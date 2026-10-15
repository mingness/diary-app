/**
 * One entry in full, as the reader may see it (spec §6.1, FRONTEND.md §4.4, §4.7), used wherever an entry is
 * read: full screen, in the leader's reading pane, and in the continuous reading feed.
 *
 * - The owner (context `own`): their newest writing, 編輯, the share request, and submitted comments.
 * - A leader in review: the submitted version, sharing decisions, the other leaders' comments and the comment
 *   editor for their own. Elsewhere (開放日記) the entry is read-only and their own comment is listed with the
 *   others. A leader's own entry seen in review gets the review treatment.
 * - Anyone else, for an open entry: the submitted version and its submitted comments.
 */
import { useEffect } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { personName, type EntryView } from '@diary/shared';
import { refreshAfterRead } from '../../api/leader.js';
import { useSession } from '../../api/session.js';
import { buttonClass } from '../../components/Button.js';
import { Icon } from '../../components/Icon.js';
import { useI18n } from '../../i18n/index.js';
import { formatDiaryDate } from '../../lib/dates.js';
import { ApprovalBar, StopSharing } from '../review/ApprovalBar.js';
import { CommentEditor } from '../review/CommentEditor.js';
import { AccessChip, CommentChip, StateChip } from './chips.js';
import { CommentList } from './CommentList.js';
import { RichContent } from './RichContent.js';
import { ShareToggle } from './ShareToggle.js';
import { TranslateBlock } from './TranslateBlock.js';
import styles from './EntryArticle.module.css';

export function EntryArticle({
  entry,
  context,
  level,
}: {
  entry: EntryView;
  /**
   * `own`: the owner's diary (編輯, sharing, state). `review`: the leader's review (decisions, my comment).
   * `read`: 開放日記, just for reading: text, author, translation and comments, nothing to change.
   */
  context: 'own' | 'review' | 'read';
  /** The title's heading level: 1 full screen, 2 in a pane, 3 in a feed under a list heading. */
  level: 1 | 2 | 3;
}) {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const isLeader = session?.status === 'ready' && session.me.role === 'COURSE_LEADER';

  // Opening the entry marked its new comments seen on the server; the list's markers must follow.
  const hadNew = entry.view === 'owner' && entry.comments.some((c) => c.isNew);
  useEffect(() => {
    if (hadNew) void queryClient.invalidateQueries({ queryKey: ['documents', 'mine'] });
  }, [hadNew, queryClient]);
  // A leader's read is recorded by the server: their 未讀 count and 未讀 marks follow.
  const leaderRead = entry.view === 'leader';
  useEffect(() => {
    if (leaderRead) refreshAfterRead(queryClient);
  }, [leaderRead, entry.id, queryClient]);

  const ownView = entry.view === 'owner' && context === 'own' ? entry : null;
  const shown =
    entry.view !== 'owner'
      ? { title: entry.title, body: entry.body }
      : ownView
        ? (entry.draft ?? entry.submitted ?? { title: '', body: '' })
        : // Leaders review, and 開放日記 shows, what was submitted, the reader's own entries included.
          { title: entry.submitted?.title ?? '', body: entry.submitted?.body ?? '' };
  const submitted = entry.view !== 'owner' || entry.submitted !== null;
  // Not a reader's view: the leader's own comment and sharing state are known.
  const withMine = entry.view === 'reader' ? null : entry;
  const reviewing = context === 'review' && entry.view !== 'reader';
  // Leaders write comments in review (批閱 / 開放申請); elsewhere their own shows with the others, read-only.
  const commenting = isLeader && submitted && context === 'review';
  const myName =
    session?.status === 'ready'
      ? personName(session.me.profile.familyName, session.me.profile.givenName) ||
        session.me.username
      : null;
  const mine =
    !commenting && withMine?.myComment?.state === 'submitted' && withMine.myComment.submittedAt
      ? [
          {
            id: `mine-${entry.id}`,
            authorName: myName,
            submittedAt: withMine.myComment.submittedAt,
            body: withMine.myComment.body,
          },
        ]
      : [];
  const comments = [...entry.comments, ...mine].sort((a, b) =>
    a.submittedAt.localeCompare(b.submittedAt),
  );
  const Title = `h${level}` as const;

  return (
    <article className={styles.article}>
      <div className={styles.titleRow}>
        <Title className={level === 1 ? styles.title : styles.titleSmall}>
          {shown.title || t('entry.untitled')}
        </Title>
        {ownView && (
          <Link to={`/diary/${entry.id}/edit`} className={buttonClass('quiet', { small: true })}>
            <Icon name="pen" />
            {t('entry.edit')}
          </Link>
        )}
      </div>
      <div className={styles.meta}>
        <span>{formatDiaryDate(entry.diaryDate, lang)}</span>
        {entry.view !== 'owner' ? (
          <span>{entry.author.name || entry.author.username}</span>
        ) : (
          context === 'read' && <span>{myName}</span>
        )}
        {/* For reading, the comments speak for themselves and everything shown is open. */}
        {ownView && <StateChip state={ownView.state} />}
        {context !== 'read' && withMine && <AccessChip access={withMine.access} />}
        {reviewing && withMine?.access === 'open' && <StopSharing documentId={entry.id} />}
        {context !== 'read' && <CommentChip count={comments.length} />}
      </div>
      {/* Quiet lines, not boxes: the entry itself should be the most visible thing here. */}
      {ownView && !ownView.submitted && <p className={styles.note}>{t('entry.draftNote')}</p>}
      {ownView?.submitted && ownView.draft && (
        <p className={styles.note}>{t('entry.pendingNote')}</p>
      )}
      {reviewing && withMine && <ApprovalBar documentId={entry.id} access={withMine.access} />}
      <div className={styles.body}>
        {shown.body ? <RichContent html={shown.body} /> : t('entry.empty')}
      </div>
      <TranslateBlock target={{ documentId: entry.id }} />
      {ownView && (
        <ShareToggle documentId={ownView.id} access={ownView.access} submitted={submitted} />
      )}
      <CommentList comments={comments} />
      {commenting && withMine && (
        <CommentEditor key={entry.id} documentId={entry.id} saved={withMine.myComment} />
      )}
    </article>
  );
}
