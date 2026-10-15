/**
 * The editor's font and size choices against the server's real sanitiser: a value its allowlist doesn't match
 * is silently dropped on save (125% once was), so every choice must come back unchanged.
 */
import { describe, expect, it } from 'vitest';
import { sanitizeBody } from '../../server/src/domain/diary/sanitize.js';
import { FONTS, SIZES } from '../src/screens/diary/schema.js';

describe('toolbar choices survive the server sanitiser', () => {
  it.each(Object.entries(FONTS))('font %s', (_key, value) => {
    // As the browser writes it: quotes inside the attribute are escaped.
    const escaped = value.replace(/"/g, '&quot;');
    const html = `<p><span style="font-family:${escaped}">念</span></p>`;
    expect(sanitizeBody(html)).toContain(`font-family:${escaped}`);
  });

  it.each(Object.entries(SIZES))('size %s', (_key, value) => {
    expect(sanitizeBody(`<p><span style="font-size:${value}">念</span></p>`)).toContain(
      `font-size:${value}`,
    );
  });
});
