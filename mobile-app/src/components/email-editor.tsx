import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type TKey, useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { otpErrorKey } from '@/lib/otp-errors';
import { requestEmailCode, verifyEmailCode } from '@/lib/profile';
import { showToast } from '@/lib/toast';
import { normalizeEmail } from '@/shared';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { Field } from './field';
import { OtpEntry } from './otp-entry';
import { Pressable } from './pressable';

/** Errors specific to linking an email; everything else is the shared OTP mapping. */
const mapEmailError = (e: unknown): TKey | null =>
  e instanceof ApiError && e.code === 'email_taken' ? 'profile.err.email_taken' : null;

/** Add or change the email: type it, get a 6-digit code (backend log in dev), type that. */
export function EmailEditor({
  hasEmail,
  defaultOpen = false,
}: {
  hasEmail: boolean;
  /** Start in the entry form and never collapse (the required-email screen). */
  defaultOpen?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const normalized = normalizeEmail(email);

  const close = () => {
    setOpen(defaultOpen);
    setStep('email');
    setEmail('');
    setError(null);
  };

  if (!open) {
    return (
      <Pressable style={styles.linkRow} onPress={() => setOpen(true)} accessibilityRole="button">
        <Text style={styles.link}>{t(hasEmail ? 'profile.emailChange' : 'profile.emailAdd')}</Text>
      </Pressable>
    );
  }

  const send = async () => {
    if (!normalized || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestEmailCode(normalized);
      setStep('code');
    } catch (e) {
      haptic.error();
      setError(t(mapEmailError(e) ?? otpErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.editor}>
      {step === 'email' ? (
        <>
          <Field
            onCanvas
            error={error !== null}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setError(null);
            }}
            placeholder={t('profile.emailPlaceholder')}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={send}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            style={[styles.primary, (!normalized || busy) && styles.disabled]}
            disabled={!normalized || busy}
            onPress={send}
            accessibilityRole="button"
            accessibilityState={{ disabled: !normalized || busy }}
          >
            <Text style={styles.primaryText}>{t('profile.sendCode')}</Text>
          </Pressable>
          {defaultOpen ? null : (
            <Pressable onPress={close} accessibilityRole="button">
              <Text style={styles.cancel}>{t('common.cancel')}</Text>
            </Pressable>
          )}
        </>
      ) : (
        <OtpEntry
          sentTo={normalized ?? email}
          mapError={mapEmailError}
          onVerify={async (code) => {
            await verifyEmailCode(code);
            haptic.success();
            showToast(t('profile.emailSaved'));
            close();
          }}
          onResend={() => requestEmailCode(normalized ?? email)}
          onChange={() => setStep('email')}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  linkRow: { paddingVertical: space.xs },
  link: { ...type.bodyMedium, color: colors.action },
  editor: { gap: space.md },
  primary: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.inner + 2,
    backgroundColor: colors.action,
  },
  primaryText: { ...type.headline, color: colors.onAction },
  cancel: {
    ...type.bodyMedium,
    color: colors.body,
    textAlign: 'center',
    paddingVertical: space.xs,
  },
  disabled: { opacity: 0.4 },
  error: { ...type.caption, color: colors.danger },
});
