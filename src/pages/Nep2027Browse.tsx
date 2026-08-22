/**
 * `/2027/browse` — every spending group in one sortable table.
 *
 * This was a section on the overview page. It is the densest thing on the
 * site and the most likely starting point for an analyst who already knows
 * which department they want, so it earns its own page: the overview stays a
 * narrative (headline, expense mix, movers) and browsing gets room for
 * filtering and sorting.
 *
 * Served entirely from D1 via the national index — no parquet.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { Bar, Delta, KpiStrip, NepError, NepHeader, NepLoading } from '../components/Nep2027Bits';
import * as fmt from '../lib/format';
import {
  BASE_YEAR, NEP_YEAR, formatPct, isSynthetic, loadNepIndex, pctChange,
  type NepDeptRow, type NepNationalIndex,
} from '../lib/nep2027';
import '../nep2027.css';

type DeptSort = 'amount' | 'delta' | 'pct' | 'description' | 'line_items';

const SORTS: Array<{ key: DeptSort; label: string }> = [
  { key: 'amount', label: `FY${NEP_YEAR} amount` },
  { key: 'delta', label: 'Peso change' },
  { key: 'pct', label: 'Percent change' },
  { key: 'line_items', label: 'Line items' },
  { key: 'description', label: 'Name' },
];

export default function Nep2027Browse() {
  const [idx, setIdx] = useState<NepNationalIndex | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<DeptSort>('amount');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [hideSynthetic, setHideSynthetic] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    loadNepIndex().then(setIdx).catch((e) => setErr(String(e?.message || e)));
  }, []);

  const depts = useMemo(() => {
    if (!idx) return [];
    const needle = q.trim().toLowerCase();
    let rows = hideSynthetic ? idx.departments.filter((d) => !isSynthetic(d.id)) : idx.departments;
    if (needle) {
      rows = rows.filter(
        (d) => d.description.toLowerCase().includes(needle) || d.id.toLowerCase().includes(needle),
      );
    }
    const val = (d: NepDeptRow): number | string => {
      switch (sort) {
        case 'description': return d.description.toLowerCase();
        case 'delta': return d.delta;
        case 'line_items': return d.line_items;
        case 'pct': return pctChange(d.amount, d.base_amount) ?? -Infinity;
        default: return d.amount;
      }
    };
    const mult = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * mult;
      }
      return (av - bv) * mult;
    });
  }, [idx, sort, dir, hideSynthetic, q]);

  if (err) return <NepError message={err} />;
  if (!idx) return <NepLoading what="the FY2027 spending groups" />;

  const maxDept = Math.max(0, ...depts.map((d) => Math.max(d.amount, d.base_amount)));
  const shownTotal = depts.reduce((a, d) => a + d.amount, 0);
  const shownBase = depts.reduce((a, d) => a + d.base_amount, 0);
  const isFiltered = depts.length !== idx.departments.length;

  function head(key: DeptSort, text: string, cls = '') {
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

  return (
    <>
      <NepHeader crumb="Browse" compiledMeta={`${fmt.shortPhp(idx.national.amount, 'T')} proposed`} />

      <main className="nep-main">
        <div className="page-headline">
          <p className="page-eyebrow">Browse · Fiscal Year {NEP_YEAR}</p>
          <h1 className="page-title">Every spending group</h1>
          <p className="page-dek">
            All {idx.departments.length} groups in the FY{NEP_YEAR} National Expenditure Program,
            measured against the FY{BASE_YEAR} GAA. Sort by any column, or open a group to drill into
            its agencies, programs, funds and line items.
          </p>
        </div>

        <KpiStrip
          items={[
            {
              label: isFiltered ? 'Shown' : `FY${NEP_YEAR} NEP total`,
              value: fmt.shortPhp(shownTotal, 'T'),
              sub: isFiltered
                ? `${depts.length} of ${idx.departments.length} groups`
                : `${idx.national.line_items.toLocaleString()} line items`,
            },
            {
              label: `vs FY${BASE_YEAR} GAA`,
              value: formatPct(pctChange(shownTotal, shownBase)),
              tone: shownTotal >= shownBase ? 'up' : 'down',
              sub: `${shownTotal >= shownBase ? '+' : '−'}${fmt.shortPhp(Math.abs(shownTotal - shownBase), 'B')} on ${fmt.shortPhp(shownBase, 'T')}`,
            },
            {
              label: 'Groups shown',
              value: depts.length,
              sub: hideSynthetic ? 'departments only' : 'incl. SPF and automatic',
            },
            {
              label: 'Largest',
              value: depts[0] ? fmt.shortPhp(depts[0].amount) : '—',
              sub: depts[0]?.description ?? '',
            },
          ]}
        />

        <section className="nep-section">
          <SectionHead
            eyebrow={`Ranking · FY${NEP_YEAR}`}
            headline="All groups"
            dek="Click a group to open its FY2027 detail — agencies, programs, funds, regions and line items."
            right={
              <div className="nep-controls">
                <label className="nep-toggle">
                  <input
                    type="checkbox"
                    checked={hideSynthetic}
                    onChange={(e) => setHideSynthetic(e.target.checked)}
                  />
                  Departments only
                </label>
                <select
                  className="select-input"
                  value={sort}
                  onChange={(e) => {
                    const next = e.target.value as DeptSort;
                    setSort(next);
                    setDir(next === 'description' ? 'asc' : 'desc');
                  }}
                  aria-label="Sort groups"
                >
                  {SORTS.map((s) => (
                    <option key={s.key} value={s.key}>Sort: {s.label}</option>
                  ))}
                </select>
              </div>
            }
          />

          <div className="nep-table-toolbar">
            <input
              className="text-input nep-filter"
              type="search"
              placeholder="Filter groups…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="nep-table-count">
              {depts.length.toLocaleString()} {depts.length === 1 ? 'group' : 'groups'}
              {isFiltered && ` of ${idx.departments.length}`}
            </span>
          </div>

          <div className="nep-table-wrap">
            <table className="nep-table nep-dept-table">
              <thead>
                <tr>
                  {head('description', 'Group', 'nep-th-name')}
                  {head('line_items', 'Line items', 'num')}
                  <th className="num">FY{BASE_YEAR} GAA</th>
                  {head('amount', `FY${NEP_YEAR} NEP`, 'num')}
                  <th className="nep-th-bar" />
                  {head('delta', 'Change', 'num')}
                </tr>
              </thead>
              <tbody>
                {depts.map((d) => (
                  <tr key={d.id}>
                    <td className="nep-td-name">
                      <Link to={`/2027/d/${d.id}`}>{d.description}</Link>
                      <span className="nep-code">{d.id}</span>
                      {isSynthetic(d.id) && <span className="pill nep-pill">derived</span>}
                    </td>
                    <td className="num">{d.line_items.toLocaleString()}</td>
                    <td className="num nep-td-base">{fmt.shortPhp(d.base_amount)}</td>
                    <td className="num nep-td-amt">{fmt.shortPhp(d.amount)}</td>
                    <td className="nep-td-bar"><Bar value={d.amount} max={maxDept} base={d.base_amount} /></td>
                    <td className="num"><Delta amount={d.amount} base={d.base_amount} /></td>
                  </tr>
                ))}
                {!depts.length && (
                  <tr><td colSpan={6} className="nep-empty">No group matches that filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <p className="nep-provenance">
          Served live from D1 · <Link to="/2027">FY{NEP_YEAR} overview</Link> ·{' '}
          <Link to="/2027/search">search line items</Link> ·{' '}
          <Link to="/2027/methodology">field mapping and caveats</Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
