import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, useData, displayDate } from '../services/api';
import { useAllowed, useSession } from '../stores/session';
import { PageHeading, QueryState, Badge } from '../components/common';
import { FormDialog } from '../components/FormDialog';
import { Table } from '../components/Table';
export function Sync() {
  const { user, setUser } = useSession(),
    admin = useAllowed('staff.manage'),
    manager = useAllowed('refund.write'),
    cache = useQueryClient(),
    navigate = useNavigate();
  const [dialog, setDialog] = useState<'prepare' | 'unlock' | null>(null),
    [busy, setBusy] = useState(false),
    [resolve, setResolve] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ['offline-status'],
    queryFn: () => window.desktop.offlineStatus(),
    refetchInterval: 5000,
  });
  const conflicts = useData<{ id: string; state: string; message: string; created_at: string }[]>(
    '/sync/conflicts',
    manager && !user?.offline,
  );
  async function synchronize() {
    setBusy(true);
    try {
      const result = await window.desktop.syncNow();
      if (result.error) throw new Error(result.error.message);
      await cache.invalidateQueries();
      toast.success('Synchronization attempt finished. Review any remaining receipts below.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Synchronization failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title="Offline & synchronization"
        description="Prepare this terminal online before a connection outage. Cash receipts are saved locally before checkout completes."
      />
      <QueryState query={status}>
        <section className="panel settings-card">
          <h2>Terminal authorization</h2>
          {status.data?.lastSyncedAt && (
            <p>Last accepted sync: {new Date(status.data.lastSyncedAt).toLocaleString('en-LK')}</p>
          )}
          <p>
            {status.data?.authorized
              ? `Prepared for ${status.data.staffName} until ${displayDate(status.data.expiresAt!)}`
              : 'Offline access has not been prepared on this terminal.'}
          </p>
          <p className="muted">
            Offline access lasts 12 hours and permits cached products, walk-in cash sales and local
            receipts. Stock can change on other terminals; any conflict remains visible for manager
            reconciliation.
          </p>
          <div className="inline">
            {admin && !user?.offline && (
              <button
                className="btn secondary"
                onClick={async () => {
                  try {
                    const info = await window.desktop.info();
                    await api('/sync/terminals', 'POST', {
                      terminalId: info.terminalId,
                      name: `Windows till ${info.terminalId.slice(0, 8)}`,
                      offlineEnabled: true,
                    });
                    toast.success('This terminal is authorized');
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Authorization failed');
                  }
                }}
              >
                Authorize this terminal
              </button>
            )}
            {!user?.offline && (
              <button className="btn" onClick={() => setDialog('prepare')}>
                Prepare offline access
              </button>
            )}
            {!user?.offline && status.data?.authorized && (
              <button className="btn secondary" onClick={() => setDialog('unlock')}>
                Switch to offline checkout
              </button>
            )}
            <button className="btn secondary" disabled={busy} onClick={() => void synchronize()}>
              {busy ? 'Synchronizing…' : 'Synchronize now'}
            </button>
          </div>
          <p>
            {user?.offline
              ? 'You are using the offline snapshot. Sign out and sign in online to return to live shop data.'
              : 'You are using live shop data.'}
          </p>
        </section>
        <h2 className="section-title">Receipts awaiting synchronization</h2>
        <Table
          rows={status.data?.operations ?? []}
          searchText={(r) => `${r.id} ${r.state} ${r.message}`}
          columns={[
            { key: 'id', title: 'Receipt', value: (r) => r.id.slice(0, 8) },
            {
              key: 'state',
              title: 'State',
              value: (r) => (
                <Badge tone={['failed', 'conflict'].includes(r.state) ? 'danger' : 'warning'}>
                  {r.state}
                </Badge>
              ),
            },
            {
              key: 'message',
              title: 'Details',
              value: (r) => r.message || 'Waiting for service connection',
            },
            { key: 'attempts', title: 'Attempts', value: (r) => r.attempts },
          ]}
        />
      </QueryState>
      {manager && !user?.offline && (
        <>
          <h2 className="section-title">Shop reconciliation</h2>
          <QueryState query={conflicts}>
            <Table
              rows={conflicts.data ?? []}
              searchText={(r) => `${r.id} ${r.message}`}
              columns={[
                { key: 'id', title: 'Receipt', value: (r) => r.id.slice(0, 8) },
                { key: 'state', title: 'State', value: (r) => r.state },
                {
                  key: 'message',
                  title: 'Review required',
                  value: (r) => r.message || 'Pending reconciliation',
                },
                {
                  key: 'action',
                  title: 'Action',
                  align: 'end',
                  value: (r) => (
                    <button className="text-btn" onClick={() => setResolve(r.id)}>
                      Review / retry
                    </button>
                  ),
                },
              ]}
            />
          </QueryState>
        </>
      )}
      {dialog && (
        <FormDialog
          title={dialog === 'prepare' ? 'Prepare offline checkout' : 'Unlock offline checkout'}
          description={
            dialog === 'prepare'
              ? 'Choose an 8–12 digit PIN. Finish all pending receipts before replacing the catalog snapshot.'
              : 'Enter the PIN for the prepared staff account.'
          }
          fields={[
            { name: 'pin', label: 'Offline PIN', type: 'password', required: true },
            ...(dialog === 'prepare'
              ? [
                  {
                    name: 'confirm',
                    label: 'Confirm PIN',
                    type: 'password' as const,
                    required: true,
                  },
                ]
              : []),
          ]}
          onClose={() => setDialog(null)}
          onSave={async (v) => {
            if (dialog === 'prepare' && v.pin !== v.confirm) throw new Error('PINs do not match');
            const result =
              dialog === 'prepare'
                ? await window.desktop.prepareOffline(v.pin!)
                : await window.desktop.unlockOffline(v.pin!);
            if (result.error) throw new Error(result.error.message);
            if (dialog === 'unlock') {
              cache.clear();
              setUser(await api('/auth/me'));
              navigate('/pos');
            } else {
              await cache.invalidateQueries();
              toast.success('Offline catalog and authorization saved securely');
            }
          }}
        />
      )}
      {resolve && (
        <FormDialog
          title="Reconcile offline receipt"
          description="Review the conflict first. Correct stock through a documented receipt or adjustment. For a closed register, choose the current terminal after opening its register. The original receipt and amount remain unchanged."
          fields={[
            {
              name: 'register',
              label: 'Cash register',
              type: 'select',
              required: true,
              options: [
                { value: 'original', label: 'Retry original register' },
                { value: 'current', label: 'Reconcile into this terminal’s open register' },
              ],
            },
          ]}
          initial={{ register: 'original' }}
          onClose={() => setResolve(null)}
          onSave={async (v) => {
            const info = await window.desktop.info();
            const result = await api<{ state: string; message?: string }>(
              `/sync/conflicts/${resolve}/resolve`,
              'POST',
              v.register === 'current' ? { terminalId: info.terminalId } : {},
            );
            await cache.invalidateQueries();
            if (result.state === 'conflict') throw new Error(result.message);
            toast.success('Receipt reconciled');
          }}
        />
      )}
    </>
  );
}
