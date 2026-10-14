/**
 * Session handling for every request (docs/ARCHITECTURE.md §8.2):
 *  - reads the session cookie and attaches `request.auth`;
 *  - `requireAuth` refuses anonymous requests, enforces the CSRF header on anything that changes data, and
 *    keeps half-logged-in sessions (waiting for an authenticator code) out of the rest of the app;
 *  - `requireCapability` adds the role check from the authorisation policy.
 */
import { timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  onRequestAsyncHookHandler,
} from 'fastify';
import { CSRF_HEADER, type Role } from '@diary/shared';
import type { AppContext } from '../context.js';
import { hasCapability, type Actor, type Capability } from '../domain/authz/policy.js';
import {
  idleLimitMs,
  isFullyAuthenticated,
  type MfaState,
  type SessionKind,
} from '../domain/auth/sessions.js';
import { csrfFailed, forbidden, totpRequired, unauthorized } from '../http-errors.js';
import { loadSession, type SessionRow } from '../services/sessions.js';
import type { UserRow } from '../services/users.js';

export interface AuthState {
  readonly session: SessionRow;
  readonly user: UserRow;
  readonly actor: Actor;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthState | null;
  }
}

/** `__Host-` makes browsers insist on Secure, path=/ and no Domain, so subdomains can't plant a session. */
export function sessionCookieName(ctx: AppContext): string {
  return ctx.config.env === 'production' ? '__Host-sid' : 'sid';
}

export function setSessionCookie(
  reply: FastifyReply,
  ctx: AppContext,
  token: string,
  kind: SessionKind,
  role: Role,
  mfa: MfaState,
): void {
  reply.setCookie(sessionCookieName(ctx), token, {
    httpOnly: true,
    secure: ctx.config.env === 'production',
    sameSite: 'lax',
    path: '/',
    // A browser session ends when the browser closes; a remembered device keeps its cookie as long as the
    // server-side session can live.
    ...(kind === 'device' ? { maxAge: Math.floor(idleLimitMs(kind, role, mfa) / 1000) } : {}),
  });
}

export function clearSessionCookie(reply: FastifyReply, ctx: AppContext): void {
  reply.clearCookie(sessionCookieName(ctx), { path: '/' });
}

export async function installAuth(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(cookie);
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (request, reply) => {
    const token = request.cookies[sessionCookieName(ctx)];
    if (!token) return;
    const loaded = await loadSession(ctx, token);
    if (!loaded) {
      clearSessionCookie(reply, ctx);
      return;
    }
    const { session, user } = loaded;
    request.auth = { session, user, actor: { id: user.id, role: user.role } };
    // Keep a remembered device's cookie in step with the sliding server-side expiry.
    if (session.kind === 'device') {
      setSessionCookie(reply, ctx, token, session.kind, user.role, session.mfa);
    }
  });
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfMatches(request: FastifyRequest, expected: string): boolean {
  const given = request.headers[CSRF_HEADER];
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Guards run as route `onRequest` hooks, after the global hook above has loaded the session and before the
 * body is parsed or validated, so anonymous callers get 401 rather than learning about request formats.
 *
 * Requires a signed-in session. `allowMfa` lists the incomplete second-factor states that may still use this
 * route (e.g. the authenticator step itself); fully authenticated sessions are always allowed.
 */
export function requireAuth(
  options: { allowMfa?: readonly MfaState[] } = {},
): onRequestAsyncHookHandler {
  return async (request) => {
    const auth = request.auth;
    if (!auth) throw unauthorized();
    if (!SAFE_METHODS.has(request.method) && !csrfMatches(request, auth.session.csrfToken)) {
      throw csrfFailed();
    }
    const mfa = auth.session.mfa;
    if (!isFullyAuthenticated(mfa) && !(options.allowMfa ?? []).includes(mfa)) throw totpRequired();
  };
}

/** Requires a fully signed-in session whose role grants `capability`. */
export function requireCapability(capability: Capability): onRequestAsyncHookHandler[] {
  return [
    requireAuth(),
    async (request) => {
      if (!request.auth || !hasCapability(request.auth.actor, capability)) throw forbidden();
    },
  ];
}

/** The request's session, for handlers behind `requireAuth` (which guarantees one). */
export function authOf(request: FastifyRequest): AuthState {
  if (!request.auth) throw unauthorized();
  return request.auth;
}
