import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileDown, Printer, Wallet } from 'lucide-react';
import { decimalToInteger, money, paymentLabel } from '@agripos/shared';
import { toast } from 'sonner';
import {
  api,
  displayDate,
  printOptions,
  useData,
  useDebounced,
  type CreditProfileData,
  type InstallmentRow,
} from '../services/api';
import { Badge, QueryState } from './common';
import { Modal } from './Modal';
import { Table } from './Table';
import { useAllowed } from '../stores/session';

const stateLabel = {
  overdue: 'Overdue',
  due_today: 'Due today',
  due_soon: 'Due soon',
  upcoming: 'Upcoming',
  paid: 'Paid',
} as const;
const stateTone = {
  overdue: 'danger',
  due_today: 'warning',
  due_soon: 'warning',
  upcoming: 'neutral',
  paid: 'success',
} as const;
export function DueBadge({
  row,
}: {
  row: Pick<InstallmentRow, 'status' | 'amount' | 'remaining'>;
}) {
  const partial = paymentLabel(row.amount, row.remaining) === 'Partially paid';
  return (
    <Badge tone={stateTone[row.status]}>
      {stateLabel[row.status]}
      {partial ? ' · part paid' : ''}
    </Badge>
  );
}
export function dueText(row: Pick<InstallmentRow, 'status' | 'days'>) {
  if (row.status === 'paid') return '—';
  if (row.days < 0) return `${-row.days} day${row.days === -1 ? '' : 's'} overdue`;
  if (row.days === 0) return 'Today';
  return `In ${row.days} day${row.days === 1 ? '' : 's'}`;
}
export const customerType = (kind: string) =>
  kind === 'driver' ? 'Lorry driver' : 'Normal customer';

export async function printPaymentReceipt(paymentId: string, pdf = false) {
  try {
    const result = await window.desktop.printPaymentReceipt({ paymentId, pdf, ...printOptions() });
    if (!result.cancelled) toast.success(pdf ? 'Receipt PDF saved' : 'Receipt sent to printer');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Printing failed');
  }
}
export async function printDocument(path: string, pdf = false) {
  try {
    const result = await window.desktop.printDocument({ path, pdf });
    if (!result.cancelled) toast.success(pdf ? 'PDF saved' : 'Sent to printer');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Printing failed');
  }
}

