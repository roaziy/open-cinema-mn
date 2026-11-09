/* eslint-disable react/no-unknown-property -- react-three-fiber props */
import { SCREEN_BOTTOM_M } from '@open-cinema/shared';
import { useThree } from '@react-three/fiber/native';
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { rowsOf, type ScreenSource } from './camera-math';
import { palette } from './palette';
import { aisleCentres, aisleStrips, slatLayout } from './room-layout';
import { useScreenTexture } from './screen-texture';

/**
 * Side walls run past the camera (a seat sits beside them). One long quad crossing the near
 * plane rasterises as a dark wedge across the picture on some GPUs, so cut them into short ones.
 */
const WALL_SEGMENTS = 24;
/** The screen bows toward the audience by this share of its width. */
const SCREEN_BOW = 0.015;

const dummy = new THREE.Object3D();
const tint = new THREE.Color();

type Hall = { screen_width_m: number; screen_height_m: number; screen_x_m: number };
type Step = { from: number; to: number; height: number };
type SeatLike = { x_m: number; y_m: number; z_m: number; rowLabel: string };

type Props = {
  /** The screen group: the hand-off to the 2D map fades its three layers. */
  screenRef: RefObject<THREE.Group | null>;
  hall: Hall;
  seats: SeatLike[];
  drawable: SeatLike[];
  tone: string;
  screen: ScreenSource;
  steps: Step[];
  half: number;
  depth: number;
  wallH: number;
};

/** The room around the seats: screen in its mask, stepped floor with step lights, walls, ceiling, slats. */
export function HallRoom({
  screenRef,
  hall,
  seats,
  drawable,
  tone,
  screen,
  steps,
  half,
  depth,
  wallH,
}: Props) {
  const invalidate = useThree((s) => s.invalidate);
  const maxTexture = useThree((s) => s.gl.capabilities.maxTextureSize);
  const planeAspect = hall.screen_width_m / hall.screen_height_m;
  const texture = useScreenTexture(screen, planeAspect, maxTexture);
  const stepsRef = useRef<THREE.InstancedMesh>(null);
  const slatsRef = useRef<THREE.InstancedMesh>(null);
  const stripsRef = useRef<THREE.InstancedMesh>(null);

  const slats = useMemo(() => slatLayout(depth), [depth]);
  const strips = useMemo(
    () => aisleStrips(rowsOf(seats), aisleCentres(drawable.map((s) => s.x_m)), half),
    [seats, drawable, half],
  );
  const screenGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(hall.screen_width_m, hall.screen_height_m, 32, 1);
    const p = g.getAttribute('position');
    const hw = hall.screen_width_m / 2;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / hw;
      p.setZ(i, hall.screen_width_m * SCREEN_BOW * u * u);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }, [hall.screen_width_m, hall.screen_height_m]);
  useEffect(() => () => screenGeo.dispose(), [screenGeo]);
  useLayoutEffect(() => {
    const mesh = slatsRef.current;
    if (!mesh) return;
    const slatH = wallH - 1.6;
    slats.forEach((sl, i) => {
      for (const side of [0, 1]) {
        dummy.position.set((side ? 1 : -1) * (half - 0.07), 0.7 + slatH / 2, sl.z);
        dummy.scale.set(1, slatH, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i * 2 + side, dummy.matrix);
        tint.set(sl.shade ? palette.slatLight : palette.slatDark);
        mesh.setColorAt(i * 2 + side, tint);
      }
    });
    mesh.count = slats.length * 2;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [slats, half, wallH, invalidate]);
  useLayoutEffect(() => {
    const mesh = stripsRef.current;
    if (!mesh) return;
    strips.forEach((st, i) => {
      dummy.position.set(st.x, st.y, st.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.count = strips.length;
    mesh.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [strips, invalidate]);

  useLayoutEffect(() => {
    const mesh = stepsRef.current;
    if (!mesh) return;
    steps.forEach((st, i) => {
      dummy.position.set(0, st.height / 2, (st.from + st.to) / 2);
      dummy.scale.set(half * 2, st.height, st.to - st.from);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.count = steps.length;
    mesh.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [steps, half, invalidate]);

  return (
    <>
      {/* Screen: bowed, cover-cropped film image in a black mask, brightest thing in the room.
          Always upright: tilting it behind the front wall hid it during the dive. */}
      <group ref={screenRef} position={[hall.screen_x_m, SCREEN_BOTTOM_M, 0.12]}>
        <mesh position={[0, hall.screen_height_m / 2, 0]} geometry={screenGeo}>
          <meshBasicMaterial
            key={texture ? 'tex' : 'flat'}
            map={texture}
            color={texture ? '#FFFFFF' : tone}
            transparent
            toneMapped={false}
            fog={false}
          />
        </mesh>
        <mesh position={[0, hall.screen_height_m / 2, -0.04]}>
          <planeGeometry args={[hall.screen_width_m * 1.07, hall.screen_height_m * 1.12]} />
          <meshBasicMaterial color="#030304" transparent toneMapped={false} fog={false} />
        </mesh>
        <mesh position={[0, hall.screen_height_m / 2, -0.07]}>
          <planeGeometry args={[hall.screen_width_m * 1.35, hall.screen_height_m * 1.6]} />
          <meshBasicMaterial
            color={tone}
            transparent
            opacity={0.2}
            depthWrite={false}
            toneMapped={false}
            fog={false}
          />
        </mesh>
      </group>

      {/* Stepped floor, one instance per row. */}
      <instancedMesh ref={stepsRef} args={[undefined, undefined, Math.max(steps.length, 1)]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color={palette.floor} />
      </instancedMesh>
      <instancedMesh
        ref={stripsRef}
        args={[undefined, undefined, Math.max(strips.length, 1)]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.26, 0.02, 0.04]} />
        <meshBasicMaterial color={palette.stepLight} toneMapped={false} fog={false} />
      </instancedMesh>

      {/* Walls and ceiling are one-sided planes facing in: from outside the hall (the dive
          passes over the back wall) they are invisible instead of a dark slab in the way. The
          side walls are cut into short segments so no quad crosses the near plane. */}
      <mesh position={[-half, wallH / 2, depth / 2]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[depth, wallH, WALL_SEGMENTS, 4]} />
        <meshLambertMaterial color={palette.wallSide} />
      </mesh>
      <mesh position={[half, wallH / 2, depth / 2]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[depth, wallH, WALL_SEGMENTS, 4]} />
        <meshLambertMaterial color={palette.wallSide} />
      </mesh>
      <mesh position={[0, wallH / 2, 0]}>
        <planeGeometry args={[half * 2, wallH]} />
        <meshLambertMaterial color={palette.wallFront} />
      </mesh>
      <mesh position={[0, wallH / 2, depth]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[half * 2, wallH]} />
        <meshLambertMaterial color={palette.wallSide} />
      </mesh>
      <mesh position={[0, wallH, depth / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[half * 2, depth]} />
        <meshLambertMaterial color={palette.ceiling} />
      </mesh>
      {/* Acoustic slats: every other one a shade lighter, both walls in one draw call. */}
      <instancedMesh
        ref={slatsRef}
        args={[undefined, undefined, Math.max(slats.length * 2, 1)]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.14, 1, 0.5]} />
        <meshLambertMaterial color={0xffffff} />
      </instancedMesh>
    </>
  );
}
