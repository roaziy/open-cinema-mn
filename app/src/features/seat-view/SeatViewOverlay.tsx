import { type SeatMap, type SeatState, seatViewStats } from '@open-cinema/shared';
import { useHeaderHeight } from 'expo-router/react-navigation';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AppState,
  type LayoutChangeEvent,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  type SharedValue,
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
import { seatLabel } from '@/lib/seats';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { FLY_MS, pickScreenSource, safeTone, type TopDownPose } from './camera-math';
import type { RigGoal } from './camera-rig';
import { GlBoundary } from './gl-boundary';
import { createGlMachine } from './gl-machine';
import { Hall2D } from './Hall2D';
import { StatsCard } from './StatsCard';

// Loaded on demand: if three or expo-gl cannot even be imported, the boundary routes to 2D.
const Hall3D = lazy(() => import('./Hall3D'));

/** If no frame has been drawn this long after the canvas mounts, GL is treated as unavailable. */
const WATCHDOG_MS = 3000;
/** Crossfade between the 2D map and the 3D picture. */
export const FADE_MS = 200;
const PANEL_MS = 280;
/** How far the stats panel travels when it slides in and out. */
const PANEL_TRAVEL = 220;
/** Swipe down this far (or fast) to leave the view. */
const DISMISS_PX = 90;
const DISMISS_VELOCITY = 900;

function byPosition(a: SeatState, b: SeatState) {
  return a.y_m - b.y_m || a.x_m - b.x_m;
}

export type OverlayRect = { x: number; y: number; w: number; h: number };

type Props = {
  map: SeatMap;
  /** The seats the viewer holds right now; the view can switch between them. */
  selected: SeatState[];
  /** The seat to look from first. */
  initialSeatId: string;
  /** The 3D canvas, in the seat map screen's coordinates: exactly the 2D map's viewport. */
  rect: OverlayRect;
  /** The camera pose that lines the first 3D frame up with the 2D map. */
  topPose: TopDownPose;
  /** 0 = the 2D map shows, 1 = the 3D picture shows. Owned by the screen, which fades its map with it. */
  fade: SharedValue<number>;
  /** The viewer asked to leave (back button, swipe down). */
  closing: boolean;
  /** Ask to leave. */
  onRequestClose: () => void;
  /** The 2D map is fully back: the screen can unmount this. */
  onClosed: () => void;
  /** Dev only: force the 2D fallback. */
  forceFallback: boolean;
  /** Dev only: stay on the top-down start. */
  holdTop: boolean;
};

/**
 * The 3D view from a seat, shown over the seat map in place. The canvas starts looking straight
 * down at the pose of the 2D map; once its first real frame is drawn the two crossfade, then the
 * camera dives to the seat. Leaving flies back up and crossfades to the map again. If GL fails,
 * the 2D side profile takes the canvas's place with the same crossfade.
 */
