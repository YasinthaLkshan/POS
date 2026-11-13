import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Plus, Printer, Search, UserPlus } from 'lucide-react';
import { money } from '@agripos/shared';
import { toast } from 'sonner';
import {
  api,
  displayDate,
  useData,
  useDebounced,
  type Driver,
  type Factory,
  type InstallmentRow,
} from '../services/api';
import { Badge, PageHeading, QueryState } from '../components/common';
import { FormDialog } from '../components/FormDialog';
import { Table } from '../components/Table';
import { DueBadge, dueText, printDocument } from '../components/Credit';
import { DriverFormDialog, DriverTable } from './Drivers';

function FactoryFormDialog({ factory, onClose }: { factory?: Factory; onClose: () => void }) {
  const cache = useQueryClient();
  return (
    <FormDialog
      title={factory ? `Edit ${factory.name}` : 'Add factory'}
      description="A factory groups its lorry drivers. Each driver keeps their own credit balance."
      fields={[
        { name: 'name', label: 'Factory name', required: true },
        { name: 'phone', label: 'Phone' },
        { name: 'address', label: 'Address', type: 'textarea' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
        {
          name: 'active',
          label: 'Status',
          type: 'select',
          required: true,
          options: [
            { value: 'true', label: 'Active' },
            { value: 'false', label: 'Inactive' },
          ],
        },
      ]}
      initial={{
        name: factory?.name ?? '',
        phone: factory?.phone ?? '',
        address: factory?.address ?? '',
        notes: factory?.notes ?? '',
        active: String(factory?.active ?? true),
      }}
      onClose={onClose}
      onSave={async (v) => {
        await api(factory ? `/factories/${factory.id}` : '/factories', factory ? 'PATCH' : 'POST', {
          name: v.name,
          phone: v.phone,
          address: v.address,
          notes: v.notes,
          active: v.active === 'true',
        });
        await cache.invalidateQueries();
        toast.success('Factory saved');
      }}
    />
  );
}

function FactoryDetails({ id, onBack }: { id: string; onBack: () => void }) {
  const query = useData<{
    factory: Factory;
    drivers: Driver[];
    upcoming: InstallmentRow[];
    sales: {
      id: string;
      invoice_number: string;
      created_at: string;
      total: number;
      credit: number;
      discount: number;
      driver: string;
      driver_code: string;
      payment_type: string;
    }[];
    totals: Record<string, number>;
  }>(`/factories/${id}`);
  const [edit, setEdit] = useState(false),
    [addDriver, setAddDriver] = useState(false);
  const f = query.data?.factory;
  return (
    <>
      <div className="page-heading">
        <div>
          <button className="text-btn" onClick={onBack}>
            <ArrowLeft size={15} />
            All factories
          </button>
          <h1>{f?.name ?? 'Factory'}</h1>
          <p>
            {f
              ? [f.phone, f.address].filter(Boolean).join(' · ') || 'No contact details'
              : 'Loading…'}
          </p>
        </div>
        {f && (
          <div className="inline wrap">
            <button
              className="btn secondary"
              onClick={() => void printDocument(`/factories/${id}/report`)}
            >
              <Printer size={16} />
              Print report
            </button>
            <button className="btn secondary" onClick={() => setEdit(true)}>
              <Pencil size={16} />
              Edit
            </button>
            <button className="btn" onClick={() => setAddDriver(true)} disabled={!f.active}>
              <UserPlus size={16} />
              Add driver
            </button>
          </div>
        )}
      </div>
      <QueryState query={query}>
        {query.data && (
          <>
            {f?.notes && <div className="alert info">{f.notes}</div>}
            <div className="stats-grid">
              <div className="stat-card">
                <span>Drivers</span>
                <strong>{query.data.totals.drivers}</strong>
                <small>{query.data.totals.active_drivers} active</small>
              </div>
              <div className="stat-card">
                <span>Outstanding driver credit</span>
                <strong>{money(query.data.totals.outstanding ?? 0)}</strong>
                <small>Sum of each driver’s own balance</small>
              </div>
              <div className={`stat-card ${query.data.totals.overdue ? 'stat-critical' : ''}`}>
                <span>Overdue</span>
                <strong>{money(query.data.totals.overdue ?? 0)}</strong>
                <small>Unpaid past due date</small>
              </div>
              <div className="stat-card">
                <span>Upcoming payments</span>
                <strong>{money(query.data.totals.upcoming ?? 0)}</strong>
                <small>Scheduled, not yet due</small>
              </div>
            </div>
            <h2 className="section-title">Drivers</h2>
            <DriverTable drivers={query.data.drivers} />
            <h2 className="section-title">Upcoming and overdue payments</h2>
            <Table
              rows={query.data.upcoming}
              empty="No unpaid installments for this factory’s drivers."
              columns={[
                {
                  key: 'driver',
                  title: 'Driver',
                  value: (r) => <Link to={`/drivers?id=${r.customer_id}`}>{r.customer_name}</Link>,
                },
                {
                  key: 'invoice',
                  title: 'Invoice',
                  value: (r) => `${r.invoice_number} · #${r.seq}`,
                },
                {
                  key: 'due',
                  title: 'Due',
                  value: (r) => `${displayDate(r.due_date)} · ${dueText(r)}`,
                  sort: (r) => r.due_date,
                },
                {
                  key: 'remaining',
                  title: 'Remaining',
                  align: 'end',
                  value: (r) => money(r.remaining),
                },
                { key: 'status', title: 'Status', value: (r) => <DueBadge row={r} /> },
              ]}
            />
            <h2 className="section-title">Driver sales history</h2>
            <Table
              rows={query.data.sales}
              searchText={(r) => `${r.invoice_number} ${r.driver} ${r.driver_code}`}
              empty="No sales to this factory’s drivers yet."
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
                { key: 'driver', title: 'Driver', value: (r) => `${r.driver} (${r.driver_code})` },
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
                { key: 'credit', title: 'Credit', align: 'end', value: (r) => money(r.credit) },
                {
                  key: 'total',
                  title: 'Total',
                  align: 'end',
                  value: (r) => <strong>{money(r.total)}</strong>,
                },
              ]}
            />
          </>
        )}
      </QueryState>
      {edit && f && <FactoryFormDialog factory={f} onClose={() => setEdit(false)} />}
      {addDriver && <DriverFormDialog factoryId={id} onClose={() => setAddDriver(false)} />}
    </>
  );
}

