import type { TKey } from '@/i18n';

type T = (key: TKey, params?: Record<string, string | number>) => string;

export function formatDuration(min: number, t: T): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? t('duration.hm', { h, m }) : t('duration.m', { m });
}

/** Weekday index (0 = Sunday) of a YYYY-MM-DD calendar date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "11/20" style day-month for a YYYY-MM-DD date. */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(m)}/${Number(d)}`;
}
