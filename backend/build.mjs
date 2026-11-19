// Production bundle: dist/index.js (API), dist/migrate.js (migrations), dist/admin-create.js (first
// admin), dist/halls-create.js (ready-made halls), dist/movies-update.js (TMDB films) and
// dist/showtimes-week.js (a week of showings), run with plain node.
// Application code (including src/shared) is bundled; every dependency stays external and is
// loaded from node_modules at runtime.
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = import.meta.dirname;
// Build beside `dist`, then swap, so a pm2 restart during a build never sees a half-written tree.
const dist = path.join(root, 'dist');
const next = path.join(root, 'dist.next');
await rm(next, { recursive: true, force: true });
await build({
  absWorkingDir: root,
  entryPoints: {
    index: 'src/index.ts',
    migrate: 'src/db/migrate.ts',
    'admin-create': 'src/scripts/admin-create.ts',
    'halls-create': 'src/scripts/halls-create.ts',
    'movies-update': 'src/scripts/movies-update.ts',
    'showtimes-week': 'src/scripts/showtimes-week.ts',
  },
  outdir: next,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  logLevel: 'info',
});
// Swap with two renames: dist is missing only for the instant between them, and restored if the second fails.
const old = path.join(root, 'dist.old');
await rm(old, { recursive: true, force: true });
await rename(dist, old).catch((err) => {
  if (err.code !== 'ENOENT') throw err;
});
await rename(next, dist).catch(async (err) => {
  await rename(old, dist).catch(() => {});
  throw err;
});
await rm(old, { recursive: true, force: true });
