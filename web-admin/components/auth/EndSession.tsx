'use client';

import { useEffect } from 'react';
import { endDeadSession } from '../shell/sign-out';

/**
 * Rendered only when the server already found the stored session dead or without a home here.
 * The action checks again before ending anything, so this is never a way to sign someone out.
 */
export function EndSession() {
  useEffect(() => {
    void endDeadSession();
  }, []);
  return null;
}
