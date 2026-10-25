/**
 * `/hgab/2027/overview` — what House Bill 10858 changed against the NEP, for
 * the four programs where the bill prints project-level detail. The dashboard
 * view; the story version is `/hgab/2027/intro`.
 *
 * Everything on this page comes from one `overview.json`. Counts and money
 * stay separate per dataset on purpose: the four programs have different
 * record grains (a road segment, a facility, an irrigation project), so a
 * grand total across them would be a number without a meaning. The source
 * workbench follows the same rule.
 *
 * Copy: plain first. Cards show the dataset's reader-facing `summary`,
 * `one_row` and `caveats`; the technical `grain` and `scope` sit inside a
 * "Details for analysts" block on each card.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip } from '../components/Nep2027Bits';
import {
  BridgeStrip, Caveats, DisclaimerNotice, HgabDetails, HgabError, HgabHeader, HgabHero, HgabLoading,
  HgabStageStrip, SignedPhp,
} from '../components/HgabBits';
import * as fmt from '../lib/format';
import { pageMeta } from '../lib/seo';
import {
  DATASET_ORDER, HGAB_ROOT, STAGE_LABELS, datasetPath, districtPath, formatPct, loadHgabDistricts, loadHgabOverview,
  pctChange, pdfUrl,
  type HgabDatasetMeta, type HgabDistrictIndex, type HgabDocument, type HgabOverview as Overview,
} from '../lib/hgab';
import { headlineResidual, residualShare, residualUnattributed, slotLabel } from '../lib/hgab-districts';
import { DATASET_SHORT, datasetCaveats, datasetOneRow, datasetSummary, formatBytes, ordinal } from '../lib/hgab-ui';
import '../nep2027.css';
import '../hgab-districts.css';

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

      <HgabHero
        crumb="Overview"
        title="What the House changed in the 2027 budget"
        dek={
          <>
            Every year the President sends Congress a proposed budget, the National Expenditure
            Program (NEP). The House of Representatives then passes its own version, House Bill 10858.
            This section sets the two side by side, project by project. It shows what the House added,
            dropped, raised or cut, each traceable to a page of the printed documents.
          </>
        }
        note={
          <>
            This is not the whole bill. The bill covers every department. Only four programs list
            named projects in both documents, so only those four can be compared line by line.
            Totals for everything else are in{' '}
            <Link to="/2027/browse" style={{ color: 'inherit' }}>the NEP browser</Link>.
          </>
        }
      />

      <main className="nep-main">
        <p className="hgab-recon-note" style={{ marginBottom: 24 }}>
          This is the dashboard. For a short, guided version,{' '}
          <Link to={`${HGAB_ROOT}/intro`}>start with the introduction</Link>.
        </p>
        <HgabStageStrip />

        {/* ---- one card per dataset ---- */}
        <section className="nep-section" aria-labelledby="hgab-datasets">
          <SectionHead
            eyebrow="Four programs, four kinds of row"
            headline={<span id="hgab-datasets">{datasets.length === 4 ? 'Four' : datasets.length} programs compared project by project</span>}
            dek="Each card shows the amount in the President’s proposal and in the House bill, then how the two differ. The four programs are not added together: a road segment and a hospital ward are not the same unit."
          />
          <div className="hgab-cards">
            {datasets.map((d, i) => <DatasetCard key={d.key} d={d} explain={i === 0} />)}
          </div>
          <DistrictsCallout index={districts} />
        </section>

        {/* ---- reconciliation ---- */}
        <section className="nep-section" aria-labelledby="hgab-recon">
          <SectionHead
            eyebrow="Two readings of the President’s proposal"
            headline={<span id="hgab-recon">{recon.length.toLocaleString()} checks against this portal’s own copy of the proposal</span>}
            dek="The analysis read the proposal from the printed PDF volumes. This portal reads it from the budget department’s spreadsheet. Where the two disagree, the difference has a written explanation, or it is flagged."
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
            headline={<span id="hgab-docs">The printed sources</span>}
            dek="Every amount on these pages links back to a page in one of these PDFs. File fingerprints, sizes and downloads are on the Sources page."
            right={<Link className="hgab-cta hgab-cta-quiet" to={`${HGAB_ROOT}/sources`}>All sources & downloads →</Link>}
          />
          <div className="hgab-docs">
            <div>
              <h3>{STAGE_LABELS.nep.label}</h3>
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
        <h3 id="hgab-districts-callout">District engineering offices and the districts they serve</h3>
        <p>
          One card per congressional district. Each card names the district’s representative in the
          20th Congress. It lists the DPWH district engineering office, or offices, that serve it. It
          shows that office’s budget by Congress and by year, from the enacted budgets (GAA) of 2020 to
          2026. It then sets the 2027 House bill against the President’s proposal for the office’s
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
        <p className="hgab-card-grain">
          <strong>What one row is:</strong> {datasetOneRow(d)}
        </p>
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
          Totals printed for the whole {d.key === 'dpwh' ? 'agency' : 'program'} — {STAGE_LABELS.nep.short}{' '}
          {fmt.shortPhp(d.printed.nep_new_appropriations_php)} · House{' '}
          {fmt.shortPhp(d.printed.house_new_appropriations_php)}
        </p>
      )}

      <BridgeStrip bridge={d.bridge} dataset={d.key} explain={explain} />

      <Caveats items={caveats} />

      <HgabDetails>
        <dl>
          <dt>One row</dt>
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
