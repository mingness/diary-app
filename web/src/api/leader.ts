/**
 * The leader's review data (spec §6.3–6.4, FRONTEND.md §4.7): calendar counts, the day's or a student's
 * entries, the student list, open requests, and the leader's own comment on an entry.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  EntryView,
  LeaderCalendar,
  LeaderDocumentList,
  LeaderUserList,
  MyComment,
  OpenRequestList,
} from '@diary/shared';
import { api } from './client.js';
import { diaryKeys } from './diary.js';

/** How often review lists and the requests badge look for new entries while on screen. */
export const LEADER_POLL_MS = 60_000;

export const leaderKeys = {
  all: ['leader'] as const,
  calendar: (month: string) => ['leader', 'calendar', month] as const,
  documents: (query: LeaderListQuery) => ['leader', 'documents', query] as const,
  users: (month: string) => ['leader', 'users', month] as const,
  unreadCount: ['leader', 'unread-count'] as const,
  requests: ['leader', 'requests'] as const,
};

export type LeaderListQuery =
  | { date: string; page: number; size: number }
  | { user: string; month: string }
  | { unread: 'true'; page: number; size: number };

const isUnreadQuery = (query: unknown) =>
  typeof query === 'object' && query !== null && 'unread' in query;

export function useLeaderCalendar(month: string) {
  return useQuery({
    queryKey: leaderKeys.calendar(month),
    queryFn: () =>
      api<z.infer<typeof LeaderCalendar>>('GET', `/api/leader/calendar?month=${month}`),
  });
}

export function useLeaderDocuments(query: LeaderListQuery, enabled = true) {
  const params = new URLSearchParams(
    Object.entries(query).map(([key, value]) => [key, String(value)]),
  );
  return useQuery({
    queryKey: leaderKeys.documents(query),
    queryFn: () =>
      api<z.infer<typeof LeaderDocumentList>>('GET', `/api/leader/documents?${params}`),
    enabled,
    // The unread list holds still while the leader works through it (entries would vanish as they're read);
    // choosing 未讀 again refreshes it. The other lists keep up with new submissions.
    ...(isUnreadQuery(query)
      ? { staleTime: Infinity, refetchOnWindowFocus: false }
      : { refetchInterval: LEADER_POLL_MS }),
  });
}

/** How many entries this leader hasn't read yet (the 未讀 filter's count), kept fresh while on screen. */
export function useUnreadCount() {
  return useQuery({
    queryKey: leaderKeys.unreadCount,
    queryFn: async () =>
      (
        await api<z.infer<typeof LeaderDocumentList>>(
          'GET',
          '/api/leader/documents?unread=true&size=1',
        )
      ).total,
    refetchInterval: LEADER_POLL_MS,
  });
}

/** After a leader opens an entry: the count and the live lists' 新 marks follow (not the unread list). */
export function refreshAfterRead(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: leaderKeys.unreadCount });
  void queryClient.invalidateQueries({
    queryKey: ['leader', 'documents'],
    predicate: (q) => !isUnreadQuery(q.queryKey[2]),
  });
}

export function useStudents(month: string) {
  return useQuery({
    queryKey: leaderKeys.users(month),
    queryFn: () => api<z.infer<typeof LeaderUserList>>('GET', `/api/leader/users?month=${month}`),
  });
}

export function useOpenRequests(enabled = true) {
  return useQuery({
    queryKey: leaderKeys.requests,
    queryFn: () => api<z.infer<typeof OpenRequestList>>('GET', '/api/leader/open-requests'),
    refetchInterval: LEADER_POLL_MS,
    enabled,
  });
}

/** 暫存 or 提交 the leader's one comment on an entry. */
export function useSaveMyComment(documentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { body: string; state: 'draft' | 'submitted' }) =>
      api<z.infer<typeof MyComment>>('PUT', `/api/documents/${documentId}/comments/mine`, body),
    onSuccess: (myComment) => {
      queryClient.setQueryData<EntryView>(diaryKeys.entry(documentId), (old) =>
        old && old.view !== 'reader' ? { ...old, myComment } : old,
      );
      // The lists' "my comment" chips follow.
      void queryClient.invalidateQueries({ queryKey: ['leader', 'documents'] });
    },
  });
}
