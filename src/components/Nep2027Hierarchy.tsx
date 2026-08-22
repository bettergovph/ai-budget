/**
 * FY2027 spending-group hierarchy — the drill-down the GAA portal has, applied
 * to the NEP.
 *
 *   Agency → Program → Activity / project → Operating unit → Fund → Expense
 *   class → Object code
 *
 * Two differences from the GAA portal's version, both forced by the data:
 *
 *  - Every level shows FY2027 against the FY2026 GAA baseline, because that
 *    comparison is the point of this microsite. Both years live in the
 *    department's parquet, discriminated by `fy`.
 *  - It goes one level deeper than the GAA portal (which stops at expense
 *    class). Down a drill path the object list is small, so there is no reason
 *    to stop short.
 *
 * Where the data comes from is split by depth, because the two sources have
 * very different costs:
 *
 *  - **Level 0 (agencies) is served from D1**, reusing the rollup the
 *    department page has already fetched. DuckDB does not range-read these
 *    files — it downloads them whole — so drawing the default view from
 *    parquet meant pulling 7 MB and waiting 3.2 s before DepEd painted
 *    anything. Level 0 now costs nothing.
 *  - **Level 1 and deeper come from parquet**, because that is a
 *    per-department drill 180k projects wide for DPWH, which is exactly the
 *    grain parquet is here for, and only users who actually drill pay for it.
 *
 * The two paths are interchangeable: `verify:nep2027` asserts D1 and parquet
 * agree on every rollup row, in both years.
 *
 * Correctness note: codes are NULL on rows the source does not tag (no
 * operating unit on SPF/AUTO, no division outside DepEd). Those are bucketed
 * under `__unassigned__` rather than filtered out, so each level sums to its
 * parent instead of silently losing money.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { runQuery } from '../lib/duckdb';
import { downloadCsv } from '../lib/csv';
import * as fmt from '../lib/format';
import { BASE_YEAR, NEP_YEAR, lineItemsUrl, type NepRollupRow } from '../lib/nep2027';
import { Bar, Delta } from './Nep2027Bits';

const UNASSIGNED = '__unassigned__';

interface Level {
  key: string;
  code: string;
  desc: string;
  /** Heading shown when listing this level. */
  title: string;
  /** Singular noun for the row counter. */
  noun: string;
  /** Explicit plural — "agencys"/"activitys" are not words. */
  plural: string;
}

const LEVELS: Level[] = [
  { key: 'agency', code: 'agency_code', desc: 'agency_dsc', title: 'Agencies and bureaus', noun: 'agency', plural: 'agencies' },
  { key: 'program', code: 'program_code', desc: 'program_dsc', title: 'Programs', noun: 'program', plural: 'programs' },
  { key: 'activity', code: 'fpap_code', desc: 'fpap_dsc', title: 'Activities and projects', noun: 'activity', plural: 'activities' },
  { key: 'operating_unit', code: 'operunit_code', desc: 'operunit_dsc', title: 'Operating units', noun: 'operating unit', plural: 'operating units' },
  { key: 'fund', code: 'fund_code', desc: 'fund_dsc', title: 'Fund sources', noun: 'fund', plural: 'funds' },
  { key: 'expense_class', code: 'expense_code', desc: 'expense_dsc', title: 'Expense classes', noun: 'expense class', plural: 'expense classes' },
  { key: 'object', code: 'object_code', desc: 'object_dsc', title: 'Object codes', noun: 'object', plural: 'objects' },
];

interface Row {
  code: string;
  description: string | null;
  items: number;
  amount: number;
  base_amount: number;
}

interface Crumb {
  depth: number;
  code: string;
  label: string;
  /** Parent totals, so each level can prove it sums back to the row above. */
  amount: number;
  base: number;
}

const sqlStr = (v: string) => `'${v.replace(/'/g, "''")}'`;

