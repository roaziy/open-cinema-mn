import { describe, expect, it } from 'vitest';
import { upstreamPath } from '../lib/proxy-path';

describe('upstreamPath', () => {
  it('builds the API path for allowed areas', () => {
    expect(upstreamPath(['branches'])).toBe('/v1/branches');
    expect(upstreamPath(['staff', 'today'])).toBe('/v1/staff/today');
    expect(upstreamPath(['showtimes', 'a b', 'seats'])).toBe('/v1/showtimes/a%20b/seats');
  });

  it('reaches admin endpoints such as the cancel preview', () => {
    expect(upstreamPath(['admin', 'showtimes', 'abc', 'cancel-preview'])).toBe(
      '/v1/admin/showtimes/abc/cancel-preview',
    );
    expect(upstreamPath(['admin', 'uploads'])).toBe('/v1/admin/uploads');
  });

  it('refuses token-issuing endpoints in any case', () => {
    for (const first of ['auth', 'Auth', 'AUTH', 'aUtH']) {
      expect(upstreamPath([first, 'refresh'])).toBeNull();
      expect(upstreamPath([first, 'admin', 'login'])).toBeNull();
    }
  });

  it('refuses areas that are not on the allowlist', () => {
    expect(upstreamPath(['t', 'abc'])).toBeNull();
    expect(upstreamPath(['unknown'])).toBeNull();
    expect(upstreamPath([])).toBeNull();
  });

  it('normalizes the first segment to lowercase', () => {
    expect(upstreamPath(['Branches'])).toBe('/v1/branches');
  });

  it('refuses dot segments and separators smuggled in a segment', () => {
    expect(upstreamPath(['branches', '..', 'auth', 'refresh'])).toBeNull();
    expect(upstreamPath(['branches', '.'])).toBeNull();
    expect(upstreamPath(['branches', '../auth'])).toBeNull();
    expect(upstreamPath(['branches', '..\\auth'])).toBeNull();
    expect(upstreamPath(['staff', 'a/b'])).toBeNull();
    expect(upstreamPath(['staff', ''])).toBeNull();
    expect(upstreamPath(['staff', 'x\ny'])).toBeNull();
  });

  it('encodes what it forwards so an encoded separator stays one segment', () => {
    expect(upstreamPath(['staff', 'a%2Fb'])).toBe('/v1/staff/a%252Fb');
  });
});
