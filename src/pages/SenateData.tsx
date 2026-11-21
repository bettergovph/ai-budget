/**
 * `/senate/2027/data`: the Senate committee report as a dataset to download and check (Jason, 2026-11-21: "we need
 * to have our dataset downloadable and verifiable"). Reads senate/2027/downloads/index.json (build_downloads.py):
 * every file with its size and SHA-256, the source PDFs with theirs, and every check the build ran against the
 * report's printed totals.
 */
import { useEffect, useState } from 'react';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { SenateError, SenateHeader, SenateHero, SenateLoading, SenateNotice, SenateReviewBanner } from '../components/SenateBits';
import { pageMeta } from '../lib/seo';
import { dataUrl } from '../lib/data-url';
import { SENATE_BASE, SENATE_DATA_ROOT, loadSenateDownloads, senatePdfUrl, type SenateDownloadFile, type SenateDownloads } from '../lib/senate';
import '../nep2027.css';
import '../hgab-explorer.css';

const REPO = 'https://github.com/bettergovph/ai-reports';
const TABLE_TITLE: Record<string, string> = {
  projects: 'Projects', 'annex-a': 'Annex A amendments', 'general-summary': 'General Summary', provisions: 'Provisions',
};

function size(bytes: number): string {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** Through the site's data address (budget-assets in production), as the pages read the data. */
const fileUrl = (f: SenateDownloadFile) => dataUrl(`${SENATE_BASE}/downloads/${f.file}`);

function FileLink({ f, label }: { f: SenateDownloadFile | undefined; label: string }) {
  if (!f) return null;
  return (
    <a className="senate-dl-file" href={fileUrl(f)} download>
      <span>{label}</span> <small>{size(f.bytes)}</small>
    </a>
  );
}

function Sha({ v }: { v: string }) {
  return <code className="senate-sha" title={v}>{v.slice(0, 16)}…</code>;
}

export default function SenateData() {
  const [d, setD] = useState<SenateDownloads | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    document.title = pageMeta(SENATE_DATA_ROOT).title;
    loadSenateDownloads().then(setD).catch((e) => setErr(String(e?.message || e)));
  }, []);
  if (err) return <SenateError message={err} />;
  if (!d) return <SenateLoading what="the Senate dataset" />;
  const file = (name: string) => d.files.find((f) => f.file === name);
  const zip = file('senate-2027-dataset.zip');
  const failed = d.check_rows.filter((c) => !c.ok);
  return (
    <>
      <SenateHeader crumb="Download data" />
      <SenateHero
        compact
        crumb="Download data"
        title="The Senate committee report as data"
        dek="Every project, Senate amendment, General Summary line and provision we read from the report, with the page that prints each one, checksums for every file, and the checks against the report's own totals."
      />
      <main className="nep-main hgab-ex-main senate-data">
        <SenateReviewBanner compact />

        <section className="nep-section">
          <SectionHead size="sm" eyebrow="Download" headline="The whole Senate dataset in one file" />
          <div className="senate-dl-main">
            {zip && (
              <a className="senate-dl-zip" href={fileUrl(zip)} download>
                Download the Senate dataset (ZIP, {size(zip.bytes)})
              </a>
            )}
            <p className="senate-dl-note">
              CSVs, the checks, the README (what every column means), the manifest and SHA256SUMS.txt.
              {zip && <> SHA-256 of the ZIP: <code className="senate-sha-full">{zip.sha256}</code></>}
            </p>
          </div>
          <div className="nep-table-wrap">
            <table className="nep-table senate-dl-table">
              <thead>
                <tr><th className="nep-th-name">Table</th><th className="num">Rows</th><th>Download</th><th>SHA-256 (CSV)</th></tr>
              </thead>
              <tbody>
                {d.tables.map((t) => {
                  const csv = file(`senate-2027-${t.name}.csv`);
                  return (
                    <tr key={t.name}>
                      <td className="nep-td-name"><strong>{TABLE_TITLE[t.name] ?? t.name}</strong><span className="senate-am-sub">{t.about}</span></td>
                      <td className="num">{t.rows.toLocaleString()}</td>
                      <td className="senate-dl-links">
                        <FileLink f={csv} label="CSV" />
                        <FileLink f={file(`senate-2027-${t.name}.parquet`)} label="Parquet" />
                      </td>
                      <td>{csv && <Sha v={csv.sha256} />}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="nep-td-name"><strong>Checks</strong><span className="senate-am-sub">Every check the build ran, below.</span></td>
                  <td className="num">{d.checks.run}</td>
                  <td className="senate-dl-links"><FileLink f={file('senate-2027-checks.csv')} label="CSV" /></td>
                  <td>{file('senate-2027-checks.csv') && <Sha v={file('senate-2027-checks.csv')!.sha256} />}</td>
                </tr>
                <tr>
                  <td className="nep-td-name"><strong>README, manifest and checksums</strong><span className="senate-am-sub">What each column means; every file's size and SHA-256.</span></td>
                  <td />
                  <td className="senate-dl-links">
                    <FileLink f={file('README.md')} label="README" />
                    <FileLink f={file('manifest.json')} label="manifest.json" />
                    <FileLink f={file('SHA256SUMS.txt')} label="SHA256SUMS.txt" />
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="nep-provenance">
            Built {d.built_at.replace('T', ' ').replace('Z', ' UTC')}
            {d.source_commit && <> from commit <a href={`${REPO}/commit/${d.source_commit}`} target="_blank" rel="noreferrer"><code>{d.source_commit.slice(0, 10)}</code></a></>}.
            {' '}Amounts are integer pesos. The NEP, the House bill and the Senate committee report are versions of one budget: compare them, never add them.
          </p>
        </section>

        <section className="nep-section">
          <SectionHead size="sm" eyebrow="Verify" headline="How to check the Senate data yourself" />
          <ol className="senate-verify">
            <li>
              <strong>The files are the ones we published.</strong> In the folder with the files, run
              {' '}<code>sha256sum -c --ignore-missing SHA256SUMS.txt</code> (macOS: <code>shasum -a 256 -c --ignore-missing SHA256SUMS.txt</code>).
              Every file you have should say OK.
            </li>
            <li>
              <strong>The source PDFs are the Senate's.</strong> Each one's SHA-256 is below. Compare it with a copy you get from the Senate.
            </li>
            <li>
              <strong>Every amount cites its page.</strong> Each row has <code>senate_pdf_url</code>, which opens the report at the page that prints it,
              and <code>house_pdf_url</code> (and <code>nep_pdf_url</code> for projects) for the House bill and the NEP.
            </li>
            <li>
              <strong>The totals add up.</strong> {d.checks.passed} of {d.checks.run} checks pass: each program's House bill and Senate totals against
              the totals the annexes print, the row arithmetic, the General Summary's own sums, and our line-by-line Senate amounts against the
              General Summary. The build stops if one fails.
            </li>
            <li>
              <strong>Rebuild it.</strong> The code is public: <code>npm run build:senate-cr</code> in <a href={REPO} target="_blank" rel="noreferrer">github.com/bettergovph/ai-reports</a>
              {' '}reproduces these files from the report's PDFs.
            </li>
          </ol>
        </section>

        <section className="nep-section">
          <SectionHead size="sm" eyebrow="Checks" headline={`${d.checks.passed} of ${d.checks.run} checks against the Senate committee report pass`} />
          {failed.length > 0 && <p className="nep-status-error">{failed.length} checks failed in this build; see the list.</p>}
          <div className="nep-table-wrap">
            <table className="nep-table senate-dl-table">
              <thead>
                <tr><th className="nep-th-name">Check</th><th className="num">Ours</th><th className="num">Should equal</th><th>Result</th></tr>
              </thead>
              <tbody>
                {d.check_rows.map((c) => (
                  <tr key={c.check}>
                    <td className="nep-td-name">{c.check}<span className="senate-am-sub">{c.source}{c.note ? ` · ${c.note}` : ''}</span></td>
                    <td className="num">{typeof c.ours === 'number' ? c.ours.toLocaleString() : <Sha v={String(c.ours)} />}</td>
                    <td className="num">{typeof c.printed === 'number' ? c.printed.toLocaleString() : <Sha v={String(c.printed)} />}</td>
                    <td>{c.ok ? <span className="senate-ok">✓ Matches</span> : <span className="senate-bad">✗ Differs by {c.difference?.toLocaleString() ?? '—'}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="nep-provenance">
            Projects are checked against each annex's printed total; Annex A's own rows aren't added up, because the report prints some amounts at more
            than one level (see the README).
          </p>
        </section>

        <section className="nep-section">
          <SectionHead size="sm" eyebrow="Sources" headline="The Senate committee report's PDFs, byte for byte" />
          <div className="nep-table-wrap">
            <table className="nep-table senate-dl-table">
              <thead>
                <tr><th className="nep-th-name">Document</th><th className="num">Size</th><th>SHA-256</th></tr>
              </thead>
              <tbody>
                {d.sources.map((s) => (
                  <tr key={s.key}>
                    <td className="nep-td-name"><a href={senatePdfUrl(s.key)} target="_blank" rel="noreferrer">{s.title}</a><span className="senate-am-sub">{s.original_file}</span></td>
                    <td className="num">{size(s.bytes)}</td>
                    <td><code className="senate-sha-full">{s.sha256}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <SenateNotice />
      </main>
      <SiteFooter />
    </>
  );
}
