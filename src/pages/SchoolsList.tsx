/**
 * `/schools/list` — every school in the registry, 50 at a time, searchable and filterable by EDCOM 2's shortage levels
 * and allocation statuses; the filters live in the address so a list can be shared ("public schools in Region V,
 * underallocated, biggest remaining unfunded first").
 */
import { useSearchParams, Link } from 'react-router-dom';
import { LevelBadge, PreviewNotice, SchoolsChrome, Status, StatusBadge } from '../components/SchoolsBits';
import { php } from '../lib/format';
import { useSchoolsApi } from '../lib/use-schools-api';
import {
  ALLOCATION_STATUS, PROJECT_SETS, REGION_KEYS, SCHOOLS_API, SHORTAGE_LEVELS, UNRATED, num, regionName, rooms, schoolPath, schoolReviewPath,
  type ListFile, type ListSort,
} from '../lib/schools';

const SORT_LABELS: [ListSort, string][] = [
  ['gap', 'Remaining unfunded'], ['shortage', 'Classroom shortage'], ['rate', 'Classroom shortage rate'],
  ['excess', 'Excess allocated classrooms'], ['enrolment', 'Most learners'], ['reports', 'Most field reports'], ['name', 'Name'],
];
const SECTORS: [string, string][] = [['all', 'All'], ['Public', 'Public'], ['Private', 'Private'], ['SUCsLUCs', 'State or local university']];
const CHIPS: [string, string][] = [['division', 'Division'], ['province', 'Province'], ['municipality', 'City or municipality']];

