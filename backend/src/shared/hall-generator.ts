import type { HallGenParams, SeatKind } from './schemas/admin';

export type GeneratedSeat = {
  rowLabel: string;
  number: number;
  x_m: number;
  y_m: number;
  z_m: number;
  kind: SeatKind;
};

/** A, B, ... Z, AA, AB, ... */
export function rowLabelFor(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function generateSeats(p: HallGenParams): GeneratedSeat[] {
  const aisles = new Set(p.aisleAfter);
  const offsets: number[] = [];
  let gaps = 0;
  for (let n = 1; n <= p.seatsPerRow; n++) {
    offsets.push((n - 1 + gaps) * p.seatPitchM);
    if (aisles.has(n) && n < p.seatsPerRow) gaps++;
  }
  const center = (offsets[offsets.length - 1] ?? 0) / 2;
  const seats: GeneratedSeat[] = [];
  for (let r = 0; r < p.rows; r++) {
    for (let n = 1; n <= p.seatsPerRow; n++) {
      seats.push({
        rowLabel: rowLabelFor(r),
        number: n,
        x_m: (offsets[n - 1] as number) - center,
        y_m: p.firstRowDistanceM + r * p.rowSpacingM,
        z_m: r * p.risePerRowM,
        kind: 'standard',
      });
    }
  }
  return seats;
}
