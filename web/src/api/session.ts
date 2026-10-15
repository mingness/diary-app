/**
 * Who is signed in. Every screen reads this through `useSession()`; any API call that answers
 * `unauthorized` resets it to anonymous (see `query.ts`), which brings back the sign-in screen.
 */
import { useQuery } from '@tanstack/react-query';
import { ErrorCode, type LoginResponse, type MeResponse } from '@diary/shared';
import { ApiError, api, setCsrfToken } from './client.js';

export type Me = MeResponse['user'];

export type Session =
  | { status: 'anonymous' }
  /** Password accepted; the authenticator code is next (only reachable straight from the login form). */
  | { status: 'totp' }
  /** A SYS_ADMIN without an authenticator: setting one up is the only thing they can do. */
  | { status: 'enrol'; me: Me; features: MeResponse['features'] }
  | { status: 'ready'; me: Me; features: MeResponse['features'] };

export const SESSION_KEY = ['session'] as const;
export const ANONYMOUS: Session = { status: 'anonymous' };

/** TOTP is required for SYS_ADMINs (D12); until it's set up the server only allows the setup routes. */
export function sessionFromMe(response: MeResponse): Session {
  setCsrfToken(response.csrfToken);
  const { user: me, features } = response;
  return me.role === 'SYS_ADMIN' && !me.totpEnabled
    ? { status: 'enrol', me, features }
    : { status: 'ready', me, features };
}

export async function fetchSession(): Promise<Session> {
  try {
    return sessionFromMe(await api<MeResponse>('GET', '/api/me'));
  } catch (err) {
    // A session left waiting for its authenticator code (e.g. after a reload) has no CSRF token in memory, so
    // it can't finish; signing in again replaces it.
    if (err instanceof ApiError && (err.signedOut || err.code === ErrorCode.TotpRequired)) {
      setCsrfToken(null);
      return ANONYMOUS;
    }
    throw err;
  }
}

export function useSession() {
  return useQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, staleTime: Infinity });
}

/** The signed-in user, for screens that are only shown when the session is ready. */
export function useMe(): Me {
  const { data } = useSession();
  if (data?.status !== 'ready') throw new Error('useMe() outside a signed-in screen');
  return data.me;
}

/** Where a login response leaves the session; `ok` and enrolment need the full profile from `/api/me`. */
export function afterLogin(response: LoginResponse): 'totp' | 'fetch' {
  setCsrfToken(response.csrfToken);
  return response.status === 'totp_required' ? 'totp' : 'fetch';
}
