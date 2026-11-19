import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { layoutSeats } from '../../lib/seat-layout';
import {
  coverTransform,
  eyePosition,
  fovForAspect,
  hallDepth,
  hallExtents,
  keyed,
  lensRange,
  mapFitOf,
  POV_NEAR_M,
  pickScreenSource,
  povLook,
  projectToPx,
  rowsOf,
  SEAT_TOP_M,
  safeTone,
  screenCenter,
  seatPlaneHeight,
  stepSpans,
  topDownFromMap,
} from './camera-math';

const hall = { screen_width_m: 10, screen_height_m: 4.2, screen_x_m: 0 };

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

describe('hallExtents', () => {
  const seats = [
    { x_m: -4, y_m: 4, z_m: 0 },
    { x_m: 4, y_m: 12, z_m: 2.4 },
  ];
  it('reads hall extents', () => {
    expect(hallExtents(seats)).toEqual({ minX: -4, maxX: 4, minY: 4, maxY: 12, maxZ: 2.4 });
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
  it('takes in about 46 degrees across, vertical clamped to 50..85', () => {
    expect(fovForAspect(0.46)).toBe(85);
    expect(fovForAspect(0.75)).toBeCloseTo(59, 0);
    expect(fovForAspect(0.75)).toBeGreaterThan(fovForAspect(1.5));
    expect(fovForAspect(3)).toBe(50);
    expect(fovForAspect(1)).toBe(50);
  });
  it('across the unclamped range the horizontal angle is 46 degrees', () => {
    for (const a of [0.6, 0.75, 0.9]) {
      const v = fovForAspect(a);
      const across = (2 * Math.atan(Math.tan((v * Math.PI) / 360) * a) * 180) / Math.PI;
      expect(across).toBeCloseTo(46, 9);
    }
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

// A small hall: 4 columns 0.55 m apart with an aisle, 3 rows 1.1 m apart.
const seatsOf = () => {
  const out: {
    id: string;
    rowLabel: string;
    kind: 'standard';
    x_m: number;
    y_m: number;
    z_m: number;
  }[] = [];
  for (const [r, y] of [4, 5.1, 6.2].entries()) {
    for (const x of [-1.65, -1.1, 0.55, 1.1]) {
      out.push({
        id: `${r}${x}`,
        rowLabel: 'ABC'[r] as string,
        kind: 'standard',
        x_m: x,
        y_m: y,
        z_m: r * 0.3,
      });
    }
  }
  return out;
};
const GUTTER = 22;
const ARC_H = 90;

describe('lensRange', () => {
  it('keeps the seat-height near plane low and pushes it out when high above the hall', () => {
    expect(lensRange(2).near).toBe(POV_NEAR_M);
    expect(lensRange(100).near).toBeGreaterThan(20);
    expect(lensRange(100).far).toBeGreaterThan(200);
    expect(lensRange(50).near).toBeLessThan(lensRange(100).near);
  });
});

describe('mapFitOf', () => {
  it('recovers the layout scale and the row pitch', () => {
    const layout = layoutSeats(seatsOf() as never, 330);
    const fit = mapFitOf(layout.slots, layout.size, layout.ppm, { x: GUTTER, y: ARC_H });
    expect(fit.ppmX).toBeCloseTo(layout.ppm);
    // 3 rows 1.1 m apart are drawn rowStep px apart.
    expect(fit.ppmY).toBeCloseTo(layout.rowStep / 1.1);
    const s = layout.slots[5];
    expect(fit.x0 + fit.ppmX * (s?.seat.x_m ?? 0)).toBeCloseTo(
      GUTTER + (s?.left ?? 0) + layout.size / 2,
    );
    expect(fit.y0 + fit.ppmY * (s?.seat.y_m ?? 0)).toBeCloseTo(
      ARC_H + (s?.top ?? 0) + layout.size / 2,
    );
  });
  it('survives a hall with a single row', () => {
    const one = seatsOf().filter((s) => s.rowLabel === 'A');
    const layout = layoutSeats(one as never, 330);
    const fit = mapFitOf(layout.slots, layout.size, layout.ppm, { x: GUTTER, y: ARC_H });
    expect(fit.ppmY).toBeCloseTo(layout.ppm);
  });
});

describe('topDownFromMap', () => {
  // Project a hall point through the returned camera with real three.js and compare with where
  // the 2D map draws that seat after the given pan/zoom.
  function check(
    view: { scale: number; tx: number; ty: number },
    offset: { x: number; y: number },
    canvas = { w: 390, h: 640 },
  ) {
    const seats = seatsOf();
    const layout = layoutSeats(seats as never, 330);
    const contentW = layout.width + GUTTER * 2;
    const contentH = ARC_H + layout.height + 24;
    const fit = mapFitOf(layout.slots, layout.size, layout.ppm, { x: GUTTER, y: ARC_H });
    const viewW = 390;
    const viewH = 520;
    const canvasW = canvas.w;
    const canvasH = canvas.h;
    const pose = topDownFromMap({
      fit,
      view: { ...view, viewW, viewH, contentW, contentH },
      canvasW,
      canvasH,
      offsetX: offset.x,
      offsetY: offset.y,
      planeY: seatPlaneHeight(seats),
    });
    const cam = new THREE.PerspectiveCamera(pose.fov, canvasW / canvasH, 0.5, 600);
    cam.position.set(...pose.position);
    cam.up.set(0, 0, -1);
    cam.lookAt(...pose.target);
    cam.updateMatrixWorld();
    cam.projectionMatrix.elements[5] = (cam.projectionMatrix.elements[5] ?? 0) * pose.squash;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    for (const slot of layout.slots) {
      const p = new THREE.Vector3(slot.seat.x_m, slot.seat.z_m + 0.5, slot.seat.y_m).project(cam);
      const gotX = ((p.x + 1) / 2) * canvasW;
      const gotY = ((1 - p.y) / 2) * canvasH;
      const wantX =
        offset.x +
        viewW / 2 +
        view.tx +
        view.scale * (GUTTER + slot.left + layout.size / 2 - contentW / 2);
      const wantY =
        offset.y +
        viewH / 2 +
        view.ty +
        view.scale * (ARC_H + slot.top + layout.size / 2 - contentH / 2);
      expect(Math.abs(gotX - wantX)).toBeLessThan(3);
      // Rows are fitted, not exact; the fit error stays under half a pixel here.
      expect(Math.abs(gotY - wantY)).toBeLessThan(2.5);
    }
  }
  it('lines seats up with the 2D map at the fitted zoom', () => {
    check({ scale: 1, tx: 0, ty: 0 }, { x: 0, y: 60 });
  });
  it('lines up when the canvas is the whole window and the map sits in the middle of it', () => {
    check({ scale: 1.6, tx: 20, ty: -30 }, { x: 0, y: 190 }, { w: 390, h: 844 });
  });
  it('follows pan and zoom, and a canvas offset from the viewport', () => {
    check({ scale: 2.4, tx: -35, ty: 48 }, { x: 0, y: 112 });
  });
  it('looks straight down with the screen at the top and a narrow lens', () => {
    const pose = topDownFromMap({
      fit: { x0: 0, ppmX: 20, y0: 0, ppmY: 20 },
      view: { scale: 1, tx: 0, ty: 0, viewW: 300, viewH: 500, contentW: 300, contentH: 500 },
      canvasW: 300,
      canvasH: 500,
      offsetX: 0,
      offsetY: 0,
      planeY: 0.6,
    });
    expect(pose.fov).toBeLessThan(20);
    expect(pose.target[1]).toBe(0);
    expect(pose.position[0]).toBeCloseTo(pose.target[0]);
    expect(pose.position[2]).toBeCloseTo(pose.target[2]);
    expect(pose.position[1]).toBeGreaterThan(20);
    expect(pose.squash).toBe(1);
  });
});

describe('seatPlaneHeight', () => {
  it('is the mean seat height plus the seat tops', () => {
    expect(seatPlaneHeight([{ z_m: 0 }, { z_m: 2 }])).toBeCloseTo(1 + SEAT_TOP_M);
    expect(seatPlaneHeight([])).toBe(SEAT_TOP_M);
  });
});

describe('povLook', () => {
  const center = screenCenter(hall);
  const deg = (r: number) => (r * 180) / Math.PI;
  const fov = 60;

  it('turns toward the screen centre', () => {
    const left = povLook([-4, 3, 12], center, fov);
    const right = povLook([4, 3, 12], center, fov);
    expect(left.yaw).toBeLessThan(0);
    expect(right.yaw).toBeGreaterThan(0);
    expect(left.yaw).toBeCloseTo(-right.yaw, 12);
    expect(povLook([0, 3, 12], center, fov).yaw).toBeCloseTo(0, 12);
  });

  it('holds the front rows at +3 degrees even when the screen is far above the eye', () => {
    expect(deg(povLook([0, 1.9, 3], center, fov).pitch)).toBeCloseTo(3, 9);
    expect(deg(povLook([0, 1.9, 1], center, fov).pitch)).toBeCloseTo(3, 9);
  });

  it('holds the back rows at -18 degrees or higher however far above the screen the eye is', () => {
    expect(deg(povLook([0, 12, 30], center, fov).pitch)).toBeCloseTo(-18, 9);
    for (const z of [15, 20, 25, 30, 40]) {
      expect(deg(povLook([0, 9, z], center, fov).pitch)).toBeGreaterThanOrEqual(-18 - 1e-9);
    }
  });

  it('never looks above +3 or below -18 degrees, whatever the seat', () => {
    for (let y = 0.5; y < 14; y += 1.5) {
      for (let z = 1; z < 40; z += 3) {
        const d = deg(povLook([0, y, z], center, fov).pitch);
        expect(d).toBeLessThanOrEqual(3 + 1e-9);
        expect(d).toBeGreaterThanOrEqual(-18 - 1e-9);
      }
    }
  });

  it('puts the screen centre 0.38 up from the middle of the picture (31 percent from the top) when unclamped', () => {
    const eye: [number, number, number] = [0, 2.6, 14];
    const look = povLook(eye, center, fov);
    expect(deg(look.pitch)).toBeGreaterThan(-18);
    expect(deg(look.pitch)).toBeLessThan(3);
    const cam = {
      x: eye[0],
      y: eye[1],
      z: eye[2],
      ...look,
      fov,
      squash: 1,
      shift: 0,
      w: 402,
      h: 874,
    };
    const out: [number, number, number] = [0, 0, 0];
    projectToPx(cam, center[0], center[1], center[2], out);
    const ndcY = 1 - (out[1] / 874) * 2;
    expect(ndcY).toBeCloseTo(0.38, 6);
    expect(out[0]).toBeCloseTo(201, 6);
  });
});

describe('keyed', () => {
  const xs = [0, 0.2, 0.6, 1];

  it('passes through its keys', () => {
    const ys = [3, -1, 4, 0.5];
    xs.forEach((x, i) => {
      expect(keyed(x, xs, ys)).toBeCloseTo(ys[i] as number, 12);
    });
  });

  it('is flat before the first key and after the last', () => {
    const ys = [3, -1, 4, 0.5];
    expect(keyed(-5, xs, ys)).toBe(3);
    expect(keyed(0, xs, ys)).toBe(3);
    expect(keyed(1, xs, ys)).toBe(0.5);
    expect(keyed(7, xs, ys)).toBe(0.5);
  });

  it('is monotone between monotone keys and passes a middle key without stopping', () => {
    const ys = [0, 1, 5, 6];
    let prev = Number.NEGATIVE_INFINITY;
    for (let i = 0; i <= 1000; i++) {
      const v = keyed(i / 1000, xs, ys);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
    // the slope at the middle keys is not zero
    expect(keyed(0.2 + 1e-4, xs, ys) - keyed(0.2 - 1e-4, xs, ys)).toBeGreaterThan(1e-4);
    const down = [6, 5, 1, 0];
    prev = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 1000; i++) {
      const v = keyed(i / 1000, xs, down);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
  });

  it('never overshoots its keys (steep and flat stretches, a stop at a turning key)', () => {
    for (const ys of [
      [0, 0, 10, 10],
      [0, 10, 10.5, 11],
      [0, 8, 1, 9],
      [2, 2, 2, 2],
    ]) {
      for (let i = 0; i < 3; i++) {
        const lo = Math.min(ys[i] as number, ys[i + 1] as number) - 1e-9;
        const hi = Math.max(ys[i] as number, ys[i + 1] as number) + 1e-9;
        for (let j = 0; j <= 200; j++) {
          const x = (xs[i] as number) + (((xs[i + 1] as number) - (xs[i] as number)) * j) / 200;
          const v = keyed(x, xs, ys);
          expect(v).toBeGreaterThanOrEqual(lo);
          expect(v).toBeLessThanOrEqual(hi);
        }
      }
    }
  });
});
