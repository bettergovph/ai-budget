/**
 * `/schools` — every school with 2022 coordinates on one map, coloured by its 2023 classroom shortage, with the
 * schools the 2026 School Building Program lists ringed in blue. Pick a school (on the map or by search) for its
 * card; its page has everything and the field report. Data: src/worker/schools-api.ts.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SchoolsMap from '../components/SchoolsMap';
import { LevelBadge, PreviewNotice, SchoolsChrome, ShortageLegend, Stat, Status, StatusBadge, StatusLegend } from '../components/SchoolsBits';
import { php } from '../lib/format';
import { useSchoolsApi } from '../lib/use-schools-api';
import {
  PROJECT_SETS, SCHOOLS_API, SCHOOLS_API_VERSION, SCHOOLS_LIST, SCHOOLS_SHORTAGE, SECTOR_LABEL, classrooms, levelOf, num, pct, regionName, rooms,
  schoolPath, schoolReviewPath, statusOf, type ProjectSet,
  type AreasFile, type ListFile, type PointsFile, type SchoolFile, type SectorCode,
} from '../lib/schools';

const SECTORS: SectorCode[] = [0, 1, 2];

export default function Schools() {
  const pts = useSchoolsApi<PointsFile>(`${SCHOOLS_API}/points?v=${SCHOOLS_API_VERSION}`);
  const regions = useSchoolsApi<AreasFile>(`${SCHOOLS_API}/areas?level=region&v=${SCHOOLS_API_VERSION}`);
  const [sectors, setSectors] = useState<SectorCode[]>([0]);
  const [projectsOnly, setProjectsOnly] = useState(false);
  const [ring, setRing] = useState<ProjectSet>('sbp2026');
  const [colorBy, setColorBy] = useState<'level' | 'status'>('level');
  const [picked, setPicked] = useState<string | null>(null);
  const [fit, setFit] = useState<[[number, number], [number, number]] | null>(null);
  const [q, setQ] = useState('');
  const search = useSchoolsApi<ListFile>(q.trim().length >= 3 ? `${SCHOOLS_API}/list?q=${encodeURIComponent(q.trim())}&sort=name` : null);

  const ringInfo = PROJECT_SETS.find((x) => x.key === ring) ?? PROJECT_SETS[0];
  const where = useMemo(() => new Map((pts.data?.rows ?? []).map((r) => [r[0], r] as const)), [pts.data]);
  const totals = useMemo(() => {
    const rows = regions.data?.rows ?? [];
    const sum = (k: 'schools' | 'with_shortage_data' | 'schools_short' | 'shortage' | 'allocated' | 'gap' | 'excess' | 'reports') =>
      rows.reduce((a, r) => a + r[k], 0);
    return {
      schools: sum('schools'), withData: sum('with_shortage_data'), short: sum('schools_short'), shortage: sum('shortage'),
      allocated: sum('allocated'), gap: sum('gap'), excess: sum('excess'), reports: sum('reports'),
    };
  }, [regions.data]);

  const pickedRow = picked ? where.get(picked) : undefined;
  const pickedAt: [number, number] | null = pickedRow ? [pickedRow[1], pickedRow[2]] : null;
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
          Every school in DepEd’s registry, where it is, its classroom shortage in SY 2023–2024, and the classrooms the
          FY 2026 School Building Program allocates to it. If you know a school, tell us whether the shortage is real.
        </p>
      </div>
      <PreviewNotice />

      <div className="sch-stats">
        <Stat value={num(totals.short)} label="schools with shortages" note={`out of ${num(totals.withData)} schools with shortage data`} />
        <Stat value={rooms(totals.shortage)} label="classroom shortage" note="classrooms needed, SY 2023–2024" />
        <Stat value={rooms(totals.allocated)} label="classrooms for allocation" note={`FY 2026; ${pct(totals.allocated, totals.shortage)} of the shortage (allocation-to-shortage ratio)`} />
        <Stat value={rooms(totals.gap)} label="remaining unfunded" note={`${rooms(totals.excess)} allocated classrooms exceed recorded needs`} />
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
          </fieldset>

          <div className="sch-field">
            <label className="sch-field"><span>Projects</span>
              <select value={ring} onChange={(e) => setRing(e.target.value as ProjectSet)}>
                {PROJECT_SETS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
            </label>
            <label className="sch-check">
              <input type="checkbox" checked={projectsOnly} onChange={(e) => setProjectsOnly(e.target.checked)} />
              Only schools with these projects
            </label>
          </div>

          <div className="sch-field">
            <span>Colour schools by</span>
            <div className="sch-seg" role="group" aria-label="Colour schools by">
              <button type="button" aria-pressed={colorBy === 'level'} onClick={() => setColorBy('level')}>Shortage level</button>
              <button type="button" aria-pressed={colorBy === 'status'} onClick={() => setColorBy('status')}>Allocation status</button>
            </div>
            {colorBy === 'level' ? <ShortageLegend /> : <StatusLegend />}
            {(colorBy === 'level' || ring !== 'sbp2026') && (
              <p className="sch-legend-note"><span className="sch-swatch sch-swatch-ring" style={{ borderColor: ringInfo.color }} /> {ringInfo.label}</p>
            )}
          </div>

          {/* A school with coordinates gets its card on the map, above its dot; one without (picked from search) here. */}
          {picked && !where.has(picked) ? <PickedCard id={picked} onClose={() => setPicked(null)} /> : (
            <p className="sch-muted">Click a dot for the school. Zoom in to see each one. <Link to={SCHOOLS_SHORTAGE}>Shortages by division →</Link></p>
          )}
        </aside>

        <div className="sch-mapwrap">
          <Status error={pts.error} loading={false}>
            <SchoolsMap mode="points" points={pts.data?.rows ?? []} sectors={sectors} ring={ring} projectsOnly={projectsOnly} colorBy={colorBy} selected={picked} onPick={pick} fit={fit}
              popup={picked && pickedAt ? { at: pickedAt, content: <PickedCard id={picked} onClose={() => setPicked(null)} />, onClose: () => setPicked(null) } : null} />
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
  const allocated = linked.reduce((a, p) => a + (p.classrooms ?? 0), 0);
  const y27 = (data?.y2027 ?? []).filter((l) => l.confident === 1);
  const shortage = data?.shortage ? Math.round(data.shortage.total_shortage as number) : null;
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
              <div><dt>Shortage</dt><dd>{shortage == null ? 'No data' : classrooms(shortage)} <LevelBadge level={levelOf(shortage, s.instructional_classrooms as number | null)} /></dd></div>
              <div><dt>Allocated FY 2026</dt><dd>{classrooms(allocated)} <StatusBadge status={statusOf(shortage, allocated)} /></dd></div>
              <div><dt>Learners</dt><dd>{num(data?.enrollment?.enrolment_total as number | null)} · {num(s.instructional_classrooms as number | null)} classrooms</dd></div>
              <div><dt>2027 proposals</dt><dd>{y27.length ? `${y27.length} DPWH ${y27.length === 1 ? 'project' : 'projects'}: ${php(y27.reduce((a, l) => a + (l.house_php ?? 0), 0))} in the House bill${y27.some((l) => l.change === 'added') ? ', added by the House' : ''}` : 'None naming it'}</dd></div>
              <div><dt>Field reports</dt><dd>{data?.reports.reports ? `${data.reports.reports} (${data.reports.confirmed} say it needs classrooms)` : 'None yet'}</dd></div>
            </dl>
            <span className="sch-cardactions"><Link className="sch-button" to={schoolReviewPath(id)}>Review</Link> <Link to={schoolPath(id)}>Open the school →</Link></span>
          </>
        )}
      </Status>
    </div>
  );
}
