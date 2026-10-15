import { useSyncExternalStore } from 'react';

/** Whether a CSS media query matches, kept up to date as the window changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Tablets and up show the review screens' reading pane beside the lists (FRONTEND.md §3, §4.7). */
export const WIDE = '(min-width: 768px)';
