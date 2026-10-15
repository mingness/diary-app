/**
 * 注意 (spec §6.5.5, FRONTEND.md §4.8): accounts flagged by the activity rules, newest first, with the quick
 * responses (sign out everywhere, lock, mark handled), and the per-user activity summary below so spikes stand
 * out. Metadata only: who, which rule, when.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import {
  useActivitySummary,
  useAlerts,
  useAlertStatus,
  useMarkHandled,
  useUserAction,
  type Alert,
} from '../../api/admin.js';
import { Button } from '../../components/Button.js';
import { Chip } from '../../components/Chip.js';
import { ConfirmButton } from '../../components/ConfirmButton.js';
import { DataTable, tableStyles } from '../../components/DataTable.js';
import { SegmentedControl } from '../../components/Field.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/States.js';
import { useToast } from '../../components/Toast.js';
import { useI18n, type MessageKey } from '../../i18n/index.js';
import { formatDateTime } from '../../lib/dates.js';
import { formatBytes } from '../../lib/images.js';
import { roleKey, ruleKey } from './labels.js';
import styles from './admin.module.css';

type Show = 'open' | 'handled' | 'all';

export function AttentionScreen() {
  const { t, lang } = useI18n();
  const [show, setShow] = useState<Show>('open');
  const alerts = useAlerts(show);
  const status = useAlertStatus().data;

  const email = status?.email;
  const emailLine = !email
    ? ''
    : !email.configured
      ? t('attention.emailOff')
      : [
          t('attention.emailOn', { n: email.recipients }),
          email.lastSentAt &&
            t('attention.lastSent', { time: formatDateTime(email.lastSentAt, lang) }),
          email.failing > 0 && t('attention.failing', { n: email.failing }),
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <div className={styles.page}>
      <h1>{t('attention.title')}</h1>
      {emailLine && <p className={styles.muted}>{emailLine}</p>}
      <SegmentedControl<Show>
        legend={t('attention.show')}
        name="alerts"
        value={show}
        onChange={setShow}
        options={[
          { value: 'open', label: t('attention.open') },
          { value: 'handled', label: t('attention.handled') },
          { value: 'all', label: t('attention.all') },
        ]}
      />
      {alerts.isPending ? (
        <LoadingState />
      ) : alerts.isError ? (
        <ErrorState error={alerts.error} onRetry={() => void alerts.refetch()} />
      ) : alerts.data.alerts.length === 0 ? (
        <EmptyState title={t('attention.empty')} />
      ) : (
        <ul className={styles.cards}>
          {alerts.data.alerts.map((alert) => (
            <AlertCard key={alert.id} alert={alert} />
          ))}
        </ul>
      )}
      <Summary />
    </div>
  );
}

const EMAIL_CHIP: Partial<Record<Alert['email'], MessageKey>> = {
  pending: 'attention.email.pending',
  sent: 'attention.email.sent',
  failing: 'attention.email.failing',
  gave_up: 'attention.email.gave_up',
};

function AlertCard({ alert }: { alert: Alert }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const handled = useMarkHandled();
  const act = useUserAction(alert.userId ?? '');
  const emailChip = EMAIL_CHIP[alert.email];
  const name = alert.username;
  const run = (action: 'sign-out-all' | 'lock', done: MessageKey) =>
    act.mutate(action, { onSuccess: () => toast.show(t(done)), onError: toast.showError });

  return (
    <li className={`${styles.card} ${alert.handledAt ? styles.cardHandled : ''}`}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{name}</span>
        <span>{t(ruleKey(alert.rule))}</span>
        <span className={styles.muted}>{formatDateTime(alert.createdAt, lang)}</span>
        {emailChip && <Chip tone={alert.email === 'sent' ? 'green' : 'amber'}>{t(emailChip)}</Chip>}
      </div>
      {alert.handledAt ? (
        <p className={styles.muted}>
          {t('attention.handledAt', { time: formatDateTime(alert.handledAt, lang) })}
        </p>
      ) : (
        <div className={styles.actions}>
          {alert.userId && (
            <Link className={styles.link} to={`/admin/activity?user=${alert.userId}`}>
              {t('attention.viewActivity')}
            </Link>
          )}
          {alert.userId && (
            <>
              <ConfirmButton
                small
                danger={false}
                label={t('attention.signOutAll')}
                title={t('attention.signOutTitle', { name })}
                body={t('attention.signOutBody')}
                disabled={act.isPending}
                onConfirm={() => run('sign-out-all', 'attention.signedOut')}
              />
              <ConfirmButton
                small
                label={t('attention.lock')}
                title={t('attention.lockTitle', { name })}
                body={t('attention.lockBody')}
                disabled={act.isPending}
                onConfirm={() => run('lock', 'attention.locked')}
              />
            </>
          )}
          <Button
            small
            variant="primary"
            disabled={handled.isPending}
            onClick={() => handled.mutate(alert.id, { onError: toast.showError })}
          >
            {t('attention.markHandled')}
          </Button>
        </div>
      )}
    </li>
  );
}

type Sort = 'today' | 'week' | 'storage';

/** Per-user totals for today and the last 7 days, sortable, so a busy account stands out. */
function Summary() {
  const t = useI18n().t;
  const [sort, setSort] = useState<Sort>('today');
  const summary = useActivitySummary(sort);
  const period = sort === 'week' ? 'week' : 'today';
  return (
    // A plain block: its table is already the labelled region, and two landmarks shouldn't share a name.
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>{t('summary.title')}</h2>
      </div>
      <SegmentedControl<Sort>
        legend={t('summary.sort')}
        name="summarySort"
        value={sort}
        onChange={setSort}
        options={[
          { value: 'today', label: t('summary.today') },
          { value: 'week', label: t('summary.week') },
          { value: 'storage', label: t('summary.storage') },
        ]}
      />
      {summary.isPending ? (
        <LoadingState />
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        <DataTable caption={t('summary.title')}>
          <thead>
            <tr>
              <th scope="col">{t('summary.user')}</th>
              <th scope="col">{t('users.role')}</th>
              <th scope="col" className={tableStyles.num}>
                {t('summary.entries')}
              </th>
              <th scope="col" className={tableStyles.num}>
                {t('summary.submissions')}
              </th>
              <th scope="col" className={tableStyles.num}>
                {t('summary.updates')}
              </th>
              <th scope="col" className={tableStyles.num}>
                {t('summary.counts')}
              </th>
              <th scope="col" className={tableStyles.num}>
                {t('summary.storage')}
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.data.rows.map((row) => {
              const tally = row[period];
              return (
                <tr key={row.userId}>
                  <td>
                    <Link to={`/admin/activity?user=${row.userId}`}>{row.username}</Link>
                  </td>
                  <td>{t(roleKey(row.role))}</td>
                  <td className={tableStyles.num}>{tally.entries}</td>
                  <td className={tableStyles.num}>{tally.submissions}</td>
                  <td className={tableStyles.num}>{tally.updates}</td>
                  <td className={tableStyles.num}>{tally.countEntries}</td>
                  <td className={tableStyles.num}>{formatBytes(row.storageBytes)}</td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
      <p className={styles.muted}>
        {t(sort === 'week' ? 'summary.week' : 'summary.today')} · {t('activity.hint')}
      </p>
    </div>
  );
}
