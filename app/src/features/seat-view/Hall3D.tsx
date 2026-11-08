/* eslint-disable react/no-unknown-property -- react-three-fiber props */
import './three-shim';
import type { SeatMap, SeatState } from '@open-cinema/shared';
import { SCREEN_BOTTOM_M } from '@open-cinema/shared';
import { Canvas, useThree } from '@react-three/fiber/native';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  hallDepth,
  hallExtents,
  hallHalfWidth,
  rowsOf,
  type ScreenSource,
  stepSpans,
} from './camera-math';
import { CameraRig } from './camera-rig';
import { palette } from './palette';
import { useScreenTexture } from './screen-texture';
import { createSeatGeometry } from './seat-geometry';

const MAX_SELECTED = 10;

export type Hall3DProps = {
  seats: SeatState[];
  hall: SeatMap['hall'];
  tone: string;
  screen: ScreenSource;
  selectedIds: string[];
  currentId: string;
  reduceMotion: boolean;
  /** Dev only: stay on the top-down view. */
  hold: boolean;
  /** The canvas component has mounted (its code is loaded); starts the first-frame watchdog. */
  onMount: () => void;
  /** A render finished and issued draw calls: GL works. */
  onDrew: () => void;
  /** Context lost, shader error or a throwing render: show the 2D diagram instead. */
  onFail: (reason: string) => void;
};

export default function Hall3D(props: Hall3DProps) {
  const { onMount } = props;
  useEffect(() => {
    onMount();
  }, [onMount]);
  return (
    <Canvas
      style={{ flex: 1, backgroundColor: palette.canvas }}
      camera={{ fov: 60, near: 0.05, far: 120, position: [0, 20, 8] }}
      frameloop="always"
    >
      <color attach="background" args={[palette.canvas]} />
      <Scene {...props} />
    </Canvas>
  );
}

const dummy = new THREE.Object3D();
const tint = new THREE.Color();

