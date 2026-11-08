import { router } from 'expo-router';
import { Envelope, Globe, Phone, SignOut, UserCircle } from 'phosphor-react-native';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmailEditor } from '@/components/email-editor';
import { IconTile } from '@/components/icon-tile';
import { Pressable } from '@/components/pressable';
import { type Locale, useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { confirmGuestLogin } from '@/lib/guest-login';
import { colors, hues, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

export default function ProfileScreen() {
  const { t, locale, setLocale } = useI18n();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [checkingLogin, setCheckingLogin] = useState(false);
  const signedIn = !!user && user.role !== 'guest';
  const top = process.env.EXPO_OS === 'ios' ? 0 : insets.top;

  const askLogout = () => {
    Alert.alert(t('profile.logoutConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.logout'),
        style: 'destructive',
        onPress: async () => {
          setLoggingOut(true);
          try {
            await logout();
          } finally {
            setLoggingOut(false);
          }
        },
      },
    ]);
  };

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
            style={[styles.primary, checkingLogin && styles.disabled]}
            disabled={checkingLogin}
            onPress={async () => {
              if (checkingLogin) return;
              setCheckingLogin(true);
              try {
                if (await confirmGuestLogin(t)) router.push('/login');
              } finally {
                setCheckingLogin(false);
              }
            }}
            accessibilityRole="button"
            accessibilityState={{ busy: checkingLogin, disabled: checkingLogin }}
          >
            {checkingLogin ? (
              <ActivityIndicator color={colors.onAction} />
            ) : (
              <Text style={styles.primaryText}>{t('login.title')}</Text>
            )}
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
        <Pressable
          style={[styles.logout, loggingOut && styles.disabled]}
          disabled={loggingOut}
          onPress={askLogout}
          accessibilityRole="button"
          accessibilityState={{ busy: loggingOut, disabled: loggingOut }}
        >
          {loggingOut ? (
            <ActivityIndicator color={colors.danger} />
          ) : (
            <>
              <SignOut size={18} weight="bold" color={colors.danger} />
              <Text style={styles.logoutText}>{t('profile.logout')}</Text>
            </>
          )}
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
  primary: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.inner + 2,
    backgroundColor: colors.action,
  },
  primaryText: { ...type.headline, color: colors.onAction },
  disabled: { opacity: 0.4 },
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
