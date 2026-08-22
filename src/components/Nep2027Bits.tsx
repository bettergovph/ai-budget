/**
 * Shared building blocks for the FY2027 NEP microsite.
 *
 * The microsite has one job the GAA portal doesn't: every number is a
 * *comparison* (FY2027 proposed vs FY2026 enacted). So the primitives here all
 * take an `amount` / `base_amount` pair rather than a single value.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import SiteHeader from './SiteHeader';
import * as fmt from '../lib/format';
import {
  BASE_YEAR, DATA_BASE_OVERRIDE, NEP_YEAR, formatPct, pctChange, type NepRollupRow,
} from '../lib/nep2027';

export function Delta({ amount, base }: { amount: number; base: number }) {
  const d = amount - base;
  const p = pctChange(amount, base);
  const color = d > 0 ? 'var(--positive)' : d < 0 ? 'var(--negative)' : 'var(--ink-mute)';
  return (
    <span className="nep-delta" style={{ color }}>
      <span className="nep-delta-abs">{d >= 0 ? '+' : '−'}{fmt.shortPhp(Math.abs(d))}</span>
      <span className="nep-delta-pct">{p == null ? 'new' : formatPct(p)}</span>
    </span>
  );
}

/** Horizontal bar showing FY2027 against the largest row in the same table. */
export function Bar({ value, max, base }: { value: number; max: number; base?: number }) {
  const w = max > 0 ? Math.max((value / max) * 100, 0.4) : 0;
  const bw = base != null && max > 0 ? Math.max((base / max) * 100, 0) : null;
  return (
    <span className="nep-bar" aria-hidden="true">
      {bw != null && <span className="nep-bar-base" style={{ width: `${bw}%` }} />}
      <span className="nep-bar-fill" style={{ width: `${w}%` }} />
    </span>
  );
}

export interface KpiItem {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'up' | 'down';
}

export function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <div className="kpi-strip">
      {items.map((k, i) => (
        <div className="kpi-cell" key={i}>
          <div className="kpi-label">{k.label}</div>
          <div
            className="kpi-value"
            style={k.tone ? { color: k.tone === 'up' ? 'var(--positive)' : 'var(--negative)' } : undefined}
          >
            {k.value}
          </div>
          {k.sub && <div className="kpi-sub">{k.sub}</div>}
        </div>
      ))}
    </div>
  );
}

type SortKey = 'amount' | 'base_amount' | 'delta' | 'pct' | 'description' | 'count';

export interface CompareTableProps {
  rows: NepRollupRow[];
  /** Column header for the code/name column. */
  label: string;
  /** Render the name cell as a link. */
  linkTo?: (row: NepRollupRow) => string | null;
  /** Show the raw code alongside the description. */
  showCode?: boolean;
  /** Rows shown before the "show all" toggle appears. */
  initial?: number;
  /** Show the FY2027 line-item count column. */
  showCount?: boolean;
  emptyLabel?: string;
}

/**
 * Sortable FY2027-vs-FY2026 table. Sorting is client-side over an array that
 * is at most a few hundred rows (the importer caps every rollup it emits into
 * `summary.json`), so there's no need for windowing here.
 */
