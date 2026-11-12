import { it, expect } from 'vitest';
import { parseCsv } from './csv';
it('parses quoted commas, escaped quotes, BOM and embedded newlines', () => {
  expect(parseCsv('\uFEFFname,description\r\n"Seeds, tomato","A ""good""\nseed"\r\n')).toEqual([
    { name: 'Seeds, tomato', description: 'A "good"\nseed' },
  ]);
});
it('rejects ambiguous headers, truncated quotes and invalid row lengths', () => {
  for (const csv of ['name,name\na,b', 'name,sku\n"bad,x', 'name,sku\na,b,c'])
    expect(() => parseCsv(csv)).toThrow();
});
