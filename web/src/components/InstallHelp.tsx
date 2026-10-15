/**
 * Installing the app (spec §9.1, FRONTEND.md §9): the browser's own install button where it offers one,
 * otherwise the steps for the phone in hand; inside WeChat, how to open a real browser first.
 */
import { useState } from 'react';
import { useT } from '../i18n/index.js';
import {
  countVisit,
  currentPlatform,
  dismissInstall,
  install,
  installDismissed,
  shouldSuggestInstall,
  useInstallOffer,
} from '../lib/install.js';
import { Button } from './Button.js';
import { Sheet } from './Dialog.js';
import styles from './Banners.module.css';

function Steps() {
  const t = useT();
  const offer = useInstallOffer();
  const platform = currentPlatform();
  if (platform === 'installed') return <p>{t('install.standalone')}</p>;
  if (platform === 'wechat') return <p>{t('install.wechat')}</p>;
  return (
    <>
      <p>{t('install.why')}</p>
      {offer ? (
        <Button variant="primary" wide onClick={() => void install()}>
          {t('install.button')}
        </Button>
      ) : (
        <ol>
          {platform === 'ios' ? (
            <>
              <li>{t('install.ios1')}</li>
              <li>{t('install.ios2')}</li>
              <li>{t('install.ios3')}</li>
            </>
          ) : (
            <>
              <li>{t('install.android1')}</li>
              <li>{t('install.android2')}</li>
            </>
          )}
        </ol>
      )}
    </>
  );
}

/** The account page's "加到手機主畫面" row. */
export function InstallButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t('install.title')}</Button>
      <Sheet open={open} title={t('install.title')} onClose={() => setOpen(false)}>
        <Steps />
      </Sheet>
    </>
  );
}

// Counted once per app start, not per render.
const visits = typeof window === 'undefined' ? 0 : countVisit();

/** The one-time suggestion from a phone's third visit, until dismissed (FRONTEND.md §9). */
export function InstallSuggestion() {
  const t = useT();
  const [dismissed, setDismissed] = useState(installDismissed);
  const [open, setOpen] = useState(false);
  const phone = window.matchMedia('(pointer: coarse)').matches;
  if (!phone || !shouldSuggestInstall(visits, currentPlatform(), dismissed)) return null;
  return (
    <div className={`${styles.banner} ${styles.install}`}>
      <span>{t('install.banner')}</span>
      <Button small variant="primary" onClick={() => setOpen(true)}>
        {t('install.how')}
      </Button>
      <Button
        small
        variant="quiet"
        onClick={() => {
          dismissInstall();
          setDismissed(true);
        }}
      >
        {t('install.dismiss')}
      </Button>
      <Sheet open={open} title={t('install.title')} onClose={() => setOpen(false)}>
        <Steps />
      </Sheet>
    </div>
  );
}
