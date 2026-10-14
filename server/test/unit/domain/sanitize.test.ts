/**
 * The sanitiser is the defence against stored script injection in shared entries, so it's tested against
 * real attack shapes, not just happy paths.
 */
import { describe, expect, it } from 'vitest';
import { inspectBody, sanitizeBody } from '../../../src/domain/diary/sanitize.js';

const png = (bytes: number) => {
  // Valid base64 of exactly `bytes` decoded bytes.
  const b64 = Buffer.alloc(bytes, 7).toString('base64');
  return `data:image/png;base64,${b64}`;
};

describe('sanitizeBody keeps what the editor produces', () => {
  it.each([
    '<p>念佛一小時</p>',
    '<h1>標題</h1><h2>二</h2><h3>三</h3>',
    '<p><b>bold</b> <strong>strong</strong> <u>under</u></p>',
    '<p><span style="font-family:\'Noto Serif TC\', serif">明體</span></p>',
    '<p><span style="font-size:20px">大</span></p>',
    '<p>line<br />break</p>',
    `<p><img src="${png(10)}" alt="photo" /></p>`,
  ])('%s', (html) => {
    const once = sanitizeBody(html);
    expect(sanitizeBody(once)).toBe(once); // idempotent
    expect(once).not.toBe('');
  });

  it('leaves editor output exactly as it was', () => {
    const html = '<p>念佛<b>一小時</b>，<u>心</u>安。</p><h2>心得</h2>';
    expect(sanitizeBody(html)).toBe(html);
  });
});

describe('sanitizeBody removes everything dangerous', () => {
  it.each([
    ['script tag', '<p>hi</p><script>alert(1)</script>', 'alert'],
    ['event handler', '<p onclick="alert(1)">hi</p>', 'onclick'],
    ['img onerror', `<img src="${png(4)}" onerror="alert(1)">`, 'onerror'],
    ['javascript: image', '<img src="javascript:alert(1)">', 'javascript'],
    ['remote image (tracking pixel)', '<img src="https://evil.example/p.png">', 'evil'],
    ['SVG image, which can carry scripts', '<img src="data:image/svg+xml;base64,PHN2Zz4=">', 'svg'],
    ['links', '<a href="https://evil.example">click</a>', 'href'],
    ['iframe', '<iframe src="https://evil.example"></iframe>', 'iframe'],
    ['style with url()', '<span style="font-family:url(https://evil.example)">x</span>', 'url('],
    ['style on a paragraph', '<p style="position:fixed;top:0">x</p>', 'position'],
    ['style injection via ;', '<span style="font-size:12px;background:red">x</span>', 'background'],
    ['inline SVG', '<svg><script>alert(1)</script></svg>', 'script'],
    ['style element', '<style>body{display:none}</style><p>x</p>', 'display'],
    ['form', '<form action="/api/x"><input name="a"></form>', 'form'],
  ])('%s', (_label, html, forbidden) => {
    expect(sanitizeBody(html).toLowerCase()).not.toContain(forbidden);
  });

  it('keeps the text of removed formatting tags, but not the content of scripts', () => {
    expect(sanitizeBody('<div><i>italic</i></div>')).toBe('italic');
    expect(sanitizeBody('<script>evil()</script>ok')).toBe('ok');
  });
});

describe('inspectBody measures what the limits need', () => {
  it('counts visible characters without whitespace, one per Chinese character', () => {
    const { visibleChars } = inspectBody('<p>念佛 一小時</p>\n<p>  A b  </p>');
    expect(visibleChars).toBe(5 + 2);
  });

  it('counts entities as the characters they show', () => {
    expect(inspectBody('<p>a &amp; b &lt; c</p>').visibleChars).toBe(5);
  });

  it('does not count markup or image data as text', () => {
    expect(inspectBody(`<p><b>ab</b><img src="${png(3000)}"></p>`).visibleChars).toBe(2);
  });

  it('reports each image’s decoded size, and ignores images that were removed', () => {
    const { imageBytes } = inspectBody(
      `<img src="${png(1000)}"><img src="${png(2)}"><img src="https://x.example/a.png">`,
    );
    expect(imageBytes).toEqual([1000, 2]);
  });

  it('measures the sanitised HTML, not the raw input', () => {
    const raw = `<p>x</p><script>${'a'.repeat(10_000)}</script>`;
    expect(inspectBody(raw).bodyBytes).toBe(Buffer.byteLength('<p>x</p>'));
  });
});
