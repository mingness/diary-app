import type { ReactNode } from 'react';
import styles from './Chip.module.css';

export type ChipTone = 'neutral' | 'green' | 'amber' | 'blue' | 'primary';

/** A short status label; always text, never colour alone (FRONTEND.md §8). */
export function Chip({
  tone = 'neutral',
  strong = false,
  children,
}: {
  tone?: ChipTone;
  strong?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={[styles.chip, styles[tone], strong && styles.strong].filter(Boolean).join(' ')}
    >
      {children}
    </span>
  );
}
