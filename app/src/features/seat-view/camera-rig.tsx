import type { SeatMap, SeatState } from '@open-cinema/shared';
import { useFrame, useThree } from '@react-three/fiber/native';
import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as THREE from 'three';
import {
  eyePosition,
  flightProgress,
  fovForAspect,
  lensRange,
  lerp3,
  screenCenter,
  type TopDownPose,
  type Vec3,
} from './camera-math';

/** Dev only: how long the average frame time is sampled after a flight. */
const MEASURE_MS = 3000;

// Scratch objects: nothing is allocated per frame.
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

/** Lens: vertical fov, a vertical squash on the projection, and a near/far that follow altitude. */
function applyLens(camera: THREE.PerspectiveCamera, fov: number, squash: number) {
  const range = lensRange(camera.position.y);
  camera.fov = fov;
  camera.near = range.near;
  camera.far = range.far;
  camera.updateProjectionMatrix();
  if (squash !== 1) {
    camera.projectionMatrix.elements[5] = (camera.projectionMatrix.elements[5] ?? 1) * squash;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
}

export type RigGoal = 'top' | 'pov';

type Flight = {
  active: boolean;
  goal: RigGoal;
  startedAt: number;
  from: Vec3;
  to: Vec3;
  cur: Vec3;
  fromQ: THREE.Quaternion;
  toQ: THREE.Quaternion;
  fromFov: number;
  toFov: number;
  fromSquash: number;
  toSquash: number;
  /** Dev only: performance.now() at which the frame-time window closes (0 = not sampling). */
  measureUntil: number;
  frames: number;
  sumDelta: number;
};

type Props = {
  hall: SeatMap['hall'];
  eyeSeat: SeatState | undefined;
  reduceMotion: boolean;
  /** Where the 2D map is looking from, in 3D: the start and end of every dive. */
  topPose: TopDownPose;
  /** Where the camera should be: over the hall (matching the 2D map) or at the seat. */
  goal: RigGoal;
  /** A flight to `goal` finished. */
  onArrive: (goal: RigGoal) => void;
  /** A render finished and issued draw calls. */
  onDrew: () => void;
  /** Rendering threw. */
  onFail: (reason: string) => void;
};

/**
 * Owns the camera (top-down pose matching the 2D map, ease-in-out flights to the seat and back,
 * re-flight on seat change) and the render itself: r3f runs useFrame callbacks and then
 * gl.render with no try/catch, so the render is taken over here (priority 1) where a throw can
 * route to the 2D fallback.
 */
export function CameraRig({
  hall,
  eyeSeat,
  reduceMotion,
  topPose,
  goal,
  onArrive,
  onDrew,
  onFail,
}: Props) {
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);
  const placed = useRef(false);
  const settled = useRef<string | null>(null);
  const reported = useRef(false);
  const failed = useRef(false);
  const lens = useRef({ fov: topPose.fov, squash: topPose.squash });
  const flight = useRef<Flight>({
    active: false,
    goal: 'top',
    startedAt: 0,
    from: [0, 0, 0],
    to: [0, 0, 0],
    cur: [0, 0, 0],
    fromQ: new THREE.Quaternion(),
    toQ: new THREE.Quaternion(),
    fromFov: 0,
    toFov: 0,
    fromSquash: 1,
    toSquash: 1,
    measureUntil: 0,
    frames: 0,
    sumDelta: 0,
  });
  // Latest props for the frame loop and timers, which must not capture stale values.
  const latest = useRef({ reduceMotion, eyeSeat, hall, topPose, goal, onArrive, onDrew, onFail });
  useEffect(() => {
    latest.current = { reduceMotion, eyeSeat, hall, topPose, goal, onArrive, onDrew, onFail };
  });

  /** The pose (position, orientation, lens) for a goal, written into `out`. */
  const targetPose = useEffectEvent(
    (
      want: RigGoal,
      aspect: number,
      out: { pos: Vec3; q: THREE.Quaternion },
    ): { fov: number; squash: number } | null => {
      const { eyeSeat: seat, hall: h, topPose: top } = latest.current;
      if (want === 'top') {
        out.pos[0] = top.position[0];
        out.pos[1] = top.position[1];
        out.pos[2] = top.position[2];
        lookQuat(out.q, top.position, top.target, downUp);
        return { fov: top.fov, squash: top.squash };
      }
      if (!seat) return null;
      const eye = eyePosition(seat);
      out.pos[0] = eye[0];
      out.pos[1] = eye[1];
      out.pos[2] = eye[2];
      lookQuat(out.q, eye, screenCenter(h), up);
      return { fov: fovForAspect(aspect), squash: 1 };
    },
  );

  const startFlight = useEffectEvent((want: RigGoal) => {
    const f = flight.current;
    const camera = get().camera as THREE.PerspectiveCamera;
    const aspect = camera.aspect;
    const end = targetPose(want, aspect, { pos: f.to, q: f.toQ });
    if (!end) return;
    f.from[0] = camera.position.x;
    f.from[1] = camera.position.y;
    f.from[2] = camera.position.z;
    f.fromQ.copy(camera.quaternion);
    f.fromFov = lens.current.fov;
    f.fromSquash = lens.current.squash;
    f.toFov = end.fov;
    f.toSquash = end.squash;
    f.goal = want;
    f.startedAt = performance.now();
    f.active = true;
    f.measureUntil = 0;
    setFrameloop('always');
  });

  // Lens and placement. The first time the camera is put straight at the goal (the top-down pose
  // that matches the 2D map, or the seat with Reduce Motion); later resizes only refit the lens.
  useLayoutEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    const camera = get().camera as THREE.PerspectiveCamera;
    const aspect = size.width / size.height;
    camera.aspect = aspect;
    if (!placed.current) {
      const want: RigGoal = latest.current.reduceMotion ? latest.current.goal : 'top';
      const f = flight.current;
      const end = targetPose(want, aspect, { pos: f.cur, q: camera.quaternion });
      if (!end) return;
      placed.current = true;
      settled.current = `${want}:${latest.current.eyeSeat?.id}`;
      camera.position.set(f.cur[0], f.cur[1], f.cur[2]);
      lens.current = end;
    } else if (!flight.current.active) {
      const f = flight.current;
      const want = settled.current?.startsWith('pov') ? 'pov' : 'top';
      lens.current = targetPose(want, aspect, { pos: f.cur, q: f.toQ }) ?? lens.current;
    }
    applyLens(camera, lens.current.fov, lens.current.squash);
    invalidate();
  }, [size.width, size.height, get, invalidate]);

  const seatId = eyeSeat?.id;
  useEffect(() => {
    if (!placed.current) return;
    const key = `${goal}:${seatId}`;
    if (settled.current === key) return;
    settled.current = key;
    startFlight(goal);
  }, [goal, seatId]);

  useFrame((state, delta) => {
    if (failed.current) return;
    const f = flight.current;
    const now = performance.now();
    if (f.active) {
      const camera = state.camera as THREE.PerspectiveCamera;
      const p = flightProgress(now - f.startedAt, latest.current.reduceMotion);
      lerp3(f.cur, f.from, f.to, p);
      camera.position.set(f.cur[0], f.cur[1], f.cur[2]);
      camera.quaternion.slerpQuaternions(f.fromQ, f.toQ, p);
      lens.current.fov = f.fromFov + (f.toFov - f.fromFov) * p;
      lens.current.squash = f.fromSquash + (f.toSquash - f.fromSquash) * p;
      applyLens(camera, lens.current.fov, lens.current.squash);
      if (p >= 1) {
        f.active = false;
        if (__DEV__) {
          f.measureUntil = now + MEASURE_MS;
          f.frames = 0;
          f.sumDelta = 0;
        } else {
          // Nothing moves any more: draw only when something changes.
          setFrameloop('demand');
          invalidate();
        }
        latest.current.onArrive(f.goal);
      }
    } else if (__DEV__ && f.measureUntil > 0) {
      f.frames++;
      f.sumDelta += delta;
      if (now >= f.measureUntil) {
        f.measureUntil = 0;
        if (f.frames > 0) {
          const avg = (f.sumDelta / f.frames) * 1000;
          console.log(
            `[seat-view] avg frame ${avg.toFixed(1)} ms (${(1000 / avg).toFixed(0)} fps) over ${f.frames} frames, 3 s after flight`,
          );
        }
        setFrameloop('demand');
        invalidate();
      }
    }
  });

  // Frames are skipped while the app is not active (below); draw the current pose on return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') invalidate();
    });
    return () => sub.remove();
  }, [invalidate]);

  // Priority 1 takes over rendering from r3f; a throw (an expo-gl call that is not
  // implemented, a bad shader) must reach the 2D fallback instead of escaping the loop.
  useFrame(({ gl, scene, camera }) => {
    if (failed.current) return;
    // expo-gl stops running its queue once the app resigns active: a frame would only pile up,
    // and the wait below would block the JS thread until the app is active again.
    if (AppState.currentState === 'inactive' || AppState.currentState === 'background') return;
    try {
      // expo-gl runs GL calls on its own thread from an unbounded queue and presents only after
      // a drain. If a frame costs more than the frame budget (the simulator's software GL, a busy
      // GPU), queuing one every vsync piles up seconds of frames and the picture stops changing.
      // Wait for the previous frame first: at most one frame in flight, so frames keep presenting.
      (gl.getContext() as { flushEXP?: () => void }).flushEXP?.();
      gl.render(scene, camera);
      if (!reported.current && gl.info.render.calls > 0) {
        reported.current = true;
        latest.current.onDrew();
        // Nothing moves until the dive starts: draw only when something changes.
        if (!flight.current.active && flight.current.measureUntil === 0) setFrameloop('demand');
      }
    } catch (e) {
      failed.current = true;
      latest.current.onFail(`render threw: ${String(e)}`);
    }
  }, 1);

  return null;
}
