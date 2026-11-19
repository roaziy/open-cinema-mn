import { router, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Poster } from '@/components/poster';
import { PosterBackdrop } from '@/components/poster-backdrop';
import { ShowtimeDays } from '@/components/showtime-days';
import { ShowtimeGroups } from '@/components/showtime-groups';
import { useI18n } from '@/i18n';
import { useBranchId } from '@/lib/branch';
import { useMovie, useShowDays, useShowtimes } from '@/lib/catalog';
import { formatDuration, nextUbDays } from '@/lib/format';
import { groupByBranch } from '@/lib/showtime-groups';
import { colors, space } from '@/theme/tokens';
import { type } from '@/theme/type';

export default function ShowtimesScreen() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useScrollOffset(scrollRef);
  const { id } = useLocalSearchParams<{ id: string }>();
  const days = useMemo(() => nextUbDays(7), []);
  // Open on the first day that has showings, until the viewer picks one.
  const [picked, setPicked] = useState<string | null>(null);
  const showDays = useShowDays(id, days, true);
  const date = picked ?? showDays[0] ?? (days[0] as string);
  const preferred = useBranchId();
  const movie = useMovie(id);
  const shows = useShowtimes(id, date);
  // Previous day's cards linger as placeholder data: never show or open them under a new chip.
  const loading = shows.isPending || shows.isPlaceholderData;
  // The transparent native header is laid over the backdrop; reserve its measured height.
  const headerHeight = useHeaderHeight();

  const branches = useMemo(
    () => groupByBranch(shows.data ?? [], preferred),
    [shows.data, preferred],
  );

  return (
    <Animated.ScrollView
      ref={scrollRef}
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
            fadeHeight={160}
            scrollY={scrollY}
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

      <ShowtimeDays days={days} value={date} onChange={setPicked} />

      <View style={styles.list}>
        <ShowtimeGroups
          groups={branches}
          loading={loading}
          error={shows.isError ? shows.error : null}
          onRetry={() => shows.refetch()}
          onPick={(slot) => router.push(`/showtime/${slot.id}`)}
        />
      </View>
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  film: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
  },
  filmText: { flex: 1, gap: 2 },
  filmTitle: { ...type.title, color: colors.ink },
  filmMeta: { ...type.caption, color: colors.body },
  list: { paddingHorizontal: space.lg, gap: space.lg, marginTop: space.lg },
});
