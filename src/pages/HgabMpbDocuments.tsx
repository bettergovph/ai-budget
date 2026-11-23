/**
 * `/gaa/multi-purpose/documents` (Multi-purpose buildings menu): "Multi-purpose buildings or classrooms?" The House
 * bill's multi-purpose building projects, tallied by what their own documents say they are. Jason (2026-11-15): "From
 * the extracted Senate document data from the pdfs, I need a new tally for the MPBs and their projects. Create a new
 * page under multi-purpose buildings for their breakdown."
 *
 * Data: hgab/2027/mpb-documents/ (npm run build:mpb-documents; contract src/lib/mpb-documents.ts). Every figure in the
 * copy is computed from it. State in the URL: `?cat=&q=&only=classrooms|school|different&sort=`.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { Caveats, DisclaimerNotice, HgabError, HgabHero, HgabLoading } from '../components/HgabBits';
import { GaaHeader } from '../components/GaaBits';
import { cached, getJson, REGION_LABELS, type RegionKey } from '../lib/hgab';
import { dataUrl } from '../lib/data-url';
import { HISTORY_ROOT, HISTORY_TITLE } from '../lib/hgab-history';
import { REVIEW_ROOT } from '../lib/hgab-review';
import { MPB_CARD_DISCLAIMER } from '../lib/hgab-disclaimers';
import { SenateReviewBanner } from '../components/SenateBits';
import { MPB_COMPARE_ROOT } from '../lib/mpb-compare';
import {
  CATEGORY_LABEL, MISMATCH_LABEL, MPB_DOCS_CSV_NAME, MPB_DOCS_PROJECTS_PATH, MPB_DOCS_SUMMARY_PATH, MPB_DOCS_TITLE, MPB_DOC_CATEGORIES,
  decodeMpbDocProjects, mpbDocsCsvPath, type MpbDocCategory, type MpbDocProject, type MpbDocsProjectsFile, type MpbDocsSummary,
} from '../lib/mpb-documents';
import '../nep2027.css';
import '../hgab-mpb-docs.css';

const n = (v: number) => v.toLocaleString('en-PH');
const peso = (v: number) => `₱${Math.round(v).toLocaleString('en-PH')}`;
const big = (v: number) => (v >= 1e9 ? `₱${(v / 1e9).toFixed(1)} billion` : `₱${(v / 1e6).toFixed(1)} million`);
const short = (v: number) => (v >= 1e9 ? `₱${(v / 1e9).toFixed(2)}B` : `₱${(v / 1e6).toFixed(1)}M`);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(a / b < 0.1 ? 1 : 0)}%` : '—');
const recordHref = (id: string) => `/hgab/2027/dpwh/p/${encodeURIComponent(id)}`;
const docsHref = (id: string) => `${REVIEW_ROOT}?p=${encodeURIComponent(id)}`;
const PAGE = 60;

type Only = '' | 'classrooms' | 'school' | 'different';
/** The Senate committee report's word on a project: kept (any amount above ₱0) or cut to ₱0. */
type SenateFilter = '' | 'kept' | 'cut';
const senateCut = (p: MpbDocProject) => p.senateReportPhp === 0;
type Sort = 'amount' | 'title';

function load(): Promise<{ summary: MpbDocsSummary; projects: MpbDocProject[] }> {
  return cached('mpb-documents', async () => {
    const [summary, file] = await Promise.all([
      getJson<MpbDocsSummary>(dataUrl(MPB_DOCS_SUMMARY_PATH), 'Failed to load the multi-purpose building documents summary'),
      getJson<MpbDocsProjectsFile>(dataUrl(MPB_DOCS_PROJECTS_PATH), 'Failed to load the multi-purpose building projects'),
    ]);
    return { summary, projects: decodeMpbDocProjects(file) };
  });
}

export default function HgabMpbDocuments() {
  const [state, setState] = useState<{ summary: MpbDocsSummary; projects: MpbDocProject[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    load().then((s) => { if (live) setState(s); }).catch((e) => { if (live) setError(String(e?.message ?? e)); });
    return () => { live = false; };
  }, []);
  if (error) return <HgabError message={error} />;
  if (!state) return <HgabLoading what="the multi-purpose building documents" />;
  return <Page summary={state.summary} projects={state.projects} />;
}

