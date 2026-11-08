import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { formatUbTime, type TicketView, ubDate } from '@open-cinema/shared';
import { PKPass } from 'passkit-generator';
import { type Env, env } from '../env';

const MODEL = fileURLToPath(new URL('./model/OpenCinema.pass', import.meta.url));

export type WalletConfig = {
  passTypeId: string;
  teamId: string;
  orgName: string;
  signerCertPath: string;
  signerKeyPath: string;
  signerKeyPassphrase: string | undefined;
  wwdrPath: string;
};

/** Read per call, never at startup: a missing certificate only disables the Wallet endpoint. */
export function walletConfig(source: Env = env): WalletConfig | null {
  const {
    WALLET_PASS_TYPE_ID: passTypeId,
    WALLET_TEAM_ID: teamId,
    WALLET_SIGNER_CERT_PATH: signerCertPath,
    WALLET_SIGNER_KEY_PATH: signerKeyPath,
    WALLET_WWDR_PATH: wwdrPath,
  } = source;
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

export async function buildPass(cfg: WalletConfig, t: TicketView): Promise<Buffer> {
  const [wwdr, signerCert, signerKey] = await Promise.all([
    readFile(cfg.wwdrPath),
    readFile(cfg.signerCertPath),
    readFile(cfg.signerKeyPath),
  ]);
  const pass = await PKPass.from(
    {
      model: MODEL,
      certificates: { wwdr, signerCert, signerKey, signerKeyPassphrase: cfg.signerKeyPassphrase },
    },
    {
      serialNumber: t.id,
      passTypeIdentifier: cfg.passTypeId,
      teamIdentifier: cfg.teamId,
      organizationName: cfg.orgName,
      description: `${t.movie.title} ticket`,
    },
  );
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
  pass.setBarcodes({
    message: t.qrToken,
    format: 'PKBarcodeFormatQR',
    messageEncoding: 'iso-8859-1',
  });
  pass.setRelevantDate(new Date(t.showtime.startsAt));
  pass.setLocations({ latitude: t.branch.lat, longitude: t.branch.lng });
  return pass.getAsBuffer();
}
