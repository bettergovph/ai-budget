/**
 * `/schools/:id` — one school: the registry entry, each source attached to it (2023 shortage, 2022 coordinates, 2023
 * facilities and enrolment), its 2026 School Building Program projects, any join left for review, and the field
 * reports. Signed-in members (the project reviewer's accounts) can send one report per school and edit it.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import DpwhContractLink from '../components/DpwhContractLink';
import MemberProvider from '../components/HgabReviewMember';
import { LevelBadge, PreviewNotice, SchoolsChrome, Status, StatusBadge } from '../components/SchoolsBits';
import { useSchoolsApi } from '../lib/use-schools-api';
import { useMember } from '../lib/hgab-review-member';
import { php } from '../lib/format';
import {
  COUNT_FIELDS, DPWH_MATCH_LABEL, LIMITS, LISTINGS, NEEDS, NEED_REASONS, NO_DATA_EXPLAINED, NO_NEED_REASONS, PROJECT_SEEN, RELATIONS,
  SCHOOLS_API, SCHOOLS_LIST, SHORTAGE_LIST_ONLY, SITE, classrooms, disputesData, dpwhKey, emptyReport, levelOf, num, regionName, rooms, scopeLabel,
  shortageRate, statusOf, type DpwhProject, type ReportTally, type SchoolFile, type SchoolProject, type SchoolReport,
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
            {s.in_registry === 0 && <p className="sch-notice sch-notice-info" role="note">{SHORTAGE_LIST_ONLY}</p>}

            <div className="sch-schoolgrid">
              <div className="sch-schoolmain">
                <Headline data={data} tally={tally} />
                <Projects projects={data.projects} />
                <History dpwh={data.dpwh ?? []} />
                <Section title="Classrooms and learners, SY 2023–2024">
                  {data.enrollment ? <Enrollment e={data.enrollment} s={s} /> : <Missing what="enrolment" />}
                </Section>
                <Section title="Buildings and facilities, SY 2023–2024">
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
                    ['SY 2023–2024 shortage', `${s.join_shortage ?? 'No match'}${s.join_shortage_method ? ` · ${s.join_shortage_method}` : ''}`],
                    ['2022 coordinates', `${s.join_coordinates ?? 'No match'}${s.join_coordinates_method ? ` · ${s.join_coordinates_method}` : ''}`],
                    ['SY 2023–2024 facilities', `${s.join_facilities ?? 'No match'}${s.join_facilities_method ? ` · ${s.join_facilities_method}` : ''}`],
                    ['SY 2023–2024 enrolment', `${s.join_enrollment ?? 'No match'}${s.join_enrollment_method ? ` · ${s.join_enrollment_method}` : ''}`],
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
                <ReportBox schoolId={String(s.school_id)} projects={askAbout(data)}
                  shortage={data.shortage ? Math.round(data.shortage.total_shortage as number) : null}
                  allocated={data.projects.filter((p) => !p.candidate).reduce((a, p) => a + (p.classrooms ?? 0), 0)} onTally={setTally} />
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
  const shortage = sh ? Math.round(sh.total_shortage as number) : null;
  const allocated = data.projects.filter((p) => !p.candidate).reduce((a, p) => a + (p.classrooms ?? 0), 0);
  const status = statusOf(shortage, allocated);
  const rate = shortageRate(shortage, data.school.instructional_classrooms as number | null);
  return (
    <div className="sch-headline">
      <div className="sch-big">
        <span className="sch-big-value">{shortage == null ? '—' : num(shortage)}</span>
        <span className="sch-big-label">{shortage == null ? 'No shortage data' : `classroom shortage, SY 2023–2024`}</span>
        <span className="sch-sub"><LevelBadge level={levelOf(shortage, data.school.instructional_classrooms as number | null)} />{rate != null && ` · shortage rate ${Math.round(rate * 100)}%`}</span>
        {shortage == null
          ? <span className="sch-sub">{NO_DATA_EXPLAINED}</span>
          : <span className="sch-sub">Kinder to Grade 10: {rooms(sh?.shortage_k10 as number)} short, {rooms(sh?.excess_k10 as number)} extra · Senior high: {rooms(sh?.shortage_shs as number)} short</span>}
      </div>
      <div className="sch-big">
        <span className="sch-big-value">{num(allocated)}</span>
        <span className="sch-big-label">classrooms for allocation, FY 2026</span>
        <span className="sch-sub"><StatusBadge status={status} /></span>
        {shortage != null && status === 'under' && <span className="sch-sub">Remaining unfunded: {classrooms(shortage - allocated)}</span>}
        {shortage != null && status === 'over' && <span className="sch-sub">Excess allocated: {classrooms(allocated - shortage)}{shortage === 0 ? ', at a school with no recorded shortage' : ''}</span>}
      </div>
      <div className="sch-big">
        <span className="sch-big-value">{tally?.reports ? `${tally.confirmed} of ${tally.reports}` : '0'}</span>
        <span className="sch-big-label">{tally?.reports ? 'field reports say it needs more classrooms' : 'field reports yet'}</span>
        {tally?.classrooms_needed_median != null && <span className="sch-sub">Reporters say about {num(tally.classrooms_needed_median)} more are needed (median)</span>}
        {tally?.listing_issues ? <span className="sch-sub">{tally.listing_issues} say the school is elsewhere, closed or not found</span> : null}
      </div>
    </div>
  );
}

function Projects({ projects }: { projects: SchoolProject[] }) {
  if (!projects.length) return <Section title="FY 2026 School Building Program"><p className="sch-muted">No project in the 2026 list names this school’s ID.</p></Section>;
  return (
    <Section title="FY 2026 School Building Program">
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

function History({ dpwh }: { dpwh: DpwhProject[] }) {
  const sure = dpwh.filter((p) => p.confident === 1);
  const maybe = dpwh.filter((p) => p.confident !== 1);
  const years = sure.map((p) => p.infra_year).filter((y): y is number => y != null);
  return (
    <Section title="Project history: DPWH, 2016 to 2026">
      {sure.length === 0 ? (
        <p className="sch-muted">No DPWH contract since 2016 names this school or its School ID.</p>
      ) : (
        <>
          <p className="sch-muted">
            {sure.length} DPWH {sure.length === 1 ? 'contract names' : 'contracts name'} this school
            {years.length ? `, from ${Math.min(...years)} to ${Math.max(...years)}` : ''}, for {php(sure.reduce((a, p) => a + (p.budget_php ?? 0), 0))} in all.
          </p>
          <DpwhTable rows={sure} />
        </>
      )}
      {maybe.length > 0 && (
        <details className="sch-details">
          <summary>{maybe.length} possible {maybe.length === 1 ? 'match' : 'matches'} to check</summary>
          <p className="sch-muted">These contracts may be for this school, but the link is uncertain: they sit near it on DPWH’s map, or another school shares the name. They are not counted above.</p>
          <DpwhTable rows={maybe} />
        </details>
      )}
      <p className="sch-footnote">
        From DPWH’s contract list, matched to the school by its School ID or its name in the contract’s province. Only DPWH’s
        contracts are here, not classrooms built by DepEd, local governments or others. The budget is the contract’s; a status
        is DPWH’s own. If you know what was built, say so in a field report.
      </p>
    </Section>
  );
}

function DpwhTable({ rows }: { rows: DpwhProject[] }) {
  return (
    <div className="sch-tablewrap">
      <table className="sch-table">
        <thead><tr><th>Year</th><th>Project</th><th>Status</th><th className="num">Budget</th><th>Contractor</th><th>Contract</th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.contract_id}>
              <td className="num">{p.infra_year ?? '—'}</td>
              <td className="sch-desc">{p.description ?? '—'}<span className="sch-sub">{DPWH_MATCH_LABEL[p.match]}{p.distance_m != null ? ` · ${num(p.distance_m)} m from the school’s point` : ''}</span></td>
              <td>{p.status ?? '—'}{p.progress != null && p.status !== 'Completed' ? <span className="sch-sub">{Math.round(p.progress)}% done</span> : null}</td>
              <td className="num">{php(p.budget_php)}{(p.schools_confident ?? 0) > 1 && <span className="sch-sub">one contract for {p.schools_confident} schools</span>}</td>
              <td>{p.contractor ?? '—'}</td>
              <td><DpwhContractLink id={p.contract_id} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
const Missing = ({ what }: { what: string }) => <p className="sch-muted">No SY 2023–2024 {what} row was matched to this School ID. That means no data, not zero.</p>;

// ---------------------------------------------------------------------------
// The field report
// ---------------------------------------------------------------------------

/** A project the report asks about: the 2026 list's, then the newest DPWH contracts that surely name the school. */
interface Asked { key: string; title: string; sub: string }
const MAX_DPWH_ASKED = 5;
/** A DPWH description, short and in sentence case: "CONSTRUCTION OF MULTI-PURPOSE BUILDING AT …" → "Construction of multi-purpose building". */
function shortDesc(d: string | null): string {
  const head = (d ?? 'DPWH contract').split(/,| AT | IN | @ /i)[0].trim().toLowerCase();
  const cut = head.length > 70 ? `${head.slice(0, 70)}…` : head;
  return cut.charAt(0).toUpperCase() + cut.slice(1);
}
function askAbout(data: SchoolFile): Asked[] {
  return [
    ...data.projects.map((p) => ({ key: p.project_id, title: `FY 2026 allocation: ${scopeLabel(p.scope_of_work)}`, sub: `${p.project_id} · ${p.modality ?? ''}` })),
    ...(data.dpwh ?? []).filter((p) => p.confident === 1).slice(0, MAX_DPWH_ASKED).map((p) => ({
      key: dpwhKey(p.contract_id),
      title: `${p.infra_year ?? ''} · ${shortDesc(p.description)}`,
      sub: `${p.contract_id} · DPWH says ${p.status?.toLowerCase() ?? 'no status'}`,
    })),
  ];
}

