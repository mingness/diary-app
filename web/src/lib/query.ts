/**
 * The TanStack Query client (FRONTEND.md §10.1): limited retries for flaky phone connections, never for
 * answers that won't change on retry, and a signed-out answer anywhere returns the app to sign-in.
 */
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client.js';
import { ANONYMOUS, SESSION_KEY } from '../api/session.js';

const MAX_RETRIES = 2;

/** Retry only what might succeed next time: network failures and server errors, not 4xx answers. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  return !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
}

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error) => onSignedOut(error) }),
    mutationCache: new MutationCache({ onError: (error) => onSignedOut(error) }),
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000 },
      mutations: { retry: false },
    },
  });

  function onSignedOut(error: unknown): void {
    if (!(error instanceof ApiError) || !error.signedOut) return;
    // Drop everything the previous user could see, then show sign-in.
    client.removeQueries({ predicate: (q) => q.queryKey[0] !== SESSION_KEY[0] });
    client.setQueryData(SESSION_KEY, ANONYMOUS);
  }

  return client;
}
