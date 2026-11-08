import * as THREE from 'three';

/** One merged mesh for a seat: cushion plus backrest, facing -z (toward the screen). */
export function createSeatGeometry(): THREE.BufferGeometry {
  const cushion = new THREE.BoxGeometry(0.46, 0.14, 0.46).translate(0, 0.42, 0);
  const back = new THREE.BoxGeometry(0.46, 0.5, 0.1).translate(0, 0.65, 0.2);
  const base = new THREE.BoxGeometry(0.12, 0.35, 0.12).translate(0, 0.175, 0.02);
  const parts = [cushion, back, base];

  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (const g of parts) {
    const offset = pos.length / 3;
    for (const v of g.getAttribute('position').array) pos.push(v);
    for (const v of g.getAttribute('normal').array) nor.push(v);
    for (const i of g.getIndex()?.array ?? []) idx.push(i + offset);
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  merged.setIndex(idx);
  return merged;
}
