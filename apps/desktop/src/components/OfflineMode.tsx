import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
export function OfflineMode() {
  const state = useQuery({
    queryKey: ['offline-status'],
    queryFn: () => window.desktop.offlineStatus(),
    refetchInterval: 5000,
  });
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <div className="offline-mode">
      <label>
        <input
          type="checkbox"
          checked={state.data?.workOffline ?? false}
          disabled={busy || !state.data?.authorized}
          onChange={async (e) => {
            const enabled = e.target.checked;
            setBusy(true);
            try {
              await window.desktop.setWorkOffline(enabled);
              await cache.invalidateQueries({ queryKey: ['offline-status'] });
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Could not change offline mode');
            } finally {
              setBusy(false);
            }
          }}
        />{' '}
        Work offline
      </label>
      <p className="muted">
        {!state.data?.authorized
          ? 'Connect your shop online once to enable offline use.'
          : state.data.workOffline
            ? 'Using this computer’s saved shop. Same login and access; cloud sync is paused.'
            : 'Offline use is automatic if internet drops. Turn this on to pause cloud sync yourself.'}
      </p>
    </div>
  );
}
