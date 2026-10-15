/**
 * The signed-in frame (FRONTEND.md §3): the app name and language toggle on top, and the role's few
 * destinations, always visible with an icon and a label. A bottom tab bar on phones and tablets; the same
 * links in the top bar from 1024 px.
 */
import type { ReactNode } from 'react';
import { NavLink, useMatches } from 'react-router';
import type { Role } from '@diary/shared';
import { useI18n, type MessageKey } from '../i18n/index.js';
import { Icon, type IconName } from './Icon.js';
import { LanguageToggle } from './LanguageToggle.js';
import styles from './AppShell.module.css';

interface NavItem {
  to: string;
  label: MessageKey;
  icon: IconName;
}

// Destinations appear here as their screens are built (docs/ARCHITECTURE.md §11, Phase B).
const DIARY: NavItem = { to: '/diary', label: 'nav.diary', icon: 'book' };
const OPEN: NavItem = { to: '/open', label: 'nav.open', icon: 'bookOpen' };
const ME: NavItem = { to: '/me', label: 'nav.me', icon: 'user' };

const NAV: Record<Role, readonly NavItem[]> = {
  NORMAL_USER: [DIARY, OPEN, ME],
  COURSE_LEADER: [DIARY, OPEN, ME],
  SYS_ADMIN: [ME],
};

/** Whether the current screen is a detail screen (route `handle: { detail: true }`). */
function useIsDetail(): boolean {
  return useMatches().some((match) => (match.handle as { detail?: boolean } | undefined)?.detail);
}

export function AppShell({ role, children }: { role: Role; children: ReactNode }) {
  const { t } = useI18n();
  const isDetail = useIsDetail();
  return (
    <>
      <header className={styles.header}>
        <span className={styles.brand}>{t('app.title')}</span>
        <nav
          className={`${styles.nav} ${isDetail ? styles.navDetail : ''}`}
          aria-label={t('nav.label')}
        >
          <ul className={styles.tabs}>
            {NAV[role].map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} className={styles.tab ?? ''}>
                  <Icon name={item.icon} size="1.4em" />
                  <span>{t(item.label)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <LanguageToggle />
      </header>
      <main className={`${styles.main} ${isDetail ? styles.mainDetail : ''}`}>{children}</main>
    </>
  );
}
