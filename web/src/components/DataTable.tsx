import type { ReactNode } from 'react';
import styles from './DataTable.module.css';

/** A table that scrolls sideways in its own box on narrow screens, so the page itself never does. */
export function DataTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    // Focusable so keyboard users can scroll it when it overflows. A group, not a landmark region: the
    // section around it is usually named the same, and two landmarks mustn't share a name.
    <div className={styles.wrap} tabIndex={0} role="group" aria-label={caption}>
      <table className={styles.table}>
        <caption className="visually-hidden">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export const tableStyles = styles;
