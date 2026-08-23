import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Eyebrow } from '../components/shared';
import { SkeletonRows } from '../components/Nep2027Bits';
import SiteFooter from '../components/SiteFooter';
import SiteHeader from '../components/SiteHeader';
import YearLinkStrip from '../components/YearLinkStrip';
import { fetchEntity, fetchMidChildren, loadDeptData, YEARS } from '../lib/dept-data';
import type { MidChildrenPage } from '../lib/dept-data';
import * as fmt from '../lib/format';
import { dataUrl } from '../lib/data-url';
import type { BaseEntity, NationalIndex, NationalDeptRow } from '../lib/types';

/**
 * /gaa/:year/… — the per-year budget browser. One fiscal year at a time, the
 * full GAA hierarchy: group → bureau → program (FPAP) → operating unit →
 * fund → expense class.
 *
 * Both the year and the drill path live in the URL:
 *   /gaa/:year/:group/:bureau/:program/:opunit/:fund
 * Each segment is the entity's stable id, so every drill level is a
 * shareable, bookmarkable link and browser back/forward walk the hierarchy.
 * Switching years rewrites only the year segment and re-reads the same
 * branch under the newly selected year. (The fund page lists expense
 * classes — the leaf — so no sixth segment exists.)
 *
 * Data: the group level comes from national/index.json (all years, pesos);
 * bureaus from the department's Stage A core (all years); everything deeper
 * from the year-aware /api/dept/:id/mid/children endpoint, cached per
 * (dept, table, parent, year). On a cold deep link, mid-level breadcrumb
 * labels are resolved through /api/dept/:id/entity.
 */

type DrillLevel = 'dept' | 'agency' | 'fpap' | 'opUnit' | 'fund';
type PathEntry = { level: DrillLevel; id: string; label: string };

type MidTable = 'fpaps' | 'operating_units' | 'fund_subcategories' | 'expenses';

/** URL segment order. segIds[i] is an entity of LEVELS[i]. */
const LEVELS: DrillLevel[] = ['dept', 'agency', 'fpap', 'opUnit', 'fund'];

/** D1 table backing each URL-addressable mid level (for label lookups). */
const TABLE_OF: Record<'fpap' | 'opUnit' | 'fund', MidTable> = {
  fpap: 'fpaps',
  opUnit: 'operating_units',
  fund: 'fund_subcategories',
};

/** What lives under a node at each level. `table` set → children served by
    the year-scoped /mid/children endpoint; unset → bureaus come from core. */
const CHILD_OF: Record<DrillLevel, { level: DrillLevel | 'expense'; title: string; table?: MidTable }> = {
  dept: { level: 'agency', title: 'Bureaus' },
  agency: { level: 'fpap', title: 'Programs (FPAPs)', table: 'fpaps' },
  fpap: { level: 'opUnit', title: 'Operating Units', table: 'operating_units' },
  opUnit: { level: 'fund', title: 'Funds', table: 'fund_subcategories' },
  fund: { level: 'expense', title: 'Expense Classes', table: 'expenses' },
};

function drillUrl(year: number, segIds: string[]): string {
  return ['/gaa/' + year, ...segIds.map(encodeURIComponent)].join('/');
}

export default function GaaYear() {
  const params = useParams();
  const year = Number(params.year);
  const segIds = (params['*'] ?? '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!YEARS.includes(year)) {
    // FY2027 is the NEP microsite, not the GAA series; anything else is noise.
    return <Navigate to={year === 2027 ? '/2027/browse' : '/gaa'} replace />;
  }
  if (segIds.length > LEVELS.length) {
    return <Navigate to={drillUrl(year, segIds.slice(0, LEVELS.length))} replace />;
  }
  return <GaaYearBrowser year={year} segIds={segIds} />;
}

