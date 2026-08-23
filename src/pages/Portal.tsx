import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  fetchMidChildren,
  fetchObjectsPage,
  fetchProgramsPage,
  isMidHeavy,
  isObjectsHeavy,
  loadDeptData,
  loadDeptMidInto,
  YEARS,
} from '../lib/dept-data';
import * as fmt from '../lib/format';
import { Eyebrow, SectionHead, Spark } from '../components/shared';
import { SkeletonRows } from '../components/Nep2027Bits';
import ReportView from '../components/ReportView';
import BudgetCycleView from '../components/BudgetCycleView';
import SiteFooter from '../components/SiteFooter';
import SiteHeader from '../components/SiteHeader';
import { buildColumns, buildRow, downloadCsv, filterObjects, objectsToCsv } from '../lib/csv';
import { deptTitle } from '../lib/seo';
import type { ColumnDef, ObjectFilter, RawCell } from '../lib/csv';
import type { DeptData, FPAP, ObjectItem, BaseEntity, MoverEntry } from '../lib/types';

const FALLBACK_YEAR = 2026;

const VIEW_BY_SUFFIX: Record<string, View> = {
  '': 'hierarchy',
  '/': 'hierarchy',
  '/overview': 'hierarchy',
  '/by-year': 'byyear',
  '/programs': 'programs',
  '/budget-cycle': 'cycle',
  '/objects': 'objects',
  '/data': 'data',
  '/report': 'report',
  '/methodology': 'methodology',
};

const SUFFIX_BY_VIEW: Record<View, string> = {
  hierarchy: '/overview',
  byyear: '/by-year',
  programs: '/programs',
  cycle: '/budget-cycle',
  objects: '/objects',
  data: '/data',
  report: '/report',
  methodology: '/methodology',
};

function pathSuffix(pathname: string, deptId: string): string {
  const prefix = `/d/${deptId}`;
  if (pathname === prefix) return '';
  if (pathname.startsWith(prefix + '/')) return pathname.slice(prefix.length);
  return pathname;
}

type View = 'hierarchy' | 'byyear' | 'programs' | 'cycle' | 'objects' | 'data' | 'report' | 'methodology';

interface DownloadButtonProps {
  data: DeptData;
  filter: ObjectFilter;
  filename: string;
  label?: string;
  variant?: 'inline' | 'pill';
  disabled?: boolean;
}

function DownloadCsvButton({
  data,
  filter,
  filename,
  label,
  variant = 'inline',
  disabled,
}: DownloadButtonProps) {
  const matched = useMemo(() => filterObjects(data, filter), [data, filter]);
  const isDisabled = disabled || matched.length === 0;
  const text = label != null ? label : `Download CSV · ${matched.length.toLocaleString()} rows`;
  return (
    <button
      type="button"
      className={`csv-btn csv-btn-${variant}`}
      disabled={isDisabled}
      onClick={() => {
        if (isDisabled) return;
        const csv = objectsToCsv(data, matched);
        downloadCsv(filename, csv);
      }}
    >
      <span className="csv-btn-arrow">↓</span>
      <span>{text}</span>
    </button>
  );
}

function delta(curr: number, prev: number | null | undefined): number | null {
  if (!prev) return null;
  return (curr - prev) / prev;
}
function trendArr(rec: BaseEntity): number[] {
  return YEARS.map((y) => rec.years[y]?.amount || 0);
}
function maxAcrossYears(records: BaseEntity[]): number {
  let m = 0;
  records.forEach((r) =>
    YEARS.forEach((y) => {
      const v = r.years[y]?.amount || 0;
      if (v > m) m = v;
    }),
  );
  return m;
}

/* ---------- KPI strip ---------- */
function KpiStrip({ data, hideOnMobile }: { data: DeptData; hideOnMobile?: boolean }) {
  const totalNow = data.total(2026);
  const totalPrev = data.total(2020);
  const growth = delta(totalNow, totalPrev);
  const yoy = delta(data.total(2026), data.total(2025));
  const peak = Math.max(...YEARS.map((y) => data.total(y)));
  const peakYear = YEARS.find((y) => data.total(y) === peak);

  return (
    <div className={`kpi-strip ${hideOnMobile ? 'kpi-strip-hide-mobile' : ''}`}>
      <div className="kpi-cell">
        <p className="kpi-label">FY 2026 Appropriation</p>
        <p className="kpi-value">{fmt.php(totalNow, { unit: 'B' })}</p>
        <p className={`kpi-sub ${(yoy ?? 0) > 0 ? 'up' : 'down'}`}>{fmt.signedPct(yoy)} vs. 2025</p>
      </div>
      <div className="kpi-cell">
        <p className="kpi-label">7-Year Growth</p>
        <p className="kpi-value">{fmt.signedPct(growth, 0)}</p>
        <p className="kpi-sub">
          {fmt.php(totalPrev, { unit: 'B' })} → {fmt.php(totalNow, { unit: 'B' })}
        </p>
      </div>
      <div className="kpi-cell">
        <p className="kpi-label">Peak Year</p>
        <p className="kpi-value">FY {peakYear}</p>
        <p className="kpi-sub">{fmt.php(peak, { unit: 'B' })}</p>
      </div>
      <div className="kpi-cell">
        <p className="kpi-label">Bureaus Tracked</p>
        <p className="kpi-value">{data.agencies.length}</p>
        <p className="kpi-sub">OSEC · NTC · NPC · CICC</p>
      </div>
    </div>
  );
}

/* ---------- Trend chart ---------- */
function TrendChart({ data, height = 260 }: { data: DeptData; height?: number }) {
  const w = 1000;
  const h = height;
  const pad = { l: 56, r: 24, t: 18, b: 36 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const values = YEARS.map((y) => data.total(y));
  const maxV = Math.max(...values) * 1.1;
  const x = (i: number) => pad.l + (i / (YEARS.length - 1)) * innerW;
  const y = (v: number) => pad.t + innerH - (v / maxV) * innerH;
  const barW = (innerW / YEARS.length) * 0.55;

  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => maxV * t);

  return (
    <div className="trend">
      <div className="trend-title">
        <h2>{data.department.description} · total appropriation, FY 2020 – 2026</h2>
        <span className="meta">SOURCE: GENERAL APPROPRIATIONS ACT · ₱ BILLIONS</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--rule-soft)" strokeWidth="1" />
            <text
              x={pad.l - 8}
              y={y(t) + 4}
              textAnchor="end"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--ink-3)' }}
            >
              {fmt.shortPhp(t, 'B')}
            </text>
          </g>
        ))}
        {values.map((v, i) => (
          <rect
            key={i}
            x={x(i) - barW / 2}
            y={y(v)}
            width={barW}
            height={innerH - (y(v) - pad.t)}
            fill="var(--accent-soft)"
          />
        ))}
        <polyline points={pts} fill="none" stroke="var(--accent-deep)" strokeWidth="2" />
        {values.map((v, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(v)} r={4} fill="var(--accent-deep)" />
            <text
              x={x(i)}
              y={y(v) - 12}
              textAnchor="middle"
              style={{ fontFamily: 'var(--font-hero)', fontSize: 12, fontWeight: 700, fill: 'var(--ink)' }}
            >
              {fmt.shortPhp(v, 'B')}
            </text>
            <text
              x={x(i)}
              y={h - 14}
              textAnchor="middle"
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: 'var(--ink-3)' }}
            >
              {YEARS[i]}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ---------- Expense-class composition stack ---------- */
