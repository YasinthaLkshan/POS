import { BrowserWindow, dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import { money, quantity, type ApiResult } from '@agripos/shared';
import { apiRequest } from '../services/client';
interface Receipt {
  logoDataUrl?: string;
  offline?: boolean;
  invoice_number?: string;
  id: string;
  created_at: string;
  cashier: string;
  total: number;
  tax: number;
  discount: number;
  credit: number;
  cash_tendered: number;
  change: number;
  shop: { name: string; address: string; phone: string; receipt_footer: string };
  lines: { name: string; quantity: number; unit_price: number; total: number }[];
  payments: { method: string; amount: number }[];
}
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function receiptHtml(sale: Receipt, paper: string, marginMm = 4) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>@page{size:${paper === 'A4' ? 'A4' : `${paper} auto`};margin:${marginMm}mm}body{font:12px Arial;color:#111;margin:0}h1{font-size:19px}table{width:100%;border-collapse:collapse}td{padding:5px 0;border-bottom:1px dashed #bbb}td:last-child{text-align:right}.total{font-size:18px;font-weight:bold}small{overflow-wrap:anywhere}</style></head><body>${sale.logoDataUrl ? `<img alt="Shop logo" style="width:60px;height:60px;object-fit:contain" src="${escape(sale.logoDataUrl)}">` : ''}<h1>${escape(sale.shop.name)}</h1><p>${escape(sale.shop.address)}<br>${escape(sale.shop.phone)}</p><small>Invoice ${escape(sale.invoice_number ?? sale.id)}<br>${escape(new Date(sale.created_at).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' }))}<br>Cashier: ${escape(sale.cashier)}</small><table>${sale.lines.map((l) => `<tr><td>${escape(l.name)}<br>${quantity(l.quantity)} × ${money(l.unit_price)}</td><td>${money(l.total)}</td></tr>`).join('')}</table><p>Discount: ${money(sale.discount)}<br>Tax: ${money(sale.tax)}</p><p class="total">Total ${money(sale.total)}</p>${sale.payments.map((p) => `<p>${escape(p.method)}: ${money(p.amount)}</p>`).join('')}<p>Cash received: ${money(sale.cash_tendered)}<br>Change: ${money(sale.change)}<br>Credit: ${money(sale.credit)}</p><p>${escape(sale.shop.receipt_footer)}</p></body></html>`;
}
export async function printReceipt(
  parent: BrowserWindow,
  options: {
    saleId: string;
    printer: string;
    paper: '58mm' | '80mm' | 'A4';
    pdf: boolean;
    marginMm?: number;
  },
  test = false,
) {
  const response: ApiResult<Receipt> = test
    ? await (async () => {
        const settings = await apiRequest<Receipt['shop']>({ method: 'GET', path: '/settings' });
        if (settings.error || !settings.data) return { error: settings.error };
        return {
          data: {
            id: 'TEST PRINT — NOT A SALE',
            created_at: new Date().toISOString(),
            cashier: 'Printer setup',
            total: 10000,
            tax: 0,
            discount: 0,
            credit: 0,
            cash_tendered: 10000,
            change: 0,
            shop: settings.data,
            lines: [
              {
                name: 'TEST ITEM — NO STOCK OR PAYMENT POSTED',
                quantity: 1000,
                unit_price: 10000,
                total: 10000,
              },
            ],
            payments: [{ method: 'TEST', amount: 10000 }],
          } satisfies Receipt,
        };
      })()
    : await apiRequest<Receipt>({
        method: 'GET',
        path: `/sales/${options.saleId}/receipt`,
      });
  if (response.error || !response.data)
    throw new Error(response.error?.message ?? 'Receipt unavailable');
  if (!response.data.offline) {
    const logo = await apiRequest<{ dataUrl: string | null }>({
      method: 'GET',
      path: '/settings/logo',
    });
    if (logo.data?.dataUrl) response.data.logoDataUrl = logo.data.dataUrl;
  }
  const win = new BrowserWindow({
    show: false,
    parent,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(receiptHtml(response.data, options.paper, options.marginMm))}`,
    );
    if (options.pdf) {
      const target = await dialog.showSaveDialog(parent, {
        defaultPath: `AgriPOS-${options.saleId}.pdf`,
        filters: [{ name: 'PDF receipt', extensions: ['pdf'] }],
      });
      if (target.canceled || !target.filePath) return { cancelled: true };
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        pageSize:
          options.paper === 'A4'
            ? 'A4'
            : { width: options.paper === '58mm' ? 2.28 : 3.15, height: 11.7 },
      });
      await writeFile(target.filePath, pdf);
    } else
      await new Promise<void>((resolve, reject) =>
        win.webContents.print(
          { silent: false, deviceName: options.printer, printBackground: true },
          (success, reason) => (success ? resolve() : reject(new Error(reason))),
        ),
      );
    return { cancelled: false };
  } finally {
    win.destroy();
  }
}
