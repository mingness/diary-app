/**
 * The signed-in user (spec §4.4) and authenticator setup (D12). The rest of the account page (profile edits,
 * password change, devices) arrives in delivery slice 8.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, eq, isNull } from 'drizzle-orm';
import QRCode from 'qrcode';
import { ErrorCode, MeResponse, OkResponse, TotpCode, TotpSetupResponse } from '@diary/shared';
import type { AppContext } from '../context.js';
import { users } from '../db/schema.js';
import { checkTotp, generateTotpSecret, totpUri } from '../domain/auth/totp.js';
import { HttpError } from '../http-errors.js';
import { authOf, requireAuth } from '../plugins/auth.js';
import { openProfile, openTotpSecret, sealTotpSecret } from '../services/profiles.js';
import { setSessionMfa } from '../services/sessions.js';
import { storageBytesFor } from '../services/storage.js';
import { toSessionUser } from './auth.js';

const ME_TAG = ['me'];
const enrolmentAllowed = requireAuth({ allowMfa: ['enrolment_required'] });

export function meRoutes(app: FastifyInstance, ctx: AppContext): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();

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
      reply.header('cache-control', 'no-store');
      return {
        user: {
          ...toSessionUser(user),
          email: user.email,
          profile: openProfile(ctx.config.profileKeyring, user.id, user),
          totpEnabled: user.totpEnabledAt !== null,
          storageBytes: await storageBytesFor(ctx, user.id),
        },
        csrfToken: session.csrfToken,
      };
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
}
