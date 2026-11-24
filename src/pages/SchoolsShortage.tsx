/**
 * `/schools/shortage` — the 2023 classroom shortage against the classrooms the 2026 School Building Program lists,
 * by region and by schools division: a map of divisions (sized by shortage, coloured by how much of it the list
 * covers) and the tables behind it. Classrooms in the list are planned, not built (docs/schools-data.md).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SchoolsMap from '../components/SchoolsMap';
import { PreviewNotice, SchoolsChrome, Stat, Status } from '../components/SchoolsBits';
import { useSchoolsApi } from '../lib/use-schools-api';
import { php } from '../lib/format';
import {
  COVERAGE_CLASSES, SCHOOLS_API, SCHOOLS_LIST, classrooms, coverageClass, num, pct, regionName, rooms, type AreaRow, type AreasFile,
} from '../lib/schools';

const allocated = (r: AreaRow) => r.sbp_classrooms_funded + r.sbp_classrooms_bidding;
const gap = (r: AreaRow) => r.gap;

export default function SchoolsShortage() {
  const regions = useSchoolsApi<AreasFile>(`${SCHOOLS_API}/areas?level=region`);
  const divisions = useSchoolsApi<AreasFile>(`${SCHOOLS_API}/areas?level=division`);
  const [region, setRegion] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [sort, setSort] = useState<'gap' | 'shortage' | 'coverage'>('gap');

  const total = useMemo(() => {
    const rows = regions.data?.rows ?? [];
    return rows.reduce((a, r) => ({
      shortage: a.shortage + r.shortage, funded: a.funded + r.sbp_classrooms_funded, bidding: a.bidding + r.sbp_classrooms_bidding,
      budget: a.budget + r.sbp_budget_php, reports: a.reports + r.reports, confirming: a.confirming + r.reports_confirming,
      covered: a.covered + r.covered, notShort: a.notShort + r.listed_not_short, noData: a.noData + r.listed_no_data,
    }), { shortage: 0, funded: 0, bidding: 0, budget: 0, reports: 0, confirming: 0, covered: 0, notShort: 0, noData: 0 });
  }, [regions.data]);
  const maxShortage = Math.max(1, ...(regions.data?.rows ?? []).map((r) => Math.max(r.shortage, allocated(r))));

  const divRows = useMemo(() => {
    const rows = (divisions.data?.rows ?? []).filter((r) => r.division && (!region || r.region_key === region));
    const key = sort === 'gap' ? gap : sort === 'shortage' ? (r: AreaRow) => r.shortage : (r: AreaRow) => -(r.covered / Math.max(r.shortage, 0.5));
    return [...rows].sort((a, b) => key(b) - key(a));
  }, [divisions.data, region, sort]);
  const fit = useMemo((): [[number, number], [number, number]] | null => {
    const pts = divRows.filter((r) => r.lat != null && r.lon != null);
    if (!region || !pts.length) return null;
    const lons = pts.map((r) => r.lon as number), lats = pts.map((r) => r.lat as number);
    return [[Math.min(...lons) - 0.3, Math.min(...lats) - 0.3], [Math.max(...lons) + 0.3, Math.max(...lats) + 0.3]];
  }, [divRows, region]);
  const pickedRow = divRows.find((r) => r.division === picked) ?? divisions.data?.rows.find((r) => r.division === picked) ?? null;

  return (
    <SchoolsChrome wide>
      <div className="page-headline">
        <p className="page-eyebrow">Basic education · shortages vs classrooms</p>
        <h1 className="page-title">Where the classrooms are short, and where the 2026 list puts new ones</h1>
        <p className="page-dek">
          DepEd’s 2023 count of classrooms each school was short, set against the classrooms the 2026 School Building
          Program lists for the same schools. A listed classroom is planned, not built.
        </p>
      </div>
      <PreviewNotice />

      <div className="sch-stats">
        <Stat value={rooms(total.shortage)} label="classrooms short in 2023" />
        <Stat value={rooms(total.funded)} label="classrooms listed for 2026 with a budget" note={php(total.budget)} />
        <Stat value={rooms(total.bidding)} label="more listed “for bidding”" note="PSIP III, from Mar 2027" />
        <Stat value={pct(total.covered, total.shortage)} label="of the shortage the list would cover" note="school by school, if every listed classroom were built" />
        <Stat value={rooms(total.notShort)} label="listed classrooms at schools DepEd counted as not short" note={`and ${rooms(total.noData)} at schools with no shortage data`} /> 
      </div>

      <h2 className="sch-h2">By region</h2>
      <Status error={regions.error} loading={regions.loading}>
        <div className="sch-tablewrap">
          <table className="sch-table sch-bars">
            <thead><tr><th>Region</th><th>Short (2023) and listed (2026)</th><th className="num">Short</th><th className="num">Listed</th><th className="num">Covers</th><th className="num">Reports</th></tr></thead>
            <tbody>
              {(regions.data?.rows ?? []).filter((r) => r.region_key).map((r) => (
                <tr key={r.region_key} className={region === r.region_key ? 'sch-row-picked' : ''}>
                  <td><button type="button" className="sch-linkbtn" onClick={() => { setRegion(region === r.region_key ? null : r.region_key); setPicked(null); }}>{regionName(r.region_key)}</button></td>
                  <td className="sch-barcell">
                    <span className="sch-bar sch-bar-short" style={{ width: `${(r.shortage / maxShortage) * 100}%` }} />
                    <span className="sch-bar sch-bar-funded" style={{ width: `${(r.sbp_classrooms_funded / maxShortage) * 100}%` }} />
                    <span className="sch-bar sch-bar-bidding" style={{ width: `${(r.sbp_classrooms_bidding / maxShortage) * 100}%` }} />
                  </td>
                  <td className="num">{rooms(r.shortage)}</td>
                  <td className="num">{rooms(allocated(r))}</td>
                  <td className="num">{pct(r.covered, r.shortage)}</td>
                  <td className="num">{r.reports ? `${r.reports} (${r.reports_confirming} confirm)` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="sch-legend sch-legend-bars">
          <li><span className="sch-swatch sch-bar-short" />Short in 2023</li>
          <li><span className="sch-swatch sch-bar-funded" />Listed for 2026 with a budget</li>
          <li><span className="sch-swatch sch-bar-bidding" />Listed “for bidding”</li>
        </ul>
      </Status>

      <h2 className="sch-h2">By schools division{region ? ` · ${regionName(region)}` : ''}</h2>
      <p className="sch-muted">
        Each disc is a division at the middle of its schools: its size is the shortage, its colour how much of it the 2026 list covers.
        {region ? <> <button type="button" className="sch-linkbtn" onClick={() => setRegion(null)}>Show every region</button></> : ' Pick a region above to zoom in.'}
      </p>
      <Status error={divisions.error} loading={divisions.loading}>
        <div className="sch-mapgrid">
          <aside className="sch-panel">
            <ul className="sch-legend" aria-label="Share of the shortage covered">
              {COVERAGE_CLASSES.map((c) => <li key={c.label}><span className="sch-swatch" style={{ background: c.color }} />{c.label}</li>)}
            </ul>
            {pickedRow ? <DivisionCard row={pickedRow} /> : <p className="sch-muted">Click a disc for the division.</p>}
          </aside>
          <div className="sch-mapwrap">
            <SchoolsMap mode="areas" areas={divisions.data?.rows ?? []} selected={picked} onPick={setPicked} fit={fit} />
          </div>
        </div>

        <div className="sch-tablehead">
          <p className="sch-count">{num(divRows.length)} divisions</p>
          <label className="sch-field sch-field-inline"><span>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="gap">Shortage left after the 2026 list</option>
              <option value="shortage">Biggest shortage</option>
              <option value="coverage">Least covered</option>
            </select>
          </label>
        </div>
        <div className="sch-tablewrap">
          <table className="sch-table">
            <thead><tr><th>Division</th><th className="num">Schools</th><th className="num">Short (2023)</th><th className="num">Listed with budget</th><th className="num">For bidding</th><th className="num">Left short</th><th className="num">Covers</th><th className="num">At schools not short</th><th className="num">2026 budget</th></tr></thead>
            <tbody>
              {divRows.map((r) => {
                const k = coverageClass(r.covered, r.shortage);
                return (
                  <tr key={`${r.region_key}|${r.division}`} className={picked === r.division ? 'sch-row-picked' : ''}>
                    <td>
                      <button type="button" className="sch-linkbtn" onClick={() => setPicked(r.division)}>{r.division}</button>
                      <span className="sch-sub">{regionName(r.region_key)} · <Link to={`${SCHOOLS_LIST}?division=${encodeURIComponent(r.division ?? '')}&shortage=short`}>its schools</Link></span>
                    </td>
                    <td className="num">{num(r.schools)}</td>
                    <td className="num">{rooms(r.shortage)}</td>
                    <td className="num">{rooms(r.sbp_classrooms_funded)}</td>
                    <td className="num">{rooms(r.sbp_classrooms_bidding)}</td>
                    <td className="num"><strong>{rooms(gap(r))}</strong></td>
                    <td className="num"><span className="sch-dot" style={{ background: COVERAGE_CLASSES[k].color, borderColor: COVERAGE_CLASSES[k].color }} />{pct(r.covered, r.shortage)}</td>
                    <td className="num">{r.listed_not_short ? rooms(r.listed_not_short) : '—'}</td>
                    <td className="num">{r.sbp_budget_php ? php(r.sbp_budget_php) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {divisions.data && divisions.data.meta.unplaced_projects > 0 && (
          <p className="sch-footnote">
            Not counted above: {num(divisions.data.meta.unplaced_projects)} projects ({num(divisions.data.meta.unplaced_classrooms)} classrooms) whose
            School ID is in DepEd’s shortage list but not in its registry, so they belong to no division here.
            Shortages count only schools with a 2023 shortage row; schools without one have no data, not zero.
          </p>
        )}
      </Status>
    </SchoolsChrome>
  );
}

function DivisionCard({ row }: { row: AreaRow }) {
  return (
    <div className="sch-card">
      <p className="sch-card-eyebrow">{regionName(row.region_key)}</p>
      <h2 className="sch-card-title">{row.division}</h2>
      <dl className="sch-facts">
        <div><dt>Schools</dt><dd>{num(row.schools)} ({num(row.public_schools)} public)</dd></div>
        <div><dt>Short in 2023</dt><dd>{classrooms(row.shortage)} at {num(row.schools_short)} schools</dd></div>
        <div><dt>2026 list</dt><dd>{rooms(row.sbp_classrooms_funded)} with a budget, {rooms(row.sbp_classrooms_bidding)} for bidding ({num(row.sbp_projects)} projects)</dd></div>
        <div><dt>Left short</dt><dd>{classrooms(gap(row))}</dd></div>
        <div><dt>Listed at schools not short</dt><dd>{classrooms(row.listed_not_short)}</dd></div>
        <div><dt>Field reports</dt><dd>{row.reports ? `${row.reports} (${row.reports_confirming} confirm a shortage)` : 'None yet'}</dd></div>
      </dl>
      <Link className="sch-button" to={`${SCHOOLS_LIST}?division=${encodeURIComponent(row.division ?? '')}&shortage=short`}>Its schools short of classrooms</Link>
    </div>
  );
}
