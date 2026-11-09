/* eslint-disable react/no-unknown-property -- react-three-fiber props */
import { SCREEN_BOTTOM_M } from '@open-cinema/shared';
import { useThree } from '@react-three/fiber/native';
import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { type ScreenSource, smoothstep } from './camera-math';
import { palette } from './palette';
import { createKitGeometry, disposeKitGeometry, type ModuleGeometry } from './room-kit-geometry';
import {
  CARPET_SINK_M,
  CARPET_THICK_M,
  type Instance,
  type KitName,
  layoutRoom,
  moduleOf,
  type RoomInput,
} from './room-kit-layout';
import { aisleCentres } from './room-layout';
import { useCarpetTexture } from './room-texture';
import { useScreenTexture } from './screen-texture';

/** The screen bows toward the audience by this share of its width; IMAX's is curved more. */
const SCREEN_BOW: Record<KitName, number> = { standard: 0.015, imax: 0.035, dolby: 0.02 };
/**
 * The screen group stands this far off the wall: in front of the curtain's pleats (0.115 m) and
 * the masking border, so neither hides the picture's mask and halo.
 */
const SCREEN_Z = 0.2;
/** The kits' colours are dark and the room is lit by a few lights: lifted so detail reads. */
const ROOM_LIFT = 1.1;
/** What a sconce's glow keeps of its brightness while a film plays (the kit's `show_dim`). */
const SCONCE_SHOW_DIM = 0.15;
/** Carpet colour until its texture has loaded (the pattern's average). */
const CARPET_FLAT = '#241A1F';
/** Layout keys hung from the ceiling: hidden while the camera is above it. */
const CEILING_KEYS = new Set(['CeilingPanel', 'Downlight', 'SpeakerCeiling']);

/** Names of the screen's three layers: the hand-off to the 2D map fades them by name. */
export const SCREEN_FACE = 'screen-face';
export const SCREEN_MASK = 'screen-mask';
export const SCREEN_HALO = 'screen-halo';

const dummy = new THREE.Object3D();

/** What the scene drives while the dive runs (see Hall3D's `follow`). */
export type RoomControl = {
  /** `show`: 0 house lights up ... 1 film playing; `dive`: 0 over the hall ... 1 at the seat; `camY`: camera height. */
  update: (show: number, dive: number, camY: number) => void;
};

type Hall = { screen_width_m: number; screen_height_m: number; screen_x_m: number };
type Step = { from: number; to: number; height: number };
type SeatLike = { x_m: number; y_m: number; z_m: number; rowLabel: string };

type Props = {
  /** The screen group: the hand-off to the 2D map fades its three layers. */
  screenRef: RefObject<THREE.Group | null>;
  /** Set to the room's controls once it is built. */
  roomRef: RefObject<RoomControl | null>;
  kit: KitName;
  hall: Hall;
  drawable: SeatLike[];
  tone: string;
  screen: ScreenSource;
  steps: Step[];
  half: number;
  depth: number;
  wallH: number;
};

/** One module group (its lit surface or its glow) drawn once for all of its instances. */
function Placed({
  geometry,
  material,
  list,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  list: readonly Instance[];
}) {
  const invalidate = useThree((s) => s.invalidate);
  // A callback ref: it runs again whenever the mesh is rebuilt (a new geometry, material or
  // count), so the matrices are always written into the mesh that is on screen.
  const ref = useCallback(
    (mesh: THREE.InstancedMesh | null) => {
      if (!mesh) return;
      list.forEach((it, i) => {
        dummy.position.set(it.x, it.y, it.z);
        dummy.rotation.set(0, it.ry, it.rz ?? 0);
        dummy.scale.set(it.sx, it.sy, it.sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      invalidate();
    },
    [list, invalidate],
  );
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, Math.max(list.length, 1)]}
      frustumCulled={false}
    />
  );
}

/**
 * The room around the seats, built from the room kit for the showtime's format (see
 * room-kit-layout.ts): screen in its masking, stepped carpeted floor, walls, ceiling and the
 * fixtures, all sized to this hall. Every kit module is one instanced draw per material group.
 */
