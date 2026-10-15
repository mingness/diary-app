/**
 * Sign-in (FRONTEND.md §4.1, spec §4.1): username, password, CAPTCHA, where to land, and "remember this
 * device". A SYS_ADMIN then enters their authenticator code in a second step.
 */
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ErrorCode, type LoginResponse } from '@diary/shared';
import { ApiError, api, setCsrfToken } from '../../api/client.js';
import { afterLogin, ANONYMOUS, SESSION_KEY, useSession } from '../../api/session.js';
import { AuthLayout } from '../../components/AuthLayout.js';
import { Button } from '../../components/Button.js';
import { CheckboxRow, PasswordField, SegmentedControl, TextField } from '../../components/Field.js';
import { Notice } from '../../components/Notice.js';
import { useI18n } from '../../i18n/index.js';
import { rememberDestination, rememberedDestination, type Destination } from '../../lib/landing.js';
import { CaptchaField, useCaptcha } from './Captcha.js';
import styles from './auth.module.css';

/** Set by the register screen so the new user sees a confirmation and their username already filled in. */
export interface LoginLocationState {
  registered?: string;
}

export function LoginScreen() {
  const { data: session } = useSession();
  return <AuthLayout>{session?.status === 'totp' ? <TotpStep /> : <PasswordStep />}</AuthLayout>;
}

function PasswordStep() {
  const { t, tError } = useI18n();
  const queryClient = useQueryClient();
  const location = useLocation();
  const registered = (location.state as LoginLocationState | null)?.registered;

  const [username, setUsername] = useState(registered ?? '');
  const [password, setPassword] = useState('');
  const [answer, setAnswer] = useState('');
  const [destination, setDestination] = useState<Destination>(rememberedDestination);
  const [remember, setRemember] = useState(true);
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const { captcha, failed, refresh } = useCaptcha();
  const answerRef = useRef<HTMLInputElement>(null);

  const login = useMutation({
    mutationFn: (body: object) => api<LoginResponse>('POST', '/api/auth/login', body),
    onSuccess: async (response) => {
      rememberDestination(destination);
      if (afterLogin(response) === 'totp') {
        queryClient.setQueryData(SESSION_KEY, { status: 'totp' });
      } else {
        await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
      }
    },
    onError: (error) => {
      // The CAPTCHA was used up by this attempt, whatever went wrong.
      setAnswer('');
      refresh();
      if (error instanceof ApiError && error.code === ErrorCode.CaptchaFailed) {
        answerRef.current?.focus();
      }
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const empty = new Set<string>();
    if (!username.trim()) empty.add('username');
    if (!password) empty.add('password');
    if (!answer) empty.add('captcha');
    setMissing(empty);
    if (empty.size > 0 || !captcha) return;
    login.mutate({
      username: username.trim(),
      password,
      captchaId: captcha.id,
      captchaAnswer: answer,
      remember,
    });
  }

  const required = (field: string, label: string) =>
    missing.has(field) ? t('auth.required', { field: label }) : null;
  const error = login.error instanceof ApiError ? login.error : null;

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <h1>{t('auth.login')}</h1>
      {registered && !login.isPending && !error && (
        <Notice kind="success">{t('register.done')}</Notice>
      )}
      <TextField
        label={t('auth.username')}
        autoComplete="username"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        error={required('username', t('auth.username'))}
      />
      <PasswordField
        label={t('auth.password')}
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={required('password', t('auth.password'))}
      />
      <CaptchaField
        captcha={captcha}
        failed={failed}
        onRefresh={refresh}
        answer={answer}
        onAnswer={setAnswer}
        error={required('captcha', t('auth.captchaAnswer'))}
        inputRef={answerRef}
      />
      <SegmentedControl<Destination>
        legend={t('auth.destination')}
        name="destination"
        value={destination}
        onChange={setDestination}
        options={[
          { value: 'diary', label: t('auth.destDiary') },
          { value: 'count', label: t('auth.destCount') },
        ]}
      />
      <CheckboxRow
        label={t('auth.remember')}
        hint={t('auth.rememberHint')}
        checked={remember}
        onChange={(e) => setRemember(e.target.checked)}
      />
      {(error || login.error) && (
        <Notice kind="error" requestId={error?.requestId}>
          {tError(error?.code ?? ErrorCode.Internal)}
        </Notice>
      )}
      <Button type="submit" variant="primary" wide disabled={login.isPending || !captcha}>
        {login.isPending ? t('auth.loggingIn') : t('auth.login')}
      </Button>
      <div className={styles.links}>
        <Link to="/forgot-password">{t('auth.toForgot')}</Link>
        <Link to="/register">{t('auth.toRegister')}</Link>
      </div>
    </form>
  );
}

/** Second step for accounts with an authenticator (SYS_ADMINs always; others if they set one up). */
function TotpStep() {
  const { t, tError } = useI18n();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);

  const verify = useMutation({
    mutationFn: (body: { code: string }) => api<LoginResponse>('POST', '/api/auth/totp', body),
    onSuccess: async (response) => {
      setCsrfToken(response.csrfToken);
      await queryClient.invalidateQueries({ queryKey: SESSION_KEY });
    },
    onError: () => setCode(''),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const ok = /^\d{6}$/.test(code);
    setInvalid(!ok);
    if (ok) verify.mutate({ code });
  }

  const error = verify.error instanceof ApiError ? verify.error : null;
  // Too many wrong codes ends the half-signed-in session on the server; start again from the password.
  const sessionEnded = error?.code === ErrorCode.RateLimited;

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <h1>{t('totp.title')}</h1>
      <p className={styles.intro}>{t('totp.intro')}</p>
      <TextField
        className={styles.code}
        label={t('totp.code')}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        error={invalid ? t('totp.codeInvalid') : null}
        disabled={sessionEnded}
      />
      {error && (
        <Notice kind="error" requestId={error.requestId}>
          {tError(error.code)}
        </Notice>
      )}
      <Button type="submit" variant="primary" wide disabled={verify.isPending || sessionEnded}>
        {t('totp.submit')}
      </Button>
      <div className={styles.links}>
        <Button
          variant="quiet"
          onClick={() => {
            setCsrfToken(null);
            queryClient.setQueryData(SESSION_KEY, ANONYMOUS);
          }}
        >
          {t('totp.otherAccount')}
        </Button>
      </div>
    </form>
  );
}
