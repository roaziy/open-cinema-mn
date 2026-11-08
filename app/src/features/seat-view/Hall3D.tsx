/* eslint-disable react/no-unknown-property -- react-three-fiber props */
import './three-shim';
import type { SeatMap, SeatState } from '@open-cinema/shared';
import { SCREEN_BOTTOM_M } from '@open-cinema/shared';
import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { colors } from '@/theme/tokens';
import {
  eyePosition,
  flightProgress,
  fovForAspect,
  hallExtents,
  hallHalfWidth,
  lerp3,
  type ScreenSource,
  screenCenter,
  topDownPosition,
  type Vec3,
} from './camera-math';
import { useScreenTexture } from './screen-texture';
import { createSeatGeometry } from './seat-geometry';

const MAX_SELECTED = 10;
/** Pause on the top-down view before the camera dives to the seat. */
const START_DELAY_MS = 600;
/** How long the average frame time is sampled after the fly-in. */
const MEASURE_MS = 3000;

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
  /** The first frame has been drawn: GL works. */
  onReady: () => void;
};

export default function Hall3D(props: Hall3DProps) {
  const { onMount } = props;
  useEffect(() => {
    onMount();
  }, [onMount]);
  return (
    <>
      <Canvas
        style={{ flex: 1, backgroundColor: colors.canvas }}
        camera={{ fov: 60, near: 0.05, far: 120, position: [0, 20, 8] }}
        frameloop="always"
      >
        <color attach="background" args={[colors.canvas]} />
        <Scene {...props} />
      </Canvas>
    </>
  );
}

type Row = { y: number; z: number };

