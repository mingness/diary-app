/**
 * Server-side sanitising of diary and comment rich text (spec §5.2, engineering standards §12.4). Shared
 * ("Open") entries are shown to other users, so stored script injection is a real risk: everything outside the
 * editor's own allowlist is removed before storing, and the stored result is what gets displayed.
 *
 * The allowlist matches the editor's Tiptap extensions exactly (docs/ARCHITECTURE.md §8.3), so anything the
 * editor can produce survives unchanged and sanitising is idempotent.
 */
import sanitizeHtml, { type IOptions } from 'sanitize-html';
import { visibleCharCount } from '@diary/shared';

const IMAGE_SRC = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Decoded size of a base64 payload without decoding it. */
function base64Bytes(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return (b64.length * 3) / 4 - padding;
}

const OPTIONS: IOptions = {
  allowedTags: ['p', 'h1', 'h2', 'h3', 'b', 'strong', 'u', 'span', 'img', 'br'],
  allowedAttributes: { span: ['style'], img: ['src', 'alt'] },
  allowedStyles: {
    span: {
      // The editor's three font stacks: names, commas, quotes, spaces and hyphens only (no url(), no ;).
      'font-family': [/^[\p{L}\p{N} ,'"-]{1,100}$/u],
      'font-size': [/^(?:[1-9]\d?(?:\.\d+)?)(?:px|pt|em|rem|%)$/],
    },
  },
  allowedSchemes: [],
  allowedSchemesByTag: { img: ['data'] },
  allowProtocolRelative: false,
  // Images must be inline JPEG/PNG/WebP data; anything else (remote URLs, SVG, which can carry scripts) goes.
  exclusiveFilter: (frame) => frame.tag === 'img' && !IMAGE_SRC.test(frame.attribs.src ?? ''),
};

const TEXT_ONLY: IOptions = { allowedTags: [], allowedAttributes: {} };

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

export interface InspectedBody {
  /** Safe HTML to store and display. */
  readonly html: string;
  /** Characters excluding whitespace, for the 5,000-character limit. */
  readonly visibleChars: number;
  /** Decoded size of each embedded image, in order. */
  readonly imageBytes: readonly number[];
  /** Size of the sanitised HTML in bytes. */
  readonly bodyBytes: number;
}

/** Removes all markup and decodes the entities sanitize-html writes, leaving the text. */
function textOf(html: string): string {
  return sanitizeHtml(html, TEXT_ONLY).replace(
    /&(amp|lt|gt|quot|#39|nbsp);/g,
    (e) => ENTITIES[e] ?? e,
  );
}

/**
 * The text of a sanitised body, with one line per paragraph, heading or line break, and nothing else: no
 * markup, no images. This is all that is sent for translation (spec §8).
 */
export function toPlainText(html: string): string {
  const marked = sanitizeBody(html)
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/(p|h1|h2|h3)>/g, '\n');
  return textOf(marked)
    .split('\n')
    .map((line) => line.trim())
    .filter((line, i, lines) => line !== '' || (i > 0 && lines[i - 1] !== ''))
    .join('\n')
    .trim();
}

export function sanitizeBody(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}

/** Sanitises and measures a body in one go: what limits and storage need to know. */
export function inspectBody(raw: string): InspectedBody {
  const html = sanitizeBody(raw);
  const imageBytes: number[] = [];
  sanitizeHtml(html, {
    allowedTags: ['img'],
    allowedAttributes: { img: ['src'] },
    allowedSchemesByTag: { img: ['data'] },
    exclusiveFilter: (frame) => {
      const match = frame.tag === 'img' ? IMAGE_SRC.exec(frame.attribs.src ?? '') : null;
      if (match?.[2]) imageBytes.push(base64Bytes(match[2]));
      return false;
    },
  });
  return {
    html,
    visibleChars: visibleCharCount(textOf(html)),
    imageBytes,
    bodyBytes: Buffer.byteLength(html, 'utf8'),
  };
}
