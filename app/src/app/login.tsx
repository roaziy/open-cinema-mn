import { normalizeEmail, normalizePhone, type OtpChannel, type SeatMap } from '@open-cinema/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { type ComponentRef, useCallback, useEffect, useRef, useState } from 'react';
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
import { Pressable } from '@/components/pressable';
import { type TKey, useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';
import { requestOtp } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { loginKeepingHolds } from '@/lib/login-flow';
import { seatKeys, seatLabel } from '@/lib/seats';
import { showToast } from '@/lib/toast';
import { colors, radius, space } from '@/theme/tokens';
import { fonts, type } from '@/theme/type';

const RESEND_S = 60;
const CODE_LEN = 6;
const CODE_SLOTS = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'] as const;

type Mode = 'phone' | 'email';

/** "+97699112233" -> "+976 9911 2233" */
function prettyPhone(e164: string): string {
  return `+976 ${e164.slice(4, 8)} ${e164.slice(8)}`;
}

function errorKey(e: unknown): { key: TKey; params?: Record<string, number> } {
  if (e instanceof ApiError) {
    if (e.code === 'invalid_code') {
      const left = e.body?.attemptsLeft;
      return typeof left === 'number'
        ? { key: 'login.err.invalid_code_left', params: { n: left } }
        : { key: 'login.err.invalid_code' };
    }
    if (e.status === 410) return { key: 'login.err.expired' };
    if (e.status === 0) return { key: 'error.network' };
    const key = `login.err.${e.code}` as TKey;
    if (e.code in ERR_CODES) return { key };
  }
  return { key: 'login.err.generic' };
}

const ERR_CODES: Record<string, true> = {
  too_many_attempts: true,
  resend_too_soon: true,
  too_many_requests: true,
  sms_failed: true,
  email_failed: true,
};

export default function LoginScreen() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { showtimeId, next } = useLocalSearchParams<{ showtimeId?: string; next?: string }>();

  const [mode, setMode] = useState<Mode>('phone');
  const [value, setValue] = useState('');
  const [step, setStep] = useState<'contact' | 'code'>('contact');
  const [target, setTarget] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendLeft, setResendLeft] = useState(0);
  const codeRef = useRef<ComponentRef<typeof TextInput>>(null);

  const channel: OtpChannel = mode === 'phone' ? 'sms' : 'email';
  const normalized = mode === 'phone' ? normalizePhone(value) : normalizeEmail(value);

  useEffect(() => {
    if (resendLeft <= 0) return;
    const timer = setTimeout(() => setResendLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendLeft]);

  const fail = useCallback(
    (e: unknown) => {
      const { key, params } = errorKey(e);
      setError(t(key, params));
      haptic.error();
    },
    [t],
  );

  const send = async () => {
    if (!normalized || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestOtp(channel, normalized);
      setTarget(normalized);
      setStep('code');
      setCode('');
      setResendLeft(RESEND_S);
      setTimeout(() => codeRef.current?.focus(), 250);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!target || busy || resendLeft > 0) return;
    setBusy(true);
    setError(null);
    try {
      await requestOtp(channel, target);
      setCode('');
      setResendLeft(RESEND_S);
      codeRef.current?.focus();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (digits: string) => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { lostSeatIds } = await loginKeepingHolds(channel, target, digits, showtimeId);
      haptic.success();
      const lost = lostLabels(showtimeId, lostSeatIds);
      if (showtimeId && next === 'checkout' && lost.length === 0) {
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
    } catch (e) {
      setCode('');
      fail(e);
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const lostLabels = (id: string | undefined, seatIds: string[]): string[] => {
    if (!id || seatIds.length === 0) return [];
    const map = qc.getQueryData<SeatMap>(seatKeys.map(id));
    return seatIds.flatMap((sid) => {
      const seat = map?.seats.find((s) => s.id === sid);
      return seat ? [seatLabel(seat)] : [];
    });
  };

  const onCodeChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, CODE_LEN);
    setCode(digits);
    setError(null);
    if (digits.length === CODE_LEN) verify(digits);
  };

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
                    setValue(v);
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
          <Animated.View entering={FadeIn.duration(160)} style={styles.stack}>
            <Text style={styles.sub}>
              {t('login.codeSent', {
                target: target && mode === 'phone' ? prettyPhone(target) : (target ?? ''),
              })}
            </Text>

            <View style={styles.boxes}>
              {CODE_SLOTS.map((slot, i) => {
                const active = i === Math.min(code.length, CODE_LEN - 1) && !busy;
                return (
                  <View
                    key={slot}
                    style={[styles.box, active && styles.boxActive, error ? styles.boxError : null]}
                  >
                    <Text style={styles.boxText}>{code[i] ?? ''}</Text>
                  </View>
                );
              })}
              {/* One real field behind the boxes: typing, paste and the iOS "From Messages" suggestion all land here. */}
              <TextInput
                ref={codeRef}
                style={styles.hidden}
                value={code}
                onChangeText={onCodeChange}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={CODE_LEN}
                caretHidden
                editable={!busy}
                accessibilityLabel={t('login.codeTitle')}
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {busy ? (
              <View style={styles.checking}>
                <ActivityIndicator color={colors.muted} />
                <Text style={styles.checkingText}>{t('login.verifying')}</Text>
              </View>
            ) : null}

            <View style={styles.links}>
              <Pressable
                onPress={resend}
                disabled={resendLeft > 0 || busy}
                accessibilityRole="button"
              >
                <Text style={[styles.link, resendLeft > 0 && styles.linkOff]}>
                  {resendLeft > 0 ? t('login.resendIn', { s: resendLeft }) : t('login.resend')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setStep('contact');
                  setError(null);
                  setCode('');
                }}
                accessibilityRole="button"
              >
                <Text style={styles.link}>{t('login.change')}</Text>
              </Pressable>
            </View>
          </Animated.View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const BOX = 48;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { flex: 1, paddingHorizontal: space.xl, gap: space.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...type.title, color: colors.ink },
  close: { paddingVertical: space.xs, paddingLeft: space.md },
  closeText: { ...type.bodyMedium, color: colors.body },
  stack: { gap: space.lg },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.raised,
    borderRadius: radius.card,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.hairline,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 54,
    paddingHorizontal: space.lg,
    borderRadius: radius.card,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
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
  sub: { ...type.body, color: colors.body },
  boxes: { flexDirection: 'row', justifyContent: 'space-between' },
  box: {
    width: BOX,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  boxActive: { borderColor: colors.action, borderWidth: 1.5 },
  boxError: { borderColor: colors.dangerEdge },
  boxText: { ...type.title, color: colors.ink, fontVariant: ['tabular-nums'] },
  hidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.02,
    color: 'transparent',
  },
  checking: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  checkingText: { ...type.caption, color: colors.muted },
  links: { flexDirection: 'row', justifyContent: 'space-between' },
  link: { ...type.bodyMedium, color: colors.ink },
  linkOff: { color: colors.muted },
});
