import DOMPurify from 'dompurify';

/**
 * Sanitize untrusted HTML (diary content, comments) before rendering.
 * Strips scripts, event handlers, javascript: URLs — keeps basic formatting.
 */
export function sanitizeHtml(html) {
  if (html == null) return '';
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'del', 'ins',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
      'a', 'img', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'hr', 'sub', 'sup',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'target', 'rel', 'width', 'height'],
    ALLOW_DATA_ATTR: false,
  });
}
