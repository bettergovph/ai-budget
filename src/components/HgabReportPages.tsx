/**
 * The pages of the team's report (`/hgab/2027/review/report/*`, src/pages/HgabReviewReport.tsx), one each since
 * 2026-11-18: the overview, the automatic red flags, the red flags (and each one's projects), the documents, final
 * status by region, the questions, every project, and each project. Data: useReport() (src/lib/hgab-report-data.ts).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { HGAB_BASE, cached, getJson, pdfUrl, recordPath } from '../lib/hgab';
import { dataUrl } from '../lib/data-url';
import {
  NAMED_TYPES, detailShardPath, missingCode, scoreBand, type DetailFile, type ReviewDetail, type ReviewDetailShard,
} from '../lib/hgab-documents';
import {
  DETAIL_NOTE_TEXT, FAMILY_LABEL, FAMILY_ORDER, LINK_LABEL, LINK_WEAK, NAMED_MEANING, NAMED_SHORT, REVIEW_ROOT, SOURCE_GROUPS,
  SOURCE_GROUP_NOTE, docCount, hasDoc, pesoFull, pesoShort, readerText,
} from '../lib/hgab-review';
import { QUESTION_OF_FLAG, RATINGS, TEAM_FLAGS, VERDICT_LABEL } from '../lib/hgab-redflags-team';
import {
  ATTENTION_GROUPS, DOC_FROM, DOC_FROM_LABEL, DOC_FROM_NOTE, DOC_LEVELS, DOC_LEVEL_LABEL, PROJECT_GROUPS, PROJECT_GROUP_LABEL, REPORT_GROUP_NOTE, REPORT_PAGES,
  checkTallies, docTallies, docTally, flagPath, flagSource, flagTallies, groupCounts, insertionKey, n, officeLine, pct,
  questionTallies, reportPath, rulePath, sumAmount, tallyBy, type DocFrom, type DocTally, type GroupCounts, type ProjectGroup, type ReportProject,
} from '../lib/hgab-review-report';
import { fetchSenateStatus, senatePath, type SenateCopyStatus } from '../lib/hgab-review-api';
import { useReport } from '../lib/hgab-report-data';
import { Card, GroupBar, PageHead, Pill, ProjectLinks, ProjectTable, ReviewEntry, TallyTable } from './HgabReportParts';

const MEMBER_GROUPS: readonly ProjectGroup[] = ['needs_immediate_attention', 'needs_attention', 'satisfactory', 'none'];
const total = (c: GroupCounts, gs: readonly ProjectGroup[]) => gs.reduce((s, g) => s + c[g].projects, 0);
const totalAmount = (c: GroupCounts, gs: readonly ProjectGroup[]) => gs.reduce((s, g) => s + c[g].amount, 0);
const listLink = (gs: readonly ProjectGroup[]) => `${reportPath('projects')}?st=${gs.join(',')}`;

// --- Overview --------------------------------------------------------------------------------------------------------

export function Overview() {
  const { all, index, reviews, groupOf } = useReport();
  const counts = useMemo(() => groupCounts(all, groupOf), [all, groupOf]);
  const flagged = useMemo(() => all.filter((p) => p.flags.length > 0).length, [all]);
  const flagsOn = useMemo(() => all.reduce((s, p) => s + p.flags.length, 0), [all]);
  const res = reviews.state === 'ready' ? reviews.res : null;
  const budget = sumAmount(all);
  return (
    <>
      <PageHead title="Overview">
        <p>The DPWH projects in the FY2027 House bill (HB 10858): the red flags applied to every project, the documents found for each, and what members found when they reviewed them.</p>
      </PageHead>
      <section className="rr-sec">
        <div className="rr-cards is-4">
          <Card label="DPWH projects in the House bill" value={n(all.length)} note={pesoShort(budget)} to={reportPath('projects')} />
          <Card label="With a red flag" value={n(flagged)} note={`${n(flagsOn)} red flags, ${n(index.flags.length)} kinds`} to={reportPath('flags')} />
          <Card label="Needs attention" value={n(total(counts, ATTENTION_GROUPS))} tone="needs_attention"
            note={`${pesoShort(totalAmount(counts, ATTENTION_GROUPS))} · members and the automatic rule`} to={listLink(ATTENTION_GROUPS)} />
          <Card label="Reviewed by members" value={n(total(counts, MEMBER_GROUPS))} to={listLink(MEMBER_GROUPS)}
            note={res ? `${n(res.meta.reviews)} reviews by ${n(res.meta.members)} member${res.meta.members === 1 ? '' : 's'}` : reviews.state === 'loading' ? 'Loading the reviews…' : 'The reviews didn’t load'} />
        </div>
        <h3 className="rr-h3">Final status of every project</h3>
        <GroupBar counts={counts} big />
        <div className="rr-table-wrap">
          <table className="rr-table rr-narrow">
            <thead><tr><th scope="col">Final status</th><th scope="col" className="num">Projects</th><th scope="col" className="num">Share</th><th scope="col" className="num">Budget</th><th scope="col" className="rr-wide-only">What it means</th></tr></thead>
            <tbody>
              {PROJECT_GROUPS.map((g) => (
                <tr key={g}>
                  <th scope="row"><Link to={listLink([g])}><i className={`rr-dot is-${g}`} />{PROJECT_GROUP_LABEL[g]}</Link></th>
                  <td className="num">{n(counts[g].projects)}</td>
                  <td className="num">{pct(counts[g].projects, all.length)}</td>
                  <td className="num" title={pesoFull(counts[g].amount)}>{pesoShort(counts[g].amount)}</td>
                  <td className="rr-muted rr-wide-only">{g === 'not_reviewed' ? 'No member has reviewed it, and the automatic rule didn’t mark it.' : REPORT_GROUP_NOTE[g]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rr-note">A project counts under the most serious final status any member gave it. Until a member reviews it, a project the automatic rule marked counts as “{PROJECT_GROUP_LABEL.auto}”.</p>
      </section>
      <section className="rr-sec">
        <h3 className="rr-h3 is-first">In this report</h3>
        <ul className="rr-pagelist">
          {REPORT_PAGES.filter((pg) => pg.slug).map((pg) => <li key={pg.slug}><Link to={reportPath(pg.slug)}>{pg.label}</Link><span>{pg.note}</span></li>)}
        </ul>
      </section>
    </>
  );
}

// --- Automatic red flags ---------------------------------------------------------------------------------------------

export function AutomaticPage() {
  const { all, index, groupOf } = useReport();
  const auto = index.auto;
  const families = useMemo(() => FAMILY_ORDER.map((fam) => {
    const idx = new Set(index.flags.map((f, i) => (f.family === fam ? i : -1)).filter((i) => i >= 0));
    return { fam, kinds: idx.size, on: all.reduce((s, p) => s + p.flags.filter((i) => idx.has(i)).length, 0), projects: all.filter((p) => p.flags.some((i) => idx.has(i))).length };
  }), [all, index.flags]);
  const ours = index.flags.filter((f) => f.source === 'bettergov').length;
  return (
    <>
      <PageHead title="Automatic red flags">
        <p>What we applied to every project before anyone read it. A project a rule marks shows as “{PROJECT_GROUP_LABEL.auto}” until a member reviews it; the member’s final status then takes over.</p>
      </PageHead>
      {!auto ? <section className="rr-sec"><p className="rr-muted">This build of the project list has no automatic review.</p></section> : auto.rules.map((r) => {
        const ps = all.filter((p) => p.auto?.rules.includes(r.code));
        const counts = groupCounts(ps, groupOf);
        const regions = docTallies(ps, (p) => [p.region, p.region]).sort((a, b) => b.projects - a.projects);
        const ofRegion = new Map<string, number>();
        for (const p of all) ofRegion.set(p.region, (ofRegion.get(p.region) ?? 0) + 1);
        return (
          <section key={r.code} className="rr-sec">
            <h3 className="rr-h3 is-first"><Link to={rulePath(r.code)}>{r.label}</Link></h3>
            <p className="rr-rule-note">{r.note}</p>
            <dl className="rr-facts">
              <div><dt>Applied to</dt><dd>All {n(all.length)} DPWH projects in the House bill</dd></div>
              <div><dt>Projects marked</dt><dd>{n(ps.length)} ({pct(ps.length, all.length)}) · {pesoShort(sumAmount(ps))}</dd></div>
              <div><dt>Score</dt><dd>{r.weight} of 100{scoreBand(r.weight) ? ` (${scoreBand(r.weight)})` : ''}, provisional</dd></div>
              <div><dt>The team’s checks</dt><dd>{r.team_flags.map((id) => {
                const q = QUESTION_OF_FLAG.get(id);
                return `${id} ${TEAM_FLAGS.get(id)?.title ?? ''}${q ? ` (question ${q.id})` : ''}`.trim();
              }).join(' · ')}</dd></div>
            </dl>
            <h4 className="rr-h4">Their final status now</h4>
            <GroupBar counts={counts} big />
            <p className="rr-note">
              {n(counts.auto.projects)} have only the automatic review. Members have since reviewed {n(ps.length - counts.auto.projects)}
              {ps.length - counts.auto.projects > 0 && <> ({MEMBER_GROUPS.filter((g) => counts[g].projects).map((g) => `${PROJECT_GROUP_LABEL[g]}: ${n(counts[g].projects)}`).join(' · ')})</>}.
            </p>
            <p><Link className="rr-btn is-primary" to={rulePath(r.code)}>See the {n(ps.length)} projects</Link></p>
            <h4 className="rr-h4">By region</h4>
            <div className="rr-table-wrap">
              <table className="rr-table rr-narrow">
                <thead><tr><th scope="col">Region</th><th scope="col" className="num">Projects marked</th><th scope="col" className="num">Of the region’s projects</th><th scope="col" className="num">Budget</th></tr></thead>
                <tbody>
                  {regions.map((t) => (
                    <tr key={t.key}>
                      <th scope="row"><Link to={`${rulePath(r.code)}?region=${encodeURIComponent(t.key)}`}>{t.label}</Link></th>
                      <td className="num">{n(t.projects)}</td>
                      <td className="num">{pct(t.projects, ofRegion.get(t.key) ?? 0)} <small>of {n(ofRegion.get(t.key) ?? 0)}</small></td>
                      <td className="num" title={pesoFull(t.amount)}>{pesoShort(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {auto && <p className="rr-note">{auto.note} The team’s workflow asks for no unapproved thresholds or weights, so this rule marks only projects where nothing at all was found.</p>}
      <section className="rr-sec">
        <h3 className="rr-h3 is-first">Red flags on every project</h3>
        <p>Besides the automatic rule, {n(index.flags.length)} kinds of red flag were computed for every project: {n(index.flags.length - ours)} by research.bettergov.ph’s detectors and {n(ours)} by us (our NEP comparison, and the missing key documents with our document links). They point to what to check; they don’t set a final status.</p>
        <div className="rr-table-wrap">
          <table className="rr-table rr-narrow">
            <thead><tr><th scope="col">Kind</th><th scope="col" className="num">Red flags</th><th scope="col" className="num">On projects</th><th scope="col" className="num">Projects with one</th></tr></thead>
            <tbody>
              {families.map((f) => (
                <tr key={f.fam}>
                  <th scope="row"><Link to={`${reportPath('flags')}#${f.fam}`}>{FAMILY_LABEL[f.fam]}</Link></th>
                  <td className="num">{n(f.kinds)}</td>
                  <td className="num">{n(f.on)}</td>
                  <td className="num">{n(f.projects)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p><Link className="rr-btn" to={reportPath('flags')}>Every red flag</Link></p>
      </section>
    </>
  );
}

// --- Red flags ---------------------------------------------------------------------------------------------------------

export function FlagsPage() {
  const { all, index, groupOf } = useReport();
  const tallies = useMemo(() => flagTallies(index.flags, all, groupOf), [index.flags, all, groupOf]);
  return (
    <>
      <PageHead title="Red flags">
        <p>Every red flag on the House bill’s DPWH projects, by kind, with how many projects carry it and where their review stands. A red flag is a candidate for follow-up, not a finding. Open one for its projects.</p>
      </PageHead>
      {FAMILY_ORDER.map((fam) => {
        const rows = tallies.filter((t) => t.flag.family === fam);
        if (!rows.length) return null;
        return (
          <section key={fam} id={fam} className="rr-sec">
            <h3 className="rr-h3 is-first">{FAMILY_LABEL[fam]}</h3>
            <div className="rr-table-wrap">
              <table className="rr-table rr-flagtable">
                <colgroup><col /><col className="rr-w-from" /><col className="rr-w-num" /><col className="rr-w-num" /><col className="rr-w-num" /><col className="rr-w-num" /><col className="rr-w-bar" /></colgroup>
                <thead>
                  <tr>
                    <th scope="col">Red flag</th>
                    <th scope="col">From</th>
                    <th scope="col" className="num">Projects</th>
                    <th scope="col" className="num">Budget</th>
                    <th scope="col" className="num">Needs attention</th>
                    <th scope="col" className="num">Reviewed by members</th>
                    <th scope="col" className="rr-col-bar"><span className="rr-sr">Final status</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.flag.code}>
                      <th scope="row"><Link to={flagPath(t.flag.code)}>{readerText(t.flag.label)}</Link></th>
                      <td className="rr-muted">{flagSource(t.flag)}</td>
                      <td className="num">{n(t.projects)}</td>
                      <td className="num" title={pesoFull(t.amount)}>{pesoShort(t.amount)}</td>
                      <td className={`num${total(t.groups, ATTENTION_GROUPS) ? ' is-needs_attention' : ' is-zero'}`}>{n(total(t.groups, ATTENTION_GROUPS))}</td>
                      <td className="num">{n(total(t.groups, MEMBER_GROUPS))}</td>
                      <td className="rr-col-bar"><GroupBar counts={t.groups} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}

/** One red flag's projects (`flags/:code`), or one automatic rule's (`automatic/:code`). */
export function ConditionPage({ kind }: { kind: 'flag' | 'rule' }) {
  const { code = '' } = useParams();
  const { all, index, groupOf } = useReport();
  const fi = kind === 'flag' ? index.flags.findIndex((f) => f.code === code) : -1;
  const rule = kind === 'rule' ? index.auto?.rules.find((r) => r.code === code) : undefined;
  const projects = useMemo(() => (kind === 'flag' ? (fi < 0 ? [] : all.filter((p) => p.flags.includes(fi))) : all.filter((p) => p.auto?.rules.includes(code))),
    [kind, fi, all, code]);
  const counts = useMemo(() => groupCounts(projects, groupOf), [projects, groupOf]);
  const flag = fi >= 0 ? index.flags[fi] : null;
  if (!flag && !rule) return <NotFound what={kind === 'flag' ? 'red flag' : 'automatic rule'} />;
  const crumbs = kind === 'flag' ? [{ to: reportPath('flags'), label: 'Red flags' }] : [{ to: reportPath('automatic'), label: 'Automatic red flags' }];
  return (
    <>
      <PageHead title={flag ? readerText(flag.label) : rule!.label} crumbs={crumbs}>
        <p className="rr-meta">{flag ? `${FAMILY_LABEL[flag.family]} · from ${flagSource(flag)}` : `Automatic rule · applied to every project · score ${rule!.weight}, provisional`}</p>
        {flag?.note && <p>{flag.note}</p>}
        {flag?.computed && <p>Computed with our document links: research.bettergov.ph’s own count is {n(flag.n_upstream ?? 0)}.</p>}
        {rule && <p>{rule.note}</p>}
        {flag && !flag.source && <p className="rr-muted">As research.bettergov.ph’s detectors name it. Each project’s evidence is on its page.</p>}
      </PageHead>
      <section className="rr-sec">
        <div className="rr-cards is-4">
          <Card label="Projects" value={n(projects.length)} note={`${pct(projects.length, all.length)} of all ${n(all.length)}`} />
          <Card label="Budget" value={pesoShort(sumAmount(projects))} note={pesoFull(sumAmount(projects))} />
          <Card label="Needs attention" tone="needs_attention" value={n(total(counts, ATTENTION_GROUPS))} note="members and the automatic rule" />
          <Card label="Reviewed by members" value={n(total(counts, MEMBER_GROUPS))} note={`${n(counts.not_reviewed.projects + counts.auto.projects)} not yet`} />
        </div>
        <GroupBar counts={counts} big />
        <ProjectTable projects={projects} />
      </section>
    </>
  );
}

