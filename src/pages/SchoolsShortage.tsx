/**
 * `/schools/shortage` — "Classroom Shortage and Allocation Status", in EDCOM 2's terms (docs/schools-edcom2-
 * reconciliation.md): the SY 2023–2024 classroom shortage against the FY 2026 classrooms for allocation, by region,
 * by schools division (map and table) and by city or municipality (with its income class). Shortage is blue,
 * allocation green, as in EDCOM 2's legend. A classroom for allocation is planned, not built.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SchoolsMap from '../components/SchoolsMap';
import { PreviewNotice, SchoolsChrome, Stat, Status } from '../components/SchoolsBits';
import { useSchoolsApi } from '../lib/use-schools-api';
import { php } from '../lib/format';
import {
  COVERAGE_CLASSES, EDCOM2_COST_PER_CLASSROOM, REGION_KEYS, SCHOOLS_API, SCHOOLS_API_VERSION, SCHOOLS_LIST, classrooms, coverageClass,
  num, pct, regionName, rooms, type AreaRow, type AreasFile, type AreaTotals,
} from '../lib/schools';

const SUM_KEYS: (keyof AreaTotals)[] = [
  'schools', 'public_schools', 'with_shortage_data', 'schools_short', 'shortage', 'sbp_projects', 'allocated', 'sbp_classrooms_funded',
  'sbp_classrooms_bidding', 'sbp_budget_php', 'covered', 'gap', 'excess', 'excess_no_shortage', 'excess_budget_php', 'allocated_no_data',
  'schools_under', 'schools_fully', 'schools_over', 'schools_moderate', 'schools_severe', 'schools_extreme', 'instructional_classrooms', 'instructional_with_data',
];
function total(rows: AreaTotals[]): AreaTotals {
  const out = Object.fromEntries(SUM_KEYS.map((k) => [k, 0])) as unknown as AreaTotals;
  for (const r of rows) for (const k of SUM_KEYS) out[k] += r[k] ?? 0;
  return out;
}
const ratio = (r: AreaTotals) => pct(r.allocated, r.shortage);
type Sort = 'gap' | 'shortage' | 'ratio' | 'excess';
const SORTS: [Sort, string][] = [['gap', 'Remaining unfunded'], ['shortage', 'Classroom shortage'], ['ratio', 'Lowest allocation-to-shortage ratio'], ['excess', 'Excess allocated classrooms']];
const sortKey = (s: Sort) => (r: AreaRow) => (s === 'ratio' ? -(r.shortage > 0 ? r.allocated / r.shortage : Infinity) : r[s]);

export default function SchoolsShortage() {
  const v = SCHOOLS_API_VERSION;
  const regions = useSchoolsApi<AreasFile>(`${SCHOOLS_API}/areas?level=region&v=${v}`);
  const divisions = useSchoolsApi<AreasFile>(`${SCHOOLS_API}/areas?level=division&v=${v}`);
  const [region, setRegion] = useState<string | null>(null);
  const [view, setView] = useState<'division' | 'lgu'>('division');
  const lgus = useSchoolsApi<AreasFile>(view === 'lgu' ? `${SCHOOLS_API}/areas?level=lgu&v=${v}${region ? `&region=${region}` : ''}` : null);
  const [picked, setPicked] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('gap');

  const scope = useMemo(() => total((regions.data?.rows ?? []).filter((r) => !region || r.region_key === region)), [regions.data, region]);
  const maxBar = Math.max(1, ...(regions.data?.rows ?? []).map((r) => Math.max(r.shortage, r.allocated)));
  const divRows = useMemo(() => {
    const rows = (divisions.data?.rows ?? []).filter((r) => r.division && (!region || r.region_key === region));
    return [...rows].sort((a, b) => sortKey(sort)(b) - sortKey(sort)(a));
  }, [divisions.data, region, sort]);
  const lguRows = useMemo(() => [...(lgus.data?.rows ?? [])].sort((a, b) => sortKey(sort)(b) - sortKey(sort)(a)), [lgus.data, sort]);
  const fit = useMemo((): [[number, number], [number, number]] | null => {
    const pts = divRows.filter((r) => r.lat != null && r.lon != null);
    if (!region || !pts.length) return null;
    const lons = pts.map((r) => r.lon as number), lats = pts.map((r) => r.lat as number);
    return [[Math.min(...lons) - 0.3, Math.min(...lats) - 0.3], [Math.max(...lons) + 0.3, Math.max(...lats) + 0.3]];
  }, [divRows, region]);
  const pickedRow = divisions.data?.rows.find((r) => r.division === picked) ?? null;
  const where = region ? regionName(region) : 'the Philippines';

  return (
    <SchoolsChrome wide>
      <div className="page-headline">
        <p className="page-eyebrow">Basic education · classroom shortage and allocation status</p>
        <h1 className="page-title">Where classrooms are short, and where the FY 2026 allocations go</h1>
        <p className="page-dek">
          DepEd’s classroom shortage for SY 2023–2024 against the classrooms the FY 2026 School Building Program allocates,
          school by school, in EDCOM 2’s terms. A classroom for allocation is planned, not built.
        </p>
      </div>
      <PreviewNotice />

      <div className="sch-scopebar">
        <label className="sch-field sch-field-inline"><span>Area</span>
          <select value={region ?? ''} onChange={(e) => { setRegion(e.target.value || null); setPicked(null); }}>
            <option value="">The Philippines</option>
            {REGION_KEYS.map((k) => <option key={k} value={k}>{regionName(k)}</option>)}
          </select>
        </label>
      </div>
      <div className="sch-stats">
        <Stat value={num(scope.schools_short)} label="schools with shortages" note={`out of ${num(scope.with_shortage_data)} schools with shortage data in ${where}`} />
        <Stat value={rooms(scope.shortage)} label="classroom shortage" note={`out of ${num(scope.instructional_with_data + scope.shortage)} total classrooms needed (available + shortage) in ${where}`} />
        <Stat value={rooms(scope.allocated)} label="classrooms for allocation" note={`out of ${rooms(scope.shortage)} total shortage in ${where}`} />
        <Stat value={ratio(scope)} label="allocation-to-shortage ratio" note="total allocated classrooms ÷ total classroom shortage × 100" />
        <Stat value={rooms(scope.gap)} label="remaining unfunded" note="classrooms still needed after allocations, not counting excess allocated elsewhere" />
        <Stat value={rooms(scope.excess)} label="excess allocated classrooms"
          note={<>{rooms(scope.excess_no_shortage)} at schools with no recorded shortage. Estimated funds: {php(scope.excess * EDCOM2_COST_PER_CLASSROOM)} at ₱2.5M a classroom; {php(scope.excess_budget_php)} from the projects’ own budgets</>} />
      </div>

      {!region && (
        <>
          <h2 className="sch-h2">By region</h2>
          <Status error={regions.error} loading={regions.loading}>
            <div className="sch-tablewrap">
              <table className="sch-table sch-bars">
                <thead><tr><th>Region</th><th>Shortage and allocation</th><th className="num">Shortage</th><th className="num">Allocated</th><th className="num">Ratio</th><th className="num">Remaining unfunded</th><th className="num">Excess</th></tr></thead>
                <tbody>
                  {(regions.data?.rows ?? []).filter((r) => r.region_key).map((r) => (
                    <tr key={r.region_key}>
                      <td><button type="button" className="sch-linkbtn" onClick={() => setRegion(r.region_key)}>{regionName(r.region_key)}</button></td>
                      <td className="sch-barcell">
                        <span className="sch-bar sch-bar-short" style={{ width: `${(r.shortage / maxBar) * 100}%` }} />
                        <span className="sch-bar sch-bar-funded" style={{ width: `${(r.sbp_classrooms_funded / maxBar) * 100}%` }} />
                        <span className="sch-bar sch-bar-bidding" style={{ width: `${(r.sbp_classrooms_bidding / maxBar) * 100}%` }} />
                      </td>
                      <td className="num">{rooms(r.shortage)}</td>
                      <td className="num">{rooms(r.allocated)}</td>
                      <td className="num">{ratio(r)}</td>
                      <td className="num"><strong>{rooms(r.gap)}</strong></td>
                      <td className="num">{rooms(r.excess)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="sch-legend sch-legend-bars">
              <li><span className="sch-swatch sch-bar-short" />Classroom shortage, SY 2023–2024</li>
              <li><span className="sch-swatch sch-bar-funded" />Allocated FY 2026, with a budget</li>
              <li><span className="sch-swatch sch-bar-bidding" />Allocated FY 2026, “for bidding”</li>
            </ul>
          </Status>
        </>
      )}

      <h2 className="sch-h2">By schools division{region ? ` · ${regionName(region)}` : ''}</h2>
      <p className="sch-muted">Each disc is a division at the middle of its schools: its size is the shortage, its colour how much of it the FY 2026 allocations fill, school by school.</p>
      <Status error={divisions.error} loading={divisions.loading}>
        <div className="sch-mapgrid">
          <aside className="sch-panel">
            <ul className="sch-legend" aria-label="Share of the shortage filled, school by school">
              {COVERAGE_CLASSES.map((c) => <li key={c.label}><span className="sch-swatch" style={{ background: c.color }} />{c.label}</li>)}
            </ul>
            {pickedRow ? <DivisionCard row={pickedRow} /> : <p className="sch-muted">Click a disc for the division.</p>}
          </aside>
          <div className="sch-mapwrap">
            <SchoolsMap mode="areas" areas={divisions.data?.rows ?? []} selected={picked} onPick={setPicked} fit={fit} />
          </div>
        </div>
      </Status>

      <div className="sch-tablehead">
        <div className="sch-seg" role="group" aria-label="Areas">
          <button type="button" aria-pressed={view === 'division'} onClick={() => setView('division')}>Schools divisions</button>
          <button type="button" aria-pressed={view === 'lgu'} onClick={() => setView('lgu')}>Cities and municipalities</button>
        </div>
        <label className="sch-field sch-field-inline"><span>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {SORTS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
      </div>
      {view === 'division'
        ? <AreaTable rows={divRows} kind="division" picked={picked} onPick={setPicked} />
        : (
          <Status error={lgus.error} loading={lgus.loading}>
            <AreaTable rows={lguRows} kind="lgu" picked={null} onPick={() => {}} />
          </Status>
        )}
      {divisions.data && divisions.data.meta.unplaced_projects > 0 && (
        <p className="sch-footnote">
          Not counted above: {num(divisions.data.meta.unplaced_projects)} projects ({num(divisions.data.meta.unplaced_classrooms)} classrooms) whose
          School ID is in DepEd’s shortage list but not in its registry. Shortages are DepEd’s figures rounded to whole classrooms per school
          (the unrounded national total is 164,763); schools without a shortage figure have no data, not zero.
        </p>
      )}
    </SchoolsChrome>
  );
}

const MAX_ROWS = 400;

function AreaTable({ rows, kind, picked, onPick }: { rows: AreaRow[]; kind: 'division' | 'lgu'; picked: string | null; onPick: (d: string) => void }) {
  const shown = rows.slice(0, MAX_ROWS);
  const listLink = (r: AreaRow) => kind === 'division'
    ? `${SCHOOLS_LIST}?division=${encodeURIComponent(r.division ?? '')}&status=under`
    : `${SCHOOLS_LIST}?province=${encodeURIComponent(r.province ?? '')}&municipality=${encodeURIComponent(r.municipality ?? '')}`;
  return (
    <>
      <p className="sch-count">{num(rows.length)} {kind === 'division' ? 'divisions' : 'cities and municipalities'}{rows.length > MAX_ROWS ? `; the first ${MAX_ROWS} shown (pick a region for the rest)` : ''}</p>
      <div className="sch-tablewrap">
        <table className="sch-table">
          <thead>
            <tr>
              <th>{kind === 'division' ? 'Division' : 'City or municipality'}</th><th className="num">Schools</th><th className="num">Shortage</th>
              <th className="num">Allocated</th><th className="num">Ratio</th><th className="num">Remaining unfunded</th><th className="num">Excess</th>
              <th className="num">Under · Fully · Over</th><th className="num">FY 2026 budget</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const k = coverageClass(r.covered, r.shortage);
              const name = kind === 'division' ? r.division : r.municipality;
              return (
                <tr key={`${r.region_key}|${r.division}|${r.province}|${r.municipality}`} className={kind === 'division' && picked === r.division ? 'sch-row-picked' : ''}>
                  <td>
                    {kind === 'division' ? <button type="button" className="sch-linkbtn" onClick={() => onPick(r.division ?? '')}>{name}</button> : name}
                    <span className="sch-sub">
                      {kind === 'lgu' ? `${r.province ?? ''}${r.income_class ? ` · ${r.income_class}` : ''} · ` : `${regionName(r.region_key)} · `}
                      <Link to={listLink(r)}>its schools</Link>
                    </span>
                  </td>
                  <td className="num">{num(r.schools)}</td>
                  <td className="num">{rooms(r.shortage)}</td>
                  <td className="num">{rooms(r.allocated)}{r.sbp_classrooms_bidding ? <span className="sch-sub">{rooms(r.sbp_classrooms_bidding)} for bidding</span> : null}</td>
                  <td className="num"><span className="sch-dot" style={{ background: COVERAGE_CLASSES[k].color, borderColor: COVERAGE_CLASSES[k].color }} />{ratio(r)}</td>
                  <td className="num"><strong>{rooms(r.gap)}</strong></td>
                  <td className="num">{r.excess ? rooms(r.excess) : '—'}</td>
                  <td className="num">{num(r.schools_under)} · {num(r.schools_fully)} · {num(r.schools_over)}</td>
                  <td className="num">{r.sbp_budget_php ? php(r.sbp_budget_php) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DivisionCard({ row }: { row: AreaRow }) {
  return (
    <div className="sch-card">
      <p className="sch-card-eyebrow">{regionName(row.region_key)}</p>
      <h2 className="sch-card-title">{row.division}</h2>
      <dl className="sch-facts">
        <div><dt>Schools</dt><dd>{num(row.schools)} ({num(row.public_schools)} public)</dd></div>
        <div><dt>Shortage</dt><dd>{classrooms(row.shortage)} at {num(row.schools_short)} schools</dd></div>
        <div><dt>Allocated</dt><dd>{classrooms(row.allocated)} ({ratio(row)} of the shortage)</dd></div>
        <div><dt>Remaining unfunded</dt><dd>{classrooms(row.gap)}</dd></div>
        <div><dt>Excess allocated</dt><dd>{classrooms(row.excess)}</dd></div>
        <div><dt>Schools</dt><dd>{num(row.schools_under)} underallocated, {num(row.schools_fully)} fully, {num(row.schools_over)} overallocated</dd></div>
      </dl>
      <Link className="sch-button" to={`${SCHOOLS_LIST}?division=${encodeURIComponent(row.division ?? '')}&status=under`}>Its underallocated schools</Link>
    </div>
  );
}
