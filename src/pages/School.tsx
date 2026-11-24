/**
 * `/schools/:id` — one school: the registry entry, each source attached to it (2023 shortage, 2022 coordinates, 2023
 * facilities and enrolment), its 2026 School Building Program projects, any join left for review, and the field
 * reports. Signed-in members (the project reviewer's accounts) can send one report per school and edit it.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import MemberProvider from '../components/HgabReviewMember';
import { PreviewNotice, SchoolsChrome, Status } from '../components/SchoolsBits';
import { useSchoolsApi } from '../lib/use-schools-api';
import { useMember } from '../lib/hgab-review-member';
import { php } from '../lib/format';
import {
  LIMITS, LISTINGS, PROJECT_SEEN, RELATIONS, SCHOOLS_API, SCHOOLS_LIST, SHORTAGE_ANSWERS, SIGNS, classrooms, emptyReport, num, scopeLabel,
  regionName, rooms, type ReportTally, type SchoolFile, type SchoolProject, type SchoolReport,
} from '../lib/schools';

type Row = Record<string, string | number | null>;

export default function SchoolPage() {
  return <MemberProvider><School /></MemberProvider>;
}

function School() {
  const { id = '' } = useParams();
  const { data, error, loading } = useSchoolsApi<SchoolFile>(`${SCHOOLS_API}/school/${encodeURIComponent(id)}`);
  // The tally the last report sent back, for this school; else the one the page loaded with.
  const [sent, setSent] = useState<{ id: string; tally: ReportTally } | null>(null);
  const tally = sent?.id === id ? sent.tally : data?.reports ?? null;
  const setTally = (t: ReportTally) => setSent({ id, tally: t });
  const s = data?.school;
  useEffect(() => { if (s?.school_name) document.title = `${s.school_name} · Schools · BetterGov.ph`; }, [s?.school_name]);

  return (
    <SchoolsChrome>
      <Status error={error} loading={loading}>
        {data && s && (
          <>
            <div className="page-headline">
              <p className="page-eyebrow">
                <Link to={`${SCHOOLS_LIST}?region=${s.region_key ?? ''}`}>{regionName(s.region_key as string)}</Link> ·{' '}
                <Link to={`${SCHOOLS_LIST}?division=${encodeURIComponent(String(s.division))}`}>{s.division}</Link> · School ID {s.school_id}
              </p>
              <h1 className="page-title">{s.school_name}</h1>
              <p className="page-dek">
                {[s.street_address, s.barangay, s.municipality, s.province].filter(Boolean).join(', ')} · {s.sector} · {s.curricular_offering}
                {s.legislative_district ? ` · ${s.legislative_district}` : ''}
              </p>
            </div>
            <PreviewNotice />

            <div className="sch-schoolgrid">
              <div className="sch-schoolmain">
                <Headline data={data} tally={tally} />
                <Projects projects={data.projects} />
                <Section title="Classrooms and learners (2023)">
                  {data.enrollment ? <Enrollment e={data.enrollment} s={s} /> : <Missing what="enrolment" />}
                </Section>
                <Section title="Buildings and facilities (2023)">
                  {data.facilities ? <Facilities f={data.facilities} /> : <Missing what="facilities" />}
                </Section>
                <Section title="Registry entry">
                  <Facts rows={[
                    ['School type', s.school_type], ['Subclassification', s.subclassification], ['Mother school', s.mother_school_id],
                    ['Last-mile school', s.last_mile_school], ['IPEd school', s.iped_implementing], ['School head’s position', s.school_head_position],
                    ['Implementing unit', s.implementing_unit], ['District (DepEd)', s.district],
                  ]} />
                </Section>
                <Section title="How this school was matched">
                  <Facts rows={[
                    ['2023 shortage', `${s.join_shortage ?? 'No match'}${s.join_shortage_method ? ` · ${s.join_shortage_method}` : ''}`],
                    ['2022 coordinates', `${s.join_coordinates ?? 'No match'}${s.join_coordinates_method ? ` · ${s.join_coordinates_method}` : ''}`],
                    ['2023 facilities', `${s.join_facilities ?? 'No match'}${s.join_facilities_method ? ` · ${s.join_facilities_method}` : ''}`],
                    ['2023 enrolment', `${s.join_enrollment ?? 'No match'}${s.join_enrollment_method ? ` · ${s.join_enrollment_method}` : ''}`],
                  ]} />
                  {data.join_review.length > 0 && (
                    <ul className="sch-list">{data.join_review.map((r, i) => <li key={i}><strong>{r.source_sheet}:</strong> {r.join_outcome}{r.fallback_method ? ` (${r.fallback_method})` : ''}</li>)}</ul>
                  )}
                  {data.coordinates && (
                    <p className="sch-muted">
                      2022 coordinates: {Number(data.coordinates.latitude).toFixed(5)}, {Number(data.coordinates.longitude).toFixed(5)} ·{' '}
                      <a href={`https://www.openstreetmap.org/?mlat=${data.coordinates.latitude}&mlon=${data.coordinates.longitude}#map=17/${data.coordinates.latitude}/${data.coordinates.longitude}`} target="_blank" rel="noopener noreferrer">open in OpenStreetMap ↗</a>
                      {data.coordinates.in_ph_bbox === 0 && ' · these fall outside the Philippines, so the school is not on our map'}
                    </p>
                  )}
                </Section>
              </div>
              <aside className="sch-schoolside">
                <ReportBox schoolId={String(s.school_id)} projects={data.projects} shortage={(data.shortage?.total_shortage as number | undefined) ?? null} onTally={setTally} />
              </aside>
            </div>
          </>
        )}
      </Status>
    </SchoolsChrome>
  );
}

function Headline({ data, tally }: { data: SchoolFile; tally: ReportTally | null }) {
  const sh = data.shortage;
  const listed = data.projects.filter((p) => !p.candidate).reduce((a, p) => a + (p.classrooms ?? 0), 0);
  return (
    <div className="sch-headline">
      <div className="sch-big">
        <span className="sch-big-value">{sh ? rooms(sh.total_shortage as number) : '—'}</span>
        <span className="sch-big-label">{sh ? 'classrooms short in 2023' : 'No 2023 shortage data for this school (not the same as none)'}</span>
        {sh && <span className="sch-sub">Kinder to Grade 10: {rooms(sh.shortage_k10 as number)} short, {rooms(sh.excess_k10 as number)} extra · Senior high: {rooms(sh.shortage_shs as number)} short</span>}
      </div>
      <div className="sch-big">
        <span className="sch-big-value">{listed ? num(listed) : '—'}</span>
        <span className="sch-big-label">classrooms in the 2026 School Building Program list</span>
      </div>
      <div className="sch-big">
        <span className="sch-big-value">{tally?.reports ? `${tally.confirmed} of ${tally.reports}` : '0'}</span>
        <span className="sch-big-label">{tally?.reports ? 'field reports confirm a shortage' : 'field reports yet'}</span>
        {tally?.classrooms_needed_median != null && <span className="sch-sub">Reporters say {num(tally.classrooms_needed_median)} more classrooms are needed (median)</span>}
        {tally?.listing_issues ? <span className="sch-sub">{tally.listing_issues} say the listing is wrong (moved, closed or not found)</span> : null}
      </div>
    </div>
  );
}

function Projects({ projects }: { projects: SchoolProject[] }) {
  if (!projects.length) return <Section title="2026 School Building Program"><p className="sch-muted">No project in the 2026 list names this school’s ID.</p></Section>;
  return (
    <Section title="2026 School Building Program">
      <div className="sch-tablewrap">
        <table className="sch-table">
          <thead><tr><th>Project</th><th>Who builds it</th><th>Scope</th><th className="num">Classrooms</th><th className="num">Budget</th><th>Expected</th></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.project_id}>
                <td>{p.project_id}{p.candidate && <span className="sch-sub">Possible match only: the list names {p.src_school_name ?? 'another school'}</span>}</td>
                <td>{p.modality ?? '—'}</td>
                <td>{p.scope_of_work ? scopeLabel(p.scope_of_work) : '—'}</td>
                <td className="num">{num(p.classrooms)}</td>
                <td className="num">{p.budget_php != null ? php(p.budget_php, { unit: 'full' }) : p.budget_allocation_raw ?? '—'}</td>
                <td>{[p.expected_start_raw, p.expected_end_raw].filter(Boolean).join(' to ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sch-footnote">A listed classroom and its budget are what the 2026 list plans. They are not proof that the money was released or the classroom built. If you have seen the work, say so in a field report.</p>
    </Section>
  );
}

function Enrollment({ e, s }: { e: Row; s: Row }) {
  return (
    <Facts rows={[
      ['Learners', `${num(e.enrolment_total as number)} (elementary ${num(e.enrolment_es as number)}, junior high ${num(e.enrolment_jhs as number)}, senior high ${num(e.enrolment_shs as number)})`],
      ['Instructional classrooms', `${num(e.instr_cr_total as number)} (elementary ${num(e.instr_cr_es as number)}, junior high ${num(e.instr_cr_jhs as number)}, senior high ${num(e.instr_cr_shs as number)})`],
      ['Makeshift rooms', `${num(e.makeshift_es as number)} elementary, ${num(e.makeshift_hs as number)} high school`],
      ['Temporary learning spaces', `${num(e.tls_es as number)} elementary, ${num(e.tls_hs as number)} high school`],
      ['Learners per classroom', e.ratio_enrolment_instr_cr != null ? Number(e.ratio_enrolment_instr_cr).toFixed(1) : (e.ratio_enrolment_instr_cr_note as string) ?? '—'],
      ['Learners per room, makeshift and temporary included', e.ratio_enrolment_all_rooms != null ? Number(e.ratio_enrolment_all_rooms).toFixed(1) : (e.ratio_enrolment_all_rooms_note as string) ?? '—'],
      ['Relies on temporary or makeshift rooms', s.tls_mr_band ? `${s.tls_mr_band} of its rooms` : '—'],
    ]} />
  );
}

const AMENITIES: [string, string][] = [
  ['covered_court', 'Covered court'], ['gymnasium', 'Gymnasium'], ['perimeter_fence_permanent', 'Permanent fence'],
  ['playground', 'Playground'], ['garden', 'Garden'], ['solar_panel', 'Solar panels'], ['flood_marker', 'Flood marker'],
  ['paved_pathway', 'Paved pathway'], ['road_paved', 'Paved road'],
];
const ACCESS: [string, string][] = [
  ['walking_hiking', 'on foot'], ['tricycle', 'tricycle'], ['jeepney', 'jeepney'], ['habalhabal', 'habal-habal'],
  ['boat', 'boat'], ['private_4wheel', 'car'], ['private_motorcycle', 'motorcycle'], ['bus', 'bus'], ['uv_express', 'UV Express'],
  ['pedicab', 'pedicab'], ['bicycle', 'bicycle'], ['train', 'train'],
];

function Facilities({ f }: { f: Row }) {
  const has = (k: string) => f[`es_has_${k}`] === 1 || f[`hs_has_${k}`] === 1;
  const by = ACCESS.filter(([k]) => f[`es_accessible_${k}`] === 1 || f[`hs_accessible_${k}`] === 1).map(([, t]) => t);
  const rooms3 = (a: string, b: string, c: string) => [f[a], f[b], f[c]].reduce<number>((x, v) => x + (typeof v === 'number' ? v : 0), 0);
  return (
    <Facts rows={[
      ['Instructional classrooms', num(rooms3('es_classrooms_instructional', 'jhs_classrooms_instructional', 'shs_classrooms_instructional'))],
      ['Other rooms', num(rooms3('es_classrooms_non_instructional', 'jhs_classrooms_non_instructional', 'shs_classrooms_non_instructional'))],
      ['Buildings', `${num(f.buildings_good_condition as number)} in good condition, ${num(f.buildings_needs_minor_repair as number)} need minor repair, ${num(f.buildings_needs_major_repair as number)} major repair, ${num(f.buildings_for_condemnation as number)} for condemnation, ${num(f.buildings_for_demolition as number)} for demolition`],
      ['Being built', `${num(f.buildings_ongoing_construction as number)} under construction, ${num(f.buildings_for_completion as number)} awaiting completion`],
      ['Has', AMENITIES.filter(([k]) => has(k)).map(([, t]) => t).join(', ') || 'None of the listed facilities'],
      ['Reached by', by.join(', ') || '—'],
      ['Managed by', `${f.school_management ?? '—'} · offers ${[f.offers_es ? 'elementary' : null, f.offers_jhs ? 'junior high' : null, f.offers_shs ? 'senior high' : null].filter(Boolean).join(', ') || '—'}`],
    ]} />
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="sch-section"><h2 className="sch-h2">{title}</h2>{children}</section>;
}
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="sch-facts sch-facts-wide">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? '—'}</dd></div>)}</dl>;
}
const Missing = ({ what }: { what: string }) => <p className="sch-muted">No 2023 {what} row was matched to this School ID. That means no data, not zero.</p>;

// ---------------------------------------------------------------------------
// The field report
// ---------------------------------------------------------------------------

function ReportBox({ schoolId, projects, shortage, onTally }: {
  schoolId: string; projects: SchoolProject[]; shortage: number | null; onTally: (t: ReportTally) => void;
}) {
  const member = useMember();
  const [report, setReport] = useState<SchoolReport>(() => emptyReport(schoolId));
  const [saved, setSaved] = useState<SchoolReport | null>(null);
  const [state, setState] = useState<{ busy: boolean; error: string | null; problems: string[]; done: string | null }>({ busy: false, error: null, problems: [], done: null });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!member.userId) return;
    let live = true;
    void (async () => {
      const token = await member.getToken();
      const res = await fetch(`${SCHOOLS_API}/reports/mine?school=${encodeURIComponent(schoolId)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
      const body = (await res.json().catch(() => null)) as { data?: SchoolReport | null } | null;
      if (live && res.ok && body?.data) { setReport({ ...emptyReport(schoolId), ...body.data }); setSaved(body.data); setOpen(true); }
    })();
    return () => { live = false; };
  }, [member.userId, schoolId]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof SchoolReport>(k: K, v: SchoolReport[K]) => setReport((r) => ({ ...r, [k]: v }));
  const call = async (method: 'POST' | 'DELETE') => {
    setState({ busy: true, error: null, problems: [], done: null });
    try {
      const token = await member.getToken();
      const res = await fetch(method === 'POST' ? `${SCHOOLS_API}/reports` : `${SCHOOLS_API}/reports/${saved?.report_id}`, {
        method, cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: method === 'POST' ? JSON.stringify(report) : undefined,
      });
      const body = (await res.json().catch(() => null)) as { data: SchoolReport; reports?: ReportTally; message?: string; problems?: string[] } | null;
      if (!res.ok || !body) { setState({ busy: false, error: body?.message ?? `The server answered ${res.status}.`, problems: body?.problems ?? [], done: null }); return; }
      if (body?.reports) onTally(body.reports);
      if (method === 'POST') { setSaved(body.data); setReport((r) => ({ ...r, report_id: body.data.report_id })); setState({ busy: false, error: null, problems: [], done: 'Sent. Thank you. You can change your report at any time.' }); }
      else { setSaved(null); setReport(emptyReport(schoolId)); setState({ busy: false, error: null, problems: [], done: 'Your report is withdrawn.' }); }
    } catch {
      setState({ busy: false, error: 'We couldn’t reach the server. Check your connection and try again.', problems: [], done: null });
    }
  };
  const shortageHint = shortage == null ? 'DepEd has no 2023 count for this school.' : `DepEd counted ${classrooms(shortage)} short in 2023.`;

  return (
    <div className="sch-report">
      <h2 className="sch-h2">Report from the field</h2>
      <p className="sch-muted">Know this school? Tell DepEd and EDCOM2 whether it is here and whether it really lacks classrooms. Under a minute; your name is never shown, only how many reports agree.</p>
      {!member.enabled && <p className="sch-notice">Sign-in isn’t set up on this copy of the site, so this form can be tried but not sent.</p>}
      {member.enabled && !member.loaded ? (
        <p className="sch-muted">Checking your sign-in…</p>
      ) : member.enabled && !member.userId ? (
        <button type="button" className="sch-button" onClick={member.signIn}>Sign in to report (email code, no password)</button>
      ) : !open ? (
        <button type="button" className="sch-button" onClick={() => setOpen(true)}>Start a report on this school</button>
      ) : (
        <form className="sch-form" onSubmit={(e) => { e.preventDefault(); void call('POST'); }}>
          <Choice legend="1. Is the school here and open?" list={LISTINGS} value={report.listing} onChange={(v) => set('listing', v)} />
          {report.listing !== 'closed' && report.listing !== 'not_found' && (
            <Choice legend="2. Does it lack classrooms?" list={SHORTAGE_ANSWERS} value={report.shortage} onChange={(v) => set('shortage', v)} />
          )}
          {report.shortage === 'confirmed' && report.listing !== 'closed' && report.listing !== 'not_found' && (
            <>
              <NumberField label="3. About how many more classrooms does it need?" value={report.classrooms_needed} max={LIMITS.classrooms}
                onChange={(v) => set('classrooms_needed', v)} hint={shortageHint} />
              <fieldset className="sch-field">
                <legend>4. What do you see? (any that apply)</legend>
                {SIGNS.map(([k, t]) => (
                  <label key={k} className="sch-check">
                    <input type="checkbox" checked={report.signs.includes(k)}
                      onChange={(e) => set('signs', e.target.checked ? [...report.signs, k] : report.signs.filter((x) => x !== k))} />{t}
                  </label>
                ))}
              </fieldset>
            </>
          )}
          {projects.length > 0 && (
            <fieldset className="sch-field">
              <legend>5. What have you seen of the 2026 {projects.length === 1 ? 'project' : 'projects'}?</legend>
              {projects.map((p) => (
                <label key={p.project_id} className="sch-field sch-field-inline">
                  <span>{scopeLabel(p.scope_of_work)}<span className="sch-sub">{p.project_id} · {p.modality ?? ''}</span></span>
                  <select value={report.projects[p.project_id] ?? ''} onChange={(e) => {
                    const next = { ...report.projects };
                    if (e.target.value) next[p.project_id] = e.target.value as SchoolReport['projects'][string]; else delete next[p.project_id];
                    set('projects', next);
                  }}>
                    <option value="">Don’t know</option>
                    {PROJECT_SEEN.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                  </select>
                </label>
              ))}
            </fieldset>
          )}
          <Choice legend={`${projects.length > 0 ? 6 : 5}. How do you know this school?`} list={RELATIONS} value={report.relation} onChange={(v) => set('relation', v)} />
          <label className="sch-field"><span>Anything else? (optional)</span>
            <textarea maxLength={LIMITS.notes} rows={3} value={report.notes} onChange={(e) => set('notes', e.target.value)}
              placeholder={report.listing && report.listing !== 'open' ? 'Where is it now, or when did it close?' : 'What DepEd should know'} />
            <span className="sch-sub">Don’t write anyone’s name or contact details.</span>
          </label>
          <label className="sch-field"><span>Photo links (optional, https, up to {LIMITS.photos})</span>
            <textarea rows={2} value={report.photo_links.join('\n')} placeholder="https://…"
              onChange={(e) => set('photo_links', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, LIMITS.photos))} />
          </label>
          {state.error && <p className="sch-error" role="alert">{state.error}{state.problems.length > 0 && <> ({state.problems.join(' ')})</>}</p>}
          {state.done && <p className="sch-done" role="status">{state.done}</p>}
          <div className="sch-actions">
            <button type="submit" className="sch-button" disabled={state.busy || !member.enabled}>{saved ? 'Update my report' : 'Send my report'}</button>
            {saved && <button type="button" className="sch-linkbtn" disabled={state.busy} onClick={() => void call('DELETE')}>Withdraw it</button>}
          </div>
          {member.userId && <p className="sch-sub">Signed in as {member.email}. <button type="button" className="sch-linkbtn" onClick={member.signOut}>Sign out</button></p>}
        </form>
      )}
    </div>
  );
}

function Choice<T extends string>({ legend, list, value, onChange }: { legend: string; list: readonly (readonly [T, string])[]; value: T | null; onChange: (v: T | null) => void }) {
  return (
    <fieldset className="sch-field sch-choice">
      <legend>{legend}</legend>
      {list.map(([k, t]) => (
        <label key={k} className={`sch-pill${value === k ? ' on' : ''}`}>
          <input type="radio" checked={value === k} onChange={() => onChange(k)} onClick={() => { if (value === k) onChange(null); }} />{t}
        </label>
      ))}
    </fieldset>
  );
}

function NumberField({ label, value, max, onChange, hint }: { label: string; value: number | null; max: number; onChange: (v: number | null) => void; hint?: string }) {
  return (
    <label className="sch-field"><span>{label}</span>
      <input type="number" inputMode="numeric" min={1} max={max} step={1} value={value ?? ''}
        onChange={(e) => { const n = Number.parseInt(e.target.value, 10); onChange(Number.isFinite(n) ? Math.min(max, Math.max(1, n)) : null); }} />
      {hint && <span className="sch-sub">{hint}</span>}
    </label>
  );
}
