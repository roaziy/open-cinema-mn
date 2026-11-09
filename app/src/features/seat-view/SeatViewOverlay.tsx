import { type SeatMap, type SeatState, seatViewStats } from '@open-cinema/shared';
import { Stack } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AppState,
  type LayoutChangeEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  SensorType,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedSensor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { Pressable } from '@/components/pressable';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { mediaUrl } from '@/lib/http';
import { seatLabel } from '@/lib/seats';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import {
  type CamState,
  FLY_MS,
  pickScreenSource,
  safeTone,
  smoothstep,
  type TopDownPose,
} from './camera-math';
import type { RigGoal } from './camera-rig';
import { GlBoundary } from './gl-boundary';
import { createGlMachine } from './gl-machine';
import { Hall2D } from './Hall2D';
import { CROSSFADE_MS } from './handoff';
import {
  angleDiff,
  dragLook,
  foldGyroLook,
  type Look,
  newLook,
  phoneAim,
  setGyroLook,
} from './look-around';
import { StatsCard } from './StatsCard';
import { goalOf, initialTransition, panelLive, transitionReducer } from './transition-machine';

// Loaded on demand: if three or expo-gl cannot even be imported, the boundary routes to 2D.
const Hall3D = lazy(() => import('./Hall3D'));

/** If no frame has been drawn this long after the canvas mounts, GL is treated as unavailable. */
const WATCHDOG_MS = 3000;
/** Crossfade between the 2D map and the 3D picture. */
export const FADE_MS = 200;
/** The dive's progress at which the stats panel starts to slide in. */
const PANEL_FROM = 0.85;

function byPosition(a: SeatState, b: SeatState) {
  return a.y_m - b.y_m || a.x_m - b.x_m;
}

export type OverlayRect = { x: number; y: number; w: number; h: number };

/** Looking more steeply than this up or down, the phone's heading is too unsteady to follow. */
const STEEP = 1.35;

/**
 * While mounted, turning the phone turns the view, by the phone's turn since it mounted (the
 * motion sensor runs only meanwhile). Unmounting keeps the view where it is.
 */
function PhoneLook({ look }: { look: Look }) {
  const rotation = useAnimatedSensor(SensorType.ROTATION, {
    interval: 'auto',
    adjustToInterfaceOrientation: false,
  });
  const start = useRef<{ heading: number; elevation: number } | null>(null);
  const onTurn = useCallback(
    (qx: number, qy: number, qz: number, qw: number) => {
      const aim = phoneAim(qx, qy, qz, qw);
      if (!start.current) {
        start.current = aim;
        return;
      }
      const yaw =
        Math.abs(aim.elevation) > STEEP
          ? look.gyroYaw
          : angleDiff(aim.heading, start.current.heading);
      setGyroLook(look, yaw, aim.elevation - start.current.elevation);
    },
    [look],
  );
  useAnimatedReaction(
    () => rotation.sensor.get(),
    (q) => {
      // the sensor's first value, before any reading, is all zeros
      if (q.qw === 0 && q.qx === 0 && q.qy === 0 && q.qz === 0) return;
      scheduleOnRN(onTurn, q.qx, q.qy, q.qz, q.qw);
    },
  );
  useEffect(() => () => foldGyroLook(look), [look]);
  return null;
}

type Props = {
  map: SeatMap;
  /** The seats the viewer holds right now; the view can switch between them. */
  selected: SeatState[];
  /** The seat to look from first. */
  initialSeatId: string;
  /** Seats others hold or bought, as the 2D map showed them when the view opened. */
  takenIds: string[];
  /** The 3D canvas, in the seat map screen's coordinates: the whole window. */
  rect: OverlayRect;
  /** The camera pose that lines the first 3D frame up with the 2D map. */
  topPose: TopDownPose;
  /** 0 over the map ... 1 at the seat. The screen fades the map's header and footer with it. */
  dive: SharedValue<number>;
  /** 0 = the map shows, 1 = the 3D picture covers it. */
  fade: SharedValue<number>;
  /** The 3D camera as numbers (written by the rig). */
  cam: SharedValue<CamState>;
  /** NOT_CLOSING, or where the dive was when leaving began: the scene morphs toward the 2D look. */
  closingFlag: SharedValue<number>;
  /** The viewer asked to leave (back button). */
  closing: boolean;
  /** Ask to leave (holds expired). */
  onRequestClose: () => void;
  /** The map is fully back: the screen can unmount this. */
  onClosed: () => void;
  /** Dev only: force the 2D fallback. */
  forceFallback: boolean;
  /** Dev only: stay on the top-down start. */
  holdTop: boolean;
};