interface Preview {
  outstanding: number;
  allocations: {
    installmentId: string;
    invoiceNumber: string;
    seq: number;
    dueDate: string;
    amount: number;
    remainingBefore: number;
    remainingAfter: number;
  }[];
}
/** Records a repayment after showing exactly which installments it will settle. */
export function RecordPaymentDialog({
  customerId,
  customerName,
  installment,
  onClose,
}: {
  customerId: string;
  customerName: string;
  installment?: Pick<InstallmentRow, 'id' | 'remaining' | 'invoice_number' | 'seq'>;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const [operationId] = useState(() => crypto.randomUUID()),
    [amount, setAmount] = useState(installment ? String(installment.remaining / 100) : ''),
    [method, setMethod] = useState<'cash' | 'card' | 'transfer'>('cash'),
    [reference, setReference] = useState(''),
    [notes, setNotes] = useState(''),
    [mode, setMode] = useState<'oldest' | 'selected'>(installment ? 'selected' : 'oldest'),
    [preview, setPreview] = useState<Preview | null>(null),
    [problem, setProblem] = useState(''),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState<string | null>(null);
  const cents = useMemo(() => {
    try {
      return amount ? decimalToInteger(amount) : 0;
    } catch {
      return -1;
    }
  }, [amount]);
  const debounced = useDebounced(cents, 300);
  const allocations =
    mode === 'selected' && installment && debounced > 0
      ? [{ installmentId: installment.id, amount: debounced }]
      : undefined;
  useEffect(() => {
    setProblem('');
    if (debounced <= 0) {
      setPreview(null);
      if (debounced < 0) setProblem('Enter a valid amount, for example 4000 or 4000.50');
      return;
    }
    let current = true;
    api<Preview>(`/customers/${customerId}/payments/preview`, 'POST', {
      amount: debounced,
      ...(allocations ? { allocations } : {}),
    })
      .then((p) => current && setPreview(p))
      .catch((e: Error) => {
        if (!current) return;
        setPreview(null);
        setProblem(e.message);
      });
    return () => {
      current = false;
    };
  }, [debounced, mode, customerId, installment?.id]);
  const save = async () => {
    setSaving(true);
    try {
      const result = await api<{ id: string }>(`/customers/${customerId}/payments`, 'POST', {
        operationId,
        terminalId: (await window.desktop.info()).terminalId,
        payment: { method, amount: cents, reference },
        ...(allocations ? { allocations } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setSaved(result.id);
      await cache.invalidateQueries();
      toast.success(`Payment of ${money(cents)} recorded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setSaving(false);
    }
  };
  if (saved)
    return (
      <Modal
        title="Payment recorded"
        description={`${customerName} · ${money(cents)}`}
        onClose={onClose}
      >
        <div className="alert info">
          The payment was saved and applied to the installments shown.
        </div>
        <div className="form-actions">
          <button className="btn secondary" onClick={() => void printPaymentReceipt(saved, true)}>
            <FileDown size={16} />
            Save receipt PDF
          </button>
          <button className="btn secondary" onClick={() => void printPaymentReceipt(saved)}>
            <Printer size={16} />
            Print receipt
          </button>
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  const ready = cents > 0 && !!preview && !problem && (method === 'cash' || reference.trim());
  return (
    <Modal
      title={`Record payment · ${customerName}`}
      description={
        preview ? `Outstanding before this payment: ${money(preview.outstanding)}` : undefined
      }
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <button className="btn secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={!ready || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : `Confirm ${cents > 0 ? money(cents) : 'payment'}`}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          Amount (LKR) *
          <input
            autoFocus
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          Method *
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="transfer">Bank transfer</option>
          </select>
        </label>
        {method !== 'cash' && (
          <label>
            Confirmed reference *
            <input value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
        )}
        {installment && (
          <label>
            Apply payment to
            <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="selected">
                {installment.invoice_number} · installment {installment.seq}
              </option>
              <option value="oldest">Oldest due installments first</option>
            </select>
          </label>
        )}
        <label className="full">
          Notes
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {problem && <div className="alert danger">{problem}</div>}
      {preview && (
        <table className="compact-table">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Installment due</th>
              <th className="numeric">Before</th>
              <th className="numeric">Paying</th>
              <th className="numeric">After</th>
            </tr>
          </thead>
          <tbody>
            {preview.allocations.map((a) => (
              <tr key={a.installmentId}>
                <td>
                  {a.invoiceNumber} · #{a.seq}
                </td>
                <td>{displayDate(a.dueDate)}</td>
                <td className="numeric">{money(a.remainingBefore)}</td>
                <td className="numeric strong">{money(a.amount)}</td>
                <td className="numeric">
                  {a.remainingAfter ? money(a.remainingAfter) : <Badge tone="success">Paid</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

/** Complete credit history for a driver or normal credit customer, derived from transactions. */
export function CreditProfile({ customerId, onBack }: { customerId: string; onBack: () => void }) {
  const query = useData<CreditProfileData>(`/customers/${customerId}/credit-profile`),
    canSell = useAllowed('sales.write');
  const [paying, setPaying] = useState<InstallmentRow | 'any' | null>(null);
  const p = query.data;
  const driver = p?.customer.kind === 'driver';
  return (
    <>
      <div className="page-heading">
        <div>
          <button className="text-btn" onClick={onBack}>
            <ArrowLeft size={15} />
            Back
          </button>
          <h1>{p?.customer.name ?? 'Credit profile'}</h1>
          <p>
            {p
              ? [
                  customerType(p.customer.kind),
                  p.customer.driver_code,
                  p.customer.factory,
                  p.customer.lorry_number && `Lorry ${p.customer.lorry_number}`,
                  p.customer.phone,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Loading…'}
          </p>
        </div>
        {p && (
          <div className="inline wrap">
            {driver && (
              <button
                className="btn secondary"
                onClick={() => void printDocument(`/drivers/${customerId}/statement`)}
              >
                <Printer size={16} />
                Print statement
              </button>
            )}
            {driver && canSell && (
              <Link className="btn secondary" to={`/pos?driver=${customerId}`}>
                New sale
              </Link>
            )}
            <button
              className="btn"
              disabled={p.customer.outstanding <= 0}
              onClick={() => setPaying('any')}
            >
              <Wallet size={16} />
              Record payment
            </button>
          </div>
        )}
      </div>
      <QueryState query={query}>
        {p && (
          <>
            <div className="stats-grid">
              {(
                [
                  ['Total purchases', p.totals.purchases, `${p.totals.invoices} invoices`],
                  ['Paid at sale', p.totals.paid_at_sale, 'Cash, card and transfer'],
                  [
                    'Credit issued',
                    p.totals.credit_issued,
                    `${p.totals.credit_invoices} credit · ${p.totals.mixed_invoices} mixed`,
                  ],
                  ['Credit repaid', p.totals.credit_paid, `${p.payments.length} payments`],
                  [
                    'Outstanding',
                    p.customer.outstanding,
                    p.customer.next_due
                      ? `Next due ${displayDate(p.customer.next_due)}`
                      : 'Nothing due',
                  ],
                  ['Overdue', p.customer.overdue, 'Unpaid past due date'],
                ] as const
              ).map(([label, value, note]) => (
                <div
                  key={label}
                  className={`stat-card ${label === 'Overdue' && value ? 'stat-critical' : ''}`}
                >
                  <span>{label}</span>
                  <strong>{money(value ?? 0)}</strong>
                  <small>{note}</small>
                </div>
              ))}
            </div>
            {(p.totals.discounts ?? 0) > 0 && (
              <p className="muted table-note">Discounts received: {money(p.totals.discounts!)}</p>
            )}
            <div className="profile-grid">
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <h2>Due by month</h2>
                    <p>Unpaid installments from every credit invoice</p>
                  </div>
                </div>
                {p.monthly.length ? (
                  <table className="compact-table">
                    <tbody>
                      {p.monthly.map((m) => (
                        <tr key={m.month}>
                          <td>
                            {new Date(`${m.month}-01T00:00:00`).toLocaleDateString('en-LK', {
                              month: 'long',
                              year: 'numeric',
                            })}
                          </td>
                          <td className="muted">{m.installments} installment(s)</td>
                          <td className="numeric strong">{money(m.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty">No unpaid installments.</div>
                )}
              </section>
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <h2>{driver ? 'Driver' : 'Customer'} details</h2>
                    <p>{p.customer.active ? 'Active' : 'Inactive'}</p>
                  </div>
                </div>
                <dl className="details-list">
                  {driver && (
                    <>
                      <dt>Driver ID</dt>
                      <dd>{p.customer.driver_code}</dd>
                      <dt>Factory</dt>
                      <dd>
                        <Link to={`/factories?id=${p.customer.factory_id}`}>
                          {p.customer.factory}
                        </Link>
                      </dd>
                      <dt>Lorry</dt>
                      <dd>{p.customer.lorry_number || '—'}</dd>
                      <dt>Registered</dt>
                      <dd>{displayDate(p.customer.registered_at)}</dd>
                    </>
                  )}
                  <dt>Phone</dt>
                  <dd>{p.customer.phone || '—'}</dd>
                  {p.customer.address && (
                    <>
                      <dt>Address</dt>
                      <dd>{p.customer.address}</dd>
                    </>
                  )}
                  {p.customer.notes && (
                    <>
                      <dt>Notes</dt>
                      <dd>{p.customer.notes}</dd>
                    </>
                  )}
                </dl>
              </section>
            </div>
            <h2 className="section-title">Installments</h2>
            <Table
              rows={p.installments}
              searchText={(r) => `${r.invoice_number} ${r.status}`}
              empty="No credit installments."
              columns={[
                { key: 'invoice', title: 'Invoice', value: (r) => r.invoice_number },
                {
                  key: 'seq',
                  title: 'Installment',
                  value: (r) => `${r.seq} of ${r.installment_count}`,
                },
                {
                  key: 'due',
                  title: 'Due date',
                  value: (r) => displayDate(r.due_date),
                  sort: (r) => r.due_date,
                },
                { key: 'amount', title: 'Original', align: 'end', value: (r) => money(r.amount) },
                {
                  key: 'paid',
                  title: 'Paid',
                  align: 'end',
                  value: (r) => money(r.paid + r.reduced),
                },
                {
                  key: 'remaining',
                  title: 'Remaining',
                  align: 'end',
                  value: (r) => <strong>{money(r.remaining)}</strong>,
                  sort: (r) => r.remaining,
                },
                { key: 'status', title: 'Status', value: (r) => <DueBadge row={r} /> },
                {
                  key: 'action',
                  title: 'Actions',
                  align: 'end',
                  value: (r) =>
                    r.remaining > 0 && (
                      <button className="btn secondary small" onClick={() => setPaying(r)}>
                        Pay
                      </button>
                    ),
                },
              ]}
            />
            <h2 className="section-title">Invoices</h2>
            <Table
              rows={p.invoices}
              searchText={(r) => `${r.invoice_number} ${r.payment_type}`}
              empty="No invoices yet."
              columns={[
                {
                  key: 'invoice',
                  title: 'Invoice',
                  value: (r) => <Link to={`/sales?id=${r.id}`}>{r.invoice_number}</Link>,
                },
                {
                  key: 'date',
                  title: 'Date',
                  value: (r) => displayDate(r.created_at),
                  sort: (r) => r.created_at,
                },
                {
                  key: 'type',
                  title: 'Payment',
                  value: (r) => (
                    <Badge tone={r.payment_type === 'cash' ? 'success' : 'warning'}>
                      {r.payment_type === 'cash'
                        ? 'Paid'
                        : r.payment_type === 'credit'
                          ? 'Credit'
                          : 'Mixed'}
                    </Badge>
                  ),
                },
                {
                  key: 'discount',
                  title: 'Discount',
                  align: 'end',
                  value: (r) => money(r.discount),
                },
                { key: 'total', title: 'Total', align: 'end', value: (r) => money(r.total) },
                {
                  key: 'paid',
                  title: 'Paid at sale',
                  align: 'end',
                  value: (r) => money(r.paid_at_sale),
                },
                { key: 'credit', title: 'Credit', align: 'end', value: (r) => money(r.credit) },
                {
                  key: 'outstanding',
                  title: 'Outstanding',
                  align: 'end',
                  value: (r) => <strong>{money(r.outstanding)}</strong>,
                },
              ]}
            />
            <h2 className="section-title">Payments</h2>
            <Table
              rows={p.payments}
              searchText={(r) => `${r.method} ${r.invoices ?? ''} ${r.notes}`}
              empty="No repayments recorded."
              columns={[
                {
                  key: 'date',
                  title: 'Date',
                  value: (r) => new Date(r.created_at).toLocaleString('en-LK'),
                  sort: (r) => r.created_at,
                },
                { key: 'method', title: 'Method', value: (r) => r.method },
                { key: 'invoices', title: 'Applied to', value: (r) => r.invoices ?? '—' },
                { key: 'notes', title: 'Notes', value: (r) => r.notes || '—' },
                {
                  key: 'amount',
                  title: 'Amount',
                  align: 'end',
                  value: (r) => <strong>{money(r.amount)}</strong>,
                },
                {
                  key: 'receipt',
                  title: 'Receipt',
                  align: 'end',
                  value: (r) => (
                    <button
                      className="icon-btn"
                      aria-label="Print payment receipt"
                      onClick={() => void printPaymentReceipt(r.id)}
                    >
                      <Printer size={15} />
                    </button>
                  ),
                },
              ]}
            />
          </>
        )}
      </QueryState>
      {paying && p && (
        <RecordPaymentDialog
          customerId={customerId}
          customerName={p.customer.name}
          installment={paying === 'any' ? undefined : paying}
          onClose={() => setPaying(null)}
        />
      )}
    </>
  );
}
