/**
 * SYS_ADMIN data (spec §6.5, FRONTEND.md §4.8): accounts, flags and activity, and entry metadata. Never diary
 * content or comments: the server doesn't send any to this role. Writes refresh the lists they change.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  ActivityList,
  ActivitySummary,
  AdminDocumentList,
  AdminUser,
  AdminUserList,
  AlertList,
  AlertStatus,
  BatchDeleteResponse,
  PasswordSet,
  UserWithPassword,
} from '@diary/shared';
import { api } from './client.js';

export type { AdminUser } from '@diary/shared';
export type AdminDocument = z.infer<typeof AdminDocumentList>['documents'][number];
export type Alert = z.infer<typeof AlertList>['alerts'][number];
export type ActivityEvent = z.infer<typeof ActivityList>['events'][number];
export type SummaryRow = z.infer<typeof ActivitySummary>['rows'][number];

/** How often the badges (open flags, waiting resets) refresh while signed in. */
export const ADMIN_POLL_MS = 60_000;

const query = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) =>
      value === undefined || value === '' ? [] : [[key, String(value)]],
    ),
  ).toString();

export interface UserFilter {
  q?: string;
  role?: AdminUser['role'];
  status?: AdminUser['status'];
  page: number;
  size: number;
}

export function useAdminUsers(filter: UserFilter) {
  return useQuery({
    queryKey: ['admin', 'users', filter],
    queryFn: () =>
      api<z.infer<typeof AdminUserList>>('GET', `/api/admin/users?${query({ ...filter })}`),
  });
}

/** How many accounts wait for a new password (the 用戶 tab's badge). */
export function useWaitingResets(enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'users', 'waiting'],
    queryFn: async () =>
      (
        await api<z.infer<typeof AdminUserList>>(
          'GET',
          '/api/admin/users?status=reset_pending&size=1',
        )
      ).total,
    refetchInterval: ADMIN_POLL_MS,
    enabled,
  });
}

export function useAdminUser(id: string | null) {
  return useQuery({
    queryKey: ['admin', 'user', id],
    queryFn: () => api<AdminUser>('GET', `/api/admin/users/${id}`),
    enabled: id !== null,
  });
}

/** Any change to accounts refreshes every account list, badge and the activity views. */
function useAdminWrite<TBody, TResult>(fn: (body: TBody) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin'] }),
  });
}

export type NewPassword = { password: string } | { generate: true };

export const useCreateUser = () =>
  useAdminWrite((body: object) =>
    api<z.infer<typeof UserWithPassword>>('POST', '/api/admin/users', body),
  );
export const useUpdateUser = (id: string) =>
  useAdminWrite((body: object) => api<AdminUser>('PATCH', `/api/admin/users/${id}`, body));
export const useSetPassword = (id: string) =>
  useAdminWrite((body: NewPassword) =>
    api<z.infer<typeof PasswordSet>>('POST', `/api/admin/users/${id}/password`, body),
  );
export const useUserAction = (id: string) =>
  useAdminWrite((action: 'sign-out-all' | 'lock' | 'remove-totp' | 'delete') =>
    action === 'remove-totp'
      ? api('DELETE', `/api/admin/users/${id}/totp`)
      : action === 'delete'
        ? api('DELETE', `/api/admin/users/${id}`)
        : api('POST', `/api/admin/users/${id}/${action}`),
  );
export const useBatchDelete = () =>
  useAdminWrite((ids: string[]) =>
    api<z.infer<typeof BatchDeleteResponse>>('POST', '/api/admin/users/batch-delete', { ids }),
  );

export function useAlerts(status: 'open' | 'handled' | 'all') {
  return useQuery({
    queryKey: ['admin', 'alerts', status],
    queryFn: () => api<z.infer<typeof AlertList>>('GET', `/api/admin/attention?status=${status}`),
    refetchInterval: ADMIN_POLL_MS,
  });
}

/** Open flags (the 注意 badge) and whether email alerts are on. */
export function useAlertStatus(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'alert-status'],
    queryFn: () => api<z.infer<typeof AlertStatus>>('GET', '/api/admin/attention/status'),
    refetchInterval: ADMIN_POLL_MS,
    enabled,
  });
}

export const useMarkHandled = () =>
  useAdminWrite((id: string) => api('POST', `/api/admin/attention/${id}/handled`));

export function useActivity(params: {
  userId?: string;
  kind?: string;
  page: number;
  size: number;
}) {
  return useQuery({
    queryKey: ['admin', 'activity', params],
    queryFn: () =>
      api<z.infer<typeof ActivityList>>('GET', `/api/admin/activity?${query({ ...params })}`),
  });
}

export function useActivitySummary(sort: 'today' | 'week' | 'storage') {
  return useQuery({
    queryKey: ['admin', 'summary', sort],
    queryFn: () =>
      api<z.infer<typeof ActivitySummary>>('GET', `/api/admin/activity/summary?sort=${sort}`),
  });
}

export function useAdminDocuments(params: {
  username?: string;
  date?: string;
  page: number;
  size: number;
}) {
  return useQuery({
    queryKey: ['admin', 'documents', params],
    queryFn: () =>
      api<z.infer<typeof AdminDocumentList>>('GET', `/api/admin/documents?${query({ ...params })}`),
  });
}

export const useDeleteDocument = () =>
  useAdminWrite((id: string) => api('DELETE', `/api/admin/documents/${id}`));
