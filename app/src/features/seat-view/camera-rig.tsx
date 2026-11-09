import type { SeatMap, SeatState } from '@open-cinema/shared';
import { useFrame, useThree } from '@react-three/fiber/native';
import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import type * as THREE from 'three';
import { divePace, shouldLead, turnBlendMs, turnRoundAt, turnRoundMs } from './camera-clock';
import { hopDurationMs, hopFrame } from './camera-hop';
import {
  type CamState,
  camOf,
  type DivePose,
  divePose,
  eyePosition,
  fovForAspect,
  gridAlignmentPx,
  lensRange,
  newDivePose,
  screenCenter,
  seatView,
  type TopDownPose,
  type Vec3,
} from './camera-math';
import { type Look, lookPitch, lookWeight, lookYaw, stepLook, subscribeLook } from './look-around';
import { clearPosition, type Obstacles } from './room-layout';

/** Dev only: how long the average frame time is sampled after a flight. */
const MEASURE_MS = 3000;

/** Height (m) of the points the grid alignment is measured on: about the seat tops. */
const ALIGN_Y = 1;

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

/** Never quite straight up or down: the heading stays defined. */
const PITCH_LIMIT = 1.45;

/** The look-around turn on top of a pose, `w` of it (heading and elevation only). */
function turnBy(p: DivePose, look: Look, w: number) {
  if (w <= 0) return;
  p.yaw += lookYaw(look) * w;
  p.pitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, p.pitch + lookPitch(look) * w));
}

/** Copy a pose into another (no allocation). */
function copyPose(from: DivePose, to: DivePose): DivePose {
  to.position[0] = from.position[0];
  to.position[1] = from.position[1];
  to.position[2] = from.position[2];
  to.yaw = from.yaw;
  to.pitch = from.pitch;
  to.fov = from.fov;
  to.squash = from.squash;
  return to;
}

/** Position and heading/elevation (no roll: the right vector stays horizontal). */
function applyPose(camera: THREE.PerspectiveCamera, p: DivePose) {
  camera.position.set(p.position[0], p.position[1], p.position[2]);
  camera.rotation.order = 'YXZ';
  camera.rotation.set(p.pitch, p.yaw, 0);
}

type Flight = {
  active: boolean;
  /** dive: top <-> seat along the dive path; hop: seat <-> seat. */
  kind: 'dive' | 'hop';
  startedAt: number;
  durationMs: number;
  s0: number;
  s1: number;
  /** The dive's pace, progress per ms (negative when closing). */
  pace: number;
  /** The pace the camera had when this dive turned another round (0 when it started at rest)... */
  v0: number;
  /** ...and how long the swing to the new pace takes, ms. */
  blend: number;
  /** Latest measured pace, progress per ms (for turning a dive round smoothly). */
  vel: number;
  lastTau: number;
  lastAt: number;
  eye: Vec3;
  /** The lead-out signal of a closing flight has been sent. */
  leadSent: boolean;
  /** Per flight, not per frame: the screen's centre and the seat lenses. */
  center: Vec3;
  povA: number;
  povB: number;
  from: Vec3;
  to: Vec3;
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
  /** The room's solids: the camera stays out of them. */
  obstacles: Obstacles;
  /** A flight to `goal` finished. */
  onArrive: (goal: RigGoal) => void;
  /** A closing flight is LEAD_MS from landing over the map: the crossfade can start. */
  onLead: () => void;
  /** The camera as plain numbers, for the 2D landmarks that ride on the 3D grid. */
  cam: SharedValue<CamState>;
  /** A render finished and issued draw calls. */
  onDrew: () => void;
  /** Rendering threw. */
  onFail: (reason: string) => void;
  /** Where the view from the seat is turned to by a drag or the phone (applied at the seat). */
  look: Look;
};

