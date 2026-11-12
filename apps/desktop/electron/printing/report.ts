import { BrowserWindow, dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import { money, quantity, type Report, type ReportKind } from '@agripos/shared';
import { apiRequest } from '../services/client';
const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export async function printReport(
  parent: BrowserWindow,
  options: { kind: ReportKind; from: string; to: string; pdf?: boolean },
) {
  const result = await apiRequest<Report>({
    method: 'GET',
    path: `/reports/detail/${options.kind}?from=${options.from}&to=${options.to}`,
  });
  if (result.error || !result.data) throw new Error(result.error?.message ?? 'Report unavailable');
  const report = result.data;
  if (report.truncated)
    throw new Error('Narrow the date range before exporting more than 10,000 rows');
  const target =
    options.pdf === false
      ? null
      : await dialog.showSaveDialog(parent, {
          defaultPath: `AgriPOS-${options.kind}-${options.from}-${options.to}.pdf`,
          filters: [{ name: 'PDF report', extensions: ['pdf'] }],
        });
  if (target && (target.canceled || !target.filePath)) return { cancelled: true };
  const win = new BrowserWindow({
    show: false,
    parent,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>@page{size:A4 landscape;margin:12mm}body{font:10px Arial;color:#17251f}table{border-collapse:collapse;width:100%}th,td{padding:6px;border:1px solid #ddd;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}</style></head><body><h1>${escape(report.title)}</h1><p>${escape(options.from)} to ${escape(options.to)} · Sri Lanka business dates · LKR</p><table><thead><tr>${report.columns.map((c) => `<th>${escape(c.label)}</th>`).join('')}</tr></thead><tbody>${report.rows.map((r) => `<tr>${report.columns.map((c) => `<td>${escape(r[c.key] == null ? '' : c.format === 'money' ? money(Number(r[c.key])) : c.format === 'quantity' ? quantity(Number(r[c.key])) : r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    if (target?.filePath)
      await writeFile(
        target.filePath,
        await win.webContents.printToPDF({
          landscape: true,
          printBackground: true,
          preferCSSPageSize: true,
        }),
      );
    else
      await new Promise<void>((resolve, reject) =>
        win.webContents.print(
          { silent: false, printBackground: true, landscape: true },
          (success, reason) => (success ? resolve() : reject(new Error(reason))),
        ),
      );
    return { cancelled: false };
  } finally {
    win.destroy();
  }
}
