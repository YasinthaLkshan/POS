import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { id } from '@agripos/shared';

export function imageId(path: string) {
  if (path === '/settings/logo') return 'logo';
  const match = /^\/products\/([0-9a-f-]{36})\/image$/.exec(path);
  return match ? id.parse(match[1]) : null;
}
export function imageFile(userData: string, apiUrl: string, shopId: string, productId: string) {
  const endpoint = createHash('sha256').update(apiUrl).digest('hex');
  return join(
    userData,
    'images',
    endpoint,
    id.parse(shopId),
    `${productId === 'logo' ? 'logo' : id.parse(productId)}.png`,
  );
}
export function validateImage(bytes: Buffer) {
  if (
    bytes.length < 33 ||
    bytes.length > 131072 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error('Use a PNG thumbnail up to 128 KB');
}
export function writeImage(path: string, bytes: Buffer) {
  validateImage(bytes);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, path);
}
export function readImage(path: string) {
  return existsSync(path) ? `data:image/png;base64,${readFileSync(path).toString('base64')}` : null;
}
