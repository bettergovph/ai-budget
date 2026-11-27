/**
 * `/senate/2027/report/*`: an executive report on the Senate committee report (Jason, 2026-11-21: "an executive report
 * of what was changed and our analysis based on that data ... don't link it for now"), in the shape of the House bill
 * review report (HgabReviewReport.tsx: a bar, pages on the left, cards and tables; its styles, hgab-review-report.css;
 * Jason: "make it look like our hgab's review report"). Not in any menu or the sitemap, and noindex. Every figure
 * comes from senate/2027/report.json (scripts/senate-cr/build_report.py), which reads the published dataset
 * (senate/2027/downloads/) and, for DPWH red flags and documents, the House bill reviewer's index.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import * as fmt from '../lib/format';
import { cached, getJson, type DatasetKey } from '../lib/hgab';
import { dataUrl } from '../lib/data-url';
import { NAMED_TYPES } from '../lib/hgab-documents';
import { NAMED_MEANING, REVIEW_ROOT } from '../lib/hgab-review';
import { DOC_FROM, DOC_FROM_LABEL, DOC_FROM_NOTE, DOC_LEVEL_LABEL, type DocFrom } from '../lib/hgab-review-report';
import {
  SENATE_BASE, SENATE_DATA_ROOT, SENATE_EXPLORER_ROOT, SENATE_PROVISIONS_ROOT, SENATE_REPORT_ROOT, SENATE_ROOT, nameCase, senateListPath,
  senatePdfUrl, senateProgramPath, senateRecordPath,
} from '../lib/senate';
import '../hgab-review-report.css';
import '../senate.css';

interface Amt { house: number; increase: number; decrease: number; net: number; senate: number }
interface Dept extends Amt { no: string; name: string; nep: number | null }
interface Line { department: string; agency: string | null; item: string | null; label: string; house: number | null; net: number; senate: number | null; status: string; page: number }
interface StatusSum { n: number; house: number | null; senate: number | null; change: number | null }
interface Program {
  house: number; senate: number; nep: number;
  status: Partial<Record<'cut' | 'reduced' | 'raised' | 'added' | 'restored' | 'renamed' | 'unchanged', StatusSum>>;
  replaces: number;
  house_inserted: { n: number; house: number; removed_n: number; removed: number };
  nep_proposed: { n: number; house: number; removed_n: number; removed: number };
  regions: Array<{ region: string; n: number; house: number; senate: number; removed_n: number }>;
}
interface Profile { n: number; insertion_flag: number; five_plus_flags: number; avg_flags: number; no_key_document: number; all_five_documents: number }
/** Projects, their House bill and Senate budget, and those the Senate removes (cut to zero) with their House bill budget. */
interface DocCell { n: number; house: number; senate: number; removed_n: number; removed: number }
type DocLvl = 'complete' | 'partial' | 'none' | 'unchecked';
/** report.json `dpwh_documents` (build_report.py `documents`): the House bill review report's document counts, with the Senate's. */
interface Documents {
  projects: DocCell; checked: number; complete_at: number; reviewer_built_at: string | null;
  /** By the source counted: 5 of 5 down to 0 of 5 (checked projects), the levels, each key document with and without. */
  by: Record<DocFrom, { count: DocCell[]; levels: Record<DocLvl, DocCell>; types: Array<{ with: DocCell; without: DocCell }>; with_file: DocCell }>;
  sources: Record<'senate' | 'nep' | 'both' | 'none', DocCell>;
  insertion: Record<'insertion' | 'nep', Record<DocLvl, DocCell>>;
  regions: Array<{ region: string; all: DocCell; complete: DocCell; partial: DocCell; none: DocCell }>;
}
interface Report {
  built_at: string; dataset_built_at: string; source_commit: string | null;
  totals: Record<'total' | 'programmed' | 'unprogrammed' | 'departments' | 'spf', Amt>;
  departments: { changed: number; count: number; gains: Dept[]; cuts: Dept[] };
  big_lines: Line[]; unprogrammed_lines: Line[];
  programs: Record<DatasetKey, Program>;
  dpwh_raised: Array<{ title: string; nep: number | null; house: number; senate: number; change: number; page: number; id: string }>;
  dpwh_program_lines: Array<{ line: string; n: number; house: number; senate: number; removed_n: number }>;
  dpwh_mpb: { n: number; house: number; senate: number; removed_n: number; removed: number; inserted_n: number; inserted: number; inserted_removed_n: number; inserted_removed: number };
  dpwh_flags: { removed: Profile; kept: Profile; in_reviewer: number; projects: number };
  /** Absent in a report.json built before 2026-11-27. */
  dpwh_documents?: Documents;
  dpwh_offices: Array<{ office: string; districts: string[]; tier: string | null; removed_n: number; removed: number; house: number }>;
  dpwh_central_office: { house: number; senate: number; removed_n: number; removed: number };
  hfep_kinds: Array<{ kind: string; n: number; change: number }>;
  provisions: { n: number; general: number; by_department: Array<{ department: string; n: number }> };
  checks: { run: number; passed: number; totals_run?: number; totals_passed?: number; page_links?: number; page_links_ok?: number };
}

const loadReport = () => cached('senate:report', () => getJson<Report>(dataUrl(`${SENATE_BASE}/report.json`), 'Could not load the Senate report'));

const TITLE = 'What the Senate changed in the 2027 budget';
/** The report's pages, in the left-hand list; Overview's "In this report" repeats them with their notes. */
const PAGES: ReadonlyArray<{ slug: string; label: string; note: string }> = [
  { slug: '', label: 'Overview', note: '' },
  { slug: 'bill', label: 'The whole bill', note: 'The Senate’s totals and the departments that gain and lose the most.' },
  { slug: 'amendments', label: 'Largest amendments', note: 'The biggest single amounts the Senate changes, outside DPWH.' },
  { slug: 'unprogrammed', label: 'Unprogrammed', note: 'What the Senate takes out of unprogrammed appropriations, and puts in.' },
  { slug: 'programs', label: 'Infrastructure programs', note: 'DPWH, farm-to-market roads, irrigation and health facilities, project by project.' },
  { slug: 'dpwh', label: 'DPWH', note: 'Where the Senate’s DPWH cuts fall, and the foreign-assisted projects it raises.' },
  { slug: 'offices', label: 'District offices', note: 'The district engineering offices that lose the most budget.' },
  { slug: 'red-flags', label: 'Red flags', note: 'Removed and kept DPWH projects, by red flags and documents.' },
  { slug: 'documents', label: 'Documents', note: 'DPWH projects by how many of the five key documents were found (5 of 5 to 0 of 5), and what the Senate did to them.' },
  { slug: 'provisions', label: 'Provisions', note: 'The Senate’s amendments to the bill’s provisions.' },
  { slug: 'about', label: 'About this report', note: 'What it does not say, and where every figure comes from.' },
];
const pagePath = (slug: string) => (slug ? `${SENATE_REPORT_ROOT}/${slug}` : SENATE_REPORT_ROOT);

