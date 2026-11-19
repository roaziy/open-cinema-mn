import { Camera, Globe, Mail, Phone } from 'lucide-react-native';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SettingsRow, SettingsSection } from '@/components/settings-list';
import { EmptyState } from '@/components/state-views';
import { useI18n } from '@/i18n';
import { contactItems } from '@/lib/contact';
import { showToast } from '@/lib/toast';
import { colors, space } from '@/theme/tokens';

// Expo inlines each EXPO_PUBLIC_ variable only when it is read by its full name.
const icons = { phone: Phone, email: Mail, facebook: Globe, instagram: Camera } as const;

const items = contactItems({
  EXPO_PUBLIC_CONTACT_PHONE: process.env.EXPO_PUBLIC_CONTACT_PHONE,
  EXPO_PUBLIC_CONTACT_EMAIL: process.env.EXPO_PUBLIC_CONTACT_EMAIL,
  EXPO_PUBLIC_CONTACT_FACEBOOK: process.env.EXPO_PUBLIC_CONTACT_FACEBOOK,
  EXPO_PUBLIC_CONTACT_INSTAGRAM: process.env.EXPO_PUBLIC_CONTACT_INSTAGRAM,
});

export default function ContactScreen() {
  const { t } = useI18n();
  const open = (url: string) => {
    Linking.openURL(url).catch(() => showToast(t('error.generic'), 'error'));
  };
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      {items.length === 0 ? (
        <View>
          <EmptyState title={t('contact.empty')} />
        </View>
      ) : (
        <SettingsSection>
          {items.map((i) => (
            <SettingsRow
              key={i.key}
              icon={icons[i.key]}
              label={t(i.label)}
              value={i.value}
              onPress={() => open(i.url)}
            />
          ))}
        </SettingsSection>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, paddingBottom: space.xxxl },
});
