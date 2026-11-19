import { router } from 'expo-router';
import { Mail } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmailEditor } from '@/components/email-editor';
import { Pressable } from '@/components/pressable';
import { useI18n } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { needsEmail } from '@/lib/member';
import { colors, space } from '@/theme/tokens';
import { type } from '@/theme/type';

/** Full-screen, no swipe and no close: verify an email or sign out. */
export default function EmailRequiredScreen() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [leaving, setLeaving] = useState(false);
  const missing = needsEmail(user);

  // Verified (or signed out): the way back is open.
  useEffect(() => {
    if (!missing && router.canDismiss()) router.dismiss();
  }, [missing]);

  // Android back must not close it either.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const signOut = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await logout();
    } finally {
      setLeaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingTop: insets.top + space.xxxl, paddingBottom: insets.bottom + space.lg },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Mail size={40} color={colors.muted} strokeWidth={1.5} />
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">
            {t('emailRequired.title')}
          </Text>
          <Text style={styles.text}>{t('emailRequired.body')}</Text>
        </View>
        <EmailEditor hasEmail={!!user?.email} defaultOpen />
        <Pressable
          style={styles.signOut}
          disabled={leaving}
          onPress={signOut}
          accessibilityRole="button"
          accessibilityState={{ busy: leaving, disabled: leaving }}
        >
          {leaving ? (
            <ActivityIndicator color={colors.muted} />
          ) : (
            <Text style={styles.signOutText}>{t('profile.logout')}</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  body: { paddingHorizontal: space.xl, gap: space.xl },
  head: { gap: space.sm },
  title: { ...type.title, color: colors.ink },
  text: { ...type.body, color: colors.muted },
  signOut: { alignItems: 'center', paddingVertical: space.md },
  signOutText: { ...type.bodyMedium, color: colors.muted },
});
