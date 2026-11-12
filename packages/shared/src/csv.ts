/** CSV parser supporting quoted commas, escaped quotes and newlines. */
export function parseCsv(input: string): Record<string, string>[] {
  const source = input.replace(/^\uFEFF/, ''),
    rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (c === '"') {
      if (field || closed) throw new Error('Unexpected quote in CSV');
      quoted = true;
      continue;
    }
    if (c === ',' || c === '\n' || c === '\r') {
      row.push(field);
      field = '';
      closed = false;
      if (c !== ',') {
        if (c === '\r' && source[i + 1] === '\n') i++;
        if (row.some((v) => v.length)) rows.push(row);
        row = [];
      }
      continue;
    }
    if (closed) throw new Error('Unexpected text after a quoted CSV field');
    field += c;
  }
  if (quoted) throw new Error('Unclosed quote in CSV');
  row.push(field);
  if (row.some((v) => v.length)) rows.push(row);
  const headers = rows.shift()?.map((s) => s.trim()) ?? [];
  if (!headers.length || headers.some((h) => !h) || new Set(headers).size !== headers.length)
    throw new Error('CSV headers must be nonempty and unique');
  return rows.map((values, index) => {
    if (values.length !== headers.length)
      throw new Error(
        `CSV row ${index + 2} has ${values.length} fields; expected ${headers.length}`,
      );
    return Object.fromEntries(headers.map((h, i) => [h, values[i]!.trim()]));
  });
}
