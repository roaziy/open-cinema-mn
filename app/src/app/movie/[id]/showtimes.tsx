import { formatMnt, formatUbTime, type ShowtimeSlot } from '@open-cinema/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Buildings } from 'phosphor-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconTile } from '@/components/icon-tile';
import { Poster } from '@/components/poster';
import { PosterBackdrop } from '@/components/poster-backdrop';
import { Pressable } from '@/components/pressable';
import { Skeleton } from '@/components/skeleton';
import { EmptyState, ErrorState } from '@/components/state-views';
import { type TKey, useI18n } from '@/i18n';
import { useBranchId } from '@/lib/branch';
import { useMovie, useShowtimes } from '@/lib/catalog';
import { formatDuration, nextUbDays, weekdayOf } from '@/lib/format';
import { colors, hairlineWidth, hueFor, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

const FEW_LEFT = 10;
const GAP = space.sm;

export default function ShowtimesScreen() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const days = useMemo(() => nextUbDays(7), []);
  const [date, setDate] = useState(days[0] as string);
  const [picked, setPicked] = useState<string | null>(null);
  const preferred = useBranchId();
  const movie = useMovie(id);
  const shows = useShowtimes(id, date);
  // Previous day's cards linger as placeholder data: never show or open them under a new chip.
  const loading = shows.isPending || shows.isPlaceholderData;
  // The transparent native header is laid over the backdrop; reserve its measured height.
  const headerHeight = useHeaderHeight();

  // The preferred branch leads; the rest keep the API order.
  const branches = useMemo(() => {
    const list = (shows.data ?? []).filter((b) => b.showtimes.length > 0);
    return [...list].sort(
      (a, b) => Number(b.branch.id === preferred) - Number(a.branch.id === preferred),
    );
  }, [shows.data, preferred]);

  // card padding 14 + screen gutter 16, three slots per row
  const slotWidth = Math.floor((width - space.lg * 2 - 14 * 2 - GAP * 2) / 3);

  const dayLabel = (d: string, i: number): string =>
    i === 0
      ? t('showtimes.today')
      : i === 1
        ? t('showtimes.tomorrow')
        : t(`weekday.${weekdayOf(d)}` as TKey);

  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{ paddingBottom: insets.bottom + space.xxxl }}
      showsVerticalScrollIndicator={false}
    >
      {movie.data ? (
        <View
          style={[
            styles.film,
            { paddingTop: headerHeight + space.lg, minHeight: headerHeight + 112 },
          ]}
        >
          <PosterBackdrop
            uri={movie.data.backdropUrl ?? movie.data.posterUrl}
            tone={movie.data.tone}
          />
          <Poster uri={movie.data.posterUrl} width={60} radius={10} />
          <View style={styles.filmText}>
            <Text style={styles.filmTitle} numberOfLines={2}>
              {movie.data.title}
            </Text>
            <Text style={styles.filmMeta}>
              {[movie.data.ageRating, formatDuration(movie.data.durationMin, t)].join('  ·  ')}
            </Text>
          </View>
        </View>
      ) : (
        <View
          style={[
            styles.film,
            { paddingTop: headerHeight + space.lg, minHeight: headerHeight + 112 },
          ]}
        />
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.days}
        style={styles.daysScroll}
      >
        {days.map((d, i) => {
          const on = d === date;
          return (
            <Pressable
              key={d}
              style={[styles.day, on && styles.dayOn]}
              onPress={() => setDate(d)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.dayName, on && styles.dayNameOn]}>{dayLabel(d, i)}</Text>
              <Text style={[styles.dayNum, on && styles.dayNumOn]}>{Number(d.slice(8))}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.list}>
        {loading ? (
          <>
            <Skeleton height={190} radius={radius.card} />
            <Skeleton height={190} radius={radius.card} />
          </>
        ) : shows.isError ? (
          <ErrorState error={shows.error} onRetry={() => shows.refetch()} />
        ) : branches.length === 0 ? (
          <EmptyState title={t('showtimes.empty')} hint={t('showtimes.emptyHint')} />
        ) : (
          branches.map(({ branch, showtimes }) => (
            <View key={branch.id} style={styles.card}>
              <View style={styles.cardHead}>
                <IconTile
                  sf="building.2.fill"
                  phosphor={Buildings}
                  hue={hueFor(branch.id)}
                  size={32}
                />
                <View style={styles.cardHeadText}>
                  <Text style={styles.branchName}>{branch.name}</Text>
                  <Text style={styles.branchAddr} numberOfLines={1}>
                    {branch.address}
                  </Text>
                </View>
              </View>
              <View style={styles.slots}>
                {showtimes.map((s) => (
                  <Slot
                    key={s.id}
                    slot={s}
                    width={slotWidth}
                    selected={picked === s.id}
                    onPress={() => {
                      setPicked(s.id);
                      router.push(`/showtime/${s.id}`);
                    }}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function Slot({
  slot,
  width,
  selected,
  onPress,
}: {
  slot: ShowtimeSlot;
  width: number;
  selected: boolean;
  onPress: () => void;
}) {
  const { t } = useI18n();
  const soldOut = slot.seatsLeft <= 0;
  const few = !soldOut && slot.seatsLeft <= FEW_LEFT;
  const time = formatUbTime(slot.startsAt);
  const note = soldOut
    ? t('showtimes.soldOut')
    : few
      ? t('showtimes.fewLeft', { n: slot.seatsLeft })
      : slot.hallName;
  return (
    <Pressable
      style={[
        styles.slot,
        { width },
        few && styles.slotFew,
        soldOut && styles.slotSold,
        selected && styles.slotOn,
      ]}
      onPress={onPress}
      disabled={soldOut}
      feedback={!soldOut}
      accessibilityRole="button"
      accessibilityState={{ disabled: soldOut, selected }}
      accessibilityLabel={`${time}, ${slot.format}, ${note}`}
    >
      <Text
        style={[
          styles.time,
          few && { color: colors.warning },
          soldOut && styles.struck,
          selected && { color: colors.onAction },
        ]}
      >
        {time}
      </Text>
      <Text
        style={[styles.slotSub, soldOut && styles.struck, selected && styles.slotSubOn]}
        numberOfLines={1}
      >
        {slot.format} · {formatMnt(slot.priceStandard)}
      </Text>
      <Text
        style={[styles.slotNote, few && { color: colors.warning }, selected && styles.slotSubOn]}
        numberOfLines={1}
      >
        {note}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  film: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    overflow: 'hidden',
  },
  filmText: { flex: 1, gap: 2 },
  filmTitle: { ...type.title, color: colors.ink },
  filmMeta: { ...type.caption, color: colors.body },
  daysScroll: { flexGrow: 0 },
  days: { paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.sm },
  day: {
    width: 70,
    height: 68,
    borderRadius: radius.card,
    backgroundColor: colors.raised,
    borderWidth: hairlineWidth,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dayOn: { backgroundColor: colors.action, borderColor: colors.action },
  dayName: { ...type.footnote, color: colors.muted },
  dayNameOn: { color: colors.onActionMuted },
  dayNum: { ...type.number, fontSize: 20, color: colors.ink },
  dayNumOn: { color: colors.onAction },
  list: { paddingHorizontal: space.lg, gap: space.lg, marginTop: space.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.panel,
    borderWidth: hairlineWidth,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
    padding: 14,
    gap: space.lg,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  cardHeadText: { flex: 1, gap: 2 },
  branchName: { ...type.headline, color: colors.ink },
  branchAddr: { ...type.caption, color: colors.muted },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  slot: {
    paddingVertical: space.md,
    paddingHorizontal: 10,
    borderRadius: radius.inner + 2,
    backgroundColor: colors.raised,
    borderWidth: hairlineWidth,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
    gap: 2,
  },
  slotFew: { borderColor: colors.warningTint },
  slotSold: { opacity: 0.55 },
  slotOn: { backgroundColor: colors.action, borderColor: colors.action },
  time: { ...type.number, fontSize: 19, color: colors.ink },
  struck: { textDecorationLine: 'line-through', color: colors.muted },
  slotSub: { ...type.footnote, color: colors.body },
  slotSubOn: { color: colors.onActionMuted },
  slotNote: { ...type.footnote, color: colors.muted },
});
