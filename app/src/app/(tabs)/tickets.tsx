import { formatUbTime, type TicketView, ubDate } from '@open-cinema/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Poster } from '@/components/poster';
import { Pressable } from '@/components/pressable';
import { Skeleton } from '@/components/skeleton';
import { EmptyState, ErrorState } from '@/components/state-views';
import { ticketSummary } from '@/components/ticket-stub';
import { useI18n } from '@/i18n';
import { formatMonthDay } from '@/lib/format';
import { useTickets } from '@/lib/orders';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

type Scope = 'upcoming' | 'past';

export default function TicketsScreen() {
  const { t } = useI18n();
  const [scope, setScope] = useState<Scope>('upcoming');
  const q = useTickets(scope);
  const { refetch } = q;
  const [pulling, setPulling] = useState(false);

  // A ticket bought on another screen shows up the moment this tab is opened.
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch]),
  );

  const header = (
    <View style={styles.head}>
      <Text style={styles.title} accessibilityRole="header">
        {t('tickets.title')}
      </Text>
      <View style={styles.segments} accessibilityRole="tablist">
        {(['upcoming', 'past'] as const).map((s) => (
          <Pressable
            key={s}
            style={[styles.segment, scope === s && styles.segmentOn]}
            onPress={() => setScope(s)}
            accessibilityRole="tab"
            accessibilityState={{ selected: scope === s }}
          >
            <Text style={[styles.segmentText, scope === s && styles.segmentTextOn]}>
              {t(s === 'upcoming' ? 'tickets.upcoming' : 'tickets.past')}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <FlatList
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      data={q.data ?? []}
      keyExtractor={(x) => x.id}
      ListHeaderComponent={header}
      renderItem={({ item }) => <Row ticket={item} />}
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          tintColor={colors.muted}
          onRefresh={async () => {
            setPulling(true);
            await refetch();
            setPulling(false);
          }}
        />
      }
      ListEmptyComponent={
        q.isError ? (
          <ErrorState error={q.error} onRetry={() => refetch()} />
        ) : q.isPending ? (
          <View style={styles.skeletons}>
            <Skeleton height={104} radius={radius.card} />
            <Skeleton height={104} radius={radius.card} />
          </View>
        ) : (
          <EmptyState
            title={t(scope === 'upcoming' ? 'tickets.emptyUpcoming' : 'tickets.emptyPast')}
            hint={scope === 'upcoming' ? t('tickets.empty') : undefined}
          />
        )
      }
    />
  );
}

function Row({ ticket }: { ticket: TicketView }) {
  const { t, locale } = useI18n();
  const seat = `${ticket.seat.rowLabel}${ticket.seat.number}`;
  const cancelled = ticket.status === 'cancelled';
  return (
    <Pressable
      style={styles.row}
      onPress={() => router.push(`/ticket/${ticket.id}`)}
      accessibilityRole="button"
      accessibilityLabel={ticketSummary(ticket, t, locale)}
    >
      {/* Only the film's own content is dimmed; the status badge keeps full contrast. */}
      <View style={[styles.rowBody, cancelled && styles.rowDim]}>
        <Poster uri={ticket.movie.posterUrl} width={54} radius={8} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {ticket.movie.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {formatMonthDay(ubDate(ticket.showtime.startsAt), locale)}
            {'  ·  '}
            {formatUbTime(ticket.showtime.startsAt)}
            {'  ·  '}
            {ticket.showtime.format}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {ticket.branch.name}
            {'  ·  '}
            {ticket.hallName}
          </Text>
        </View>
        <Text style={styles.seatCode}>{seat}</Text>
      </View>
      {cancelled ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{t('ticket.cancelledNote')}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxxl, gap: space.md },
  head: { gap: space.md, paddingTop: space.lg, paddingBottom: space.xs },
  title: { ...type.largeTitle, color: colors.ink },
  segments: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: radius.inner + 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  segment: {
    flex: 1,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.inner - 1,
  },
  segmentOn: { backgroundColor: colors.fill },
  segmentText: { ...type.bodyMedium, color: colors.muted },
  segmentTextOn: { color: colors.ink },
  skeletons: { gap: space.md },
  row: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
  },
  rowBody: { flexDirection: 'row', gap: space.md },
  rowDim: { opacity: 0.6 },
  rowText: { flex: 1, gap: 2, justifyContent: 'center' },
  rowTitle: { ...type.headline, color: colors.ink },
  meta: { ...type.caption, color: colors.body },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    height: 22,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.dangerFill,
  },
  badgeText: { ...type.footnote, color: colors.danger },
  seatCode: { ...type.number, fontSize: 24, lineHeight: 30, color: colors.ink },
});
