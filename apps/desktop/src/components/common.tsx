import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
export function PageHeading({
  eyebrow = 'YOUR WORKSPACE',
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function QueryState({
  query,
  children,
}: {
  query: { isPending: boolean; error: Error | null; refetch: () => unknown };
  children: ReactNode;
}) {
  if (query.isPending)
    return (
      <div className="panel empty" role="status">
        Loading your shop data…
      </div>
    );
  if (query.error)
    return (
      <div className="alert danger" role="alert">
        <strong>Unable to load data</strong>
        <p>{query.error.message}</p>
        <button className="btn secondary" onClick={() => query.refetch()}>
          <RefreshCw size={15} />
          Try again
        </button>
      </div>
    );
  return <>{children}</>;
}
export function RecordPages({
  query,
}: {
  query: {
    recordPage: number;
    setRecordPage: (page: number) => void;
    data?: unknown[];
    isPending: boolean;
  };
}) {
  return (
    <div className="section-toolbar">
      <span className="muted">
        Record group {query.recordPage} · Search and sort apply to this group of up to 100 records.
      </span>
      <div className="inline">
        <button
          className="btn secondary"
          disabled={query.isPending || query.recordPage === 1}
          onClick={() => query.setRecordPage(query.recordPage - 1)}
        >
          Previous records
        </button>
        <button
          className="btn secondary"
          disabled={query.isPending || (query.data?.length ?? 0) < 100}
          onClick={() => query.setRecordPage(query.recordPage + 1)}
        >
          More records
        </button>
      </div>
    </div>
  );
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'success' | 'danger' | 'warning' | 'neutral';
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
