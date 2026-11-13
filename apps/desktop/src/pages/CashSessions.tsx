import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { money, decimalToInteger } from '@agripos/shared';
import { api, usePagedData, displayDate } from '../services/api';
import { PageHeading, QueryState, Badge, RecordPages } from '../components/common';
import { Table } from '../components/Table';
import { FormDialog } from '../components/FormDialog';
import { useAllowed } from '../stores/session';
interface CashSession {
  id: string;
  terminal_id: string;
  opening_float: number;
  movements: number;
  opened_at: string;
  closed_at: string | null;
  expected_close: number | null;
  actual_close: number | null;
  difference: number | null;
}
export function CashSessions() {
  const query = usePagedData<CashSession>('/cash-sessions'),
    [terminal, setTerminal] = useState(''),
    [mode, setMode] = useState<'open' | 'close' | 'move' | null>(null),
    [selected, setSelected] = useState<CashSession | null>(null),
    [operationId, setOperationId] = useState(''),
    cache = useQueryClient(),
    canMove = useAllowed('expenses.write');
  useEffect(() => {
    void window.desktop.info().then((info) => setTerminal(info.terminalId));
  }, []);
  const begin = (value: typeof mode, session?: CashSession) => {
    setOperationId(crypto.randomUUID());
    setSelected(session ?? null);
    setMode(value);
  };
  return (
    <>
      <PageHeading
        title="Cash registers"
        description="Reconcile opening float, cash movements and the actual drawer count."
        action={
          <button
            className="btn"
            disabled={
              !terminal || query.data?.some((s) => s.terminal_id === terminal && !s.closed_at)
            }
            onClick={() => begin('open')}
          >
            Open this register
          </button>
        }
      />
      <RecordPages query={query} />
      <QueryState query={query}>
        <Table
          rows={query.data ?? []}
          columns={[
            { key: 'opened', title: 'Opened', value: (r) => displayDate(r.opened_at) },
            {
              key: 'terminal',
              title: 'Register',
              value: (r) =>
                r.terminal_id === terminal ? 'This terminal' : r.terminal_id.slice(0, 8),
            },
            { key: 'float', title: 'Opening float', value: (r) => money(r.opening_float) },
            {
              key: 'expected',
              title: 'Expected cash',
              value: (r) => money(r.expected_close ?? r.opening_float + r.movements),
            },
            {
              key: 'actual',
              title: 'Actual / difference',
              value: (r) =>
                r.actual_close === null
                  ? '—'
                  : `${money(r.actual_close)} / ${money(r.difference ?? 0)}`,
            },
            {
              key: 'status',
              title: 'Status',
              value: (r) => (
                <Badge tone={r.closed_at ? 'neutral' : 'success'}>
                  {r.closed_at ? 'Closed' : 'Open'}
                </Badge>
              ),
            },
            {
              key: 'action',
              title: 'Actions',
              align: 'end',
              value: (r) =>
                !r.closed_at && (
                  <div className="row-actions">
                    <button className="btn secondary small" onClick={() => begin('close', r)}>
                      Close & reconcile
                    </button>
                    {canMove && (
                      <button className="btn secondary small" onClick={() => begin('move', r)}>
                        Cash in / out
                      </button>
                    )}
                  </div>
                ),
            },
          ]}
        />
      </QueryState>
      {mode && (
        <FormDialog
          title={
            mode === 'open'
              ? 'Open cash register'
              : mode === 'close'
                ? 'Close and reconcile'
                : 'Record cash movement'
          }
          description={
            mode === 'close'
              ? `Expected drawer balance: ${money((selected?.opening_float ?? 0) + (selected?.movements ?? 0))}. Count the physical cash before closing.`
              : undefined
          }
          fields={
            mode === 'open'
              ? [
                  {
                    name: 'amount',
                    label: 'Opening cash float (LKR)',
                    type: 'number',
                    min: 0,
                    required: true,
                  },
                ]
              : mode === 'close'
                ? [
                    {
                      name: 'amount',
                      label: 'Actual counted cash (LKR)',
                      type: 'number',
                      min: 0,
                      required: true,
                    },
                  ]
                : [
                    {
                      name: 'amount',
                      label: 'Amount (LKR)',
                      type: 'number',
                      min: 0,
                      required: true,
                    },
                    {
                      name: 'direction',
                      label: 'Direction',
                      type: 'select',
                      required: true,
                      options: [
                        { value: 'in', label: 'Cash in' },
                        { value: 'out', label: 'Cash out' },
                      ],
                    },
                    { name: 'reason', label: 'Reason', required: true },
                  ]
          }
          onClose={() => setMode(null)}
          onSave={async (v) => {
            const amount = decimalToInteger(v.amount!);
            if (mode === 'open')
              await api('/cash-sessions/open', 'POST', {
                operationId,
                terminalId: terminal,
                openingFloat: amount,
              });
            else if (mode === 'close')
              await api(`/cash-sessions/${selected!.id}/close`, 'POST', {
                operationId,
                actualClose: amount,
              });
            else
              await api('/cash-sessions/movements', 'POST', {
                operationId,
                sessionId: selected!.id,
                amount,
                direction: v.direction,
                reason: v.reason,
              });
            await cache.invalidateQueries();
          }}
        />
      )}
    </>
  );
}
