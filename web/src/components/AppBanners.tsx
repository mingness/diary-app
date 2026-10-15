/**
 * App-wide notices (FRONTEND.md §9): offline (the app shell still opens from the service worker, but nothing
 * can be saved or loaded), and a new version, offered as a reload only while nothing is unsaved.
 */
import { useSyncExternalStore } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useT } from '../i18n/index.js';
import { useAnyUnsaved } from '../lib/unsaved.js';
import { Button } from './Button.js';
import styles from './Banners.module.css';

const HOUR = 60 * 60 * 1000;

function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener('online', listener);
      window.addEventListener('offline', listener);
      return () => {
        window.removeEventListener('online', listener);
        window.removeEventListener('offline', listener);
      };
    },
    () => navigator.onLine,
  );
}

export function OfflineBanner() {
  const t = useT();
  const online = useOnline();
  if (online) return null;
  return (
    <div className={`${styles.banner} ${styles.offline}`} role="status">
      {t('pwa.offline')}
    </div>
  );
}

export function UpdateBanner() {
  const t = useT();
  const unsaved = useAnyUnsaved();
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // An installed app can stay open for days: look for a new version every hour as well.
    onRegisteredSW: (_url, registration) => {
      if (registration) window.setInterval(() => void registration.update(), HOUR);
    },
  });
  // Never while writing is unsaved: reloading would lose it. The offer appears once it's saved.
  if (!needRefresh || unsaved) return null;
  return (
    <div className={`${styles.banner} ${styles.update}`} role="status">
      <span>{t('pwa.update')}</span>
      <Button small variant="primary" onClick={() => void updateServiceWorker(true)}>
        {t('pwa.reload')}
      </Button>
    </div>
  );
}
