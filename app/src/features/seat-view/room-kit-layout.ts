import { ROOM_KITS } from './room-kits';

/**
 * Where the room kits' modules go in one hall. Pure: it returns instance transforms, HallRoom
 * draws them. The kits (assets/models/rooms) are modular: tiles, fixtures and trims at the
 * origin, placed here by the conventions their generator (build_rooms.py) documents:
 *
 *  - Wall-mounted modules (panels, base, sconces, speakers, exit signs, borders, curtain) have
 *    their back on the plane x = 0, face +X, and a tile runs toward -Z with its origin at the
 *    bottom-left corner. Left side wall: no rotation. Right side wall: 180 degrees about Y.
 *    Back wall (face -Z): +90 degrees. Screen wall (face +Z): -90 degrees, the tile then runs +X.
 *  - Carpet / ceiling panel: x, z in [0, 1]. The panel's visible face is its local y = 0.
 *  - Step nosing / step light face -Z, riser plane z = 0.
 *
 * The room's planes are the camera collision's (room-layout.ts): side walls at x = +-half,
 * back wall at z = depth, ceiling at y = wallH, the screen wall at z = 0, the floor the steps.
 */

export type KitName = 'standard' | 'imax' | 'dolby';

/** The IMAX kit for an IMAX showtime, the standard room for everything else. */
export function kitOf(format: string | undefined): KitName {
  return format === 'IMAX' ? 'imax' : 'standard';
}

/** One placed module: position, turn about Y (then Z for the ceiling speakers) and scale. */
export type Instance = {
  x: number;
  y: number;
  z: number;
  ry: number;
  /** Turn about Z, applied before `ry`. Only the dolby ceiling speaker arrays use it. */
  rz?: number;
  sx: number;
  sy: number;
  sz: number;
};

type Step = { from: number; to: number; height: number };

export type RoomInput = {
  half: number;
  depth: number;
  wallH: number;
  screen: { width: number; height: number; x: number; bottom: number };
  steps: readonly Step[];
  /** x of the aisles between seat blocks. */
  aisleXs: readonly number[];
  seats: readonly { x_m: number }[];
};

/**
 * Instances per layout key. A key is a kit module name, or 'SpeakerCeiling' (the dolby kit's
 * ceiling arrays: the Speaker module, kept apart so they can be hidden from above).
 */
export type RoomLayout = Record<string, Instance[]>;

/** The module a layout key draws. */
/** Layout keys that reuse another module: ceiling speakers, and the black masking under the screen. */
export const moduleOf = (key: string) =>
  key === 'SpeakerCeiling' ? 'Speaker' : key === 'MaskFill' ? 'ScreenBorderH' : key;

type Box = { min: [number, number, number]; max: [number, number, number] };

type Rect = { x0: number; x1: number; y0: number; y1: number };

const PI = Math.PI;
/** Side wall panels and base are cut to about a metre along the wall (and no taller than ~2 m). */
const TILE_M = 1;
const TILE_H_M = 2;
/** The screen wall's masking border width, per kit (standard: velvet; imax/dolby: thin). */
const BORDER_M: Record<KitName, number> = { standard: 0.5, imax: 0.15, dolby: 0.15 };
/** Curtain valance above the masking. */
const VALANCE_M = 1.25;
/** Seat half width plus a margin: where an aisle's walkable gap starts. */
const SEAT_EDGE_M = 0.3;
/** Thickness of the wall panels: the walkway ends before it. */
const PANEL_M = 0.04;
/** The visible face of a ceiling panel sits this far below the ceiling plane (its body is above it). */
const CEILING_BODY_M = 0.03;
/** Carpet tile top sits just under the step's top, so the nosing reads as the edge. */
export const CARPET_SINK_M = 0.004;
export const CARPET_THICK_M = 0.01;
const SPEAKER_SIDE_PITCH: Record<KitName, number> = { standard: 3.5, imax: 3, dolby: 2.25 };

const bounds = (kit: KitName, module: string): Box => {
  const m = (ROOM_KITS[kit].modules as unknown as Record<string, { bounds: Box }>)[module];
  if (!m) throw new Error(`kit ${kit} has no module ${module}`);
  return m.bounds;
};
const has = (kit: KitName, module: string) => module in ROOM_KITS[kit].modules;

