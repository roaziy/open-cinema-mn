import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { Clock, LogIn, Ticket } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from '@/components/pressable';
import { useI18n } from '@/i18n';
import { getContactEmail, setContactEmail } from '@/lib/checkout-store';
import { confirmGuestLogin } from '@/lib/guest-login';
import { formatCountdown, liveHolds, useCountdown, useMyHolds } from '@/lib/seats';
import { normalizeEmail } from '@/shared';
import { colors, radius, space } from '@/theme/tokens';
import { fonts, type } from '@/theme/type';

/** Sheet after seats for logged-out customers: log in, or continue as a guest with an email. */
export default function GateScreen() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const holds = useMyHolds(id);
  const earliest = useMemo(
    () =>
      liveHolds(holds.data)
        .map((h) => h.expiresAt)
        .sort()[0] ?? null,
    [holds.data],
  );
  const left = useCountdown(earliest);
  // No live seat left (the timer ran out, or the map's own expiry cleared them first): go
  // back to the map, which says which ones lapsed. Only while this sheet is the front screen,
  // so a login modal on top is never the one that closes.
  const focused = useIsFocused();
  const noSeats = holds.data !== undefined && earliest === null;
  const closed = noSeats || left === 0;
  useEffect(() => {
    if (focused && closed) router.dismissTo(`/showtime/${id}`);
  }, [focused, closed, id]);

  const [email, setEmail] = useState(() => getContactEmail(id) ?? '');
  const [touched, setTouched] = useState(false);
  const [checkingLogin, setCheckingLogin] = useState(false);
  const normalized = normalizeEmail(email);
  const invalid = touched && !normalized;

  const asGuest = () => {
    if (!normalized) {
      setTouched(true);
      return;
    }
    setContactEmail(id, normalized);
    router.dismiss();
    router.push(`/checkout/${id}`);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.body, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.head}>
          <View style={styles.headText}>
            <Text style={styles.title} accessibilityRole="header">
              {t('gate.title')}
            </Text>
            <Text style={styles.sub}>{t('gate.sub')}</Text>
          </View>
          {left !== null ? (
            <View style={[styles.timer, left <= 60 && styles.timerUrgent]}>
              <Clock size={14} strokeWidth={2} color={left <= 60 ? colors.danger : colors.body} />
              <Text style={[styles.timerText, left <= 60 && { color: colors.danger }]}>
                {formatCountdown(left)}
              </Text>
            </View>
          ) : null}
        </View>

        <Pressable
          style={[styles.loginCard, (closed || checkingLogin) && styles.disabled]}
          disabled={closed || checkingLogin}
          accessibilityState={{ disabled: closed || checkingLogin, busy: checkingLogin }}
          onPress={async () => {
            if (checkingLogin) return;
            setCheckingLogin(true);
            try {
              if (await confirmGuestLogin(t)) router.push(`/login?showtimeId=${id}&next=checkout`);
            } finally {
              setCheckingLogin(false);
            }
          }}
          accessibilityRole="button"
        >
          <LogIn size={26} color={colors.muted} strokeWidth={1.75} />
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>{t('gate.login')}</Text>
            <Text style={styles.cardHint}>{t('gate.loginHint')}</Text>
          </View>
          <View style={styles.cta}>
            <Text style={styles.ctaText}>{t('gate.login')}</Text>
          </View>
        </Pressable>

        <View style={styles.divider}>
          <View style={styles.rule} />
          <Text style={styles.or}>{t('gate.or')}</Text>
          <View style={styles.rule} />
        </View>

        <View style={styles.guestCard}>
          <View style={styles.guestHead}>
            <Ticket size={26} color={colors.muted} strokeWidth={1.75} />
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>{t('gate.guest')}</Text>
              <Text style={styles.cardHint}>{t('gate.guestHint')}</Text>
            </View>
          </View>
          <TextInput
            style={[styles.input, invalid && styles.inputInvalid]}
            value={email}
            onChangeText={setEmail}
            onBlur={() => email.length > 0 && setTouched(true)}
            placeholder={t('gate.email')}
            placeholderTextColor={colors.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
            autoComplete="email"
            returnKeyType="go"
            onSubmitEditing={asGuest}
            selectionColor={colors.action}
          />
          {invalid ? <Text style={styles.error}>{t('gate.emailInvalid')}</Text> : null}
          <Pressable
            style={[styles.secondary, (!normalized || closed) && styles.disabled]}
            disabled={!normalized || closed}
            onPress={asGuest}
            accessibilityRole="button"
            accessibilityState={{ disabled: !normalized || closed }}
          >
            <Text style={styles.secondaryText}>{t('gate.guest')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { paddingHorizontal: space.lg, paddingTop: space.xxl, gap: space.lg },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  headText: { flex: 1, gap: 2 },
  title: { ...type.title, color: colors.ink },
  sub: { ...type.body, color: colors.muted },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space.sm + 2,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.fill,
  },
  timerUrgent: { backgroundColor: colors.dangerFill },
  timerText: { ...type.footnote, color: colors.body, fontVariant: ['tabular-nums'] },
  loginCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
  },
  cardText: { flex: 1, gap: 1 },
  cardTitle: { ...type.headline, color: colors.ink },
  cardHint: { ...type.caption, color: colors.muted },
  cta: {
    height: 36,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.action,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { ...type.bodyMedium, color: colors.onAction },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rule: { flex: 1, height: 1, backgroundColor: colors.hairline },
  or: { ...type.caption, color: colors.muted },
  guestCard: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
  },
  guestHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  input: {
    height: 50,
    paddingHorizontal: space.lg,
    borderRadius: radius.inner + 2,
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.hairline,
    ...type.bodyMedium,
    fontFamily: fonts.medium,
    color: colors.ink,
  },
  inputInvalid: { borderColor: colors.dangerEdge },
  error: { ...type.caption, color: colors.danger },
  secondary: {
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.inner + 2,
    backgroundColor: colors.fill,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  secondaryText: { ...type.headline, color: colors.ink },
  disabled: { opacity: 0.4 },
});
