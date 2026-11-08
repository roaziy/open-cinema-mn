'use client';

import { CaretLeft, Keyboard } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call, messageOf } from '@/lib/client-api';
import { errorMessage } from '@/lib/errors-mn';
import { cardFor } from '@/lib/scan/card';
import { deviceId as readDeviceId } from '@/lib/scan/ids';
import { frameToVideoRect, scanFrame } from '@/lib/scan/stable';
import { ManualEntry } from './ManualEntry';
import { RecentStrip } from './RecentStrip';
import { ResultCard } from './ResultCard';
import { signal, unlockAudio } from './sounds';
import { useRecent } from './useRecent';
import { useScanFlow } from './useScanFlow';
import { useStableDecode } from './useStableDecode';

type Camera = 'off' | 'starting' | 'on' | 'denied' | 'insecure' | 'failed';
type Size = { width: number; height: number };

const AUTO_CLOSE_MS = 4500;

function FrameBrackets({ color }: { color: string }) {
  const corner = `absolute size-9 border-[4px] ${color}`;
  return (
    <>
      <span
        aria-hidden
        className={`${corner} top-0 left-0 rounded-tl-[14px] border-r-0 border-b-0`}
      />
      <span
        aria-hidden
        className={`${corner} top-0 right-0 rounded-tr-[14px] border-b-0 border-l-0`}
      />
      <span
        aria-hidden
        className={`${corner} bottom-0 left-0 rounded-bl-[14px] border-t-0 border-r-0`}
      />
      <span
        aria-hidden
        className={`${corner} right-0 bottom-0 rounded-br-[14px] border-t-0 border-l-0`}
      />
    </>
  );
}

