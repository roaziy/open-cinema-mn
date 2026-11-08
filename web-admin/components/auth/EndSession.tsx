'use client';

import { useEffect } from 'react';
import type { Area } from '@/lib/auth/judge';
import { endDeadSession } from '../shell/sign-out';

/**
 * Rendered only when the server already found the stored session dead or unfit for this area.
 * The action checks again before ending anything, so this is never a way to sign someone out.
 */
export function EndSession({ area }: { area: Area }) {
  useEffect(() => {
    void endDeadSession(area);
  }, [area]);
  return null;
}
