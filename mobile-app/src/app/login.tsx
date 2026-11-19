import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { OtpEntry } from '@/components/otp-entry';
import { Pressable } from '@/components/pressable';
import { useI18n } from '@/i18n';
import { requestOtp } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { localPhone } from '@/lib/local-phone';
import { loginKeepingHolds } from '@/lib/login-flow';
import { otpErrorKey } from '@/lib/otp-errors';
import { seatKeys, seatLabel } from '@/lib/seats';
import { showToast } from '@/lib/toast';
import { normalizeEmail, normalizePhone, type OtpChannel, type SeatMap } from '@/shared';
import { colors, radius, space } from '@/theme/tokens';
import { fonts, type } from '@/theme/type';

type Mode = 'phone' | 'email';

/** "+97699112233" -> "+976 9911 2233" */
function prettyPhone(e164: string): string {
  return `+976 ${e164.slice(4, 8)} ${e164.slice(8)}`;
}

export default function LoginScreen() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { showtimeId, next } = useLocalSearchParams<{ showtimeId?: string; next?: string }>();

  const [mode, setMode] = useState<Mode>('phone');
  const [value, setValue] = useState('');
  const [step, setStep] = useState<'contact' | 'code'>('contact');
  const [target, setTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const channel: OtpChannel = mode === 'phone' ? 'sms' : 'email';
  const normalized = mode === 'phone' ? normalizePhone(value) : normalizeEmail(value);

  const send = async () => {
    if (!normalized || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestOtp(channel, normalized);
      setTarget(normalized);
      setStep('code');
    } catch (e) {
      haptic.error();
      setError(t(otpErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  /** Throws on a wrong code; the code step shows it. */
  const verify = async (digits: string) => {
    if (!target) return;
    // The login clears cached data for the old identity: keep the seat names for the message.
    const seatMap = showtimeId ? qc.getQueryData<SeatMap>(seatKeys.map(showtimeId)) : undefined;
    const { lostSeatIds, heldCount } = await loginKeepingHolds(channel, target, digits, showtimeId);
    haptic.success();
    const lost = lostLabels(seatMap, lostSeatIds);
    if (showtimeId && next === 'checkout' && heldCount === 0) {
      // Nothing left to pay for (the holds ran out or were taken): back to the map.
      router.dismissTo(`/showtime/${showtimeId}`);
      const msg =
        lost.length > 0 ? t('seats.lost', { seats: lost.join(', ') }) : t('seats.expiredNone');
      setTimeout(() => showToast(msg, 'error', 5000), 400);
    } else if (showtimeId && next === 'checkout' && lost.length === 0) {
      router.dismissTo(`/showtime/${showtimeId}`);
      router.push(`/checkout/${showtimeId}`);
    } else if (showtimeId) {
      router.dismissTo(`/showtime/${showtimeId}`);
      if (lost.length > 0) {
        setTimeout(
          () => showToast(t('seats.lost', { seats: lost.join(', ') }), 'error', 5000),
          400,
        );
      }
    } else {
      router.dismiss();
    }
  };

  const lostLabels = (map: SeatMap | undefined, seatIds: string[]): string[] =>
    seatIds.flatMap((sid) => {
      const seat = map?.seats.find((x) => x.id === sid);
      return seat ? [seatLabel(seat)] : [];
    });

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    haptic.select();
    setMode(m);
    setValue('');
    setError(null);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View
        style={[styles.body, { paddingTop: space.xxl, paddingBottom: insets.bottom + space.lg }]}
      >
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            {step === 'contact' ? t('login.title') : t('login.codeTitle')}
          </Text>
          <Pressable
            style={styles.close}
            onPress={() => router.dismiss()}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
          >
            <Text style={styles.closeText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>

        {step === 'contact' ? (
          <Animated.View entering={FadeIn.duration(160)} style={styles.stack}>
            <View style={styles.segment} accessibilityRole="tablist">
              {(['phone', 'email'] as const).map((m) => (
                <Pressable
                  key={m}
                  feedback={false}
                  style={[styles.segItem, mode === m && styles.segOn]}
                  onPress={() => switchMode(m)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === m }}
                >
                  <Text style={[styles.segText, mode === m && styles.segTextOn]}>
                    {t(m === 'phone' ? 'login.phone' : 'login.email')}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>
                {t(mode === 'phone' ? 'login.phoneLabel' : 'login.emailLabel')}
              </Text>
              <View style={styles.inputRow}>
                {mode === 'phone' ? <Text style={styles.prefix}>+976</Text> : null}
                <TextInput
                  key={mode}
                  style={styles.input}
                  value={value}
                  onChangeText={(v) => {
                    setValue(mode === 'phone' ? localPhone(v) : v);
                    setError(null);
                  }}
                  autoFocus
                  autoCorrect={false}
                  autoCapitalize="none"
                  keyboardType={mode === 'phone' ? 'phone-pad' : 'email-address'}
                  textContentType={mode === 'phone' ? 'telephoneNumber' : 'emailAddress'}
                  autoComplete={mode === 'phone' ? 'tel' : 'email'}
                  placeholder={t(
                    mode === 'phone' ? 'login.phonePlaceholder' : 'login.emailPlaceholder',
                  )}
                  placeholderTextColor={colors.muted}
                  returnKeyType="next"
                  onSubmitEditing={send}
                  selectionColor={colors.action}
                />
              </View>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[styles.primary, (!normalized || busy) && styles.disabled]}
              disabled={!normalized || busy}
              onPress={send}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color={colors.onAction} />
              ) : (
                <Text style={styles.primaryText}>{t('login.next')}</Text>
              )}
            </Pressable>
          </Animated.View>
        ) : (
          <Animated.View entering={FadeIn.duration(160)}>
            <OtpEntry
              sentTo={target && mode === 'phone' ? prettyPhone(target) : (target ?? '')}
              onVerify={verify}
              onResend={() => requestOtp(channel, target ?? '')}
              onChange={() => {
                setStep('contact');
                setError(null);
              }}
            />
          </Animated.View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { flex: 1, paddingHorizontal: space.xl, gap: space.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...type.title, color: colors.ink },
  close: { paddingVertical: space.xs, paddingLeft: space.md },
  closeText: { ...type.bodyMedium, color: colors.body },
  stack: { gap: space.lg },
  segment: {
    borderCurve: 'continuous',
    flexDirection: 'row',
    backgroundColor: colors.raised,
    borderRadius: radius.card,
    padding: 4,
  },
  segItem: {
    flex: 1,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card - 4,
  },
  segOn: { backgroundColor: colors.fill },
  segText: { ...type.bodyMedium, color: colors.muted },
  segTextOn: { color: colors.ink },
  field: { gap: space.sm },
  fieldLabel: { ...type.caption, color: colors.muted },
  inputRow: {
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 54,
    paddingHorizontal: space.lg,
    borderRadius: radius.panel,
    backgroundColor: colors.raised,
  },
  prefix: { ...type.headline, color: colors.muted },
  input: { flex: 1, ...type.headline, fontFamily: fonts.medium, color: colors.ink, height: '100%' },
  error: { ...type.caption, color: colors.danger },
  primary: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    backgroundColor: colors.action,
  },
  primaryText: { ...type.headline, color: colors.onAction },
  disabled: { opacity: 0.4 },
});
