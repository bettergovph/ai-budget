/**
 * `/hgab/2027/overview` — what House Bill 10858 changed against the NEP, for
 * the four programs where the bill prints project-level detail. The section's
 * landing page (`/hgab` and `/hgab/2027` redirect here); the story version,
 * the Explainer, is `/hgab/2027/intro`.
 *
 * Everything on this page comes from one `overview.json`. Counts and money
 * stay separate per dataset on purpose: the four programs have different
 * record grains (a road segment, a facility, an irrigation project), so a
 * grand total across them would be a number without a meaning. The source
 * workbench follows the same rule.
 *
 * Copy: plain first. Cards show the dataset's reader-facing `summary` and
 * `caveats`; the technical `grain` and `scope` sit inside a "Details for
 * analysts" block on each card.
 *
 * The one exception to "never across programs" is the candidate-change table,
 * which mirrors the source workbench's Overview: its Total row adds pesos
 * (exact, since each program's bridge holds) and says its counts mix kinds of
 * record.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip } from '../components/Nep2027Bits';
import {
  BridgeStrip, Caveats, DisclaimerNotice, HgabDetails, HgabError, HgabHeader, HgabHero, HgabLoading,
  HgabStageStrip, SignedPhp, WhatThisMeans,
} from '../components/HgabBits';
import * as fmt from '../lib/format';
import { pageMeta } from '../lib/seo';
import {
  DATASET_ORDER, HGAB_ROOT, STAGE_LABELS, datasetPath, districtPath, formatPct, loadHgabDistricts, loadHgabOverview,
  pctChange, pdfUrl,
  type BridgeGroup, type DatasetKey, type HgabCandidateChanges, type HgabCandidatePopulation, type HgabCandidateProgram,
  type HgabDatasetMeta, type HgabDistrictIndex, type HgabDocument, type HgabOverview as Overview,
} from '../lib/hgab';
import { DISCLAIMER_NO_ALLEGATIONS } from '../lib/hgab-disclaimers';
import { headlineResidual, residualShare, residualUnattributed, slotLabel } from '../lib/hgab-districts';
import { DATASET_SHORT, PLAIN, datasetCaveats, datasetSummary, formatBytes, ordinal } from '../lib/hgab-ui';
import '../nep2027.css';
import '../hgab-districts.css';
import '../hgab-overview.css';

export default function HgabOverview() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The Districts call-out quotes the unassigned share when the district index
  // is available; the call-out itself does not depend on it.
  const [districts, setDistricts] = useState<HgabDistrictIndex | null>(null);

  useEffect(() => {
    document.title = pageMeta(`${HGAB_ROOT}/overview`).title;
    loadHgabOverview().then(setOv).catch((e) => setErr(String(e?.message || e)));
    loadHgabDistricts().then(setDistricts).catch(() => { /* call-out renders without the figure */ });
  }, []);

  if (err) return <HgabError message={err} />;
  if (!ov) return <HgabLoading what="the FY2027 House bill overview" heroBlend />;

  const byKey = new Map(ov.datasets.map((d) => [d.key, d]));
  const datasets = DATASET_ORDER.map((k) => byKey.get(k)).filter((d): d is HgabDatasetMeta => Boolean(d));
  const recon = ov.reconciliation ?? [];
  const count = (s: string) => recon.filter((r) => r.status === s).length;
  const nepDocs = ov.documents.filter((d) => d.stage === 'nep');
  const houseDocs = sortHouseDocs(ov.documents.filter((d) => d.stage === 'house'));
  const commit = ov.source_commit?.slice(0, 7) ?? '';
  const built = ov.built_at ? new Date(ov.built_at) : null;

  return (
    <>
      <HgabHeader crumb="Overview" heroBlend />

      {/* The landing hero says only the section's name (docs/hgab-copy.md); what it used to say opens the page. */}
      <HgabHero crumb="Overview" title="House Budget Analysis" />

      <main className="nep-main">
        <div className="hgab-ov-intro">
          <p className="hgab-ov-lede">
            The NEP, or National Expenditure Program, is the budget the President submits to Congress
            each August. The House of Representatives then passes its own version, House Bill 10858.
            This section sets the two side by side, project by project. It shows what the House added,
            dropped, raised or cut, each traceable to a page of the published documents.
          </p>
          <p className="hgab-ov-scope">
            This is not the whole bill. The bill covers every department. Only four programs list
            named projects in both documents, so only those four can be compared line by line.
            Totals for everything else are in <Link to="/2027/browse">the NEP browser</Link>.
          </p>
          <p className="hgab-recon-note">
            For a short, guided version, <Link to={`${HGAB_ROOT}/intro`}>read the explainer</Link>.
          </p>
        </div>
        <HgabStageStrip />

        {ov.candidate_changes && (
          <CandidateChanges
            cc={ov.candidate_changes}
            datasets={datasets}
            sourceUrl={ov.source_commit ? `${ov.source_repo}/blob/${ov.source_commit}/${ov.candidate_changes.source_file}` : null}
          />
        )}

        {/* ---- one card per dataset ---- */}
        <section className="nep-section" aria-labelledby="hgab-datasets">
          <SectionHead
            eyebrow="Four programs, four kinds of row"
            headline={<span id="hgab-datasets">{datasets.length === 4 ? 'Four' : datasets.length} programs compared project by project</span>}
            dek="Each card shows the amount in the NEP and in the House bill, then how the two differ. The four programs are not added together: a road segment and a hospital ward are not the same unit."
          />
          <div className="hgab-cards">
            {datasets.map((d, i) => <DatasetCard key={d.key} d={d} explain={i === 0} />)}
          </div>
          <DistrictsCallout index={districts} />
        </section>

        {/* ---- reconciliation ---- */}
        <section className="nep-section" aria-labelledby="hgab-recon">
          <SectionHead
            eyebrow="Two readings of the NEP"
            headline={<span id="hgab-recon">{recon.length.toLocaleString()} checks against this portal’s own copy of the NEP</span>}
            dek="The analysis read the NEP from the published PDF volumes. This portal reads it from the budget department’s spreadsheet. Where the two disagree, the difference has a written explanation, or it is flagged."
          />
          <KpiStrip
            items={[
              { label: 'Exact', value: count('exact').toLocaleString(), sub: 'to the peso' },
              { label: 'Explained', value: count('explained').toLocaleString(), sub: 'difference has a written reason' },
              {
                label: 'Mismatch',
                value: count('mismatch').toLocaleString(),
                tone: count('mismatch') > 0 ? 'down' : undefined,
                sub: count('mismatch') > 0 ? 'needs a look' : 'none open',
              },
              { label: 'Checks', value: recon.length.toLocaleString(), sub: `across ${datasets.length} programs` },
            ]}
          />
          <p className="hgab-recon-note">
            Matching totals show the program totals were read correctly. They do not vouch for any single
            project name, place or pairing. <Link to={`${HGAB_ROOT}/methodology#reconciliation`}>See every check and its note →</Link>
          </p>
        </section>

        {/* ---- documents ---- */}
        <section className="nep-section" aria-labelledby="hgab-docs">
          <SectionHead
            eyebrow="Documents"
            headline={<span id="hgab-docs">The published sources</span>}
            dek="Every amount on these pages links back to a page in one of these PDFs. File fingerprints, sizes and downloads are on the Sources page."
            right={<Link className="hgab-cta hgab-cta-quiet" to={`${HGAB_ROOT}/sources`}>All sources & downloads →</Link>}
          />
          <div className="hgab-docs">
            <div>
              <h3>The {STAGE_LABELS.nep.short}</h3>
              <DocList docs={nepDocs} />
            </div>
            <div>
              <h3>The House bill (HB 10858)</h3>
              <DocList docs={houseDocs} />
            </div>
          </div>
        </section>

        <DisclaimerNotice />

        <p className="nep-provenance">
          {built && `Built ${built.toLocaleString('en-PH')} · `}
          Figures copied unchanged from{' '}
          <a href={ov.source_repo} target="_blank" rel="noopener noreferrer">the analysis repository</a>
          {commit && <> at commit <code>{commit}</code></>}
          {' · '}<Link to={`${HGAB_ROOT}/sources`}>Sources</Link>
          {' · '}<Link to={`${HGAB_ROOT}/methodology`}>Methodology</Link>
        </p>
      </main>
      <SiteFooter source="SOURCE: HOUSE BILL 10858 (2ND & 3RD READING) · DBM NEP FY 2027 · 4 PROGRAMS" />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * Points at the districts pages. The "not assigned to a district" sentence is
 * that lens's third condition — most DPWH money sits under the Central Office
 * and appears on no district card — so it is quoted here too, not left for the
 * districts page alone.
 */
function DistrictsCallout({ index }: { index: HgabDistrictIndex | null }) {
  const head = index ? headlineResidual(index.residual) : null;
  const share = head ? residualShare(head) : null;
  return (
    <section className="hgab-dx-callout" aria-labelledby="hgab-districts-callout">
      <div>
        <p className="hgab-dx-callout-eyebrow">By district engineering office · DPWH only</p>
        <h3 id="hgab-districts-callout">DPWH district engineering offices and the legislative districts they serve</h3>
        <p>
          One card per legislative district. Each card names the district’s representative in the
          20th Congress. It lists the DPWH district engineering office, or offices, that serve it. It
          shows that office’s budget by Congress and by year, from the enacted budgets (GAA) of 2020 to
          2026. It then sets the 2027 House bill against the NEP for the office’s
          lines. An office shared by several districts is shown as one whole total; nothing is split
          or guessed.
        </p>
        {head && share != null ? (
          <p className="hgab-dx-callout-figure">
            <strong>{fmt.php(residualUnattributed(head))}</strong> of <strong>{fmt.php(head.total_php)}</strong> in{' '}
            {slotLabel(head)} ({fmt.pct(share, 1)}) sits under the Central Office, regional offices or
            offices we could not match. That money is not assigned to any district and appears on no card.
          </p>
        ) : (
          <p className="hgab-dx-callout-figure">
            Most DPWH money sits under the Central Office and regional offices and appears on no district
            card. The districts pages publish that unassigned amount for every year.
          </p>
        )}
      </div>
      <Link className="hgab-cta hgab-cta-primary" to={districtPath()}>Open districts →</Link>
    </section>
  );
}

function DatasetCard({ d, explain }: { d: HgabDatasetMeta; explain: boolean }) {
  const { totals, counts } = d;
  const identicalReadings =
    !d.has_readings && totals.hgab2_php != null && totals.hgab3_php != null && totals.hgab2_php === totals.hgab3_php;
  const stages: Array<{ key: 'nep' | 'hgab2' | 'hgab3'; php: number | null; rows: number | null }> = [
    { key: 'nep', php: totals.nep_php, rows: counts.nep },
    { key: 'hgab2', php: totals.hgab2_php, rows: counts.hgab2 },
    { key: 'hgab3', php: totals.hgab3_php, rows: counts.hgab3 },
  ];
  const caveats = datasetCaveats(d);
  // The data's caveats usually say this already; print it only when they do not.
  const sayIdentical = identicalReadings && !caveats.some((c) => /third reading/i.test(c));
  return (
    <article className="hgab-card" aria-labelledby={`hgab-card-${d.key}`}>
      <header>
        <p className="hgab-card-agency">{d.agency}</p>
        <h3 className="hgab-card-title" id={`hgab-card-${d.key}`}>
          <Link to={datasetPath(d.key)}>{d.label}</Link>
        </h3>
        <p className="hgab-card-summary">{datasetSummary(d)}</p>
      </header>

      <dl className="hgab-card-stages">
        {stages.map((s) => {
          const label = STAGE_LABELS[s.key];
          const delta = s.key === 'nep' || s.php == null ? null : s.php - totals.nep_php;
          const pct = s.key === 'nep' ? null : pctChange(s.php, totals.nep_php);
          return (
            <div className="hgab-card-stage" key={s.key}>
              <dt title={label.label}>{label.short}</dt>
              <dd>
                <span className={`hgab-amt ${s.php == null ? 'is-empty' : ''}`.trim()}>
                  {s.php == null ? '—' : fmt.shortPhp(s.php)}
                </span>
                <span className="hgab-rows">
                  {s.rows == null ? 'no rows' : `${s.rows.toLocaleString()} rows`}
                </span>
                {s.key !== 'nep' && s.php != null && (
                  <span className="hgab-delta-line">
                    <SignedPhp value={delta} />{' '}
                    <span className="hgab-delta">{pct == null ? '' : `(${formatPct(pct)} vs ${STAGE_LABELS.nep.short})`}</span>
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {sayIdentical && (
        <p className="hgab-rows" style={{ marginTop: -6 }}>
          The House list is word-for-word the same at second and third reading.
        </p>
      )}
      {d.printed && (d.printed.nep_new_appropriations_php != null || d.printed.house_new_appropriations_php != null) && (
        <p className="hgab-rows" style={{ marginTop: -6 }} title="Broader than the project lists compared on this card">
          Totals published for the whole {d.key === 'dpwh' ? 'agency' : 'program'} — {STAGE_LABELS.nep.short}{' '}
          {fmt.shortPhp(d.printed.nep_new_appropriations_php)} · House{' '}
          {fmt.shortPhp(d.printed.house_new_appropriations_php)}
        </p>
      )}

      <BridgeStrip bridge={d.bridge} dataset={d.key} explain={explain} />

      <Caveats items={caveats} />

      <HgabDetails>
        <dl>
          <dt>Each row</dt>
          <dd>{d.grain}</dd>
          <dt>Scope</dt>
          <dd>{d.scope}</dd>
        </dl>
      </HgabDetails>

      <footer className="hgab-card-ctas">
        <Link className="hgab-cta hgab-cta-primary" to={datasetPath(d.key)}>Open {DATASET_SHORT[d.key]} →</Link>
        <Link className="hgab-cta" to={datasetPath(d.key, 'projects')}>Projects</Link>
        <Link className="hgab-cta" to={datasetPath(d.key, 'changes')}>Changes</Link>
        <Link className="hgab-cta" to={datasetPath(d.key, 'map')}>Map</Link>
        <Link className="hgab-cta hgab-cta-quiet" to={`/2027/d/${d.dept_id}`} title={`Department group ${d.dept_id} in the NEP browser`}>
          This agency in the NEP →
        </Link>
      </footer>
    </article>
  );
}

function DocList({ docs }: { docs: HgabDocument[] }) {
  if (!docs.length) return <p className="nep-empty">No documents registered.</p>;
  return (
    <ul className="hgab-doc-list">
      {docs.map((doc) => (
        <li key={doc.key}>
          <span>
            <span className="hgab-doc-title">{doc.title}</span>
            <span className="hgab-doc-meta">
              {[
                doc.reading ? `${ordinal(doc.reading)} reading` : null,
                volumeLabel(doc.volume),
                doc.pages ? `pp. ${doc.pages.from.toLocaleString()}–${doc.pages.to.toLocaleString()}` : null,
                doc.bytes ? formatBytes(doc.bytes) : null,
              ].filter(Boolean).join(' · ')}
            </span>
          </span>
          <a className="hgab-doc-open" href={pdfUrl(doc.key)} target="_blank" rel="noopener noreferrer">
            Open PDF ↗
          </a>
        </li>
      ))}
    </ul>
  );
}

/** "I-C" → "Vol. I-C"; prose volumes print as they are, with the source's "Annex" read as "List". */
function volumeLabel(volume: string | null): string | null {
  if (!volume) return null;
  return /^[IVX]+(-[A-Z])?$/.test(volume) ? `Vol. ${volume}` : volume.replace(/^Annex\b/, 'List');
}

function sortHouseDocs(docs: HgabDocument[]): HgabDocument[] {
  return [...docs].sort((a, b) => (a.reading ?? 0) - (b.reading ?? 0) || (a.volume ?? '').localeCompare(b.volume ?? ''));
}

// ---------------------------------------------------------------------------
// House bill vs. NEP: candidate changes
// ---------------------------------------------------------------------------

/**
 * The columns of the workbench Overview's candidate-change table, in its
 * order, under the section's words: the insertion/deletion/increase/decrease
 * vocabulary with a plain gloss. Each maps to the Projects filter for its group.
 */
const CC_COLUMNS: ReadonlyArray<{ group: BridgeGroup; label: string; gloss: string }> = [
  { group: 'house_only', label: 'Insertion candidates', gloss: 'In the House bill only' },
  { group: 'nep_only', label: 'Deletion candidates', gloss: 'In the NEP only' },
  { group: 'unchanged', label: 'Unchanged', gloss: 'Matched, no change' },
  { group: 'increased', label: 'Increases', gloss: 'Matched, amount raised' },
  { group: 'decreased', label: 'Decreases', gloss: 'Matched, amount reduced' },
];
const CC_HOUSE = { label: 'House bill total', gloss: 'Every House record' };

/** The Projects list filtered to one group (all rows, unconfirmed matches included, as the counts are). */
function groupPath(key: DatasetKey, group: BridgeGroup): string {
  return `${datasetPath(key, 'projects')}&group=${group}`;
}

/** "6,196 allocation records", "1 project record". */
function countOf(n: number, unit: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? unit.replace(/s$/, '') : unit}`;
}

/** What one cell shows: a figure, its count, and up to two quiet lines. */
interface CcFigure {
  amount: number;
  signed: boolean;
  count: string;
  lines: string[];
}

function ccFigures(p: HgabCandidateProgram, group: BridgeGroup, money: (n: number) => string): CcFigure {
  const a = p.adjustments;
  // HFEP's changes are funding-column records, not pairs; the unit says so.
  const pairUnit = /pairs/.test(a.count_unit) ? 'pairs' : 'changed records';
  const rows = (x: HgabCandidatePopulation) =>
    x.comparison_rows != null && x.comparison_rows !== x.count ? [`in ${x.comparison_rows.toLocaleString('en-US')} rows`] : [];
  switch (group) {
    case 'house_only':
      return { amount: p.insertions.amount_php, signed: false, count: countOf(p.insertions.count, p.count_unit), lines: ['House amount', ...rows(p.insertions)] };
    case 'nep_only':
      return { amount: p.deletions.amount_php, signed: false, count: countOf(p.deletions.count, p.count_unit), lines: ['NEP amount', ...rows(p.deletions)] };
    case 'unchanged':
      return { amount: p.unchanged.amount_php, signed: false, count: countOf(p.unchanged.count, p.count_unit), lines: ['Same in both', ...rows(p.unchanged)] };
    case 'increased':
      return {
        amount: a.increased_php, signed: true, count: countOf(a.increased_count, pairUnit),
        lines: a.increased_count ? [`NEP ${money(a.increased_nep_php)} → House ${money(a.increased_house_php)}`] : [],
      };
    case 'decreased':
      return {
        amount: -a.reduced_php, signed: true, count: countOf(a.reduced_count, pairUnit),
        lines: a.reduced_count ? [`NEP ${money(a.reduced_nep_php)} → House ${money(a.reduced_house_php)}`] : [],
      };
    default:
      return { amount: 0, signed: false, count: '', lines: [] };
  }
}

function CcAmount({ value, signed, money }: { value: number; signed: boolean; money: (n: number) => string }) {
  const sign = signed ? (value > 0 ? '+' : value < 0 ? '−' : '') : '';
  return (
    <span className="hgab-cc-amt" title={`${sign}${fmt.php(Math.abs(value), { unit: 'full' })}`}>
      {sign}{money(Math.abs(value))}
    </span>
  );
}

/** One cell: the column's name for the phone layout, then the figure, count and notes. */
function CcCellBody({ label, gloss, fig, money }: { label: string; gloss: string; fig: CcFigure; money: (n: number) => string }) {
  return (
    <>
      <span className="hgab-cc-mlabel">{label}<small>{gloss}</small></span>
      <span className="hgab-cc-fig">
        <CcAmount value={fig.amount} signed={fig.signed} money={money} />
        <span className="hgab-cc-n">{fig.count}</span>
        {fig.lines.map((l) => <span className="hgab-cc-meta" key={l}>{l}</span>)}
      </span>
    </>
  );
}

/**
 * "House bill vs. NEP: candidate changes" — the source workbench Overview's
 * table (analysis/web/src/MainOverview.jsx), from `overview.json`
 * `candidate_changes`: the workbench's own figures, carried by the importer
 * and re-checked by the verifier against each program's rows. Counts keep the
 * workbench's record grain, named in every row; the Total row adds pesos
 * exactly and labels its counts as mixed. On phones each program becomes a card.
 */
function CandidateChanges({ cc, datasets, sourceUrl }: { cc: HgabCandidateChanges; datasets: HgabDatasetMeta[]; sourceUrl: string | null }) {
  const [params, setParams] = useSearchParams();
  const exact = params.get('exact') === '1';
  // Short figures (172.1B) by default, every peso on request; a true zero prints as 0.
  const money = (n: number) => (exact || n === 0 ? n.toLocaleString('en-US') : fmt.shortPhp(n));
  const setExact = (on: boolean) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (on) next.set('exact', '1');
      else next.delete('exact');
      return next;
    }, { replace: true, preventScrollReset: true });
  const nameOf = new Map(datasets.map((d) => [d.key, d.label]));
  const t = cc.totals;
  const scope = cc.programs.filter((p) => p.scope_review && p.scope_review.count > 0);
  const split = cc.programs.filter((p) => [p.insertions, p.deletions, p.unchanged].some((x) => x.comparison_rows != null && x.comparison_rows !== x.count));
  const hfep = cc.programs.find((p) => p.adjustments.events);
  const oneSided = hfep?.adjustments.events ? hfep.adjustments.events.added + hfep.adjustments.events.dropped : 0;
  const readings = cc.programs.filter((p) => p.house_stage === 'hgab3').map((p) => DATASET_SHORT[p.key]);
  const totalFig = (g: BridgeGroup): CcFigure => {
    switch (g) {
      case 'house_only': return { amount: t.insertions.amount_php, signed: false, count: countOf(t.insertions.count, 'records'), lines: ['House amount'] };
      case 'nep_only': return { amount: t.deletions.amount_php, signed: false, count: countOf(t.deletions.count, 'records'), lines: ['NEP amount'] };
      case 'unchanged': return { amount: t.unchanged.amount_php, signed: false, count: countOf(t.unchanged.count, 'records'), lines: ['Same in both'] };
      case 'increased': return { amount: t.increased.php, signed: true, count: countOf(t.increased.count, 'changes'), lines: [`NEP ${money(t.increased.nep_php)} → House ${money(t.increased.house_php)}`] };
      case 'decreased': return { amount: -t.decreased.php, signed: true, count: countOf(t.decreased.count, 'changes'), lines: [`NEP ${money(t.decreased.nep_php)} → House ${money(t.decreased.house_php)}`] };
      default: return { amount: 0, signed: false, count: '', lines: [] };
    }
  };

  return (
    <section className="nep-section hgab-cc" aria-labelledby="hgab-cc-head">
      <SectionHead
        eyebrow="Candidate changes · four programs"
        headline={<span id="hgab-cc-head">House bill vs. NEP: candidate changes</span>}
        dek="Every line in the four programs, sorted by what happened to it between the NEP and the House bill. Select a figure to see those lines."
        right={
          <label className="hgab-cc-exact">
            <input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} /> Exact pesos
          </label>
        }
      />
      <WhatThisMeans>{PLAIN.candidateMeans}</WhatThisMeans>

      <div className={`hgab-cc-wrap ${exact ? 'is-exact' : ''}`.trim()} role="region" aria-labelledby="hgab-cc-caption" tabIndex={0}>
        <table className="hgab-cc-table">
          <caption id="hgab-cc-caption">
            Candidate changes by program, in pesos{exact ? '' : ' (B = billion, M = million)'}. Changes are House bill minus NEP.
          </caption>
          <thead>
            <tr>
              <th scope="col">Program</th>
              {CC_COLUMNS.map((c) => (
                <th scope="col" key={c.group} className={`is-${c.group}`}>{c.label}<small>{c.gloss}</small></th>
              ))}
              <th scope="col">{CC_HOUSE.label}<small>{CC_HOUSE.gloss}</small></th>
            </tr>
          </thead>
          <tbody>
            {cc.programs.map((p) => {
              const name = nameOf.get(p.key) ?? p.label;
              return (
                <tr key={p.key}>
                  <th scope="row">
                    <Link to={datasetPath(p.key)}>{name}</Link>
                    <small>Counted in {p.count_unit}</small>
                  </th>
                  {CC_COLUMNS.map((c) => {
                    const fig = ccFigures(p, c.group, money);
                    return (
                      <td key={c.group} className={`is-${c.group}`}>
                        <Link className="hgab-cc-cell" to={groupPath(p.key, c.group)}>
                          <CcCellBody label={c.label} gloss={c.gloss} fig={fig} money={money} />
                        </Link>
                      </td>
                    );
                  })}
                  <td className="is-house">
                    <Link className="hgab-cc-cell" to={datasetPath(p.key)}>
                      <CcCellBody
                        label={CC_HOUSE.label}
                        gloss={CC_HOUSE.gloss}
                        money={money}
                        fig={{
                          amount: p.sources.house.amount_php, signed: false, count: countOf(p.sources.house.count, p.count_unit),
                          lines: [
                            ...(p.sources.house.facility_count != null ? [`${p.sources.house.facility_count.toLocaleString('en-US')} facilities`] : []),
                            `House − NEP ${p.delta_php > 0 ? '+' : p.delta_php < 0 ? '−' : ''}${money(Math.abs(p.delta_php))}`,
                          ],
                        }}
                      />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="hgab-cc-total">
              <th scope="row">
                Total, {t.programs === 4 ? 'four' : t.programs} programs
                <small>Pesos add up; counts mix record types</small>
              </th>
              {CC_COLUMNS.map((c) => (
                <td key={c.group} className={`is-${c.group}`}>
                  <span className="hgab-cc-cell">
                    <CcCellBody label={c.label} gloss={c.gloss} fig={totalFig(c.group)} money={money} />
                  </span>
                </td>
              ))}
              <td className="is-house">
                <span className="hgab-cc-cell">
                  <CcCellBody
                    label={CC_HOUSE.label}
                    gloss={CC_HOUSE.gloss}
                    money={money}
                    fig={{
                      amount: t.house.amount_php, signed: false, count: countOf(t.house.count, 'records'),
                      lines: [`House − NEP ${t.delta_php > 0 ? '+' : t.delta_php < 0 ? '−' : ''}${money(Math.abs(t.delta_php))}`],
                    }}
                  />
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {scope.map((p) => {
        const s = p.scope_review!;
        const name = nameOf.get(p.key) ?? p.label;
        return (
          <p className="hgab-cc-scope is-scope_review" key={p.key}>
            <strong>Scope review · {name}: {countOf(s.count, 'pairs')} cover different stretches of the same road.</strong>{' '}
            The NEP lists <span title={fmt.php(s.nep_php, { unit: 'full' })}>{money(s.nep_php)}</span> for them and the House bill{' '}
            <span title={fmt.php(s.house_php, { unit: 'full' })}>{money(s.house_php)}</span>.
            The net <CcAmount value={s.net_php} signed money={money} /> is kept apart from the increases and decreases.{' '}
            <Link to={groupPath(p.key, 'scope_review')}>See the {s.count.toLocaleString('en-US')} pairs →</Link>
          </p>
        );
      })}

      <ul className="hgab-cc-notes">
        <li>
          In every program, insertion candidates − deletion candidates + increases − decreases + scope review = House bill −
          NEP, to the peso.
        </li>
        <li>Each program counts its own kind of record, named in its row. Counts do not compare across rows.</li>
        {split.map((p) => {
          const x = [p.insertions, p.deletions, p.unchanged].find((y) => y.comparison_rows != null && y.comparison_rows !== y.count)!;
          return (
            <li key={p.key}>
              {DATASET_SHORT[p.key]} counts {countOf(x.count, p.count_unit)} in {x.comparison_rows!.toLocaleString('en-US')} rows.
              Some House rows group repeated entries; the project lists show rows.
            </li>
          );
        })}
        {hfep && (
          <li>
            {DATASET_SHORT[hfep.key]} counts one record per facility and spending column: building, equipment or vehicle.
            {oneSided > 0 && <> Of its {countOf(hfep.adjustments.count, 'changed records')}, {oneSided} are a column listed for a matched facility in one document only.</>}
          </li>
        )}
        <li>Increases and decreases show what the matched pairs carry in each document, then the change.</li>
        {readings.length > 0 && (
          <li>
            {readings.join(', ')} figures are at third reading. The other programs’ House lists are the same at second and
            third reading.
          </li>
        )}
        <li>
          The Total row adds the four programs. Its pesos add up exactly; its counts mix kinds of record. Add the scope
          review to rebuild the full House − NEP.
        </li>
      </ul>

      <p className="hgab-cc-allegations">
        <strong>{DISCLAIMER_NO_ALLEGATIONS.title}</strong> {DISCLAIMER_NO_ALLEGATIONS.body}
      </p>
      <p className="hgab-cc-source">
        Figures carried unchanged from the analysis workbench’s overview
        {sourceUrl ? <> (<a href={sourceUrl} target="_blank" rel="noopener noreferrer">main_overview_2027.json</a>)</> : null}, and
        checked against each program’s own rows.
      </p>
    </section>
  );
}
