import { Wheelchair } from 'phosphor-react-native';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { SeatKind } from '@/shared';
import { colors, hues } from '@/theme/tokens';

export type SeatStatus = 'free' | 'mine' | 'taken';

const PREMIUM = hues.indigo;
const TAKEN_FILL = '#101012';
const TAKEN_EDGE = 'rgba(255,255,255,0.05)';
const FREE_EDGE = 'rgba(255,255,255,0.12)';

/** A check mark drawn from one rotated corner, so it needs no font or SVG. */
function Check({ size }: { size: number }) {
  const w = Math.max(3, size * 0.26);
  const h = Math.max(5, size * 0.5);
  return (
    <View
      style={{
        width: w,
        height: h,
        borderRightWidth: Math.max(1.5, size * 0.1),
        borderBottomWidth: Math.max(1.5, size * 0.1),
        borderColor: colors.onAction,
        transform: [{ rotate: '45deg' }, { translateY: -size * 0.04 }],
      }}
    />
  );
}

/** Two crossed bars: the "taken" shape, readable without colour. */
function Cross({ size, kind }: { size: number; kind: SeatKind }) {
  const len = size * 0.52;
  const bar = {
    position: 'absolute' as const,
    width: len,
    height: Math.max(1.5, size * 0.1),
    borderRadius: 1,
    backgroundColor: colors.muted,
    opacity: kind === 'premium' ? 0.8 : 0.6,
  };
  return (
    <>
      <View style={[bar, { transform: [{ rotate: '45deg' }] }]} />
      <View style={[bar, { transform: [{ rotate: '-45deg' }] }]} />
    </>
  );
}

type Props = {
  id: string;
  left: number;
  top: number;
  size: number;
  kind: SeatKind;
  status: SeatStatus;
  label: string;
  onPress: (id: string) => void;
  /** Draw only the icons (check, cross, wheelchair): the tile is see-through (the premium bar stays). */
  glyphsOnly?: boolean;
};

function SeatCellView({ id, left, top, size, kind, status, label, onPress, glyphsOnly }: Props) {
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const round = size * 0.42;
  const base = {
    position: 'absolute' as const,
    left,
    top,
    width: size,
    height: size,
  };

  const fill = status === 'mine' ? colors.action : status === 'taken' ? TAKEN_FILL : colors.fill;
  const edge = status === 'mine' ? colors.action : status === 'taken' ? TAKEN_EDGE : FREE_EDGE;
  const glyph = Math.max(6, size * 0.62);

  return (
    <Pressable
      disabled={status === 'taken'}
      hitSlop={2}
      onPress={() => {
        scale.set(
          withSequence(
            withTiming(0.92, { duration: 60 }),
            withSpring(1, { damping: 11, stiffness: 320 }),
          ),
        );
        onPress(id);
      }}
      accessible={!glyphsOnly}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: status === 'mine', disabled: status === 'taken' }}
      style={base}
    >
      <Animated.View
        style={[
          styles.seat,
          {
            borderTopLeftRadius: round,
            borderTopRightRadius: round,
            borderBottomLeftRadius: size * 0.16,
            borderBottomRightRadius: size * 0.16,
            backgroundColor: glyphsOnly ? 'transparent' : fill,
            borderColor: glyphsOnly ? 'transparent' : edge,
          },
          anim,
        ]}
      >
        {kind === 'premium' ? (
          <View
            style={[
              styles.bar,
              { height: Math.max(2, size * 0.16), opacity: status === 'taken' ? 0.35 : 1 },
            ]}
          />
        ) : null}
        {status === 'mine' ? (
          <Check size={size} />
        ) : status === 'taken' ? (
          <Cross size={size} kind={kind} />
        ) : kind === 'wheelchair' ? (
          <Wheelchair size={glyph} color={colors.body} weight="fill" />
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

export const SeatCell = memo(SeatCellView);

const styles = StyleSheet.create({
  seat: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: PREMIUM },
});
