/**
 * `/hgab/2027/sources` — the documents behind the comparison, the files a
 * reader can download, where they came from, and how to cite one figure.
 *
 * Every row on the dataset pages links to a PDF page; this page is where the
 * PDFs themselves are listed with their checksums, so a quoted figure can be
 * tied to an exact byte-identical copy of the source.
 *
 * Copy: every section opens with two plain sentences; the technical tables
 * (checksums, file formats, the pinned commit) follow, and the query example
 * and file-format notes sit in "Details for analysts".
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { DisclaimerNotice, HgabDetails, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import { pageMeta } from '../lib/seo';
import { dataUrl } from '../lib/data-url';
import {
  DATASET_ORDER, HGAB_BASE, HGAB_ROOT, HGAB_SOURCE_REPO, STAGE_LABELS, loadHgabOverview, pdfUrl,
  projectsParquetUrl, type HgabOverview,
} from '../lib/hgab';
import { DATASET_SHORT, formatBytes, ordinal } from '../lib/hgab-ui';
import '../nep2027.css';

const PATH = `${HGAB_ROOT}/sources`;

export default function HgabSources() {
  const [ov, setOv] = useState<HgabOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    document.title = pageMeta(PATH).title;
    loadHgabOverview().then(setOv).catch((e) => setErr(String(e?.message || e)));
  }, []);

  if (err) return <HgabError message={err} />;
  if (!ov) return <HgabLoading what="the FY2027 House bill sources" />;

  const docs = [...ov.documents].sort(
    (a, b) =>
      (a.stage === 'nep' ? 0 : 1) - (b.stage === 'nep' ? 0 : 1)
      || (a.reading ?? 0) - (b.reading ?? 0)
      || (a.volume ?? '').localeCompare(b.volume ?? ''),
  );
  const byKey = new Map(ov.datasets.map((d) => [d.key, d]));
  const repo = ov.source_repo || HGAB_SOURCE_REPO;
  const commit = ov.source_commit ?? '';
  const built = ov.built_at ? new Date(ov.built_at) : null;
  const example = docs.find((d) => d.stage === 'house') ?? docs[0];

  return (
    <>
      <HgabHeader crumb="Sources" />
      <HgabHero
        compact
        crumb="Sources"
        title="Documents, downloads and where the figures come from"
        dek="These are the printed documents every figure was read from, and the files you can download. Each document has a fingerprint, so anyone can check they hold the same copy. The last section shows how to quote a figure."
      />

      <main className="nep-main">
        {/* ---- documents ---- */}
        <section className="nep-section" aria-labelledby="hgab-src-docs">
          <SectionHead
            eyebrow="Source documents"
            headline={<span id="hgab-src-docs">The {docs.length.toLocaleString()} printed documents</span>}
            dek="The President’s proposal (NEP) and the House bill (HB 10858) are printed in several volumes. Each link opens the PDF we read; the fingerprint proves which exact copy it was."
          />
          <div className="nep-table-wrap">
            <table className="nep-table hgab-src-table">
              <thead>
                <tr>
                  <th className="nep-th-name">Document</th>
                  <th>Version</th>
                  <th>Reading</th>
                  <th>Volume</th>
                  <th className="num" title="PDF file pages this section uses">Pages used</th>
                  <th className="num">Size</th>
                  <th title="SHA-256 checksum of the file as retained">Fingerprint</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.key}>
                    <td className="nep-td-name">
                      {d.title}
                      <span className="nep-code">{d.key}</span>
                      {d.notes && <span className="nep-td-dim" style={{ display: 'block', maxWidth: 420, whiteSpace: 'normal' }}>{d.notes}</span>}
                    </td>
                    <td>
                      <span className="pill nep-pill" style={{ marginLeft: 0 }}>
                        {d.stage === 'nep' ? STAGE_LABELS.nep.short : 'House'}
                      </span>
                    </td>
                    <td>{d.reading ? `${ordinal(d.reading)} reading` : '—'}</td>
                    <td>{d.volume ?? '—'}</td>
                    <td className="num">{d.pages ? `${d.pages.from.toLocaleString()}–${d.pages.to.toLocaleString()}` : '—'}</td>
                    <td className="num">{formatBytes(d.bytes)}</td>
                    <td><Sha value={d.sha256} /></td>
                    <td>
                      <a className="hgab-doc-open" href={pdfUrl(d.key)} target="_blank" rel="noopener noreferrer">Open PDF ↗</a>
                      {d.source_url && (
                        <>
                          {' '}
                          <a className="hgab-doc-open" href={d.source_url} target="_blank" rel="noopener noreferrer" title="Where the original was published">Original ↗</a>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <HgabDetails>
            <p>
              Pages are one-based PDF file pages, not the printed page labels; they are not
              interchangeable across readings or volumes. The fingerprint is the SHA-256 of the file as
              retained. The small code under each title is the document key used in the data files.
            </p>
          </HgabDetails>
        </section>

        {/* ---- downloads ---- */}
        <section className="nep-section" aria-labelledby="hgab-src-dl">
          <SectionHead
            eyebrow="Downloads"
            headline={<span id="hgab-src-dl">The {(2 + DATASET_ORDER.length * 2).toLocaleString()} files this section reads</span>}
            dek="Every figure on these pages comes from these files, so you can check or reuse them. Amounts are in whole pesos; an empty value means that document has no such line, not zero."
          />
          <div className="hgab-downloads">
            <div className="hgab-dl-group">
              <h3>Whole section</h3>
              <p className="hgab-dl-sub">programs · how the versions differ · documents · checks</p>
              <ul>
                <li><a href={dataUrl(`${HGAB_BASE}/overview.json`)}>overview.json</a><span className="hgab-dl-kind">JSON</span></li>
                <li><a href={dataUrl(`${HGAB_BASE}/manifest.json`)}>manifest.json</a><span className="hgab-dl-kind">JSON</span></li>
              </ul>
            </div>
            {DATASET_ORDER.map((k) => {
              const d = byKey.get(k);
              return (
                <div className="hgab-dl-group" key={k}>
                  <h3>{d?.label ?? DATASET_SHORT[k]}</h3>
                  <p className="hgab-dl-sub">
                    {d ? `${d.counts.nep.toLocaleString()} lines in the proposal · ${(d.counts.hgab3 ?? d.counts.hgab2 ?? 0).toLocaleString()} in the House bill` : k}
                  </p>
                  <ul>
                    <li><a href={dataUrl(`${HGAB_BASE}/${k}/summary.json`)}>{k}/summary.json</a><span className="hgab-dl-kind">Summary</span></li>
                    <li><a href={dataUrl(`${HGAB_BASE}/${k}/projects.parquet`)}>{`${k}/projects.parquet`}</a><span className="hgab-dl-kind">Every line</span></li>
                  </ul>
                </div>
              );
            })}
          </div>
          <p className="hgab-recon-note" style={{ marginTop: 14 }}>
            Not sure how to open them? Each program’s Projects tab shows the same lines, and its
            “Download CSV” button saves the rows you filtered as a spreadsheet.
          </p>
          <HgabDetails>
            <p>
              Summaries are JSON. The project tables are Parquet: open them with DuckDB, pandas or polars,
              or query them in place from the URL. Amounts are integer pesos; null means the version has
              no record, never zero.
            </p>
            <p><strong>Query a project table without downloading it.</strong> DuckDB reads Parquet over HTTP with range requests; this is the same file the program pages query in the browser.</p>
            <pre>{`SELECT title, region, trace, nep_php, hgab3_php, delta_php, hgab3_doc, hgab3_page
FROM read_parquet('${projectsParquetUrl('dpwh')}')
WHERE trace = 'candidate_increase'
ORDER BY delta_php DESC
LIMIT 25;`}</pre>
          </HgabDetails>
        </section>

        {/* ---- provenance ---- */}
        <section className="nep-section" aria-labelledby="hgab-src-prov">
          <SectionHead
            eyebrow="Provenance"
            headline={<span id="hgab-src-prov">Where the figures come from</span>}
            dek="The figures come from an independent analysis of the printed documents, published as open source. This portal copies them unchanged and does not redo the matching."
          />
          <table className="nep-table nep-kv">
            <tbody>
              <tr>
                <th>Pipeline</th>
                <td>
                  <a href={repo} target="_blank" rel="noopener noreferrer">{repo.replace(/^https?:\/\//, '')} ↗</a>
                  {' '}— the extraction and matching workbench. Every status, pairing and amount here is carried from its builders; this portal does not re-derive matches.
                </td>
              </tr>
              <tr>
                <th>Pinned commit</th>
                <td>
                  {commit ? (
                    <a href={`${repo}/commit/${commit}`} target="_blank" rel="noopener noreferrer"><code>{commit}</code> ↗</a>
                  ) : '—'}
                </td>
              </tr>
              <tr>
                <th>Built</th>
                <td>{built ? `${built.toLocaleString('en-PH')} (${ov.built_at})` : '—'}</td>
              </tr>
              <tr>
                <th>Fiscal year</th>
                <td>FY{ov.fiscal_year}</td>
              </tr>
              <tr>
                <th>Rebuild</th>
                <td><code>npm run import:hgab</code> in this portal’s repository, then <code>npm run upload:hgab</code> to publish.</td>
              </tr>
              <tr>
                <th>Units</th>
                <td>Integer pesos throughout. Versions are compared, never added; a printed total and the lines under it are never added together.</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* ---- how to cite ---- */}
        <section className="nep-section" aria-labelledby="hgab-src-cite">
          <SectionHead
            eyebrow="How to cite"
            headline={<span id="hgab-src-cite">Five things a quoted figure needs</span>}
            dek="Quote a figure with these five details so anyone can find it again. A screenshot or a link alone loses them, and the figures can change when errors are fixed."
          />
          <div className="hgab-cite">
            <ol>
              <li><strong>Dataset file</strong> — e.g. <code>hgab/2027/dpwh/projects.parquet</code> or <code>hgab/2027/overview.json</code>.</li>
              <li><strong>Record id</strong> — the <code>id</code> column, also the last segment of a record page URL.</li>
              <li><strong>Pipeline commit</strong> — <code>{commit ? commit.slice(0, 12) : '<source_commit>'}</code>, from <code>overview.json</code>.</li>
              <li><strong>Source document</strong> — the document key, its reading and volume{example ? <> (e.g. <code>{example.key}</code>)</> : null}.</li>
              <li><strong>PDF page</strong> — one-based file page, as shown on the record page; include the printed page label separately if you have it.</li>
            </ol>
            <pre>{`BetterGov Budget, FY2027 House bill vs NEP. Dataset hgab/2027/<dataset>/projects.parquet, record <id>; pipeline ${repo} @ ${commit ? commit.slice(0, 12) : '<commit>'}; source <doc key> (<reading>, <volume>), PDF p. <page>; accessed <date>. Independent and unofficial; matching is provisional.`}</pre>
          </div>
          <p className="hgab-recon-note" style={{ marginTop: 14 }}>
            Suspected errors go to the pipeline’s{' '}
            <a href={`${repo}/issues`} target="_blank" rel="noopener noreferrer">issue tracker ↗</a> with the record, version, source reference and proposed correction.
            The full disclaimer is on the <Link to={`${HGAB_ROOT}/methodology#disclaimer`}>Methodology page</Link>.
          </p>
        </section>

        <DisclaimerNotice compact />
      </main>
      <SiteFooter source="SOURCE: HOUSE BILL 10858 (2ND & 3RD READING) · DBM NEP FY 2027 · 4 PROGRAMS" />
    </>
  );
}

/** Truncated checksum with a copy button; the full hash is in the title and copied. */
function Sha({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  if (!value) return <span className="hgab-sha">—</span>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      window.setTimeout(() => setDone(false), 1600);
    } catch {
      /* clipboard unavailable (insecure context); the title still carries the hash */
    }
  };
  return (
    <span className="hgab-sha" title={value}>
      <span>{value.slice(0, 12)}…</span>
      <button type="button" className={`hgab-copy ${done ? 'is-done' : ''}`.trim()} onClick={copy} aria-label="Copy full SHA-256">
        {done ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}
