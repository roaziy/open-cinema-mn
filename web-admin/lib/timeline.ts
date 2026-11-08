export type TimelineItem = { id: string; hallId: string; startMin: number; endMin: number };

export type TimelineRange = { fromMin: number; toMin: number };

const HOUR = 60;

/**
 * The visible window of a day: whole hours, at least 10:00-24:00, widened to fit anything that
 * starts earlier or runs later (a late show can end after midnight).
 */
export function rangeFor(items: Pick<TimelineItem, 'startMin' | 'endMin'>[]): TimelineRange {
  let from = 10 * HOUR;
  let to = 24 * HOUR;
  for (const i of items) {
    from = Math.min(from, Math.floor(i.startMin / HOUR) * HOUR);
    to = Math.max(to, Math.ceil(i.endMin / HOUR) * HOUR);
  }
  return { fromMin: Math.max(0, from), toMin: Math.min(30 * HOUR, to) };
}

/** Left offset and width of a block as percentages of the window, clipped to it. */
export function place(
  item: Pick<TimelineItem, 'startMin' | 'endMin'>,
  r: TimelineRange,
): { left: number; width: number } {
  const span = r.toMin - r.fromMin;
  const s = Math.max(item.startMin, r.fromMin);
  const e = Math.min(item.endMin, r.toMin);
  return { left: ((s - r.fromMin) / span) * 100, width: (Math.max(e - s, 0) / span) * 100 };
}

/** Where the "now" line sits in the window, or null when it is outside. */
export function nowOffset(nowMin: number, r: TimelineRange): number | null {
  if (nowMin < r.fromMin || nowMin > r.toMin) return null;
  return ((nowMin - r.fromMin) / (r.toMin - r.fromMin)) * 100;
}

/** Hour tick labels for the window ("10:00", ...), with their offset in percent. */
export function hourTicks(r: TimelineRange): { label: string; left: number }[] {
  const out: { label: string; left: number }[] = [];
  for (let m = r.fromMin; m <= r.toMin; m += HOUR) {
    const h = Math.floor(m / HOUR) % 24;
    out.push({
      label: `${String(h).padStart(2, '0')}:00`,
      left: ((m - r.fromMin) / (r.toMin - r.fromMin)) * 100,
    });
  }
  return out;
}
