/**
 * The account page (spec §4.4): the signed-in user, profile and appearance, password change, signed-in devices,
 * and authenticator setup (D12).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq, isNull } from 'drizzle-orm';
import QRCode from 'qrcode';
import {
  ChangePasswordRequest,
  DeviceList,
  ErrorCode,
  MeResponse,
  OkResponse,
  SessionIdParams,
  TotpChangeRequest,
  TotpCode,
  TotpSetupResponse,
  UpdateMeRequest,
} from '@diary/shared';
import type { AppContext } from '../context.js';
import { users } from '../db/schema.js';
import { checkTotp, generateTotpSecret, totpUri } from '../domain/auth/totp.js';
import { HttpError } from '../http-errors.js';
import { authOf, clearSessionCookie, requireAuth } from '../plugins/auth.js';
import { changePassword, listMySessions, revokeMySession, updateMe } from '../services/account.js';
import { recordActivity, safely } from '../services/activity.js';
import { openProfile, openTotpSecret, sealTotpSecret } from '../services/profiles.js';
import { setSessionMfa, type SessionRow } from '../services/sessions.js';
import { storageBytesFor } from '../services/storage.js';
import { confirmTotpChange, startTotpChange } from '../services/totp-change.js';
import type { UserRow } from '../services/users.js';
import { toSessionUser, type AuthThrottles } from './auth.js';

const ME_TAG = ['me'];
const enrolmentAllowed = requireAuth({ allowMfa: ['enrolment_required'] });

export function meRoutes(app: FastifyInstance, ctx: AppContext, throttles: AuthThrottles): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const signedIn = requireAuth();

  /** What `GET /api/me` and `PUT /api/me` answer. Never cached: it holds the decrypted profile. */
  async function me(reply: FastifyReply, user: UserRow, session: SessionRow) {
    reply.header('cache-control', 'no-store');
    return {
      user: {
        ...toSessionUser(user),
        email: user.email,
        profile: openProfile(ctx.config.profileKeyring, user.id, user),
        totpEnabled: user.totpEnabledAt !== null,
        storageBytes: await storageBytesFor(ctx, user.id),
      },
      features: { translation: ctx.translator !== null },
      csrfToken: session.csrfToken,
    };
  }

  routes.get(
    '/api/me',
    {
      onRequest: enrolmentAllowed,
      schema: {
        tags: ME_TAG,
        summary: 'The signed-in user, including the decrypted profile',
        response: { 200: MeResponse },
      },
    },
    async (request, reply) => {
      const { user, session } = authOf(request);
      return me(reply, user, session);
    },
  );

  routes.put(
    '/api/me',
    {
      onRequest: signedIn,
      schema: {
        tags: ME_TAG,
        summary:
          'Save my email, profile (name, address, photo), text size or theme; fields left out stay as they are. ' +
          'The username never changes.',
        body: UpdateMeRequest,
        response: { 200: MeResponse },
      },
    },
    async (request, reply) => {
      const { user, session } = authOf(request);
      return me(reply, await updateMe(ctx, user, request.body), session);
    },
  );

  routes.post(
    '/api/me/password',
    {
      onRequest: signedIn,
      schema: {
        tags: ME_TAG,
        summary:
          'Change my password (current password required). Signs out my other devices; this one stays signed in.',
        body: ChangePasswordRequest,
        response: { 200: OkResponse },
      },
    },
    async (request) => {
      const { user, session } = authOf(request);
      await changePassword(ctx, user, session, request.body, throttles.password);
      request.log.info({ event: 'password_changed', userId: user.id }, 'password changed');
      await safely(request.log, () =>
        recordActivity(ctx, user, 'password_changed', { by: 'self' }),
      );
      return { ok: true as const };
    },
  );

  routes.get(
    '/api/me/sessions',
    {
      onRequest: signedIn,
      schema: {
        tags: ME_TAG,
        summary: 'My signed-in devices, most recently used first',
        response: { 200: DeviceList },
      },
    },
    async (request) => {
      const { user, session } = authOf(request);
      return listMySessions(ctx, user, session);
    },
  );

  routes.delete(
    '/api/me/sessions/:id',
    {
      onRequest: signedIn,
      schema: {
        tags: ME_TAG,
        summary: 'Sign out one of my devices (this one included)',
        params: SessionIdParams,
        response: { 200: OkResponse },
      },
    },
    async (request, reply) => {
      const { user, session } = authOf(request);
      const { wasCurrent } = await revokeMySession(ctx, user, session, request.params.id);
      if (wasCurrent) clearSessionCookie(reply, ctx);
      return { ok: true as const };
    },
  );

  routes.post(
    '/api/me/totp/setup',
    {
      onRequest: enrolmentAllowed,
      schema: {
        tags: ME_TAG,
        summary:
          'Start authenticator setup: returns the secret as a QR code. Confirm with a code to switch it on.',
        response: { 200: TotpSetupResponse },
      },
    },
    async (request, reply) => {
      const { user } = authOf(request);
      if (user.totpEnabledAt) {
        throw new HttpError(409, ErrorCode.InvalidTransition, 'Authenticator already set up');
      }
      const secret = generateTotpSecret();
      const sealed = sealTotpSecret(
        ctx.config.profileKeyring,
        user.id,
        user.profileDekWrapped,
        secret,
      );
      await ctx.db
        .update(users)
        .set({ ...sealed, totpLastStep: null, updatedAt: ctx.clock() })
        .where(eq(users.id, user.id));
      const uri = totpUri(secret, user.username);
      reply.header('cache-control', 'no-store');
      return { otpauthUri: uri, qrSvg: await QRCode.toString(uri, { type: 'svg', margin: 1 }) };
    },
  );

  routes.post(
    '/api/me/totp/confirm',
    {
      onRequest: enrolmentAllowed,
      schema: {
        tags: ME_TAG,
        summary:
          'Finish authenticator setup with a code from the app; this session counts as verified',
        body: TotpCode,
        response: { 200: OkResponse },
      },
    },
    async (request) => {
      const { user, session } = authOf(request);
      if (user.totpEnabledAt || !user.totpSecretCt || !user.totpSecretNonce) {
        throw new HttpError(409, ErrorCode.InvalidTransition, 'No authenticator setup in progress');
      }
      const secret = openTotpSecret(ctx.config.profileKeyring, user.id, user.profileDekWrapped, {
        totpSecretCt: user.totpSecretCt,
        totpSecretNonce: user.totpSecretNonce,
      });
      const now = ctx.clock();
      const check = checkTotp(secret, request.body.code, now, null);
      if (!check.ok) throw new HttpError(401, ErrorCode.TotpInvalid, 'Wrong authenticator code');
      await ctx.db
        .update(users)
        .set({ totpEnabledAt: now, totpLastStep: check.step, updatedAt: now })
        .where(and(eq(users.id, user.id), isNull(users.totpEnabledAt)));
      if (session.mfa === 'enrolment_required') await setSessionMfa(ctx, session, user, 'verified');
      request.log.info({ event: 'totp_enabled', userId: user.id }, 'authenticator enabled');
      return { ok: true as const };
    },
  );

  routes.post(
    '/api/me/totp/change',
    {
      onRequest: signedIn,
      schema: {
        tags: ME_TAG,
        summary:
          'Move my authenticator to a new app, step one: password and a current code; returns the new QR code',
        body: TotpChangeRequest,
        response: { 200: TotpSetupResponse },
      },
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const secret = await startTotpChange(ctx, user, request.body, throttles);
      const uri = totpUri(secret, user.username);
      reply.header('cache-control', 'no-store');
      return { otpauthUri: uri, qrSvg: await QRCode.toString(uri, { type: 'svg', margin: 1 }) };
    },
  );

  routes.post(
    '/api/me/totp/change/confirm',
    {
      onRequest: signedIn,
      schema: {
        tags: ME_TAG,
        summary:
          'Step two: a code from the new app replaces the old authenticator and signs out my other devices',
        body: TotpCode,
        response: { 200: OkResponse },
      },
    },
    async (request) => {
      const { user, session } = authOf(request);
      await confirmTotpChange(ctx, user, session, request.body.code, throttles.totp);
      request.log.info({ event: 'totp_changed', userId: user.id }, 'authenticator moved');
      // Raises a 注意 alert for every SYS_ADMIN, in case it wasn't the real owner.
      await safely(request.log, () => recordActivity(ctx, user, 'totp_changed'));
      return { ok: true as const };
    },
  );
}
