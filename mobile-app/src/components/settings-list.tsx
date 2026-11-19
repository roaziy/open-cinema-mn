import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Children, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, hairlineWidth, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { Pressable } from './pressable';

export const ICON_STROKE = 1.75;

/** A titled group of rows on one rounded surface, hairline dividers between rows. */
export function SettingsSection({ title, children }: { title?: string; children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <View style={styles.section}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={styles.surface}>
        {rows.map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static children, order never changes
          <View key={i}>
            {i > 0 ? <View style={styles.divider} /> : null}
            {row}
          </View>
        ))}
      </View>
    </View>
  );
}

type RowProps = {
  icon: LucideIcon;
  label: string;
  value?: string;
  onPress?: () => void;
  /** Hide the trailing chevron (a row that acts in place). */
  noChevron?: boolean;
};

/** Icon, label, optional muted value, chevron. 54 pt tall. */
export function SettingsRow({ icon: Icon, label, value, onPress, noChevron }: RowProps) {
  const body = (
    <>
      <Icon size={20} color={colors.muted} strokeWidth={ICON_STROKE} />
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {value ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {onPress && !noChevron ? (
        <ChevronRight size={18} color={colors.muted} strokeWidth={ICON_STROKE} />
      ) : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  title: { ...type.footnote, color: colors.muted, marginLeft: space.xs },
  surface: { backgroundColor: colors.raised, borderRadius: radius.card, overflow: 'hidden' },
  divider: {
    height: hairlineWidth,
    backgroundColor: colors.hairline,
    marginLeft: space.lg + 20 + space.md,
  },
  row: {
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  label: { ...type.body, color: colors.ink, flex: 1 },
  value: { ...type.body, color: colors.muted, maxWidth: '50%', textAlign: 'right' },
});
