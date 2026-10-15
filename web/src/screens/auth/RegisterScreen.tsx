/**
 * Self-registration (spec §4.2): creates a NORMAL_USER, with no email verification. On success the user goes
 * to sign-in with their username filled in.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Email, ErrorCode, Password, Username } from '@diary/shared';
import { ApiError, api } from '../../api/client.js';
import { AuthLayout } from '../../components/AuthLayout.js';
import { Button } from '../../components/Button.js';
import { PasswordField, TextField } from '../../components/Field.js';
import { Notice } from '../../components/Notice.js';
import { useI18n, type MessageKey } from '../../i18n/index.js';
import { CaptchaField, useCaptcha } from './Captcha.js';
import type { LoginLocationState } from './LoginScreen.js';
import styles from './auth.module.css';

interface Form {
  username: string;
  familyName: string;
  givenName: string;
  address: string;
  email: string;
  password: string;
  confirm: string;
  answer: string;
}

type Field = keyof Form;
type Problems = Partial<Record<Field, MessageKey>>;

const EMPTY: Form = {
  username: '',
  familyName: '',
  givenName: '',
  address: '',
  email: '',
  password: '',
  confirm: '',
  answer: '',
};

/** The same rules the server applies, checked first so the user sees them next to the field. */
export function checkRegistration(form: Form): Problems {
  const problems: Problems = {};
  if (!Username.safeParse(form.username).success) problems.username = 'register.badUsername';
  if (!Password.safeParse(form.password).success) problems.password = 'register.badPassword';
  else if (form.password !== form.confirm) problems.confirm = 'register.mismatch';
  if (form.email.trim() && !Email.safeParse(form.email.trim()).success) {
    problems.email = 'register.badEmail';
  }
  if (!form.answer) problems.answer = 'auth.required';
  return problems;
}

export function RegisterScreen() {
  const { t, tError } = useI18n();
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(EMPTY);
  const [problems, setProblems] = useState<Problems>({});
  const { captcha, failed, refresh } = useCaptcha();

  const register = useMutation({
    mutationFn: (body: object) => api('POST', '/api/auth/register', body),
    onSuccess: () => {
      const state: LoginLocationState = { registered: form.username.trim() };
      void navigate('/login', { state });
    },
    onError: (error) => {
      setForm((f) => ({ ...f, answer: '' }));
      refresh();
      // These two belong next to their field rather than above the button.
      if (error instanceof ApiError && error.code === ErrorCode.UsernameTaken) {
        setProblems({ username: 'error.username_taken' });
      } else if (error instanceof ApiError && error.code === ErrorCode.EmailTaken) {
        setProblems({ email: 'error.email_taken' });
      }
    },
  });

  const set = (field: Field) => (event: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: event.target.value }));

  function problem(field: Field): string | null {
    const key = problems[field];
    if (!key) return null;
    return key === 'auth.required' ? t(key, { field: t('auth.captchaAnswer') }) : t(key);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = checkRegistration(form);
    setProblems(found);
    if (Object.keys(found).length > 0 || !captcha) return;
    register.mutate({
      username: form.username.trim(),
      password: form.password,
      email: form.email.trim() || null,
      profile: {
        familyName: form.familyName.trim(),
        givenName: form.givenName.trim(),
        address: form.address.trim(),
        photo: null,
      },
      captchaId: captcha.id,
      captchaAnswer: form.answer,
    });
  }

  const error = register.error instanceof ApiError ? register.error : null;
  const fieldError =
    error?.code === ErrorCode.UsernameTaken || error?.code === ErrorCode.EmailTaken;

  return (
    <AuthLayout>
      <form className={styles.form} onSubmit={submit} noValidate>
        <h1>{t('register.title')}</h1>
        <TextField
          label={t('auth.username')}
          hint={t('register.usernameHint')}
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={32}
          value={form.username}
          onChange={set('username')}
          error={problem('username')}
        />
        <div className={styles.names}>
          <TextField
            label={t('register.familyName')}
            optional
            autoComplete="family-name"
            maxLength={50}
            value={form.familyName}
            onChange={set('familyName')}
          />
          <TextField
            label={t('register.givenName')}
            optional
            autoComplete="given-name"
            maxLength={50}
            value={form.givenName}
            onChange={set('givenName')}
          />
        </div>
        <TextField
          label={t('register.address')}
          optional
          autoComplete="street-address"
          maxLength={200}
          value={form.address}
          onChange={set('address')}
        />
        <TextField
          label={t('register.email')}
          optional
          type="email"
          autoComplete="email"
          maxLength={200}
          value={form.email}
          onChange={set('email')}
          error={problem('email')}
        />
        <PasswordField
          label={t('auth.password')}
          hint={t('register.passwordHint')}
          autoComplete="new-password"
          maxLength={256}
          value={form.password}
          onChange={set('password')}
          error={problem('password')}
        />
        <PasswordField
          label={t('register.confirmPassword')}
          autoComplete="new-password"
          maxLength={256}
          value={form.confirm}
          onChange={set('confirm')}
          error={problem('confirm')}
        />
        <CaptchaField
          captcha={captcha}
          failed={failed}
          onRefresh={refresh}
          answer={form.answer}
          onAnswer={(answer) => setForm((f) => ({ ...f, answer }))}
          error={problem('answer')}
        />
        {error && !fieldError && (
          <Notice kind="error" requestId={error.requestId}>
            {tError(error.code)}
          </Notice>
        )}
        <Button type="submit" variant="primary" wide disabled={register.isPending || !captcha}>
          {register.isPending ? t('register.submitting') : t('register.submit')}
        </Button>
        <div className={styles.links}>
          <Link to="/login">{t('auth.backToLogin')}</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
