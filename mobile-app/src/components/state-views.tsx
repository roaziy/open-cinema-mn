import { Film, type LucideIcon, WifiOff } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { useI18n } from '@/i18n';
import { ApiError } from '@/lib/api';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { Pressable } from './pressable';

type EmptyProps = { title: string; hint?: string; icon?: LucideIcon };

export function EmptyState({ title, hint, icon: Icon = Film }: EmptyProps) {
  return (
    <View style={styles.wrap}>
      <Icon size={40} color={colors.muted} strokeWidth={1.5} />
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** The copy says what failed (offline or not); the icon is the same quiet grey either way. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useI18n();
  const offline = error instanceof ApiError && error.status === 0;
  return (
    <View style={styles.wrap}>
      <WifiOff size={40} color={colors.muted} strokeWidth={1.5} />
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
    borderCurve: 'continuous',
    backgroundColor: colors.fill,
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  retryText: { ...type.bodyMedium, color: colors.ink },
});
