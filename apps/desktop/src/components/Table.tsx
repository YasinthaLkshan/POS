import { useMemo, useState, type ReactNode } from 'react';
import { Search, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
export interface Column<T> {
  key: string;
  title: string;
  value: (row: T) => ReactNode;
  sort?: (row: T) => string | number;
  align?: 'end';
}
export function Table<T>({
  rows,
  columns,
  searchText,
  empty = 'No records yet. Add your first record to get started.',
}: {
  rows: T[];
  columns: Column<T>[];
  searchText?: (row: T) => string;
  empty?: string;
}) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(0),
    [sort, setSort] = useState<{ key: string; direction: number } | null>(null);
  const filtered = useMemo(() => {
    const result = rows.filter(
      (r) => !searchText || searchText(r).toLowerCase().includes(search.toLowerCase()),
    );
    const column = columns.find((c) => c.key === sort?.key);
    if (column?.sort)
      result.sort((a, b) => {
        const x = column.sort!(a),
          y = column.sort!(b);
        return (
          (typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y))) * (sort?.direction ?? 1)
        );
      });
    return result;
  }, [rows, columns, search, searchText, sort]);
  const current = Math.min(page, Math.max(0, Math.ceil(filtered.length / 12) - 1));
  return (
    <div className="panel table-panel">
      {searchText && (
        <div className="table-tools">
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label="Search table"
              placeholder="Search records…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <span className="muted">{filtered.length} records loaded</span>
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.align === 'end' ? 'cell-end' : undefined}>
                  {c.sort ? (
                    <button
                      className="table-sort"
                      onClick={() =>
                        setSort({
                          key: c.key,
                          direction: sort?.key === c.key ? -sort.direction : 1,
                        })
                      }
                    >
                      {c.title}
                      <ArrowUpDown size={12} />
                    </button>
                  ) : (
                    c.title
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(current * 12, current * 12 + 12).map((row, index) => (
              <tr key={index}>
                {columns.map((c) => (
                  <td key={c.key} className={c.align === 'end' ? 'cell-end' : undefined}>
                    {c.value(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && <div className="empty">{empty}</div>}
      </div>
      <div className="table-footer">
        <span>
          Page {current + 1} of {Math.max(1, Math.ceil(filtered.length / 12))}
        </span>
        <div className="inline">
          <button
            className="icon-btn"
            aria-label="Previous page"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-btn"
            aria-label="Next page"
            disabled={(current + 1) * 12 >= filtered.length}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
