/** SYS_ADMIN document management (spec §6.5.2): metadata only, and delete (D24). */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AdminDocumentList, AdminDocumentQuery, DocumentIdParams, OkResponse } from '@diary/shared';
import type { AppContext } from '../context.js';
import { Capability } from '../domain/authz/policy.js';
import { authOf, requireCapability } from '../plugins/auth.js';
import { deleteDocument, searchDocumentMetadata } from '../services/admin-documents.js';

const TAG = ['admin: documents'];

export function adminDocumentRoutes(app: FastifyInstance, ctx: AppContext): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const guard = requireCapability(Capability.ManageDocuments);

  routes.get(
    '/api/admin/documents',
    {
      onRequest: guard,
      schema: {
        tags: TAG,
        summary:
          'Find entries by owner and/or date: title, date, owner and state only, never content',
        querystring: AdminDocumentQuery,
        response: { 200: AdminDocumentList },
      },
    },
    async (request) => searchDocumentMetadata(ctx, request.query),
  );

  routes.delete(
    '/api/admin/documents/:id',
    {
      onRequest: guard,
      schema: {
        tags: TAG,
        summary: 'Delete an entry immediately, with its history and comments',
        params: DocumentIdParams,
        response: { 200: OkResponse },
      },
    },
    async (request) => {
      await deleteDocument(ctx, request.params.id);
      request.log.info(
        {
          event: 'admin_action',
          actorId: authOf(request).user.id,
          action: 'delete_document',
          target: request.params.id,
        },
        'admin action',
      );
      return { ok: true as const };
    },
  );
}
