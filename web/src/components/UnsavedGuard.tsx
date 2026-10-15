/**
 * One guard per page against losing unsaved comments (spec §5.2: content never lost). A page may show several
 * comment editors (the continuous reading feed), but the router allows one blocker at a time, so editors
 * register here and the page decides which navigations would unmount them.
 */
import { createContext, useContext, useEffect, useId, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useBlocker, type Location } from 'react-router';
import { useT } from '../i18n/index.js';
import { Button } from './Button.js';
import { ConfirmDialog } from './Dialog.js';

export interface GuardedEditor {
  dirty: boolean;
  /** Whether "save and leave" may save it as a draft (not for a submitted comment: that would retract it). */
  canSaveDraft: boolean;
  saveDraft: () => Promise<boolean>;
}

type Registry = Map<string, GuardedEditor>;
const GuardContext = createContext<Registry | null>(null);

/** Registers an editor with the page's guard while it's mounted; does nothing outside a guard. */
export function useGuardedEditor(editor: GuardedEditor): void {
  const registry = useContext(GuardContext);
  const id = useId();
  useEffect(() => {
    registry?.set(id, editor);
  });
  useEffect(() => () => void registry?.delete(id), [registry, id]);
}

/** Navigations that keep the address but change these parameters are treated as leaving. */
export function changes(...keys: string[]) {
  return (current: Location, next: Location) => {
    if (current.pathname !== next.pathname) return true;
    const a = new URLSearchParams(current.search);
    const b = new URLSearchParams(next.search);
    return keys.some((key) => a.get(key) !== b.get(key));
  };
}

export function UnsavedGuard({
  leaves,
  children,
}: {
  /** Whether a navigation unmounts the page's editors. */
  leaves: (current: Location, next: Location) => boolean;
  children: ReactNode;
}) {
  const t = useT();
  const registry = useMemo<Registry>(() => new Map(), []);
  const leavesRef = useRef(leaves);
  useEffect(() => {
    leavesRef.current = leaves;
  });

  const dirtyEditors = () => [...registry.values()].filter((e) => e.dirty);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyEditors().length > 0 && leavesRef.current(currentLocation, nextLocation),
  );

  const dirty = blocker.state === 'blocked' ? dirtyEditors() : [];
  const canSave = dirty.length > 0 && dirty.every((e) => e.canSaveDraft);

  return (
    <GuardContext.Provider value={registry}>
      {children}
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title={t('leave.title')}
        onCancel={() => blocker.reset?.()}
        actions={
          <>
            <Button variant="quiet" onClick={() => blocker.reset?.()}>
              {t('leave.stay')}
            </Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              {t('leave.discard')}
            </Button>
            {canSave && (
              <Button
                variant="primary"
                onClick={() =>
                  void Promise.all(dirty.map((e) => e.saveDraft())).then((saved) =>
                    saved.every(Boolean) ? blocker.proceed?.() : blocker.reset?.(),
                  )
                }
              >
                {t('leave.save')}
              </Button>
            )}
          </>
        }
      >
        <p>{t('leave.body')}</p>
      </ConfirmDialog>
    </GuardContext.Provider>
  );
}
