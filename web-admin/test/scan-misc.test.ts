import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScanResult } from '@/lib/shared';
import { call } from '../lib/client-api';
import { cleanLabel, readDoorLabel, saveDoorLabel } from '../lib/scan/door';
import { needsRestart } from '../lib/scan/health';
import { mapRecent } from '../lib/scan/recent';
import { isTimeout, upstreamTimeoutMs } from '../lib/upstream';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const live = { readyState: 'live' as const, muted: false };

describe('needsRestart', () => {
  it('is false for running audio and a live camera', () => {
    expect(needsRestart({ audio: 'running', tracks: [live] })).toBe(false);
    expect(needsRestart({ audio: 'none', tracks: [live] })).toBe(false);
  });
  it('is true after iOS suspends audio or ends or mutes the camera', () => {
    expect(needsRestart({ audio: 'suspended', tracks: [live] })).toBe(true);
    expect(needsRestart({ audio: 'interrupted' as AudioContextState, tracks: [live] })).toBe(true);
    expect(
      needsRestart({ audio: 'running', tracks: [{ readyState: 'ended', muted: false }] }),
    ).toBe(true);
    expect(needsRestart({ audio: 'running', tracks: [{ readyState: 'live', muted: true }] })).toBe(
      true,
    );
    expect(needsRestart({ audio: 'running', tracks: [] })).toBe(true);
  });
});

describe('door label', () => {
  it('trims, collapses spaces and caps at 40', () => {
    expect(cleanLabel('  Хаалга   2 ')).toBe('Хаалга 2');
    expect(cleanLabel('x'.repeat(60))).toHaveLength(40);
    expect(cleanLabel('   ')).toBe('');
    expect(cleanLabel('Door\u0000\u202e1')).toBe('Door 1');
  });
  it('round-trips through storage and survives storage that throws', () => {
    const m = new Map<string, string>();
    const st = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
    expect(saveDoorLabel(' Хаалга 1 ', st)).toBe('Хаалга 1');
    expect(m.get('oc.doorLabel')).toBe('Хаалга 1');
    expect(readDoorLabel(st)).toBe('Хаалга 1');
    const broken = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    expect(readDoorLabel(broken)).toBe('');
    expect(saveDoorLabel('A', broken)).toBe('A');
  });
});

describe('mapRecent', () => {
  const r = (
    scanId: string,
    result: ScanResult['result'],
    undoUntil: string | null,
  ): ScanResult => ({
    scanId,
    result,
    ticket: null,
    previous: null,
    undoUntil,
  });
  it('shows an undone admit once, as undone', () => {
    const out = mapRecent([
      r('u', 'undone', null),
      r('a', 'admitted', null),
      r('b', 'admitted', '2026-11-09T11:00:00Z'),
      r('c', 'already_used', null),
    ]);
    expect(out.map((x) => [x.result.scanId, x.undone])).toEqual([
      ['a', true],
      ['b', false],
      ['c', false],
    ]);
  });
});

describe('request timeouts', () => {
  it('a response whose body stalls becomes a network error too', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => ({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener('abort', () => rej(init.signal?.reason));
        }),
    }));
    const err = await call('POST', '/staff/scan', {}, { timeoutMs: 40 }).catch((e) => e);
    expect(err).toMatchObject({ status: 0, code: 'network' });
  });

  it('a stalled fetch becomes a retryable network error after the timeout', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener('abort', () => rej(init.signal?.reason));
        }),
    );
    const t0 = Date.now();
    const err = await call('POST', '/staff/scan', {}, { timeoutMs: 40 }).catch((e) => e);
    expect(err).toMatchObject({ status: 0, code: 'network' });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('door requests give up on the API sooner than uploads', () => {
    expect(upstreamTimeoutMs('/v1/staff/scan')).toBeLessThanOrEqual(8000);
    expect(upstreamTimeoutMs('/v1/admin/uploads')).toBeGreaterThan(8000);
    expect(isTimeout(new DOMException('x', 'TimeoutError'))).toBe(true);
    expect(isTimeout(new Error('x'))).toBe(false);
  });

  it('AbortSignal.timeout aborts with a TimeoutError', async () => {
    const s = AbortSignal.timeout(20);
    await new Promise((r) => setTimeout(r, 60));
    expect(isTimeout(s.reason)).toBe(true);
  });
});
