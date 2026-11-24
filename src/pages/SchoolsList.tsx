/**
 * `/schools/list` — every school in the registry, 50 at a time, searchable and filterable; the filters live in the
 * address so a list can be shared ("public schools in Region V short of classrooms, biggest gap first").
 */
import { useSearchParams, Link } from 'react-router-dom';
import { PreviewNotice, SchoolsChrome, Status } from '../components/SchoolsBits';
import { useSchoolsApi } from '../lib/use-schools-api';
import { php } from '../lib/format';
import {
  REGION_KEYS, SCHOOLS_API, num, regionName, rooms, schoolPath, shortageClass, SHORTAGE_CLASSES, NO_SHORTAGE_DATA,
  type ListFile, type ListSort, type ShortageFilter,
} from '../lib/schools';

const SORT_LABELS: [ListSort, string][] = [
  ['shortage', 'Biggest shortage'], ['gap', 'Shortage left after the 2026 list'], ['enrolment', 'Most learners'],
  ['reports', 'Most field reports'], ['name', 'Name'],
];
const SHORTAGE_LABELS: [ShortageFilter, string][] = [
  ['any', 'Any'], ['short', 'Short of classrooms'], ['none', 'Not short'], ['nodata', 'No shortage data'],
];
const SECTORS: [string, string][] = [['all', 'All'], ['Public', 'Public'], ['Private', 'Private'], ['SUCsLUCs', 'State or local university']];

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
  for (const k of ['q', 'region', 'division', 'shortage', 'projects', 'sort', 'page']) if (params.get(k)) api.set(k, params.get(k) as string);
  // Public schools unless the address says otherwise; "all" sends no sector.
  const sector = params.get('sector') ?? 'Public';
  if (sector !== 'all') api.set('sector', sector);
  const { data, error, loading } = useSchoolsApi<ListFile>(`${SCHOOLS_API}/list?${api}`);
  const page = data?.meta.page ?? 1;
  const pages = data ? Math.max(1, Math.ceil(data.meta.total / data.meta.per)) : 1;

  return (
    <SchoolsChrome>
      <div className="page-headline">
        <p className="page-eyebrow">Basic education · the registry</p>
        <h1 className="page-title">Every school</h1>
        <p className="page-dek">Search by name, School ID or town, or narrow by region and shortage. Open a school to see all its data and to report what you know.</p>
      </div>
      <PreviewNotice />

      <form className="sch-filters" onSubmit={(e) => e.preventDefault()}>
        <label className="sch-field"><span>Search</span>
          <input type="search" defaultValue={get('q')} placeholder="Name, School ID or town"
            onKeyDown={(e) => { if (e.key === 'Enter') set('q', (e.target as HTMLInputElement).value.trim()); }}
            onBlur={(e) => { if (e.target.value.trim() !== get('q')) set('q', e.target.value.trim()); }} />
        </label>
        <label className="sch-field"><span>Region</span>
          <select value={get('region')} onChange={(e) => { set('region', e.target.value); }}>
            <option value="">All regions</option>
            {REGION_KEYS.map((k) => <option key={k} value={k}>{regionName(k)}</option>)}
          </select>
        </label>
        <label className="sch-field"><span>Sector</span>
          <select value={sector} onChange={(e) => set('sector', e.target.value === 'Public' ? '' : e.target.value)}>
            {SECTORS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
        <label className="sch-field"><span>2023 shortage</span>
          <select value={get('shortage', 'any')} onChange={(e) => set('shortage', e.target.value === 'any' ? '' : e.target.value)}>
            {SHORTAGE_LABELS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
        <label className="sch-field"><span>Sort</span>
          <select value={get('sort', 'shortage')} onChange={(e) => set('sort', e.target.value === 'shortage' ? '' : e.target.value)}>
            {SORT_LABELS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
        <label className="sch-check sch-check-inline">
          <input type="checkbox" checked={get('projects') === 'yes'} onChange={(e) => set('projects', e.target.checked ? 'yes' : '')} />
          In the 2026 list
        </label>
      </form>
      {get('division') && (
        <p className="sch-chip">Division: <strong>{get('division')}</strong> <button type="button" onClick={() => set('division', '')}>Clear</button></p>
      )}

      <Status error={error} loading={loading && !data}>
        {data && (
          <>
            <p className="sch-count">{num(data.meta.total)} schools{loading ? ' · updating…' : ''}</p>
            <div className="sch-tablewrap">
              <table className="sch-table">
                <thead>
                  <tr>
                    <th>School</th><th>Where</th><th className="num">Learners</th><th className="num">Classrooms</th>
                    <th className="num">Short (2023)</th><th className="num">2026 list</th><th className="num">Reports</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => {
                    const c = shortageClass(r.shortage);
                    return (
                      <tr key={r.school_id}>
                        <td><Link to={schoolPath(r.school_id)}>{r.school_name}</Link><span className="sch-sub">{r.school_id} · {r.curricular_offering ?? r.sector}</span></td>
                        <td>{[r.municipality, r.province].filter(Boolean).join(', ')}<span className="sch-sub">{regionName(r.region_key)} · {r.division}</span></td>
                        <td className="num">{num(r.enrolment_total)}</td>
                        <td className="num">{num(r.instructional_classrooms)}</td>
                        <td className="num">
                          <span className="sch-dot" style={c < 0 ? { borderColor: NO_SHORTAGE_DATA } : { background: SHORTAGE_CLASSES[c].color, borderColor: SHORTAGE_CLASSES[c].color }} />
                          {r.shortage == null ? 'No data' : rooms(r.shortage)}
                        </td>
                        <td className="num">{r.sbp_classrooms ? <>{num(r.sbp_classrooms)} rooms<span className="sch-sub">{r.sbp_budget_php ? php(r.sbp_budget_php) : 'for bidding'}</span></> : '—'}</td>
                        <td className="num">{r.reports || '—'}</td>
                      </tr>
                    );
                  })}
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
    </SchoolsChrome>
  );
}
