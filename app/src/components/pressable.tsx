import type { ReactNode } from 'react';
import {
  type PressableProps,
  Pressable as RNPressable,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { haptic } from '@/lib/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);

type Props = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** Selection haptic on press (default on). */
  feedback?: boolean;
};

/** Press feedback used everywhere: scale 0.97 and a selection haptic. */
export function Pressable({
  style,
  children,
  feedback = true,
  onPressIn,
  onPressOut,
  onPress,
  ...rest
}: Props) {
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <AnimatedPressable
      {...rest}
      style={[style, anim]}
      onPressIn={(e) => {
        scale.set(withTiming(0.97, { duration: 90 }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withTiming(1, { duration: 140 }));
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (feedback) haptic.select();
        onPress?.(e);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}
