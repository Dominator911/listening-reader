// Generates the PWA icons (PNG) without any image library: a rounded green square with a
// white open book and a "play" mark. Run: npx tsx scripts/make-icons.ts
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [47, 107, 87];
const FG = [255, 255, 255];

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Coverage (0..1) of the foreground shape at normalised coords (0..1). */
function shape(x: number, y: number): number {
  // Open book: two slanted pages.
  const cx = 0.5;
  const top = 0.3;
  const bottom = 0.68;
  const dx = Math.abs(x - cx);
  const sag = dx * 0.12;
  const inBook = dx > 0.015 && dx < 0.27 && y > top + sag && y < bottom + sag;
  // Play triangle below the book.
  const ty = 0.79;
  const inTri = x > 0.455 && x < 0.56 && Math.abs(y - ty) < (0.56 - x) * 0.6;
  return inBook || inTri ? 1 : 0;
}

function icon(size: number, maskable: boolean): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = maskable ? 0 : size * 0.22;
  const scale = maskable ? 0.8 : 1; // keep the art inside the maskable safe zone
  const SS = 4;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let fg = 0;
      let inside = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          // rounded rect
          const qx = Math.max(Math.abs(px - size / 2) - (size / 2 - r), 0);
          const qy = Math.max(Math.abs(py - size / 2) - (size / 2 - r), 0);
          if (Math.hypot(qx, qy) <= r || r === 0) {
            inside++;
            const nx = (px / size - 0.5) / scale + 0.5;
            const ny = (py / size - 0.5) / scale + 0.5;
            fg += shape(nx, ny);
          }
        }
      const n = SS * SS;
      const a = inside / n;
      const f = inside ? fg / inside : 0;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c] * (1 - f) + FG[c] * f);
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync('public/icon-192.png', icon(192, false));
writeFileSync('public/icon-512.png', icon(512, false));
writeFileSync('public/icon-maskable-512.png', icon(512, true));
writeFileSync('public/apple-touch-icon.png', icon(180, true));
console.log('Icons written to public/');
