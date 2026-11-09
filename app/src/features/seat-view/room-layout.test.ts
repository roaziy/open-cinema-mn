import { describe, expect, it } from 'vitest';
import {
  divePose,
  fovForAspect,
  hallDepth,
  hallExtents,
  hallHalfWidth,
  hopPose,
  newDivePose,
  rowsOf,
  screenCenter,
  stepSpans,
  type TopDownPose,
} from './camera-math';
import {
  aisleCentres,
  aisleStrips,
  clearPosition,
  hoverAltitude,
  insideGeometry,
  type Obstacles,
  seatHeightM,
  slatLayout,
} from './room-layout';

describe('slatLayout', () => {
  it('alternates two shades along the wall and stays inside it', () => {
    const slats = slatLayout(12);
    expect(slats.length).toBeGreaterThan(8);
    expect(slats.map((s) => s.shade).slice(0, 4)).toEqual([0, 1, 0, 1]);
    expect(Math.min(...slats.map((s) => s.z))).toBeGreaterThanOrEqual(1);
    expect(Math.max(...slats.map((s) => s.z))).toBeLessThan(12);
  });
});

describe('aisleCentres', () => {
  it('finds the gap between two blocks of seats', () => {
    const xs = [-3.3, -2.75, -2.2, -1.65, 1.1, 1.65, 2.2, 2.75, 3.3];
    expect(aisleCentres(xs)).toHaveLength(1);
    expect(aisleCentres(xs)[0]).toBeCloseTo(-0.275);
  });
  it('finds none in a hall without an aisle', () => {
    expect(aisleCentres([0, 0.55, 1.1, 1.65])).toEqual([]);
  });
});

describe('aisleStrips', () => {
  it('puts a light per row at each aisle and both side walls', () => {
    const rows = [
      { label: 'A', y: 4, z: 0 },
      { label: 'B', y: 5, z: 0.3 },
    ];
    const strips = aisleStrips(rows, [0], 4);
    expect(strips).toHaveLength(2 * 3);
    expect(strips.some((s) => s.x === 0)).toBe(true);
    expect(strips.some((s) => s.x === -3.65)).toBe(true);
    // on the front edge of its row's step: between the rows ahead and itself
    expect(strips[3]?.z).toBeCloseTo(4.5 + 0.07);
  });
});

const hall = { screen_width_m: 14, screen_height_m: 6, screen_x_m: 0 };
function makeHall() {
  const seats: { id: string; rowLabel: string; x_m: number; y_m: number; z_m: number }[] = [];
  const xs = [-3.8, -3.25, -2.7, -2.15, -1.6, -1.05, 1.05, 1.6, 2.15, 2.7, 3.25, 3.8];
  for (let r = 0; r < 10; r++) {
    for (const x of xs) {
      seats.push({
        id: `${'ABCDEFGHIJ'[r]}${x}`,
        rowLabel: 'ABCDEFGHIJ'[r] as string,
        x_m: x,
        y_m: 4.5 + r * 1.1,
        z_m: r * 0.3,
      });
    }
  }
  const ext = hallExtents(seats);
  const half = hallHalfWidth(ext, hall);
  const depth = hallDepth(ext);
  const o: Obstacles = {
    half,
    depth,
    wallH: ext.maxZ + 6,
    steps: stepSpans(rowsOf(seats), depth),
    seats,
  };
  return { seats, o, ext };
}

describe('the dive never goes through the room', () => {
  const { seats, o } = makeHall();
  const top: TopDownPose = { position: [0, 95, 8], target: [0, 0, 8], fov: 9, squash: 0.6 };
  const picks = [
    seats.find((s) => s.id === 'A-1.05'),
    seats.find((s) => s.id === 'D1.6'),
    seats.find((s) => s.id === 'J-3.8'),
    seats.find((s) => s.id === 'J3.8'),
    seats.find((s) => s.id === 'E-1.05'),
    seats.find((s) => s.id === 'A3.8'),
  ];
  for (const seat of picks) {
    it(`flies to ${seat?.id} and back without a sample inside a seat, step or wall`, () => {
      if (!seat) throw new Error('seat missing');
      const eye: [number, number, number] = [seat.x_m, seat.z_m + 1.15, seat.y_m];
      const out = newDivePose();
      const p: [number, number, number] = [0, 0, 0];
      for (let i = 0; i <= 200; i++) {
        const s = i / 200;
        divePose(s, top, eye, screenCenter(hall), fovForAspect(0.46), out, hoverAltitude(eye, o));
        clearPosition(out.position, eye, null, o, p);
        // The viewer's own seat shrinks away by the end of the dive.
        const gone = Math.min(1, Math.max(0, (s - 0.5) / 0.35));
        const bad = insideGeometry(p, o, 0.12, (st) => st.id === seat.id && gone > 0.95);
        expect(bad, `s=${s} at ${p.map((v) => v.toFixed(2)).join(',')}`).toBe(false);
        // low enough to be among the seat backs: it must be right over its own seat
        const maxBack = Math.max(...seats.map((st) => st.z_m)) + seatHeightM + 0.5;
        if (p[1] < maxBack) {
          expect(Math.hypot(p[0] - eye[0], p[2] - eye[2]), `s=${s}`).toBeLessThan(0.55);
        }
      }
      const end = clearPosition(
        divePose(1, top, eye, screenCenter(hall), 60, out, hoverAltitude(eye, o)).position,
        eye,
        null,
        o,
        p,
      );
      for (let i = 0; i < 3; i++) expect(end[i]).toBeCloseTo(eye[i] as number, 3);
    });
  }

  it('hops between seats in different rows, over the rows, without a sample inside a seat', () => {
    const a = seats.find((s) => s.id === 'A-1.05');
    const b = seats.find((s) => s.id === 'J3.8');
    if (!a || !b) throw new Error('seat missing');
    const ea: [number, number, number] = [a.x_m, a.z_m + 1.15, a.y_m];
    const eb: [number, number, number] = [b.x_m, b.z_m + 1.15, b.y_m];
    const out = newDivePose();
    const eyeNow: [number, number, number] = [0, 0, 0];
    for (let i = 0; i <= 200; i++) {
      const p = hopPose(
        i / 200,
        top,
        ea,
        eb,
        screenCenter(hall),
        60,
        60,
        (e) => hoverAltitude(e, o),
        out,
        eyeNow,
      );
      const pos: [number, number, number] = [p.position[0], p.position[1], p.position[2]];
      expect(
        insideGeometry(pos, o, 0.12, (st) => st.id === a.id || st.id === b.id),
        `t=${i / 200} at ${pos.map((v) => v.toFixed(2)).join(',')}`,
      ).toBe(false);
    }
  });
});
