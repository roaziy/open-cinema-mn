import type { SeatMap, SeatState } from '@open-cinema/shared';
import { useFrame, useThree } from '@react-three/fiber/native';
import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as THREE from 'three';
import {
  eyePosition,
  flightProgress,
  fovForAspect,
  type hallExtents,
  lerp3,
  screenCenter,
  topDownPosition,
  type Vec3,
} from './camera-math';

/** Pause on the top-down view before the camera dives to the seat. */
const START_DELAY_MS = 600;
/** Dev only: how long the average frame time is sampled after the fly-in. */
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

type Flight = {
  active: boolean;
  startedAt: number;
  from: Vec3;
  to: Vec3;
  cur: Vec3;
  fromQ: THREE.Quaternion;
  toQ: THREE.Quaternion;
  /** Dev only: performance.now() at which the frame-time window closes (0 = not sampling). */
  measureUntil: number;
  frames: number;
  sumDelta: number;
};

type Props = {
  ext: ReturnType<typeof hallExtents>;
  hall: SeatMap['hall'];
  eyeSeat: SeatState | undefined;
  reduceMotion: boolean;
  /** Dev only: stay on the top-down view. */
  hold: boolean;
  /** A render finished and issued draw calls. */
  onDrew: () => void;
  /** Rendering threw. */
  onFail: (reason: string) => void;
};

/**
 * Owns the camera (top-down start, ease-in-out dive to the seat, re-flight on seat change) and
 * the render itself: r3f runs useFrame callbacks and then gl.render with no try/catch, so the
 * render is taken over here (priority 1) where a throw can route to the 2D fallback.
 */
export function CameraRig({ ext, hall, eyeSeat, reduceMotion, hold, onDrew, onFail }: Props) {
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);
  const placed = useRef(false);
  const started = useRef(false);
  const reported = useRef(false);
  const failed = useRef(false);
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
  });
  // Latest props for the frame loop and timers, which must not capture stale values.
  const latest = useRef({ reduceMotion, eyeSeat, hall, onDrew, onFail });
  useEffect(() => {
    latest.current = { reduceMotion, eyeSeat, hall, onDrew, onFail };
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

  useFrame((state, delta) => {
    if (failed.current) return;
    const f = flight.current;
    const now = performance.now();
    if (f.active) {
      const camera = state.camera;
      const p = flightProgress(now - f.startedAt, latest.current.reduceMotion);
      lerp3(f.cur, f.from, f.to, p);
      camera.position.set(f.cur[0], f.cur[1], f.cur[2]);
      camera.quaternion.slerpQuaternions(f.fromQ, f.toQ, p);
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
      }
    } else if (__DEV__ && f.measureUntil > 0) {
      f.frames++;
      f.sumDelta += delta;
      if (now >= f.measureUntil) {
        f.measureUntil = 0;
        if (f.frames > 0) {
          const avg = (f.sumDelta / f.frames) * 1000;
          console.log(
            `[seat-view] avg frame ${avg.toFixed(1)} ms (${(1000 / avg).toFixed(0)} fps) over ${f.frames} frames, 3 s after fly-in`,
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
      }
    } catch (e) {
      failed.current = true;
      latest.current.onFail(`render threw: ${String(e)}`);
    }
  }, 1);

  return null;
}
