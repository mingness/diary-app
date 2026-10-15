/**
 * The diary (spec §5): the owner's create, 暫存, 提交/更新, history and month list; reading an entry as its
 * owner, as a leader, or as a reader of an open entry; the open-entry list; leaders' comments; and sharing
 * changes.
 */
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AccessChangeRequest,
  AccessChangeResponse,
  CreateDocumentRequest,
  DocumentIdParams,
  EntryView,
  MyComment,
  SaveCommentRequest,
  DocumentVersions,
  MyDocumentList,
  MyDocumentsQuery,
  OpenDocumentList,
  OpenDocumentsQuery,
  OwnDocument,
  SaveDocumentRequest,
} from '@diary/shared';
import type { AppContext } from '../context.js';
import { Capability } from '../domain/authz/policy.js';
import { authOf, requireCapability } from '../plugins/auth.js';
import { recordActivity, safely, type ActivitySubject } from '../services/activity.js';
import { saveMyComment } from '../services/diary/comments.js';
import {
  createDocument,
  listOwnMonth,
  saveDraft,
  submitDocument,
  type Written,
} from '../services/diary/documents.js';
import { listVersions, readEntry, type Reader } from '../services/diary/entries.js';
import { listOpenMonth } from '../services/open-diaries.js';
import { changeAccess } from '../services/sharing.js';
import { LimitReachedError } from '../services/diary/usage.js';

const TAG = ['diary'];

function readerOf(request: FastifyRequest): Reader {
  const { actor, user } = authOf(request);
  return { ...actor, username: user.username };
}

/**
 * Runs a write and records the activity it reports, including a daily warning level it reached. A refused
 * write is recorded as `limit_reached` (which flags the account when it was a daily cap, spec §5.5), and the
 * refusal still reaches the client.
 */
async function tracked<T extends Pick<Written, 'activity' | 'elevated'>>(
  ctx: AppContext,
  log: FastifyBaseLogger,
  user: ActivitySubject,
  write: () => Promise<T>,
): Promise<T> {
  try {
    const result = await write();
    const kind = result.activity;
    if (kind) await safely(log, () => recordActivity(ctx, user, kind));
    const { elevated } = result;
    if (elevated) {
      await safely(log, () =>
        recordActivity(ctx, user, 'elevated_activity', {
          usage: elevated.usage,
          count: elevated.count,
        }),
      );
    }
    return result;
  } catch (err) {
    if (err instanceof LimitReachedError) {
      await safely(log, () => recordActivity(ctx, user, 'limit_reached', { limit: err.limit }));
    }
    throw err;
  }
}

export function documentRoutes(app: FastifyInstance, ctx: AppContext): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const writer = requireCapability(Capability.WriteDiary);

  routes.get(
    '/api/documents/mine',
    {
      onRequest: writer,
      schema: {
        tags: TAG,
        summary: 'My entries in a Beijing calendar month, newest first',
        querystring: MyDocumentsQuery,
        response: { 200: MyDocumentList },
      },
    },
    async (request) => listOwnMonth(ctx, authOf(request).user.id, request.query.month),
  );

  routes.get(
    '/api/documents/open',
    {
      onRequest: requireCapability(Capability.ReadOpenDiaries),
      schema: {
        tags: TAG,
        summary:
          '開放日記: open entries in a Beijing calendar month, newest first (read each with GET /api/documents/:id)',
        querystring: OpenDocumentsQuery,
        response: { 200: OpenDocumentList },
      },
    },
    async (request) => listOpenMonth(ctx, request.query.month),
  );

  routes.post(
    '/api/documents',
    {
      onRequest: writer,
      schema: {
        tags: TAG,
        summary:
          'Create an entry dated today (Beijing; it can never be changed). Daily limit: 20 (spec §5.5).',
        body: CreateDocumentRequest,
        response: { 201: OwnDocument },
      },
    },
    async (request, reply) => {
      const { user } = authOf(request);
      const { document } = await tracked(ctx, request.log, user, () =>
        createDocument(ctx, user.id, request.body),
      );
      return reply.code(201).send(document);
    },
  );

  routes.get(
    '/api/documents/:id',
    {
      onRequest: writer,
      schema: {
        tags: TAG,
        summary:
          'One entry. Owner (view=owner): what leaders see, my pending draft, and submitted comments, which ' +
          "are then marked seen. Leader (view=leader): the last submitted version only, other leaders' " +
          'submitted comments and my own comment; each read is audited. Anyone else, for an open entry ' +
          '(view=reader): the submitted version and submitted comments.',
        params: DocumentIdParams,
        response: { 200: EntryView },
      },
    },
    async (request) => readEntry(ctx, readerOf(request), request.params.id),
  );

  routes.put(
    '/api/documents/:id/draft',
    {
      onRequest: writer,
      schema: {
        tags: TAG,
        summary: '暫存: save my working copy. Leaders keep seeing the last submission.',
        params: DocumentIdParams,
        body: SaveDocumentRequest,
        response: { 200: OwnDocument },
      },
    },
    async (request) => {
      const { user } = authOf(request);
      const { document } = await tracked(ctx, request.log, user, () =>
        saveDraft(ctx, user.id, request.params.id, request.body),
      );
      return document;
    },
  );

  routes.post(
    '/api/documents/:id/submit',
    {
      onRequest: writer,
      schema: {
        tags: TAG,
        summary:
          '提交 (first time) or 更新 (afterwards; the previous version goes to history, newest 3 kept). ' +
          'Limits: 5,000 characters, 2 photos; 20 first submissions and 50 updates per day.',
        params: DocumentIdParams,
        body: SaveDocumentRequest,
        response: { 200: OwnDocument },
      },
    },
    async (request) => {
      const { user } = authOf(request);
      const { document } = await tracked(ctx, request.log, user, () =>
        submitDocument(ctx, user.id, request.params.id, request.body),
      );
      return document;
    },
  );

  routes.get(
    '/api/documents/:id/versions',
    {
      onRequest: writer,
      schema: {
        tags: TAG,
        summary: '历史版本: earlier submitted versions, newest first (at most 3); owner or leader',
        params: DocumentIdParams,
        response: { 200: DocumentVersions },
      },
    },
    async (request) => listVersions(ctx, readerOf(request), request.params.id),
  );

  routes.put(
    '/api/documents/:id/comments/mine',
    {
      onRequest: requireCapability(Capability.LeaderReview),
      schema: {
        tags: ['leader'],
        summary:
          'Leaders: 暫存 (state=draft, only I see it) or 提交 (state=submitted, the owner sees it) my one ' +
          "comment on someone else's submitted entry. Entry limits apply: 2 photos, and 5,000 characters " +
          'when submitting.',
        params: DocumentIdParams,
        body: SaveCommentRequest,
        response: { 200: MyComment },
      },
    },
    async (request) => {
      const { actor, user } = authOf(request);
      const { comment } = await tracked(ctx, request.log, user, () =>
        saveMyComment(ctx, actor, request.params.id, request.body),
      );
      return comment;
    },
  );

  routes.post(
    '/api/documents/:id/access',
    {
      onRequest: writer,
      schema: {
        tags: TAG,
        summary:
          'Sharing. Owner: request, withdraw, revoke. Leader (not on own entries): approve, decline, revoke. ' +
          'Only submitted entries; 409 invalid_transition when the current state does not allow it.',
        params: DocumentIdParams,
        body: AccessChangeRequest,
        response: { 200: AccessChangeResponse },
      },
    },
    async (request) => ({
      access: await changeAccess(
        ctx,
        authOf(request).actor,
        request.params.id,
        request.body.action,
      ),
    }),
  );
}
