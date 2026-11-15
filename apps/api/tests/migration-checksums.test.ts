import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { migrationChecksums } from '../src/database/migrate';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
it('accepts legacy LF and CRLF checksums in either installation direction', () => {
  const lf = 'CREATE TABLE example (\n id integer PRIMARY KEY\n);\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  for (const installed of [lf, crlf]) {
    const checks = migrationChecksums(installed);
    expect(checks.compatible.has(hash(lf))).toBe(true);
    expect(checks.compatible.has(hash(crlf))).toBe(true);
    expect(checks.canonical).toBe(hash(lf));
    expect(checks.compatible.has(hash(lf.replace('integer', 'text')))).toBe(false);
  }
});
