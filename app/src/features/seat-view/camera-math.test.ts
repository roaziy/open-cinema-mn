import { describe, expect, it } from 'vitest';
import {
  coverTransform,
  easeInOut,
  eyePosition,
  flightProgress,
  fovForAspect,
  hallDepth,
  hallExtents,
  lerp3,
  pickScreenSource,
  rowsOf,
  safeTone,
  screenCenter,
  stepSpans,
  textureFits,
  topDownHeight,
  topDownPosition,
} from './camera-math';

const hall = { screen_width_m: 10, screen_height_m: 4.2, screen_x_m: 0 };

describe('easeInOut', () => {
  it('is 0 at the start, 1 at the end, 0.5 in the middle, and clamps', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(-3)).toBe(0);
    expect(easeInOut(7)).toBe(1);
  });
  it('is slow at the ends and monotonic', () => {
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const v = easeInOut(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('flightProgress', () => {
  it('takes 1.5 s by default and finishes at once with Reduce Motion', () => {
    expect(flightProgress(750, false)).toBeCloseTo(0.5);
    expect(flightProgress(1500, false)).toBe(1);
    expect(flightProgress(0, true)).toBe(1);
  });
});

describe('eyePosition', () => {
  it('maps y_m to depth, z_m to height and adds the 1.15 m eye height', () => {
    expect(eyePosition({ x_m: 2, y_m: 9, z_m: 0.6 })).toEqual([2, 1.75, 9]);
  });
});

describe('screenCenter', () => {
  it('is half the screen height above the screen bottom', () => {
    expect(screenCenter({ ...hall, screen_x_m: 1 })).toEqual([1, 1.2 + 2.1, 0]);
  });
});

describe('top-down pose', () => {
  const seats = [
    { x_m: -4, y_m: 4, z_m: 0 },
    { x_m: 4, y_m: 12, z_m: 2.4 },
  ];
  it('reads hall extents', () => {
    expect(hallExtents(seats)).toEqual({ minX: -4, maxX: 4, minY: 4, maxY: 12, maxZ: 2.4 });
  });
  it('sits above the hall middle and looks straight down at it', () => {
    const { position, target } = topDownPosition(hallExtents(seats), hall, 55, 0.5);
    expect(position[0]).toBe(target[0]);
    expect(position[2]).toBe(target[2]);
    expect(position[1]).toBeGreaterThan(10);
    expect(target[1]).toBe(0);
  });
  it('goes higher on a narrower screen', () => {
    expect(topDownHeight(6, 14, 55, 0.5)).toBeGreaterThan(topDownHeight(6, 14, 55, 1));
  });
});

describe('lerp3', () => {
  it('writes into the output without allocating', () => {
    const out: [number, number, number] = [0, 0, 0];
    expect(lerp3(out, [0, 0, 0], [10, 20, 30], 0.5)).toBe(out);
    expect(out).toEqual([5, 10, 15]);
  });
});

describe('screen texture fallback', () => {
  const base = { backdropUrl: null, posterUrl: '', tone: '#3A6EA5' };
  it('prefers the backdrop, then the poster', () => {
    expect(
      pickScreenSource({ ...base, backdropUrl: 'https://x/b.jpg', posterUrl: 'https://x/p.jpg' }),
    ).toEqual({
      kind: 'remote',
      url: 'https://x/b.jpg',
    });
    expect(pickScreenSource({ ...base, posterUrl: 'https://x/p.jpg' })).toEqual({
      kind: 'remote',
      url: 'https://x/p.jpg',
    });
  });
  it('falls back to a flat film tone, neutral when the tone is malformed', () => {
    expect(pickScreenSource(base)).toEqual({ kind: 'flat', color: '#3A6EA5' });
    expect(pickScreenSource({ ...base, tone: 'red' })).toEqual({ kind: 'flat', color: '#8E8E93' });
    expect(safeTone('nope')).toBe('#8E8E93');
  });
});

describe('fovForAspect', () => {
  it('widens for portrait canvases within 50..85 degrees', () => {
    expect(fovForAspect(0.46)).toBe(85);
    expect(fovForAspect(0.75)).toBeGreaterThan(fovForAspect(1.5));
    expect(fovForAspect(3)).toBe(50);
    const mid = fovForAspect(1);
    expect(mid).toBeGreaterThanOrEqual(50);
    expect(mid).toBeLessThanOrEqual(85);
  });
});

describe('coverTransform', () => {
  it('crops the sides of a wider image and the top/bottom of a taller one', () => {
    expect(coverTransform(2, 1)).toEqual({ rx: 0.5, ry: 1, ox: 0.25, oy: 0 });
    expect(coverTransform(1, 2)).toEqual({ rx: 1, ry: 0.5, ox: 0, oy: 0.25 });
    expect(coverTransform(1.5, 1.5)).toEqual({ rx: 1, ry: 1, ox: 0, oy: 0 });
    expect(coverTransform(0, 1)).toEqual({ rx: 1, ry: 1, ox: 0, oy: 0 });
  });
});

describe('rows and steps', () => {
  const seats = [
    { rowLabel: 'B', x_m: 0, y_m: 6, z_m: 0.6 },
    { rowLabel: 'A', x_m: 0, y_m: 4, z_m: 0 },
    { rowLabel: 'A', x_m: 1, y_m: 4.2, z_m: 0 },
    { rowLabel: 'C', x_m: 0, y_m: 8, z_m: 1.2 },
  ];
  it('groups by row label, nearest the screen first, averaging curved rows', () => {
    const rows = rowsOf(seats);
    expect(rows.map((r) => r.label)).toEqual(['A', 'B', 'C']);
    expect(rows[0]?.y).toBeCloseTo(4.1);
  });
  it('gives each row a step from halfway to its neighbours, with a minimum thickness', () => {
    const rows = rowsOf(seats);
    const depth = hallDepth(hallExtents(seats));
    expect(depth).toBe(9.5);
    const spans = stepSpans(rows, depth);
    expect(spans[0]).toEqual({ from: 0, to: (4.1 + 6) / 2, height: 0.05 });
    expect(spans[1]?.from).toBe(spans[0]?.to);
    expect(spans[2]).toEqual({ from: 7, to: 9.5, height: 1.2 });
  });
});

describe('textureFits', () => {
  it('rejects empty, oversize and over-cap images', () => {
    expect(textureFits(960, 1440, 8192)).toBe(true);
    expect(textureFits(0, 10, 8192)).toBe(false);
    expect(textureFits(5000, 100, 8192)).toBe(false);
    expect(textureFits(3000, 100, 2048)).toBe(false);
    expect(textureFits(100, 100, 0)).toBe(true);
  });
});
