/**
 * 翻譯 / Translate (spec §8): buttons in the submit style, with the result as plain text below them, never in
 * a text box; a new click replaces it. Greyed out when the server has no translation provider.
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
          variant="primary"
          lang="zh-Hant"
          disabled={!available || translate.isPending}
          onClick={() => run('en_to_zh')}
        >
          {t('translate.toZh')}
        </Button>
        <Button
          variant="primary"
          lang="en"
          disabled={!available || translate.isPending}
          onClick={() => run('zh_to_en')}
        >
          {t('translate.toEn')}
        </Button>
      </div>
      {!available && <p className={styles.off}>{t('translate.off')}</p>}
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
