/**
 * Labelled form controls (FRONTEND.md §8): a real <label> for every input, with the hint and the error tied to
 * it through aria-describedby so screen readers read them with the field.
 */
import { useId, useState } from 'react';
import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import { useT } from '../i18n/index.js';
import { Button } from './Button.js';
import { Icon } from './Icon.js';
import styles from './Field.module.css';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
  optional?: boolean;
  ref?: Ref<HTMLInputElement> | undefined;
}

function describedBy(hintId: string, errorId: string, hint?: string, error?: string | null) {
  const ids = [error ? errorId : null, hint ? hintId : null].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

export function TextField({
  label,
  hint,
  error,
  optional,
  ref,
  className,
  ...input
}: TextFieldProps) {
  const id = useId();
  const t = useT();
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {optional && <span className={styles.optional}>（{t('common.optional')}）</span>}
      </label>
      {hint && (
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      )}
      <input
        ref={ref}
        id={id}
        className={className ? `${styles.input} ${className}` : styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(`${id}-hint`, `${id}-error`, hint, error)}
        {...input}
      />
      {error && (
        <span id={`${id}-error`} className={styles.error}>
          {error}
        </span>
      )}
    </div>
  );
}

/** A password input with a show/hide button, so older users can check what they typed. */
export function PasswordField({ label, hint, error, ...input }: Omit<TextFieldProps, 'type'>) {
  const id = useId();
  const t = useT();
  const [visible, setVisible] = useState(false);
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {hint && (
        <span id={`${id}-hint`} className={styles.hint}>
          {hint}
        </span>
      )}
      <div className={styles.withButton}>
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          className={styles.input}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(`${id}-hint`, `${id}-error`, hint, error)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          {...input}
        />
        <Button
          variant="quiet"
          aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} />
        </Button>
      </div>
      {error && (
        <span id={`${id}-error`} className={styles.error}>
          {error}
        </span>
      )}
    </div>
  );
}

interface CheckboxRowProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  hint?: string;
}

export function CheckboxRow({ label, hint, ...input }: CheckboxRowProps) {
  return (
    <label className={styles.check}>
      <input type="checkbox" {...input} />
      <span className={styles.checkText}>
        <span>{label}</span>
        {hint && <span className={styles.hint}>{hint}</span>}
      </span>
    </label>
  );
}

interface Option<T extends string | number> {
  value: T;
  label: ReactNode;
}

interface SegmentedControlProps<T extends string | number> {
  legend: string;
  name: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** A row of mutually exclusive choices: radio buttons underneath, so arrow keys and screen readers work. */
export function SegmentedControl<T extends string | number>({
  legend,
  name,
  options,
  value,
  onChange,
  disabled,
}: SegmentedControlProps<T>) {
  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <legend className={styles.label}>{legend}</legend>
      <div className={styles.segments}>
        {options.map((option) => (
          <label key={String(option.value)} className={styles.segment}>
            <input
              type="radio"
              name={name}
              value={String(option.value)}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