export function CompareTable({
  rows,
  label,
  linkTo,
  showCode = true,
  initial = 25,
  showCount = false,
  emptyLabel = 'No rows.',
}: CompareTableProps) {
  const [sort, setSort] = useState<SortKey>('amount');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [expanded, setExpanded] = useState(false);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.description.toLowerCase().includes(needle) ||
        String(r.code ?? '').toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const sorted = useMemo(() => {
    const val = (r: NepRollupRow): number | string => {
      switch (sort) {
        case 'description': return r.description.toLowerCase();
        case 'base_amount': return r.base_amount;
        case 'delta': return r.delta;
        case 'count': return r.count;
        case 'pct': return pctChange(r.amount, r.base_amount) ?? -Infinity;
        default: return r.amount;
      }
    };
    const mult = dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * mult;
      }
      return (av - bv) * mult;
    });
  }, [filtered, sort, dir]);

  const max = useMemo(
    () => Math.max(0, ...rows.map((r) => Math.max(r.amount, r.base_amount))),
    [rows],
  );
  const shown = expanded ? sorted : sorted.slice(0, initial);

  function head(key: SortKey, text: string, cls = '') {
    const active = sort === key;
    return (
      <th className={`${cls} ${active ? 'nep-th-active' : ''}`}>
        <button
          type="button"
          onClick={() => {
            if (active) setDir(dir === 'asc' ? 'desc' : 'asc');
            else {
              setSort(key);
              setDir(key === 'description' ? 'asc' : 'desc');
            }
          }}
        >
          {text}
          <span className="nep-sort-caret">{active ? (dir === 'asc' ? '▲' : '▼') : ''}</span>
        </button>
      </th>
    );
  }

  if (!rows.length) return <p className="nep-empty">{emptyLabel}</p>;

  return (
    <div className="nep-table-block">
      <div className="nep-table-toolbar">
        <input
          className="text-input nep-filter"
          type="search"
          placeholder={`Filter ${label.toLowerCase()}…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="nep-table-count">
          {sorted.length.toLocaleString()} {sorted.length === 1 ? 'row' : 'rows'}
          {filtered.length !== rows.length && ` of ${rows.length.toLocaleString()}`}
        </span>
      </div>
      <div className="nep-table-wrap">
        <table className="nep-table">
          <thead>
            <tr>
              {head('description', label, 'nep-th-name')}
              {showCount && head('count', 'Items', 'num')}
              {head('base_amount', `FY${BASE_YEAR} GAA`, 'num')}
              {head('amount', `FY${NEP_YEAR} NEP`, 'num')}
              <th className="nep-th-bar" />
              {head('delta', 'Change', 'num')}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const href = linkTo?.(r) ?? null;
              return (
                <tr key={r.code ?? r.description}>
                  <td className="nep-td-name">
                    {href ? <Link to={href}>{r.description}</Link> : r.description}
                    {showCode && r.code && <span className="nep-code">{r.code}</span>}
                  </td>
                  {showCount && <td className="num">{r.count.toLocaleString()}</td>}
                  <td className="num nep-td-base">{fmt.shortPhp(r.base_amount)}</td>
                  <td className="num nep-td-amt">{fmt.shortPhp(r.amount)}</td>
                  <td className="nep-td-bar"><Bar value={r.amount} max={max} base={r.base_amount} /></td>
                  <td className="num"><Delta amount={r.amount} base={r.base_amount} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > initial && (
        <button type="button" className="nep-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer' : `Show all ${sorted.length.toLocaleString()}`}
        </button>
      )}
    </div>
  );
}

const NEP_NAV: Array<{ to: string; label: string }> = [
  { to: '/2027', label: 'Overview' },
  { to: '/2027/explore', label: 'Line items' },
  { to: '/2027/methodology', label: 'Methodology' },
];

/** Masthead + the microsite's own sub-nav. */
export function NepHeader({ crumb, compiledMeta }: { crumb?: ReactNode; compiledMeta?: ReactNode }) {
  return (
    <SiteHeader
      crumb={crumb}
      compiledMeta={compiledMeta}
      subNav={
        <nav className="view-tabs section-tabs" aria-label="FY2027 NEP sections">
          {NEP_NAV.map((n) => (
            <Link key={n.to} to={n.to}>{n.label}</Link>
          ))}
        </nav>
      }
      drawerExtras={
        <nav className="nep-drawer-nav" aria-label="FY2027 NEP sections">
          {NEP_NAV.map((n) => (
            <Link key={n.to} to={n.to}>{n.label}</Link>
          ))}
        </nav>
      }
    />
  );
}

export function NepLoading({ what }: { what: string }) {
  return <main className="nep-status">Loading {what}…</main>;
}

export function NepError({ message }: { message: string }) {
  return (
    <main className="nep-status nep-status-error">
      <p>{message}</p>
      {DATA_BASE_OVERRIDE ? (
        <p className="nep-status-hint">
          The browser is reading assets from <code>{DATA_BASE_OVERRIDE}</code>, set via{' '}
          <code>VITE_DATA_BASE_URL</code>. That host carries the FY2020–2026 GAA data but not
          the <code>2027/</code> prefix unless it has been published. Either run{' '}
          <code>npm run upload:nep2027</code> to publish it, or put{' '}
          <code>VITE_DATA_BASE_URL=</code> in <code>.env.local</code> to serve the locally
          generated tree from <code>public/data</code> instead.
        </p>
      ) : (
        <p className="nep-status-hint">
          Assets are being served from the local <code>public/data</code> tree. If{' '}
          <code>data/2027/</code> is missing, generate it with{' '}
          <code>npm run import:nep2027</code>, then check it with{' '}
          <code>npm run verify:nep2027</code>.
        </p>
      )}
      <p><Link to="/2027">Back to the FY2027 overview</Link></p>
    </main>
  );
}