export function Factories() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('id');
  const [search, setSearch] = useState(''),
    [adding, setAdding] = useState(params.get('new') === '1'),
    [edit, setEdit] = useState<Factory | null>(null);
  useEffect(() => {
    if (params.get('new') === '1') setAdding(true);
  }, [params]);
  const debounced = useDebounced(search);
  const query = useData<Factory[]>(`/factories?search=${encodeURIComponent(debounced)}`);
  if (selected) return <FactoryDetails id={selected} onBack={() => setParams({})} />;
  return (
    <>
      <PageHeading
        title="Factories"
        description="Factories group the lorry drivers who buy from your shop."
        action={
          <button className="btn" onClick={() => setAdding(true)}>
            <Plus size={16} />
            Add factory
          </button>
        }
      />
      <div className="filter-bar">
        <div className="search-field">
          <Search size={15} />
          <input
            autoFocus
            aria-label="Search factories"
            placeholder="Type a factory name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="muted">{query.data?.length ?? 0} factories</span>
      </div>
      <QueryState query={query}>
        <Table
          rows={query.data ?? []}
          empty="No factories yet. Add the first factory to start registering drivers."
          columns={[
            {
              key: 'name',
              title: 'Factory',
              value: (f) => (
                <button className="text-btn" onClick={() => setParams({ id: f.id })}>
                  {f.name}
                </button>
              ),
              sort: (f) => f.name,
            },
            { key: 'phone', title: 'Phone', value: (f) => f.phone || '—' },
            {
              key: 'drivers',
              title: 'Drivers',
              align: 'end',
              value: (f) => f.drivers ?? 0,
              sort: (f) => f.drivers ?? 0,
            },
            {
              key: 'outstanding',
              title: 'Driver credit',
              align: 'end',
              value: (f) => money(f.outstanding ?? 0),
              sort: (f) => f.outstanding ?? 0,
            },
            {
              key: 'overdue',
              title: 'Overdue',
              align: 'end',
              value: (f) =>
                f.overdue ? <span className="error-text strong">{money(f.overdue)}</span> : '—',
              sort: (f) => f.overdue ?? 0,
            },
            {
              key: 'status',
              title: 'Status',
              value: (f) => (
                <Badge tone={f.active ? 'success' : 'neutral'}>
                  {f.active ? 'Active' : 'Inactive'}
                </Badge>
              ),
            },
            {
              key: 'actions',
              title: 'Actions',
              align: 'end',
              value: (f) => (
                <div className="row-actions">
                  <button className="text-btn" onClick={() => setParams({ id: f.id })}>
                    View drivers
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Edit ${f.name}`}
                    onClick={() => setEdit(f)}
                  >
                    <Pencil size={15} />
                  </button>
                </div>
              ),
            },
          ]}
        />
      </QueryState>
      {(adding || edit) && (
        <FactoryFormDialog
          factory={edit ?? undefined}
          onClose={() => {
            setAdding(false);
            setEdit(null);
            if (params.get('new')) setParams({});
          }}
        />
      )}
    </>
  );
}
