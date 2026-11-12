import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  tax: number;
  discount: number;
  cash_tendered: number;
  change: number;
  shop: { name: string; address: string; phone: string; receipt_footer: string };
  lines: {
    id: string;
    name: string;
    quantity: number;
    returned: number;
    unit_price: number;
    total: number;
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
                  </div>
                  <button className="text-btn" onClick={() => setParams({})}>
                    Close preview
                  </button>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Quantity</th>
                      <th>Unit price</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipt.data.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.name}</td>
                        <td>{quantity(l.quantity)}</td>
                        <td>{money(l.unit_price)}</td>
                        <td>{money(l.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="receipt-summary">
                  <span>
                    Tax {money(receipt.data.tax)} · Discount {money(receipt.data.discount)} · Credit{' '}
                    {money(receipt.data.credit)} · Change {money(receipt.data.change)}
                  </span>
                  <strong>Total {money(receipt.data.total)}</strong>
                </div>
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
                  <p>
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
                  #{r.id.slice(0, 8).toUpperCase()}
                </button>
              ),
            },
            {
              key: 'date',
              title: 'Date',
              value: (r) => displayDate(r.created_at),
              sort: (r) => r.created_at,
            },
            { key: 'total', title: 'Total', value: (r) => money(r.total), sort: (r) => r.total },
            { key: 'credit', title: 'Initial credit', value: (r) => money(r.credit) },
            {
              key: 'status',
              title: 'Status',
              value: (r) => (
                <Badge tone={r.status === 'returned' ? 'warning' : 'success'}>{r.status}</Badge>
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
