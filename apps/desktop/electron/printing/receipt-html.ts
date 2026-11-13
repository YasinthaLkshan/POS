import { money, quantity } from '@agripos/shared';
export interface Shop {
  name: string;
  address: string;
  phone: string;
  receipt_footer: string;
}
export interface Receipt {
  logoDataUrl?: string;
  offline?: boolean;
  invoice_number?: string;
  id: string;
  created_at: string;
  cashier: string;
  subtotal?: number;
  total: number;
  tax: number;
  discount: number;
  bill_discount?: number;
  credit: number;
  cash_tendered: number;
  change: number;
  notes?: string;
  outstanding?: number;
  shop: Shop;
  customer?: {
    name: string;
    kind: 'registered' | 'driver' | 'walk_in';
    phone?: string;
    driver_code?: string | null;
    lorry_number?: string;
    factory?: string | null;
  } | null;
  lines: {
    name: string;
    quantity: number;
    unit_price: number;
    total: number;
    discount?: number;
    auto_discount?: number;
    unit?: string;
  }[];
  payments: { method: string; amount: number }[];
  installments?: { seq: number; due_date: string; amount: number; remaining: number }[];
}
export interface PaymentReceipt {
  id: string;
  created_at: string;
  amount: number;
  method: string;
  notes: string;
  customer_name: string;
  customer_kind: string;
  driver_code: string | null;
  factory: string | null;
  cashier: string;
  balance_after: number;
  shop: Shop;
  allocations: {
    amount: number;
    seq: number;
    due_date: string;
    installment_count: number;
    invoice_number: string;
  }[];
}
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const date = (value: string) =>
  new Date(value).toLocaleDateString('en-LK', { timeZone: 'Asia/Colombo' });
const when = (value: string) =>
  new Date(value).toLocaleString('en-LK', { timeZone: 'Asia/Colombo' });
const row = (label: string, value: string, strong = false) =>
  `<tr class="sum${strong ? ' strong' : ''}"><td>${escape(label)}</td><td>${escape(value)}</td></tr>`;
