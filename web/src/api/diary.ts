/**
 * Diary data (spec §5–6): my entries, open entries, one entry, and the writes. Writes update the cached entry
 * and refresh the lists, so every screen agrees after a save without reloading by hand.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type {
  AccessChangeResponse,
  DocumentVersions,
  EntryView,
  MyDocumentList,
  OpenDocumentList,
  OwnDocument,
  TranslateDirection,
  TranslateResponse,
} from '@diary/shared';
import { api } from './client.js';

export type MyDocumentRow = z.infer<typeof MyDocumentList>['documents'][number];
export type OpenDocumentRow = z.infer<typeof OpenDocumentList>['documents'][number];
export type OwnerEntry = Extract<EntryView, { view: 'owner' }>;
type Access = z.infer<typeof AccessChangeResponse>['access'];

/** How often the lists check for new entries and comments while they're on screen (spec §6.2). */
export const POLL_MS = 30_000;

export const diaryKeys = {
  all: ['documents'] as const,
  mine: (month: string) => ['documents', 'mine', month] as const,
  open: (month: string) => ['documents', 'open', month] as const,
  entry: (id: string) => ['documents', 'entry', id] as const,
  versions: (id: string) => ['documents', 'versions', id] as const,
};

export function useMyDocuments(month: string) {
  return useQuery({
    queryKey: diaryKeys.mine(month),
    queryFn: () => api<z.infer<typeof MyDocumentList>>('GET', `/api/documents/mine?month=${month}`),
    // Only while the list is mounted; TanStack Query also pauses it while the tab is hidden.
    refetchInterval: POLL_MS,
  });
}

export function useOpenDocuments(month: string) {
  return useQuery({
    queryKey: diaryKeys.open(month),
    queryFn: () =>
      api<z.infer<typeof OpenDocumentList>>('GET', `/api/documents/open?month=${month}`),
  });
}

export function useEntry(id: string | null) {
  return useQuery({
    queryKey: diaryKeys.entry(id ?? 'none'),
    queryFn: () => api<EntryView>('GET', `/api/documents/${id}`),
    enabled: id !== null,
  });
}

export function useVersions(id: string, enabled: boolean) {
  return useQuery({
    queryKey: diaryKeys.versions(id),
    queryFn: () => api<z.infer<typeof DocumentVersions>>('GET', `/api/documents/${id}/versions`),
    enabled,
  });
}

/** Folds a write's answer into the cached owner view (comments and the rest stay as they were). */
export function storeOwnDocument(queryClient: QueryClient, document: OwnDocument): void {
  queryClient.setQueryData<EntryView>(diaryKeys.entry(document.id), (old) =>
    old?.view === 'owner'
      ? { ...old, ...document }
      : { ...document, view: 'owner', comments: [], myComment: null },
  );
  void queryClient.invalidateQueries({ queryKey: ['documents', 'mine'] });
  void queryClient.invalidateQueries({ queryKey: diaryKeys.versions(document.id) });
}

export interface EntryContent {
  title: string;
  body: string;
}

export const saveEntry = {
  create: (content: EntryContent) => api<OwnDocument>('POST', '/api/documents', content),
  draft: (id: string, content: EntryContent) =>
    api<OwnDocument>('PUT', `/api/documents/${id}/draft`, content),
  submit: (id: string, content: EntryContent) =>
    api<OwnDocument>('POST', `/api/documents/${id}/submit`, content),
};

export type AccessAction = 'request' | 'withdraw' | 'approve' | 'decline' | 'revoke';

export function useAccessChange(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: AccessAction) =>
      api<{ access: Access }>('POST', `/api/documents/${id}/access`, { action }),
    onSuccess: ({ access }) => {
      queryClient.setQueryData<EntryView>(diaryKeys.entry(id), (old) =>
        old && 'access' in old ? { ...old, access } : old,
      );
      void queryClient.invalidateQueries({ queryKey: diaryKeys.all });
    },
  });
}

export function useTranslate() {
  return useMutation({
    mutationFn: (
      body: ({ documentId: string } | { commentId: string }) & { direction: TranslateDirection },
    ) => api<z.infer<typeof TranslateResponse>>('POST', '/api/translate', body),
  });
}
