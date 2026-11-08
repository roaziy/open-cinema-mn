'use client';

import { type BarcodeDetector, setZXingModuleOverrides } from 'barcode-detector/ponyfill';
import { useEffect, useRef, useState } from 'react';
import { advance, type Detected, initialStable, type Rect } from '@/lib/scan/stable';

const FRAME_MS = 100;

let detector: Promise<BarcodeDetector> | null = null;

/** One detector for the page; the decoder's wasm comes from our own origin (see copy-zxing.mjs). */
function getDetector(): Promise<BarcodeDetector> {
  detector ??= import('barcode-detector/ponyfill').then((m) => {
    setZXingModuleOverrides({
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? '/zxing/zxing_reader.wasm' : prefix + path,
    });
    return new m.BarcodeDetector({ formats: ['qr_code'] });
  });
  detector.catch(() => {
    detector = null;
  });
  return detector;
}

type Options = {
  /** A request or a result card is up (or manual entry is open): nothing is read. */
  paused: boolean;
  onStable: (token: string) => void;
  /** Reports a decoder that failed to load, so the screen can say so instead of staying blind. */
  onError?: () => void;
};

/**
 * Reads QR codes from a live video, about 10 times a second, and reports a token only when the
 * guards in `lib/scan/stable.ts` agree: centre inside the scan frame, the same value on 3 frames
 * in a row, and not the token that was just read.
 */
export function useStableDecode(
  video: HTMLVideoElement | null,
  roi: Rect | null,
  { paused, onStable, onError }: Options,
): { value: string | null } {
  const [value, setValue] = useState<string | null>(null);
  const live = useRef({ roi, paused, onStable, onError });
  live.current = { roi, paused, onStable, onError };

  useEffect(() => {
    if (!video) return;
    let stop = false;
    let state = initialStable;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const started = performance.now();
      let codes: Detected[] = [];
      if (!live.current.paused && video.readyState >= 2 && video.videoWidth > 0) {
        try {
          const found = await (await getDetector()).detect(video);
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
          live.current.onError?.();
        }
      }
      if (stop) return;
      // Pause and frame are read again after the await: they may have changed meanwhile.
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
      timer = setTimeout(tick, Math.max(0, FRAME_MS - (performance.now() - started)));
    };
    timer = setTimeout(tick, FRAME_MS);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [video]);

  return { value };
}
