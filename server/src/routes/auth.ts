/**
 * Login, logout, registration and forgot-password (spec §4.1–4.3).
 *
 * Failed logins say the same thing, and take the same time, whether the username is unknown, the password is
 * wrong or the account is locked pending a reset, so the form can't be used to discover accounts.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import {
  AuthOptions,
  CaptchaResponse,
  ErrorCode,
  ForgotPasswordRequest,
  LoginRequest,
  LoginResponse,
  OkResponse,
  RegisterRequest,
  TotpCode,
  type SessionUser,
} from '@diary/shared';
import type { AppContext } from '../context.js';
import { users } from '../db/schema.js';
import {
  hashPassword,
  needsRehash,
  verifyAgainstDummy,
  verifyPassword,
} from '../domain/auth/passwords.js';
import { initialMfaState } from '../domain/auth/sessions.js';
import type { FailureThrottle } from '../domain/auth/throttle.js';
import { checkTotp } from '../domain/auth/totp.js';
import { captchaFailed, HttpError, invalidCredentials, rateLimited } from '../http-errors.js';
import { authOf, clearSessionCookie, requireAuth, setSessionCookie } from '../plugins/auth.js';
import { recordActivity, recordLogin, safely } from '../services/activity.js';
import { consumeCaptcha, issueCaptcha } from '../services/captchas.js';
import { openTotpSecret } from '../services/profiles.js';
import {
  createSession,
  revokeSession,
  revokeUserSessions,
  setSessionMfa,
} from '../services/sessions.js';
import {
  createUser,
  EmailTakenError,
  findUserByUsername,
  UsernameTakenError,
  type UserRow,
} from '../services/users.js';
import { EMPTY_PROFILE } from '../services/profiles.js';

export interface RateLimit {
  readonly max: number;
  readonly timeWindow: string;
}

export interface AuthLimits {
  readonly captcha: RateLimit;
  readonly login: RateLimit;
  readonly totp: RateLimit;
  readonly register: RateLimit;
  readonly forgotPassword: RateLimit;
}

/** Per-IP limits; the per-account throttles below are the main defence against password guessing. */
export const DEFAULT_AUTH_LIMITS: AuthLimits = {
  captcha: { max: 60, timeWindow: '1 minute' },
  login: { max: 20, timeWindow: '1 minute' },
  totp: { max: 20, timeWindow: '1 minute' },
  register: { max: 10, timeWindow: '1 hour' },
  forgotPassword: { max: 5, timeWindow: '1 hour' },
};

export interface AuthThrottles {
  /** Wrong passwords per username. */
  readonly password: FailureThrottle;
  /** Wrong authenticator codes per user; on reaching the limit the half-open session is ended. */
  readonly totp: FailureThrottle;
}

export function toSessionUser(user: UserRow): SessionUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    fontSize: user.fontSize as SessionUser['fontSize'],
    theme: user.theme,
  };
}

const AUTH_TAG = ['auth'];

