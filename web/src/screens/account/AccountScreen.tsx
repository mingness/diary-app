/**
 * The account page (FRONTEND.md §4.6, spec §4.4): profile, appearance, storage used, password, the
 * authenticator (SYS_ADMINs), signed-in devices, and signing out. (Installing the app: slice 17.)
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { personName, type MeResponse } from '@diary/shared';
import { api } from '../../api/client.js';
import { SESSION_KEY, sessionFromMe, useMe, type Session } from '../../api/session.js';
import { Button } from '../../components/Button.js';
import { SegmentedControl } from '../../components/Field.js';
import { Icon } from '../../components/Icon.js';
import { useToast } from '../../components/Toast.js';
import { useI18n, useT } from '../../i18n/index.js';
import { formatBytes } from '../../lib/images.js';
import { DevicesSection } from './DevicesSection.js';
import { PasswordButton } from './PasswordSheet.js';
import { ProfileSection } from './ProfileSection.js';
import { FONT_SIZES, type Appearance, type FontSize, type Theme } from '../../lib/appearance.js';
import { useLogout } from './useLogout.js';
import styles from './AccountScreen.module.css';

/** The name from the profile (written as `personName` says), or the username when none is set. */
export function displayName(me: { username: string; profile: MeResponse['user']['profile'] }) {
  return personName(me.profile.familyName, me.profile.givenName) || me.username;
}

export function AccountScreen() {
  const { t } = useI18n();
  const me = useMe();
  const logout = useLogout();

  return (
    <div className={styles.page}>
      <h1>{t('account.title')}</h1>
      <div className={styles.who}>
        {me.profile.photo ? (
          <img className={styles.avatar} src={me.profile.photo} alt="" />
        ) : (
          <Icon name="user" size="2em" />
        )}
        <div>
          <p className={styles.name}>{displayName(me)}</p>
          <p className={styles.username}>{me.username}</p>
        </div>
      </div>
      <ProfileSection />
      <AppearanceSection />
      <section className={styles.section} aria-labelledby="security-heading">
        <h2 id="security-heading">{t('userForm.security')}</h2>
        <p>{t('account.storage', { size: formatBytes(me.storageBytes) })}</p>
        <div>
          <PasswordButton />
        </div>
        {me.role === 'SYS_ADMIN' && (
          <div>
            <h3>{t('account.authenticator')}</h3>
            <p>{t('account.totpOn')}</p>
            <p className={styles.username}>{t('account.totpReset')}</p>
          </div>
        )}
      </section>
      <DevicesSection />
      <div>
        <Button variant="danger" onClick={logout.run} disabled={logout.isPending}>
          <Icon name="logout" />
          {t('account.logout')}
        </Button>
      </div>
    </div>
  );
}

const APPEARANCE = ['appearance'] as const;

function AppearanceSection() {
  const t = useT();
  const me = useMe();
  const toast = useToast();
  const queryClient = useQueryClient();
  // What the user just picked, shown until the server answers. React state updates within the click, whereas
  // the query cache notifies a tick later, which would let the controlled radio snap back meanwhile.
  const [picked, setPicked] = useState<Partial<Appearance>>({});

  const save = useMutation({
    mutationKey: APPEARANCE,
    // One save at a time, in order: two quick changes must not race, or the first reply (with the old theme)
    // could land last and undo the second.
    scope: { id: 'appearance' },
    mutationFn: ({ change }: { change: Partial<Appearance>; previous: Session }) =>
      api<MeResponse>('PUT', '/api/me', change),
    // Only the last queued save's reply has every change in it; earlier ones would briefly undo later picks.
    onSuccess: (response) => {
      if (queryClient.isMutating({ mutationKey: APPEARANCE }) <= 1) {
        queryClient.setQueryData(SESSION_KEY, sessionFromMe(response));
      }
    },
    onError: (error, { previous }) => {
      queryClient.setQueryData(SESSION_KEY, previous);
      toast.showError(error);
    },
    onSettled: (_data, _error, { change }) =>
      setPicked(
        (current) =>
          Object.fromEntries(
            Object.entries(current).filter(([key]) => !(key in change)),
          ) as Partial<Appearance>,
      ),
  });

  // Optimistic: the page changes at once (the shell applies the session's appearance) and goes back if the
  // server refuses.
  function change(patch: Partial<Appearance>) {
    const previous = queryClient.getQueryData<Session>(SESSION_KEY);
    if (previous?.status !== 'ready') return;
    setPicked((current) => ({ ...current, ...patch }));
    const next: Session = { ...previous, me: { ...previous.me, ...patch } };
    queryClient.setQueryData<Session>(SESSION_KEY, next);
    save.mutate({ change: patch, previous });
  }

  const sizeLabels: Record<FontSize, string> = {
    16: t('account.size16'),
    18: t('account.size18'),
    20: t('account.size20'),
    22: t('account.size22'),
  };

  return (
    <section className={styles.section} aria-labelledby="appearance-heading">
      <h2 id="appearance-heading">{t('account.appearance')}</h2>
      <SegmentedControl<FontSize>
        legend={t('account.textSize')}
        name="fontSize"
        value={picked.fontSize ?? me.fontSize}
        onChange={(fontSize) => change({ fontSize })}
        options={FONT_SIZES.map((size) => ({ value: size, label: sizeLabels[size] }))}
      />
      <p className={styles.preview}>
        <span className={styles.previewLabel}>{t('account.previewLabel')}</span>
        {t('account.preview')}
      </p>
      <SegmentedControl<Theme>
        legend={t('account.theme')}
        name="theme"
        value={picked.theme ?? me.theme}
        onChange={(theme) => change({ theme })}
        options={[
          { value: 'light', label: t('account.themeLight') },
          { value: 'dark', label: t('account.themeDark') },
          { value: 'system', label: t('account.themeSystem') },
        ]}
      />
    </section>
  );
}
