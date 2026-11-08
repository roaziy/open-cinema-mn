export type Area = 'admin' | 'staff';
/** `end`: close the stored session. `home`: it is fine and fits, go there. `stay`: do nothing. */
export type Verdict = 'end' | 'home' | 'stay';

export const fitsArea = (role: string | undefined, area: Area): boolean =>
  area === 'admin' ? role === 'admin' : role === 'staff' || role === 'admin';

/**
 * Decides what a login page opened with `?error=` may do to the stored session. Ending one is
 * destructive, so it needs proof: the API refused a token that had not expired, or accepted it
 * for a role this area does not take. An expired token, a missing answer or an API error prove
 * nothing, and a healthy session is never ended by a link.
 */
export function judgeSession(
  me: { status: number | null; role?: string; accessFresh: boolean },
  area: Area,
): Verdict {
  if (me.status === null) return 'stay';
  if (me.status === 401) return me.accessFresh ? 'end' : 'stay';
  if (me.status >= 200 && me.status < 300) return fitsArea(me.role, area) ? 'home' : 'end';
  return 'stay';
}
