/**
 * The human-verification question (spec §4.1): a server-drawn image of a sum, a 更新 button for a new one,
 * and the answer box. Each CAPTCHA can be checked once, so the form calls `refresh()` after every attempt.
 */
import { useCallback, useId, useState } from 'react';
import type { Ref } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { CaptchaResponse } from '@diary/shared';
import { api } from '../../api/client.js';
import { Button } from '../../components/Button.js';
import { TextField } from '../../components/Field.js';
import { Icon } from '../../components/Icon.js';
import { useT } from '../../i18n/index.js';
import styles from './auth.module.css';

type Captcha = z.infer<typeof CaptchaResponse>;

export function useCaptcha() {
  // Keyed per form instance: two screens sharing a cached CAPTCHA would send one that is already used up.
  const instance = useId();
  const [round, setRound] = useState(0);
  const query = useQuery({
    queryKey: ['captcha', instance, round],
    queryFn: () => api<Captcha>('GET', '/api/auth/captcha'),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const refresh = useCallback(() => setRound((r) => r + 1), []);
  return { captcha: query.data ?? null, failed: query.isError, refresh };
}

interface CaptchaFieldProps {
  captcha: Captcha | null;
  failed: boolean;
  onRefresh: () => void;
  answer: string;
  onAnswer: (value: string) => void;
  error?: string | null;
  inputRef?: Ref<HTMLInputElement>;
}

export function CaptchaField({
  captcha,
  failed,
  onRefresh,
  answer,
  onAnswer,
  error,
  inputRef,
}: CaptchaFieldProps) {
  const t = useT();
  return (
    <div className={styles.form}>
      <div className={styles.captchaRow}>
        {captcha ? (
          <img
            className={styles.captchaImage}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(captcha.svg)}`}
            alt={t('auth.captchaImage')}
          />
        ) : (
          <span className={`${styles.captchaImage} ${styles.captchaMissing}`} role="status">
            {failed ? t('auth.captchaFailed') : t('auth.captchaLoading')}
          </span>
        )}
        <Button variant="secondary" aria-label={t('auth.captchaRefreshLabel')} onClick={onRefresh}>
          <Icon name="refresh" />
          {t('auth.captchaRefresh')}
        </Button>
      </div>
      <TextField
        ref={inputRef}
        label={t('auth.captchaAnswer')}
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        value={answer}
        onChange={(e) => onAnswer(e.target.value.replace(/\D/g, ''))}
        error={error ?? null}
      />
    </div>
  );
}
