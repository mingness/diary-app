/**
 * 翻譯 / Translate (spec §8): two small buttons at the right, with the result as plain text below them, never
 * in a text box; a new click replaces it. Greyed out (the reason in their tooltip) when the server has no
 * translation provider; a note beside every pair would repeat down a whole feed.
 */
import { useState } from 'react';
import type { TranslateDirection } from '@diary/shared';
import { ApiError } from '../../api/client.js';
import { useTranslate } from '../../api/diary.js';
import { useSession } from '../../api/session.js';
import { Button } from '../../components/Button.js';
import { Notice } from '../../components/Notice.js';
import { useI18n } from '../../i18n/index.js';
import styles from './TranslateBlock.module.css';

export function TranslateBlock({
  target,
}: {
  target: { documentId: string } | { commentId: string };
}) {
  const { t, tError } = useI18n();
  const { data: session } = useSession();
  const available = session?.status === 'ready' && session.features.translation;
  const translate = useTranslate();
  const [result, setResult] = useState<string | null>(null);

  function run(direction: TranslateDirection) {
    setResult(null);
    translate.mutate({ ...target, direction }, { onSuccess: ({ text }) => setResult(text) });
  }

  const error = translate.error instanceof ApiError ? translate.error : null;
  return (
    <div className={styles.block}>
      <div className={styles.buttons}>
        <Button
          small
          variant="quiet"
          lang="zh-Hant"
          title={available ? undefined : t('translate.off')}
          disabled={!available || translate.isPending}
          onClick={() => run('en_to_zh')}
        >
          {t('translate.toZh')}
        </Button>
        <Button
          small
          variant="quiet"
          lang="en"
          title={available ? undefined : t('translate.off')}
          disabled={!available || translate.isPending}
          onClick={() => run('zh_to_en')}
        >
          {t('translate.toEn')}
        </Button>
      </div>
      <div aria-live="polite">
        {translate.isPending && <p>{t('translate.working')}</p>}
        {result !== null && (
          <p className={styles.result}>
            <span className={styles.resultLabel}>{t('translate.result')}</span>
            {result}
          </p>
        )}
      </div>
      {error && (
        <Notice kind="error" requestId={error.requestId}>
          {tError(error.code)}
        </Notice>
      )}
    </div>
  );
}
