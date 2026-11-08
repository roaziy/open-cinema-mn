import * as SecureStore from 'expo-secure-store';
import { useCallback, useSyncExternalStore } from 'react';
import { en } from './en';
import { mn, type TKey } from './mn';

export type Locale = 'mn' | 'en';
export type { TKey };

const dictionaries: Record<Locale, Record<TKey, string>> = { mn, en };
const STORAGE_KEY = 'oc.locale';

let current: Locale = 'mn'; // Mongolian is the default
const listeners = new Set<() => void>();

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/** Restore the saved language. Called once at startup; failures keep the default. */
export async function hydrateLocale(): Promise<void> {
  try {
    const saved = await SecureStore.getItemAsync(STORAGE_KEY);
    if (saved === 'mn' || saved === 'en') setLocaleState(saved);
  } catch {}
}

function setLocaleState(next: Locale) {
  if (next === current) return;
  current = next;
  for (const l of listeners) l();
}

export function setLocale(next: Locale) {
  setLocaleState(next);
  SecureStore.setItemAsync(STORAGE_KEY, next).catch(() => {});
}

export function translate(
  locale: Locale,
  key: TKey,
  params?: Record<string, string | number>,
): string {
  const text = dictionaries[locale][key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}

export function useI18n() {
  const locale = useSyncExternalStore(subscribe, () => current);
  const t = useCallback(
    (key: TKey, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  );
  return { t, locale, setLocale };
}