const NO_SEAT: Vec3 = [0, 1.5, 6];
const scratch: Vec3 = [0, 0, 0];
const viewPt: Vec3 = [0, 0, 0];

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
  obstacles,
  onArrive,
  onLead,
  cam,
  onDrew,
  onFail,
  look,
}: Props) {
  const get = useThree((s) => s.get);
  const size = useThree((s) => s.size);
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);
  const placed = useRef(false);
  /** The look-around turn is moving: keep drawing every frame. */
  const looking = useRef(false);
  const settled = useRef<string | null>(null);
  const reported = useRef(false);
  const failed = useRef(false);
  /** Where along the dive the camera is, 0..1. */
  const at = useRef(0);
  const lens = useRef({ fov: topPose.fov, squash: topPose.squash, shift: 0 });
  const pose = useRef<DivePose>(newDivePose());
  /** The camera's pose before the look-around turn (at rest the turn is re-applied on it). */
  const base = useRef<DivePose>(newDivePose());
  const flight = useRef<Flight>({
    active: false,
    kind: 'dive',
    startedAt: 0,
    durationMs: 1600,
    s0: 0,
    s1: 1,
    pace: 0,
    blend: 0,
    v0: 0,
    vel: 0,
    lastTau: 0,
    lastAt: 0,
    eye: [0, 0, 0],
    leadSent: false,
    center: [0, 0, 0],
    povA: 50,
    povB: 50,
    from: [0, 0, 0],
    to: [0, 0, 0],
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
    obstacles,
    onArrive,
    onLead,
    onDrew,
    onFail,
    look,
  });
  useEffect(() => {
    latest.current = {
      reduceMotion,
      eyeSeat,
      hall,
      topPose,
      goal,
      obstacles,
      onArrive,
      onLead,
      onDrew,
      onFail,
      look,
    };
  });

  const eyeOf = useEffectEvent((): Vec3 => {
    const seat = latest.current.eyeSeat;
    return seat ? eyePosition(seat) : NO_SEAT;
  });

  /** Put the camera on the dive curve at linear progress `tau`, with the lens that goes with it. */
  const placeAt = useEffectEvent((tau: number, eye: Vec3) => {
    const camera = get().camera as THREE.PerspectiveCamera;
    const { topPose: top, hall: h, obstacles: ob } = latest.current;
    const p = divePose(
      tau,
      top,
      eye,
      screenCenter(h),
      fovForAspect(camera.aspect),
      pose.current,
      ob,
    );
    clearPosition(p.position, seatView(eye, screenCenter(h), ob, viewPt), null, ob, scratch);
    p.position[0] = scratch[0];
    p.position[1] = scratch[1];
    p.position[2] = scratch[2];
    copyPose(p, base.current);
    turnBy(p, latest.current.look, lookWeight(tau));
    applyPose(camera, p);
    lens.current = { fov: p.fov, squash: p.squash, shift: 0 };
    applyLens(camera, lens.current.fov, lens.current.squash, lens.current.shift);
    at.current = tau;
    cam.set(camOf(p, lens.current.shift, get().size.width, get().size.height));
  });

  /** Hand the current camera to the UI thread (the landmark layer projects through it). */
  const publishCam = (w: number, h: number) => {
    const now = camOf(pose.current, lens.current.shift, w, h);
    cam.set(now);
    return now;
  };

  const startFlight = useEffectEvent((want: RigGoal, hop: boolean) => {
    const f = flight.current;
    const camera = get().camera as THREE.PerspectiveCamera;
    const eye = eyeOf();
    const { hall: h } = latest.current;
    f.startedAt = performance.now();
    f.measureUntil = 0;
    f.leadSent = false;
    const c = screenCenter(h);
    f.center[0] = c[0];
    f.center[1] = c[1];
    f.center[2] = c[2];
    const turnedRound = f.active && f.kind === 'dive';
    if (hop) {
      f.kind = 'hop';
      f.from[0] = camera.position.x;
      f.from[1] = camera.position.y;
      f.from[2] = camera.position.z;
      // seat to seat: from the view over one seat's back to the next's
      seatView(eye, c, latest.current.obstacles, f.to);
      f.povA = lens.current.fov;
      f.povB = fovForAspect(camera.aspect);
      f.s0 = 0;
      f.s1 = 1;
      f.durationMs = hopDurationMs(f.from, f.to);
      f.v0 = 0;
    } else {
      f.kind = 'dive';
      f.eye[0] = eye[0];
      f.eye[1] = eye[1];
      f.eye[2] = eye[2];
      f.povB = fovForAspect(camera.aspect);
      const closing = want === 'top';
      f.s0 = at.current;
      f.s1 = closing ? 0 : 1;
      f.pace = divePace(closing);
      f.v0 = 0;
      f.durationMs = Math.abs(f.s1 - f.s0) / Math.abs(f.pace);
      if (turnedRound && f.vel !== 0) {
        // Turned round in flight: the pace swings from the camera's to the new move's, then the
        // rest plays exactly like the normal move. Timed from the frame `s0` was drawn at.
        f.v0 = f.vel;
        f.blend = turnBlendMs(f.s0, f.v0);
        f.durationMs = turnRoundMs(f.s0, f.s1, f.v0, f.pace, f.blend);
        if (f.lastAt > 0) f.startedAt = f.lastAt;
      }
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

  // A drag, a fling or the phone moves the view: draw every frame until it settles (the turn
  // is stepped in the frame loop, so uneven touch and sensor events never show as jerks).
  useEffect(
    () =>
      subscribeLook(look, () => {
        if (!placed.current) return;
        setFrameloop('always');
      }),
    [look, setFrameloop],
  );

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
    const wasLooking = looking.current;
    looking.current = stepLook(latest.current.look, delta * 1000);
    if (f.active) {
      const camera = state.camera as THREE.PerspectiveCamera;
      const t = Math.min(1, (now - f.startedAt) / f.durationMs);
      const linear = latest.current.reduceMotion ? 1 : t;
      const { topPose: top, obstacles: ob } = latest.current;
      if (f.kind === 'dive') {
        const tau =
          f.v0 !== 0 && !latest.current.reduceMotion
            ? Math.min(1, Math.max(0, turnRoundAt(now - f.startedAt, f.s0, f.v0, f.pace, f.blend)))
            : f.s0 + (f.s1 - f.s0) * linear;
        const k = Math.min(1, Math.max(0, tau));
        const p = divePose(k, top, f.eye, f.center, f.povB, pose.current, ob);
        clearPosition(p.position, seatView(f.eye, f.center, ob, viewPt), null, ob, scratch);
        p.position[0] = scratch[0];
        p.position[1] = scratch[1];
        p.position[2] = scratch[2];
        // the look-around turn fades out early in a close: the way back is exactly the dive's
        copyPose(p, base.current);
        turnBy(p, latest.current.look, lookWeight(k));
        applyPose(camera, p);
        lens.current = { fov: p.fov, squash: p.squash, shift: 0 };
        const dtMs = now - f.lastAt;
        if (f.lastAt > 0 && dtMs > 0) f.vel = (tau - f.lastTau) / dtMs;
        f.lastTau = tau;
        f.lastAt = now;
        at.current = tau;
        dive.set(k);
      } else {
        // Seat to seat: one curve that rises over the seat backs between the two.
        const p = hopFrame(linear, f.from, f.to, f.center, f.povA, f.povB, ob, pose.current);
        copyPose(p, base.current);
        turnBy(p, latest.current.look, 1);
        applyPose(camera, p);
        lens.current = { fov: p.fov, squash: 1, shift: 0 };
      }
      applyLens(camera, lens.current.fov, lens.current.squash, lens.current.shift);
      const drawn = publishCam(state.size.width, state.size.height);
      if (
        f.kind === 'dive' &&
        f.s1 === 0 &&
        !f.leadSent &&
        shouldLead(gridAlignmentPx(drawn, latest.current.topPose, ALIGN_Y), true, false)
      ) {
        f.leadSent = true;
        latest.current.onLead();
      }
      if (t >= 1) {
        f.active = false;
        f.vel = 0;
        f.lastAt = 0;
        if (f.kind === 'dive') dive.set(f.s1);
        if (__DEV__) {
          f.measureUntil = now + MEASURE_MS;
          f.frames = 0;
          f.sumDelta = 0;
        } else if (!looking.current) {
          // Nothing moves any more: draw only when something changes.
          setFrameloop('demand');
          invalidate();
        }
        latest.current.onArrive(f.kind === 'dive' && f.s1 === 0 ? 'top' : 'pov');
      }
      return;
    }
    // At rest: the view turns in place while the look moves (and once more as it settles).
    if (looking.current || wasLooking) {
      const p = copyPose(base.current, pose.current);
      turnBy(p, latest.current.look, lookWeight(at.current));
      applyPose(state.camera as THREE.PerspectiveCamera, p);
      publishCam(state.size.width, state.size.height);
    }
    if (__DEV__ && f.measureUntil > 0) {
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
        if (!looking.current) setFrameloop('demand');
        invalidate();
      }
    } else if (!looking.current) {
      setFrameloop('demand');
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
        if (!flight.current.active && flight.current.measureUntil === 0 && !looking.current)
          setFrameloop('demand');
      }
    } catch (e) {
      failed.current = true;
      latest.current.onFail(`render threw: ${String(e)}`);
    }
  }, 1);

  return null;
}
