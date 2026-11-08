// Production bundle: dist/index.js (API) and dist/migrate.js (migrations), run with plain node.
// The workspace package @open-cinema/shared ships TypeScript source, so it is inlined; every
// other dependency stays external and is loaded from node_modules at runtime.
import { rm } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('dist', { recursive: true, force: true });
await build({
  entryPoints: { index: 'src/index.ts', migrate: 'src/db/migrate.ts' },
  outdir: 'dist',
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
            resolveDir: process.cwd(),
          }),
        );
      },
    },
  ],
  logLevel: 'info',
});
