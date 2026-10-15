/**
 * 新增 / 編輯用戶 (spec §6.6, FRONTEND.md §4.8): role, email, names, address and photo; the username is set
 * once. A new account gets a password chosen here (a generated one is shown once). An existing one has its
 * security actions below: a new password, removing the authenticator, signing out everywhere, locking, and
 * deleting the account. The server keeps the last SYS_ADMIN and refuses actions on your own account.
 */
import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Email, ErrorCode, Role, Username, type Profile } from '@diary/shared';
import { ApiError } from '../../api/client.js';
import {
  useAdminUser,
  useCreateUser,
  useUpdateUser,
  useUserAction,
  type AdminUser,
} from '../../api/admin.js';
import { useMe } from '../../api/session.js';
import { Button } from '../../components/Button.js';
import { ConfirmButton } from '../../components/ConfirmButton.js';
import { DetailHeader } from '../../components/DetailHeader.js';
import { TextField } from '../../components/Field.js';
import { Notice } from '../../components/Notice.js';
import { PasswordReveal } from '../../components/PasswordReveal.js';
import { ErrorState, LoadingState } from '../../components/States.js';
import { useToast } from '../../components/Toast.js';
import { useI18n, type MessageKey } from '../../i18n/index.js';
import { prepareAvatar } from '../../lib/avatar.js';
import { formatDateTime } from '../../lib/dates.js';
import { roleKey } from './labels.js';
import {
  GENERATE,
  PasswordChoiceFields,
  passwordBody,
  SetPasswordButton,
  type PasswordChoice,
} from './NewPassword.js';
import styles from './admin.module.css';

export function UserFormScreen() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const query = useAdminUser(isNew ? null : id);
  if (!isNew && query.isPending) return <LoadingState />;
  if (!isNew && query.isError) {
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  }
  // Keyed, so the form starts afresh for each user.
  return <UserForm key={id} user={isNew ? null : (query.data ?? null)} />;
}

interface FormState {
  username: string;
  role: AdminUser['role'];
  email: string;
  profile: Profile;
}

function UserForm({ user }: { user: AdminUser | null }) {
  const { t, tError, lang } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const me = useMe();
  const create = useCreateUser();
  const update = useUpdateUser(user?.id ?? '');
  const [form, setForm] = useState<FormState>({
    username: user?.username ?? '',
    role: user?.role ?? 'NORMAL_USER',
    email: user?.email ?? '',
    profile: user?.profile ?? { familyName: '', givenName: '', address: '', photo: null },
  });
  const [password, setPassword] = useState<PasswordChoice>(GENERATE);
  const [revealed, setRevealed] = useState<string | null>(null);
  /** The new account's page, opened once its generated password has been seen. */
  const [createdId, setCreatedId] = useState<string | null>(null);
  const openCreated = (id: string) => void navigate(`/admin/users/${id}`, { replace: true });
  const [problem, setProblem] = useState<{
    field: 'username' | 'email' | 'form';
    text: string;
    ref?: string | null;
  } | null>(null);
  const [checked, setChecked] = useState(false);

  const setProfile = (patch: Partial<Profile>) =>
    setForm((f) => ({ ...f, profile: { ...f.profile, ...patch } }));
  const usernameBad = user === null && !Username.safeParse(form.username).success;
  const emailBad = form.email.trim() !== '' && !Email.safeParse(form.email.trim()).success;
  const passwordMissing = user === null && passwordBody(password) === null;

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setProfile({ photo: await prepareAvatar(file) });
    } catch {
      toast.show(t('editor.imageUnreadable'));
    }
  }

  function fail(error: unknown) {
    const apiError = error instanceof ApiError ? error : null;
    const code = apiError?.code;
    if (code === ErrorCode.UsernameTaken) setProblem({ field: 'username', text: tError(code) });
    else if (code === ErrorCode.EmailTaken) setProblem({ field: 'email', text: tError(code) });
    else
      setProblem({
        field: 'form',
        text: tError(code ?? ErrorCode.Internal),
        ref: apiError?.requestId ?? null,
      });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    setProblem(null);
    if (usernameBad || emailBad || passwordMissing) return;
    const common = {
      role: form.role,
      email: form.email.trim() || null,
      profile: {
        ...form.profile,
        familyName: form.profile.familyName.trim(),
        givenName: form.profile.givenName.trim(),
        address: form.profile.address.trim(),
      },
    };
    if (user === null) {
      create.mutate(
        { ...common, username: form.username.trim(), credentials: passwordBody(password) },
        {
          onSuccess: ({ user: created, generatedPassword }) => {
            toast.show(t('userForm.created'));
            // Show the password before leaving: the new account's page starts a fresh form, and the
            // password is never shown again.
            if (generatedPassword) {
              setCreatedId(created.id);
              setRevealed(generatedPassword);
            } else {
              openCreated(created.id);
            }
          },
          onError: fail,
        },
      );
    } else {
      update.mutate(common, {
        onSuccess: () => toast.show(t('userForm.saved')),
        onError: fail,
      });
    }
  }

  const busy = create.isPending || update.isPending;
  return (
    <div className={styles.page}>
      <DetailHeader fallback="/admin/users" />
      <h1>{user ? t('userForm.editTitle') : t('userForm.newTitle')}</h1>
      <form className={styles.section} onSubmit={submit} noValidate>
        {user ? (
          <div>
            <p className={styles.cardTitle}>{user.username}</p>
            <p className={styles.muted}>
              {t('userForm.usernameFixed')}{' '}
              {user.lastLoginAt
                ? t('userForm.lastLogin', { time: formatDateTime(user.lastLoginAt, lang) })
                : t('userForm.neverLoggedIn')}
            </p>
          </div>
        ) : (
          <TextField
            label={t('userForm.username')}
            hint={t('register.usernameHint')}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={32}
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            error={
              problem?.field === 'username'
                ? problem.text
                : checked && usernameBad
                  ? t('register.badUsername')
                  : null
            }
          />
        )}
        <label className={styles.label}>
          {t('users.role')}
          <select
            className={styles.select}
            value={form.role}
            onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as AdminUser['role'] }))}
          >
            {Role.options.map((r) => (
              <option key={r} value={r}>
                {t(roleKey(r))}
              </option>
            ))}
          </select>
        </label>
        {user && form.role !== user.role && (
          <p className={styles.muted}>{t('userForm.roleChangeNote')}</p>
        )}
        <TextField
          label={t('register.email')}
          optional
          type="email"
          maxLength={200}
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          error={
            problem?.field === 'email'
              ? problem.text
              : checked && emailBad
                ? t('register.badEmail')
                : null
          }
        />
        <div className={styles.names}>
          <TextField
            label={t('register.familyName')}
            optional
            maxLength={50}
            value={form.profile.familyName}
            onChange={(e) => setProfile({ familyName: e.target.value })}
          />
          <TextField
            label={t('register.givenName')}
            optional
            maxLength={50}
            value={form.profile.givenName}
            onChange={(e) => setProfile({ givenName: e.target.value })}
          />
        </div>
        <TextField
          label={t('register.address')}
          optional
          maxLength={200}
          value={form.profile.address}
          onChange={(e) => setProfile({ address: e.target.value })}
        />
        <fieldset className={styles.fieldset}>
          <legend className={styles.cardTitle}>{t('userForm.photo')}</legend>
          <div className={styles.photoRow}>
            {form.profile.photo && (
              <img className={styles.avatar} src={form.profile.photo} alt="" />
            )}
            <label className={styles.fileButton}>
              {t('userForm.choosePhoto')}
              <input
                type="file"
                accept="image/*"
                // Visually hidden, not `hidden`: keyboard users still reach it through the label.
                className="visually-hidden"
                onChange={(e) => void choosePhoto(e)}
              />
            </label>
            {form.profile.photo && (
              <Button small variant="quiet" onClick={() => setProfile({ photo: null })}>
                {t('userForm.removePhoto')}
              </Button>
            )}
          </div>
          <p className={styles.muted}>{t('userForm.photoHint')}</p>
        </fieldset>
        {user === null && (
          <PasswordChoiceFields value={password} onChange={setPassword} name="new-user-password" />
        )}
        {problem?.field === 'form' && (
          <Notice kind="error" requestId={problem.ref ?? null}>
            {problem.text}
          </Notice>
        )}
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={busy}>
            {user ? t('userForm.save') : t('userForm.create')}
          </Button>
        </div>
      </form>

      {user && <Security user={user} isMe={user.id === me.id} />}
      <PasswordReveal
        password={revealed}
        onClose={() => {
          setRevealed(null);
          if (createdId) openCreated(createdId);
        }}
      />
    </div>
  );
}

