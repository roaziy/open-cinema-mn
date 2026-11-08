import * as Haptics from 'expo-haptics';

// Haptics are decoration: a failure (simulator, old dev client) must never surface.
const safe = (run: () => Promise<void>) => {
  run().catch(() => {});
};

export const haptic = {
  select: () => safe(() => Haptics.selectionAsync()),
  tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  press: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
