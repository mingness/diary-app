/**
 * Forgot password (spec §4.3): locks the account until a SYS_ADMIN sets a new password. The answer is the same
 * whether or not the username exists.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { ApiError, api } from '../../api/client.js';
import { AuthLayout } from '../../components/AuthLayout.js';
import { Button } from '../../components/Button.js';
import { TextField } from '../../components/Field.js';
import { Notice } from '../../components/Notice.js';
import { useI18n } from '../../i18n/index.js';
import { CaptchaField, useCaptcha } from './Captcha.js';
import styles from './auth.module.css';

export function ForgotPasswordScreen() {
  const { t, tError } = useI18n();
  const [username, setUsername] = useState('');
  const [answer, setAnswer] = useState('');
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const { captcha, failed, refresh } = useCaptcha();

  const forgot = useMutation({
    mutationFn: (body: object) => api('POST', '/api/auth/forgot-password', body),
    onError: () => {
      setAnswer('');
      refresh();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const empty = new Set<string>();
    if (!username.trim()) empty.add('username');
    if (!answer) empty.add('captcha');
    setMissing(empty);
    if (empty.size > 0 || !captcha) return;
    forgot.mutate({ username: username.trim(), captchaId: captcha.id, captchaAnswer: answer });
  }

  if (forgot.isSuccess) {
    return (
      <AuthLayout>
        <h1>{t('forgot.title')}</h1>
        <Notice kind="success">
          <strong>{t('forgot.done')}</strong>
          <br />
          {t('forgot.doneDetail')}
        </Notice>
        <div className={styles.links}>
          <Link to="/login">{t('auth.backToLogin')}</Link>
        </div>
      </AuthLayout>
    );
  }

  const error = forgot.error instanceof ApiError ? forgot.error : null;
  return (
    <AuthLayout>
      <form className={styles.form} onSubmit={submit} noValidate>
        <h1>{t('forgot.title')}</h1>
        <p className={styles.intro}>{t('forgot.intro')}</p>
        <TextField
          label={t('auth.username')}
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={missing.has('username') ? t('auth.required', { field: t('auth.username') }) : null}
        />
        <CaptchaField
          captcha={captcha}
          failed={failed}
          onRefresh={refresh}
          answer={answer}
          onAnswer={setAnswer}
          error={
            missing.has('captcha') ? t('auth.required', { field: t('auth.captchaAnswer') }) : null
          }
        />
        {error && (
          <Notice kind="error" requestId={error.requestId}>
            {tError(error.code)}
          </Notice>
        )}
        <Button type="submit" variant="primary" wide disabled={forgot.isPending || !captcha}>
          {t('forgot.submit')}
        </Button>
        <div className={styles.links}>
          <Link to="/login">{t('auth.backToLogin')}</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
