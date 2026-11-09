import { describe, expect, it } from 'vitest';
import { hopPose } from './camera-hop';
import {
  divePose,
  easeFlight,
  eyePosition,
  fovForAspect,
  hallDepth,
  hallExtents,
  hallHalfWidth,
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
  const center = screenCenter(hall);
  const bounds = { half: o.half, depth: o.depth };
  const tops: [string, TopDownPose][] = [
    ['over the hall', { position: [0, 95, 8], target: [0, 0, 8], fov: 9, squash: 0.6 }],
    [
      'panned out of the hall',
      { position: [34, 70, -12], target: [34, 0, -12], fov: 9, squash: 0.6 },
    ],
  ];
  const picks = [
    seats.find((s) => s.id === 'A-1.05'),
    seats.find((s) => s.id === 'D1.6'),
    seats.find((s) => s.id === 'J-3.8'),
    seats.find((s) => s.id === 'J3.8'),
    seats.find((s) => s.id === 'E-1.05'),
    seats.find((s) => s.id === 'A3.8'),
  ];
  const maxBack = Math.max(...seats.map((st) => st.z_m)) + seatHeightM + 0.5;
  for (const [where, top] of tops) {
    for (const seat of picks) {
      it(`${where}: flies to ${seat?.id} and back, never inside a seat, step or wall`, () => {
        if (!seat) throw new Error('seat missing');
        const eye = eyePosition(seat);
        const out = newDivePose();
        const p: [number, number, number] = [0, 0, 0];
        for (let i = 0; i <= 300; i++) {
          const tau = i / 300;
          divePose(easeFlight(tau), top, eye, center, fovForAspect(0.46), out, bounds);
          clearPosition(out.position, eye, null, o, p);
          // The viewer's own seat shrinks away as the camera comes to it.
          const near = Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) < 1;
          const bad = insideGeometry(p, o, 0.12, (st) => st.id === seat.id && near);
          expect(bad, `tau=${tau} at ${p.map((v) => v.toFixed(2)).join(',')}`).toBe(false);
          // low enough to be among the seat backs: only in the final approach, behind and above its own seat
          if (p[1] < maxBack) {
            const back = p[2] - eye[2];
            expect(back, `tau=${tau}`).toBeGreaterThan(-0.4);
            expect(back, `tau=${tau}`).toBeLessThan(2.6);
            expect(Math.abs(p[0] - eye[0]), `tau=${tau}`).toBeLessThan(0.9);
          }
        }
        const end = clearPosition(
          divePose(1, top, eye, center, 60, out, bounds).position,
          eye,
          null,
          o,
          p,
        );
        for (let i = 0; i < 3; i++) expect(end[i]).toBeCloseTo(eye[i] as number, 3);
      });
    }
  }

  it('the curve itself, without the safety net, stays out of the seats for a front seat', () => {
    const seat = seats.find((s) => s.id === 'A-1.05');
    if (!seat) throw new Error('seat missing');
    const eye = eyePosition(seat);
    const out = newDivePose();
    for (let i = 0; i <= 300; i++) {
      divePose(easeFlight(i / 300), tops[0]?.[1] as TopDownPose, eye, center, 60, out, bounds);
      const near =
        Math.hypot(out.position[0] - eye[0], out.position[1] - eye[1], out.position[2] - eye[2]) <
        1;
      expect(insideGeometry(out.position, o, 0.12, (st) => st.id === seat.id && near)).toBe(false);
    }
  });

  it('hops between seats in different rows, over the rows, without a sample inside a seat', () => {
    const a = seats.find((s) => s.id === 'A-1.05');
    const b = seats.find((s) => s.id === 'J3.8');
    if (!a || !b) throw new Error('seat missing');
    const ea = eyePosition(a);
    const eb = eyePosition(b);
    const out = newDivePose();
    for (let i = 0; i <= 300; i++) {
      const p = hopPose(easeFlight(i / 300), ea, eb, center, 60, 60, bounds, out);
      const near = (e: [number, number, number]) =>
        Math.hypot(p.position[0] - e[0], p.position[1] - e[1], p.position[2] - e[2]) < 1;
      expect(
        insideGeometry(
          p.position,
          o,
          0.12,
          (st) => (st.id === a.id && near(ea)) || (st.id === b.id && near(eb)),
        ),
        `t=${i / 300} at ${p.position.map((v) => v.toFixed(2)).join(',')}`,
      ).toBe(false);
    }
  });
});
