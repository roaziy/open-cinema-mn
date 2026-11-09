// Turns the three room kits (assets/models/rooms/room-{standard,imax,dolby}.glb, made by
// assets/models/rooms/build_rooms.py in Blender) into src/features/seat-view/room-kits.ts: every
// module as plain arrays (base64), so the app needs no model loader at runtime, and the kits'
// light empties as data. Also extracts the standard kit's carpet texture. Run after changing a kit:
//   node scripts/room-kits.mjs && npx biome format --write src/features/seat-view/room-kits.ts
//
// Per module the converter emits up to two draw groups:
//   solid  the lit surfaces: positions, normals, colour = baseColor x baked AO (COLOR_0), and for
//          the carpet its UVs. Colours are linear (three treats vertex colours as linear).
//   glow   the emissive surfaces, drawn unlit: colour = emissive colour x min(strength, 2).
// Modules keep their native orientation; the layout rotates them into place.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KITS = ['standard', 'imax', 'dolby'];
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const BYTES = { 5126: 4, 5123: 2, 5125: 4, 5121: 1, 5120: 1, 5122: 2 };
const MAX_EMISSIVE = 2;

function load(file) {
  const glb = readFileSync(file);
  const jsonLen = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLen));
  return { gltf, bin };
}

function reader({ gltf, bin }) {
  return (accessorIndex) => {
    const a = gltf.accessors[accessorIndex];
    const view = gltf.bufferViews[a.bufferView];
    const n = SIZE[a.type];
    const bytes = BYTES[a.componentType];
    const stride = view.byteStride ?? n * bytes;
    const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out = [];
    for (let i = 0; i < a.count; i++) {
      for (let c = 0; c < n; c++) {
        const at = base + i * stride + c * bytes;
        let v;
        switch (a.componentType) {
          case 5126:
            v = bin.readFloatLE(at);
            break;
          case 5123:
            v = bin.readUInt16LE(at);
            if (a.normalized) v /= 65535;
            break;
          case 5125:
            v = bin.readUInt32LE(at);
            break;
          case 5121:
            v = bin.readUInt8(at);
            if (a.normalized) v /= 255;
            break;
          default:
            throw new Error(`component type ${a.componentType}`);
        }
        out.push(v);
      }
    }
    return { data: out, n };
  };
}

