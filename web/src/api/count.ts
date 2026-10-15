/**
 * 報數 (spec §7): the shared progress, the latest reports, my auto-submit settings, and the SYS_ADMIN tools.
 * A report refreshes every figure, so the page always agrees with itself after submitting.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  AdminCountUsers,
  CountEntry,
  CountJobRuns,
  CountLatest,
  CountSettings,
  CountSummary,
  DeletedCount,
  RunNowResponse,
} from '@diary/shared';
import { api } from './client.js';

export type Summary = z.infer<typeof CountSummary>;
export type LatestRow = z.infer<typeof CountLatest>['rows'][number];
export type AdminCountUser = z.infer<typeof AdminCountUsers>['users'][number];

/** The figures and the table refresh about once a minute while the page is open (spec §7.1). */
export const COUNT_POLL_MS = 60_000;

export function useCountSummary() {
  return useQuery({
    queryKey: ['count', 'summary'],
    queryFn: () => api<Summary>('GET', '/api/count/summary'),
    refetchInterval: COUNT_POLL_MS,
  });
}

export function useLatestCounts() {
  return useQuery({
    queryKey: ['count', 'latest'],
    queryFn: () => api<z.infer<typeof CountLatest>>('GET', '/api/count/latest'),
    refetchInterval: COUNT_POLL_MS,
  });
}

export function useCountSettings() {
  return useQuery({
    queryKey: ['count', 'settings'],
    queryFn: () => api<CountSettings>('GET', '/api/count/settings'),
  });
}

export function useSubmitCount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { count: number; countDate: string }) =>
      api<z.infer<typeof CountEntry>>('POST', '/api/count', body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['count'] }),
  });
}

export function useUpdateCountSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<CountSettings>) =>
      api<CountSettings>('PUT', '/api/count/settings', body),
    onSuccess: (settings) => queryClient.setQueryData(['count', 'settings'], settings),
  });
}

// SYS_ADMIN 報數管理 (spec §6.5.3).

export function useAdminCountUsers() {
  return useQuery({
    queryKey: ['admin', 'count', 'users'],
    queryFn: () => api<z.infer<typeof AdminCountUsers>>('GET', '/api/admin/count/users'),
  });
}

export function useCountJobRuns() {
  return useQuery({
    queryKey: ['admin', 'count', 'runs'],
    queryFn: () => api<z.infer<typeof CountJobRuns>>('GET', '/api/admin/count/job-runs'),
  });
}

function useCountAdminWrite<TBody, TResult>(fn: (body: TBody) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'count'] });
      void queryClient.invalidateQueries({ queryKey: ['count'] });
    },
  });
}

export const useSetAutoSubmit = (userId: string) =>
  useCountAdminWrite((autoSubmit: boolean) =>
    api<CountSettings>('PUT', `/api/admin/count/users/${userId}/auto`, { autoSubmit }),
  );

export const useDeleteCounts = (userId: string) =>
  useCountAdminWrite((range: { from?: string; to?: string }) => {
    const query = new URLSearchParams(
      Object.entries(range).filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    return api<z.infer<typeof DeletedCount>>(
      'DELETE',
      `/api/admin/count/users/${userId}/entries?${query}`,
    );
  });

export const useRunAutoSubmitNow = () =>
  useCountAdminWrite(() => api<z.infer<typeof RunNowResponse>>('POST', '/api/admin/count/run-now'));