export function HallRoom({
  screenRef,
  roomRef,
  kit,
  hall,
  drawable,
  tone,
  screen,
  steps,
  half,
  depth,
  wallH,
}: Props) {
  const invalidate = useThree((s) => s.invalidate);
  const maxTexture = useThree((s) => s.gl.capabilities.maxTextureSize);
  const planeAspect = hall.screen_width_m / hall.screen_height_m;
  const texture = useScreenTexture(screen, planeAspect, maxTexture);
  const carpetTexture = useCarpetTexture(kit === 'standard');
  const stepsRef = useRef<THREE.InstancedMesh>(null);
  const ceilingRef = useRef<THREE.Group>(null);

  const layout = useMemo(() => {
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
      aisleXs: aisleCentres(drawable.map((s) => s.x_m)),
      seats: drawable,
    };
    return layoutRoom(kit, input);
  }, [kit, half, depth, wallH, hall, steps, drawable]);

  const parts = useMemo<Record<string, ModuleGeometry>>(() => createKitGeometry(kit), [kit]);
  const mats = useMemo(() => {
    const lit = (side: THREE.Side) =>
      new THREE.MeshLambertMaterial({
        vertexColors: true,
        color: new THREE.Color().setScalar(ROOM_LIFT),
        side,
      });
    const glow = () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    return {
      solid: lit(THREE.FrontSide),
      solidTwo: lit(THREE.DoubleSide),
      glow: glow(),
      glowDim: glow(),
      glowOff: glow(),
    };
  }, []);
  // Rebuilt when the texture arrives (a material's map cannot be added in place). From above the
  // floor is the plain step boxes, as on the 2D map: the carpet fades in with the dive.
  const carpetMat = useMemo(
    () =>
      new THREE.MeshLambertMaterial({
        vertexColors: true,
        map: carpetTexture,
        color: new THREE.Color(carpetTexture ? '#FFFFFF' : CARPET_FLAT),
        transparent: true,
        opacity: 0,
      }),
    [carpetTexture],
  );
  useEffect(
    () => () => {
      disposeKitGeometry(parts);
    },
    [parts],
  );
  useEffect(
    () => () => {
      for (const m of Object.values(mats)) m.dispose();
    },
    [mats],
  );
  useEffect(() => () => carpetMat.dispose(), [carpetMat]);

  const state = useRef({ show: 0, dive: 0, camY: 1e9 });
  const apply = useCallback(() => {
    const { show, dive, camY } = state.current;
    const fade = smoothstep(0.3, 0.85, dive);
    carpetMat.setValues({ opacity: fade, transparent: fade < 1 });
    mats.glowDim.color.setScalar(1 + (SCONCE_SHOW_DIM - 1) * show);
    mats.glowOff.color.setScalar(1 - show);
    if (ceilingRef.current) ceilingRef.current.visible = camY < wallH;
    invalidate();
  }, [carpetMat, mats, wallH, invalidate]);
  useLayoutEffect(() => {
    const control: RoomControl = {
      update: (show, dive, camY) => {
        state.current = { show, dive, camY };
        apply();
      },
    };
    roomRef.current = control;
    apply();
    return () => {
      if (roomRef.current === control) roomRef.current = null;
    };
  }, [roomRef, apply]);

  const screenGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(hall.screen_width_m, hall.screen_height_m, 32, 1);
    const p = g.getAttribute('position');
    const hw = hall.screen_width_m / 2;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / hw;
      p.setZ(i, hall.screen_width_m * SCREEN_BOW[kit] * u * u);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }, [hall.screen_width_m, hall.screen_height_m, kit]);
  useEffect(() => () => screenGeo.dispose(), [screenGeo]);

  // The step boxes under the carpet: the floor the camera collision knows. Their tops sit just
  // under the carpet tiles.
  useLayoutEffect(() => {
    const mesh = stepsRef.current;
    if (!mesh) return;
    steps.forEach((st, i) => {
      const h = Math.max(0.001, st.height - CARPET_SINK_M - CARPET_THICK_M);
      dummy.position.set(0, h / 2, (st.from + st.to) / 2);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(half * 2, h, st.to - st.from);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.count = steps.length;
    mesh.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [steps, half, invalidate]);

  const placed = (hanging: boolean) =>
    Object.entries(layout)
      .filter(([key, list]) => CEILING_KEYS.has(key) === hanging && list.length > 0)
      .flatMap(([key, list]) => {
        const name = moduleOf(key);
        const geo = parts[name];
        if (!geo) return [];
        const out = [];
        if (geo.solid) {
          const mat = name === 'Carpet' ? carpetMat : geo.doubleSided ? mats.solidTwo : mats.solid;
          out.push(<Placed key={`${key}-solid`} geometry={geo.solid} material={mat} list={list} />);
        }
        if (geo.glow) {
          const mat =
            name === 'Sconce' ? mats.glowDim : name === 'Downlight' ? mats.glowOff : mats.glow;
          out.push(<Placed key={`${key}-glow`} geometry={geo.glow} material={mat} list={list} />);
        }
        return out;
      });

  return (
    <>
      {/* Screen: bowed, cover-cropped film image in a black mask, brightest thing in the room.
          Always upright: tilting it behind the front wall hid it during the dive. */}
      <group ref={screenRef} position={[hall.screen_x_m, SCREEN_BOTTOM_M, SCREEN_Z]}>
        <mesh name={SCREEN_FACE} position={[0, hall.screen_height_m / 2, 0]} geometry={screenGeo}>
          <meshBasicMaterial
            key={texture ? 'tex' : 'flat'}
            map={texture}
            color={texture ? '#FFFFFF' : tone}
            transparent
            toneMapped={false}
            fog={false}
          />
        </mesh>
        <mesh name={SCREEN_MASK} position={[0, hall.screen_height_m / 2, -0.04]}>
          <planeGeometry args={[hall.screen_width_m * 1.07, hall.screen_height_m * 1.12]} />
          <meshBasicMaterial color="#030304" transparent toneMapped={false} fog={false} />
        </mesh>
        <mesh name={SCREEN_HALO} position={[0, hall.screen_height_m / 2, -0.07]}>
          <planeGeometry args={[hall.screen_width_m * 1.35, hall.screen_height_m * 1.6]} />
          <meshBasicMaterial
            color={tone}
            transparent
            opacity={0.2}
            depthWrite={false}
            toneMapped={false}
            fog={false}
          />
        </mesh>
      </group>

      {/* Stepped floor, one box per row (the carpet tiles lie on top of them). */}
      <instancedMesh
        ref={stepsRef}
        args={[undefined, undefined, Math.max(steps.length, 1)]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial color={palette.floor} />
      </instancedMesh>

      {/* The kit's modules. The wall tiles are one-sided and short (about a metre by two): from
          outside the hall (the dive passes over the back wall) they are invisible, and no quad
          crosses the camera's near plane. */}
      {placed(false)}
      <group ref={ceilingRef}>{placed(true)}</group>
    </>
  );
}
