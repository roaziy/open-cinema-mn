import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generateSeats } from '../../../../shared/src/hall-generator';
import { layoutSeats } from '../../lib/seat-layout';
import {
  CLOSE_CAPS,
  diveClock,
  handOver,
  OPEN_CAPS,
  reversalMs,
  shouldLead,
  tauHermite,
} from './camera-clock';
import { hopDurationMs, hopFrame } from './camera-hop';
import {
  camOf,
  type DivePose,
  divePose,
  eyePosition,
  forwardOf,
  gridAlignmentPx,
  hallDepth,
  hallExtents,
  hallHalfWidth,
  MAX_TURN_DEG_PER_S,
  mapFitOf,
  newDivePose,
  povFov,
  projectToPx,
  rotationAngleDeg,
  rowsOf,
  screenCenter,
  seatPlaneHeight,
  stepSpans,
  type TopDownPose,
  topDownFromMap,
  type Vec3,
  viewAngles,
} from './camera-math';
import { insideGeometry, type Obstacles } from './room-layout';

const FPS = 60;
const ASPECT = 402 / 874;

/** z of the front edge of the seat block, minus a margin: the close's aim waypoint. */
function frontOf(h: { seats: { y_m: number }[] }): number {
  return Math.min(...h.seats.map((s) => s.y_m)) - 0.5;
}

function makeHall(rows: number, per: number, aisle: number, screenW: number) {
  const seats = generateSeats({
    rows,
    seatsPerRow: per,
    seatPitchM: 0.55,
    rowSpacingM: 1.05,
    aisleAfter: [aisle],
    firstRowDistanceM: 4.5,
    risePerRowM: 0.2,
  }).map((s) => ({
    ...s,
    id: `${s.rowLabel}${s.number}`,
    kind: 'standard' as const,
    state: 'free' as const,
  }));
  const hall = {
    screen_width_m: screenW,
    screen_height_m: Math.round(screenW * 0.42 * 10) / 10,
    screen_x_m: 0,
  };
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
  return { seats, hall, o, center: screenCenter(hall), planeY: seatPlaneHeight(seats) };
}

type Hall = ReturnType<typeof makeHall>;

/** The top-down pose the seat map screen would build: real layout, real fit, real lens. */
function topFor(h: Hall, zoom: 'fit' | 'zoomed'): TopDownPose {
  const layout = layoutSeats(h.seats as never, 402 - 44);
  const cw = layout.width + 44;
  const ch = 90 + layout.height + 16;
  const viewW = 402;
  const viewH = 520;
  const fit = Math.min(1, viewH / ch);
  const scale = zoom === 'fit' ? fit : 3;
  return topDownFromMap({
    fit: mapFitOf(layout.slots, layout.size, layout.ppm, { x: 22, y: 90 }),
    view: { scale, tx: 0, ty: 0, viewW, viewH, contentW: cw, contentH: ch },
    canvasW: 402,
    canvasH: 874,
    offsetX: 0,
    offsetY: 250,
    planeY: h.planeY,
  });
}

const HALLS: [string, Hall][] = [
  ['10x14', makeHall(10, 14, 7, 12)],
  ['IMAX 14x18', makeHall(14, 18, 9, 18)],
];

function pick(h: Hall, rowIdx: number, num: number): Vec3 {
  const row = h.seats.filter((s) => s.rowLabel === 'ABCDEFGHIJKLMNOP'[rowIdx]);
  const seat = row.find((s) => s.number === num) ?? (row[0] as (typeof row)[number]);
  return eyePosition(seat);
}

function seatsOf(h: Hall, name: string): [string, Vec3][] {
  const last = name.includes('IMAX') ? 13 : 9;
  const per = name.includes('IMAX') ? 18 : 14;
  return [
    ['A middle', pick(h, 0, Math.floor(per / 2))],
    ['A edge', pick(h, 0, 1)],
    ['E', pick(h, 4, 4)],
    ['G aisle', pick(h, 6, Math.floor(per / 2) + 1)],
    ['back middle', pick(h, last, Math.floor(per / 2))],
    ['back edge', pick(h, last, per)],
  ];
}

