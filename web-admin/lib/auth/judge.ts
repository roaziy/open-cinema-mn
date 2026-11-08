import { homeFor } from './redirects';

/** `end`: close the stored session. `home`: it is live and has a home, go there. `stay`: do nothing. */
export type Verdict = 'end' | 'home' | 'stay';

/**
 * Decides what a login page opened with `?error=` may do to the stored session. Ending one is
 * destructive, so it needs proof, and a live back-office session is never ended by a link:
 * - 401 on a token that has not expired: dead, `end`.
 * - 2xx for admin or staff: live, `home` (the role's own home; an admin on the staff login goes
 *   to /admin, staff on the admin login go to /staff).
 * - 2xx for a role with no home here (customer, guest): `end`.
 * - Anything else (expired token, API error, unreadable answer): `stay`.
 */
export function judgeSession(me: {
  status: number | null;
  role?: string;
  accessFresh: boolean;
}): Verdict {
  if (me.status === null) return 'stay';
  if (me.status === 401) return me.accessFresh ? 'end' : 'stay';
  if (me.status >= 200 && me.status < 300) return homeFor(me.role) ? 'home' : 'end';
  return 'stay';
}
