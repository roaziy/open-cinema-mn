import { describe, expect, it } from 'vitest';
import {
  CROSSFADE_MS,
  HANDOFF_FROM,
  handoffLook,
  handoffProgress,
  heldScale,
  LEAD_MS,
} from './handoff';

describe('handoffLook', () => {
  it('does nothing when opening or before the close reaches the last stretch', () => {
    for (const d of [0, 0.1, 0.5, 1]) {
      const look = handoffLook(d, false);
      expect(look.landmarks).toBe(0);
      expect(look.morph).toBe(0);
      expect(look.light).toBe(1);
      expect(look.footprintX).toBe(1);
      expect(look.screen).toBe(1);
    }
    expect(handoffLook(HANDOFF_FROM, true).landmarks).toBe(0);
    expect(handoffLook(0.9, true).morph).toBe(0);
  });

  it('ends exactly at the 2D look', () => {
    const look = handoffLook(0, true);
    expect(look.landmarks).toBe(1);
    expect(look.morph).toBe(1);
    expect(look.light).toBe(0);
    expect(look.screen).toBe(0);
    expect(look.footprintX).toBeCloseTo((0.55 * 0.86) / 0.52);
    expect(heldScale(look.morph, true)).toBeCloseTo(1);
    expect(heldScale(look.morph, false)).toBeCloseTo(1);
  });

  it('is monotonic as the camera comes down, and reversible (a pure function of progress)', () => {
    let prev = handoffLook(HANDOFF_FROM, true);
    for (let i = 1; i <= 60; i++) {
      const d = HANDOFF_FROM * (1 - i / 60);
      const look = handoffLook(d, true);
      expect(look.landmarks).toBeGreaterThanOrEqual(prev.landmarks);
      expect(look.morph).toBeGreaterThanOrEqual(prev.morph);
      expect(look.footprintX).toBeLessThanOrEqual(prev.footprintX);
      expect(heldScale(look.morph, true)).toBeLessThanOrEqual(heldScale(prev.morph, true));
      expect(look.screen).toBeLessThanOrEqual(prev.screen);
      prev = look;
    }
    expect(handoffLook(0.12, true)).toEqual(
      expect.objectContaining({ landmarks: handoffLook(0.12, true).landmarks }),
    );
  });

  it('lets the landmarks arrive before the seats finish morphing', () => {
    for (let i = 1; i < 20; i++) {
      const d = HANDOFF_FROM * (1 - i / 20);
      const look = handoffLook(d, true);
      if (look.morph < 1) expect(look.landmarks).toBeGreaterThanOrEqual(look.morph - 1e-9);
    }
  });
});

describe('handoffProgress and the crossfade window', () => {
  it('runs from 0 at the threshold to 1 at the map', () => {
    expect(handoffProgress(HANDOFF_FROM, true)).toBe(0);
    expect(handoffProgress(HANDOFF_FROM / 2, true)).toBeCloseTo(0.5);
    expect(handoffProgress(0, true)).toBe(1);
  });
  it('starts the crossfade before landing and ends it after', () => {
    expect(CROSSFADE_MS).toBe(450);
    expect(LEAD_MS).toBeGreaterThan(0);
    expect(LEAD_MS).toBeLessThan(CROSSFADE_MS);
    expect(CROSSFADE_MS - LEAD_MS).toBeGreaterThanOrEqual(150);
  });
});