/** One entry per row, nearest the screen first. Curved halls use the row's mean position. */
function rowsOf(seats: SeatState[]): Row[] {
  const byRow = new Map<string, { y: number; z: number; n: number }>();
  for (const s of seats) {
    const r = byRow.get(s.rowLabel) ?? { y: 0, z: 0, n: 0 };
    r.y += s.y_m;
    r.z += s.z_m;
    r.n++;
    byRow.set(s.rowLabel, r);
  }
  return [...byRow.values()].map((r) => ({ y: r.y / r.n, z: r.z / r.n })).sort((a, b) => a.y - b.y);
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
  onReady,
}: Hall3DProps) {
  const ext = useMemo(() => hallExtents(seats), [seats]);
  const half = hallHalfWidth(ext, hall);
  const depth = ext.maxY + 1.5;
  const wallH = ext.maxZ + 7;
  const screenY = SCREEN_BOTTOM_M + hall.screen_height_m / 2;
  const planeAspect = hall.screen_width_m / hall.screen_height_m;
  const texture = useScreenTexture(screen, planeAspect);

  const rows = useMemo(() => rowsOf(seats), [seats]);
  const drawable = useMemo(() => seats.filter((s) => s.kind !== 'blocked'), [seats]);
  const seatGeo = useMemo(() => createSeatGeometry(), []);
  const seatMat = useMemo(() => new THREE.MeshLambertMaterial({ color: 0xffffff }), []);
  const pickMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: colors.action, toneMapped: false }),
    [],
  );

  const seatsRef = useRef<THREE.InstancedMesh>(null);
  const pickRef = useRef<THREE.InstancedMesh>(null);
  const stepsRef = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);

  // Static instance data: written once per seat map, never per frame.
  useLayoutEffect(() => {
    const mesh = seatsRef.current;
    if (!mesh) return;
    drawable.forEach((s, i) => {
      dummy.position.set(s.x_m, s.z_m, s.y_m);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      tint.set(s.kind === 'premium' ? '#40404C' : '#2E2E35');
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
    rows.forEach((r, i) => {
      const prev = rows[i - 1];
      const next = rows[i + 1];
      const from = prev ? (prev.y + r.y) / 2 : 0;
      const to = next ? (r.y + next.y) / 2 : depth;
      const h = Math.max(r.z, 0.05);
      dummy.position.set(0, h / 2, (from + to) / 2);
      dummy.scale.set(half * 2, h, to - from);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.count = rows.length;
    mesh.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [rows, half, depth, invalidate]);

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
      <ambientLight intensity={0.55} color="#9A9AB0" />
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
      <instancedMesh ref={stepsRef} args={[undefined, undefined, Math.max(rows.length, 1)]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color="#202026" />
      </instancedMesh>

      {/* Side, front and back walls. */}
      <mesh position={[-half - 0.1, wallH / 2, depth / 2]}>
        <boxGeometry args={[0.2, wallH, depth + 0.4]} />
        <meshLambertMaterial color="#26262D" />
      </mesh>
      <mesh position={[half + 0.1, wallH / 2, depth / 2]}>
        <boxGeometry args={[0.2, wallH, depth + 0.4]} />
        <meshLambertMaterial color="#26262D" />
      </mesh>
      <mesh position={[0, wallH / 2, -0.1]}>
        <boxGeometry args={[half * 2 + 0.4, wallH, 0.2]} />
        <meshLambertMaterial color="#17171B" />
      </mesh>
      <mesh position={[0, wallH / 2, depth + 0.1]}>
        <boxGeometry args={[half * 2 + 0.4, wallH, 0.2]} />
        <meshLambertMaterial color="#26262D" />
      </mesh>

      {/* All seats in one draw call, chosen ones in a second. */}
      <instancedMesh
        ref={seatsRef}
        args={[seatGeo, seatMat, Math.max(drawable.length, 1)]}
        frustumCulled={false}
      />
      <instancedMesh ref={pickRef} args={[seatGeo, pickMat, MAX_SELECTED]} frustumCulled={false} />

      <Rig
        ext={ext}
        hall={hall}
        eyeSeat={current}
        reduceMotion={reduceMotion}
        hold={hold}
        onReady={onReady}
      />
    </>
  );
}

// Scratch objects for the camera rig: nothing is allocated per frame.
const up = new THREE.Vector3(0, 1, 0);
const downUp = new THREE.Vector3(0, 0, -1);
const mA = new THREE.Matrix4();
const vEye = new THREE.Vector3();
const vTarget = new THREE.Vector3();

function lookQuat(out: THREE.Quaternion, eye: Vec3, target: Vec3, upVec: THREE.Vector3) {
  vEye.set(eye[0], eye[1], eye[2]);
  vTarget.set(target[0], target[1], target[2]);
  mA.lookAt(vEye, vTarget, upVec);
  return out.setFromRotationMatrix(mA);
}

type Flight = {
  active: boolean;
  startedAt: number;
  from: Vec3;
  to: Vec3;
  cur: Vec3;
  fromQ: THREE.Quaternion;
  toQ: THREE.Quaternion;
  /** performance.now() at which the post-fly-in sampling window closes (0 = not sampling). */
  measureUntil: number;
  frames: number;
  sumDelta: number;
  drawn: number;
};

function Rig({
  ext,
  hall,
  eyeSeat,
  reduceMotion,
  hold,
  onReady,
}: {
  ext: ReturnType<typeof hallExtents>;
  hall: SeatMap['hall'];
  eyeSeat: SeatState | undefined;
  reduceMotion: boolean;
  hold: boolean;
  onReady: () => void;
}) {
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);
  const placed = useRef(false);
  const started = useRef(false);
  const flight = useRef<Flight>({
    active: false,
    startedAt: 0,
    from: [0, 0, 0],
    to: [0, 0, 0],
    cur: [0, 0, 0],
    fromQ: new THREE.Quaternion(),
    toQ: new THREE.Quaternion(),
    measureUntil: 0,
    frames: 0,
    sumDelta: 0,
    drawn: 0,
  });
  // Latest props for the frame loop and timers, which must not capture stale values.
  const latest = useRef({ reduceMotion, eyeSeat, onReady, hall });
  useEffect(() => {
    latest.current = { reduceMotion, eyeSeat, onReady, hall };
  });

  const startFlight = useEffectEvent(() => {
    const { eyeSeat: seat, hall: h } = latest.current;
    const f = flight.current;
    const camera = get().camera;
    if (!seat) return;
    f.from[0] = camera.position.x;
    f.from[1] = camera.position.y;
    f.from[2] = camera.position.z;
    f.fromQ.copy(camera.quaternion);
    const eye = eyePosition(seat);
    f.to[0] = eye[0];
    f.to[1] = eye[1];
    f.to[2] = eye[2];
    lookQuat(f.toQ, eye, screenCenter(h), up);
    f.startedAt = performance.now();
    f.active = true;
    f.measureUntil = 0;
    setFrameloop('always');
  });

  // Lens and top-down placement; the first time, then wait a beat and dive.
  useLayoutEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    const camera = get().camera as THREE.PerspectiveCamera;
    const aspect = size.width / size.height;
    camera.fov = fovForAspect(aspect);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    if (placed.current) return;
    placed.current = true;
    const pose = topDownPosition(ext, hall, camera.fov, aspect);
    camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
    camera.quaternion.copy(lookQuat(flight.current.fromQ, pose.position, pose.target, downUp));
    invalidate();
  }, [size.width, size.height, get, ext, hall, invalidate]);

  const seatId = eyeSeat?.id;
  useEffect(() => {
    if (hold || !seatId) return;
    if (!started.current) {
      const timer = setTimeout(
        () => {
          started.current = true;
          startFlight();
        },
        reduceMotion ? 0 : START_DELAY_MS,
      );
      return () => clearTimeout(timer);
    }
    // A different seat: fly from wherever the camera is now.
    startFlight();
  }, [seatId, hold, reduceMotion]);

  const drawnOnce = useRef(false);
  useFrame((_, delta) => {
    const f = flight.current;
    f.drawn++;
    // Report on the second frame: the first frame has actually been presented by then.
    if (!drawnOnce.current && f.drawn >= 2) {
      drawnOnce.current = true;
      latest.current.onReady();
    }
    const now = performance.now();
    if (f.active) {
      const camera = get().camera;
      const p = flightProgress(now - f.startedAt, latest.current.reduceMotion);
      lerp3(f.cur, f.from, f.to, p);
      camera.position.set(f.cur[0], f.cur[1], f.cur[2]);
      camera.quaternion.slerpQuaternions(f.fromQ, f.toQ, p);
      if (p >= 1) {
        f.active = false;
        f.measureUntil = now + MEASURE_MS;
        f.frames = 0;
        f.sumDelta = 0;
      }
      return;
    }
    if (f.measureUntil > 0) {
      f.frames++;
      f.sumDelta += delta;
      if (now >= f.measureUntil) {
        f.measureUntil = 0;
        if (__DEV__ && f.frames > 0) {
          const avg = (f.sumDelta / f.frames) * 1000;
          console.log(
            `[seat-view] avg frame ${avg.toFixed(1)} ms (${(1000 / avg).toFixed(0)} fps) over ${f.frames} frames, 3 s after fly-in`,
          );
        }
        // Nothing moves any more: draw only when something changes.
        setFrameloop('demand');
        invalidate();
      }
    }
  });

  return null;
}