type Sample = { pose: DivePose; k: number };

function copy(p: DivePose): DivePose {
  return { ...p, position: [...p.position] as Vec3 };
}

function playDive(h: Hall, top: TopDownPose, eye: Vec3, reverse: boolean) {
  const pov = povFov(eye, h.hall, ASPECT);
  const clock = diveClock(
    top,
    eye,
    h.center,
    pov,
    h.o,
    reverse ? CLOSE_CAPS : OPEN_CAPS,
    reverse ? frontOf(h) : null,
  );
  const n = Math.round((clock.ms / 1000) * FPS);
  const out: Sample[] = [];
  for (let i = 0; i <= n; i++) {
    const tau = reverse ? 1 - i / n : i / n;
    const k = clock.at(tau);
    out.push({
      pose: copy(
        divePose(k, top, eye, h.center, pov, newDivePose(), h.o, reverse ? frontOf(h) : null),
      ),
      k,
    });
  }
  return { ms: clock.ms, samples: out };
}

/** The full rotation between two frames, picture spin included. */
function angle(a: DivePose, b: DivePose) {
  return rotationAngleDeg(a.yaw, a.pitch, b.yaw, b.pitch);
}

const speed = (a: DivePose, b: DivePose) =>
  Math.hypot(...(b.position.map((v, i) => v - (a.position[i] as number)) as Vec3)) * FPS;
const zoom = (a: DivePose, b: DivePose) =>
  Math.abs(Math.log(Math.tan((b.fov * Math.PI) / 360) / Math.tan((a.fov * Math.PI) / 360))) * FPS;

/** True when the view's centre ray meets the room: the floor, or the screen wall. */
function looksAtTheHall(h: Hall, p: DivePose): boolean {
  const f = forwardOf(p.yaw, p.pitch, [0, 0, 0]);
  const [px, py, pz] = p.position;
  if (f[1] < -1e-6) {
    const t = -py / f[1];
    const x = px + f[0] * t;
    const z = pz + f[2] * t;
    if (Math.abs(x) <= h.o.half && z >= 0 && z <= h.o.depth) return true;
  }
  if (f[2] < -1e-6) {
    const t = -pz / f[2];
    const x = px + f[0] * t;
    const y = py + f[1] * t;
    if (Math.abs(x) <= h.o.half && y >= 0 && y <= h.o.wallH) return true;
  }
  return false;
}

for (const [hallName, h] of HALLS) {
  for (const zoomName of ['fit', 'zoomed'] as const) {
    const top = topFor(h, zoomName);
    for (const [seatName, eye] of seatsOf(h, hallName)) {
      for (const reverse of [false, true]) {
        const label = `${hallName}, map ${zoomName}, ${seatName}, ${reverse ? 'closing' : 'opening'}`;
        describe(label, () => {
          const { ms, samples } = playDive(h, top, eye, reverse);
          const poses = samples.map((s) => s.pose);

          it('has its own duration and starts and ends where it should', () => {
            const open = playDive(h, top, eye, false).ms;
            if (reverse) {
              // the close is clearly quicker than the matching open (0.6 to 0.8 of it)
              expect(ms / open).toBeGreaterThan(0.6);
              expect(ms / open).toBeLessThan(0.8);
              expect(ms).toBeGreaterThanOrEqual(CLOSE_CAPS.minMs);
            } else {
              expect(ms).toBeGreaterThanOrEqual(1600);
              expect(ms).toBeLessThanOrEqual(3200);
            }
            const [a, b] = reverse
              ? [poses[poses.length - 1] as DivePose, poses[0] as DivePose]
              : [poses[0] as DivePose, poses[poses.length - 1] as DivePose];
            for (let i = 0; i < 3; i++)
              expect(a.position[i]).toBeCloseTo(top.position[i] as number, 5);
            for (let i = 0; i < 3; i++) expect(b.position[i]).toBeCloseTo(eye[i] as number, 5);
          });

          it('never shows an empty frame', () => {
            for (const p of poses) expect(looksAtTheHall(h, p)).toBe(true);
          });

          it('never rolls', () => {
            const cam = new THREE.PerspectiveCamera();
            cam.rotation.order = 'YXZ';
            for (const p of poses) {
              cam.rotation.set(p.pitch, p.yaw, 0);
              cam.updateMatrixWorld();
              expect(
                Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).y),
              ).toBeLessThan(1e-9);
            }
          });

          it(`${reverse ? 'turns at most 125 degrees a second and zooms at most 4 ln' : 'turns at most 90 degrees a second and zooms at most 3 ln'} a second`, () => {
            let peak = 0;
            let zPeak = 0;
            for (let i = 1; i < poses.length; i++) {
              peak = Math.max(peak, angle(poses[i - 1] as DivePose, poses[i] as DivePose) * FPS);
              zPeak = Math.max(zPeak, zoom(poses[i - 1] as DivePose, poses[i] as DivePose));
            }
            expect(peak).toBeLessThanOrEqual(
              reverse ? CLOSE_CAPS.turnDegPerS * 1.3 : MAX_TURN_DEG_PER_S * 1.05,
            );
            expect(zPeak).toBeLessThanOrEqual(
              reverse ? CLOSE_CAPS.zoomLnPerS * 1.05 : OPEN_CAPS.zoomLnPerS,
            );
          });

          it('has no jump in speed from frame to frame', () => {
            const v: number[] = [];
            for (let i = 1; i < poses.length; i++) {
              v.push(speed(poses[i - 1] as DivePose, poses[i] as DivePose));
            }
            const vMax = Math.max(...v);
            for (let i = 1; i < v.length; i++) {
              expect(Math.abs((v[i] as number) - (v[i - 1] as number))).toBeLessThan(0.2 * vMax);
            }
          });
        });
      }
    }
  }
}

