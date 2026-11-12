'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { call } from '@/lib/client-api';
import { mapRecent, type RecentScan } from '@/lib/scan/recent';
import { type ScanResult, ScanResultSchema } from '@/lib/shared';

export type { RecentScan };

const MAX = 10;
const List = z.array(ScanResultSchema);

/** This phone's last scans: loaded once, then kept in step with what the screen does. */
export function useRecent(deviceId: string | null) {
  const [items, setItems] = useState<RecentScan[]>([]);

  useEffect(() => {
    if (!deviceId) return;
    let live = true;
    call('GET', `/staff/scans/recent?deviceId=${deviceId}`)
      .then((raw) => {
        const parsed = List.safeParse(raw);
        if (live && parsed.success) setItems(mapRecent(parsed.data));
      })
      .catch(() => {
        // The strip is a convenience; scanning works without it.
      });
    return () => {
      live = false;
    };
  }, [deviceId]);

  const add = useCallback((result: ScanResult) => {
    setItems((all) =>
      [{ result, undone: false }, ...all.filter((x) => x.result.scanId !== result.scanId)].slice(
        0,
        MAX,
      ),
    );
  }, []);

  const markUndone = useCallback((scanId: string) => {
    setItems((all) =>
      all.map((x) =>
        x.result.scanId === scanId ? { undone: true, result: { ...x.result, undoUntil: null } } : x,
      ),
    );
  }, []);

  return { items, add, markUndone };
}
