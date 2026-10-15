/** The state, sharing and comment chips used on entry cards and the entry view (FRONTEND.md §4.2). */
import type { Access } from '@diary/shared';
import type { MyDocumentRow } from '../../api/diary.js';
import { Chip } from '../../components/Chip.js';
import { useT } from '../../i18n/index.js';

export function StateChip({ state }: { state: MyDocumentRow['state'] }) {
  const t = useT();
  if (state === 'draft') return <Chip tone="amber">{t('chip.draft')}</Chip>;
  if (state === 'submitted_with_draft') return <Chip tone="primary">{t('chip.pending')}</Chip>;
  return <Chip tone="green">{t('chip.submitted')}</Chip>;
}

export function AccessChip({ access }: { access: Access }) {
  const t = useT();
  if (access === 'open') return <Chip tone="green">{t('chip.open')}</Chip>;
  if (access === 'wait_for_open') return <Chip tone="amber">{t('chip.waiting')}</Chip>;
  return <Chip>{t('chip.private')}</Chip>;
}

export function CommentChip({ count, unseen = false }: { count: number; unseen?: boolean }) {
  const t = useT();
  if (unseen) {
    return (
      <Chip tone="blue" strong>
        {t('chip.newComment')}
      </Chip>
    );
  }
  if (count === 0) return <Chip>{t('chip.noComment')}</Chip>;
  return <Chip tone="blue">{t(count === 1 ? 'chip.comment' : 'chip.comments', { n: count })}</Chip>;
}
