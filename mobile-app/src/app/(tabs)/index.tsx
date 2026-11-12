import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BranchChip } from '@/components/branch-chip';
import { HERO_HEIGHT, HeroPager } from '@/components/hero-pager';
import { PosterRow, PosterRowSkeleton } from '@/components/poster-row';
import { Skeleton } from '@/components/skeleton';
import { EmptyState, ErrorState } from '@/components/state-views';
import { useI18n } from '@/i18n';
import { useMovies } from '@/lib/catalog';
import { formatMonthDay } from '@/lib/format';
import { colors, space } from '@/theme/tokens';
import { type } from '@/theme/type';

export default function MoviesScreen() {
  const { t, locale } = useI18n();
  const insets = useSafeAreaInsets();
  const now = useMovies('now');
  const soon = useMovies('soon');
  const refreshing = now.isRefetching || soon.isRefetching;

  return (
    <View style={styles.root}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.muted}
            onRefresh={() => {
              now.refetch();
              soon.refetch();
            }}
          />
        }
      >
        {now.data ? (
          now.data.length === 0 ? (
            <View style={{ paddingTop: insets.top + 64 }}>
              <EmptyState title={t('home.empty')} />
            </View>
          ) : (
            <HeroPager movies={now.data.slice(0, 5)} />
          )
        ) : now.isError ? (
          <View style={{ paddingTop: insets.top + 64 }}>
            <ErrorState error={now.error} onRetry={() => now.refetch()} />
          </View>
        ) : (
          <HeroSkeleton top={insets.top} />
        )}

        {now.data && now.data.length > 0 ? (
          <PosterRow
            title={t('home.nowShowing')}
            movies={now.data}
            caption={(m) => [m.ageRating, m.genres[0]].filter(Boolean).join(' · ')}
          />
        ) : null}

        {soon.data ? (
          soon.data.length > 0 ? (
            <PosterRow
              title={t('home.comingSoon')}
              movies={soon.data}
              caption={(m) => t('home.opens', { date: formatMonthDay(m.releaseDate, locale) })}
            />
          ) : null
        ) : soon.isError ? (
          <View style={styles.soonSkeleton}>
            <Text style={styles.soonTitle}>{t('home.comingSoon')}</Text>
            <ErrorState error={soon.error} onRetry={() => soon.refetch()} />
          </View>
        ) : (
          <View style={styles.soonSkeleton}>
            <Skeleton width={150} height={24} style={{ marginLeft: space.lg }} />
            <PosterRowSkeleton>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} width={132} height={198} radius={14} />
              ))}
            </PosterRowSkeleton>
          </View>
        )}
      </ScrollView>

      <View style={[styles.header, { top: insets.top + space.sm }]} pointerEvents="box-none">
        <Text style={styles.headerTitle} accessibilityRole="header">
          {t('movies.title')}
        </Text>
        <BranchChip />
      </View>
    </View>
  );
}

function HeroSkeleton({ top }: { top: number }) {
  return (
    <View style={[styles.heroSkeleton, { paddingTop: top + 64 }]}>
      <Skeleton width={176} height={264} radius={18} />
      <Skeleton width={200} height={26} />
      <Skeleton width={140} height={16} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  header: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { ...type.title, color: colors.ink },
  heroSkeleton: { height: HERO_HEIGHT, alignItems: 'center', gap: space.md },
  soonTitle: { ...type.title, color: colors.ink, paddingHorizontal: space.lg },
  soonSkeleton: { gap: space.md, marginTop: space.xxl },
});
