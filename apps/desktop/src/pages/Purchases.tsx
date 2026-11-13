import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { decimalToInteger, quantity } from '@agripos/shared';
import {
  api,
  useAllOptions,
  usePagedData,
  displayDate,
  type Contact,
  type Product,
} from '../services/api';
import { Table } from '../components/Table';
import { FormDialog, type Field } from '../components/FormDialog';
import { PageHeading, QueryState, Badge, RecordPages } from '../components/common';
import { useAllowed } from '../stores/session';
import { toast } from 'sonner';
interface Purchase {
  id: string;
  supplier: string;
  status: string;
  created_at: string;
}
interface PurchaseDetail {
  id: string;
  lines: { id: string; name: string; quantity: number; received: number }[];
}
export function Purchases() {
  const [lineCount, setLineCount] = useState(1);
  const query = usePagedData<Purchase>('/purchases'),
    suppliers = useAllOptions<Contact>('/suppliers'),
    products = useAllOptions<Product>('/products');
  const [create, setCreate] = useState(false),
    [receive, setReceive] = useState<PurchaseDetail | null>(null),
    [operationId, setOperationId] = useState(''),
    cache = useQueryClient(),
    canReceive = useAllowed('inventory.write'),
    canApprove = useAllowed('price.write');
  async function changeStatus(order: Purchase, status: string) {
    try {
      await api(`/purchases/${order.id}/status`, 'POST', {
        operationId: crypto.randomUUID(),
        status,
      });
      await cache.invalidateQueries();
      toast.success(`Purchase ${status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unable to change status');
    }
  }
  return (
    <>
      <PageHeading
        title="Purchases"
        description="Order confidently. Receive accurately. Stock changes only when goods arrive."
        action={
          <button
            className="btn"
            onClick={() => {
              setOperationId(crypto.randomUUID());
              setCreate(true);
            }}
          >
            <Plus size={16} />
            Create purchase order
          </button>
        }
      />
      <RecordPages query={query} />
      <QueryState query={query}>
        <Table
          rows={query.data ?? []}
          searchText={(r) => `${r.id} ${r.supplier} ${r.status}`}
          columns={[
            { key: 'id', title: 'Order', value: (r) => `PO-${r.id.slice(0, 8).toUpperCase()}` },
            {
              key: 'supplier',
              title: 'Supplier',
              value: (r) => <strong>{r.supplier}</strong>,
              sort: (r) => r.supplier,
            },
            {
              key: 'date',
              title: 'Ordered',
              value: (r) => displayDate(r.created_at),
              sort: (r) => r.created_at,
            },
            {
              key: 'status',
              title: 'Status',
              value: (r) => (
                <Badge tone={r.status === 'received' ? 'success' : 'warning'}>{r.status}</Badge>
              ),
            },
            {
              key: 'actions',
              title: 'Actions',
              align: 'end',
              value: (r) => (
                <div className="row-actions">
                  {r.status === 'draft' && (
                    <button className="text-btn" onClick={() => void changeStatus(r, 'submitted')}>
                      Submit
                    </button>
                  )}
                  {r.status === 'submitted' && canApprove && (
                    <button className="text-btn" onClick={() => void changeStatus(r, 'approved')}>
                      Approve
                    </button>
                  )}
                  {['approved', 'ordered'].includes(r.status) && (
                    <button className="text-btn" onClick={() => void changeStatus(r, 'sent')}>
                      Mark sent
                    </button>
                  )}
                  {['draft', 'submitted', 'approved', 'ordered', 'sent'].includes(r.status) && (
                    <button className="text-btn" onClick={() => void changeStatus(r, 'cancelled')}>
                      Cancel unreceived order
                    </button>
                  )}
                  {canReceive && ['approved', 'ordered', 'sent', 'partial'].includes(r.status) && (
                    <button
                      className="btn secondary small"
                      onClick={async () => {
                        try {
                          setReceive(await api(`/purchases/${r.id}`));
                          setOperationId(crypto.randomUUID());
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'Unable to load order');
                        }
                      }}
                    >
                      Receive goods
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </QueryState>
      {create && (
        <FormDialog
          title="Create purchase order"
          description="Add products, quantities and agreed costs. Choose base or configured purchase units for each line. Receiving always uses base stock units."
          fields={[
            {
              name: 'status',
              label: 'Order state',
              type: 'select',
              required: true,
              options: [
                { value: 'draft', label: 'Draft — submit for approval' },
                ...(canApprove
                  ? [{ value: 'ordered', label: 'Approved order — ready to receive' }]
                  : []),
              ],
            },
            {
              name: 'supplierId',
              label: 'Supplier',
              type: 'select',
              required: true,
              options: suppliers.data?.map((s) => ({ value: s.id, label: s.name })),
            },
            ...Array.from({ length: lineCount }, (_, i): Field[] => [
              {
                name: `product_${i}`,
                label: `Line ${i + 1} product`,
                type: 'select',
                required: true,
                options: products.data?.map((p) => ({
                  value: p.id,
                  label: `${p.name} · base ${p.unit} · purchase ${p.purchase_unit} = ${quantity(p.purchase_factor)} ${p.unit}`,
                })),
              },
              {
                name: `unit_${i}`,
                label: `Line ${i + 1} quantity/cost unit`,
                type: 'select',
                required: true,
                options: [
                  { value: 'base', label: 'Base stock unit' },
                  { value: 'purchase', label: 'Configured purchase unit' },
                ],
              },
              {
                name: `quantity_${i}`,
                label: `Line ${i + 1} quantity`,
                type: 'number',
                required: true,
                min: 0.001,
              },
              {
                name: `cost_${i}`,
                label: `Line ${i + 1} cost per selected unit (LKR)`,
                type: 'number',
                required: true,
                min: 0,
              },
            ]).flat(),
          ]}
          onClose={() => setCreate(false)}
          initial={{ status: canApprove ? 'ordered' : 'draft' }}
          submitLabel="Create order"
          onSave={async (v) => {
            await api('/purchases', 'POST', {
              supplierId: v.supplierId,
              operationId,
              status: v.status,
              lines: Array.from({ length: lineCount }, (_, i) => ({
                productId: v[`product_${i}`],
                unit: v[`unit_${i}`],
                quantity: decimalToInteger(v[`quantity_${i}`]!, 3),
                unitCost: decimalToInteger(v[`cost_${i}`]!),
              })),
            });
            await cache.invalidateQueries();
            toast.success('Purchase order created');
          }}
        >
          <div className="inline">
            <button
              type="button"
              className="btn secondary"
              disabled={lineCount >= 100}
              onClick={() => setLineCount(lineCount + 1)}
            >
              Add order line
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={lineCount <= 1}
              onClick={() => setLineCount(lineCount - 1)}
            >
              Remove last line
            </button>
          </div>
        </FormDialog>
      )}
      {receive && (
        <FormDialog
          title="Receive goods"
          description="Record one batch at a time. You can receive the remaining quantities later."
          fields={[
            { name: 'invoiceNumber', label: 'Supplier invoice reference' },
            { name: 'dueDate', label: 'Supplier payment due date', type: 'date' },
            {
              name: 'lineId',
              label: 'Order line',
              type: 'select',
              required: true,
              options: receive.lines
                .filter((l) => l.received < l.quantity)
                .map((l) => ({
                  value: l.id,
                  label: `${l.name} · ${quantity(l.quantity - l.received)} outstanding`,
                })),
            },
            {
              name: 'quantity',
              label: 'Quantity received in good condition',
              type: 'number',
              min: 0,
              required: true,
            },
            { name: 'batchNumber', label: 'Batch / lot number', required: true },
            { name: 'expiryDate', label: 'Expiry date (if applicable)', type: 'date' },
            { name: 'manufactureDate', label: 'Manufacture / packing date', type: 'date' },
            { name: 'supplierLot', label: 'Supplier lot reference' },
          ]}
          onClose={() => setReceive(null)}
          submitLabel="Receive stock"
          onSave={async (v) => {
            await api(`/purchases/${receive.id}/receive`, 'POST', {
              operationId,
              invoiceNumber: v.invoiceNumber,
              dueDate: v.dueDate || null,
              lines: [
                {
                  lineId: v.lineId,
                  quantity: decimalToInteger(v.quantity!, 3),
                  batchNumber: v.batchNumber,
                  expiryDate: v.expiryDate || null,
                  manufactureDate: v.manufactureDate || null,
                  supplierLot: v.supplierLot || '',
                },
              ],
            });
            await cache.invalidateQueries();
            toast.success('Stock received');
          }}
        />
      )}
    </>
  );
}
