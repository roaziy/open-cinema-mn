import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';
import { useToast } from '@/lib/toast';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

const ios = Platform.OS === 'ios';

/**
 * The one toast layer, mounted at the root. On iOS it sits in a full-window overlay, which is
 * painted above native sheets and modals (gate, login). The overlay stays mounted for the
 * app's lifetime: it moves VoiceOver focus to itself every time it attaches, so mounting it
 * per toast would pull focus off the seat just tapped. It is not modal, touches pass through
 * it, and the toast inside is hidden from VoiceOver (showToast announces it instead).
 * Elsewhere a plain absolute layer with a live region is enough.
 */
export function ToastHost() {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const layer = (
    <View
      pointerEvents="none"
      accessibilityElementsHidden={ios}
      style={[styles.layer, { top: insets.top + space.sm }]}
    >
      {toast ? (
        <Animated.View
          key={toast.id}
          entering={FadeInUp.duration(180)}
          exiting={FadeOutUp.duration(160)}
          style={[styles.toast, toast.tone === 'error' && styles.error]}
          accessibilityLiveRegion="polite"
        >
          <View
            style={[
              styles.dot,
              { backgroundColor: toast.tone === 'error' ? colors.danger : colors.action },
            ]}
          />
          <Text style={styles.text}>{toast.message}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
  if (!ios) return layer;
  return (
    <FullWindowOverlay unstable_accessibilityContainerViewIsModal={false}>
      {layer}
    </FullWindowOverlay>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  toast: {
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.raised,
    borderRadius: radius.pill,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    maxWidth: '100%',
  },
  error: { borderColor: colors.dangerEdge },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { ...type.bodyMedium, color: colors.ink, flexShrink: 1 },
});
