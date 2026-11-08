import type { ScanResult } from '@open-cinema/shared';
import type { RetryReason } from './send';

/** What the scanner screen is doing. Decoding is allowed only while `idle`. */
export type Flow =
  | { kind: 'idle' }
  | { kind: 'sending'; scanId: string; token: string; retry: RetryReason | null }
  | { kind: 'card'; result: ScanResult; at: number }
  | { kind: 'failed'; scanId: string; code: string };

export const idleFlow: Flow = { kind: 'idle' };

export type FlowAction =
  | { type: 'start'; scanId: string; token: string }
  | { type: 'retrying'; scanId: string; reason: RetryReason }
  | { type: 'settled'; scanId: string; result: ScanResult; at: number }
  | { type: 'failed'; scanId: string; code: string }
  | { type: 'dismiss' };

export const isBusy = (f: Flow): boolean => f.kind !== 'idle';

export function flowReducer(state: Flow, a: FlowAction): Flow {
  switch (a.type) {
    case 'start':
      // One read at a time: a new token while a request or card is up is dropped.
      return state.kind === 'idle'
        ? { kind: 'sending', scanId: a.scanId, token: a.token, retry: null }
        : state;
    case 'retrying':
      return state.kind === 'sending' && state.scanId === a.scanId
        ? { ...state, retry: a.reason }
        : state;
    case 'settled':
      // Only the scan we are waiting for can put a card up.
      return state.kind === 'sending' && state.scanId === a.scanId
        ? { kind: 'card', result: a.result, at: a.at }
        : state;
    case 'failed':
      return state.kind === 'sending' && state.scanId === a.scanId
        ? { kind: 'failed', scanId: a.scanId, code: a.code }
        : state;
    case 'dismiss':
      return idleFlow;
  }
}
