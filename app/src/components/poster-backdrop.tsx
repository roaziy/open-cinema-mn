import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/theme/tokens';
import { Fade } from './fade';

/**
 * The film's own poster, blurred and tinted with its tone, fading into the canvas.
 * Fills its parent: give the parent a height.
 */
export function PosterBackdrop({ uri, tone }: { uri: string; tone: string }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image
        source={uri}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        blurRadius={process.env.EXPO_OS === 'ios' ? 50 : 25}
        transition={200}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tone, opacity: 0.38 }]} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.canvas, opacity: 0.3 }]} />
      <View style={styles.fade}>
        <Fade color={colors.canvas} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
});
