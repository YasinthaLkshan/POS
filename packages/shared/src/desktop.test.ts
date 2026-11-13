import { expect, it } from 'vitest';
import { connectionSchema } from './desktop';
const shop = 'postgresql://agripos:secret@localhost:5432/agripos';
const neon = 'postgresql://neon:secret@ep-x.neon.tech/backup?sslmode=require';
it('treats existing connections as tills and allows cloud backup only on the main computer', () => {
  expect(connectionSchema.parse({ databaseUrl: shop }).role).toBe('till');
  expect(
    connectionSchema.parse({ databaseUrl: shop, role: 'main', backupUrl: neon }).backupUrl,
  ).toBe(neon);
  expect(() =>
    connectionSchema.parse({ databaseUrl: shop, role: 'till', backupUrl: neon }),
  ).toThrow('main shop computer');
  expect(() =>
    connectionSchema.parse({ databaseUrl: shop, role: 'main', backupUrl: shop }),
  ).toThrow('different database');
  expect(() => connectionSchema.parse({ databaseUrl: 'https://shop.example' })).toThrow(
    'PostgreSQL',
  );
});