function Page({ summary: s, projects }: { summary: MpbDocsSummary; projects: MpbDocProject[] }) {
  const read = s.coverage.read;
  const cls = s.classroom.yes;
  const cat = (k: MpbDocCategory) => s.categories.find((c) => c.key === k) ?? { key: k, lines: 0, php: 0, at_school: 0 };
  const halls = cat('multi-purpose hall'), courts = cat('covered court or gym');
  const diff = s.mismatch.find((m) => m.key === 'different facility') ?? { key: 'different facility', lines: 0, php: 0 };
  const classrooms = useMemo(() => projects.filter((p) => p.classroom === 'yes').sort((a, b) => b.php - a.php), [projects]);
  const different = useMemo(() => projects.filter((p) => p.mismatch === 'different facility').sort((a, b) => b.php - a.php), [projects]);
  const asOf = new Date(s.source.records_written).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' });

  return (
    <>
      <GaaHeader crumb={MPB_DOCS_TITLE} />
      <HgabHero
        section="gaa"
        compact
        crumb={<><Link to={HISTORY_ROOT}>{HISTORY_TITLE}</Link><span className="hgab-crumb-sep" aria-hidden="true">·</span><span className="hgab-crumb-here">What the documents say</span></>}
        title={MPB_DOCS_TITLE}
        dek={
          <>
            We read the documents of {n(read.lines)}* multi-purpose building projects inserted by the House. {n(cls.lines)} are
            classrooms.
          </>
        }
        note={
          <>
            <span className="mpbd-star">
              * Documents available: the House inserted {n(s.coverage.dpwh.insertions.lines)} DPWH projects with no matching line in the NEP;
              {' '}{n(s.coverage.dpwh.with_documents.lines)} come with documents in the Senate’s copies. {n(s.coverage.insertions.lines)} of the
              {' '}{n(s.coverage.dpwh.insertions.lines)} are multi-purpose buildings: {n(s.coverage.with_documents.lines)} with documents,
              {' '}{n(s.coverage.without_documents.lines)} with none. We have read {n(read.lines)} so far.
            </span>{' '}
            Each project’s project profile (BP 202), program of work, plans and site photos say what will be built. A model read them and
            quoted them; every project below links to its documents. Amounts are allocations, not spending. Documents read as of {asOf}.
            {' '}The Senate committee report keeps {n(s.senate.kept.lines)} of the {n(read.lines)} and cuts {n(s.senate.cut.lines)} to ₱0; it keeps
            {' '}{n(s.senate.classroom.kept.lines)} of the {n(cls.lines)} classrooms.
          </>
        }
      />
      <main className="nep-main mpbd-main">
        <SenateReviewBanner compact />
        <div className="mpbd-strip" role="list">
          <div role="listitem" className="is-red"><strong>{n(cls.lines)} of {n(read.lines)}</strong><span>inserted multi-purpose building projects read are classrooms or school buildings, {big(cls.php)} ({pct(cls.lines, read.lines)})</span></div>
          <div role="listitem"><strong>{n(halls.lines + courts.lines)}</strong><span>multi-purpose halls ({n(halls.lines)}) and covered courts or gyms ({n(courts.lines)}), {big(halls.php + courts.php)}</span></div>
          <div role="listitem"><strong>{n(s.at_school.yes.lines)}</strong><span>at a school, most of them halls or courts on school grounds</span></div>
          <div role="listitem"><strong>{n(diff.lines)}</strong><span>whose documents describe a different facility from the title, {big(diff.php)}</span></div>
        </div>

        <WhichProjects summary={s} />
        <Breakdown summary={s} />
        <Classrooms rows={classrooms} />
        <Different rows={different} total={diff} />
        <Explorer projects={projects} summary={s} />

        <section className="nep-section mpbd-section" id="about" aria-labelledby="mpbd-about-h">
          <h2 id="mpbd-about-h" className="mpbd-h2">About this data</h2>
          <Caveats items={[
            `Which projects: the House bill’s ${n(s.coverage.house.lines)} multi-purpose building lines (${big(s.coverage.house.php)}), as our map counts them; ${n(s.coverage.house.insertions.lines)} are House insertions. ${n(s.coverage.with_documents.lines)} have documents in the Senate’s copies; ${n(read.lines)} of those have been read so far.`,
            'What was read: the redacted Senate copies only. The project profile (first pages), the program of work (first page), plans, certifications, endorsements and geotagged photos.',
            `How: a language model (${s.source.model}) filled one record per project from those pages and quoted them. It was told to describe what will be built, even when the title calls it something else.`,
            'A classroom here is a building the documents describe as classrooms or a school building. A hall or court on school grounds counts as at a school, not as a classroom.',
            `The reading can be wrong. Open a project’s documents to check; ${n(s.confidence.high)} of ${n(read.lines)} readings were marked high confidence.`,
            `The Senate committee report is the Senate Committee on Finance’s amendments to the House bill; the Senate still votes on it. It keeps ${n(s.senate.kept.lines)} of the ${n(read.lines)} projects (${big(s.senate.kept.php)}) and cuts ${n(s.senate.cut.lines)} to ₱0 (${big(s.senate.cut.php)} in the House bill). “Senate’s copies” on this page are the documents DPWH gave the Senate, not the report.`,
            'No personal names were read. The documents do not say who asked for any project.',
          ]} />
          <p className="mpbd-more">
            <a href={dataUrl(mpbDocsCsvPath(s))} download={MPB_DOCS_CSV_NAME}>Download every project read (CSV)</a>, with the quotes and links to
            each project’s record and documents. <Link to={REVIEW_ROOT}>Review the projects yourself →</Link>
          </p>
        </section>
        <DisclaimerNotice mpb />
      </main>
      <SiteFooter source="SOURCES: HOUSE BILL 10858, THIRD READING (MULTI-PURPOSE BUILDING LINES); DPWH PROJECT DOCUMENTS SUBMITTED TO THE SENATE (REDACTED COPIES)" />
    </>
  );
}