function ExpenseClassStack({ data, year }: { data: DeptData; year: number }) {
  const breakdown = data.expenseClassByYear[year];
  const total = breakdown.PS + breakdown.MOOE + breakdown.CO + breakdown.FE;
  if (!total) return null;
  const cells = [
    { key: 'PS', label: 'Personnel', color: 'var(--ec-ps)', value: breakdown.PS },
    { key: 'MOOE', label: 'Operating', color: 'var(--ec-mooe)', value: breakdown.MOOE },
    { key: 'CO', label: 'Capital Outlays', color: 'var(--ec-co)', value: breakdown.CO },
    { key: 'FE', label: 'Financial', color: 'var(--ec-fe)', value: breakdown.FE },
  ].filter((c) => c.value > 0);
  return (
    <div>
      <div className="ec-stack">
        {cells.map((c) => {
          const p = c.value / total;
          return (
            <div
              key={c.key}
              style={{ width: `${p * 100}%`, background: c.color }}
              title={`${c.label}: ${fmt.php(c.value, { unit: 'B' })} (${fmt.pct(p, 0)})`}
            >
              {p > 0.06 ? `${c.label.toUpperCase()} ${fmt.pct(p, 0)}` : ''}
            </div>
          );
        })}
      </div>
      <div className="ec-legend">
        {cells.map((c) => (
          <span key={c.key}>
            <span className="swatch" style={{ background: c.color }}></span>
            {c.label} · {fmt.php(c.value, { unit: 'B' })} ({fmt.pct(c.value / total, 0)})
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- Hierarchy row ---------- */
function HierarchyRow({
  rec,
  year,
  max,
  prevYear,
  onClick,
  drillable,
  label,
}: {
  rec: BaseEntity;
  year: number;
  max: number;
  prevYear: number | null;
  onClick?: () => void;
  drillable: boolean;
  label?: string;
}) {
  const v = rec.years[year]?.amount || 0;
  const prev = prevYear ? rec.years[prevYear]?.amount || 0 : null;
  const d = prev != null ? delta(v, prev) : null;
  const p = max ? v / max : 0;

  return (
    <tr className={drillable ? '' : 'disabled'} onClick={drillable ? onClick : undefined}>
      <td className="name">
        <span>{rec.description}</span>
        {label && <span className="desc">{label}</span>}
      </td>
      <td className="bar-cell">
        <div className="bar-h accent">
          <span style={{ width: `${p * 100}%` }}></span>
        </div>
      </td>
      <td className="num">{fmt.php(v, { unit: v >= 1e9 ? 'B' : 'M' })}</td>
      <td className="num">
        {d == null ? (
          <span className="delta">—</span>
        ) : (
          <span className={`delta ${d > 0 ? 'up' : 'down'}`}>{fmt.signedPct(d, 0)}</span>
        )}
      </td>
      <td className="spark-cell">
        <Spark values={trendArr(rec)} w={88} h={22} color="var(--ink-2)" />
      </td>
      {drillable && <td className="chev">›</td>}
    </tr>
  );
}

/* ---------- Year strip (prominent, used across year-aware views) ---------- */
function YearStrip({
  data,
  year,
  setYear,
}: {
  data: DeptData;
  year: number;
  setYear: (y: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const peak = Math.max(...YEARS.map((y) => data.total(y)));

  function pickYear(y: number) {
    setYear(y);
    const el = wrapRef.current;
    if (!el) return;
    const masthead = document.querySelector('.masthead') as HTMLElement | null;
    const offset = (masthead?.offsetHeight ?? 0) + 12;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: 'smooth' });
  }

  return (
    <div ref={wrapRef} className="year-strip-wrap">
      <p className="eyebrow">Pick a fiscal year</p>
      <div className="year-strip" role="tablist" aria-label="Fiscal year">
        {YEARS.map((y) => {
          const v = data.total(y);
          const p = peak ? (v / peak) * 100 : 0;
          const active = y === year;
          return (
            <button
              key={y}
              type="button"
              role="tab"
              aria-selected={active}
              className={`year-cell ${active ? 'active' : ''}`}
              onClick={() => pickYear(y)}
            >
              <div className="year-cell-num">FY {y}</div>
              <div className="year-cell-meta">{fmt.shortPhp(v, 'B')} GAA</div>
              <div className="year-cell-bar">
                <span style={{ width: `${p}%` }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Hierarchy view ---------- */
type PathEntry = { level: 'agency' | 'fpap' | 'opUnit' | 'fund'; id: string; label: string };

function HierarchyView({
  data,
  year,
  setYear,
  midState,
  midError,
  onRequestMid,
  deptId,
  onDepthChange,
}: {
  data: DeptData;
  year: number;
  setYear: (y: number) => void;
  midState: StageState;
  midError: string | null;
  onRequestMid: () => void;
  deptId: string;
  onDepthChange: (depth: number) => void;
}) {
  const [path, setPath] = useState<PathEntry[]>([]);
  const drillBarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onDepthChange(path.length);
    if (path.length === 0) return;
    if (!window.matchMedia('(max-width: 720px)').matches) return;

    const id = window.setTimeout(() => {
      const target = drillBarRef.current;
      if (!target) return;
      const masthead = document.querySelector('.masthead') as HTMLElement | null;
      const offset = (masthead?.offsetHeight ?? 0) + 8;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, 0);
    return () => window.clearTimeout(id);
  }, [onDepthChange, path.length]);
  // If user is mid-drill but Stage B data hasn't loaded yet, surface a loader.
  const needsMid = path.length > 0 && !data.midLoaded;

  const current = path[path.length - 1];

  // Interactive Stage B (the four departments whose bulk dump the Worker
  // refuses to serve): children for the current drill node come from D1 per
  // interaction, cached per (level, parent, year). Absence of a cache entry
  // doubles as the loading state so no setState runs synchronously in the
  // effect. Everything downstream works off `records` exactly as bulk mode.
  const interactive = data.midMode === 'interactive';
  const remoteKey = current ? `${current.level}|${current.id}|${year}` : '';
  const [remoteChildren, setRemoteChildren] = useState<
    Record<string, { records: BaseEntity[]; cursor: string | null; total: number }>
  >({});
  useEffect(() => {
    if (!interactive || !remoteKey || remoteChildren[remoteKey]) return;
    const lvl = remoteKey.split('|', 1)[0];
    const parent = remoteKey.slice(lvl.length + 1, remoteKey.lastIndexOf('|'));
    const table =
      lvl === 'agency' ? 'fpaps'
      : lvl === 'fpap' ? 'operating_units'
      : lvl === 'opUnit' ? 'fund_subcategories'
      : 'expenses';
    let live = true;
    const t = setTimeout(() => {
      fetchMidChildren(deptId, table, parent, year)
        .then((r) => {
          if (live) setRemoteChildren((m) => ({ ...m, [remoteKey]: { records: r.records, cursor: r.cursor, total: r.total } }));
        })
        .catch(() => {
          if (live) setRemoteChildren((m) => ({ ...m, [remoteKey]: { records: [], cursor: null, total: 0 } }));
        });
    }, 0);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, remoteKey, deptId, year]);
  const remoteEntry = interactive && current ? remoteChildren[remoteKey] : undefined;
  const childrenLoading = interactive && !!current && !remoteEntry;
  const loadMoreChildren = () => {
    if (!current || !remoteEntry?.cursor) return;
    const lvl = current.level;
    const table =
      lvl === 'agency' ? 'fpaps'
      : lvl === 'fpap' ? 'operating_units'
      : lvl === 'opUnit' ? 'fund_subcategories'
      : 'expenses';
    fetchMidChildren(deptId, table, current.id, year, remoteEntry.cursor).then((r) => {
      setRemoteChildren((m) => {
        const cur = m[remoteKey];
        if (!cur) return m;
        return { ...m, [remoteKey]: { records: [...cur.records, ...r.records], cursor: r.cursor, total: r.total } };
      });
    });
  };

  let level: 'agency' | 'fpap' | 'opUnit' | 'fund' | 'expense' = 'agency';
  let records: BaseEntity[] = [];
  let drillable = true;
  let parentLabel = '';
  let levelTitle = '';

  if (!current) {
    level = 'agency';
    records = data.agencies;
    drillable = true;
    parentLabel = 'Department of Information and Communications Technology';
    levelTitle = 'Bureaus';
  } else if (current.level === 'agency') {
    level = 'fpap';
    records = (data.fpapsByAgency[current.id] || [])
      .slice()
      .sort((a, b) => (b.years[year]?.amount || 0) - (a.years[year]?.amount || 0));
    drillable = true;
    parentLabel = current.label;
    levelTitle = 'Programs (FPAPs)';
  } else if (current.level === 'fpap') {
    const fpapId = current.id;
    level = 'opUnit';
    records = data.opUnits
      .filter((o) => o.fpap_id === fpapId)
      .sort((a, b) => (b.years[year]?.amount || 0) - (a.years[year]?.amount || 0));
    drillable = true;
    parentLabel = current.label;
    levelTitle = 'Operating Units';
  } else if (current.level === 'opUnit') {
    const ouId = current.id;
    level = 'fund';
    records = data.funds
      .filter((f) => f.operating_unit_id === ouId)
      .sort((a, b) => (b.years[year]?.amount || 0) - (a.years[year]?.amount || 0));
    drillable = true;
    parentLabel = current.label;
    levelTitle = 'Funds';
  } else if (current.level === 'fund') {
    const fundId = current.id;
    level = 'expense';
    records = data.expenses
      .filter((e) => e.fund_id === fundId)
      .sort((a, b) => (b.years[year]?.amount || 0) - (a.years[year]?.amount || 0));
    drillable = false;
    parentLabel = current.label;
    levelTitle = 'Expense Classes';
  }

  if (interactive && current) {
    records = remoteEntry?.records ?? [];
  }

  const max = maxAcrossYears(records);
  const prevYear = year > YEARS[0] ? year - 1 : null;

  function drill(rec: BaseEntity) {
    if (level === 'expense') return;
    if (level === 'agency' && !data.midLoaded && midState === 'idle') {
      onRequestMid();
    }
    setPath([...path, { level, id: rec.id, label: rec.description }]);
  }
  function jump(idx: number) {
    if (idx < 0) setPath([]);
    else setPath(path.slice(0, idx + 1));
  }
  function back() {
    setPath((prev) => prev.slice(0, -1));
  }

  // Build a CSV filter that matches the deepest entry in `path`,
  // so a download from this branch only includes its line items.
  const csvFilter: ObjectFilter = (() => {
    const f: ObjectFilter = {};
    for (const p of path) {
      if (p.level === 'agency') f.agencyId = p.id;
      else if (p.level === 'fpap') f.fpapId = p.id;
      else if (p.level === 'opUnit') f.operatingUnitId = p.id;
      else if (p.level === 'fund') f.fundId = p.id;
    }
    return f;
  })();
  const deptSlug = data.department.description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const csvLabel =
    path.length === 0 ? `${data.department.description} (all bureaus)` : path[path.length - 1].label;
  const csvFilename =
    path.length === 0
      ? `gaa-${data.department.id}-${deptSlug}-fy2020-2026.csv`
      : `gaa-${data.department.id}-${path[path.length - 1].label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}.csv`;

  return (
    <div className={`hierarchy-view ${path.length > 0 ? 'hierarchy-view-drilled' : ''}`}>
      <YearStrip data={data} year={year} setYear={setYear} />

      <div className="hierarchy-view-label" style={{ marginBottom: 14, marginTop: 28 }}>
        <Eyebrow>Hierarchy · drill from department to expense class</Eyebrow>
      </div>

      <div ref={drillBarRef} className="drill-mobile-bar" aria-label="Current drilldown level">
        <button type="button" onClick={back} disabled={path.length === 0}>
          ← Back
        </button>
        <div>
          <span>{levelTitle}</span>
          <strong>{path.length === 0 ? data.department.description : path[path.length - 1].label}</strong>
        </div>
        <em>{records.length.toLocaleString()}</em>
      </div>

      <div className="crumbs">
        <button onClick={() => jump(-1)}>{data.department.description}</button>
        {path.map((p, i) => (
          <Fragment key={i}>
            <span className="sep">›</span>
            <button onClick={() => jump(i)}>{p.label}</button>
          </Fragment>
        ))}
        <span className="sep">›</span>
        <span className="current">{levelTitle}</span>
        <span className="crumb-download">
          <DownloadCsvButton
            data={data}
            filter={csvFilter}
            filename={csvFilename}
            label={`Download line items · ${csvLabel}`}
            variant="pill"
          />
        </span>
      </div>

      {needsMid ? (
        <StageLoader
          stage="mid"
          state={midState}
          error={midError}
          deptId={deptId}
          onLoad={midState === 'idle' ? onRequestMid : undefined}
        />
      ) : (
        <>
          <table className="hier-table drill-table">
            <thead>
              <tr>
                <th>{levelTitle.toUpperCase()}</th>
                <th>SHARE OF MAX</th>
                <th className="right">FY {year}</th>
                <th className="right">YoY</th>
                <th>2020 — 2026</th>
                {(level === 'agency' || level === 'fpap' || level === 'opUnit' || level === 'fund') && <th></th>}
              </tr>
            </thead>
            <tbody>
              {childrenLoading && <SkeletonRows cols={6} />}
              {records.length === 0 && !childrenLoading && (
                <tr className="disabled">
                  <td
                    colSpan={6}
                    style={{
                      padding: 24,
                      textAlign: 'center',
                      color: 'var(--ink-3)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                    }}
                  >
                    No line items at this level for {parentLabel}.
                  </td>
                </tr>
              )}
              {records.map((rec) => {
                const labelExtra =
                  (rec as FPAP).fpap_code !== undefined
                    ? (rec as FPAP).fpap_code
                    : (rec as { expense_code?: string }).expense_code;
                return (
                  <HierarchyRow
                    key={rec.id}
                    rec={rec}
                    year={year}
                    max={max}
                    prevYear={prevYear}
                    onClick={() => drill(rec)}
                    drillable={drillable}
                    label={labelExtra}
                  />
                );
              })}
            </tbody>
          </table>

          {interactive && remoteEntry?.cursor && (
            <button
              type="button"
              className="csv-btn"
              style={{ marginTop: 12 }}
              onClick={loadMoreChildren}
            >
              Show more · {records.length.toLocaleString()} of {remoteEntry.total.toLocaleString()} loaded
            </button>
          )}

          {level === 'expense' && (
            <p className="note-block" style={{ marginTop: 24, borderTop: '1px solid var(--rule)', paddingTop: 18 }}>
              <strong>Why no further drill-down?</strong> Below expense class, the data goes to <em>Object</em>{' '}
              (UACS line items like “Travelling Expenses — Local”). The Philippine UACS catalog was recoded several
              times between FY 2020 and FY 2026, so individual object codes do not align across years and are not
              safe to chart longitudinally. Use the <strong>Programs</strong> tab for cross-year analysis.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Treemap ---------- */
interface TreemapTile {
  id: string;
  name: string;
  agency: string;
  agency_id: string;
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TreemapItem {
  id: string;
  name: string;
  agency: string;
  agency_id: string;
  value: number;
}

function Treemap({
  data,
  year,
  height = 480,
  overrideItems,
}: {
  data: DeptData;
  year: number;
  height?: number;
  /** Interactive departments keep data.fpaps empty; the caller supplies the
      top program families fetched from D1 instead. */
  overrideItems?: TreemapItem[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1000);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((es) => {
      for (const e of es) setW(e.contentRect.width);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const items: TreemapItem[] = (
    overrideItems ??
    data.fpaps.map((f) => ({
      id: f.id,
      name: f.description,
      agency: data.agencyById[f.agency_id]?.description || '—',
      agency_id: f.agency_id,
      value: f.years[year]?.amount || 0,
    }))
  )
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value);

  const tiles: TreemapTile[] = [];

  const colorFor = (aid: string) => {
    const idx = data.agencies.findIndex((a) => a.id === aid);
    const palette = ['var(--accent-deep)', '#5a7d2a', '#8c4a1f', '#3a5a7a'];
    return palette[idx % palette.length];
  };

  let remaining = items.slice();
  const H = height;
  const W = w;
  let cur = { x: 0, y: 0, w: W, h: H };
  while (remaining.length > 0) {
    const remTotal = remaining.reduce((s, i) => s + i.value, 0);
    if (!remTotal) break;
    const horizontal = cur.w >= cur.h;
    let row: typeof remaining = [];
    let rowSum = 0;
    let bestRatio = Infinity;
    let i = 0;
    while (i < remaining.length) {
      const next = remaining[i];
      const trial = [...row, next];
      const trialSum = rowSum + next.value;
      const rowArea = (trialSum / remTotal) * (cur.w * cur.h);
      const rowH = horizontal ? rowArea / cur.w : rowArea / cur.h;
      const ratios = trial.map((it) => {
        const itArea = (it.value / trialSum) * rowArea;
        const itLen = horizontal ? itArea / rowH : itArea / rowH;
        const longSide = Math.max(itLen, rowH);
        const shortSide = Math.min(itLen, rowH);
        return longSide / Math.max(shortSide, 0.0001);
      });
      const worst = Math.max(...ratios);
      if (worst <= bestRatio) {
        bestRatio = worst;
        row = trial;
        rowSum = trialSum;
        i++;
      } else {
        break;
      }
    }
    if (row.length === 0) {
      row = [remaining[0]];
      rowSum = remaining[0].value;
    }
    const rowArea = (rowSum / remTotal) * (cur.w * cur.h);
    const rowDim = horizontal ? rowArea / cur.w : rowArea / cur.h;
    let off = 0;
    row.forEach((it) => {
      const itArea = (it.value / rowSum) * rowArea;
      const itLen = horizontal ? itArea / rowDim : itArea / rowDim;
      if (horizontal) {
        tiles.push({ ...it, x: cur.x + off, y: cur.y, w: itLen, h: rowDim });
      } else {
        tiles.push({ ...it, x: cur.x, y: cur.y + off, w: rowDim, h: itLen });
      }
      off += itLen;
    });
    if (horizontal) {
      cur = { x: cur.x, y: cur.y + rowDim, w: cur.w, h: cur.h - rowDim };
    } else {
      cur = { x: cur.x + rowDim, y: cur.y, w: cur.w - rowDim, h: cur.h };
    }
    remaining = remaining.slice(row.length);
    if (cur.w <= 0.5 || cur.h <= 0.5) break;
  }

  return (
    <div ref={wrapRef} className="treemap" style={{ height }}>
      {tiles.map((t) => (
        <div
          key={t.id}
          className="treemap-cell"
          style={{
            left: t.x,
            top: t.y,
            width: t.w,
            height: t.h,
            background: colorFor(t.agency_id),
            fontSize: t.w > 200 && t.h > 80 ? 13 : 11,
          }}
          title={`${t.name} · ${t.agency} · ${fmt.php(t.value, { unit: 'B' })}`}
        >
          {t.w > 60 && t.h > 28 && (
            <>
              <div className="tm-name">{t.name}</div>
              <div className="tm-amount">{fmt.php(t.value, { unit: t.value >= 1e9 ? 'B' : 'M' })}</div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- Programs view ---------- */
function ProgramsView({
  data,
  year,
  setYear,
}: {
  data: DeptData;
  year: number;
  setYear: (y: number) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get('q') || '');
  const [agency, setAgency] = useState(() => searchParams.get('agency') || 'all');

  // Reflect filter state back into the URL so the page is shareable.
  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (agency !== 'all') next.set('agency', agency);
    setSearchParams(next, { replace: true });
  }, [q, agency, setSearchParams]);

  const rows = useMemo(() => {
    return data.fpapFamilies
      .filter((f) => agency === 'all' || f.agency_id === agency)
      .filter((f) => !q || f.name.toLowerCase().includes(q.toLowerCase()))
      .map((f) => {
        const v = f.years[year]?.amount || 0;
        const total = YEARS.reduce((s, y) => s + (f.years[y]?.amount || 0), 0);
        return { f, v, total };
      })
      // Sort by the active year's amount descending; fall back to 7-year total
      // so programs that don't appear in the selected year still rank stably.
      .sort((a, b) => b.v - a.v || b.total - a.total);
  }, [data, year, q, agency]);

  // Server mode: DPWH's 149k program families cannot ship inline, so the
  // list pages from D1 with the same filters (year sort, bureau, search).
  // Every other department keeps the local path above. The result is keyed
  // by its filters so a stale response never renders under fresh ones.
  const paginated = !!data.programsPaginated;
  const serverKey = `${data.department.id}|${year}|${agency}|${q}`;
  const [serverRows, setServerRows] = useState<{
    key: string;
    families: DeptData['fpapFamilies'];
    cursor: string | null;
    total: number;
  } | null>(null);
  useEffect(() => {
    if (!paginated) return;
    let live = true;
    const t = setTimeout(() => {
      fetchProgramsPage(data.department.id, { year, q: q || undefined, bureau: agency, limit: 100 })
        .then((r) => {
          if (live) setServerRows({ key: serverKey, families: r.families, cursor: r.cursor, total: r.total });
        })
        .catch(() => {
          if (live) setServerRows({ key: serverKey, families: [], cursor: null, total: 0 });
        });
    }, q ? 300 : 0);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paginated, serverKey]);
  const serverFresh = serverRows && serverRows.key === serverKey ? serverRows : null;
  const serverLoading = paginated && !serverFresh;
  const loadMorePrograms = () => {
    if (!serverFresh?.cursor) return;
    fetchProgramsPage(data.department.id, {
      year, q: q || undefined, bureau: agency, cursor: serverFresh.cursor, limit: 100,
    }).then((r) => {
      setServerRows((prev) =>
        prev && prev.key === serverKey
          ? { ...prev, families: [...prev.families, ...r.families], cursor: r.cursor }
          : prev,
      );
    });
  };
  const shownRows = paginated
    ? (serverFresh?.families ?? []).map((f) => ({
        f,
        v: f.years[year]?.amount || 0,
        total: YEARS.reduce((s, y) => s + (f.years[y]?.amount || 0), 0),
      }))
    : rows;

  return (
    <div>
      <YearStrip data={data} year={year} setYear={setYear} />

      <div
        className="flex between items-center"
        style={{ marginBottom: 14, marginTop: 28, gap: 16 }}
      >
        <Eyebrow>Programs · merged across renames · 7-year view</Eyebrow>
        <select
          value={agency}
          onChange={(e) => setAgency(e.target.value)}
          style={{
            border: '1px solid var(--ink)',
            padding: '7px 10px',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            background: 'var(--paper)',
            color: 'var(--ink)',
          }}
        >
          <option value="all">All bureaus</option>
          {data.agencies.map((a) => (
            <option key={a.id} value={a.id}>
              {a.description}
            </option>
          ))}
        </select>
      </div>

      <input
        className="search-box"
        placeholder="Search programs (e.g. Internet, Cybersecurity, Smart City)…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <table className="hier-table" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>PROGRAM</th>
            <th>BUREAU</th>
            <th className="right">FY {year}</th>
            <th className="right">7-YEAR TOTAL</th>
            <th>2020 — 2026</th>
          </tr>
        </thead>
        <tbody>
          {serverLoading && <SkeletonRows cols={5} />}
          {(paginated ? shownRows : shownRows.slice(0, 60)).map((r) => (
            <tr key={r.f.key} className="disabled">
              <td className="name">
                <span>{r.f.name}</span>
                {r.f.ids.length > 1 && (
                  <span className="desc">{r.f.ids.length} program codes (renames)</span>
                )}
              </td>
              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
                {(data.agencyById[r.f.agency_id]?.description || '')
                  .replace('National Telecommunications Commission', 'NTC')
                  .replace('National Privacy Commission', 'NPC')
                  .replace('Cybercrime Investigation and Coordination Center', 'CICC')
                  .replace('Office of the Secretary', 'OSEC')}
              </td>
              <td className="num">{fmt.php(r.v, { unit: r.v >= 1e9 ? 'B' : 'M' })}</td>
              <td className="num">{fmt.php(r.total, { unit: 'B' })}</td>
              <td className="spark-cell">
                <Spark
                  values={YEARS.map((y) => r.f.years[y]?.amount || 0)}
                  w={120}
                  h={22}
                  color="var(--accent-deep)"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {paginated && serverFresh && (
        <p style={{ marginTop: 12, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
          Showing {shownRows.length.toLocaleString()} of {serverFresh.total.toLocaleString()} programs.
          {serverFresh.cursor && (
            <button type="button" className="csv-btn" style={{ marginLeft: 12 }} onClick={loadMorePrograms}>
              Show more
            </button>
          )}
        </p>
      )}
      {!paginated && rows.length > 60 && (
        <p style={{ marginTop: 12, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)' }}>
          Showing top 60 of {rows.length}. Refine your search to see more.
        </p>
      )}
    </div>
  );
}

/* ---------- Methodology view ---------- */
function MethodologyView({ data }: { data: DeptData }) {
  return (
    <div style={{ maxWidth: 760, fontSize: 14.5, lineHeight: 1.7 }}>
      <SectionHead
        eyebrow="Methodology"
        headline="What this view does — and what it carefully avoids"
      />

      <h3 style={{ fontFamily: 'var(--font-hero)', fontSize: 17, marginTop: 22, marginBottom: 8 }}>Source</h3>
      <p style={{ color: 'var(--ink-2)' }}>
        Every figure on this view is parsed directly from the Philippines’{' '}
        <strong>General Appropriations Act</strong> for fiscal years 2020 through 2026, restricted to{' '}
        <strong>Department {data.department.id} — {data.department.description}</strong>. The GAA is the budget law
        passed by Congress; it does not measure obligations or disbursements, only the legal authority to spend.
        See the global <a href="/methodology" style={{ color: 'var(--accent)' }}>Methodology</a> page for the
        full set of caveats that apply across all 40 departments.
      </p>

      <h3 style={{ fontFamily: 'var(--font-hero)', fontSize: 17, marginTop: 22, marginBottom: 8 }}>Units</h3>
      <p style={{ color: 'var(--ink-2)' }}>
        The source data is denominated in <strong>thousands of pesos</strong>. We multiply by 1,000 at load time
        so every number you see on this site is in <strong>full pesos</strong>; the formatter then renders ₱B /
        ₱M / ₱K for legibility. A figure shown as “₱18.2B” means ₱18.2 billion, not ₱18.2 trillion.
      </p>

      <h3 style={{ fontFamily: 'var(--font-hero)', fontSize: 17, marginTop: 22, marginBottom: 8 }}>
        The hierarchy, and why drill-down stops at expense class
      </h3>
      <p style={{ color: 'var(--ink-2)' }}>
        Every appropriation line lives in a strict 7-level tree: Department → Agency → Program (FPAP) →
        Operating Unit → Fund → Expense Class → Object. The first six levels are stable enough to compare across
        years. The seventh — <strong>Object</strong> — is governed by the Unified Account Code Structure (UACS)
        catalog, which the DBM revised mid-period; identical line items appear under different codes in
        different years. We expose object-level values inside a single year only.
      </p>

      <h3 style={{ fontFamily: 'var(--font-hero)', fontSize: 17, marginTop: 22, marginBottom: 8 }}>Program renames</h3>
      <p style={{ color: 'var(--ink-2)' }}>
        At least a dozen significant programs were renamed or restructured across the 7 years. A naive chart
        shows them flatlining at ₱0 then jumping to ₱5B the next year — visually misleading. The{' '}
        <strong>Programs</strong> tab merges programs by <em>normalised name within bureau</em>, producing a
        continuous series wherever rename was clean. Renames that also moved between bureaus, or split a program
        in two, remain split.
      </p>

      <h3 style={{ fontFamily: 'var(--font-hero)', fontSize: 17, marginTop: 22, marginBottom: 8 }}>Aggregation</h3>
      <p style={{ color: 'var(--ink-2)' }}>
        Roll-ups (Department total, Agency totals, etc.) are recomputed from line items. The published totals
        from the GAA agree to within rounding — small residuals exist because the GAA introduces sub-totals at
        multiple levels (e.g. tax expenditure subsidies) which we deduplicate.
      </p>

      <h3 style={{ fontFamily: 'var(--font-hero)', fontSize: 17, marginTop: 22, marginBottom: 8 }}>
        What “count” means
      </h3>
      <p style={{ color: 'var(--ink-2)' }}>
        “Count” throughout this portal refers to <strong>budget line items</strong>, not projects or contracts.
        A single program can have hundreds of line items because it’s split across object codes, funds, and
        operating units.
      </p>
    </div>
  );
}

/* ---------- By year view ---------- */
function ByYearView({
  data,
  year,
  setYear,
}: {
  data: DeptData;
  year: number;
  setYear: (y: number) => void;
}) {
  const items = data.agencies
    .map((a) => ({ a, v: a.years[year]?.amount || 0 }))
    .sort((x, z) => z.v - x.v);
  const max = Math.max(...items.map((i) => i.v));

  // Interactive departments keep the entity arrays empty, so the treemap's
  // programs come from D1: the top families for the selected year. Inline
  // departments already carry fpapFamilies; only the paginated one fetches.
  const interactive = data.midMode === 'interactive';
  const treemapKey = `${data.department.id}|${year}`;
  const [treemapFetch, setTreemapFetch] = useState<{ key: string; items: TreemapItem[] } | null>(null);
  useEffect(() => {
    if (!interactive || !data.programsPaginated) return;
    let live = true;
    const t = setTimeout(() => {
      fetchProgramsPage(data.department.id, { year, limit: 150 })
        .then((r) => {
          if (!live) return;
          setTreemapFetch({
            key: treemapKey,
            items: r.families.map((f) => ({
              id: f.key,
              name: f.name,
              agency: data.agencyById[f.agency_id]?.description || '—',
              agency_id: f.agency_id,
              value: f.years[year]?.amount || 0,
            })),
          });
        })
        .catch(() => { if (live) setTreemapFetch({ key: treemapKey, items: [] }); });
    }, 0);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, treemapKey]);
  const treemapOverride: TreemapItem[] | undefined = !interactive
    ? undefined
    : data.programsPaginated
      ? (treemapFetch && treemapFetch.key === treemapKey ? treemapFetch.items : [])
      : data.fpapFamilies.map((f) => ({
          id: f.key,
          name: f.name,
          agency: data.agencyById[f.agency_id]?.description || '—',
          agency_id: f.agency_id,
          value: f.years[year]?.amount || 0,
        }));

  return (
    <div>
      <YearStrip data={data} year={year} setYear={setYear} />

      <div style={{ marginBottom: 14, marginTop: 28 }}>
        <Eyebrow>FY {year} · the budget at a single moment</Eyebrow>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 28 }}>
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">By bureau</h3>
            <span className="card-meta">{fmt.php(data.total(year), { unit: 'B' })}</span>
          </div>
          <table className="hier-table">
            <tbody>
              {items.map(({ a, v }) => (
                <tr key={a.id} className="disabled">
                  <td className="name" style={{ maxWidth: 220 }}>
                    {a.description}
                  </td>
                  <td className="bar-cell">
                    <div className="bar-h accent">
                      <span style={{ width: `${(v / max) * 100}%` }}></span>
                    </div>
                  </td>
                  <td className="num">{fmt.php(v, { unit: v >= 1e9 ? 'B' : 'M' })}</td>
                  <td className="num delta">{fmt.pct(v / data.total(year), 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-head">
            <h3 className="card-title">By expense class</h3>
            <span className="card-meta">FY {year}</span>
          </div>
          <ExpenseClassStack data={data} year={year} />
          <p
            style={{
              marginTop: 16,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--ink-3)',
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: 'var(--ink)' }}>PS</strong>: salaries and benefits.{' '}
            <strong style={{ color: 'var(--ink)' }}>MOOE</strong>: internet subscriptions, training, contract
            services.&nbsp;
            <strong style={{ color: 'var(--ink)' }}>CO</strong>: hardware, network builds, IT infrastructure.{' '}
            <strong style={{ color: 'var(--ink)' }}>FE</strong>: loan-related interest and charges.
          </p>
        </div>
      </div>

      <SectionHead
        eyebrow={`The FY ${year} treemap`}
        headline={`Where the ₱${fmt.shortPhp(data.total(year), 'B').replace('B', '')}B goes — every program at scale`}
        dek={`Each rectangle is a program (FPAP) — area is proportional to FY ${year} appropriation. Hover for exact figures. Color = bureau.`}
      />
      <Treemap data={data} year={year} height={520} overrideItems={treemapOverride} />

      <div className="grid grid-2" style={{ marginTop: 28 }}>
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">
              Biggest jumps · {year - 1} → {year}
            </h3>
          </div>
          <table className="hier-table">
            <tbody>
              {data.topMovers('up', year, year - 1, 6).length === 0 && (
                <tr className="disabled">
                  <td className="name" style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                    No programs grew — every program shrank or held this year.
                  </td>
                </tr>
              )}
              {data.topMovers('up', year, year - 1, 6).map(({ fam, delta }: MoverEntry) => (
                <tr key={fam.key} className="disabled">
                  <td className="name">{fam.name}</td>
                  <td className="num" style={{ color: 'var(--positive)' }}>
                    +{fmt.php(delta, { unit: delta >= 1e9 ? 'B' : 'M' })}
                  </td>
                  <td className="spark-cell">
                    <Spark
                      values={YEARS.map((y) => fam.years[y]?.amount || 0)}
                      w={88}
                      h={22}
                      color="var(--positive)"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">
              Biggest cuts · {year - 1} → {year}
            </h3>
          </div>
          <table className="hier-table">
            <tbody>
              {data.topMovers('down', year, year - 1, 6).length === 0 && (
                <tr className="disabled">
                  <td className="name" style={{ color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                    No programs were cut — every program grew or held this year.
                  </td>
                </tr>
              )}
              {data.topMovers('down', year, year - 1, 6).map(({ fam, delta }: MoverEntry) => (
                <tr key={fam.key} className="disabled">
                  <td className="name">{fam.name}</td>
                  <td className="num" style={{ color: 'var(--negative)' }}>
                    {fmt.php(delta, { unit: Math.abs(delta) >= 1e9 ? 'B' : 'M' })}
                  </td>
                  <td className="spark-cell">
                    <Spark
                      values={YEARS.map((y) => fam.years[y]?.amount || 0)}
                      w={88}
                      h={22}
                      color="var(--negative)"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ---------- Object Detail ---------- */
function ObjectDetail({
  obj,
  fpap,
  opUnit,
  fund,
  expense,
  agency,
  dept,
}: {
  obj: ObjectItem;
  fpap?: FPAP;
  opUnit?: { description: string };
  fund?: { description: string };
  expense?: { description: string };
  agency?: { description: string };
  dept: { id: string; description: string };
}) {
  const yearsPresent = YEARS.filter((y) => obj.years[y] && obj.years[y].amount);
  const maxAmt = yearsPresent.length > 0 ? Math.max(...yearsPresent.map((y) => obj.years[y].amount)) : 0;

  return (
    <div className="object-detail-inner">
      <div className="breadcrumb">
        <span className="bc-label">Where this lives</span>
        <ol>
          <li>
            <span className="bc-tier">Department</span>
            <span className="bc-name">{dept.description} ({dept.id})</span>
          </li>
          <li>
            <span className="bc-tier">Bureau</span>
            <span className="bc-name">{agency?.description || '—'}</span>
          </li>
          <li>
            <span className="bc-tier">Program</span>
            <span className="bc-name">{fpap?.description || '—'}</span>
          </li>
          <li>
            <span className="bc-tier">Operating Unit</span>
            <span className="bc-name">{opUnit?.description || '—'}</span>
          </li>
          <li>
            <span className="bc-tier">Fund</span>
            <span className="bc-name">{fund?.description || '—'}</span>
          </li>
          <li>
            <span className="bc-tier">Expense Class</span>
            <span className="bc-name">{expense?.description || '—'}</span>
          </li>
          <li>
            <span className="bc-tier">Object</span>
            <span className="bc-name strong">{obj.description}</span>
          </li>
        </ol>
      </div>

      <div className="bc-yearchart">
        <p className="bc-label">By year (this exact UACS code)</p>
        <table className="bc-yeartable">
          <tbody>
            {YEARS.map((y) => {
              const amt = obj.years[y]?.amount || 0;
              const p = maxAmt > 0 ? (amt / maxAmt) * 100 : 0;
              return (
                <tr key={y} className={amt ? '' : 'missing'}>
                  <td className="yc-year mono">{y}</td>
                  <td className="yc-bar">
                    <span style={{ width: `${p}%` }}></span>
                  </td>
                  <td className="yc-amt num">
                    {amt ? (
                      fmt.php(amt, { unit: amt >= 1e9 ? 'B' : amt >= 1e6 ? 'M' : 'K' })
                    ) : (
                      <span className="missing-label">not in GAA</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="bc-uacs">
          <span>UACS code</span> <code>{obj.object_code}</code>
        </p>
      </div>
    </div>
  );
}

/* ---------- Objects view ---------- */
const ROWS_PER_PAGE = 50;

/**
 * Browser-driven CSV download — builds the same /api/dept/:id/objects/csv
 * URL the Worker streams, then clicks it as an `<a download>`. No JS in
 * the middle, so even DepEd's million rows download without spiking
 * client memory.
 */
function ObjectsCsvLink({
  deptId,
  year,
  bureau,
  expense,
  q,
  rowCount,
}: {
  deptId: string;
  year: number;
  bureau: string;
  expense: string;
  q: string;
  rowCount: number;
}) {
  const params = new URLSearchParams();
  params.set('year', String(year));
  if (bureau !== 'all') params.set('bureau', bureau);
  if (expense !== 'all') params.set('expense', expense);
  if (q) params.set('q', q);
  const href = `/api/dept/${deptId}/objects/csv?${params.toString()}`;
  const disabled = rowCount === 0;
  const label =
    rowCount > 0
      ? `Download CSV · ${rowCount.toLocaleString()} rows`
      : 'Download CSV';
  return (
    <a
      className={`csv-btn csv-btn-pill${disabled ? ' csv-btn-disabled' : ''}`}
      href={disabled ? undefined : href}
      onClick={(e) => { if (disabled) e.preventDefault(); }}
      aria-disabled={disabled}
      style={{ display: 'inline-flex' }}
    >
      <span className="csv-btn-arrow">↓</span>
      <span>{label}</span>
    </a>
  );
}

function ObjectsView({
  data,
  deptId,
  year,
  setYear,
}: {
  data: DeptData;
  deptId: string;
  year: number;
  setYear: (y: number) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get('q') || '');
  const [bureau, setBureau] = useState(() => searchParams.get('bureau') || 'all');
  const [expense, setExpense] = useState(() => searchParams.get('expense') || 'all');
  const [sortKey, setSortKey] = useState<'amount' | 'description' | 'code'>('amount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  // Debounce the text input so we don't fire a new server query on every
  // keystroke. 300ms is short enough to feel responsive, long enough that
  // typing "internet" stays a single fetch.
  const [qDebounced, setQDebounced] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (bureau !== 'all') next.set('bureau', bureau);
    if (expense !== 'all') next.set('expense', expense);
    setSearchParams(next, { replace: true });
  }, [q, bureau, expense, setSearchParams]);

  const fpapById = useMemo(() => Object.fromEntries(data.fpaps.map((f) => [f.id, f])), [data]);
  const opUnitById = data.opUnitById;
  const fundById = data.fundById;
  const expenseById = useMemo(() => Object.fromEntries(data.expenses.map((e) => [e.id, e])), [data]);
  const agencyById = useMemo(() => Object.fromEntries(data.agencies.map((a) => [a.id, a])), [data]);

  const expenseClasses = useMemo(() => {
    const set = new Map<string, string>();
    data.expenses.forEach((e) => {
      const code = e.id.split('-').pop();
      if (!code || code === 'nan') return;
      const label = e.description || code;
      if (!set.has(code)) set.set(code, label);
    });
    return Array.from(set.entries()).map(([code, label]) => ({ code, label }));
  }, [data]);

  // ----- server-driven pagination -----
  // Each filter signature kicks off a fresh sequence of page fetches. We
  // keep ALL fetched pages cached in `pages` so back/forward navigation is
  // instant; cursors[i] is the cursor that produced pages[i] (cursor 0 is
  // empty for the first page). On filter change we wipe both.
  const [pages, setPages] = useState<ObjectItem[][]>([]);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ count: number; sum: number } | null>(null);
  const [unfilteredCount, setUnfilteredCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // Filter signature — bumps when anything that affects the result set changes.
  const filterKey = `${year}|${bureau}|${expense}|${qDebounced}|${sortKey}|${sortDir}`;
  useEffect(() => {
    // Reset everything; first page fetches in the effect below.
    setPages([]);
    setCursors([null]);
    setNextCursor(null);
    setSummary(null);
    setPage(0);
    setOpenId(null);
    setPageError(null);
    // unfilteredCount is independent of filters — don't reset it.
  }, [filterKey]);

  // Fetch the page at index `page` if we don't already have it cached. The
  // server returns a cursor pointing to the NEXT page; we capture both that
  // and (on the first page) the summary count/sum for the filtered set.
  useEffect(() => {
    if (pages[page]) return;
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    fetchObjectsPage(deptId, {
      year,
      bureau: bureau !== 'all' ? bureau : null,
      expense: expense !== 'all' ? expense : null,
      q: qDebounced,
      sort: sortKey,
      dir: sortDir,
      cursor: cursors[page] ?? null,
      limit: ROWS_PER_PAGE,
    })
      .then((res) => {
        if (cancelled) return;
        setPages((prev) => {
          const next = prev.slice();
          next[page] = res.data;
          return next;
        });
        setCursors((prev) => {
          if (!res.nextCursor) return prev;
          const next = prev.slice();
          next[page + 1] = res.nextCursor;
          return next;
        });
        setNextCursor(res.nextCursor);
        if (res.summary) setSummary(res.summary);
      })
      .catch((e) => {
        if (!cancelled) setPageError(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterKey, deptId]);

  // One-shot fetch of the unfiltered total for the current year, so the
  // eyebrow can show "X of Y line items" even before the user touches
  // filters. Independent of the page query so we don't refire it on each
  // filter change.
  useEffect(() => {
    let cancelled = false;
    fetchObjectsPage(deptId, { year, limit: 1 })
      .then((res) => {
        if (!cancelled && res.summary) setUnfilteredCount(res.summary.count);
      })
      .catch(() => { /* non-fatal — eyebrow will fall back to filtered count */ });
    return () => { cancelled = true; };
  }, [deptId, year]);

  const pageRows = pages[page] ?? [];
  const totalRows = summary?.count ?? 0;
  const filteredTotal = summary?.sum ?? 0;
  const hasNext = page + 1 < pages.length || nextCursor != null;
  const showPagerNumbers = totalRows > ROWS_PER_PAGE;
  const fromRow = page * ROWS_PER_PAGE + (pageRows.length > 0 ? 1 : 0);
  const toRow = page * ROWS_PER_PAGE + pageRows.length;

  function setSort(key: 'amount' | 'description' | 'code') {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'amount' ? 'desc' : 'asc');
    }
  }
  const arrow = (k: 'amount' | 'description' | 'code') =>
    sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <div className="objects-view">
      <YearStrip data={data} year={year} setYear={setYear} />

      <div style={{ marginTop: 28 }}>
        <SectionHead
          eyebrow={`Objects · ${
            unfilteredCount != null ? unfilteredCount.toLocaleString() : '…'
          } UACS line items · FY ${year}`}
          headline="Every line item, searchable"
          dek="The lowest level of the budget hierarchy: each row is a single object code in a single fund, in a single operating unit, under a single program. This is the data your auditor reads. Search by name (e.g. “internet”), filter by bureau or expense class, click a row for the full breadcrumb."
        />
      </div>

      <div className="objects-toolbar">
        <div className="objects-search">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${
              unfilteredCount != null ? unfilteredCount.toLocaleString() : ''
            } line items — try “internet”, “salary”, “travelling”…`}
          />
        </div>
        <div className="objects-filters">
          <label className="filter">
            <span>Bureau</span>
            <select value={bureau} onChange={(e) => setBureau(e.target.value)}>
              <option value="all">All bureaus</option>
              {data.agencies.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.description}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            <span>Expense class</span>
            <select value={expense} onChange={(e) => setExpense(e.target.value)}>
              <option value="all">All classes</option>
              {expenseClasses.map(({ code, label }) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="objects-summary">
        {summary == null ? (
          <span>Loading totals…</span>
        ) : (
          <>
            <span>
              <strong>{totalRows.toLocaleString()}</strong> line items match
            </span>
            <span className="sep">·</span>
            <span>
              Total: <strong>{fmt.php(filteredTotal, { unit: filteredTotal >= 1e9 ? 'B' : 'M' })}</strong>
            </span>
            <span className="sep">·</span>
            <span>
              {((filteredTotal / data.total(year)) * 100).toFixed(1)}% of FY {year} budget
            </span>
          </>
        )}
        <span className="objects-summary-spacer" />
        {/*
          CSV is streamed straight from the Worker — the browser handles the
          download via Content-Disposition: attachment, so we don't need to
          hold any of the rows in JS. Works for DepEd's million rows just as
          well as for a tiny dept.
        */}
        <ObjectsCsvLink
          deptId={deptId}
          year={year}
          bureau={bureau}
          expense={expense}
          q={qDebounced}
          rowCount={summary?.count ?? 0}
        />
      </div>

      <div className="objects-table-wrap">
        <table className="objects-table">
          <thead>
            <tr>
              <th className="col-code" onClick={() => setSort('code')}>
                UACS{arrow('code')}
              </th>
              <th className="col-name" onClick={() => setSort('description')}>
                Object{arrow('description')}
              </th>
              <th className="col-meta">Bureau · Class</th>
              <th className="col-amount" onClick={() => setSort('amount')}>
                FY {year}
                {arrow('amount')}
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((o) => {
              const open = openId === o.id;
              const amt = o.years[year]?.amount || 0;
              const ag = agencyById[o.agency_id];
              const exp = expenseById[o.expense_id];
              const expCode = (o.expense_id || '').split('-').pop() || '';
              const expClass =
                ({ '1': 'PS', '2': 'MOOE', '3': 'CO', '4': 'FE', '5': 'FE' } as Record<string, string>)[expCode] || expCode;
              return (
                <Fragment key={o.id}>
                  <tr className={`obj-row ${open ? 'open' : ''}`} onClick={() => setOpenId(open ? null : o.id)}>
                    <td className="col-code mono">{o.object_code}</td>
                    <td className="col-name">{o.description}</td>
                    <td className="col-meta">
                      <span className="bureau-pill">
                        {ag?.description?.replace(
                          /Office of the |National |Cybercrime Investigation and Coordinating /,
                          '',
                        ) || '—'}
                      </span>
                      <span className="expense-pill" data-class={expClass}>
                        {expClass}
                      </span>
                    </td>
                    <td className="col-amount num">
                      {fmt.php(amt, { unit: amt >= 1e9 ? 'B' : amt >= 1e6 ? 'M' : 'K' })}
                    </td>
                  </tr>
                  {open && (
                    <tr className="obj-detail">
                      <td colSpan={4}>
                        <ObjectDetail
                          obj={o}
                          fpap={fpapById[o.fpap_id]}
                          opUnit={opUnitById[o.operating_unit_id]}
                          fund={fundById[o.fund_id]}
                          expense={exp}
                          agency={ag}
                          dept={data.department}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {pageRows.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="no-results">
                  {pageError
                    ? `Could not load these results: ${pageError}`
                    : `No line items match these filters in FY ${year}.`}
                </td>
              </tr>
            )}
            {loading && pageRows.length === 0 && (
              <tr>
                <td colSpan={4} className="no-results">
                  <span className="busy-sweep" aria-hidden="true" />Loading line items…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showPagerNumbers && (
        <div className="objects-pager">
          <button disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            ← Prev
          </button>
          <span>
            Showing {fromRow.toLocaleString()}–{toRow.toLocaleString()} of {totalRows.toLocaleString()}
            {loading && ' · loading…'}
          </span>
          <button disabled={!hasNext || loading} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      )}

      <p className="note-block" style={{ marginTop: 28 }}>
        <strong>On UACS object codes.</strong> The Department of Budget and Management revised the Unified
        Account Code Structure during this period. The same expense (e.g. “Internet Subscription Expenses”) may
        carry different codes across years, and some codes were merged or split. We therefore show one year at a
        time and avoid drawing multi-year lines at this level. To track an item across years, use the Programs
        tab instead, which merges renames at the program level.
      </p>
    </div>
  );
}

/* ---------- Raw data browser ---------- */
const RAW_ROWS_PER_PAGE = 50;
const DEFAULT_HIDDEN_COLS = new Set([
  'department_id',
  'department',
  'fpap_id',
  'operating_unit_id',
  'fund_id',
  'expense_id',
  'object_id',
]);

function formatCell(col: ColumnDef, val: RawCell): string {
  if (val == null || val === '') return '';
  if (col.numeric && typeof val === 'number') {
    if (col.group === 'year-amount' || col.key === 'total_amount_php') {
      if (val === 0) return '';
      return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
    if (val === 0) return '';
    return val.toLocaleString('en-US');
  }
  return String(val);
}

/**
 * Server-side sort options accepted by /api/dept/:id/objects/page. Other
 * columns in the Data table render but their headers aren't clickable
 * (sorting on a JOINed parent column would need either server-side joins
 * for the sort or a denormalised column on the objects table — both bigger
 * refactors than this view warrants).
 */
type DataSortKey = 'total_amount_php' | 'object_description' | 'object_code' | `amount_${number}`;

/** Map a Data-table sort key to the Worker's sort/dir/year params. */
function dataSortToServer(key: DataSortKey, dir: 'asc' | 'desc'): { sort: 'amount' | 'description' | 'code' | 'total'; year?: number; dir: 'asc' | 'desc' } {
  if (key === 'total_amount_php') return { sort: 'total', dir };
  if (key === 'object_description') return { sort: 'description', dir };
  if (key === 'object_code') return { sort: 'code', dir };
  const m = /^amount_(\d{4})$/.exec(key);
  if (m) return { sort: 'amount', year: Number(m[1]), dir };
  return { sort: 'total', dir }; // fallback
}

function DataBrowserView({ data, deptId }: { data: DeptData; deptId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState(() => searchParams.get('q') || '');
  const [bureau, setBureau] = useState(() => searchParams.get('bureau') || 'all');
  const [expense, setExpense] = useState(() => searchParams.get('expense') || 'all');
  const [sortKey, setSortKey] = useState<DataSortKey>('total_amount_php');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(new Set(DEFAULT_HIDDEN_COLS));
  const [colsOpen, setColsOpen] = useState(false);

  // Debounce the search box for the same reason ObjectsView does — each
  // keystroke would otherwise fire a fresh server query.
  const [qDebounced, setQDebounced] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (bureau !== 'all') next.set('bureau', bureau);
    if (expense !== 'all') next.set('expense', expense);
    setSearchParams(next, { replace: true });
  }, [q, bureau, expense, setSearchParams]);

  const columns = useMemo(() => buildColumns(YEARS), []);

  const expenseClasses = useMemo(() => {
    const set = new Map<string, string>();
    data.expenses.forEach((e) => {
      const code = e.id.split('-').pop();
      if (!code || code === 'nan') return;
      const label = e.description || code;
      if (!set.has(code)) set.set(code, label);
    });
    return Array.from(set.entries()).map(([code, label]) => ({ code, label }));
  }, [data]);

  // ----- server-driven pagination (mirrors ObjectsView) -----
  // Each filter+sort signature kicks off a fresh sequence of page fetches.
  // We cache every page we've seen so back-paging is instant.
  const [pages, setPages] = useState<ObjectItem[][]>([]);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ count: number; sum: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const filterKey = `${bureau}|${expense}|${qDebounced}|${sortKey}|${sortDir}`;
  useEffect(() => {
    setPages([]);
    setCursors([null]);
    setNextCursor(null);
    setSummary(null);
    setPage(0);
    setPageError(null);
  }, [filterKey]);

  useEffect(() => {
    if (pages[page]) return;
    let cancelled = false;
    setLoading(true);
    setPageError(null);
    const serverSort = dataSortToServer(sortKey, sortDir);
    fetchObjectsPage(deptId, {
      // Data tab is all-years; the year param only matters for sort=amount
      // (which lets a user re-sort by a single column header). Default to
      // 2026 for that case; for `total` the year just gates summary scope
      // and we want the all-years sum so the server picks total there.
      year: serverSort.year ?? 2026,
      bureau: bureau !== 'all' ? bureau : null,
      expense: expense !== 'all' ? expense : null,
      q: qDebounced,
      sort: serverSort.sort,
      dir: serverSort.dir,
      cursor: cursors[page] ?? null,
      limit: RAW_ROWS_PER_PAGE,
    })
      .then((res) => {
        if (cancelled) return;
        setPages((prev) => {
          const next = prev.slice();
          next[page] = res.data;
          return next;
        });
        setCursors((prev) => {
          if (!res.nextCursor) return prev;
          const next = prev.slice();
          next[page + 1] = res.nextCursor;
          return next;
        });
        setNextCursor(res.nextCursor);
        if (res.summary) setSummary(res.summary);
      })
      .catch((e) => {
        if (!cancelled) setPageError(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterKey, deptId]);

  // Hydrate the current page's rows into the wide breadcrumb shape using
  // Stage B data already in memory — same join the legacy in-memory path did.
  const pageRows = useMemo(() => {
    const objs = pages[page] ?? [];
    return objs.map((o) => buildRow(data, o, YEARS));
  }, [pages, page, data]);

  const totalRows = summary?.count ?? 0;
  const hasNext = page + 1 < pages.length || nextCursor != null;
  const fromRow = page * RAW_ROWS_PER_PAGE + (pageRows.length > 0 ? 1 : 0);
  const toRow = page * RAW_ROWS_PER_PAGE + pageRows.length;
  const visibleCols = columns.filter((c) => !hidden.has(c.key));

  // Columns the server can sort by — every other header renders flat.
  const sortableServerKeys = new Set<string>([
    'total_amount_php',
    'object_description',
    'object_code',
    ...YEARS.map((y) => `amount_${y}`),
  ]);

  function toggleSort(key: string, numeric: boolean) {
    if (!sortableServerKeys.has(key)) return;
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key as DataSortKey);
      setSortDir(numeric ? 'desc' : 'asc');
    }
  }
  const arrow = (k: string) => (sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '');

  /**
   * CSV download — streams from /api/dept/:id/objects/csv via the browser,
   * no client-side JSON parsing. Works for DepEd's million rows the same
   * way it works for tiny depts.
   */
  function downloadFiltered() {
    const params = new URLSearchParams();
    // Data tab is all-years, so we use include_zero=1 to match what's
    // displayed (rows that may be zero for any given year but non-zero
    // somewhere else still show up in the table).
    params.set('include_zero', '1');
    if (bureau !== 'all') params.set('bureau', bureau);
    if (expense !== 'all') params.set('expense', expense);
    if (qDebounced) params.set('q', qDebounced);
    // Year doesn't filter the row set in include_zero mode but is required
    // by the server's query parser; pin to the latest.
    params.set('year', '2026');
    const href = `/api/dept/${deptId}/objects/csv?${params.toString()}`;
    // Trigger the browser download. window.open keeps the current SPA route
    // intact; the response's Content-Disposition handles the rest.
    window.location.href = href;
  }

  function toggleCol(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="raw-browser">
      <SectionHead
        eyebrow={`Raw dataset · ${
          summary != null ? summary.count.toLocaleString() : '…'
        } line items × ${columns.length} columns`}
        headline="Raw data browser"
        dek="The same flat table the CSV download produces — every UACS line item denormalised with its full department → agency → program → operating unit → fund → expense-class breadcrumb, plus seven years of amount + count columns. Search, filter, sort, paginate. Hidden ID columns can be toggled on for joins."
      />

      <div className="raw-toolbar">
        <input
          type="search"
          className="raw-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search any column — try “internet”, “salary”, “OSEC”, a UACS code…"
        />
        <div className="raw-filters">
          <label className="filter">
            <span>Bureau</span>
            <select value={bureau} onChange={(e) => setBureau(e.target.value)}>
              <option value="all">All bureaus</option>
              {data.agencies.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.description}
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            <span>Expense class</span>
            <select value={expense} onChange={(e) => setExpense(e.target.value)}>
              <option value="all">All classes</option>
              {expenseClasses.map(({ code, label }) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="raw-cols-btn"
            aria-expanded={colsOpen}
            onClick={() => setColsOpen((o) => !o)}
          >
            Columns · {visibleCols.length}/{columns.length}
          </button>
        </div>
      </div>

      {colsOpen && (
        <div className="raw-cols-panel">
          <div className="raw-cols-grid">
            {columns.map((c) => (
              <label key={c.key} className="raw-col-toggle">
                <input
                  type="checkbox"
                  checked={!hidden.has(c.key)}
                  onChange={() => toggleCol(c.key)}
                />
                <code>{c.key}</code>
              </label>
            ))}
          </div>
          <div className="raw-cols-actions">
            <button type="button" onClick={() => setHidden(new Set())}>
              Show all
            </button>
            <button type="button" onClick={() => setHidden(new Set(DEFAULT_HIDDEN_COLS))}>
              Reset
            </button>
            <button type="button" onClick={() => setHidden(new Set(columns.map((c) => c.key)))}>
              Hide all
            </button>
          </div>
        </div>
      )}

      <div className="raw-summary">
        {summary == null ? (
          <span>Loading totals…</span>
        ) : (
          <span>
            <strong>{totalRows.toLocaleString()}</strong> rows match
          </span>
        )}
        <span className="raw-summary-spacer" />
        <button
          type="button"
          className="csv-btn csv-btn-pill"
          disabled={totalRows === 0}
          onClick={downloadFiltered}
        >
          <span className="csv-btn-arrow">↓</span>
          <span>
            Download CSV
            {totalRows > 0 && ` · ${totalRows.toLocaleString()} rows`}
          </span>
        </button>
      </div>

      <div className="raw-table-wrap">
        <table className="raw-table">
          <thead>
            <tr>
              {visibleCols.map((c) => (
                <th
                  key={c.key}
                  className={`raw-th raw-th-${c.group} ${c.numeric ? 'num' : ''}`}
                  style={{ width: c.width, minWidth: c.width }}
                  onClick={() => toggleSort(c.key, c.numeric)}
                  title={`${c.key} (click to sort)`}
                >
                  {c.label}
                  {arrow(c.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={String(r.object_id)}>
                {visibleCols.map((c) => (
                  <td
                    key={c.key}
                    className={`raw-td raw-td-${c.group} ${c.numeric ? 'num' : ''}`}
                    title={String(r[c.key] ?? '')}
                  >
                    {formatCell(c, r[c.key])}
                  </td>
                ))}
              </tr>
            ))}
            {pageRows.length === 0 && !loading && (
              <tr>
                <td className="no-results" colSpan={visibleCols.length}>
                  {pageError
                    ? `Could not load these results: ${pageError}`
                    : 'No rows match these filters.'}
                </td>
              </tr>
            )}
            {loading && pageRows.length === 0 && (
              <tr>
                <td className="no-results" colSpan={visibleCols.length}>
                  Loading rows…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalRows > RAW_ROWS_PER_PAGE && (
        <div className="objects-pager">
          <button disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            ← Prev
          </button>
          <span>
            Showing {fromRow.toLocaleString()}–{toRow.toLocaleString()} of {totalRows.toLocaleString()}
            {loading && ' · loading…'}
          </span>
          <button disabled={!hasNext || loading} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- Lazy-load affordances for heavy stages ---------- */
type StageState = 'idle' | 'loading' | 'loaded' | 'error';

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Field-level slices of `DeptData` that each lazy stage is responsible for.
 * Used to merge Stage B/C results into the latest React state via the
 * functional form of setData, so concurrent stage completions don't
 * overwrite each other's flags by spreading a stale Stage-A snapshot.
 */
function midDelta(next: DeptData): Partial<DeptData> {
  return {
    fpaps: next.fpaps,
    fpapById: next.fpapById,
    fpapsByAgency: next.fpapsByAgency,
    fpapFamilies: next.fpapFamilies,
    opUnits: next.opUnits,
    opUnitById: next.opUnitById,
    funds: next.funds,
    fundById: next.fundById,
    expenses: next.expenses,
    expenseClassByYear: next.expenseClassByYear,
    expenseClassByAgencyYear: next.expenseClassByAgencyYear,
    midLoaded: true,
    midMode: next.midMode,
    programsPaginated: next.programsPaginated,
    expensesSkipped: next.expensesSkipped,
    topMovers: next.topMovers,
  };
}

// objectsDelta was used by the old Stage C auto-loader to merge into the
// React state after a full /objects dump. Both /objects and /data views
// server-paginate now and don't need it. Kept defined here (unused) to
// stay symmetric with midDelta for any future callers that opt back into
// loadDeptObjectsInto. eslint-disable-next-line @typescript-eslint/no-unused-vars
// @ts-expect-error: intentionally unused — see comment above.
function objectsDelta(next: DeptData): Partial<DeptData> {
  return {
    objects: next.objects,
    objectsLoaded: true,
  };
}

/** Ticks elapsed seconds while mounted. Used inside loading-state UI to
 *  give users a visible sign that work is happening on long parquet queries. */
function Elapsed() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{secs}s elapsed</>;
}

function StageLoader({
  stage,
  state,
  error,
  deptId,
  onLoad,
}: {
  stage: 'mid' | 'objects';
  state: StageState;
  error: string | null;
  deptId: string;
  onLoad?: () => void;
}) {
  // User-facing labels — kept in language a civic-society or journalist
  // audience will recognise. No backend table names, payload sizes, or
  // database/CDN references in any of the copy below.
  const stageLabel =
    stage === 'mid'
      ? 'this department’s programs and bureaus'
      : 'the individual budget items';
  const isHeavy =
    stage === 'mid' ? isMidHeavy(deptId) : isObjectsHeavy(deptId);

  if (state === 'idle' && onLoad) {
    return (
      <div className="stage-loader stage-loader-idle">
        <p>
          {isHeavy
            ? `${capitalize(stageLabel)} are not loaded yet — this is a large department, so the load may take a little longer than usual.`
            : `${capitalize(stageLabel)} are not loaded yet.`}
        </p>
        <button
          type="button"
          className="csv-btn csv-btn-pill"
          onClick={onLoad}
          style={{ display: 'inline-flex' }}
        >
          <span className="csv-btn-arrow">↓</span>
          <span>Load this section</span>
        </button>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="stage-loader stage-loader-error">
        <p>Sorry — we couldn’t load {stageLabel} right now. Please try again in a moment.</p>
        {error && <p className="stage-loader-detail">{error}</p>}
      </div>
    );
  }

  // state === 'loading' (or 'loaded' transition — both fall through to the
  // progress UI; the parent unmounts us once the data is in hand).
  return (
    <div className="stage-loader stage-loader-loading">
      <p className="stage-loader-title">
        Loading {stageLabel}…
      </p>
      <div className="loading-bar" aria-hidden="true" />
      <p className="stage-loader-detail">
        {isHeavy
          ? 'This is a large department, so it can take a few seconds. Thanks for your patience.'
          : 'This usually takes just a few seconds.'}
      </p>
      <p className="stage-loader-elapsed" aria-live="polite">
        <Elapsed />
      </p>
    </div>
  );
}

/* ---------- Page shell ---------- */

export default function Portal() {
  const { deptId = '' } = useParams<{ deptId: string }>();
  const [data, setData] = useState<DeptData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [midState, setMidState] = useState<StageState>('idle');
  const [midError, setMidError] = useState<string | null>(null);
  const [year, setYear] = useState(FALLBACK_YEAR);
  const location = useLocation();
  const navigate = useNavigate();
  const view: View = VIEW_BY_SUFFIX[pathSuffix(location.pathname, deptId)] || 'hierarchy';
  const [hierarchyDepth, setHierarchyDepth] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const didMountViewScroll = useRef(false);

  // Re-assert the department-specific title on view changes too — RouteMeta
  // resets document.title to the generic portal title on every navigation.
  useEffect(() => {
    if (data) document.title = deptTitle(data.department.description, 'gaa');
  }, [data, view]);

  useEffect(() => {
    if (!deptId) return;
    setData(null);
    setLoadError(null);
    setMidState('idle');
    setMidError(null);
    let cancelled = false;
    loadDeptData(deptId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setLoadError(String(e?.message || e)); });
    return () => { cancelled = true; };
  }, [deptId]);

  const triggerMidLoad = () => {
    if (!data) return;
    if (midState !== 'idle') return;
    setMidState('loading');
    loadDeptMidInto(data, deptId)
      .then((next) => {
        // Stage B and Stage C run concurrently after Stage A, each closing
        // over the same Stage-A `data`. Functional setData merges the mid
        // delta onto whatever `prev` is now — without it, a slower Stage C
        // resolving second would clobber Stage B's update with stale
        // Stage-A state and the UI would stay on the "loading" screen
        // forever despite midState === 'loaded'.
        setData((prev) => (prev ? { ...prev, ...midDelta(next) } : next));
        setMidState('loaded');
      })
      .catch((e) => {
        setMidError(String(e?.message || e));
        setMidState('error');
      });
  };

  // Auto-fire Stage B in the background as soon as Stage A lands — except
  // for outlier departments (e.g. DPWH) where the combined payload is so
  // large that the user must explicitly opt in.
  useEffect(() => {
    if (!data || data.midLoaded || midState !== 'idle') return;
    if (isMidHeavy(deptId)) return;
    triggerMidLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, deptId, midState]);

  useEffect(() => {
    if (view !== 'hierarchy') setHierarchyDepth(0);
  }, [deptId, view]);

  useEffect(() => {
    if (!didMountViewScroll.current) {
      didMountViewScroll.current = true;
      return;
    }
    if (!window.matchMedia('(max-width: 720px)').matches) return;

    const id = window.setTimeout(() => {
      const target = mainRef.current;
      if (!target) return;
      const masthead = document.querySelector('.masthead') as HTMLElement | null;
      const offset = (masthead?.offsetHeight ?? 0) + 8;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, 0);
    return () => window.clearTimeout(id);
  }, [deptId, view]);

  // Stage C is no longer triggered from the SPA. The Objects and Data views
  // both server-paginate via /api/dept/:id/objects/page (and the CSV button
  // streams from /api/dept/:id/objects/csv). `loadDeptObjectsInto` stays
  // exported from dept-data.ts for callers that still want the full dump.

  if (loadError) {
    return (
      <div
        style={{
          padding: 80,
          textAlign: 'center',
          fontFamily: 'var(--font-mono)',
          color: 'var(--accent)',
        }}
      >
        <p>Sorry — we couldn’t load this department right now. Please try again in a moment.</p>
        <p style={{ color: 'var(--ink-3)', fontSize: 12 }}>{loadError}</p>
        <p><Link to="/gaa">← Back to the national overview</Link></p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page-shell-loader">
        <p className="page-shell-loader-title">Loading this department…</p>
        <div className="loading-bar" aria-hidden="true" />
        <p className="page-shell-loader-detail">Pulling budget figures for 2020 – 2026.</p>
        <p className="page-shell-loader-elapsed" aria-live="polite">
          <Elapsed />
        </p>
      </div>
    );
  }

  const sevenYearTotal = YEARS.reduce((s, y) => s + data.total(y), 0);
  const deptSlug = data.department.description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const csvFilename = `gaa-${deptId}-${deptSlug}-fy2020-2026.csv`;

  function go(v: View) {
    navigate(`/d/${deptId}${SUFFIX_BY_VIEW[v]}`);
  }

  const sectionTabs: Array<[View, string]> = [
    ['hierarchy', 'Overview'],
    ['report', 'Report'],
    ['byyear', 'By year'],
    ['programs', 'Programs'],
    ['cycle', 'Budget cycle'],
    ['objects', 'Objects'],
    ['data', 'Data'],
    ['methodology', 'Methodology'],
  ];

  return (
    <>
      <SiteHeader
        crumb={data.department.description}
        compiledMeta={
          <>
            <DownloadCsvButton
              data={data}
              filter={{}}
              filename={csvFilename}
              label="Download · CSV"
              variant="inline"
            />
            <span className="masthead-meta-sep">·</span>
            Compiled · ₱{fmt.shortPhp(sevenYearTotal, 'B').replace('₱', '')}
          </>
        }
        subNav={
          <nav className="view-tabs section-tabs" aria-label="Group sections">
            {sectionTabs.map(([v, label]) => (
              <button
                key={v}
                className={view === v ? 'active' : ''}
                onClick={() => go(v)}
              >
                {label}
              </button>
            ))}
          </nav>
        }
        drawerExtras={
          <>
            <span className="drawer-eyebrow">Group sections</span>
            {sectionTabs.map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={`drawer-link ${view === v ? 'active' : ''}`}
                onClick={() => go(v)}
              >
                {label}
                <span className="drawer-link-arrow">→</span>
              </button>
            ))}
            <span className="drawer-eyebrow" style={{ marginTop: 16 }}>Dataset</span>
            <DownloadCsvButton
              data={data}
              filter={{}}
              filename={csvFilename}
              label="Download · CSV"
              variant="pill"
            />
            <p className="drawer-meta">
              Compiled · 7 fiscal years · ₱{fmt.shortPhp(sevenYearTotal, 'B').replace('₱', '')}
            </p>
          </>
        }
      />

      <main
        ref={mainRef}
        className={`portal-main ${view === 'hierarchy' && hierarchyDepth > 0 ? 'portal-main-drilled' : ''}`}
        style={{ maxWidth: 1440, margin: '0 auto', padding: '32px 32px 80px' }}
      >
        <div className="page-headline">
          <p className="page-eyebrow">
            Department {deptId} · {view === 'cycle' ? 'FY 2018 – 2026 · Current New Appropriations' : 'FY 2020 – 2026'}
          </p>
          <h1 className="page-title">{data.department.description}</h1>
        </div>
        {view !== 'methodology' && view !== 'data' && view !== 'report' && view !== 'cycle' && (
          <KpiStrip data={data} hideOnMobile={view !== 'hierarchy'} />
        )}
        {view === 'hierarchy' && <TrendChart data={data} />}
        {view === 'report' && <ReportView key={deptId} deptId={deptId} />}

        {view === 'hierarchy' && (
          <HierarchyView
            data={data}
            year={year}
            setYear={setYear}
            midState={midState}
            midError={midError}
            onRequestMid={triggerMidLoad}
            deptId={deptId}
            onDepthChange={setHierarchyDepth}
          />
        )}
        {view === 'byyear' && <ByYearView data={data} year={year} setYear={setYear} />}
        {view === 'programs' &&
          (data.midLoaded ? (
            <ProgramsView data={data} year={year} setYear={setYear} />
          ) : (
            <StageLoader
              stage="mid"
              state={midState}
              error={midError}
              deptId={deptId}
              onLoad={midState === 'idle' ? triggerMidLoad : undefined}
            />
          ))}
        {view === 'cycle' && (
          <BudgetCycleView key={deptId} deptId={deptId} departmentName={data.department.description} />
        )}
        {view === 'objects' &&
          (data.midLoaded ? (
            <ObjectsView data={data} deptId={deptId} year={year} setYear={setYear} />
          ) : (
            <StageLoader
              stage="mid"
              state={midState}
              error={midError}
              deptId={deptId}
              onLoad={midState === 'idle' ? triggerMidLoad : undefined}
            />
          ))}
        {view === 'data' &&
          (data.midLoaded ? (
            <DataBrowserView data={data} deptId={deptId} />
          ) : (
            <StageLoader
              stage="mid"
              state={midState}
              error={midError}
              deptId={deptId}
              onLoad={midState === 'idle' ? triggerMidLoad : undefined}
            />
          ))}
        {view === 'methodology' && <MethodologyView data={data} />}

        {view !== 'methodology' && view !== 'data' && view !== 'cycle' && (
          <p className="note-block">
            <strong>Note.</strong> All amounts are appropriations under the General Appropriations Act, in
            pesos. Source data is published in thousands; values shown here are converted to full pesos and
            rendered as ₱B / ₱M / ₱K for legibility. The GAA is the legal authority to spend — not actual
            obligations or disbursements. See the Methodology tab for caveats on object-level codes and program
            renames.
          </p>
        )}
      </main>

      <SiteFooter />
    </>
  );
}
