/**
 * `/senate/2027/:program/p/:id`: one project in the Senate committee report. Its House bill name and the
 * report's (when it renames it), NEP, House bill and committee report amounts, the report's page for it, and
 * the House bill project page with its documents. A Senate insertion that revises a project it cuts links that
 * project.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { KpiStrip } from '../components/Nep2027Bits';
import {
  SenateError, SenateHeader, SenateHero, SenateLoading, SenateNotice, SenateReviewBanner, SenateStatusChip,
} from '../components/SenateBits';
import { runQuery } from '../lib/duckdb';
import * as fmt from '../lib/format';
import { pdfUrl, recordPath } from '../lib/hgab';
import { sqlStr } from '../lib/hgab-query';
import {
  PROGRAM_SHORT, SENATE_STATUS, coerceSenateProject as coerce, programKey, senatePdfUrl, senateProgramPath, senateProjectsUrl, senateRecordPath, type SenateProject,
} from '../lib/senate';
import '../nep2027.css';
import '../hgab-explorer.css';

export default function SenateRecord() {
  const { dataset, id = '' } = useParams();
  const key = programKey(dataset);
  const [st, setSt] = useState<{ id: string; row: SenateProject | null; replaced: SenateProject | null; err: string | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    const src = `read_parquet(${sqlStr(senateProjectsUrl(key))})`;
    runQuery<Record<string, unknown>>(`SELECT * EXCLUDE (search_text) FROM ${src} WHERE id = ${sqlStr(id)} OR house_id = ${sqlStr(id)} LIMIT 1`)
      .then(async (r) => {
        const row = r.rows[0] ? coerce(r.rows[0]) : null;
        let replaced: SenateProject | null = null;
        if (row?.replaces_id) {
          const x = await runQuery<Record<string, unknown>>(`SELECT * EXCLUDE (search_text) FROM ${src} WHERE house_id = ${sqlStr(row.replaces_id)} LIMIT 1`);
          replaced = x.rows[0] ? coerce(x.rows[0]) : null;
        }
        if (live) setSt({ id, row, replaced, err: row ? null : 'No such project in the Senate committee report data.' });
      })
      .catch((e) => { if (live) setSt({ id, row: null, replaced: null, err: String(e?.message || e) }); });
    return () => { live = false; };
  }, [key, id]);
  useEffect(() => {
    if (st?.row) document.title = `${st.row.title.slice(0, 80)}: Senate committee report · budget.bettergov.ph`;
  }, [st?.row]);
  if (!key) return <SenateError message="No such program." />;
  const cur = st?.id === id ? st : null;
  if (cur?.err) return <SenateError message={cur.err} />;
  if (!cur?.row) return <SenateLoading what="this project" />;
  const r = cur.row;
  const crumb = (
    <>
      <Link to={senateProgramPath(key, 'projects')}>{PROGRAM_SHORT[key]}</Link>
      <span className="hgab-crumb-sep" aria-hidden="true">·</span>
      <span className="hgab-crumb-here">Project</span>
    </>
  );
  return (
    <>
      <SenateHeader crumb={crumb} />
      <SenateHero compact crumb={crumb} title={r.title} dek={<><SenateStatusChip status={r.status} /> {SENATE_STATUS[r.status].help}</>} />
      <main className="nep-main hgab-ex-main">
        <SenateReviewBanner compact />
        <KpiStrip
          items={[
            { label: 'NEP', value: r.nep_php != null ? fmt.shortPhp(r.nep_php) : '—', sub: r.nep_php != null ? `₱${r.nep_php.toLocaleString()}` : 'not in the NEP' },
            { label: 'House bill', value: r.house_php != null ? fmt.shortPhp(r.house_php) : '—', sub: r.house_php != null ? `₱${r.house_php.toLocaleString()}` : 'not in the House bill' },
            { label: 'Senate', value: fmt.shortPhp(r.senate_php), sub: `₱${r.senate_php.toLocaleString()}` },
            { label: 'Change', value: `${r.change_php >= 0 ? '+' : '−'}${fmt.shortPhp(Math.abs(r.change_php))}`, tone: r.change_php < 0 ? 'down' : r.change_php > 0 ? 'up' : undefined, sub: 'Senate minus the House bill' },
          ]}
        />
        <div className="senate-record-names">
          {r.hb_title && <div><strong>House bill</strong>{r.hb_title}</div>}
          <div className="is-senate"><strong>Senate committee report</strong>{r.title}{r.hb_title && !r.renamed ? ' (same name)' : ''}</div>
        </div>
        <dl className="hgab-facts">
          {r.region && <><dt>Region</dt><dd>{r.region}</dd></>}
          {r.office && <><dt>{key === 'hfep' ? 'Province' : 'Office'}</dt><dd>{r.office}</dd></>}
          {r.program && <><dt>{key === 'hfep' ? 'Category' : 'Program'}</dt><dd>{r.program}</dd></>}
          {r.pap && <><dt>{key === 'hfep' ? 'Kind of budget' : 'Program line'}</dt><dd>{r.pap}</dd></>}
        </dl>
        <p className="senate-refs">
          {r.senate_page && (
            <a href={senatePdfUrl(r.senate_doc, r.senate_page)} target="_blank" rel="noreferrer">The Senate committee report, page {r.senate_page} →</a>
          )}
          {r.house_doc && r.house_page && (
            <a href={pdfUrl(r.house_doc, r.house_page)} target="_blank" rel="noreferrer">The House bill page →</a>
          )}
          {r.house_id && <Link to={recordPath(key, r.house_id)}>This project in the House bill, with its documents →</Link>}
        </p>
        {cur.replaced && (
          <p className="hgab-ex-gap">
            The Senate adds this project in place of one it cuts, which reads almost the same:{' '}
            <Link to={senateRecordPath(key, cur.replaced.id)}>{cur.replaced.title}</Link> ({fmt.shortPhp(cur.replaced.house_php ?? 0)} in the House bill).
          </p>
        )}
        <SenateNotice />
      </main>
      <SiteFooter />
    </>
  );
}