function Security({ user, isMe }: { user: AdminUser; isMe: boolean }) {
  const t = useI18n().t;
  const toast = useToast();
  const navigate = useNavigate();
  const act = useUserAction(user.id);
  const name = user.username;
  const run = (
    action: 'sign-out-all' | 'lock' | 'remove-totp' | 'delete',
    done: MessageKey,
    after?: () => void,
  ) =>
    act.mutate(action, {
      onSuccess: () => {
        toast.show(t(done));
        after?.();
      },
      onError: toast.showError,
    });

  return (
    <>
      <section className={styles.section} aria-labelledby="security-heading">
        <h2 id="security-heading">{t('userForm.security')}</h2>
        <p className={styles.muted}>{t('userForm.passwordNote')}</p>
        <div className={styles.actions}>
          <SetPasswordButton userId={user.id} name={name} />
          {user.totpEnabled && !isMe && (
            <ConfirmButton
              danger={false}
              label={t('userForm.removeTotp')}
              title={t('userForm.removeTotpTitle', { name })}
              body={t('userForm.removeTotpBody')}
              disabled={act.isPending}
              onConfirm={() => run('remove-totp', 'userForm.totpRemoved')}
            />
          )}
          <ConfirmButton
            danger={false}
            label={t('attention.signOutAll')}
            title={t('attention.signOutTitle', { name })}
            body={t('attention.signOutBody')}
            disabled={act.isPending}
            onConfirm={() => run('sign-out-all', 'attention.signedOut')}
          />
          {!isMe && (
            <ConfirmButton
              label={t('attention.lock')}
              title={t('attention.lockTitle', { name })}
              body={t('attention.lockBody')}
              disabled={act.isPending}
              onConfirm={() => run('lock', 'attention.locked')}
            />
          )}
        </div>
      </section>
      {!isMe && (
        <section className={styles.section} aria-labelledby="danger-heading">
          <h2 id="danger-heading">{t('userForm.danger')}</h2>
          <p className={styles.muted}>{t('userForm.deleteBody')}</p>
          <div className={styles.actions}>
            <ConfirmButton
              label={t('users.delete')}
              title={t('users.deleteTitle', { name })}
              body={t('userForm.deleteBody')}
              disabled={act.isPending}
              onConfirm={() =>
                run('delete', 'userForm.deletedOne', () => void navigate('/admin/users'))
              }
            />
          </div>
        </section>
      )}
    </>
  );
}
