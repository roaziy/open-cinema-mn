'use client';

import { useEffect } from 'react';
import { endSession } from '../shell/sign-out';

/**
 * A login page reached because a session ended or did not fit (`?error=`) also closes whatever
 * session is still stored, with a POST, so signing out is never a link.
 */
export function EndSession() {
  useEffect(() => {
    void endSession();
  }, []);
  return null;
}
