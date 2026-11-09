import { type SeatMap, type SeatState, seatViewStats } from '@open-cinema/shared';
import { useHeaderHeight } from 'expo-router/react-navigation';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
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
import { mediaUrl } from '@/lib/http';
import { seatLabel } from '@/lib/seats';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { FLY_MS, pickScreenSource, safeTone, smoothstep, type TopDownPose } from './camera-math';
import type { RigGoal } from './camera-rig';
import { GlBoundary } from './gl-boundary';
import { createGlMachine } from './gl-machine';
import { Hall2D } from './Hall2D';
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
  /** The viewer asked to leave (back button). */
  closing: boolean;
  /** Ask to leave (swipe down, holds expired). */
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
    if (closing) send({ type: 'close' });
  }, [closing]);

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
      fallbackFade.set(withTiming(0, { duration: FADE_MS }));
      fade.set(
        withTiming(0, { duration: FADE_MS }, (done) => {
          'worklet';
          if (done) scheduleOnRN(send, { type: 'faded-out' });
        }),
      );
    } else if (tr.phase === 'closed') {
      onClosed();
    }
  }, [tr.phase, tr.fallback, fade, fallbackFade, onClosed]);
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

  const onArrive = useCallback((arrived: RigGoal) => {
    if (arrived === 'pov') {
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
  const live = panelLive(tr);
  // The picture is lifted so the screen sits centred between the status bar and the panel.
  const cover = Math.max(0, panelH - insets.top);

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

  const showCanvas = !(fallback && tr.fallbackShown);

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      {showCanvas ? (
        <GestureDetector gesture={swipe}>
          <Animated.View
            style={[
              styles.canvas,
              { left: rect.x, top: rect.y, width: rect.w, height: rect.h },
              canvasStyle,
            ]}
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
                  takenIds={takenIds}
                  currentId={current.id}
                  reduceMotion={still}
                  topPose={topPose}
                  goal={goalOf(tr)}
                  dive={dive}
                  cover={cover}
                  onArrive={onArrive}
                  onMount={machine.start}
                  onDrew={onDrew}
                  onFail={onFail}
                />
              </Suspense>
            </GlBoundary>
          </Animated.View>
        </GestureDetector>
      ) : null}
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
  );
}

const styles = StyleSheet.create({
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
