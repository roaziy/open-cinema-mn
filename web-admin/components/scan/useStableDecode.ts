'use client';

import type { BarcodeDetector } from 'barcode-detector/ponyfill';
import { useEffect, useRef, useState } from 'react';
import { advance, type Detected, initialStable, type Rect } from '@/lib/scan/stable';

const FRAME_MS = 100;
const LOAD_TRIES = 3;
const FAILS_BEFORE_REPORT = 5;
const SLOW_MS = 2000;

let detector: Promise<BarcodeDetector> | null = null;

/** One detector for the page; the decoder's wasm comes from our own origin (see copy-zxing.mjs). */
function getDetector(): Promise<BarcodeDetector> {
  if (!detector) {
    const loading = import('barcode-detector/ponyfill').then(async (m) => {
      m.setZXingModuleOverrides({
        locateFile: (path: string, prefix: string) =>
          path.endsWith('.wasm') ? '/zxing/zxing_reader.wasm' : prefix + path,
      });
      // Load the wasm now, so a missing file fails here (decoder) and not as a camera problem.
      await m.prepareZXingModule({ fireImmediately: true });
      return new m.BarcodeDetector({ formats: ['qr_code'] });
    });
    // A failed load is not cached: the next attempt starts over.
    loading.catch(() => {
      if (detector === loading) detector = null;
    });
    detector = loading;
  }
  return detector;
}

type Options = {
  /** A request or a result card is up (or manual entry is open): nothing is read. */
  paused: boolean;
  onStable: (token: string) => void;
  /** The decoder cannot load or keeps failing; cleared again by the next good frame. */
  onDecoder?: (ok: boolean) => void;
};

/**
 * Reads QR codes from a live video, about 10 times a second, and reports a token only when the
 * guards in `lib/scan/stable.ts` agree: centre inside the scan frame, the same value on 3 frames
 * in a row, and not the token that was just read. A failing frame is retried with backoff and
 * never ends scanning for good.
 */
export function useStableDecode(
  video: HTMLVideoElement | null,
  roi: Rect | null,
  { paused, onStable, onDecoder }: Options,
): { value: string | null } {
  const [value, setValue] = useState<string | null>(null);
  const live = useRef({ roi, paused, onStable, onDecoder });
  live.current = { roi, paused, onStable, onDecoder };

  useEffect(() => {
    if (!video) return;
    let stop = false;
    let state = initialStable;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fails = 0;
    let reported = false;

    const report = (ok: boolean) => {
      if (ok === !reported) return;
      reported = !ok;
      live.current.onDecoder?.(ok);
    };

    const loadDetector = async (): Promise<BarcodeDetector | null> => {
      for (let i = 0; i < LOAD_TRIES && !stop; i++) {
        try {
          return await getDetector();
        } catch {
          await new Promise((r) => setTimeout(r, 400 * 2 ** i));
        }
      }
      return null;
    };

    const tick = async () => {
      const started = performance.now();
      let codes: Detected[] = [];
      let delay = FRAME_MS;
      if (!live.current.paused && video.readyState >= 2 && video.videoWidth > 0) {
        const d = await loadDetector();
        if (stop) return;
        if (!d) {
          report(false);
          delay = SLOW_MS;
        } else {
          try {
            const found = await d.detect(video);
            fails = 0;
            report(true);
            codes = found.map((f) => ({
              value: f.rawValue,
              box: {
                x: f.boundingBox.x,
                y: f.boundingBox.y,
                width: f.boundingBox.width,
                height: f.boundingBox.height,
              },
            }));
          } catch {
            fails++;
            if (fails >= FAILS_BEFORE_REPORT) report(false);
            delay = Math.min(SLOW_MS, FRAME_MS * 2 ** Math.min(fails, 5));
          }
        }
      }
      if (stop) return;
      // Pause and frame are read again after the awaits: they may have changed meanwhile.
      const r = advance(state, {
        codes,
        roi: live.current.roi,
        now: performance.now(),
        paused: live.current.paused,
      });
      state = r.state;
      if (r.emit) {
        setValue(r.emit);
        live.current.onStable(r.emit);
      }
      timer = setTimeout(tick, Math.max(0, delay - (performance.now() - started)));
    };
    timer = setTimeout(tick, FRAME_MS);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [video]);

  return { value };
}
