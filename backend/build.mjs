// Production bundle: dist/index.js (API) and dist/migrate.js (migrations), run with plain node.
// The workspace package @open-cinema/shared ships TypeScript source, so it is inlined; every
// other dependency stays external and is loaded from node_modules at runtime.
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
  entryPoints: { index: 'src/index.ts', migrate: 'src/db/migrate.ts' },
  outdir: next,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  // `packages: external` also externalizes the workspace package, so bundle it explicitly.
  plugins: [
    {
      name: 'inline-shared',
      setup(b) {
        b.onResolve({ filter: /^@open-cinema\/shared$/ }, () =>
          b.resolve('../shared/src/index.ts', {
            kind: 'import-statement',
            resolveDir: root,
          }),
        );
      },
    },
  ],
  logLevel: 'info',
});
await rm(dist, { recursive: true, force: true });
await rename(next, dist);
