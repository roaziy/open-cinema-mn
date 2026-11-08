// Draws the Open Cinema mark (a ticket on action blue) into PNGs. No dependencies.
// Run: node scripts/generate-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BLUE = [0x2e, 0x6b, 0xf0];
const WHITE = [255, 255, 255];

const inRound = (x, y, rx, ry, w, h, r) => {
  if (x < rx || x > rx + w || y < ry || y > ry + h) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

// Colour at a point of the 64x64 design space, or null for transparent.
function sample(u, v, { round, scale }) {
  if (round && !inRound(u, v, 0, 0, 64, 64, 16)) return null;
  // Scale the ticket about the centre (maskable icons keep it inside the safe zone).
  const x = (u - 32) / scale + 32;
  const y = (v - 32) / scale + 32;
  const inTicket =
    inRound(x, y, 16, 18, 32, 28, 4) &&
    (x - 16) ** 2 + (y - 32) ** 2 > 4.8 ** 2 &&
    (x - 48) ** 2 + (y - 32) ** 2 > 4.8 ** 2;
  if (!inTicket) return BLUE;
  const perforation = Math.abs(x - 40) < 1.2 && y > 21 && y < 43 && (y - 21) % 6.2 < 3;
  return perforation ? BLUE : WHITE;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc(body), body.length + 4);
  return out;
};

function png(size, opts) {
  const SS = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(
            ((px + (sx + 0.5) / SS) / size) * 64,
            ((py + (sy + 0.5) / SS) / size) * 64,
            opts,
          );
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 1;
          }
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const n = SS * SS;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / n) * 255);
    }
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(size, 0);
  head.writeUInt32BE(size, 4);
  head[8] = 8;
  head[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
const write = (path, size, opts) => writeFileSync(path, png(size, opts));
write('public/icons/icon-192.png', 192, { round: true, scale: 1 });
write('public/icons/icon-512.png', 512, { round: true, scale: 1 });
write('public/icons/maskable-512.png', 512, { round: false, scale: 0.8 });
write('app/icon.png', 64, { round: true, scale: 1 });
write('app/apple-icon.png', 180, { round: false, scale: 0.9 });
