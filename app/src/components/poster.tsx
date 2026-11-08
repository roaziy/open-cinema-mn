import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/theme/tokens';

type Props = { uri: string; width: number; radius?: number };

/** Real poster at 2:3 with a hairline edge. */
export function Poster({ uri, width, radius = 14 }: Props) {
  return (
    <View style={[styles.frame, { width, height: Math.round(width * 1.5), borderRadius: radius }]}>
      <Image source={uri} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
});
