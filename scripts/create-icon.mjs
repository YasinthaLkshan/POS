import { mkdirSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
const size = 256,
  maskStride = Math.ceil(size / 32) * 4,
  pixels = Buffer.alloc(size * size * 4),
  mask = Buffer.alloc(maskStride * size);
// Original, code-drawn sprout icon. The 32-bit ICO uses a standard DIB and alpha channel.
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const cornerX = Math.max(0, Math.abs(x - 127.5) - 91),
      cornerY = Math.max(0, Math.abs(y - 127.5) - 91);
    const inside = cornerX * cornerX + cornerY * cornerY < 36 * 36;
    const left =
      ((x - 93) * 0.78 + (y - 103) * 0.63) ** 2 / 35 ** 2 +
        ((y - 103) * 0.78 - (x - 93) * 0.63) ** 2 / 19 ** 2 <
      1;
    const right =
      ((x - 158) * 0.75 - (y - 80) * 0.66) ** 2 / 37 ** 2 +
        ((y - 80) * 0.75 + (x - 158) * 0.66) ** 2 / 20 ** 2 <
      1;
    const stem = Math.abs(x - (125 + (145 - y) * 0.1)) < 6 && y > 103 && y < 191;
    const color = left || right || stem ? [215, 237, 135] : [16, 38, 32];
    const at = ((size - 1 - y) * size + x) * 4;
    pixels[at] = color[2];
    pixels[at + 1] = color[1];
    pixels[at + 2] = color[0];
    pixels[at + 3] = inside ? 255 : 0;
    if (!inside) mask[(size - 1 - y) * maskStride + (x >> 3)] |= 1 << (7 - (x % 8));
  }
const dib = Buffer.alloc(40);
dib.writeUInt32LE(40, 0);
dib.writeInt32LE(size, 4);
dib.writeInt32LE(size * 2, 8);
dib.writeUInt16LE(1, 12);
dib.writeUInt16LE(32, 14);
dib.writeUInt32LE(pixels.length + mask.length, 20);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(dib.length + pixels.length + mask.length, 14);
header.writeUInt32LE(22, 18);
mkdirSync('apps/desktop/resources', { recursive: true });
writeFileSync('apps/desktop/resources/icon.ico', Buffer.concat([header, dib, pixels, mask]));
