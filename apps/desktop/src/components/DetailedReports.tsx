import { useState } from 'react';
import { reportKinds, money, quantity, type Report, type ReportKind } from '@agripos/shared';
import { useData } from '../services/api';
import { exportReport } from '../services/export';
import { useAllowed } from '../stores/session';
import { QueryState } from './common';
import { Table } from './Table';
import { toast } from 'sonner';
export function DetailedReports({ from, to }: { from: string; to: string }) {
  const [kind, setKind] = useState<ReportKind>('products'),
    admin = useAllowed('staff.manage'),
    query = useData<Report>(`/reports/detail/${kind}?from=${from}&to=${to}`);
  return (
    <section>
      <div className="panel report-filters">
        <label>
          Detailed report
          <select value={kind} onChange={(e) => setKind(e.target.value as ReportKind)}>
            {reportKinds
              .filter((k) => k !== 'audit' || admin)
              .map((k) => (
                <option key={k} value={k}>
                  {k.replaceAll('-', ' ')}
                </option>
              ))}
          </select>
        </label>
        <button
          className="btn secondary"
          disabled={!query.data || query.data.truncated}
          onClick={() => exportReport(query.data!, 'csv', `AgriPOS-${kind}-${from}-${to}`)}
        >
          Export CSV
        </button>
        <button
          className="btn secondary"
          disabled={!query.data || query.data.truncated}
          onClick={() => exportReport(query.data!, 'excel', `AgriPOS-${kind}-${from}-${to}`)}
        >
          Export Excel XML
        </button>
        <button
          className="btn secondary"
          disabled={!query.data || query.data.truncated}
          onClick={async () => {
            try {
              const result = await window.desktop.printReport({ kind, from, to });
              if (!result.cancelled) toast.success('Report PDF saved');
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Report export failed');
            }
          }}
        >
          Save PDF
        </button>
        <button
          className="btn secondary"
          disabled={!query.data || query.data.truncated}
          onClick={async () => {
            try {
              await window.desktop.printReport({ kind, from, to, pdf: false });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Printing failed');
            }
          }}
        >
          Print report
        </button>
      </div>
      <QueryState query={query}>
        {query.data?.truncated && (
          <div className="alert warning">
            More than 10,000 rows match. Narrow the date range to export the complete report.
          </div>
        )}
        <h2>{query.data?.title}</h2>
        <Table
          rows={query.data?.rows ?? []}
          searchText={(r) => Object.values(r).join(' ')}
          columns={(query.data?.columns ?? []).map((c) => ({
            key: c.key,
            title: c.label,
            value: (r: Record<string, unknown>) =>
              r[c.key] == null
                ? '—'
                : c.format === 'money'
                  ? money(Number(r[c.key]))
                  : c.format === 'quantity'
                    ? quantity(Number(r[c.key]))
                    : String(r[c.key]),
            sort: (r: Record<string, unknown>) =>
              typeof r[c.key] === 'number' ? (r[c.key] as number) : String(r[c.key] ?? ''),
          }))}
        />
      </QueryState>
    </section>
  );
}