/** Evenly split `len` into about `target` m pieces: count and exact pitch (no gaps, no overlaps). */
function split(len: number, target: number): { n: number; pitch: number } {
  const n = Math.max(1, Math.round(len / target));
  return { n, pitch: len / n };
}

/** Floor height at z (the step under it). */
export function floorAt(steps: readonly Step[], z: number): number {
  for (const s of steps) if (z >= s.from && z <= s.to) return s.height;
  return 0;
}
/** The lowest floor between two z (a tile that spans steps sits on the lowest). */
function floorMin(steps: readonly Step[], z0: number, z1: number): number {
  let h = Number.POSITIVE_INFINITY;
  for (const s of steps) if (s.to >= z0 && s.from <= z1) h = Math.min(h, s.height);
  return Number.isFinite(h) ? h : 0;
}

type Walkway = { c: number; hw: number; side: boolean };

/** Aisles as walkable gaps: the interior aisles, and the strips between the seats and the walls. */
export function walkways(input: RoomInput): Walkway[] {
  const { half, aisleXs, seats } = input;
  const xs = seats.map((s) => s.x_m);
  const out: Walkway[] = [];
  for (const c of aisleXs) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const x of xs) nearest = Math.min(nearest, Math.abs(x - c));
    const hw = Math.min(1.2, nearest - SEAT_EDGE_M);
    if (Number.isFinite(hw) && hw >= 0.15) out.push({ c, hw, side: false });
  }
  if (xs.length) {
    const lo = Math.min(...xs) - SEAT_EDGE_M;
    const hi = Math.max(...xs) + SEAT_EDGE_M;
    const wallL = -half + PANEL_M;
    const wallR = half - PANEL_M;
    if (lo - wallL >= 0.5) out.push({ c: (lo + wallL) / 2, hw: (lo - wallL) / 2, side: true });
    if (wallR - hi >= 0.5) out.push({ c: (hi + wallR) / 2, hw: (wallR - hi) / 2, side: true });
  }
  return out;
}

/** The open part of the screen wall: the screen and its masking border. */
export function screenOpening(kit: KitName, input: RoomInput): Rect {
  const { half, wallH, screen } = input;
  const sx0 = screen.x - screen.width / 2;
  const sx1 = screen.x + screen.width / 2;
  const bw = Math.max(0.05, Math.min(BORDER_M[kit], half - Math.max(Math.abs(sx0), Math.abs(sx1))));
  return {
    x0: Math.max(-half, sx0 - bw),
    x1: Math.min(half, sx1 + bw),
    y0: Math.max(0, screen.bottom - bw),
    y1: Math.min(wallH, screen.bottom + screen.height + bw),
  };
}

/** The screen's own rectangle on the wall. */
export function screenRect(input: RoomInput): Rect {
  const { screen } = input;
  return {
    x0: screen.x - screen.width / 2,
    x1: screen.x + screen.width / 2,
    y0: screen.bottom,
    y1: screen.bottom + screen.height,
  };
}

/**
 * The world box of one placed module (turn about Z, then Y, then the scale first; the module
 * boxes are in their native frame). For tests and for checking a layout stays inside the room.
 */
export function instanceBox(kit: KitName, key: string, inst: Instance): Box {
  const b = bounds(kit, moduleOf(key));
  const min: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  const cz = Math.cos(inst.rz ?? 0);
  const sz_ = Math.sin(inst.rz ?? 0);
  const cy = Math.cos(inst.ry);
  const sy_ = Math.sin(inst.ry);
  for (const px of [b.min[0], b.max[0]]) {
    for (const py of [b.min[1], b.max[1]]) {
      for (const pz of [b.min[2], b.max[2]]) {
        let x = px * inst.sx;
        let y = py * inst.sy;
        const z = pz * inst.sz;
        // about Z
        [x, y] = [x * cz - y * sz_, x * sz_ + y * cz];
        // about Y
        const rx = x * cy + z * sy_;
        const rz = -x * sy_ + z * cy;
        const w = [rx + inst.x, y + inst.y, rz + inst.z];
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i] as number, w[i] as number);
          max[i] = Math.max(max[i] as number, w[i] as number);
        }
      }
    }
  }
  return { min, max };
}

