import { router } from 'expo-router';
import { CaretDown } from 'phosphor-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { useI18n } from '@/i18n';
import { useBranchId } from '@/lib/branch';
import { useBranches } from '@/lib/catalog';
import { colors, hueFor, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { Pressable } from './pressable';

/** Pill showing the preferred branch with its identity-hue dot; opens the branch sheet. */
export function BranchChip() {
  const { t } = useI18n();
  const id = useBranchId();
  const { data } = useBranches();
  const branch = data?.find((b) => b.id === id);
  return (
    <Pressable
      style={styles.chip}
      onPress={() => router.push('/branches')}
      accessibilityRole="button"
      accessibilityLabel={`${t('branch.title')}: ${branch ? branch.name : t('branch.all')}`}
    >
      <View style={[styles.dot, { backgroundColor: branch ? hueFor(branch.id) : colors.muted }]} />
      <Text style={styles.label} numberOfLines={1}>
        {branch ? branch.name : t('branch.all')}
      </Text>
      <CaretDown size={12} color={colors.body} weight="bold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    maxWidth: 190,
    paddingHorizontal: space.md,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.scrim,
    borderWidth: 1,
    borderColor: colors.scrimBorder,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { ...type.footnote, color: colors.ink, flexShrink: 1 },
});
