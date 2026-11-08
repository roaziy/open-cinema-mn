import type { ScanBody, ScanResult } from '@open-cinema/shared';
import { describe, expect, it } from 'vitest';
import { backoffMs, isRetryable, sendScan } from '../lib/scan/send';

const TOKEN = 'oc1.t.s.mac';
const SCAN_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';

const result = (over: Partial<ScanResult> = {}): ScanResult => ({
  scanId: SCAN_ID,
  result: 'admitted',
  ticket: null,
  previous: null,
  undoUntil: null,
  ...over,
});

class Err extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function harness(script: (call: number, body: ScanBody) => unknown) {
  const bodies: ScanBody[] = [];
  const retries: string[] = [];
  let cancelled = false;
  const deps = {
    send: async (body: ScanBody) => {
      bodies.push(body);
      const out = script(bodies.length, body);
      if (out instanceof Error) throw out;
      return out;
    },
    sleep: () => new Promise<void>((r) => setTimeout(r, 0)),
    onRetry: (reason: string) => retries.push(reason),
    isCancelled: () => cancelled,
  };
  return { deps, bodies, retries, cancel: () => (cancelled = true) };
}
const input = { token: TOKEN, scanId: SCAN_ID, deviceId: DEVICE };

describe('sendScan', () => {
  it('returns the server answer', async () => {
    const h = harness(() => result({ result: 'admitted' }));
    const out = await sendScan(input, h.deps);
    expect(out).toMatchObject({ kind: 'done', result: { result: 'admitted' } });
    expect(h.bodies).toEqual([{ token: TOKEN, scanId: SCAN_ID, deviceId: DEVICE }]);
  });

  it('retries a network failure with the SAME scan id and then succeeds', async () => {
    const h = harness((n) => (n < 4 ? new Err(0, 'network') : result()));
    const out = await sendScan(input, h.deps);
    expect(out.kind).toBe('done');
    expect(h.bodies).toHaveLength(4);
    expect(new Set(h.bodies.map((b) => b.scanId))).toEqual(new Set([SCAN_ID]));
    expect(new Set(h.bodies.map((b) => ('token' in b ? b.token : '')))).toEqual(new Set([TOKEN]));
    expect(h.retries).toEqual(['network', 'network', 'network']);
  });

  it('never yields an admit while the network is down', async () => {
    const h = harness(() => new Err(0, 'network'));
    const run = sendScan(input, h.deps);
    // let it fail a few times, however slowly this machine runs, then cancel
    for (let i = 0; i < 400 && h.bodies.length < 4; i++) await new Promise((r) => setTimeout(r, 5));
    h.cancel();
    const out = await run;
    expect(out.kind).toBe('cancelled');
    expect(h.bodies.length).toBeGreaterThan(3);
  });

  it('retries 5xx and 429 but not other client errors', async () => {
    for (const status of [500, 502, 503, 504, 429, 408]) {
      const h = harness((n) => (n === 1 ? new Err(status, 'x') : result()));
      expect((await sendScan(input, h.deps)).kind).toBe('done');
      expect(h.bodies).toHaveLength(2);
    }
    for (const status of [400, 401, 403, 404, 409]) {
      const h = harness(() => new Err(status, 'scan_id_conflict'));
      expect(await sendScan(input, h.deps)).toEqual({ kind: 'failed', code: 'scan_id_conflict' });
      expect(h.bodies).toHaveLength(1);
    }
  });

  it('treats a malformed answer as a failure, never as an admit', async () => {
    const h = harness(() => ({ result: 'admitted' }));
    expect(await sendScan(input, h.deps)).toEqual({ kind: 'failed', code: 'bad_response' });
  });

  it('refuses an answer that belongs to another scan id', async () => {
    const h = harness(() => result({ scanId: '33333333-3333-4333-8333-333333333333' }));
    expect(await sendScan(input, h.deps)).toEqual({ kind: 'failed', code: 'bad_response' });
  });

  it('refuses an undone answer to a scan', async () => {
    const h = harness(() => result({ result: 'undone' }));
    expect(await sendScan(input, h.deps)).toEqual({ kind: 'failed', code: 'bad_response' });
  });

  it('stops quietly when cancelled before the answer arrives', async () => {
    const h = harness(() => {
      h.cancel();
      return result();
    });
    expect((await sendScan(input, h.deps)).kind).toBe('cancelled');
  });
});

describe('isRetryable / backoffMs', () => {
  it('classifies', () => {
    expect(isRetryable(new Err(0, 'network'))).toBe(true);
    expect(isRetryable(new Err(503, 'x'))).toBe(true);
    expect(isRetryable(new Err(409, 'x'))).toBe(false);
    expect(isRetryable(new Error('boom'))).toBe(false);
  });

  it('backs off and caps', () => {
    expect(backoffMs(1)).toBeLessThan(backoffMs(2));
    expect(backoffMs(2)).toBeLessThan(backoffMs(3));
    expect(backoffMs(50)).toBe(backoffMs(20));
    expect(backoffMs(50)).toBeLessThanOrEqual(5000);
  });
});
