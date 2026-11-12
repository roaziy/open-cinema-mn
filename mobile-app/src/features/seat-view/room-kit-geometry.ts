import * as THREE from 'three';
import type { KitName } from './room-kit-layout';
import { ROOM_KITS } from './room-kits';
import { fromBase64 } from './seat-geometry';

type Group = {
  readonly position: string;
  readonly normal?: string;
  readonly color: string;
  readonly uv?: string;
  readonly index: string;
};
type ModuleData = { readonly doubleSided: boolean; readonly solid?: Group; readonly glow?: Group };

const floats = (s: string) => new Float32Array(fromBase64(s).buffer);

function groupGeometry(g: Group): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(floats(g.position), 3));
  if (g.normal) geo.setAttribute('normal', new THREE.BufferAttribute(floats(g.normal), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(floats(g.color), 3));
  if (g.uv) geo.setAttribute('uv', new THREE.BufferAttribute(floats(g.uv), 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array(fromBase64(g.index).buffer), 1));
  return geo;
}

export type ModuleGeometry = {
  /** The lit surface: vertex colours (base colour x baked AO), linear. */
  solid?: THREE.BufferGeometry;
  /** The emissive part, drawn unlit. */
  glow?: THREE.BufferGeometry;
  doubleSided: boolean;
};

/** Every module of a kit as geometry, native orientation (see room-kit-layout.ts). */
export function createKitGeometry(kit: KitName): Record<string, ModuleGeometry> {
  const out: Record<string, ModuleGeometry> = {};
  const modules = ROOM_KITS[kit].modules as unknown as Record<string, ModuleData>;
  for (const [name, m] of Object.entries(modules)) {
    out[name] = {
      doubleSided: m.doubleSided,
      ...(m.solid ? { solid: groupGeometry(m.solid) } : {}),
      ...(m.glow ? { glow: groupGeometry(m.glow) } : {}),
    };
  }
  return out;
}

/** Free every geometry of a kit. */
export function disposeKitGeometry(parts: Record<string, ModuleGeometry>) {
  for (const p of Object.values(parts)) {
    p.solid?.dispose();
    p.glow?.dispose();
  }
}