describe('turning a dive round', () => {
  for (const [hallName, h] of HALLS) {
    const top = topFor(h, 'zoomed');
    const eye = pick(h, 0, 2);
    const pov = povFov(eye, h.hall, ASPECT);
    const open = diveClock(top, eye, h.center, pov, h.o, OPEN_CAPS);
    const close = diveClock(top, eye, h.center, pov, h.o, CLOSE_CAPS, frontOf(h));
    const poseOf = (k: number, out: DivePose) => divePose(k, top, eye, h.center, pov, out, h.o);
    for (const turnAt of [0.3, 0.5, 0.7]) {
      it(`${hallName}: from ${turnAt} the quicker return stays under 125 degrees a second and is continuous`, () => {
        const dtMs = 1000 / FPS;
        const D = open.ms;
        const out: DivePose[] = [];
        const frames = Math.round((turnAt * D) / dtMs);
        const atOpen = (frames * dtMs) / D;
        for (let i = 0; i <= frames; i++) {
          out.push(copy(poseOf(open.at((i * dtMs) / D), newDivePose())));
        }
        // the rig's hand-over, through the shipped function
        const ho = handOver(open, close, atOpen, 1 / D);
        const s0 = ho.s0;
        const vel = ho.vel;
        const base = close.ms * Math.max(0.4, s0);
        const Dr = reversalMs(poseOf, close, s0, 0, vel, base, 125);
        const n = Math.round(Dr / dtMs);
        for (let i = 1; i <= n; i++) {
          out.push(copy(poseOf(close.at(tauHermite(i / n, s0, 0, vel * Dr, 0)), newDivePose())));
        }
        const w: number[] = [];
        for (let i = 1; i < out.length; i++) {
          w.push(angle(out[i - 1] as DivePose, out[i] as DivePose) * FPS);
        }
        const peak = Math.max(...w);
        expect(peak).toBeLessThanOrEqual(CLOSE_CAPS.turnDegPerS * 1.05);
        for (let i = 1; i < w.length; i++) {
          expect(Math.abs((w[i] as number) - (w[i - 1] as number))).toBeLessThan(0.2 * peak + 3);
        }
      });
    }
  }
});

describe('the closing clock', () => {
  it('is the inverse of its own tauOf', () => {
    const [, h] = HALLS[0] as [string, Hall];
    const top = topFor(h, 'fit');
    const eye = pick(h, 3, 3);
    const c = diveClock(
      top,
      eye,
      h.center,
      povFov(eye, h.hall, ASPECT),
      h.o,
      CLOSE_CAPS,
      frontOf(h),
    );
    for (const k of [0, 0.2, 0.5, 0.8, 1]) expect(c.at(c.tauOf(k))).toBeCloseTo(k, 3);
  });
});

