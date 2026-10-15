/** SYS_ADMIN 報數 tools (spec §6.5.3, §7.3): every user's settings and totals, deletes, and the auto-submit job. */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { z } from 'zod';
import {
  AdminAutoSubmitRequest,
  AdminCountUsers,
  AdminDeleteCountsQuery,
  CountJobRuns,
  CountSettings,
  DeletedCount,
  RunNowResponse,
} from '@diary/shared';
import type { AppContext } from '../context.js';
import { Capability } from '../domain/authz/policy.js';
import { COUNT_AUTO_SUBMIT } from '../jobs.js';
import { authOf, requireCapability } from '../plugins/auth.js';
import { runJob } from '../scheduler.js';
import {
  adminCountUsers,
  autoSubmitRuns,
  deleteCounts,
  updateCountSettings,
} from '../services/count.js';

const TAG = ['admin: count'];
const UserParams = z.object({ id: z.uuid() });

export function adminCountRoutes(app: FastifyInstance, ctx: AppContext, pool: pg.Pool): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const admin = requireCapability(Capability.ManageCount);

  routes.get(
    '/api/admin/count/users',
    {
      onRequest: admin,
      schema: {
        tags: TAG,
        summary: 'Every user with their auto-submit setting, saved number and totals',
        response: { 200: AdminCountUsers },
      },
    },
    async () => adminCountUsers(ctx),
  );

  routes.put(
    '/api/admin/count/users/:id/auto',
    {
      onRequest: admin,
      schema: {
        tags: TAG,
        summary: "Turn a user's auto-submit on or off",
        params: UserParams,
        body: AdminAutoSubmitRequest,
        response: { 200: CountSettings },
      },
    },
    async (request) => {
      const result = await updateCountSettings(ctx, request.params.id, request.body);
      request.log.info(
        { event: 'count_auto_set', by: authOf(request).user.id, userId: request.params.id },
        'auto-submit changed by admin',
      );
      return result;
    },
  );

  routes.delete(
    '/api/admin/count/users/:id/entries',
    {
      onRequest: admin,
      schema: {
        tags: TAG,
        summary:
          "Delete a user's count entries: those with a count date in from..to (inclusive), or all of them",
        params: UserParams,
        querystring: AdminDeleteCountsQuery,
        response: { 200: DeletedCount },
      },
    },
    async (request) => {
      const deleted = await deleteCounts(ctx, request.params.id, request.query);
      request.log.info(
        {
          event: 'count_entries_deleted',
          by: authOf(request).user.id,
          userId: request.params.id,
          deleted,
        },
        'count entries deleted by admin',
      );
      return { deleted };
    },
  );

  routes.get(
    '/api/admin/count/job-runs',
    {
      onRequest: admin,
      schema: {
        tags: TAG,
        summary: 'Recent auto-submit runs, and whether the latest 02:00 run is missing or failed',
        response: { 200: CountJobRuns },
      },
    },
    async () => autoSubmitRuns(ctx),
  );

  routes.post(
    '/api/admin/count/run-now',
    {
      onRequest: admin,
      schema: {
        tags: TAG,
        summary:
          "Run auto-submit now. Users already auto-submitted today get nothing more; 'skipped' if it's running",
        response: { 200: RunNowResponse },
      },
    },
    async (request) => ({ result: await runJob(ctx, pool, COUNT_AUTO_SUBMIT, request.log) }),
  );
}
