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
  Receipt,
} from 'lucide-react';
import { money, quantity } from '@agripos/shared';
import { useData, today, displayDate, type Sale } from '../services/api';
import { useAllowed, useSession } from '../stores/session';
import { PageHeading, QueryState, Badge } from '../components/common';
import { DashboardInsights } from '../components/DashboardInsights';
export function Dashboard() {
  const [customFrom, setCustomFrom] = useState(today()),
    [customTo, setCustomTo] = useState(today());
  const [days, setDays] = useState(7),
    allowed = useAllowed('reports.read'),
    canSell = useAllowed('sales.write');
  const from = days
      ? new Date(Date.now() - (days - 1) * 86400000).toLocaleDateString('en-CA', {
          timeZone: 'Asia/Colombo',
        })
      : customFrom,
    to = days ? today() : customTo;
  const summary = useData<Record<string, number>>('/dashboard/summary'),
    trend = useData<{ day: string; revenue: number }[]>(
      `/dashboard/sales-trend?from=${from}&to=${to}`,
      allowed,
    );
  const alerts = useData<{ id: string; name: string; stock: number }[]>('/dashboard/alerts'),
    sales = useData<Sale[]>('/sales?limit=5', canSell);
  const name = useSession((s) => s.user?.name.split(' ')[0]);
  const cards = [
    { label: "Today's sales", key: 'revenue', icon: Wallet, currency: true },
    { label: "Today's transactions", key: 'transactions', icon: Receipt },
    { label: "Today's gross profit", key: 'profit', icon: TrendingUp, currency: true },
    { label: 'Active products', key: 'products', icon: Package },
    { label: 'Low-stock products', key: 'low_stock', icon: AlertTriangle, danger: true },
    { label: 'Outstanding credit', key: 'outstanding', icon: Wallet, currency: true },
  ];
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
      <QueryState query={summary}>
        <div className="stats-grid">
          {cards
            .filter((c) => summary.data?.[c.key] !== undefined)
            .map(({ label, key, icon: Icon, currency, danger }) => (
              <div
                className={`stat-card ${danger && summary.data?.[key] ? 'stat-critical' : ''}`}
                key={key}
              >
                <div className="stat-top">
                  <span>{label}</span>
                  <Icon size={18} />
                </div>
                <strong>
                  {currency ? money(summary.data?.[key] ?? 0) : (summary.data?.[key] ?? 0)}
                </strong>
                <small>{danger ? 'Review products below' : 'From your shop records'}</small>
              </div>
            ))}
        </div>
      </QueryState>
      <div className="dashboard-grid">
        <section className="panel chart-panel">
          <div className="section-heading">
            <div>
              <h2>Sales overview</h2>
              <p>Daily revenue · LKR</p>
            </div>
            <div className="segmented">
              {[7, 30].map((n) => (
                <button key={n} className={days === n ? 'selected' : ''} onClick={() => setDays(n)}>
                  {n} days
                </button>
              ))}
              <button className={!days ? 'selected' : ''} onClick={() => setDays(0)}>
                Custom
              </button>
            </div>
          </div>
          {!days && (
            <div className="inline">
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
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </label>
            </div>
          )}
          {allowed ? (
            <QueryState query={trend}>
              {trend.data?.length ? (
                <div className="chart">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trend.data.map((r) => ({ ...r, revenue: r.revenue / 100 }))}>
                      <defs>
                        <linearGradient id="revenue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#21845b" stopOpacity={0.2} />
                          <stop offset="100%" stopColor="#21845b" stopOpacity={0} />
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
                        stroke="#21845b"
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
          ) : (
            <div className="empty">Financial reports are restricted to managers.</div>
          )}
        </section>
        <section className="panel alerts-panel">
          <div className="section-heading">
            <div>
              <h2>Needs your attention</h2>
              <p>Inventory health</p>
            </div>
            <span className="badge danger">{alerts.data?.length ?? 0}</span>
          </div>
          <QueryState query={alerts}>
            {alerts.data?.length ? (
              <div className="alert-list">
                {alerts.data.slice(0, 5).map((a) => (
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
              <p>Your latest completed sales</p>
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
                      <th>Date</th>
                      <th>Status</th>
                      <th className="numeric">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.data.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <Link to={`/sales?id=${s.id}`}>#{s.id.slice(0, 8).toUpperCase()}</Link>
                        </td>
                        <td>{displayDate(s.created_at)}</td>
                        <td>
                          <Badge
                            tone={
                              s.status === 'returned' ? 'warning' : s.credit ? 'warning' : 'success'
                            }
                          >
                            {s.status === 'returned' ? 'Returned' : s.credit ? 'Credit' : 'Paid'}
                          </Badge>
                        </td>
                        <td className="numeric strong">{money(s.total)}</td>
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
        <section className="panel quick-panel">
          <span className="eyebrow">KEEP THINGS MOVING</span>
          <h2>
            Everything you need,
            <br />
            within reach.
          </h2>
          <p>
            Make room for what matters.
            <br />
            We’ll keep the records in order.
          </p>
          {canSell && (
            <Link to="/pos" className="quick-link">
              <ShoppingBasket size={18} />
              Open point of sale
              <ArrowUpRight size={16} />
            </Link>
          )}
          <Link to="/products" className="quick-link">
            <Package size={18} />
            Browse products
            <ArrowUpRight size={16} />
          </Link>
        </section>
      </div>
      <DashboardInsights from={from} to={to} />
    </>
  );
}
