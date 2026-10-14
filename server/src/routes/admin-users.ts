/**
 * SYS_ADMIN endpoints for accounts (spec §6.5 sections 1 and 4, §6.6). Every route needs the ManageUsers or
 * ManagePasswordResets capability, which only a SYS_ADMIN with a verified authenticator has.
 *
 * These handlers work only with account data and profiles. They must never touch diary content: the diary
 * keyring is unreachable from here (enforced by lint rules, see eslint.config.js).
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AdminUser,
  AdminUserList,
  AdminUserListQuery,
  BatchDeleteRequest,
  BatchDeleteResponse,
  CreateUserRequest,
  NewPassword,
  OkResponse,
  PasswordSet,
  UpdateUserRequest,
  UserIdParams,
  UserWithPassword,
} from '@diary/shared';
import type { AppContext } from '../context.js';
import { recordActivity, safely } from '../services/activity.js';
import { Capability } from '../domain/authz/policy.js';
import { authOf, requireCapability } from '../plugins/auth.js';
import {
  adminBatchDelete,
  adminCreateUser,
  adminDeleteUser,
  adminLock,
  adminResetTotp,
  adminSetPassword,
  adminSignOutAll,
  adminUpdateUser,
  getUser,
  searchUsers,
  adminView,
} from '../services/admin-users.js';

const TAG = ['admin: users'];

export function adminUserRoutes(app: FastifyInstance, ctx: AppContext): void {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const manageUsers = requireCapability(Capability.ManageUsers);
  const manageResets = requireCapability(Capability.ManagePasswordResets);

  /** Admin actions are logged by ID only: who did what to whom, never names or passwords. */
  const audit = (
    request: { log: FastifyInstance['log'] },
    actorId: string,
    action: string,
    target: unknown,
  ) => request.log.info({ event: 'admin_action', actorId, action, target }, 'admin action');

  routes.get(
    '/api/admin/users',
    {
      onRequest: manageUsers,
      schema: {
        tags: TAG,
        summary:
          'Search users. `q`: `?` = one character, `*` = any run; plain text matches anywhere.',
        querystring: AdminUserListQuery,
        response: { 200: AdminUserList },
      },
    },
    async (request) => searchUsers(ctx, request.query),
  );

  routes.get(
    '/api/admin/users/:id',
    {
      onRequest: manageUsers,
      schema: {
        tags: TAG,
        summary: 'One user',
        params: UserIdParams,
        response: { 200: AdminUser },
      },
    },
    async (request) => adminView(ctx, await getUser(ctx, request.params.id)),
  );

  routes.post(
    '/api/admin/users',
    {
      onRequest: manageUsers,
      schema: {
        tags: TAG,
        summary:
          'Create a user. With `credentials: {generate: true}` the response includes the new password, once.',
        body: CreateUserRequest,
        response: { 201: UserWithPassword },
      },
    },
    async (request, reply) => {
      const result = await adminCreateUser(ctx, request.body);
      audit(request, authOf(request).user.id, 'create_user', {
        id: result.user.id,
        role: result.user.role,
      });
      return reply.code(201).send(result);
    },
  );

  routes.patch(
    '/api/admin/users/:id',
    {
      onRequest: manageUsers,
      schema: {
        tags: TAG,
        summary:
          'Change role, email or profile (never the username). A role change signs the user out everywhere.',
        params: UserIdParams,
        body: UpdateUserRequest,
        response: { 200: AdminUser },
      },
    },
    async (request) => {
      const user = await adminUpdateUser(ctx, request.params.id, request.body);
      audit(request, authOf(request).user.id, 'update_user', {
        id: user.id,
        fields: Object.keys(request.body),
      });
      return user;
    },
  );

  routes.post(
    '/api/admin/users/:id/password',
    {
      onRequest: manageResets,
      schema: {
        tags: TAG,
        summary:
          'Set a new password (spec §4.3): unlocks a reset-pending account and signs the user out everywhere.',
        params: UserIdParams,
        body: NewPassword,
        response: { 200: PasswordSet },
      },
    },
    async (request) => {
      const result = await adminSetPassword(ctx, request.params.id, request.body);
      audit(request, authOf(request).user.id, 'set_password', { id: request.params.id });
      const target = await getUser(ctx, request.params.id);
      await safely(request.log, () =>
        recordActivity(ctx, target, 'password_changed', { by: 'admin' }),
      );
      return { ok: true as const, ...result };
    },
  );

  routes.post(
    '/api/admin/users/:id/sign-out-all',
    {
      onRequest: manageUsers,
      schema: {
        tags: TAG,
        summary: 'Sign the user out of every device',
        params: UserIdParams,
        response: { 200: OkResponse },
      },
    },
    async (request) => {
      await adminSignOutAll(ctx, request.params.id);
      audit(request, authOf(request).user.id, 'sign_out_all', { id: request.params.id });
      return { ok: true as const };
    },
  );

  routes.post(
    '/api/admin/users/:id/lock',
    {
      onRequest: manageUsers,
      schema: {
        tags: TAG,
        summary:
          'Lock the account: signs it out and requires a new password from a SYS_ADMIN (spec §6.5.5)',
        params: UserIdParams,
        response: { 200: OkResponse },
      },
    },
    async (request) => {
      const actorId = authOf(request).user.id;
      await adminLock(ctx, actorId, request.params.id);
      audit(request, actorId, 'lock', { id: request.params.id });
      return { ok: true as const };
    },
  );

  routes.delete(
    '/api/admin/users/:id/totp',
    {
      onRequest: manageUsers,
      schema: {
        tags: TAG,
        summary: "Remove someone else's authenticator; they set up a new one at next sign-in",
        params: UserIdParams,
        response: { 200: OkResponse },
      },
    },
    async (request) => {
      const actorId = authOf(request).user.id;
      await adminResetTotp(ctx, actorId, request.params.id);
      audit(request, actorId, 'reset_totp', { id: request.params.id });
      return { ok: true as const };
    },
  );

  routes.delete(
    '/api/admin/users/:id',
    {
      onRequest: manageUsers,
      schema: {
        tags: TAG,
        summary:
          'Delete a user and everything they own. Not yourself, and never the last SYS_ADMIN.',
        params: UserIdParams,
        response: { 200: OkResponse },
      },
    },
    async (request) => {
      const actorId = authOf(request).user.id;
      await adminDeleteUser(ctx, actorId, request.params.id);
      audit(request, actorId, 'delete_user', { id: request.params.id });
      return { ok: true as const };
    },
  );

  routes.post(
    '/api/admin/users/batch-delete',
    {
      onRequest: manageUsers,
      schema: {
        tags: TAG,
        summary: 'Delete several NORMAL_USER accounts; anything else is skipped and reported',
        body: BatchDeleteRequest,
        response: { 200: BatchDeleteResponse },
      },
    },
    async (request) => {
      const actorId = authOf(request).user.id;
      const result = await adminBatchDelete(ctx, actorId, request.body.ids);
      audit(request, actorId, 'batch_delete', { deleted: result.deleted.length });
      return result;
    },
  );
}