function ReportBox({ schoolId, projects, shortage, allocated, onTally }: {
  schoolId: string; projects: Asked[]; shortage: number | null; allocated: number; onTally: (t: ReportTally) => void;
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
  const records = `DepEd’s SY 2023–2024 count: ${shortage == null ? 'no figure' : classrooms(shortage)} short. FY 2026 allocation: ${classrooms(allocated)}.`;
  const gone = report.listing === 'closed' || report.listing === 'not_found';
  const mustExplain = disputesData(report, shortage);

  return (
    <div className="sch-report">
      <h2 className="sch-h2">Report from the field</h2>
      <p className="sch-muted">Know this school? Tell DepEd and EDCOM 2 whether it is here and whether it needs more classrooms. Your name is never shown; the page shows only how many reports agree, and every report is reviewed before any figure changes.</p>
      <p className="sch-records">{records}</p>
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
          {!gone && (
            <>
              <Choice legend="2. Does the school need more classrooms?" list={NEEDS} value={report.needs} onChange={(v) => set('needs', v)} />
              {report.needs === 'yes' && (
                <>
                  <Checks legend="Why? (any that apply)" list={NEED_REASONS} value={report.need_reasons} onChange={(v) => set('need_reasons', v)} />
                  <NumberField label="About how many more classrooms, if you know?" value={report.classrooms_needed} min={1} max={LIMITS.classrooms}
                    onChange={(v) => set('classrooms_needed', v)} hint={records} />
                </>
              )}
              {report.needs === 'no' && (
                <Checks legend="Why not? (any that apply)" list={NO_NEED_REASONS} value={report.no_need_reasons} onChange={(v) => set('no_need_reasons', v)} />
              )}
              {report.needs && (
                <fieldset className="sch-field">
                  <legend>If you know them (optional)</legend>
                  {COUNT_FIELDS.map(([k, t]) => (
                    <NumberField key={k} label={t} value={report.counts[k]} min={0} max={LIMITS.count} inline
                      onChange={(v) => set('counts', { ...report.counts, [k]: v })} />
                  ))}
                </fieldset>
              )}
              {(report.needs === 'yes' || allocated > 0) && (
                <Choice legend="3. Is there space at the school to build classrooms?" list={SITE} value={report.site} onChange={(v) => set('site', v)} />
              )}
            </>
          )}
          {projects.length > 0 && (
            <fieldset className="sch-field">
              <legend>{gone ? '2' : '4'}. What is the status of {projects.length === 1 ? 'this project' : 'these projects'}?</legend>
              {projects.map((p) => (
                <label key={p.key} className="sch-field sch-ask">
                  <span>{p.title}<span className="sch-sub">{p.sub}</span></span>
                  <select value={report.projects[p.key] ?? ''} onChange={(e) => {
                    const next = { ...report.projects };
                    if (e.target.value) next[p.key] = e.target.value as SchoolReport['projects'][string]; else delete next[p.key];
                    set('projects', next);
                  }}>
                    <option value="">Don’t know</option>
                    {PROJECT_SEEN.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                  </select>
                </label>
              ))}
            </fieldset>
          )}
          <label className="sch-field"><span>When did you last see this?</span>
            <input type="date" value={report.observed_on ?? ''} min="2016-01-01" max={new Date().toISOString().slice(0, 10)} onChange={(e) => set('observed_on', e.target.value || null)} />
          </label>
          <Choice legend="What is your relationship to the school?" list={RELATIONS} value={report.relation} onChange={(v) => set('relation', v)} />
          <label className="sch-field"><span>{mustExplain ? 'Please explain the school’s situation (needed: your report differs from the records)' : 'Anything else? (optional)'}</span>
            <textarea maxLength={LIMITS.notes} rows={3} value={report.notes} onChange={(e) => set('notes', e.target.value)} required={mustExplain}
              placeholder={report.listing && report.listing !== 'open' ? 'Where is it now, or when did it close or merge?' : 'What DepEd and EDCOM 2 should know'} />
            <span className="sch-sub">Don’t write anyone’s name or contact details.</span>
          </label>
          <label className="sch-field"><span>Links to photos or documents (optional, https, up to {LIMITS.photos})</span>
            <textarea rows={2} value={report.photo_links.join('\n')} placeholder="https://…"
              onChange={(e) => set('photo_links', e.target.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, LIMITS.photos))} />
          </label>
          {state.error && <p className="sch-error" role="alert">{state.error}{state.problems.length > 0 && <> ({state.problems.join(' ')})</>}</p>}
          {state.done && <p className="sch-done" role="status">{state.done}</p>}
          <div className="sch-actions">
            <button type="submit" className="sch-button" disabled={state.busy || !member.enabled}>{saved ? 'Update my report' : 'Send my report'}</button>
            {saved && <button type="button" className="sch-linkbtn" disabled={state.busy} onClick={() => void call('DELETE')}>Withdraw it</button>}
          </div>
          <p className="sch-sub">
            {member.userId ? <>Signed in as {member.email}. </> : null}
            Your name and email are seen only by the review team, never on the site.
            {member.userId && <> <button type="button" className="sch-linkbtn" onClick={member.signOut}>Sign out</button></>}
          </p>
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

function Checks<T extends string>({ legend, list, value, onChange }: { legend: string; list: readonly (readonly [T, string])[]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <fieldset className="sch-field">
      <legend>{legend}</legend>
      {list.map(([k, t]) => (
        <label key={k} className="sch-check">
          <input type="checkbox" checked={value.includes(k)} onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} />{t}
        </label>
      ))}
    </fieldset>
  );
}

function NumberField({ label, value, min, max, onChange, hint, inline = false }: {
  label: string; value: number | null; min: number; max: number; onChange: (v: number | null) => void; hint?: string; inline?: boolean;
}) {
  return (
    <label className={`sch-field${inline ? ' sch-field-inline sch-field-count' : ''}`}><span>{label}</span>
      <input type="number" inputMode="numeric" min={min} max={max} step={1} value={value ?? ''}
        onChange={(e) => { const n = Number.parseInt(e.target.value, 10); onChange(Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null); }} />
      {hint && <span className="sch-sub">{hint}</span>}
    </label>
  );
}
