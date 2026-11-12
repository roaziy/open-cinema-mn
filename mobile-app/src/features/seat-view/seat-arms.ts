type SeatPos = { rowLabel: string; x_m: number; y_m: number; z_m: number };

/** Where a divider stands: floor point (x, height, depth), hall coordinates as the seats use. */
export type ArmPos = { x: number; y: number; z: number };

/** A gap wider than this many seat spacings is an aisle: the seats either side get their own divider. */
const AISLE_GAPS = 1.5;
const DEFAULT_PITCH = 0.55;

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s[Math.floor(s.length / 2)] as number) : Number.NaN;
};

/**
 * The dividers between seats: one between each two neighbours in a row, and one at each end of
 * every run of seats (a row's ends, either side of an aisle). Also the hall's seat spacing (the
 * typical distance between neighbours), which sizes the seat model.
 */
export function armsOf(seats: readonly SeatPos[]): { arms: ArmPos[]; pitch: number } {
  const rows = new Map<string, SeatPos[]>();
  for (const s of seats) {
    const r = rows.get(s.rowLabel);
    if (r) r.push(s);
    else rows.set(s.rowLabel, [s]);
  }
  const gaps: number[] = [];
  for (const r of rows.values()) {
    r.sort((a, b) => a.x_m - b.x_m);
    for (let i = 1; i < r.length; i++) gaps.push((r[i] as SeatPos).x_m - (r[i - 1] as SeatPos).x_m);
  }
  const m = median(gaps.filter((g) => g > 0.2 && g < 1.2));
  const pitch = Number.isFinite(m) ? m : DEFAULT_PITCH;
  const arms: ArmPos[] = [];
  for (const r of rows.values()) {
    r.forEach((s, i) => {
      const prev = r[i - 1];
      const joined = prev && s.x_m - prev.x_m <= pitch * AISLE_GAPS;
      if (prev && joined) {
        arms.push({
          x: (prev.x_m + s.x_m) / 2,
          y: Math.max(prev.z_m, s.z_m),
          z: (prev.y_m + s.y_m) / 2,
        });
      } else {
        arms.push({ x: s.x_m - pitch / 2, y: s.z_m, z: s.y_m });
      }
      const next = r[i + 1];
      if (!next || next.x_m - s.x_m > pitch * AISLE_GAPS) {
        arms.push({ x: s.x_m + pitch / 2, y: s.z_m, z: s.y_m });
      }
    });
  }
  return { arms, pitch };
}
