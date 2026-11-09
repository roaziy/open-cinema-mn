import { describe, expect, it } from 'vitest';
import { POV_ACROSS_DEG } from './camera-math';
import {
  angleDiff,
  dragLook,
  foldGyroLook,
  LOOK_DOWN_MAX,
  LOOK_UP_MAX,
  LOOK_YAW_MAX,
  lookPitch,
  lookWeight,
  lookYaw,
  newLook,
  phoneAim,
  setGyroLook,
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

describe('the look', () => {
  it('follows the finger: a full-width drag right turns left by the lens width, a drag down looks up', () => {
    const l = newLook();
    dragLook(l, 402, 0, 402);
    expect(lookYaw(l)).toBeCloseTo(POV_ACROSS_DEG * RAD, 9);
    dragLook(l, -402, 100, 402);
    expect(lookYaw(l)).toBeCloseTo(0, 9);
    expect(lookPitch(l)).toBeGreaterThan(0);
  });

  it('stops at the limits, and dragging past them does not wind up', () => {
    const l = newLook();
    dragLook(l, 10_000, 10_000, 402);
    expect(lookYaw(l)).toBeCloseTo(LOOK_YAW_MAX, 9);
    expect(lookPitch(l)).toBeCloseTo(LOOK_UP_MAX, 9);
    dragLook(l, -40, -40, 402);
    expect(lookYaw(l)).toBeLessThan(LOOK_YAW_MAX);
    expect(lookPitch(l)).toBeLessThan(LOOK_UP_MAX);
    dragLook(l, 0, -10_000, 402);
    expect(lookPitch(l)).toBeCloseTo(-LOOK_DOWN_MAX, 9);
  });

  it('adds the phone to the drag, and switching the phone off keeps the view where it is', () => {
    const l = newLook();
    dragLook(l, 100, 0, 402);
    setGyroLook(l, 0.2, -0.1);
    const yaw = lookYaw(l);
    const pitch = lookPitch(l);
    expect(yaw).toBeCloseTo(l.yaw + 0.2, 9);
    foldGyroLook(l);
    expect(l.gyroYaw).toBe(0);
    expect(lookYaw(l)).toBeCloseTo(yaw, 9);
    expect(lookPitch(l)).toBeCloseTo(pitch, 9);
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
