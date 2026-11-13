import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search } from 'lucide-react';
import { money } from '@agripos/shared';
import { toast } from 'sonner';
import { displayDate, useData, useDebounced, type Driver, type Factory } from '../services/api';
import { Badge, PageHeading, QueryState } from '../components/common';
import { FormDialog } from '../components/FormDialog';
import { Table } from '../components/Table';
import { CreditProfile } from '../components/Credit';
import { useAllowed } from '../stores/session';

export function DriverFormDialog({
  driver,
  factoryId,
  onClose,
}: {
  driver?: Driver;
  factoryId?: string;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const factories = useData<Factory[]>('/factories');
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  return (
    <FormDialog
      title={driver ? `Edit ${driver.name}` : 'Add lorry driver'}
      description={
        driver
          ? `Driver ID ${driver.driver_code}. Changing the factory keeps all existing invoices and credit.`
          : 'A unique driver ID is created automatically. Credit and invoices always stay with this driver.'
      }
      fields={[
        { name: 'name', label: 'Driver name', required: true },
        {
          name: 'factoryId',
          label: 'Factory',
          type: 'select',
          required: true,
          options: factories.data
            ?.filter((f) => f.active || f.id === driver?.factory_id)
            .map((f) => ({ value: f.id, label: f.name })),
        },
        { name: 'lorryNumber', label: 'Lorry registration number' },
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
        name: driver?.name ?? '',
        factoryId: driver?.factory_id ?? factoryId ?? '',
        lorryNumber: driver?.lorry_number ?? '',
        phone: driver?.phone ?? '',
        address: driver?.address ?? '',
        notes: driver?.notes ?? '',
        active: String(driver?.active ?? true),
      }}
      submitLabel={confirmDuplicate ? 'Save as a different person' : 'Save driver'}
      onClose={onClose}
      onSave={async (v) => {
        const result = await window.desktop.request<Driver>({
          method: driver ? 'PATCH' : 'POST',
          path: driver ? `/drivers/${driver.id}` : '/drivers',
          body: {
            name: v.name,
            factoryId: v.factoryId,
            lorryNumber: v.lorryNumber,
            phone: v.phone,
            address: v.address,
            notes: v.notes,
            active: v.active === 'true',
            ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
          },
        });
        if (result.error) {
          if (result.error.code === 'DUPLICATE_DRIVER') setConfirmDuplicate(true);
          throw new Error(result.error.message);
        }
        await cache.invalidateQueries();
        toast.success(driver ? 'Driver updated' : `Driver ${result.data!.driver_code} added`);
      }}
    />
  );
}

export function DriverTable({ drivers }: { drivers: Driver[] }) {
  const [edit, setEdit] = useState<Driver | null>(null);
  const canSell = useAllowed('sales.write');
  return (
    <>
      <Table
        rows={drivers}
        empty="No drivers yet. Add the first driver for this factory."
        columns={[
          {
            key: 'name',
            title: 'Driver',
            value: (d) => (
              <div className="product-cell">
                <span className="product-symbol">{d.name.slice(0, 1)}</span>
                <div>
                  <Link to={`/drivers?id=${d.id}`}>
                    <strong>{d.name}</strong>
                  </Link>
                  <small>
                    {d.driver_code}
                    {d.phone ? ` · ${d.phone}` : ''}
                  </small>
                </div>
              </div>
            ),
            sort: (d) => d.name,
          },
          {
            key: 'factory',
            title: 'Factory',
            value: (d) => <Link to={`/factories?id=${d.factory_id}`}>{d.factory}</Link>,
            sort: (d) => d.factory,
          },
          { key: 'lorry', title: 'Lorry', value: (d) => d.lorry_number || '—' },
          {
            key: 'outstanding',
            title: 'Outstanding',
            align: 'end',
            value: (d) => money(d.outstanding),
            sort: (d) => d.outstanding,
          },
          {
            key: 'overdue',
            title: 'Overdue',
            align: 'end',
            value: (d) =>
              d.overdue ? <span className="error-text strong">{money(d.overdue)}</span> : '—',
            sort: (d) => d.overdue,
          },
          {
            key: 'next',
            title: 'Next due',
            value: (d) => (d.next_due ? displayDate(d.next_due) : '—'),
            sort: (d) => d.next_due ?? '9999',
          },
          {
            key: 'status',
            title: 'Status',
            value: (d) => (
              <Badge tone={d.active ? 'success' : 'neutral'}>
                {d.active ? 'Active' : 'Inactive'}
              </Badge>
            ),
          },
          {
            key: 'actions',
            title: 'Actions',
            align: 'end',
            value: (d) => (
              <div className="row-actions">
                <Link className="text-btn" to={`/drivers?id=${d.id}`}>
                  Profile
                </Link>
                {canSell && d.active && (
                  <Link className="btn secondary small" to={`/pos?driver=${d.id}`}>
                    New sale
                  </Link>
                )}
                <button
                  className="icon-btn"
                  aria-label={`Edit ${d.name}`}
                  onClick={() => setEdit(d)}
                >
                  <Pencil size={15} />
                </button>
              </div>
            ),
          },
        ]}
      />
      {edit && <DriverFormDialog driver={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

export function Drivers() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('id');
  const [search, setSearch] = useState(''),
    [factoryId, setFactoryId] = useState(params.get('factory') ?? ''),
    [adding, setAdding] = useState(params.get('new') === '1');
  useEffect(() => {
    if (params.get('new') === '1') setAdding(true);
  }, [params]);
  const debounced = useDebounced(search);
  const query = useData<Driver[]>(
    `/drivers?limit=100&search=${encodeURIComponent(debounced)}${factoryId ? `&factoryId=${factoryId}` : ''}`,
  );
  const factories = useData<Factory[]>('/factories');
  if (selected) return <CreditProfile customerId={selected} onBack={() => setParams({})} />;
  return (
    <>
      <PageHeading
        title="Lorry drivers"
        description="Regular drivers, their factories, purchases and credit."
        action={
          <button
            className="btn"
            onClick={() => setAdding(true)}
            disabled={!factories.data?.length}
          >
            <Plus size={16} />
            Add driver
          </button>
        }
      />
      {factories.data && !factories.data.length && (
        <div className="alert info">
          Add a factory first, then register the drivers who work for it.{' '}
          <Link className="text-btn" to="/factories?new=1">
            Add factory
          </Link>
        </div>
      )}
      <div className="filter-bar">
        <div className="search-field">
          <Search size={15} />
          <input
            aria-label="Search drivers"
            placeholder="Name, driver ID, lorry number, phone or factory…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
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
        <span className="muted">{query.data?.length ?? 0} drivers</span>
      </div>
      <QueryState query={query}>
        <DriverTable drivers={query.data ?? []} />
      </QueryState>
      {adding && (
        <DriverFormDialog
          factoryId={factoryId || undefined}
          onClose={() => {
            setAdding(false);
            if (params.get('new')) setParams({});
          }}
        />
      )}
    </>
  );
}
