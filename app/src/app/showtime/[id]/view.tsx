import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useI18n } from '@/i18n';
import { colors, space } from '@/theme/tokens';
import { type } from '@/theme/type';

/** Placeholder until the 3D view from a seat lands. */
export default function SeatViewScreen() {
  const { t } = useI18n();
  const { seat } = useLocalSearchParams<{ id: string; seat?: string }>();
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
      <Text style={styles.text}>{t('seats.viewPlaceholder')}</Text>
      <Text style={styles.id}>{seat}</Text>
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
