import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { Icon as PhosphorIcon } from 'phosphor-react-native';
import { StyleSheet, View } from 'react-native';
import { radius } from '@/theme/tokens';

type Props = {
  /** SF Symbol (iOS), use a `.fill` variant. */
  sf: SymbolViewProps['name'];
  /** Phosphor glyph (Android), rendered with weight "fill". */
  phosphor: PhosphorIcon;
  /** Identity hue the tile is filled with. */
  hue: string;
  size?: number;
};

/** iOS Settings style filled tile: rounded square in an identity hue with a white filled glyph. */
export function IconTile({ sf, phosphor: Glyph, hue, size = 30 }: Props) {
  const glyph = Math.round(size * 0.58);
  return (
    <View style={[styles.tile, { width: size, height: size, backgroundColor: hue }]}>
      {process.env.EXPO_OS === 'ios' ? (
        <SymbolView name={sf} size={glyph} tintColor="#FFFFFF" />
      ) : (
        <Glyph size={glyph} color="#FFFFFF" weight="fill" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: radius.tile, alignItems: 'center', justifyContent: 'center' },
});
