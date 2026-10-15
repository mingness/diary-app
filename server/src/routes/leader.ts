/** The COURSE_LEADER review screens (spec §6.3, docs/FRONTEND.md §4.7): lists only, never content. */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  LeaderCalendar,
  LeaderDocumentList,
  LeaderDocumentsQuery,
  LeaderMonthQuery,
  LeaderUserList,
  OpenRequestList,
} from '@diary/shared';
import type { AppContext } from '../context.js';
import { Capability } from '../domain/authz/policy.js';
import { authOf, requireCapability } from '../plugins/auth.js';
import {
  calendarCounts,
  documentsOfUser,
  documentsOnDate,
  openRequests,
  unreadDocuments,
  usersWithMonthCounts,
} from '../services/leader.js';

const TAG = ['leader'];

export function leaderRoutes(app: FastifyInstance, ctx: AppContext): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const leader = requireCapability(Capability.LeaderReview);

  routes.get(
    '/api/leader/documents',
    {
      onRequest: leader,
      schema: {
        tags: TAG,
        summary:
          "Every submitted entry, mine included: ?date= for everyone's on a Beijing date, paged; ?user=&month= " +
          "for one user's month; or ?unread=true for what I haven't read since it was last submitted (last 90 " +
          'days, not my own), paged. Each row says my comment state, whether another leader has commented, and ' +
          'whether I have read it.',
        querystring: LeaderDocumentsQuery,
        response: { 200: LeaderDocumentList },
      },
    },
    async (request) => {
      const { id } = authOf(request).user;
      const q = request.query;
      if (q.unread) return unreadDocuments(ctx, id, q.page, q.size);
      return q.date
        ? documentsOnDate(ctx, id, q.date, q.page, q.size)
        : documentsOfUser(ctx, id, q.user ?? '', q.month ?? '');
    },
  );

  routes.get(
    '/api/leader/calendar',
    {
      onRequest: leader,
      schema: {
        tags: TAG,
        summary: 'Submitted entries per Beijing date in a month (days with none are left out)',
        querystring: LeaderMonthQuery,
        response: { 200: LeaderCalendar },
      },
    },
    async (request) => calendarCounts(ctx, request.query.month),
  );

  routes.get(
    '/api/leader/users',
    {
      onRequest: leader,
      schema: {
        tags: TAG,
        summary: '學員: everyone who keeps a diary, with their submitted entries this month',
        querystring: LeaderMonthQuery,
        response: { 200: LeaderUserList },
      },
    },
    async (request) => usersWithMonthCounts(ctx, request.query.month),
  );

  routes.get(
    '/api/leader/open-requests',
    {
      onRequest: leader,
      schema: {
        tags: TAG,
        summary: 'Entries waiting for approval to open, oldest request first',
        response: { 200: OpenRequestList },
      },
    },
    async (request) => openRequests(ctx, authOf(request).user.id),
  );
}