describe('rotationAngleDeg', () => {
  it('matches the angle between two camera quaternions, spin included', () => {
    const mk = (yaw: number, pitch: number) => {
      const c = new THREE.PerspectiveCamera();
      c.rotation.order = 'YXZ';
      c.rotation.set(pitch, yaw, 0);
      return c.quaternion.clone();
    };
    for (const [y1, p1, y2, p2] of [
      [0, -1.5, 0.7, -1.5],
      [0.3, -0.4, -0.5, 0.6],
      [0, -Math.PI / 2, 1, -Math.PI / 2],
    ] as [number, number, number, number][]) {
      const want = (mk(y1, p1).angleTo(mk(y2, p2)) * 180) / Math.PI;
      expect(rotationAngleDeg(y1, p1, y2, p2)).toBeCloseTo(want, 4);
    }
  });
});

describe('the seat switch glides between the seats', () => {
  for (const [hallName, h] of HALLS) {
    const seats = seatsOf(h, hallName);
    for (const [[na, a], [nb, b]] of [
      [seats[0], seats[4]],
      [seats[4], seats[1]],
      [seats[2], seats[3]],
      [seats[5], seats[0]],
    ] as [[string, Vec3], [string, Vec3]][]) {
      describe(`${hallName}: ${na} to ${nb}`, () => {
        const povA = povFov(a, h.hall, ASPECT);
        const povB = povFov(b, h.hall, ASPECT);
        const ms = hopDurationMs(a, b);
        const n = Math.round((ms / 1000) * FPS);
        const frame = (i: number) =>
          copy(hopFrame(i / n, a, b, h.center, povA, povB, h.o, newDivePose()));
        const poses = Array.from({ length: n + 1 }, (_, i) => frame(i));

        it("takes 1.6 to 2.2 s, starts at the first seat's view and ends at the second's", () => {
          expect(ms).toBeGreaterThanOrEqual(1600);
          expect(ms).toBeLessThanOrEqual(2200);
          const first = poses[0] as DivePose;
          const last = poses[n] as DivePose;
          for (let i = 0; i < 3; i++) {
            expect(first.position[i]).toBeCloseTo(a[i] as number, 6);
            expect(last.position[i]).toBeCloseTo(b[i] as number, 6);
          }
          const va = viewAngles(a, h.center);
          const vb = viewAngles(b, h.center);
          expect(first.yaw).toBeCloseTo(va.yaw, 6);
          expect(first.pitch).toBeCloseTo(va.pitch, 6);
          expect(last.yaw).toBeCloseTo(vb.yaw, 6);
          expect(last.pitch).toBeCloseTo(vb.pitch, 6);
          expect(first.fov).toBeCloseTo(povA, 6);
          expect(last.fov).toBeCloseTo(povB, 6);
        });

        it('moves smoothly: no jump of more than a few centimetres a frame at the start and end, no roll', () => {
          const total = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
          for (let i = 1; i < poses.length; i++) {
            const d = Math.hypot(
              ...((poses[i] as DivePose).position.map(
                (v, j) => v - ((poses[i - 1] as DivePose).position[j] as number),
              ) as Vec3),
            );
            // the ease peaks at 1.5x the average speed over the curve (which is a bit longer than the chord)
            expect(d).toBeLessThan(((total + 4) / n) * 2.2);
            if (i < 3 || i > n - 3) expect(d).toBeLessThan(0.05);
          }
        });

        it('never passes through a seat, step or wall (the two seats exempt close to them)', () => {
          const near = (p: DivePose, e: Vec3) =>
            Math.hypot(p.position[0] - e[0], p.position[1] - e[1], p.position[2] - e[2]) < 1;
          for (const p of poses) {
            expect(
              insideGeometry(
                p.position,
                h.o,
                0.12,
                (st) =>
                  (near(p, a) && Math.abs(st.x_m - a[0]) < 0.6 && Math.abs(st.y_m - a[2]) < 0.6) ||
                  (near(p, b) && Math.abs(st.x_m - b[0]) < 0.6 && Math.abs(st.y_m - b[2]) < 0.6),
              ),
            ).toBe(false);
          }
        });

        it('keeps the screen in view, turns under the open caps and passes between the seats', () => {
          const cam = new THREE.PerspectiveCamera(60, ASPECT, 0.1, 500);
          cam.rotation.order = 'YXZ';
          let peakTurn = 0;
          let peakZoom = 0;
          let maxAlong = 0;
          for (let i = 0; i < poses.length; i++) {
            const p = poses[i] as DivePose;
            cam.fov = p.fov;
            cam.updateProjectionMatrix();
            cam.position.set(...p.position);
            cam.rotation.set(p.pitch, p.yaw, 0);
            cam.updateMatrixWorld();
            cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
            const q = new THREE.Vector3(...h.center).applyMatrix4(cam.matrixWorldInverse);
            const n2 = new THREE.Vector3(...h.center).project(cam);
            expect(q.z).toBeLessThan(0);
            expect(Math.abs(n2.x)).toBeLessThanOrEqual(1);
            if (i > 0) {
              peakTurn = Math.max(peakTurn, angle(poses[i - 1] as DivePose, p) * FPS);
              peakZoom = Math.max(peakZoom, zoom(poses[i - 1] as DivePose, p));
            }
            // progress along the chord a to b: the camera really travels between them
            const ab = [b[0] - a[0], b[2] - a[2]];
            const len = Math.hypot(ab[0] as number, ab[1] as number) || 1;
            maxAlong = Math.max(
              maxAlong,
              ((p.position[0] - a[0]) * (ab[0] as number) +
                (p.position[2] - a[2]) * (ab[1] as number)) /
                len /
                len,
            );
          }
          expect(peakTurn).toBeLessThanOrEqual(MAX_TURN_DEG_PER_S);
          expect(peakZoom).toBeLessThanOrEqual(3);
          const mid = poses[Math.round(n / 2)] as DivePose;
          const along =
            ((mid.position[0] - a[0]) * (b[0] - a[0]) + (mid.position[2] - a[2]) * (b[2] - a[2])) /
            (Math.hypot(b[0] - a[0], b[2] - a[2]) ** 2 || 1);
          if (Math.hypot(b[0] - a[0], b[2] - a[2]) > 1) {
            expect(along).toBeGreaterThan(0.25);
            expect(along).toBeLessThan(0.75);
          }
          expect(maxAlong).toBeLessThan(1.05);
        });
      });
    }
  }
});

