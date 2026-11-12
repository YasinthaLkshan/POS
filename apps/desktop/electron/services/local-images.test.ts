import { afterAll, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imageFile, imageId, readImage, writeImage } from './local-images';
const root = mkdtempSync(join(tmpdir(), 'agripos-local-images-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const shopId = '00000000-0000-4000-8000-000000000001';
const productId = '00000000-0000-4000-8000-000000000002';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9foAAAAASUVORK5CYII=',
  'base64',
);
it('keeps image bytes on the selected desktop and separates shops and API endpoints', () => {
  expect(imageId(`/products/${productId}/image`)).toBe(productId);
  const first = imageFile(join(root, 'desktop-one'), 'https://shop.example', shopId, productId);
  writeImage(first, png);
  expect(readImage(first)).toBe(`data:image/png;base64,${png.toString('base64')}`);
  expect(
    readImage(imageFile(join(root, 'desktop-two'), 'https://shop.example', shopId, productId)),
  ).toBeNull();
  expect(
    readImage(imageFile(join(root, 'desktop-one'), 'https://other.example', shopId, productId)),
  ).toBeNull();
  expect(
    readImage(
      imageFile(
        join(root, 'desktop-one'),
        'https://shop.example',
        '00000000-0000-4000-8000-000000000003',
        productId,
      ),
    ),
  ).toBeNull();
  expect(() => writeImage(first, Buffer.from('<script>'))).toThrow('PNG');
});
