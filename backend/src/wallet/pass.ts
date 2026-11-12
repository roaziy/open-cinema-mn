import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PKPass } from 'passkit-generator';
import { type Env, env } from '../env';
import { BACKEND_ROOT } from '../lib/paths';
import { avoidOrange, type TicketView, UB_OFFSET_MS } from '../shared';
import { walletStrip } from './strip';

const MODEL = path.join(BACKEND_ROOT, 'src/wallet/model/OpenCinema.pass');

export type WalletConfig = {
  passTypeId: string;
  teamId: string;
  orgName: string;
  signerCertPath: string;
  signerKeyPath: string;
  signerKeyPassphrase: string | undefined;
  wwdrPath: string;
};

let warned = false;

/** Read per call, never at startup: a missing certificate only disables the Wallet endpoint. */
export function walletConfig(source: Env = env): WalletConfig | null {
  const {
    WALLET_PASS_TYPE_ID: passTypeId,
    WALLET_TEAM_ID: teamId,
    WALLET_SIGNER_CERT_PATH: signerCertPath,
    WALLET_SIGNER_KEY_PATH: signerKeyPath,
    WALLET_WWDR_PATH: wwdrPath,
  } = source;
  const set = [passTypeId, teamId, signerCertPath, signerKeyPath, wwdrPath].filter(Boolean).length;
  if (set < 5) {
    if (set > 0 && !warned) {
      warned = true;
      console.warn('Wallet is partly configured (some WALLET_* variables are missing); disabled');
    }
    return null;
  }
  if (!passTypeId || !teamId || !signerCertPath || !signerKeyPath || !wwdrPath) return null;
  return {
    passTypeId,
    teamId,
    orgName: source.WALLET_ORG_NAME,
    signerCertPath,
    signerKeyPath,
    signerKeyPassphrase: source.WALLET_SIGNER_KEY_PASSPHRASE,
    wwdrPath,
  };
}

/** Certificates or the model could not be loaded; the endpoint answers 503, not 500. */
export class WalletUnavailableError extends Error {}

// Loaded once per distinct config and kept in memory; a failed load is retried on the next request.
const templates = new Map<string, Promise<PKPass>>();

function loadTemplate(cfg: WalletConfig): Promise<PKPass> {
  const key = JSON.stringify(cfg);
  let cached = templates.get(key);
  if (!cached) {
    cached = (async () => {
      const [wwdr, signerCert, signerKey] = await Promise.all([
        readFile(cfg.wwdrPath),
        readFile(cfg.signerCertPath),
        readFile(cfg.signerKeyPath),
      ]);
      return PKPass.from(
        {
          model: MODEL,
          certificates: {
            wwdr,
            signerCert,
            signerKey,
            signerKeyPassphrase: cfg.signerKeyPassphrase,
          },
        },
        {
          passTypeIdentifier: cfg.passTypeId,
          teamIdentifier: cfg.teamId,
          organizationName: cfg.orgName,
          logoText: cfg.orgName,
        },
      );
    })();
    templates.set(key, cached);
    cached.catch(() => templates.delete(key));
  }
  return cached;
}

/** sRGB channel (0..255) to linear light, for WCAG luminance. */
const linear = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** Darkest the film colour may be before white text loses its punch; darker reads as cinema. */
const MAX_LUMINANCE = 0.035;

/**
 * Pass colours from the film's tone: the tone (never orange) darkened until white text reads
 * well on it, with labels in a soft tint of the same colour.
 */
export function passColours(tone: string): { background: string; label: string; hex: string } {
  const safe = avoidOrange(tone).replace('#', '');
  let [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(safe.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
  const lum = () => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  // Whole channel values throughout, so the check sees the exact colour that ships.
  while (lum() > MAX_LUMINANCE)
    [r, g, b] = [r, g, b].map((c) => Math.floor(c * 0.92)) as [number, number, number];
  const mix = (c: number) => Math.round(c + (255 - c) * 0.6);
  const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  return {
    background: `rgb(${r}, ${g}, ${b})`,
    label: `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`,
    hex,
  };
}

/** An instant as Ulaanbaatar wall-clock time with its offset, e.g. 2026-11-12T14:45:00+08:00. */
export const ubIso = (instant: string): string =>
  `${new Date(Date.parse(instant) + UB_OFFSET_MS).toISOString().slice(0, 19)}+08:00`;

/** "12.11 · 14:45": day.month and 24-hour time in Ulaanbaatar, for the pass header. */
export const headerTime = (instant: string): string => {
  const [date, time] = ubIso(instant).split('T') as [string, string];
  const [, month, day] = date.split('-');
  return `${day}.${month} · ${time.slice(0, 5)}`;
};

export async function buildPass(cfg: WalletConfig, t: TicketView): Promise<Buffer> {
  let template: PKPass;
  try {
    template = await loadTemplate(cfg);
  } catch (err) {
    console.error('wallet certificates or model could not be loaded', err);
    throw new WalletUnavailableError();
  }
  const colours = passColours(t.movie.tone);
  const pass = await PKPass.from(template, {
    serialNumber: t.id,
    description: `${t.movie.title} ticket`,
    backgroundColor: colours.background,
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor: colours.label,
  });
  // The banner (else the poster) under the header, blurring into the pass colour.
  const strip = await walletStrip(t.movie.backdropUrl ?? t.movie.posterUrl, colours.hex);
  if (strip) {
    pass.addBuffer('strip.png', strip.x1);
    pass.addBuffer('strip@2x.png', strip.x2);
    pass.addBuffer('strip@3x.png', strip.x3);
  }
  // Compact 24-hour Ulaanbaatar time: a locale-formatted date and time does not fit beside the logo.
  pass.headerFields.push({
    key: 'when',
    label: 'Showtime',
    value: headerTime(t.showtime.startsAt),
    textAlignment: 'PKTextAlignmentRight',
  });
  pass.secondaryFields.push({
    key: 'movie',
    label: `Movie · ${t.showtime.format}`,
    value: t.movie.title,
  });
  pass.auxiliaryFields.push(
    { key: 'branch', label: 'Branch', value: t.branch.name },
    { key: 'hall', label: 'Hall', value: t.hallName },
    {
      key: 'seat',
      label: 'Seat',
      value: `${t.seat.rowLabel}${t.seat.number}`,
      textAlignment: 'PKTextAlignmentRight',
    },
  );
  // Wallet-only holders can still be admitted by hand: the door types the order number and code.
  pass.backFields.push(
    { key: 'order', label: 'Order number', value: t.orderNo },
    { key: 'checkCode', label: 'Check code', value: t.checkCode },
    { key: 'address', label: 'Address', value: t.branch.address },
  );
  pass.setBarcodes({
    message: t.qrToken,
    format: 'PKBarcodeFormatQR',
    messageEncoding: 'iso-8859-1',
    altText: `Code ${t.checkCode}`,
  });
  const start = new Date(t.showtime.startsAt);
  pass.setRelevantDate(start);
  // iOS 18 replaced relevantDate with intervals
  pass.setRelevantDates([
    { startDate: start, endDate: new Date(start.getTime() + t.movie.durationMin * 60_000) },
  ]);
  pass.setLocations({ latitude: t.branch.lat, longitude: t.branch.lng });
  return pass.getAsBuffer();
}
