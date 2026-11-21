/**
 * `/senate/2027/report`: an executive report on the Senate committee report (Jason, 2026-11-21: "an executive report
 * of what was changed and our analysis based on that data ... don't link it for now"). Not in any menu or the
 * sitemap, and noindex. Every figure comes from senate/2027/report.json (scripts/senate-cr/build_report.py), which
 * reads the published dataset (senate/2027/downloads/) and, for DPWH red flags and documents, the House bill
 * reviewer's index.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip } from '../components/Nep2027Bits';
import { SenateError, SenateHeader, SenateHero, SenateLoading, SenateNotice, SenateReviewBanner, SignedChange } from '../components/SenateBits';
import * as fmt from '../lib/format';
import { cached, getJson, type DatasetKey } from '../lib/hgab';
import { dataUrl } from '../lib/data-url';
import { REVIEW_ROOT } from '../lib/hgab-review';
import { pageMeta } from '../lib/seo';
import {
  SENATE_BASE, SENATE_DATA_ROOT, SENATE_EXPLORER_ROOT, SENATE_PROVISIONS_ROOT, SENATE_REPORT_ROOT, nameCase, senateListPath, senatePdfUrl, senateProgramPath,
  senateRecordPath,
} from '../lib/senate';
import '../nep2027.css';
import '../hgab-explorer.css';

interface Amt { house: number; increase: number; decrease: number; net: number; senate: number }
interface Dept extends Amt { no: string; name: string; nep: number | null }
interface Line { department: string; agency: string | null; item: string | null; label: string; house: number | null; net: number; senate: number | null; status: string; page: number }
interface StatusSum { n: number; house: number | null; senate: number | null; change: number | null }
interface Program {
  house: number; senate: number; nep: number;
  status: Partial<Record<'cut' | 'reduced' | 'raised' | 'added' | 'renamed' | 'unchanged', StatusSum>>;
  replaces: number;
  house_inserted: { n: number; house: number; removed_n: number; removed: number };
  nep_proposed: { n: number; house: number; removed_n: number; removed: number };
  regions: Array<{ region: string; n: number; house: number; senate: number; removed_n: number }>;
}
interface Profile { n: number; insertion_flag: number; five_plus_flags: number; avg_flags: number; no_key_document: number; all_five_documents: number }
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
  dpwh_offices: Array<{ office: string; districts: string[]; tier: string | null; removed_n: number; removed: number; house: number }>;
  dpwh_central_office: { house: number; senate: number; removed_n: number; removed: number };
  hfep_kinds: Array<{ kind: string; n: number; change: number }>;
  provisions: { n: number; general: number; by_department: Array<{ department: string; n: number }> };
  checks: { run: number; passed: number };
}

const loadReport = () => cached('senate:report', () => getJson<Report>(dataUrl(`${SENATE_BASE}/report.json`), 'Could not load the Senate report'));

const php = (v: number | null | undefined) => (v == null ? '—' : fmt.shortPhp(v));
/** Trillions with three decimals: a whole-bill change of under a billion still shows. */
const trillion = (v: number) => `${(v / 1e12).toFixed(3)}T`;
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt.shortPhp(Math.abs(v))}`;
const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : '—');
const n = (v: number) => v.toLocaleString('en-US');
const PROGRAM_NAME: Record<DatasetKey, string> = {
  dpwh: 'DPWH projects', fmr: 'Farm-to-market roads (DA)', hfep: 'Health facilities (DOH HFEP)', nia: 'Irrigation (NIA)',
};

function Finding({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <li className="senate-rep-finding">
      <strong>{head}</strong> {children}
    </li>
  );
}

export default function SenateReport() {
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    document.title = pageMeta(SENATE_REPORT_ROOT).title;
    loadReport().then(setR).catch((e) => setErr(String(e?.message || e)));
  }, []);
  if (err) return <SenateError message={err} />;
  if (!r) return <SenateLoading what="the executive report" />;

  const t = r.totals;
  const dp = r.programs.dpwh;
  const fmr = r.programs.fmr;
  const nia = r.programs.nia;
  const hf = r.programs.hfep;
  const line = (s: string) => r.big_lines.find((x) => (x.item ?? '').toLowerCase().includes(s.toLowerCase()));
  const map = line('Medical Assistance Program');
  const phic = line('National Health Insurance');
  const nscr = line('North-South Commuter');
  const mmsp = r.big_lines.filter((x) => (x.item ?? '').includes('Metro Manila Subway'));
  const feeding = line('School-Based Feeding');
  const aics = line('Protective Services');
  const hosp = line('Regional Hospitals');
  const animal = r.big_lines.filter((x) => (x.item ?? '').includes('Animal Industry'));
  const bef = line('Basic Education Facilities');
  const dpwhDept = [...r.departments.cuts, ...r.departments.gains].find((d) => d.name.includes('PUBLIC WORKS'));
  const raisedTotal = r.dpwh_raised.reduce((a, x) => a + x.change, 0);
  const raisedNep = r.dpwh_raised.reduce((a, x) => a + (x.nep ?? 0), 0);
  const raisedHouse = r.dpwh_raised.reduce((a, x) => a + x.house, 0);
  const cut = dp.status.cut!;
  const fl = r.dpwh_flags;
  const fmrAdded = fmr.status.added;
  const date = new Date(r.dataset_built_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
  const regions = [...dp.regions].filter((x) => x.house > 0).sort((a, b) => (a.senate - a.house) / a.house - (b.senate - b.house) / b.house);

  return (
    <>
      <SenateHeader crumb="Executive report" />
      <SenateHero
        compact
        crumb="Executive report"
        title="What the Senate changed in the 2027 budget"
        dek={<>An executive report on the Senate Committee on Finance's report on House Bill 10858, the FY 2027 General Appropriations Bill, and what our data shows. Data as of {date}.</>}
      />
      <main className="nep-main hgab-ex-main senate-report">
        <SenateReviewBanner compact />

        <section className="nep-section">
          <SectionHead size="sm" eyebrow="Summary" headline="Key findings on the Senate's changes" />
          <ul className="senate-rep-findings">
            <Finding head="The same total, different priorities.">
              The Senate keeps programmed appropriations at {php(t.programmed.house)}, the House bill's to the peso, and moves {php(t.programmed.increase)} between
              lines. Total new appropriations go from {trillion(t.total.house)} to {trillion(t.total.senate)} ({signed(t.total.net)}), all of it in unprogrammed appropriations.
            </Finding>
            {dpwhDept && (
              <Finding head="DPWH takes the largest Senate cut.">
                The department falls {signed(dpwhDept.net)} ({pct(dpwhDept.net, dpwhDept.house)}). Its projects go from {php(dp.house)} to {php(dp.senate)}: the
                Senate removes {n(cut.n)} projects worth {php(cut.house)} and raises {n(dp.status.raised?.n ?? 0)} by {php(dp.status.raised?.change ?? 0)}.
              </Finding>
            )}
            <Finding head="Most of what the Senate removes, the House had inserted.">
              Of the {n(dp.house_inserted.n)} DPWH projects the House inserted (no line in the NEP, {php(dp.house_inserted.house)}), the Senate removes {n(dp.house_inserted.removed_n)},
              {' '}{php(dp.house_inserted.removed)} or {pct(dp.house_inserted.removed, dp.house_inserted.house)} of their budget. It removes {n(dp.nep_proposed.removed_n)} of
              the {n(dp.nep_proposed.n)} projects the NEP proposed ({php(dp.nep_proposed.removed)}). In farm-to-market roads it removes {n(fmr.house_inserted.removed_n)} of
              the {n(fmr.house_inserted.n)} House insertions.
            </Finding>
            <Finding head="Foreign-assisted projects are restored, in part.">
              All {r.dpwh_raised.length} DPWH projects the Senate raises are foreign-assisted, by {php(raisedTotal)}: from {php(raisedHouse)} in the House bill to{' '}
              {php(raisedHouse + raisedTotal)}, against {php(raisedNep)} in the NEP.
              {nscr && mmsp.length > 0 && <> The Department of Transportation gains {php(nscr.net + mmsp.reduce((a, x) => a + x.net, 0))} on two railways (North-South Commuter Railway, Metro Manila Subway).</>}
            </Finding>
            {(map || phic) && (
              <Finding head="Health and social protection are reshaped.">
                {map && <>The DOH Medical Assistance Program is cut by {php(Math.abs(map.net))} ({php(map.house)} to {php(map.senate)}). </>}
                {phic && <>PhilHealth's National Health Insurance Program gains {php(phic.net)}. </>}
                {hosp && <>DOH regional hospital operations gain {php(hosp.net)}, and health facilities (HFEP) {php(hf.senate - hf.house)}. </>}
                {aics && <>DSWD's protective services for individuals and families in crisis are cut by {php(Math.abs(aics.net))}. </>}
                {feeding && <>DepEd's school-based feeding gains {php(feeding.net)}.</>}
              </Finding>
            )}
            <Finding head="The projects the Senate removes carried more red flags.">
              {fl.removed.insertion_flag}% of the removed DPWH projects were flagged as potential NEP insertions, against {fl.kept.insertion_flag}% of those
              kept; {fl.removed.no_key_document}% had none of the five key documents, against {fl.kept.no_key_document}%. The report gives no reason for each
              removal: this is a pattern in the data, not the Senate's stated reason.
            </Finding>
            <Finding head="Unprogrammed appropriations are rebuilt.">
              The Senate adds {php(t.unprogrammed.increase)} and takes out {php(Math.abs(t.unprogrammed.decrease))} in unprogrammed appropriations, which end
              at {php(t.unprogrammed.senate)} ({signed(t.unprogrammed.net)}).
            </Finding>
          </ul>
        </section>

        <section className="nep-section">
          <SectionHead size="sm" eyebrow="The whole bill" headline="The Senate's totals beside the House bill's" />
          <div className="senate-kpi5"><KpiStrip items={[
            { label: 'Total new appropriations, Senate', value: trillion(t.total.senate), sub: `${signed(t.total.net)} vs the House bill` },
            { label: 'Programmed, Senate', value: trillion(t.programmed.senate), sub: t.programmed.net === 0 ? 'the same as the House bill' : `${signed(t.programmed.net)} vs the House bill` },
            { label: 'Moved between lines', value: php(t.programmed.increase), sub: 'raised in some lines, cut from others' },
            { label: 'Departments', value: signed(t.departments.net), tone: t.departments.net < 0 ? 'down' : 'up', sub: `special purpose funds ${signed(t.spf.net)}` },
            { label: 'Unprogrammed, Senate', value: php(t.unprogrammed.senate), sub: `${signed(t.unprogrammed.net)} vs the House bill` },
          ]} /></div>
          <p className="senate-rep-p">
            {r.departments.changed} of {r.departments.count} departments and funds change in the Senate committee report. The departments together lose{' '}
            {php(Math.abs(t.departments.net))}; the special purpose funds gain the same, so the programmed total doesn't move.
          </p>
          <div className="senate-rep-split">
            <DeptTable title="Largest Senate increases, by department" rows={r.departments.gains} />
            <DeptTable title="Largest Senate cuts, by department" rows={r.departments.cuts} />
          </div>
        </section>

        <section className="nep-section">
          <SectionHead size="sm" eyebrow="Line by line" headline="The largest single Senate amendments" dek="Outside DPWH, which follows. Each is one amount Annex A prints; the page opens the report." />
          <LineTable rows={r.big_lines} />
          <p className="nep-provenance">Every amendment, department by department: <Link to={SENATE_EXPLORER_ROOT}>Line by line</Link>.</p>
          {animal.length > 0 && bef && (
            <p className="senate-rep-p">
              Two programs the House bill funds lose all or most of their budget: DA's Animal Industry Development and Competitiveness Program (
              {php(animal.reduce((a, x) => a + (x.house ?? 0), 0))} in the House bill, removed) and DepEd's Basic Education Facilities capital outlay ({signed(bef.net)}).
            </p>
          )}
        </section>

        <section className="nep-section">
          <SectionHead size="sm" eyebrow="Unprogrammed appropriations" headline="What the Senate takes out of unprogrammed appropriations, and puts in"
            dek={`In ${php(t.unprogrammed.increase)}, out ${php(Math.abs(t.unprogrammed.decrease))}. A lump sum for foreign-assisted projects gives way to named ones.`} />
          <LineTable rows={r.unprogrammed_lines} noAgency />
        </section>

        <section className="nep-section">
          <SectionHead size="sm" eyebrow="Infrastructure" headline="The four infrastructure programs in the Senate" dek="Project by project, from Annexes A-1 to A-4. NEP, House bill and Senate are versions of one budget: compare them, don't add them." />
          <div className="nep-table-wrap">
            <table className="nep-table">
              <thead>
                <tr>
                  <th className="nep-th-name">Program</th><th className="num">NEP</th><th className="num">House bill</th><th className="num senate-col-senate">Senate</th>
                  <th className="num">vs House bill</th><th className="num">Removed</th><th className="num">Inserted by the Senate</th>
                </tr>
              </thead>
              <tbody>
                {(['dpwh', 'fmr', 'nia', 'hfep'] as DatasetKey[]).map((k) => {
                  const p = r.programs[k];
                  return (
                    <tr key={k}>
                      <td className="nep-td-name"><Link to={senateProgramPath(k)}>{PROGRAM_NAME[k]}</Link></td>
                      <td className="num nep-td-base">{php(p.nep)}</td>
                      <td className="num">{php(p.house)}</td>
                      <td className="num senate-col-senate"><strong>{php(p.senate)}</strong></td>
                      <td className="num"><SignedChange v={p.senate - p.house} base={p.house} /></td>
                      <td className="num">{p.status.cut ? <Link to={senateListPath(k, 'status', 'cut')}>{n(p.status.cut.n)} · {php(p.status.cut.house)}</Link> : '—'}</td>
                      <td className="num">{p.status.added ? <Link to={senateListPath(k, 'status', 'added')}>{n(p.status.added.n)} · {php(p.status.added.senate)}</Link> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="nep-section">
          <SectionHead size="sm" eyebrow="DPWH" headline="Where the Senate's DPWH cuts fall" />
          <div className="senate-kpi5"><KpiStrip items={[
            { label: 'Projects removed', value: n(cut.n), sub: `${php(cut.house)} of House bill budget` },
            { label: 'House insertions removed', value: `${n(dp.house_inserted.removed_n)} of ${n(dp.house_inserted.n)}`, sub: `${php(dp.house_inserted.removed)}, ${pct(dp.house_inserted.removed, dp.house_inserted.house)} of their budget` },
            { label: 'NEP-proposed removed', value: `${n(dp.nep_proposed.removed_n)} of ${n(dp.nep_proposed.n)}`, sub: `${php(dp.nep_proposed.removed)}` },
            { label: 'Multi-purpose buildings removed', value: `${n(r.dpwh_mpb.removed_n)} of ${n(r.dpwh_mpb.n)}`, sub: `${php(r.dpwh_mpb.removed)} of ${php(r.dpwh_mpb.house)}` },
            { label: 'Foreign-assisted raised', value: n(r.dpwh_raised.length), sub: `+${php(raisedTotal)}` },
          ]} /></div>
          <p className="senate-rep-p">
            The Central Office's projects carry {php(r.dpwh_central_office.removed)} of the removed budget ({n(r.dpwh_central_office.removed_n)} projects).
            Of the {n(r.dpwh_mpb.inserted_n)} multi-purpose buildings the House inserted ({php(r.dpwh_mpb.inserted)}), the Senate removes{' '}
            {n(r.dpwh_mpb.inserted_removed_n)} ({php(r.dpwh_mpb.inserted_removed)}).
          </p>
          <div className="senate-rep-split">
            <div>
              <h3 className="senate-rep-h3">By program line</h3>
              <table className="nep-table">
                <thead><tr><th className="nep-th-name">Program line</th><th className="num">House bill</th><th className="num">Senate</th><th className="num">Change</th><th className="num">Removed</th></tr></thead>
                <tbody>
                  {r.dpwh_program_lines.filter((x) => x.house !== x.senate).map((x) => (
                    <tr key={x.line}>
                      <td className="nep-td-name">{x.line}</td><td className="num">{php(x.house)}</td><td className="num"><strong>{php(x.senate)}</strong></td>
                      <td className="num"><SignedChange v={x.senate - x.house} base={x.house} /></td><td className="num">{n(x.removed_n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="senate-rep-h3">By region, largest share cut first</h3>
              <table className="nep-table">
                <thead><tr><th className="nep-th-name">Region</th><th className="num">House bill</th><th className="num">Senate</th><th className="num">Change</th></tr></thead>
                <tbody>
                  {regions.map((x) => (
                    <tr key={x.region}>
                      <td className="nep-td-name"><Link to={senateListPath('dpwh', 'region', x.region)}>{x.region}</Link></td>
                      <td className="num">{php(x.house)}</td><td className="num"><strong>{php(x.senate)}</strong></td>
                      <td className="num"><SignedChange v={x.senate - x.house} base={x.house} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="nep-provenance">NCR includes the Central Office's foreign-assisted projects, which the Senate raises.</p>
            </div>
          </div>
        </section>

        <section className="nep-section">
          <SectionHead size="sm" eyebrow="DPWH" headline="District engineering offices with the most budget removed by the Senate"
            dek="An office's budget, not a district's: an office can serve more than one district (Shared), and a project's office is not a statement about any official." />
          <div className="nep-table-wrap">
            <table className="nep-table">
              <thead><tr><th className="nep-th-name">Office</th><th className="num">House bill</th><th className="num">Removed</th><th className="num">Share</th><th className="num">Projects removed</th></tr></thead>
              <tbody>
                {r.dpwh_offices.map((o) => (
                  <tr key={o.office}>
                    <td className="nep-td-name">
                      <Link to={senateListPath('dpwh', 'office', o.office)}>{o.office.replace('District Engineering Office', 'DEO')}</Link>
                      <span className="senate-am-sub">{o.tier === 'B' ? 'Shared: ' : 'Lone: '}{o.districts.join(' · ') || 'no single district'}</span>
                    </td>
                    <td className="num">{php(o.house)}</td><td className="num"><strong>{php(o.removed)}</strong></td>
                    <td className="num">{pct(o.removed, o.house)}</td><td className="num">{n(o.removed_n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="nep-section">
          <SectionHead size="sm" eyebrow="DPWH" headline="Removed and kept DPWH projects, by red flags and documents"
            dek={<>From the <Link to={REVIEW_ROOT}>project reviewer</Link>'s index ({n(fl.in_reviewer)} of {n(fl.projects)} House bill projects). A red flag is a reason to look, not a finding.</>} />
          <div className="nep-table-wrap">
            <table className="nep-table senate-rep-compare">
              <thead><tr><th className="nep-th-name">Of the projects…</th><th className="num">Removed by the Senate ({n(fl.removed.n)})</th><th className="num">Kept ({n(fl.kept.n)})</th></tr></thead>
              <tbody>
                <tr><td className="nep-td-name">flagged as a potential NEP insertion</td><td className="num"><strong>{fl.removed.insertion_flag}%</strong></td><td className="num">{fl.kept.insertion_flag}%</td></tr>
                <tr><td className="nep-td-name">with 5 or more red flags</td><td className="num"><strong>{fl.removed.five_plus_flags}%</strong></td><td className="num">{fl.kept.five_plus_flags}%</td></tr>
                <tr><td className="nep-td-name">red flags on average</td><td className="num"><strong>{fl.removed.avg_flags}</strong></td><td className="num">{fl.kept.avg_flags}</td></tr>
                <tr><td className="nep-td-name">with none of the 5 key documents</td><td className="num"><strong>{fl.removed.no_key_document}%</strong></td><td className="num">{fl.kept.no_key_document}%</td></tr>
                <tr><td className="nep-td-name">with all 5 key documents</td><td className="num"><strong>{fl.removed.all_five_documents}%</strong></td><td className="num">{fl.kept.all_five_documents}%</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="nep-section">
          <SectionHead size="sm" eyebrow="DPWH" headline="The foreign-assisted projects the Senate raises" />
          <div className="nep-table-wrap">
            <table className="nep-table">
              <thead><tr><th className="nep-th-name">Project</th><th className="num">NEP</th><th className="num">House bill</th><th className="num senate-col-senate">Senate</th><th className="num">vs House bill</th><th>Page</th></tr></thead>
              <tbody>
                {r.dpwh_raised.map((x) => (
                  <tr key={x.id}>
                    <td className="nep-td-name"><Link to={senateRecordPath('dpwh', x.id)}>{x.title}</Link></td>
                    <td className="num nep-td-base">{php(x.nep)}</td><td className="num">{php(x.house)}</td>
                    <td className="num senate-col-senate"><strong>{php(x.senate)}</strong></td>
                    <td className="num"><SignedChange v={x.change} base={x.house} /></td>
                    <td className="senate-am-refs"><a href={senatePdfUrl('senate-cr-annex-a4', x.page)} target="_blank" rel="noreferrer">Senate {x.page}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="nep-section">
          <SectionHead size="sm" eyebrow="The other programs" headline="Farm-to-market roads, irrigation and health facilities in the Senate" />
          <ul className="senate-rep-findings">
            <Finding head={`Farm-to-market roads: ${php(fmr.house)} to ${php(fmr.senate)}.`}>
              The Senate removes {n(fmr.status.cut?.n ?? 0)} roads ({php(fmr.status.cut?.house ?? 0)}), {n(fmr.house_inserted.removed_n)} of them House insertions,
              and inserts {n(fmrAdded?.n ?? 0)} of its own ({php(fmrAdded?.senate ?? 0)}); {n(fmr.replaces)} of those revise a removed road (a corrected name or new
              coordinates).
            </Finding>
            <Finding head={`Irrigation (NIA): ${php(nia.house)} to ${php(nia.senate)}.`}>
              {n(nia.status.cut?.n ?? 0)} projects removed ({php(nia.status.cut?.house ?? 0)}), {n(nia.house_inserted.removed_n)} of the {n(nia.house_inserted.n)} House insertions;
              {' '}{n(nia.status.added?.n ?? 0)} inserted by the Senate ({php(nia.status.added?.senate ?? 0)}) and {n(nia.status.raised?.n ?? 0)} raised; {n(nia.status.renamed?.n ?? 0)} keep their
              amount under a revised name.
            </Finding>
            <Finding head={`Health facilities (HFEP): ${php(hf.house)} to ${php(hf.senate)}.`}>
              The Senate adds {r.hfep_kinds.map((k) => `${php(k.change)} for ${k.kind.toLowerCase().replace(/vehicle$/, "vehicles")}`).join(', ')}: {n(hf.status.added?.n ?? 0)} facilities inserted and{' '}
              {n(hf.status.raised?.n ?? 0)} raised. It removes one.
            </Finding>
          </ul>
        </section>

        <section className="nep-section">
          <SectionHead size="sm" eyebrow="Provisions" headline={`${n(r.provisions.n)} Senate amendments to the bill's provisions`} />
          <p className="senate-rep-p">
            {r.provisions.n - r.provisions.general} amend special provisions and {r.provisions.general} the general provisions. Most fall on{' '}
            {r.provisions.by_department.slice(0, 4).map((x) => `${nameCase(x.department.replace(/^[IVXL]+\.\s*/, ''))} (${x.n})`).join(', ')}.{' '}
            <Link to={SENATE_PROVISIONS_ROOT}>Read them</Link>.
          </p>
        </section>

        <section className="nep-section">
          <SectionHead size="sm" eyebrow="Read with care" headline="What this report does not say" />
          <ul className="senate-rep-caveats">
            <li>The Senate committee report is the committee's version. The Senate still votes on it, and both chambers then settle one text in the bicameral conference.</li>
            <li>The report changes amounts; it does not give a reason for each project it removes. Patterns here (red flags, House insertions) are what the data shows, not the Senate's reasons.</li>
            <li>A red flag is a reason to look, not a finding. An office's budget is not a statement about any official.</li>
            <li>The NEP, the House bill and the Senate committee report are versions of one budget: compare them, never add them.</li>
            <li>Under citizen review: we have not finished checking every figure. Before you cite one, open the page of the report it gives.</li>
          </ul>
        </section>

        <section className="nep-section">
          <SectionHead size="sm" eyebrow="Data" headline="Every figure here is in the Senate dataset" />
          <p className="senate-rep-p">
            The figures come from the <Link to={SENATE_DATA_ROOT}>Senate committee report dataset</Link> ({r.checks.passed} of {r.checks.run} checks against the report's printed
            totals pass), with red flags and documents from the House bill project reviewer. Built {r.built_at.slice(0, 10)}
            {r.source_commit && <> from commit <code>{r.source_commit.slice(0, 10)}</code></>}.
          </p>
        </section>
        <SenateNotice />
      </main>
      <SiteFooter />
    </>
  );
}

