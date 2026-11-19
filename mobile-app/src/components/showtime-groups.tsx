import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useI18n } from '@/i18n';
import { type BranchShowtimes, formatMnt, formatUbTime, type ShowtimeSlot } from '@/shared';
import { colors, hairlineWidth, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { Pressable } from './pressable';
import { Skeleton } from './skeleton';
import { EmptyState, ErrorState } from './state-views';

const FEW_LEFT = 10;

type Props = {
  /** Branches that have shows, already ordered (see `groupByBranch`). */
  groups: BranchShowtimes[];
  /** The film's running time: each slot shows when it ends. */
  durationMin?: number;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onPick: (slot: ShowtimeSlot) => void;
};

/**
 * Showings of one day: a branch filter when there is more than one branch, then per branch a
 * plain header and a two-column grid of slots. Also owns the loading, error and empty states.
 */
export function ShowtimeGroups({ groups, durationMin, loading, error, onRetry, onPick }: Props) {
  const { t } = useI18n();
  const [only, setOnly] = useState<string | null>(null);
  if (loading) {
    return (
      <View style={styles.list}>
        <Skeleton width={180} height={20} />
        <Skeleton height={92} radius={radius.inner + 2} />
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
      {shown.map(({ branch, showtimes }, i) => (
        <View key={branch.id} style={[styles.group, i > 0 && styles.groupRule]}>
          <View style={styles.head}>
            <Text style={styles.branchName}>{branch.name}</Text>
            <Text style={styles.branchAddr} numberOfLines={1}>
              {branch.address}
            </Text>
          </View>
          {pairs(showtimes).map(([a, b]) => (
            <View key={a.id} style={styles.row}>
              <Slot slot={a} durationMin={durationMin} onPress={() => onPick(a)} />
              {b ? (
                <Slot slot={b} durationMin={durationMin} onPress={() => onPick(b)} />
              ) : (
                <View style={styles.cell} />
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function pairs<T>(list: T[]): [T, T | undefined][] {
  const out: [T, T | undefined][] = [];
  for (let i = 0; i < list.length; i += 2) out.push([list[i] as T, list[i + 1]]);
  return out;
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

function Slot({
  slot,
  durationMin,
  onPress,
}: {
  slot: ShowtimeSlot;
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
  // Name the format only when the hall's own name does not already say it ("3D танхим", "IMAX").
  const hall =
    slot.format !== '2D' && !slot.hallName.toUpperCase().includes(slot.format)
      ? `${slot.hallName} · ${slot.format}`
      : slot.hallName;
  const price = formatMnt(slot.priceStandard);
  return (
    <Pressable
      style={[styles.cell, styles.slot, soldOut && styles.slotSold]}
      onPress={onPress}
      disabled={soldOut}
      feedback={!soldOut}
      accessibilityRole="button"
      accessibilityState={{ disabled: soldOut }}
      accessibilityLabel={[
        start,
        end && `– ${end}`,
        hall,
        soldOut ? t('showtimes.soldOut') : price,
        few && t('showtimes.fewLeft', { n: slot.seatsLeft }),
      ]
        .filter(Boolean)
        .join(', ')}
    >
      <Text style={styles.hall} numberOfLines={1}>
        {hall}
      </Text>
      <View style={styles.times}>
        <Text style={[styles.start, soldOut && styles.struck]}>{start}</Text>
        {end ? <Text style={styles.end}>– {end}</Text> : null}
      </View>
      <Text style={styles.price} numberOfLines={1}>
        {soldOut ? (
          t('showtimes.soldOut')
        ) : (
          <>
            {price}
            {few ? (
              <Text style={styles.few}>
                {'  ·  '}
                {t('showtimes.fewLeft', { n: slot.seatsLeft })}
              </Text>
            ) : null}
          </>
        )}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.xl },
  // The filter runs to the screen edges and scrolls under them; its chips start on the content line.
  filterBleed: { marginHorizontal: -space.lg, flexGrow: 0 },
  filter: { paddingHorizontal: space.lg, gap: space.sm },
  chip: {
    height: 36,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: hairlineWidth,
    borderColor: colors.hairline,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { ...type.bodyMedium, fontSize: 14, color: colors.body },
  chipTextOn: { color: colors.canvas },
  group: { gap: space.sm },
  groupRule: {
    paddingTop: space.xl,
    borderTopWidth: hairlineWidth,
    borderTopColor: colors.hairline,
  },
  head: { gap: 2, marginBottom: space.xs },
  branchName: { ...type.headline, color: colors.ink },
  branchAddr: { ...type.caption, color: colors.muted },
  row: { flexDirection: 'row', gap: space.sm },
  cell: { flex: 1 },
  slot: {
    gap: 2,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.inner + 2,
    backgroundColor: colors.surface,
    borderWidth: hairlineWidth,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
  },
  slotSold: { opacity: 0.45 },
  hall: { ...type.footnote, color: colors.muted },
  times: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  start: { ...type.number, fontSize: 22, lineHeight: 28, color: colors.ink },
  end: { ...type.caption, color: colors.muted, fontVariant: ['tabular-nums'] },
  struck: { textDecorationLine: 'line-through', color: colors.muted },
  price: { ...type.caption, color: colors.body, fontVariant: ['tabular-nums'] },
  few: { color: colors.warning },
});
