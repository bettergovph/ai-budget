/**
 * `/hgab/2027` — what House Bill 10858 changed against the NEP, for the four
 * programs where the bill prints project-level detail.
 *
 * Everything on this page comes from one `overview.json`. Counts and money
 * stay separate per dataset on purpose: the four programs have different
 * record grains (a road segment, a facility, an irrigation project), so a
 * grand total across them would be a number without a meaning. The source
 * workbench follows the same rule.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip } from '../components/Nep2027Bits';
import {
  BridgeStrip, DisclaimerNotice, HgabError, HgabHeader, HgabHero, HgabLoading, HgabStageStrip,
  SignedPhp,
} from '../components/HgabBits';
import * as fmt from '../lib/format';
import { pageMeta } from '../lib/seo';
import {
  DATASET_ORDER, HGAB_ROOT, STAGE_LABELS, datasetPath, formatPct, loadHgabOverview, pctChange, pdfUrl,
  type HgabDatasetMeta, type HgabDocument, type HgabOverview as Overview,
} from '../lib/hgab';
import { formatBytes, ordinal } from '../lib/hgab-ui';
import '../nep2027.css';

export default function HgabOverview() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    document.title = pageMeta(HGAB_ROOT).title;
    loadHgabOverview().then(setOv).catch((e) => setErr(String(e?.message || e)));
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
            The House’s General Appropriations Bill is the second stage of the budget, after the
            President’s National Expenditure Program and before the Senate. This section sets House
            Bill 10858 beside the NEP project by project — insertions, deletions, increases and cuts,
            each traceable to a page of the printed documents — for the four programs where the bill
            prints that level of detail.
          </>
        }
        note={
          <>
            This is not the whole bill. HB 10858 covers every department; these four programs are the
            ones printed as named projects on both sides, so they are the only ones that can be compared
            row by row. Agency totals for everything else are in{' '}
            <Link to="/2027/browse" style={{ color: 'inherit' }}>the NEP browser</Link>.
          </>
        }
      />

      <main className="nep-main">
        <HgabStageStrip />

        {/* ---- one card per dataset ---- */}
        <section className="nep-section" aria-labelledby="hgab-datasets">
          <SectionHead
            eyebrow="Four programs, four record grains"
            headline={<span id="hgab-datasets">Compared project by project</span>}
            dek="Stage totals are the compared populations as printed; the five tiles under each are the bridge from the NEP figure to the House figure. Counts and pesos are not summed across programs — a road segment and a hospital ward are not the same unit."
          />
          <div className="hgab-cards">
            {datasets.map((d) => <DatasetCard key={d.key} d={d} />)}
          </div>
        </section>

        {/* ---- reconciliation ---- */}
        <section className="nep-section" aria-labelledby="hgab-recon">
          <SectionHead
            eyebrow="Two independent readings of the NEP"
            headline={<span id="hgab-recon">Checked against this portal’s NEP data</span>}
            dek="The workbench reads the NEP from the printed PDF volumes; this portal reads it from DBM’s CSV. Where the two disagree, the difference has a documented scope explanation — automatic appropriations the PDF tree leaves out, a planning line the annex excludes — or it is flagged as a mismatch."
          />
          <KpiStrip
            items={[
              { label: 'Exact', value: count('exact').toLocaleString(), sub: 'to the peso' },
              { label: 'Explained', value: count('explained').toLocaleString(), sub: 'scope difference documented' },
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
            Reconciled totals say the extraction got the controls right; they do not certify any single
            title, location or pairing. <Link to={`${HGAB_ROOT}/methodology#reconciliation`}>See every check and its note →</Link>
          </p>
        </section>

        {/* ---- documents ---- */}
        <section className="nep-section" aria-labelledby="hgab-docs">
          <SectionHead
            eyebrow="Documents"
            headline={<span id="hgab-docs">The printed sources</span>}
            dek="Every amount on these pages links back to a page in one of these PDFs. Checksums, sizes and downloads are on the Sources page."
            right={<Link className="hgab-cta hgab-cta-quiet" to={`${HGAB_ROOT}/sources`}>All sources & downloads →</Link>}
          />
          <div className="hgab-docs">
            <div>
              <h3>{STAGE_LABELS.nep.label}</h3>
              <DocList docs={nepDocs} />
            </div>
            <div>
              <h3>House Bill 10858</h3>
              <DocList docs={houseDocs} />
            </div>
          </div>
        </section>

        <DisclaimerNotice />

        <p className="nep-provenance">
          {built && `Built ${built.toLocaleString('en-PH')} · `}
          Figures carried verbatim from{' '}
          <a href={ov.source_repo} target="_blank" rel="noopener noreferrer">the extraction workbench</a>
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

function DatasetCard({ d }: { d: HgabDatasetMeta }) {
  const { totals, counts } = d;
  const identicalReadings =
    !d.has_readings && totals.hgab2_php != null && totals.hgab3_php != null && totals.hgab2_php === totals.hgab3_php;
  const stages: Array<{ key: 'nep' | 'hgab2' | 'hgab3'; php: number | null; rows: number | null }> = [
    { key: 'nep', php: totals.nep_php, rows: counts.nep },
    { key: 'hgab2', php: totals.hgab2_php, rows: counts.hgab2 },
    { key: 'hgab3', php: totals.hgab3_php, rows: counts.hgab3 },
  ];
  return (
    <article className="hgab-card" aria-labelledby={`hgab-card-${d.key}`}>
      <header>
        <p className="hgab-card-agency">{d.agency}</p>
        <h3 className="hgab-card-title" id={`hgab-card-${d.key}`}>
          <Link to={datasetPath(d.key)}>{d.label}</Link>
        </h3>
        <p className="hgab-card-grain">
          <strong>One row:</strong> {d.grain}
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
                  {s.rows == null ? 'no records' : `${s.rows.toLocaleString()} records`}
                </span>
                {s.key !== 'nep' && s.php != null && (
                  <span className="hgab-delta-line">
                    <SignedPhp value={delta} />{' '}
                    <span className="hgab-delta">{pct == null ? '' : `(${formatPct(pct)} vs NEP)`}</span>
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      {identicalReadings && (
        <p className="hgab-rows" style={{ marginTop: -6 }}>
          Annex pages are text-identical at second and third reading.
        </p>
      )}
      {d.printed && (d.printed.nep_new_appropriations_php != null || d.printed.house_new_appropriations_php != null) && (
        <p className="hgab-rows" style={{ marginTop: -6 }}>
          Printed agency controls — new appropriations: NEP{' '}
          {fmt.shortPhp(d.printed.nep_new_appropriations_php)} · House{' '}
          {fmt.shortPhp(d.printed.house_new_appropriations_php)}
        </p>
      )}

      <BridgeStrip bridge={d.bridge} dataset={d.key} />

      <p className="hgab-card-scope">{d.scope}</p>

      <footer className="hgab-card-ctas">
        <Link className="hgab-cta hgab-cta-primary" to={datasetPath(d.key)}>Open {d.short} →</Link>
        <Link className="hgab-cta" to={datasetPath(d.key, 'projects')}>Projects</Link>
        <Link className="hgab-cta" to={datasetPath(d.key, 'changes')}>Changes</Link>
        <Link className="hgab-cta hgab-cta-quiet" to={`/2027/d/${d.dept_id}`}>NEP group {d.dept_id} →</Link>
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

/** "I-C" → "Vol. I-C"; prose volumes ("Annex (NEP Volume I …)") print as they are. */
function volumeLabel(volume: string | null): string | null {
  if (!volume) return null;
  return /^[IVX]+(-[A-Z])?$/.test(volume) ? `Vol. ${volume}` : volume;
}

function sortHouseDocs(docs: HgabDocument[]): HgabDocument[] {
  return [...docs].sort((a, b) => (a.reading ?? 0) - (b.reading ?? 0) || (a.volume ?? '').localeCompare(b.volume ?? ''));
}
