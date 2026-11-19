import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius } from '@/theme/tokens';

/** Floating bar: Liquid Glass on iOS 26+, a raised surface with a hairline everywhere else. */
export function GlassBar({ children }: { children: ReactNode }) {
  if (process.env.EXPO_OS === 'ios' && isLiquidGlassAvailable()) {
    return (
      <GlassView glassEffectStyle="regular" style={styles.bar}>
        {children}
      </GlassView>
    );
  }
  return <View style={[styles.bar, styles.fallback]}>{children}</View>;
}

const styles = StyleSheet.create({
  bar: { borderRadius: radius.panel + 8, padding: 10 },
  fallback: {
    borderCurve: 'continuous',
    backgroundColor: colors.raised,
  },
});
