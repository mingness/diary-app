import type { ButtonHTMLAttributes } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Full width on phones; the screen's one obvious action. */
  wide?: boolean;
  /** Low and quiet, for secondary tools (formatting, translate, stepping). */
  small?: boolean;
}

export function Button({
  variant = 'secondary',
  wide = false,
  small = false,
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.button,
    styles[variant],
    wide && styles.wide,
    small && styles.small,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} {...rest} />;
}

/** The same look on a link, for navigation that should read as a button. */
export function buttonClass(
  variant: Variant,
  { wide = false, small = false }: { wide?: boolean; small?: boolean } = {},
): string {
  return [styles.button, styles[variant], wide && styles.wide, small && styles.small]
    .filter(Boolean)
    .join(' ');
}
