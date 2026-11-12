import { money, quantity, type Report } from '@agripos/shared';
export function formattedReport(report: Report) {
  return report.rows.map((row) =>
    Object.fromEntries(
      report.columns.map((c) => [
        c.label,
        row[c.key] == null
          ? ''
          : c.format === 'money'
            ? money(Number(row[c.key]))
            : c.format === 'quantity'
              ? quantity(Number(row[c.key]))
              : String(row[c.key]),
      ]),
    ),
  );
}
function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportReport(report: Report, format: 'csv' | 'excel', name: string) {
  const rows = formattedReport(report),
    keys = report.columns.map((c) => c.label);
  if (format === 'csv') {
    const cell = (v: unknown) => {
      let s = String(v ?? '');
      if (/^\s*[=+\-@]/.test(s) || /^[\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replaceAll('"', '""')}"`;
    };
    download(
      '\uFEFF' +
        [keys, ...rows.map((r) => keys.map((k) => r[k]))]
          .map((row) => row.map(cell).join(','))
          .join('\r\n'),
      `${name}.csv`,
      'text/csv;charset=utf-8',
    );
  } else {
    const escape = (v: unknown) =>
      String(v ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
      );
    const data = [keys, ...rows.map((r) => keys.map((k) => r[k]))];
    download(
      `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Report"><Table>${data.map((row) => `<Row>${row.map((v) => `<Cell><Data ss:Type="String">${escape(v)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet></Workbook>`,
      `${name}.xml`,
      'application/xml',
    );
  }
}
