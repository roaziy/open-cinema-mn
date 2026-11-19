// Imports the films in cinemas now (and opening soon) from TMDB: posters and backdrops go to this
// server's storage, films are matched by TMDB id so it is safe to re-run, and imported films that
// left the box office are archived unless a future showing still needs them.
//   movies:update [-- --region US] [--now 12] [--soon 6]
// Needs TMDB_READ_TOKEN (TMDB "API Read Access Token") in .env.
import { parseArgs } from 'node:util';
import { db, pool } from '../db/client';
import { env } from '../env';
import { importFilms } from '../services/movie-import';
import { fetchBoxOffice } from '../services/tmdb';
import { createStorage } from '../storage';

const USAGE = 'usage: movies:update -- [--region US] [--now 12] [--soon 6]';

const count = (v: string | undefined, fallback: number) => {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 20)
    throw new Error(`expected 0-20, got "${v}". ${USAGE}`);
  return n;
};

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      region: { type: 'string' },
      now: { type: 'string' },
      soon: { type: 'string' },
    },
  });
  if (!env.TMDB_READ_TOKEN) {
    throw new Error('set TMDB_READ_TOKEN in .env (TMDB: Settings → API → API Read Access Token)');
  }
  const region = (values.region ?? env.TMDB_REGION).toUpperCase();
  if (!/^[A-Z]{2}$/.test(region))
    throw new Error(`region must be a 2-letter country code. ${USAGE}`);
  const now = new Date();

  const { films, skipped } = await fetchBoxOffice({
    token: env.TMDB_READ_TOKEN,
    region,
    nowLimit: count(values.now, 12),
    soonLimit: count(values.soon, 6),
    now,
  });
  const result = await importFilms(db, createStorage(), films, { now });
  console.log(`region ${region}: ${films.length} films from TMDB`);
  console.log(
    `  created ${result.created}, updated ${result.updated}, archived ${result.archived}`,
  );
  for (const s of [...skipped, ...result.skipped]) console.log(`  skipped ${s}`);
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
