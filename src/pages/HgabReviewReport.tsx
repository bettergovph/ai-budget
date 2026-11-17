/**
 * `/hgab/2027/review/report` — the team's report on members' reviews from the project reviewer: totals by final
 * status, House insertions and NEP only, region, DPWH office and question, then every reviewed project with its
 * reviews. Downloads as CSV (one row per review, or per answer) and prints or saves as PDF.
 *
 * Hidden: no menu or page links to it, it is not in the sitemap, and it is noindex. Open to anyone for now, with no
 * sign-in (Jason, 2026-11-17); the data comes from the Worker (src/worker/hgab-reviews.ts), members by name, no emails.
 * Logic: src/lib/hgab-review-report.ts. Filters live in the URL (`st=`, `region=`, `src=`, `q=`).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { cached, getJson } from '../lib/hgab';
import { dataUrl } from '../lib/data-url';
import { REVIEW_INDEX_PATH, type ReviewIndex } from '../lib/hgab-documents';
import { REVIEW_ROOT, decodeIndex, foldText, pesoFull, pesoShort } from '../lib/hgab-review';
import { RATINGS, VERDICT_LABEL, toCsv } from '../lib/hgab-redflags-team';
import {
  REPORT_ANSWER_COLUMNS, REPORT_API, REPORT_GROUPS, REPORT_GROUP_LABEL, REPORT_GROUP_NOTE, REPORT_REVIEW_COLUMNS, REPORT_TITLE,
  answerLines, answerRows, checkTallies, insertionKey, memberNames, questionTallies, reportProjects, reviewRows, tallyBy, totalTally,
  type ReportGroup, type ReportProject, type ReportResponse, type Tally,
} from '../lib/hgab-review-report';
import { ReviewsApiError } from '../lib/hgab-review-api';
import { download } from '../lib/hgab-review-export';
import '../hgab-review-report.css';

const loadIndex = () => cached('review-index', () => getJson<ReviewIndex>(dataUrl(`hgab/2027/${REVIEW_INDEX_PATH}`), 'Failed to load the project list'));
const n = (v: number) => v.toLocaleString('en-US');
const when = (iso: string, time = false) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', ...(time ? { hour: 'numeric', minute: '2-digit' } : {}) });
};
const shortOffice = (name: string) => name.replace(/\bDistrict Engineering Office\b/i, 'DEO');
/** A DPWH office beside the legislative districts it serves, as the copy rules ask. */
const officeLine = (office: string, districts: string[]) =>
  districts.length ? `${districts.join(' · ')} [${shortOffice(office)}]` : office === 'Central Office' ? 'DPWH Central Office' : `DPWH ${shortOffice(office)}`;

/** Keeps the page out of search results, beside the Worker's X-Robots-Tag. */
function useNoindex() {
  useEffect(() => {
    const m = Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex, nofollow' });
    document.head.appendChild(m);
    return () => { m.remove(); };
  }, []);
}

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; res: ReportResponse };

