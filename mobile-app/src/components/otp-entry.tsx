import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { otpErrorKey } from '@/lib/otp-errors';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { Pressable } from './pressable';

const RESEND_S = 60;
const CODE_LEN = 6;
const CODE_SLOTS = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'] as const;
const BOX = 48;

type Props = {
  /** Shown in "code sent to ...". */
  sentTo: string;
  /** Check the code; throw to show the error and clear the boxes. Success is the parent's to act on. */
  onVerify: (code: string) => Promise<void>;
  /** Send a new code; throw to show the error. */
  onResend: () => Promise<void>;
  /** The "change" link (back to the contact step). */
  onChange: () => void;
  /** Own mapping tried first (e.g. email_taken); falls back to the shared auth errors. */
  mapError?: (e: unknown) => import('@/i18n').TKey | null;
};

/**
 * The 6-box code step used by sign-in and by adding an email: one hidden real field behind the
 * boxes (typing, paste and the iOS "From Messages" suggestion all land there), the 60 s resend
 * timer, and the shared error messages. A code was just sent when this mounts, so the timer
 * starts running at once.
 */
export function OtpEntry({ sentTo, onVerify, onResend, onChange, mapError }: Props) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendLeft, setResendLeft] = useState(RESEND_S);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    if (resendLeft <= 0) return;
    const timer = setTimeout(() => setResendLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendLeft]);

  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(id);
  }, []);

  const fail = (e: unknown) => {
    haptic.error();
    setError(t(mapError?.(e) ?? otpErrorKey(e)));
  };

  const verify = async (digits: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onVerify(digits);
    } catch (e) {
      setCode('');
      fail(e);
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (busy || resendLeft > 0) return;
    setBusy(true);
    setError(null);
    try {
      await onResend();
      setCode('');
      setResendLeft(RESEND_S);
      inputRef.current?.focus();
    } catch (e) {
      fail(e);
      // Only when the server says "too soon" is the full wait the honest answer; any other
      // failure (network, send error) must not lock the user out for another minute.
      if (e instanceof ApiError && e.code === 'resend_too_soon') setResendLeft(RESEND_S);
    } finally {
      setBusy(false);
    }
  };

  const onCodeChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, CODE_LEN);
    setCode(digits);
    setError(null);
    if (digits.length === CODE_LEN) verify(digits);
  };

  return (
    <View style={styles.stack}>
      <Text style={styles.sub}>{t('login.codeSent', { target: sentTo })}</Text>

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
        <TextInput
          ref={inputRef}
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
        <Pressable onPress={resend} disabled={resendLeft > 0 || busy} accessibilityRole="button">
          <Text style={[styles.link, resendLeft > 0 && styles.linkOff]}>
            {resendLeft > 0 ? t('login.resendIn', { s: resendLeft }) : t('login.resend')}
          </Text>
        </Pressable>
        <Pressable onPress={onChange} accessibilityRole="button">
          <Text style={styles.link}>{t('login.change')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  sub: { ...type.body, color: colors.body },
  boxes: { flexDirection: 'row', justifyContent: 'space-between' },
  box: {
    borderCurve: 'continuous',
    width: BOX,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    backgroundColor: colors.raised,
  },
  boxActive: { borderColor: colors.action, borderWidth: 1.5 },
  boxError: { borderColor: colors.dangerEdge, borderWidth: 1.5 },
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
  error: { ...type.caption, color: colors.danger },
  checking: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  checkingText: { ...type.caption, color: colors.muted },
  links: { flexDirection: 'row', justifyContent: 'space-between' },
  link: { ...type.bodyMedium, color: colors.ink },
  linkOff: { color: colors.muted },
});
