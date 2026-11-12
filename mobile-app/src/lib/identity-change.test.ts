import { describe, expect, it } from 'vitest';
import { shouldClearCache } from './identity-change';

describe('shouldClearCache', () => {
  it('keeps the cache on the first sighting and on null -> user', () => {
    expect(shouldClearCache(undefined, null)).toBe(false);
    expect(shouldClearCache(undefined, 'u1')).toBe(false);
    expect(shouldClearCache(null, 'guest1')).toBe(false);
  });
  it('clears when a real user switches or logs out', () => {
    expect(shouldClearCache('u1', 'u2')).toBe(true);
    expect(shouldClearCache('u1', null)).toBe(true);
  });
  it('keeps the cache when nothing changed', () => {
    expect(shouldClearCache('u1', 'u1')).toBe(false);
    expect(shouldClearCache(null, null)).toBe(false);
  });
});
