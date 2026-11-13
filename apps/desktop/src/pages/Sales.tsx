import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Printer, FileDown, Undo2 } from 'lucide-react';
import { money, quantity, decimalToInteger } from '@agripos/shared';
import { api, useData, usePagedData, displayDate, type Sale } from '../services/api';
import { useAllowed } from '../stores/session';
import { Table } from '../components/Table';
import { FormDialog } from '../components/FormDialog';
import { PageHeading, QueryState, Badge, RecordPages } from '../components/common';
import { toast } from 'sonner';
import { shortcuts } from '../services/shortcuts';
interface Receipt extends Sale {
  invoice_number?: string;
  cashier: string;
  subtotal: number;
  tax: number;
  discount: number;
  bill_discount?: number;
  cash_tendered: number;
  change: number;
  customer?: {
    id: string;
    name: string;
    kind: 'registered' | 'driver' | 'walk_in';
    phone: string;
    driver_code: string | null;
    lorry_number: string;
    factory: string | null;
  } | null;
  installments?: { id: string; seq: number; due_date: string; amount: number; remaining: number }[];
  shop: { name: string; address: string; phone: string; receipt_footer: string };
  lines: {
    id: string;
    name: string;
    quantity: number;
    returned: number;
    unit_price: number;
    total: number;
    discount: number;
    auto_discount?: number;
    unit?: string;
  }[];
  outstanding: number;
  returns: {
    id: string;
    total_amount: number;
    refund_amount: number;
    credit_amount: number;
    reason: string;
  }[];
  payments: { method: string; amount: number }[];
}
export function Sales() {
  const [params, setParams] = useSearchParams(),
    selected = params.get('id'),
    query = usePagedData<Sale>('/sales'),
    receipt = useData<Receipt>(`/sales/${selected}`, !!selected);
  const [refund, setRefund] = useState(false),
    [operationId, setOperationId] = useState(''),
    cache = useQueryClient(),
    canRefund = useAllowed('refund.write');
  const print = async (pdf: boolean) => {
    try {
      const result = await window.desktop.printReceipt({
        saleId: selected!,
        printer: localStorage.getItem('agripos-printer') ?? '',
        paper: (localStorage.getItem('agripos-paper') ?? '80mm') as '58mm' | '80mm' | 'A4',
        pdf,
        marginMm: Number(localStorage.getItem('agripos-margin') ?? 4),
      });
      if (!result.cancelled) toast.success(pdf ? 'PDF saved' : 'Receipt sent to printer');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Printing failed');
    }
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === shortcuts().print && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        document.getElementById('print-receipt-button')?.click();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  return (
    <>
      <PageHeading
        title="Sales history"
        description="Every transaction, recorded. View receipts and process authorized returns."
      />
      {selected && (
        <section className="panel receipt-preview">
          <QueryState query={receipt}>
            {receipt.data && (
              <>
                <div className="section-heading">
                  <div>
                    <h2>{receipt.data.shop.name}</h2>
                    <p>
                      {receipt.data.shop.address} · {receipt.data.shop.phone}
                    </p>
                    <small>
                      Invoice {receipt.data.invoice_number ?? receipt.data.id} ·{' '}
                      {displayDate(receipt.data.created_at)} · {receipt.data.cashier}
                    </small>
                    <small className="block">
                      {receipt.data.customer ? (
                        <>
                          {receipt.data.customer.kind === 'driver'
                            ? 'Lorry driver'
                            : 'Credit customer'}
                          :{' '}
                          <Link
                            to={
                              receipt.data.customer.kind === 'driver'
                                ? `/drivers?id=${receipt.data.customer.id}`
                                : `/credit?customer=${receipt.data.customer.id}`
                            }
                          >
                            {receipt.data.customer.name}
                          </Link>
                          {receipt.data.customer.driver_code
                            ? ` (${receipt.data.customer.driver_code})`
                            : ''}
                          {receipt.data.customer.factory
                            ? ` · ${receipt.data.customer.factory}`
                            : ''}
                          {receipt.data.customer.lorry_number
                            ? ` · ${receipt.data.customer.lorry_number}`
                            : ''}
                        </>
                      ) : (
                        'Walk-in customer'
                      )}
                    </small>
                  </div>
                  <button className="text-btn" onClick={() => setParams({})}>
                    Close preview
                  </button>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="numeric">Quantity</th>
                      <th className="numeric">Unit price</th>
                      <th className="numeric">Discount</th>
                      <th className="numeric">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipt.data.lines.map((l) => (
                      <tr key={l.id}>
                        <td>
                          {l.name}
                          {!!l.auto_discount && (
                            <small className="block discount-note">
                              Driver discount {money(l.auto_discount)}
                            </small>
                          )}
                        </td>
                        <td className="numeric">
                          {quantity(l.quantity)} {l.unit}
                        </td>
                        <td className="numeric">{money(l.unit_price)}</td>
                        <td className="numeric">{l.discount ? money(l.discount) : '—'}</td>
                        <td className="numeric">{money(l.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(() => {
                  const r = receipt.data;
                  const driver = r.lines.reduce((s, l) => s + (l.auto_discount ?? 0), 0),
                    bill = r.bill_discount ?? 0,
                    paid = r.total - r.credit;
                  return (
                    <div className="receipt-totals">
                      <div>
                        <span>Subtotal</span>
                        <span>{money(r.subtotal)}</span>
                      </div>
                      {driver > 0 && (
                        <div>
                          <span>Driver discount</span>
                          <span>−{money(driver)}</span>
                        </div>
                      )}
                      {r.discount - driver - bill > 0 && (
                        <div>
                          <span>Item discounts</span>
                          <span>−{money(r.discount - driver - bill)}</span>
                        </div>
                      )}
                      {bill > 0 && (
                        <div>
                          <span>Bill discount</span>
                          <span>−{money(bill)}</span>
                        </div>
                      )}
                      {r.tax > 0 && (
                        <div>
                          <span>Tax</span>
                          <span>{money(r.tax)}</span>
                        </div>
                      )}
                      <div className="grand">
                        <span>Total</span>
                        <strong>{money(r.total)}</strong>
                      </div>
                      <div>
                        <span>Paid at sale</span>
                        <span>{money(paid)}</span>
                      </div>
                      {r.change > 0 && (
                        <div>
                          <span>Change</span>
                          <span>{money(r.change)}</span>
                        </div>
                      )}
                      {r.credit > 0 && (
                        <div>
                          <span>Credit</span>
                          <strong>{money(r.credit)}</strong>
                        </div>
                      )}
                      <div>
                        <span>Status</span>
                        <Badge
                          tone={
                            r.status === 'returned' ? 'neutral' : r.credit ? 'warning' : 'success'
                          }
                        >
                          {r.status === 'returned'
                            ? 'Returned'
                            : !r.credit
                              ? 'Paid'
                              : r.credit === r.total
                                ? 'Credit'
                                : 'Part paid / credit'}
                        </Badge>
                      </div>
                    </div>
                  );
                })()}
                {!!receipt.data.installments?.length && (
                  <div className="receipt-installments">
                    <strong>
                      {receipt.data.installments.length > 1 ? 'Installments' : 'Repayment due'}
                    </strong>
                    {receipt.data.installments.map((i) => (
                      <span key={i.id}>
                        {receipt.data!.installments!.length > 1 ? `${i.seq}. ` : ''}
                        {displayDate(i.due_date)} · {money(i.amount)}
                        {i.remaining < i.amount ? ` · ${money(i.remaining)} remaining` : ''}
                      </span>
                    ))}
                  </div>
                )}
                <div className="inline receipt-actions">
                  <button id="print-receipt-button" className="btn" onClick={() => print(false)}>
                    <Printer size={16} />
                    Print receipt
                  </button>
                  <button className="btn secondary" onClick={() => print(true)}>
                    <FileDown size={16} />
                    Save PDF
                  </button>
                  {canRefund && receipt.data.status === 'completed' && (
                    <button
                      className="btn secondary"
                      onClick={() => {
                        setOperationId(crypto.randomUUID());
                        setRefund(true);
                      }}
                    >
                      <Undo2 size={16} />
                      Return items
                    </button>
                  )}
                </div>
                <p className="muted receipt-footer">{receipt.data.shop.receipt_footer}</p>
                {!!receipt.data.returns?.length && (
                  <div className="alert info">
                    {receipt.data.returns.map((r) => (
                      <p key={r.id}>
                        Return {r.id.slice(0, 8)} · {money(r.total_amount)} · Refund{' '}
                        {money(r.refund_amount)} · Credit reduced {money(r.credit_amount)} ·{' '}
                        {r.reason}
                      </p>
                    ))}
                  </div>
                )}
                {!!receipt.data.credit && (
                  <p className="receipt-footer strong">
                    Outstanding on this invoice:{' '}
                    {money(receipt.data.outstanding ?? receipt.data.credit)}
                  </p>
                )}
              </>
            )}
          </QueryState>
        </section>
      )}
      <RecordPages query={query} />
      <QueryState query={query}>
        <Table
          rows={query.data ?? []}
          searchText={(r) => `${r.id} ${r.status}`}
          columns={[
            {
              key: 'id',
              title: 'Invoice',
              value: (r) => (
                <button className="text-btn" onClick={() => setParams({ id: r.id })}>
                  {r.invoice_number ?? `#${r.id.slice(0, 8).toUpperCase()}`}
                </button>
              ),
            },
            {
              key: 'customer',
              title: 'Customer',
              value: (r) => r.customer_name || 'Walk-in',
              sort: (r) => r.customer_name ?? '',
            },
            {
              key: 'date',
              title: 'Date',
              value: (r) => displayDate(r.created_at),
              sort: (r) => r.created_at,
            },
            {
              key: 'total',
              title: 'Total',
              align: 'end',
              value: (r) => money(r.total),
              sort: (r) => r.total,
            },
            { key: 'credit', title: 'Initial credit', align: 'end', value: (r) => money(r.credit) },
            {
              key: 'status',
              title: 'Status',
              value: (r) => (
                <Badge
                  tone={r.status === 'returned' ? 'neutral' : r.credit ? 'warning' : 'success'}
                >
                  {r.status === 'returned'
                    ? 'Returned'
                    : !r.credit
                      ? 'Paid'
                      : r.credit === r.total
                        ? 'Credit'
                        : 'Mixed'}
                </Badge>
              ),
            },
          ]}
        />
      </QueryState>
      {refund && (
        <FormDialog
          title="Return invoice items"
          description="Enter quantities to return (zero skips an item). Unpaid credit on this invoice is reduced first; the remainder is refunded. Confirm stock condition and any external refund."
          fields={[
            ...(receipt.data?.lines
              .filter((l) => l.quantity > (l.returned ?? 0))
              .map((l) => ({
                name: `qty_${l.id}`,
                label: `${l.name} — remaining ${quantity(l.quantity - (l.returned ?? 0))}`,
                type: 'number' as const,
                min: 0,
                required: true,
              })) ?? []),
            { name: 'reason', label: 'Reason for return', required: true, type: 'textarea' },
            {
              name: 'refundMethod',
              label: 'Refund method',
              type: 'select',
              required: true,
              options: ['cash', 'card', 'transfer'].map((v) => ({ value: v, label: v })),
            },
            { name: 'reference', label: 'Confirmed external refund reference' },
            {
              name: 'restock',
              label: 'Returned stock condition',
              required: true,
              type: 'select',
              options: [
                { value: 'true', label: 'Verified sellable — restore to original batches' },
                { value: 'false', label: 'Damaged / unsellable — do not restore stock' },
              ],
            },
          ]}
          initial={{
            refundMethod: 'cash',
            ...Object.fromEntries((receipt.data?.lines ?? []).map((l) => [`qty_${l.id}`, '0'])),
          }}
          onClose={() => setRefund(false)}
          submitLabel="Confirm return"
          onSave={async (v) => {
            await api(`/sales/${selected}/returns`, 'POST', {
              operationId,
              reason: v.reason,
              restock: v.restock === 'true',
              terminalId: (await window.desktop.info()).terminalId,
              refundMethod: v.refundMethod,
              reference: v.reference,
              lines: receipt
                .data!.lines.map((l) => ({
                  lineId: l.id,
                  quantity: decimalToInteger(v[`qty_${l.id}`] || '0', 3),
                }))
                .filter((l) => l.quantity > 0),
            });
            await cache.invalidateQueries();
            toast.success('Return recorded');
          }}
        />
      )}
    </>
  );
}