export default function SchoolsList() {
  const [params, setParams] = useSearchParams();
  const get = (k: string, d = '') => params.get(k) ?? d;
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };
  const api = new URLSearchParams();
  for (const k of ['q', 'region', 'division', 'province', 'municipality', 'shortage', 'level', 'status', 'projects', 'page']) {
    if (params.get(k)) api.set(k, params.get(k) as string);
  }
  api.set('sort', get('sort', 'gap'));
  // Public schools unless the address says otherwise; "all" sends no sector.
  const sector = params.get('sector') ?? 'Public';
  if (sector !== 'all') api.set('sector', sector);
  const { data, error, loading } = useSchoolsApi<ListFile>(`${SCHOOLS_API}/list?${api}`);
  const page = data?.meta.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.meta.total / data.meta.per)) : 1;
  // The level select also offers "no shortage data", which the API takes as shortage=nodata.
  const levelValue = get('shortage') === 'nodata' ? 'nodata' : get('level');
  // "projects=yes" (older links) is the FY 2026 allocation.
  const projectsValue = get('projects') === 'yes' ? 'sbp2026' : get('projects');

  return (
    <SchoolsChrome>
      <div className="page-headline">
        <p className="page-eyebrow">Basic education · the registry</p>
        <h1 className="page-title">Every school</h1>
        <p className="page-dek">Search by name, School ID or town, or narrow by region, shortage level and allocation status. Know a school? Press <strong>Review</strong> to tell DepEd and EDCOM 2 whether it needs more classrooms.</p>
      </div>
      <PreviewNotice />

      <div className="sch-listgrid">
        <aside className="sch-panel sch-listside" aria-label="Filters">
          <form className="sch-filters-side" onSubmit={(e) => e.preventDefault()}>
            <label className="sch-field"><span>Search</span>
              <input type="search" defaultValue={get('q')} placeholder="Name, School ID or town"
                onKeyDown={(e) => { if (e.key === 'Enter') set('q', (e.target as HTMLInputElement).value.trim()); }}
                onBlur={(e) => { if (e.target.value.trim() !== get('q')) set('q', e.target.value.trim()); }} />
            </label>
            <label className="sch-field"><span>Region</span>
              <select value={get('region')} onChange={(e) => set('region', e.target.value)}>
                <option value="">All regions</option>
                {REGION_KEYS.map((k) => <option key={k} value={k}>{regionName(k)}</option>)}
              </select>
            </label>
            <label className="sch-field"><span>Sector</span>
              <select value={sector} onChange={(e) => set('sector', e.target.value === 'Public' ? '' : e.target.value)}>
                {SECTORS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </label>
            <label className="sch-field"><span>Shortage level</span>
              <select value={levelValue} onChange={(e) => {
                const v = e.target.value, next = new URLSearchParams(params);
                next.delete('page'); next.delete('shortage'); next.delete('level');
                if (v === 'nodata') next.set('shortage', 'nodata'); else if (v) next.set('level', v);
                setParams(next, { replace: true });
              }}>
                <option value="">Any</option>
                {SHORTAGE_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.key === 'none' ? l.label : `${l.label} (rate ${l.range})`}</option>)}
                <option value="unrated">{UNRATED.label}</option>
            <option value="nodata">No shortage data</option>
              </select>
            </label>
            <label className="sch-field"><span>Allocation status</span>
              <select value={get('status')} onChange={(e) => set('status', e.target.value)}>
                <option value="">Any</option>
                {ALLOCATION_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <label className="sch-field"><span>Sort</span>
              <select value={get('sort', 'gap')} onChange={(e) => set('sort', e.target.value === 'gap' ? '' : e.target.value)}>
                {SORT_LABELS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </label>
          </form>
          <label className="sch-field"><span>Projects</span>
          <select value={projectsValue} onChange={(e) => set('projects', e.target.value)}>
            <option value="">Any</option>
            {PROJECT_SETS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
          {CHIPS.filter(([k]) => get(k)).map(([k, t]) => (
            <p key={k} className="sch-chip">{t}: <strong>{get(k)}</strong> <button type="button" onClick={() => set(k, '')}>Clear</button></p>
          ))}
          {[...params.keys()].some((k) => k !== 'page') && (
            <button type="button" className="sch-linkbtn sch-clearall" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear all filters</button>
          )}
        </aside>

        <section className="sch-listmain" aria-label="Schools">
          <Status error={error} loading={loading && !data}>
            {data && (
              <>
                <p className="sch-count">{num(data.meta.total)} schools{loading ? ' · updating…' : ''}</p>
                <div className="sch-tablewrap">
                  <table className="sch-table">
                    <thead>
                      <tr>
                        <th>School</th><th>Where</th><th className="num">Learners</th><th className="num">Classrooms</th>
                        <th className="num">Shortage</th><th className="num">Allocated FY 2026</th>
                        <th className="num">Remaining unfunded</th><th className="num">2027 House bill</th><th>Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((r) => (
                        <tr key={r.school_id}>
                          <td><Link to={schoolPath(r.school_id)}>{r.school_name}</Link><span className="sch-sub">{r.school_id} · {r.curricular_offering ?? r.sector}{r.in_registry === 0 ? ' · shortage list only' : ''}</span></td>
                          <td>{[r.municipality, r.province].filter(Boolean).join(', ')}<span className="sch-sub">{regionName(r.region_key)} · {r.division}</span></td>
                          <td className="num">{num(r.enrolment_total)}</td>
                          <td className="num">{num(r.instructional_classrooms)}</td>
                          <td className="num">{r.shortage == null ? '—' : rooms(r.shortage)}{r.shortage_rate != null && r.shortage ? <span className="sch-sub">rate {Math.round(r.shortage_rate * 100)}%</span> : null}<span className="sch-sub"><LevelBadge level={r.level} /></span></td>
                          <td className="num">{r.allocated ? rooms(r.allocated) : '—'}<span className="sch-sub"><StatusBadge status={r.status} /></span>{r.modalities && <span className="sch-sub">{r.modalities.replace(/,/g, ', ')}</span>}</td>
                          <td className="num">{r.shortage == null ? '—' : rooms(Math.max(0, r.shortage - r.allocated))}</td>
                      <td className="num">{r.y27_house_php ? php(r.y27_house_php) : r.y27_nep_php ? 'removed' : '—'}{r.y27_added ? <span className="sch-sub">added by the House</span> : null}</td>
                          <td className="sch-reviewcell">
                            <Link className="sch-button sch-button-sm" to={schoolReviewPath(r.school_id)} aria-label={`Review ${r.school_name}`}>Review</Link>
                            <span className="sch-sub">{r.reports ? `${r.reports} ${r.reports === 1 ? 'review' : 'reviews'}` : 'No reviews yet'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <nav className="sch-pager" aria-label="Pages">
                  <button type="button" disabled={page <= 1} onClick={() => set('page', String(page - 1))}>← Previous</button>
                  <span>Page {num(page)} of {num(pages)}</span>
                  <button type="button" disabled={page >= pages} onClick={() => set('page', String(page + 1))}>Next →</button>
                </nav>
              </>
            )}
          </Status>
        </section>
      </div>
    </SchoolsChrome>
  );
}
