const BASE = 'http://n';

/** C0 controls and DEL: browsers silently drop some of them from URLs, which smuggles hosts. */
export function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Only same-site paths survive; anything else falls back. Control characters (a tab or newline
 * makes browsers drop them and read `/\t/evil.example` as `//evil.example`), backslashes and
 * encoded forms of them are refused outright, then the value must still resolve to our own origin.
 */
export function safeNext(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return fallback;
  if (
    hasControlChars(value) ||
    value.includes(String.fromCharCode(92)) ||
    /%(?:[01][0-9a-f]|7f|5c)/i.test(value)
  ) {
    return fallback;
  }
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

export function loginPathFor(path: string): string {
  return path === '/staff' || path.startsWith('/staff/') ? '/staff/login' : '/login';
}

export function homeFor(role: string | undefined): string | null {
  if (role === 'admin') return '/admin';
  if (role === 'staff') return '/staff';
  return null;
}
