import { generateSeats } from './hall-generator';
import type { HallGenParams, SeatKind } from './schemas/admin';

export type HallTemplate = {
  id: string;
  /** Also the hall name it creates. */
  name: string;
  screenW: number;
  screenH: number;
  gen: HallGenParams;
  /** Back rows painted premium. */
  premiumRows: number;
  /** Seats painted for wheelchairs at each end of the front row. */
  wheelchairPerSide: number;
  /** Every seat premium (recliner halls). */
  allPremium?: boolean;
};

/** Common cinema hall formats to start from; every value stays editable afterwards. */
export const HALL_TEMPLATES: HallTemplate[] = [
  {
    id: '2d',
    name: '2D танхим',
    screenW: 12,
    screenH: 5,
    gen: {
      rows: 10,
      seatsPerRow: 18,
      seatPitchM: 0.55,
      rowSpacingM: 1.05,
      aisleAfter: [4, 14],
      firstRowDistanceM: 4,
      risePerRowM: 0.22,
    },
    premiumRows: 2,
    wheelchairPerSide: 1,
  },
  {
    id: '3d',
    name: '3D танхим',
    screenW: 14,
    screenH: 6,
    gen: {
      rows: 12,
      seatsPerRow: 20,
      seatPitchM: 0.55,
      rowSpacingM: 1.05,
      aisleAfter: [5, 15],
      firstRowDistanceM: 4.5,
      risePerRowM: 0.24,
    },
    premiumRows: 2,
    wheelchairPerSide: 1,
  },
  {
    id: 'dolby',
    name: '3D Dolby Vision',
    screenW: 16,
    screenH: 7,
    gen: {
      rows: 9,
      seatsPerRow: 18,
      seatPitchM: 0.7,
      rowSpacingM: 1.35,
      aisleAfter: [3, 15],
      firstRowDistanceM: 5,
      risePerRowM: 0.32,
    },
    premiumRows: 4,
    wheelchairPerSide: 1,
  },
  {
    id: 'imax',
    name: 'IMAX',
    screenW: 22,
    screenH: 12,
    gen: {
      rows: 16,
      seatsPerRow: 28,
      seatPitchM: 0.55,
      rowSpacingM: 1.15,
      aisleAfter: [7, 21],
      firstRowDistanceM: 6,
      risePerRowM: 0.35,
    },
    premiumRows: 4,
    wheelchairPerSide: 2,
  },
  {
    id: 'vip',
    name: 'VIP',
    screenW: 8,
    screenH: 3.4,
    gen: {
      rows: 4,
      seatsPerRow: 8,
      seatPitchM: 0.9,
      rowSpacingM: 1.6,
      aisleAfter: [2, 4, 6],
      firstRowDistanceM: 4,
      risePerRowM: 0.3,
    },
    premiumRows: 0,
    wheelchairPerSide: 0,
    allPremium: true,
  },
  {
    id: 'small',
    name: 'Жижиг танхим',
    screenW: 7,
    screenH: 3,
    gen: {
      rows: 6,
      seatsPerRow: 12,
      seatPitchM: 0.55,
      rowSpacingM: 1,
      aisleAfter: [6],
      firstRowDistanceM: 2.5,
      risePerRowM: 0.18,
    },
    premiumRows: 1,
    wheelchairPerSide: 1,
  },
];

/** Seat kinds a template paints, keyed `row-number`; unlisted seats stay standard. */
export function templateKinds(t: HallTemplate): Map<string, SeatKind> {
  const seats = generateSeats(t.gen);
  const rows = [...new Set(seats.map((s) => s.rowLabel))];
  const premium = new Set(t.allPremium ? rows : rows.slice(rows.length - t.premiumRows));
  const front = rows[0];
  const per = t.gen.seatsPerRow;
  const kinds = new Map<string, SeatKind>();
  for (const s of seats) {
    const key = `${s.rowLabel}-${s.number}`;
    if (premium.has(s.rowLabel)) kinds.set(key, 'premium');
    const end = s.number <= t.wheelchairPerSide || s.number > per - t.wheelchairPerSide;
    if (s.rowLabel === front && end) kinds.set(key, 'wheelchair');
  }
  return kinds;
}
