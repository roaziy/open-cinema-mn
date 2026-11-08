import { describe, expect, it } from 'vitest';
import { deviceId, newId } from '../lib/scan/ids';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function store(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    m,
  };
}

describe('ids', () => {
  it('makes v4 uuids', () => {
    expect(newId()).toMatch(UUID);
    expect(newId()).not.toBe(newId());
  });

  it('creates the device id once and keeps it', () => {
    const s = store();
    const first = deviceId(s);
    expect(first).toMatch(UUID);
    expect(s.m.get('oc.deviceId')).toBe(first);
    expect(deviceId(s)).toBe(first);
  });

  it('replaces a stored value that is not a uuid', () => {
    const s = store({ 'oc.deviceId': 'hello' });
    expect(deviceId(s)).toMatch(UUID);
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
    };
    const a = deviceId(broken);
    expect(a).toMatch(UUID);
    expect(deviceId(broken)).toBe(a);
  });
});
