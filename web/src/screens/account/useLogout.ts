import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, setCsrfToken } from '../../api/client.js';
import { ANONYMOUS, SESSION_KEY } from '../../api/session.js';

/** Signs this device out and forgets everything the user could see. */
export function useLogout() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api('POST', '/api/auth/logout'),
    // Even if the server can't be reached, the user asked to leave: drop the local state regardless.
    onSettled: () => {
      setCsrfToken(null);
      // Session first, so signed-in screens unmount before the data they read disappears.
      queryClient.setQueryData(SESSION_KEY, ANONYMOUS);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== SESSION_KEY[0] });
    },
  });
  return { run: () => mutation.mutate(), isPending: mutation.isPending };
}
