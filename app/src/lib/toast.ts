import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export type ToastTone = 'error' | 'info';
export type ToastItem = { id: number; message: string; tone: ToastTone; leaving: boolean };

/** How long the fade-out runs before the toast layer is removed. */
const LEAVE_MS = 200;

let current: ToastItem | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let leaveTimer: ReturnType<typeof setTimeout> | null = null;
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
  if (leaveTimer) clearTimeout(leaveTimer);
  const item: ToastItem = { id: ++seq, message, tone, leaving: false };
  set(item);
  // VoiceOver does not read an overlay that appears on its own.
  if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  timer = setTimeout(() => {
    set({ ...item, leaving: true });
    leaveTimer = setTimeout(() => set(null), LEAVE_MS);
  }, ms);
}

export function useToast(): ToastItem | null {
  return useSyncExternalStore(subscribe, () => current);
}
