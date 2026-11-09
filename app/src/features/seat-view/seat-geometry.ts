import * as THREE from 'three';

/**
 * One merged mesh for a cinema seat facing -z (toward the screen): cushion, two armrests, a
 * backrest that leans back with a headrest, and a pedestal. The backrest's top sits just below
 * the eye of someone seated behind, so rows ahead fill the bottom of the frame.
 */
export function createSeatGeometry(): THREE.BufferGeometry {
  const cushion = new THREE.BoxGeometry(0.4, 0.14, 0.46).translate(0, 0.42, -0.02);
  const armL = new THREE.BoxGeometry(0.06, 0.07, 0.4).translate(-0.235, 0.63, 0.0);
  const armR = new THREE.BoxGeometry(0.06, 0.07, 0.4).translate(0.235, 0.63, 0.0);
  const armPostL = new THREE.BoxGeometry(0.05, 0.22, 0.05).translate(-0.235, 0.5, 0.1);
  const armPostR = new THREE.BoxGeometry(0.05, 0.22, 0.05).translate(0.235, 0.5, 0.1);
  const back = new THREE.BoxGeometry(0.44, 0.52, 0.09).rotateX(-0.12).translate(0, 0.74, 0.22);
  const head = new THREE.BoxGeometry(0.3, 0.17, 0.09).rotateX(-0.12).translate(0, 1.08, 0.255);
  const base = new THREE.BoxGeometry(0.1, 0.35, 0.1).translate(0, 0.175, 0.05);
  const parts = [cushion, armL, armR, armPostL, armPostR, back, head, base];

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
