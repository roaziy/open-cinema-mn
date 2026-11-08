import { describe, expect, it } from 'vitest';
import { safeNext } from '../lib/auth/redirects';

const FALLBACK = '/admin';

describe('safeNext', () => {
  it.each([
    ['//evil.example', 'protocol-relative'],
    ['/\t/evil.example', 'tab'],
    ['/\n/evil.example', 'newline'],
    ['/\r/evil.example', 'carriage return'],
    ['/%09/evil.example', 'encoded tab'],
    ['/%0a/evil.example', 'encoded newline'],
    ['/\\evil.example', 'backslash'],
    ['/%5Cevil.example', 'encoded backslash'],
    ['\\\\evil.example', 'leading backslashes'],
    ['https:evil.example', 'scheme without slashes'],
    ['https://evil.example', 'absolute url'],
    ['javascript:alert(1)', 'javascript url'],
    ['admin', 'relative'],
    ['', 'empty'],
    ['/.//evil.example', 'dot segment collapsing to //'],
    ['/..//x', 'dot-dot collapsing to //'],
    ['/%2e//x', 'encoded dot collapsing to //'],
    ['/%2E%2E//x', 'encoded dot-dot collapsing to //'],
    ['/a/..//x', 'inner dot-dot collapsing to //'],
    ['/x/../..//x/p?q=1', 'deep dot-dot collapsing to //'],
  ])('rejects %j (%s)', (value) => {
    expect(safeNext(value, FALLBACK)).toBe(FALLBACK);
  });

  it('rejects non-strings', () => {
    expect(safeNext(null, FALLBACK)).toBe(FALLBACK);
    expect(safeNext(['/x'], FALLBACK)).toBe(FALLBACK);
  });

  it('keeps ordinary paths, query and hash', () => {
    expect(safeNext('/admin/movies', FALLBACK)).toBe('/admin/movies');
    expect(safeNext('/staff/scan?x=1#top', '/staff')).toBe('/staff/scan?x=1#top');
    expect(safeNext('/admin/branches/ab-12', FALLBACK)).toBe('/admin/branches/ab-12');
  });
});
