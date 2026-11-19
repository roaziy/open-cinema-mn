import { Building2 } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
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
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onPick: (slot: ShowtimeSlot) => void;
};

/** One card per branch with wrapping time chips; also owns the loading, error and empty states. */
export function ShowtimeGroups({ groups, loading, error, onRetry, onPick }: Props) {
  const { t } = useI18n();
  if (loading) {
    return (
      <View style={styles.list}>
        <Skeleton height={120} radius={radius.card} />
        <Skeleton height={120} radius={radius.card} />
      </View>
    );
  }
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (groups.length === 0) {
    return <EmptyState title={t('showtimes.empty')} hint={t('showtimes.emptyHint')} />;
  }
  return (
    <View style={styles.list}>
      {groups.map(({ branch, showtimes }) => (
        <View key={branch.id} style={styles.card}>
          <View style={styles.head}>
            <Building2 size={20} color={colors.muted} strokeWidth={1.75} />
            <View style={styles.headText}>
              <Text style={styles.branchName}>{branch.name}</Text>
              <Text style={styles.branchAddr} numberOfLines={1}>
                {branch.address}
              </Text>
            </View>
          </View>
          <View style={styles.slots}>
            {showtimes.map((s) => (
              <Slot key={s.id} slot={s} onPress={() => onPick(s)} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function Slot({ slot, onPress }: { slot: ShowtimeSlot; onPress: () => void }) {
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
      style={[styles.slot, few && styles.slotFew, soldOut && styles.slotSold]}
      onPress={onPress}
      disabled={soldOut}
      feedback={!soldOut}
      accessibilityRole="button"
      accessibilityState={{ disabled: soldOut }}
      accessibilityLabel={`${time}, ${slot.format}, ${note}, ${formatMnt(slot.priceStandard)}`}
    >
      <View style={styles.slotTop}>
        <Text style={[styles.time, few && { color: colors.warning }, soldOut && styles.struck]}>
          {time}
        </Text>
        {slot.format !== '2D' ? (
          <View style={styles.tag}>
            <Text style={styles.tagText}>{slot.format}</Text>
          </View>
        ) : null}
      </View>
      {/* Hall (or seats left / sold out) and price: what the viewer weighs before tapping. */}
      <Text style={[styles.note, few && { color: colors.warning }]} numberOfLines={1}>
        {soldOut ? note : `${note} · ${formatMnt(slot.priceStandard)}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.panel,
    borderWidth: hairlineWidth,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
    padding: 14,
    gap: space.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headText: { flex: 1, gap: 2 },
  branchName: { ...type.headline, color: colors.ink },
  branchAddr: { ...type.caption, color: colors.muted },
  slots: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  slot: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 2,
    minHeight: 52,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.inner + 2,
    backgroundColor: colors.raised,
    borderWidth: hairlineWidth,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
  },
  slotFew: { borderColor: colors.warningTint },
  slotSold: { opacity: 0.55 },
  slotTop: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  time: { ...type.number, color: colors.ink },
  note: { ...type.footnote, color: colors.muted },
  struck: { textDecorationLine: 'line-through', color: colors.muted },
  tag: {
    paddingHorizontal: 5,
    height: 18,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chipFill,
  },
  tagText: { ...type.footnote, fontSize: 10, lineHeight: 12, color: colors.body },
});
