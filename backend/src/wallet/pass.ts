import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PKPass } from 'passkit-generator';
import { type Env, env } from '../env';
import { BACKEND_ROOT } from '../lib/paths';
import { formatUbTime, type TicketView, ubDate } from '../shared';

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

export async function buildPass(cfg: WalletConfig, t: TicketView): Promise<Buffer> {
  let template: PKPass;
  try {
    template = await loadTemplate(cfg);
  } catch (err) {
    console.error('wallet certificates or model could not be loaded', err);
    throw new WalletUnavailableError();
  }
  const pass = await PKPass.from(template, {
    serialNumber: t.id,
    description: `${t.movie.title} — тасалбар`,
  });
  pass.primaryFields.push({ key: 'movie', label: 'Кино', value: t.movie.title });
  pass.secondaryFields.push(
    { key: 'hall', label: 'Танхим', value: t.hallName },
    { key: 'row', label: 'Эгнээ', value: t.seat.rowLabel },
    { key: 'seat', label: 'Суудал', value: t.seat.number },
  );
  pass.auxiliaryFields.push(
    {
      key: 'time',
      label: 'Цаг',
      value: `${ubDate(t.showtime.startsAt)} ${formatUbTime(t.showtime.startsAt)}`,
    },
    { key: 'branch', label: 'Салбар', value: t.branch.name },
  );
  // Wallet-only holders can still be admitted by hand: the door types the order number and code.
  pass.backFields.push(
    { key: 'order', label: 'Захиалгын дугаар', value: t.orderNo },
    { key: 'checkCode', label: 'Шалгах код', value: t.checkCode },
  );
  pass.setBarcodes({
    message: t.qrToken,
    format: 'PKBarcodeFormatQR',
    messageEncoding: 'iso-8859-1',
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
