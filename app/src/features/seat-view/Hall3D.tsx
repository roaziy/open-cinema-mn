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
  type CamState,
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
import { HallRoom, type RoomControl, SCREEN_FACE, SCREEN_HALO, SCREEN_MASK } from './HallRoom';
import { handoffLook, heldScale } from './handoff';
import type { Look } from './look-around';
import { palette } from './palette';
import { kitOf, type RoomInput, washLights } from './room-kit-layout';
import { aisleCentres, type Obstacles } from './room-layout';
import { armsOf } from './seat-arms';
import { createSeatParts, MODEL_PITCH } from './seat-geometry';

const MAX_SELECTED = 10;
const AMBIENT = 1.5;
const SPILL = 150;
/** The screen's light reaches what is in front of it only: a cone (half-angle) into the hall. */
const SPILL_CONE = Math.PI * 0.45;
const FLOOR_SPILL = 40;
const TOP_LIGHT = 18;
const FILL = 1.1;
/** Seats are brightened toward the seat view so they read against the dark room. */
const SEAT_LIFT = 2.4;
/** The viewing seat's accent shell at the view over its back: just around the seat (no z-fighting). */
const HELD_NEAR = 1.06;

export type Hall3DProps = {
  seats: SeatState[];
  hall: SeatMap['hall'];
  tone: string;
  /** The showtime's format: picks the room kit (IMAX gets its own room). */
  format?: string;
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
  /** A flight to `goal` finished. */
  onArrive: (goal: RigGoal) => void;
  /** A closing flight's drawn grid is aligned with the 2D map. */
  onLead: () => void;
  /** The camera as numbers, for the landmark layer. */
  cam: SharedValue<CamState>;
  /** NOT_CLOSING, or the dive progress at which leaving began (the hand-off only runs then). */
  closing: SharedValue<number>;
  /** The canvas component has mounted (its code is loaded); starts the first-frame watchdog. */
  onMount: () => void;
  /** A render finished and issued draw calls: GL works. */
  onDrew: () => void;
  /** Context lost, shader error or a throwing render: show the 2D diagram instead. */
  onFail: (reason: string) => void;
  /** Where the view from the seat is turned to by a drag or the phone. */
  lookAround: Look;
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
  format,
  screen,
  selectedIds,
  takenIds,
  currentId,
  reduceMotion,
  topPose,
  goal,
  dive,
  onArrive,
  onLead,
  cam,
  closing,
  onDrew,
  onFail,
  lookAround,
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
  const kit = kitOf(format);
  // The kit's few real lights (a sconce wash, an accent wash); the rest of the room glows.
  const wash = useMemo(() => {
    const input: RoomInput = {
      half,
      depth,
      wallH,
      screen: {
        width: hall.screen_width_m,
        height: hall.screen_height_m,
        x: hall.screen_x_m,
        bottom: SCREEN_BOTTOM_M,
      },
      steps,
      aisleXs: aisleCentres(drawable.map((d) => d.x_m)),
      seats: drawable,
    };
    return washLights(kit, input);
  }, [kit, half, depth, wallH, hall, steps, drawable]);
  // The seat model (see seat-model.ts), sized to the hall's seat spacing, and its dividers.
  const parts = useMemo(() => createSeatParts(), []);
  const { arms, pitch } = useMemo(() => armsOf(drawable), [drawable]);
  const widthScale = Math.min(1.2, Math.max(0.75, pitch / MODEL_PITCH));
  // Not tone mapped: at the top-down start the seats must be the 2D map's colours.
  const fabricMat = useMemo(
    () => new THREE.MeshLambertMaterial({ color: 0xffffff, toneMapped: false }),
    [],
  );
  const shellMat = useMemo(
    () => new THREE.MeshLambertMaterial({ color: palette.seatShell, toneMapped: false }),
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
      for (const g of Object.values(parts)) g.dispose();
      fabricMat.dispose();
      shellMat.dispose();
      pickMat.dispose();
    },
    [parts, fabricMat, shellMat, pickMat],
  );

  const fabricRef = useRef<THREE.InstancedMesh>(null);
  const shellRef = useRef<THREE.InstancedMesh>(null);
  const armsRef = useRef<THREE.InstancedMesh>(null);
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

  // Each seat's fabric: the 2D map's tile colour from above, its upholstery at the seat.
  const fabricColours = useMemo(() => {
    const taken = new Set(takenIds);
    return drawable.map((s) => {
      const state = taken.has(s.id) ? 'taken' : s.kind === 'premium' ? 'premium' : 'free';
      return {
        map: new THREE.Color(
          state === 'taken'
            ? palette.seatTaken
            : state === 'premium'
              ? palette.seatPremium
              : palette.seat,
        ),
        near: new THREE.Color(
          state === 'taken'
            ? palette.seatFabricTaken
            : state === 'premium'
              ? palette.seatFabricPremium
              : palette.seatFabric,
        ),
      };
    });
  }, [drawable, takenIds]);
  const shellBase = useMemo(() => new THREE.Color(palette.seatShell), []);

  const chosen = useMemo(
    () => seats.filter((s) => selectedIds.includes(s.id)).slice(0, MAX_SELECTED),
    [seats, selectedIds],
  );

  const lastS = useRef(-1);
  const lastCam = useRef<Vec3>([0, 0, 0]);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const spillRef = useRef<THREE.SpotLight>(null);
  const topRef = useRef<THREE.PointLight>(null);
  const fillRef = useRef<THREE.DirectionalLight>(null);
  const floorSpillRef = useRef<THREE.PointLight>(null);
  const fogRef = useRef<THREE.Fog>(null);
  const screenRef = useRef<THREE.Group>(null);
  const roomRef = useRef<RoomControl | null>(null);
  const washRefs = useRef<(THREE.PointLight | null)[]>([]);

  /** Everything that follows the dive: seat footprint, own seat, lights, the screen's tilt. */
  const follow = useCallback(
    (s: number) => {
      // Rows are drawn closer together on the 2D map: the projection squashes the hall's depth
      // until the tilt foreshortens it; each seat's depth is stretched by the inverse so its
      // footprint reads as the map's square tile.
      const look = handoffLook(s, closing.get());
      // (read off the camera itself: the rig has already set it this frame)
      const camera = get().camera as THREE.PerspectiveCamera;
      const squash = camera.projectionMatrix.elements[5] * Math.tan((camera.fov * Math.PI) / 360);
      const g = 1 / Math.max(0.2, squash);
      const pos = camera.position;
      /** 1 when far from the camera, 0 at the view over the seat's back. */
      const near = (seat: SeatState) =>
        smoothstep(
          1,
          2.2,
          Math.hypot(pos.x - seat.x_m, pos.y - (seat.z_m + 0.6), pos.z - seat.y_m),
        );
      const fabricMesh = fabricRef.current;
      const shellMesh = shellRef.current;
      if (fabricMesh && shellMesh) {
        // the map's tile colours from above, the upholstery as the camera comes down
        const near = smoothstep(0.3, 0.85, s);
        drawable.forEach((seat, i) => {
          dummy.position.set(seat.x_m, seat.z_m, seat.y_m);
          dummy.scale.set(widthScale * look.footprintX, 1, g);
          dummy.updateMatrix();
          fabricMesh.setMatrixAt(i, dummy.matrix);
          shellMesh.setMatrixAt(i, dummy.matrix);
          const c = fabricColours[i];
          if (c) fabricMesh.setColorAt(i, tint.copy(c.map).lerp(c.near, near));
        });
        fabricMesh.count = drawable.length;
        shellMesh.count = drawable.length;
        fabricMesh.instanceMatrix.needsUpdate = true;
        shellMesh.instanceMatrix.needsUpdate = true;
        if (fabricMesh.instanceColor) fabricMesh.instanceColor.needsUpdate = true;
      }
      // The dividers fold away as the seats become the map's tiles.
      const armMesh = armsRef.current;
      if (armMesh) {
        const a = 1 - look.morph;
        arms.forEach((arm, i) => {
          dummy.position.set(arm.x, arm.y, arm.z);
          dummy.scale.set(widthScale * a, a, g * a);
          dummy.updateMatrix();
          armMesh.setMatrixAt(i, dummy.matrix);
        });
        armMesh.count = arms.length;
        armMesh.instanceMatrix.needsUpdate = true;
      }
      const pickMesh = pickRef.current;
      if (pickMesh) {
        chosen.forEach((seat, i) => {
          // The seat the view is taken over: its oversized shell settles to just around the
          // seat as the camera comes in behind it (the seat stays in view, as in the reference).
          const held = heldScale(look.morph, seat.id === currentId);
          const k = seat.id === currentId ? HELD_NEAR + (held - HELD_NEAR) * near(seat) : held;
          dummy.position.set(seat.x_m, seat.z_m, seat.y_m);
          dummy.scale.set(k * widthScale * look.footprintX, k, k * g);
          dummy.updateMatrix();
          pickMesh.setMatrixAt(i, dummy.matrix);
        });
        pickMesh.count = chosen.length;
        pickMesh.instanceMatrix.needsUpdate = true;
      }
      // Flat at the start (ambient alone shows each colour as it is), lit by the film at the seat.
      if (ambientRef.current)
        ambientRef.current.intensity = Math.PI + (AMBIENT - Math.PI) * s * look.light;
      if (spillRef.current) spillRef.current.intensity = SPILL * s * look.light;
      if (topRef.current) topRef.current.intensity = TOP_LIGHT * s * look.light;
      if (fillRef.current) fillRef.current.intensity = FILL * s * look.light;
      if (floorSpillRef.current) floorSpillRef.current.intensity = FLOOR_SPILL * s * look.light;
      wash.forEach((w, i) => {
        const light = washRefs.current[i];
        if (light) light.intensity = w.intensity * s * look.light;
      });
      // the room's own glow: house lights fade out as the film takes over
      roomRef.current?.update(s * look.light, s, pos.y);
      const lift = 1 + SEAT_LIFT * s * look.light;
      fabricMat.color.setScalar(lift);
      // black plastic stays dark: half the fabric's lift
      shellMat.color.copy(shellBase).multiplyScalar(1 + (lift - 1) * 0.5);
      const screenGroup = screenRef.current;
      if (screenGroup) {
        const fadeMat = (name: string, base: number) => {
          const m = screenGroup.getObjectByName(name) as THREE.Mesh | undefined;
          if (m) (m.material as THREE.Material).opacity = base * look.screen;
        };
        fadeMat(SCREEN_FACE, 1);
        fadeMat(SCREEN_MASK, 1);
        fadeMat(SCREEN_HALO, 0.2);
      }
      // Depth haze only once inside the hall: from above it would swallow the whole picture.
      if (fogRef.current) {
        const t = smoothstep(0.6, 1, s);
        fogRef.current.near = 9 + 1e4 * (1 - t) ** 3;
        fogRef.current.far = 48 + 2e4 * (1 - t) ** 3;
      }
    },
    [
      drawable,
      chosen,
      currentId,
      fabricMat,
      shellMat,
      shellBase,
      fabricColours,
      arms,
      widthScale,
      get,
      closing,
      wash,
    ],
  );

  // The spill aims down into the hall; the wall, valance and curtains behind it stay unlit.
  useLayoutEffect(() => {
    const t = spillRef.current?.target;
    if (!t) return;
    t.position.set(hall.screen_x_m, 0, depth * 0.6);
    t.updateMatrixWorld();
  }, [hall.screen_x_m, depth]);

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
      {/* The screen's light, tinted by the film: spills over the rows and side walls ahead. */}
      <spotLight
        ref={spillRef}
        position={[hall.screen_x_m, screenY + 0.3, 3.5]}
        color={spillTone}
        decay={1.5}
        angle={SPILL_CONE}
        penumbra={0.4}
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

      {wash.map((w, i) => (
        <pointLight
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pair of lights, never reordered
          key={i}
          ref={(l) => {
            washRefs.current[i] = l;
          }}
          position={[w.x, w.y, w.z]}
          color={w.color}
          decay={1.6}
        />
      ))}

      <HallRoom
        screenRef={screenRef}
        roomRef={roomRef}
        kit={kit}
        hall={hall}
        drawable={drawable}
        tone={tone}
        screen={screen}
        steps={steps}
        half={half}
        depth={depth}
        wallH={wallH}
      />

      {/* Seat fabric, seat shells and dividers: a draw call each; chosen seats in a fourth. */}
      <instancedMesh
        ref={fabricRef}
        args={[parts.fabric, fabricMat, Math.max(drawable.length, 1)]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={shellRef}
        args={[parts.shell, shellMat, Math.max(drawable.length, 1)]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={armsRef}
        args={[parts.arm, shellMat, Math.max(arms.length, 1)]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={pickRef}
        args={[parts.whole, pickMat, MAX_SELECTED]}
        frustumCulled={false}
      />

      <CameraRig
        hall={hall}
        eyeSeat={current}
        reduceMotion={reduceMotion}
        topPose={topPose}
        goal={goal}
        dive={dive}
        obstacles={obstacles}
        onArrive={onArrive}
        onLead={onLead}
        cam={cam}
        onDrew={onDrew}
        onFail={onFail}
        look={lookAround}
      />
    </>
  );
}
