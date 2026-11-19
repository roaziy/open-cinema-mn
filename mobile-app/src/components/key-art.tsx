import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { mediaUrl } from '@/lib/http';
import { Fade } from './fade';

/**
 * The film's own key art, sharp and edge to edge, fading into `pageColor` at the bottom.
 * Fills its parent: give the parent a height. `scrollY` stretches it on pull-down (same
 * transform as PosterBackdrop) so no bare canvas shows above it.
 */
export function KeyArt({
  uri,
  pageColor,
  height,
  topInset,
  scrollY,
  fade = 0.45,
  solid = 0,
  scrim = 0.55,
  scrimDepth = 96,
}: {
  uri: string;
  pageColor: string;
  height: number;
  /** Safe-area top: the dark scrim covers it plus the back button row. */
  topInset: number;
  scrollY?: SharedValue<number>;
  /** Share of the height the bottom fade covers; its lower `solid` part is fully opaque. */
  fade?: number;
  solid?: number;
  /** Opacity of the dark scrim behind the status bar and header, and how far below the inset it reaches. */
  scrim?: number;
  scrimDepth?: number;
}) {
  const h = useSharedValue(height);
  const stretch = useAnimatedStyle(() => {
    const pull = scrollY ? Math.max(0, -scrollY.get()) : 0;
    const base = h.get();
    if (pull === 0 || base <= 0) return { transform: [{ translateY: 0 }, { scale: 1 }] };
    return { transform: [{ translateY: -pull / 2 }, { scale: (base + pull) / base }] };
  });
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: pageColor }, stretch]}
      pointerEvents="none"
      onLayout={(e) => h.set(e.nativeEvent.layout.height)}
    >
      <Image
        source={mediaUrl(uri)}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={200}
      />
      <View style={[styles.top, { height: topInset + scrimDepth }]}>
        <Fade color="#000000" to="top" strength={scrim} />
      </View>
      <View style={[styles.bottom, { height: Math.round(height * fade) }]}>
        <View style={{ flex: 1 - solid }}>
          <Fade color={pageColor} />
        </View>
        {solid > 0 ? <View style={{ flex: solid, backgroundColor: pageColor }} /> : null}
      </View>
      {/* Seals the last pixel row so the art never leaks past the fade. */}
      <View style={[styles.seal, { backgroundColor: pageColor }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  seal: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2 },
});
