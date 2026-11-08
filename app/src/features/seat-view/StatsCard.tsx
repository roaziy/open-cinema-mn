import type { seatViewStats } from '@open-cinema/shared';
import { StyleSheet, Text, View } from 'react-native';
import { type TKey, useI18n } from '@/i18n';
import { colors, hues, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

type Stats = ReturnType<typeof seatViewStats>;

/** Identity hue per verdict: calm for balanced, never an action colour. */
const LABEL_HUE: Record<Stats['label'], string> = {
  balanced: hues.green,
  immersive: hues.sky,
  angled: hues.purple,
  very_close: hues.yellow,
};

export function StatsCard({ seatLabel, stats }: { seatLabel: string; stats: Stats }) {
  const { t } = useI18n();
  const hue = LABEL_HUE[stats.label];
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.seat}>{t('view.seat', { seat: seatLabel })}</Text>
          <Text style={styles.hint} numberOfLines={2}>
            {t(`view.hint.${stats.label}` as TKey)}
          </Text>
        </View>
        <View style={[styles.pill, { backgroundColor: `${hue}26` }]}>
          <View style={[styles.dot, { backgroundColor: hue }]} />
          <Text style={[styles.pillText, { color: hue }]}>
            {t(`view.label.${stats.label}` as TKey)}
          </Text>
        </View>
      </View>
      <View style={styles.metrics}>
        <Metric
          label={t('view.distance')}
          value={t('view.distanceValue', { n: stats.distanceM.toFixed(1) })}
        />
        <View style={styles.sep} />
        <Metric
          label={t('view.viewAngle')}
          value={t('view.degValue', { n: Math.round(stats.viewDeg) })}
        />
        <View style={styles.sep} />
        <Metric
          label={t('view.offCenter')}
          value={t('view.degValue', { n: Math.round(stats.offCenterDeg) })}
        />
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
    padding: space.md,
    gap: space.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headText: { flex: 1, gap: 2 },
  seat: { ...type.headline, color: colors.ink },
  hint: { ...type.caption, color: colors.muted },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 28,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { ...type.footnote },
  // Nested one step in: card radius 16 minus 6 padding = 10.
  metrics: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.raised,
    borderRadius: radius.inner,
    paddingVertical: space.md,
  },
  metric: { flex: 1, alignItems: 'center', gap: 2 },
  value: { ...type.number, color: colors.ink },
  label: { ...type.footnote, color: colors.muted },
  sep: { width: 1, alignSelf: 'stretch', backgroundColor: colors.hairline },
});
