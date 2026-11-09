import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  type DivePose,
  divePose,
  diveTurnDeg,
  easeFlight,
  eyePosition,
  flightMs,
  forwardOf,
  hopPose,
  MAX_TURN_DEG_PER_S,
  newDivePose,
  screenCenter,
  type TopDownPose,
  type Vec3,
  viewAngles,
} from './camera-math';

const hall = { screen_width_m: 14, screen_height_m: 6, screen_x_m: 0 };
const center = screenCenter(hall);
const bounds = { half: 5.2, depth: 16.5 };
const top: TopDownPose = { position: [0.4, 95, 8], target: [0.4, 0, 8], fov: 9, squash: 0.62 };
const seatAt = (x: number, row: number): Vec3 =>
  eyePosition({ x_m: x, y_m: 4.5 + row * 1.1, z_m: row * 0.3 });
const SEATS: [string, Vec3][] = [
  ['front', seatAt(-1.05, 0)],
  ['middle', seatAt(1.6, 4)],
  ['back', seatAt(3.8, 9)],
  ['aisle', seatAt(1.05, 6)],
  ['edge', seatAt(-3.8, 9)],
];

const FPS = 60;
const frames = (ms: number) => Math.round((ms / 1000) * FPS);

/** Per-frame samples of a flight played at 60 fps: time is linear, the ease is the shipped one. */
function playDive(eye: Vec3, reverse = false) {
  const ms = flightMs(diveTurnDeg(eye, center));
  const n = frames(ms);
  const out: DivePose[] = [];
  for (let i = 0; i <= n; i++) {
    const tau = reverse ? 1 - i / n : i / n;
    const p = divePose(easeFlight(tau), top, eye, center, 70, newDivePose(), bounds);
    out.push({ ...p, position: [...p.position] as Vec3 });
  }
  return { ms, poses: out };
}

function angleBetween(a: DivePose, b: DivePose) {
  const fa = forwardOf(a.yaw, a.pitch, [0, 0, 0]);
  const fb = forwardOf(b.yaw, b.pitch, [0, 0, 0]);
  const dot = Math.min(1, Math.max(-1, fa[0] * fb[0] + fa[1] * fb[1] + fa[2] * fb[2]));
  return (Math.acos(dot) * 180) / Math.PI;
}

const speed = (a: DivePose, b: DivePose) =>
  Math.hypot(...(b.position.map((v, i) => v - (a.position[i] as number)) as Vec3)) * FPS;
const zoom = (a: DivePose, b: DivePose) =>
  Math.abs(Math.log(Math.tan((b.fov * Math.PI) / 360) / Math.tan((a.fov * Math.PI) / 360))) * FPS;

describe('flightMs', () => {
  it('is between 1.6 and 2.4 s and never faster than the turn cap allows', () => {
    expect(flightMs(60)).toBe(1600);
    expect(flightMs(100)).toBeGreaterThanOrEqual(1600);
    expect(flightMs(400)).toBe(2400);
  });
});

