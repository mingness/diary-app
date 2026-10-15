/**
 * A SYS_ADMIN's first sign-in without an authenticator (D12): the server allows nothing else until one is set
 * up, so this screen replaces the whole app until the code is confirmed.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type { TotpSetupResponse } from '@diary/shared';
import { ApiError, api } from '../../api/client.js';
import { SESSION_KEY } from '../../api/session.js';
import { AuthLayout } from '../../components/AuthLayout.js';
import { Button } from '../../components/Button.js';
import { TextField } from '../../components/Field.js';
import { Notice } from '../../components/Notice.js';
import { ErrorState, LoadingState } from '../../components/States.js';
import { useToast } from '../../components/Toast.js';
import { useI18n } from '../../i18n/index.js';
import { useLogout } from '../account/useLogout.js';
import styles from './auth.module.css';

type Setup = z.infer<typeof TotpSetupResponse>;

/** The base32 key inside the `otpauth://` link, for typing in by hand. */
export function secretFromUri(uri: string): string {
  try {
    return new URL(uri).searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
}

export function EnrolScreen() {
  const { t, tError } = useI18n();
  const queryClient = useQueryClient();
  const toast = useToast();
  const logout = useLogout();
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);

  // A query, not a mutation, so it runs once per visit even when React renders twice: a second setup call
  // would replace the secret behind a QR code already on screen.
  const setup = useQuery({
    queryKey: ['totp-setup'],
    queryFn: () => api<Setup>('POST', '/api/me/totp/setup'),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const confirm = useMutation({
    mutationFn: (body: { code: string }) => api('POST', '/api/me/totp/confirm', body),
    onSuccess: async () => {
      toast.show(t('enrol.done'));
      queryClient.removeQueries({ queryKey: ['totp-setup'] });
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    },
    onError: () => setCode(''),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const ok = /^\d{6}$/.test(code);
    setInvalid(!ok);
    if (ok) confirm.mutate({ code });
  }

  const error = confirm.error instanceof ApiError ? confirm.error : null;

  return (
    <AuthLayout>
      <h1>{t('enrol.title')}</h1>
      <p className={styles.intro}>{t('enrol.intro')}</p>
      {setup.isPending && <LoadingState />}
      {setup.isError && <ErrorState error={setup.error} onRetry={() => void setup.refetch()} />}
      {setup.data && (
        <form className={styles.form} onSubmit={submit} noValidate>
          <img
            className={styles.qr}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.data.qrSvg)}`}
            alt={t('enrol.qr')}
          />
          <p>{t('enrol.manual')}</p>
          <p className={styles.secret}>{secretFromUri(setup.data.otpauthUri)}</p>
          <TextField
            className={styles.code}
            label={t('totp.code')}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            error={invalid ? t('totp.codeInvalid') : null}
          />
          {error && (
            <Notice kind="error" requestId={error.requestId}>
              {tError(error.code)}
            </Notice>
          )}
          <Button type="submit" variant="primary" wide disabled={confirm.isPending}>
            {t('enrol.submit')}
          </Button>
        </form>
      )}
      <div className={styles.links}>
        <Button variant="quiet" onClick={logout.run} disabled={logout.isPending}>
          {t('account.logout')}
        </Button>
      </div>
    </AuthLayout>
  );
}
