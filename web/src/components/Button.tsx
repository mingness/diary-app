import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Full width on phones; the screen's one obvious action. */
  wide?: boolean;
}

export function Button({
  variant = 'secondary',
  wide = false,
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  const classes = [styles.button, styles[variant], wide && styles.wide, className]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} {...rest} />;
}

/** The same look on a link, for navigation that should read as a button. */
export function buttonClass(variant: Variant, wide = false): string {
  return [styles.button, styles[variant], wide && styles.wide].filter(Boolean).join(' ');
}
