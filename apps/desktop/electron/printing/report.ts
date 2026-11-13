import { BrowserWindow, dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import { money, printableDocument, quantity, type Report, type ReportKind } from '@agripos/shared';
import { apiRequest } from '../services/client';
const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const cell = (value: unknown, format?: string) =>
  value == null || value === ''
    ? ''
    : format === 'money'
      ? money(Number(value))
      : format === 'quantity'
        ? quantity(Number(value))
        : format === 'date'
          ? new Date(String(value)).toLocaleDateString('en-LK', { timeZone: 'Asia/Colombo' })
          : value;
export function reportHtml(report: Report, subtitle: string, shopName = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>@page{size:A4 ${report.columns.length > 5 ? 'landscape' : 'portrait'};margin:12mm}body{font:10px Arial;color:#132019}h1{font-size:16px;margin:0 0 4px}p{margin:0 0 10px;color:#555}table{border-collapse:collapse;width:100%}th{background:#eef3f0;text-align:left}th,td{padding:6px;border:1px solid #d5ddd8}td.money{text-align:right;white-space:nowrap}thead{display:table-header-group}tr{break-inside:avoid}</style></head><body>${shopName ? `<p><strong>${escape(shopName)}</strong></p>` : ''}<h1>${escape(report.title)}</h1><p>${escape(subtitle)}</p><table><thead><tr>${report.columns.map((c) => `<th>${escape(c.label)}</th>`).join('')}</tr></thead><tbody>${report.rows.map((r) => `<tr>${report.columns.map((c) => `<td${c.format === 'money' ? ' class="money"' : ''}>${escape(cell(r[c.key], c.format))}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
}
async function output(
  parent: BrowserWindow,
  html: string,
  fileName: string,
  pdf: boolean,
  landscape: boolean,
) {
  const target = pdf
    ? await dialog.showSaveDialog(parent, {
        defaultPath: fileName,
        filters: [{ name: 'PDF report', extensions: ['pdf'] }],
      })
    : null;
  if (target && (target.canceled || !target.filePath)) return { cancelled: true };
  const win = new BrowserWindow({
    show: false,
    parent,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    if (target?.filePath)
      await writeFile(
        target.filePath,
        await win.webContents.printToPDF({
          landscape,
          printBackground: true,
          preferCSSPageSize: true,
        }),
      );
    else
      await new Promise<void>((resolve, reject) =>
        win.webContents.print(
          { silent: false, printBackground: true, landscape },
          (success, reason) => (success ? resolve() : reject(new Error(reason))),
        ),
      );
    return { cancelled: false };
  } finally {
    win.destroy();
  }
}
async function fetchReport(path: string) {
  const result = await apiRequest<Report>({ method: 'GET', path });
  if (result.error || !result.data) throw new Error(result.error?.message ?? 'Report unavailable');
  if (result.data.truncated)
    throw new Error('Narrow the date range before exporting more than 10,000 rows');
  const shop = await apiRequest<{ name: string }>({ method: 'GET', path: '/settings' });
  return { report: result.data, shopName: shop.data?.name ?? '' };
}
export async function printReport(
  parent: BrowserWindow,
  options: { kind: ReportKind; from: string; to: string; pdf?: boolean },
) {
  return printDocument(parent, {
    path: `/reports/detail/${options.kind}?from=${options.from}&to=${options.to}`,
    pdf: options.pdf,
  });
}
export async function printDocument(
  parent: BrowserWindow,
  options: { path: string; pdf?: boolean },
) {
  if (!printableDocument.test(options.path)) throw new Error('This document cannot be printed');
  const { report, shopName } = await fetchReport(options.path);
  const range = /from=(\d{4}-\d{2}-\d{2})&to=(\d{4}-\d{2}-\d{2})/.exec(options.path);
  const subtitle = range
    ? `${range[1]} to ${range[2]} · Sri Lanka business dates · LKR`
    : `Printed ${new Date().toLocaleString('en-LK', { timeZone: 'Asia/Colombo' })} · LKR`;
  const name = `AgriPOS-${report.title.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 60)}.pdf`;
  return output(
    parent,
    reportHtml(report, subtitle, shopName),
    name,
    options.pdf !== false,
    report.columns.length > 5,
  );
}