function GaaYearBrowser({ year, segIds }: { year: number; segIds: string[] }) {
  const navigate = useNavigate();
  const [idx, setIdx] = useState<NationalIndex | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [agencyCache, setAgencyCache] = useState<
    Record<string, { records: BaseEntity[]; error?: string }>
  >({});
  const [midCache, setMidCache] = useState<Record<string, MidChildrenPage>>({});
  /** description by `${table}|${id}`, for mid-level breadcrumb labels. */
  const [labelCache, setLabelCache] = useState<Record<string, string>>({});
  const labelRequested = useRef(new Set<string>());
  const drillBarRef = useRef<HTMLDivElement>(null);

  const deptId = segIds[0] ?? '';
  const segKey = segIds.join('/');
  const suffix = segIds.length ? '/' + segIds.map(encodeURIComponent).join('/') : '';

  useEffect(() => {
    fetch(dataUrl('national/index.json'))
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load national index (HTTP ${r.status}). Run \`npm run build:index\`.`);
        return r.json() as Promise<NationalIndex>;
      })
      .then((data) => setIdx(data))
      .catch((e) => setErr(String(e?.message || e)));
  }, []);

  // Bureaus once per group the user enters. Core carries all years in one
  // response, so switching years at this level never refetches.
  useEffect(() => {
    if (!deptId || agencyCache[deptId]) return;
    let live = true;
    loadDeptData(deptId)
      .then((d) => {
        if (live) setAgencyCache((m) => ({ ...m, [deptId]: { records: d.agencies } }));
      })
      .catch((e) => {
        if (live) setAgencyCache((m) => ({ ...m, [deptId]: { records: [], error: String(e?.message || e) } }));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deptId]);

  // Levels below bureau: year-scoped children from D1. Absence of a cache
  // entry doubles as the loading state, mirroring Portal's interactive mode.
  // Every listing also feeds the label cache: children fetched while
  // drilling are tomorrow's breadcrumb ancestors.
  const current: { level: DrillLevel; id: string } | null = segIds.length
    ? { level: LEVELS[segIds.length - 1], id: segIds[segIds.length - 1] }
    : null;
  const child = current ? CHILD_OF[current.level] : null;
  const midKey = current && child?.table ? `${deptId}|${child.table}|${current.id}|${year}` : '';
  useEffect(() => {
    if (!midKey || midCache[midKey]) return;
    const table = child!.table!;
    const parent = current!.id;
    let live = true;
    fetchMidChildren(deptId, table, parent, year)
      .then((r) => {
        if (!live) return;
        setMidCache((m) => ({ ...m, [midKey]: r }));
        setLabelCache((m) => {
          const out = { ...m };
          r.records.forEach((rec) => (out[`${table}|${rec.id}`] = rec.description));
          return out;
        });
      })
      .catch(() => {
        if (live) setMidCache((m) => ({ ...m, [midKey]: { records: [], cursor: null, total: 0, totalAmount: 0 } }));
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [midKey]);

  // Cold deep link: URL segments arrive without labels. Resolve each
  // mid-level ancestor once by id; interactive drilling rarely hits this
  // because listings already populated the label cache.
  useEffect(() => {
    segIds.forEach((id, i) => {
      const level = LEVELS[i];
      if (level === 'dept' || level === 'agency') return;
      const table = TABLE_OF[level];
      const key = `${table}|${id}`;
      if (labelCache[key] || labelRequested.current.has(key)) return;
      labelRequested.current.add(key);
      fetchEntity(deptId, table, id)
        .then((rec) => {
          if (rec) setLabelCache((m) => ({ ...m, [key]: rec.description }));
        })
        .catch(() => {
          /* crumb falls back to the raw id */
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segKey, deptId]);

  // On mobile, drilling replaces the table wholesale — scroll the context bar
  // into view so the user sees where they landed (same behaviour as Portal).
  useEffect(() => {
    if (segIds.length === 0) return;
    if (!window.matchMedia('(max-width: 720px)').matches) return;
    const t = window.setTimeout(() => {
      const target = drillBarRef.current;
      if (!target) return;
      const masthead = document.querySelector('.masthead') as HTMLElement | null;
      const offset = (masthead?.offsetHeight ?? 0) + 8;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, 0);
    return () => window.clearTimeout(t);
  }, [segIds.length]);

  if (err) {
    return (
      <main style={{ maxWidth: 1000, margin: '60px auto', padding: '0 32px', fontFamily: 'var(--font-mono)' }}>
        <p style={{ color: 'var(--accent)' }}>{err}</p>
        <p style={{ color: 'var(--ink-3)' }}>
          You can still browse the multi-year overview at <Link to="/gaa">/gaa</Link>.
        </p>
      </main>
    );
  }

  if (!idx) {
    return (
      <main style={{ padding: 80, textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--ink-3)' }}>
        Loading FY {year} browser…
      </main>
    );
  }

  // A group id the index doesn't know can't be browsed — drop the drill.
  if (deptId && !idx.departments.some((d) => d.id === deptId)) {
    return <Navigate to={`/gaa/${year}`} replace />;
  }

  const amt = (r: { years: BaseEntity['years'] }) => r.years[year]?.amount || 0;
  const natTotal = (y: number) => idx.national_yearly.find((r) => r.year === y)?.amount || 0;
  const total = natTotal(year);
  const prevYear = year > YEARS[0] ? year - 1 : null;
  const prevTotal = prevYear ? natTotal(prevYear) : 0;
  const yoy = prevYear && prevTotal ? (total - prevTotal) / prevTotal : null;

  const deptRows = [...idx.departments].sort((a, b) => amt(b) - amt(a));
  const fundedCount = deptRows.filter((d) => amt(d) > 0).length;
  const top = deptRows[0];
  const topShare = total && top ? amt(top) / total : 0;

  // Rehydrate the breadcrumb path from URL segments; labels fall back to the
  // raw id until the entity lookup lands.
  const path: PathEntry[] = segIds.map((id, i) => {
    const level = LEVELS[i];
    let label: string;
    if (level === 'dept') {
      label = idx.departments.find((d) => d.id === id)?.description ?? id;
    } else if (level === 'agency') {
      label = agencyCache[deptId]?.records.find((a) => a.id === id)?.description ?? id;
    } else {
      label = labelCache[`${TABLE_OF[level]}|${id}`] ?? id;
    }
    return { level, id, label };
  });
  const currentEntry = path.length ? path[path.length - 1] : null;

  // Resolve the current listing: which records, from which source.
  const midEntry = midKey ? midCache[midKey] : undefined;
  let levelTitle: string;
  let records: BaseEntity[];
  let loading = false;
  let loadError: string | null = null;
  let levelTotal: number;
  let rowsDrillable = true;

  if (!current) {
    levelTitle = 'Groups';
    records = deptRows as unknown as BaseEntity[];
    levelTotal = total;
  } else if (current.level === 'dept') {
    levelTitle = 'Bureaus';
    const entry = agencyCache[deptId];
    loading = !entry;
    loadError = entry?.error ?? null;
    records = (entry?.records ?? []).slice().sort((a, b) => amt(b) - amt(a));
    levelTotal = records.reduce((s, r) => s + amt(r), 0);
  } else {
    levelTitle = child!.title;
    loading = !midEntry;
    records = midEntry?.records ?? [];
    levelTotal = midEntry?.totalAmount ?? 0;
    rowsDrillable = child!.level !== 'expense';
  }

  // Per-year exclusivity: lines that exist only in other budget years carry
  // zero here and are hidden rather than rendered as ₱0 noise. The server
  // sorts by this year's amount descending, so once a loaded page contains a
  // zero every later page is zeros too — stop offering "show more" then.
  const visible = records.filter((r) => amt(r) > 0);
  const hidden = records.length - visible.length;
  const max = visible.reduce((m, r) => Math.max(m, amt(r)), 0);
  const canLoadMore = !!midEntry?.cursor && hidden === 0;

  function loadMore() {
    if (!current || !child?.table || !midEntry?.cursor) return;
    const table = child.table;
    fetchMidChildren(deptId, table, current.id, year, midEntry.cursor).then((r) => {
      setMidCache((m) => {
        const cur = m[midKey];
        if (!cur) return m;
        return { ...m, [midKey]: { ...r, records: [...cur.records, ...r.records] } };
      });
      setLabelCache((m) => {
        const out = { ...m };
        r.records.forEach((rec) => (out[`${table}|${rec.id}`] = rec.description));
        return out;
      });
    });
  }

  function drill(rec: BaseEntity) {
    const lvl = current ? CHILD_OF[current.level].level : 'dept';
    if (lvl === 'expense') return;
    if (!current && (rec as unknown as NationalDeptRow).has_data === false) return;
    navigate(drillUrl(year, [...segIds, rec.id]));
  }
  function jump(i: number) {
    navigate(drillUrl(year, i < 0 ? [] : segIds.slice(0, i + 1)));
  }
  function back() {
    navigate(drillUrl(year, segIds.slice(0, -1)));
  }

  const atLeaf = current?.level === 'fund';

  return (
    <>
      <SiteHeader
        crumb={<>Per-year browser</>}
        compiledMeta={`Compiled · FY${year} · ₱${fmt.shortPhp(total, 'T')}`}
        subNav={
          <nav className="view-tabs section-tabs" aria-label="Fiscal years">
            <Link to="/gaa">All years</Link>
            {YEARS.map((y) => (
              <Link key={y} to={`/gaa/${y}${suffix}`} className={y === year ? 'active' : ''}>
                FY {y}
              </Link>
            ))}
          </nav>
        }
        drawerExtras={
          <>
            <Link className="drawer-link" to="/gaa">
              All years overview <span className="drawer-link-arrow">→</span>
            </Link>
            {YEARS.map((y) => (
              <Link key={y} className="drawer-link" to={`/gaa/${y}${suffix}`}>
                FY {y} browser <span className="drawer-link-arrow">→</span>
              </Link>
            ))}
          </>
        }
      />

      <main style={{ maxWidth: 1440, margin: '0 auto', padding: '32px 32px 80px' }}>
        <div className="page-headline">
          <p className="page-eyebrow">Budget browser · one fiscal year</p>
          <h1 className="page-title">FY {year} General Appropriations</h1>
          <p className="page-dek">
            Every peso appropriated for fiscal year {year} alone — drill from group to bureau, program,
            operating unit, fund, and expense class. Each level has its own URL you can share, and
            switching years keeps your place in the hierarchy.
          </p>
        </div>

        <div className="year-strip-wrap" style={{ marginBottom: 24 }}>
          <p className="eyebrow">Pick a fiscal year — the whole page follows</p>
          <YearLinkStrip yearly={idx.national_yearly} active={year} suffix={suffix} />
        </div>

        <div className="kpi-strip">
          <div className="kpi-cell">
            <div className="kpi-label">FY {year} appropriation</div>
            <div className="kpi-value">{fmt.shortPhp(total, 'T')}</div>
            <div className="kpi-sub">national, all groups</div>
          </div>
          <div className="kpi-cell">
            <div className="kpi-label">
              {prevYear ? `YoY change · ${prevYear} → ${year}` : 'YoY change'}
            </div>
            {yoy == null ? (
              <>
                <div className="kpi-value">—</div>
                <div className="kpi-sub">first year in the series</div>
              </>
            ) : (
              <>
                <div className="kpi-value" style={{ color: yoy >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                  {fmt.signedPct(yoy)}
                </div>
                <div className="kpi-sub">{fmt.shortPhp(total - prevTotal, 'B')} vs FY {prevYear}</div>
              </>
            )}
          </div>
          <div className="kpi-cell">
            <div className="kpi-label">Largest group share</div>
            <div className="kpi-value">{fmt.pct(topShare)}</div>
            <div className="kpi-sub">{top?.description ?? '—'}</div>
          </div>
          <div className="kpi-cell">
            <div className="kpi-label">Groups funded</div>
            <div className="kpi-value">{fundedCount}</div>
            <div className="kpi-sub">of {deptRows.length} tracked</div>
          </div>
        </div>

        <div style={{ marginBottom: 14, marginTop: 28 }}>
          <Eyebrow>Hierarchy · FY {year} only, drill from group to expense class</Eyebrow>
        </div>

        <div ref={drillBarRef} className="drill-mobile-bar" aria-label="Current drilldown level">
          <button type="button" onClick={back} disabled={path.length === 0}>
            ← Back
          </button>
          <div>
            <span>{levelTitle}</span>
            <strong>{currentEntry ? currentEntry.label : `All groups · FY ${year}`}</strong>
          </div>
          <em>{visible.length.toLocaleString()}</em>
        </div>

        <div className="crumbs">
          <button onClick={() => jump(-1)}>All groups · FY {year}</button>
          {path.map((p, i) => (
            <Fragment key={`${p.level}-${p.id}`}>
              <span className="sep">›</span>
              <button onClick={() => jump(i)}>{p.label}</button>
            </Fragment>
          ))}
          <span className="sep">›</span>
          <span className="current">{levelTitle}</span>
          {deptId && (
            <span className="crumb-download">
              <Link className="csv-btn csv-btn-pill" to={`/d/${deptId}/overview`}>
                Multi-year view · {path[0].label} →
              </Link>
            </span>
          )}
        </div>

        <table className="hier-table drill-table">
          <thead>
            <tr>
              <th>{levelTitle}</th>
              <th style={{ width: 160 }}>Share of max</th>
              <th className="right">FY {year}</th>
              <th className="right">% of level</th>
              <th className="right">YoY</th>
              <th style={{ width: 24 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows cols={6} />}
            {!loading && loadError && (
              <tr className="disabled">
                <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--negative)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  {loadError}
                </td>
              </tr>
            )}
            {!loading && !loadError && visible.length === 0 && (
              <tr className="disabled">
                <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  No FY {year} appropriations under {currentEntry ? currentEntry.label : 'this level'}.
                </td>
              </tr>
            )}
            {!loading &&
              visible.map((rec) => {
                const code =
                  (rec as { fpap_code?: string }).fpap_code ??
                  (rec as { expense_code?: string }).expense_code;
                const noDrill =
                  !rowsDrillable || (!current && (rec as unknown as NationalDeptRow).has_data === false);
                return (
                  <YearRow
                    key={rec.id}
                    rec={rec}
                    year={year}
                    max={max}
                    total={levelTotal}
                    prevYear={prevYear}
                    drillable={!noDrill}
                    onClick={() => drill(rec)}
                    code={!current && noDrill ? 'summary only — no line-item data' : code}
                  />
                );
              })}
          </tbody>
        </table>

        {canLoadMore && midEntry && (
          <button type="button" className="csv-btn" style={{ marginTop: 12 }} onClick={loadMore}>
            Show more · {records.length.toLocaleString()} of {midEntry.total.toLocaleString()} loaded
          </button>
        )}

        {hidden > 0 && !loading && (
          <p style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-mute)' }}>
            {hidden.toLocaleString()} {hidden === 1 ? 'line exists' : 'lines exist'} in other budget years
            but carr{hidden === 1 ? 'ies' : 'y'} no FY {year} appropriation — hidden in this per-year view.
          </p>
        )}

        {atLeaf && (
          <p className="note-block" style={{ marginTop: 24, borderTop: '1px solid var(--rule)', paddingTop: 18 }}>
            <strong>Why no further drill-down?</strong> Below expense class, the data goes to <em>Object</em>{' '}
            (UACS line items like “Travelling Expenses — Local”). Object codes were recoded between fiscal
            years, so they live in each group’s portal under <strong>Objects</strong> rather than here.
          </p>
        )}

        <p className="note-block" style={{ marginTop: 32 }}>
          <strong>Note.</strong> Figures are FY {year} appropriations under the General Appropriations Act,
          in pesos (source data is published in thousands and converted). The GAA is the legal authority to
          spend — not actual obligations or disbursements. For cross-year trends use the{' '}
          <Link to="/gaa">all-years overview</Link>; for caveats see the{' '}
          <Link to="/methodology">Methodology</Link> page.
        </p>
      </main>

      <SiteFooter />
    </>
  );
}

/** One listing row, scoped to a single fiscal year: share bar against the
    level max, the FY amount, share of the level total, and YoY vs the prior
    budget (— for FY 2020; "new" when the line first appears this year). */
function YearRow({
  rec,
  year,
  max,
  total,
  prevYear,
  drillable,
  onClick,
  code,
}: {
  rec: BaseEntity;
  year: number;
  max: number;
  total: number;
  prevYear: number | null;
  drillable: boolean;
  onClick: () => void;
  code?: string;
}) {
  const v = rec.years[year]?.amount || 0;
  const prev = prevYear != null ? rec.years[prevYear]?.amount || 0 : null;
  const d = prev ? (v - prev) / prev : null;
  const isNew = prevYear != null && !prev && v > 0;
  const share = total ? v / total : 0;

  return (
    <tr className={drillable ? '' : 'disabled'} onClick={drillable ? onClick : undefined}>
      <td className="name">
        <span>{rec.description}</span>
        {code && <span className="desc">{code}</span>}
      </td>
      <td className="bar-cell">
        <div className="bar-h accent">
          <span style={{ width: `${max ? (v / max) * 100 : 0}%` }} />
        </div>
      </td>
      <td className="num">{fmt.php(v, { unit: v >= 1e9 ? 'B' : 'M' })}</td>
      <td className="num">
        <span className="delta">{fmt.pct(share, share >= 0.1 ? 1 : 2)}</span>
      </td>
      <td className="num">
        {isNew ? (
          <span className="delta up">new</span>
        ) : d == null ? (
          <span className="delta">—</span>
        ) : (
          <span className={`delta ${d > 0 ? 'up' : 'down'}`}>{fmt.signedPct(d, 0)}</span>
        )}
      </td>
      <td className="chev">{drillable ? '›' : ''}</td>
    </tr>
  );
}
