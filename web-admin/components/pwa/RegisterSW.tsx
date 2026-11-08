'use client';

import { useEffect } from 'react';

/** Registers the app-shell service worker. Production only, so dev reloads are never cached. */
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // The app works without it; installability is a bonus.
    });
  }, []);
  return null;
}