function DeptTable({ title, rows }: { title: string; rows: Dept[] }) {
  return (
    <div>
      <h3 className="senate-rep-h3">{title}</h3>
      <table className="nep-table">
        <thead><tr><th className="nep-th-name">Department or fund</th><th className="num">House bill</th><th className="num">Senate</th><th className="num">Change</th></tr></thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.name}>
              <td className="nep-td-name">{nameCase(d.name)}</td>
              <td className="num">{php(d.house)}</td><td className="num"><strong>{php(d.senate)}</strong></td>
              <td className="num"><SignedChange v={d.net} base={d.house} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LineTable({ rows, noAgency = false }: { rows: Line[]; noAgency?: boolean }) {
  return (
    <div className="nep-table-wrap">
      <table className="nep-table">
        <thead><tr><th className="nep-th-name">Amendment</th><th className="num">House bill</th><th className="num senate-col-senate">Senate</th><th className="num">Change</th><th>Page</th></tr></thead>
        <tbody>
          {rows.map((x, k) => (
            <tr key={k}>
              <td className="nep-td-name">
                {nameCase(x.item ?? x.label)} <span className="senate-tag">{x.label}</span>
                {!noAgency && <span className="senate-am-sub">{nameCase(x.department)}{x.agency ? ` · ${x.agency}` : ''}</span>}
              </td>
              <td className="num">{x.house != null ? php(x.house) : <span className="hgab-ds-null" title="Not in the House bill">—</span>}</td>
              <td className="num senate-col-senate"><strong>{php(x.senate)}</strong></td>
              <td className="num"><SignedChange v={x.net} base={x.house} /></td>
              <td className="senate-am-refs"><a href={senatePdfUrl('senate-cr-annex-a', x.page)} target="_blank" rel="noreferrer">Senate {x.page}</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
