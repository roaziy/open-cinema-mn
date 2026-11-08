import { formatMnt } from '@open-cinema/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Flask } from 'phosphor-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from '@/components/pressable';
import { Skeleton } from '@/components/skeleton';
import { ErrorState } from '@/components/state-views';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { mockPay, orderKeys, useBooking } from '@/lib/orders';
import { formatCountdown, useCountdown } from '@/lib/seats';
import { showToast } from '@/lib/toast';
import { colors, hueFor, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

/** Static list for the mock screen; a real provider returns its own deep links. */
const BANKS = [
  'Хаан банк',
  'Голомт банк',
  'Худалдаа хөгжлийн банк',
  'Төрийн банк',
  'Капитрон банк',
  'Хас банк',
  'М банк',
  'Ариг банк',
  'Чингис Хаан банк',
  'Богд банк',
  'Транс банк',
  'Үндэсний хөрөнгө оруулалтын банк',
] as const;

const initials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export default function PayScreen() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const qc = useQueryClient();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const booking = useBooking(bookingId);
  const data = booking.data;
  const [paying, setPaying] = useState(false);
  const moved = useRef(false);

  const left = useCountdown(data?.status === 'pending' ? data.expiresAt : null);

  useEffect(() => {
    if (!data || moved.current) return;
    if (data.status === 'paid' && data.ticketIds[0]) {
      moved.current = true;
      haptic.success();
      router.replace(`/ticket/${data.ticketIds[0]}?booking=${data.id}`);
    }
  }, [data]);

  const markPaid = async () => {
    if (paying) return;
    setPaying(true);
    try {
      qc.setQueryData(orderKeys.booking(bookingId), await mockPay(bookingId));
    } catch {
      haptic.error();
      showToast(t('pay.error'), 'error');
    } finally {
      setPaying(false);
    }
  };

  const dead = data && data.status !== 'pending' && data.status !== 'paid';

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t('pay.title'),
          headerBackButtonDisplayMode: 'minimal',
          headerTintColor: colors.ink,
          headerTransparent: true,
        }}
      />
      {booking.isError && !data ? (
        <View style={[styles.center, { paddingTop: headerHeight }]}>
          <ErrorState error={booking.error} onRetry={() => booking.refetch()} />
        </View>
      ) : !data ? (
        <View style={[styles.pad, { paddingTop: headerHeight + space.lg }]}>
          <Skeleton height={300} radius={radius.card} />
        </View>
      ) : dead ? (
        <View style={[styles.center, styles.pad, { paddingTop: headerHeight }]}>
          <Text style={styles.deadTitle}>
            {data.status === 'failed' ? t('pay.failed') : t('pay.expired')}
          </Text>
          {data.seatsLost ? <Text style={styles.sub}>{t('pay.seatsLost')}</Text> : null}
          <Pressable
            style={styles.secondary}
            onPress={() => router.dismissTo(`/showtime/${data.showtime.id}`)}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>{t('pay.back')}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.pad,
            { paddingTop: headerHeight + space.lg, paddingBottom: 150 + insets.bottom },
          ]}
        >
          <View style={styles.testBadge}>
            <Flask size={16} weight="fill" color={colors.warning} />
            <Text style={styles.testBadgeText}>{t('pay.test')}</Text>
          </View>

          <View style={styles.panel}>
            <View style={styles.qrCard}>
              <Text style={styles.qrHint}>{t('pay.scan')}</Text>
              <View style={styles.qr} accessibilityLabel={t('pay.scan')}>
                <QRCode
                  value={data.invoice?.qrText ?? data.id}
                  size={200}
                  color={colors.paperInk}
                  backgroundColor={colors.paper}
                  ecl="M"
                />
              </View>
              <Text style={styles.amount}>{formatMnt(data.total)}</Text>
              <View style={styles.waiting}>
                <ActivityIndicator size="small" color={colors.paperMuted} />
                <Text style={styles.waitingText}>
                  {left !== null
                    ? t('pay.left', { time: formatCountdown(left) })
                    : t('pay.waiting')}
                </Text>
              </View>
            </View>
          </View>

          <Text style={styles.group}>{t('pay.orFrom')}</Text>
          <View style={styles.grid}>
            {BANKS.map((name) => (
              <View key={name} style={styles.bank} accessibilityLabel={name}>
                <View style={[styles.bankTile, { backgroundColor: hueFor(name) }]}>
                  <Text style={styles.bankInitials}>{initials(name)}</Text>
                </View>
                <Text style={styles.bankName} numberOfLines={2}>
                  {name}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      {data && !dead ? (
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
          <Text style={styles.barHint}>{t('pay.testHint')}</Text>
          <Pressable
            style={[styles.cta, paying && styles.disabled]}
            disabled={paying}
            onPress={markPaid}
            accessibilityRole="button"
            accessibilityState={{ busy: paying, disabled: paying }}
          >
            {paying ? (
              <ActivityIndicator color={colors.onAction} />
            ) : (
              <Text style={styles.ctaText}>{t('pay.markPaid')}</Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.md },
  pad: { paddingHorizontal: space.lg, gap: space.md },
  testBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.fill,
    borderWidth: 1,
    borderColor: colors.warningTint,
  },
  testBadgeText: { ...type.footnote, color: colors.warning },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.panel,
    padding: space.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  qrCard: {
    backgroundColor: colors.paper,
    borderRadius: radius.panel - space.sm,
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
  },
  qrHint: { ...type.bodyMedium, color: colors.paperMuted },
  qr: { padding: space.xs },
  amount: { ...type.number, fontSize: 26, lineHeight: 32, color: colors.paperInk },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  waitingText: { ...type.caption, color: colors.paperMuted, fontVariant: ['tabular-nums'] },
  group: { ...type.footnote, color: colors.muted, marginTop: space.sm, marginLeft: space.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.lg },
  bank: { width: '25%', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  bankTile: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bankInitials: { ...type.headline, color: colors.tileGlyph },
  bankName: { ...type.footnote, color: colors.body, textAlign: 'center' },
  deadTitle: { ...type.title, color: colors.ink, textAlign: 'center' },
  sub: { ...type.body, color: colors.muted, textAlign: 'center' },
  secondary: {
    marginTop: space.md,
    height: 50,
    paddingHorizontal: space.xxl,
    borderRadius: radius.card,
    backgroundColor: colors.fill,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { ...type.headline, color: colors.ink },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  barHint: { ...type.caption, color: colors.muted, textAlign: 'center' },
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
