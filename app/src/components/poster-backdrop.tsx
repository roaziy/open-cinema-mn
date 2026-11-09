import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { mediaUrl } from '@/lib/http';
import { colors } from '@/theme/tokens';
import { Fade } from './fade';

/**
 * The film's own poster, blurred and tinted with its tone, fading into the canvas.
 * Fills its parent: give the parent a height.
 */
export function PosterBackdrop({
  uri,
  tone,
  fadeHeight = 240,
}: {
  uri: string;
  tone: string;
  /** Fixed in points: an SVG sized by percentage would not repaint when its parent resizes. */
  fadeHeight?: number;
}) {
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} pointerEvents="none">
      <Image
        source={mediaUrl(uri)}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        blurRadius={process.env.EXPO_OS === 'ios' ? 50 : 25}
        transition={200}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: tone, opacity: 0.38 }]} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.canvas, opacity: 0.3 }]} />
      <View style={[styles.fade, { height: fadeHeight }]}>
        <Fade color={colors.canvas} />
      </View>
      {/* Seals the last pixel row so the blur never leaks past the fade. */}
      <View style={styles.seal} />
    </View>
  );
}

const styles = StyleSheet.create({
  seal: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: colors.canvas,
  },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
