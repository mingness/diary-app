/**
 * Sharing decisions in review (spec §5.3, F3): a request gets one line with 批准開放 (after a confirmation)
 * and 婉拒; an open entry only a small 取消開放 beside its chip (StopSharing). Any leader may decide, their own
 * entries included.
 */
import { useState } from 'react';
import type { Access } from '@diary/shared';
import { useAccessChange, type AccessAction } from '../../api/diary.js';
import { Button } from '../../components/Button.js';
import { ConfirmDialog } from '../../components/Dialog.js';
import { useToast } from '../../components/Toast.js';
import { useT, type MessageKey } from '../../i18n/index.js';
import styles from './review.module.css';

const DONE: Record<Exclude<AccessAction, 'request' | 'withdraw'>, MessageKey> = {
  approve: 'approval.approved',
  decline: 'approval.declined',
  revoke: 'approval.revoked',
};

/** A small 取消開放 for an open entry, after a confirmation; it sits beside the 已開放 chip. */
export function StopSharing({ documentId }: { documentId: string }) {
  const t = useT();
  const toast = useToast();
  const change = useAccessChange(documentId);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button small variant="quiet" disabled={change.isPending} onClick={() => setConfirming(true)}>
        {t('approval.revoke')}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={t('share.revokeTitle')}
        onCancel={() => setConfirming(false)}
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                change.mutate('revoke', {
                  onSuccess: () => toast.show(t(DONE.revoke)),
                  onError: toast.showError,
                });
              }}
            >
              {t('approval.revoke')}
            </Button>
          </>
        }
      >
        <p>{t('approval.revokeBody')}</p>
      </ConfirmDialog>
    </>
  );
}

/** A share request: one line with an amber edge, 批准開放 (after a confirmation) and 婉拒. */
export function ApprovalBar({ documentId, access }: { documentId: string; access: Access }) {
  const t = useT();
  const toast = useToast();
  const change = useAccessChange(documentId);
  const [confirming, setConfirming] = useState(false);

  if (access !== 'wait_for_open') return null;

  function run(action: 'approve' | 'decline') {
    setConfirming(false);
    change.mutate(action, {
      onSuccess: () => toast.show(t(DONE[action])),
      onError: toast.showError,
    });
  }

  return (
    <div className={styles.approval}>
      <span>{t('approval.waiting')}</span>
      <span className={styles.approvalActions}>
        <Button
          small
          variant="primary"
          disabled={change.isPending}
          onClick={() => setConfirming(true)}
        >
          {t('approval.approve')}
        </Button>
        <Button small disabled={change.isPending} onClick={() => run('decline')}>
          {t('approval.decline')}
        </Button>
      </span>
      <ConfirmDialog
        open={confirming}
        title={t('approval.confirmTitle')}
        onCancel={() => setConfirming(false)}
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={() => run('approve')}>
              {t('approval.approve')}
            </Button>
          </>
        }
      >
        <p>{t('approval.confirmBody')}</p>
      </ConfirmDialog>
    </div>
  );
}
