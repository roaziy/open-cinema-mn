import type { HallGenParams } from '@open-cinema/shared';

type SeatLike = { rowLabel: string; number: number; x_m: number; y_m: number; z_m: number };

export const DEFAULT_GEN: HallGenParams = {
  rows: 8,
  seatsPerRow: 14,
  seatPitchM: 0.55,
  rowSpacingM: 1.0,
  aisleAfter: [7],
  firstRowDistanceM: 3,
  risePerRowM: 0.2,
};

const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Best-effort inverse of `generateSeats`: the stored hall keeps seats, not the numbers that made
 * them, so the editor reads them back from the geometry (pitch = narrowest step, aisles = wider
 * steps). Returns null for a hall with no seats.
 */
export function inferGen(seats: SeatLike[]): HallGenParams | null {
  if (seats.length === 0) return null;
  const rowLabels = [...new Set(seats.map((s) => s.rowLabel))];
  const perRow = Math.max(...seats.map((s) => s.number));
  const byY = [...new Map(seats.map((s) => [s.rowLabel, s])).values()].sort(
    (a, b) => a.y_m - b.y_m,
  );
  const first = byY[0] as SeatLike;
  const second = byY[1];
  const rowSpacingM = second ? second.y_m - first.y_m : DEFAULT_GEN.rowSpacingM;
  const rise = second ? second.z_m - first.z_m : 0;

  const row = seats
    .filter((s) => s.rowLabel === first.rowLabel)
    .sort((a, b) => a.number - b.number);
  const steps = row.slice(1).map((s, i) => s.x_m - (row[i] as SeatLike).x_m);
  const pitch = steps.length ? Math.min(...steps) : DEFAULT_GEN.seatPitchM;
  const aisleAfter = row
    .slice(0, -1)
    .filter((_, i) => (steps[i] as number) > pitch * 1.5)
    .map((s) => s.number);

  return {
    rows: rowLabels.length,
    seatsPerRow: perRow,
    seatPitchM: round(pitch, 2) || DEFAULT_GEN.seatPitchM,
    rowSpacingM: round(rowSpacingM, 2) || DEFAULT_GEN.rowSpacingM,
    aisleAfter,
    firstRowDistanceM: round(first.y_m, 2),
    risePerRowM: Math.max(0, round(rise, 2)),
  };
}

const sameList = (a: number[], b: number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export function sameGen(a: HallGenParams, b: HallGenParams): boolean {
  return (
    a.rows === b.rows &&
    a.seatsPerRow === b.seatsPerRow &&
    Math.abs(a.seatPitchM - b.seatPitchM) < 0.005 &&
    Math.abs(a.rowSpacingM - b.rowSpacingM) < 0.005 &&
    Math.abs(a.firstRowDistanceM - b.firstRowDistanceM) < 0.005 &&
    Math.abs(a.risePerRowM - b.risePerRowM) < 0.005 &&
    sameList(
      normalizeAisles(a.aisleAfter, a.seatsPerRow),
      normalizeAisles(b.aisleAfter, b.seatsPerRow),
    )
  );
}

/**
 * Aisle positions as the generator reads them: an aisle after the last seat means nothing, so
 * those are dropped; the rest sorted and unique. Two spellings of one layout compare equal.
 */
export function normalizeAisles(aisles: number[], seatsPerRow: number): number[] {
  return [...new Set(aisles.filter((n) => Number.isInteger(n) && n >= 1 && n < seatsPerRow))].sort(
    (a, b) => a - b,
  );
}

/** "7, 14" -> [7, 14]; junk and duplicates are dropped, then normalised for the row length. */
export function parseAisles(text: string, seatsPerRow = Number.POSITIVE_INFINITY): number[] {
  return normalizeAisles(
    text
      .split(/[\s,;]+/)
      .map(Number)
      .filter((n) => Number.isInteger(n)),
    seatsPerRow,
  );
}

/** Bounding box of seat centres, for fitting the plan into its SVG. */
export function bounds(seats: { x_m: number; y_m: number }[]) {
  if (seats.length === 0) return { minX: -1, maxX: 1, minY: 0, maxY: 1 };
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const s of seats) {
    minX = Math.min(minX, s.x_m);
    maxX = Math.max(maxX, s.x_m);
    minY = Math.min(minY, s.y_m);
    maxY = Math.max(maxY, s.y_m);
  }
  return { minX, maxX, minY, maxY };
}
