import type { Hold } from '@open-cinema/shared';
import { formatUbTime } from '@open-cinema/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight, usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type HostInstance, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
import { PosterBackdrop } from '@/components/poster-backdrop';
import {
  SeatCanvas,
  seatAreaWidth,
  seatContentMetrics,
  useSeatTransform,
} from '@/components/seat-canvas';
import type { SeatStatus } from '@/components/seat-cell';
import { SeatFooter } from '@/components/seat-footer';
import { SeatLegend } from '@/components/seat-legend';
import { Skeleton } from '@/components/skeleton';
import { ErrorState } from '@/components/state-views';
import {
  mapFitOf,
  seatPlaneHeight,
  type TopDownPose,
  topDownFromMap,
} from '@/features/seat-view/camera-math';
import { chromeOpacity, footerSlide } from '@/features/seat-view/chrome-fade';
import { type OverlayRect, SeatViewOverlay } from '@/features/seat-view/SeatViewOverlay';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { layoutSeats } from '@/lib/seat-layout';
import { liveHolds, seatLabel, useMyHolds, useSeatActions, useSeatMap } from '@/lib/seats';
import { useSeatStream } from '@/lib/sse';
import { showToast } from '@/lib/toast';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

export default function SeatMapScreen() {
  const { t } = useI18n();
  // `mode=2d` forces the 3D fallback and `hold=1` stays on the top-down start; both dev only.
  const { id, mode, hold } = useLocalSearchParams<{ id: string; mode?: string; hold?: string }>();
  const { width } = useWindowDimensions();
  const headerHeight = useHeaderHeight();
  const { user } = useAuth();
  const qc = useQueryClient();

  const map = useSeatMap(id);
  const holds = useMyHolds(id);
  const stream = useSeatStream(id);
  const toggle = useSeatActions(id, t, stream.patch);

  const seats = map.data?.seats;
  const layout = useMemo(() => layoutSeats(seats ?? [], seatAreaWidth(width)), [seats, width]);
  const bySeat = useMemo(() => new Map((seats ?? []).map((s) => [s.id, s])), [seats]);

  const mine = useMemo(() => liveHolds(holds.data), [holds.data]);
  const mineIds = useMemo(() => new Set(mine.map((h) => h.seatId)), [mine]);

  const statusOf = useCallback(
    (seatId: string): SeatStatus => {
      if (mineIds.has(seatId)) return 'mine';
      const state = stream.seats[seatId] ?? bySeat.get(seatId)?.state ?? 'free';
      return state === 'free' ? 'free' : 'taken';
    },
    [mineIds, stream.seats, bySeat],
  );

  const labelOf = useCallback(
    (seatId: string, status: SeatStatus) => {
      const seat = bySeat.get(seatId);
      if (!seat) return '';
      const state =
        status === 'mine'
          ? t('seats.mine')
          : status === 'taken'
            ? t('seats.taken')
            : t('seats.free');
      const kind =
        seat.kind === 'premium'
          ? `${t('seats.kind.premium')}, `
          : seat.kind === 'wheelchair'
            ? `${t('seats.kind.wheelchair')}, `
            : '';
      return t('seats.a11y', { row: seat.rowLabel, n: seat.number, state: `${kind}${state}` });
    },
    [bySeat, t],
  );

  const selected = useMemo(() => mine.flatMap((h) => bySeat.get(h.seatId) ?? []), [mine, bySeat]);
  const earliest = useMemo(() => mine.map((h) => h.expiresAt).sort()[0] ?? null, [mine]);

  // Holds run out one by one: release only the ones that lapsed, and say which.
  const { patch } = stream;
  const onExpire = useCallback(() => {
    const cache = qc.getQueriesData<Hold[]>({ queryKey: ['holds', id] });
    const lapsed = new Set<string>();
    for (const [key, list] of cache) {
      if (!list) continue;
      const keep = list.filter((h) => new Date(h.expiresAt).getTime() > Date.now());
      for (const h of list) if (!keep.includes(h)) lapsed.add(h.seatId);
      qc.setQueryData(key, keep);
    }
    if (lapsed.size === 0) return;
    patch([...lapsed].map((seatId) => ({ seatId, state: 'free' as const })));
    const names = [...lapsed].flatMap((sid) => {
      const seat = bySeat.get(sid);
      return seat ? [seatLabel(seat)] : [];
    });
    showToast(
      t(names.length > 1 ? 'seats.expiredMany' : 'seats.expired', { seats: names.join(', ') }),
      'error',
    );
    qc.invalidateQueries({ queryKey: ['holds', id] });
  }, [qc, id, t, patch, bySeat]);

  // In-place 3D view: the map fades out under it, the canvas starts from the map's own pose.
  const transform = useSeatTransform();
  const rootRef = useRef<HostInstance>(null);
  const viewportRef = useRef<HostInstance>(null);
  const fade = useSharedValue(0);
  const dive = useSharedValue(0);
  const still = useReducedMotion();
  // The header, legend and footer stay over the 3D picture through the first part of the dive and
  // fade around its middle (see chrome-fade.ts); with Reduce Motion they follow the crossfade.
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: chromeOpacity(dive.get(), fade.get(), still),
  }));
  const footerStyle = useAnimatedStyle(() => ({
    opacity: chromeOpacity(dive.get(), fade.get(), still),
    transform: [{ translateY: footerSlide(dive.get(), fade.get(), still) }],
  }));
  const [viewing, setViewing] = useState<{
    seatId: string;
    takenIds: string[];
    rect: OverlayRect;
    topPose: TopDownPose;
    closing: boolean;
  } | null>(null);
  const requestClose = useCallback(
    () => setViewing((v) => (v && !v.closing ? { ...v, closing: true } : v)),
    [],
  );
  const closed = useCallback(() => {
    dive.set(0);
    fade.set(0);
    setViewing(null);
  }, [dive, fade]);
  // The back button, swipe-back and the Android back key leave the 3D view first. Anything else
  // that removes the screen (a reset after logout, say) goes through untouched.
  const isViewing = viewing !== null;
  const [guard, setGuard] = useState(true);
  const repeat = useRef<(() => void) | null>(null);
  usePreventRemove(isViewing && guard, ({ data, repeat: again }) => {
    if (data.action.type === 'GO_BACK' || data.action.type === 'POP') requestClose();
    else {
      repeat.current = again;
      setGuard(false);
    }
  });
  useEffect(() => {
    if (guard) return;
    repeat.current?.();
    repeat.current = null;
  }, [guard]);

  const openView = () => {
    const last = selected[selected.length - 1];
    const root = rootRef.current;
    const viewport = viewportRef.current;
    if (!last || !root || !viewport) return;
    haptic.tap();
    root.measureInWindow((rx, ry, rw, rh) => {
      viewport.measureInWindow((vx, vy, vw, vh) => {
        const content = seatContentMetrics(layout);
        // The 3D canvas is the whole window; the 2D map's viewport sits at (offsetX, offsetY)
        // inside it, so the first top-down frame lines up with the seats on screen.
        const topPose = topDownFromMap({
          fit: mapFitOf(layout.slots, layout.size, layout.ppm, content.origin),
          view: {
            scale: transform.scale.get(),
            tx: transform.tx.get(),
            ty: transform.ty.get(),
            viewW: vw,
            viewH: vh,
            contentW: content.width,
            contentH: content.height,
          },
          canvasW: rw,
          canvasH: rh,
          offsetX: vx - rx,
          offsetY: vy - ry,
          planeY: seatPlaneHeight(map.data?.seats ?? []),
        });
        fade.set(0);
        dive.set(0);
        setViewing({
          seatId: last.id,
          takenIds: layout.slots
            .filter(({ seat }) => seat.kind !== 'blocked' && statusOf(seat.id) === 'taken')
            .map(({ seat }) => seat.id),
          rect: { x: 0, y: 0, w: rw, h: rh },
          topPose,
          closing: false,
        });
      });
    });
  };

  const show = map.data?.showtime;
  const tone = show?.movie.tone ?? colors.canvas;

  const onContinue = () => {
    if (!user || user.role === 'guest') router.push(`/showtime/${id}/gate`);
    else router.push(`/checkout/${id}`);
  };

  return (
    <View ref={rootRef} style={styles.root} collapsable={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '',
          headerTransparent: true,
          headerBackButtonDisplayMode: 'minimal',
          headerTintColor: colors.ink,
          // No slide closes the 3D view: the iOS edge swipe cannot even start while it is open.
          gestureEnabled: !isViewing,
          fullScreenGestureEnabled: false,
        }}
      />
      <Animated.View
        style={[chromeStyle, styles.chrome]}
        pointerEvents={isViewing ? 'none' : 'auto'}
        accessibilityElementsHidden={isViewing}
        importantForAccessibility={isViewing ? 'no-hide-descendants' : 'auto'}
      >
        {show ? (
          <View style={[styles.head, { paddingTop: headerHeight + space.xs }]}>
            <PosterBackdrop
              uri={show.movie.backdropUrl ?? show.movie.posterUrl}
              tone={tone}
              fadeHeight={90}
            />
            <View style={styles.headRow}>
              <View style={styles.headText}>
                <Text style={styles.title} numberOfLines={1}>
                  {show.movie.title}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {[
                    show.branch.name,
                    show.hallName,
                    `${formatUbTime(show.startsAt)}`,
                    show.format,
                  ].join('  ·  ')}
                </Text>
              </View>
              <LiveBadge status={stream.status} />
            </View>
          </View>
        ) : (
          <View style={{ height: headerHeight + 56 }} />
        )}

        <View style={styles.legend}>
          <SeatLegend />
        </View>
      </Animated.View>

      <View
        style={styles.grid}
        accessibilityElementsHidden={isViewing}
        importantForAccessibility={isViewing ? 'no-hide-descendants' : 'auto'}
      >
        {map.isError && !map.data ? (
          <View style={styles.center}>
            <ErrorState error={map.error} onRetry={() => map.refetch()} />
          </View>
        ) : !map.data ? (
          <View style={styles.skeleton}>
            <Skeleton height={64} radius={radius.card} />
            <Skeleton height={220} radius={radius.card} />
          </View>
        ) : (
          <SeatCanvas
            layout={layout}
            transform={transform}
            viewportRef={viewportRef}
            tone={tone}
            onSeat={toggle}
            statusOf={statusOf}
            labelOf={labelOf}
          />
        )}
      </View>

      <Animated.View
        style={[footerStyle, styles.chrome]}
        pointerEvents={isViewing ? 'none' : 'auto'}
        accessibilityElementsHidden={isViewing}
        importantForAccessibility={isViewing ? 'no-hide-descendants' : 'auto'}
      >
        {show ? (
          <SeatFooter
            selected={selected}
            priceStandard={show.priceStandard}
            pricePremium={show.pricePremium}
            expiresAt={earliest}
            onExpire={onExpire}
            onRelease={toggle}
            onViewFromSeat={openView}
            onContinue={onContinue}
          />
        ) : null}
      </Animated.View>
      {viewing && map.data ? (
        <SeatViewOverlay
          map={map.data}
          selected={selected}
          initialSeatId={viewing.seatId}
          takenIds={viewing.takenIds}
          rect={viewing.rect}
          topPose={viewing.topPose}
          dive={dive}
          fade={fade}
          closing={viewing.closing}
          onRequestClose={requestClose}
          onClosed={closed}
          forceFallback={__DEV__ && mode === '2d'}
          holdTop={__DEV__ && hold === '1'}
        />
      ) : null}
    </View>
  );
}

function LiveBadge({ status }: { status: ReturnType<typeof useSeatStream>['status'] }) {
  const { t } = useI18n();
  if (status === 'error') return null;
  const live = status === 'live';
  return (
    <View style={styles.badge} accessibilityLiveRegion="polite">
      <View style={[styles.badgeDot, { backgroundColor: live ? colors.action : colors.muted }]} />
      <Text style={styles.badgeText}>{live ? t('seats.live') : t('seats.reconnecting')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  /** Above the 3D picture (zIndex 2 in the overlay) while the dive begins. */
  chrome: { zIndex: 3 },
  grid: { flex: 1, zIndex: 0 },
  head: { paddingHorizontal: space.lg, paddingBottom: space.md, overflow: 'hidden' },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headText: { flex: 1, gap: 2 },
  title: { ...type.headline, color: colors.ink },
  meta: { ...type.caption, color: colors.body },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 26,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.scrim,
    borderWidth: 1,
    borderColor: colors.scrimBorder,
  },
  badgeDot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { ...type.footnote, color: colors.ink },
  legend: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  center: { flex: 1, justifyContent: 'center' },
  skeleton: { flex: 1, padding: space.lg, gap: space.lg },
});
