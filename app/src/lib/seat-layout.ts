import type { SeatState } from '@open-cinema/shared';

export type SeatSlot = { seat: SeatState; left: number; top: number };
export type RowSlot = { label: string; top: number };

export type SeatLayout = {
  /** Pixels per metre along x. */
  ppm: number;
  /** Pixel pitch between neighbouring seats. */
  cell: number;
  /** Side length of a drawn seat. */
  size: number;
  /** Vertical distance between rows. */
  rowStep: number;
  /** Seat area, without the row-letter gutters. */
  width: number;
  height: number;
  slots: SeatSlot[];
  rows: RowSlot[];
};

const ROW_RATIO = 1.18;
const GAP_RATIO = 0.14;

/** Smallest positive distance between distinct sorted values (the seat pitch). */
function pitch(values: number[]): number {
  const sorted = [...new Set(values.map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < sorted.length; i++) {
    best = Math.min(best, (sorted[i] as number) - (sorted[i - 1] as number));
  }
  return Number.isFinite(best) && best > 0 ? best : 0.55;
}

/**
 * Lay the hall out for a given pixel width. Columns follow the real x position (so aisles
 * stay aisles); rows are stacked by their order from the screen, evenly, so curved halls
 * still read as straight rows on a phone. Blocked seats keep their slot but are skipped
 * by the renderer, leaving a gap.
 */
export function layoutSeats(seats: SeatState[], availableWidth: number): SeatLayout {
  if (seats.length === 0) {
    return {
      ppm: 0,
      cell: 0,
      size: 0,
      rowStep: 0,
      width: availableWidth,
      height: 0,
      slots: [],
      rows: [],
    };
  }
  const minX = Math.min(...seats.map((s) => s.x_m));
  const maxX = Math.max(...seats.map((s) => s.x_m));
  const pitchX = pitch(seats.map((s) => s.x_m));
  const ppm = availableWidth / (maxX - minX + pitchX);
  const cell = pitchX * ppm;
  const size = Math.max(4, cell * (1 - GAP_RATIO));
  const rowStep = cell * ROW_RATIO;

  const byRow = new Map<string, { sumY: number; n: number }>();
  for (const s of seats) {
    const r = byRow.get(s.rowLabel) ?? { sumY: 0, n: 0 };
    r.sumY += s.y_m;
    r.n++;
    byRow.set(s.rowLabel, r);
  }
  const order = [...byRow.entries()]
    .map(([label, r]) => ({ label, y: r.sumY / r.n }))
    .sort((a, b) => a.y - b.y);
  const rowIndex = new Map(order.map((r, i) => [r.label, i]));

  const slots = seats.map((seat) => ({
    seat,
    left: (seat.x_m - minX) * ppm + (cell - size) / 2,
    top: (rowIndex.get(seat.rowLabel) ?? 0) * rowStep + (rowStep - size) / 2,
  }));
  const rows = order.map((r, i) => ({ label: r.label, top: i * rowStep }));
  return {
    ppm,
    cell,
    size,
    rowStep,
    width: availableWidth,
    height: order.length * rowStep,
    slots,
    rows,
  };
}
