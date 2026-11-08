import { ubDate } from '@open-cinema/shared';
import type { Locale, TKey } from '@/i18n';

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

/** Day and month of a YYYY-MM-DD date: "11-р сарын 20" (mn), "Nov 20" (en). */
export function formatMonthDay(date: string, locale: Locale): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  if (locale === 'mn') return `${m}-р сарын ${d}`;
  const month = new Date(Date.UTC(2000, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
  return `${month} ${d}`;
}

/** The next `count` Ulaanbaatar calendar days, today first. */
export function nextUbDays(count = 7, now: Date = new Date()): string[] {
  return Array.from({ length: count }, (_, i) => ubDate(new Date(now.getTime() + i * 86_400_000)));
}
