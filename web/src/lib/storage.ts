/**
 * Per-device preferences in localStorage. Storage can be missing or throw (private windows, blocked site
 * data), so every access is guarded and the app works without it.
 */
const PREFIX = 'diary.';

export function readPref(name: string): string | null {
  try {
    return localStorage.getItem(PREFIX + name);
  } catch {
    return null;
  }
}

export function writePref(name: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + name, value);
  } catch {
    // Not saved; the default applies next time.
  }
}
