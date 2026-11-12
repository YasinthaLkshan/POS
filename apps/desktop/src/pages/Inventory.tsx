import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { quantity, decimalToInteger } from '@agripos/shared';
import { api, useData, usePagedData, today, type Batch } from '../services/api';
import { useAllowed } from '../stores/session';
import { Table } from '../components/Table';
import { FormDialog } from '../components/FormDialog';
import { PageHeading, QueryState, Badge, RecordPages } from '../components/common';
export function Inventory() {
  const [supplierReturn, setSupplierReturn] = useState<Batch | null>(null),
    canReturn = useAllowed('purchases.write');
  const settings = useData<{ expiry_alert_days: number }>('/settings');
  const expiryWindow = new Date(Date.now() + (settings.data?.expiry_alert_days ?? 30) * 86400000)
    .toISOString()
    .slice(0, 10);
  const query = usePagedData<Batch>('/inventory'),
    [adjust, setAdjust] = useState<Batch | null>(null),
    [count, setCount] = useState<Batch | null>(null),
    [operationId, setOperationId] = useState(''),
    [filter, setFilter] = useState('all'),
    cache = useQueryClient(),
    allowed = useAllowed('inventory.write');
  const rows = (query.data ?? []).filter(
    (r) =>
      filter === 'all' ||
      (filter === 'expiring' &&
        r.quantity > 0 &&
        !!r.expiry_date &&
        r.expiry_date >= today() &&
        r.expiry_date <= expiryWindow) ||
      (filter === 'expired' && !!r.expiry_date && r.expiry_date < today()) ||
      (filter === 'available' && r.quantity > 0 && (!r.expiry_date || r.expiry_date >= today())),
  );
  return (
    <>
      <PageHeading
        title="Inventory"
        description="Track every batch, every movement, every growing opportunity."
      />
      <div className="section-toolbar">
        <div className="segmented">
          {['all', 'available', 'expired', 'expiring'].map((v) => (
            <button key={v} className={filter === v ? 'selected' : ''} onClick={() => setFilter(v)}>
              {v}
            </button>
          ))}
        </div>
        <span className="muted">Quantities in base sale units</span>
      </div>
      <RecordPages query={query} />
      <QueryState query={query}>
        <Table
          rows={rows}
          searchText={(r) => `${r.name} ${r.batch_number}`}
          columns={[
            {
              key: 'name',
              title: 'Product',
              value: (r) => <strong>{r.name}</strong>,
              sort: (r) => r.name,
            },
            { key: 'batch', title: 'Batch / lot', value: (r) => r.batch_number },
            {
              key: 'quantity',
              title: 'Quantity',
              value: (r) => `${quantity(r.quantity)} ${r.unit}`,
              sort: (r) => r.quantity,
            },
            {
              key: 'expiry',
              title: 'Expiry date',
              value: (r) => r.expiry_date ?? 'Not applicable',
              sort: (r) => r.expiry_date ?? '9999',
            },
            {
              key: 'status',
              title: 'Status',
              value: (r) => (
                <Badge
                  tone={
                    r.expiry_date && r.expiry_date < today()
                      ? 'danger'
                      : r.quantity === 0
                        ? 'neutral'
                        : 'success'
                  }
                >
                  {r.expiry_date && r.expiry_date < today()
                    ? 'Expired'
                    : r.quantity === 0
                      ? 'Depleted'
                      : 'Available'}
                </Badge>
              ),
            },
            {
              key: 'actions',
              title: '',
              value: (r) =>
                allowed && (
                  <div className="inline">
                    {canReturn && (
                      <button
                        className="btn secondary small"
                        disabled={!r.quantity}
                        onClick={() => {
                          setOperationId(crypto.randomUUID());
                          setSupplierReturn(r);
                        }}
                      >
                        Return to supplier
                      </button>
                    )}
                    <button
                      className="btn secondary small"
                      onClick={() => {
                        setOperationId(crypto.randomUUID());
                        setCount(r);
                      }}
                    >
                      Count stock
                    </button>
                    <button
                      className="btn secondary small"
                      onClick={() => {
                        setOperationId(crypto.randomUUID());
                        setAdjust(r);
                      }}
                    >
                      Adjust stock
                    </button>
                  </div>
                ),
            },
          ]}
        />
      </QueryState>
      {adjust && (
        <FormDialog
          title={`Adjust ${adjust.name}`}
          description={`Batch ${adjust.batch_number} · Current stock ${quantity(adjust.quantity)}. Every adjustment is recorded in the audit trail.`}
          fields={[
            {
              name: 'direction',
              label: 'Direction',
              type: 'select',
              required: true,
              options: [
                { value: 'decrease', label: 'Decrease' },
                { value: 'increase', label: 'Increase' },
              ],
            },
            { name: 'quantity', label: 'Quantity', type: 'number', required: true, min: 0 },
            {
              name: 'type',
              label: 'Movement type',
              type: 'select',
              required: true,
              options: ['adjustment', 'damage', 'write_off'].map((v) => ({ value: v, label: v })),
            },
            { name: 'reason', label: 'Reason', required: true, type: 'textarea' },
          ]}
          initial={{ direction: 'decrease', type: 'adjustment' }}
          onClose={() => setAdjust(null)}
          onSave={async (v) => {
            await api('/inventory/adjustments', 'POST', {
              operationId,
              batchId: adjust.id,
              delta: decimalToInteger(v.quantity!, 3) * (v.direction === 'decrease' ? -1 : 1),
              reason: v.reason,
              type: v.type,
            });
            await cache.invalidateQueries();
          }}
        />
      )}
      {supplierReturn && (
        <FormDialog
          title={`Return ${supplierReturn.name} to supplier`}
          description="Return stock from its original purchase batch. This posts a supplier credit; a negative payable is retained as credit with the supplier. Record only goods physically returned and accepted."
          fields={[
            {
              name: 'quantity',
              label: 'Quantity returned',
              type: 'number',
              min: 0,
              required: true,
            },
            { name: 'reason', label: 'Reason / supplier acceptance reference', required: true },
          ]}
          onClose={() => setSupplierReturn(null)}
          onSave={async (v) => {
            await api('/inventory/supplier-returns', 'POST', {
              operationId,
              batchId: supplierReturn.id,
              quantity: decimalToInteger(v.quantity!, 3),
              reason: v.reason,
            });
            await cache.invalidateQueries();
          }}
        />
      )}
      {count && (
        <FormDialog
          title={`Count ${count.name}`}
          description={`Batch ${count.batch_number}. Expected quantity ${quantity(count.quantity)}. If stock changes during the count, refresh and recount.`}
          fields={[
            {
              name: 'counted',
              label: 'Actual counted quantity',
              type: 'number',
              min: 0,
              required: true,
            },
            { name: 'reason', label: 'Stocktake reason', required: true },
          ]}
          onClose={() => setCount(null)}
          onSave={async (v) => {
            await api('/inventory/stocktakes', 'POST', {
              operationId,
              reason: v.reason,
              lines: [
                {
                  batchId: count.id,
                  expectedQuantity: count.quantity,
                  countedQuantity: decimalToInteger(v.counted!, 3),
                },
              ],
            });
            await cache.invalidateQueries();
          }}
        />
      )}
    </>
  );
}
