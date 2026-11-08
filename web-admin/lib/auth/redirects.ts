/** Only same-site absolute paths; anything else falls back. Stops open redirects via `next`. */
export function safeNext(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  return value;
}

export function loginPathFor(path: string): string {
  return path === '/staff' || path.startsWith('/staff/') ? '/staff/login' : '/login';
}

export function homeFor(role: string | undefined): string | null {
  if (role === 'admin') return '/admin';
  if (role === 'staff') return '/staff';
  return null;
}
