export { HUES, type HueKey, hueFor } from '@/lib/shared';

export function initials(name: string | null | undefined, fallback = '?'): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  const first = parts[0] as string;
  const second = parts[1];
  return ([...first][0] + (second ? [...second][0] : '')).toLocaleUpperCase('mn');
}
