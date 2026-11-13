import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  ArrowUpRight,
  ShoppingBasket,
  Package,
  Wallet,
  TrendingUp,
  AlertTriangle,
  Plus,
  Truck,
  UserRound,
  UserPlus,
  CalendarDays,
  Printer,
  HandCoins,
} from 'lucide-react';
import { money, quantity } from '@agripos/shared';
import {
  useData,
  today,
  displayDate,
  type BusinessSummary,
  type InstallmentRow,
  type Sale,
} from '../services/api';
import { useAllowed, useSession } from '../stores/session';
import { PageHeading, QueryState, Badge } from '../components/common';
import { DashboardInsights } from '../components/DashboardInsights';
import {
  DueBadge,
  RecordPaymentDialog,
  customerType,
  dueText,
  printDocument,
} from '../components/Credit';

export function Dashboard() {
  const [customFrom, setCustomFrom] = useState(today()),
    [customTo, setCustomTo] = useState(today());
  const [days, setDays] = useState(7),
    allowed = useAllowed('reports.read'),
    canSell = useAllowed('sales.write'),
    canPay = useAllowed('payments.write'),
    canCatalog = useAllowed('catalog.write'),
    canCustomers = useAllowed('customers.write');
  const [paying, setPaying] = useState<InstallmentRow | null>(null);
  const from = days
      ? new Date(Date.now() - (days - 1) * 86400000).toLocaleDateString('en-CA', {
          timeZone: 'Asia/Colombo',
        })
      : customFrom,
    to = days ? today() : customTo;
  const day = today();
  const business = useData<{
    summary: BusinessSummary;
    repayments: {
      id: string;
      created_at: string;
      amount: number;
      method: string;
      customer_id: string;
      customer_name: string;
      customer_kind: string;
    }[];
  }>(`/reports/business?from=${day}&to=${day}&details=true`, allowed);
  const basic = useData<Record<string, number>>('/dashboard/summary', !allowed);
  const trend = useData<{ day: string; revenue: number }[]>(
    `/dashboard/sales-trend?from=${from}&to=${to}`,
    allowed,
  );
  const alerts = useData<{ id: string; name: string; stock: number }[]>('/dashboard/alerts'),
    sales = useData<Sale[]>('/sales?limit=6', canSell),
    due = useData<{ rows: InstallmentRow[] }>('/credit/due?limit=8', canPay);
  const name = useSession((s) => s.user?.name.split(' ')[0]);
  const s = business.data?.summary;
  const cards: { label: string; value: number; note: string; tone?: string; count?: boolean }[] = s
    ? [
        {
          label: "Today's sales",
          value: s.net_sales!,
          note: `Gross ${money(s.gross_sales!)} before discounts`,
        },
        {
          label: 'Cash collected',
          value: s.net_cash_collected!,
          note: 'Sales cash + repayments − refunds',
        },
        {
          label: 'New credit sales',
          value: s.credit_total!,
          note: `${s.credit_count} fully on credit`,
        },
        { label: 'Mixed cash/credit', value: s.mixed_total!, note: `${s.mixed_count} invoices` },
        {
          label: 'New credit created',
          value: s.credit_created!,
          note: 'Unpaid part of today’s sales',
        },
        {
          label: 'Repayments collected',
          value: s.repayments_total!,
          note: `${s.repayment_count} payments`,
        },
        {
          label: 'Discounts given',
          value: s.discounts!,
          note: `Driver ${money(s.driver_discounts!)}`,
        },
        { label: 'Transactions', value: s.transactions!, note: 'Invoices today', count: true },
        { label: 'Total outstanding', value: s.outstanding!, note: 'All unpaid credit' },
        {
          label: 'Due today',
          value: s.due_today!,
          note: `${s.due_today_invoices} invoices`,
          tone: s.due_today ? 'warning-card' : '',
        },
        {
          label: 'Overdue',
          value: s.overdue!,
          note: `${s.overdue_invoices} invoices`,
          tone: s.overdue ? 'stat-critical' : '',
        },
        { label: 'Due soon', value: s.due_soon!, note: 'Upcoming within the reminder period' },
      ]
    : basic.data
      ? [
          ...(basic.data.products !== undefined
            ? [
                {
                  label: 'Active products',
                  value: basic.data.products,
                  note: 'In the catalog',
                  count: true,
                },
              ]
            : []),
          ...(basic.data.low_stock !== undefined
            ? [
                {
                  label: 'Low-stock products',
                  value: basic.data.low_stock,
                  note: 'Review below',
                  count: true,
                  tone: basic.data.low_stock ? 'stat-critical' : '',
                },
              ]
            : []),
        ]
      : [];
  const out = alerts.data?.filter((a) => a.stock === 0) ?? [],
    low = alerts.data?.filter((a) => a.stock > 0) ?? [];
  return (
    <>
      <PageHeading
        eyebrow={new Date()
          .toLocaleDateString('en-LK', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            timeZone: 'Asia/Colombo',
          })
          .toUpperCase()}
        title={`Good to see you, ${name}.`}
        description="Here’s what’s happening at your shop today."
        action={
          canSell && (
            <Link className="btn" to="/pos">
              <Plus size={17} />
              New sale
            </Link>
          )
        }
      />
      <div className="quick-actions">
        {canSell && (
          <>
            <Link className="primary-action" to="/pos">
              <ShoppingBasket size={18} />
              New sale
            </Link>
            <Link to="/pos?type=driver">
              <Truck size={18} />
              Lorry driver sale
            </Link>
            <Link to="/pos?type=credit">
              <UserRound size={18} />
              Normal customer sale
            </Link>
          </>
        )}
        {canCatalog && (
          <Link to="/products?new=1">
            <Package size={18} />
            Add product
          </Link>
        )}
        {canCustomers && (
          <Link to="/drivers?new=1">
            <UserPlus size={18} />
            Add lorry driver
          </Link>
        )}
        {canPay && (
          <Link to="/credit">
            <HandCoins size={18} />
            Record credit payment
          </Link>
        )}
        {allowed && (
          <Link to="/daily">
            <CalendarDays size={18} />
            Daily sales
          </Link>
        )}
        {canPay && (
          <Link to="/credit">
            <Wallet size={18} />
            Credit management
          </Link>
        )}
        {allowed && (
          <button
            onClick={() =>
              void printDocument(`/reports/detail/business-summary?from=${day}&to=${day}`)
            }
          >
            <Printer size={18} />
            Print daily report
          </button>
        )}
      </div>
      <QueryState query={allowed ? business : basic}>
        <div className="stats-grid">
          {cards.map((c) => (
            <div className={`stat-card ${c.tone ?? ''}`} key={c.label}>
              <div className="stat-top">
                <span>{c.label}</span>
              </div>
              <strong>{c.count ? c.value : money(c.value)}</strong>
              <small>{c.note}</small>
            </div>
          ))}
        </div>
      </QueryState>
      <div className="dashboard-grid">
        {canPay && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Credit to collect</h2>
                <p>Overdue first, then due today and upcoming</p>
              </div>
              <Link className="text-btn" to="/credit">
                All credit <ArrowUpRight size={15} />
              </Link>
            </div>
            <QueryState query={due}>
              {due.data?.rows.length ? (
                <table className="compact-table">
                  <tbody>
                    {due.data.rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <Link to={`/credit?customer=${r.customer_id}`}>
                            <strong>{r.customer_name}</strong>
                          </Link>
                          <small className="block muted">
                            {customerType(r.customer_kind)}
                            {r.factory ? ` · ${r.factory}` : ''} · {r.invoice_number}
                          </small>
                        </td>
                        <td>
                          {displayDate(r.due_date)}
                          <small
                            className={`block ${r.status === 'overdue' ? 'error-text' : 'muted'}`}
                          >
                            {dueText(r)}
                          </small>
                        </td>
                        <td>
                          <DueBadge row={r} />
                        </td>
                        <td className="numeric strong">{money(r.remaining)}</td>
                        <td className="numeric">
                          <button className="btn secondary small" onClick={() => setPaying(r)}>
                            Pay
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty">No unpaid credit. Everything is settled.</div>
              )}
            </QueryState>
          </section>
        )}
        <section className="panel alerts-panel">
          <div className="section-heading">
            <div>
              <h2>Stock alerts</h2>
              <p>
                {out.length} out of stock · {low.length} low
              </p>
            </div>
            <span className="badge danger">{alerts.data?.length ?? 0}</span>
          </div>
          <QueryState query={alerts}>
            {alerts.data?.length ? (
              <div className="alert-list">
                {[...out, ...low].slice(0, 6).map((a) => (
                  <Link to="/inventory" className="inventory-alert" key={a.id}>
                    <span className="alert-icon">
                      <AlertTriangle size={17} />
                    </span>
                    <div>
                      <strong>{a.name}</strong>
                      <small>
                        {a.stock === 0
                          ? 'Out of stock'
                          : `Low stock · ${quantity(a.stock)} remaining`}
                      </small>
                    </div>
                    <ArrowUpRight size={15} />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty">
                <Package size={30} />
                <h3>All clear for now</h3>
                <p>No low-stock alerts to review.</p>
              </div>
            )}
          </QueryState>
          <Link className="panel-link" to="/inventory">
            View inventory <ArrowUpRight size={15} />
          </Link>
        </section>
        <section className="panel recent-panel">
          <div className="section-heading">
            <div>
              <h2>Recent transactions</h2>
              <p>Your latest sales</p>
            </div>
            {canSell && (
              <Link className="text-btn" to="/sales">
                View all <ArrowUpRight size={15} />
              </Link>
            )}
          </div>
          {canSell ? (
            <QueryState query={sales}>
              {sales.data?.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Customer</th>
                      <th>Status</th>
                      <th className="numeric">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.data.map((sale) => (
                      <tr key={sale.id}>
                        <td>
                          <Link to={`/sales?id=${sale.id}`}>
                            {sale.invoice_number ?? `#${sale.id.slice(0, 8).toUpperCase()}`}
                          </Link>
                          <small className="block muted">{displayDate(sale.created_at)}</small>
                        </td>
                        <td>{sale.customer_name || 'Walk-in'}</td>
                        <td>
                          <Badge
                            tone={
                              sale.status === 'returned'
                                ? 'neutral'
                                : sale.credit
                                  ? 'warning'
                                  : 'success'
                            }
                          >
                            {sale.status === 'returned'
                              ? 'Returned'
                              : !sale.credit
                                ? 'Paid'
                                : sale.credit === sale.total
                                  ? 'Credit'
                                  : 'Mixed'}
                          </Badge>
                        </td>
                        <td className="numeric strong">{money(sale.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty">No transactions yet. Create a sale to begin.</div>
              )}
            </QueryState>
          ) : (
            <div className="empty">Sales are available to authorized cashiers and managers.</div>
          )}
        </section>
        {allowed && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Recent repayments</h2>
                <p>Credit payments received today</p>
              </div>
              <Link className="text-btn" to="/daily">
                Daily business <ArrowUpRight size={15} />
              </Link>
            </div>
            {business.data?.repayments.length ? (
              <table className="compact-table">
                <tbody>
                  {business.data.repayments.slice(0, 6).map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link to={`/credit?customer=${r.customer_id}`}>{r.customer_name}</Link>
                        <small className="block muted">{customerType(r.customer_kind)}</small>
                      </td>
                      <td className="muted">{r.method}</td>
                      <td className="numeric strong">{money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty">No repayments received today.</div>
            )}
          </section>
        )}
        {allowed && (
          <section className="panel chart-panel">
            <div className="section-heading">
              <div>
                <h2>Sales overview</h2>
                <p>Daily revenue · LKR</p>
              </div>
              <div className="segmented">
                {[7, 30].map((n) => (
                  <button
                    key={n}
                    className={days === n ? 'selected' : ''}
                    onClick={() => setDays(n)}
                  >
                    {n} days
                  </button>
                ))}
                <button className={!days ? 'selected' : ''} onClick={() => setDays(0)}>
                  Custom
                </button>
              </div>
            </div>
            {!days && (
              <div className="inline" style={{ padding: '0 22px' }}>
                <label>
                  From
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                  />
                </label>
              </div>
            )}
            <QueryState query={trend}>
              {trend.data?.length ? (
                <div className="chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trend.data.map((r) => ({ ...r, revenue: r.revenue / 100 }))}>
                      <defs>
                        <linearGradient id="revenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#146b4a" stopOpacity={0.2} />
                          <stop offset="100%" stopColor="#146b4a" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        vertical={false}
                        stroke="var(--border)"
                        strokeDasharray="3 5"
                      />
                      <XAxis
                        dataKey="day"
                        tickFormatter={(v) => String(v).slice(5, 10)}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis tickLine={false} axisLine={false} width={65} />
                      <Tooltip formatter={(v) => money(Number(v) * 100)} />
                      <Area
                        type="monotone"
                        dataKey="revenue"
                        stroke="#146b4a"
                        strokeWidth={2.5}
                        fill="url(#revenue)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty chart-empty">
                  <TrendingUp size={32} />
                  <h3>Your next chapter starts with a sale.</h3>
                  <p>Recorded sales will appear here automatically.</p>
                </div>
              )}
            </QueryState>
          </section>
        )}
      </div>
      {allowed && <DashboardInsights from={from} to={to} />}
      {paying && (
        <RecordPaymentDialog
          customerId={paying.customer_id}
          customerName={paying.customer_name}
          installment={paying}
          onClose={() => setPaying(null)}
        />
      )}
    </>
  );
}
