import { ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable as RNPressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '@/i18n';
import { formatMarks } from '@/lib/format-marks';
import { haptic } from '@/lib/haptics';
import { type BranchShowtimes, formatMnt, formatUbTime, type ShowtimeSlot } from '@/shared';
import { colors, radius, space } from '@/theme/tokens';
import { fonts, type } from '@/theme/type';
import { FormatMark } from './format-mark';
import { Pressable } from './pressable';
import { Skeleton } from './skeleton';
import { EmptyState, ErrorState } from './state-views';

const FEW_LEFT = 10;

type Props = {
  /** Branches that have shows, already ordered (see `groupByBranch`). */
  groups: BranchShowtimes[];
  /** The film's running time: each showing shows when it ends. */
  durationMin?: number;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onPick: (slot: ShowtimeSlot) => void;
};

/**
 * Showings of one day. A branch filter when more than one branch has them, then per branch its
 * name over one card of rows: start and end on the left, format marks and seats in the middle,
 * price on the right. Also owns the loading, error and empty states.
 */
export function ShowtimeGroups({ groups, durationMin, loading, error, onRetry, onPick }: Props) {
  const { t } = useI18n();
  const [only, setOnly] = useState<string | null>(null);
  if (loading) {
    return (
      <View style={styles.list}>
        <Skeleton width={180} height={20} />
        <Skeleton height={204} radius={radius.panel} />
      </View>
    );
  }
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (groups.length === 0) {
    return <EmptyState title={t('showtimes.empty')} hint={t('showtimes.emptyHint')} />;
  }
  // A branch picked on another day may have nothing today: fall back to all of them.
  const picked = only && groups.some((g) => g.branch.id === only) ? only : null;
  const shown = picked ? groups.filter((g) => g.branch.id === picked) : groups;
  return (
    <View style={styles.list}>
      {groups.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterBleed}
          contentContainerStyle={styles.filter}
        >
          <Chip label={t('branch.all')} on={!picked} onPress={() => setOnly(null)} />
          {groups.map(({ branch }) => (
            <Chip
              key={branch.id}
              label={branch.name}
              on={picked === branch.id}
              onPress={() => setOnly(branch.id)}
            />
          ))}
        </ScrollView>
      ) : null}
      {shown.map(({ branch, showtimes }) => (
        <View key={branch.id} style={styles.group}>
          <View style={styles.head}>
            <Text style={styles.branchName}>{branch.name}</Text>
            <Text style={styles.branchAddr} numberOfLines={1}>
              {branch.address}
            </Text>
          </View>
          <View style={styles.card}>
            {showtimes.map((s, i) => (
              <Row
                key={s.id}
                slot={s}
                first={i === 0}
                durationMin={durationMin}
                onPress={() => onPick(s)}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function Row({
  slot,
  first,
  durationMin,
  onPress,
}: {
  slot: ShowtimeSlot;
  first: boolean;
  durationMin?: number;
  onPress: () => void;
}) {
  const { t } = useI18n();
  const soldOut = slot.seatsLeft <= 0;
  const few = !soldOut && slot.seatsLeft <= FEW_LEFT;
  const start = formatUbTime(slot.startsAt);
  const end = durationMin
    ? formatUbTime(new Date(Date.parse(slot.startsAt) + durationMin * 60_000))
    : null;
  const { marks, hall } = formatMarks(slot.format, slot.hallName);
  const seats = soldOut
    ? t('showtimes.soldOut')
    : few
      ? t('showtimes.fewLeft', { n: slot.seatsLeft })
      : t('showtimes.seatsFree', { n: slot.seatsLeft });
  const price = formatMnt(slot.priceStandard);
  return (
    <RNPressable
      style={({ pressed }) => [styles.row, pressed && !soldOut && styles.rowPressed]}
      onPress={() => {
        haptic.select();
        onPress();
      }}
      disabled={soldOut}
      accessibilityRole="button"
      accessibilityState={{ disabled: soldOut }}
      accessibilityLabel={[start, end && `– ${end}`, slot.hallName, seats, !soldOut && price]
        .filter(Boolean)
        .join(', ')}
    >
      {/* Rows are split by a hairline that starts where their text does, as in iOS lists. */}
      {first ? null : <View style={styles.rule} />}
      <View style={[styles.when, soldOut && styles.dim]}>
        <Text style={styles.start}>{start}</Text>
        {end ? <Text style={styles.end}>{end}</Text> : null}
      </View>
      <View style={[styles.what, soldOut && styles.dim]}>
        <View style={styles.marks}>
          {marks.map((m) => (
            <FormatMark key={m} mark={m} />
          ))}
          {hall ? (
            <Text style={styles.hall} numberOfLines={1}>
              {hall}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.seats, few && styles.few]} numberOfLines={1}>
          {seats}
        </Text>
      </View>
      {soldOut ? null : (
        <View style={styles.price}>
          <Text style={styles.priceText}>{price}</Text>
          <ChevronRight size={16} color={colors.muted} strokeWidth={2} />
        </View>
      )}
    </RNPressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.xxl },
  // The filter runs to the screen edges and scrolls under them; its chips start on the content line.
  filterBleed: { marginHorizontal: -space.lg, flexGrow: 0 },
  filter: { paddingHorizontal: space.lg, gap: space.sm },
  chip: {
    height: 36,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.fill,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.action },
  chipText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, color: colors.body },
  chipTextOn: { color: colors.onAction },
  group: { gap: space.md },
  head: { gap: 2 },
  branchName: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 22, color: colors.ink },
  branchAddr: { ...type.caption, color: colors.muted },
  // Shop.mn card: one borderless surface, continuous corners, rows split by inset hairlines.
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.panel,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 68,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  rowPressed: { backgroundColor: colors.fill },
  rule: {
    position: 'absolute',
    top: 0,
    left: space.lg,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
  },
  dim: { opacity: 0.4 },
  when: { width: 52 },
  start: {
    fontFamily: fonts.medium,
    fontSize: 17,
    lineHeight: 22,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  end: { ...type.caption, color: colors.muted, fontVariant: ['tabular-nums'] },
  what: { flex: 1, gap: 6 },
  marks: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hall: { ...type.caption, color: colors.body, flexShrink: 1 },
  seats: { ...type.caption, color: colors.muted },
  few: { color: colors.warning },
  price: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  priceText: {
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 20,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
});
