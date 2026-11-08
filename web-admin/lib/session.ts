import 'server-only';
import { type PublicUser, PublicUserSchema, type Role } from '@open-cinema/shared';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
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
 * asks the API. A wrong role means the stored session is not for this area, so it is dropped.
 */
export async function requireRole(...roles: Role[]): Promise<PublicUser> {
  const path = (await headers()).get('x-pathname') ?? '/admin';
  const user = await getUser();
  if (!roles.includes(user.role)) {
    redirect(
      `/auth/refresh?next=${encodeURIComponent(loginPathFor(path))}&signout=1&error=forbidden`,
    );
  }
  return user;
}
