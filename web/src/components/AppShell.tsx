/**
 * The signed-in frame (FRONTEND.md §3): the app name and language toggle on top, and the role's few
 * destinations, always visible with an icon and a label. A bottom tab bar on phones and tablets; the same
 * links in the top bar from 1024 px.
 */
import type { ReactNode } from 'react';
import { NavLink, useMatches } from 'react-router';
import { useAlertStatus, useWaitingResets } from '../api/admin.js';
import { useOpenRequests } from '../api/leader.js';
import type { Role } from '@diary/shared';
import { useI18n, type MessageKey } from '../i18n/index.js';
import { Icon, type IconName } from './Icon.js';
import { LanguageToggle } from './LanguageToggle.js';
import styles from './AppShell.module.css';

interface NavItem {
  to: string;
  label: MessageKey;
  /** A longer label for the desktop top bar, where there is room (FRONTEND.md §3). */
  wideLabel?: MessageKey;
  icon: IconName;
  /** Only in the desktop top bar; phones keep to four or five tabs. */
  desktopOnly?: boolean;
  /** What the badge counts: share requests (leaders), open flags or waiting resets (SYS_ADMINs). */
  badge?: 'requests' | 'alerts' | 'resets';
}

// Destinations appear here as their screens are built (docs/ARCHITECTURE.md §11, Phase B).
const DIARY: NavItem = { to: '/diary', label: 'nav.diary', icon: 'book' };
const OPEN: NavItem = { to: '/open', label: 'nav.open', icon: 'bookOpen' };
const COUNT: NavItem = { to: '/count', label: 'nav.count', icon: 'count' };
const ME: NavItem = { to: '/me', label: 'nav.me', icon: 'user' };

const NAV: Record<Role, readonly NavItem[]> = {
  NORMAL_USER: [DIARY, OPEN, COUNT, ME],
  COURSE_LEADER: [
    { to: '/review', label: 'nav.review', icon: 'review', badge: 'requests' },
    { ...DIARY, wideLabel: 'nav.myDiary' },
    OPEN,
    COUNT,
    ME,
  ],
  SYS_ADMIN: [
    { to: '/admin/attention', label: 'nav.attention', icon: 'bell', badge: 'alerts' },
    { to: '/admin/users', label: 'nav.users', icon: 'users', badge: 'resets' },
    {
      to: '/admin/documents',
      label: 'nav.documents',
      wideLabel: 'nav.documentsWide',
      icon: 'book',
    },
    COUNT,
    ME,
  ],
};

function useRouteFlag(flag: 'detail' | 'wide'): boolean {
  return useMatches().some(
    (match) => (match.handle as Partial<Record<typeof flag, boolean>> | undefined)?.[flag],
  );
}

/** A tab's count, shown as a number with words for screen readers; kept fresh by its query's polling. */
function Badge({ kind }: { kind: NonNullable<NavItem['badge']> }) {
  const { t } = useI18n();
  const requests = useOpenRequests(kind === 'requests').data?.documents.length;
  const alerts = useAlertStatus(kind === 'alerts').data?.openCount;
  const resets = useWaitingResets(kind === 'resets').data;
  const count = { requests, alerts, resets }[kind] ?? 0;
  if (count === 0) return null;
  return (
    <span className={styles.badge}>
      <span aria-hidden="true">{count}</span>
      <span className="visually-hidden">{t('nav.waiting', { n: count })}</span>
    </span>
  );
}

export function AppShell({ role, children }: { role: Role; children: ReactNode }) {
  const { t } = useI18n();
  const isDetail = useRouteFlag('detail');
  const isWide = useRouteFlag('wide');
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
              <li key={item.to} className={item.desktopOnly ? styles.desktopOnly : undefined}>
                <NavLink to={item.to} className={styles.tab ?? ''}>
                  <span className={styles.icon}>
                    <Icon name={item.icon} size="1.4em" />
                    {item.badge && <Badge kind={item.badge} />}
                  </span>
                  {item.wideLabel ? (
                    <>
                      <span className={styles.phoneLabel}>{t(item.label)}</span>
                      <span className={styles.wideLabel}>{t(item.wideLabel)}</span>
                    </>
                  ) : (
                    <span>{t(item.label)}</span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <LanguageToggle />
      </header>
      <main
        className={[styles.main, isDetail && styles.mainDetail, isWide && styles.wide]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </main>
    </>
  );
}
