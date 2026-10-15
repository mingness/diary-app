/**
 * The owner's sharing request (spec §5.3): checked for both "waiting" and "open". Checking asks a leader to
 * open the entry; unchecking withdraws the request, or, once open, stops sharing after a confirmation.
 */
import { useState } from 'react';
import type { Access } from '@diary/shared';
import { useAccessChange } from '../../api/diary.js';
import { Button } from '../../components/Button.js';
import { ConfirmDialog } from '../../components/Dialog.js';
import { CheckboxRow } from '../../components/Field.js';
import { useToast } from '../../components/Toast.js';
import { useT } from '../../i18n/index.js';

export function ShareToggle({
  documentId,
  access,
  submitted,
}: {
  /** Null for a new entry that hasn't been saved yet. */
  documentId: string | null;
  access: Access;
  submitted: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const change = useAccessChange(documentId ?? '');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  // The box follows the click at once; the server's answer (or a refusal) settles it.
  const [pending, setPending] = useState<boolean | null>(null);
  const run = (action: 'request' | 'withdraw' | 'revoke', checked: boolean) => {
    setPending(checked);
    change.mutate(action, { onError: toast.showError, onSettled: () => setPending(null) });
  };

  const hint = !submitted
    ? t('share.notSubmitted')
    : access === 'wait_for_open'
      ? t('share.waiting')
      : access === 'open'
        ? t('share.open')
        : undefined;

  function toggle(checked: boolean) {
    if (checked) run('request', true);
    else if (access === 'open') setConfirmRevoke(true);
    else run('withdraw', false);
  }

  return (
    <>
      <CheckboxRow
        label={t('share.label')}
        {...(hint ? { hint } : {})}
        checked={pending ?? access !== 'private'}
        disabled={!documentId || !submitted || change.isPending}
        onChange={(e) => toggle(e.target.checked)}
      />
      <ConfirmDialog
        open={confirmRevoke}
        title={t('share.revokeTitle')}
        onCancel={() => setConfirmRevoke(false)}
        actions={
          <>
            <Button onClick={() => setConfirmRevoke(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmRevoke(false);
                run('revoke', false);
              }}
            >
              {t('share.revokeConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('share.revokeBody')}</p>
      </ConfirmDialog>
    </>
  );
}
