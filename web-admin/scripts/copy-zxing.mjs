// Serves the QR decoder's WebAssembly from our own origin instead of a public CDN, so the door
// scanner needs nothing external. Runs before dev and build; the copy is gitignored.
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(import.meta.resolve('zxing-wasm/reader/zxing_reader.wasm'));
const dir = new URL('../public/zxing/', import.meta.url);
mkdirSync(dir, { recursive: true });
copyFileSync(from, new URL('zxing_reader.wasm', dir));
