import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { money } from '@agripos/shared';
import {
  displayDate,
  useData,
  useDebounced,
  type Factory,
  type InstallmentRow,
} from '../services/api';
import { Badge, PageHeading, QueryState } from '../components/common';
import { Table } from '../components/Table';
import {
  CreditProfile,
  DueBadge,
  RecordPaymentDialog,
  customerType,
  dueText,
} from '../components/Credit';

type Status = 'actionable' | 'overdue' | 'due_today' | 'due_soon' | 'upcoming' | 'paid' | 'all';
const cards = [
  ['overdue', 'Overdue', 'stat-critical'],
  ['due_today', 'Due today', 'warning-card'],
  ['due_soon', 'Due soon', 'warning-card'],
  ['upcoming', 'Upcoming', ''],
  ['paid', 'Paid', ''],
] as const;
export function CreditManagement() {
  const [params, setParams] = useSearchParams();
  const customer = params.get('customer');
  const [status, setStatus] = useState<Status>('actionable'),
    [type, setType] = useState<'all' | 'driver' | 'normal'>('all'),
    [factoryId, setFactoryId] = useState(''),
    [search, setSearch] = useState(''),
    [paying, setPaying] = useState<InstallmentRow | null>(null);
  const debounced = useDebounced(search);
  const query = useData<{
    rows: InstallmentRow[];
    summary: Record<string, { count: number; remaining: number }>;
  }>(
    `/credit/due?status=${status}&type=${type}${factoryId ? `&factoryId=${factoryId}` : ''}&search=${encodeURIComponent(debounced)}&limit=500`,
  );
  const factories = useData<Factory[]>('/factories');
  if (customer) return <CreditProfile customerId={customer} onBack={() => setParams({})} />;
  return (
    <>
      <PageHeading
        title="Credit management"
        description="Driver and normal customer credit in one list: overdue first, then due today and the nearest due dates."
      />
      <div className="stats-grid">
        {cards.map(([key, label, tone]) => (
          <button
            key={key}
            className={`stat-card clickable ${tone} ${status === key ? 'selected' : ''}`}
            onClick={() => setStatus(status === key ? 'actionable' : key)}
          >
            <span>{label}</span>
            <strong>{money(query.data?.summary[key]?.remaining ?? 0)}</strong>
            <small>{query.data?.summary[key]?.count ?? 0} installment(s)</small>
          </button>
        ))}
      </div>
      <div className="filter-bar">
        <div className="segmented">
          {(
            [
              ['actionable', 'Unpaid'],
              ['overdue', 'Overdue'],
              ['due_today', 'Due today'],
              ['due_soon', 'Due soon'],
              ['paid', 'Paid'],
              ['all', 'All'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className={status === value ? 'selected' : ''}
              onClick={() => setStatus(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          aria-label="Customer type"
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
        >
          <option value="all">Drivers and normal customers</option>
          <option value="driver">Lorry drivers</option>
          <option value="normal">Normal customers</option>
        </select>
        <select
          aria-label="Factory"
          value={factoryId}
          onChange={(e) => setFactoryId(e.target.value)}
        >
          <option value="">All factories</option>
          {factories.data?.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <div className="search-field">
          <Search size={15} />
          <input
            aria-label="Search credit"
            placeholder="Name, invoice, phone, lorry…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <QueryState query={query}>
        <Table
          rows={query.data?.rows ?? []}
          empty="No credit matches these filters."
          columns={[
            {
              key: 'customer',
              title: 'Customer',
              value: (r) => (
                <div className="product-cell">
                  <div>
                    <button
                      className="text-btn"
                      onClick={() => setParams({ customer: r.customer_id })}
                    >
                      {r.customer_name}
                    </button>
                    <small>
                      {customerType(r.customer_kind)}
                      {r.driver_code ? ` · ${r.driver_code}` : ''}
                      {r.phone ? ` · ${r.phone}` : ''}
                    </small>
                  </div>
                </div>
              ),
              sort: (r) => r.customer_name,
            },
            { key: 'factory', title: 'Factory', value: (r) => r.factory ?? '—' },
            {
              key: 'invoice',
              title: 'Invoice',
              value: (r) => (
                <>
                  {r.invoice_number}
                  <small className="block muted">
                    {displayDate(r.sale_date)} ·{' '}
                    {r.installment_count > 1
                      ? `${r.seq} of ${r.installment_count}`
                      : 'single payment'}
                  </small>
                </>
              ),
              sort: (r) => r.sale_date,
            },
            { key: 'amount', title: 'Original', align: 'end', value: (r) => money(r.amount) },
            { key: 'paid', title: 'Paid', align: 'end', value: (r) => money(r.paid + r.reduced) },
            {
              key: 'remaining',
              title: 'Remaining',
              align: 'end',
              value: (r) => <strong>{money(r.remaining)}</strong>,
              sort: (r) => r.remaining,
            },
            {
              key: 'due',
              title: 'Due date',
              value: (r) => (
                <>
                  {displayDate(r.due_date)}
                  <small className={`block ${r.status === 'overdue' ? 'error-text' : 'muted'}`}>
                    {dueText(r)}
                  </small>
                </>
              ),
              sort: (r) => r.due_date,
            },
            { key: 'status', title: 'Status', value: (r) => <DueBadge row={r} /> },
            {
              key: 'action',
              title: 'Actions',
              align: 'end',
              value: (r) =>
                r.remaining > 0 ? (
                  <button className="btn small" onClick={() => setPaying(r)}>
                    Record payment
                  </button>
                ) : (
                  <Badge tone="success">Settled</Badge>
                ),
            },
          ]}
        />
      </QueryState>
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
