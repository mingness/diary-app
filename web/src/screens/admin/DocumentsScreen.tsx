/**
 * 日記管理 (spec §6.5.2): find entries by username and/or date and delete them. Metadata only (title, date,
 * author, state): the server never sends this role any content or comments.
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useAdminDocuments, useDeleteDocument, type AdminDocument } from '../../api/admin.js';
import { Button } from '../../components/Button.js';
import { ConfirmButton } from '../../components/ConfirmButton.js';
import { DataTable } from '../../components/DataTable.js';
import { TextField } from '../../components/Field.js';
import { Pagination } from '../../components/Pagination.js';
import { EmptyState, ErrorState, LoadingState } from '../../components/States.js';
import { useToast } from '../../components/Toast.js';
import { useI18n } from '../../i18n/index.js';
import { formatDiaryDate } from '../../lib/dates.js';
import { AccessChip, StateChip } from '../diary/chips.js';
import styles from './admin.module.css';

export function DocumentsScreen() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const username = params.get('username') ?? '';
  const dateParam = params.get('date') ?? '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : '';
  const page = Math.max(1, Math.trunc(Number(params.get('page'))) || 1);
  const size = Math.min(100, Math.max(1, Math.trunc(Number(params.get('size'))) || 20));
  const documents = useAdminDocuments({
    ...(username ? { username } : {}),
    ...(date ? { date } : {}),
    page,
    size,
  });
  const [draft, setDraft] = useState({ username, date });

  const set = (next: Record<string, string>) => {
    const values = Object.fromEntries(
      Object.entries({ username, date, page: '1', size: String(size), ...next }).filter(
        ([, value]) => value !== '',
      ),
    );
    setParams(values, { replace: true });
  };

  function search(event: FormEvent) {
    event.preventDefault();
    set({ username: draft.username.trim(), date: draft.date });
  }

  return (
    <div className={styles.page}>
      <h1>{t('docs.title')}</h1>
      <p className={styles.muted}>{t('docs.hint')}</p>
      <form className={styles.filters} onSubmit={search} role="search">
        <div className={styles.grow}>
          <TextField
            label={t('docs.username')}
            autoCapitalize="off"
            spellCheck={false}
            value={draft.username}
            onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))}
          />
        </div>
        <div>
          <TextField
            type="date"
            label={t('docs.date')}
            value={draft.date}
            onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
          />
        </div>
        <Button type="submit" variant="primary">
          {t('docs.search')}
        </Button>
      </form>
      {documents.isPending ? (
        <LoadingState />
      ) : documents.isError ? (
        <ErrorState error={documents.error} onRetry={() => void documents.refetch()} />
      ) : documents.data.documents.length === 0 ? (
        <EmptyState title={t('docs.empty')} />
      ) : (
        <DataTable caption={t('docs.title')}>
          <thead>
            <tr>
              <th scope="col">{t('docs.titleCol')}</th>
              <th scope="col">{t('docs.date')}</th>
              <th scope="col">{t('docs.owner')}</th>
              <th scope="col">{t('docs.state')}</th>
              <th scope="col">{t('admin.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {documents.data.documents.map((doc) => (
              <DocumentRow key={doc.id} doc={doc} />
            ))}
          </tbody>
        </DataTable>
      )}
      {documents.data && documents.data.total > 0 && (
        <Pagination
          page={page}
          size={size}
          total={documents.data.total}
          onPage={(p) => set({ page: String(p) })}
          onSize={(s) => set({ size: String(s) })}
        />
      )}
    </div>
  );
}

function DocumentRow({ doc }: { doc: AdminDocument }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const remove = useDeleteDocument();
  const title = doc.title || t('entry.untitled');
  return (
    <tr>
      <td>{title}</td>
      <td>{formatDiaryDate(doc.diaryDate, lang)}</td>
      <td>{doc.ownerUsername}</td>
      <td>
        <span className={styles.actions}>
          <StateChip state={doc.state} />
          <AccessChip access={doc.access} />
        </span>
      </td>
      <td>
        <ConfirmButton
          small
          label={t('users.delete')}
          title={t('docs.deleteTitle', { title })}
          body={t('docs.deleteBody')}
          disabled={remove.isPending}
          onConfirm={() =>
            remove.mutate(doc.id, {
              onSuccess: () => toast.show(t('docs.deleted')),
              onError: toast.showError,
            })
          }
        />
      </td>
    </tr>
  );
}
