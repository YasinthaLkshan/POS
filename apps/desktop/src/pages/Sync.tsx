import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeading } from '../components/common';
import { OfflineMode } from '../components/OfflineMode';
export function Sync() {
  const state = useQuery({
    queryKey: ['offline-status'],
    queryFn: () => window.desktop.offlineStatus(),
    refetchInterval: 5000,
  });
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PageHeading
        title="Cloud synchronization"
        description="One shop, the same login and features with or without internet."
      />
      <section className="panel">
        <h2>Work offline. Sync automatically.</h2>
        <p>
          Products, sales and other changes are saved on this computer first. Keep using your normal
          username and password without internet. When internet access returns, pending changes
          upload to Neon automatically; the app checks every 30 seconds while open.
        </p>
        <OfflineMode />
        <p>
          Changes synchronize automatically. Before moving to another computer, wait until this
          computer is synchronized, then connect the other computer to the internet.
        </p>
        <p>
          Last synchronized:{' '}
          {state.data?.lastSyncedAt
            ? new Date(state.data.lastSyncedAt).toLocaleString()
            : 'Not yet'}
        </p>
        {state.data?.operations.map((o) => (
          <div key={o.id} className={o.state === 'conflict' ? 'alert danger' : 'alert'}>
            {o.message}
          </div>
        ))}
        <button
          className="btn"
          disabled={busy || state.data?.workOffline}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await window.desktop.syncNow();
              if (r.error) throw new Error(r.error.message);
              toast.success('Shop synchronized');
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Sync pending');
            } finally {
              setBusy(false);
              void state.refetch();
            }
          }}
        >
          {busy ? 'Synchronizing…' : 'Sync now'}
        </button>
      </section>
    </>
  );
}
