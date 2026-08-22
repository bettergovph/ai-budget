/**
 * `/2027/search` — search the FY2027 NEP down to the line item.
 *
 * Each department's 2027 line items are a single ZSTD parquet file. DuckDB-Wasm
 * range-reads it in the browser, so filtering 327k DepEd rows costs one fetch of
 * the columns actually touched — no API, no D1, no server-side pagination.
 *
 * The generated SQL is shown verbatim: analysts asked for numbers they can
 * defend, and a visible query is the cheapest way to make a filter auditable.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { NepError, NepHeader, NepLoading } from '../components/Nep2027Bits';
import { runQuery } from '../lib/duckdb';
import { downloadCsv } from '../lib/csv';
import * as fmt from '../lib/format';
import { NEP_YEAR, lineItemsUrl, loadNepIndex, type NepNationalIndex } from '../lib/nep2027';
import '../nep2027.css';

interface Row {
  agency_dsc: string | null;
  program_dsc: string | null;
  fpap_dsc: string | null;
  operunit_dsc: string | null;
  region_dsc: string | null;
  fund_dsc: string | null;
  expense_dsc: string | null;
  object_code: string | null;
  object_dsc: string | null;
  amount: number;
}

const GROUPINGS = [
  { key: 'none', label: 'Line items (no grouping)' },
  { key: 'object_dsc', label: 'Group by object' },
  { key: 'agency_dsc', label: 'Group by agency' },
  { key: 'program_dsc', label: 'Group by program' },
  { key: 'operunit_dsc', label: 'Group by operating unit' },
  { key: 'region_dsc', label: 'Group by region' },
  { key: 'fund_dsc', label: 'Group by fund' },
] as const;

const LIMITS = [100, 500, 2000, 10000];

export default function Nep2027Explore() {
  const [params, setParams] = useSearchParams();
  const [idx, setIdx] = useState<NepNationalIndex | null>(null);
  const [idxErr, setIdxErr] = useState<string | null>(null);

  const dept = params.get('dept') || '';
  const [q, setQ] = useState(params.get('q') || '');
  const [expense, setExpense] = useState(params.get('expense') || '');
  const [region, setRegion] = useState(params.get('region') || '');
  const [grouping, setGrouping] = useState<string>(params.get('group') || 'none');
  const [limit, setLimit] = useState(Number(params.get('limit')) || 500);

  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<{ n: number; amount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [queryErr, setQueryErr] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    loadNepIndex().then(setIdx).catch((e) => setIdxErr(String(e?.message || e)));
  }, []);

  const sql = useMemo(() => {
    if (!dept) return null;
    const src = `read_parquet('${lineItemsUrl(dept)}')`;
    // The parquet carries FY2026 and FY2027 so the hierarchy can compare them;
    // this view is FY2027 only, so `fy` must always be pinned or every total
    // double-counts.
    const where: string[] = [`fy = ${NEP_YEAR}`];
    const needle = q.trim().replace(/'/g, "''");
    if (needle) {
      where.push(
        `(object_dsc ILIKE '%${needle}%' OR fpap_dsc ILIKE '%${needle}%' OR program_dsc ILIKE '%${needle}%'` +
        ` OR operunit_dsc ILIKE '%${needle}%' OR agency_dsc ILIKE '%${needle}%' OR fund_dsc ILIKE '%${needle}%'` +
        ` OR div_dsc ILIKE '%${needle}%' OR object_code LIKE '%${needle}%')`,
      );
    }
    if (expense) where.push(`expense_code = '${expense.replace(/'/g, "''")}'`);
    if (region) where.push(`region_code = '${region.replace(/'/g, "''")}'`);
    const clause = where.length ? `\nWHERE ${where.join('\n  AND ')}` : '';

    if (grouping !== 'none') {
      return `SELECT ${grouping} AS label,
       count(*) AS items,
       sum(amount) AS amount
FROM ${src}${clause}
GROUP BY 1
ORDER BY amount DESC
LIMIT ${limit}`;
    }
    return `SELECT agency_dsc, program_dsc, fpap_dsc, operunit_dsc, region_dsc,
       fund_dsc, expense_dsc, object_code, object_dsc, amount
FROM ${src}${clause}
ORDER BY amount DESC
LIMIT ${limit}`;
  }, [dept, q, expense, region, grouping, limit]);

  const totalSql = useMemo(() => {
    if (!sql) return null;
    // Reuse the exact filter of the display query so the summary can never
    // disagree with the table; strip only the projection/limit.
    const from = sql.slice(sql.indexOf('FROM '));
    const body = from.replace(/\nGROUP BY[\s\S]*$/, '').replace(/\nORDER BY[\s\S]*$/, '');
    return `SELECT count(*) AS n, coalesce(sum(amount), 0) AS amount ${body}`;
  }, [sql]);

  const run = useCallback(async () => {
    if (!sql || !totalSql) return;
    setBusy(true);
    setQueryErr(null);
    try {
      const [res, sum] = await Promise.all([
        runQuery<Row>(sql),
        runQuery<{ n: number | bigint; amount: number }>(totalSql),
      ]);
      setRows(res.rows);
      setMs(Math.round(res.ms));
      const s = sum.rows[0];
      setTotal(s ? { n: Number(s.n), amount: Number(s.amount) } : null);
    } catch (e) {
      setQueryErr(String((e as Error)?.message || e));
      setRows([]);
      setTotal(null);
    } finally {
      setBusy(false);
    }
  }, [sql, totalSql]);

  // Auto-run whenever a department is selected or a filter settles.
  useEffect(() => {
    if (!dept) return;
    const t = setTimeout(run, 250);
    return () => clearTimeout(t);
  }, [dept, run]);

  function setDept(next: string) {
    const p = new URLSearchParams(params);
    if (next) p.set('dept', next); else p.delete('dept');
    setParams(p, { replace: true });
    setRows([]);
    setTotal(null);
  }

  function syncParam(key: string, value: string) {
    const p = new URLSearchParams(params);
    if (value) p.set(key, value); else p.delete(key);
    setParams(p, { replace: true });
  }

  if (idxErr) return <NepError message={idxErr} />;
  if (!idx) return <NepLoading what="the FY2027 department list" />;

  const deptRow = idx.departments.find((d) => d.id === dept);
  const grouped = grouping !== 'none';

  return (
    <>
      <NepHeader crumb="Search" compiledMeta="DuckDB in-browser" />
      <main className="nep-main">
        <div className="page-headline">
          <p className="page-eyebrow">Search · Fiscal Year {NEP_YEAR}</p>
          <h1 className="page-title">Search the FY{NEP_YEAR} NEP</h1>
          <p className="page-dek">
            Pick a spending group and search its line items by name, object code, expense class or
            region. The query runs in your browser over the department's own data — nothing is sent to
            a server, the SQL below is exactly what runs, and results download as CSV.
          </p>
        </div>

        <div className="nep-explore-controls">
          <label>
            <span>Spending group</span>
            <select className="select-input" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">Select a group…</option>
              {idx.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.description} · {fmt.shortPhp(d.amount)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Search text</span>
            <input
              className="text-input"
              type="search"
              placeholder="e.g. infrastructure, salaries, 5021203000"
              value={q}
              onChange={(e) => { setQ(e.target.value); syncParam('q', e.target.value); }}
            />
          </label>
          <label>
            <span>Expense class</span>
            <select
              className="select-input"
              value={expense}
              onChange={(e) => { setExpense(e.target.value); syncParam('expense', e.target.value); }}
            >
              <option value="">All</option>
              {idx.expense_classes.map((c) => (
                <option key={c.code} value={c.code}>{c.description}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Region</span>
            <select
              className="select-input"
              value={region}
              onChange={(e) => { setRegion(e.target.value); syncParam('region', e.target.value); }}
            >
              <option value="">All</option>
              {idx.regions.map((r) => (
                <option key={r.code} value={r.code}>{r.description}</option>
              ))}
            </select>
          </label>
          <label>
            <span>View</span>
            <select
              className="select-input"
              value={grouping}
              onChange={(e) => { setGrouping(e.target.value); syncParam('group', e.target.value); }}
            >
              {GROUPINGS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
          </label>
          <label>
            <span>Rows</span>
            <select
              className="select-input"
              value={limit}
              onChange={(e) => { setLimit(Number(e.target.value)); syncParam('limit', e.target.value); }}
            >
              {LIMITS.map((l) => <option key={l} value={l}>{l.toLocaleString()}</option>)}
            </select>
          </label>
        </div>

        {!dept && (
          <p className="nep-empty nep-explore-empty">
            Select a spending group to start searching. Large groups (DepEd, DPWH) take a few seconds
            on the first query while the data loads.
          </p>
        )}

        {dept && (
          <>
            <div className="nep-explore-summary">
              {busy && <span className="nep-busy">Running…</span>}
              {!busy && total && (
                <>
                  <strong>{total.n.toLocaleString()}</strong> matching line items ·{' '}
                  <strong>{fmt.shortPhp(total.amount)}</strong>
                  {deptRow && total.amount !== deptRow.amount && (
                    <> · {((total.amount / deptRow.amount) * 100).toFixed(1)}% of {deptRow.description}</>
                  )}
                  {ms != null && <span className="nep-ms"> · {ms} ms</span>}
                </>
              )}
              <span className="nep-explore-actions">
                {deptRow && <Link to={`/2027/d/${deptRow.id}`}>Open {deptRow.id} summary →</Link>}
                <button
                  type="button"
                  className="csv-btn"
                  disabled={!rows.length}
                  onClick={() => downloadCsv(`nep-2027-${dept}${grouped ? `-by-${grouping}` : ''}.csv`, toCsv(rows))}
                >
                  Download CSV
                </button>
              </span>
            </div>

            {queryErr && <p className="nep-status-error nep-query-err">{queryErr}</p>}

            <details className="nep-sql">
              <summary>SQL</summary>
              <pre>{sql}</pre>
            </details>

            <div className="nep-table-wrap nep-explore-table">
              <table className="nep-table">
                <thead>
                  {grouped ? (
                    <tr><th className="nep-th-name">Group</th><th className="num">Items</th><th className="num">FY{NEP_YEAR} amount</th></tr>
                  ) : (
                    <tr>
                      <th className="nep-th-name">Object</th>
                      <th>Activity</th>
                      <th>Operating unit</th>
                      <th>Region</th>
                      <th>Class</th>
                      <th className="num">Amount</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {rows.map((r, i) => grouped ? (
                    <tr key={i}>
                      <td className="nep-td-name">{(r as unknown as { label: string }).label ?? '(not specified)'}</td>
                      <td className="num">{Number((r as unknown as { items: number }).items).toLocaleString()}</td>
                      <td className="num nep-td-amt">{fmt.shortPhp(Number(r.amount))}</td>
                    </tr>
                  ) : (
                    <tr key={i}>
                      <td className="nep-td-name">
                        {r.object_dsc ?? '—'}
                        {r.object_code && <span className="nep-code">{r.object_code}</span>}
                      </td>
                      <td className="nep-td-dim">{r.fpap_dsc ?? '—'}</td>
                      <td className="nep-td-dim">{r.operunit_dsc ?? r.agency_dsc ?? '—'}</td>
                      <td className="nep-td-dim">{r.region_dsc ?? '—'}</td>
                      <td className="nep-td-dim">{r.expense_dsc ?? '—'}</td>
                      <td className="num nep-td-amt">{fmt.shortPhp(Number(r.amount))}</td>
                    </tr>
                  ))}
                  {!rows.length && !busy && (
                    <tr><td colSpan={grouped ? 3 : 6} className="nep-empty">No rows match these filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {rows.length === limit && (
              <p className="nep-truncated">
                Showing the top {limit.toLocaleString()} rows by amount — raise the row limit or narrow the
                filters to see the rest. The summary above counts <em>all</em> matches, not just these.
              </p>
            )}
          </>
        )}

        <SectionHead
          eyebrow="Note"
          headline="These are proposed amounts"
          size="sm"
          dek="The NEP is the Executive's submission to Congress. Figures change during deliberation; cite the GAA, not the NEP, for enacted appropriations."
        />
      </main>
      <SiteFooter />
    </>
  );
}

function toCsv(rows: Row[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc((r as unknown as Record<string, unknown>)[c])).join(','))].join('\n');
}
