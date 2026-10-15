/**
 * 報數管理 (spec §6.5.3, §7.3): whether the 02:00 automatic counting ran, the recent runs and 立即執行; then
 * every user with their auto-submit switch, totals, and deleting their counts (all, or a count-date range),
 * e.g. to clean up after a hijacked account while keeping the honest history.
 */
import { useState } from 'react';
import {
  useAdminCountUsers,
  useCountJobRuns,
  useDeleteCounts,
  useRunAutoSubmitNow,
  useSetAutoSubmit,
  type AdminCountUser,
} from '../../api/count.js';
import { Button } from '../../components/Button.js';
import { ConfirmDialog } from '../../components/Dialog.js';
import { DataTable, tableStyles } from '../../components/DataTable.js';
import { DetailHeader } from '../../components/DetailHeader.js';
import { TextField } from '../../components/Field.js';
import { Notice } from '../../components/Notice.js';
import { ErrorState, LoadingState } from '../../components/States.js';
import { useToast } from '../../components/Toast.js';
import { useI18n, type MessageKey } from '../../i18n/index.js';
import { formatBeijingDateTime, formatDateTime } from '../../lib/dates.js';
import styles from './admin.module.css';

export function CountAdminScreen() {
  const { t } = useI18n();
  return (
    <div className={styles.page}>
      <DetailHeader fallback="/count" />
      <h1>{t('countAdmin.title')}</h1>
      <Runs />
      <Users />
    </div>
  );
}

const STATUS: Record<'running' | 'ok' | 'failed', MessageKey> = {
  running: 'countAdmin.status.running',
  ok: 'countAdmin.status.ok',
  failed: 'countAdmin.status.failed',
};

const RESULT: Record<'ok' | 'failed' | 'skipped', MessageKey> = {
  ok: 'countAdmin.ran',
  failed: 'countAdmin.failed',
  skipped: 'countAdmin.skipped',
};

function Runs() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const runs = useCountJobRuns();
  const runNow = useRunAutoSubmitNow();
  return (
    <section className={styles.section} aria-labelledby="runs-heading">
      <div className={styles.sectionHead}>
        <h2 id="runs-heading">{t('countAdmin.runs')}</h2>
        <Button
          variant="primary"
          small
          disabled={runNow.isPending}
          onClick={() =>
            runNow.mutate(undefined, {
              onSuccess: ({ result }) => toast.show(t(RESULT[result])),
              onError: toast.showError,
            })
          }
        >
          {t('countAdmin.runNow')}
        </Button>
      </div>
      {runs.isPending ? (
        <LoadingState />
      ) : runs.isError ? (
        <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
      ) : (
        <>
          {runs.data.needsAttention && (
            <Notice kind="warning">
              {t('countAdmin.attention', {
                time: formatBeijingDateTime(runs.data.lastScheduledAt, lang),
              })}
            </Notice>
          )}
          {runs.data.runs.length === 0 ? (
            <p className={styles.muted}>{t('countAdmin.noRuns')}</p>
          ) : (
            <DataTable caption={t('countAdmin.runs')}>
              <thead>
                <tr>
                  <th scope="col">{t('countAdmin.started')}</th>
                  <th scope="col">{t('users.status')}</th>
                  <th scope="col">{t('countAdmin.result')}</th>
                </tr>
              </thead>
              <tbody>
                {runs.data.runs.map((run) => (
                  <tr key={run.id}>
                    <td>{formatDateTime(run.startedAt, lang)}</td>
                    <td>{t(STATUS[run.status])}</td>
                    <td className={tableStyles.wrapCell}>
                      {run.error ??
                        Object.entries(run.summary ?? {})
                          .map(([key, n]) => `${key}: ${n}`)
                          .join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </>
      )}
    </section>
  );
}

function Users() {
  const { t } = useI18n();
  const users = useAdminCountUsers();
  return (
    <section className={styles.section} aria-labelledby="count-users-heading">
      <h2 id="count-users-heading">{t('countAdmin.users')}</h2>
      {users.isPending ? (
        <LoadingState />
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : (
        <DataTable caption={t('countAdmin.users')}>
          <thead>
            <tr>
              <th scope="col">{t('count.name')}</th>
              <th scope="col">{t('count.auto')}</th>
              <th scope="col" className={tableStyles.num}>
                {t('countAdmin.saved')}
              </th>
              <th scope="col" className={tableStyles.num}>
                {t('count.totalCol')}
              </th>
              <th scope="col" className={tableStyles.num}>
                {t('countAdmin.entries')}
              </th>
              <th scope="col">{t('count.latestAt')}</th>
              <th scope="col">{t('admin.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.data.users.map((user) => (
              <UserRow key={user.userId} user={user} />
            ))}
          </tbody>
        </DataTable>
      )}
    </section>
  );
}

function UserRow({ user }: { user: AdminCountUser }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const setAuto = useSetAutoSubmit(user.userId);
  const remove = useDeleteCounts(user.userId);
  const [deleting, setDeleting] = useState(false);
  const [range, setRange] = useState({ from: '', to: '' });
  const label = user.name === user.username ? user.username : `${user.name} (${user.username})`;
  // Follows the click at once; the server's answer (or a refusal) then settles it.
  const [picked, setPicked] = useState<boolean | null>(null);
  const auto = picked ?? user.autoSubmit;

  return (
    <tr>
      <td>{label}</td>
      <td>
        <input
          type="checkbox"
          className={styles.check}
          aria-label={t('countAdmin.autoFor', { name: user.username })}
          checked={auto}
          disabled={setAuto.isPending}
          onChange={(e) => {
            setPicked(e.target.checked);
            setAuto.mutate(e.target.checked, {
              onError: toast.showError,
              onSettled: () => setPicked(null),
            });
          }}
        />
      </td>
      <td className={tableStyles.num}>{user.savedCount || ''}</td>
      <td className={tableStyles.num}>{user.total.toLocaleString()}</td>
      <td className={tableStyles.num}>{user.entries}</td>
      <td>{user.latestSubmitAt ? formatDateTime(user.latestSubmitAt, lang) : ''}</td>
      <td>
        <Button
          small
          variant="danger"
          disabled={user.entries === 0}
          onClick={() => setDeleting(true)}
        >
          {t('countAdmin.deleteEntries')}
        </Button>
        <ConfirmDialog
          open={deleting}
          title={t('countAdmin.deleteTitle', { name: user.username })}
          onCancel={() => setDeleting(false)}
          actions={
            <>
              <Button onClick={() => setDeleting(false)}>{t('common.cancel')}</Button>
              <Button
                variant="danger"
                disabled={
                  remove.isPending ||
                  (range.from !== '' && range.to !== '' && range.from > range.to)
                }
                onClick={() =>
                  remove.mutate(
                    {
                      ...(range.from ? { from: range.from } : {}),
                      ...(range.to ? { to: range.to } : {}),
                    },
                    {
                      onSuccess: ({ deleted }) => {
                        setDeleting(false);
                        setRange({ from: '', to: '' });
                        toast.show(t('countAdmin.deleted', { n: deleted }));
                      },
                      onError: toast.showError,
                    },
                  )
                }
              >
                {t('countAdmin.deleteEntries')}
              </Button>
            </>
          }
        >
          <p>{t('countAdmin.deleteBody')}</p>
          <div className={styles.names}>
            <TextField
              type="date"
              label={t('countAdmin.from')}
              value={range.from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            />
            <TextField
              type="date"
              label={t('countAdmin.to')}
              value={range.to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            />
          </div>
        </ConfirmDialog>
      </td>
    </tr>
  );
}
