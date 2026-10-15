/**
 * Toasts (spec §10.6): short notifications in an aria-live region that never take focus, so they don't
 * disturb typing. Error toasts carry the request ID ("錯誤代碼：…", §12.7).
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError } from '../api/client.js';
import { useI18n } from '../i18n/index.js';
import { Icon } from './Icon.js';
import { shortRef } from './Notice.js';
import styles from './Toast.module.css';

interface Toast {
  id: number;
  message: string;
  requestId?: string | null;
}

interface ToastApi {
  show: (message: string, options?: { requestId?: string | null }) => void;
  /** An API failure in words, with its error ref. */
  showError: (error: unknown) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const DURATION_MS = 5_000;
const ERROR_DURATION_MS = 10_000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t, tError } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback<ToastApi['show']>(
    (message, options = {}) => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-2), { id, message, requestId: options.requestId ?? null }]);
      window.setTimeout(() => dismiss(id), options.requestId ? ERROR_DURATION_MS : DURATION_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      showError: (error) => {
        if (error instanceof ApiError) show(tError(error.code), { requestId: error.requestId });
        else show(tError('internal_error'));
      },
    }),
    [show, tError],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={styles.toast}>
            <div className={styles.message}>
              <span>{toast.message}</span>
              {toast.requestId && (
                <span className={styles.ref}>
                  {t('common.errorRef', { id: shortRef(toast.requestId) })}
                </span>
              )}
            </div>
            <button
              type="button"
              className={styles.close}
              aria-label={t('common.close')}
              onClick={() => dismiss(toast.id)}
            >
              <Icon name="close" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast outside ToastProvider');
  return value;
}
