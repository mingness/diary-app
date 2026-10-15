/**
 * 開放日記's filters, worked out from one month's list of open entries (no server round trip): the calendar's
 * counts per day, the authors with their counts, and the entries a day and/or author leaves.
 */
import type { OpenDocumentRow } from '../../api/diary.js';

export interface OpenFilter {
  date: string | null;
  user: string | null;
}

export function dayCounts(rows: readonly OpenDocumentRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.diaryDate] = (counts[row.diaryDate] ?? 0) + 1;
  return counts;
}

export interface Author {
  id: string;
  name: string;
  entries: number;
}

/** Everyone with an open entry in the list, most entries first, then by name. */
export function authorsOf(rows: readonly OpenDocumentRow[]): Author[] {
  const byId = new Map<string, Author>();
  for (const row of rows) {
    const found = byId.get(row.author.id);
    if (found) found.entries += 1;
    else {
      byId.set(row.author.id, {
        id: row.author.id,
        name: row.author.name || row.author.username,
        entries: 1,
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name));
}

export function applyFilter(
  rows: readonly OpenDocumentRow[],
  filter: OpenFilter,
): OpenDocumentRow[] {
  return rows.filter(
    (row) =>
      (filter.date === null || row.diaryDate === filter.date) &&
      (filter.user === null || row.author.id === filter.user),
  );
}
