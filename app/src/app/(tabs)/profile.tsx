import { normalizeEmail } from '@open-cinema/shared';
import { router } from 'expo-router';
import { Envelope, Globe, Phone, SignOut, UserCircle } from 'phosphor-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconTile } from '@/components/icon-tile';
import { Pressable } from '@/components/pressable';
import { type Locale, type TKey, useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { requestEmailCode, verifyEmailCode } from '@/lib/profile';
import { showToast } from '@/lib/toast';
import { colors, hues, radius, space } from '@/theme/tokens';
import { fonts, type } from '@/theme/type';

function errorKey(e: unknown): TKey {
  if (e instanceof ApiError) {
    if (e.code === 'email_taken') return 'profile.err.email_taken';
    if (e.code === 'invalid_target') return 'profile.err.invalid_target';
    if (e.code === 'invalid_code') return 'profile.err.invalid_code';
    if (e.code === 'too_many_attempts') return 'profile.err.too_many_attempts';
  }
  return 'profile.err.generic';
}

export default function ProfileScreen() {
  const { t, locale, setLocale } = useI18n();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const signedIn = !!user && user.role !== 'guest';
  const top = process.env.EXPO_OS === 'ios' ? 0 : insets.top;

  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[styles.content, { paddingTop: top + space.lg }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title} accessibilityRole="header">
        {t('profile.title')}
      </Text>

      {signedIn ? (
        <>
          <Text style={styles.group}>{t('profile.account')}</Text>
          <View style={styles.card}>
            {user.phone ? (
              <InfoRow
                tile={<IconTile sf="phone.fill" phosphor={Phone} hue={hues.green} size={30} />}
                label={t('profile.phone')}
                value={user.phone}
              />
            ) : null}
            <InfoRow
              tile={<IconTile sf="envelope.fill" phosphor={Envelope} hue={hues.teal} size={30} />}
              label={t('profile.email')}
              value={user.email ?? '—'}
              note={user.email && user.emailVerified ? t('profile.verified') : undefined}
            />
            <EmailEditor hasEmail={!!user.email} />
          </View>
        </>
      ) : (
        <View style={styles.card}>
          <View style={styles.guest}>
            <IconTile
              sf="person.crop.circle.fill"
              phosphor={UserCircle}
              hue={hues.purple}
              size={44}
            />
            <View style={styles.guestText}>
              <Text style={styles.rowValue}>{t('profile.guestTitle')}</Text>
              <Text style={styles.rowLabel}>{t('profile.guestHint')}</Text>
            </View>
          </View>
          <Pressable
            style={styles.primary}
            onPress={() => router.push('/login')}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>{t('login.title')}</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.card}>
        <View style={styles.langHead}>
          <IconTile sf="globe" phosphor={Globe} hue={hues.indigo} size={30} />
          <Text style={styles.rowValue}>{t('profile.language')}</Text>
        </View>
        <View style={styles.segments} accessibilityRole="radiogroup">
          {(['mn', 'en'] as const satisfies readonly Locale[]).map((l) => (
            <Pressable
              key={l}
              style={[styles.segment, locale === l && styles.segmentOn]}
              onPress={() => setLocale(l)}
              accessibilityRole="radio"
              accessibilityState={{ selected: locale === l }}
            >
              <Text style={[styles.segmentText, locale === l && styles.segmentTextOn]}>
                {t(l === 'mn' ? 'lang.mn' : 'lang.en')}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {signedIn ? (
        <Pressable style={styles.logout} onPress={() => logout()} accessibilityRole="button">
          <SignOut size={18} weight="bold" color={colors.danger} />
          <Text style={styles.logoutText}>{t('profile.logout')}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function InfoRow({
  tile,
  label,
  value,
  note,
}: {
  tile: React.ReactNode;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <View style={styles.infoRow}>
      {tile}
      <View style={styles.guestText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

/** Add or change the email: type it, get a 6-digit code (backend log in dev), type that. */
function EmailEditor({ hasEmail }: { hasEmail: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const normalized = normalizeEmail(email);

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
      setCode('');
    } catch (e) {
      haptic.error();
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (digits: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyEmailCode(digits);
      haptic.success();
      showToast(t('profile.emailSaved'));
      setOpen(false);
      setStep('email');
      setEmail('');
    } catch (e) {
      haptic.error();
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.editor}>
      {step === 'email' ? (
        <>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setError(null);
            }}
            placeholder={t('profile.emailPlaceholder')}
            placeholderTextColor={colors.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={send}
            selectionColor={colors.action}
          />
          <Pressable
            style={[styles.primary, (!normalized || busy) && styles.disabled]}
            disabled={!normalized || busy}
            onPress={send}
            accessibilityRole="button"
            accessibilityState={{ disabled: !normalized || busy }}
          >
            <Text style={styles.primaryText}>{t('profile.sendCode')}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.rowLabel}>
            {t('profile.codeSent', { email: normalized ?? email })}
          </Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={code}
            onChangeText={(v) => {
              const digits = v.replace(/\D/g, '').slice(0, 6);
              setCode(digits);
              setError(null);
              if (digits.length === 6) verify(digits);
            }}
            placeholder={t('profile.code')}
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            maxLength={6}
            autoFocus
            selectionColor={colors.action}
          />
          <Pressable
            style={[styles.primary, (code.length !== 6 || busy) && styles.disabled]}
            disabled={code.length !== 6 || busy}
            onPress={() => verify(code)}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>{t('profile.verify')}</Text>
          </Pressable>
        </>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxxl, gap: space.md },
  title: { ...type.largeTitle, color: colors.ink, marginBottom: space.xs },
  group: { ...type.footnote, color: colors.muted, marginTop: space.sm, marginLeft: space.xs },
  card: {
    padding: space.lg,
    gap: space.lg,
    borderRadius: radius.card,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
  },
  guest: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  guestText: { flex: 1, gap: 1 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowLabel: { ...type.caption, color: colors.muted },
  rowValue: { ...type.bodyMedium, color: colors.ink },
  note: { ...type.footnote, color: colors.success },
  linkRow: { paddingVertical: space.xs },
  link: { ...type.bodyMedium, color: colors.action },
  editor: { gap: space.md },
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
  codeInput: { letterSpacing: 6, fontVariant: ['tabular-nums'] },
  primary: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.inner + 2,
    backgroundColor: colors.action,
  },
  primaryText: { ...type.headline, color: colors.onAction },
  disabled: { opacity: 0.4 },
  error: { ...type.caption, color: colors.danger },
  langHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  segments: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: radius.inner + 2,
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  segment: {
    flex: 1,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.inner - 1,
  },
  segmentOn: { backgroundColor: colors.fill },
  segmentText: { ...type.bodyMedium, color: colors.muted },
  segmentTextOn: { color: colors.ink },
  logout: {
    marginTop: space.md,
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.card,
    backgroundColor: colors.dangerFill,
    borderWidth: 1,
    borderColor: colors.dangerEdge,
  },
  logoutText: { ...type.headline, color: colors.danger },
});