/** Lay the kit's modules into a hall of this size: instance transforms per module. */
export function layoutRoom(kit: KitName, input: RoomInput): RoomLayout {
  const { half, depth, wallH, steps } = input;
  const out: RoomLayout = {};
  const add = (key: string, inst: Instance) => {
    if (!has(kit, moduleOf(key))) return;
    let list = out[key];
    if (!list) {
      list = [];
      out[key] = list;
    }
    list.push(inst);
  };
  const open = screenOpening(kit, input);
  const screen = screenRect(input);
  const width = half * 2;

  // ---- floor: carpet tiles over each step, step nosing and lights on its edge ---------------
  const cols = split(width, TILE_M);
  const ways = walkways(input);
  steps.forEach((s, i) => {
    const rows = split(s.to - s.from, TILE_M);
    for (let a = 0; a < cols.n; a++) {
      for (let b = 0; b < rows.n; b++) {
        add('Carpet', {
          x: -half + a * cols.pitch,
          y: s.height - CARPET_SINK_M,
          z: s.from + b * rows.pitch,
          ry: 0,
          sx: cols.pitch,
          sy: 1,
          sz: rows.pitch,
        });
      }
    }
    if (i === 0 || s.from < 0.05) return;
    const prev = steps[i - 1] as Step;
    const riser = s.height - prev.height;
    if (kit === 'dolby') {
      add('StepNosing', {
        x: -half + PANEL_M,
        y: s.height,
        z: s.from,
        ry: 0,
        sx: width - 2 * PANEL_M,
        sy: 1,
        sz: 1,
      });
    }
    for (const w of ways) {
      if (kit !== 'dolby') {
        add('StepNosing', {
          x: w.c - w.hw,
          y: s.height,
          z: s.from,
          ry: 0,
          sx: w.hw * 2,
          sy: 1,
          sz: 1,
        });
      }
      if (riser >= 0.1) {
        for (const e of [-1, 1]) {
          add('StepLight', {
            x: w.c + e * (w.hw - 0.07),
            y: prev.height + riser / 2,
            z: s.from,
            ry: 0,
            sx: 1,
            sy: 1,
            sz: 1,
          });
        }
      }
    }
  });

  // ---- side walls: panels and base, one tile per metre -------------------------------------
  const along = split(depth, TILE_M);
  const up = split(wallH, TILE_H_M);
  const baseH = has(kit, 'WallBase') ? bounds(kit, 'WallBase').max[1] : 0;
  for (const side of [-1, 1]) {
    const left = side < 0;
    for (let k = 0; k < along.n; k++) {
      const z0 = k * along.pitch;
      const z1 = z0 + along.pitch;
      // the tile's origin is its -Z end for the left wall, its +Z end... (turned 180) the other
      const z = left ? z1 : z0;
      for (let r = 0; r < up.n; r++) {
        add('WallPanel', {
          x: side * half,
          y: r * up.pitch,
          z,
          ry: left ? 0 : PI,
          sx: 1,
          sy: up.pitch,
          sz: along.pitch,
        });
      }
      add('WallBase', {
        x: side * half,
        y: floorMin(steps, z0, z1),
        z,
        ry: left ? 0 : PI,
        sx: 1,
        sy: 1,
        sz: along.pitch,
      });
    }
  }

  // ---- back wall (faces the screen) --------------------------------------------------------
  const backCols = split(width, TILE_M);
  for (let k = 0; k < backCols.n; k++) {
    const x = half - k * backCols.pitch;
    for (let r = 0; r < up.n; r++) {
      add('WallPanel', {
        x,
        y: r * up.pitch,
        z: depth,
        ry: PI / 2,
        sx: 1,
        sy: up.pitch,
        sz: backCols.pitch,
      });
    }
    add('WallBase', {
      x,
      y: floorAt(steps, depth),
      z: depth,
      ry: PI / 2,
      sx: 1,
      sy: 1,
      sz: backCols.pitch,
    });
  }

  // ---- screen wall: covering beside, above and below the screen's opening -------------------
  const valanceTop = Math.min(open.y1 + VALANCE_M, wallH);
  // `black`: the velvet masking (ScreenBorderH, 0.5 m tall tiles) stretched over the area.
  const cover = (r: Rect, curtain: boolean, black = false) => {
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    if (w < 0.01 || h < 0.01) return;
    const key = black
      ? 'MaskFill'
      : curtain && w >= 0.4 && h >= 0.3 && has(kit, 'Curtain')
        ? 'Curtain'
        : 'WallPanel';
    const nx = split(w, TILE_M);
    const ny = split(h, key === 'WallPanel' ? TILE_H_M : TILE_M);
    for (let a = 0; a < nx.n; a++) {
      for (let b = 0; b < ny.n; b++) {
        add(key, {
          x: r.x0 + a * nx.pitch,
          y: r.y0 + b * ny.pitch,
          z: 0,
          ry: -PI / 2,
          sx: 1,
          sy: key === 'MaskFill' ? ny.pitch / 0.5 : ny.pitch,
          sz: nx.pitch,
        });
      }
    }
  };
  const curtain = kit === 'standard';
  if (curtain) {
    cover({ x0: -half, x1: open.x0, y0: 0, y1: valanceTop }, true);
    cover({ x0: open.x1, x1: half, y0: 0, y1: valanceTop }, true);
    // under the screen: black masking, as in a real hall (not curtain)
    cover({ x0: open.x0, x1: open.x1, y0: 0, y1: open.y0 }, false, true);
    cover({ x0: open.x0, x1: open.x1, y0: open.y1, y1: valanceTop }, true);
    cover({ x0: -half, x1: half, y0: valanceTop, y1: wallH }, false);
  } else {
    cover({ x0: -half, x1: open.x0, y0: 0, y1: wallH }, false);
    cover({ x0: open.x1, x1: half, y0: 0, y1: wallH }, false);
    cover({ x0: open.x0, x1: open.x1, y0: 0, y1: open.y0 }, false);
    cover({ x0: open.x0, x1: open.x1, y0: open.y1, y1: wallH }, false);
  }
  // Masking: the border module (a box 0.5 m wide, 1 m long) stretched into the ring around the screen.
  const bh = bounds(kit, 'ScreenBorderH');
  const bHigh = bh.max[1] - bh.min[1];
  const bLong = bh.max[2] - bh.min[2];
  const border = (r: Rect) => {
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    if (w < 0.01 || h < 0.01) return;
    add('ScreenBorderH', {
      x: r.x0,
      y: r.y0,
      z: 0,
      ry: -PI / 2,
      sx: 1,
      sy: h / bHigh,
      sz: w / bLong,
    });
  };
  border({ x0: open.x0, x1: open.x1, y0: screen.y1, y1: open.y1 });
  border({ x0: open.x0, x1: open.x1, y0: open.y0, y1: screen.y0 });
  border({ x0: open.x0, x1: screen.x0, y0: screen.y0, y1: screen.y1 });
  border({ x0: screen.x1, x1: open.x1, y0: screen.y0, y1: screen.y1 });
  // base along the screen wall, except where it would run into the opening
  const baseY = floorAt(steps, 0.01);
  const baseCols = split(width, TILE_M);
  for (let k = 0; k < baseCols.n; k++) {
    const x0 = -half + k * baseCols.pitch;
    const x1 = x0 + baseCols.pitch;
    const inOpening = x1 > open.x0 && x0 < open.x1;
    if (inOpening && baseY + baseH > open.y0) continue;
    add('WallBase', { x: x0, y: baseY, z: 0, ry: -PI / 2, sx: 1, sy: 1, sz: baseCols.pitch });
  }

  // ---- ceiling ----------------------------------------------------------------------------
  const ceilX = split(width, TILE_M);
  const ceilZ = split(depth, TILE_M);
  for (let a = 0; a < ceilX.n; a++) {
    for (let b = 0; b < ceilZ.n; b++) {
      add('CeilingPanel', {
        x: -half + a * ceilX.pitch,
        y: wallH - CEILING_BODY_M,
        z: b * ceilZ.pitch,
        ry: 0,
        sx: ceilX.pitch,
        sy: 1,
        sz: ceilZ.pitch,
      });
    }
  }
  // downlights: about one per 25 m2, on a grid
  const wanted = Math.min(10, Math.max(1, Math.round((width * depth) / 25)));
  const dCols = Math.max(1, Math.round(Math.sqrt((wanted * width) / depth)));
  const dRows = Math.max(1, Math.round(wanted / dCols));
  for (let a = 0; a < dCols; a++) {
    for (let b = 0; b < dRows; b++) {
      add('Downlight', {
        x: -half + (width * (a + 0.5)) / dCols,
        y: wallH - CEILING_BODY_M,
        z: (depth * (b + 0.5)) / dRows,
        ry: 0,
        sx: 1,
        sy: 1,
        sz: 1,
      });
    }
  }

  // ---- fixtures on the side walls -----------------------------------------------------------
  // sconces: standard only; every 4.5 m at most, from 3 m off the screen to 2 m before the back wall
  if (kit === 'standard') {
    const span = depth - 5;
    const n = span < 0 ? 0 : Math.ceil(span / 4.5) + 1;
    for (let i = 0; i < n; i++) {
      const z = n === 1 ? 3 : 3 + (span * i) / (n - 1);
      for (const side of [-1, 1]) {
        add('Sconce', {
          x: side * half,
          y: floorAt(steps, z) + 2.6,
          z,
          ry: side < 0 ? 0 : PI,
          sx: 1,
          sy: 1,
          sz: 1,
        });
      }
    }
  }
  // speakers: side surrounds; dolby also has two ceiling arrays
  const sp = split(depth, SPEAKER_SIDE_PITCH[kit]);
  const spH = bounds(kit, 'Speaker');
  const spHalfH = (spH.max[1] - spH.min[1]) / 2;
  const spY: Record<KitName, number> = { standard: 3.6, imax: 5.5, dolby: 4 };
  for (let i = 0; i < sp.n; i++) {
    const z = (i + 0.5) * sp.pitch;
    const y = Math.min(floorAt(steps, z) + spY[kit], wallH - spHalfH - 0.2);
    for (const side of [-1, 1]) {
      add('Speaker', { x: side * half, y, z, ry: side < 0 ? 0 : PI, sx: 1, sy: 1, sz: 1 });
    }
  }
  if (kit === 'dolby') {
    const arrays = split(depth, 2.75);
    for (let i = 0; i < arrays.n; i++) {
      for (const side of [-1, 1]) {
        add('SpeakerCeiling', {
          x: side * (width / 4),
          y: wallH - CEILING_BODY_M,
          z: (i + 0.5) * arrays.pitch,
          ry: 0,
          rz: -PI / 2,
          sx: 1,
          sy: 1,
          sz: 1,
        });
      }
    }
  }
  // exit signs: the rear corners and near the screen, never dimmed
  for (const side of [-1, 1]) {
    for (const z of [depth - 1, Math.min(1.5, depth / 2)]) {
      add('ExitSign', {
        x: side * half,
        y: floorAt(steps, z) + 2.3,
        z,
        ry: side < 0 ? 0 : PI,
        sx: 1,
        sy: 1,
        sz: 1,
      });
    }
  }

  return out;
}

