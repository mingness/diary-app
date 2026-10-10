/**
 * API client — supports dynamic server URL for Android WebView and web browser.
 * In Android: window.__SERVER_URL__ is injected by native code (from Settings).
 * In browser: defaults to '/api' (same-origin proxy).
 */
function getServerBase() {
  // Android injects window.__SERVER_URL__ (e.g. "http://192.168.1.100:3001")
  if (typeof window !== 'undefined' && window.__SERVER_URL__) {
    return window.__SERVER_URL__ + '/api';
  }
  // Browser: use same-origin '/api' (works for local dev and deployed)
  return '/api';
}

function getHeaders(hasBody) {
  const headers = {};
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }
  const token = localStorage.getItem('token');
  // Session password is scoped to the browser session (sessionStorage, cleared on
  // close) — never persisted long-term. Still sent over HTTPS as X-Session-Key
  // because the server derives the user's decryption key from it.
  const sessionPassword = sessionStorage.getItem('sessionPassword');
  if (token) headers.Authorization = `Bearer ${token}`;
  if (sessionPassword) headers['X-Session-Key'] = sessionPassword;
  return headers;
}

const METHODS_WITH_BODY = ['POST', 'PUT', 'PATCH', 'DELETE'];

async function request(path, options = {}) {
  const BASE = getServerBase();
  const method = options.method || 'GET';
  const headers = getHeaders(METHODS_WITH_BODY.includes(method));
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers: { ...headers, ...options.headers },
    });
  } catch (networkErr) {
    const err = new Error('Network error: ' + networkErr.message);
    err.status = 0;
    err.data = {};
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.errorZh || `Request failed (HTTP ${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
  upload: async (file) => {
    const BASE = getServerBase();
    const form = new FormData();
    form.append('image', file);
    const token = localStorage.getItem('token');
    const res = await fetch(`${BASE}/upload`, {
      method: 'POST',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    return res.json();
  },
};

/**
 * Apply font size from Android settings or localStorage.
 * Called on app startup and when font size changes.
 */
export function applyFontSize() {
  const size =
    (typeof window !== 'undefined' && window.__FONT_SIZE__) ||
    localStorage.getItem('fontSize') ||
    14;
  document.documentElement.style.fontSize = `${size}px`;
}

// Apply on load
if (typeof document !== 'undefined') {
  applyFontSize();
}
