import { formatMnt, type SeatState } from '@open-cinema/shared';
import { Clock, Eye } from 'phosphor-react-native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import { formatCountdown, seatLabel, useCountdown } from '@/lib/seats';
import { useTween } from '@/lib/use-tween';
import { colors, hues, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { Pressable } from './pressable';

type Props = {
  selected: SeatState[];
  priceStandard: number;
  pricePremium: number;
  /** When the earliest hold runs out, null with no seats. */
  expiresAt: string | null;
  onExpire: () => void;
  onRelease: (seatId: string) => void;
  onViewFromSeat: () => void;
  onContinue: () => void;
};

const MIDDLE_HEIGHT = 36 + space.md + 48;

export function seatPrice(seat: SeatState, standard: number, premium: number): number {
  return seat.kind === 'premium' ? premium : standard;
}

/** Floating-sheet footer: chosen seats, running total, hold timer and the two actions. */
export function SeatFooter({
  selected,
  priceStandard,
  pricePremium,
  expiresAt,
  onExpire,
  onRelease,
  onViewFromSeat,
  onContinue,
}: Props) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const secondsLeft = useCountdown(expiresAt, onExpire);
  const total = selected.reduce((sum, s) => sum + seatPrice(s, priceStandard, pricePremium), 0);
  const shown = useTween(total);
  const empty = selected.length === 0;
  const premiumCount = selected.filter((s) => s.kind === 'premium').length;
  const standardCount = selected.length - premiumCount;
  const urgent = secondsLeft !== null && secondsLeft <= 60;

  return (
    <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
      <View style={styles.middle}>
        {empty ? (
          <View style={styles.emptyRow}>
            <Text style={styles.emptyTitle}>{t('seats.pick')}</Text>
            <Text style={styles.emptyHint}>{t('seats.pickHint')}</Text>
          </View>
        ) : (
          <>
            <View style={styles.chipsWrap}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chips}
              >
                {selected.map((s) => (
                  <Animated.View
                    key={s.id}
                    entering={FadeIn.duration(160)}
                    exiting={FadeOut.duration(120)}
                    layout={LinearTransition.duration(180)}
                  >
                    <Pressable
                      style={styles.chip}
                      onPress={() => onRelease(s.id)}
                      accessibilityRole="button"
                      accessibilityLabel={t('seats.release', { seat: seatLabel(s) })}
                    >
                      {s.kind === 'premium' ? <View style={styles.premiumDot} /> : null}
                      <Text style={styles.chipText}>{seatLabel(s)}</Text>
                      <Text style={styles.chipX}>×</Text>
                    </Pressable>
                  </Animated.View>
                ))}
              </ScrollView>
            </View>
            <View style={styles.totalRow}>
              <View style={styles.totalLeft}>
                <Text style={styles.count}>{t('seats.count', { n: selected.length })}</Text>
                <Text style={styles.breakdown} numberOfLines={1}>
                  {[
                    standardCount > 0 ? `${t('seats.standard')} ×${standardCount}` : null,
                    premiumCount > 0 ? `${t('seats.premium')} ×${premiumCount}` : null,
                  ]
                    .filter(Boolean)
                    .join('  ·  ')}
                </Text>
              </View>
              {secondsLeft !== null ? (
                <View style={[styles.timer, urgent && styles.timerUrgent]}>
                  <Clock size={14} weight="fill" color={urgent ? colors.danger : colors.body} />
                  <Text style={[styles.timerText, urgent && { color: colors.danger }]}>
                    {formatCountdown(secondsLeft)}
                  </Text>
                </View>
              ) : null}
              <Text style={styles.total}>{formatMnt(shown)}</Text>
            </View>
          </>
        )}
      </View>
      <View style={styles.actions}>
        <Pressable
          style={[styles.secondary, empty && styles.disabled]}
          disabled={empty}
          onPress={onViewFromSeat}
          accessibilityRole="button"
        >
          <Eye size={18} weight="fill" color={colors.ink} />
          <Text style={styles.secondaryText}>{t('seats.fromSeat')}</Text>
        </Pressable>
        <Pressable
          style={[styles.primary, empty && styles.disabled]}
          disabled={empty}
          onPress={onContinue}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>{t('seats.continue')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.raised,
    borderTopLeftRadius: radius.panel,
    borderTopRightRadius: radius.panel,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
    paddingTop: space.lg,
    gap: space.md,
  },
  // Same height with or without seats, so picking one never moves the map under the finger.
  middle: { height: MIDDLE_HEIGHT, gap: space.md },
  emptyRow: { flex: 1, paddingHorizontal: space.lg, gap: 2, justifyContent: 'center' },
  emptyTitle: { ...type.headline, color: colors.ink },
  emptyHint: { ...type.caption, color: colors.muted },
  chipsWrap: { height: 36 },
  chips: { paddingHorizontal: space.lg, gap: space.sm, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.fill,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  premiumDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: hues.indigo },
  chipText: { ...type.bodyMedium, color: colors.ink, fontVariant: ['tabular-nums'] },
  chipX: { ...type.bodyMedium, color: colors.muted },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  totalLeft: { flex: 1, gap: 1 },
  count: { ...type.bodyMedium, color: colors.ink },
  breakdown: { ...type.caption, color: colors.muted },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space.sm + 2,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.fill,
  },
  timerUrgent: { backgroundColor: colors.dangerFill },
  timerText: { ...type.footnote, color: colors.body, fontVariant: ['tabular-nums'] },
  total: { ...type.title, color: colors.ink, fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg },
  secondary: {
    flex: 1,
    height: 50,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    backgroundColor: colors.fill,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  secondaryText: { ...type.bodyMedium, color: colors.ink },
  primary: {
    flex: 1,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    backgroundColor: colors.action,
  },
  primaryText: { ...type.headline, color: colors.onAction },
  disabled: { opacity: 0.4 },
});