export function SeatViewOverlay({
  map,
  selected,
  initialSeatId,
  rect,
  topPose,
  fade,
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
  const [shown, setShown] = useState(false);
  const [panelH, setPanelH] = useState(0);

  // Render-loop state machine: ready only after a real draw; any failure or no draw in 3 s -> 2D.
  const [machine] = useState(() =>
    createGlMachine({
      timeoutMs: WATCHDOG_MS,
      initial: __DEV__ && forceFallback ? 'failed' : 'loading',
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

  // 0 = stats panel tucked away, 1 = in place.
  const panel = useSharedValue(0);

  const seats = useMemo(() => [...selected].sort(byPosition), [selected]);
  const current =
    seats.find((s) => s.id === picked) ?? seats.find((s) => s.id === initialSeatId) ?? seats[0];
  const stats = useMemo(
    () => (current ? seatViewStats(current, map.hall) : null),
    [current, map.hall],
  );
  const selectedIds = useMemo(() => seats.map((s) => s.id), [seats]);
  const tone = safeTone(map.showtime.movie.tone);
  const screen = useMemo(() => pickScreenSource(map.showtime.movie), [map.showtime.movie]);

  // Every holds expired while looking: nothing left to look from.
  useEffect(() => {
    if (!current) onRequestClose();
  }, [current, onRequestClose]);

  // First real frame (or a failure): 2D map out, 3D picture in. Until then the map stays up.
  const settled = gl !== 'loading';
  const fadedIn = useRef(false);
  useEffect(() => {
    if (!settled || closing || fadedIn.current) return;
    fadedIn.current = true;
    fade.set(
      withTiming(1, { duration: FADE_MS }, (done) => {
        'worklet';
        if (done) scheduleOnRN(setShown, true);
      }),
    );
  }, [settled, closing, fade]);

  // No flight to wait for: the stats are there from the start.
  useEffect(() => {
    if (shown && !closing && (gl === 'failed' || reduceMotion)) {
      panel.set(withTiming(1, { duration: PANEL_MS }));
    }
  }, [shown, closing, gl, reduceMotion, panel]);

  // Faded in: dive to the seat; leaving: back up to the 2D map's pose. Reduce Motion never flies.
  const dive = shown && gl === 'ready' && !reduceMotion && !holdTop;
  const goal: RigGoal = reduceMotion || (dive && !closing) ? 'pov' : 'top';
  const away = useRef(false);
  useEffect(() => {
    if (!closing) away.current = dive;
  }, [closing, dive]);

  const onArrive = useCallback(
    (arrived: RigGoal) => {
      if (arrived === 'pov') panel.set(withTiming(1, { duration: PANEL_MS }));
    },
    [panel],
  );

  // Leaving: panel away, fly back up to the 2D map's pose, crossfade back, hand the screen back.
  const leaving = useRef(false);
  const guard = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finish = useCallback(() => {
    if (guard.current) clearTimeout(guard.current);
    guard.current = null;
    fade.set(
      withTiming(0, { duration: FADE_MS }, (done) => {
        'worklet';
        if (done) scheduleOnRN(onClosed);
      }),
    );
  }, [fade, onClosed]);
  useEffect(
    () => () => {
      if (guard.current) clearTimeout(guard.current);
    },
    [],
  );
  useEffect(() => {
    if (!closing || leaving.current) return;
    leaving.current = true;
    panel.set(withTiming(0, { duration: PANEL_MS / 2 }));
    if (!fadedIn.current) {
      // Never got to show: the 2D map is still all there is.
      fade.set(0);
      onClosed();
    } else if (gl === 'ready' && away.current) {
      // finish() runs when the camera lands; this only covers a flight that never reports.
      guard.current = setTimeout(finish, FLY_MS + 3000);
    } else {
      finish();
    }
  }, [closing, gl, panel, fade, onClosed, finish]);
  // The picture failed on the way back: nothing will fly, just leave.
  useEffect(() => {
    if (leaving.current && gl === 'failed') finish();
  }, [gl, finish]);
  const onArrived = useCallback(
    (arrived: RigGoal) => {
      onArrive(arrived);
      if (arrived === 'top' && leaving.current) finish();
    },
    [onArrive, finish],
  );

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.get() }));
  const panelStyle = useAnimatedStyle(() => ({
    opacity: panel.get(),
    transform: [{ translateY: (1 - panel.get()) * PANEL_TRAVEL }],
  }));

  const swipe = usePanGesture({
    runOnJS: true,
    activeOffsetY: [-1000, 14],
    failOffsetX: [-30, 30],
    onDeactivate: (e) => {
      if (e.translationY > DISMISS_PX || e.velocityY > DISMISS_VELOCITY) onRequestClose();
    },
  });

  if (!current || !stats) return null;

  const a11y = t('view.a11y', {
    row: current.rowLabel,
    distance: stats.distanceM.toFixed(1),
    off: Math.round(stats.offCenterDeg),
  });

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
                if (on) return;
                haptic.select();
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

  const onPanelLayout = (e: LayoutChangeEvent) => setPanelH(e.nativeEvent.layout.height);

  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, styles.root, fadeStyle]}>
        {gl === 'failed' ? (
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
        ) : (
          <GestureDetector gesture={swipe}>
            <View
              style={[styles.canvas, { left: rect.x, top: rect.y, width: rect.w, height: rect.h }]}
              accessible
              accessibilityRole="image"
              accessibilityLabel={a11y}
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
                    currentId={current.id}
                    reduceMotion={reduceMotion}
                    topPose={topPose}
                    goal={goal}
                    onArrive={onArrived}
                    onMount={machine.start}
                    onDrew={onDrew}
                    onFail={onFail}
                  />
                </Suspense>
              </GlBoundary>
            </View>
          </GestureDetector>
        )}
      </Animated.View>
      <Animated.View
        style={[styles.panel, { paddingBottom: Math.max(insets.bottom, space.lg) }, panelStyle]}
        pointerEvents={closing ? 'none' : 'auto'}
        onLayout={onPanelLayout}
      >
        {chips}
        <View style={styles.statsWrap}>
          <StatsCard seatLabel={seatLabel(current)} kind={current.kind} stats={stats} />
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.canvas },
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
