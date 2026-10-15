/** Submitted comments under an entry (spec §5.4, §6.1): the `Comment:` label, then one card per leader. */
import type { SubmittedComment } from '@diary/shared';
import { Chip } from '../../components/Chip.js';
import { useI18n } from '../../i18n/index.js';
import { formatDateTime } from '../../lib/dates.js';
import { RichContent } from './RichContent.js';
import { TranslateBlock } from './TranslateBlock.js';
import styles from './CommentList.module.css';

type Comment = SubmittedComment & { isNew?: boolean };

export function CommentList({ comments }: { comments: readonly Comment[] }) {
  const { t, lang } = useI18n();
  if (comments.length === 0) return null;
  return (
    // A plain block, not a landmark: a feed has many entries, each with its own comments.
    <div>
      <h2 className={styles.label}>{t('entry.commentLabel')}</h2>
      <ul className={styles.list}>
        {comments.map((comment) => (
          <li key={comment.id} className={styles.card}>
            <div className={styles.meta}>
              <span className={styles.author}>
                {comment.authorName
                  ? t('entry.leader', { name: comment.authorName })
                  : t('entry.formerLeader')}
              </span>
              <span>{formatDateTime(comment.submittedAt, lang)}</span>
              {comment.isNew && (
                <Chip tone="blue" strong>
                  {t('entry.newComment')}
                </Chip>
              )}
            </div>
            <RichContent html={comment.body} />
            <TranslateBlock target={{ commentId: comment.id }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
