/**
 * 用戶 (spec §6.5.1, §6.5.4, FRONTEND.md §4.8): search with ? and *, filter by role, and 等待重設 for accounts
 * waiting for a new password (answered right on their row). Students can be deleted several at a time; any
 * account one at a time, after a confirmation, except your own.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Role } from '@diary/shared';
import {
  useAdminUsers,
  useBatchDelete,
  useUserAction,
  useWaitingResets,
  type AdminUser,
} from '../../api/admin.js';
import { useMe } from '../../api/session.js';
import { buttonClass } from '../../components/Button.js';
import { Chip } from '../../components/Chip.js';
import { ConfirmButton } from '../../components/ConfirmButton.js';
import { DataTable, tableStyles } from '../../components/DataTable.js';
import { SegmentedControl, TextField } from '../../components/Field.js';
import { Icon } from '../../components/Icon.js';
import { Pagination } from '../../components/Pagination.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/States.js';
import { useToast } from '../../components/Toast.js';
import { useI18n } from '../../i18n/index.js';
import { formatDiaryDate } from '../../lib/dates.js';
import { formatBytes } from '../../lib/images.js';
import { roleKey } from './labels.js';
import { SetPasswordButton } from './NewPassword.js';
import styles from './admin.module.css';

type StatusFilter = 'all' | 'reset_pending';

export function UsersScreen() {
  const { t } = useI18n();
  const toast = useToast();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const roleParam = params.get('role');
  const role = Role.safeParse(roleParam).success ? (roleParam as AdminUser['role']) : undefined;
  const status: StatusFilter = params.get('status') === 'reset_pending' ? 'reset_pending' : 'all';
  const page = Math.max(1, Math.trunc(Number(params.get('page'))) || 1);
  const size = Math.min(100, Math.max(1, Math.trunc(Number(params.get('size'))) || 20));

  const users = useAdminUsers({
    ...(q ? { q } : {}),
    ...(role ? { role } : {}),
    ...(status === 'reset_pending' ? { status } : {}),
    page,
    size,
  });
  const waiting = useWaitingResets(true).data;
  const batchDelete = useBatchDelete();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const set = (next: Record<string, string | undefined>) => {
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries({
      q: q || undefined,
      role,
      status: status === 'all' ? undefined : status,
      page: '1',
      size: String(size),
      ...next,
    })) {
      if (value !== undefined && value !== '') values[key] = value;
    }
    setParams(values, { replace: true });
    setSelected(new Set());
  };

  // The search follows typing, a moment after the last key.
  const [search, setSearch] = useState(q);
  useEffect(() => {
    if (search === q) return;
    const timer = window.setTimeout(() => set({ q: search || undefined }), 300);
    return () => window.clearTimeout(timer);
  });

  const deletable = (user: AdminUser) => user.role === 'NORMAL_USER' && user.id !== me.id;
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={styles.page}>
      <div className={styles.sectionHead}>
        <h1>{t('users.title')}</h1>
        <Link to="/admin/users/new" className={buttonClass('primary')}>
          <Icon name="user" />
          {t('users.new')}
        </Link>
      </div>
      <div className={styles.filters}>
        <div className={styles.grow}>
          <TextField
            type="search"
            label={t('users.search')}
            hint={t('users.searchHint')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className={styles.label}>
          {t('users.role')}
          <select
            className={styles.select}
            value={role ?? ''}
            onChange={(e) => set({ role: e.target.value || undefined })}
          >
            <option value="">{t('users.allRoles')}</option>
            {Role.options.map((r) => (
              <option key={r} value={r}>
                {t(roleKey(r))}
              </option>
            ))}
          </select>
        </label>
      </div>
      <SegmentedControl<StatusFilter>
        legend={t('users.status')}
        name="status"
        value={status}
        onChange={(s) => set({ status: s === 'all' ? undefined : s })}
        options={[
          { value: 'all', label: t('users.everyone') },
          { value: 'reset_pending', label: t('users.waiting', { n: waiting ?? '…' }) },
        ]}
      />

      {selected.size > 0 && (
        <div className={styles.bar}>
          <span>{t('users.selected', { n: selected.size })}</span>
          <ConfirmButton
            small
            label={t('users.deleteSelected')}
            title={t('users.deleteSelectedTitle', { n: selected.size })}
            body={t('users.deleteBody')}
            disabled={batchDelete.isPending}
            onConfirm={() =>
              batchDelete.mutate([...selected], {
                onSuccess: ({ deleted, skipped }) => {
                  setSelected(new Set());
                  toast.show(
                    [
                      t('users.deleted', { n: deleted.length }),
                      skipped.length > 0 && t('users.skipped', { n: skipped.length }),
                    ]
                      .filter(Boolean)
                      .join(' '),
                  );
                },
                onError: toast.showError,
              })
            }
          />
        </div>
      )}

      {users.isPending ? (
        <LoadingState />
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : users.data.users.length === 0 ? (
        <EmptyState title={t('users.empty')} />
      ) : (
        <DataTable caption={t('users.title')}>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">{t('users.selected', { n: '' })}</span>
              </th>
              <th scope="col">{t('userForm.username')}</th>
              <th scope="col">{t('users.name')}</th>
              <th scope="col">{t('users.role')}</th>
              <th scope="col">{t('users.status')}</th>
              <th scope="col" className={tableStyles.num}>
                {t('users.storage')}
              </th>
              <th scope="col">{t('users.created')}</th>
              <th scope="col">{t('admin.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.data.users.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                isMe={user.id === me.id}
                selectable={deletable(user)}
                selected={selected.has(user.id)}
                onToggle={() => toggle(user.id)}
              />
            ))}
          </tbody>
        </DataTable>
      )}
      {users.data && users.data.total > 0 && (
        <Pagination
          page={page}
          size={size}
          total={users.data.total}
          onPage={(p) => set({ page: String(p) })}
          onSize={(s) => set({ size: String(s) })}
        />
      )}
    </div>
  );
}

function UserRow({
  user,
  isMe,
  selectable,
  selected,
  onToggle,
}: {
  user: AdminUser;
  isMe: boolean;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const act = useUserAction(user.id);
  const name = user.displayName;
  return (
    <tr>
      <td>
        {selectable && (
          <input
            type="checkbox"
            className={styles.check}
            aria-label={t('users.select', { name: user.username })}
            checked={selected}
            onChange={onToggle}
          />
        )}
      </td>
      <td>{user.username}</td>
      <td>{name === user.username ? '' : name}</td>
      <td>{t(roleKey(user.role))}</td>
      <td>
        <span className={styles.actions}>
          {user.status === 'reset_pending' && <Chip tone="amber">{t('admin.resetPending')}</Chip>}
          {user.totpEnabled && <Chip tone="green">{t('admin.totpOn')}</Chip>}
        </span>
      </td>
      <td className={tableStyles.num}>{formatBytes(user.storageBytes)}</td>
      <td>{formatDiaryDate(user.createdAt.slice(0, 10), lang)}</td>
      <td>
        <span className={styles.actions}>
          {user.status === 'reset_pending' && (
            <SetPasswordButton small userId={user.id} name={user.username} />
          )}
          <Link
            to={`/admin/users/${user.id}`}
            className={buttonClass('secondary', { small: true })}
          >
            {t('users.edit')}
          </Link>
          {!isMe && (
            <ConfirmButton
              small
              label={t('users.delete')}
              title={t('users.deleteTitle', { name: user.username })}
              body={t('userForm.deleteBody')}
              disabled={act.isPending}
              onConfirm={() =>
                act.mutate('delete', {
                  onSuccess: () => toast.show(t('userForm.deletedOne')),
                  onError: toast.showError,
                })
              }
            />
          )}
        </span>
      </td>
    </tr>
  );
}
