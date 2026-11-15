import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Cloud, CircleCheck, CircleX, HardDrive, RefreshCw, PauseCircle } from 'lucide-react';
import { PageHeading } from '../components/common';
import { OfflineMode } from '../components/OfflineMode';
import { ShopConnectionDialog } from '../components/ShopConnectionDialog';
export function Sync() {
  const state = useQuery({
    queryKey: ['offline-status'],
    queryFn: () => window.desktop.offlineStatus(),
    refetchInterval: 5000,
  });
  const connection = useQuery({
    queryKey: ['shop-connection'],
    queryFn: () => window.desktop.backupStatus(),
    refetchInterval: 5000,
  });
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  const paused = state.data?.workOffline;
  const connected = !!connection.data?.lastCloudAt && !connection.data.lastError;
  const running = busy || connection.data?.running;
  const StatusIcon = paused ? PauseCircle : connected ? CircleCheck : CircleX;
  const refresh = async () => {
    await Promise.all([state.refetch(), connection.refetch()]);
  };
  return (
    <>
      <PageHeading
        title="Cloud synchronization"
        description="Your shop stays available offline. Changes sync when you are online."
      />
      <div className="sync-layout">
        <section className="panel sync-card">
          <div className="sync-card-heading">
            <span className="sync-icon">
              <HardDrive size={24} />
            </span>
            <div>
              <h2>Saved on this computer</h2>
              <p className="muted">Keep working, even without internet.</p>
            </div>
          </div>
          <p>
            Products, sales and other records are saved locally. Use the same username, password and
            access online or offline.
          </p>
          <div className="sync-control">
            <OfflineMode />
          </div>
          <p className="sync-footnote">
            Leave Work offline off for automatic cloud sync. Turn it on only when you want to pause
            synchronization.
          </p>
        </section>
        <section className="panel sync-card">
          <div className="sync-card-heading">
            <span className="sync-icon">
              <Cloud size={24} />
            </span>
            <div>
              <h2>Neon cloud</h2>
              <p className="muted">Automatic sync every 30 seconds while the app is open.</p>
            </div>
          </div>
          <button
            type="button"
            className={`shop-connection-status ${connected && !paused ? 'connected' : ''}`}
            onClick={() => setSetup(true)}
          >
            <StatusIcon size={22} aria-hidden="true" />
            <span>
              <strong>
                {running
                  ? 'Synchronizing...'
                  : paused
                    ? 'Cloud sync paused'
                    : connected
                      ? 'Shop connected'
                      : 'Cloud disconnected'}
              </strong>
              <small>Click to manage your connection</small>
            </span>
          </button>
          <dl className="sync-details">
            <div>
              <dt>Last synchronized</dt>
              <dd>
                {state.data?.lastSyncedAt
                  ? new Date(state.data.lastSyncedAt).toLocaleString()
                  : 'Not yet'}
              </dd>
            </div>
            <div>
              <dt>Local changes</dt>
              <dd>
                {state.data?.counts.pending
                  ? 'Waiting to sync'
                  : state.data?.authorized
                    ? 'Up to date'
                    : 'Connect your shop first'}
              </dd>
            </div>
          </dl>
          {state.data?.operations.map((o) => (
            <div
              key={o.id}
              role="status"
              className={o.state === 'conflict' ? 'alert danger' : 'alert'}
            >
              {o.message}
            </div>
          ))}
          <div className="sync-actions">
            <button
              className="btn"
              disabled={!!running || !!paused || !state.data?.authorized}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await window.desktop.syncNow();
                  if (result.error) throw new Error(result.error.message);
                  toast.success('Shop synchronized');
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Sync pending');
                } finally {
                  setBusy(false);
                  await refresh();
                }
              }}
            >
              <RefreshCw size={16} />
              {running ? 'Synchronizing...' : 'Sync now'}
            </button>
            <button className="btn secondary" onClick={() => setSetup(true)}>
              Connection settings
            </button>
          </div>
        </section>
      </div>
      <p className="sync-switch-note">
        Moving to another computer? Wait until this computer has synchronized before opening your
        shop there.
      </p>
      {setup && <ShopConnectionDialog onClose={() => setSetup(false)} onSaved={refresh} />}
    </>
  );
}
