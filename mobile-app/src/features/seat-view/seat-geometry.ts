import * as THREE from 'three';
import { SEAT_MODEL } from './seat-model';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(128);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

/** Base64 to bytes (no atob needed). */
export function fromBase64(s: string): Uint8Array {
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n =
      ((LOOKUP[s.charCodeAt(i)] as number) << 18) |
      ((LOOKUP[s.charCodeAt(i + 1)] as number) << 12) |
      ((LOOKUP[s.charCodeAt(i + 2)] as number) << 6) |
      (LOOKUP[s.charCodeAt(i + 3)] as number);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

type Part = { readonly position: string; readonly normal: string; readonly index: string };

function partGeometry(p: Part): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(fromBase64(p.position).buffer), 3),
  );
  g.setAttribute(
    'normal',
    new THREE.BufferAttribute(new Float32Array(fromBase64(p.normal).buffer), 3),
  );
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(fromBase64(p.index).buffer), 1));
  return g;
}

/** How bright the shell is next to the fabric in the one-colour (held seat) version. */
const SHELL_SHADE = 0.35;

/** Fabric and shell in one geometry, shaded by a colour attribute (the held seats' accent version). */
function wholeSeat(
  fabric: THREE.BufferGeometry,
  shell: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const [g, shade] of [
    [fabric, 1],
    [shell, SHELL_SHADE],
  ] as const) {
    const offset = pos.length / 3;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(shade, shade, shade);
    }
    for (const i of g.getIndex()?.array ?? []) idx.push(i + offset);
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  merged.setIndex(idx);
  return merged;
}

export type SeatParts = {
  /** The seat's upholstery (its colour shows the seat's state). */
  fabric: THREE.BufferGeometry;
  /** The seat's back shell and pan. */
  shell: THREE.BufferGeometry;
  /** Both, shaded, for the held seats' accent version. */
  whole: THREE.BufferGeometry;
  /** The divider between two seats (armrest, leg, foot). */
  arm: THREE.BufferGeometry;
};

/** The cinema seat model (see seat-model.ts), facing -z, floor at y = 0. */
export function createSeatParts(): SeatParts {
  const fabric = partGeometry(SEAT_MODEL.fabric);
  const shell = partGeometry(SEAT_MODEL.shell);
  return { fabric, shell, whole: wholeSeat(fabric, shell), arm: partGeometry(SEAT_MODEL.arm) };
}

/** Seat spacing the model was made for and its width, metres. */
export const MODEL_PITCH = SEAT_MODEL.pitch;
export const MODEL_SEAT_WIDTH = SEAT_MODEL.width;
