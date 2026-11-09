import { describe, expect, it } from 'vitest';
import { POV_ACROSS_DEG } from './camera-math';
import {
  dragLook,
  FLING_TAU_MS,
  grabLook,
  LOOK_DOWN_MAX,
  LOOK_UP_MAX,
  letGoLook,
  lookPitch,
  lookWeight,
  lookYaw,
  newLook,
  releaseLook,
  stepLook,
  subscribeLook,
} from './look-around';

const RAD = Math.PI / 180;
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

  it('tells its listeners, until they leave', () => {
    const l = newLook();
    let n = 0;
    const off = subscribeLook(l, () => n++);
    dragLook(l, 5, 0, 402);
    releaseLook(l, 0, 0, 402);
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
