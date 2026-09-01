// Generate simple branded PNG icons (no external deps). Graphite field with an
// accent LCD block — a placeholder Runner OS mark. Replace with real art later.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const BG = [15, 18, 13, 255];       // #0f120d
const ACCENT = [167, 192, 106, 255]; // #a7c06a
const LCD = [27, 32, 22, 255];       // #1b2016

function pixel(x, y, n) {
  const m = n * 0.14, i = n * 0.30;
  const inAccent = x >= m && x < n - m && y >= m && y < n - m;
  const inLcd = x >= i && x < n - i && y >= i && y < n - i;
  return inLcd ? LCD : inAccent ? ACCENT : BG;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(n) {
  const raw = Buffer.alloc((n * 4 + 1) * n);
  let o = 0;
  for (let y = 0; y < n; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < n; x++) { const p = pixel(x, y, n); raw[o++] = p[0]; raw[o++] = p[1]; raw[o++] = p[2]; raw[o++] = p[3]; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(OUT + file, png(size));
  console.log('wrote', file, size);
}
