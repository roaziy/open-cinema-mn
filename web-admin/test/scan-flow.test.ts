import { describe, expect, it } from 'vitest';
import type { ScanResult } from '@/lib/shared';
import { type Flow, flowReducer, idleFlow, isBusy } from '../lib/scan/flow';

const admitted: ScanResult = {
  scanId: 's1',
  result: 'admitted',
  ticket: null,
  previous: null,
  undoUntil: null,
};

describe('flowReducer', () => {
  it('starts a scan from idle', () => {
    const s = flowReducer(idleFlow, { type: 'start', scanId: 's1', token: 't' });
    expect(s).toMatchObject({ kind: 'sending', scanId: 's1', token: 't', retry: null });
  });

  it('ignores a new read while a request or a card is up', () => {
    const sending = flowReducer(idleFlow, { type: 'start', scanId: 's1', token: 't' });
    expect(flowReducer(sending, { type: 'start', scanId: 's2', token: 'u' })).toBe(sending);
    const card = flowReducer(sending, { type: 'settled', scanId: 's1', result: admitted, at: 1 });
    expect(flowReducer(card, { type: 'start', scanId: 's2', token: 'u' })).toBe(card);
    expect(isBusy(sending)).toBe(true);
    expect(isBusy(card)).toBe(true);
    expect(isBusy(idleFlow)).toBe(false);
  });

  it('a network retry keeps the same scan id and is never a result card', () => {
    let s: Flow = flowReducer(idleFlow, { type: 'start', scanId: 's1', token: 't' });
    s = flowReducer(s, { type: 'retrying', scanId: 's1', reason: 'network' });
    expect(s).toMatchObject({ kind: 'sending', scanId: 's1', retry: 'network' });
  });

  it('drops a late answer for a scan that was cancelled or replaced', () => {
    const s = flowReducer(idleFlow, { type: 'start', scanId: 's2', token: 't' });
    expect(flowReducer(s, { type: 'settled', scanId: 's1', result: admitted, at: 1 })).toBe(s);
    const cancelled = flowReducer(s, { type: 'dismiss' });
    expect(cancelled).toEqual(idleFlow);
    expect(flowReducer(cancelled, { type: 'settled', scanId: 's2', result: admitted, at: 1 })).toBe(
      cancelled,
    );
  });

  it('a failure shows as failed, not as a result', () => {
    const s = flowReducer(idleFlow, { type: 'start', scanId: 's1', token: 't' });
    expect(flowReducer(s, { type: 'failed', scanId: 's1', code: 'unauthorized' })).toMatchObject({
      kind: 'failed',
      code: 'unauthorized',
    });
  });

  it('dismiss returns to idle from a card', () => {
    const s = flowReducer(flowReducer(idleFlow, { type: 'start', scanId: 's1', token: 't' }), {
      type: 'settled',
      scanId: 's1',
      result: admitted,
      at: 5,
    });
    expect(s).toMatchObject({ kind: 'card', at: 5 });
    expect(flowReducer(s, { type: 'dismiss' })).toEqual(idleFlow);
  });
});
