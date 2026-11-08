import 'server-only';
import { PublicUserSchema } from '@open-cinema/shared';
import { cookies, headers } from 'next/headers';
import { bffHeaders, clientOf } from '../bff';
import { apiUrl } from '../env';
import { isFresh } from './claims';
import { ACCESS_COOKIE } from './cookies';
import { type Area, judgeSession, type Verdict } from './judge';

/** Asks the API whether the stored session is alive and fits `area`. */
export async function verdictFor(area: Area): Promise<Verdict> {
  const access = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!access) return 'stay';
  try {
    const res = await fetch(`${apiUrl()}/v1/me`, {
      cache: 'no-store',
      headers: { authorization: `Bearer ${access}`, ...bffHeaders(clientOf(await headers())) },
      signal: AbortSignal.timeout(8_000),
    });
    const user = res.ok ? PublicUserSchema.safeParse(await res.json()) : null;
    return judgeSession(
      {
        status: res.status,
        role: user?.success ? user.data.role : undefined,
        accessFresh: isFresh(access, 0),
      },
      area,
    );
  } catch {
    return 'stay';
  }
}