const customerLabel = {
  driver: 'Lorry driver',
  walk_in: 'Credit customer',
  registered: 'Customer',
};
const page = (paper: string, marginMm: number, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>@page{size:${paper === 'A4' ? 'A4' : `${paper} auto`};margin:${marginMm}mm}body{font:12px Arial;color:#111;margin:0}h1{font-size:18px;margin:4px 0}p{margin:4px 0}table{width:100%;border-collapse:collapse}td{padding:4px 0;vertical-align:top}td:last-child{text-align:right;white-space:nowrap}.item td{border-bottom:1px dashed #bbb}.item small{color:#444}.sum td{padding:2px 0}.strong td{font-size:16px;font-weight:bold;border-top:1px solid #111;padding-top:6px}.muted{color:#444}.center{text-align:center}hr{border:0;border-top:1px dashed #999;margin:8px 0}small{overflow-wrap:anywhere}</style></head><body>${body}</body></html>`;
const header = (shop: Shop, logo?: string) =>
  `<div class="center">${logo ? `<img alt="Shop logo" style="width:60px;height:60px;object-fit:contain" src="${escape(logo)}">` : ''}<h1>${escape(shop.name)}</h1>${shop.address ? `<p>${escape(shop.address)}</p>` : ''}${shop.phone ? `<p>${escape(shop.phone)}</p>` : ''}</div><hr>`;

export function receiptHtml(sale: Receipt, paper: string, marginMm = 4) {
  const c = sale.customer;
  const driverDiscount = sale.lines.reduce((s, l) => s + (l.auto_discount ?? 0), 0);
  const bill = sale.bill_discount ?? 0;
  const itemDiscount = sale.discount - bill - driverDiscount;
  const subtotal =
    sale.subtotal ?? sale.lines.reduce((s, l) => s + l.total + (l.discount ?? 0), 0) - sale.tax;
  const cashPaid = sale.payments
    .filter((p) => p.method === 'cash')
    .reduce((s, p) => s + p.amount, 0);
  const status =
    sale.credit === 0 ? 'Paid' : sale.credit === sale.total ? 'Credit' : 'Part paid / credit';
  return page(
    paper,
    marginMm,
    `${header(sale.shop, sale.logoDataUrl)}<small>Invoice: ${escape(sale.invoice_number ?? sale.id)}<br>Date: ${escape(when(sale.created_at))}<br>Cashier: ${escape(sale.cashier)}${
      c
        ? `<br>${escape(customerLabel[c.kind] ?? 'Customer')}: ${escape(c.name)}${c.driver_code ? ` (${escape(c.driver_code)})` : ''}${c.factory ? `<br>Factory: ${escape(c.factory)}` : ''}${c.lorry_number ? `<br>Lorry: ${escape(c.lorry_number)}` : ''}`
        : '<br>Walk-in customer'
    }</small><hr><table>${sale.lines
      .map(
        (l) =>
          `<tr class="item"><td>${escape(l.name)}<br><small>${quantity(l.quantity)}${l.unit ? ` ${escape(l.unit)}` : ''} × ${money(l.unit_price)}${l.discount ? ` · less ${money(l.discount)}` : ''}</small></td><td>${money(l.total)}</td></tr>`,
      )
      .join(
        '',
      )}</table><table>${row('Subtotal', money(subtotal))}${driverDiscount ? row('Driver discount', `- ${money(driverDiscount)}`) : ''}${itemDiscount > 0 ? row('Item discounts', `- ${money(itemDiscount)}`) : ''}${bill ? row('Bill discount', `- ${money(bill)}`) : ''}${sale.discount ? row('Total discount', money(sale.discount)) : ''}${sale.tax ? row('Tax', money(sale.tax)) : ''}${row('Total', money(sale.total), true)}${sale.payments
      .map((p) => row(p.method === 'cash' ? 'Cash paid' : `${p.method} paid`, money(p.amount)))
      .join(
        '',
      )}${cashPaid && sale.cash_tendered > cashPaid ? row('Cash received', money(sale.cash_tendered)) + row('Change', money(sale.change)) : ''}${sale.credit ? row('Credit', money(sale.credit)) : ''}${row('Payment status', status)}</table>${
      sale.installments?.length
        ? `<hr><p><strong>${sale.installments.length > 1 ? 'Installments' : 'Due date'}</strong></p><table>${sale.installments.map((i) => row(sale.installments!.length > 1 ? `${i.seq}. ${date(i.due_date)}` : date(i.due_date), money(i.amount))).join('')}</table>`
        : ''
    }${sale.notes ? `<p class="muted">${escape(sale.notes)}</p>` : ''}<hr><p class="center">${escape(sale.shop.receipt_footer)}</p>`,
  );
}

export function paymentReceiptHtml(payment: PaymentReceipt, paper: string, marginMm = 4) {
  return page(
    paper,
    marginMm,
    `${header(payment.shop)}<p class="center"><strong>CREDIT PAYMENT RECEIPT</strong></p><small>Receipt: ${escape(payment.id.slice(0, 8).toUpperCase())}<br>Date: ${escape(when(payment.created_at))}<br>Received by: ${escape(payment.cashier)}<br>${payment.customer_kind === 'driver' ? 'Lorry driver' : 'Customer'}: ${escape(payment.customer_name)}${payment.driver_code ? ` (${escape(payment.driver_code)})` : ''}${payment.factory ? `<br>Factory: ${escape(payment.factory)}` : ''}</small><hr><table>${payment.allocations
      .map((a) =>
        row(
          `${a.invoice_number}${a.installment_count > 1 ? ` · installment ${a.seq} of ${a.installment_count}` : ''} (due ${date(a.due_date)})`,
          money(a.amount),
        ),
      )
      .join(
        '',
      )}${row('Amount paid', money(payment.amount), true)}${row('Method', payment.method)}${row('Balance remaining', money(payment.balance_after))}</table>${payment.notes ? `<p class="muted">${escape(payment.notes)}</p>` : ''}<hr><p class="center">${escape(payment.shop.receipt_footer)}</p>`,
  );
}
