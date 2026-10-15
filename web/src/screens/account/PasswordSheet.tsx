/**
 * 更改密碼 (spec §4.4): current password, new password twice. A mismatch is caught here ("兩次密碼輸入不同")
 * and nothing is sent; on success every other device is signed out, and this one stays signed in.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Password } from '@diary/shared';
import { useChangePassword } from '../../api/account.js';
import { ApiError } from '../../api/client.js';
import { Button } from '../../components/Button.js';
import { Sheet } from '../../components/Dialog.js';
import { PasswordField } from '../../components/Field.js';
import { Notice } from '../../components/Notice.js';
import { useToast } from '../../components/Toast.js';
import { useI18n } from '../../i18n/index.js';
import styles from './AccountScreen.module.css';

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' };

export function PasswordButton() {
  const { t, tError } = useI18n();
  const toast = useToast();
  const change = useChangePassword();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [checked, setChecked] = useState(false);
  const tooShort = !Password.safeParse(form.newPassword).success;
  const mismatch = form.newPassword !== form.confirmPassword;

  function close() {
    setOpen(false);
    setForm(EMPTY);
    setChecked(false);
    change.reset();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (!form.currentPassword || tooShort || mismatch) return;
    change.mutate(form, {
      onSuccess: () => {
        close();
        toast.show(t('account.passwordChanged'));
      },
    });
  }

  const error = change.error instanceof ApiError ? change.error : null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t('account.password')}</Button>
      <Sheet open={open} title={t('account.password')} onClose={close}>
        <form className={styles.form} onSubmit={submit} noValidate>
          <PasswordField
            label={t('account.currentPassword')}
            autoComplete="current-password"
            value={form.currentPassword}
            onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))}
            error={
              checked && !form.currentPassword
                ? t('auth.required', { field: t('account.currentPassword') })
                : null
            }
          />
          <PasswordField
            label={t('account.newPassword')}
            hint={t('register.passwordHint')}
            autoComplete="new-password"
            value={form.newPassword}
            onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
            error={checked && tooShort ? t('register.badPassword') : null}
          />
          <PasswordField
            label={t('account.confirmPassword')}
            autoComplete="new-password"
            value={form.confirmPassword}
            onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
            error={checked && !tooShort && mismatch ? t('register.mismatch') : null}
          />
          {error && (
            <Notice kind="error" requestId={error.requestId}>
              {tError(error.code)}
            </Notice>
          )}
          <Button type="submit" variant="primary" wide disabled={change.isPending}>
            {t('account.changePassword')}
          </Button>
        </form>
      </Sheet>
    </>
  );
}
