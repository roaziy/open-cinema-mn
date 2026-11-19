import { router } from 'expo-router';
import {
  Building2,
  CircleUserRound,
  Coins,
  FileText,
  Globe,
  Headset,
  Shield,
  UserRound,
} from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MemberCard } from '@/components/member-card';
import { Pressable } from '@/components/pressable';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { confirmGuestLogin } from '@/lib/guest-login';
import { useMyPoints } from '@/lib/loyalty';
import { formatPoints } from '@/lib/member';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

export default function ProfileScreen() {
  const { t, locale, setLocale } = useI18n();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const points = useMyPoints();
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
        <MemberCard
          name={user.name ?? user.phone ?? t('profile.member')}
          phone={user.name ? user.phone : null}
          memberNo={points.data?.memberNo ?? user.memberNo}
          points={points.data?.balance ?? null}
          onPress={() => router.push('/points')}
        />
      ) : (
        <View style={styles.guest}>
          <View style={styles.guestHead}>
            <CircleUserRound size={40} color={colors.muted} strokeWidth={1.5} />
            <View style={styles.guestText}>
              <Text style={styles.guestTitle}>{t('profile.guestTitle')}</Text>
              <Text style={styles.guestHint}>{t('profile.guestHint')}</Text>
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

      {signedIn ? (
        <SettingsSection title={t('profile.account')}>
          <SettingsRow
            icon={UserRound}
            label={t('profile.personal')}
            onPress={() => router.push('/account')}
          />
          <SettingsRow
            icon={Coins}
            label={t('profile.pointsRow')}
            value={points.data ? formatPoints(points.data.balance) : undefined}
            onPress={() => router.push('/points')}
          />
        </SettingsSection>
      ) : null}

      <SettingsSection title={t('profile.cinema')}>
        <SettingsRow
          icon={Building2}
          label={t('profile.branches')}
          onPress={() => router.push('/branches')}
        />
        <SettingsRow
          icon={Globe}
          label={t('profile.language')}
          value={t(locale === 'mn' ? 'lang.mn' : 'lang.en')}
          onPress={() => setLocale(locale === 'mn' ? 'en' : 'mn')}
          noChevron
        />
      </SettingsSection>

      <SettingsSection title={t('profile.help')}>
        <SettingsRow
          icon={Headset}
          label={t('profile.contact')}
          onPress={() => router.push('/contact')}
        />
        <SettingsRow
          icon={FileText}
          label={t('profile.terms')}
          onPress={() => router.push('/terms')}
        />
        <SettingsRow
          icon={Shield}
          label={t('profile.privacy')}
          onPress={() => router.push('/privacy')}
        />
      </SettingsSection>

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
            <Text style={styles.logoutText}>{t('profile.logout')}</Text>
          )}
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xxxl, gap: space.xl },
  title: { ...type.largeTitle, color: colors.ink },
  guest: {
    gap: space.lg,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: colors.raised,
  },
  guestHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  guestText: { flex: 1, gap: 2 },
  guestTitle: { ...type.headline, color: colors.ink },
  guestHint: { ...type.caption, color: colors.muted },
  primary: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.inner + 2,
    backgroundColor: colors.action,
  },
  primaryText: { ...type.headline, color: colors.onAction },
  disabled: { opacity: 0.4 },
  logout: { alignItems: 'center', justifyContent: 'center', height: 48 },
  logoutText: { ...type.bodyMedium, color: colors.danger },
});
