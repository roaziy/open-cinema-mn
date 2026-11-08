import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export type ToastTone = 'error' | 'info';
export type ToastItem = { id: number; message: string; tone: ToastTone };

let current: ToastItem | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

function set(next: ToastItem | null) {
  current = next;
  for (const l of listeners) l();
}

/** One toast at a time: a new one replaces the old. */
export function showToast(message: string, tone: ToastTone = 'info', ms = 3200) {
  if (timer) clearTimeout(timer);
  set({ id: ++seq, message, tone });
  // On iOS the toast itself is hidden from VoiceOver, so focus stays on what the user just
  // tapped and this announcement is the only speech. Queued, so it waits for VoiceOver to
  // finish reading a screen that just opened instead of cutting it off. Android speaks the
  // toast through its live region instead.
  if (Platform.OS === 'ios') {
    AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
  }
  timer = setTimeout(() => set(null), ms);
}

export function useToast(): ToastItem | null {
  return useSyncExternalStore(subscribe, () => current);
}
