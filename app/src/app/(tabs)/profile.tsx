import { router } from 'expo-router';
import { UserCircle } from 'phosphor-react-native';
import { StyleSheet, Text } from 'react-native';
import { Pressable } from '@/components/pressable';
import { TabScreen } from '@/components/tab-screen';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { colors, hues, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

export default function ProfileScreen() {
  const { t } = useI18n();
  const { user, logout } = useAuth();
  const signedIn = !!user && user.role !== 'guest';
  return (
    <TabScreen
      title={t('profile.title')}
      message={signedIn ? (user.phone ?? user.email ?? t('profile.empty')) : t('profile.empty')}
      tile={{ sf: 'person.crop.circle.fill', phosphor: UserCircle, hue: hues.purple }}
    >
      <Pressable
        style={[styles.button, !signedIn && styles.primary]}
        onPress={() => (signedIn ? logout() : router.push('/login'))}
        accessibilityRole="button"
      >
        <Text style={styles.text}>{t(signedIn ? 'profile.logout' : 'login.title')}</Text>
      </Pressable>
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  button: {
    marginTop: space.lg,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.card,
    backgroundColor: colors.fill,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  primary: { backgroundColor: colors.action, borderColor: colors.action },
  text: { ...type.headline, color: colors.ink },
});
