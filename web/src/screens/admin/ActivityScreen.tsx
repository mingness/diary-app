/**
 * 活動記錄 (spec §6.5.5): one user's events (from a flag or the summary), or everyone's, newest first. Times and
 * events only, never what was written; the user it describes never sees it.
 */
import { useSearchParams } from 'react-router';
import { ActivityKind } from '@diary/shared';
import { useActivity, useAdminUser } from '../../api/admin.js';
import { DataTable } from '../../components/DataTable.js';
import { DetailHeader } from '../../components/DetailHeader.js';
import { Pagination } from '../../components/Pagination.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/States.js';
import { useI18n } from '../../i18n/index.js';
import { formatDateTime } from '../../lib/dates.js';
import { describeDetail, kindKey } from './labels.js';
import styles from './admin.module.css';

const SIZE = 50;

export function ActivityScreen() {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const userId = params.get('user');
  const kindParam = params.get('kind');
  const kind = ActivityKind.safeParse(kindParam).success ? (kindParam ?? undefined) : undefined;
  const page = Math.max(1, Math.trunc(Number(params.get('page'))) || 1);
  const size = Math.min(200, Math.max(1, Math.trunc(Number(params.get('size'))) || SIZE));
  const user = useAdminUser(userId).data;
  const activity = useActivity({
    ...(userId ? { userId } : {}),
    ...(kind ? { kind } : {}),
    page,
    size,
  });

  const set = (next: Record<string, string | undefined>) => {
    const values = Object.fromEntries(
      Object.entries({
        user: userId ?? undefined,
        kind,
        page: '1',
        size: String(size),
        ...next,
      }).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    setParams(values, { replace: true });
  };

  return (
    <div className={styles.page}>
      <DetailHeader fallback="/admin/attention" />
      <h1>{user ? t('activity.titleFor', { name: user.username }) : t('activity.title')}</h1>
      <p className={styles.muted}>{t('activity.hint')}</p>
      <div className={styles.filters}>
        <label className={styles.label}>
          {t('activity.kind')}
          <select
            className={styles.select}
            value={kind ?? ''}
            onChange={(e) => set({ kind: e.target.value || undefined })}
          >
            <option value="">{t('activity.allKinds')}</option>
            {ActivityKind.options.map((k) => (
              <option key={k} value={k}>
                {t(kindKey(k))}
              </option>
            ))}
          </select>
        </label>
      </div>
      {activity.isPending ? (
        <LoadingState />
      ) : activity.isError ? (
        <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
      ) : activity.data.events.length === 0 ? (
        <EmptyState title={t('activity.empty')} />
      ) : (
        <DataTable caption={t('activity.title')}>
          <thead>
            <tr>
              <th scope="col">{t('activity.time')}</th>
              {!userId && <th scope="col">{t('summary.user')}</th>}
              <th scope="col">{t('activity.kind')}</th>
              <th scope="col">{t('activity.detail')}</th>
            </tr>
          </thead>
          <tbody>
            {activity.data.events.map((event) => (
              <tr key={event.id}>
                <td>{formatDateTime(event.createdAt, lang)}</td>
                {!userId && <td>{event.username}</td>}
                <td>{t(kindKey(event.kind))}</td>
                <td>{describeDetail(event.detail, t)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {activity.data && activity.data.total > 0 && (
        <Pagination
          page={page}
          size={size}
          total={activity.data.total}
          onPage={(p) => set({ page: String(p) })}
          onSize={(s) => set({ size: String(s) })}
        />
      )}
    </div>
  );
}
