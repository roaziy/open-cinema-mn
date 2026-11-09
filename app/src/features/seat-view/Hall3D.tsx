/* eslint-disable react/no-unknown-property -- react-three-fiber props */
import './three-shim';
import type { SeatMap, SeatState } from '@open-cinema/shared';
import { SCREEN_BOTTOM_M } from '@open-cinema/shared';
import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import * as Device from 'expo-device';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, PixelRatio, Platform, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import * as THREE from 'three';
import {
  FLY_MS,
  hallDepth,
  hallExtents,
  hallHalfWidth,
  rowsOf,
  type ScreenSource,
  smoothstep,
  stepSpans,
  type TopDownPose,
} from './camera-math';
import { CameraRig, type RigGoal } from './camera-rig';
import { palette } from './palette';
import { useScreenTexture } from './screen-texture';
import { createSeatGeometry } from './seat-geometry';

const MAX_SELECTED = 10;
const AMBIENT = 0.55;
const SPILL = 260;
const TOP_LIGHT = 30;
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
  /** 0 over the map ... 1 at the seat; the scene's lighting and shapes follow it. */
  dive: SharedValue<number>;
  /** Px of the canvas's bottom covered by the stats panel. */
  cover: number;
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
const CHEAP_GL = Platform.OS === 'ios' && Device.isDevice === false;

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
      onCreated={CHEAP_GL ? () => setTimeout(() => setNudge(1), 120) : undefined}
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
            width: box.w / ratio + nudge * 0.5,
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
  dive,
  cover,
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
  // Not tone mapped: at the top-down start the seats must be the 2D map's colours.
  const seatMat = useMemo(
    () => new THREE.MeshLambertMaterial({ color: 0xffffff, toneMapped: false }),
    [],
  );
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

  // Seat colours are static; matrices follow the dive (footprint, the viewer's own seat).
  useLayoutEffect(() => {
    const mesh = seatsRef.current;
    if (!mesh) return;
    drawable.forEach((s, i) => {
      tint.set(s.kind === 'premium' ? palette.seatPremium : palette.seat);
      mesh.setColorAt(i, tint);
    });
    mesh.count = drawable.length;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [drawable]);

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

  const chosen = useMemo(
    () => seats.filter((s) => selectedIds.includes(s.id)).slice(0, MAX_SELECTED),
    [seats, selectedIds],
  );

  // Seats the camera is at (or just left) are dropped at the seat: no geometry around the lens.
  const away = useRef<string | null>(null);
  const awayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCurrent = useRef(currentId);
  const lastS = useRef(-1);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const spillRef = useRef<THREE.PointLight>(null);
  const topRef = useRef<THREE.PointLight>(null);
  const screenRef = useRef<THREE.Group>(null);

  /** Everything that follows the dive: seat footprint, own seat, lights, the screen's tilt. */
  const follow = useCallback(
    (s: number) => {
      // Rows are drawn closer together on the 2D map: stretch each seat's depth by the same
      // factor at the start so the footprints read as the map's squares, then settle to real.
      const g = (1 / Math.max(0.2, topPose.squash)) ** (1 - s);
      const gone = smoothstep(0.5, 0.85, s);
      const seatMesh = seatsRef.current;
      if (seatMesh) {
        drawable.forEach((seat, i) => {
          const k = seat.id === currentId || seat.id === away.current ? 1 - gone : 1;
          dummy.position.set(seat.x_m, seat.z_m, seat.y_m);
          dummy.scale.set(k, k, k * g);
          dummy.updateMatrix();
          seatMesh.setMatrixAt(i, dummy.matrix);
        });
        seatMesh.instanceMatrix.needsUpdate = true;
      }
      const pickMesh = pickRef.current;
      if (pickMesh) {
        chosen.forEach((seat, i) => {
          const own = seat.id === currentId || seat.id === away.current;
          const k = (seat.id === currentId ? 1.3 : 1.06) * (own ? 1 - gone : 1);
          dummy.position.set(seat.x_m, seat.z_m, seat.y_m);
          dummy.scale.set(k, k, k * g);
          dummy.updateMatrix();
          pickMesh.setMatrixAt(i, dummy.matrix);
        });
        pickMesh.count = chosen.length;
        pickMesh.instanceMatrix.needsUpdate = true;
      }
      // Flat at the start (ambient alone shows each colour as it is), lit by the film at the seat.
      if (ambientRef.current) ambientRef.current.intensity = Math.PI + (AMBIENT - Math.PI) * s;
      if (spillRef.current) spillRef.current.intensity = SPILL * s;
      if (topRef.current) topRef.current.intensity = TOP_LIGHT * s;
      // The screen lies flat at the start, where the 2D map draws its arc, and stands up.
      if (screenRef.current) screenRef.current.rotation.x = -(1 - s) * (Math.PI / 2);
    },
    [drawable, chosen, currentId, topPose.squash],
  );

  // A new viewing seat: keep the previous one out of the way until the camera has left it.
  useEffect(() => {
    if (lastCurrent.current === currentId) return;
    away.current = lastCurrent.current;
    lastCurrent.current = currentId;
    if (awayTimer.current) clearTimeout(awayTimer.current);
    awayTimer.current = setTimeout(() => {
      away.current = null;
      follow(dive.get());
      invalidate();
    }, FLY_MS + 300);
  }, [currentId, dive, invalidate, follow]);
  useEffect(
    () => () => {
      if (awayTimer.current) clearTimeout(awayTimer.current);
    },
    [],
  );

  // Instances and lights are written whenever the data changes and while the dive moves.
  useLayoutEffect(() => {
    follow(dive.get());
    lastS.current = dive.get();
    invalidate();
  }, [follow, dive, invalidate]);
  useFrame(() => {
    const s = dive.get();
    if (Math.abs(s - lastS.current) < 0.002) return;
    lastS.current = s;
    follow(s);
  });

  const current = useMemo(() => seats.find((s) => s.id === currentId), [seats, currentId]);

  return (
    <>
      <ambientLight ref={ambientRef} color={0xffffff} />
      <pointLight
        ref={spillRef}
        position={[hall.screen_x_m, screenY + 0.3, 4]}
        color={tone}
        decay={1.7}
      />
      <pointLight ref={topRef} position={[0, wallH - 1, depth / 2]} color="#FFFFFF" decay={1.5} />

      {/* Screen: film backdrop or flat tone with a soft halo. It lies flat at the dive's start. */}
      <group ref={screenRef} position={[hall.screen_x_m, SCREEN_BOTTOM_M, 0.05]}>
        <mesh position={[0, hall.screen_height_m / 2, 0]}>
          <planeGeometry args={[hall.screen_width_m, hall.screen_height_m]} />
          <meshBasicMaterial
            key={texture ? 'tex' : 'flat'}
            map={texture}
            color={texture ? '#FFFFFF' : tone}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, hall.screen_height_m / 2, -0.02]}>
          <planeGeometry args={[hall.screen_width_m * 1.1, hall.screen_height_m * 1.22]} />
          <meshBasicMaterial
            color={tone}
            transparent
            opacity={0.28}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* Stepped floor, one instance per row. */}
      <instancedMesh ref={stepsRef} args={[undefined, undefined, Math.max(steps.length, 1)]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color={palette.floor} />
      </instancedMesh>

      {/* Walls are one-sided planes facing in: from outside the hall (the dive passes over the
          back wall) they are invisible instead of a dark slab in the way. Cut into short
          segments so no quad crosses the near plane. */}
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
        dive={dive}
        cover={cover}
        onArrive={onArrive}
        onDrew={onDrew}
        onFail={onFail}
      />
    </>
  );
}