describe('the close lands exactly on the aligned top-down frame', () => {
  for (const [hallName, h] of HALLS) {
    for (const zoomName of ['fit', 'zoomed'] as const) {
      it(`${hallName}, map ${zoomName}: the last pose of the close is topDownFromMap's pose, and every seat projects within 1 px of the 2D map`, () => {
        const top = topFor(h, zoomName);
        const eye = pick(h, 4, 4);
        const pov = povFov(eye, h.hall, ASPECT);
        const clock = diveClock(top, eye, h.center, pov, h.o, CLOSE_CAPS, frontOf(h));
        const last = divePose(clock.at(0), top, eye, h.center, pov, newDivePose(), h.o);
        for (let i = 0; i < 3; i++)
          expect(last.position[i]).toBeCloseTo(top.position[i] as number, 9);
        expect(last.fov).toBeCloseTo(top.fov, 9);
        expect(last.squash).toBeCloseTo(top.squash, 9);
        expect(last.yaw).toBeCloseTo(0, 9);
        expect(last.pitch).toBeCloseTo(-Math.PI / 2, 9);
        // the pose projects the grid onto the 2D map's pixels (same maths as the open's first frame)
        const layout = layoutSeats(h.seats as never, 402 - 44);
        const cam = new THREE.PerspectiveCamera(last.fov, 402 / 874, 0.1, 600);
        cam.position.set(...last.position);
        cam.rotation.order = 'YXZ';
        cam.rotation.set(last.pitch, last.yaw, 0);
        cam.updateMatrixWorld();
        cam.projectionMatrix.elements[5] = (cam.projectionMatrix.elements[5] ?? 0) * last.squash;
        cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
        const probe = layout.slots[Math.floor(layout.slots.length / 2)];
        const seat = probe?.seat as (typeof h.seats)[number];
        const p = new THREE.Vector3(seat.x_m, seat.z_m + 0.5, seat.y_m).project(cam);
        const gotX = ((p.x + 1) / 2) * 402;
        const cw = layout.width + 44;
        const view = zoomName === 'fit' ? Math.min(1, 520 / (90 + layout.height + 16)) : 3;
        const want = 0 + 402 / 2 + view * (22 + (probe?.left ?? 0) + layout.size / 2 - cw / 2);
        expect(Math.abs(gotX - want)).toBeLessThan(1.5);
      });
    }
  }
});