/** Column-major 4x4 of a node (translation, rotation quaternion, scale). */
function local(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

const b64 = (arr, T) => Buffer.from(new T(arr).buffer).toString('base64');
const r4 = (v) => Math.round(v * 10000) / 10000;

/** A growing set of vertices and triangles. */
function bucket() {
  return { pos: [], nor: [], col: [], uv: [], idx: [], hasUv: false };
}

function finish(b, withUv) {
  if (b.idx.length === 0) return undefined;
  if (b.pos.length / 3 > 65535) throw new Error('too many vertices for 16-bit indices');
  const out = {
    position: b64(b.pos, Float32Array),
    ...(b.nor.length ? { normal: b64(b.nor, Float32Array) } : {}),
    color: b64(b.col, Float32Array),
    ...(withUv && b.uv.length ? { uv: b64(b.uv, Float32Array) } : {}),
    index: b64(b.idx, Uint16Array),
  };
  return out;
}

function convert(file) {
  const model = load(file);
  const { gltf } = model;
  const read = reader(model);
  const modules = {};
  const lights = [];
  const stats = { tris: {} };

  for (const node of gltf.nodes) {
    if (node.mesh == null && node.extras?.type) {
      // A light empty: Light_<Module>_<n>
      const kind = node.name.split('_')[1];
      const e = node.extras;
      const [x, y, z] = node.translation ?? [0, 0, 0];
      lights.push({
        module: kind,
        type: e.type,
        color: e.color,
        intensity: e.intensity,
        ...(e.range != null ? { range: e.range } : {}),
        ...(e.angle != null ? { angle: e.angle } : {}),
        ...(e.aim != null ? { aim: e.aim } : {}),
        ...(e.show_dim != null ? { showDim: e.show_dim } : {}),
        ...(e.width != null ? { width: e.width, height: e.height } : {}),
        position: [r4(x), r4(y), r4(z)],
      });
      continue;
    }
    if (node.mesh == null) continue;
    const m = local(node);
    const solid = bucket();
    const glow = bucket();
    let doubleSided = false;
    let textured = false;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const prim of gltf.meshes[node.mesh].primitives) {
      const mat = gltf.materials[prim.material] ?? {};
      const emissive = mat.emissiveFactor ?? [0, 0, 0];
      const isGlow = emissive.some((v) => v > 0);
      const strength = Math.min(
        mat.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1,
        MAX_EMISSIVE,
      );
      const base = mat.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
      if (mat.doubleSided) doubleSided = true;
      const b = isGlow ? glow : solid;
      const offset = b.pos.length / 3;
      const P = read(prim.attributes.POSITION).data;
      const N = read(prim.attributes.NORMAL).data;
      const C = prim.attributes.COLOR_0 != null ? read(prim.attributes.COLOR_0) : null;
      const hasTex = mat.pbrMetallicRoughness?.baseColorTexture != null;
      const UV =
        hasTex && prim.attributes.TEXCOORD_0 != null ? read(prim.attributes.TEXCOORD_0).data : null;
      if (hasTex) textured = true;
      for (let i = 0; i < P.length / 3; i++) {
        const [x, y, z] = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
        const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
        b.pos.push(wx, wy, wz);
        min[0] = Math.min(min[0], wx);
        min[1] = Math.min(min[1], wy);
        min[2] = Math.min(min[2], wz);
        max[0] = Math.max(max[0], wx);
        max[1] = Math.max(max[1], wy);
        max[2] = Math.max(max[2], wz);
        if (!isGlow) {
          const [a, bb, c] = [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
          let nx = m[0] * a + m[4] * bb + m[8] * c;
          let ny = m[1] * a + m[5] * bb + m[9] * c;
          let nz = m[2] * a + m[6] * bb + m[10] * c;
          const l = Math.hypot(nx, ny, nz) || 1;
          nx /= l;
          ny /= l;
          nz /= l;
          b.nor.push(nx, ny, nz);
        }
        if (isGlow) {
          b.col.push(emissive[0] * strength, emissive[1] * strength, emissive[2] * strength);
        } else {
          // baked ambient occlusion x base colour (both linear)
          const ao = C ? [C.data[i * C.n], C.data[i * C.n + 1], C.data[i * C.n + 2]] : [1, 1, 1];
          b.col.push(base[0] * ao[0], base[1] * ao[1], base[2] * ao[2]);
        }
        if (UV) b.uv.push(UV[i * 2], UV[i * 2 + 1]);
      }
      const ix = prim.indices != null ? read(prim.indices).data : P.map((_, j) => j);
      for (const v of ix) b.idx.push(v + offset);
    }
    const tris = (solid.idx.length + glow.idx.length) / 3;
    stats.tris[node.name] = tris;
    modules[node.name] = {
      tris,
      doubleSided,
      bounds: { min: min.map(r4), max: max.map(r4) },
      ...(solid.idx.length ? { solid: finish(solid, textured) } : {}),
      ...(glow.idx.length ? { glow: finish(glow, false) } : {}),
    };
  }
  return { modules, lights, stats, model };
}

const outDir = join(root, 'assets/models/rooms');
mkdirSync(outDir, { recursive: true });
const kits = {};
let report = '';
for (const name of KITS) {
  const { modules, lights, stats, model } = convert(join(outDir, `room-${name}.glb`));
  kits[name] = { modules, lights };
  report += `${name}: ${Object.keys(modules).length} modules, ${lights.length} lights, tris ${JSON.stringify(stats.tris)}\n`;
  if (name === 'standard') {
    const img = model.gltf.images?.[0];
    if (img) {
      const view = model.gltf.bufferViews[img.bufferView];
      const start = view.byteOffset ?? 0;
      const jpg = model.bin.subarray(start, start + view.byteLength);
      writeFileSync(join(outDir, 'carpet.jpg'), jpg);
      report += `carpet.jpg ${jpg.length} bytes\n`;
    }
  }
}

const body = JSON.stringify(kits);
const out = `// Generated by scripts/room-kits.mjs from assets/models/rooms/room-*.glb. Do not edit.
/**
 * The three room kits (standard, imax, dolby): every module as plain arrays, plus the kits'
 * light empties. Modules keep their native orientation (see assets/models/rooms/build_rooms.py
 * and room-kit-layout.ts for the conventions). Arrays are little-endian base64: positions,
 * normals, colours and uvs Float32, indices Uint16. 'solid' is the lit surface (colour = base
 * colour x baked AO, linear; the carpet also has uvs), 'glow' the emissive part (colour =
 * emissive x min(strength, ${MAX_EMISSIVE}), drawn unlit).
 */
export const ROOM_KITS = ${body} as const;
`;
writeFileSync(join(root, 'src/features/seat-view/room-kits.ts'), out);
console.log(`${report}room-kits.ts ${(out.length / 1024).toFixed(0)} KB`);
