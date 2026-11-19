import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import type { MovieSummary } from '@/shared';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { Poster } from './poster';
import { PosterBackdrop } from './poster-backdrop';
import { Pressable } from './pressable';

export const HERO_HEIGHT = 600;
/** How far a pull-down may stretch a page's backdrop upward before it is clipped. */
const STRETCH_ROOM = 1000;

/** Horizontal pager of now-showing films; every page sits on its own blurred, tinted poster. */
export function HeroPager({
  movies,
  scrollY,
}: {
  movies: MovieSummary[];
  /** The page's vertical scroll offset: pulling past the top stretches the backdrops. */
  scrollY?: SharedValue<number>;
}) {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);

  const onEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      if (next !== index) haptic.select();
      setIndex(next);
    },
    [width, index],
  );

  return (
    <View style={{ height: HERO_HEIGHT }}>
      <FlatList
        data={movies}
        keyExtractor={(m) => m.id}
        horizontal
        pagingEnabled
        // Past the first/last film there is nothing to show: stop at the edge instead of bouncing
        // into bare canvas, and do not swipe at all with a single film.
        bounces={false}
        overScrollMode="never"
        scrollEnabled={movies.length > 1}
        // The backdrops stretch above the pager when the page is pulled down: do not clip them.
        style={{ overflow: 'visible' }}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onEnd}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => <Page movie={item} width={width} scrollY={scrollY} />}
      />
      <View style={styles.dots} pointerEvents="none">
        {movies.map((m, i) => (
          <View key={m.id} style={[styles.pip, i === index && styles.pipOn]} />
        ))}
      </View>
    </View>
  );
}

function Page({
  movie,
  width,
  scrollY,
}: {
  movie: MovieSummary;
  width: number;
  scrollY?: SharedValue<number>;
}) {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const open = () => router.push(`/movie/${movie.id}`);
  const book = () => router.push(`/movie/${movie.id}/showtimes`);
  return (
    <View style={{ width, height: HERO_HEIGHT }}>
      {/* Clip each page's backdrop to its own width (the stretch on pull-down also widens it,
          which would spill over the next page) while leaving room above for that stretch. */}
      <View style={styles.backdropClip} pointerEvents="none">
        <View style={styles.backdropBox}>
          <PosterBackdrop
            uri={movie.backdropUrl ?? movie.posterUrl}
            tone={movie.tone}
            scrollY={scrollY}
          />
        </View>
      </View>
      <View style={[styles.content, { paddingTop: insets.top + 64 }]}>
        <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={movie.title}>
          <View style={[styles.glow, { shadowColor: movie.tone }]}>
            <Poster uri={movie.posterUrl} width={176} radius={18} />
          </View>
        </Pressable>
        <Text style={styles.title} numberOfLines={2}>
          {movie.title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[movie.ageRating, formatDuration(movie.durationMin, t), movie.genres[0]]
            .filter(Boolean)
            .join('  ·  ')}
        </Text>
        <Pressable
          style={styles.cta}
          onPress={book}
          accessibilityRole="button"
          accessibilityLabel={`${movie.title} — ${t('home.book').toLowerCase()}`}
        >
          <Text style={styles.ctaText}>{t('home.book')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdropClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -STRETCH_ROOM,
    bottom: 0,
    overflow: 'hidden',
  },
  backdropBox: { position: 'absolute', left: 0, right: 0, top: STRETCH_ROOM, bottom: 0 },
  content: { flex: 1, alignItems: 'center', paddingHorizontal: space.xl, gap: space.md },
  // The one allowed shadow: the poster casting its own film tone, not a generic drop shadow.
  glow: { shadowOpacity: 0.55, shadowRadius: 36, shadowOffset: { width: 0, height: 14 } },
  title: { ...type.title, color: colors.ink, textAlign: 'center', marginTop: space.sm },
  meta: { ...type.caption, color: colors.body, marginTop: -space.xs },
  cta: {
    marginTop: space.sm,
    backgroundColor: colors.action,
    borderRadius: radius.pill,
    paddingHorizontal: space.xxxl,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { ...type.headline, color: colors.onAction },
  dots: {
    position: 'absolute',
    bottom: space.sm,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  pip: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.pip },
  pipOn: { width: 18, backgroundColor: colors.ink },
});