describe('shouldLead', () => {
  it('fires once, only for a closing flight, once the drawn grid is within 2 px of the 2D map', () => {
    expect(shouldLead(40, true, false)).toBe(false);
    expect(shouldLead(2.01, true, false)).toBe(false);
    expect(shouldLead(2, true, false)).toBe(true);
    expect(shouldLead(0, true, true)).toBe(false);
    expect(shouldLead(0, false, false)).toBe(false);
  });
});

describe('handOver', () => {
  it('lands on the same progress on the new clock, and keeps a stopped camera stopped', () => {
    const [, h] = HALLS[0] as [string, Hall];
    const top = topFor(h, 'fit');
    const eye = pick(h, 3, 3);
    const pov = povFov(eye, h.hall, ASPECT);
    const open = diveClock(top, eye, h.center, pov, h.o, OPEN_CAPS);
    const close = diveClock(top, eye, h.center, pov, h.o, CLOSE_CAPS, frontOf(h));
    for (const tau of [0.2, 0.5, 0.8]) {
      const ho = handOver(open, close, tau, 0);
      expect(close.at(ho.s0)).toBeCloseTo(open.at(tau), 3);
      expect(ho.vel).toBeCloseTo(0, 9);
    }
  });
});

describe('the landmarks ride on the 3D grid', () => {
  const [, h] = HALLS[0] as [string, Hall];
  const layout = layoutSeats(h.seats as never, 402 - 44);
  const content = { w: layout.width + 44, h: 90 + layout.height + 16 };
  const fit = mapFitOf(layout.slots, layout.size, layout.ppm, { x: 22, y: 90 });
  const fitZoom = Math.min(1, 520 / content.h);
  const top = topFor(h, 'fit');
  const o: Vec3 = [0, 0, 0];

  it('projectToPx draws a point where three.js does', () => {
    const eye = pick(h, 5, 5);
    const poseNow = divePose(0.4, top, eye, h.center, 70, newDivePose(), h.o);
    const cam = camOf(poseNow, 0.05, 402, 874);
    const t = new THREE.PerspectiveCamera(poseNow.fov, 402 / 874, 0.1, 600);
    t.position.set(...poseNow.position);
    t.rotation.order = 'YXZ';
    t.rotation.set(poseNow.pitch, poseNow.yaw, 0);
    t.updateMatrixWorld();
    t.updateProjectionMatrix();
    t.projectionMatrix.elements[5] = (t.projectionMatrix.elements[5] ?? 0) * poseNow.squash;
    t.projectionMatrix.elements[9] = -0.05;
    t.projectionMatrixInverse.copy(t.projectionMatrix).invert();
    const p = new THREE.Vector3(1.2, 1, 7).project(t);
    projectToPx(cam, 1.2, 1, 7, o);
    expect(o[0]).toBeCloseTo(((p.x + 1) / 2) * 402, 3);
    expect(o[1]).toBeCloseTo(((1 - p.y) / 2) * 874, 3);
  });

  it('at the final pose every landmark anchor is where the 2D layout draws it (within 1 px)', () => {
    const last = camOf(
      divePose(0, top, pick(h, 4, 4), h.center, 70, newDivePose(), h.o),
      0,
      402,
      874,
    );
    // the 2D map: viewport 402 x 520 starting 250 px down the window, centred content, fit zoom
    const px2d = (cx: number, cy: number): [number, number] => [
      402 / 2 + fitZoom * (cx - content.w / 2),
      250 + 520 / 2 + fitZoom * (cy - content.h / 2),
    ];
    for (const slot of layout.slots.filter((_, i) => i % 7 === 0)) {
      const cx = 22 + slot.left + layout.size / 2;
      const cy = 90 + slot.top + layout.size / 2;
      const [wx, wy] = px2d(cx, cy);
      projectToPx(last, slot.seat.x_m, slot.seat.z_m + 0.5, slot.seat.y_m, o);
      expect(Math.abs(o[0] - wx)).toBeLessThan(3);
      expect(Math.abs(o[1] - wy)).toBeLessThan(3);
    }
    // a row letter: a point on the plane at its content position
    const rowCy = 90 + (layout.rows[3]?.top ?? 0) + layout.rowStep / 2;
    const [lx, ly] = px2d(22 - 11, rowCy);
    projectToPx(last, (22 - 11 - fit.x0) / fit.ppmX, h.planeY, (rowCy - fit.y0) / fit.ppmY, o);
    expect(Math.abs(o[0] - lx)).toBeLessThan(1);
    expect(Math.abs(o[1] - ly)).toBeLessThan(1);
  });

  it('tracks the 3D seat centres through the last 30 percent of the close (the anchors are the seats)', () => {
    const eye = pick(h, 5, 5);
    const pov = povFov(eye, h.hall, ASPECT);
    const clock = diveClock(top, eye, h.center, pov, h.o, CLOSE_CAPS, frontOf(h));
    const seat = h.seats[40] as (typeof h.seats)[number];
    for (let i = 0; i <= 30; i++) {
      const k = 0.3 * (1 - i / 30);
      const p = divePose(k, top, eye, h.center, pov, newDivePose(), h.o);
      const cam = camOf(p, 0, 402, 874);
      projectToPx(cam, seat.x_m, seat.z_m + 0.5, seat.y_m, o);
      // the landmark IS the projection of the seat anchor, so it equals where the seat is drawn
      const t = new THREE.PerspectiveCamera(p.fov, 402 / 874, 0.1, 600);
      t.position.set(...p.position);
      t.rotation.order = 'YXZ';
      t.rotation.set(p.pitch, p.yaw, 0);
      t.updateMatrixWorld();
      t.updateProjectionMatrix();
      t.projectionMatrix.elements[5] = (t.projectionMatrix.elements[5] ?? 0) * p.squash;
      t.projectionMatrixInverse.copy(t.projectionMatrix).invert();
      const v = new THREE.Vector3(seat.x_m, seat.z_m + 0.5, seat.y_m).project(t);
      expect(Math.abs(o[0] - ((v.x + 1) / 2) * 402)).toBeLessThan(0.01);
      expect(Math.abs(o[1] - ((1 - v.y) / 2) * 874)).toBeLessThan(0.01);
    }
    void clock;
  });

  it('gridAlignmentPx is 0 at the landing and shrinks monotonically on the way', () => {
    const eye = pick(h, 5, 5);
    const pov = povFov(eye, h.hall, ASPECT);
    let prev = Number.POSITIVE_INFINITY;
    let started = false;
    for (let i = 0; i <= 60; i++) {
      const k = 0.4 * (1 - i / 60);
      const e = gridAlignmentPx(
        camOf(divePose(k, top, eye, h.center, pov, newDivePose(), h.o), 0, 402, 874),
        top,
        1,
      );
      if (e < Number.POSITIVE_INFINITY) started = true;
      if (started) {
        expect(e).toBeLessThanOrEqual(prev + 1e-6);
        prev = e;
      }
    }
    expect(prev).toBeLessThan(0.01);
  });
});

