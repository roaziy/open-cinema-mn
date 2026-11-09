/* eslint-disable react/no-unknown-property -- react-three-fiber props */
import './three-shim';
import type { SeatMap, SeatState } from '@open-cinema/shared';
import { avoidOrange, SCREEN_BOTTOM_M } from '@open-cinema/shared';
import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import * as Device from 'expo-device';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, PixelRatio, Platform, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import * as THREE from 'three';
import {
  hallDepth,
  hallExtents,
  hallHalfWidth,
  rowsOf,
  type ScreenSource,
  smoothstep,
  stepSpans,
  type TopDownPose,
  type Vec3,
} from './camera-math';
import { CameraRig, type RigGoal } from './camera-rig';
import { HallRoom } from './HallRoom';
import { palette } from './palette';
import type { Obstacles } from './room-layout';
import { createSeatGeometry } from './seat-geometry';

const MAX_SELECTED = 10;
const AMBIENT = 1.5;
const SPILL = 150;
const FLOOR_SPILL = 40;
const TOP_LIGHT = 18;
const FILL = 1.1;
/** Seats are brightened toward the seat view so they read against the dark room. */
const SEAT_LIFT = 2.4;

export type Hall3DProps = {
  seats: SeatState[];
  hall: SeatMap['hall'];
  tone: string;
  screen: ScreenSource;
  selectedIds: string[];
  /** Seats someone else holds or has bought, as the 2D map shows them. */
  takenIds: string[];
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
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    },
    [],
  );
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
      onCreated={
        CHEAP_GL
          ? () => {
              nudgeTimer.current = setTimeout(() => setNudge(1), 120);
            }
          : undefined
      }
    >
      <color attach="background" args={[palette.canvas]} />
      <Scene {...props} cover={props.cover / ratio} />
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
  takenIds,
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
  const wallH = ext.maxZ + 6;
  const screenY = SCREEN_BOTTOM_M + hall.screen_height_m / 2;
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);

  const steps = useMemo(() => stepSpans(rowsOf(seats), depth), [seats, depth]);
  const drawable = useMemo(() => seats.filter((s) => s.kind !== 'blocked'), [seats]);
  const seatGeo = useMemo(() => createSeatGeometry(), []);
  // Not tone mapped: at the top-down start the seats must be the 2D map's colours.
  const seatMat = useMemo(
    () => new THREE.MeshLambertMaterial({ color: 0xffffff, toneMapped: false, vertexColors: true }),
    [],
  );
  const pickMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({ color: palette.chosen, toneMapped: false, vertexColors: true }),
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
    const taken = new Set(takenIds);
    drawable.forEach((s, i) => {
      tint.set(
        taken.has(s.id)
          ? palette.seatTaken
          : s.kind === 'premium'
            ? palette.seatPremium
            : palette.seat,
      );
      mesh.setColorAt(i, tint);
    });
    mesh.count = drawable.length;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [drawable, takenIds]);

  const chosen = useMemo(
    () => seats.filter((s) => selectedIds.includes(s.id)).slice(0, MAX_SELECTED),
    [seats, selectedIds],
  );

  // The seat the camera is at (and the one it just left) shrinks away as the camera comes close:
  // no geometry around the lens, no pop, and a seat stays in view as the blue landmark until then.
  const previousId = useRef<string | null>(null);
  const lastCurrent = useRef(currentId);
  const lastS = useRef(-1);
  const lastCam = useRef<Vec3>([0, 0, 0]);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const spillRef = useRef<THREE.PointLight>(null);
  const topRef = useRef<THREE.PointLight>(null);
  const fillRef = useRef<THREE.DirectionalLight>(null);
  const floorSpillRef = useRef<THREE.PointLight>(null);
  const fogRef = useRef<THREE.Fog>(null);

  /** Everything that follows the dive: seat footprint, own seat, lights, the screen's tilt. */
  const follow = useCallback(
    (s: number) => {
      // Rows are drawn closer together on the 2D map: stretch each seat's depth by the same
      // factor at the start so the footprints read as the map's squares, then settle to real.
      const g = (1 / Math.max(0.2, topPose.squash)) ** (1 - s);
      const cam = get().camera.position;
      /** 1 when far from the camera, 0 when it is at the seat. */
      const near = (seat: SeatState) =>
        smoothstep(
          0.5,
          2.2,
          Math.hypot(cam.x - seat.x_m, cam.y - (seat.z_m + 0.6), cam.z - seat.y_m),
        );
      const own = (id: string) => id === currentId || id === previousId.current;
      const seatMesh = seatsRef.current;
      if (seatMesh) {
        drawable.forEach((seat, i) => {
          const k = own(seat.id) ? near(seat) : 1;
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
          const k = (seat.id === currentId ? 1.3 : 1.06) * (own(seat.id) ? near(seat) : 1);
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
      if (fillRef.current) fillRef.current.intensity = FILL * s;
      if (floorSpillRef.current) floorSpillRef.current.intensity = FLOOR_SPILL * s;
      seatMat.color.setScalar(1 + SEAT_LIFT * s);
      // Depth haze only once inside the hall: from above it would swallow the whole picture.
      if (fogRef.current) {
        const t = smoothstep(0.6, 1, s);
        fogRef.current.near = 9 + 1e4 * (1 - t) ** 3;
        fogRef.current.far = 48 + 2e4 * (1 - t) ** 3;
      }
    },
    [drawable, chosen, currentId, topPose.squash, seatMat, get],
  );

  // A new viewing seat: remember the one the camera is leaving.
  useEffect(() => {
    if (lastCurrent.current === currentId) return;
    previousId.current = lastCurrent.current;
    lastCurrent.current = currentId;
    follow(dive.get());
    invalidate();
  }, [currentId, dive, invalidate, follow]);

  // Instances and lights are written whenever the data changes and while the dive moves.
  useLayoutEffect(() => {
    follow(dive.get());
    lastS.current = dive.get();
    invalidate();
  }, [follow, dive, invalidate]);
  useFrame(({ camera }) => {
    const s = dive.get();
    const c = camera.position;
    const moved = Math.hypot(
      c.x - lastCam.current[0],
      c.y - lastCam.current[1],
      c.z - lastCam.current[2],
    );
    if (Math.abs(s - lastS.current) < 0.002 && moved < 0.03) return;
    lastS.current = s;
    lastCam.current = [c.x, c.y, c.z];
    follow(s);
  });

  const current = useMemo(() => seats.find((s) => s.id === currentId), [seats, currentId]);

  // The screen's light on the room: the film's tone, softened toward white so walls stay neutral.
  const spillTone = useMemo(
    () => new THREE.Color(avoidOrange(tone)).lerp(new THREE.Color('#FFFFFF'), 0.5),
    [tone],
  );

  const obstacles = useMemo<Obstacles>(
    () => ({ half, depth, wallH, steps, seats: drawable }),
    [half, depth, wallH, steps, drawable],
  );

  return (
    <>
      <fog ref={fogRef} attach="fog" args={[palette.canvas, 1e4, 2e4]} />
      <ambientLight ref={ambientRef} color={0xffffff} />
      {/* The screen's light, tinted by the film: spills over the front rows and walls. */}
      <pointLight
        ref={spillRef}
        position={[hall.screen_x_m, screenY + 0.3, 3.5]}
        color={spillTone}
        decay={1.5}
      />
      <pointLight
        ref={floorSpillRef}
        position={[hall.screen_x_m, 0.9, 2]}
        color={spillTone}
        decay={1.6}
      />
      {/* A soft cool fill from behind the audience: the rows ahead show their backs and heads. */}
      <directionalLight ref={fillRef} position={[0, 6, depth + 8]} color="#9DB0E6" />
      <pointLight ref={topRef} position={[0, wallH - 1, depth / 2]} color="#AEB8E0" decay={1.5} />

      <HallRoom
        hall={hall}
        seats={seats}
        drawable={drawable}
        tone={tone}
        screen={screen}
        steps={steps}
        half={half}
        depth={depth}
        wallH={wallH}
      />

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
        obstacles={obstacles}
        onArrive={onArrive}
        onDrew={onDrew}
        onFail={onFail}
      />
    </>
  );
}
