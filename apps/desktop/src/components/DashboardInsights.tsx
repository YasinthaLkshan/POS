import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Link } from 'react-router-dom';
import { money, quantity, type Report } from '@agripos/shared';
import { useData } from '../services/api';
import { useAllowed } from '../stores/session';
import { QueryState } from './common';
const stockColors = ['#146B4A', '#D38A21', '#C73535'];
export function DashboardInsights({ from, to }: { from: string; to: string }) {
  const reports = useAllowed('reports.read'),
    admin = useAllowed('staff.manage');
  const stock = useData<{ name: string; value: number }[]>('/dashboard/stock-status'),
    expiry =
      useData<{ id: string; name: string; expiry_date: string; quantity: number }[]>(
        '/inventory/expiring',
      );
  const categories = useData<Report>(`/reports/detail/categories?from=${from}&to=${to}`, reports),
    products = useData<Report>(`/reports/detail/products?from=${from}&to=${to}`, reports),
    activity = useData<{ id: string; action: string; name: string; created_at: string }[]>(
      '/dashboard/activity',
      admin,
    );
  return (
    <div className="dashboard-grid" style={{ marginTop: 24 }}>
      <section className="panel settings-card">
        <h2>Stock status</h2>
        <QueryState query={stock}>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stock.data ?? []}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={85}
                  label
                >
                  {stockColors.map((color) => (
                    <Cell key={color} fill={color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-legend">
            {stock.data?.map((s, i) => (
              <span key={s.name}>
                <i style={{ background: stockColors[i] }} />
                {s.name}: <strong>{s.value}</strong>
              </span>
            ))}
          </div>
        </QueryState>
      </section>
      <section className="panel settings-card">
        <h2>Expiring stock</h2>
        <QueryState query={expiry}>
          {expiry.data?.length ? (
            expiry.data.slice(0, 6).map((b) => (
              <Link className="inventory-alert" to="/inventory" key={b.id}>
                <div>
                  <strong>{b.name}</strong>
                  <small>
                    {b.expiry_date} · {quantity(b.quantity)} remaining
                  </small>
                </div>
              </Link>
            ))
          ) : (
            <p>No stock is within the configured expiry window.</p>
          )}
        </QueryState>
        <Link className="text-btn" to="/inventory">
          Review batches
        </Link>
      </section>
      {reports && (
        <>
          <section className="panel settings-card">
            <h2>Sales by category</h2>
            <QueryState query={categories}>
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categories.data?.rows ?? []}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis tickFormatter={(v) => String(Number(v) / 100)} />
                    <Tooltip formatter={(v) => money(Number(v))} />
                    <Bar dataKey="revenue" fill="#146B4A" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </QueryState>
          </section>
          <section className="panel settings-card">
            <h2>Top-selling products</h2>
            <QueryState query={products}>
              {products.data?.rows.slice(0, 5).map((p, i) => (
                <p key={String(p.name) + i}>
                  {String(p.name)} · {quantity(Number(p.quantity))} units ·{' '}
                  {money(Number(p.revenue))}
                </p>
              ))}
            </QueryState>
            <Link className="text-btn" to="/reports">
              Compare best and slow movers
            </Link>
          </section>
        </>
      )}
      {admin && (
        <section className="panel settings-card">
          <h2>Recent system activity</h2>
          <QueryState query={activity}>
            {activity.data?.map((a) => (
              <p key={a.id}>
                <strong>{a.name}</strong> · {a.action.replaceAll('.', ' ')}{' '}
                <small>{new Date(a.created_at).toLocaleString('en-LK')}</small>
              </p>
            ))}
          </QueryState>
        </section>
      )}
    </div>
  );
}
