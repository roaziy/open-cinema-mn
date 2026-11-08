import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme/tokens';
import { type } from '@/theme/type';

/** Age rating chip; 18+ reads as a warning. */
export function AgeBadge({ rating }: { rating: string }) {
  const strict = rating.startsWith('18');
  return (
    <View style={[styles.badge, strict && styles.strict]}>
      <Text style={[styles.text, strict && styles.strictText]}>{rating}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 7,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.chipFill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
  },
  text: { ...type.footnote, color: colors.ink },
  strict: { backgroundColor: colors.dangerFill, borderColor: colors.dangerEdge },
  strictText: { color: colors.danger },
});
