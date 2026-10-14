/**
 * SYS_ADMIN activity log, summary and Attention list (spec §6.5.5, docs/ARCHITECTURE.md §8.9).
 * Metadata only: these routes never touch content, titles or profile fields.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ActivityList,
  ActivityQuery,
  ActivitySummary,
  ActivitySummaryQuery,
  AlertIdParams,
  AlertList,
  AlertListQuery,
  AlertStatus,
  ErrorCode,
  OkResponse,
} from '@diary/shared';
import type { AppContext } from '../context.js';
import { Capability } from '../domain/authz/policy.js';
import { HttpError } from '../http-errors.js';
import { authOf, requireCapability } from '../plugins/auth.js';
import { activitySummary, listActivity } from '../services/activity-admin.js';
import {
  alertStatus,
  listAlerts,
  markHandled,
  MAX_EMAIL_ATTEMPTS,
  type AlertRow,
} from '../services/alerts.js';

const TAG = ['admin: attention & activity'];

function emailState(ctx: AppContext, a: AlertRow) {
  if (a.emailedAt) return 'sent' as const;
  if (!ctx.mailer) return 'not_configured' as const;
  if (a.emailAttempts >= MAX_EMAIL_ATTEMPTS) return 'gave_up' as const;
  if (a.lastError) return 'failing' as const;
  return 'pending' as const;
}

export function adminActivityRoutes(app: FastifyInstance, ctx: AppContext): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const guard = requireCapability(Capability.ReviewActivity);

  routes.get(
    '/api/admin/attention',
    {
      onRequest: guard,
      schema: {
        tags: TAG,
        summary: 'Flagged accounts, newest first',
        querystring: AlertListQuery,
        response: { 200: AlertList },
      },
    },
    async (request) => {
      const rows = await listAlerts(ctx, request.query.status);
      return {
        alerts: rows.map((a) => ({
          id: a.id,
          userId: a.userId,
          username: a.username,
          rule: a.rule,
          createdAt: a.createdAt.toISOString(),
          handledAt: a.handledAt?.toISOString() ?? null,
          email: emailState(ctx, a),
          lastError: a.lastError,
        })),
      };
    },
  );

  routes.get(
    '/api/admin/attention/status',
    {
      onRequest: guard,
      schema: {
        tags: TAG,
        summary: 'Open count (for the badge) and whether email alerts are on',
        response: { 200: AlertStatus },
      },
    },
    async () => alertStatus(ctx),
  );

  routes.post(
    '/api/admin/attention/:id/handled',
    {
      onRequest: guard,
      schema: {
        tags: TAG,
        summary: 'Mark a flag as handled',
        params: AlertIdParams,
        response: { 200: OkResponse },
      },
    },
    async (request) => {
      const actorId = authOf(request).user.id;
      if (!(await markHandled(ctx, request.params.id, actorId))) {
        throw new HttpError(404, ErrorCode.NotFound, 'No such open item');
      }
      request.log.info(
        { event: 'admin_action', actorId, action: 'alert_handled', target: request.params.id },
        'admin action',
      );
      return { ok: true as const };
    },
  );

  routes.get(
    '/api/admin/activity',
    {
      onRequest: guard,
      schema: {
        tags: TAG,
        summary: 'Activity events, newest first (kept 90 days)',
        querystring: ActivityQuery,
        response: { 200: ActivityList },
      },
    },
    async (request) => listActivity(ctx, request.query),
  );

  routes.get(
    '/api/admin/activity/summary',
    {
      onRequest: guard,
      schema: {
        tags: TAG,
        summary: 'Per-user totals for today and the last 7 days, with storage used',
        querystring: ActivitySummaryQuery,
        response: { 200: ActivitySummary },
      },
    },
    async (request) => activitySummary(ctx, request.query.sort),
  );
}
