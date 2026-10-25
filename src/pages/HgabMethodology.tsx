/**
 * `/hgab/2027/methodology` — how the House bill was read, matched to the NEP,
 * bucketed into the five-group bridge, and checked against this portal's own
 * NEP data; the limits; and the full disclaimer (`#disclaimer`).
 *
 * The vocabulary tables render straight from the labels in lib/hgab.ts so
 * the words here are the words on every chip. The reconciliation table reads
 * overview.json; the rest of the page is static and renders before it lands.
 *
 * Copy: this page is where the technical detail lives, so the tables and the
 * prose keep the workbench's terms. Every section opens with two plain
 * sentences (`.hgab-plain-intro`) a reader can stop at.
 */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { HgabHeader, HgabHero, StatusChip } from '../components/HgabBits';
import * as fmt from '../lib/format';
import { pageMeta } from '../lib/seo';
import {
  BRIDGE_LABELS, BRIDGE_ORDER, HGAB_ROOT, HGAB_SOURCE_REPO, MATCH_LABELS, READING_LABELS, TRACE_LABELS,
  loadHgabOverview, type HgabOverview,
} from '../lib/hgab';
import { DATASET_SHORT, RECON_STATUS_LABEL, reconStatusClass } from '../lib/hgab-ui';
import '../nep2027.css';

const PATH = `${HGAB_ROOT}/methodology`;