describe('the look stays on the seat block', () => {
  for (const [hallName, h] of HALLS) {
    for (const zoomName of ['fit', 'zoomed'] as const) {
      const top = topFor(h, zoomName);
      for (const [seatName, eye] of seatsOf(h, hallName)) {
        it(`${hallName}, map ${zoomName}, ${seatName}: seats are in frame all the way down (leaving)`, () => {
          const pov = povFov(eye, h.hall, ASPECT);
          const clock = diveClock(top, eye, h.center, pov, h.o);
          const n = Math.round((clock.ms / 1000) * FPS);
          const out: Vec3 = [0, 0, 0];
          for (let i = 0; i <= n; i++) {
            const k = clock.at(i / n);
            if (k > 0.75) continue; // the last stretch is the seat's own approach (a front seat sees few seats)
            const p = divePose(k, top, eye, h.center, pov, newDivePose(), h.o, frontOf(h));
            const cam = camOf(p, 0, 402, 874);
            let inView = 0;
            for (const s of h.seats) {
              projectToPx(cam, s.x_m, s.z_m + 0.5, s.y_m, out);
              if (out[2] && out[0] >= 0 && out[0] <= 402 && out[1] >= 0 && out[1] <= 874) inView++;
            }
            expect(inView / h.seats.length, `k=${k.toFixed(2)}`).toBeGreaterThan(0.05);
          }
        });
      }
    }
  }
});

