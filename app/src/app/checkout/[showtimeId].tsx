import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useI18n } from '@/i18n';
import { getContactEmail } from '@/lib/checkout-store';
import { colors, space } from '@/theme/tokens';
import { type } from '@/theme/type';

/** Placeholder until checkout lands. */
export default function CheckoutScreen() {
  const { t } = useI18n();
  const { showtimeId } = useLocalSearchParams<{ showtimeId: string }>();
  const email = getContactEmail(showtimeId);
  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '',
          headerTransparent: true,
          headerTintColor: colors.ink,
        }}
      />
      <Text style={styles.text}>{t('checkout.placeholder')}</Text>
      {email ? (
        <Text style={styles.id}>
          {t('checkout.contact')}: {email}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  text: { ...type.body, color: colors.body },
  id: { ...type.caption, color: colors.muted },
});
