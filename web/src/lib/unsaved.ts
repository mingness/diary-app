/**
 * Whether any editor on screen holds unsaved writing, for things outside the editors that must wait for it
 * (the "new version" reload, FRONTEND.md §9). Editors report through `useReportUnsaved`.
 */
import { useEffect, useId, useSyncExternalStore } from 'react';

const dirty = new Set<string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** Called by an editor on every render with whether it has unsaved changes. */
export function useReportUnsaved(isDirty: boolean): void {
  const id = useId();
  useEffect(() => {
    if (isDirty === dirty.has(id)) return;
    if (isDirty) dirty.add(id);
    else dirty.delete(id);
    notify();
  }, [id, isDirty]);
  useEffect(
    () => () => {
      if (dirty.delete(id)) notify();
    },
    [id],
  );
}

/** True while any editor has unsaved writing. */
export function useAnyUnsaved(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => dirty.size > 0,
  );
}