/** Full-bleed door scanner: live camera, one scan frame, the answer as a card over it. */
export function Scanner() {
  const [camera, setCamera] = useState<Camera>('off');
  const [started, setStarted] = useState(false);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [box, setBox] = useState<Size>({ width: 0, height: 0 });
  const [videoSize, setVideoSize] = useState<Size | null>(null);
  const [manual, setManual] = useState(false);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [device, setDevice] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => setDevice(readDeviceId()), []);

  const recent = useRecent(device);
  const { flow, scan, dismiss } = useScanFlow(device, recent.add);

  // Measure the screen so the scan frame can be mapped into the camera's own pixels.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const read = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frame = useMemo(() => scanFrame(box.width, box.height), [box]);
  const roi = useMemo(
    () => (videoSize && box.width > 0 ? frameToVideoRect(box, videoSize, frame) : null),
    [box, videoSize, frame],
  );

  useEffect(() => {
    if (!video || !stream) return;
    video.srcObject = stream;
    const meta = () => setVideoSize({ width: video.videoWidth, height: video.videoHeight });
    video.addEventListener('loadedmetadata', meta);
    if (video.readyState >= 1) meta();
    void video.play().catch(() => setCamera('failed'));
    return () => video.removeEventListener('loadedmetadata', meta);
  }, [video, stream]);

  useEffect(
    () => () => {
      for (const t of stream?.getTracks() ?? []) t.stop();
    },
    [stream],
  );

  const start = useCallback(async () => {
    // Audio first: it only unlocks inside this tap.
    unlockAudio();
    setStarted(true);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera(window.isSecureContext ? 'failed' : 'insecure');
      return;
    }
    setCamera('starting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      setStream(s);
      setCamera('on');
    } catch (err) {
      setCamera((err as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'failed');
    }
  }, []);

  const paused = flow.kind !== 'idle' || manual || camera !== 'on';
  useStableDecode(video, roi, { paused, onStable: scan, onError: () => setCamera('failed') });

  // Quick outcomes close themselves so the line keeps moving; a reject waits to be read.
  useEffect(() => {
    if (flow.kind !== 'card' || cardFor(flow.result).tone === 'reject') return;
    const t = setTimeout(dismiss, AUTO_CLOSE_MS);
    return () => clearTimeout(t);
  }, [flow, dismiss]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const undo = useCallback(
    async (scanId: string) => {
      setUndoing(scanId);
      try {
        await call('POST', `/staff/scan/${scanId}/undo`);
        recent.markUndone(scanId);
        if (flow.kind === 'card' && flow.result.scanId === scanId) dismiss();
        signal('repeat');
        setNotice('Буцаалаа. Тасалбар дахин хүчинтэй.');
      } catch (err) {
        setNotice(messageOf(err));
      } finally {
        setUndoing(null);
      }
    },
    [flow, dismiss, recent],
  );

  const submitManual = (token: string) => {
    if (scan(token)) setManual(false);
  };

  const retrying = flow.kind === 'sending' && flow.retry !== null;
  const sending = flow.kind === 'sending';
  const bracket = sending ? 'border-action' : 'border-white/85';

  return (
    <div ref={root} className="fixed inset-0 overflow-hidden bg-black">
      <video
        ref={setVideo}
        playsInline
        muted
        autoPlay
        className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${camera === 'on' ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* Scan frame: everything outside it is dimmed, the corners say where to hold the QR. */}
      <div
        aria-hidden={!started}
        className="pointer-events-none absolute rounded-[18px]"
        style={{
          left: frame.x,
          top: frame.y,
          width: frame.width,
          height: frame.height,
          boxShadow: `0 0 0 100vmax rgb(0 0 0 / ${camera === 'on' ? 0.5 : 0})`,
        }}
      >
        <FrameBrackets color={bracket} />
      </div>

      <p
        className="pointer-events-none absolute inset-x-0 text-center text-[16px] font-medium text-white/85"
        style={{ top: frame.y + frame.height + 18 }}
      >
        {retrying
          ? ''
          : sending
            ? 'Шалгаж байна…'
            : camera === 'on'
              ? 'QR кодыг хүрээнд байрлуулна уу'
              : ''}
      </p>

      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Link
          href="/staff"
          aria-label="Өнөөдрийн сеанс руу буцах"
          className="focus-ring flex size-12 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur"
        >
          <CaretLeft size={24} weight="bold" />
        </Link>
        <p className="rounded-full bg-black/55 px-4 py-2 text-[15px] font-medium text-white backdrop-blur">
          Билет шалгах
        </p>
        <button
          type="button"
          aria-label="Кодыг гараар оруулах"
          onClick={() => setManual(true)}
          className="focus-ring flex size-12 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur"
        >
          <Keyboard size={24} weight="fill" />
        </button>
      </header>

      {notice && (
        <p
          role="status"
          className="absolute inset-x-4 top-[calc(max(0.75rem,env(safe-area-inset-top))+4rem)] z-10 rounded-panel border border-hairline bg-raised px-4 py-3 text-center text-[16px] text-ink"
        >
          {notice}
        </p>
      )}

      {!started && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-3 px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <p className="text-center text-[16px] text-body">
            Камер болон дууг асаана. Хаалган дээр утсаа босоо барина уу.
          </p>
          <button
            type="button"
            onClick={start}
            className="focus-ring h-16 rounded-panel bg-action text-[20px] font-semibold text-white active:bg-action-hover"
          >
            Эхлэх
          </button>
        </div>
      )}

      {started && camera !== 'on' && camera !== 'starting' && (
        <div
          role="alert"
          className="absolute inset-x-4 z-10 rounded-panel border border-hairline bg-raised p-4"
          style={{ top: frame.y + frame.height + 18 }}
        >
          <p className="text-[17px] font-semibold text-ink">
            {camera === 'denied'
              ? 'Камерын зөвшөөрөл олгогдоогүй'
              : camera === 'insecure'
                ? 'Камер зөвхөн HTTPS холболтоор ажиллана'
                : 'Камер ажиллахгүй байна'}
          </p>
          <p className="mt-1 text-[15px] text-body">
            {camera === 'denied'
              ? 'Хөтчийн тохиргооноос энэ сайтад камер ашиглахыг зөвшөөрнө үү.'
              : 'Кодыг гараар оруулж болно.'}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={start}
              className="focus-ring h-12 flex-1 rounded-card bg-action text-[16px] font-semibold text-white"
            >
              Дахин оролдох
            </button>
            <button
              type="button"
              onClick={() => setManual(true)}
              className="focus-ring h-12 flex-1 rounded-card bg-fill text-[16px] font-semibold text-ink"
            >
              Гараар оруулах
            </button>
          </div>
        </div>
      )}

      {started && flow.kind === 'idle' && !manual && (
        <div className="absolute inset-x-0 bottom-0 z-10 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <RecentStrip items={recent.items} undoing={undoing} onUndo={undo} />
        </div>
      )}

      {retrying && (
        <section
          aria-live="polite"
          className="animate-rise absolute inset-x-0 bottom-0 z-20 flex flex-col gap-4 rounded-t-rail border-t border-hairline bg-raised px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        >
          <h2 className="text-[22px] font-semibold leading-tight text-ink">
            {flow.retry === 'network'
              ? 'Сүлжээ алга, дахин оролдож байна'
              : 'Сервер завгүй, дахин оролдож байна'}
          </h2>
          <p className="text-[17px] text-body">
            Холбогдтол тасалбарыг оруулахгүй. Хүлээж байгаад дахин уншуулж болно.
          </p>
          <button
            type="button"
            onClick={dismiss}
            className="focus-ring h-16 rounded-panel bg-fill text-[18px] font-semibold text-ink"
          >
            Болих
          </button>
        </section>
      )}

      {flow.kind === 'failed' && (
        <section
          role="alert"
          className="animate-rise absolute inset-x-0 bottom-0 z-20 flex flex-col gap-4 rounded-t-rail border-t border-hairline bg-raised px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        >
          <h2 className="text-[22px] font-semibold leading-tight text-ink">Уншиж чадсангүй</h2>
          <p className="text-[17px] text-body">{errorMessage(flow.code)}</p>
          <button
            type="button"
            onClick={dismiss}
            className="focus-ring h-16 rounded-panel bg-action text-[18px] font-semibold text-white"
          >
            Хаах
          </button>
        </section>
      )}

      {flow.kind === 'card' && (
        <ResultCard
          result={flow.result}
          undoing={undoing === flow.result.scanId}
          onClose={dismiss}
          onUndo={undo}
        />
      )}

      {manual && <ManualEntry onSubmit={submitManual} onClose={() => setManual(false)} />}
    </div>
  );
}
