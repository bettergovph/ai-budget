/**
 * `/hgab/2027/explorer` — "Line by line": every department of the House bill against the NEP,
 * with how many of its lines differ. Each row opens the department's line-by-line page.
 *
 * One small JSON (`explorer/index.json`); the department files load on their own pages.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { DisclaimerNotice, HgabDetails, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import { KpiStrip } from '../components/Nep2027Bits';
import { ExStatusChip, ExChange, UnderReviewBanner } from '../components/HgabExplorerBits';
import * as fmt from '../lib/format';
import { pageMeta } from '../lib/seo';
import { HGAB_ROOT, pdfUrl } from '../lib/hgab';
import {
  EXPLORER_ROOT, STATUS_LABEL, downloadUrl, explorerPath, fileSize, fullPhp, loadExplorerDownloads, loadExplorerIndex, titleCase,
  type DownloadsManifest, type ExIndex, type ExIndexRow, type LineStatus,
} from '../lib/hgab-explorer';
import '../nep2027.css';
import '../hgab-explorer.css';

type Sort = 'name' | 'nep' | 'house' | 'delta' | 'changed';

export default function HgabExplorer() {
  const [idx, setIdx] = useState<ExIndex | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [sort, setSort] = useState<Sort>('nep');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    document.title = pageMeta(EXPLORER_ROOT).title;
    loadExplorerIndex().then(setIdx).catch((e) => setErr(String(e?.message || e)));
  }, []);

  const rows = useMemo(() => {
    if (!idx) return [];
    const needle = q.trim().toLowerCase();
    let r = idx.departments;
    if (needle) r = r.filter((d) => d.name.toLowerCase().includes(needle));
    if (changedOnly) r = r.filter((d) => d.changed > 0);
    // "name" keeps the bill's own order (Congress first, the special purpose funds last)
    if (sort === 'name') return [...r];
    const val = (d: ExIndexRow): number =>
      sort === 'house' ? d.house : sort === 'delta' ? d.house - d.nep : sort === 'changed' ? d.changed : d.nep;
    const m = dir === 'asc' ? 1 : -1;
    return [...r].sort((a, b) => (val(a) - val(b)) * m);
  }, [idx, q, changedOnly, sort, dir]);

  if (err) return <HgabError message={err} />;
  if (!idx) return <HgabLoading what="the House bill explorer" />;

  const st = idx.status;
  const programmed = idx.house_total - idx.unprogrammed;
  const changedLines = idx.lines - (st.same ?? 0);
  const sameShare = (st.same ?? 0) / idx.lines;

  function head(key: Sort, text: string, cls = '') {
    const active = sort === key;
    return (
      <th className={`${cls} ${active ? 'nep-th-active' : ''}`.trim()}>
        <button
          type="button"
          onClick={() => {
            if (active && key !== 'name') setDir(dir === 'asc' ? 'desc' : 'asc');
            else { setSort(key); setDir('desc'); }
          }}
        >
          {text}
          <span className="nep-sort-caret">{active && key !== 'name' ? (dir === 'asc' ? '▲' : '▼') : ''}</span>
        </button>
      </th>
    );
  }

  return (
    <>
      <HgabHeader crumb="Line by line" />
      <HgabHero
        compact
        crumb="Line by line"
        title={`${idx.lines.toLocaleString()} House bill lines beside the NEP`}
        dek={
          <>
            Every amount in the House bill's appropriation tables, by agency, program, region and office,
            next to the NEP line it matches. {fmt.pct(sameShare, 1)} of lines carry the same amount in both.
          </>
        }
      />
      <main className="nep-main hgab-ex-main">
        <UnderReviewBanner />
        <KpiStrip
          items={[
            { label: 'House bill, programmed', value: fmt.shortPhp(programmed, 'T'), sub: `plus ${fmt.shortPhp(idx.unprogrammed, 'B')} unprogrammed` },
            { label: 'NEP', value: fmt.shortPhp(idx.nep_total, 'T'), sub: programmed === idx.nep_total ? 'the same total, to the peso' : `${fmt.shortPhp(programmed - idx.nep_total)} apart` },
            { label: 'Lines that differ', value: changedLines.toLocaleString(), sub: `of ${idx.lines.toLocaleString()} lines` },
            {
              label: 'Higher · lower',
              value: `${(st.higher ?? 0).toLocaleString()} · ${(st.lower ?? 0).toLocaleString()}`,
              sub: `${(st.house_only ?? 0).toLocaleString()} House bill only · ${(st.nep_only ?? 0).toLocaleString()} NEP only`,
            },
          ]}
        />

        <section className="nep-section">
          <SectionHead
            eyebrow="By department"
            headline={`${idx.departments.length} departments and funds`}
            dek="Open one to see its agencies, programs, regions and offices, line by line, with the page each House bill line is published on."
            right={
              <label className="nep-toggle">
                <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} />
                Only those with changes
              </label>
            }
          />
          <div className="nep-table-toolbar">
            <input
              className="text-input nep-filter"
              type="search"
              placeholder="Filter departments…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Filter departments"
            />
            <span className="nep-table-count">{rows.length} of {idx.departments.length}</span>
          </div>
          <div className="nep-table-wrap">
            <table className="nep-table hgab-ex-dept-table">
              <thead>
                <tr>
                  {head('name', 'Department or fund', 'nep-th-name')}
                  {head('nep', 'NEP', 'num')}
                  {head('house', 'House bill', 'num')}
                  {head('delta', 'Change', 'num')}
                  {head('changed', 'Lines that differ', 'num')}
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="nep-td-name">
                      <Link to={explorerPath(d.id)}>{titleCase(d.name)}</Link>
                      {d.agencies > 1 && <span className="hgab-ex-sub">{d.agencies} agencies</span>}
                    </td>
                    <td className="num nep-td-base" title={fullPhp(d.nep)}>{d.nep ? fmt.shortPhp(d.nep) : '—'}</td>
                    <td className="num nep-td-amt" title={fullPhp(d.house)}>{fmt.shortPhp(d.house)}</td>
                    <td className="num">
                      {d.name === 'UNPROGRAMMED APPROPRIATIONS'
                        ? <ExStatusChip status="unprogrammed" />
                        : <ExChange nep={d.nep} house={d.house} />}
                    </td>
                    <td className="num">
                      {d.changed ? `${d.changed.toLocaleString()} of ${d.lines.toLocaleString()}` : <span className="hgab-ex-none">none of {d.lines.toLocaleString()}</span>}
                    </td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={5} className="nep-empty">No department matches that filter.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <ExplorerDownloads />

        <section className="nep-section hgab-ex-legend" aria-label="What the labels mean">
          <SectionHead eyebrow="Labels" headline="What each line's label means" />
          <dl className="hgab-ex-legend-list">
            {(['same', 'higher', 'lower', 'house_only', 'nep_only', 'unprogrammed'] as LineStatus[]).map((s) => (
              <div key={s}>
                <dt><ExStatusChip status={s} /></dt>
                <dd>{STATUS_LABEL[s].help}</dd>
              </div>
            ))}
          </dl>
        </section>

        <HgabDetails>
          <p>
            The House bill's appropriation tables (Vol. I-A and I-B, third reading) were read from the
            published PDFs: every agency's table by programs, activities and projects, and the special
            purpose funds' tables by purpose. Each agency's lines add up to its published total, and the
            bill's total, ₱{idx.house_total.toLocaleString()}, matches its own summary of new appropriations.
          </p>
          <p>
            NEP amounts are the NEP's new appropriations at the same level of detail: activity, region,
            operating unit and expense class. Without unprogrammed appropriations the House bill and the
            NEP total the same, ₱{idx.nep_total.toLocaleString()}. Lines are matched by name within each
            agency; DepEd's schools come from the bill's list of non-implementing schools (Vol. I-B).
            DPWH's project list (Vol. I-C) is on the <Link to={`${HGAB_ROOT}/dpwh`}>DPWH pages</Link>.
          </p>
          <p>
            Every line links the page that prints it in both documents. NEP pages were found by matching each
            NEP line's activity code, office and amount to the NEP's pages. A DepEd school with no budget of
            its own links its division office's line, which holds it. A line only in the House bill links the
            NEP's table for its activity, which does not have it.
          </p>
          <p>
            Sources: <a href={pdfUrl('hb10858-3r-vol-ia')}>House bill Vol. I-A</a> ·{' '}
            <a href={pdfUrl('hb10858-3r-vol-ib')}>Vol. I-B</a> · NEP{' '}
            <a href={pdfUrl('nep2027-vol-i')}>Vol. I</a> · <a href={pdfUrl('nep2027-vol-iia')}>Vol. II-A</a> ·{' '}
            <a href={pdfUrl('nep2027-vol-iib')}>Vol. II-B</a> · <a href={pdfUrl('nep2027-vol-iii')}>Vol. III</a> ·
            built {idx.built_at.slice(0, 10)}.
          </p>
        </HgabDetails>

        <DisclaimerNotice />
      </main>
      <SiteFooter />
    </>
  );
}

/**
 * "Download the data": the extracted dataset behind this page, as published files (CSV for
 * spreadsheets, Parquet for analysts, one zip with every CSV and the column guide). Read from
 * downloads/manifest.json, so sizes and row counts are the files' own.
 */