export function authRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  limits: AuthLimits,
  throttles: AuthThrottles,
): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    '/api/auth/captcha',
    {
      config: { rateLimit: limits.captcha },
      schema: {
        tags: AUTH_TAG,
        summary:
          'A new verification image. The answer is never sent; each one can be checked once.',
        response: { 200: CaptchaResponse },
      },
    },
    async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      return issueCaptcha(ctx);
    },
  );

  routes.post(
    '/api/auth/login',
    {
      config: { rateLimit: limits.login },
      schema: {
        tags: AUTH_TAG,
        summary: 'Sign in with username, password and the CAPTCHA answer',
        body: LoginRequest,
        response: { 200: LoginResponse },
      },
    },
    async (request, reply) => {
      const { username, password, captchaId, captchaAnswer, remember } = request.body;
      if (!(await consumeCaptcha(ctx, captchaId, captchaAnswer))) throw captchaFailed();

      const throttleKey = username.trim().toLowerCase();
      const user = await findUserByUsername(ctx, username);
      // Failed attempts are recorded for real accounts only: a mistyped username is often a password typed
      // into the wrong box, and must never be stored.
      const recordFailure = (reason: string) =>
        user
          ? safely(request.log, () => recordActivity(ctx, user, 'login_failed', { reason }))
          : Promise.resolve();

      if (throttles.password.isBlocked(throttleKey)) {
        await recordFailure('throttled');
        throw rateLimited();
      }
      const passwordOk = user
        ? await verifyPassword(user.passwordHash, password)
        : await verifyAgainstDummy(password);
      if (!user || !passwordOk || user.resetPending) {
        throttles.password.recordFailure(throttleKey);
        request.log.info({ event: 'login_failed' }, 'login failed');
        await recordFailure(passwordOk ? 'locked' : 'password');
        throw invalidCredentials();
      }
      throttles.password.reset(throttleKey);

      // Signing in replaces any session this browser already had (prevents session fixation).
      if (request.auth) await revokeSession(ctx, request.auth.session.idHash);

      const now = ctx.clock();
      const updates: Partial<typeof users.$inferInsert> = { lastLoginAt: now };
      if (needsRehash(user.passwordHash)) updates.passwordHash = await hashPassword(password);
      await ctx.db.update(users).set(updates).where(eq(users.id, user.id));

      const mfa = initialMfaState(user.role, user.totpEnabledAt !== null, ctx.config.skipTotp);
      const kind = remember ? 'device' : 'browser';
      const { token, session } = await createSession(ctx, user, {
        kind,
        mfa,
        userAgent: request.headers['user-agent'],
      });
      setSessionCookie(reply, ctx, token, kind, user.role, mfa);
      request.log.info({ event: 'login', userId: user.id, mfa }, 'login');
      await safely(request.log, () => recordLogin(ctx, user, session.deviceLabel));

      if (mfa === 'pending')
        return { status: 'totp_required' as const, csrfToken: session.csrfToken };
      if (mfa === 'enrolment_required') {
        return {
          status: 'totp_enrolment_required' as const,
          user: toSessionUser(user),
          csrfToken: session.csrfToken,
        };
      }
      return { status: 'ok' as const, user: toSessionUser(user), csrfToken: session.csrfToken };
    },
  );

  routes.post(
    '/api/auth/totp',
    {
      config: { rateLimit: limits.totp },
      onRequest: requireAuth({ allowMfa: ['pending'] }),
      schema: {
        tags: AUTH_TAG,
        summary: 'Second login step: the 6-digit authenticator code',
        body: TotpCode,
        response: { 200: LoginResponse },
      },
    },
    async (request, reply) => {
      const { session, user } = authOf(request);
      if (session.mfa !== 'pending' || !user.totpSecretCt || !user.totpSecretNonce) {
        throw new HttpError(409, ErrorCode.InvalidTransition, 'No authenticator code is expected');
      }
      const key = user.id;
      if (throttles.totp.isBlocked(key)) {
        await revokeSession(ctx, session.idHash);
        clearSessionCookie(reply, ctx);
        throw rateLimited();
      }
      const secret = openTotpSecret(ctx.config.profileKeyring, user.id, user.profileDekWrapped, {
        totpSecretCt: user.totpSecretCt,
        totpSecretNonce: user.totpSecretNonce,
      });
      const check = checkTotp(secret, request.body.code, ctx.clock(), user.totpLastStep);
      if (!check.ok) {
        throttles.totp.recordFailure(key);
        await safely(request.log, () =>
          recordActivity(ctx, user, 'login_failed', { reason: 'totp' }),
        );
        request.log.info({ event: 'totp_failed', userId: user.id }, 'authenticator code rejected');
        throw new HttpError(401, ErrorCode.TotpInvalid, 'Wrong or reused authenticator code');
      }
      throttles.totp.reset(key);
      await ctx.db.update(users).set({ totpLastStep: check.step }).where(eq(users.id, user.id));
      const updated = await setSessionMfa(ctx, session, user, 'verified');
      return { status: 'ok' as const, user: toSessionUser(user), csrfToken: updated.csrfToken };
    },
  );

  routes.post(
    '/api/auth/logout',
    {
      onRequest: requireAuth({ allowMfa: ['pending', 'enrolment_required'] }),
      schema: { tags: AUTH_TAG, summary: 'Sign out this session', response: { 200: OkResponse } },
    },
    async (request, reply) => {
      await revokeSession(ctx, authOf(request).session.idHash);
      clearSessionCookie(reply, ctx);
      return { ok: true as const };
    },
  );

  routes.get(
    '/api/auth/options',
    {
      schema: {
        tags: AUTH_TAG,
        summary: 'What the sign-in screens may offer, such as registering',
        response: { 200: AuthOptions },
      },
    },
    async () => ({ registration: ctx.config.registrationOpen }),
  );

  routes.post(
    '/api/auth/register',
    {
      config: { rateLimit: limits.register },
      // Before the body is read, so a closed server says so instead of complaining about the form.
      onRequest: async () => {
        if (!ctx.config.registrationOpen) {
          throw new HttpError(403, ErrorCode.RegistrationClosed, 'Registration is closed');
        }
      },
      schema: {
        tags: AUTH_TAG,
        summary: 'Create a normal user account (no email verification, spec §4.2)',
        body: RegisterRequest,
        response: { 201: OkResponse },
      },
    },
    async (request, reply) => {
      const { captchaId, captchaAnswer, username, password, email, profile } = request.body;
      if (!(await consumeCaptcha(ctx, captchaId, captchaAnswer))) throw captchaFailed();
      try {
        const user = await createUser(ctx, {
          username,
          password,
          email,
          role: 'NORMAL_USER',
          profile: profile ?? EMPTY_PROFILE,
        });
        request.log.info({ event: 'register', userId: user.id }, 'registered');
      } catch (err) {
        if (err instanceof UsernameTakenError) {
          throw new HttpError(409, ErrorCode.UsernameTaken, 'Username taken');
        }
        if (err instanceof EmailTakenError) {
          throw new HttpError(409, ErrorCode.EmailTaken, 'Email already in use');
        }
        throw err;
      }
      return reply.code(201).send({ ok: true as const });
    },
  );

  routes.post(
    '/api/auth/forgot-password',
    {
      config: { rateLimit: limits.forgotPassword },
      schema: {
        tags: AUTH_TAG,
        summary:
          'Lock the account until a SYS_ADMIN sets a new password (spec §4.3). Always answers ok, whether or not the user exists.',
        body: ForgotPasswordRequest,
        response: { 200: OkResponse },
      },
    },
    async (request) => {
      const { captchaId, captchaAnswer, username } = request.body;
      if (!(await consumeCaptcha(ctx, captchaId, captchaAnswer))) throw captchaFailed();
      const user = await findUserByUsername(ctx, username);
      // SYS_ADMIN accounts can't be locked from the public form: anyone could lock every admin out. A locked-out
      // admin is reset by another admin or with the server's command-line tool.
      if (user && user.role !== 'SYS_ADMIN' && !user.resetPending) {
        await ctx.db
          .update(users)
          .set({ resetPending: true, updatedAt: ctx.clock() })
          .where(eq(users.id, user.id));
        await revokeUserSessions(ctx, user.id);
        request.log.info({ event: 'reset_requested', userId: user.id }, 'password reset requested');
      }
      return { ok: true as const };
    },
  );
}