export default function Nep2027Hierarchy({
  deptId,
  deptLabel,
  deptAmount,
  deptBaseAmount,
  agencies,
}: {
  deptId: string;
  deptLabel: string;
  deptAmount: number;
  deptBaseAmount: number;
  /** D1 agency rollup, already loaded by the department page — level 0. */
  agencies: NepRollupRow[];
}) {
  // Keyed by department so navigating to another group resets the drill
  // without clearing state synchronously in an effect.
  const [drill_, setDrill] = useState<{ dept: string; path: Crumb[] }>({ dept: deptId, path: [] });
  const path = useMemo(
    () => (drill_.dept === deptId ? drill_.path : []),
    [drill_, deptId],
  );
  const setPath = useCallback(
    (next: Crumb[]) => setDrill({ dept: deptId, path: next }),
    [deptId],
  );

  // Tagged with the query that produced it, so a level in flight never renders
  // the previous level's numbers under the new level's heading.
  const [result, setResult] = useState<{ sql: string; rows: Row[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);

  const depth = path.length;
  const level = LEVELS[Math.min(depth, LEVELS.length - 1)];
  const isLeaf = depth >= LEVELS.length - 1;

  // Level 0 is answered from D1; only deeper levels touch parquet.
  const sql = useMemo(() => {
    if (depth === 0) return null;
    const filters = path.map((c) => {
      const col = LEVELS[c.depth].code;
      return c.code === UNASSIGNED ? `${col} IS NULL` : `${col} = ${sqlStr(c.code)}`;
    });
    const where = filters.length ? `\n WHERE ${filters.join('\n   AND ')}` : '';
    return `SELECT coalesce(${level.code}, '${UNASSIGNED}') AS code,
       coalesce(max(${level.desc}) FILTER (fy = ${NEP_YEAR}), max(${level.desc})) AS description,
       count(*) FILTER (fy = ${NEP_YEAR})                    AS items,
       coalesce(sum(amount) FILTER (fy = ${NEP_YEAR}), 0)    AS amount,
       coalesce(sum(amount) FILTER (fy = ${BASE_YEAR}), 0)   AS base_amount
  FROM read_parquet('${lineItemsUrl(deptId)}')${where}
 GROUP BY 1
 ORDER BY amount DESC`;
  }, [deptId, level, path, depth]);

  // Deferred a tick so the fetch never fires synchronously from the effect
  // body, and guarded so a slow query for a level we have already navigated
  // away from cannot paint over the current one.
  useEffect(() => {
    if (!sql) return;
    let live = true;
    const t = setTimeout(async () => {
      setErr(null);
      try {
        const res = await runQuery<Row>(sql);
        if (!live) return;
        setResult({
          sql,
          rows: res.rows.map((r) => ({
            ...r,
            items: Number(r.items),
            amount: Number(r.amount),
            base_amount: Number(r.base_amount),
          })),
        });
        setMs(Math.round(res.ms));
      } catch (e) {
        if (!live) return;
        setErr(String((e as Error)?.message || e));
        setResult({ sql, rows: [] });
      }
    }, 0);
    return () => { live = false; clearTimeout(t); };
  }, [sql]);

  // At level 0 use the D1 rollup verbatim; deeper levels use the parquet result.
  const rootRows = useMemo<Row[]>(
    () => agencies.map((a) => ({
      code: a.code,
      description: a.description,
      items: a.count,
      amount: a.amount,
      base_amount: a.base_amount,
    })),
    [agencies],
  );
  const fresh = sql && result?.sql === sql ? result.rows : null;
  const shown = depth === 0 ? rootRows : (fresh ?? []);
  const loading = depth > 0 && fresh === null;
  const max = Math.max(0, ...shown.map((r) => Math.max(r.amount, r.base_amount)));

  // What this level should add up to — the department, or the row we drilled
  // into. Both years are checked and the result is shown in the footer, so a
  // level that fails to reconcile is visible rather than silent.
  const parent = depth === 0
    ? { amount: deptAmount, base: deptBaseAmount }
    : { amount: path[depth - 1].amount, base: path[depth - 1].base };
  const levelTotal = shown.reduce((a, r) => a + r.amount, 0);
  const levelBase = shown.reduce((a, r) => a + r.base_amount, 0);
  const drift = Math.abs(levelTotal - parent.amount) + Math.abs(levelBase - parent.base);
  const reconciles = drift < 1;

  function drill(r: Row) {
    if (isLeaf) return;
    setPath([...path, {
      depth,
      code: r.code,
      label: r.description ?? '(not attributed)',
      amount: r.amount,
      base: r.base_amount,
    }]);
  }

  function jumpTo(i: number) {
    setPath(i < 0 ? [] : path.slice(0, i + 1));
  }

  return (
    <div className="nep-hier">
      <div className="nep-hier-head">
        <div>
          <p className="eyebrow">Hierarchy · drill from the spending group down to object codes</p>
          <h3 className="nep-hier-title">{level.title}</h3>
        </div>
        <div className="nep-hier-meta">
          {loading ? <span className="nep-busy">Loading line items…</span> : (
            <>
              <strong>{shown.length.toLocaleString()}</strong> {shown.length === 1 ? level.noun : level.plural}
              <span className="nep-ms">
                {depth === 0 ? ' · from D1' : ms != null ? ` · ${ms} ms` : ''}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="nep-hier-bar">
        <button type="button" onClick={() => setPath(path.slice(0, -1))} disabled={depth === 0}>
          ← Back
        </button>
        <nav className="nep-hier-crumbs" aria-label="Hierarchy breadcrumb">
          <button type="button" onClick={() => jumpTo(-1)} className={depth === 0 ? 'is-current' : ''}>
            {deptLabel}
          </button>
          {path.map((c, i) => (
            <span key={i}>
              <span className="nep-hier-sep">›</span>
              <button
                type="button"
                onClick={() => jumpTo(i)}
                className={i === depth - 1 ? 'is-current' : ''}
              >
                {c.label}
              </button>
            </span>
          ))}
        </nav>
        <button
          type="button"
          className="csv-btn"
          disabled={!shown.length}
          onClick={() => downloadCsv(
            `nep-2027-${deptId}-${level.key}${path.length ? `-${path[path.length - 1].code}` : ''}.csv`,
            toCsv(shown, level),
          )}
        >
          CSV
        </button>
      </div>

      {err && <p className="nep-status-error nep-query-err">{err}</p>}

      <div className="nep-table-wrap">
        <table className="nep-table nep-hier-table">
          <thead>
            <tr>
              <th className="nep-th-name">{level.title}</th>
              <th className="num">Items</th>
              <th className="num">FY{BASE_YEAR} GAA</th>
              <th className="num">FY{NEP_YEAR} NEP</th>
              <th className="nep-th-bar" />
              <th className="num">Change</th>
              {!isLeaf && <th className="nep-th-chev" />}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.code}
                className={isLeaf ? '' : 'is-drillable'}
                onClick={() => drill(r)}
                tabIndex={isLeaf ? -1 : 0}
                role={isLeaf ? undefined : 'button'}
                onKeyDown={(e) => { if (!isLeaf && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); drill(r); } }}
              >
                <td className="nep-td-name">
                  {r.description ?? '(not attributed)'}
                  {r.code !== UNASSIGNED && <span className="nep-code">{r.code}</span>}
                </td>
                <td className="num">{r.items.toLocaleString()}</td>
                <td className="num nep-td-base">{fmt.shortPhp(r.base_amount)}</td>
                <td className="num nep-td-amt">{fmt.shortPhp(r.amount)}</td>
                <td className="nep-td-bar"><Bar value={r.amount} max={max} base={r.base_amount} /></td>
                <td className="num"><Delta amount={r.amount} base={r.base_amount} /></td>
                {!isLeaf && <td className="nep-td-chev" aria-hidden="true">›</td>}
              </tr>
            ))}
            {!shown.length && !loading && (
              <tr><td colSpan={isLeaf ? 6 : 7} className="nep-empty">Nothing at this level.</td></tr>
            )}
          </tbody>
          {shown.length > 0 && (
            <tfoot>
              <tr>
                <td className="nep-td-name">Total</td>
                <td className="num">{shown.reduce((a, r) => a + r.items, 0).toLocaleString()}</td>
                <td className="num nep-td-base">{fmt.shortPhp(shown.reduce((a, r) => a + r.base_amount, 0))}</td>
                <td className="num nep-td-amt">{fmt.shortPhp(levelTotal)}</td>
                <td />
                <td className="num">
                  {reconciles
                    ? <span className="nep-recon-ok">reconciles</span>
                    : <span className="nep-recon-bad">off by {fmt.shortPhp(drift)}</span>}
                </td>
                {!isLeaf && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="nep-hier-note">
        {isLeaf
          ? 'Object codes are the bottom of the hierarchy — this is the line-item level.'
          : 'Click any row to drill in.'}
        {' '}Every level sums to the row above it; untagged rows are shown as
        {' '}<em>(not attributed)</em> rather than dropped.
        {' '}FY{BASE_YEAR} figures are the enacted GAA, FY{NEP_YEAR} the proposal.
      </p>
    </div>
  );
}

function toCsv(rows: Row[], level: Level): string {
  const head = [`${level.key}_code`, 'description', 'items', `amount_fy${BASE_YEAR}`, `amount_fy${NEP_YEAR}`, 'delta'];
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    head.join(','),
    ...rows.map((r) => [
      r.code, r.description ?? '', r.items, r.base_amount, r.amount, r.amount - r.base_amount,
    ].map(esc).join(',')),
  ].join('\n');
}
