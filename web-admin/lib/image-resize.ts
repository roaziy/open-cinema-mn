/**
 * Posters travel browser -> Vercel Function -> API, and Vercel rejects request bodies over 4.5 MB.
 * So the browser shrinks a picture before sending it: longest side at most 2400 px, re-encoded as
 * WebP (JPEG where WebP encoding is unavailable), and the result must stay under 4 MB.
 */
export const MAX_EDGE_PX = 2400;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** Largest file we are willing to decode in the browser at all. */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const QUALITY = 0.85;

export type Plan = { resize: false } | { resize: true; width: number; height: number };

/** Keep the file as is when it already fits; otherwise the size to draw it at. */
export function planResize(img: { width: number; height: number; size: number }): Plan {
  const longest = Math.max(img.width, img.height);
  if (longest <= MAX_EDGE_PX && img.size <= MAX_UPLOAD_BYTES) return { resize: false };
  const scale = longest > MAX_EDGE_PX ? MAX_EDGE_PX / longest : 1;
  return {
    resize: true,
    width: Math.max(1, Math.round(img.width * scale)),
    height: Math.max(1, Math.round(img.height * scale)),
  };
}

export const fitsUpload = (bytes: number): boolean => bytes <= MAX_UPLOAD_BYTES;

export class TooLargeError extends Error {}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/** The admin surface token (`--color-surface` in globals.css); the literal is its fallback. */
function surfaceColor(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim();
  return v || '#151517';
}

const rename = (name: string, type: string) =>
  `${name.replace(/\.[^.]+$/, '') || 'image'}.${type === 'image/webp' ? 'webp' : 'jpg'}`;

/**
 * The file to upload: the original when it already fits, else a downscaled re-encode.
 * Throws `TooLargeError` when even that is over the limit, and any other error when the image cannot be decoded.
 */
export async function prepareImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const plan = planResize({ width: bitmap.width, height: bitmap.height, size: file.size });
    if (!plan.resize) return file;
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas_unavailable');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, plan.width, plan.height);
    // Browsers that cannot encode WebP silently return a PNG, which is not smaller: ask for JPEG then.
    let blob = await encode(canvas, 'image/webp');
    if (blob?.type !== 'image/webp') {
      // JPEG has no alpha: paint the dark surface colour first so transparent areas do not turn black.
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = surfaceColor();
      ctx.fillRect(0, 0, plan.width, plan.height);
      ctx.globalCompositeOperation = 'source-over';
      blob = await encode(canvas, 'image/jpeg');
    }
    if (!blob) throw new Error('encode_failed');
    if (!fitsUpload(blob.size)) throw new TooLargeError();
    return new File([blob], rename(file.name, blob.type), { type: blob.type });
  } finally {
    bitmap.close();
  }
}
