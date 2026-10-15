/**
 * One entry, read-only (FRONTEND.md §4.4, F1): the owner reaches it from 我的日記 and edits from here; anyone
 * else reads an open entry from 開放日記. Comments and translation live here, not in the editor.
 */
import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorCode, type EntryView } from '@diary/shared';
import { ApiError } from '../../api/client.js';
import { useEntry } from '../../api/diary.js';
import { buttonClass } from '../../components/Button.js';
import { DetailHeader } from '../../components/DetailHeader.js';
import { Icon } from '../../components/Icon.js';
import { Notice } from '../../components/Notice.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/States.js';
import { useI18n } from '../../i18n/index.js';
import { formatDiaryDate } from '../../lib/dates.js';
import { AccessChip, CommentChip, StateChip } from './chips.js';
import { CommentList } from './CommentList.js';
import { RichContent } from './RichContent.js';
import { ShareToggle } from './ShareToggle.js';
import { TranslateBlock } from './TranslateBlock.js';
import styles from './EntryScreen.module.css';

export function EntryScreen({ fallback }: { fallback: '/diary' | '/open' }) {
  const { t } = useI18n();
  const { id = '' } = useParams();
  const query = useEntry(id);
  const queryClient = useQueryClient();

  // Opening the entry marked its new comments seen on the server; the list's markers must follow.
  const hadNew = query.data?.view === 'owner' && query.data.comments.some((c) => c.isNew);
  useEffect(() => {
    if (hadNew) void queryClient.invalidateQueries({ queryKey: ['documents', 'mine'] });
  }, [hadNew, queryClient]);

  if (query.isPending) return <LoadingState />;
  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.code === ErrorCode.NotFound;
    return (
      <>
        <DetailHeader fallback={fallback} />
        {notFound ? (
          <EmptyState title={t('entry.notFound')} />
        ) : (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        )}
      </>
    );
  }
  return <Entry entry={query.data} fallback={fallback} />;
}

function Entry({ entry, fallback }: { entry: EntryView; fallback: string }) {
  const { t, lang } = useI18n();
  const owner = entry.view === 'owner' ? entry : null;
  // The owner reads their newest writing; leaders and readers only ever get the submitted version.
  const shown =
    entry.view === 'owner'
      ? (entry.draft ?? entry.submitted ?? { title: '', body: '' })
      : { title: entry.title, body: entry.body };

  return (
    <div className={styles.page}>
      <DetailHeader
        fallback={fallback}
        aside={
          owner && (
            <Link to={`/diary/${entry.id}/edit`} className={buttonClass('primary')}>
              <Icon name="pen" />
              {t('entry.edit')}
            </Link>
          )
        }
      />
      <h1 className={styles.title}>{shown.title || t('entry.untitled')}</h1>
      <div className={styles.meta}>
        <span>{formatDiaryDate(entry.diaryDate, lang)}</span>
        {entry.view !== 'owner' && <span>{entry.author.name || entry.author.username}</span>}
        {owner && <StateChip state={owner.state} />}
        {owner && <AccessChip access={owner.access} />}
        <CommentChip count={entry.comments.length} />
      </div>
      {owner && !owner.submitted && <Notice kind="info">{t('entry.draftNote')}</Notice>}
      {owner?.submitted && owner.draft && <Notice kind="info">{t('entry.pendingNote')}</Notice>}
      <div className={styles.body}>
        {shown.body ? <RichContent html={shown.body} label={t('editor.body')} /> : t('entry.empty')}
      </div>
      <TranslateBlock target={{ documentId: entry.id }} />
      {owner && (
        <div className={styles.actions}>
          <ShareToggle
            documentId={owner.id}
            access={owner.access}
            submitted={owner.submitted !== null}
          />
        </div>
      )}
      <CommentList comments={entry.comments} />
    </div>
  );
}
