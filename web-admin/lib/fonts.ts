import 'server-only';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Gilroy (GIP) is a commercial font and is never committed. If ADMIN_FONT_DIR points at the local
 * files they are served from this app; otherwise the page uses Onest only.
 */
export const GILROY_FILES = {
  '400': 'GIP-Regular.otf',
  '500': 'GIP-Medium.otf',
  '600': 'GIP-SemiBold.otf',
} as const;

export type GilroyWeight = keyof typeof GILROY_FILES;

export function gilroyPath(weight: GilroyWeight): string | null {
  const dir = process.env.ADMIN_FONT_DIR;
  if (!dir) return null;
  const file = join(/* turbopackIgnore: true */ dir, GILROY_FILES[weight]);
  return existsSync(file) ? file : null;
}

let css: string | null | undefined;

/** `@font-face` rules for the weights found on disk, or null when Gilroy is not available. */
export function gilroyCss(): string | null {
  if (css !== undefined) return css;
  const faces = (Object.keys(GILROY_FILES) as GilroyWeight[])
    .filter((w) => gilroyPath(w))
    .map(
      (w) =>
        `@font-face{font-family:'GIP';font-weight:${w};font-style:normal;font-display:swap;src:url('/fonts/gip/${w}') format('opentype')}`,
    );
  css = faces.length ? faces.join('') : null;
  return css;
}
