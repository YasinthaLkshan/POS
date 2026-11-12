import { useState } from 'react';
import { DetailedReports } from '../components/DetailedReports';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Download } from 'lucide-react';
import { money, decimalToInteger, roleNames } from '@agripos/shared';
import { api, useData, usePagedData, today, displayDate } from '../services/api';
import { useAllowed, useSession } from '../stores/session';
import { Table } from '../components/Table';
import { FormDialog } from '../components/FormDialog';
import { PageHeading, QueryState, Badge, RecordPages } from '../components/common';
import { toast } from 'sonner';
interface Expense {
  paid_from: 'cash' | 'bank';
  voided_at: string | null;
  id: string;
  category: string;
  description: string;
  amount: number;
  date: string;
}
export function Expenses() {
  const [editing, setEditing] = useState<Expense | null>(null);
  const query = usePagedData<Expense>('/expenses'),
    [open, setOpen] = useState(false),
    [operationId, setOperationId] = useState(''),
    cache = useQueryClient();
  return (
    <>
      <PageHeading
        title="Expenses"
        description="Keep a clear picture of what it takes to run your shop."
        action={
          <button
            className="btn"
            onClick={() => {
              setOperationId(crypto.randomUUID());
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus size={16} />
            Record expense
          </button>
        }
      />
      <RecordPages query={query} />
      <QueryState query={query}>
        <Table
          rows={query.data ?? []}
          searchText={(r) => `${r.category} ${r.description}`}
          columns={[
            { key: 'date', title: 'Date', value: (r) => displayDate(r.date), sort: (r) => r.date },
            {
              key: 'description',
              title: 'Description',
              value: (r) => <strong>{r.description}</strong>,
            },
            {
              key: 'category',
              title: 'Category',
              value: (r) => r.category,
              sort: (r) => r.category,
            },
            {
              key: 'amount',
              title: 'Amount',
              value: (r) => money(r.amount),
              sort: (r) => r.amount,
            },
            {
              key: 'status',
              title: 'Status',
              value: (r) => (r.voided_at ? 'Corrected (retained)' : 'Recorded'),
            },
            {
              key: 'edit',
              title: '',
              value: (r) =>
                !r.voided_at && (
                  <button
                    className="text-btn"
                    onClick={() => {
                      setEditing(r);
                      setOperationId(crypto.randomUUID());
                      setOpen(true);
                    }}
                  >
                    Correct expense
                  </button>
                ),
            },
          ]}
        />
      </QueryState>
      {open && (
        <FormDialog
          title={editing ? 'Correct expense' : 'Record expense'}
          description={
            editing
              ? 'The original entry is retained. Cash activity is reversed in this terminal’s open register and the replacement is recorded.'
              : 'Record a confirmed business expense.'
          }
          fields={[
            ...(editing
              ? [{ name: 'reason', label: 'Reason for correction', required: true }]
              : []),
            {
              name: 'category',
              label: 'Category',
              type: 'select',
              required: true,
              options: [
                'Rent',
                'Electricity',
                'Water',
                'Salaries',
                'Transport',
                'Maintenance',
                'Miscellaneous',
              ].map((v) => ({ value: v, label: v })),
            },
            { name: 'date', label: 'Date', type: 'date', required: true },
            { name: 'amount', label: 'Amount (LKR)', type: 'number', min: 0, required: true },
            { name: 'description', label: 'Description', type: 'textarea', required: true },
            {
              name: 'paidFrom',
              label: 'Paid from',
              type: 'select',
              required: true,
              options: [
                { value: 'bank', label: 'Bank / outside drawer' },
                { value: 'cash', label: 'This cash register' },
              ],
            },
          ]}
          initial={
            editing
              ? {
                  date: editing.date,
                  paidFrom: editing.paid_from,
                  category: editing.category,
                  description: editing.description,
                  amount: String(editing.amount / 100),
                }
              : { date: today(), paidFrom: 'bank' }
          }
          onClose={() => setOpen(false)}
          onSave={async (v) => {
            const values = {
              category: v.category,
              date: v.date,
              amount: decimalToInteger(v.amount!),
              description: v.description,
              paidFrom: v.paidFrom,
              terminalId: (await window.desktop.info()).terminalId,
            };
            await api(
              editing ? `/expenses/${editing.id}/correct` : '/expenses',
              'POST',
              editing
                ? { operationId, reason: v.reason, expense: values }
                : { operationId, ...values },
            );
            await cache.invalidateQueries();
            toast.success('Expense recorded');
          }}
        />
      )}
    </>
  );
}
function exportCsv(rows: Record<string, unknown>[], name: string) {
  const keys = Object.keys(rows[0] ?? {});
  if (!keys.length) {
    toast.info('No rows to export');
    return;
  }
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const csv =
    '\uFEFF' +
    [keys.map(cell).join(','), ...rows.map((r) => keys.map((k) => cell(r[k])).join(','))].join(
      '\r\n',
    );
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Reports() {
  const [from, setFrom] = useState(today().slice(0, 8) + '01'),
    [to, setTo] = useState(today()),
    canProfit = useAllowed('profit.read');
  const valid = !!from && !!to && from <= to,
    query = useData<{ day: string; transactions: number; revenue: number }[]>(
      `/reports/sales?from=${from}&to=${to}`,
      valid,
    ),
    profit = useData<Record<string, number>>(
      `/reports/profit?from=${from}&to=${to}`,
      valid && canProfit,
    );
  return (
    <>
      <PageHeading
        title="Reports"
        description="Make informed decisions from recorded sales and expenses."
        action={
          <button
            className="btn secondary"
            disabled={!valid || !query.data?.length}
            onClick={() =>
              exportCsv(
                (query.data ?? []).map((r) => ({
                  date: r.day,
                  transactions: r.transactions,
                  revenue_LKR: (r.revenue / 100).toFixed(2),
                })),
                `AgriPOS-sales-${from}-${to}.csv`,
              )
            }
          >
            <Download size={16} />
            Export CSV
          </button>
        }
      />
      <div className="panel report-filters">
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <span className="muted">Sri Lanka business dates · LKR</span>
      </div>
      {!valid ? (
        <div className="alert danger">Choose a valid date range.</div>
      ) : (
        <>
          {canProfit && (
            <QueryState query={profit}>
              <div className="stats-grid">
                {Object.entries(profit.data ?? {}).map(([key, value]) => (
                  <div className="stat-card" key={key}>
                    <span>{key.replaceAll('_', ' ')}</span>
                    <strong>{money(value)}</strong>
                  </div>
                ))}
              </div>
            </QueryState>
          )}
          <QueryState query={query}>
            <Table
              rows={query.data ?? []}
              columns={[
                {
                  key: 'day',
                  title: 'Business date',
                  value: (r) => displayDate(r.day),
                  sort: (r) => r.day,
                },
                {
                  key: 'count',
                  title: 'Transactions',
                  value: (r) => r.transactions,
                  sort: (r) => r.transactions,
                },
                {
                  key: 'revenue',
                  title: 'Sales including tax',
                  value: (r) => money(r.revenue),
                  sort: (r) => r.revenue,
                },
              ]}
            />
          </QueryState>
          <p className="muted">
            Returns reduce revenue on their return dates. Unsellable returns retain their original
            cost. Net profit is an estimate after recorded expenses; it is not a statutory
            accounting statement.
          </p>
          <DetailedReports from={from} to={to} />
        </>
      )}
    </>
  );
}
interface Staff {
  id: string;
  name: string;
  username: string | null;
  role: (typeof roleNames)[number];
  active: boolean;
}
export function Staff() {
  const [invite, setInvite] = useState(false);
  const query = useData<Staff[]>('/staff'),
    [edit, setEdit] = useState<Staff | null>(null),
    user = useSession((s) => s.user),
    cache = useQueryClient();
  return (
    <>
      <PageHeading
        title="Staff & roles"
        description="Control access with clear, server-enforced responsibilities."
        action={
          <button className="btn" onClick={() => setInvite(true)}>
            Add staff account
          </button>
        }
      />
      <div className="alert info">
        Create a staff username and initial password. Roles are enforced by the shop service.
      </div>
      {invite && (
        <FormDialog
          title="Add staff account"
          description="Choose a unique username and a private initial password of at least 12 characters. Ask the employee to change it after signing in."
          fields={[
            { name: 'name', label: 'Employee name', required: true },
            { name: 'username', label: 'Username', required: true },
            { name: 'password', label: 'Initial password', type: 'password', required: true },
            {
              name: 'role',
              label: 'Role',
              type: 'select',
              required: true,
              options: roleNames.map((r) => ({ value: r, label: r })),
            },
          ]}
          initial={{ role: 'cashier' }}
          onClose={() => setInvite(false)}
          onSave={async (v) => {
            await api('/staff/invite', 'POST', {
              name: v.name,
              username: v.username,
              password: v.password,
              role: v.role,
            });
            await cache.invalidateQueries();
            toast.success('Staff account added');
          }}
        />
      )}
      <QueryState query={query}>
        <Table
          rows={query.data ?? []}
          searchText={(r) => `${r.name} ${r.username ?? ''} ${r.role}`}
          columns={[
            {
              key: 'name',
              title: 'Employee',
              value: (r) => <strong>{r.name}</strong>,
              sort: (r) => r.name,
            },
            { key: 'username', title: 'Username', value: (r) => r.username ?? 'Not set' },
            { key: 'role', title: 'Role', value: (r) => r.role },
            {
              key: 'status',
              title: 'Access',
              value: (r) => (
                <Badge tone={r.active ? 'success' : 'neutral'}>
                  {r.active ? 'Active' : 'Disabled'}
                </Badge>
              ),
            },
            {
              key: 'action',
              title: '',
              value: (r) =>
                r.id !== user?.id && (
                  <button className="btn secondary small" onClick={() => setEdit(r)}>
                    Change access
                  </button>
                ),
            },
          ]}
        />
      </QueryState>
      {edit && (
        <FormDialog
          title={`Access for ${edit.name}`}
          description="Changes apply on the next API request and are recorded in the audit log."
          fields={[
            {
              name: 'role',
              label: 'Role',
              type: 'select',
              required: true,
              options: roleNames.map((v) => ({ value: v, label: v })),
            },
            {
              name: 'active',
              label: 'Access',
              type: 'select',
              required: true,
              options: [
                { value: 'true', label: 'Active' },
                { value: 'false', label: 'Disabled' },
              ],
            },
          ]}
          initial={{ role: edit.role, active: String(edit.active) }}
          onClose={() => setEdit(null)}
          onSave={async (v) => {
            await api(`/staff/${edit.id}`, 'PATCH', { role: v.role, active: v.active === 'true' });
            await cache.invalidateQueries();
          }}
        />
      )}
    </>
  );
}
