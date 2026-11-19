import { ScrollView, StyleSheet, Text } from 'react-native';
import { type TKey, useI18n } from '@/i18n';
import { weekdayOf } from '@/lib/format';
import { colors, hairlineWidth, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { Pressable } from './pressable';

/** Horizontal day chips (YYYY-MM-DD values); the first is "today". */
export function ShowtimeDays({
  days,
  value,
  onChange,
}: {
  days: string[];
  value: string;
  onChange: (date: string) => void;
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
        return (
          <Pressable
            key={d}
            style={[styles.day, on && styles.dayOn]}
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
  name: { ...type.footnote, color: colors.muted },
  nameOn: { color: colors.onActionMuted },
  num: { ...type.number, fontSize: 20, color: colors.ink },
  numOn: { color: colors.onAction },
});
