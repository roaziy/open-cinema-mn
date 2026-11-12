import { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

type Props = {
  /** Colour at the opaque end. */
  color: string;
  /** Which edge is opaque. */
  to?: 'bottom' | 'top';
  /** Opacity at the opaque end (0..1). */
  strength?: number;
};

/** Gradient overlay fading from transparent to `color`; fills its parent. */
export function Fade({ color, to = 'bottom', strength = 1 }: Props) {
  const id = useId();
  const [y1, y2] = to === 'bottom' ? [0, 1] : [1, 0];
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1={y1} x2="0" y2={y2}>
          <Stop offset="0" stopColor={color} stopOpacity={0} />
          <Stop offset="1" stopColor={color} stopOpacity={strength} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}
