import { router, useLocalSearchParams } from 'expo-router';
import {
  CalendarDays,
  ChevronLeft,
  Clock,
  type LucideIcon,
  ShieldCheck,
  Tag,
} from 'lucide-react-native';
import { useMemo } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AgeBadge } from '@/components/age-badge';
import { Poster } from '@/components/poster';
import { PosterBackdrop } from '@/components/poster-backdrop';
import { Pressable } from '@/components/pressable';
import { Skeleton } from '@/components/skeleton';
import { ErrorState } from '@/components/state-views';
import { useI18n } from '@/i18n';
import { useFromPrice, useMovie } from '@/lib/catalog';
import { formatDuration, formatMonthDay, nextUbDays } from '@/lib/format';
import { formatMnt } from '@/shared';
import { colors, hairlineWidth, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

export default function MovieScreen() {
  const { t, locale } = useI18n();
  const insets = useSafeAreaInsets();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollY = useScrollOffset(scrollRef);
  const { id } = useLocalSearchParams<{ id: string }>();
  const movie = useMovie(id);
  const days = useMemo(() => nextUbDays(7), []);
  // "From" price: cheapest bookable slot across the loaded week (also covers presale for soon films).
  const fromPrice = useFromPrice(id, days, movie.isSuccess);

  const back = (
    <Pressable
      style={[styles.back, { top: insets.top + space.sm }]}
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel={t('movie.back')}
    >
      <ChevronLeft size={22} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );

  if (movie.isPending || movie.isError) {
    return (
      <View style={styles.root}>
        <View style={{ paddingTop: insets.top + 72, alignItems: 'center', gap: space.md }}>
          {movie.isError ? (
            <ErrorState error={movie.error} onRetry={() => movie.refetch()} />
          ) : (
            <>
              <Skeleton width={200} height={300} radius={18} />
              <Skeleton width={220} height={28} />
              <Skeleton width={160} height={16} />
            </>
          )}
        </View>
        {back}
      </View>
    );
  }

  const m = movie.data;
  const trailerUrl = m.trailerUrl;
  const trailer = trailerUrl ? (
    <Pressable
      style={styles.trailerButton}
      onPress={() => {
        Linking.openURL(trailerUrl).catch(() => {});
      }}
      accessibilityRole="link"
    >
      <Text style={styles.trailerText}>{t('movie.trailer')}</Text>
    </Pressable>
  ) : null;
  return (
    <View style={styles.root}>
      <Animated.ScrollView
        ref={scrollRef}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.xxxl }}
      >
        <View style={[styles.hero, { paddingTop: insets.top + 64 }]}>
          <PosterBackdrop uri={m.backdropUrl ?? m.posterUrl} tone={m.tone} scrollY={scrollY} />
          <View style={[styles.glow, { shadowColor: m.tone }]}>
            <Poster uri={m.posterUrl} width={200} radius={18} />
          </View>
          <Text style={styles.title}>{m.title}</Text>
          <View style={styles.metaRow}>
            <AgeBadge rating={m.ageRating} />
            <Text style={styles.meta}>
              {[formatDuration(m.durationMin, t), m.genres.join(', ')]
                .filter(Boolean)
                .join('  ·  ')}
            </Text>
          </View>
          {/* Actions sit with the title, where the eye already is, not in a floating bar. */}
          {m.status === 'soon' && fromPrice === null ? (
            <Text style={styles.soon}>
              {t('home.opens', { date: formatMonthDay(m.releaseDate, locale) })}
            </Text>
          ) : fromPrice !== null ? (
            <Text style={styles.price}>
              {t('movie.fromPrice', { price: formatMnt(fromPrice) })}
            </Text>
          ) : null}
          <View style={styles.actions}>
            {m.status === 'soon' && fromPrice === null ? null : (
              <Pressable
                style={styles.button}
                onPress={() => router.push(`/movie/${id}/showtimes`)}
                accessibilityRole="button"
              >
                <Text style={styles.buttonText}>{t('movie.pickTime')}</Text>
              </Pressable>
            )}
            {trailer}
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.heading}>{t('movie.synopsis')}</Text>
          <Text style={styles.synopsis}>{m.synopsis}</Text>

          <Text style={[styles.heading, { marginTop: space.xxl }]}>{t('movie.info')}</Text>
          <View style={styles.card}>
            <InfoRow
              icon={Clock}
              label={t('movie.duration')}
              value={formatDuration(m.durationMin, t)}
            />
            <InfoRow icon={Tag} label={t('movie.genre')} value={m.genres.join(', ')} />
            <InfoRow
              icon={CalendarDays}
              label={t('movie.release')}
              value={formatMonthDay(m.releaseDate, locale)}
            />
            <InfoRow icon={ShieldCheck} label={t('movie.age')} value={m.ageRating} last />
          </View>
        </View>
      </Animated.ScrollView>

      {back}
    </View>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
  last,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, !last && styles.infoDivider]}>
      <Icon size={20} color={colors.muted} strokeWidth={1.75} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  back: {
    position: 'absolute',
    left: space.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.scrim,
    borderWidth: 1,
    borderColor: colors.scrimBorder,
  },
  hero: {
    alignItems: 'center',
    gap: space.md,
    paddingBottom: space.xl,
    paddingHorizontal: space.xl,
  },
  glow: { shadowOpacity: 0.6, shadowRadius: 40, shadowOffset: { width: 0, height: 16 } },
  title: { ...type.largeTitle, color: colors.ink, textAlign: 'center', marginTop: space.md },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  meta: { ...type.caption, color: colors.body },
  body: { paddingHorizontal: space.lg },
  heading: { ...type.title, color: colors.ink, marginBottom: space.md },
  synopsis: { ...type.body, color: colors.body, lineHeight: 23 },
  // One surface, hairline rows: no frame inside a frame.
  card: { backgroundColor: colors.raised, borderRadius: radius.card, paddingHorizontal: space.lg },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  infoDivider: { borderBottomWidth: hairlineWidth, borderBottomColor: colors.hairline },
  infoLabel: { ...type.body, color: colors.ink, flex: 1 },
  infoValue: { ...type.body, color: colors.muted, maxWidth: '50%' },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.md,
    alignSelf: 'stretch',
    marginTop: space.sm,
  },
  soon: { ...type.headline, color: colors.ink, textAlign: 'center' },
  price: { ...type.number, color: colors.ink },
  trailerButton: {
    height: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailerText: { ...type.headline, color: colors.ink },
  button: {
    flex: 1,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { ...type.headline, color: colors.onAction },
});