/**
 * The 3D view from a seat, shown over the seat map in place. The canvas starts looking straight
 * down at the pose of the 2D map; once its first real frame is drawn it fades in over the map,
 * then the camera dives to the seat. Leaving flies back up and fades to the map again. If GL
 * fails, the 2D side profile fades in over the canvas. The phases live in transition-machine.ts.
 */
export function SeatViewOverlay({
  map,
  selected,
  initialSeatId,
  takenIds,
  rect,
  topPose,
  dive,
  fade,
  closingFlag,
  cam,
  closing,
  onRequestClose,
  onClosed,
  forceFallback,
  holdTop,
}: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const [picked, setPicked] = useState<string | null>(null);
  const [panelH, setPanelH] = useState(0);
  // A seat switch is flying: further taps and back wait for it to land.
  const [hopping, setHopping] = useState(false);
  // Looking around from the seat: a drag, and (switched on from the header) turning the phone.
  const [look] = useState(newLook);
  const [phoneLook, setPhoneLook] = useState(false);
  const fallbackFade = useSharedValue(0);
  const [tr, send] = useReducer(
    transitionReducer,
    { still: reduceMotion, hold: __DEV__ && holdTop, forceFallback: __DEV__ && forceFallback },
    initialTransition,
  );

  // Render-loop state machine: ready only after a real draw; any failure or no draw in 3 s -> 2D.
  const [machine] = useState(() =>
    createGlMachine({
      timeoutMs: WATCHDOG_MS,
      onFail: (reason) => {
        if (__DEV__) console.warn(`[seat-view] 2D fallback: ${reason}`);
      },
    }),
  );
  const gl = useSyncExternalStore(machine.subscribe, machine.getState);
  const onDrew = useCallback(() => machine.dispatch({ type: 'drew' }), [machine]);
  const onFail = useCallback(
    (reason: string) => machine.dispatch({ type: 'error', reason }),
    [machine],
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) =>
      next === 'active' ? machine.resume() : machine.pause(),
    );
    return () => {
      sub.remove();
      machine.dispose();
    };
  }, [machine]);
  useEffect(() => {
    if (gl === 'ready') send({ type: 'ready' });
    else if (gl === 'failed') send({ type: 'failed' });
  }, [gl]);

  // Seats: the one being viewed stays on screen after its hold ran out, while the view leaves.
  const seats = useMemo(() => [...selected].sort(byPosition), [selected]);
  const found =
    seats.find((s) => s.id === picked) ?? seats.find((s) => s.id === initialSeatId) ?? seats[0];
  const [kept, setKept] = useState(found);
  if (found && found !== kept) setKept(found);
  const current = found ?? kept;
  const stats = useMemo(
    () => (current ? seatViewStats(current, map.hall) : null),
    [current, map.hall],
  );
  const selectedIds = useMemo(() => seats.map((s) => s.id), [seats]);
  const tone = safeTone(map.showtime.movie.tone);
  const screen = useMemo(() => {
    const src = pickScreenSource(map.showtime.movie);
    return src.kind === 'remote' ? { ...src, url: mediaUrl(src.url) } : src;
  }, [map.showtime.movie]);

  // Holds all expired while looking: nothing left to look from, so leave.
  useEffect(() => {
    if (!found) onRequestClose();
  }, [found, onRequestClose]);
  useEffect(() => {
    if (closing && !hopping) send({ type: 'close' });
  }, [closing, hopping]);

  // The grid crossfade back to the map: 450 ms, started ahead of the landing when there is a flight.
  const crossfading = useRef(false);
  const startCrossfade = useCallback(() => {
    crossfading.current = true;
    fallbackFade.set(withTiming(0, { duration: CROSSFADE_MS }));
    fade.set(
      withTiming(0, { duration: CROSSFADE_MS }, (done) => {
        'worklet';
        if (done) scheduleOnRN(send, { type: 'faded-out' });
      }),
    );
  }, [fade, fallbackFade]);
  useEffect(() => {
    if (tr.handoff && !crossfading.current) startCrossfade();
  }, [tr.handoff, startCrossfade]);

  // Phase -> animation.
  const still = tr.still;
  useEffect(() => {
    if (tr.phase === 'fading-in' && !tr.fallback) {
      fade.set(
        withTiming(1, { duration: FADE_MS }, (done) => {
          'worklet';
          if (done) scheduleOnRN(send, { type: 'faded-in' });
        }),
      );
    } else if (tr.phase === 'fading-out') {
      // Already under way when the crossfade started ahead of the landing.
      if (!crossfading.current) startCrossfade();
    } else if (tr.phase === 'closed') {
      onClosed();
    }
  }, [tr.phase, tr.fallback, fade, onClosed, startCrossfade]);
  useEffect(() => {
    if (!tr.fallback || tr.phase === 'mounting' || tr.phase === 'fading-out') return;
    if (tr.phase === 'leaving' || tr.phase === 'closed') return;
    fallbackFade.set(
      withTiming(1, { duration: FADE_MS }, (done) => {
        'worklet';
        if (done) {
          scheduleOnRN(send, { type: 'fallback-shown' });
          scheduleOnRN(send, { type: 'faded-in' });
        }
      }),
    );
  }, [tr.fallback, tr.phase, fallbackFade]);
  // Reduce Motion: the scene is at the seat from the start; only the crossfade is animated.
  useEffect(() => {
    if (still) dive.set(1);
  }, [still, dive]);
  // A flight home that never reports must not strand the viewer.
  useEffect(() => {
    if (tr.phase !== 'leaving') return;
    const timer = setTimeout(() => send({ type: 'timeout' }), FLY_MS + 3000);
    return () => clearTimeout(timer);
  }, [tr.phase]);

  const onLead = useCallback(() => send({ type: 'near-landing' }), []);

  const onArrive = useCallback((arrived: RigGoal) => {
    if (arrived === 'pov') {
      setHopping(false);
      haptic.tap();
      send({ type: 'landed' });
    } else send({ type: 'landed-top' });
  }, []);

  const fallback = tr.fallback;
  const canvasStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));
  const fallbackStyle = useAnimatedStyle(() => ({ opacity: fallbackFade.get() }));
  const panelStyle = useAnimatedStyle(() => {
    const p = fallback
      ? fallbackFade.get()
      : still
        ? fade.get()
        : smoothstep(PANEL_FROM, 1, dive.get());
    // Slides exactly its own height: a taller or shorter panel never peeks.
    return { transform: [{ translateY: (1 - p) * (panelH + 4) }] };
  });

  // At the seat, a drag on the picture looks around (the scene follows the finger).
  const lookable = panelLive(tr) && !hopping && !fallback;
  const lookPan = usePanGesture({
    runOnJS: true,
    enabled: lookable,
    minDistance: 4,
    onUpdate: (e) => dragLook(look, e.changeX, e.changeY, rect.w),
  });
  const phoneOn = phoneLook && lookable;

  if (!current || !stats) return null;

  const a11y = t('view.a11y', {
    row: current.rowLabel,
    distance: stats.distanceM.toFixed(1),
    off: Math.round(stats.offCenterDeg),
  });
  const live = panelLive(tr);

  const chips =
    seats.length > 1 ? (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        accessibilityLabel={t('view.switcher')}
      >
        {seats.map((s) => {
          const on = s.id === current.id;
          return (
            <Pressable
              key={s.id}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => {
                if (on || hopping || !live) return;
                haptic.select();
                if (!tr.fallback) setHopping(true);
                setPicked(s.id);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t('view.seat', { seat: seatLabel(s) })}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{seatLabel(s)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    ) : null;

  const showCanvas = !(fallback && tr.fallbackShown);

  return (
    <>
      {phoneOn ? <PhoneLook look={look} /> : null}
      {/* ponytail: iOS only (SF Symbol); Android needs an image icon for the header button. */}
      {Platform.OS === 'ios' && lookable ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="gyroscope"
            selected={phoneLook}
            accessibilityLabel={t('view.lookAround')}
            onPress={() => {
              haptic.select();
              setPhoneLook((on) => !on);
            }}
          />
        </Stack.Toolbar>
      ) : null}
      <View style={[StyleSheet.absoluteFill, styles.canvasLayer]}>
        {showCanvas ? (
          <GestureDetector gesture={lookPan}>
            <Animated.View
              style={[
                styles.canvas,
                { left: rect.x, top: rect.y, width: rect.w, height: rect.h },
                canvasStyle,
              ]}
            >
              <GlBoundary
                onError={(e) =>
                  machine.dispatch({ type: 'error', reason: `render/import error: ${String(e)}` })
                }
              >
                <Suspense fallback={null}>
                  <Hall3D
                    seats={map.seats}
                    hall={map.hall}
                    tone={tone}
                    screen={screen}
                    selectedIds={selectedIds}
                    takenIds={takenIds}
                    currentId={current.id}
                    reduceMotion={still}
                    topPose={topPose}
                    goal={goalOf(tr)}
                    dive={dive}
                    onArrive={onArrive}
                    onLead={onLead}
                    closing={closingFlag}
                    cam={cam}
                    onMount={machine.start}
                    onDrew={onDrew}
                    onFail={onFail}
                    lookAround={look}
                  />
                </Suspense>
              </GlBoundary>
            </Animated.View>
          </GestureDetector>
        ) : null}
      </View>
      <View
        style={[StyleSheet.absoluteFill, styles.topLayer]}
        pointerEvents="box-none"
        accessibilityViewIsModal
      >
        {/* The picture's description lives here, in the modal layer, so VoiceOver can reach it. */}
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={a11y}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
        {fallback ? (
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.fallback, fallbackStyle]}
            pointerEvents="box-none"
          >
            <ScrollView
              contentContainerStyle={{
                paddingTop: headerHeight + space.sm,
                paddingBottom: panelH + space.lg,
                gap: space.md,
              }}
            >
              <Hall2D
                seats={map.seats}
                hall={map.hall}
                tone={tone}
                selectedIds={selectedIds}
                currentId={current.id}
                width={width}
                a11y={a11y}
              />
            </ScrollView>
          </Animated.View>
        ) : null}
        <Animated.View
          style={[styles.panel, { paddingBottom: Math.max(insets.bottom, space.lg) }, panelStyle]}
          pointerEvents={live ? 'auto' : 'none'}
          accessibilityElementsHidden={!live}
          importantForAccessibility={live ? 'auto' : 'no-hide-descendants'}
          onLayout={(e: LayoutChangeEvent) => setPanelH(e.nativeEvent.layout.height)}
        >
          {chips}
          <View style={styles.statsWrap}>
            <StatsCard seatLabel={seatLabel(current)} kind={current.kind} stats={stats} />
          </View>
        </Animated.View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  /** Over the 2D grid, under the page chrome (zIndex 3 on the screen). */
  canvasLayer: { zIndex: 2 },
  /** Over everything: the diagram fallback and the stats panel. */
  topLayer: { zIndex: 4 },
  fallback: { backgroundColor: colors.canvas },
  canvas: { position: 'absolute', backgroundColor: colors.canvas, overflow: 'hidden' },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.raised,
    borderTopLeftRadius: radius.panel,
    borderTopRightRadius: radius.panel,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
    paddingTop: space.md,
    gap: space.md,
  },
  chips: { paddingHorizontal: space.lg, gap: space.sm, alignItems: 'center' },
  chip: {
    height: 34,
    minWidth: 52,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.fill,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  chipOn: { backgroundColor: colors.action, borderColor: colors.action },
  chipText: { ...type.bodyMedium, color: colors.body, fontVariant: ['tabular-nums'] },
  chipTextOn: { color: colors.onAction },
  statsWrap: { paddingHorizontal: space.lg },
});
