import { type ComponentRef, useRef, useState } from 'react';
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  TextInput,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, space } from '@/theme/tokens';
import { fonts } from '@/theme/type';

type Props = TextInputProps & {
  /** Fixed text before the value, e.g. "+976". */
  prefix?: string;
  error?: boolean;
  /** On the bare canvas the field is the card colour with a hairline; on a card or sheet, the fill. */
  onCanvas?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
};

/**
 * The Shop.mn field: filled, 52pt, 18pt continuous corner. Its edge stays in the fill's own colour
 * and only shows on focus (blue) or error (red), fading between them.
 */
export function Field({
  prefix,
  error = false,
  onCanvas = false,
  containerStyle,
  style,
  onFocus,
  onBlur,
  ...input
}: Props) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  const state = useDerivedValue(
    () => withTiming(error ? 2 : focused ? 1 : 0, { duration: 200 }),
    [error, focused],
  );
  const idle = onCanvas ? colors.hairline : colors.fill;
  const edge = useAnimatedStyle(() => ({
    borderColor: interpolateColor(state.value, [0, 1, 2], [idle, colors.focus, colors.danger]),
  }));
  return (
    <AnimatedPressable
      onPress={() => ref.current?.focus()}
      accessible={false}
      style={[
        styles.shell,
        { backgroundColor: onCanvas ? colors.surface : colors.fill },
        edge,
        containerStyle,
      ]}
    >
      {prefix ? (
        // A read-only text box, not a Text: iOS centres a label and a text field differently
        // (by a point or two, more on some versions), so the prefix is drawn by the same
        // renderer as the value and the placeholder and sits on their line on every iOS.
        <TextInput
          value={prefix}
          editable={false}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[styles.text, styles.prefix]}
        />
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={colors.hint}
        selectionColor={colors.action}
        {...input}
        // Same family and size as the prefix and no fixed line height (a lineHeight on a
        // TextInput pushes its text off-centre).
        style={[styles.text, styles.input, style]}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
      />
    </AnimatedPressable>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const styles = StyleSheet.create({
  shell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 52,
    paddingHorizontal: space.lg,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  text: { fontFamily: fonts.medium, fontSize: 16, color: colors.muted, paddingVertical: 0 },
  // Both boxes run the field's full height, so iOS centres prefix and value in the same box.
  prefix: { alignSelf: 'stretch' },
  input: { flex: 1, alignSelf: 'stretch', paddingVertical: 0, color: colors.ink },
});
