import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { type PublicUser, PublicUserSchema, type Role } from '@/lib/shared';
import { ApiError, apiFetch } from './api';
import { loginPathFor } from './auth/redirects';

/** The signed-in user, as the API sees them right now. A 401 is handled inside `apiFetch`. */
export const getUser = cache(async (): Promise<PublicUser> => {
  const res = await apiFetch('/me');
  if (!res.ok) throw new ApiError(res.status, 'me_failed');
  return PublicUserSchema.parse(await res.json());
});

/**
 * Authoritative role gate for layouts. `proxy.ts` only routes on an unverified token claim; this
 * asks the API. A wrong role sends the browser to the login page, which ends that session.
 */
export async function requireRole(...roles: Role[]): Promise<PublicUser> {
  const path = (await headers()).get('x-pathname') ?? '/admin';
  const user = await getUser();
  if (!roles.includes(user.role)) {
    redirect(`${loginPathFor(path)}?error=forbidden`);
  }
  return user;
}
