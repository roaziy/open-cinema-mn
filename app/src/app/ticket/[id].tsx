import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { CalendarPlus, Wallet } from 'phosphor-react-native';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from '@/components/pressable';
import { Skeleton } from '@/components/skeleton';
import { ErrorState } from '@/components/state-views';
import { TicketStub } from '@/components/ticket-stub';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useBooking, useTicket } from '@/lib/orders';
import { addToCalendar, addToWallet } from '@/lib/ticket-actions';
import { showToast } from '@/lib/toast';
import { WALLET_BADGE_SOURCE } from '@/lib/wallet-badge';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

/** One ticket, or every ticket of a booking when opened right after paying (`?booking=`). */
export default function TicketScreen() {
  const { t } = useI18n();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const { id, booking } = useLocalSearchParams<{ id: string; booking?: string }>();
  const order = useBooking(booking ?? '');
  const ids = booking && order.data ? order.data.ticketIds : [id];

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t('ticket.title'),
          headerBackButtonDisplayMode: 'minimal',
          headerTintColor: colors.ink,
          headerTransparent: true,
          // After paying, back goes to the film list rather than the finished checkout.
          headerBackVisible: !booking,
          headerRight: booking
            ? () => (
                <Pressable onPress={() => router.dismissAll()} accessibilityRole="button">
                  <Text style={styles.done}>{t('common.done')}</Text>
                </Pressable>
              )
            : undefined,
        }}
      />
      <ScrollView
        contentContainerStyle={[
          styles.pad,
          { paddingTop: headerHeight + space.lg, paddingBottom: insets.bottom + space.xxl },
        ]}
      >
        {ids.map((tid, i) => (
          <TicketBlock key={tid} id={tid} index={ids.length > 1 ? i : null} total={ids.length} />
        ))}
      </ScrollView>
    </View>
  );
}

function TicketBlock({ id, index, total }: { id: string; index: number | null; total: number }) {
  const { t } = useI18n();
  const q = useTicket(id);
  const [walletBusy, setWalletBusy] = useState(false);
  const ticket = q.data;

  if (q.isError && !ticket) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!ticket) return <Skeleton height={560} radius={radius.panel} />;

  const live = ticket.status === 'valid';

  const wallet = async () => {
    if (walletBusy) return;
    setWalletBusy(true);
    const res = await addToWallet(ticket.id, t);
    setWalletBusy(false);
    if (!res.ok) {
      haptic.error();
      showToast(res.message, 'error');
    }
  };

  const calendar = async () => {
    const res = await addToCalendar(ticket, t);
    if (res.ok) {
      haptic.success();
      showToast(t('ticket.calendarAdded'));
    } else if (res.message) {
      haptic.error();
      showToast(res.message, 'error');
    }
  };

  return (
    <View style={styles.block}>
      {index !== null ? (
        <Text style={styles.count}>{t('ticket.n', { n: index + 1, total })}</Text>
      ) : null}
      <TicketStub ticket={ticket} />
      {live ? (
        <View style={styles.actions}>
          {process.env.EXPO_OS === 'ios' ? (
            <Pressable
              style={[styles.action, styles.wallet, walletBusy && styles.busy]}
              onPress={wallet}
              disabled={walletBusy}
              accessibilityRole="button"
              accessibilityLabel={t('ticket.wallet')}
            >
              {WALLET_BADGE_SOURCE !== null ? (
                <Image source={WALLET_BADGE_SOURCE} style={styles.badge} contentFit="contain" />
              ) : walletBusy ? (
                <ActivityIndicator color={colors.ink} />
              ) : (
                <>
                  <Wallet size={20} weight="fill" color={colors.ink} />
                  <Text style={styles.actionText}>{t('ticket.wallet')}</Text>
                </>
              )}
            </Pressable>
          ) : null}
          <Pressable style={styles.action} onPress={calendar} accessibilityRole="button">
            <CalendarPlus size={20} weight="fill" color={colors.ink} />
            <Text style={styles.actionText}>{t('ticket.calendar')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  pad: { paddingHorizontal: space.lg, gap: space.xxl },
  done: { ...type.bodyMedium, color: colors.action },
  block: { gap: space.md },
  count: { ...type.footnote, color: colors.muted, marginLeft: space.xs },
  actions: { gap: space.sm },
  action: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.card,
    backgroundColor: colors.fill,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  wallet: { backgroundColor: colors.raised },
  busy: { opacity: 0.6 },
  badge: { width: '100%', height: 48 },
  actionText: { ...type.headline, color: colors.ink },
});
