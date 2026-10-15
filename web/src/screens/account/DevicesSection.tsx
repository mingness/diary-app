/**
 * Signed-in devices (spec §4.1, §4.4): each with its name from the browser, this device marked, when it was
 * last used, and 登出. Signing out this device is the same as 登出.
 */
import { useDevices, useSignOutDevice } from '../../api/account.js';
import { Button } from '../../components/Button.js';
import { Chip } from '../../components/Chip.js';
import { ErrorState, LoadingState } from '../../components/States.js';
import { useToast } from '../../components/Toast.js';
import { useI18n } from '../../i18n/index.js';
import { formatDateTime } from '../../lib/dates.js';
import { useLogout } from './useLogout.js';
import styles from './AccountScreen.module.css';

export function DevicesSection() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const devices = useDevices();
  const signOut = useSignOutDevice();
  const logout = useLogout();
  return (
    <section className={styles.section} aria-labelledby="devices-heading">
      <h2 id="devices-heading">{t('account.devices')}</h2>
      {devices.isPending ? (
        <LoadingState />
      ) : devices.isError ? (
        <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />
      ) : (
        <ul className={styles.devices}>
          {devices.data.sessions.map((device) => (
            <li key={device.id} className={styles.device}>
              <span className={styles.deviceName}>
                {device.deviceLabel}
                {device.current && <Chip tone="green">{t('account.thisDevice')}</Chip>}
                {device.kind === 'device' && <Chip>{t('account.remembered')}</Chip>}
              </span>
              <span className={styles.muted}>
                {t('account.lastUsed', { time: formatDateTime(device.lastSeenAt, lang) })}
              </span>
              <Button
                small
                variant="danger"
                aria-label={t('account.signOutDeviceLabel', { device: device.deviceLabel })}
                disabled={signOut.isPending || logout.isPending}
                onClick={() =>
                  device.current
                    ? logout.run()
                    : signOut.mutate(device.id, {
                        onSuccess: () => toast.show(t('account.signedOutDevice')),
                        onError: toast.showError,
                      })
                }
              >
                {t('account.signOutDevice')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
