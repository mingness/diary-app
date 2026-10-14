/**
 * The owner's diary (spec §5): create, 暫存, 提交/更新, history, and the month list. Leaders' and readers' views
 * of an entry arrive with delivery slices 6 and 7; until then anyone but the owner gets 404.
 */
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  CreateDocumentRequest,
  DocumentIdParams,
  DocumentVersions,
  MyDocumentList,
  MyDocumentsQuery,
  OwnDocument,
  SaveDocumentRequest,
} from '@diary/shared';
import type { AppContext } from '../context.js';
import { Capability } from '../domain/authz/policy.js';
import { authOf, requireCapability } from '../plugins/auth.js';
import { recordActivity, safely, type ActivitySubject } from '../services/activity.js';
import {
  createDocument,
  getOwnDocument,
  listOwnMonth,
  listOwnVersions,
  saveDraft,
  submitDocument,
  type Written,
} from '../services/diary/documents.js';
import { LimitReachedError } from '../services/diary/usage.js';

const TAG = ['diary'];

/**
 * Runs a write and records its activity. A refused write is recorded as `limit_reached`, which also flags the
 * account for SYS_ADMINs (spec §5.5), and the refusal still reaches the client.
 */
async function tracked(
  ctx: AppContext,
  log: FastifyBaseLogger,
  user: ActivitySubject,
  write: () => Promise<Written>,
): Promise<Written> {
  try {
    const result = await write();
    const kind = result.activity;
    if (kind) await safely(log, () => recordActivity(ctx, user, kind));
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
        summary: 'One of my entries: what leaders see, and my pending draft',
        params: DocumentIdParams,
        response: { 200: OwnDocument },
      },
    },
    async (request) => getOwnDocument(ctx, authOf(request).user.id, request.params.id),
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
        summary: '历史版本: earlier submitted versions, newest first (at most 3)',
        params: DocumentIdParams,
        response: { 200: DocumentVersions },
      },
    },
    async (request) => listOwnVersions(ctx, authOf(request).user.id, request.params.id),
  );
}
