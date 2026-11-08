import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useI18n } from '@/i18n';
import { colors, space } from '@/theme/tokens';
import { type } from '@/theme/type';

/** Placeholder until the seat map lands. */
export default function ShowtimeScreen() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
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
      <Text style={styles.text}>{t('showtime.placeholder')}</Text>
      <Text style={styles.id}>{id}</Text>
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
