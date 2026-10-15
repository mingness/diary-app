/**
 * Endpoints for machines, outside normal sign-in (spec §7.3): an external cron can trigger the 報數 job with
 * `Authorization: Bearer <CRON_SECRET>`. The proxy must not route `/internal/` from the internet (Phase C);
 * the secret is the second lock.
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { RunNowResponse } from '@diary/shared';
import type { AppContext } from '../context.js';
import { COUNT_AUTO_SUBMIT } from '../jobs.js';
import { unauthorized } from '../http-errors.js';
import { runJob } from '../scheduler.js';

/** Constant-time, so the response time doesn't reveal how much of a guess was right. */
export function bearerMatches(header: string | undefined, secret: string): boolean {
  const given = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function internalRoutes(app: FastifyInstance, ctx: AppContext, pool: pg.Pool): void {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/internal/count/auto-run',
    {
      onRequest: async (request) => {
        if (!bearerMatches(request.headers.authorization, ctx.config.cronSecret))
          throw unauthorized();
      },
      schema: {
        tags: ['internal'],
        summary:
          'Run 報數 auto-submit (for an external cron; Bearer CRON_SECRET; not routed publicly)',
        response: { 200: RunNowResponse },
      },
    },
    async (request) => ({ result: await runJob(ctx, pool, COUNT_AUTO_SUBMIT, request.log) }),
  );
}
