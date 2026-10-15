/** What the sign-in screens may offer before anyone signs in (e.g. whether registering is open). */
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { AuthOptions } from '@diary/shared';
import { api } from './client.js';

export function useAuthOptions() {
  return useQuery({
    queryKey: ['auth', 'options'],
    queryFn: () => api<z.infer<typeof AuthOptions>>('GET', '/api/auth/options'),
    staleTime: 5 * 60 * 1000,
  });
}