export default function HgabMethodology() {
  const [ov, setOv] = useState<HgabOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { hash } = useLocation();

  useEffect(() => {
    document.title = pageMeta(PATH).title;
    loadHgabOverview().then(setOv).catch((e) => setErr(String(e?.message || e)));
  }, []);

  // React Router does not scroll to a hash on its own; `#disclaimer` and
  // `#reconciliation` are linked from every page in the section.
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ block: 'start' });
  }, [hash, ov]);

  const commit = ov?.source_commit?.slice(0, 7);
  const repo = ov?.source_repo || HGAB_SOURCE_REPO;
  // The House bill's printed DPWH total against the NEP's, from the data rather than restated by hand.
  const dpwhPrinted = ov?.datasets.find((d) => d.key === 'dpwh')?.printed ?? null;
  const dpwhPrintedGap = dpwhPrinted?.nep_new_appropriations_php != null && dpwhPrinted.house_new_appropriations_php != null
    ? dpwhPrinted.house_new_appropriations_php - dpwhPrinted.nep_new_appropriations_php
    : null;

  return (
    <>
      <HgabHeader crumb="Methodology" />
      <HgabHero
        compact
        crumb="Methodology"
        title="How the House bill was matched to the NEP"
        dek="We compare two published documents line by line. This page explains how each line was read and matched, what every label means, and where the comparison stops."
      />

      <main className="nep-main nep-prose hgab-prose">
        <nav className="hgab-dataset-switch" aria-label="On this page" style={{ marginBottom: 8 }}>
          <a href="#documents">Documents</a>
          <a href="#extraction">Reading the pages</a>
          <a href="#matching">Matching</a>
          <a href="#bridge">Six groups</a>
          <a href="#reconciliation">Checks</a>
          <a href="#limits">Limits</a>
          <a href="#disclaimer">Disclaimer</a>
        </nav>

        {/* ---- documents and stages ---- */}
        <section className="nep-section" id="documents">
          <SectionHead eyebrow="Documents and versions" headline="What is being compared" />
          <p className="hgab-plain-intro">
            Two versions of the 2027 budget: the NEP and the House bill
            (HB 10858). Only four programs list named projects in both, so only those four are compared.
          </p>
          <p>
            The <strong>NEP</strong> is the budget the President submits to Congress each August; the 2027
            NEP was submitted in August 2026 and published by DBM in volumes. For DPWH the project detail is in Volume II-B; for farm-to-market
            roads, the Health Facilities Enhancement Program and irrigation it is in annexes to the
            agency chapters. The <strong>House General Appropriations Bill</strong> is House Bill 10858:
            the version approved on <em>second reading</em> and the version approved on <em>third
            reading</em> were published separately, and the DPWH detail (Volume I-C) changed between them.
            The three annexes were verified text-identical across the two readings. For DPWH a third
            record, the <strong>Transparency</strong> listing published on the agency’s own portal, is
            attached where it exists; it is a listing of the NEP, not a budget stage.
          </p>
          <table className="nep-table nep-kv">
            <tbody>
              <tr><th>Stages compared</th><td>NEP → House second reading → House third reading. Stages are set side by side, never added.</td></tr>
              <tr><th>Programs</th><td>DPWH national infrastructure (group 18) · DA farm-to-market roads (05) · DOH HFEP (13) · NIA irrigation (35). The only parts of the bill listed as named projects on both sides.</td></tr>
              <tr><th>Each row</th><td>DPWH: a named project with chainage, region and implementing office. FMR: a project with published coordinates. HFEP: a facility with four funding columns. NIA: a project under one of six sub-programs.</td></tr>
              <tr><th>Not compared</th><td>Everything the bill lists only as an agency or program total — the large majority of the bill by value — and any special or general provision in prose. For those, the NEP browser’s department pages are the right place to look.</td></tr>
            </tbody>
          </table>
        </section>

        {/* ---- extraction ---- */}
        <section className="nep-section" id="extraction">
          <SectionHead eyebrow="Reading the pages" headline="How lines were read off the page" />
          <p className="hgab-plain-intro">
            The House bill’s PDFs contain their own text, so it was read directly. The NEP’s DPWH
            volume is a scan, so its text was read by software and every amount was checked a second time.
          </p>
          <ul className="nep-bullets">
            <li>
              <strong>House volumes: native text layer.</strong> HB 10858 is a digitally typeset PDF, so
              rows are read from the embedded text with their positions, not OCR. The extractor builds an
              additive tree — program → PAP → region → office → project → funding partition — and asserts
              at every level that children sum to the published parent. A mismatch stops the build.
            </li>
            <li>
              <strong>NEP Volume II-B: OCR with per-row evidence.</strong> DBM’s DPWH volume is a scan.
              Each row’s amount carries an evidence grade from a second, independent read of the same
              page area (<code>within_bbox_agreement</code>, <code>native_row_ambiguity</code>,
              <code>native_text_review</code>, <code>nearby_alignment_candidate</code>,
              <code>not_checked</code>). Thousands of rows remain in review queues; the figure is still
              shown, with its grade.
            </li>
            <li>
              <strong>Annexes: native or OCR per document.</strong> The FMR, HFEP and NIA annexes are
              small and were extracted with whichever method the source permitted, then checked against
              the totals published in each document. HFEP’s published NEP total is ₱140,000 more than the
              sum of its facility lines, an error in the published list, noted by the source; both values
              are kept rather than forced to agree.
            </li>
            <li>
              <strong>Normalisation is additive.</strong> Titles are never rewritten. Match keys are
              computed beside the published text (<em>Brgy.</em>↔<em>Barangay</em>, structure IDs with
              <code> O</code>→<code>0</code>, repeated tokens collapsed), and the key, the published title and
              the page are all retained on the record.
            </li>
            <li>
              <strong>Every row keeps its page.</strong> The one-based PDF file page is stored per stage, so
              each amount on a record page opens the exact page it was read from.
            </li>
          </ul>
        </section>

        {/* ---- matching and vocabulary ---- */}
        <section className="nep-section" id="matching">
          <SectionHead
            eyebrow="Matching and vocabulary"
            headline="How a House line is matched to a line in the NEP"
            dek="A House line is matched to a line in the NEP only when a written rule finds exactly one fit. Every match is a lead to check, and the rule that made it is kept with it."
          />
          <p>
            Identity between the two documents is never asserted. A pairing is a candidate produced by a
            rule, kept with the rule’s name, so a reader can decide how much to trust it.
          </p>
          <p>
            Rules run in order and each one only claims pairs that are <em>unique</em> in both documents:
            exact normalised title + region + PAP first; then the stage-qualifier bridge
            (<em>Construction (Completion)</em> ↔ <em>Construction</em>); then same-road pairs whose
            station spans differ; then unique high-similarity pairs that relocate one place slot or
            re-scope one phrase; then soft matches reviewed by tier. Anything with a similar title that
            no rule accepted is kept as a <em>suggestion</em> with a confidence score, not attached.
            Duplicate keys are left ambiguous on purpose.
          </p>

          <h3 className="headline sm" style={{ marginTop: 24 }}>What happened to each line (<code>trace</code>)</h3>
          <div className="nep-table-wrap">
            <table className="nep-table hgab-vocab-table hgab-trace-table">
              <thead>
                <tr><th>Code</th><th>Label on the pages</th><th>Group</th><th>Meaning</th></tr>
              </thead>
              <tbody>
                {Object.entries(TRACE_LABELS).map(([code, t]) => (
                  <tr key={code}>
                    <td><code>{code}</code></td>
                    <td><StatusChip trace={code} /></td>
                    <td>
                      {BRIDGE_LABELS[t.group].label}
                      {t.held && <span className="pill nep-pill" title="Counted under ‘In the House bill only’; left out of the ranked lists of largest changes">unconfirmed</span>}
                    </td>
                    <td className="nep-td-dim">{t.help}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            DPWH rows carry the compounds: <code>transparency_gap_then_*</code> means the NEP row is
            absent from the Transparency listing, <code>outside_api_then_*</code> that it falls outside
            that listing’s scope (mostly foreign-assisted projects). Neither says anything about the
            House pairing beyond the suffix. Unconfirmed matches — fuzzy and ambiguous — are counted in the
            insertion-candidate group, so the six groups add up to the total change. They are left out
            of the ranked lists of largest changes, and the Projects tab can show or hide them.
          </p>

          <h3 className="headline sm" style={{ marginTop: 24 }}>How the pairing was made (<code>house_match</code>, DPWH)</h3>
          <div className="nep-table-wrap">
            <table className="nep-table hgab-vocab-table">
              <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
              <tbody>
                {Object.entries(MATCH_LABELS).map(([code, label]) => (
                  <tr key={code}><td><code>{code}</code></td><td className="nep-td-dim">{label}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="headline sm" style={{ marginTop: 24 }}>Second vs third reading (<code>reading_status</code>, DPWH)</h3>
          <div className="nep-table-wrap">
            <table className="nep-table hgab-vocab-table">
              <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
              <tbody>
                {Object.entries(READING_LABELS).map(([code, label]) => (
                  <tr key={code}><td><code>{code}</code></td><td className="nep-td-dim">{label}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ---- bridge ---- */}
        <section className="nep-section" id="bridge">
          <SectionHead
            eyebrow="Six groups (the bridge)"
            headline="From the NEP’s total to the House total"
            dek="Every line falls into one of six groups, such as “Higher in the House bill”. Add and subtract the groups and you get exactly the difference between the two versions."
          />
          <p>
            Every compared row lands in exactly one group. The groups are chosen so that their signed
            sums reproduce the difference between the two documents — which is what makes the bucketing
            checkable.
          </p>
          <div className="nep-table-wrap">
            <table className="nep-table hgab-vocab-table">
              <thead><tr><th>Group</th><th>Label</th><th>Money basis</th><th>Meaning</th></tr></thead>
              <tbody>
                {BRIDGE_ORDER.map((g) => (
                  <tr key={g}>
                    <td><code>{g}</code></td>
                    <td>
                      <span className={`hgab-chip is-${g}`}>{BRIDGE_LABELS[g].label}</span>
                      <span className="nep-code">{BRIDGE_LABELS[g].sub}</span>
                    </td>
                    <td className="nep-td-dim">{BASIS[g]}</td>
                    <td className="nep-td-dim">{BRIDGE_LABELS[g].help}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hgab-identity" aria-label="Bridge identity">
            <span className="is-house_only">insertion candidates</span> − <span className="is-nep_only">deletion candidates</span>
            {' '}+ <span className="is-increased">increases</span> − <span className="is-decreased">reductions</span>
            {' '}± <span className="is-scope_review">different stretch of the same road</span> = House total − NEP total
          </p>
          <p>
            Unchanged rows contribute zero by definition and are shown for scale. Increases and
            decreases are the <em>movement</em> on paired rows, not the rows’ totals. Segment-scope
            pairs — the same road, non-overlapping chainage — are carried at their signed difference
            so the identity closes, but are deliberately not booked as increases or cuts: a different
            segment is a different scope, not an adjustment. The importer asserts the identity for
            every dataset at build time.
          </p>
        </section>

        {/* ---- reconciliation ---- */}
        <section className="nep-section hgab-breakout" id="reconciliation">
          <SectionHead
            eyebrow="Checked against this portal’s NEP data"
            headline={ov ? `${ov.reconciliation.length.toLocaleString()} checks on two readings of the same NEP` : 'Two readings of the same NEP'}
            dek="The analysis read the NEP from the published PDFs; this portal reads it from the budget department’s spreadsheet. Where both can add up the same total, we check that they agree."
          />
          <p>
            The workbench’s NEP comes from the published PDFs; this portal’s comes from DBM’s
            NEP-FY2027.csv. Each check compares a control total both can compute. “Explained” differences
            have a scope note; a “mismatch” would mean one side misread the document.
          </p>
          {err && <p className="nep-empty">The reconciliation table could not be loaded: {err}</p>}
          {!ov && !err && <p className="nep-empty" aria-busy="true">Loading the reconciliation checks…</p>}
          {ov && (
            <div className="nep-table-wrap">
              <table className="nep-table hgab-recon-table">
                <thead>
                  <tr>
                    <th>Program</th>
                    <th className="nep-th-name">Check</th>
                    <th className="num">This portal (CSV)</th>
                    <th className="num">Analysis (PDF)</th>
                    <th className="num">Difference</th>
                    <th>Status</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {ov.reconciliation.map((r, i) => (
                    <tr key={`${r.dataset}-${r.check}-${i}`}>
                      <td><Link to={`${HGAB_ROOT}/${r.dataset}`}>{DATASET_SHORT[r.dataset] ?? r.dataset.toUpperCase()}</Link></td>
                      <td className="nep-td-name">{r.check}</td>
                      <td className="num">{r.ours_php == null ? '—' : fmt.php(r.ours_php, { unit: 'full' })}</td>
                      <td className="num">{r.theirs_php == null ? '—' : fmt.php(r.theirs_php, { unit: 'full' })}</td>
                      <td className="num">{signedFull(r.diff_php)}</td>
                      <td><span className={reconStatusClass(r.status)}>{RECON_STATUS_LABEL[r.status] ?? r.status}</span></td>
                      <td className="hgab-td-note">{r.note}</td>
                    </tr>
                  ))}
                  {ov.reconciliation.length === 0 && (
                    <tr><td colSpan={7} className="nep-empty">No reconciliation rows in this build.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p>
            Balanced controls say the extraction read the totals correctly. They do not say that any
            single title, location or pairing is right; those are checked row by row, with the evidence
            grades above.
          </p>
        </section>

        {/* ---- limits ---- */}
        <section className="nep-section" id="limits">
          <SectionHead eyebrow="Limits" headline="Where the comparison stops" />
          <p className="hgab-plain-intro">
            The comparison is a starting point for questions, not a verdict. These are the places where
            it can mislead if read too quickly.
          </p>
          <ul className="nep-bullets">
            <li><strong>Candidates, not findings.</strong> No pairing in this build has been manually certified. A row in <em>Insertion candidates</em> means no NEP record was attached by the rules — not that the House inserted it. A re-titled or re-scoped counterpart may exist.</li>
            <li><strong>Amounts do not prove identity.</strong> Equal amounts with similar titles are still candidates; different amounts on a paired row do not break the pairing. Same road, same building family or same municipality do not establish that two rows are one project.</li>
            <li><strong>Scope differences are real.</strong> The NEP volume includes general administration and support that the House project extract does not{dpwhPrintedGap != null && <>; the House bill’s published DPWH total is <span title={fmt.php(Math.abs(dpwhPrintedGap), { unit: 'full' })}>{fmt.php(Math.abs(dpwhPrintedGap))}</span> {dpwhPrintedGap >= 0 ? 'above' : 'below'} the NEP’s</>}. Compare within one program, PAP or zone — the pages separate them for this reason.</li>
            <li><strong>Region and office are per source.</strong> A paired row can carry a different region on each side. Filters use the House-side assignment; a difference is flagged, not resolved.</li>
            <li><strong>Chainage lengths are parsed.</strong> Peso-per-kilometre figures divide a published allocation by a parsed station span. OCR-damaged spans are flagged; a repair is not a survey.</li>
            <li><strong>Transparency gaps are listing observations.</strong> “Not in Transparency” means the NEP row is absent from the published listing. It is not evidence of concealment; foreign-assisted projects are outside that listing’s scope by design.</li>
            <li><strong>Allocations, not spending.</strong> Every figure is a published appropriation at a budget stage. None is an obligation, a disbursement or work completed.</li>
            <li><strong>The numbers move.</strong> The pipeline is active; counts changed between the October builds and will again. The commit on the Sources page pins what you are looking at.</li>
          </ul>
        </section>

        {/* ---- disclaimer ---- */}
        <section className="nep-section hgab-notice" id="disclaimer">
          <SectionHead
            eyebrow="Disclaimer"
            headline="Read before quoting any figure from this section"
            dek="Adapted from the extraction workbench’s notice of 23 October 2026. The substance is unchanged; the wording is this site’s."
          />
          <p className="hgab-plain-intro">
            This is our own reading of the documents, not an official record. A possible change is a lead
            to check; it does not say anyone did anything wrong.
          </p>
          <h3>Independent and unofficial</h3>
          <p>
            This section is independent analysis of retained copies of the FY2027 National Expenditure
            Program, House Bill 10858 and related material. It is not an official record of DBM, DPWH,
            DA, DOH, NIA, the House of Representatives or the Senate, and none of those bodies has
            reviewed or endorsed it. A link to or from a government office or a media outlet does not
            change that. Verify a figure against the specific document, edition and stage cited for
            it: a copy’s reading label, or identical text across selected annex pages, does not by
            itself authenticate the legislative stage of the whole bill. Figures describe allocations
            in those sources; they say nothing about amounts obligated, disbursed or work completed.
          </p>
          <h3>Where errors can arise</h3>
          <p>
            Rows are built from retained documents, by native text where the PDF has it and by OCR
            where it does not, under documented normalisation and review rules. Errors can enter at
            four distinct stages — an error in the published source, an OCR or extraction error, a
            normalisation error, and uncertain matching across documents — and a disagreement is not
            attributed to the published source until it has been checked against it. Retained raw text,
            repair annotations and review flags should be read alongside the normalised values.
          </p>
          <h3>Matching is provisional</h3>
          <p>
            Pairings and classifications — <em>unchanged</em>, <em>increased</em>, <em>decreased</em>,
            <em> insertion candidate</em>, <em>deletion candidate</em> — come from documented rules
            applied to titles, locations, amounts and road-station text. Identifiers local to one
            document do not certify identity across documents, and different reasonable rules would
            classify some rows differently. <strong>Pairings and change classifications are candidates
            and review leads, not certified findings.</strong> An unmatched row alone does not
            establish that a project was inserted, removed or reduced; and whether two rows are the
            same project is a separate question from whether either amount was transcribed correctly.
          </p>
          <h3>Ambiguity is kept visible</h3>
          <p>
            Same-road pairs with no overlapping chainage are held in segment-scope review and excluded
            from increase and decrease totals. Title-and-amount twins across programs stay unpaired
            with cross-references rather than being auto-paired. Rows that appear in one reading only
            and have an NEP twin carry a possible-restoration marker without certifying restoration.
            Similar titles, equal amounts and shared road or building families do not establish
            identity; unresolved cases need a human reader.
          </p>
          <h3>Reconciliation is not row correctness</h3>
          <p>
            Control totals that balance say the extraction read the totals right; they do not say
            every title, location or pairing is right. Documented exceptions are kept as two values
            rather than forced to agree. Stages, parent controls and child rows, and repeated or
            multi-segment records must not be added together as separate funding. Each workspace
            covers its stated schedules and record grain, not an agency’s whole budget.
          </p>
          <h3>Offices and districts</h3>
          <p>
            An implementing office is an administrative unit. Associating one with a legislative
            district does not establish that any representative requested, sponsored or controlled a
            project, nor that every project of that office lies in every district it serves. Totals of
            shared offices stay undivided; central and regional office amounts remain unattributable.
            This section does not publish district attributions.
          </p>
          <h3>No allegations</h3>
          <p>
            An insertion, deletion or amount-change candidate is a provisional comparison between two
            identified sources. The classification alone does not establish irregularity or wrongdoing
            by any office or official and must not be represented as doing so. Absence from a listing
            does not establish absence from the published document, or concealment.
          </p>
          <h3>Units, pages and verification</h3>
          <p>
            Check currency units, fiscal year, funding column and scope before comparing amounts: some
            agency forms are in thousands of pesos; annual allocations, total project costs and loan
            or government components are different bases. Cite the document key, reading, volume and
            one-based PDF file page, with the page number shown on the page separately where available — page
            numbers are not interchangeable across copies, volumes or readings. Parsed or repaired
            chainage spans and coordinates keep their review flags; a repair is not a survey, and
            allocation divided by parsed length is an analytical ratio, not a construction unit cost.
            Third-party transcriptions, including BetterGov’s own, are supplementary evidence, not
            official records.
          </p>
          <h3>Citation, revision and corrections</h3>
          <p>
            When quoting, keep the dataset file, record id, pipeline commit, access date, and the
            source document, reading, volume and PDF page — the{' '}
            <Link to={`${HGAB_ROOT}/sources#hgab-src-cite`}>Sources page shows the template</Link>.
            Results may change after source corrections, extraction repairs or revisions to the
            matching rules; check for later corrections before republishing while preserving the
            version you quoted. Report suspected errors through the pipeline’s{' '}
            <a href={`${repo}/issues`} target="_blank" rel="noopener noreferrer">issue tracker ↗</a>{' '}
            with the record, version, source reference and proposed correction.
          </p>
          <p>
            Everything here is provided as is, without warranty of accuracy or completeness. Readers
            remain responsible for checking the cited evidence before relying on or republishing a
            figure.
          </p>
          <p className="hgab-notice-stamp">
            Source notice: <a href={`${repo}/blob/main/disclaimer/README.md`} target="_blank" rel="noopener noreferrer">disclaimer/README.md ↗</a>
            {commit && <> · this build pins commit <code>{commit}</code></>}
          </p>
        </section>

        <p className="nep-provenance">
          <Link to={HGAB_ROOT}>Back to the House bill overview</Link> · <Link to={`${HGAB_ROOT}/sources`}>Sources and downloads</Link> · the NEP’s own methodology is at{' '}
          <Link to="/2027/methodology">/2027/methodology</Link>
        </p>
      </main>
      <SiteFooter source="SOURCE: HOUSE BILL 10858 (2ND & 3RD READING) · DBM NEP FY 2027 · 4 PROGRAMS" />
    </>
  );
}

const BASIS: Record<(typeof BRIDGE_ORDER)[number], string> = {
  house_only: 'House-side amount of the rows (added)',
  nep_only: 'NEP-side amount of the rows (subtracted)',
  unchanged: 'Either side — equal by definition; contributes zero',
  increased: 'House − NEP on the paired rows (added)',
  decreased: 'NEP − House on the paired rows (subtracted)',
  scope_review: 'House − NEP on the pairs, signed; not booked as an adjustment',
};

function signedFull(v: number | null): string {
  if (v == null) return '—';
  if (v === 0) return '0';
  return `${v > 0 ? '+' : '−'}${fmt.php(Math.abs(v), { unit: 'full' })}`;
}