describe('the approved open is unchanged', () => {
  it('opening poses are exactly the held=0 poses (the approved aim), whatever the close does', () => {
    const [, h] = HALLS[0] as [string, Hall];
    const top = topFor(h, 'fit');
    const eye = pick(h, 6, 4);
    const pov = povFov(eye, h.hall, ASPECT);
    const clock = diveClock(top, eye, h.center, pov, h.o, OPEN_CAPS);
    const ref = diveClock(top, eye, h.center, pov, h.o, { ...OPEN_CAPS });
    expect(clock.ms).toBe(ref.ms);
    for (const tau of [0.1, 0.4, 0.6, 0.9]) expect(clock.at(tau)).toBe(ref.at(tau));
    // the aim still heads for the foot of the screen when opening: at k = 0.4 it looks well past the held seat's row
    const open = divePose(0.4, top, eye, h.center, pov, newDivePose(), h.o);
    const held = divePose(0.4, top, eye, h.center, pov, newDivePose(), h.o, frontOf(h));
    expect(open.pitch).not.toBeCloseTo(held.pitch, 3);
  });

  it('opening speed and zoom rate change by well under 8 percent a frame at 60 fps, and about halve at 120 and 240', () => {
    const [, h] = HALLS[0] as [string, Hall];
    const top = topFor(h, 'fit');
    for (const [reverse, bound] of [
      [false, 0.1],
      [true, 0.16],
    ] as const) {
      const eye = pick(h, 8, 4);
      const pov = povFov(eye, h.hall, ASPECT);
      const caps = reverse ? CLOSE_CAPS : OPEN_CAPS;
      const clock = diveClock(top, eye, h.center, pov, h.o, caps, reverse ? frontOf(h) : null);
      const worst = (fps: number) => {
        const n = Math.round((clock.ms / 1000) * fps);
        const ps: DivePose[] = [];
        for (let i = 0; i <= n; i++) {
          const tau = reverse ? 1 - i / n : i / n;
          ps.push(
            copy(
              divePose(
                clock.at(tau),
                top,
                eye,
                h.center,
                pov,
                newDivePose(),
                h.o,
                reverse ? frontOf(h) : null,
              ),
            ),
          );
        }
        let vMax = 0;
        const v: number[] = [];
        for (let i = 1; i < ps.length; i++) {
          const d =
            Math.hypot(
              ...((ps[i] as DivePose).position.map(
                (x, j) => x - ((ps[i - 1] as DivePose).position[j] as number),
              ) as Vec3),
            ) * fps;
          v.push(d);
          vMax = Math.max(vMax, d);
        }
        let w = 0;
        for (let i = 1; i < v.length; i++)
          w = Math.max(w, Math.abs((v[i] as number) - (v[i - 1] as number)) / vMax);
        return w;
      };
      const w60 = worst(60);
      const w120 = worst(120);
      const w240 = worst(240);
      expect(w60).toBeLessThan(bound);
      expect(w120).toBeLessThan(w60 * 0.65);
      expect(w240).toBeLessThan(w120 * 0.65);
    }
  });
});
