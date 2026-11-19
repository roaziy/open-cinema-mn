import { ScrollView, StyleSheet, Text } from 'react-native';
import { type TKey, useI18n } from '@/i18n';
import { weekdayOf } from '@/lib/format';
import { colors, radius, space } from '@/theme/tokens';
import { fonts, type } from '@/theme/type';
import { Pressable } from './pressable';

/** Horizontal day chips (YYYY-MM-DD values); the first is "today". */
export function ShowtimeDays({
  days,
  value,
  onChange,
  open,
}: {
  days: string[];
  value: string;
  onChange: (date: string) => void;
  /** Days known to have showings: the rest are dimmed (still tappable) once any are known. */
  open?: string[];
}) {
  const { t } = useI18n();
  const label = (d: string, i: number): string =>
    i === 0
      ? t('showtimes.today')
      : i === 1
        ? t('showtimes.tomorrow')
        : t(`weekday.${weekdayOf(d)}` as TKey);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.days}
      style={styles.scroll}
    >
      {days.map((d, i) => {
        const on = d === value;
        const quiet = !on && !!open?.length && !open.includes(d);
        return (
          <Pressable
            key={d}
            style={[styles.day, on && styles.dayOn, quiet && styles.dayQuiet]}
            onPress={() => onChange(d)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.name, on && styles.nameOn]}>{label(d, i)}</Text>
            <Text style={[styles.num, on && styles.numOn]}>{Number(d.slice(8))}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  days: { paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.sm },
  // Shop.mn field: borderless surface, continuous 18pt corner; selected is a solid blue fill.
  day: {
    width: 64,
    height: 64,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dayOn: { backgroundColor: colors.action },
  dayQuiet: { opacity: 0.4 },
  name: { ...type.caption, fontSize: 12, lineHeight: 16, color: colors.muted },
  nameOn: { color: colors.onActionMuted },
  num: {
    fontFamily: fonts.medium,
    fontSize: 20,
    lineHeight: 24,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  numOn: { color: colors.onAction },
});
