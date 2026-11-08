import { useEffect } from 'react';
import type { DimensionValue, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '@/theme/tokens';

type Props = {
  width?: DimensionValue;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/** Loading placeholder: a calm fill with a slow breathe (loading only, never decoration). */
export function Skeleton({ width = '100%', height, radius = 10, style }: Props) {
  const o = useSharedValue(0.55);
  useEffect(() => {
    o.set(withRepeat(withTiming(1, { duration: 900 }), -1, true));
  }, [o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.get() }));
  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.fill }, anim, style]}
    />
  );
}
