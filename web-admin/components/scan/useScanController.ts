'use client';

import type { ScanResult } from '@open-cinema/shared';
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { call, messageOf } from '@/lib/client-api';
import { type ControllerState, ScanController } from '@/lib/scan/controller';
import { idleFlow } from '@/lib/scan/flow';
import { newId } from '@/lib/scan/ids';
import { signal } from './sounds';

const SEND_TIMEOUT_MS = 6000;
const UNDO_TIMEOUT_MS = 8000;
const idle: ControllerState = { flow: idleFlow, undoing: null, notice: null };
const noop = () => () => {};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Handlers = {
  onResult: (r: ScanResult) => void;
  onUndone: (scanId: string) => void;
  doorLabel: () => string | undefined;
};

/** React binding for `ScanController`: one per phone, state read through an external store. */
export function useScanController(deviceId: string | null, handlers: Handlers) {
  const h = useRef(handlers);
  h.current = handlers;

  const controller = useMemo(
    () =>
      deviceId
        ? new ScanController({
            deviceId,
            doorLabel: () => h.current.doorLabel(),
            // A stalled request counts as a lost one: retried with the same scan id.
            send: (body) => call('POST', '/staff/scan', body, { timeoutMs: SEND_TIMEOUT_MS }),
            sleep,
            newId,
            undo: (scanId) =>
              call('POST', `/staff/scan/${scanId}/undo`, undefined, { timeoutMs: UNDO_TIMEOUT_MS }),
            errorText: messageOf,
            signal,
            onResult: (r) => h.current.onResult(r),
            onUndone: (id) => h.current.onUndone(id),
          })
        : null,
    [deviceId],
  );
  useEffect(() => () => controller?.dispose(), [controller]);

  const state = useSyncExternalStore(
    controller?.subscribe ?? noop,
    controller?.getSnapshot ?? (() => idle),
    () => idle,
  );
  return { state, controller };
}