function ExplorerDownloads() {
  const [m, setM] = useState<DownloadsManifest | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    loadExplorerDownloads().then(setM).catch(() => setErr(true));
  }, []);
  if (err) return null;
  return (
    <section className="nep-section hgab-ex-downloads" id="downloads" aria-labelledby="hgab-ex-dl-h">
      <SectionHead
        eyebrow="Download the data"
        headline={<span id="hgab-ex-dl-h">Every line, as files you can reuse</span>}
        dek="The lines on these pages, extracted from the House bill and matched to the NEP. CSV opens in any spreadsheet; Parquet is for analysts."
      />
      <UnderReviewBanner compact />
      {!m ? <p className="hgab-ex-none">Loading the list of files…</p> : (
        <>
          <p className="hgab-ex-dl-all">
            <a className="hgab-ex-dl-zip" href={downloadUrl(m.zip)} download>
              Download everything <span>({fileSize(m.zip.bytes)} zip: {m.files.length} CSV files and a column guide)</span>
            </a>
            <a href={downloadUrl(m.readme)}>What every column means</a>
          </p>
          <div className="nep-table-wrap">
            <table className="nep-table hgab-ex-dl-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th className="num">Rows</th>
                  <th>CSV</th>
                  <th>Parquet</th>
                </tr>
              </thead>
              <tbody>
                {m.files.map((f) => (
                  <tr key={f.key}>
                    <td>
                      <strong>{f.title}</strong>
                      <span className="hgab-ex-dl-about">{f.about}</span>
                    </td>
                    <td className="num">{f.rows.toLocaleString()}</td>
                    <td className="hgab-ex-dl-link">
                      <a href={downloadUrl(f.csv)} download title={`SHA-256 ${f.csv.sha256}`}>{f.csv.file}</a>
                      <small>{fileSize(f.csv.bytes)}</small>
                    </td>
                    <td className="hgab-ex-dl-link">
                      {f.parquet ? (
                        <>
                          <a href={downloadUrl(f.parquet)} download title={`SHA-256 ${f.parquet.sha256}`}>{f.parquet.file}</a>
                          <small>{fileSize(f.parquet.bytes)}</small>
                        </>
                      ) : <span className="hgab-ex-none">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="nep-provenance">
            Integer pesos, as published; an empty amount means the document has no such line. {m.notice} Built{' '}
            {m.built_at.slice(0, 10)}{m.pipeline_commit ? ` from pipeline commit ${m.pipeline_commit}` : ''}. Hover a file name for its SHA-256.
          </p>
        </>
      )}
    </section>
  );
}
