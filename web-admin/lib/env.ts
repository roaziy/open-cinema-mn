export const APP_NAME = process.env.APP_NAME ?? 'Open Cinema';

export const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Where the Express API lives, as seen from this server (never exposed to browsers).
 * A function so a missing value fails when a request needs it, not while the build collects pages.
 */
export function apiUrl(): string {
  const value = process.env.API_INTERNAL_URL;
  if (!value) {
    if (IS_PROD) throw new Error('API_INTERNAL_URL is not set');
    return 'http://localhost:4000';
  }
  return value.replace(/\/$/, '');
}
