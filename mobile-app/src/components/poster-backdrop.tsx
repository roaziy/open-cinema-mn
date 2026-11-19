import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { mediaUrl } from '@/lib/http';
import { colors } from '@/theme/tokens';
import { Fade } from './fade';

/**
 * The film's own poster, blurred and tinted with its tone, fading into the canvas.
 * Fills its parent: give the parent a height.
 *
 * Pass the scroll view's offset as `scrollY` when the backdrop sits at the top of one: pulling
 * past the top then stretches it upward to fill the gap, instead of showing bare canvas above it.
 */
export function PosterBackdrop({
  uri,
  tone,
  fadeHeight = 240,
  scrollY,
}: {
  uri: string;
  tone: string;
  /** Fixed in points: an SVG sized by percentage would not repaint when its parent resizes. */
  fadeHeight?: number;
  scrollY?: SharedValue<number>;
}) {
  const height = useSharedValue(0);
  const stretch = useAnimatedStyle(() => {
    const pull = scrollY ? Math.max(0, -scrollY.get()) : 0;
    const h = height.get();
    if (pull === 0 || h <= 0) return { transform: [{ translateY: 0 }, { scale: 1 }] };
    // Grow by `pull` about the centre, then lift by half of it: the top meets the screen's top
    // edge and the bottom (with its fade into the canvas) stays put.
    return { transform: [{ translateY: -pull / 2 }, { scale: (h + pull) / h }] };
  });
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, stretch]}
      pointerEvents="none"
      onLayout={(e) => height.set(e.nativeEvent.layout.height)}
    >
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
    </Animated.View>
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
