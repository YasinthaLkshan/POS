import { BrowserWindow, dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import type { ApiResult } from '@agripos/shared';
import { apiRequest } from '../services/client';
import {
  paymentReceiptHtml,
  receiptHtml,
  type PaymentReceipt,
  type Receipt,
  type Shop,
} from './receipt-html';
export { paymentReceiptHtml, receiptHtml };
async function output(
  parent: BrowserWindow,
  html: string,
  options: { printer: string; paper: '58mm' | '80mm' | 'A4'; pdf: boolean; name: string },
) {
  const win = new BrowserWindow({
    show: false,
    parent,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    if (options.pdf) {
      const target = await dialog.showSaveDialog(parent, {
        defaultPath: `${options.name}.pdf`,
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
        const settings = await apiRequest<Shop>({ method: 'GET', path: '/settings' });
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
            payments: [{ method: 'cash', amount: 10000 }],
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
  return output(parent, receiptHtml(response.data, options.paper, options.marginMm), {
    ...options,
    name: `AgriPOS-${response.data.invoice_number ?? options.saleId}`,
  });
}

export async function printPaymentReceipt(
  parent: BrowserWindow,
  options: {
    paymentId: string;
    printer: string;
    paper: '58mm' | '80mm' | 'A4';
    pdf: boolean;
    marginMm?: number;
  },
) {
  const response = await apiRequest<PaymentReceipt>({
    method: 'GET',
    path: `/repayments/${options.paymentId}/receipt`,
  });
  if (response.error || !response.data)
    throw new Error(response.error?.message ?? 'Receipt unavailable');
  return output(parent, paymentReceiptHtml(response.data, options.paper, options.marginMm), {
    ...options,
    name: `AgriPOS-payment-${options.paymentId.slice(0, 8)}`,
  });
}
