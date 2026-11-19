import { router, useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { type SharedValue, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import { formatDuration } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import type { MovieSummary } from '@/shared';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { AgeBadge } from './age-badge';
import { KeyArt } from './key-art';
import { Pressable } from './pressable';

export const HERO_HEIGHT = 720;
/** Room under the art for the button, the facts and the page dots. */
const FOOT = 112;
/** How far a pull-down may stretch a page's backdrop upward before it is clipped. */
const STRETCH_ROOM = 1000;
/** How long a film stays up before the pager moves on by itself. */
const AUTO_MS = 5000;
// ponytail: "endless" = the films repeated LAPS times, starting in the middle; a person would
// have to swipe ~LAPS/2 laps one way to reach an end. Swap for clone-and-jump if that ever matters.
const LAPS = 200;

/** Horizontal pager of now-showing films: each page is the film's poster, full width. */
export function HeroPager(props: { movies: MovieSummary[]; scrollY?: SharedValue<number> }) {
  // A new film count starts the pager over, in the middle of its laps.
  return <Pager key={props.movies.length} {...props} />;
}

function Pager({
  movies,
  scrollY,
}: {
  movies: MovieSummary[];
  /** The page's vertical scroll offset: pulling past the top stretches the backdrops. */
  scrollY?: SharedValue<number>;
}) {
  const { width } = useWindowDimensions();
  const n = movies.length;
  const loop = n > 1;
  const pages = useMemo(
    () => (loop ? Array.from({ length: n * LAPS }, (_, i) => movies[i % n]) : movies),
    [movies, n, loop],
  );
  const start = loop ? n * (LAPS / 2) : 0;
  const list = useRef<FlatList<MovieSummary>>(null);
  const pos = useRef(start);
  const [index, setIndex] = useState(0);

  // Move on every AUTO_MS while the home tab is on screen; a touch holds it, Reduce Motion stops it.
  const focused = useIsFocused();
  const still = useReducedMotion();
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const arm = useCallback(() => {
    clearInterval(timer.current);
    if (!loop || !focused || still) return;
    timer.current = setInterval(() => {
      pos.current += 1;
      setIndex(pos.current % n);
      list.current?.scrollToOffset({ offset: pos.current * width, animated: true });
    }, AUTO_MS);
  }, [loop, focused, still, n, width]);
  useEffect(() => {
    arm();
    return () => clearInterval(timer.current);
  }, [arm]);

  const hold = useCallback(() => clearInterval(timer.current), []);
  const onEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      if (next !== pos.current) haptic.select();
      pos.current = next;
      setIndex(next % n);
      arm();
    },
    [width, n, arm],
  );

  return (
    <View style={{ height: HERO_HEIGHT }}>
      <FlatList
        ref={list}
        data={pages}
        keyExtractor={(m, i) => `${m.id}-${i}`}
        horizontal
        pagingEnabled
        initialScrollIndex={start}
        // A single film has nowhere to go: no swipe, no bounce into bare canvas.
        bounces={false}
        overScrollMode="never"
        scrollEnabled={loop}
        // The backdrops stretch above the pager when the page is pulled down: do not clip them.
        style={{ overflow: 'visible' }}
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={hold}
        onScrollEndDrag={arm}
        onMomentumScrollEnd={onEnd}
        windowSize={3}
        initialNumToRender={1}
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
  // The poster at its own 2:3 shape, full width: its title art stays whole and does the talking.
  const artH = Math.min(Math.round(width * 1.5), HERO_HEIGHT - FOOT);
  return (
    <View style={{ width, height: HERO_HEIGHT }}>
      {/* Clip each page's art to its own width (the stretch on pull-down also widens it, which
          would spill over the next page) while leaving room above for that stretch. */}
      <View style={[styles.artClip, { height: STRETCH_ROOM + artH }]} pointerEvents="none">
        <View style={[styles.artBox, { height: artH }]}>
          <KeyArt
            uri={movie.posterUrl}
            pageColor={colors.canvas}
            height={artH}
            topInset={insets.top}
            scrollY={scrollY}
            fade={0.3}
            scrim={0.85}
            scrimDepth={170}
          />
        </View>
      </View>
      <Pressable
        style={[styles.artTap, { height: artH }]}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={movie.title}
      />
      <View style={[styles.foot, { top: artH - 26 }]} pointerEvents="box-none">
        <Pressable
          style={styles.cta}
          onPress={book}
          accessibilityRole="button"
          accessibilityLabel={`${movie.title} — ${t('home.book').toLowerCase()}`}
        >
          <Text style={styles.ctaText}>{t('home.book')}</Text>
        </Pressable>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{formatDuration(movie.durationMin, t)}</Text>
          <AgeBadge rating={movie.ageRating} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  artClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -STRETCH_ROOM,
    overflow: 'hidden',
  },
  artBox: { position: 'absolute', left: 0, right: 0, top: STRETCH_ROOM },
  artTap: { position: 'absolute', top: 0, left: 0, right: 0 },
  // The button and the facts sit just under the art, centred, on the page itself.
  foot: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: space.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  meta: { ...type.headline, color: colors.ink },
  cta: {
    backgroundColor: colors.action,
    borderRadius: radius.pill,
    paddingHorizontal: space.xxxl,
    height: 52,
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
