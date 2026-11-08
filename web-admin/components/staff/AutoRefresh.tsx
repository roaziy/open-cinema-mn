'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-reads the server data every few seconds while the page is in front, so door counts stay live. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const t = setInterval(tick, seconds * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router, seconds]);
  return null;
}
