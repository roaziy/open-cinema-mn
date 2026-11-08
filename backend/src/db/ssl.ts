import { readFileSync } from 'node:fs';
import type { ConnectionOptions } from 'node:tls';
import type { Env } from '../env';

export type SslLevel = 'off' | 'require' | 'verify';
type UrlMode = 'disable' | 'require' | 'verify-ca' | 'verify-full';

const RANK: Record<string, number> = {
  off: 0,
  disable: 0,
  require: 1,
  // node's `verify` checks the host name, so it is as strong as verify-full.
  verify: 3,
  'verify-ca': 2,
  'verify-full': 3,
};
const SSL_PARAMS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'];

function urlMode(raw: string | null): UrlMode | null {
  if (raw === null) return null;
  if (raw === 'disable') return 'disable';
  if (raw === 'verify-ca' || raw === 'verify-full') return raw;
  // allow, prefer, require, no-verify: encrypted without a certificate check in node-postgres.
  return 'require';
}

export type DbSsl = {
  /** The connection string without ssl parameters (pg would re-parse them over our settings). */
  url: string;
  ssl: ConnectionOptions | false;
  level: SslLevel;
};

/**
 * Database TLS from DATABASE_SSL and the URL's `sslmode`. A verifying `sslmode` is honoured, never
 * downgraded, and a DATABASE_SSL weaker than the URL asks for refuses to start.
 * `verify` uses `sslrootcert` / DATABASE_CA_FILE, else the system certificate store.
 */
export function resolveDbSsl(
  e: Pick<Env, 'DATABASE_URL' | 'DATABASE_SSL' | 'DATABASE_SSL_SET' | 'DATABASE_CA_FILE'>,
  read: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): DbSsl {
  let u: URL | null = null;
  try {
    u = new URL(e.DATABASE_URL);
  } catch {
    u = null;
  }
  const mode = u ? urlMode(u.searchParams.get('sslmode')) : null;
  const rootCert = u?.searchParams.get('sslrootcert') ?? null;
  const explicit = e.DATABASE_SSL_SET ? e.DATABASE_SSL : null;

  if (
    explicit &&
    mode &&
    RANK[explicit] !== undefined &&
    (RANK[explicit] as number) < (RANK[mode] as number)
  ) {
    throw new Error(
      `DATABASE_SSL=${explicit} is weaker than sslmode=${u?.searchParams.get('sslmode')} in DATABASE_URL: remove one of them or make them agree`,
    );
  }

  let level: SslLevel;
  if (explicit === 'verify' || mode === 'verify-ca' || mode === 'verify-full') level = 'verify';
  else if (explicit) level = explicit;
  else if (mode) level = mode === 'disable' ? 'off' : 'require';
  else level = e.DATABASE_SSL;

  let url = e.DATABASE_URL;
  if (u && SSL_PARAMS.some((k) => u.searchParams.has(k))) {
    for (const k of SSL_PARAMS) u.searchParams.delete(k);
    url = u.toString();
  }

  if (level === 'off') return { url, ssl: false, level };
  if (level === 'require') return { url, ssl: { rejectUnauthorized: false }, level };
  const caFile = e.DATABASE_CA_FILE ?? rootCert;
  const ssl: ConnectionOptions = { rejectUnauthorized: true };
  if (caFile) ssl.ca = read(caFile);
  // verify-ca checks the chain but not the host name (libpq semantics).
  if (mode === 'verify-ca' && explicit !== 'verify') ssl.checkServerIdentity = () => undefined;
  return { url, ssl, level };
}
