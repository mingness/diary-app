/** 歷史版本 (spec §5.2): earlier submitted versions, newest first, each expandable. */
import { useVersions } from '../../api/diary.js';
import { Sheet } from '../../components/Dialog.js';
import { ErrorState, LoadingState } from '../../components/States.js';
import { useI18n } from '../../i18n/index.js';
import { formatDateTime } from '../../lib/dates.js';
import { RichContent } from './RichContent.js';
import styles from './EditorScreen.module.css';

export function HistorySheet({
  documentId,
  open,
  onClose,
}: {
  documentId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const query = useVersions(documentId, open);
  return (
    <Sheet open={open} title={t('history.title')} onClose={onClose}>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.versions.length === 0 ? (
        <p>{t('history.empty')}</p>
      ) : (
        <div className={styles.versions}>
          {query.data.versions.map((version) => (
            <details key={version.versionNo} className={styles.version}>
              <summary>
                {t('history.version', { n: version.versionNo })} ·{' '}
                {formatDateTime(version.createdAt, lang)}
              </summary>
              <RichContent html={version.body} />
            </details>
          ))}
        </div>
      )}
    </Sheet>
  );
}
