/**
 * Choosing a password for someone (spec §4.3, §6.6): generate an 8-character one, shown once, or type one.
 * Used when creating a user, editing one, and answering a reset request.
 */
import { useState } from 'react';
import { Password } from '@diary/shared';
import { useSetPassword, type NewPassword } from '../../api/admin.js';
import { Button } from '../../components/Button.js';
import { ConfirmDialog } from '../../components/Dialog.js';
import { PasswordField, SegmentedControl } from '../../components/Field.js';
import { PasswordReveal } from '../../components/PasswordReveal.js';
import { useToast } from '../../components/Toast.js';
import { useT } from '../../i18n/index.js';

export interface PasswordChoice {
  mode: 'generate' | 'typed';
  typed: string;
}

export const GENERATE: PasswordChoice = { mode: 'generate', typed: '' };

/** The request body for a choice, or null while a typed password isn't valid yet. */
export function passwordBody(choice: PasswordChoice): NewPassword | null {
  if (choice.mode === 'generate') return { generate: true };
  return Password.safeParse(choice.typed).success ? { password: choice.typed } : null;
}

export function PasswordChoiceFields({
  value,
  onChange,
  name,
}: {
  value: PasswordChoice;
  onChange: (choice: PasswordChoice) => void;
  name: string;
}) {
  const t = useT();
  const invalid = value.mode === 'typed' && value.typed !== '' && passwordBody(value) === null;
  return (
    <>
      <SegmentedControl<PasswordChoice['mode']>
        legend={t('userForm.password')}
        name={name}
        value={value.mode}
        onChange={(mode) => onChange({ ...value, mode })}
        options={[
          { value: 'generate', label: t('userForm.generate') },
          { value: 'typed', label: t('userForm.typed') },
        ]}
      />
      {value.mode === 'typed' && (
        <PasswordField
          label={t('userForm.password')}
          hint={t('register.passwordHint')}
          autoComplete="new-password"
          value={value.typed}
          onChange={(e) => onChange({ ...value, typed: e.target.value })}
          error={invalid ? t('register.badPassword') : null}
        />
      )}
    </>
  );
}

/** "設定密碼" for one user: choose, confirm, and show a generated password once. */
export function SetPasswordButton({
  userId,
  name,
  small = false,
}: {
  userId: string;
  name: string;
  small?: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const set = useSetPassword(userId);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<PasswordChoice>(GENERATE);
  const [revealed, setRevealed] = useState<string | null>(null);
  const body = passwordBody(choice);

  return (
    <>
      <Button small={small} variant="primary" onClick={() => setOpen(true)}>
        {t('users.setPassword')}
      </Button>
      <ConfirmDialog
        open={open}
        title={`${t('userForm.newPassword')}: ${name}`}
        onCancel={() => setOpen(false)}
        actions={
          <>
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              disabled={!body || set.isPending}
              onClick={() =>
                body &&
                set.mutate(body, {
                  onSuccess: ({ generatedPassword }) => {
                    setOpen(false);
                    setChoice(GENERATE);
                    if (generatedPassword) setRevealed(generatedPassword);
                    else toast.show(t('password.set'));
                  },
                  onError: toast.showError,
                })
              }
            >
              {t('users.setPassword')}
            </Button>
          </>
        }
      >
        <p>{t('userForm.passwordNote')}</p>
        <PasswordChoiceFields value={choice} onChange={setChoice} name={`password-${userId}`} />
      </ConfirmDialog>
      <PasswordReveal password={revealed} onClose={() => setRevealed(null)} />
    </>
  );
}
