import { type SeatState, seatViewStats } from '@open-cinema/shared';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from '@/components/pressable';
import { Skeleton } from '@/components/skeleton';
import { ErrorState } from '@/components/state-views';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { liveHolds, seatLabel, useMyHolds, useSeatMap } from '@/lib/seats';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { pickScreenSource, safeTone } from './camera-math';
import { GlBoundary } from './gl-boundary';
import { createGlMachine } from './gl-machine';
import { Hall2D } from './Hall2D';
import { StatsCard } from './StatsCard';

// Loaded on demand: if three or expo-gl cannot even be imported, the boundary routes to 2D.
const Hall3D = lazy(() => import('./Hall3D'));

/** If no frame has been drawn this long after the canvas mounts, GL is treated as unavailable. */
const WATCHDOG_MS = 3000;

function byPosition(a: SeatState, b: SeatState) {
  return a.y_m - b.y_m || a.x_m - b.x_m;
}

export function SeatViewScreen() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  // `mode=2d` forces the fallback and `hold=1` stays on the top-down start; both dev only.
  const {
    id,
    seat: seatParam,
    mode,
    hold,
  } = useLocalSearchParams<{
    id: string;
    seat?: string;
    mode?: string;
    hold?: string;
  }>();
  const map = useSeatMap(id);
  const holds = useMyHolds(id);
  const [picked, setPicked] = useState<string | null>(null);
  // Render-loop state machine: ready only after a real draw; any failure or no draw in 3 s -> 2D.
  const [machine] = useState(() =>
    createGlMachine({
      timeoutMs: WATCHDOG_MS,
      initial: __DEV__ && mode === '2d' ? 'failed' : 'loading',
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

  const data = map.data;
  const selected = useMemo(() => {
    if (!data) return [];
    const ids = new Set(liveHolds(holds.data).map((h) => h.seatId));
    if (seatParam) ids.add(seatParam);
    return data.seats.filter((s) => ids.has(s.id) && s.kind !== 'blocked').sort(byPosition);
  }, [data, holds.data, seatParam]);

  const current =
    selected.find((s) => s.id === picked) ??
    selected.find((s) => s.id === seatParam) ??
    selected[0];
  const stats = useMemo(
    () => (data && current ? seatViewStats(current, data.hall) : null),
    [data, current],
  );
  const selectedIds = useMemo(() => selected.map((s) => s.id), [selected]);
  const tone = data ? safeTone(data.showtime.movie.tone) : colors.muted;
  const screen = useMemo(
    () =>
      data
        ? pickScreenSource(data.showtime.movie)
        : ({ kind: 'flat', color: colors.muted } as const),
    [data],
  );

  const header = (
    <Stack.Screen
      options={{
        headerShown: true,
        title: '',
        headerTransparent: true,
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: colors.ink,
      }}
    />
  );

  if (map.isError && !data) {
    return (
      <View style={styles.center}>
        {header}
        <ErrorState error={map.error} onRetry={() => map.refetch()} />
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.center}>
        {header}
        <Skeleton width={120} height={14} />
      </View>
    );
  }
  if (!current || !stats) {
    return (
      <View style={styles.center}>
        {header}
        <Text style={styles.empty}>{t('view.noSeat')}</Text>
      </View>
    );
  }

  const a11y = t('view.a11y', {
    row: current.rowLabel,
    distance: stats.distanceM.toFixed(1),
    off: Math.round(stats.offCenterDeg),
  });

  const panel = (
    <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
      {selected.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          accessibilityLabel={t('view.switcher')}
        >
          {selected.map((s) => {
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
      ) : null}
      <View style={styles.statsWrap}>
        <StatsCard seatLabel={seatLabel(current)} stats={stats} />
      </View>
    </View>
  );

  if (gl === 'failed') {
    return (
      <View style={styles.root}>
        {header}
        <ScrollView
          contentContainerStyle={{
            paddingTop: headerHeight + space.sm,
            paddingBottom: space.lg,
            gap: space.md,
          }}
        >
          <Hall2D
            seats={data.seats}
            hall={data.hall}
            tone={tone}
            selectedIds={selectedIds}
            currentId={current.id}
            width={width}
            a11y={a11y}
          />
        </ScrollView>
        {panel}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {header}
      <View style={styles.canvas} accessible accessibilityRole="image" accessibilityLabel={a11y}>
        <GlBoundary
          onError={(e) =>
            machine.dispatch({ type: 'error', reason: `render/import error: ${String(e)}` })
          }
        >
          <Suspense fallback={null}>
            <Hall3D
              seats={data.seats}
              hall={data.hall}
              tone={tone}
              screen={screen}
              selectedIds={selectedIds}
              currentId={current.id}
              reduceMotion={reduceMotion}
              hold={__DEV__ && hold === '1'}
              onMount={machine.start}
              onDrew={onDrew}
              onFail={onFail}
            />
          </Suspense>
        </GlBoundary>
        {gl === 'loading' ? (
          <View style={styles.loading} pointerEvents="none">
            <ActivityIndicator color={colors.muted} />
            <Text style={styles.loadingText}>{t('view.loading')}</Text>
          </View>
        ) : null}
      </View>
      {panel}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  center: {
    flex: 1,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { ...type.body, color: colors.muted },
  canvas: { flex: 1, backgroundColor: colors.canvas },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  loadingText: { ...type.caption, color: colors.muted },
  panel: {
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