/** Which projects these are: the House bill's multi-purpose buildings, those with Senate documents, those read. */
function WhichProjects({ summary: s }: { summary: MpbDocsSummary }) {
  const c = s.coverage;
  // The chain the page's star note reads: all DPWH insertions, the multi-purpose buildings among them, those read.
  const rows: Array<{ label: string; v: { lines: number; php: number; files?: number }; strong?: boolean; level?: 1 | 2 | 3; next?: boolean }> = [
    { label: 'DPWH projects inserted by the House (no matching line in the NEP), all kinds', v: { ...c.dpwh.insertions, files: c.dpwh.with_documents.files }, strong: true },
    { label: '… with documents in the Senate’s copies', v: c.dpwh.with_documents, level: 1 },
    { label: '… with no documents', v: c.dpwh.without_documents, level: 1 },
    { label: '… multi-purpose buildings', v: c.insertions, strong: true, level: 1 },
    { label: '… with documents in the Senate’s copies', v: c.with_documents, level: 2 },
    { label: '… with no documents', v: c.without_documents, level: 2 },
    { label: '… whose documents we have read so far', v: c.read, strong: true, level: 2 },
    { label: '… kept by the Senate committee report (at its amounts)', v: s.senate.kept, level: 3 },
    { label: '… cut by it to ₱0 (at their House bill amounts)', v: s.senate.cut, level: 3 },
    { label: 'For reference: all multi-purpose building projects in the House bill, inserted or in the NEP', v: c.house, next: true },
  ];
  const kinds = s.documents_read.by_kind;
  const kind = (k: string, one: string, many: string) => (kinds[k] ? `${n(kinds[k])} ${kinds[k] === 1 ? one : many}` : null);
  const read = [
    kind('POW', 'program of work', 'programs of work'), kind('BP 202', 'project profile (BP 202)', 'project profiles (BP 202)'),
    kind('Certificate of Implementability', 'certificate of implementability', 'certificates of implementability'),
    kind('Geotagged photos', 'set of geotagged photos', 'sets of geotagged photos'),
    kind('Development Council', 'development council endorsement', 'development council endorsements'), kind('plan', 'plan', 'plans'),
  ].filter(Boolean);
  return (
    <section className="nep-section mpbd-section" id="which" aria-labelledby="mpbd-which-h">
      <h2 id="mpbd-which-h" className="mpbd-h2">Which {n(c.read.lines)} projects</h2>
      <p className="mpbd-dek">
        Multi-purpose buildings the House inserted, with no matching line in the NEP, whose documents we have read. All are multi-purpose
        buildings in the House bill: {n(s.listed.line_and_title)} sit on its multi-purpose building line with that title, {n(s.listed.line_only)} on
        the line under another title, {n(s.listed.title_only)} titled so under another line.
      </p>
      <div className="mpbd-tablewrap">
        <table className="mpbd-table">
          <thead><tr><th scope="col">Which</th><th scope="col" className="is-num">Projects</th><th scope="col" className="is-num">Amount</th><th scope="col" className="is-num">Senate files</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.label}${r.v.lines}`} className={[r.strong && 'is-strong', r.next && 'is-next'].filter(Boolean).join(' ') || undefined}>
                <th scope="row" className={r.level ? `mpbd-indent${r.level > 1 ? ` is-${r.level}` : ''}` : undefined}>{r.label}</th>
                <td className="is-num">{n(r.v.lines)}</td>
                <td className="is-num">{short(r.v.php)}</td>
                <td className="is-num">{r.v.files ? n(r.v.files) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mpbd-more">
        Documents read for the {n(c.read.lines)}: {n(s.documents_read.total)}, of their {n(c.read.files)} Senate files. They are {read.join(', ')}.
        The rest of the files are other attachments, or pages past the first ones read.
        {c.read_not_inserted.lines ? ` ${n(c.read_not_inserted.lines)} more multi-purpose buildings whose documents we read are in the NEP too, so not insertions; they are left out.` : ''}
      </p>
    </section>
  );
}

function Breakdown({ summary: s }: { summary: MpbDocsSummary }) {
  const max = Math.max(...s.categories.map((c) => c.lines));
  const senateOf = (k: MpbDocCategory) => s.senate.by_category.find((x) => x.key === k);
  return (
    <section className="nep-section mpbd-section" aria-labelledby="mpbd-what-h">
      <h2 id="mpbd-what-h" className="mpbd-h2">What the documents say they are</h2>
      <p className="mpbd-dek">The {n(s.coverage.read.lines)} projects read, by what their documents say will be built. Click a kind to list its projects.</p>
      <div className="mpbd-tablewrap">
        <table className="mpbd-table mpbd-bars">
          <thead>
            <tr>
              <th scope="col">What will be built</th><th scope="col" className="is-num">Projects</th><th scope="col" aria-label="Share" /><th scope="col" className="is-num">Amount</th><th scope="col" className="is-num">At a school</th>
              <th scope="col" className="is-num" title="Projects the Senate committee report keeps">Senate keeps</th><th scope="col" className="is-num" title="Projects the Senate committee report cuts to ₱0">Senate cuts</th>
            </tr>
          </thead>
          <tbody>
            {s.categories.map((c) => (
              <tr key={c.key} className={c.key === 'classroom or school building' ? 'is-red' : undefined}>
                <th scope="row"><Link to={`?cat=${encodeURIComponent(c.key)}#projects`}>{CATEGORY_LABEL[c.key]}</Link></th>
                <td className="is-num">{n(c.lines)}</td>
                <td className="mpbd-bar"><i style={{ width: `${Math.max(0.6, (80 * c.lines) / max)}%` }} /><span>{pct(c.lines, s.coverage.read.lines)}</span></td>
                <td className="is-num">{short(c.php)}</td>
                <td className="is-num">{c.at_school ? n(c.at_school) : '—'}</td>
                <td className="is-num">{n(senateOf(c.key)?.kept.lines ?? 0)}</td>
                <td className="is-num">{n(senateOf(c.key)?.cut.lines ?? 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th scope="row">Projects read</th><td className="is-num">{n(s.coverage.read.lines)}</td><td /><td className="is-num">{short(s.coverage.read.php)}</td><td className="is-num">{n(s.at_school.yes.lines)}</td><td className="is-num">{n(s.senate.kept.lines)}</td><td className="is-num">{n(s.senate.cut.lines)}</td></tr>
          </tfoot>
        </table>
      </div>
      <p className="mpbd-more">
        A multi-purpose hall is a building the documents call a multi-purpose building or hall without naming another use.
        At a school: the documents put the site on school grounds ({n(s.at_school.unclear.lines)} more do not say).
        Senate keeps and cuts: the Senate committee report’s word on each project, kept or cut to ₱0 (<Link to={MPB_COMPARE_ROOT}>every multi-purpose building line, NEP to Senate →</Link>).
      </p>
    </section>
  );
}

function ProjectRow({ p, quote }: { p: MpbDocProject; quote?: boolean }) {
  const region = p.region && REGION_LABELS[p.region as RegionKey] ? REGION_LABELS[p.region as RegionKey].short : p.region;
  return (
    <tr>
      <td>
        <Link className="mpbd-title" to={recordHref(p.id)}>{p.title}</Link>
        <span className="mpbd-sub">{[p.office, region].filter(Boolean).join(' · ')}</span>
      </td>
      <td>
        <span className={`mpbd-cat${p.classroom === 'yes' ? ' is-red' : ''}`}>{CATEGORY_LABEL[p.category]}</span>
        {p.facility && <span className="mpbd-sub">{p.facility}{p.classrooms ? ` · ${n(p.classrooms)} classrooms` : ''}</span>}
        {quote && p.quoteFacility && <q className="mpbd-quote">{p.quoteFacility}</q>}
        {p.atSchool === 'yes' && p.classroom !== 'yes' && <span className="mpbd-sub">At a school{p.siteName ? `: ${p.siteName}` : ''}</span>}
        {p.inserted && <span className="mpbd-tag">House insertion</span>}
        {senateCut(p) && <span className="mpbd-tag is-senate-cut" title="The Senate committee report cuts this project to ₱0">Cut by the Senate</span>}
      </td>
      <td className="is-num">{peso(p.php)}</td>
      <td><a href={docsHref(p.id)}>Documents</a></td>
    </tr>
  );
}

function Classrooms({ rows }: { rows: MpbDocProject[] }) {
  const php = rows.reduce((a, p) => a + p.php, 0);
  const counted = rows.reduce((a, p) => a + (p.classrooms ?? 0), 0);
  const cut = rows.filter(senateCut).length;
  return (
    <section className="nep-section mpbd-section" id="classrooms" aria-labelledby="mpbd-cls-h">
      <h2 id="mpbd-cls-h" className="mpbd-h2">The {n(rows.length)} that are classrooms</h2>
      <p className="mpbd-dek">
        {big(php)} in all. Their documents describe school buildings{counted ? `, ${n(counted)} classrooms where they give a count` : ''}, though
        most titles say only “multi-purpose building”. The Senate committee report keeps {n(rows.length - cut)} of them and cuts {n(cut)} to ₱0.
      </p>
      <div className="mpbd-tablewrap">
        <table className="mpbd-table">
          <thead><tr><th scope="col">Project, as the House bill lists it</th><th scope="col">What the documents say</th><th scope="col" className="is-num">Amount</th><th scope="col"><span className="visually-hidden">Documents</span></th></tr></thead>
          <tbody>{rows.map((p) => <ProjectRow key={p.id} p={p} quote />)}</tbody>
        </table>
      </div>
    </section>
  );
}

function Different({ rows, total }: { rows: MpbDocProject[]; total: { lines: number; php: number } }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 15);
  return (
    <section className="nep-section mpbd-section" id="different" aria-labelledby="mpbd-diff-h">
      <h2 id="mpbd-diff-h" className="mpbd-h2">{n(total.lines)} whose documents describe something else</h2>
      <p className="mpbd-dek">
        {big(total.php)}. The House bill calls them multi-purpose buildings; their documents describe a hospital, a market, a municipal
        building, a road. Largest first.
      </p>
      <div className="mpbd-tablewrap">
        <table className="mpbd-table">
          <thead><tr><th scope="col">Project, as the House bill lists it</th><th scope="col">What the documents say</th><th scope="col" className="is-num">Amount</th><th scope="col"><span className="visually-hidden">Documents</span></th></tr></thead>
          <tbody>{shown.map((p) => <ProjectRow key={p.id} p={p} quote />)}</tbody>
        </table>
      </div>
      {rows.length > shown.length && (
        <p className="mpbd-more"><button type="button" className="mpbd-linkbtn" onClick={() => setAll(true)}>Show all {n(rows.length)}</button></p>
      )}
    </section>
  );
}

