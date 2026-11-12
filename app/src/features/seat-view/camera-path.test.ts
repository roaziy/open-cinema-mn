import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT_M } from '@/shared';
import { layoutSeats } from '../../lib/seat-layout';
import { generateSeats } from '../../shared/hall-generator';
import {
  CLOSE_MS,
  divePace,
  OPEN_MS,
  shouldLead,
  TURN_BLEND_MS,
  turnBlendMs,
  turnRoundAt,
  turnRoundMs,
} from './camera-clock';
import { hopDurationMs, hopFrame } from './camera-hop';
import {
  camOf,
  type DivePose,
  divePose,
  eyePosition,
  fovForAspect,
  gridAlignmentPx,
  hallDepth,
  hallExtents,
  hallHalfWidth,
  MAX_TURN_DEG_PER_S,
  mapFitOf,
  newDivePose,
  povLook,
  projectToPx,
  rotationAngleDeg,
  rowsOf,
  SEAT_TOP_M,
  screenCenter,
  seatPlaneHeight,
  seatView,
  stepSpans,
  type TopDownPose,
  topDownFromMap,
  type Vec3,
} from './camera-math';
import { clearPosition, insideGeometry, type Obstacles } from './room-layout';

const FPS = 60;
const W = 402;
const H = 874;
const ASPECT = W / H;
const LENS = fovForAspect(ASPECT);
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

function copy(p: DivePose): DivePose {
  return { ...p, position: [...p.position] as Vec3 };
}

/** The eye of a seat (as `eyePosition` gives it) and the seat top the dive holds in the picture. */
const heldOf = (eye: Vec3): Vec3 => [eye[0], eye[1] - EYE_HEIGHT_M + SEAT_TOP_M, eye[2]];

/** The pose at progress `k` of the open (the close plays the same curve backwards). */
function poseAt(h: Hall, top: TopDownPose, eye: Vec3, k: number): DivePose {
  return divePose(k, top, eye, h.center, LENS, newDivePose(), h.o);
}

/** Where the dive ends: just behind and above the seat's eye. */
function viewOf(h: Hall, eye: Vec3): Vec3 {
  return seatView(eye, h.center, h.o, [0, 0, 0]);
}

/** The open (or the close, backwards) played linearly at `fps`: one pose per frame. */
function playDive(h: Hall, top: TopDownPose, eye: Vec3, reverse: boolean, fps = FPS) {
  const ms = reverse ? CLOSE_MS : OPEN_MS;
  const n = Math.round((ms / 1000) * fps);
  const out: { pose: DivePose; k: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const k = reverse ? 1 - i / n : i / n;
    out.push({ pose: copy(poseAt(h, top, eye, k)), k });
  }
  return { ms, samples: out };
}

/** The full rotation between two frames, picture spin included. */
function angle(a: DivePose, b: DivePose) {
  return rotationAngleDeg(a.yaw, a.pitch, b.yaw, b.pitch);
}

/** Rotation rates (deg/s) between consecutive poses. */
function rates(poses: DivePose[], fps = FPS): number[] {
  const r: number[] = [];
  for (let i = 1; i < poses.length; i++) {
    r.push(angle(poses[i - 1] as DivePose, poses[i] as DivePose) * fps);
  }
  return r;
}

/** Largest change of a rate from one frame to the next. */
function jerk(r: number[]): number {
  let worst = 0;
  for (let i = 1; i < r.length; i++) {
    worst = Math.max(worst, Math.abs((r[i] as number) - (r[i - 1] as number)));
  }
  return worst;
}

const ZOOMS = ['fit', 'zoomed'] as const;

// Measured over every seat of both halls, map at fit and at 3x, 60 fps (see the titles).
const OPEN_RATE_DEG_S = 218.9;
const CLOSE_RATE_DEG_S = 228.9;
const OPEN_JERK = 11.41;
const CLOSE_JERK = 12.46;
const TURN_RATE_DEG_S = 228.9;
const TURN_JERK = 28.84;
const MARGIN = 1.08;

/** True when part of the hall is in the picture: a seat top, or any corner or the centre of the screen. */
function hallInPicture(h: Hall, p: DivePose): boolean {
  const cam = camOf(p, 0, W, H);
  const o: Vec3 = [0, 0, 0];
  const inside = (x: number, y: number, z: number) => {
    projectToPx(cam, x, y, z, o);
    return o[2] === 1 && o[0] >= 0 && o[0] <= W && o[1] >= 0 && o[1] <= H;
  };
  // The screen can fill the whole picture with its corners and centre all outside it (a big
  // screen seen from the front row), so look at a grid across it, not just five points.
  const bottom = h.center[1] - h.hall.screen_height_m / 2;
  for (let i = 0; i <= 12; i++) {
    for (let j = 0; j <= 6; j++) {
      const x = h.hall.screen_x_m + (i / 12 - 0.5) * h.hall.screen_width_m;
      if (inside(x, bottom + (j / 6) * h.hall.screen_height_m, 0)) return true;
    }
  }
  return h.seats.some((s) => inside(s.x_m, s.z_m + SEAT_TOP_M, s.y_m));
}

