import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { IconTile } from './icon-tile';

type Props = {
  title: string;
  message: string;
  tile: Pick<React.ComponentProps<typeof IconTile>, 'sf' | 'phosphor' | 'hue'>;
  children?: ReactNode;
};

/** Dark canvas with a large title and one layered panel: placeholder chrome for tab roots. */
export function TabScreen({ title, message, tile, children }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.root}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingHorizontal: space.lg }}
    >
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.panel}>
        <View style={styles.card}>
          <IconTile {...tile} size={44} />
          <Text style={styles.message}>{message}</Text>
        </View>
      </View>
      {children}
    </ScrollView>
  );
}

const PANEL_PADDING = space.sm;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  title: { ...type.largeTitle, color: colors.ink, marginBottom: space.lg },
  // panel -> card: nested radius = outer - padding
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.panel,
    padding: PANEL_PADDING,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  card: {
    backgroundColor: colors.raised,
    borderRadius: radius.panel - PANEL_PADDING,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
    padding: space.xl,
    gap: space.lg,
  },
  message: { ...type.body, color: colors.body },
});
