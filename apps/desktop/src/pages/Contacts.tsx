import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil } from 'lucide-react';
import { money, decimalToInteger, type Report } from '@agripos/shared';
import { api, useData, usePagedData, type Contact } from '../services/api';
import { useAllowed } from '../stores/session';
import { Table } from '../components/Table';
import { FormDialog, type Field } from '../components/FormDialog';
import { PageHeading, QueryState, Badge, RecordPages } from '../components/common';
import { toast } from 'sonner';
import { exportReport } from '../services/export';
export function Contacts({
  kind,
  credit = false,
}: {
  kind: 'customers' | 'suppliers';
  credit?: boolean;
}) {
  const [selected, setSelected] = useState<Contact | null>(null);
  const details = useData<{
    statement: Report;
    history: {
      id: string;
      created_at: string;
      status: string;
      total?: number;
      due_date: string | null;
      outstanding?: number;
    }[];
  }>(`/${kind}/${selected?.id}/account`, !!selected);
  const [edit, setEdit] = useState<Contact | 'new' | null>(null),
    [payment, setPayment] = useState<Contact | null>(null);
  const [operationId, setOperationId] = useState(''),
    cache = useQueryClient();
  const query = usePagedData<Contact>(`/${kind}`),
    canCredit = useAllowed('credit.manage');
  const fields: Field[] = [
    { name: 'name', label: 'Name', required: true },
    { name: 'phone', label: 'Phone' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'address', label: 'Address', type: 'textarea' },
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
  ];
  if (kind === 'customers' && canCredit)
    fields.push({ name: 'creditLimit', label: 'Credit limit (LKR)', type: 'number', min: 0 });
  if (kind === 'customers' && canCredit)
    fields.push({
      name: 'creditEnabled',
      label: 'Credit eligibility',
      type: 'select',
      required: true,
      options: [
        { value: 'true', label: 'Eligible within credit limit' },
        { value: 'false', label: 'New credit disabled' },
      ],
    });
  return (
    <>
      <PageHeading
        title={credit ? 'Credit management' : kind === 'customers' ? 'Customers' : 'Suppliers'}
        description={
          credit
            ? 'Track outstanding balances and record customer repayments.'
            : `The people who help your business grow. Showing up to 100 ${kind}.`
        }
        action={
          !credit && (
            <button className="btn" onClick={() => setEdit('new')}>
              <Plus size={16} />
              Add {kind === 'customers' ? 'customer' : 'supplier'}
            </button>
          )
        }
      />
      {selected && (
        <section className="panel settings-card account-panel">
          <div className="inline spread">
            <h2>{selected.name} · Account</h2>
            <button className="text-btn" onClick={() => setSelected(null)}>
              Close account
            </button>
          </div>
          <QueryState query={details}>
            <div className="inline">
              <button
                className="btn secondary"
                disabled={!details.data || details.data.statement.truncated}
                onClick={() =>
                  exportReport(details.data!.statement, 'csv', `AgriPOS-statement-${selected.id}`)
                }
              >
                Export statement CSV
              </button>
              <button
                className="btn secondary"
                disabled={!details.data || details.data.statement.truncated}
                onClick={() =>
                  exportReport(details.data!.statement, 'excel', `AgriPOS-statement-${selected.id}`)
                }
              >
                Export statement Excel
              </button>
            </div>
            <h3>Account movements</h3>
            <Table
              rows={details.data?.statement.rows ?? []}
              columns={[
                { key: 'date', title: 'Date', value: (r) => String(r.created_at).slice(0, 10) },
                { key: 'type', title: 'Type', value: (r) => String(r.type) },
                { key: 'amount', title: 'Debit / credit', value: (r) => money(Number(r.amount)) },
                { key: 'balance', title: 'Balance', value: (r) => money(Number(r.balance)) },
              ]}
            />
            <h3>Recent {kind === 'customers' ? 'invoices' : 'purchases'} (up to 200)</h3>
            <Table
              rows={details.data?.history ?? []}
              columns={[
                { key: 'id', title: 'Reference', value: (r) => r.id.slice(0, 8) },
                { key: 'date', title: 'Date', value: (r) => String(r.created_at).slice(0, 10) },
                { key: 'status', title: 'Status', value: (r) => r.status },
                { key: 'due', title: 'Due date', value: (r) => r.due_date || '—' },
                {
                  key: 'outstanding',
                  title: kind === 'customers' ? 'Invoice outstanding' : '',
                  value: (r) => (r.outstanding === undefined ? '' : money(r.outstanding)),
                },
              ]}
            />
          </QueryState>
        </section>
      )}
      <RecordPages query={query} />
      <QueryState query={query}>
        <Table
          rows={query.data ?? []}
          searchText={(r) => `${r.name} ${r.phone} ${r.email}`}
          columns={[
            {
              key: 'name',
              title: 'Name',
              value: (r) => <strong>{r.name}</strong>,
              sort: (r) => r.name,
            },
            { key: 'phone', title: 'Phone', value: (r) => r.phone || '—' },
            {
              key: 'email',
              title: credit ? 'Credit limit' : 'Email',
              value: (r) => (credit ? money(r.credit_limit ?? 0) : r.email || '—'),
            },
            {
              key: 'balance',
              title: 'Outstanding',
              value: (r) => (
                <Badge tone={r.balance ? 'warning' : 'success'}>{money(r.balance ?? 0)}</Badge>
              ),
              sort: (r) => r.balance ?? 0,
            },
            {
              key: 'actions',
              title: 'Actions',
              align: 'end',
              value: (r) => (
                <div className="row-actions">
                  <button className="text-btn" onClick={() => setSelected(r)}>
                    Statement / history
                  </button>
                  {!credit && (
                    <button
                      className="icon-btn"
                      aria-label={`Edit ${r.name}`}
                      onClick={() => setEdit(r)}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                  {(credit || kind === 'suppliers') && (
                    <button
                      className="btn secondary small"
                      disabled={!r.balance}
                      onClick={() => {
                        setOperationId(crypto.randomUUID());
                        setPayment(r);
                      }}
                    >
                      {kind === 'suppliers' ? 'Pay supplier' : 'Record payment'}
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </QueryState>
      {edit && (
        <FormDialog
          title={`${edit === 'new' ? 'Add' : 'Edit'} ${kind === 'customers' ? 'customer' : 'supplier'}`}
          fields={fields}
          initial={
            edit === 'new'
              ? { creditLimit: '0', active: 'true', creditEnabled: 'true' }
              : {
                  name: edit.name,
                  phone: edit.phone,
                  email: edit.email,
                  address: edit.address,
                  creditLimit: String((edit.credit_limit ?? 0) / 100),
                  active: String(edit.active),
                  creditEnabled: String(edit.credit_enabled ?? true),
                }
          }
          onClose={() => setEdit(null)}
          onSave={async (v) => {
            await api(
              edit === 'new' ? `/${kind}` : `/${kind}/${edit.id}`,
              edit === 'new' ? 'POST' : 'PATCH',
              {
                name: v.name,
                phone: v.phone,
                email: v.email,
                address: v.address,
                active: v.active === 'true',
                ...(kind === 'customers'
                  ? {
                      creditLimit: canCredit
                        ? decimalToInteger(v.creditLimit || '0')
                        : edit === 'new'
                          ? 0
                          : edit.credit_limit,
                      creditEnabled: canCredit
                        ? v.creditEnabled === 'true'
                        : edit === 'new'
                          ? true
                          : edit.credit_enabled,
                    }
                  : {}),
              },
            );
            await cache.invalidateQueries();
            toast.success('Contact saved');
          }}
        />
      )}
      {payment && (
        <FormDialog
          title={`Payment ${kind === 'suppliers' ? 'to' : 'from'} ${payment.name}`}
          description={`Outstanding balance: ${money(payment.balance ?? 0)}`}
          fields={[
            { name: 'amount', label: 'Amount (LKR)', type: 'number', min: 0, required: true },
            {
              name: 'method',
              label: 'Payment method',
              type: 'select',
              required: true,
              options: ['cash', 'card', 'transfer'].map((v) => ({ value: v, label: v })),
            },
            {
              name: 'reference',
              label: 'Confirmed payment reference',
              hint: 'Required for card and bank transfer.',
            },
          ]}
          initial={{ method: 'cash' }}
          submitLabel="Record repayment"
          onClose={() => setPayment(null)}
          onSave={async (v) => {
            const info = await window.desktop.info();
            await api(
              kind === 'suppliers' ? '/supplier-payments' : `/customers/${payment.id}/payments`,
              'POST',
              {
                operationId,
                terminalId: info.terminalId,
                ...(kind === 'suppliers' ? { supplierId: payment.id } : {}),
                payment: {
                  amount: decimalToInteger(v.amount!),
                  method: v.method,
                  reference: v.reference,
                },
              },
            );
            await cache.invalidateQueries();
            toast.success('Payment recorded');
          }}
        />
      )}
    </>
  );
}
