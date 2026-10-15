/**
 * The account page (FRONTEND.md §4.6). This slice has appearance and sign-out; the profile, password,
 * devices, storage and authenticator sections arrive with slice 16.
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
import { useT } from '../../i18n/index.js';
import { FONT_SIZES, type Appearance, type FontSize, type Theme } from '../../lib/appearance.js';
import { useLogout } from './useLogout.js';
import styles from './AccountScreen.module.css';

/** The name from the profile (written as `personName` says), or the username when none is set. */
export function displayName(me: { username: string; profile: MeResponse['user']['profile'] }) {
  return personName(me.profile.familyName, me.profile.givenName) || me.username;
}

export function AccountScreen() {
  const t = useT();
  const me = useMe();
  const logout = useLogout();

  return (
    <div className={styles.page}>
      <h1>{t('account.title')}</h1>
      <section className={styles.section} aria-label={t('account.title')}>
        <div className={styles.who}>
          <Icon name="user" size="2em" />
          <div>
            <p>{displayName(me)}</p>
            <p className={styles.username}>{me.username}</p>
          </div>
        </div>
      </section>
      <AppearanceSection />
      <div>
        <Button variant="danger" onClick={logout.run} disabled={logout.isPending}>
          <Icon name="logout" />
          {t('account.logout')}
        </Button>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const t = useT();
  const me = useMe();
  const toast = useToast();
  const queryClient = useQueryClient();
  // What the user just picked, shown until the server answers. React state updates within the click, whereas
  // the query cache notifies a tick later, which would let the controlled radio snap back meanwhile.
  const [picked, setPicked] = useState<Partial<Appearance>>({});

  const save = useMutation({
    mutationFn: ({ change }: { change: Partial<Appearance>; previous: Session }) =>
      api<MeResponse>('PUT', '/api/me', change),
    onSuccess: (response) => queryClient.setQueryData(SESSION_KEY, sessionFromMe(response)),
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
