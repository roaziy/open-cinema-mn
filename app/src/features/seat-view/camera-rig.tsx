import type { SeatMap, SeatState } from '@open-cinema/shared';
import { useFrame, useThree } from '@react-three/fiber/native';
import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import type * as THREE from 'three';
import {
  type DivePose,
  divePose,
  easeInOut,
  eyePosition,
  FLY_MS,
  lensRange,
  lerp3,
  newDivePose,
  povFov,
  screenCenter,
  type TopDownPose,
  type Vec3,
} from './camera-math';
import { clearPosition, type Obstacles } from './room-layout';

/** Dev only: how long the average frame time is sampled after a flight. */
const MEASURE_MS = 3000;

export type RigGoal = 'top' | 'pov';

/** Lens: vertical fov, a vertical squash on the projection, a vertical principal-point shift. */
function applyLens(camera: THREE.PerspectiveCamera, fov: number, squash: number, shift: number) {
  const range = lensRange(camera.position.y);
  camera.fov = fov;
  camera.near = range.near;
  camera.far = range.far;
  camera.updateProjectionMatrix();
  const e = camera.projectionMatrix.elements;
  if (squash !== 1) e[5] = (e[5] ?? 1) * squash;
  // ndc.y = e5 * y / -z - e9: a negative e9 lifts the picture.
  if (shift !== 0) e[9] = -shift;
  if (squash !== 1 || shift !== 0)
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

type Flight = {
  active: boolean;
  /** dive: top <-> seat along the dive path; hop: seat <-> seat. */
  kind: 'dive' | 'hop';
  startedAt: number;
  durationMs: number;
  fromFov: number;
  toFov: number;
  s0: number;
  s1: number;
  eye: Vec3;
  from: Vec3;
  to: Vec3;
  cur: Vec3;
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
  /** 0 over the map ... 1 at the seat; written every frame of a flight for the fades around it. */
  dive: SharedValue<number>;
  /** Px of the canvas's bottom that the stats panel covers: the picture is lifted to stay centred above it. */
  cover: number;
  /** The room's solids: the camera stays out of them. */
  obstacles: Obstacles;
  /** A flight to `goal` finished. */
  onArrive: (goal: RigGoal) => void;
  /** A render finished and issued draw calls. */
  onDrew: () => void;
  /** Rendering threw. */
  onFail: (reason: string) => void;
};

const NO_SEAT: Vec3 = [0, 1.5, 6];
const scratch: Vec3 = [0, 0, 0];

/**
 * Owns the camera (the dive from the top-down pose that matches the 2D map to the seat and back,
 * hops between seats) and the render itself: r3f runs useFrame callbacks and then gl.render with
 * no try/catch, so the render is taken over here (priority 1) where a throw can route to the 2D
 * fallback.
 */
export function CameraRig({
  hall,
  eyeSeat,
  reduceMotion,
  topPose,
  goal,
  dive,
  cover,
  obstacles,
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
  /** Where along the dive the camera is, 0..1. */
  const at = useRef(0);
  const lens = useRef({ fov: topPose.fov, squash: topPose.squash, shift: 0 });
  const pose = useRef<DivePose>(newDivePose());
  const flight = useRef<Flight>({
    active: false,
    kind: 'dive',
    startedAt: 0,
    durationMs: FLY_MS,
    fromFov: 0,
    toFov: 0,
    s0: 0,
    s1: 1,
    eye: [0, 0, 0],
    from: [0, 0, 0],
    to: [0, 0, 0],
    cur: [0, 0, 0],
    measureUntil: 0,
    frames: 0,
    sumDelta: 0,
  });
  // Latest props for the frame loop and timers, which must not capture stale values.
  const latest = useRef({
    reduceMotion,
    eyeSeat,
    hall,
    topPose,
    goal,
    cover,
    obstacles,
    onArrive,
    onDrew,
    onFail,
  });
  useEffect(() => {
    latest.current = {
      reduceMotion,
      eyeSeat,
      hall,
      topPose,
      goal,
      cover,
      obstacles,
      onArrive,
      onDrew,
      onFail,
    };
  });

  const eyeOf = useEffectEvent((): Vec3 => {
    const seat = latest.current.eyeSeat;
    return seat ? eyePosition(seat) : NO_SEAT;
  });

  /** Put the camera on the dive path at `s`, with the lens that goes with it. */
  const placeAt = useEffectEvent((s: number, eye: Vec3) => {
    const camera = get().camera as THREE.PerspectiveCamera;
    const { topPose: top, hall: h, cover: c } = latest.current;
    const p = divePose(s, top, eye, screenCenter(h), povFov(eye, h, camera.aspect), pose.current);
    clearPosition(p.position, eye, null, latest.current.obstacles, scratch);
    p.position[0] = scratch[0];
    p.position[1] = scratch[1];
    p.position[2] = scratch[2];
    camera.position.set(p.position[0], p.position[1], p.position[2]);
    camera.up.set(p.up[0], p.up[1], p.up[2]);
    camera.lookAt(p.target[0], p.target[1], p.target[2]);
    const height = Math.max(1, get().size.height);
    lens.current = { fov: p.fov, squash: p.squash, shift: (c / height) * s };
    applyLens(camera, lens.current.fov, lens.current.squash, lens.current.shift);
    at.current = s;
  });

  const startFlight = useEffectEvent((want: RigGoal, hop: boolean) => {
    const f = flight.current;
    const camera = get().camera;
    const eye = eyeOf();
    f.startedAt = performance.now();
    f.measureUntil = 0;
    if (hop) {
      f.kind = 'hop';
      f.from[0] = camera.position.x;
      f.from[1] = camera.position.y;
      f.from[2] = camera.position.z;
      f.to[0] = eye[0];
      f.to[1] = eye[1];
      f.to[2] = eye[2];
      f.fromFov = lens.current.fov;
      f.toFov = povFov(eye, latest.current.hall, (camera as THREE.PerspectiveCamera).aspect);
      f.durationMs = FLY_MS;
    } else {
      f.kind = 'dive';
      f.eye[0] = eye[0];
      f.eye[1] = eye[1];
      f.eye[2] = eye[2];
      f.s0 = at.current;
      f.s1 = want === 'pov' ? 1 : 0;
      f.durationMs = FLY_MS * Math.max(0.35, Math.abs(f.s1 - f.s0));
    }
    f.active = true;
    setFrameloop('always');
  });

  // Lens and placement. The first time the camera is put straight at the start (the top-down
  // pose that matches the 2D map, or the seat with Reduce Motion); later resizes refit the lens.
  useLayoutEffect(() => {
    if (size.width === 0 || size.height === 0) return;
    const camera = get().camera as THREE.PerspectiveCamera;
    camera.aspect = size.width / size.height;
    if (!placed.current) {
      placed.current = true;
      const start = latest.current.reduceMotion && latest.current.goal === 'pov' ? 1 : 0;
      settled.current = `${start ? 'pov' : 'top'}:${latest.current.eyeSeat?.id}`;
      placeAt(start, eyeOf());
    } else if (!flight.current.active) {
      placeAt(at.current, eyeOf());
    }
    invalidate();
  }, [size.width, size.height, get, invalidate]);

  const seatId = eyeSeat?.id;
  useEffect(() => {
    if (!placed.current) return;
    const key = `${goal}:${seatId}`;
    if (settled.current === key) return;
    const prevGoal = settled.current?.split(':')[0];
    settled.current = key;
    if (prevGoal !== goal) startFlight(goal, false);
    else if (goal === 'pov' && flight.current.active && flight.current.kind === 'dive') {
      // A different seat while still diving in: aim the rest of the dive at it.
      const e = eyeOf();
      flight.current.eye[0] = e[0];
      flight.current.eye[1] = e[1];
      flight.current.eye[2] = e[2];
    } else if (goal === 'pov') startFlight(goal, true);
  }, [goal, seatId]);

  useFrame((state, delta) => {
    if (failed.current) return;
    const f = flight.current;
    const now = performance.now();
    if (f.active) {
      const camera = state.camera as THREE.PerspectiveCamera;
      const t = Math.min(1, (now - f.startedAt) / f.durationMs);
      const e = latest.current.reduceMotion ? 1 : easeInOut(t);
      const { topPose: top, hall: h, cover: c } = latest.current;
      const height = Math.max(1, state.size.height);
      if (f.kind === 'dive') {
        const s = f.s0 + (f.s1 - f.s0) * e;
        const p = divePose(
          s,
          top,
          f.eye,
          screenCenter(h),
          povFov(f.eye, h, camera.aspect),
          pose.current,
        );
        clearPosition(p.position, f.eye, null, latest.current.obstacles, scratch);
        p.position[0] = scratch[0];
        p.position[1] = scratch[1];
        p.position[2] = scratch[2];
        camera.position.set(p.position[0], p.position[1], p.position[2]);
        camera.up.set(p.up[0], p.up[1], p.up[2]);
        camera.lookAt(p.target[0], p.target[1], p.target[2]);
        lens.current = { fov: p.fov, squash: p.squash, shift: (c / height) * s };
        at.current = s;
        dive.set(s);
      } else {
        lerp3(f.cur, f.from, f.to, e);
        clearPosition(f.cur, f.from, f.to, latest.current.obstacles, scratch);
        camera.position.set(scratch[0], scratch[1], scratch[2]);
        lens.current.fov = f.fromFov + (f.toFov - f.fromFov) * e;
        camera.up.set(0, 1, 0);
        const ctr = screenCenter(h);
        camera.lookAt(ctr[0], ctr[1], ctr[2]);
      }
      applyLens(camera, lens.current.fov, lens.current.squash, lens.current.shift);
      if (t >= 1) {
        f.active = false;
        if (f.kind === 'dive') dive.set(f.s1);
        if (__DEV__) {
          f.measureUntil = now + MEASURE_MS;
          f.frames = 0;
          f.sumDelta = 0;
        } else {
          // Nothing moves any more: draw only when something changes.
          setFrameloop('demand');
          invalidate();
        }
        latest.current.onArrive(f.kind === 'dive' && f.s1 === 0 ? 'top' : 'pov');
      }
    } else if (__DEV__ && f.measureUntil > 0) {
      f.frames++;
      f.sumDelta += delta;
      if (now >= f.measureUntil) {
        f.measureUntil = 0;
        if (f.frames > 0) {
          const avg = (f.sumDelta / f.frames) * 1000;
          const ctx = state.gl.getContext();
          console.log(
            `[seat-view] avg frame ${avg.toFixed(1)} ms (${(1000 / avg).toFixed(0)} fps) over ${f.frames} frames, 3 s after flight, gl samples ${String(ctx.getParameter(ctx.SAMPLES))}`,
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
      // flushEXP has no timeout and expo-gl offers no non-blocking fence: if the GL thread ever
      // hung, JS would hang with it (the background case is guarded above).
      const ctx = gl.getContext() as WebGL2RenderingContext & { flushEXP?: () => void };
      ctx.flushEXP?.();
      gl.render(scene, camera);
      if (!reported.current && gl.info.render.calls > 0) {
        reported.current = true;
        // A draw is only queued until the GL thread has run it: wait once so "drew" means the
        // frame exists, then the crossfade never shows an empty canvas.
        ctx.flushEXP?.();
        if (__DEV__) {
          console.log(`[seat-view] gl samples ${String(ctx.getParameter(ctx.SAMPLES))}`);
        }
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
