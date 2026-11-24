/**
 * `/schools` — every school with 2022 coordinates on one map, coloured by its 2023 classroom shortage, with the
 * schools the 2026 School Building Program lists ringed in blue. Pick a school (on the map or by search) for its
 * card; its page has everything and the field report. Data: src/worker/schools-api.ts.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SchoolsMap from '../components/SchoolsMap';
import { PreviewNotice, SchoolsChrome, ShortageLegend, Stat, Status } from '../components/SchoolsBits';
import { useSchoolsApi } from '../lib/use-schools-api';
import { php } from '../lib/format';
import {
  PROJECT_RING, SCHOOLS_API, SCHOOLS_LIST, SCHOOLS_SHORTAGE, SECTOR_LABEL, classrooms, num, regionName, rooms, schoolPath,
  type AreasFile, type ListFile, type PointsFile, type SchoolFile, type SectorCode,
} from '../lib/schools';

const SECTORS: SectorCode[] = [0, 1, 2];

export default function Schools() {
  const pts = useSchoolsApi<PointsFile>(`${SCHOOLS_API}/points`);
  const regions = useSchoolsApi<AreasFile>(`${SCHOOLS_API}/areas?level=region`);
  const [sectors, setSectors] = useState<SectorCode[]>([0]);
  const [projectsOnly, setProjectsOnly] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [fit, setFit] = useState<[[number, number], [number, number]] | null>(null);
  const [q, setQ] = useState('');
  const search = useSchoolsApi<ListFile>(q.trim().length >= 3 ? `${SCHOOLS_API}/list?q=${encodeURIComponent(q.trim())}&sort=name` : null);

  const where = useMemo(() => new Map((pts.data?.rows ?? []).map((r) => [r[0], r] as const)), [pts.data]);
  const totals = useMemo(() => {
    const rows = regions.data?.rows ?? [];
    const sum = (k: 'schools' | 'with_shortage_data' | 'schools_short' | 'shortage' | 'sbp_classrooms_funded' | 'sbp_classrooms_bidding' | 'sbp_budget_php' | 'reports') =>
      rows.reduce((a, r) => a + r[k], 0);
    return {
      schools: sum('schools'), withData: sum('with_shortage_data'), short: sum('schools_short'), shortage: sum('shortage'),
      funded: sum('sbp_classrooms_funded'), bidding: sum('sbp_classrooms_bidding'), budget: sum('sbp_budget_php'), reports: sum('reports'),
    };
  }, [regions.data]);

  const pick = (id: string) => {
    setPicked(id);
    const r = where.get(id);
    if (r) setFit([[r[1] - 0.02, r[2] - 0.02], [r[1] + 0.02, r[2] + 0.02]]);
  };

  return (
    <SchoolsChrome wide>
      <div className="page-headline">
        <p className="page-eyebrow">Basic education · {totals.schools ? num(totals.schools) : '…'} schools</p>
        <h1 className="page-title">Schools and their classroom shortages</h1>
        <p className="page-dek">
          Every school in DepEd’s registry, where it is, how many classrooms it was short in 2023, and the classrooms the
          2026 School Building Program lists for it. If you know a school, tell us whether the shortage is real.
        </p>
      </div>
      <PreviewNotice />

      <div className="sch-stats">
        <Stat value={rooms(totals.shortage)} label="classrooms short in 2023" note={`${num(totals.short)} schools short, of ${num(totals.withData)} with shortage data`} />
        <Stat value={rooms(totals.funded)} label="classrooms in the 2026 list with a budget" note={`${php(totals.budget)} listed`} />
        <Stat value={rooms(totals.bidding)} label="more classrooms “for bidding”" note="PSIP III, no amount yet" />
        <Stat value={num(totals.reports)} label="field reports so far" note={<Link to={SCHOOLS_LIST + '?sort=shortage&shortage=short'}>Find a school to report on</Link>} />
      </div>

      <div className="sch-mapgrid">
        <aside className="sch-panel">
          <label className="sch-field">
            <span>Find a school</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, School ID or town" />
          </label>
          {q.trim().length >= 3 && (
            <ul className="sch-results">
              {search.loading && <li className="sch-muted">Searching…</li>}
              {search.data?.rows.slice(0, 8).map((r) => (
                <li key={r.school_id}>
                  <button type="button" onClick={() => { pick(r.school_id); setQ(''); }}>
                    <strong>{r.school_name}</strong>
                    <span>{[r.municipality, r.province].filter(Boolean).join(', ')} · {r.school_id}{where.has(r.school_id) ? '' : ' · not on the map'}</span>
                  </button>
                </li>
              ))}
              {search.data && search.data.rows.length === 0 && <li className="sch-muted">No school matches.</li>}
            </ul>
          )}

          <fieldset className="sch-field">
            <legend>Show</legend>
            {SECTORS.map((s) => (
              <label key={s} className="sch-check">
                <input type="checkbox" checked={sectors.includes(s)}
                  onChange={(e) => setSectors(e.target.checked ? [...sectors, s] : sectors.filter((x) => x !== s))} />
                {SECTOR_LABEL[s]} schools
              </label>
            ))}
            <label className="sch-check">
              <input type="checkbox" checked={projectsOnly} onChange={(e) => setProjectsOnly(e.target.checked)} />
              Only schools in the 2026 list
            </label>
          </fieldset>

          <div className="sch-field">
            <span>Classrooms short in 2023</span>
            <ShortageLegend />
            <p className="sch-legend-note"><span className="sch-swatch sch-swatch-ring" style={{ borderColor: PROJECT_RING }} /> In the 2026 School Building Program</p>
          </div>

          {picked ? <PickedCard id={picked} onClose={() => setPicked(null)} /> : (
            <p className="sch-muted">Click a dot for the school. Zoom in to see each one. <Link to={SCHOOLS_SHORTAGE}>Shortages by division →</Link></p>
          )}
        </aside>

        <div className="sch-mapwrap">
          <Status error={pts.error} loading={false}>
            <SchoolsMap mode="points" points={pts.data?.rows ?? []} sectors={sectors} projectsOnly={projectsOnly} selected={picked} onPick={pick} fit={fit} />
          </Status>
          {pts.loading && <p className="sch-maploading">Loading {num(60204)} schools…</p>}
          {pts.data && (
            <p className="sch-mapnote">
              {num(pts.data.meta.with_coordinates)} of {num(pts.data.meta.schools)} schools have 2022 coordinates; the rest are in the <Link to={SCHOOLS_LIST}>list</Link>.
            </p>
          )}
        </div>
      </div>
    </SchoolsChrome>
  );
}

function PickedCard({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, loading } = useSchoolsApi<SchoolFile>(`${SCHOOLS_API}/school/${encodeURIComponent(id)}`);
  const s = data?.school;
  const linked = data?.projects.filter((p) => !p.candidate) ?? [];
  return (
    <div className="sch-card">
      <button type="button" className="sch-card-close" onClick={onClose} aria-label="Close">×</button>
      <Status error={error} loading={loading}>
        {s && (
          <>
            <p className="sch-card-eyebrow">{regionName(s.region_key as string)} · {s.division} · {s.school_id}</p>
            <h2 className="sch-card-title">{s.school_name}</h2>
            <p className="sch-muted">{[s.barangay, s.municipality, s.province].filter(Boolean).join(', ')} · {s.sector} · {s.curricular_offering}</p>
            <dl className="sch-facts">
              <div><dt>Short in 2023</dt><dd>{data?.shortage ? classrooms(data.shortage.total_shortage as number) : 'No data'}</dd></div>
              <div><dt>Learners (2023)</dt><dd>{num(data?.enrollment?.enrolment_total as number | null)}</dd></div>
              <div><dt>Classrooms</dt><dd>{num(s.instructional_classrooms as number | null)}</dd></div>
              <div><dt>2026 list</dt><dd>{linked.length ? classrooms(linked.reduce((a, p) => a + (p.classrooms ?? 0), 0)) : 'None'}</dd></div>
              <div><dt>Field reports</dt><dd>{data?.reports.reports ? `${data.reports.reports} (${data.reports.confirmed} confirm a shortage)` : 'None yet'}</dd></div>
            </dl>
            <Link className="sch-button" to={schoolPath(id)}>Open the school · report from the field</Link>
          </>
        )}
      </Status>
    </div>
  );
}
