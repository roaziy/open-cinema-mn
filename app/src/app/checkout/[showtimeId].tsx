import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Clock, Envelope, QrCode } from 'phosphor-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconTile } from '@/components/icon-tile';
import { Poster } from '@/components/poster';
import { Pressable } from '@/components/pressable';
import { Skeleton } from '@/components/skeleton';
import { ErrorState } from '@/components/state-views';
import { type TKey, useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  attemptSignature,
  getAttempt,
  getContactEmail,
  setAttemptBooking,
} from '@/lib/checkout-store';
import { haptic } from '@/lib/haptics';
import { createBooking, newIdempotencyKey, orderKeys } from '@/lib/orders';
import {
  formatCountdown,
  liveHolds,
  seatLabel,
  useCountdown,
  useMyHolds,
  useSeatMap,
} from '@/lib/seats';
import { showToast } from '@/lib/toast';
import { formatMnt, formatUbTime, normalizeEmail, seatPrice } from '@/shared';
import { colors, hues, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

function errorKey(e: unknown): TKey {
  if (e instanceof ApiError) {
    if (e.code === 'holds_unavailable') return 'checkout.err.holds_unavailable';
    if (e.code === 'seat_taken') return 'checkout.err.seat_taken';
    if (e.code === 'showtime_closed') return 'checkout.err.showtime_closed';
  }
  return 'checkout.err.generic';
}

export default function CheckoutScreen() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const qc = useQueryClient();
  const { showtimeId } = useLocalSearchParams<{ showtimeId: string }>();
  const { user } = useAuth();
  const map = useSeatMap(showtimeId);
  const holds = useMyHolds(showtimeId);
  const focused = useIsFocused();

  const live = useMemo(() => liveHolds(holds.data), [holds.data]);
  // Server expiry of the earliest hold, not a local 10-minute timer.
  const earliest = useMemo(() => live.map((h) => h.expiresAt).sort()[0] ?? null, [live]);

  // Once the order exists the holds turn into it, so "no holds" is then expected.
  const submitted = useRef(false);
  const leaving = useRef(false);
  const [busy, setBusy] = useState(false);

  const backToSeats = useCallback(
    (message: string) => {
      if (leaving.current || submitted.current) return;
      leaving.current = true;
      showToast(message, 'error', 5000);
      router.dismissTo(`/showtime/${showtimeId}`);
    },
    [showtimeId],
  );

  // The earliest hold running out ends this order, but later ones may still be live.
  const left = useCountdown(
    earliest,
    useCallback(() => backToSeats(t('checkout.holdExpired')), [backToSeats, t]),
  );

  // Same holds, same attempt: a booking already made for them is replayed, not rebuilt.
  const signature = useMemo(
    () =>
      live.length > 0
        ? attemptSignature(
            showtimeId,
            live.map((h) => h.id),
          )
        : null,
    [live, showtimeId],
  );
  const attempt = signature ? getAttempt(signature, newIdempotencyKey) : null;
  // The server knows which holds are already inside an unpaid order (also after a restart).
  const serverBooking = live.find((h) => h.bookingId)?.bookingId ?? null;
  const existingBooking = serverBooking ?? attempt?.bookingId ?? null;
  useEffect(() => {
    if (existingBooking && !submitted.current) {
      submitted.current = true;
      if (serverBooking) showToast(t('checkout.pendingOrder'), 'error', 5000);
      router.replace(`/pay/${existingBooking}`);
    }
  }, [existingBooking, serverBooking, t]);
  // Deep link or back-navigation with nothing held: never render an order out of thin air.
  const noSeats = holds.data !== undefined && !holds.isPlaceholderData && live.length === 0;
  useEffect(() => {
    if (noSeats && focused) backToSeats(t('checkout.noSeats'));
  }, [noSeats, focused, backToSeats, t]);

  const show = map.data?.showtime;
  const seatsById = useMemo(() => new Map((map.data?.seats ?? []).map((s) => [s.id, s])), [map]);
  const lines = useMemo(
    () =>
      live.flatMap((h) => {
        const seat = seatsById.get(h.seatId);
        return seat && show ? [{ seat, price: seatPrice(seat.kind, show) }] : [];
      }),
    [live, seatsById, show],
  );
  const total = lines.reduce((sum, l) => sum + l.price, 0);

  const isGuest = !user || user.role === 'guest';
  const guestEmail = getContactEmail(showtimeId);
  const receipt = isGuest ? guestEmail : user.email;

  const pay = async () => {
    if (busy || lines.length === 0 || !signature || !attempt) return;
    setBusy(true);
    try {
      const contact = isGuest ? normalizeEmail(guestEmail ?? '') : null;
      const booking = await createBooking({
        holdIds: live.map((h) => h.id),
        idempotencyKey: attempt.key,
        ...(contact ? { contactEmail: contact } : {}),
      });
      submitted.current = true;
      setAttemptBooking(signature, booking.id);
      qc.setQueryData(orderKeys.booking(booking.id), booking);
      qc.invalidateQueries({ queryKey: ['holds', showtimeId] });
      router.replace(`/pay/${booking.id}`);
    } catch (e) {
      haptic.error();
      const key = errorKey(e);
      if (key === 'checkout.err.holds_unavailable' || key === 'checkout.err.seat_taken') {
        qc.invalidateQueries({ queryKey: ['holds', showtimeId] });
        qc.invalidateQueries({ queryKey: ['seatmap', showtimeId] });
        backToSeats(t(key));
      } else {
        showToast(t(key), 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const ready = !!show && lines.length > 0;
  const urgent = left !== null && left <= 60;

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t('checkout.title'),
          headerBackButtonDisplayMode: 'minimal',
          headerTintColor: colors.ink,
          headerTransparent: true,
        }}
      />
      {map.isError && !map.data ? (
        <View style={[styles.center, { paddingTop: headerHeight }]}>
          <ErrorState error={map.error} onRetry={() => map.refetch()} />
        </View>
      ) : !ready ? (
        <View style={[styles.pad, { paddingTop: headerHeight + space.lg }]}>
          <Skeleton height={150} radius={radius.card} />
          <Skeleton height={90} radius={radius.card} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.pad,
            { paddingTop: headerHeight + space.lg, paddingBottom: 120 + insets.bottom },
          ]}
        >
          {left !== null ? (
            <View style={[styles.timer, urgent && styles.timerUrgent]}>
              <Clock size={15} weight="fill" color={urgent ? colors.danger : colors.body} />
              <Text style={[styles.timerText, urgent && { color: colors.danger }]}>
                {t('checkout.holdLeft', { time: formatCountdown(left) })}
              </Text>
            </View>
          ) : null}

          <View style={styles.panel}>
            <View style={styles.card}>
              <View style={styles.film}>
                <Poster uri={show.movie.posterUrl} width={64} radius={10} />
                <View style={styles.filmText}>
                  <Text style={styles.filmTitle} numberOfLines={2}>
                    {show.movie.title}
                  </Text>
                  <Text style={styles.meta}>{show.branch.name}</Text>
                  <Text style={styles.meta}>
                    {[show.hallName, formatUbTime(show.startsAt), show.format].join('  ·  ')}
                  </Text>
                </View>
              </View>
              <View style={styles.rule} />
              <Text style={styles.section}>{t('checkout.seats')}</Text>
              {lines.map((l) => (
                <View key={l.seat.id} style={styles.line}>
                  <Text style={styles.lineSeat}>{seatLabel(l.seat)}</Text>
                  <Text style={styles.lineKind}>
                    {l.seat.kind === 'premium' ? t('seats.premium') : t('seats.standard')}
                  </Text>
                  <Text style={styles.linePrice}>{formatMnt(l.price)}</Text>
                </View>
              ))}
              <View style={styles.rule} />
              <View style={styles.line}>
                <Text style={styles.totalLabel}>{t('checkout.total')}</Text>
                <Text style={styles.total}>{formatMnt(total)}</Text>
              </View>
            </View>
          </View>

          <Text style={styles.group}>{t('checkout.method')}</Text>
          <View style={styles.row}>
            <IconTile sf="qrcode" phosphor={QrCode} hue={hues.indigo} size={36} />
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{t('checkout.qpay')}</Text>
              <Text style={styles.rowHint}>{t('checkout.qpayHint')}</Text>
            </View>
            <View style={styles.radio}>
              <View style={styles.radioDot} />
            </View>
          </View>

          <View style={styles.row}>
            <IconTile sf="envelope.fill" phosphor={Envelope} hue={hues.teal} size={36} />
            <View style={styles.rowText}>
              <Text style={styles.rowHint}>{t('checkout.receipt')}</Text>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {receipt ?? t('checkout.receiptNone')}
              </Text>
            </View>
            {!receipt ? (
              <Pressable
                onPress={() => router.dismissTo('/(tabs)/profile')}
                accessibilityRole="link"
              >
                <Text style={styles.link}>{t('checkout.receiptAdd')}</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.testNote}>{t('checkout.testMode')}</Text>
        </ScrollView>
      )}

      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        <Pressable
          style={[styles.cta, (!ready || busy || left === 0) && styles.disabled]}
          disabled={!ready || busy || left === 0}
          onPress={pay}
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready || busy || left === 0, busy }}
        >
          {busy ? (
            <ActivityIndicator color={colors.onAction} />
          ) : (
            <Text style={styles.ctaText}>{t('checkout.pay', { total: formatMnt(total) })}</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  center: { flex: 1, justifyContent: 'center' },
  pad: { paddingHorizontal: space.lg, gap: space.md },
  timer: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.fill,
  },
  timerUrgent: { backgroundColor: colors.dangerFill },
  timerText: { ...type.footnote, color: colors.body, fontVariant: ['tabular-nums'] },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.panel,
    padding: space.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  card: {
    backgroundColor: colors.raised,
    borderRadius: radius.panel - space.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
    padding: space.lg,
    gap: space.sm,
  },
  film: { flexDirection: 'row', gap: space.md },
  filmText: { flex: 1, gap: 3, justifyContent: 'center' },
  filmTitle: { ...type.headline, color: colors.ink },
  meta: { ...type.caption, color: colors.body },
  rule: { height: 1, backgroundColor: colors.hairline, marginVertical: space.xs },
  section: { ...type.footnote, color: colors.muted },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  lineSeat: { ...type.number, color: colors.ink, width: 52 },
  lineKind: { ...type.caption, color: colors.muted, flex: 1 },
  linePrice: { ...type.number, color: colors.ink },
  totalLabel: { ...type.bodyMedium, color: colors.body, flex: 1 },
  total: { ...type.number, fontSize: 20, lineHeight: 26, color: colors.ink },
  group: { ...type.footnote, color: colors.muted, marginTop: space.sm, marginLeft: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
  },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { ...type.bodyMedium, color: colors.ink },
  rowHint: { ...type.caption, color: colors.muted },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.action },
  link: { ...type.bodyMedium, color: colors.action },
  testNote: { ...type.caption, color: colors.muted, textAlign: 'center', marginTop: space.sm },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  cta: {
    height: 52,
    borderRadius: radius.card,
    backgroundColor: colors.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { ...type.headline, color: colors.onAction },
  disabled: { opacity: 0.4 },
});
