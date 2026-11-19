import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { type TKey, useI18n } from '@/i18n';
import { colors, space } from '@/theme/tokens';
import { type } from '@/theme/type';

/** Plain scrollable text: a list of [heading, paragraph] translation keys. */
export function LegalPage({ sections }: { sections: readonly (readonly [TKey, TKey])[] }) {
  const { t } = useI18n();
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      {sections.map(([h, p]) => (
        <View key={h} style={styles.section}>
          <Text style={styles.heading} accessibilityRole="header">
            {t(h)}
          </Text>
          <Text style={styles.paragraph}>{t(p)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxxl },
  section: { gap: space.sm },
  heading: { ...type.headline, color: colors.ink },
  paragraph: { ...type.body, color: colors.body, lineHeight: 23 },
});
