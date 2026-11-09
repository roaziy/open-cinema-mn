import { describe, expect, it } from 'vitest';
import { POV_ACROSS_DEG } from './camera-math';
import {
  angleDiff,
  dragLook,
  FLING_TAU_MS,
  foldGyroLook,
  grabLook,
  LOOK_DOWN_MAX,
  LOOK_UP_MAX,
  letGoLook,
  lookPitch,
  lookWeight,
  lookYaw,
  newLook,
  phoneAim,
  releaseLook,
  setGyroLook,
  stepLook,
  subscribeLook,
} from './look-around';

const RAD = Math.PI / 180;
/** Quaternion (x, y, z, w) of a turn by `deg` about a unit axis. */
const quat = (ax: number, ay: number, az: number, deg: number) => {
  const h = (deg * RAD) / 2;
  return [ax * Math.sin(h), ay * Math.sin(h), az * Math.sin(h), Math.cos(h)] as const;
};
/** q1 then q2 applied after it (q2 * q1). */
const then = (q1: readonly number[], q2: readonly number[]) => {
  const [x1, y1, z1, w1] = q1 as [number, number, number, number];
  const [x2, y2, z2, w2] = q2 as [number, number, number, number];
  return [
    w2 * x1 + x2 * w1 + y2 * z1 - z2 * y1,
    w2 * y1 - x2 * z1 + y2 * w1 + z2 * x1,
    w2 * z1 + x2 * y1 - y2 * x1 + z2 * w1,
    w2 * w1 - x2 * x1 - y2 * y1 - z2 * z1,
  ] as const;
};