for (const [name, eye] of SEATS) {
  describe(`the dive to the ${name} seat, played at 60 fps`, () => {
    for (const reverse of [false, true]) {
      const { ms, poses } = playDive(eye, reverse);
      const label = reverse ? 'closing' : 'opening';

      it(`${label}: starts and ends exactly where it should`, () => {
        const first = poses[0] as DivePose;
        const last = poses[poses.length - 1] as DivePose;
        const [a, b] = reverse ? [last, first] : [first, last];
        for (let i = 0; i < 3; i++) expect(a.position[i]).toBeCloseTo(top.position[i] as number, 6);
        expect(a.pitch).toBeCloseTo(-Math.PI / 2);
        for (let i = 0; i < 3; i++) expect(b.position[i]).toBeCloseTo(eye[i] as number, 6);
        const end = viewAngles(eye, center);
        expect(b.yaw).toBeCloseTo(end.yaw);
        expect(b.pitch).toBeCloseTo(end.pitch);
      });

      it(`${label}: never rolls`, () => {
        const cam = new THREE.PerspectiveCamera();
        cam.rotation.order = 'YXZ';
        for (const p of poses) {
          cam.rotation.set(p.pitch, p.yaw, 0);
          cam.updateMatrixWorld();
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
          expect(Math.abs(right.y)).toBeLessThan(1e-9);
        }
      });

      it(`${label}: turns at most ${MAX_TURN_DEG_PER_S} degrees a second`, () => {
        let peak = 0;
        for (let i = 1; i < poses.length; i++) {
          peak = Math.max(peak, angleBetween(poses[i - 1] as DivePose, poses[i] as DivePose) * FPS);
        }
        expect(peak).toBeLessThanOrEqual(MAX_TURN_DEG_PER_S * 1.02);
        expect(ms).toBeGreaterThanOrEqual(1600);
        expect(ms).toBeLessThanOrEqual(2400);
      });

      it(`${label}: speed and zoom change smoothly from frame to frame`, () => {
        const v: number[] = [];
        const z: number[] = [];
        for (let i = 1; i < poses.length; i++) {
          v.push(speed(poses[i - 1] as DivePose, poses[i] as DivePose));
          z.push(zoom(poses[i - 1] as DivePose, poses[i] as DivePose));
        }
        const vMax = Math.max(...v);
        const zMax = Math.max(...z);
        for (let i = 1; i < v.length; i++) {
          expect(Math.abs((v[i] as number) - (v[i - 1] as number))).toBeLessThan(0.15 * vMax);
          expect(Math.abs((z[i] as number) - (z[i - 1] as number))).toBeLessThan(0.15 * zMax);
        }
      });

      it(`${label}: closes in on the eye steadily over the last 30 percent`, () => {
        const seq = reverse ? [...poses].reverse() : poses;
        const from = Math.floor(seq.length * 0.7);
        let prev = Number.POSITIVE_INFINITY;
        for (let i = from; i < seq.length; i++) {
          const p = seq[i] as DivePose;
          const d = Math.hypot(
            p.position[0] - eye[0],
            p.position[1] - eye[1],
            p.position[2] - eye[2],
          );
          expect(d).toBeLessThanOrEqual(prev + 1e-9);
          prev = d;
        }
      });
    }
  });
}

describe('the hop between seats, played at 60 fps', () => {
  const a = SEATS[0]?.[1] as Vec3;
  const b = SEATS[2]?.[1] as Vec3;
  const ms = flightMs(diveTurnDeg(b, center) / 4, 1400);
  const n = frames(ms);
  const poses: DivePose[] = [];
  for (let i = 0; i <= n; i++) {
    const p = hopPose(easeFlight(i / n), a, b, center, 70, 60, 5, bounds, newDivePose());
    poses.push({ ...p, position: [...p.position] as Vec3 });
  }
  it('starts at one eye and ends at the other', () => {
    for (let i = 0; i < 3; i++) {
      expect((poses[0] as DivePose).position[i]).toBeCloseTo(a[i] as number, 6);
      expect((poses[n] as DivePose).position[i]).toBeCloseTo(b[i] as number, 6);
    }
  });
  it('turns slowly, and speed and zoom change smoothly', () => {
    let vMax = 0;
    const v: number[] = [];
    for (let i = 1; i < poses.length; i++) {
      expect(
        angleBetween(poses[i - 1] as DivePose, poses[i] as DivePose) * FPS,
      ).toBeLessThanOrEqual(MAX_TURN_DEG_PER_S);
      const s = speed(poses[i - 1] as DivePose, poses[i] as DivePose);
      v.push(s);
      vMax = Math.max(vMax, s);
    }
    for (let i = 1; i < v.length; i++) {
      expect(Math.abs((v[i] as number) - (v[i - 1] as number))).toBeLessThan(0.15 * vMax);
    }
  });
});
