/**
 * Text size and theme (FRONTEND.md §2.2, spec §4.4). They are stored per user on the server and cached on
 * the device, so the first paint is already right before `GET /api/me` answers. Everything is sized in rem,
 * so setting the root font size scales the whole UI.
 */
import type { SessionUser } from '@diary/shared';
import { readPref, writePref } from './storage.js';

export type FontSize = SessionUser['fontSize'];
export type Theme = SessionUser['theme'];

export const FONT_SIZES: readonly FontSize[] = [16, 18, 20, 22];
export const THEMES: readonly Theme[] = ['light', 'dark', 'system'];
export const DEFAULT_APPEARANCE: Appearance = { fontSize: 18, theme: 'system' };

export interface Appearance {
  fontSize: FontSize;
  theme: Theme;
}

/** Reads a cached appearance, ignoring anything that isn't a valid value. */
export function parseAppearance(fontSize: string | null, theme: string | null): Appearance {
  const size = Number(fontSize);
  return {
    fontSize: (FONT_SIZES as readonly number[]).includes(size)
      ? (size as FontSize)
      : DEFAULT_APPEARANCE.fontSize,
    theme: (THEMES as readonly string[]).includes(theme ?? '')
      ? (theme as Theme)
      : DEFAULT_APPEARANCE.theme,
  };
}

export function cachedAppearance(): Appearance {
  return parseAppearance(readPref('fontSize'), readPref('theme'));
}

/** Applies the appearance to the page and remembers it on this device. */
export function applyAppearance({ fontSize, theme }: Appearance): void {
  const root = document.documentElement;
  root.style.fontSize = `${fontSize}px`;
  // Without the attribute the CSS follows the device's light/dark preference.
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = theme;
  writePref('fontSize', String(fontSize));
  writePref('theme', theme);
}
