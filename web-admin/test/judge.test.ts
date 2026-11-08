import { describe, expect, it } from 'vitest';
import { judgeSession } from '../lib/auth/judge';

const me = (status: number | null, role?: string, accessFresh = true) => ({
  status,
  role,
  accessFresh,
});

describe('judgeSession (a login page opened with ?error= must not end a live session)', () => {
  it('ends only on proof the session is dead', () => {
    expect(judgeSession(me(401))).toBe('end');
  });

  it('does not end on a 401 for a token that has simply expired', () => {
    expect(judgeSession(me(401, undefined, false))).toBe('stay');
  });

  it('sends every live back-office session home, whichever login page was opened', () => {
    // Staff opening /login?error=... and an admin opening /staff/login?error=... both go home.
    expect(judgeSession(me(200, 'staff'))).toBe('home');
    expect(judgeSession(me(200, 'admin'))).toBe('home');
  });

  it('ends a live session whose role has no home here', () => {
    expect(judgeSession(me(200, 'customer'))).toBe('end');
    expect(judgeSession(me(200, 'guest'))).toBe('end');
    expect(judgeSession(me(200, undefined))).toBe('end');
  });

  it('leaves everything alone when the API cannot answer', () => {
    expect(judgeSession(me(null))).toBe('stay');
    expect(judgeSession(me(500))).toBe('stay');
    expect(judgeSession(me(503))).toBe('stay');
    expect(judgeSession(me(403))).toBe('stay');
  });
});
