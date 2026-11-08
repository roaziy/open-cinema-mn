import { AdminShowtimeListQuery, ubDate, ubDayRange } from '@open-cinema/shared';

/** Plain count grouped like money (`1,200`), so numbers on one screen read alike. */
export function count(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Axis-friendly short number: 1500000 -> "1.5M", 25000 -> "25K". */
export function compact(v: number): string {
  if (v >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${+(v / 1000).toFixed(0)}K`;
  return String(v);
}

/** 0..1 -> "72%". */
export function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function todayUb(now: Date = new Date()): string {
  return ubDate(now);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** UTC instant (ISO) of a Ulaanbaatar wall-clock date and "HH:mm". */
export function ubInstant(date: string, time: string): string {
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return new Date(ubDayRange(date).start.getTime() + (hh * 60 + mm) * 60_000).toISOString();
}

/** Minutes since the Ulaanbaatar midnight of `date` (may be negative or above 1440). */
export function minutesIntoDay(date: string, instant: Date | string): number {
  const t = typeof instant === 'string' ? new Date(instant) : instant;
  return Math.round((t.getTime() - ubDayRange(date).start.getTime()) / 60_000);
}

const WEEKDAYS = ['Ням', 'Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба'];

export function weekdayMn(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] as string;
}

/** "11-р сарын 8" */
export function dayMonth(date: string): string {
  const [, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${m}-р сарын ${d}`;
}

/**
 * Which day a time on a list belongs to: nothing for today, "Маргааш" for tomorrow, otherwise a
 * short date ("11-14"), so a showing on another day is never read as a time today.
 */
export function dayPrefix(startsAt: string, today: string): string {
  const day = ubDate(startsAt);
  if (day === today) return '';
  if (day === addDays(today, 1)) return 'Маргааш';
  return day.slice(5);
}

/** Change against a baseline as a rounded percent, or null when there is nothing to compare. */
export function deltaPct(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

const DateField = AdminShowtimeListQuery.shape.from.unwrap();

/** A real calendar date (YYYY-MM-DD). Overflow such as 2026-02-30 is rejected. */
export function isDate(v: string | undefined): v is string {
  return v !== undefined && DateField.safeParse(v).success;
}
