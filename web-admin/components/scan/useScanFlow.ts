'use client';

import type { ScanResult } from '@open-cinema/shared';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { call } from '@/lib/client-api';
import { cardFor } from '@/lib/scan/card';
import { flowReducer, idleFlow } from '@/lib/scan/flow';
import { newId } from '@/lib/scan/ids';
import { sendScan } from '@/lib/scan/send';
import { signal } from './sounds';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * One scan at a time. `scan` is the only way to start a request; while one is running or a card
 * is up it returns false, so a second read can never overlap the first. A cancelled scan's late
 * answer is dropped.
 */
export function useScanFlow(deviceId: string | null, onResult: (r: ScanResult) => void) {
  const [flow, dispatch] = useReducer(flowReducer, idleFlow);
  const busy = useRef(false);
  const generation = useRef(0);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const scan = useCallback(
    (token: string): boolean => {
      if (busy.current || !deviceId) return false;
      busy.current = true;
      const scanId = newId();
      const mine = ++generation.current;
      dispatch({ type: 'start', scanId, token });
      void sendScan(
        { token, scanId, deviceId },
        {
          send: (body) => call('POST', '/staff/scan', body),
          sleep,
          onRetry: (reason) => dispatch({ type: 'retrying', scanId, reason }),
          isCancelled: () => generation.current !== mine,
        },
      ).then((out) => {
        if (out.kind === 'cancelled' || generation.current !== mine) return;
        if (out.kind === 'failed') {
          signal('repeat');
          dispatch({ type: 'failed', scanId, code: out.code });
          return;
        }
        signal(cardFor(out.result).sound);
        dispatch({ type: 'settled', scanId, result: out.result, at: Date.now() });
        onResultRef.current(out.result);
      });
      return true;
    },
    [deviceId],
  );

  const dismiss = useCallback(() => {
    generation.current++;
    busy.current = false;
    dispatch({ type: 'dismiss' });
  }, []);

  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  return { flow, scan, dismiss };
}