const php = (v: number | null | undefined) => (v == null ? '—' : fmt.shortPhp(v));
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt.shortPhp(Math.abs(v))}`;
/** Trillions with three decimals: a whole-bill change of under a billion still shows. */
const trillion = (v: number) => `${(v / 1e12).toFixed(3)}T`;
const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '—');
const n = (v: number) => v.toLocaleString('en-US');
const PROGRAM_NAME: Record<DatasetKey, string> = {
  dpwh: 'DPWH projects', fmr: 'Farm-to-market roads (DA)', hfep: 'Health facilities (DOH HFEP)', nia: 'Irrigation (NIA)',
};

/** Keeps the page out of search results, beside the Worker's X-Robots-Tag. */
function useNoindex() {
  useEffect(() => {
    const m = Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex, nofollow' });
    document.head.appendChild(m);
    return () => { m.remove(); };
  }, []);
}

export default function SenateReport() {
  useNoindex();
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadReport().then(setR).catch((e) => setErr(String(e?.message || e))); }, []);
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    const page = PAGES.find((pg) => pg.slug && pathname.startsWith(pagePath(pg.slug)));
    document.title = `${page ? `${page.label} · ` : ''}${TITLE} · BetterGov.ph`;
  }, [pathname]);
  const asOf = r ? new Date(r.dataset_built_at).toLocaleString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }) : null;

  return (
    <div className="rr-app">
      <header className="rr-bar">
        <Link to="/" className="rr-brand"><img src="https://assets.bettergov.ph/logos/png/horizontal-primary.png" alt="BetterGov.ph" /></Link>
        <div className="rr-bar-title">
          <h1><Link to={SENATE_REPORT_ROOT}>{TITLE}</Link></h1>
          <span>Executive report · FY2027 Senate committee report on HB 10858</span>
        </div>
        <nav className="rr-bar-links" aria-label="Report">
          <Link to={SENATE_DATA_ROOT} className="rr-btn">Senate dataset</Link>
          <Link to={`${SENATE_ROOT}/overview`} className="rr-btn">Senate pages</Link>
        </nav>
      </header>
      <div className="rr-layout">
        <nav className="rr-toc" aria-label="Report pages">
          <p className="rr-toc-h">Pages</p>
          <ol>
            {PAGES.map((pg) => (
              <li key={pg.slug}>
                <NavLink to={pagePath(pg.slug)} end={!pg.slug} className={({ isActive }) => (isActive ? 'is-on' : undefined)}>{pg.label}</NavLink>
              </li>
            ))}
          </ol>
        </nav>
        <main className="rr-main">
          <div className="rr-notice">
            <p className="rr-stamp"><b>Under citizen review</b> · data as of {asOf ?? '…'} (Philippine time)</p>
            <p>
              Our reading of the Senate Committee on Finance’s report on House Bill 10858, the FY 2027 General Appropriations Bill. We have not finished
              checking every figure: before you cite one, open the page of the committee report it gives.
            </p>
            <p>
              <b>This report isn’t linked from the site yet; please don’t share it.</b> A red flag is a reason to look, not a finding, and the Senate gives
              no reason for each project it removes.
            </p>
          </div>
          {err ? <div className="rr-gate"><h2>We couldn’t load the report</h2><p>{err}</p></div>
            : !r ? <div className="rr-gate"><span role="status">Loading the report…</span></div> : (
              <Routes>
                <Route index element={<Overview r={r} />} />
                <Route path="bill" element={<BillPage r={r} />} />
                <Route path="amendments" element={<AmendmentsPage r={r} />} />
                <Route path="unprogrammed" element={<UnprogrammedPage r={r} />} />
                <Route path="programs" element={<ProgramsPage r={r} />} />
                <Route path="dpwh" element={<DpwhPage r={r} />} />
                <Route path="offices" element={<OfficesPage r={r} />} />
                <Route path="red-flags" element={<FlagsPage r={r} />} />
                <Route path="documents" element={<DocumentsPage r={r} />} />
                <Route path="provisions" element={<ProvisionsPage r={r} />} />
                <Route path="about" element={<AboutPage r={r} />} />
                <Route path="*" element={<PageHead title="No such page"><p><Link to={SENATE_REPORT_ROOT}>Back to the overview</Link></p></PageHead>} />
              </Routes>
            )}
        </main>
      </div>
    </div>
  );
}

// --- Pieces, as the review report's ---------------------------------------------------------------------------------

function PageHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="rr-head">
      <h2>{title}</h2>
      {children && <div className="rr-lede">{children}</div>}
    </header>
  );
}

function Card({ label, value, note, tone, to }: { label: string; value: string; note?: ReactNode; tone?: 'up' | 'down'; to?: string }) {
  const body = <><span className="rr-card-l">{label}</span><b className="rr-card-v">{value}</b>{note && <span className="rr-card-n">{note}</span>}</>;
  const cls = `rr-card${tone ? ` sr-${tone}` : ''}`;
  return to ? <Link className={cls} to={to}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** A change, signed and coloured, with its percent of the base. */
function Chg({ v, base }: { v: number | null; base?: number | null }) {
  if (v == null) return <span className="rr-muted">—</span>;
  if (v === 0) return <span className="rr-muted">0</span>;
  return (
    <span className={`sr-chg ${v < 0 ? 'is-down' : 'is-up'}`}>
      {signed(v)}{base ? <small> {v > 0 ? '+' : '−'}{Math.abs((v / base) * 100).toFixed(1)}%</small> : null}
    </span>
  );
}

function Finding({ head, children }: { head: ReactNode; children: ReactNode }) {
  return <li><b>{head}</b> {children}</li>;
}

function Page({ page }: { page: number }) {
  return <a className="rr-link" href={senatePdfUrl('senate-cr-annex-a', page)} target="_blank" rel="noreferrer">p. {page}</a>;
}

// --- Overview ---------------------------------------------------------------------------------------------------------

function Overview({ r }: { r: Report }) {
  const t = r.totals;
  const dp = r.programs.dpwh;
  const fmr = r.programs.fmr;
  const hf = r.programs.hfep;
  const line = (s: string) => r.big_lines.find((x) => (x.item ?? '').toLowerCase().includes(s.toLowerCase()));
  const map = line('Medical Assistance Program');
  const phic = line('National Health Insurance');
  const nscr = line('North-South Commuter');
  const mmsp = r.big_lines.filter((x) => (x.item ?? '').includes('Metro Manila Subway'));
  const feeding = line('School-Based Feeding');
  const aics = line('Protective Services');
  const hosp = line('Regional Hospitals');
  const dpwhDept = [...r.departments.cuts, ...r.departments.gains].find((d) => d.name.includes('PUBLIC WORKS'));
  const raised = r.dpwh_raised.reduce((a, x) => a + x.change, 0);
  const raisedNep = r.dpwh_raised.reduce((a, x) => a + (x.nep ?? 0), 0);
  const raisedHouse = r.dpwh_raised.reduce((a, x) => a + x.house, 0);
  const cut = dp.status.cut!;
  const fl = r.dpwh_flags;
  return (
    <>
      <PageHead title="Overview">
        <p>What the Senate Committee on Finance changed in the House bill (HB 10858), and what the data shows. Every figure is in the <Link to={SENATE_DATA_ROOT}>Senate dataset</Link>.</p>
      </PageHead>
      <section className="rr-sec">
        <div className="rr-cards is-4">
          <Card label="Total new appropriations, Senate" value={trillion(t.total.senate)} note={`${signed(t.total.net)} vs the House bill`} to={pagePath('bill')} />
          <Card label="Moved between lines" value={php(t.programmed.increase)} note="raised in some lines, cut from others" to={pagePath('amendments')} />
          <Card label="DPWH projects, Senate" value={php(dp.senate)} tone="down" note={`${signed(dp.senate - dp.house)} vs the House bill`} to={pagePath('dpwh')} />
          <Card label="DPWH projects removed" value={n(cut.n)} tone="down" note={`${php(cut.house)} of House bill budget`} to={pagePath('dpwh')} />
        </div>
        <h3 className="rr-h3">Key findings</h3>
        <ul className="sr-findings">
          <Finding head="The same total, different priorities.">
            The Senate keeps programmed appropriations at {php(t.programmed.house)}, the House bill’s to the peso, and moves {php(t.programmed.increase)} between lines.
            Total new appropriations go from {trillion(t.total.house)} to {trillion(t.total.senate)} ({signed(t.total.net)}), all of it in unprogrammed appropriations.
          </Finding>
          {dpwhDept && (
            <Finding head="DPWH takes the largest Senate cut.">
              The department falls {signed(dpwhDept.net)} ({pct(dpwhDept.net, dpwhDept.house)}). Its projects go from {php(dp.house)} to {php(dp.senate)}: the Senate
              removes {n(cut.n)} projects worth {php(cut.house)} and raises {n(dp.status.raised?.n ?? 0)} by {php(dp.status.raised?.change ?? 0)}.
            </Finding>
          )}
          <Finding head="Most of what the Senate removes, the House had inserted.">
            Of the {n(dp.house_inserted.n)} DPWH projects the House inserted (no line in the NEP, {php(dp.house_inserted.house)}), the Senate removes {n(dp.house_inserted.removed_n)},
            {' '}{php(dp.house_inserted.removed)} or {pct(dp.house_inserted.removed, dp.house_inserted.house)} of their budget. It removes {n(dp.nep_proposed.removed_n)} of the{' '}
            {n(dp.nep_proposed.n)} projects the NEP proposed ({php(dp.nep_proposed.removed)}). In farm-to-market roads it removes {n(fmr.house_inserted.removed_n)} of the{' '}
            {n(fmr.house_inserted.n)} House insertions.
          </Finding>
          <Finding head="Foreign-assisted projects come back, in part.">
            All {r.dpwh_raised.length} DPWH projects the Senate raises are foreign-assisted, by {php(raised)}: from {php(raisedHouse)} in the House bill to {php(raisedHouse + raised)},
            against {php(raisedNep)} in the NEP.
            {nscr && mmsp.length > 0 && <> The Department of Transportation gains {php(nscr.net + mmsp.reduce((a, x) => a + x.net, 0))} on two railways (North-South Commuter Railway, Metro Manila Subway).</>}
          </Finding>
          {(map || phic) && (
            <Finding head="Health and social protection are reshaped.">
              {map && <>The DOH Medical Assistance Program is cut by {php(Math.abs(map.net))} ({php(map.house)} to {php(map.senate)}). </>}
              {phic && <>PhilHealth’s National Health Insurance Program gains {php(phic.net)}. </>}
              {hosp && <>DOH regional hospital operations gain {php(hosp.net)}, and health facilities (HFEP) {php(hf.senate - hf.house)}. </>}
              {aics && <>DSWD’s protective services for individuals and families in crisis are cut by {php(Math.abs(aics.net))}. </>}
              {feeding && <>DepEd’s school-based feeding gains {php(feeding.net)}.</>}
            </Finding>
          )}
          <Finding head="The projects the Senate removes carried more red flags.">
            {fl.removed.insertion_flag}% of the removed DPWH projects were flagged as potential NEP insertions, against {fl.kept.insertion_flag}% of those kept;{' '}
            {fl.removed.no_key_document}% had none of the five key documents, against {fl.kept.no_key_document}%. A pattern in the data, not the Senate’s stated reason.
            {' '}By document count, 5 of 5 to 0 of 5: <Link to={pagePath('documents')}>Documents</Link>.
          </Finding>
          <Finding head="Unprogrammed appropriations are rebuilt.">
            The Senate adds {php(t.unprogrammed.increase)} and takes out {php(Math.abs(t.unprogrammed.decrease))}; they end at {php(t.unprogrammed.senate)} ({signed(t.unprogrammed.net)}).
          </Finding>
        </ul>
      </section>
      <section className="rr-sec">
        <h3 className="rr-h3 is-first">In this report</h3>
        <ul className="rr-pagelist">
          {PAGES.filter((pg) => pg.slug).map((pg) => <li key={pg.slug}><Link to={pagePath(pg.slug)}>{pg.label}</Link><span>{pg.note}</span></li>)}
        </ul>
      </section>
    </>
  );
}

// --- The whole bill -----------------------------------------------------------------------------------------------------

function BillPage({ r }: { r: Report }) {
  const t = r.totals;
  return (
    <>
      <PageHead title="The whole bill">
        <p>The Senate committee report’s General Summary beside the House bill’s. {r.departments.changed} of {r.departments.count} departments and funds change.</p>
      </PageHead>
      <section className="rr-sec">
        <div className="rr-cards is-4">
          <Card label="Total new appropriations, Senate" value={trillion(t.total.senate)} note={`${signed(t.total.net)} vs the House bill (${trillion(t.total.house)})`} />
          <Card label="Programmed, Senate" value={trillion(t.programmed.senate)} note={t.programmed.net === 0 ? 'the same as the House bill, to the peso' : `${signed(t.programmed.net)} vs the House bill`} />
          <Card label="Departments" value={signed(t.departments.net)} tone={t.departments.net < 0 ? 'down' : 'up'} note={`special purpose funds ${signed(t.spf.net)}`} />
          <Card label="Unprogrammed, Senate" value={php(t.unprogrammed.senate)} note={`${signed(t.unprogrammed.net)} vs the House bill`} to={pagePath('unprogrammed')} />
        </div>
        <p className="rr-note">The departments together lose {php(Math.abs(t.departments.net))}; the special purpose funds gain the same, so the programmed total doesn’t move.</p>
        <div className="sr-split">
          <DeptTable title="Largest Senate increases, by department" rows={r.departments.gains} />
          <DeptTable title="Largest Senate cuts, by department" rows={r.departments.cuts} />
        </div>
        <p className="rr-note">Every department and fund, line by line: <Link to={SENATE_EXPLORER_ROOT}>Line by line</Link>.</p>
      </section>
    </>
  );
}

function DeptTable({ title, rows }: { title: string; rows: Dept[] }) {
  return (
    <div>
      <h3 className="rr-h3 is-first">{title}</h3>
      <div className="rr-table-wrap">
        <table className="rr-table">
          <thead><tr><th scope="col">Department or fund</th><th scope="col" className="num">House bill</th><th scope="col" className="num">Senate</th><th scope="col" className="num">Change</th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.name}>
                <th scope="row">{nameCase(d.name)}</th>
                <td className="num">{php(d.house)}</td><td className="num"><b>{php(d.senate)}</b></td>
                <td className="num"><Chg v={d.net} base={d.house} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Amendments, unprogrammed ------------------------------------------------------------------------------------------

function LineTable({ rows, noAgency = false }: { rows: Line[]; noAgency?: boolean }) {
  return (
    <div className="rr-table-wrap">
      <table className="rr-table">
        <thead><tr><th scope="col">Amendment</th><th scope="col" className="num">House bill</th><th scope="col" className="num">Senate</th><th scope="col" className="num">Change</th><th scope="col">Annex A</th></tr></thead>
        <tbody>
          {rows.map((x, k) => (
            <tr key={k}>
              <th scope="row">
                {nameCase(x.item ?? x.label)} <span className="rr-tag">{x.label}</span>
                {!noAgency && <span className="rr-sub">{nameCase(x.department)}{x.agency ? ` · ${x.agency}` : ''}</span>}
              </th>
              <td className="num">{x.house != null ? php(x.house) : <span className="rr-muted" title="Not in the House bill">—</span>}</td>
              <td className="num"><b>{php(x.senate)}</b></td>
              <td className="num"><Chg v={x.net} base={x.house} /></td>
              <td><Page page={x.page} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AmendmentsPage({ r }: { r: Report }) {
  const animal = r.big_lines.filter((x) => (x.item ?? '').includes('Animal Industry'));
  const bef = r.big_lines.find((x) => (x.item ?? '').includes('Basic Education Facilities'));
  return (
    <>
      <PageHead title="Largest amendments">
        <p>The biggest single amounts the Senate changes, outside DPWH (its own page). Each is one amount Annex A prints; the page link opens the committee report there.</p>
      </PageHead>
      <section className="rr-sec">
        <LineTable rows={r.big_lines} />
        {animal.length > 0 && bef && (
          <p className="rr-note">
            Two programs lose all or most of their House bill budget: DA’s Animal Industry Development and Competitiveness Program ({php(animal.reduce((a, x) => a + (x.house ?? 0), 0))}, removed)
            and DepEd’s Basic Education Facilities capital outlay ({signed(bef.net)}).
          </p>
        )}
        <p className="rr-note">Every amendment, department by department: <Link to={SENATE_EXPLORER_ROOT}>Line by line</Link>.</p>
      </section>
    </>
  );
}

function UnprogrammedPage({ r }: { r: Report }) {
  const u = r.totals.unprogrammed;
  return (
    <>
      <PageHead title="Unprogrammed appropriations">
        <p>Budget that is released only when there is money for it (new revenue, loans). The Senate rebuilds the list: a lump sum for foreign-assisted projects gives way to named ones.</p>
      </PageHead>
      <section className="rr-sec">
        <div className="rr-cards is-4">
          <Card label="Unprogrammed, House bill" value={php(u.house)} />
          <Card label="Put in by the Senate" value={php(u.increase)} tone="up" />
          <Card label="Taken out by the Senate" value={php(Math.abs(u.decrease))} tone="down" />
          <Card label="Unprogrammed, Senate" value={php(u.senate)} note={`${signed(u.net)} vs the House bill`} />
        </div>
        <h3 className="rr-h3">The largest changes</h3>
        <LineTable rows={r.unprogrammed_lines} noAgency />
        <p className="rr-note">Annex A prints some of these at more than one level (a purpose and the projects under it), so the rows don’t add up to the totals above; the totals are the General Summary’s.</p>
      </section>
    </>
  );
}

// --- Infrastructure -----------------------------------------------------------------------------------------------------

function ProgramsPage({ r }: { r: Report }) {
  const { fmr, nia, hfep: hf } = r.programs;
  return (
    <>
      <PageHead title="Infrastructure programs">
        <p>The four programs the committee report lists project by project (Annexes A-1 to A-4). The NEP, the House bill and the Senate are versions of one budget: compare them, don’t add them.</p>
      </PageHead>
      <section className="rr-sec">
        <div className="rr-table-wrap">
          <table className="rr-table">
            <thead>
              <tr>
                <th scope="col">Program</th><th scope="col" className="num">NEP</th><th scope="col" className="num">House bill</th><th scope="col" className="num">Senate</th>
                <th scope="col" className="num">Change</th><th scope="col" className="num">Removed</th><th scope="col" className="num">Documented additions</th>
                <th scope="col" className="num">Restored from the NEP</th>
              </tr>
            </thead>
            <tbody>
              {(['dpwh', 'fmr', 'nia', 'hfep'] as DatasetKey[]).map((k) => {
                const p = r.programs[k];
                return (
                  <tr key={k}>
                    <th scope="row"><Link to={senateProgramPath(k)}>{PROGRAM_NAME[k]}</Link></th>
                    <td className="num">{php(p.nep)}</td><td className="num">{php(p.house)}</td><td className="num"><b>{php(p.senate)}</b></td>
                    <td className="num"><Chg v={p.senate - p.house} base={p.house} /></td>
                    <td className="num">{p.status.cut ? <Link to={senateListPath(k, 'status', 'cut')}>{n(p.status.cut.n)}</Link> : '—'}{p.status.cut && <small> · {php(p.status.cut.house)}</small>}</td>
                    <td className="num">{p.status.added ? <Link to={senateListPath(k, 'status', 'added')}>{n(p.status.added.n)}</Link> : '—'}{p.status.added && <small> · {php(p.status.added.senate)}</small>}</td>
                    <td className="num">{p.status.restored ? <Link to={senateListPath(k, 'status', 'restored')}>{n(p.status.restored.n)}</Link> : '—'}{p.status.restored && <small> · {php(p.status.restored.senate)}</small>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="sr-findings">
          <Finding head={`Farm-to-market roads: ${php(fmr.house)} to ${php(fmr.senate)}.`}>
            The Senate removes {n(fmr.status.cut?.n ?? 0)} roads ({php(fmr.status.cut?.house ?? 0)}), {n(fmr.house_inserted.removed_n)} of the {n(fmr.house_inserted.n)} House insertions
            among them; lists {n(fmr.status.added?.n ?? 0)} documented additions of its own ({php(fmr.status.added?.senate ?? 0)}) and restores {n(fmr.status.restored?.n ?? 0)} NEP roads the House
            dropped ({php(fmr.status.restored?.senate ?? 0)}). {n(fmr.status.renamed?.n ?? 0)} House roads keep their budget under a revised name; many of them the annex prints as
            removed and inserted again, and we read them as one project.
          </Finding>
          <Finding head={`Irrigation (NIA): ${php(nia.house)} to ${php(nia.senate)}.`}>
            {n(nia.status.cut?.n ?? 0)} projects removed ({php(nia.status.cut?.house ?? 0)}), {n(nia.house_inserted.removed_n)} of the {n(nia.house_inserted.n)} House insertions among them;
            {' '}{n(nia.status.added?.n ?? 0)} documented additions by the Senate ({php(nia.status.added?.senate ?? 0)}), {n(nia.status.restored?.n ?? 0)} restored from the NEP
            ({php(nia.status.restored?.senate ?? 0)}) and {n(nia.status.raised?.n ?? 0)} raised. {n(nia.status.renamed?.n ?? 0)} keep their amount under a revised name.
          </Finding>
          <Finding head={`Health facilities (HFEP): ${php(hf.house)} to ${php(hf.senate)}.`}>
            The Senate adds {r.hfep_kinds.map((k) => `${php(k.change)} for ${k.kind.toLowerCase().replace(/vehicle$/, 'vehicles')}`).join(', ')}: {n(hf.status.added?.n ?? 0)} documented
            additions of facility components (some for a facility whose other component the House bill funds), {n(hf.status.restored?.n ?? 0)} restored from the NEP and {n(hf.status.raised?.n ?? 0)} raised.
            It removes one.
          </Finding>
        </ul>
      </section>
    </>
  );
}

function DpwhPage({ r }: { r: Report }) {
  const dp = r.programs.dpwh;
  const cut = dp.status.cut!;
  const raised = r.dpwh_raised.reduce((a, x) => a + x.change, 0);
  const regions = [...dp.regions].filter((x) => x.house > 0).sort((a, b) => (a.senate - a.house) / a.house - (b.senate - b.house) / b.house);
  return (
    <>
      <PageHead title="DPWH">
        <p>The DPWH projects of the House bill in the Senate committee report (Annex A-4): {php(dp.house)} in the House bill, {php(dp.senate)} in the Senate.</p>
      </PageHead>
      <section className="rr-sec">
        <div className="rr-cards is-4">
          <Card label="Projects removed" value={n(cut.n)} tone="down" note={`${php(cut.house)} of House bill budget`} to={senateListPath('dpwh', 'status', 'cut')} />
          <Card label="House insertions removed" value={`${n(dp.house_inserted.removed_n)} of ${n(dp.house_inserted.n)}`} tone="down"
            note={`${php(dp.house_inserted.removed)}, ${pct(dp.house_inserted.removed, dp.house_inserted.house)} of their budget`} />
          <Card label="NEP-proposed projects removed" value={`${n(dp.nep_proposed.removed_n)} of ${n(dp.nep_proposed.n)}`} note={php(dp.nep_proposed.removed)} />
          <Card label="Foreign-assisted projects raised" value={n(r.dpwh_raised.length)} tone="up" note={`+${php(raised)}`} to={senateListPath('dpwh', 'status', 'raised')} />
        </div>
        <p className="rr-note">
          The Central Office’s projects carry {php(r.dpwh_central_office.removed)} of the removed budget ({n(r.dpwh_central_office.removed_n)} projects). Multi-purpose buildings: the
          Senate removes {n(r.dpwh_mpb.removed_n)} of {n(r.dpwh_mpb.n)} ({php(r.dpwh_mpb.removed)} of {php(r.dpwh_mpb.house)}), {n(r.dpwh_mpb.inserted_removed_n)} of them among
          the {n(r.dpwh_mpb.inserted_n)} the House inserted.
        </p>
        <div className="sr-split">
          <div>
            <h3 className="rr-h3 is-first">By program line</h3>
            <div className="rr-table-wrap">
              <table className="rr-table">
                <thead><tr><th scope="col">Program line</th><th scope="col" className="num">House bill</th><th scope="col" className="num">Senate</th><th scope="col" className="num">Change</th><th scope="col" className="num">Removed</th></tr></thead>
                <tbody>
                  {r.dpwh_program_lines.filter((x) => x.house !== x.senate).map((x) => (
                    <tr key={x.line}>
                      <th scope="row">{x.line}</th><td className="num">{php(x.house)}</td><td className="num"><b>{php(x.senate)}</b></td>
                      <td className="num"><Chg v={x.senate - x.house} base={x.house} /></td><td className="num">{n(x.removed_n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3 className="rr-h3 is-first">By region, largest share cut first</h3>
            <div className="rr-table-wrap">
              <table className="rr-table">
                <thead><tr><th scope="col">Region</th><th scope="col" className="num">House bill</th><th scope="col" className="num">Senate</th><th scope="col" className="num">Change</th></tr></thead>
                <tbody>
                  {regions.map((x) => (
                    <tr key={x.region}>
                      <th scope="row"><Link to={senateListPath('dpwh', 'region', x.region)}>{x.region}</Link></th>
                      <td className="num">{php(x.house)}</td><td className="num"><b>{php(x.senate)}</b></td><td className="num"><Chg v={x.senate - x.house} base={x.house} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="rr-note">NCR includes the Central Office’s foreign-assisted projects, which the Senate raises.</p>
          </div>
        </div>
      </section>
      <section className="rr-sec">
        <h3 className="rr-h3 is-first">The foreign-assisted projects the Senate raises</h3>
        <div className="rr-table-wrap">
          <table className="rr-table">
            <thead><tr><th scope="col">Project</th><th scope="col" className="num">NEP</th><th scope="col" className="num">House bill</th><th scope="col" className="num">Senate</th><th scope="col" className="num">Change</th><th scope="col">Annex A-4</th></tr></thead>
            <tbody>
              {r.dpwh_raised.map((x) => (
                <tr key={x.id}>
                  <th scope="row"><Link to={senateRecordPath('dpwh', x.id)}>{x.title}</Link></th>
                  <td className="num">{php(x.nep)}</td><td className="num">{php(x.house)}</td><td className="num"><b>{php(x.senate)}</b></td>
                  <td className="num"><Chg v={x.change} base={x.house} /></td>
                  <td><a className="rr-link" href={senatePdfUrl('senate-cr-annex-a4', x.page)} target="_blank" rel="noreferrer">p. {x.page}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function OfficesPage({ r }: { r: Report }) {
  return (
    <>
      <PageHead title="District offices">
        <p>The district engineering offices whose House bill DPWH projects lose the most budget in the Senate (the Central Office apart: see DPWH).</p>
      </PageHead>
      <section className="rr-sec">
        <p className="rr-note">An office’s budget, not a district’s: an office can serve more than one legislative district (Shared). A project’s office is not a statement about any official.</p>
        <div className="rr-table-wrap">
          <table className="rr-table">
            <thead><tr><th scope="col">Office</th><th scope="col" className="num">House bill</th><th scope="col" className="num">Removed</th><th scope="col" className="num">Share</th><th scope="col" className="num">Projects removed</th></tr></thead>
            <tbody>
              {r.dpwh_offices.map((o) => (
                <tr key={o.office}>
                  <th scope="row">
                    <Link to={senateListPath('dpwh', 'office', o.office)}>{o.office.replace('District Engineering Office', 'DEO')}</Link>
                    <span className="rr-sub">{o.tier === 'B' ? 'Shared: ' : 'Lone: '}{o.districts.join(' · ') || 'no single district'}</span>
                  </th>
                  <td className="num">{php(o.house)}</td><td className="num"><b>{php(o.removed)}</b></td>
                  <td className="num">{pct(o.removed, o.house)}</td><td className="num">{n(o.removed_n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function FlagsPage({ r }: { r: Report }) {
  const fl = r.dpwh_flags;
  const rows: Array<[string, string, string]> = [
    ['Flagged as a potential NEP insertion', `${fl.removed.insertion_flag}%`, `${fl.kept.insertion_flag}%`],
    ['With 5 or more red flags', `${fl.removed.five_plus_flags}%`, `${fl.kept.five_plus_flags}%`],
    ['Red flags on average', String(fl.removed.avg_flags), String(fl.kept.avg_flags)],
    ['With none of the 5 key documents', `${fl.removed.no_key_document}%`, `${fl.kept.no_key_document}%`],
    ['With all 5 key documents', `${fl.removed.all_five_documents}%`, `${fl.kept.all_five_documents}%`],
  ];
  return (
    <>
      <PageHead title="Red flags">
        <p>The DPWH projects the Senate removes and those it keeps, by the red flags and documents in the <Link to={REVIEW_ROOT}>project reviewer</Link> ({n(fl.in_reviewer)} of {n(fl.projects)} House bill projects).</p>
      </PageHead>
      <section className="rr-sec">
        <div className="rr-cards is-4">
          <Card label="Removed: potential NEP insertion" value={`${fl.removed.insertion_flag}%`} tone="down" note={`kept: ${fl.kept.insertion_flag}%`} />
          <Card label="Removed: none of the 5 key documents" value={`${fl.removed.no_key_document}%`} tone="down" note={`kept: ${fl.kept.no_key_document}%`} />
          <Card label="Removed: 5 or more red flags" value={`${fl.removed.five_plus_flags}%`} tone="down" note={`kept: ${fl.kept.five_plus_flags}%`} />
          <Card label="Red flags on average" value={`${fl.removed.avg_flags} vs ${fl.kept.avg_flags}`} note="removed vs kept" />
        </div>
        <div className="rr-table-wrap">
          <table className="rr-table rr-narrow">
            <thead><tr><th scope="col">Of the projects…</th><th scope="col" className="num">Removed by the Senate ({n(fl.removed.n)})</th><th scope="col" className="num">Kept ({n(fl.kept.n)})</th></tr></thead>
            <tbody>{rows.map(([k, a, b]) => <tr key={k}><th scope="row">{k}</th><td className="num"><b>{a}</b></td><td className="num">{b}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="rr-note">
          A red flag is a reason to look, not a finding. The committee report gives no reason for each project it removes: this is a pattern in the data, not the
          Senate’s stated reason. The red flags and documents are the House bill’s (research.bettergov.ph and ours), as built for the reviewer.
          Documents project by project, 5 of 5 to 0 of 5: <Link to={pagePath('documents')}>Documents</Link>.
        </p>
      </section>
    </>
  );
}

// --- Documents -------------------------------------------------------------------------------------------------------

/**
 * The House bill review report's document breakdown (HgabReportPages.tsx DocumentsPage: the five key documents, from
 * the Senate copies, DPWH Transparency or either) with the Senate's figures on every row (Jason, 2026-11-27: "the
 * document breakdown again ... similar to the hgab report but include the Senate numbers ... 5 of 5, 4 of 5, 3 of 5,
 * the tally based on the document count"). Project counts and House bill budgets are the House report's own
 * (checked against its docTally when built).
 */
function DocumentsPage({ r }: { r: Report }) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('from') ?? '';
  const from: DocFrom = (DOC_FROM as readonly string[]).includes(raw) ? raw as DocFrom : 'either';
  const setFrom = (f: DocFrom) => setParams((prev) => { const next = new URLSearchParams(prev); if (f === 'either') next.delete('from'); else next.set('from', f); return next; }, { replace: true });
  const d = r.dpwh_documents;
  if (!d) return <PageHead title="Documents"><p>This build of the report doesn’t have the document breakdown yet.</p></PageHead>;
  const t = d.by[from];
  const zero = t.count[5];
  const five = t.count[0];
  const unchecked = d.projects.n - d.checked;
  return (
    <>
      <PageHead title="Documents">
        <p>
          The DPWH projects in the House bill by how many of the five key documents were found for them, counted as in the House bill{' '}
          <Link to={REVIEW_ROOT}>project reviewer</Link>, and what the Senate committee report does to each: its budget in the House bill and in the Senate’s
          version, and the projects the Senate removes (cuts to zero).
        </p>
      </PageHead>

      <div className="rr-switch" role="group" aria-label="Count documents from">
        <span className="rr-filters-l">Count documents from</span>
        {DOC_FROM.map((f) => (
          <button key={f} type="button" className={`rr-chip${from === f ? ' is-on' : ''}`} aria-pressed={from === f} onClick={() => setFrom(f)} title={DOC_FROM_NOTE[f]}>{DOC_FROM_LABEL[f]}</button>
        ))}
      </div>

      <section className="rr-sec">
        <div className="rr-cards is-4">
          <Card label="0 of 5 key documents: removed" value={pct(zero.removed_n, zero.n)} tone="down" note={`${n(zero.removed_n)} of ${n(zero.n)} projects · ${php(zero.removed)} of ${php(zero.house)}`} />
          <Card label="5 of 5 key documents: removed" value={pct(five.removed_n, five.n)} note={`${n(five.removed_n)} of ${n(five.n)} projects · ${php(five.removed)} of ${php(five.house)}`} />
          <Card label={`${DOC_LEVEL_LABEL.complete}: removed`} value={pct(t.levels.complete.removed_n, t.levels.complete.n)}
            note={`${n(t.levels.complete.removed_n)} of ${n(t.levels.complete.n)} projects · ${php(t.levels.complete.removed)}`} />
          <Card label="All DPWH projects: removed" value={pct(d.projects.removed_n, d.projects.n)}
            note={`${n(d.projects.removed_n)} of ${n(d.projects.n)} projects · ${php(d.projects.removed)} of ${php(d.projects.house)}`} />
        </div>

        <h3 className="rr-h3">By how many of the five key documents <span className="rr-muted">· {DOC_FROM_LABEL[from]}</span></h3>
        <div className="rr-table-wrap">
          <table className="rr-table">
            <DocHead first="Key documents found" />
            <tbody>
              {t.count.map((c, i) => <DocRow key={i} label={`${5 - i} of 5`} c={c} />)}
              {unchecked > 0 && <DocRow label="Not checked yet" c={t.levels.unchecked} muted />}
              <DocRow label="All DPWH projects" c={d.projects} total />
            </tbody>
          </table>
        </div>
        <p className="rr-note">
          Each row: the projects with that many of the five key documents (program of work, BP 202, development council endorsement, geotagged photos,
          certificate of implementability) in {from === 'either' ? 'either source' : `the ${DOC_FROM_LABEL[from]}`}; their budget in the House bill and in the
          Senate committee report; and the projects the Senate removes, with their House bill budget. Senate amounts in red are lower than the House bill’s.
          {unchecked > 0 && <> “Not checked yet”: {n(unchecked)} lines outside research.bettergov.ph’s document check (foreign-assisted projects, small facility lines).</>}
        </p>
        {from === 'senate' && (
          <p className="rr-note">
            DPWH gave the Senate documents mostly for House insertions, the projects the Senate removes most often: so here, more documents go with more removals.
            Compare House insertions and NEP projects below.
          </p>
        )}

        <h3 className="rr-h3">Complete, partial or none <span className="rr-muted">· {DOC_FROM_LABEL[from]}</span></h3>
        <div className="rr-table-wrap">
          <table className="rr-table">
            <DocHead first="Documents" />
            <tbody>
              {(['complete', 'partial', 'none'] as const).map((l) => <DocRow key={l} label={DOC_LEVEL_LABEL[l]} c={t.levels[l]} />)}
              {unchecked > 0 && <DocRow label={DOC_LEVEL_LABEL.unchecked} c={t.levels.unchecked} muted />}
            </tbody>
          </table>
        </div>
        <p className="rr-note">“No document found”: none of the five and no other file in {from === 'either' ? 'either source' : 'this source'}.</p>
      </section>

      <section className="rr-sec">
        <h3 className="rr-h3 is-first">The five key documents <span className="rr-muted">· {DOC_FROM_LABEL[from]}</span></h3>
        <div className="rr-table-wrap">
          <table className="rr-table">
            <thead>
              <tr>
                <th scope="col">Document</th><th scope="col">What it is</th>
                <th scope="col" className="num">With it</th><th scope="col" className="num">Removed</th>
                <th scope="col" className="num">Without it</th><th scope="col" className="num">Removed</th><th scope="col" className="num">Budget removed without it</th>
              </tr>
            </thead>
            <tbody>
              {NAMED_TYPES.map((type, i) => {
                const x = t.types[i];
                if (!x) return null;
                return (
                  <tr key={type}>
                    <th scope="row">{type === 'POW' ? 'Program of work (POW)' : type}</th>
                    <td className="rr-muted">{NAMED_MEANING[type]}</td>
                    <td className="num">{n(x.with.n)}</td><td className="num"><RemovedShare c={x.with} /></td>
                    <td className="num">{n(x.without.n)}</td><td className="num"><RemovedShare c={x.without} /></td>
                    <td className="num">{php(x.without.removed)} <small>{pct(x.without.removed, x.without.house)}</small></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="rr-note">Of the {n(d.checked)} projects whose documents were checked. “Removed”: the share of those projects the Senate removes.</p>
      </section>

      <section className="rr-sec">
        <h3 className="rr-h3 is-first">Where each project’s files come from</h3>
        <div className="rr-table-wrap">
          <table className="rr-table">
            <DocHead first="Files from" />
            <tbody>
              {(['senate', 'nep', 'both', 'none'] as const).map((g) => <DocRow key={g} label={FILES_FROM[g]} c={d.sources[g]} />)}
            </tbody>
          </table>
        </div>
        <p className="rr-note">Either source, of the {n(d.checked)} projects whose documents were checked. Senate copies: what DPWH gave the Senate for the House bill’s projects, with signatures redacted. DPWH Transparency: what DPWH published for the NEP proposal.</p>
      </section>

      <section className="rr-sec">
        <h3 className="rr-h3 is-first">House insertions and NEP projects</h3>
        <div className="rr-table-wrap">
          <table className="rr-table rr-narrow">
            <thead>
              <tr>
                <th scope="col">Documents (either source)</th>
                <th scope="col" className="num">House insertions</th><th scope="col" className="num">Removed</th>
                <th scope="col" className="num">NEP projects</th><th scope="col" className="num">Removed</th>
              </tr>
            </thead>
            <tbody>
              {(['complete', 'partial', 'none', 'unchecked'] as const).filter((l) => d.insertion.insertion[l].n + d.insertion.nep[l].n > 0).map((l) => (
                <tr key={l}>
                  <th scope="row">{DOC_LEVEL_LABEL[l]}</th>
                  <td className="num">{n(d.insertion.insertion[l].n)}</td><td className="num"><RemovedShare c={d.insertion.insertion[l]} /></td>
                  <td className="num">{n(d.insertion.nep[l].n)}</td><td className="num"><RemovedShare c={d.insertion.nep[l]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rr-note">House insertions: in the House bill but not in the NEP, by our comparison. NEP projects: the rest.</p>
      </section>

      <section className="rr-sec">
        <h3 className="rr-h3 is-first">By region</h3>
        <div className="rr-table-wrap">
          <table className="rr-table">
            <thead>
              <tr>
                <th scope="col">Region</th><th scope="col" className="num">Projects</th><th scope="col" className="num">House bill</th><th scope="col" className="num">Senate</th>
                <th scope="col" className="num">Removed</th><th scope="col" className="num" title="Of the projects with none of the five and no file">No document: removed</th>
                <th scope="col" className="num" title={`Of the projects with ${DOC_LEVEL_LABEL.complete.toLowerCase()}`}>{DOC_LEVEL_LABEL.complete}: removed</th>
              </tr>
            </thead>
            <tbody>
              {d.regions.map((x) => (
                <tr key={x.region}>
                  <th scope="row">{x.region}</th>
                  <td className="num">{n(x.all.n)}</td><td className="num">{php(x.all.house)}</td><td className="num"><SenateAmt c={x.all} /></td>
                  <td className="num"><RemovedShare c={x.all} /></td><td className="num"><RemovedShare c={x.none} /></td><td className="num"><RemovedShare c={x.complete} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rr-note">Either source; the most budget removed first. A region’s projects are those its DPWH offices list.</p>
      </section>

      <section className="rr-sec">
        <p className="rr-note">
          The committee report gives no reason for each project it removes: this is a pattern in the data, not the Senate’s stated reason. Having a document
          doesn’t verify what’s in it. Documents as found for the House bill reviewer{d.reviewer_built_at && <> (as of {d.reviewer_built_at.slice(0, 10)})</>}:
          research.bettergov.ph’s document check and our links to the files.
        </p>
      </section>
    </>
  );
}

const FILES_FROM: Record<'senate' | 'nep' | 'both' | 'none', string> = {
  senate: 'House bill only (Senate copies)', nep: 'NEP only (DPWH Transparency)', both: 'Both', none: 'No file found',
};

function DocHead({ first }: { first: string }) {
  return (
    <thead>
      <tr>
        <th scope="col">{first}</th><th scope="col" className="num">Projects</th><th scope="col" className="num">House bill</th><th scope="col" className="num">Senate</th>
        <th scope="col" className="num">Change</th><th scope="col" className="num">Removed by the Senate</th><th scope="col" className="num">Budget removed</th>
      </tr>
    </thead>
  );
}

function DocRow({ label, c, total, muted }: { label: ReactNode; c: DocCell; total?: boolean; muted?: boolean }) {
  return (
    <tr className={total ? 'rr-total' : muted ? 'rr-muted' : undefined}>
      <th scope="row">{label}</th>
      <td className="num">{n(c.n)}</td>
      <td className="num">{php(c.house)}</td>
      <td className="num"><SenateAmt c={c} /></td>
      <td className="num"><Chg v={c.senate - c.house} base={c.house} /></td>
      <td className="num"><RemovedShare c={c} count /></td>
      <td className="num">{php(c.removed)} <small>{pct(c.removed, c.house)}</small></td>
    </tr>
  );
}

/** The Senate's amount: red when lower than the House bill's, green when higher. */
function SenateAmt({ c }: { c: DocCell }) {
  return <span className={c.senate < c.house ? 'sr-chg is-down' : c.senate > c.house ? 'sr-chg is-up' : undefined}>{php(c.senate)}</span>;
}

/** The share of the projects the Senate removes, as a red meter (and the count). */
function RemovedShare({ c, count }: { c: DocCell; count?: boolean }) {
  if (!c.n) return <span className="rr-muted">—</span>;
  return (
    <span className="rr-meter sr-meter-down" title={`${n(c.removed_n)} of ${n(c.n)} projects removed`}>
      <span className="rr-meter-track" aria-hidden="true"><span style={{ width: `${(100 * c.removed_n) / c.n}%` }} /></span>
      <b>{pct(c.removed_n, c.n)}</b>{count && <small>{n(c.removed_n)}</small>}
    </span>
  );
}

function ProvisionsPage({ r }: { r: Report }) {
  const p = r.provisions;
  return (
    <>
      <PageHead title="Provisions">
        <p>The rules attached to the budget: amounts written into special provisions, conditions on releases, reports agencies must file (Annex B).</p>
      </PageHead>
      <section className="rr-sec">
        <div className="rr-cards is-4">
          <Card label="Senate amendments to provisions" value={n(p.n)} to={SENATE_PROVISIONS_ROOT} />
          <Card label="Special provisions" value={n(p.n - p.general)} />
          <Card label="General provisions" value={n(p.general)} />
        </div>
        <h3 className="rr-h3">Departments with the most amendments</h3>
        <div className="rr-table-wrap">
          <table className="rr-table rr-narrow">
            <thead><tr><th scope="col">Department</th><th scope="col" className="num">Amendments</th></tr></thead>
            <tbody>{p.by_department.map((x) => <tr key={x.department}><th scope="row">{nameCase(x.department.replace(/^[IVXL]+\.\s*/, ''))}</th><td className="num">{n(x.n)}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="rr-note">Read them all, with the House bill page each one changes: <Link to={SENATE_PROVISIONS_ROOT}>Provisions</Link>.</p>
      </section>
    </>
  );
}

function AboutPage({ r }: { r: Report }) {
  return (
    <>
      <PageHead title="About this report" />
      <section className="rr-sec">
        <h3 className="rr-h3 is-first">What this report does not say</h3>
        <ul className="sr-list">
          <li>The Senate committee report is the committee’s version. The Senate still votes on it, and both chambers then settle one text in the bicameral conference.</li>
          <li>The report changes amounts; it doesn’t give a reason for each project it removes. Patterns here (red flags, House insertions) are what the data shows, not the Senate’s reasons.</li>
          <li>A red flag is a reason to look, not a finding. An office’s budget is not a statement about any official.</li>
          <li>The NEP, the House bill and the Senate committee report are versions of one budget: compare them, never add them.</li>
          <li>Under citizen review: we have not finished checking every figure. Before you cite one, open the page of the report it gives.</li>
        </ul>
        <h3 className="rr-h3">Where every figure comes from</h3>
        <p className="rr-note">
          The <Link to={SENATE_DATA_ROOT}>Senate committee report dataset</Link>: every project, amendment, General Summary line and provision, read from the report’s PDFs,
          with {r.checks.totals_passed ?? r.checks.passed} of {r.checks.totals_run ?? r.checks.run} checks against its printed totals and arithmetic passing
          {r.checks.page_links ? <>, and {r.checks.page_links_ok?.toLocaleString()} of {r.checks.page_links.toLocaleString()} page links opening a page that prints their project</> : null}. Red flags and documents: the House bill <Link to={REVIEW_ROOT}>project reviewer</Link>.
          Report built {r.built_at.slice(0, 10)}{r.source_commit && <> from commit <code>{r.source_commit.slice(0, 10)}</code></>} (<code>scripts/senate-cr/build_report.py</code>).
        </p>
      </section>
    </>
  );
}