for (const [hallName, h] of HALLS) {
  for (const zoomName of ZOOMS) {
    const top = topFor(h, zoomName);
    for (const [seatName, eye] of seatsOf(h, hallName)) {
      for (const reverse of [false, true]) {
        const label = `${hallName}, map ${zoomName}, ${seatName}, ${reverse ? 'closing' : 'opening'}`;
        describe(label, () => {
          const { ms, samples } = playDive(h, top, eye, reverse);
          const poses = samples.map((s) => s.pose);

          it(`lasts ${reverse ? 'CLOSE_MS' : 'OPEN_MS'}, starts on the map's top-down pose and ends in the seat's view (seatView, povLook)`, () => {
            expect(ms).toBe(reverse ? CLOSE_MS : OPEN_MS);
            expect(Math.abs(ms - (poses.length - 1) * (1000 / FPS))).toBeLessThan(1000 / FPS);
            const a = poseAt(h, top, eye, 0);
            for (let i = 0; i < 3; i++)
              expect(a.position[i]).toBeCloseTo(top.position[i] as number, 9);
            expect(a.pitch).toBeCloseTo(-Math.PI / 2, 9);
            expect(a.yaw).toBeCloseTo(0, 9);
            expect(
              gridAlignmentPx(camOf(a, 0, W, H), top, h.planeY),
              'the first frame is the map',
            ).toBeLessThan(0.01);
            expect(a.fov).toBeCloseTo(top.fov, 9);
            expect(a.squash).toBeCloseTo(top.squash, 9);
            const b = poseAt(h, top, eye, 1);
            const view = viewOf(h, eye);
            const look = povLook(view, h.center, LENS);
            for (let i = 0; i < 3; i++) expect(b.position[i]).toBeCloseTo(view[i] as number, 9);
            expect(b.yaw).toBeCloseTo(look.yaw, 9);
            expect(b.pitch).toBeCloseTo(look.pitch, 9);
            expect(b.fov).toBeCloseTo(LENS, 9);
            expect(b.squash).toBeCloseTo(1, 3);
          });

          it('never shows an empty frame (a seat top or a point of the screen is in the picture)', () => {
            for (const s of samples) expect(hallInPicture(h, s.pose), `k=${s.k}`).toBe(true);
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
        });
      }
    }
  }
}

describe('the dive turns smoothly, over every seat', () => {
  for (const [hallName, h] of HALLS) {
    for (const zoomName of ZOOMS) {
      for (const reverse of [false, true]) {
        const top = topFor(h, zoomName);
        const rateCap = (reverse ? CLOSE_RATE_DEG_S : OPEN_RATE_DEG_S) * MARGIN;
        const jerkCap = (reverse ? CLOSE_JERK : OPEN_JERK) * MARGIN;
        const dir = reverse ? 'closing' : 'opening';
        it(`${hallName}, map ${zoomName}, ${dir}: at most ${rateCap.toFixed(0)} deg/s (measured ${reverse ? CLOSE_RATE_DEG_S : OPEN_RATE_DEG_S}), rate changes by at most ${jerkCap.toFixed(1)} deg/s a frame (measured ${reverse ? CLOSE_JERK : OPEN_JERK})`, () => {
          for (const s of h.seats) {
            const eye = eyePosition(s);
            const poses = playDive(h, top, eye, reverse).samples.map((x) => x.pose);
            const r = rates(poses);
            expect(Math.max(...r), s.id).toBeLessThanOrEqual(rateCap);
            expect(jerk(r), s.id).toBeLessThanOrEqual(jerkCap);
          }
        });
      }
    }
  }

  it('changes its rate by clearly less a frame at 120 fps (under 0.55 of the 60 fps change; measured 0.502)', () => {
    for (const [hallName, h] of HALLS) {
      const top = topFor(h, 'fit');
      for (const [, eye] of seatsOf(h, hallName)) {
        for (const reverse of [false, true]) {
          const j60 = jerk(
            rates(
              playDive(h, top, eye, reverse, 60).samples.map((x) => x.pose),
              60,
            ),
          );
          const j120 = jerk(
            rates(
              playDive(h, top, eye, reverse, 120).samples.map((x) => x.pose),
              120,
            ),
          );
          expect(j120).toBeLessThan(j60 * 0.55);
        }
      }
    }
  });
});

describe('the camera never goes through the room', () => {
  for (const [hallName, h] of HALLS) {
    for (const zoomName of ZOOMS) {
      const top = topFor(h, zoomName);
      it(`${hallName}, map ${zoomName}: the raw curve is never inside a seat, step or wall (radius 0.12), and clearPosition (anchored at the view point) moves it at most 3 cm (measured 0.024 m at worst, under 3 mm at fit)`, () => {
        const out: [number, number, number] = [0, 0, 0];
        let lift = 0;
        for (const s of h.seats) {
          const eye = eyePosition(s);
          for (const { pose } of playDive(h, top, eye, false).samples) {
            const own = (st: { x_m: number; y_m: number }) =>
              Math.hypot(
                pose.position[0] - eye[0],
                pose.position[1] - eye[1],
                pose.position[2] - eye[2],
              ) < 1 &&
              Math.abs(st.x_m - eye[0]) < 0.6 &&
              Math.abs(st.y_m - eye[2]) < 0.6;
            expect(insideGeometry(pose.position, h.o, 0.12, own), `${s.id}`).toBe(false);
            clearPosition(pose.position, viewOf(h, eye), null, h.o, out);
            lift = Math.max(lift, out[1] - pose.position[1]);
          }
        }
        expect(lift).toBeLessThanOrEqual(0.03);
      });
    }
  }
});

describe('the held seat slides down the picture while the camera tilts', () => {
  for (const [hallName, h] of HALLS) {
    for (const zoomName of ZOOMS) {
      const top = topFor(h, zoomName);
      it(`${hallName}, map ${zoomName}: from k = 0.24 its y never goes up by more than 4 px, and stays at the bottom once off the edge`, () => {
        const o: Vec3 = [0, 0, 0];
        const n = Math.round((OPEN_MS / 1000) * FPS);
        for (const s of h.seats) {
          const eye = eyePosition(s);
          const held = heldOf(eye);
          let peak = Number.NEGATIVE_INFINITY;
          let left = false;
          for (let i = 0; i <= n; i++) {
            const k = i / n;
            if (k < 0.24 || k > 0.95) continue;
            projectToPx(camOf(poseAt(h, top, eye, k), 0, W, H), held[0], held[1], held[2], o);
            if (!left) {
              expect(o[2], `${s.id} k=${k.toFixed(2)}`).toBe(1);
              expect(o[1], `${s.id} k=${k.toFixed(2)}`).toBeGreaterThanOrEqual(peak - 4);
              peak = Math.max(peak, o[1]);
              if (o[1] > H) left = true;
            } else if (o[1] >= 0) {
              // (a point right under the lens projects to nonsense far above the picture: skipped)
              expect(o[1], `${s.id} k=${k.toFixed(2)} off the edge`).toBeGreaterThanOrEqual(
                0.95 * H,
              );
            }
          }
        }
      });
    }
  }
});

describe('the squash undoes itself as the tilt foreshortens the rows', () => {
  for (const [hallName, h] of HALLS) {
    for (const zoomName of ZOOMS) {
      const top = topFor(h, zoomName);
      it(`${hallName}, map ${zoomName}: top.squash while looking down, top.squash / -sin(pitch) below the knee max(0.85, top.squash), easing into 1 above it`, () => {
        expect(top.squash).toBeLessThan(1);
        const knee = Math.max(0.85, top.squash);
        for (const s of h.seats.filter((_, i) => i % 5 === 0)) {
          const eye = eyePosition(s);
          for (let i = 0; i <= 100; i++) {
            const p = poseAt(h, top, eye, i / 100);
            if (Math.abs(p.pitch + Math.PI / 2) < 1e-12) {
              expect(p.squash).toBeCloseTo(top.squash, 6);
            }
            const q = top.squash / Math.max(1e-3, -Math.sin(p.pitch));
            if (q <= knee) {
              expect(p.squash, `${s.id} i=${i}`).toBeCloseTo(q, 9);
            } else {
              expect(p.squash, `${s.id} i=${i}`).toBeGreaterThan(knee - 1e-9);
              expect(p.squash).toBeLessThanOrEqual(1);
            }
            expect(p.squash).toBeGreaterThanOrEqual(top.squash - 1e-12);
          }
          expect(poseAt(h, top, eye, 1).squash).toBeCloseTo(1, 3);
        }
      });
    }
  }
});

describe('turning a dive round', () => {
  const v0 = divePace(false);
  const pace = divePace(true);

  it('divePace is one move per OPEN_MS going in, one per CLOSE_MS coming back', () => {
    expect(v0).toBeCloseTo(1 / OPEN_MS, 12);
    expect(pace).toBeCloseTo(-1 / CLOSE_MS, 12);
  });

  it('turnBlendMs is TURN_BLEND_MS, shortened (not below 60 ms) near the end being headed for', () => {
    expect(turnBlendMs(0.2, v0)).toBe(TURN_BLEND_MS);
    expect(turnBlendMs(0.8, v0)).toBe(TURN_BLEND_MS);
    expect(turnBlendMs(0.95, v0)).toBeLessThan(TURN_BLEND_MS);
    expect(turnBlendMs(0.95, v0)).toBeGreaterThanOrEqual(60);
    expect(turnBlendMs(0.999, v0)).toBe(60);
    expect(turnBlendMs(0.05, pace)).toBeLessThan(TURN_BLEND_MS);
  });

  it('turnRoundAt starts at s0 with slope v0, reaches slope pace at the blend length and holds it', () => {
    for (const s0 of [0.2, 0.4, 0.6, 0.8]) {
      for (const [a, c] of [
        [v0, pace],
        [0, pace],
        [v0, 0],
      ] as const) {
        for (const at of [TURN_BLEND_MS, 120]) {
          expect(turnRoundAt(0, s0, a, c, at)).toBeCloseTo(s0, 12);
          const e = 1e-3;
          expect((turnRoundAt(e, s0, a, c, at) - s0) / e).toBeCloseTo(a, 6);
          expect(
            (turnRoundAt(at + e, s0, a, c, at) - turnRoundAt(at - e, s0, a, c, at)) / (2 * e),
          ).toBeCloseTo(c, 9);
          expect(
            (turnRoundAt(at + 500, s0, a, c, at) - turnRoundAt(at + 400, s0, a, c, at)) / 100,
          ).toBeCloseTo(c, 12);
          // continuous across the blend
          expect(turnRoundAt(at - 1e-6, s0, a, c, at)).toBeCloseTo(
            turnRoundAt(at + 1e-6, s0, a, c, at),
            6,
          );
        }
      }
    }
  });

  it('turnRoundMs is when turnRoundAt reaches the target: the blend plus the rest at the close pace', () => {
    for (const s0 of [0.2, 0.4, 0.6, 0.8, 0.95]) {
      const b = turnBlendMs(s0, v0);
      const ms = turnRoundMs(s0, 0, v0, pace, b);
      expect(ms).toBeGreaterThanOrEqual(b);
      expect(turnRoundAt(ms, s0, v0, pace, b)).toBeCloseTo(0, 9);
      // and a turn that is already there takes no longer than the blend
      expect(turnRoundMs(-0.1, 0, v0, pace, b)).toBe(b);
    }
  });

  for (const [hallName, h] of HALLS) {
    for (const zoomName of ZOOMS) {
      const top = topFor(h, zoomName);
      it(`${hallName}, map ${zoomName}: Back at 0.2 / 0.4 / 0.6 / 0.8 / 0.95 of the open (the rig's blend, progress clamped to 0..1) stays under ${TURN_RATE_DEG_S} deg/s (x${MARGIN}) and its rate changes by at most ${TURN_JERK} deg/s a frame (x${MARGIN})`, () => {
        const dt = 1000 / FPS;
        for (const s of h.seats.filter((_, i) => i % 3 === 0)) {
          const eye = eyePosition(s);
          for (const turnAt of [0.2, 0.4, 0.6, 0.8, 0.95]) {
            const poses: DivePose[] = [];
            const frames = Math.round((turnAt * OPEN_MS) / dt);
            for (let i = 0; i <= frames; i++) {
              poses.push(copy(poseAt(h, top, eye, (i * dt) / OPEN_MS)));
            }
            const s0 = (frames * dt) / OPEN_MS;
            const b = turnBlendMs(s0, v0);
            const total = turnRoundMs(s0, 0, v0, pace, b);
            const n = Math.ceil(total / dt);
            for (let i = 1; i <= n; i++) {
              const k = Math.min(1, Math.max(0, turnRoundAt(i * dt, s0, v0, pace, b)));
              poses.push(copy(poseAt(h, top, eye, k)));
            }
            const r = rates(poses);
            expect(Math.max(...r), `${s.id} @${turnAt}`).toBeLessThanOrEqual(
              TURN_RATE_DEG_S * MARGIN,
            );
            expect(jerk(r), `${s.id} @${turnAt}`).toBeLessThanOrEqual(TURN_JERK * MARGIN);
          }
        }
      });
    }
  }
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
        const povA = LENS;
        const povB = LENS;
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
          const va = povLook(a, h.center, povA);
          const vb = povLook(b, h.center, povB);
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
        const last = poseAt(h, top, eye, 0);
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
    const poseNow = poseAt(h, top, eye, 0.4);
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
    const last = camOf(poseAt(h, top, pick(h, 4, 4), 0), 0, 402, 874);
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
    const seat = h.seats[40] as (typeof h.seats)[number];
    for (let i = 0; i <= 30; i++) {
      const k = 0.3 * (1 - i / 30);
      const p = poseAt(h, top, eye, k);
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
  });

  it('gridAlignmentPx is 0 at the landing and shrinks monotonically over the last 30 percent of the close', () => {
    const eye = pick(h, 5, 5);
    let prev = Number.POSITIVE_INFINITY;
    let started = false;
    for (let i = 0; i <= 60; i++) {
      const k = 0.3 * (1 - i / 60);
      const e = gridAlignmentPx(camOf(poseAt(h, top, eye, k), 0, 402, 874), top, 1);
      if (e < Number.POSITIVE_INFINITY) started = true;
      if (started) {
        // half a pixel: the error plateaus (flat to a few thousandths) where the tilt begins
        expect(e).toBeLessThanOrEqual(prev + 0.5);
        prev = e;
      }
    }
    expect(prev).toBeLessThan(0.01);
  });
});

/**
 * Mean on-screen displacement (px) per frame of the seat tops plus a grid across the screen:
 * the points that are in the picture in either of two consecutive frames.
 */
function screenSpeeds(h: Hall, poses: DivePose[]): number[] {
  const pts: Vec3[] = h.seats.map((s) => [s.x_m, s.z_m + SEAT_TOP_M, s.y_m] as Vec3);
  const bottom = h.center[1] - h.hall.screen_height_m / 2;
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 4; j++) {
      pts.push([
        h.hall.screen_x_m + (i / 8 - 0.5) * h.hall.screen_width_m,
        bottom + (j / 4) * h.hall.screen_height_m,
        0,
      ]);
    }
  }
  const at = (p: DivePose) => {
    const cam = camOf(p, 0, W, H);
    const o: Vec3 = [0, 0, 0];
    return pts.map((q) => {
      projectToPx(cam, q[0], q[1], q[2], o);
      return {
        x: o[0],
        y: o[1],
        on: o[2] === 1 && o[0] >= 0 && o[0] <= W && o[1] >= 0 && o[1] <= H,
      };
    });
  };
  let prev = at(poses[0] as DivePose);
  const out: number[] = [];
  for (let i = 1; i < poses.length; i++) {
    const cur = at(poses[i] as DivePose);
    let sum = 0;
    let n = 0;
    for (let j = 0; j < cur.length; j++) {
      const a = prev[j] as (typeof cur)[number];
      const b = cur[j] as (typeof cur)[number];
      if (a.on || b.on) {
        sum += Math.hypot(b.x - a.x, b.y - a.y);
        n++;
      }
    }
    out.push(n ? sum / n : 0);
    prev = cur;
  }
  return out;
}

