import { Coins } from 'lucide-react-native';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Skeleton } from '@/components/skeleton';
import { EmptyState, ErrorState } from '@/components/state-views';
import { useI18n } from '@/i18n';
import { formatMonthDay } from '@/lib/format';
import { useMyPoints } from '@/lib/loyalty';
import { formatMemberNo, formatPoints, signedPoints } from '@/lib/member';
import { ubDate } from '@/shared';
import { colors, hairlineWidth, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

export default function PointsScreen() {
  const { t, locale } = useI18n();
  const { data, isPending, isError, error, refetch } = useMyPoints();
  const [pulling, setPulling] = useState(false);

  const onRefresh = async () => {
    setPulling(true);
    try {
      await refetch();
    } finally {
      setPulling(false);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={colors.muted} />
      }
    >
      {isPending ? (
        <>
          <Skeleton height={96} radius={radius.card} />
          <Skeleton height={54} radius={radius.card} />
          <Skeleton height={54} radius={radius.card} />
        </>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <View style={styles.balance}>
            <Text style={styles.balanceLabel}>{t('points.balance')}</Text>
            <View style={styles.balanceRow}>
              <Text style={styles.balanceValue}>{formatPoints(data.balance)}</Text>
              <Text style={styles.balanceUnit}>{t('points.unit')}</Text>
            </View>
            <Text style={styles.memberNo}>{formatMemberNo(data.memberNo)}</Text>
          </View>

          {data.entries.length === 0 ? (
            <EmptyState icon={Coins} title={t('points.empty')} hint={t('points.emptyHint')} />
          ) : (
            <View style={styles.list}>
              {data.entries.map((e, i) => (
                <View key={e.id} style={[styles.row, i > 0 && styles.divider]}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {e.movieTitle ?? t('points.bonus')}
                    </Text>
                    <Text style={styles.rowSub}>
                      {[
                        formatMonthDay(ubDate(new Date(e.createdAt)), locale),
                        e.kind === 'reverse' ? t('points.reversed') : null,
                      ]
                        .filter(Boolean)
                        .join('  ·  ')}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.amount,
                      { color: e.points < 0 ? colors.danger : colors.success },
                    ]}
                  >
                    {signedPoints(e.points)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxxl },
  balance: { gap: 2, paddingVertical: space.sm, paddingHorizontal: space.xs },
  balanceLabel: { ...type.footnote, color: colors.muted },
  balanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  balanceValue: {
    ...type.largeTitle,
    fontSize: 44,
    lineHeight: 50,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  balanceUnit: { ...type.headline, color: colors.muted },
  memberNo: { ...type.caption, color: colors.muted, marginTop: space.xs },
  list: { backgroundColor: colors.raised, borderRadius: radius.card, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 60,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  divider: { borderTopWidth: hairlineWidth, borderTopColor: colors.hairline },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...type.bodyMedium, color: colors.ink },
  rowSub: { ...type.caption, color: colors.muted },
  amount: { ...type.number },
});
