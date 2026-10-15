/** The account page's data (spec §4.4): profile, password, and signed-in devices. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type { DeviceList, MeResponse, Profile } from '@diary/shared';
import { api } from './client.js';
import { SESSION_KEY, sessionFromMe } from './session.js';

export type Device = z.infer<typeof DeviceList>['sessions'][number];

export function useDevices() {
  return useQuery({
    queryKey: ['account', 'devices'],
    queryFn: () => api<z.infer<typeof DeviceList>>('GET', '/api/me/sessions'),
  });
}

export function useSignOutDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api('DELETE', `/api/me/sessions/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['account', 'devices'] }),
  });
}

/** Saves email and profile; the answer is the whole signed-in user, so the session follows. */
export function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string | null; profile: Profile }) =>
      api<MeResponse>('PUT', '/api/me', body),
    onSuccess: (me) => queryClient.setQueryData(SESSION_KEY, sessionFromMe(me)),
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string; confirmPassword: string }) =>
      api('POST', '/api/me/password', body),
    // Every other device was signed out.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['account', 'devices'] }),
  });
}
