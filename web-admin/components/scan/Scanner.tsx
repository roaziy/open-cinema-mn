'use client';

import { ChevronLeft, Keyboard, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage } from '@/lib/errors-mn';
import { cardFor } from '@/lib/scan/card';
import { readDoorLabel, saveDoorLabel } from '@/lib/scan/door';
import { needsRestart } from '@/lib/scan/health';
import { deviceId as readDeviceId } from '@/lib/scan/ids';
import { frameToVideoRect, scanFrame } from '@/lib/scan/stable';
import { DoorLabelForm } from './DoorLabelForm';
import { ManualEntry } from './ManualEntry';
import { RecentStrip } from './RecentStrip';
import { ResultCard } from './ResultCard';
import { audioState, unlockAudio } from './sounds';
import { useRecent } from './useRecent';
import { useScanController } from './useScanController';
import { useStableDecode } from './useStableDecode';

type Camera = 'off' | 'starting' | 'on' | 'denied' | 'insecure' | 'failed';
type Size = { width: number; height: number };

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

const PILL = 'rounded-full bg-black/60 px-4 py-2 text-[16px] font-medium text-white backdrop-blur';

/** Full-bleed door scanner: live camera, one scan frame, the answer as a card over it. */
export function Scanner() {
  const [camera, setCamera] = useState<Camera>('off');
  const [started, setStarted] = useState(false);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [box, setBox] = useState<Size>({ width: 0, height: 0 });
  const [videoSize, setVideoSize] = useState<Size | null>(null);
  const [sheet, setSheet] = useState<'manual' | 'door' | null>(null);
  const [decoderDown, setDecoderDown] = useState(false);
  const [device, setDevice] = useState<string | null>(null);
  const [door, setDoor] = useState('');
  const doorRef = useRef('');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDevice(readDeviceId());
    const saved = readDoorLabel();
    setDoor(saved);
    doorRef.current = saved;
  }, []);

  const recent = useRecent(device);
  const { state, controller } = useScanController(device, {
    onResult: recent.add,
    onUndone: recent.markUndone,
    doorLabel: () => doorRef.current || undefined,
  });
  const { flow, undoing, notice, via } = state;
  const [manualHint, setManualHint] = useState<string | null>(null);

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
    // Rotation changes the picture's size without changing the container's.
    const meta = () => setVideoSize({ width: video.videoWidth, height: video.videoHeight });
    video.addEventListener('loadedmetadata', meta);
    video.addEventListener('resize', meta);
    if (video.readyState >= 1) meta();
    void video.play().catch(() => setCamera('failed'));
    return () => {
      video.removeEventListener('loadedmetadata', meta);
      video.removeEventListener('resize', meta);
    };
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
    setDecoderDown(false);
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

  // After a lock or a tab switch, iOS may have suspended the sound or ended the camera. Go back
  // to the "Эхлэх" tap, which restores both, rather than look live while blind or mute.
  useEffect(() => {
    if (!started) return;
    const check = () => {
      if (document.visibilityState !== 'visible' || camera === 'starting') return;
      const tracks = stream?.getVideoTracks() ?? [];
      if (camera === 'on' && needsRestart({ audio: audioState(), tracks })) {
        for (const t of tracks) t.stop();
        setStream(null);
        setVideoSize(null);
        setCamera('off');
        setStarted(false);
      }
    };
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [started, camera, stream]);

  const busy = flow.kind !== 'idle';
  const paused = busy || sheet !== null || camera !== 'on';
  useStableDecode(video, roi, {
    paused,
    onStable: (token) => controller?.scan({ token }),
    onDecoder: (ok) => setDecoderDown(!ok),
  });

  const saveDoor = (label: string) => {
    const clean = saveDoorLabel(label);
    setDoor(clean);
    doorRef.current = clean;
    setSheet(null);
  };

  const submitManual = (input: { orderNo: string; seat: string; checkCode: string }) => {
    if (!controller) return;
    // A finished card or failure is closed for the typed ticket; a request still running is not
    // cut short, and what was typed stays on screen.
    if (flow.kind === 'card' || flow.kind === 'failed') controller.dismiss();
    if (controller.scan(input)) {
      setManualHint(null);
      setSheet(null);
    } else {
      setManualHint('Өмнөх уншилт дуусаагүй байна. Түр хүлээгээд дахин дарна уу.');
    }
  };

  const retrying = flow.kind === 'sending' && flow.retry !== null;
  const sending = flow.kind === 'sending';
  const bracket = sending ? 'border-action' : 'border-white/85';
  const cardInfo = flow.kind === 'card' ? cardFor(flow.result, via ?? undefined) : null;
  const announce =
    flow.kind === 'card' && cardInfo
      ? `${cardInfo.title}.${flow.result.ticket ? ` Суудал ${flow.result.ticket.seatCode}.` : ''}`
      : retrying
        ? 'Сүлжээ алга, дахин оролдож байна. Тасалбарыг оруулахгүй.'
        : flow.kind === 'failed'
          ? `Уншиж чадсангүй. ${errorMessage(flow.code)}`
          : (notice ?? '');

  return (
    <div ref={root} className="fixed inset-0 overflow-hidden bg-black">
      <div role="status" aria-live="assertive" className="sr-only">
        {announce}
      </div>

      <video
        ref={setVideo}
        playsInline
        muted
        autoPlay
        className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${camera === 'on' ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* Scan frame: everything outside it is dimmed, the corners say where to hold the QR. */}
      <div
        aria-hidden
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

      {camera === 'on' && !retrying && !decoderDown && (
        <div
          className="pointer-events-none absolute inset-x-0 flex justify-center"
          style={{ top: frame.y + frame.height + 18 }}
        >
          <p className={PILL}>{sending ? 'Шалгаж байна…' : 'QR кодыг хүрээнд байрлуулна уу'}</p>
        </div>
      )}

      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Link
          href="/staff"
          aria-label="Өнөөдрийн сеанс руу буцах"
          className="focus-ring flex size-12 shrink-0 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur"
        >
          <ChevronLeft size={24} />
        </Link>
        <button
          type="button"
          onClick={() => setSheet('door')}
          aria-label="Хаалганы нэрийг солих"
          className={`${PILL} focus-ring flex min-h-12 min-w-0 items-center gap-2`}
        >
          <span className="truncate">{door || 'Хаалгаа нэрлэх'}</span>
          <Pencil size={16} className="shrink-0 opacity-70" />
        </button>
        <button
          type="button"
          aria-label="Кодыг гараар оруулах"
          onClick={() => setSheet('manual')}
          className="focus-ring flex size-12 shrink-0 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur"
        >
          <Keyboard size={24} />
        </button>
      </header>

      {notice && (
        <p
          aria-hidden
          className="absolute inset-x-4 top-[calc(max(0.75rem,env(safe-area-inset-top))+4rem)] z-10 rounded-panel border border-hairline bg-raised px-4 py-3 text-center text-[16px] text-ink"
        >
          {notice}
        </p>
      )}

      {!started && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-4 rounded-t-rail border-t border-hairline bg-raised px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {door ? (
            <>
              <p className="text-[16px] text-body">
                <span className="font-semibold text-ink">{door}</span>. Камер болон дууг асаана.
                Утсаа босоо барина уу.
              </p>
              <button
                type="button"
                onClick={start}
                className="focus-ring h-16 rounded-panel bg-action text-[20px] font-semibold text-white active:bg-action-hover"
              >
                Эхлэх
              </button>
            </>
          ) : (
            <DoorLabelForm
              initial=""
              submitLabel="Эхлэх"
              onSubmit={(l) => {
                saveDoor(l);
                void start();
              }}
            />
          )}
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
              : 'Захиалгын дугаар, суудлаар гараар оруулж болно.'}
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
              onClick={() => setSheet('manual')}
              className="focus-ring h-12 flex-1 rounded-card bg-fill text-[16px] font-semibold text-ink"
            >
              Гараар оруулах
            </button>
          </div>
        </div>
      )}

      {started && camera === 'on' && decoderDown && (
        <div
          role="alert"
          className="absolute inset-x-4 z-10 rounded-panel border border-hairline bg-raised p-4"
          style={{ top: frame.y + frame.height + 18 }}
        >
          <p className="text-[17px] font-semibold text-ink">Сканнер ачаалагдсангүй</p>
          <p className="mt-1 text-[15px] text-body">
            Хуудсыг шинэчилнэ үү, эсвэл захиалгын дугаар, суудлаар гараар оруулна уу.
          </p>
          <button
            type="button"
            onClick={() => setSheet('manual')}
            className="focus-ring mt-3 h-12 w-full rounded-card bg-fill text-[16px] font-semibold text-ink"
          >
            Гараар оруулах
          </button>
        </div>
      )}

      {started && flow.kind === 'idle' && sheet === null && (
        <div className="absolute inset-x-0 bottom-0 z-10 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <RecentStrip
            items={recent.items}
            undoing={undoing}
            onUndo={(id) => void controller?.undo(id)}
          />
        </div>
      )}

      {retrying && (
        <section className="animate-rise absolute inset-x-0 bottom-0 z-20 flex flex-col gap-4 rounded-t-rail border-t border-hairline bg-raised px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <h2 className="text-[22px] font-semibold leading-tight text-ink">
            {flow.kind === 'sending' && flow.retry === 'network'
              ? 'Сүлжээ алга, дахин оролдож байна'
              : 'Сервер завгүй, дахин оролдож байна'}
          </h2>
          <p className="text-[17px] text-body">
            Холбогдтол тасалбарыг оруулахгүй. Хүлээж байгаад дахин уншуулж болно.
          </p>
          <button
            type="button"
            onClick={() => controller?.dismiss()}
            className="focus-ring h-16 rounded-panel bg-fill text-[18px] font-semibold text-ink"
          >
            Болих
          </button>
        </section>
      )}

      {flow.kind === 'failed' && (
        <section className="animate-rise absolute inset-x-0 bottom-0 z-20 flex flex-col gap-4 rounded-t-rail border-t border-hairline bg-raised px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <h2 className="text-[22px] font-semibold leading-tight text-ink">Уншиж чадсангүй</h2>
          <p className="text-[17px] text-body">{errorMessage(flow.code)}</p>
          <button
            type="button"
            onClick={() => controller?.dismiss()}
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
          via={via ?? undefined}
          onClose={() => controller?.dismiss()}
          onUndo={(id) => void controller?.undo(id)}
        />
      )}

      {sheet === 'manual' && (
        <ManualEntry
          hint={manualHint}
          onSubmit={submitManual}
          onClose={() => {
            setManualHint(null);
            setSheet(null);
          }}
        />
      )}
      {sheet === 'door' && (
        <div className="animate-rise absolute inset-x-0 bottom-0 z-30 rounded-t-rail border-t border-hairline bg-raised px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <DoorLabelForm
            initial={door}
            submitLabel="Хадгалах"
            onSubmit={saveDoor}
            onCancel={() => setSheet(null)}
          />
        </div>
      )}
    </div>
  );
}
