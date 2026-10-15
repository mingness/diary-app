/**
 * The signed-in frame (FRONTEND.md §3): the app name and language toggle on top, and the role's few
 * destinations, always visible with an icon and a label. A bottom tab bar on phones and tablets; the same
 * links in the top bar from 1024 px.
 */
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
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
const NAV: Record<Role, readonly NavItem[]> = {
  NORMAL_USER: [{ to: '/me', label: 'nav.me', icon: 'user' }],
  COURSE_LEADER: [{ to: '/me', label: 'nav.me', icon: 'user' }],
  SYS_ADMIN: [{ to: '/me', label: 'nav.me', icon: 'user' }],
};

export function AppShell({ role, children }: { role: Role; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <>
      <header className={styles.header}>
        <span className={styles.brand}>{t('app.title')}</span>
        <nav className={styles.nav} aria-label={t('nav.label')}>
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
      <main className={styles.main}>{children}</main>
    </>
  );
}
