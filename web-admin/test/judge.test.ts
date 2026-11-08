import { describe, expect, it } from 'vitest';
import { judgeSession } from '../lib/auth/judge';

const me = (status: number | null, role?: string, accessFresh = true) => ({
  status,
  role,
  accessFresh,
});

describe('judgeSession (a login page opened with ?error= must not end a healthy session)', () => {
  it('ends only on proof the session is dead', () => {
    expect(judgeSession(me(401), 'admin')).toBe('end');
    expect(judgeSession(me(401), 'staff')).toBe('end');
  });

  it('does not end on a 401 for a token that has simply expired', () => {
    expect(judgeSession(me(401, undefined, false), 'admin')).toBe('stay');
  });

  it('sends a live session that fits its area home', () => {
    expect(judgeSession(me(200, 'admin'), 'admin')).toBe('home');
    expect(judgeSession(me(200, 'staff'), 'staff')).toBe('home');
    expect(judgeSession(me(200, 'admin'), 'staff')).toBe('home');
  });

  it('ends a live session that does not fit the area', () => {
    expect(judgeSession(me(200, 'staff'), 'admin')).toBe('end');
    expect(judgeSession(me(200, 'customer'), 'staff')).toBe('end');
    expect(judgeSession(me(200, 'guest'), 'admin')).toBe('end');
    expect(judgeSession(me(200, undefined), 'admin')).toBe('end');
  });

  it('leaves everything alone when the API cannot answer', () => {
    expect(judgeSession(me(null), 'admin')).toBe('stay');
    expect(judgeSession(me(500), 'admin')).toBe('stay');
    expect(judgeSession(me(503), 'staff')).toBe('stay');
    expect(judgeSession(me(403), 'admin')).toBe('stay');
  });
});
