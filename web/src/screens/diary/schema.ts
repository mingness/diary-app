/**
 * The editor's document model: exactly the server sanitiser's allowlist (ARCHITECTURE §8.3,
 * server/src/domain/diary/sanitize.ts), so whatever the editor writes survives sanitising unchanged, and
 * pasted content is reduced to it. The read-only view uses the same schema, so stored HTML is parsed again
 * in the browser and anything outside the allowlist is dropped there too.
 */
import type { Extensions } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import Bold from '@tiptap/extension-bold';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Heading from '@tiptap/extension-heading';
import Image from '@tiptap/extension-image';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style';
import Underline from '@tiptap/extension-underline';

/**
 * Font choices (FRONTEND.md §2.2). Values must match the sanitiser's pattern: letters, digits, spaces, commas,
 * quotes and hyphens, at most 100 characters. 楷體 falls back to the serif stack where no Kai font exists.
 */
export const FONTS = {
  serif: '"Songti TC", "Noto Serif TC", PMingLiU, serif',
  sans: '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif',
  kai: '"Kaiti TC", BiauKai, "DFKai-SB", 標楷體, serif',
} as const;
export type FontKey = keyof typeof FONTS;

/** Which font choice a stored value is; browsers may rewrite the quoting, so match on the first family. */
export function fontKeyOf(value: string | null | undefined): FontKey | null {
  if (!value) return null;
  const first = value.split(',')[0]?.replace(/["']/g, '').trim();
  const found = (Object.keys(FONTS) as FontKey[]).find(
    (key) => FONTS[key].split(',')[0]?.replace(/["']/g, '').trim() === first,
  );
  return found ?? null;
}

/**
 * Relative sizes, so they grow with the reader's text size. They must match the sanitiser's pattern: a 1–9,
 * at most one more digit, then an optional fraction (so `85%` and `1.25em`, but not `0.85em` or `125%`).
 */
export const SIZES = { small: '85%', large: '1.25em', xlarge: '1.5em' } as const;
export type SizeKey = keyof typeof SIZES | 'normal';

export function sizeKeyOf(value: string | null | undefined): SizeKey {
  const found = (Object.keys(SIZES) as (keyof typeof SIZES)[]).find((key) => SIZES[key] === value);
  return found ?? 'normal';
}

/** The extensions behind both the editor and the read-only view. */
export function contentExtensions(): Extensions {
  return [
    Document,
    Paragraph,
    Text,
    Heading.configure({ levels: [1, 2, 3] }),
    Bold,
    Underline,
    HardBreak,
    TextStyle,
    FontFamily,
    FontSize,
    // Photos are embedded as data: URLs (they never leave the entry), one per block.
    Image.configure({ allowBase64: true, inline: false }),
  ];
}

/** Photos in a document, for the two-per-entry limit. */
export function countImages(doc: PmNode): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name === 'image') count += 1;
  });
  return count;
}
