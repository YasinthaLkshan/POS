import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileDown, Printer } from 'lucide-react';
import { money } from '@agripos/shared';
import { useData, today, type BusinessSummary } from '../services/api';
import { Badge, PageHeading, QueryState } from '../components/common';
import { Table } from '../components/Table';
import { printDocument, printPaymentReceipt, customerType } from '../components/Credit';

interface Details {
  summary: BusinessSummary;
  sales: {
    id: string;
    invoice_number: string;
    created_at: string;
    customer_name: string;
    customer_kind: string | null;
    factory: string | null;
    subtotal: number;
    discount: number;
    total: number;
    cash: number;
    other_payments: number;
    credit: number;
    payment_type: string;
    status: string;
    cashier: string;
  }[];
  repayments: {
    id: string;
    created_at: string;
    amount: number;
    method: string;
    customer_id: string;
    customer_name: string;
    customer_kind: string;
    factory: string | null;
  }[];
  returns: {
    id: string;
    created_at: string;
    reason: string;
    total_amount: number;
    credit_amount: number;
    refund_amount: number;
    refund_method: string;
    invoice_number: string;
  }[];
}
const time = (value: string) =>
  new Date(value).toLocaleString('en-LK', {
    timeZone: 'Asia/Colombo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
export function Line({
  label,
  value,
  count,
  total,
}: {
  label: string;
  value: number;
  count?: number;
  total?: boolean;
}) {
  return (
    <div className={`summary-line ${total ? 'total' : ''}`}>
      <span>
        {label}
        {count !== undefined ? ` (${count})` : ''}
      </span>
      <strong>{money(value || 0)}</strong>
    </div>
  );
}
export function DailyBusiness() {
  const [from, setFrom] = useState(today()),
    [to, setTo] = useState(today()),
    [range, setRange] = useState(false);
  const end = range ? to : from;
  const valid = !!from && !!end && from <= end;
  const query = useData<Details>(`/reports/business?from=${from}&to=${end}&details=true`, valid);
  const s = query.data?.summary;
  const reportPath = `/reports/detail/business-summary?from=${from}&to=${end}`;
  return (
    <>
      <PageHeading
        title="Daily business"
        description="Sales, cash received and credit for a business day (Asia/Colombo). Repayments are cash received, not new sales."
        action={
          <div className="inline wrap">
            <button
              className="btn secondary"
              disabled={!valid}
              onClick={() => void printDocument(reportPath, true)}
            >
              <FileDown size={16} />
              Save PDF
            </button>
            <button
              className="btn"
              disabled={!valid}
              onClick={() => void printDocument(reportPath)}
            >
              <Printer size={16} />
              Print end-of-day summary
            </button>
          </div>
        }
      />
      <div className="panel report-filters">
        <label>
          {range ? 'From' : 'Business date'}
          <input type="date" value={from} max={today()} onChange={(e) => setFrom(e.target.value)} />
        </label>
        {range && (
          <label>
            To
            <input type="date" value={to} max={today()} onChange={(e) => setTo(e.target.value)} />
          </label>
        )}
        <button className="text-btn" onClick={() => setRange(!range)}>
          {range ? 'Single day' : 'Choose a date range'}
        </button>
        <span className="muted">LKR · all amounts from saved transactions</span>
      </div>
      {!valid ? (
        <div className="alert danger">Choose a valid date range.</div>
      ) : (
        <QueryState query={query}>
          {s && query.data && (
            <>
              <div className="summary-groups">
                <section className="panel">
                  <h2>Sales</h2>
                  <Line
                    label="Gross sales (before discounts)"
                    value={s.gross_sales!}
                    count={s.transactions}
                  />
                  <Line label="Driver discounts" value={-s.driver_discounts!} />
                  <Line label="Bill discounts" value={-s.bill_discounts!} />
                  {s.other_discounts !== 0 && (
                    <Line label="Other discounts" value={-s.other_discounts!} />
                  )}
                  <Line label="Returns" value={-s.returns_total!} count={s.returns_count} />
                  <Line label="Net sales" value={s.net_sales!} total />
                  <Line label="Fully paid sales" value={s.paid_total!} count={s.paid_count} />
                  <Line label="Fully credit sales" value={s.credit_total!} count={s.credit_count} />
                  <Line
                    label="Mixed cash/credit sales"
                    value={s.mixed_total!}
                    count={s.mixed_count}
                  />
                </section>
                <section className="panel">
                  <h2>Cash received</h2>
                  <Line label="Cash from new sales" value={s.cash_from_sales!} />
                  <Line label="Cash from credit repayments" value={s.repayments_cash!} />
                  <Line label="Cash refunds" value={-s.cash_refunds!} />
                  <Line label="Net cash collected" value={s.net_cash_collected!} total />
                  <Line label="Card payments (sales)" value={s.card_from_sales!} />
                  <Line label="Bank transfers (sales)" value={s.transfer_from_sales!} />
                  <Line
                    label="Card/transfer repayments"
                    value={s.repayments_card! + s.repayments_transfer!}
                  />
                </section>
                <section className="panel">
                  <h2>Credit</h2>
                  <Line label="New credit created" value={s.credit_created!} />
                  <Line
                    label="Repayments received"
                    value={s.repayments_total!}
                    count={s.repayment_count}
                  />
                  <Line label="Credit reduced by returns" value={s.credit_reduced_by_returns!} />
                  <Line label="Total outstanding (now)" value={s.outstanding!} total />
                  <Line label="Overdue (now)" value={s.overdue!} count={s.overdue_invoices} />
                  <Line label="Due today (now)" value={s.due_today!} count={s.due_today_invoices} />
                  {s.gross_profit !== undefined && (
                    <>
                      <Line label="Estimated gross profit" value={s.gross_profit} />
                      {s.lines_without_cost! > 0 && (
                        <small className="muted">
                          {s.lines_without_cost} sold item(s) have no cost price; profit is
                          understated or unreliable for them.
                        </small>
                      )}
                    </>
                  )}
                </section>
              </div>
              <h2 className="section-title">Sales</h2>
              <Table
                rows={query.data.sales}
                searchText={(r) => `${r.invoice_number} ${r.customer_name} ${r.factory ?? ''}`}
                empty="No sales on this date."
                columns={[
                  {
                    key: 'invoice',
                    title: 'Invoice',
                    value: (r) => <Link to={`/sales?id=${r.id}`}>{r.invoice_number}</Link>,
                  },
                  {
                    key: 'time',
                    title: 'Time',
                    value: (r) => time(r.created_at),
                    sort: (r) => r.created_at,
                  },
                  {
                    key: 'customer',
                    title: 'Customer',
                    value: (r) =>
                      r.customer_kind ? (
                        <>
                          {r.customer_name}
                          <small className="block muted">
                            {customerType(r.customer_kind)}
                            {r.factory ? ` · ${r.factory}` : ''}
                          </small>
                        </>
                      ) : (
                        'Walk-in'
                      ),
                  },
                  {
                    key: 'type',
                    title: 'Payment',
                    value: (r) => (
                      <Badge
                        tone={
                          r.status === 'returned'
                            ? 'neutral'
                            : r.payment_type === 'cash'
                              ? 'success'
                              : 'warning'
                        }
                      >
                        {r.status === 'returned'
                          ? 'Returned'
                          : r.payment_type === 'cash'
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
                  { key: 'cash', title: 'Cash', align: 'end', value: (r) => money(r.cash) },
                  { key: 'credit', title: 'Credit', align: 'end', value: (r) => money(r.credit) },
                  {
                    key: 'total',
                    title: 'Total',
                    align: 'end',
                    value: (r) => <strong>{money(r.total)}</strong>,
                  },
                ]}
              />
              <h2 className="section-title">Credit repayments received</h2>
              <Table
                rows={query.data.repayments}
                empty="No repayments on this date."
                columns={[
                  {
                    key: 'time',
                    title: 'Time',
                    value: (r) => time(r.created_at),
                    sort: (r) => r.created_at,
                  },
                  {
                    key: 'customer',
                    title: 'Customer',
                    value: (r) => (
                      <Link to={`/credit?customer=${r.customer_id}`}>{r.customer_name}</Link>
                    ),
                  },
                  {
                    key: 'type',
                    title: 'Type',
                    value: (r) =>
                      `${customerType(r.customer_kind)}${r.factory ? ` · ${r.factory}` : ''}`,
                  },
                  { key: 'method', title: 'Method', value: (r) => r.method },
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
              {query.data.returns.length > 0 && (
                <>
                  <h2 className="section-title">Returns and refunds</h2>
                  <Table
                    rows={query.data.returns}
                    columns={[
                      { key: 'invoice', title: 'Invoice', value: (r) => r.invoice_number },
                      { key: 'time', title: 'Time', value: (r) => time(r.created_at) },
                      { key: 'reason', title: 'Reason', value: (r) => r.reason },
                      {
                        key: 'total',
                        title: 'Returned value',
                        align: 'end',
                        value: (r) => money(r.total_amount),
                      },
                      {
                        key: 'credit',
                        title: 'Credit reduced',
                        align: 'end',
                        value: (r) => money(r.credit_amount),
                      },
                      {
                        key: 'refund',
                        title: 'Refund',
                        align: 'end',
                        value: (r) =>
                          `${money(r.refund_amount)}${r.refund_amount ? ` · ${r.refund_method}` : ''}`,
                      },
                    ]}
                  />
                </>
              )}
            </>
          )}
        </QueryState>
      )}
    </>
  );
}
