import { expect, it } from 'vitest';
import { connectionSchema } from './desktop';
const shop = 'postgresql://agripos:secret@localhost:5432/agripos';
const neon = 'postgresql://neon:secret@ep-x.neon.tech/backup?sslmode=require';
it('accepts one cloud URL and reads legacy connection fields without requiring another database', () => {
  expect(connectionSchema.parse({ databaseUrl: shop }).role).toBe('till');
  expect(
    connectionSchema.parse({ databaseUrl: shop, role: 'main', backupUrl: neon }).backupUrl,
  ).toBe(neon);
  expect(connectionSchema.parse({ databaseUrl: neon }).databaseUrl).toBe(neon);
  expect(
    connectionSchema.parse({ databaseUrl: shop, role: 'main', backupUrl: shop }).databaseUrl,
  ).toBe(shop);
  expect(() => connectionSchema.parse({ databaseUrl: 'https://shop.example' })).toThrow(
    'PostgreSQL',
  );
});
