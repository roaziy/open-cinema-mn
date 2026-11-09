// Turns assets/models/cinema-seat.glb into src/features/seat-view/seat-model.ts: the seat's
// fabric and shell and the divider between seats as plain arrays (base64), so the app needs no
// model loader at runtime. Run after changing the model:  node scripts/seat-model.mjs
//
// The GLB itself comes from scripts/seat-model-split.py (Blender), which cuts one `Seat` and one
// `Arm` out of the source model. Meshes are turned 180 degrees about y: the model faces +z, the
// hall's seats face -z (the screen).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const glb = readFileSync(join(root, 'assets/models/cinema-seat.glb'));
const jsonLen = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen + 8;
const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLen));

const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function read(accessorIndex) {
  const a = gltf.accessors[accessorIndex];
  const view = gltf.bufferViews[a.bufferView];
  const n = SIZE[a.type];
  const bytes = { 5126: 4, 5123: 2, 5125: 4, 5121: 1 }[a.componentType];
  const stride = view.byteStride ?? n * bytes;
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = [];
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < n; c++) {
      const at = base + i * stride + c * bytes;
      out.push(
        a.componentType === 5126
          ? bin.readFloatLE(at)
          : a.componentType === 5123
            ? bin.readUInt16LE(at)
            : a.componentType === 5125
              ? bin.readUInt32LE(at)
              : bin.readUInt8(at),
      );
    }
  }
  return out;
}

/** Column-major 4x4 of a node (translation, rotation quaternion, scale). */
function local(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const parentOf = new Map();
gltf.nodes.forEach((n, i) => {
  for (const c of n.children ?? []) parentOf.set(c, i);
});
function world(i) {
  const m = local(gltf.nodes[i]);
  return parentOf.has(i) ? mul(world(parentOf.get(i)), m) : m;
}

/** One group: merged positions/normals/indices of the given primitives, baked and turned round. */
function group(prims) {
  const pos = [];
  const nor = [];
  const idx = [];
  for (const { prim, m } of prims) {
    const offset = pos.length / 3;
    const p = read(prim.attributes.POSITION);
    const q = read(prim.attributes.NORMAL);
    for (let i = 0; i < p.length; i += 3) {
      const [x, y, z] = [p[i], p[i + 1], p[i + 2]];
      const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
      pos.push(-wx, wy, -wz);
      const [a, b, c] = [q[i], q[i + 1], q[i + 2]];
      let nx = m[0] * a + m[4] * b + m[8] * c;
      let ny = m[1] * a + m[5] * b + m[9] * c;
      let nz = m[2] * a + m[6] * b + m[10] * c;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      nor.push(-nx, ny, -nz);
    }
    const ix = prim.indices != null ? read(prim.indices) : p.map((_, j) => j).filter((j) => j < p.length / 3);
    for (const v of ix) idx.push(v + offset);
  }
  if (pos.length / 3 > 65535) throw new Error('too many vertices for 16-bit indices');
  const b64 = (arr, T) => Buffer.from(new T(arr).buffer).toString('base64');
  return {
    tris: idx.length / 3,
    data: {
      position: b64(pos, Float32Array),
      normal: b64(nor, Float32Array),
      index: b64(idx, Uint16Array),
    },
    pos,
  };
}

function primsOf(nodeName, keep) {
  const i = gltf.nodes.findIndex((n) => n.name === nodeName);
  if (i < 0) throw new Error(`no node ${nodeName}`);
  const mesh = gltf.meshes[gltf.nodes[i].mesh];
  const m = world(i);
  return mesh.primitives
    .filter((prim) => keep(gltf.materials[prim.material]?.name ?? ''))
    .map((prim) => ({ prim, m }));
}

const isFabric = (name) => name.startsWith('Fabric');
const fabric = group(primsOf('Seat', isFabric));
const shell = group(primsOf('Seat', (n) => !isFabric(n)));
const arm = group(primsOf('Arm', () => true));

const xs = [...fabric.pos, ...shell.pos].filter((_, j) => j % 3 === 0);
const width = Math.max(...xs) - Math.min(...xs);
const r3 = (v) => Math.round(v * 1000) / 1000;

const out = `// Generated by scripts/seat-model.mjs from assets/models/cinema-seat.glb. Do not edit.
/**
 * A cinema seat (its fabric and its shell) and the divider between two seats, in metres: floor
 * at y = 0, centred on x = 0, facing -z (toward the screen). Arrays are little-endian base64
 * (positions and normals Float32 xyz, indices Uint16). ${fabric.tris + shell.tris} triangles a seat, ${arm.tris} a divider.
 */
export const SEAT_MODEL = {
  /** Seat spacing the model was made for, centre to centre. */
  pitch: 0.57,
  /** Width of the seat (its back shell). */
  width: ${r3(width)},
  fabric: ${JSON.stringify(fabric.data)},
  shell: ${JSON.stringify(shell.data)},
  arm: ${JSON.stringify(arm.data)},
} as const;
`;
writeFileSync(join(root, 'src/features/seat-view/seat-model.ts'), out);
console.log(`seat ${fabric.tris}+${shell.tris} tris, arm ${arm.tris} tris, width ${r3(width)} m, ${(out.length / 1024).toFixed(0)} KB`);