export default function HgabReviewReport() {
  useNoindex();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [index, setIndex] = useState<ReviewIndex | null>(null);
  // Bumped to load the reviews again (Refresh, Try again).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(REPORT_API, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new ReviewsApiError(res.status, body as ConstructorParameters<typeof ReviewsApiError>[1]);
        if (live) setLoad({ state: 'ready', res: body as ReportResponse });
      })
      .catch((e: unknown) => { if (live) setLoad({ state: 'error', message: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [tick]);
  // The project list (public data), for each line's districts, region and documents.
  useEffect(() => { loadIndex().then(setIndex).catch(() => setIndex(null)); }, []);
  const reload = () => setTick((t) => t + 1);

  return (
    <div className="rr-app">
      <header className="rr-bar">
        <Link to="/" className="rr-brand"><img src="https://assets.bettergov.ph/logos/png/horizontal-primary.png" alt="BetterGov.ph" /></Link>
        <div className="rr-bar-title">
          <h1>{REPORT_TITLE}</h1>
          <span>Members’ reviews of DPWH projects in the FY2027 House bill · HB 10858</span>
        </div>
        <nav className="rr-bar-links" aria-label="Report">
          <Link to={REVIEW_ROOT} className="rr-btn">Project reviewer</Link>
        </nav>
      </header>
      {load.state === 'error' ? (
        <Gate>
          <h2>We couldn’t load the report</h2>
          <p>{load.message}</p>
          <button type="button" className="rr-btn" onClick={() => { setLoad({ state: 'loading' }); reload(); }}>Try again</button>
        </Gate>
      )
        : load.state === 'loading' ? <Gate><span role="status">Loading the reviews…</span></Gate>
          : <ReportBody res={load.res} index={index} reload={reload} />}
    </div>
  );
}

function Gate({ children }: { children: ReactNode }) {
  return <div className="rr-gate">{children}</div>;
}

// --- The report ------------------------------------------------------------------------------------------------------

const SECTIONS = [
  ['summary', 'Summary'], ['insertions', 'House insertions and NEP only'], ['regions', 'By region'], ['offices', 'By DPWH office'],
  ['questions', 'By question'], ['projects', 'Projects'],
] as const;

function ReportBody({ res, index, reload }: { res: ReportResponse; index: ReviewIndex | null; reload: () => void }) {
  const all = useMemo(() => (index ? decodeIndex(index) : null), [index]);
  const rows = useMemo(() => reportProjects(res.data, all), [res.data, all]);
  const names = useMemo(() => memberNames(res.data), [res.data]);
  const total = useMemo(() => totalTally(rows, all?.length ?? null), [rows, all]);
  // "Reviewed of": each group's projects in the House bill, when the project list has loaded.
  const billCount = useCallback((key: (p: NonNullable<typeof all>[number]) => string) => {
    const m = new Map<string, number>();
    for (const p of all ?? []) m.set(key(p), (m.get(key(p)) ?? 0) + 1);
    return (k: string) => (all ? m.get(k) ?? 0 : null);
  }, [all]);
  const bySource = useMemo(() => tallyBy(rows, insertionKey, billCount((p) => (p.insertion ? 'insertion' : 'nep'))), [rows, billCount]);
  const byRegion = useMemo(() => tallyBy(rows, (p) => [p.region, p.region], billCount((p) => p.region)), [rows, billCount]);
  const byOffice = useMemo(() => tallyBy(rows, (p) => [p.office, officeLine(p.office, p.districts)], billCount((p) => p.office.name)), [rows, billCount]);
  const questions = useMemo(() => questionTallies(res.data), [res.data]);
  const checks = useMemo(() => checkTallies(res.data), [res.data]);
  const titleOf = useMemo(() => new Map(rows.map((p) => [p.hgabId, p.title])), [rows]);
  // The automatic reviews: by rule, not by a member, so beside the totals rather than in them.
  const autoAmount = useMemo(() => {
    const ids = new Set(res.auto.map((a) => a.hgab_id));
    return all ? all.filter((p) => ids.has(p.hgabId)).reduce((s, p) => s + p.amount, 0) : null;
  }, [res.auto, all]);

  const stem = `bettergov-house-bill-2027-review-report-${res.meta.generated_at.slice(0, 10)}`;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://budget.bettergov.ph';
  const csvReviews = () => download(`${stem}-reviews.csv`, toCsv(REPORT_REVIEW_COLUMNS, reviewRows(rows, names, origin)), 'text/csv;charset=utf-8');
  const csvAnswers = () => download(`${stem}-answers.csv`, toCsv(REPORT_ANSWER_COLUMNS, answerRows(rows, names)), 'text/csv;charset=utf-8');

  return (
    <div className="rr-layout">
      <nav className="rr-toc" aria-label="Sections">
        <p className="rr-toc-h">Contents</p>
        <ol>
          {SECTIONS.map(([id, label]) => <li key={id}><a href={`#${id}`}>{label}</a></li>)}
          {REPORT_GROUPS.map((g) => total.groups[g].projects > 0 && (
            <li key={g} className="rr-toc-sub"><a href={`#g-${g}`}><i className={`rr-dot is-${g}`} />{REPORT_GROUP_LABEL[g]} <b>{n(total.groups[g].projects)}</b></a></li>
          ))}
        </ol>
        <div className="rr-toc-dl">
          <p className="rr-toc-h">Download</p>
          <button type="button" className="rr-btn" onClick={csvReviews}>Reviews (CSV)</button>
          <button type="button" className="rr-btn" onClick={csvAnswers}>Answers (CSV)</button>
          <button type="button" className="rr-btn" onClick={() => window.print()}>Print or save as PDF</button>
        </div>
      </nav>

      <main className="rr-main">
        <div className="rr-notice">
          <b>For the team. This page isn’t linked from the site; please don’t share it.</b> Each review is one member’s reading of a project’s documents: a
          candidate for follow-up, not a finding, and not evidence that anyone did anything wrong.
          <span className="rr-asof"> As of {when(res.meta.generated_at, true)} · <button type="button" className="rr-link" onClick={reload}>Refresh</button></span>
        </div>

        <section id="summary" className="rr-sec">
          <h2>Summary</h2>
          <div className="rr-cards">
            <Card label="Projects reviewed" value={n(total.projects)} note={total.of != null ? `of ${n(total.of)} DPWH projects in the House bill` : undefined} />
            <Card label="Reviews" value={n(res.meta.reviews)} note={`by ${n(res.meta.members)} member${res.meta.members === 1 ? '' : 's'}`} />
            <Card label="House bill budget reviewed" value={pesoShort(total.amount)} note={pesoFull(total.amount)} />
          </div>
          <div className="rr-cards is-status">
            {REPORT_GROUPS.map((g) => (
              <Card key={g} label={REPORT_GROUP_LABEL[g]} value={n(total.groups[g].projects)} note={pesoShort(total.groups[g].amount)} tone={g} href={`#g-${g}`} />
            ))}
          </div>
          <GroupBar t={total} big />
          <p className="rr-note">
            A project counts under the most serious final status any member gave it. {n(res.meta.auto)} more projects
            {autoAmount != null ? ` (${pesoShort(autoAmount)})` : ''} were reviewed automatically because none of the five key documents and no file
            was found: they show as “Needs attention · auto-reviewed” in the reviewer and are not counted here.
          </p>
        </section>

        <section id="insertions" className="rr-sec">
          <h2>House insertions and NEP only</h2>
          <p className="rr-note">House insertions are projects in the House bill but not in the NEP, by our comparison.</p>
          <TallyTable rows={bySource} head="Projects" />
        </section>

        <section id="regions" className="rr-sec">
          <h2>By region</h2>
          <TallyTable rows={byRegion} head="Region" />
        </section>

        <section id="offices" className="rr-sec">
          <h2>By DPWH office</h2>
          <p className="rr-note">Each DPWH office with the legislative districts it serves. Districts are where the office works, not who asked for a project.</p>
          <TallyTable rows={byOffice} head="Legislative districts [DPWH office]" />
        </section>

        <section id="questions" className="rr-sec">
          <h2>By question</h2>
          <p className="rr-note">How members answered the team’s 16 questions, over all reviews. A review answers only the questions that apply.</p>
          <QuestionTable rows={questions} titleOf={titleOf} />
          {checks.length > 0 && <>
            <h3 className="rr-h3">Checks answered before the 16 questions</h3>
            <p className="rr-note">Reviews saved before the questions (November 17) answered the team’s 44 checks instead. They are kept as they were.</p>
            <CheckTable rows={checks} titleOf={titleOf} />
          </>}
        </section>

        <Projects rows={rows} names={names} />
      </main>
    </div>
  );
}

function Card({ label, value, note, tone, href }: { label: string; value: string; note?: string; tone?: ReportGroup; href?: string }) {
  const body = <><span className="rr-card-l">{tone && <i className={`rr-dot is-${tone}`} />}{label}</span><b className="rr-card-v">{value}</b>{note && <span className="rr-card-n">{note}</span>}</>;
  return href ? <a className={`rr-card${tone ? ` is-${tone}` : ''}`} href={href}>{body}</a> : <div className="rr-card">{body}</div>;
}

/** Projects by final status, as one bar. */
function GroupBar({ t, big }: { t: Tally; big?: boolean }) {
  if (!t.projects) return null;
  return (
    <div className={`rr-bar-stack${big ? ' is-big' : ''}`} role="img"
      aria-label={REPORT_GROUPS.map((g) => `${REPORT_GROUP_LABEL[g]}: ${n(t.groups[g].projects)}`).join(', ')}>
      {REPORT_GROUPS.map((g) => t.groups[g].projects > 0 && (
        <span key={g} className={`is-${g}`} style={{ flexGrow: t.groups[g].projects }} title={`${REPORT_GROUP_LABEL[g]}: ${n(t.groups[g].projects)}`}>
          {big ? n(t.groups[g].projects) : ''}
        </span>
      ))}
    </div>
  );
}

function TallyTable({ rows, head }: { rows: Tally[]; head: string }) {
  if (!rows.length) return <p className="rr-muted">No reviews yet.</p>;
  return (
    <div className="rr-table-wrap">
      <table className="rr-table">
        <thead>
          <tr>
            <th scope="col">{head}</th>
            <th scope="col" className="num">Reviewed</th>
            {REPORT_GROUPS.map((g) => <th key={g} scope="col" className="num"><i className={`rr-dot is-${g}`} />{REPORT_GROUP_LABEL[g]}</th>)}
            <th scope="col" className="num">Budget reviewed</th>
            <th scope="col" className="rr-col-bar"><span className="rr-sr">Final status</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.key}>
              <th scope="row">{t.label}</th>
              <td className="num">{n(t.projects)}{t.of != null && <small> of {n(t.of)}</small>}</td>
              {REPORT_GROUPS.map((g) => <td key={g} className={`num${t.groups[g].projects ? ` is-${g}` : ' is-zero'}`}>{n(t.groups[g].projects)}</td>)}
              <td className="num" title={pesoFull(t.amount)}>{pesoShort(t.amount)}</td>
              <td className="rr-col-bar"><GroupBar t={t} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuestionTable({ rows, titleOf }: { rows: ReturnType<typeof questionTallies>; titleOf: ReadonlyMap<string, string> }) {
  return (
    <div className="rr-table-wrap">
      <table className="rr-table">
        <thead>
          <tr>
            <th scope="col">Question</th>
            <th scope="col" className="num">Answered</th>
            {[...RATINGS].reverse().map((r) => <th key={r} scope="col" className="num"><i className={`rr-dot is-${r}`} />{VERDICT_LABEL[r]}</th>)}
            <th scope="col" className="num">Remarks</th>
            <th scope="col">Needing immediate attention</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((q) => (
            <tr key={q.id} className={q.answered ? '' : 'is-quiet'}>
              <th scope="row"><b className="rr-qid">{q.id}</b> {q.title}</th>
              <td className="num">{n(q.answered)}</td>
              {[...RATINGS].reverse().map((r) => <td key={r} className={`num${q.ratings[r] ? ` is-${r}` : ' is-zero'}`}>{n(q.ratings[r])}</td>)}
              <td className="num">{n(q.remarks)}</td>
              <td><ProjectLinks ids={q.urgentProjects} titleOf={titleOf} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Links to projects further down the report, by bill page and row. */
function ProjectLinks({ ids, titleOf }: { ids: string[]; titleOf: ReadonlyMap<string, string> }) {
  if (!ids.length) return null;
  return (
    <div className="rr-qlinks">
      {ids.slice(0, 6).map((h) => <a key={h} href={`#p-${h}`} title={titleOf.get(h)}>{h.slice(10)}</a>)}
      {ids.length > 6 && <span>+{n(ids.length - 6)}</span>}
    </div>
  );
}

function CheckTable({ rows, titleOf }: { rows: ReturnType<typeof checkTallies>; titleOf: ReadonlyMap<string, string> }) {
  return (
    <div className="rr-table-wrap">
      <table className="rr-table">
        <thead>
          <tr>
            <th scope="col">Check</th>
            <th scope="col" className="num">Answers</th>
            <th scope="col">Outcomes</th>
            <th scope="col">Projects</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <th scope="row"><b className="rr-qid">{c.id}</b> {c.title}</th>
              <td className="num">{n(c.answered)}</td>
              <td>{c.outcomes.map((o) => `${o.label} ${n(o.count)}`).join(' · ')}</td>
              <td><ProjectLinks ids={c.projects} titleOf={titleOf} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Projects --------------------------------------------------------------------------------------------------------

function Projects({ rows, names }: { rows: ReportProject[]; names: ReadonlyMap<string, string> }) {
  const [params, setParams] = useSearchParams();
  const st = params.get('st') ?? '';
  const groups = useMemo(() => st.split(',').filter((g): g is ReportGroup => (REPORT_GROUPS as readonly string[]).includes(g)), [st]);
  const region = params.get('region') ?? '';
  const source = params.get('src') ?? '';
  const q = params.get('q') ?? '';
  const set = (key: string, value: string) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (value) next.set(key, value); else next.delete(key);
    return next;
  }, { replace: true });
  const toggleGroup = (g: ReportGroup) => set('st', (groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g]).join(','));
  const regions = useMemo(() => [...new Set(rows.map((p) => p.region))].sort(), [rows]);
  const shown = useMemo(() => {
    const needle = foldText(q.trim());
    return rows.filter((p) => (!groups.length || groups.includes(p.group)) && (!region || p.region === region)
      && (!source || insertionKey(p)[0] === source)
      && (!needle || foldText(`${p.hgabId} ${p.title} ${p.office} ${p.districts.join(' ')} ${p.reviews.map((r) => `${names.get(r.member_id)} ${r.review.notes}`).join(' ')}`).includes(needle)));
  }, [rows, groups, region, source, q, names]);
  const count = (g: ReportGroup) => rows.filter((p) => p.group === g).length;
  const filtered = groups.length > 0 || !!region || !!source || !!q;

  return (
    <section id="projects" className="rr-sec">
      <h2>Projects</h2>
      <div className="rr-filters" role="search">
        <span className="rr-filters-l">Filter</span>
        {REPORT_GROUPS.map((g) => (
          <button key={g} type="button" className={`rr-chip is-${g}${groups.includes(g) ? ' is-on' : ''}`} aria-pressed={groups.includes(g)} onClick={() => toggleGroup(g)}>
            <i className={`rr-dot is-${g}`} />{REPORT_GROUP_LABEL[g]} <b>{n(count(g))}</b>
          </button>
        ))}
        <select className="rr-select" value={region} onChange={(e) => set('region', e.target.value)} aria-label="Region">
          <option value="">All regions</option>
          {regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="rr-select" value={source} onChange={(e) => set('src', e.target.value)} aria-label="House insertions or NEP only">
          <option value="">Insertions and NEP only</option>
          <option value="insertion">House insertions</option>
          <option value="nep">NEP only</option>
        </select>
        <input className="rr-input" type="search" placeholder="Search project, office, district, reviewer, remarks" value={q} onChange={(e) => set('q', e.target.value)} />
        {filtered && <button type="button" className="rr-link" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear</button>}
      </div>
      {filtered && <p className="rr-muted">{n(shown.length)} of {n(rows.length)} projects.</p>}
      {REPORT_GROUPS.map((g) => {
        const list = shown.filter((p) => p.group === g);
        if (!list.length) return null;
        return (
          <div key={g} id={`g-${g}`} className="rr-group">
            <h3 className={`rr-group-h is-${g}`}><i className={`rr-dot is-${g}`} />{REPORT_GROUP_LABEL[g]} <span>{n(list.length)} · {pesoShort(list.reduce((s, p) => s + p.amount, 0))}</span></h3>
            <p className="rr-note">{REPORT_GROUP_NOTE[g]}</p>
            {list.map((p) => <ProjectEntry key={p.hgabId} p={p} names={names} />)}
          </div>
        );
      })}
      {!shown.length && <p className="rr-muted">{rows.length ? 'No project matches these filters.' : 'No reviews yet.'}</p>}
    </section>
  );
}

function ProjectEntry({ p, names }: { p: ReportProject; names: ReadonlyMap<string, string> }) {
  return (
    <article id={`p-${p.hgabId}`} className={`rr-proj is-${p.group}`}>
      <header className="rr-proj-h">
        <div>
          <h4>{p.title}</h4>
          <p className="rr-proj-meta">
            <span>{officeLine(p.office, p.districts)}</span>
            <span>{p.region}</span>
            {p.insertion != null && <span className={p.insertion ? 'rr-tag is-ins' : 'rr-tag'}>{p.insertion ? 'House insertion' : 'NEP only'}</span>}
            {p.docs != null && <span>{p.docs} of 5 key documents</span>}
            {p.flags != null && <span>{n(p.flags)} red flag{p.flags === 1 ? '' : 's'}</span>}
          </p>
        </div>
        <div className="rr-proj-side">
          <b title={pesoFull(p.amount)}>{pesoShort(p.amount)}</b>
          <Link to={`${REVIEW_ROOT}?p=${p.hgabId}`} target="_blank" rel="noopener">{p.hgabId}</Link>
        </div>
      </header>
      {p.reviews.map((c) => {
        const lines = answerLines(c.review);
        const fine = lines.filter((a) => a.rating === 'satisfactory');
        const rest = lines.filter((a) => a.rating !== 'satisfactory');
        return (
          <div key={c.review.case_id} className="rr-rev">
            <p className="rr-rev-h">
              <span className={`rr-pill is-${c.review.verdict ?? 'none'}`}>{c.review.verdict ? VERDICT_LABEL[c.review.verdict] : 'No final status'}</span>
              <b>{names.get(c.member_id)}</b>
              <span className="rr-muted">{when(c.updated_at)} · {n(c.revisions)} save{c.revisions === 1 ? '' : 's'}</span>
            </p>
            {c.review.notes.trim() && <blockquote className="rr-remarks">{c.review.notes.trim()}</blockquote>}
            {rest.length > 0 && (
              <ul className="rr-answers">
                {rest.map((a) => (
                  <li key={a.id} className={a.rating ? `is-${a.rating}` : ''}>
                    <b className="rr-qid">{a.id}</b> {a.title}: <em>{a.label}</em>{a.older && <small> (earlier check)</small>}
                    {a.remark && <span className="rr-remark">{a.remark}</span>}
                  </li>
                ))}
              </ul>
            )}
            {fine.length > 0 && (
              <p className="rr-fine"><i className="rr-dot is-satisfactory" />Satisfactory: {fine.map((a) => (a.remark ? `${a.id} (${a.remark})` : a.id)).join(', ')}</p>
            )}
            {!lines.length && !c.review.notes.trim() && <p className="rr-muted">No answers yet.</p>}
          </div>
        );
      })}
    </article>
  );
}
