import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Play } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedReaction,
  useAnimatedRef,
  useReducedMotion,
  useScrollOffset,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { AgeBadge } from '@/components/age-badge';
import { KeyArt } from '@/components/key-art';
import { Pressable } from '@/components/pressable';
import { ShowtimeDays } from '@/components/showtime-days';
import { ShowtimeGroups } from '@/components/showtime-groups';
import { Skeleton } from '@/components/skeleton';
import { ErrorState } from '@/components/state-views';
import { useI18n } from '@/i18n';
import { useBranchId } from '@/lib/branch';
import { useFromPrice, useMovie, useShowDays, useShowtimes } from '@/lib/catalog';
import { formatDuration, formatMonthDay, nextUbDays } from '@/lib/format';
import { groupByBranch } from '@/lib/showtime-groups';
import { formatMnt } from '@/shared';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

const PULL_UP = 64;
/** iOS 26+: the system draws its own blur under a transparent bar. */
const LIQUID_GLASS = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26;
const PILL = 40;

export default function MovieScreen() {
  const { t, locale } = useI18n();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const still = useReducedMotion();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useScrollOffset(scrollRef);
  const scheduleY = useRef(0);
  const { id } = useLocalSearchParams<{ id: string }>();
  const movie = useMovie(id);
  const days = useMemo(() => nextUbDays(7), []);
  // Open on the first day that has showings, until the viewer picks one.
  const [picked, setPicked] = useState<string | null>(null);
  const showDays = useShowDays(id, days, movie.isSuccess);
  const date = picked ?? showDays[0] ?? (days[0] as string);
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState(0);
  const artHeight = Math.min(Math.max(width * 1.2, 460), 640);
  // The native bar sits clear over the art; once the art has scrolled away it takes the title
  // (and, before iOS 26, the system blur material). Flips only when the threshold is crossed.
  const [scrolled, setScrolled] = useState(false);
  useAnimatedReaction(
    () => scrollY.get() > artHeight - insets.top - 120,
    (now, before) => {
      if (now !== before) scheduleOnRN(setScrolled, now);
    },
    [artHeight, insets.top],
  );
  const preferred = useBranchId();
  const shows = useShowtimes(id, date);
  // Previous day's cards linger as placeholder data: never show or open them under a new chip.
  const loading = shows.isPending || shows.isPlaceholderData;
  const groups = useMemo(() => groupByBranch(shows.data ?? [], preferred), [shows.data, preferred]);
  // "From" price: cheapest bookable slot across the loaded week (also covers presale for soon films).
  const fromPrice = useFromPrice(id, days, movie.isSuccess);

  const header = (
    <Stack.Screen
      options={{
        title: scrolled && movie.data ? movie.data.title : '',
        // iOS 26 blurs what scrolls under the bar by itself (scroll edge effect, set in the
        // layout); a blur material on top would double up, so it is only for older iOS.
        headerBlurEffect: !LIQUID_GLASS && scrolled ? 'systemChromeMaterialDark' : 'none',
      }}
    />
  );

  if (movie.isPending || movie.isError) {
    return (
      <View style={styles.root}>
        <View style={{ paddingTop: insets.top + 72, paddingHorizontal: space.lg, gap: space.md }}>
          {movie.isError ? (
            <ErrorState error={movie.error} onRetry={() => movie.refetch()} />
          ) : (
            <>
              <Skeleton height={320} radius={radius.panel} />
              <Skeleton width={240} height={34} />
              <Skeleton width={180} height={16} />
            </>
          )}
        </View>
        {header}
      </View>
    );
  }

  const m = movie.data;
  // Plain black page: the art carries the film's colour, the page does not.
  const page = colors.canvas;
  const soon = m.status === 'soon';
  const noTickets = soon && fromPrice === null;
  const trailerUrl = m.trailerUrl;
  const meta = [formatDuration(m.durationMin, t), m.genres.slice(0, 3).join(', ')]
    .filter(Boolean)
    .join('  ·  ');
  const longSynopsis = lines > 3;
  const opens = t('movie.opens', { date: formatMonthDay(m.releaseDate, locale) });

  return (
    <View style={[styles.root, { backgroundColor: page }]}>
      <Animated.ScrollView
        ref={scrollRef}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
      >
        <View style={{ height: artHeight }}>
          <KeyArt
            uri={m.backdropUrl ?? m.posterUrl}
            pageColor={page}
            height={artHeight}
            topInset={insets.top}
            scrollY={scrollY}
          />
          {trailerUrl ? (
            <Pressable
              style={styles.trailer}
              onPress={() => {
                Linking.openURL(trailerUrl).catch(() => {});
              }}
              accessibilityRole="link"
            >
              <Play size={16} color={colors.ink} fill={colors.ink} strokeWidth={2} />
              <Text style={styles.trailerText}>{t('movie.trailer')}</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={3}>
            {m.title}
          </Text>
          <View style={styles.metaRow}>
            <AgeBadge rating={m.ageRating} />
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          </View>
          {soon ? <Text style={styles.opens}>{opens}</Text> : null}

          {noTickets ? (
            <View style={styles.openChip}>
              <Text style={styles.openChipText}>{opens}</Text>
            </View>
          ) : (
            <Pressable
              style={styles.cta}
              // A JS-side press: Reanimated's scrollTo is UI-thread only and did nothing here.
              onPress={() =>
                scrollRef.current?.scrollTo({ y: scheduleY.current, animated: !still })
              }
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>{t('movie.buy')}</Text>
              {fromPrice !== null ? (
                <Text style={styles.ctaPrice}>
                  {t('movie.fromPrice', { price: formatMnt(fromPrice) })}
                </Text>
              ) : null}
            </Pressable>
          )}
        </View>

        <View style={styles.section}>
          <View>
            <Text style={styles.synopsis} numberOfLines={open ? undefined : 3}>
              {m.synopsis}
            </Text>
            {/* Unclamped copy, invisible: counts the lines so "read more" shows only when cut. */}
            <Text
              style={[styles.synopsis, styles.measure]}
              onTextLayout={(e) => setLines(e.nativeEvent.lines.length)}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {m.synopsis}
            </Text>
          </View>
          {longSynopsis ? (
            <Pressable
              style={styles.more}
              onPress={() => setOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
            >
              <Text style={styles.moreText}>
                {open ? t('movie.readLess') : t('movie.readMore')}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {noTickets ? null : (
          <View
            style={styles.schedule}
            onLayout={(e) => {
              // Land the heading just under the top bar (insets.top + 56).
              scheduleY.current = Math.max(0, e.nativeEvent.layout.y - insets.top - 56);
            }}
          >
            <Text style={styles.heading}>{t('movie.schedule')}</Text>
            <View style={styles.daysBleed}>
              <ShowtimeDays days={days} value={date} onChange={setPicked} open={showDays} />
            </View>
            <ShowtimeGroups
              groups={groups}
              durationMin={m.durationMin}
              loading={loading}
              error={shows.isError ? shows.error : null}
              onRetry={() => shows.refetch()}
              onPick={(slot) => router.push(`/showtime/${slot.id}`)}
            />
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.grid}>
            <Tile label={t('movie.duration')} value={formatDuration(m.durationMin, t)} />
            <Tile label={t('movie.release')} value={formatMonthDay(m.releaseDate, locale)} />
          </View>
          <View style={styles.grid}>
            <Tile label={t('movie.age')} value={m.ageRating} />
            <Tile label={t('movie.genre')} value={m.genres.join(', ') || '-'} />
          </View>
        </View>
      </Animated.ScrollView>

      {header}
    </View>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  trailer: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: PULL_UP + space.md,
    height: PILL,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.scrim,
    borderWidth: 1,
    borderColor: colors.scrimBorder,
  },
  trailerText: { ...type.bodyMedium, color: colors.ink },
  // Centred, like the home hero: the art above carries the page.
  titleBlock: {
    marginTop: -PULL_UP,
    paddingHorizontal: space.lg,
    gap: space.md,
    alignItems: 'center',
  },
  title: { ...type.largeTitle, color: colors.ink, textAlign: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  meta: { ...type.caption, color: colors.body, flexShrink: 1 },
  opens: { ...type.bodyMedium, color: colors.body, textAlign: 'center' },
  cta: {
    height: 54,
    marginTop: space.xs,
    alignSelf: 'stretch',
    paddingHorizontal: space.xl,
    borderRadius: radius.pill,
    backgroundColor: colors.action,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  ctaText: { ...type.headline, color: colors.onAction },
  ctaPrice: { ...type.number, fontSize: 15, color: colors.onActionMuted },
  openChip: {
    alignSelf: 'center',
    height: 40,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.chipFill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    justifyContent: 'center',
  },
  openChipText: { ...type.bodyMedium, color: colors.ink },
  section: { paddingHorizontal: space.lg, marginTop: space.xxl, gap: space.md },
  synopsis: { ...type.body, color: colors.body, lineHeight: 23 },
  measure: { position: 'absolute', left: 0, right: 0, opacity: 0 },
  more: { alignSelf: 'flex-start', minHeight: 32, justifyContent: 'center' },
  moreText: { ...type.bodyMedium, color: colors.ink },
  schedule: { marginTop: space.xxl, paddingHorizontal: space.lg, gap: space.lg },
  heading: { ...type.title, color: colors.ink },
  // The day chips scroll edge to edge: cancel the section gutter (they pad themselves).
  daysBleed: { marginHorizontal: -space.lg },
  grid: { flexDirection: 'row', gap: space.md },
  tile: {
    flex: 1,
    backgroundColor: colors.raised,
    borderRadius: radius.card,
    padding: space.lg,
    gap: 4,
  },
  tileLabel: { ...type.caption, color: colors.muted },
  tileValue: { ...type.bodyMedium, color: colors.ink },
});
