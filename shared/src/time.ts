export const TZ = 'Asia/Ulaanbaatar';

// Ulaanbaatar has been UTC+8 year-round since 2017 (no DST).
const UB_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function parts(d: Date | string): Record<string, string> {
  const date = typeof d === 'string' ? new Date(d) : d;
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** Calendar date (YYYY-MM-DD) of an instant in Ulaanbaatar. */
export function ubDate(d: Date | string): string {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** UTC instants bounding a Ulaanbaatar calendar day: [start, end). */
export function ubDayRange(date: string): { start: Date; end: Date } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const start = new Date(Date.UTC(y, m - 1, d) - UB_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** Wall-clock time (HH:mm) of an instant in Ulaanbaatar. */
export function formatUbTime(d: Date | string): string {
  const p = parts(d);
  return `${p.hour}:${p.minute}`;
}
