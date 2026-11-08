import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => ({ value: ACCESS }) }),
  headers: async () => new Headers(),
}));

// An unexpired token (the payload is only read for `exp`).
const ACCESS = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.sig`;

import { verdictFor } from '../lib/auth/verdict';

afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status }));

describe('verdictFor', () => {
  it('stays when a 2xx /me body is not a user (never ends on an unreadable answer)', async () => {
    answer(200, { nope: true });
    expect(await verdictFor()).toEqual({ verdict: 'stay', home: null });
  });

  it('sends a live staff session to /staff and a live admin to /admin', async () => {
    const user = (role: string) => ({
      id: 'u',
      role,
      phone: null,
      email: null,
      emailVerified: false,
      name: null,
      branchId: null,
    });
    answer(200, user('staff'));
    expect(await verdictFor()).toEqual({ verdict: 'home', home: '/staff' });
    answer(200, user('admin'));
    expect(await verdictFor()).toEqual({ verdict: 'home', home: '/admin' });
  });

  it('ends on a 401 for an unexpired token', async () => {
    answer(401, { error: 'unauthorized' });
    expect(await verdictFor()).toEqual({ verdict: 'end', home: null });
  });
});