describe('phoneAim', () => {
  it('lying flat, screen up, the back of the phone faces straight down', () => {
    expect(phoneAim(0, 0, 0, 1).elevation).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('held upright, it faces the horizon; turning left raises the heading, tilting the top back looks up', () => {
    const upright = quat(1, 0, 0, 90);
    const a = phoneAim(...upright);
    expect(a.elevation).toBeCloseTo(0, 6);
    const left = phoneAim(...then(upright, quat(0, 0, 1, 20)));
    expect(angleDiff(left.heading, a.heading)).toBeCloseTo(20 * RAD, 6);
    expect(left.elevation).toBeCloseTo(0, 6);
    const up = phoneAim(...then(quat(1, 0, 0, 105), quat(0, 0, 1, 0)));
    expect(up.elevation).toBeCloseTo(15 * RAD, 6);
  });
});

describe('angleDiff', () => {
  it('is the short way round', () => {
    expect(angleDiff(179 * RAD, -179 * RAD)).toBeCloseTo(-2 * RAD, 9);
    expect(angleDiff(-179 * RAD, 179 * RAD)).toBeCloseTo(2 * RAD, 9);
    expect(angleDiff(0.3, 0.1)).toBeCloseTo(0.2, 9);
  });
});

/** Frames of 1000/60 ms until nothing moves (or `max` frames); returns how many ran. */
function settle(l: ReturnType<typeof newLook>, max = 600): number {
  for (let i = 0; i < max; i++) if (!stepLook(l, 1000 / 60)) return i + 1;
  return max;
}

describe('the look', () => {
  it('follows the finger in place: a full-width drag right turns left by the lens width, a drag down looks up', () => {
    const l = newLook();
    grabLook(l);
    dragLook(l, 402, 0, 402);
    letGoLook(l);
    settle(l);
    expect(lookYaw(l)).toBeCloseTo(POV_ACROSS_DEG * RAD, 6);
    grabLook(l);
    dragLook(l, -402, 100, 402);
    letGoLook(l);
    settle(l);
    expect(lookYaw(l)).toBeCloseTo(0, 6);
    expect(lookPitch(l)).toBeGreaterThan(0);
  });

  it('eases after the finger: one frame shows part of a jump, never all of it, and catches up within a few frames', () => {
    const l = newLook();
    grabLook(l);
    dragLook(l, 100, 0, 402);
    stepLook(l, 1000 / 60);
    expect(lookYaw(l)).toBeGreaterThan(0);
    expect(lookYaw(l)).toBeLessThan(l.yaw);
    for (let i = 0; i < 20; i++) stepLook(l, 1000 / 60);
    expect(lookYaw(l)).toBeCloseTo(l.yaw, 3);
  });

  it('turns all the way round, as often as wanted', () => {
    const l = newLook();
    grabLook(l);
    for (let i = 0; i < 10; i++) dragLook(l, 402, 0, 402);
    letGoLook(l);
    settle(l);
    expect(lookYaw(l)).toBeGreaterThan(2 * Math.PI);
  });

  it('tilts only so far up and down', () => {
    const l = newLook();
    dragLook(l, 0, 10_000, 402);
    settle(l);
    expect(lookPitch(l)).toBeCloseTo(LOOK_UP_MAX, 6);
    dragLook(l, 0, -20_000, 402);
    settle(l);
    expect(lookPitch(l)).toBeCloseTo(-LOOK_DOWN_MAX, 6);
  });

  it('glides on after a fling, slowing to a stop about its speed times the slowing time later', () => {
    const l = newLook();
    grabLook(l);
    releaseLook(l, 402, 0, 402); // one lens width a second
    const v = POV_ACROSS_DEG * RAD;
    const frames = settle(l);
    expect(frames).toBeGreaterThan(30);
    expect(frames).toBeLessThan(600);
    expect(l.vYaw).toBe(0);
    expect(lookYaw(l)).toBeGreaterThan(v * (FLING_TAU_MS / 1000) * 0.8);
    expect(lookYaw(l)).toBeLessThan(v * (FLING_TAU_MS / 1000) * 1.1);
  });

  it('a finger down catches a fling where it is', () => {
    const l = newLook();
    releaseLook(l, 2000, 0, 402);
    for (let i = 0; i < 5; i++) stepLook(l, 1000 / 60);
    grabLook(l);
    const at = l.yaw;
    for (let i = 0; i < 30; i++) stepLook(l, 1000 / 60);
    expect(l.yaw).toBe(at);
  });

  it('a long pause between frames does not throw the view', () => {
    const l = newLook();
    releaseLook(l, 2000, 0, 402);
    stepLook(l, 5000);
    expect(l.yaw).toBeLessThan(0.3);
  });

  it('stops asking for frames once it has settled', () => {
    const l = newLook();
    expect(stepLook(l, 16)).toBe(false);
    dragLook(l, 50, 0, 402);
    expect(stepLook(l, 16)).toBe(true);
    expect(settle(l)).toBeLessThan(120);
  });

  it('adds the phone to the drag, and switching the phone off keeps the view where it is', () => {
    const l = newLook();
    dragLook(l, 100, 0, 402);
    setGyroLook(l, 0.2, -0.1);
    settle(l);
    const yaw = lookYaw(l);
    const pitch = lookPitch(l);
    expect(yaw).toBeCloseTo(l.yaw + 0.2, 6);
    foldGyroLook(l);
    expect(l.gyroYaw).toBe(0);
    settle(l);
    expect(lookYaw(l)).toBeCloseTo(yaw, 6);
    expect(lookPitch(l)).toBeCloseTo(pitch, 6);
  });

  it('tells its listeners, until they leave', () => {
    const l = newLook();
    let n = 0;
    const off = subscribeLook(l, () => n++);
    dragLook(l, 5, 0, 402);
    setGyroLook(l, 0.1, 0);
    off();
    dragLook(l, 5, 0, 402);
    expect(n).toBe(2);
  });

  it('applies in full at the seat, not at all over the map, easing out early in a close', () => {
    expect(lookWeight(1)).toBe(1);
    expect(lookWeight(0)).toBe(0);
    expect(lookWeight(0.75)).toBe(0);
    expect(lookWeight(0.9)).toBeGreaterThan(0.5);
  });
});
