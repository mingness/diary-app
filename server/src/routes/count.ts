/** 報數 (spec §7): everyone's shared count, and each user's own submissions and auto-submit settings. */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  CountEntry,
  CountLatest,
  CountSettings,
  CountSummary,
  SubmitCountRequest,
  UpdateCountSettings,
} from '@diary/shared';
import type { AppContext } from '../context.js';
import { Capability } from '../domain/authz/policy.js';
import { authOf, requireCapability } from '../plugins/auth.js';
import { recordActivity, safely } from '../services/activity.js';
import {
  countSummary,
  getCountSettings,
  latestCounts,
  submitCount,
  updateCountSettings,
} from '../services/count.js';
import { LimitReachedError } from '../services/diary/usage.js';

const TAG = ['count'];

export function countRoutes(app: FastifyInstance, ctx: AppContext): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const counter = requireCapability(Capability.Count);

  routes.get(
    '/api/count/summary',
    {
      onRequest: counter,
      schema: {
        tags: TAG,
        summary:
          'The progress card: all-time total, goal, percent, today, and the dates I may report for',
        response: { 200: CountSummary },
      },
    },
    async () => countSummary(ctx),
  );

  routes.get(
    '/api/count/latest',
    {
      onRequest: counter,
      schema: {
        tags: TAG,
        summary: 'The latest-20 table: one row per user, most recent submission first',
        response: { 200: CountLatest },
      },
    },
    async () => latestCounts(ctx),
  );

  routes.post(
    '/api/count',
    {
      onRequest: counter,
      schema: {
        tags: TAG,
        summary:
          '報數: report a count (1–1080) for today or one of the 5 days before (Beijing). It also becomes my ' +
          'saved number for auto-submit. At most 10 per count date.',
        body: SubmitCountRequest,
        response: { 201: CountEntry },
      },
    },
    async (request, reply) => {
      const { user } = authOf(request);
      try {
        const entry = await submitCount(ctx, user.id, request.body);
        await safely(request.log, () => recordActivity(ctx, user, 'count_entry'));
        return reply.code(201).send(entry);
      } catch (err) {
        if (err instanceof LimitReachedError) {
          await safely(request.log, () =>
            recordActivity(ctx, user, 'limit_reached', { limit: err.limit }),
          );
        }
        throw err;
      }
    },
  );

  routes.get(
    '/api/count/settings',
    {
      onRequest: counter,
      schema: {
        tags: TAG,
        summary: 'My auto-submit choice and saved number',
        response: { 200: CountSettings },
      },
    },
    async (request) => getCountSettings(ctx, authOf(request).user.id),
  );

  routes.put(
    '/api/count/settings',
    {
      onRequest: counter,
      schema: {
        tags: TAG,
        summary:
          'Save my auto-submit choice or the number I typed (0–1080); the 02:00 job submits it daily',
        body: UpdateCountSettings,
        response: { 200: CountSettings },
      },
    },
    async (request) => updateCountSettings(ctx, authOf(request).user.id, request.body),
  );
}
