import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

// Preferred branch (null = all branches). Plain storage: a preference, not a secret.
const STORAGE_KEY = 'oc.branch';

let current: string | null = null;
const listeners = new Set<() => void>();

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export async function hydrateBranch(): Promise<void> {
  try {
    const saved = await Storage.getItem(STORAGE_KEY);
    if (saved) setState(saved);
  } catch {}
}

function setState(next: string | null) {
  if (next === current) return;
  current = next;
  for (const l of listeners) l();
}

export function setBranchId(next: string | null) {
  setState(next);
  (next ? Storage.setItem(STORAGE_KEY, next) : Storage.removeItem(STORAGE_KEY)).catch(() => {});
}

export function useBranchId(): string | null {
  return useSyncExternalStore(subscribe, () => current);
}
