import { CloudSlash, FilmSlate } from 'phosphor-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';
import { colors, hues, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { IconTile } from './icon-tile';
import { Pressable } from './pressable';

type EmptyProps = { title: string; hint?: string };

export function EmptyState({ title, hint }: EmptyProps) {
  return (
    <View style={styles.wrap}>
      <IconTile sf="film.fill" phosphor={FilmSlate} hue={hues.indigo} size={44} />
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  const offline = error instanceof ApiError && error.status === 0;
  return (
    <View style={styles.wrap}>
      <IconTile sf="wifi.slash" phosphor={CloudSlash} hue={hues.red} size={44} />
      <Text style={styles.hint}>{offline ? t('error.network') : t('error.generic')}</Text>
      <Pressable style={styles.retry} onPress={onRetry} accessibilityRole="button">
        <Text style={styles.retryText}>{t('common.retry')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.xxxl,
    paddingHorizontal: space.xl,
  },
  title: { ...type.headline, color: colors.ink, textAlign: 'center' },
  hint: { ...type.body, color: colors.muted, textAlign: 'center' },
  retry: {
    backgroundColor: colors.fill,
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  retryText: { ...type.bodyMedium, color: colors.ink },
});
