import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';
import { useToast } from '@/lib/toast';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';

/**
 * The one toast layer, mounted at the root. On iOS it sits in a full-window overlay, which is
 * painted above native sheets and modals (gate, login); elsewhere a plain absolute layer is enough.
 */
export function ToastHost() {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const layer = (
    <View pointerEvents="none" style={[styles.layer, { top: insets.top + space.sm }]}>
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
  return Platform.OS === 'ios' ? <FullWindowOverlay>{layer}</FullWindowOverlay> : layer;
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.raised,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    maxWidth: '100%',
  },
  error: { borderColor: colors.dangerEdge },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { ...type.bodyMedium, color: colors.ink, flexShrink: 1 },
});
