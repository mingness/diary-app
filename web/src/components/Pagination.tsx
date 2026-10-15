/**
 * Numeric page navigation with an adjustable page size (spec §6.1: 20 per page by default, 1–100). Long runs
 * of pages are shortened to the first, the last and the ones around the current page.
 */
import { useState } from 'react';
import { useT } from '../i18n/index.js';
import { Button } from './Button.js';
import styles from './Pagination.module.css';

/** The page numbers to offer, with null for a gap. */
export function pageList(current: number, pages: number): (number | null)[] {
  const wanted = new Set([1, pages, current - 1, current, current + 1]);
  const list: (number | null)[] = [];
  for (let page = 1; page <= pages; page++) {
    if (!wanted.has(page)) continue;
    const last = list[list.length - 1];
    if (typeof last === 'number' && page > last + 1) list.push(null);
    list.push(page);
  }
  return list;
}

interface PaginationProps {
  page: number;
  size: number;
  total: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}

export function Pagination({ page, size, total, onPage, onSize }: PaginationProps) {
  const t = useT();
  const pages = Math.max(1, Math.ceil(total / size));
  const [draft, setDraft] = useState(String(size));

  function commitSize() {
    const value = Math.min(100, Math.max(1, Math.trunc(Number(draft)) || 20));
    setDraft(String(value));
    if (value !== size) onSize(value);
  }

  return (
    <div className={styles.bar}>
      {pages > 1 ? (
        <nav aria-label={t('review.pages')}>
          <ul className={styles.pages}>
            {pageList(page, pages).map((n, i) =>
              n === null ? (
                <li key={`gap${i}`} aria-hidden="true">
                  …
                </li>
              ) : (
                <li key={n}>
                  <Button
                    variant={n === page ? 'secondary' : 'quiet'}
                    className={styles.page}
                    aria-label={t('review.page', { n })}
                    aria-current={n === page ? 'page' : undefined}
                    onClick={() => onPage(n)}
                  >
                    {n}
                  </Button>
                </li>
              ),
            )}
          </ul>
        </nav>
      ) : (
        <span />
      )}
      <label className={styles.size}>
        {t('review.pageSize')}
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitSize}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitSize();
          }}
        />
      </label>
    </div>
  );
}
