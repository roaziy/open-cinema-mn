/* eslint-disable react/no-unknown-property -- react-three-fiber props */
import './three-shim';
import type { SeatMap, SeatState } from '@open-cinema/shared';
import { SCREEN_BOTTOM_M } from '@open-cinema/shared';
import { Canvas, useThree } from '@react-three/fiber/native';
import * as Device from 'expo-device';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, PixelRatio, View } from 'react-native';
import * as THREE from 'three';
import {
  hallDepth,
  hallExtents,
  hallHalfWidth,
  rowsOf,
  type ScreenSource,
  stepSpans,
  type TopDownPose,
} from './camera-math';
import { CameraRig, type RigGoal } from './camera-rig';
import { palette } from './palette';
import { useScreenTexture } from './screen-texture';
import { createSeatGeometry } from './seat-geometry';

const MAX_SELECTED = 10;
/**
 * Side walls run past the camera (a seat sits beside them). One long quad crossing the near
 * plane rasterises as a dark wedge across the picture on some GPUs, so cut them into short ones.
 */
const WALL_SEGMENTS = 24;

export type Hall3DProps = {
  seats: SeatState[];
  hall: SeatMap['hall'];
  tone: string;
  screen: ScreenSource;
  selectedIds: string[];
  currentId: string;
  reduceMotion: boolean;
  /** The camera pose that matches the 2D seat map under the canvas. */
  topPose: TopDownPose;
  /** Over the hall (aligned with the 2D map) or at the seat. */
  goal: RigGoal;
  /** A flight to `goal` finished. */
  onArrive: (goal: RigGoal) => void;
  /** The canvas component has mounted (its code is loaded); starts the first-frame watchdog. */
  onMount: () => void;
  /** A render finished and issued draw calls: GL works. */
  onDrew: () => void;
  /** Context lost, shader error or a throwing render: show the 2D diagram instead. */
  onFail: (reason: string) => void;
};

/**
 * The simulator rasterises GL on the CPU: with 4x MSAA at native density a hall frame takes
 * seconds. There, MSAA is off and the canvas renders at 1x and is scaled up. Devices keep both.
 */
const CHEAP_GL = Device.isDevice === false;

export default function Hall3D(props: Hall3DProps) {
  const { onMount } = props;
  const [box, setBox] = useState({ w: 0, h: 0 });
  // Bumped once the context exists: a size change makes expo-gl rebuild its buffers with the
  // sample count r3f reported only after the context was created (see below).
  const [nudge, setNudge] = useState(0);
  useEffect(() => {
    onMount();
  }, [onMount]);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b.w === width && b.h === height ? b : { w: width, h: height }));
  };
  // r3f native renders at the device pixel ratio and ignores its dpr prop; a canvas laid out
  // at 1/ratio of the size and scaled back up by `ratio` costs ratio^2 fewer pixels.
  const ratio = CHEAP_GL ? PixelRatio.get() : 1;
  const canvas = (
    <Canvas
      style={{ flex: 1, backgroundColor: palette.canvas }}
      camera={{ fov: 14, near: 1, far: 400, position: [0, 100, 8] }}
      frameloop="demand"
      gl={{ antialias: !CHEAP_GL }}
      onCreated={CHEAP_GL ? () => setNudge(1) : undefined}
    >
      <color attach="background" args={[palette.canvas]} />
      <Scene {...props} />
    </Canvas>
  );
  return (
    <View style={{ flex: 1, overflow: 'hidden' }} onLayout={onLayout}>
      {box.w > 0 && ratio !== 1 ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: box.w / ratio + nudge * 0.02,
            height: box.h / ratio,
            transform: [{ scale: ratio }],
            transformOrigin: 'top left',
          }}
        >
          {canvas}
        </View>
      ) : ratio === 1 ? (
        canvas
      ) : null}
    </View>
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
  topPose,
  goal,
  onArrive,
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

  // The overlay mounts the canvas on every open: free what it created when it goes away.
  useEffect(
    () => () => {
      seatGeo.dispose();
      seatMat.dispose();
      pickMat.dispose();
    },
    [seatGeo, seatMat, pickMat],
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
        <boxGeometry args={[0.2, wallH, depth + 0.4, 1, 4, WALL_SEGMENTS]} />
        <meshLambertMaterial color={palette.wallSide} />
      </mesh>
      <mesh position={[half + 0.1, wallH / 2, depth / 2]}>
        <boxGeometry args={[0.2, wallH, depth + 0.4, 1, 4, WALL_SEGMENTS]} />
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
        hall={hall}
        eyeSeat={current}
        reduceMotion={reduceMotion}
        topPose={topPose}
        goal={goal}
        onArrive={onArrive}
        onDrew={onDrew}
        onFail={onFail}
      />
    </>
  );
}
