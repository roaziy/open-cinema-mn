import { formatMnt, ubDate } from '@open-cinema/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarBlank, CaretLeft, Clock, ShieldCheck, Tag } from 'phosphor-react-native';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AgeBadge } from '@/components/age-badge';
import { GlassBar } from '@/components/glass-bar';
import { IconTile } from '@/components/icon-tile';
import { Poster } from '@/components/poster';
import { PosterBackdrop } from '@/components/poster-backdrop';
import { Pressable } from '@/components/pressable';
import { Skeleton } from '@/components/skeleton';
import { ErrorState } from '@/components/state-views';
import { useI18n } from '@/i18n';
import { useMovie, useShowtimes } from '@/lib/catalog';
import { formatDuration } from '@/lib/format';
import { colors, hairlineWidth, hues, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

export default function MovieScreen() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const movie = useMovie(id);
  // Today's slots give the "from" price; an empty day simply hides it.
  const today = useShowtimes(id, ubDate(new Date()));
  const prices = today.data?.flatMap((b) => b.showtimes.map((s) => s.priceStandard)) ?? [];
  const fromPrice = prices.length > 0 ? Math.min(...prices) : null;

  const back = (
    <Pressable
      style={[styles.back, { top: insets.top + space.sm }]}
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel={t('movie.back')}
    >
      <CaretLeft size={20} color={colors.ink} weight="bold" />
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
  return (
    <View style={styles.root}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
      >
        <View style={[styles.hero, { paddingTop: insets.top + 64 }]}>
          <PosterBackdrop uri={m.backdropUrl ?? m.posterUrl} tone={m.tone} />
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
        </View>

        <View style={styles.body}>
          <Text style={styles.heading}>{t('movie.synopsis')}</Text>
          <Text style={styles.synopsis}>{m.synopsis}</Text>

          <Text style={[styles.heading, { marginTop: space.xxl }]}>{t('movie.info')}</Text>
          <View style={styles.panel}>
            <View style={styles.card}>
              <InfoRow
                tile={<IconTile sf="clock.fill" phosphor={Clock} hue={hues.sky} size={28} />}
                label={t('movie.duration')}
                value={formatDuration(m.durationMin, t)}
              />
              <InfoRow
                tile={<IconTile sf="tag.fill" phosphor={Tag} hue={hues.purple} size={28} />}
                label={t('movie.genre')}
                value={m.genres.join(', ')}
              />
              <InfoRow
                tile={<IconTile sf="calendar" phosphor={CalendarBlank} hue={hues.teal} size={28} />}
                label={t('movie.release')}
                value={m.releaseDate}
              />
              <InfoRow
                tile={
                  <IconTile sf="shield.fill" phosphor={ShieldCheck} hue={hues.pink} size={28} />
                }
                label={t('movie.age')}
                value={m.ageRating}
                last
              />
            </View>
          </View>
        </View>
      </ScrollView>

      {back}

      <View style={[styles.cta, { bottom: insets.bottom + space.sm }]} pointerEvents="box-none">
        <GlassBar>
          <View style={styles.ctaRow}>
            {fromPrice !== null ? (
              <Text style={styles.price}>
                {t('movie.fromPrice', { price: formatMnt(fromPrice) })}
              </Text>
            ) : null}
            <Pressable
              style={styles.button}
              onPress={() => router.push(`/movie/${id}/showtimes`)}
              accessibilityRole="button"
            >
              <Text style={styles.buttonText}>{t('movie.pickTime')}</Text>
            </Pressable>
          </View>
        </GlassBar>
      </View>
    </View>
  );
}

function InfoRow({
  tile,
  label,
  value,
  last,
}: {
  tile: ReactNode;
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, !last && styles.infoDivider]}>
      {tile}
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const PANEL_PADDING = space.sm;

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
    backgroundColor: 'rgba(11,11,13,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
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
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.panel,
    padding: PANEL_PADDING,
    borderWidth: hairlineWidth,
    borderColor: colors.hairline,
  },
  card: {
    backgroundColor: colors.raised,
    borderRadius: radius.panel - PANEL_PADDING,
    borderWidth: hairlineWidth,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
    paddingHorizontal: space.lg,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  infoDivider: { borderBottomWidth: hairlineWidth, borderBottomColor: colors.hairline },
  infoLabel: { ...type.body, color: colors.ink, flex: 1 },
  infoValue: { ...type.body, color: colors.muted, maxWidth: '50%' },
  cta: { position: 'absolute', left: space.lg, right: space.lg },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  price: { ...type.number, color: colors.ink, paddingLeft: space.md },
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
