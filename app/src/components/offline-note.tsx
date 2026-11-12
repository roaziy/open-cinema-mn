import { StyleSheet, Text } from 'react-native';
import { useI18n } from '@/i18n';
import { formatUbTime } from '@/shared';
import { colors, space } from '@/theme/tokens';
import { type } from '@/theme/type';

/** Quiet line shown when a ticket comes from the stored copy because there is no connection. */
export function OfflineNote({ since }: { since: string | null }) {
  const { t } = useI18n();
  if (!since) return null;
  return (
    <Text style={styles.note} accessibilityRole="text">
      {t('tickets.offline', { time: formatUbTime(since) })}
    </Text>
  );
}

const styles = StyleSheet.create({
  note: { ...type.caption, color: colors.muted, textAlign: 'center', paddingVertical: space.sm },
});
