import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, useData, displayDate } from '../services/api';
import { PageHeading, QueryState, Badge } from '../components/common';
import { toast } from 'sonner';
export interface Notification {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'danger' | 'warning' | 'success';
  action_path: string;
  read_at: string | null;
  created_at: string;
}
export function Notifications() {
  const [severity, setSeverity] = useState('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const query = useData<Notification[]>('/notifications'),
    cache = useQueryClient(),
    navigate = useNavigate();
  const visible = query.data?.filter(
    (n) => (severity === 'all' || n.severity === severity) && (!unreadOnly || !n.read_at),
  );
  return (
    <>
      <PageHeading
        title="Notifications"
        description="Daily stock, expiry, overdue-payment and synchronization alerts. Open an alert to see current records."
      />
      <QueryState query={query}>
        <div className="panel toolbar">
          <label>
            Severity{' '}
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="all">All severities</option>
              <option value="danger">Urgent</option>
              <option value="warning">Warning</option>
              <option value="info">Information</option>
              <option value="success">Success</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
            />{' '}
            Unread only
          </label>
        </div>
        {!visible?.length && (
          <div className="panel empty">No matching alerts for your account.</div>
        )}
        {visible?.map((n) => (
          <section className={`panel settings-card alert ${n.severity}`} key={n.id}>
            <div className="inline">
              <h2>{n.title}</h2>
              <Badge tone={n.read_at ? 'neutral' : 'warning'}>
                {n.read_at ? 'Read' : 'Unread'}
              </Badge>
            </div>
            <p>{n.body}</p>
            <small>{displayDate(n.created_at)}</small>
            <button
              className="btn secondary"
              onClick={async () => {
                try {
                  await api(`/notifications/${n.id}/read`, 'POST', {});
                  await cache.invalidateQueries();
                  navigate(n.action_path);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Unable to open notification');
                }
              }}
            >
              View records
            </button>
          </section>
        ))}
      </QueryState>
    </>
  );
}
