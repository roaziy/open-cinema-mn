import { useSyncExternalStore } from 'react';

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
  timer = setTimeout(() => set(null), ms);
}

export function useToast(): ToastItem | null {
  return useSyncExternalStore(subscribe, () => current);
}