function Explorer({ projects, summary: s }: { projects: MpbDocProject[]; summary: MpbDocsSummary }) {
  const [params, setParams] = useSearchParams();
  const catParam = params.get('cat');
  const cat = catParam && (MPB_DOC_CATEGORIES as readonly string[]).includes(catParam) ? (catParam as MpbDocCategory) : '';
  const only = (['classrooms', 'school', 'different'].includes(params.get('only') ?? '') ? params.get('only') : '') as Only;
  const sort: Sort = params.get('sort') === 'title' ? 'title' : 'amount';
  const senate = (['kept', 'cut'].includes(params.get('senate') ?? '') ? params.get('senate') : '') as SenateFilter;
  const [q, setQ] = useState(params.get('q') ?? '');
  const [shown, setShown] = useState(PAGE);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
    setShown(PAGE);
  };
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = useMemo(() => projects
    .filter((p) => (!cat || p.category === cat)
      && (only !== 'classrooms' || p.classroom === 'yes')
      && (only !== 'school' || p.atSchool === 'yes')
      && (only !== 'different' || p.mismatch === 'different facility')
      && (!senate || (senate === 'cut') === senateCut(p))
      && words.every((w) => p.search.includes(w)))
    .sort(sort === 'title' ? (a, b) => a.title.localeCompare(b.title) : (a, b) => b.php - a.php),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- words derive from q
  [projects, cat, only, senate, sort, q]);
  const php = rows.reduce((a, p) => a + p.php, 0);
  return (
    <section className="nep-section mpbd-section" id="projects" aria-labelledby="mpbd-all-h">
      <h2 id="mpbd-all-h" className="mpbd-h2">Every project read</h2>
      <div className="mpbd-filters" role="group" aria-label="Filter the projects">
        <label className="mpbd-search">
          <span className="visually-hidden">Search</span>
          <input type="search" value={q} placeholder="Search a place, school, office or title"
            onChange={(e) => { setQ(e.target.value); set('q', e.target.value); }} />
        </label>
        <label>
          <span>What will be built</span>
          <select value={cat} onChange={(e) => set('cat', e.target.value)}>
            <option value="">Everything</option>
            {s.categories.map((c) => <option key={c.key} value={c.key}>{CATEGORY_LABEL[c.key]} ({n(c.lines)})</option>)}
          </select>
        </label>
        <label>
          <span>Only</span>
          <select value={only} onChange={(e) => set('only', e.target.value)}>
            <option value="">All projects read</option>
            <option value="classrooms">Classrooms</option>
            <option value="school">At a school</option>
            <option value="different">Documents describe something else</option>
          </select>
        </label>
        <label>
          <span>Senate committee report</span>
          <select value={senate} onChange={(e) => set('senate', e.target.value)}>
            <option value="">Kept or cut</option>
            <option value="kept">Kept ({n(s.senate.kept.lines)})</option>
            <option value="cut">Cut to ₱0 ({n(s.senate.cut.lines)})</option>
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select value={sort} onChange={(e) => set('sort', e.target.value === 'amount' ? '' : e.target.value)}>
            <option value="amount">Largest amount</option>
            <option value="title">Title</option>
          </select>
        </label>
      </div>
      <p className="mpbd-dek">{n(rows.length)} projects, {big(php)}.</p>
      <div className="mpbd-tablewrap">
        <table className="mpbd-table">
          <thead><tr><th scope="col">Project, as the House bill lists it</th><th scope="col">What the documents say</th><th scope="col" className="is-num">Amount</th><th scope="col"><span className="visually-hidden">Documents</span></th></tr></thead>
          <tbody>{rows.slice(0, shown).map((p) => <ProjectRow key={p.id} p={p} />)}</tbody>
        </table>
      </div>
      {rows.length > shown && (
        <p className="mpbd-more">
          Showing {n(shown)} of {n(rows.length)}.{' '}
          <button type="button" className="mpbd-linkbtn" onClick={() => setShown(shown + PAGE * 5)}>Show {n(Math.min(PAGE * 5, rows.length - shown))} more</button>
        </p>
      )}
      <p className="mpbd-more">
        {Object.entries(MISMATCH_LABEL).map(([k, label]) => {
          const m = s.mismatch.find((x) => x.key === k);
          return m ? `${label}: ${n(m.lines)}. ` : '';
        }).join('')}
        {MPB_CARD_DISCLAIMER}
      </p>
    </section>
  );
}