// --- Documents ---------------------------------------------------------------------------------------------------------

/** documents/manifest.json (build:hgab-documents), the parts this page reads. */
interface DocumentsManifest {
  built_at: string;
  files: { total: number; rows_with_any: number };
  senate: { files_in_index: number; files_tied: number; rows_matched_without_files: number };
  proposal: { files: number; rows_types_without_files: number };
}
/** documents/downloads/manifest.json (build:hgab-review-dataset): the public dataset. */
interface DatasetManifest {
  as_of: string;
  totals: { documents: number; senate_copies: number; senate_copies_redacted: number };
  files: { key: string; title: string; rows: number; csv?: { file: string; bytes: number }; parquet?: { file: string; bytes: number } }[];
}
const DOCUMENTS_DIR = `${HGAB_BASE}/documents`;
const loadDocumentsManifest = () => cached('documents-manifest', () => getJson<DocumentsManifest>(dataUrl(`${DOCUMENTS_DIR}/manifest.json`), 'Failed to load the documents summary'));
const loadDatasetManifest = () => cached('dataset-manifest', () => getJson<DatasetManifest>(dataUrl(`${DOCUMENTS_DIR}/downloads/manifest.json`), 'Failed to load the dataset list'));
const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`;

export function DocumentsPage() {
  const { all } = useReport();
  const [params, setParams] = useSearchParams();
  const from: DocFrom = (DOC_FROM as readonly string[]).includes(params.get('from') ?? '') ? params.get('from') as DocFrom : 'either';
  const setFrom = (f: DocFrom) => setParams((prev) => { const next = new URLSearchParams(prev); if (f === 'either') next.delete('from'); else next.set('from', f); return next; }, { replace: true });
  const [docs, setDocs] = useState<DocumentsManifest | null>(null);
  const [dataset, setDataset] = useState<DatasetManifest | null>(null);
  useEffect(() => {
    loadDocumentsManifest().then(setDocs).catch(() => {});
    loadDatasetManifest().then(setDataset).catch(() => {});
  }, []);
  // Both sources side by side, then every table below for the source chosen.
  const by = useMemo(() => Object.fromEntries(DOC_FROM.map((f) => [f, docTally(all, 'all', 'All projects', f)])) as Record<DocFrom, DocTally>, [all]);
  const t = by[from];
  const bySource = useMemo(() => docTallies(all, (p) => (p.insertion ? ['insertion', 'House insertions'] : ['nep', 'NEP only']), from), [all, from]);
  const byRegion = useMemo(() => docTallies(all, (p) => [p.region, p.region], from), [all, from]);
  const split = all.some((p) => p.bySource);
  const projects = reportPath('projects');
  const budget = by.either.amount;
  // A count with its share of all projects, and the budget of those projects with its share of the whole budget.
  const cell = (f: DocFrom, v: number, amount: number) => <td key={f} className="num"><Stat count={v} of={all.length} amount={amount} ofAmount={budget} /></td>;
  return (
    <>
      <PageHead title="Documents">
        <p>The documents found for each DPWH project in the House bill, from two sources kept apart here: the <b>House bill</b>’s (the Senate copies, what DPWH gave the Senate for the House bill’s projects, with signatures redacted) and the <b>NEP</b>’s (DPWH Transparency, what DPWH published for the NEP proposal). Five of them are the key documents the team checks first.</p>
      </PageHead>
      <section className="rr-sec">
        <div className="rr-cards is-4">
          <Card label="Documents found" value={n(docs?.files.total ?? by.either.files)}
            note={`${n(docs?.senate.files_tied ?? by.senate.files)} House bill (Senate copies) · ${n(docs?.proposal.files ?? by.nep.files)} NEP (DPWH Transparency)`} />
          <Card label="Senate copies open" value={dataset ? n(dataset.totals.senate_copies_redacted) : '…'}
            note={dataset ? `of ${n(dataset.totals.senate_copies)}: redacted, as of ${dataset.as_of}; the rest stay closed` : undefined} />
          <Card label="Projects with a file" value={n(by.either.withFile)}
            note={`${pesoShort(by.either.amounts.withFile)} · ${pct(by.either.withFile, all.length)} of ${n(all.length)} projects (${pesoShort(budget)})`} />
          <Card label={DOC_LEVEL_LABEL.complete} value={n(by.either.levels.complete)} to={`${projects}?docs=complete`}
            note={`${pesoShort(by.either.amounts.levels.complete)} · ${pct(by.either.levels.complete, all.length)} of the projects, either source`} />
        </div>
      </section>

      <section className="rr-sec">
        <h3 className="rr-h3 is-first">House bill and NEP documents</h3>
        {!split && <p className="rr-warn">This build of the project list doesn’t split the key documents by source yet.</p>}
        <div className="rr-table-wrap">
          <table className="rr-table rr-split">
            <thead>
              <tr>
                <th scope="col"><span className="rr-sr">Measure</span></th>
                {(['senate', 'nep', 'either'] as const).map((f) => <th key={f} scope="col" className="num" title={DOC_FROM_NOTE[f]}>{DOC_FROM_LABEL[f]}</th>)}
              </tr>
            </thead>
            <tbody>
              <tr className="rr-total">
                <th scope="row">DPWH projects in the House bill</th>
                {(['senate', 'nep', 'either'] as const).map((f) => cell(f, all.length, budget))}
              </tr>
              <tr>
                <th scope="row">Documents (files)</th>
                <td className="num">{n(by.senate.files)}</td><td className="num">{n(by.nep.files)}</td><td className="num">{n(by.either.files)}</td>
              </tr>
              <tr>
                <th scope="row">Projects with a file</th>
                {(['senate', 'nep', 'either'] as const).map((f) => cell(f, by[f].withFile, by[f].amounts.withFile))}
              </tr>
              <tr>
                <th scope="row">Projects with {DOC_LEVEL_LABEL.complete.toLowerCase()}</th>
                {(['senate', 'nep', 'either'] as const).map((f) => cell(f, by[f].levels.complete, by[f].amounts.levels.complete))}
              </tr>
              {NAMED_TYPES.map((type, i) => (
                <tr key={type}>
                  <th scope="row">With the {type === 'POW' ? 'program of work (POW)' : type === 'BP 202' ? 'BP 202' : type.toLowerCase()}</th>
                  {(['senate', 'nep', 'either'] as const).map((f) => cell(f, by[f].byType[i], by[f].amounts.byType[i]))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rr-note">
          Each cell: projects and their share of all {n(all.length)}, then their House bill budget and its share of {pesoShort(budget)}. Most House insertions have only House bill documents, and most NEP projects only NEP ones.
          A key document counts where its source lists it, even if we haven’t found the file
          {docs ? ` (${n(docs.proposal.rows_types_without_files)} projects on DPWH Transparency, ${n(docs.senate.rows_matched_without_files)} in the Senate copies)` : ''}.
        </p>
        <h4 className="rr-h4">Where each project’s files come from</h4>
        <div className="rr-table-wrap">
          <table className="rr-table rr-narrow">
            <thead><tr><th scope="col">Files from</th><th scope="col" className="num">Projects</th><th scope="col" className="num">Budget</th><th scope="col">Note</th></tr></thead>
            <tbody>
              {SOURCE_GROUPS.map((g) => (
                <tr key={g}>
                  <th scope="row"><Link to={`${projects}?from=${g}`}>{FILES_FROM_LABEL[g]}</Link></th>
                  <td className="num">{n(by.either.sources[g])} <small>{pct(by.either.sources[g], all.length)}</small></td>
                  <td className="num" title={pesoFull(by.either.amounts.sources[g])}>{pesoShort(by.either.amounts.sources[g])} <small>{pct(by.either.amounts.sources[g], budget)}</small></td>
                  <td className="rr-muted">{SOURCE_GROUP_NOTE[g]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="rr-switch" role="group" aria-label="Count documents from">
        <span className="rr-filters-l">Count documents from</span>
        {DOC_FROM.map((f) => (
          <button key={f} type="button" className={`rr-chip${from === f ? ' is-on' : ''}`} aria-pressed={from === f} onClick={() => setFrom(f)} title={DOC_FROM_NOTE[f]}>{DOC_FROM_LABEL[f]}</button>
        ))}
      </div>

      <section className="rr-sec">
        <h3 className="rr-h3 is-first">The five key documents <span className="rr-muted">· {DOC_FROM_LABEL[from]}</span></h3>
        <LevelBar t={t} big />
        <p className="rr-note">{DOC_LEVELS.map((d) => `${DOC_LEVEL_LABEL[d]}: ${n(t.levels[d])} (${pesoShort(t.amounts.levels[d])})`).join(' · ')}. {from === 'either'
          ? '“No document found” means none of the five and no other file in either source: the projects the automatic rule marks.'
          : `Counting only ${DOC_FROM_LABEL[from]}.`}</p>
        <div className="rr-table-wrap">
          <table className="rr-table">
            <thead>
              <tr>
                <th scope="col">Document</th><th scope="col">What it is</th><th scope="col" className="num">Projects with it</th><th scope="col" className="num">Share</th>
                <th scope="col" className="num">Budget with it</th><th scope="col" className="num">Without it</th><th scope="col" className="num">Budget without it</th>
              </tr>
            </thead>
            <tbody>
              {NAMED_TYPES.map((type, i) => (
                <tr key={type}>
                  <th scope="row">{type === 'POW' ? 'Program of work (POW)' : type}</th>
                  <td className="rr-muted">{NAMED_MEANING[type]}</td>
                  <td className="num">{n(t.byType[i])}</td>
                  <td className="num"><Meter value={t.byType[i]} of={t.projects} /></td>
                  <td className="num" title={pesoFull(t.amounts.byType[i])}>{pesoShort(t.amounts.byType[i])} <small>{pct(t.amounts.byType[i], t.amount)}</small></td>
                  <td className="num">{from === 'either' ? <Link to={flagPath(missingCode(type))}>{n(t.projects - t.byType[i])}</Link> : n(t.projects - t.byType[i])}</td>
                  <td className="num" title={pesoFull(t.amount - t.amounts.byType[i])}>{pesoShort(t.amount - t.amounts.byType[i])} <small>{pct(t.amount - t.amounts.byType[i], t.amount)}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {from === 'either' && <p className="rr-note">“Without it” opens the projects missing it in both sources.</p>}
        <h4 className="rr-h4">How many of the five each project has</h4>
        <div className="rr-table-wrap">
          <table className="rr-table rr-narrow">
            <thead><tr><th scope="col">Key documents found</th>{(['senate', 'nep', 'either'] as const).map((f) => <th key={f} scope="col" className="num">{DOC_FROM_LABEL[f]}</th>)}</tr></thead>
            <tbody>
              {[5, 4, 3, 2, 1, 0].map((k) => (
                <tr key={k}>
                  <th scope="row">{k} of 5</th>
                  {(['senate', 'nep', 'either'] as const).map((f) => cell(f, by[f].byCount[k], by[f].amounts.byCount[k]))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rr-sec">
        <h3 className="rr-h3 is-first">House insertions and NEP only <span className="rr-muted">· {DOC_FROM_LABEL[from]}</span></h3>
        <p className="rr-note">House insertions are projects in the House bill but not in the NEP, by our comparison.</p>
        <DocTable rows={bySource} head="Projects" link={(k) => `${projects}?src=${k}`} />
      </section>

      <section className="rr-sec">
        <h3 className="rr-h3 is-first">By region <span className="rr-muted">· {DOC_FROM_LABEL[from]}</span></h3>
        <p className="rr-note">Fewest projects with 4 or 5 key documents first.</p>
        <DocTable rows={byRegion} head="Region" link={(k) => `${projects}?region=${encodeURIComponent(k)}`} />
      </section>

      <section className="rr-sec">
        <h3 className="rr-h3 is-first">Download the data</h3>
        <p className="rr-note">The public dataset: every project, document and red flag, as CSV and Parquet. It has no reviews.{dataset ? ` As of ${dataset.as_of}.` : ''}</p>
        <ul className="rr-downloads">
          <li><a className="rr-btn is-primary" href={dataUrl(`${DOCUMENTS_DIR}/downloads/house-bill-2027-dpwh-dataset.zip`)} download>Everything (CSV, zip)</a></li>
          {(dataset?.files ?? []).filter((f) => f.csv || f.parquet).map((f) => (
            <li key={f.key}>
              <b>{f.title}</b> <span className="rr-muted">{n(f.rows)} rows</span>
              {f.csv && <a href={dataUrl(`${DOCUMENTS_DIR}/downloads/${f.csv.file}`)} download>CSV, {mb(f.csv.bytes)}</a>}
              {f.parquet && <a href={dataUrl(`${DOCUMENTS_DIR}/downloads/${f.parquet.file}`)} download>Parquet, {mb(f.parquet.bytes)}</a>}
            </li>
          ))}
          <li><a href={dataUrl(`${DOCUMENTS_DIR}/downloads/README.md`)} target="_blank" rel="noopener noreferrer">What each column means (README)</a></li>
        </ul>
      </section>
    </>
  );
}

/** Where a project's files come from (SOURCE_GROUPS), in the report's words. */
const FILES_FROM_LABEL: Record<(typeof SOURCE_GROUPS)[number], string> = {
  senate: 'House bill only (Senate copies)', nep: 'NEP only (DPWH Transparency)', both: 'Both', none: 'No file found',
};

/** A count and its share, over the budget of those projects and its share. */
function Stat({ count, of, amount, ofAmount }: { count: number; of: number; amount: number; ofAmount: number }) {
  return (
    <>
      {n(count)} <small>{pct(count, of)}</small>
      <span className="rr-amt" title={pesoFull(amount)}>{pesoShort(amount)} <small>{pct(amount, ofAmount)}</small></span>
    </>
  );
}

function Meter({ value, of }: { value: number; of: number }) {
  return <span className="rr-meter"><span className="rr-meter-track" aria-hidden="true"><span style={{ width: of ? `${(100 * value) / of}%` : 0 }} /></span><b>{pct(value, of)}</b></span>;
}

/** Projects by how complete their documents are, as one bar. */
function LevelBar({ t, big }: { t: DocTally; big?: boolean }) {
  return (
    <div className={`rr-bar-stack${big ? ' is-big' : ''}`} role="img" aria-label={DOC_LEVELS.map((d) => `${DOC_LEVEL_LABEL[d]}: ${n(t.levels[d])}`).join(', ')}>
      {DOC_LEVELS.map((d) => t.levels[d] > 0 && (
        <span key={d} className={`is-doc-${d}`} style={{ flexGrow: t.levels[d] }} title={`${DOC_LEVEL_LABEL[d]}: ${n(t.levels[d])}`}>{big ? n(t.levels[d]) : ''}</span>
      ))}
    </div>
  );
}

/** Short headers, so the table fits; the full words are in each header's tooltip. */
const LEVEL_SHORT: Record<(typeof DOC_LEVELS)[number], string> = { complete: '4–5 key docs', partial: 'Fewer', none: 'None found' };
const TYPE_SHORT: Record<(typeof NAMED_TYPES)[number], string> = {
  POW: 'POW', 'BP 202': 'BP 202', 'Development Council': 'Council', 'Geotagged photos': 'Photos', 'Certificate of Implementability': 'Cert. impl.',
};

function DocTable({ rows, head, link }: { rows: DocTally[]; head: string; link: (key: string) => string }) {
  return (
    <div className="rr-table-wrap">
      <table className="rr-table">
        <thead>
          <tr>
            <th scope="col">{head}</th>
            <th scope="col" className="num">Projects</th>
            <th scope="col" className="num">Budget</th>
            {DOC_LEVELS.map((d) => <th key={d} scope="col" className="num" title={`${DOC_LEVEL_LABEL[d]}: projects, then their budget`}>{LEVEL_SHORT[d]}</th>)}
            {NAMED_TYPES.map((type) => <th key={type} scope="col" className="num" title={`Share of projects with the ${type}`}>{TYPE_SHORT[type]}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row"><Link to={link(r.key)}>{r.label}</Link></th>
              <td className="num">{n(r.projects)}</td>
              <td className="num" title={pesoFull(r.amount)}>{pesoShort(r.amount)}</td>
              {DOC_LEVELS.map((d) => (
                <td key={d} className={`num${r.levels[d] ? '' : ' is-zero'}`}>
                  <Stat count={r.levels[d]} of={r.projects} amount={r.amounts.levels[d]} ofAmount={r.amount} />
                </td>
              ))}
              {NAMED_TYPES.map((type, i) => <td key={type} className="num">{pct(r.byType[i], r.projects)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- By region -----------------------------------------------------------------------------------------------------------

export function RegionsPage() {
  const { all, rows } = useReport();
  const billCount = useMemo(() => (key: (p: (typeof all)[number]) => string) => {
    const m = new Map<string, number>();
    for (const p of all) m.set(key(p), (m.get(key(p)) ?? 0) + 1);
    return (k: string) => m.get(k) ?? 0;
  }, [all]);
  const bySource = useMemo(() => tallyBy(rows, insertionKey, billCount((p) => (p.insertion ? 'insertion' : 'nep'))), [rows, billCount]);
  const byRegion = useMemo(() => tallyBy(rows, (p) => [p.region, p.region], billCount((p) => p.region)), [rows, billCount]);
  const byOffice = useMemo(() => tallyBy(rows, (p) => [p.office, officeLine(p.office, p.districts)], billCount((p) => p.office.name)), [rows, billCount]);
  return (
    <>
      <PageHead title="Final status by region">
        <p>The projects members reviewed and those the automatic rule marked, by final status: House insertions and NEP only, region, and DPWH office. “Reviewed” counts both, of all the projects in that group.</p>
      </PageHead>
      <section className="rr-sec">
        <h3 className="rr-h3 is-first">House insertions and NEP only</h3>
        <p className="rr-note">House insertions are projects in the House bill but not in the NEP, by our comparison.</p>
        <TallyTable rows={bySource} head="Projects" />
      </section>
      <section className="rr-sec">
        <h3 className="rr-h3 is-first">By region</h3>
        <TallyTable rows={byRegion} head="Region" />
      </section>
      <section className="rr-sec">
        <h3 className="rr-h3 is-first">By DPWH office</h3>
        <p className="rr-note">Each DPWH office with the legislative districts it serves. Districts are where the office works, not who asked for a project.</p>
        <TallyTable rows={byOffice} head="Legislative districts [DPWH office]" />
      </section>
    </>
  );
}

// --- Questions ---------------------------------------------------------------------------------------------------------

const RATINGS_DESC = [...RATINGS].reverse();

export function QuestionsPage() {
  const { reviews } = useReport();
  const cases = useMemo(() => (reviews.state === 'ready' ? reviews.res.data : []), [reviews]);
  const questions = useMemo(() => questionTallies(cases), [cases]);
  const checks = useMemo(() => checkTallies(cases), [cases]);
  return (
    <>
      <PageHead title="By question">
        <p>How members answered the team’s 16 questions, over all reviews. A review answers only the questions that apply.</p>
      </PageHead>
      <section className="rr-sec">
        {reviews.state !== 'ready' && <p className="rr-muted" role="status">{reviews.state === 'loading' ? 'Loading the reviews…' : 'The reviews didn’t load.'}</p>}
        <div className="rr-table-wrap">
          <table className="rr-table">
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col" className="num">Answered</th>
                {RATINGS_DESC.map((r) => <th key={r} scope="col" className="num"><i className={`rr-dot is-${r}`} />{VERDICT_LABEL[r]}</th>)}
                <th scope="col" className="num">Remarks</th>
                <th scope="col">Needing immediate attention</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((q) => (
                <tr key={q.id} className={q.answered ? '' : 'is-quiet'}>
                  <th scope="row"><b className="rr-qid">{q.id}</b> {q.title}</th>
                  <td className="num">{n(q.answered)}</td>
                  {RATINGS_DESC.map((r) => <td key={r} className={`num${q.ratings[r] ? ` is-${r}` : ' is-zero'}`}>{n(q.ratings[r])}</td>)}
                  <td className="num">{n(q.remarks)}</td>
                  <td><ProjectLinks ids={q.urgentProjects} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {checks.length > 0 && <>
          <h3 className="rr-h3">Checks answered before the 16 questions</h3>
          <p className="rr-note">Reviews saved before the questions (November 17) answered the team’s 44 checks instead. They are kept as they were.</p>
          <div className="rr-table-wrap">
            <table className="rr-table">
              <thead><tr><th scope="col">Check</th><th scope="col" className="num">Answers</th><th scope="col">Outcomes</th><th scope="col">Projects</th></tr></thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.id}>
                    <th scope="row"><b className="rr-qid">{c.id}</b> {c.title}</th>
                    <td className="num">{n(c.answered)}</td>
                    <td>{c.outcomes.map((o) => `${o.label} ${n(o.count)}`).join(' · ')}</td>
                    <td><ProjectLinks ids={c.projects} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>}
      </section>
    </>
  );
}

// --- Projects ----------------------------------------------------------------------------------------------------------

export function ProjectsPage() {
  const { all } = useReport();
  return (
    <>
      <PageHead title="Projects">
        <p>Every DPWH project in the House bill. The most serious final status comes first; filter by final status, region, House insertion or documents, or search. Open a project for its red flags, documents and reviews.</p>
      </PageHead>
      <section className="rr-sec"><ProjectTable projects={all} /></section>
    </>
  );
}

// --- One project -------------------------------------------------------------------------------------------------------

const loadShard = (seq: number) => {
  const path = detailShardPath(seq);
  return cached(`review-detail:${path}`, () => getJson<ReviewDetailShard>(dataUrl(`${HGAB_BASE}/${path}`), 'Failed to load the project’s documents'));
};
/** Files in reading order: the five key documents, then the rest; current copies before earlier ones. */
/** Which detail notes belong to which source, for the project page's two document sections. */
const SENATE_NOTES = ['senate_matched_without_files', 'senate_folder_moved_from_another_row', 'senate_folder_moved_to_another_row', 'several_senate_folders'];
const NEP_NOTES = ['proposal_documents_via_nep_counterpart', 'proposal_types_without_files'];
const fileOrder = (files: readonly DetailFile[]) => {
  const rank = (t: string) => { const i = (NAMED_TYPES as readonly string[]).indexOf(t); return i < 0 ? 99 : i; };
  return [...files].sort((a, b) => rank(a[2]) - rank(b[2]) || Number(a[7]) - Number(b[7]) || a[0].localeCompare(b[0]) || a[4].localeCompare(b[4]));
};

export function ProjectPage() {
  const { hgabId = '' } = useParams();
  const { byId, rowById, index, groupOf } = useReport();
  const p = byId.get(hgabId);
  const [detail, setDetail] = useState<{ id: string; d: ReviewDetail | null; error?: string } | null>(null);
  useEffect(() => {
    if (!p) return;
    let live = true;
    loadShard(p.seq).then((sh) => { if (live) setDetail({ id: p.hgabId, d: sh[p.hgabId] ?? null }); })
      .catch((e: unknown) => { if (live) setDetail({ id: p.hgabId, d: null, error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [p]);
  const d = detail?.id === hgabId ? detail.d : null;
  // Which Senate copies can open: only redacted ones (the Worker's status route); never a link to any other.
  const [senate, setSenate] = useState<{ id: string; st: Record<string, SenateCopyStatus> } | null>(null);
  useEffect(() => {
    if (!d) return;
    let live = true;
    const paths = d.files.filter((f) => f[0] === 'senate').map((f) => senatePath(f[5])).filter((x): x is string => !!x);
    (paths.length ? fetchSenateStatus(paths).then((r) => r.data).catch(() => ({})) : Promise.resolve({}))
      .then((st) => { if (live) setSenate({ id: hgabId, st }); });
    return () => { live = false; };
  }, [d, hgabId]);
  const st = senate?.id === hgabId ? senate.st : null;

  if (!p) return <NotFound what="project" />;
  const r: ReportProject | undefined = rowById.get(hgabId);
  const group = groupOf(hgabId);
  const flags = p.flags.map((i) => index.flags[i]).filter(Boolean);
  const families = FAMILY_ORDER.map((fam) => ({ fam, flags: flags.filter((f) => f.family === fam) })).filter((g) => g.flags.length);
  const autoRules = (p.auto?.rules ?? []).map((c) => index.auto?.rules.find((x) => x.code === c)).filter((x) => !!x);
  const files = d ? fileOrder(d.files) : [];
  return (
    <>
      <PageHead title={p.title} crumbs={[{ to: reportPath('projects'), label: 'Projects' }]}>
        <p className="rr-meta">
          <span>{p.hgabId}</span>
          <span>{officeLine(p.office.name, p.office.districts)}</span>
          <span>{p.region}</span>
          <span className={p.insertion ? 'rr-tag is-ins' : 'rr-tag'}>{p.insertion ? 'House insertion' : 'NEP only'}</span>
        </p>
      </PageHead>
      <section className="rr-sec">
        <div className="rr-proj-top">
          <div>
            <Pill group={group} />
            <p className="rr-note">{group === 'not_reviewed' ? 'No member has reviewed this project, and the automatic rule didn’t mark it.' : REPORT_GROUP_NOTE[group]}</p>
          </div>
          <b className="rr-amount" title={pesoFull(p.amount)}>{pesoFull(p.amount)}</b>
        </div>
        <dl className="rr-facts">
          <div><dt>Program</dt><dd>{p.program}{d?.pap ? <small> · {d.pap}</small> : null}</dd></div>
          <div><dt>House bill</dt><dd>{d?.bill_doc ? <a href={pdfUrl(d.bill_doc, d.bill_page)} target="_blank" rel="noopener noreferrer">Vol. I-C p. {d.bill_page}</a> : <>page {p.page}</>} · <Link to={recordPath('dpwh', p.projectId)}>NEP and House bill</Link></dd></div>
          <div><dt>Reviewer</dt><dd><Link to={`${REVIEW_ROOT}?p=${p.hgabId}`}>Open in the project reviewer</Link></dd></div>
        </dl>
        {autoRules.length > 0 && (
          <p className="rr-autobox">
            <b>Automatic red flag</b>: {autoRules.map((x) => <Link key={x.code} to={rulePath(x.code)}>{x.label}</Link>)} · score {p.auto!.score}, provisional.
            {group !== 'auto' && ' A member has reviewed it since; their final status counts.'}
          </p>
        )}
      </section>

      <section className="rr-sec">
        <h3 className="rr-h3 is-first">Members’ reviews {r?.reviews.length ? <span className="rr-muted">({n(r.reviews.length)})</span> : null}</h3>
        {r?.reviews.length ? r.reviews.map((c) => <ReviewEntry key={c.review.case_id} c={c} />) : <p className="rr-muted">No member has reviewed this project yet.</p>}
      </section>

      <section className="rr-sec">
        <h3 className="rr-h3 is-first">Red flags <span className="rr-muted">({n(flags.length)})</span></h3>
        {!flags.length && <p className="rr-muted">No red flag on this project.</p>}
        {families.map((g) => (
          <div key={g.fam} className="rr-flaggroup">
            <h4 className="rr-h4">{FAMILY_LABEL[g.fam]}</h4>
            <ul>
              {g.flags.map((f) => {
                const ev = d?.flags.find((x) => x.code === f.code);
                const label = readerText(f.label) + (ev?.value != null ? `: ${pesoFull(ev.value)}` : '');
                const why = [...(f.note ? [f.note] : []), ...(ev?.evidence ?? []).map(readerText)];
                return (
                  <li key={f.code}>
                    <Link to={flagPath(f.code)}>{label}</Link> <small className="rr-muted">{flagSource(f)}</small>
                    {why.map((w) => <p key={w} className="rr-evidence">{w}</p>)}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <section className="rr-sec">
        <h3 className="rr-h3 is-first">Documents <span className="rr-muted">({n(p.files)} file{p.files === 1 ? '' : 's'} · {docCount(p.docs)} of 5 key documents in either source)</span></h3>
        {detail?.id === hgabId && detail.error && <p className="rr-error">{detail.error}</p>}
        {!d && !(detail?.id === hgabId && detail.error) && p.files > 0 && <p className="rr-muted" role="status">Loading the documents…</p>}
        {(['senate', 'nep'] as const).map((src) => {
          const kind = src === 'senate' ? 'senate' : 'proposal';
          const mask = p.bySource?.[src].docs ?? null;
          const list = files.filter((f) => f[0] === kind);
          const notes = d ? d.notes.filter((k) => (src === 'senate' ? SENATE_NOTES : NEP_NOTES).includes(k)).map((k) => DETAIL_NOTE_TEXT[k]?.(d, d.files)).filter(Boolean) : [];
          return (
            <div key={src} className="rr-docsrc">
              <h4 className="rr-h4">{DOC_FROM_LABEL[src]} <span className="rr-muted">· {n(list.length || (p.bySource?.[src].files ?? 0))} file{(list.length || p.bySource?.[src].files) === 1 ? '' : 's'}</span></h4>
              <p className="rr-note">{DOC_FROM_NOTE[src]}</p>
              {mask != null && (
                <ul className="rr-keydocs" aria-label={`The 5 key documents, ${DOC_FROM_LABEL[src]}`}>
                  {NAMED_TYPES.map((t, i) => (
                    <li key={t} className={hasDoc(mask, i) ? 'is-on' : ''} title={NAMED_MEANING[t]}>
                      <span aria-hidden="true">{hasDoc(mask, i) ? '✓' : '✗'}</span> {NAMED_SHORT[t]}<span className="rr-sr">{hasDoc(mask, i) ? ' found' : ' not found'}</span>
                    </li>
                  ))}
                </ul>
              )}
              {notes.map((t) => <p key={t} className="rr-note">{t}</p>)}
              {list.length > 0 ? (
                <div className="rr-table-wrap">
                  <table className="rr-table">
                    <thead><tr><th scope="col">Document</th><th scope="col">File</th><th scope="col">How it was tied to the project</th><th scope="col" className="num">Size</th></tr></thead>
                    <tbody>
                      {list.map((f) => {
                        const path = f[0] === 'senate' ? senatePath(f[5]) : null;
                        const status = path ? st?.[path] : undefined;
                        const open = f[0] === 'proposal' || status === 'available';
                        return (
                          <tr key={f[5]}>
                            <td>{f[2] === 'Other' ? <span className="rr-muted">Other</span> : NAMED_SHORT[f[2]]}{f[7] && <small className="rr-muted"> · earlier copy</small>}</td>
                            <th scope="row">
                              {open ? <a href={f[5]} target="_blank" rel="noopener noreferrer">{f[4]}</a> : <span>{f[4]}</span>}
                              {!open && <small className="rr-sub">{!st ? 'Checking…' : 'Not available yet: we’re redacting the signatures in this copy first, for privacy.'}</small>}
                            </th>
                            <td className={LINK_WEAK.has(f[1]) ? 'rr-weak' : 'rr-muted'}>{LINK_LABEL[f[1]]}</td>
                            <td className="num">{f[6] ? mb(f[6]) : ''}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : d && <p className="rr-muted">No file from {src === 'senate' ? 'the Senate copies' : 'DPWH Transparency'} for this project.</p>}
            </div>
          );
        })}
      </section>
    </>
  );
}

export function NotFound({ what = 'page' }: { what?: string }) {
  return (
    <>
      <PageHead title={`No such ${what}`} />
      <section className="rr-sec"><p>This address doesn’t match a {what} in the report. <Link to={reportPath()}>Back to the overview</Link>.</p></section>
    </>
  );
}

