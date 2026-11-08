import 'server-only';
import { PublicUserSchema } from '@open-cinema/shared';
import { cookies, headers } from 'next/headers';
import { bffHeaders, clientOf } from '../bff';
import { apiUrl } from '../env';
import { isFresh } from './claims';
import { ACCESS_COOKIE } from './cookies';
import { judgeSession, type Verdict } from './judge';
import { homeFor } from './redirects';

export type Judged = { verdict: Verdict; home: string | null };

/** Asks the API whether the stored session is alive, and where a live one belongs. */
export async function verdictFor(): Promise<Judged> {
  const stay: Judged = { verdict: 'stay', home: null };
  const access = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!access) return stay;
  try {
    const res = await fetch(`${apiUrl()}/v1/me`, {
      cache: 'no-store',
      headers: { authorization: `Bearer ${access}`, ...bffHeaders(clientOf(await headers())) },
      signal: AbortSignal.timeout(8_000),
    });
    let role: string | undefined;
    if (res.ok) {
      const user = PublicUserSchema.safeParse(await res.json().catch(() => null));
      // A 2xx we cannot read proves nothing: never end a session on it.
      if (!user.success) return stay;
      role = user.data.role;
    }
    const verdict = judgeSession({ status: res.status, role, accessFresh: isFresh(access, 0) });
    return { verdict, home: verdict === 'home' ? homeFor(role) : null };
  } catch {
    return stay;
  }
}
