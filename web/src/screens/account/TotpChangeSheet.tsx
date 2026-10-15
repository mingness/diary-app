/**
 * 更換驗證器 (Q1, agreed 2026-10-15): a SYS_ADMIN moves their authenticator to a new app or phone. Step one
 * asks for the password and a code from the current app; step two shows the new QR code and asks for a code
 * from the new app. Until then the old app keeps working. Other devices are signed out, and the other
 * admins see it under 注意. A lost phone is not this path: another admin removes the authenticator.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import type { TotpSetupResponse } from '@diary/shared';
import { ApiError, api } from '../../api/client.js';
import { Button } from '../../components/Button.js';
import { Sheet } from '../../components/Dialog.js';
import { PasswordField, TextField } from '../../components/Field.js';
import { Notice } from '../../components/Notice.js';
import { useToast } from '../../components/Toast.js';
import { useI18n } from '../../i18n/index.js';
import { secretFromUri } from '../auth/EnrolScreen.js';
import authStyles from '../auth/auth.module.css';
import styles from './AccountScreen.module.css';

type Setup = z.infer<typeof TotpSetupResponse>;

const digits = (value: string) => value.replace(/\D/g, '').slice(0, 6);
const isCode = (value: string) => /^\d{6}$/.test(value);

export function TotpChangeButton() {
  const { t, tError } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [oldCode, setOldCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [checked, setChecked] = useState(false);

  const start = useMutation({
    mutationFn: (body: { currentPassword: string; code: string }) =>
      api<Setup>('POST', '/api/me/totp/change', body),
    onSuccess: () => setChecked(false),
    onError: () => setOldCode(''),
  });
  const confirm = useMutation({
    mutationFn: (body: { code: string }) => api('POST', '/api/me/totp/change/confirm', body),
    onSuccess: () => {
      close();
      toast.show(t('account.totpChanged'));
      void queryClient.invalidateQueries({ queryKey: ['account', 'devices'] });
    },
    onError: () => setNewCode(''),
  });

  function close() {
    setOpen(false);
    setPassword('');
    setOldCode('');
    setNewCode('');
    setChecked(false);
    start.reset();
    confirm.reset();
  }

  function submitStart(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (password && isCode(oldCode)) start.mutate({ currentPassword: password, code: oldCode });
  }

  function submitConfirm(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (isCode(newCode)) confirm.mutate({ code: newCode });
  }

  const setup = start.data;
  const failed = setup ? confirm.error : start.error;
  const error = failed instanceof ApiError ? failed : null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t('account.totpChange')}</Button>
      <Sheet open={open} title={t('account.totpChange')} onClose={close}>
        {!setup ? (
          <form className={styles.form} onSubmit={submitStart} noValidate>
            <p>{t('account.totpChangeIntro')}</p>
            <PasswordField
              label={t('account.currentPassword')}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={
                checked && !password
                  ? t('auth.required', { field: t('account.currentPassword') })
                  : null
              }
            />
            <TextField
              label={t('account.totpOldCode')}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={oldCode}
              onChange={(e) => setOldCode(digits(e.target.value))}
              error={checked && !isCode(oldCode) ? t('totp.codeInvalid') : null}
            />
            {error && (
              <Notice kind="error" requestId={error.requestId}>
                {tError(error.code)}
              </Notice>
            )}
            <Button type="submit" variant="primary" wide disabled={start.isPending}>
              {t('account.totpNext')}
            </Button>
          </form>
        ) : (
          <form className={styles.form} onSubmit={submitConfirm} noValidate>
            <p>{t('account.totpScan')}</p>
            <img
              className={authStyles.qr}
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(setup.qrSvg)}`}
              alt={t('enrol.qr')}
            />
            <p>{t('enrol.manual')}</p>
            <p className={authStyles.secret}>{secretFromUri(setup.otpauthUri)}</p>
            <TextField
              label={t('account.totpNewCode')}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={newCode}
              onChange={(e) => setNewCode(digits(e.target.value))}
              error={checked && !isCode(newCode) ? t('totp.codeInvalid') : null}
            />
            {error && (
              <Notice kind="error" requestId={error.requestId}>
                {tError(error.code)}
              </Notice>
            )}
            <Button type="submit" variant="primary" wide disabled={confirm.isPending}>
              {t('account.totpConfirm')}
            </Button>
          </form>
        )}
      </Sheet>
    </>
  );
}
