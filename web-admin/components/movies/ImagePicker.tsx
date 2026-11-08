'use client';

import { CircleNotch, UploadSimple } from '@phosphor-icons/react/dist/ssr';
import { useId, useRef, useState } from 'react';
import { imageProblem, messageOf, uploadImage } from '@/lib/client-api';

/**
 * Click-to-pick image slot (one tab stop: the button; the file input is only opened by it). Shows
 * the local file straight away, uploads in the background and hands the stored URL, and the raw
 * file for tone sampling, to the parent. `onBusy` lets the parent hold Save while a file is going up.
 */
export function ImagePicker({
  label,
  url,
  aspect,
  onUploaded,
  onError,
  onBusy,
}: {
  label: string;
  url: string | null;
  aspect: string;
  onUploaded: (url: string, file: File) => void;
  onError: (message: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const labelId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = local ?? url;

  async function pick(file: File | undefined) {
    if (!file) return;
    const problem = imageProblem(file);
    if (problem) {
      onError(problem);
      if (input.current) input.current.value = '';
      return;
    }
    const preview = URL.createObjectURL(file);
    setLocal((old) => {
      if (old) URL.revokeObjectURL(old);
      return preview;
    });
    setBusy(true);
    onBusy(true);
    try {
      onUploaded(await uploadImage(file), file);
    } catch (err) {
      onError(messageOf(err));
      setLocal(null);
    } finally {
      setBusy(false);
      onBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div>
      <span id={labelId} className="mb-1.5 block text-[13px] font-medium text-body">
        {label}
      </span>
      <button
        type="button"
        aria-labelledby={labelId}
        aria-busy={busy}
        disabled={busy}
        onClick={() => input.current?.click()}
        className={`focus-ring group relative block w-full overflow-hidden rounded-card border border-dashed border-white/15 bg-canvas transition-colors hover:border-white/30 ${aspect}`}
      >
        {shown ? (
          // biome-ignore lint/performance/noImgElement: local preview of a just-picked file
          <img src={shown} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-muted">
            <UploadSimple size={22} />
            <span className="text-[13px]">Зураг сонгох</span>
          </span>
        )}
        {shown && (
          <span className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-1.5 text-left text-[12px] text-ink opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            Солих
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/55">
            <CircleNotch size={22} className="animate-spin text-ink" aria-label="Байршуулж байна" />
          </span>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </div>
  );
}