export type WashLight = { x: number; y: number; z: number; color: string; intensity: number };

/**
 * The few real lights the room adds (the rest is emissive meshes): standard, a warm wash from
 * the sconces (dimmed to their show level), dolby, a blue-violet wash low on the side walls,
 * imax none. `intensity` is the level while a film plays; the scene scales it with the dive.
 */
export function washLights(kit: KitName, input: RoomInput): WashLight[] {
  const { half, depth, steps } = input;
  if (kit === 'imax') return [];
  const z = depth * 0.45;
  const floor = floorAt(steps, z);
  const color = kit === 'standard' ? '#FFA757' : '#5B4BFF';
  const intensity = kit === 'standard' ? 40 : 30;
  const y = floor + (kit === 'standard' ? 2.8 : 0.6);
  return [-1, 1].map((side) => ({ x: side * (half - 0.7), y, z, color, intensity }));
}

/**
 * What a layout costs to draw: triangles of the kit's modules, and draw calls (one per module
 * group, plus the screen's three layers and the step boxes, 4). Step boxes' own 12 triangles each
 * are left out.
 */
export function roomBudget(kit: KitName, layout: RoomLayout): { tris: number; draws: number } {
  let tris = 0;
  let draws = 4;
  for (const [key, list] of Object.entries(layout)) {
    if (!list.length) continue;
    const m = (
      ROOM_KITS[kit].modules as unknown as Record<
        string,
        { tris: number; solid?: object; glow?: object }
      >
    )[moduleOf(key)];
    if (!m) continue;
    tris += m.tris * list.length;
    draws += (m.solid ? 1 : 0) + (m.glow ? 1 : 0);
  }
  return { tris, draws };
}