function Scene({
  seats,
  hall,
  tone,
  screen,
  selectedIds,
  currentId,
  reduceMotion,
  hold,
  onDrew,
  onFail,
}: Hall3DProps) {
  const ext = useMemo(() => hallExtents(seats), [seats]);
  const half = hallHalfWidth(ext, hall);
  const depth = hallDepth(ext);
  const wallH = ext.maxZ + 7;
  const screenY = SCREEN_BOTTOM_M + hall.screen_height_m / 2;
  const planeAspect = hall.screen_width_m / hall.screen_height_m;
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  const maxTexture = useThree((s) => s.gl.capabilities.maxTextureSize);
  const texture = useScreenTexture(screen, planeAspect, maxTexture);

  const steps = useMemo(() => stepSpans(rowsOf(seats), depth), [seats, depth]);
  const drawable = useMemo(() => seats.filter((s) => s.kind !== 'blocked'), [seats]);
  const seatGeo = useMemo(() => createSeatGeometry(), []);
  const seatMat = useMemo(() => new THREE.MeshLambertMaterial({ color: 0xffffff }), []);
  const pickMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: palette.chosen, toneMapped: false }),
    [],
  );

  const seatsRef = useRef<THREE.InstancedMesh>(null);
  const pickRef = useRef<THREE.InstancedMesh>(null);
  const stepsRef = useRef<THREE.InstancedMesh>(null);

  // A bad shader or a lost context means no usable 3D: report it so the screen shows 2D.
  useEffect(() => {
    const { gl } = get();
    gl.debug.onShaderError = () => onFail('shader error');
    const canvas = gl.domElement as {
      addEventListener?: (name: string, listener: () => void) => void;
      removeEventListener?: (name: string, listener: () => void) => void;
    };
    const lost = () => onFail('context lost');
    try {
      canvas.addEventListener?.('webglcontextlost', lost);
    } catch {}
    return () => {
      gl.debug.onShaderError = null;
      try {
        canvas.removeEventListener?.('webglcontextlost', lost);
      } catch {}
    };
  }, [get, onFail]);

  // Static instance data: written once per seat map, never per frame.
  useLayoutEffect(() => {
    const mesh = seatsRef.current;
    if (!mesh) return;
    drawable.forEach((s, i) => {
      dummy.position.set(s.x_m, s.z_m, s.y_m);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      tint.set(s.kind === 'premium' ? palette.seatPremium : palette.seat);
      mesh.setColorAt(i, tint);
    });
    mesh.count = drawable.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [drawable, invalidate]);

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

  // Chosen seats glow accent blue; the one you are viewing from is a touch larger.
  useLayoutEffect(() => {
    const mesh = pickRef.current;
    if (!mesh) return;
    const chosen = seats.filter((s) => selectedIds.includes(s.id)).slice(0, MAX_SELECTED);
    chosen.forEach((s, i) => {
      dummy.position.set(s.x_m, s.z_m, s.y_m);
      dummy.scale.setScalar(s.id === currentId ? 1.3 : 1.06);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.count = chosen.length;
    mesh.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [seats, selectedIds, currentId, invalidate]);

  const current = useMemo(() => seats.find((s) => s.id === currentId), [seats, currentId]);

  return (
    <>
      <ambientLight intensity={0.55} color={palette.ambient} />
      <pointLight
        position={[hall.screen_x_m, screenY + 0.3, 4]}
        color={tone}
        intensity={260}
        decay={1.7}
      />
      <pointLight position={[0, wallH - 1, depth / 2]} color="#FFFFFF" intensity={30} decay={1.5} />

      {/* Screen: film backdrop or flat tone, with a soft halo behind it. */}
      <mesh position={[hall.screen_x_m, screenY, 0.05]}>
        <planeGeometry args={[hall.screen_width_m, hall.screen_height_m]} />
        <meshBasicMaterial
          key={texture ? 'tex' : 'flat'}
          map={texture}
          color={texture ? '#FFFFFF' : tone}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[hall.screen_x_m, screenY, 0.03]}>
        <planeGeometry args={[hall.screen_width_m * 1.1, hall.screen_height_m * 1.22]} />
        <meshBasicMaterial
          color={tone}
          transparent
          opacity={0.28}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Stepped floor, one instance per row. */}
      <instancedMesh ref={stepsRef} args={[undefined, undefined, Math.max(steps.length, 1)]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color={palette.floor} />
      </instancedMesh>

      {/* Side, front and back walls. */}
      <mesh position={[-half - 0.1, wallH / 2, depth / 2]}>
        <boxGeometry args={[0.2, wallH, depth + 0.4]} />
        <meshLambertMaterial color={palette.wallSide} />
      </mesh>
      <mesh position={[half + 0.1, wallH / 2, depth / 2]}>
        <boxGeometry args={[0.2, wallH, depth + 0.4]} />
        <meshLambertMaterial color={palette.wallSide} />
      </mesh>
      <mesh position={[0, wallH / 2, -0.1]}>
        <boxGeometry args={[half * 2 + 0.4, wallH, 0.2]} />
        <meshLambertMaterial color={palette.wallFront} />
      </mesh>
      <mesh position={[0, wallH / 2, depth + 0.1]}>
        <boxGeometry args={[half * 2 + 0.4, wallH, 0.2]} />
        <meshLambertMaterial color={palette.wallSide} />
      </mesh>

      {/* All seats in one draw call, chosen ones in a second. */}
      <instancedMesh
        ref={seatsRef}
        args={[seatGeo, seatMat, Math.max(drawable.length, 1)]}
        frustumCulled={false}
      />
      <instancedMesh ref={pickRef} args={[seatGeo, pickMat, MAX_SELECTED]} frustumCulled={false} />

      <CameraRig
        ext={ext}
        hall={hall}
        eyeSeat={current}
        reduceMotion={reduceMotion}
        hold={hold}
        onDrew={onDrew}
        onFail={onFail}
      />
    </>
  );
}