describe('the camera never pauses part-way (no "two steps")', () => {
  for (const [hallName, h] of HALLS) {
    for (const zoomName of ZOOMS) {
      const top = topFor(h, zoomName);
      for (const [seatName, eye] of seatsOf(h, hallName)) {
        for (const reverse of [false, true]) {
          it(`${hallName}, map ${zoomName}, ${seatName}, ${reverse ? 'closing' : 'opening'}: no frame in k 0.1..0.9 moves the picture at under 0.6 of both the speed 3 frames before and 3 frames after`, () => {
            const { samples } = playDive(h, top, eye, reverse);
            const v = screenSpeeds(
              h,
              samples.map((x) => x.pose),
            );
            // v[i - 1] is the move into frame i
            for (let i = 4; i + 3 < samples.length; i++) {
              const k = (samples[i] as { k: number }).k;
              if (k < 0.1 || k > 0.9) continue;
              const here = v[i - 1] as number;
              const before = v[i - 4] as number;
              const after = v[i + 2] as number;
              expect(
                here < 0.6 * before && here < 0.6 * after,
                `k=${k.toFixed(2)}: ${here.toFixed(1)} px vs ${before.toFixed(1)} before, ${after.toFixed(1)} after`,
              ).toBe(false);
            }
          });
        }
      }
    }
  }
});
