import { ubDate } from '@open-cinema/shared';

/** Thin space (U+2009): groups thousands without a comma. */
const GROUP = String.fromCharCode(0x2009);

/** Integer MNT with thin grouping, e.g. 25000 -> "25 000₮". */
export function mnt(amount: number): string {
  const n = Math.round(amount);
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
  return `${n < 0 ? '−' : ''}${digits}₮`;
}

/** Plain count with the same grouping as money. */
export function count(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
}

/** 0..1 -> "72%". */
export function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

const UB_OFFSET_MS = 8 * 3_600_000;

export function todayUb(now: Date = new Date()): string {
  return ubDate(now);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** UTC instant (ISO) of a Ulaanbaatar wall-clock date and "HH:mm". */
export function ubInstant(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - UB_OFFSET_MS).toISOString();
}

/** Minutes since the Ulaanbaatar midnight of `date` (may be negative or above 1440). */
export function minutesIntoDay(date: string, instant: Date | string): number {
  const t = typeof instant === 'string' ? new Date(instant) : instant;
  return Math.round((t.getTime() - new Date(ubInstant(date, '00:00')).getTime()) / 60_000);
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

/** Change against a baseline as a rounded percent, or null when there is nothing to compare. */
export function deltaPct(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

export function isDate(v: string | undefined): v is string {
  return (
    !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())
  );
}
