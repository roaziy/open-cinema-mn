import { generateSeats, type HallGenParams, type SeatKind } from '@/lib/shared';

export type HallTemplate = {
  id: string;
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

/** Common hall shapes to start from; every value stays editable afterwards. */
export const HALL_TEMPLATES: HallTemplate[] = [
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
  {
    id: 'standard',
    name: 'Стандарт танхим',
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
    id: 'large',
    name: 'Том танхим',
    screenW: 16,
    screenH: 6.8,
    gen: {
      rows: 14,
      seatsPerRow: 24,
      seatPitchM: 0.55,
      rowSpacingM: 1.1,
      aisleAfter: [6, 18],
      firstRowDistanceM: 5,
      risePerRowM: 0.25,
    },
    premiumRows: 3,
    wheelchairPerSide: 2,
  },
  {
    id: 'giant',
    name: 'Аварга дэлгэцтэй',
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
    name: 'VIP танхим',
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
];

const key = (row: string, n: number) => `${row}-${n}`;

/** Seat kinds the template paints, keyed like the editor (`row-number`); unlisted seats stay standard. */
export function templateKinds(t: HallTemplate): Map<string, SeatKind> {
  const seats = generateSeats(t.gen);
  const rows = [...new Set(seats.map((s) => s.rowLabel))];
  const premium = new Set(t.allPremium ? rows : rows.slice(rows.length - t.premiumRows));
  const front = rows[0];
  const per = t.gen.seatsPerRow;
  const kinds = new Map<string, SeatKind>();
  for (const s of seats) {
    if (premium.has(s.rowLabel)) kinds.set(key(s.rowLabel, s.number), 'premium');
    if (
      s.rowLabel === front &&
      (s.number <= t.wheelchairPerSide || s.number > per - t.wheelchairPerSide)
    )
      kinds.set(key(s.rowLabel, s.number), 'wheelchair');
  }
  return kinds;
}
