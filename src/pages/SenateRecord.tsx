/**
 * `/senate/2027/:program/p/:id`: one project in the Senate committee report. Its House bill name and the
 * report's (when it renames it), NEP, House bill and committee report amounts, the report's page for it, and
 * the House bill project page with its documents. A Senate insertion that revises a project it cuts links that
 * project.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import {
  SenateError, SenateHeader, SenateLoading, SenateNotice, SenateReviewBanner, SenateStatusChip,
} from '../components/SenateBits';
import { runQuery } from '../lib/duckdb';
import * as fmt from '../lib/format';
import { pdfUrl, recordPath } from '../lib/hgab';
import { PROGRAM_NAV } from '../lib/hgab-ui';
import { REVIEW_ROOT } from '../lib/hgab-review';
import { sqlStr } from '../lib/hgab-query';
import {
  SENATE_ROOT, SENATE_STATUS, coerceSenateProject as coerce, programKey, senatePdfUrl, senateProgramPath, senateProjectsUrl, senateRecordPath, type SenateProject,
} from '../lib/senate';
import '../nep2027.css';
import '../hgab-explorer.css';
import '../hgab-dataset.css';

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
  const delta = r.house_php != null ? r.senate_php - r.house_php : null;
  const vsNep = r.nep_php != null ? r.senate_php - r.nep_php : null;
  const pct = (v: number | null, base: number | null) => (v && base ? ` · ${v / base > 0 ? '+' : '−'}${Math.abs((v / base) * 100).toFixed(1)}%` : '');
  const signed = (v: number) => (v === 0 ? '0' : `${v > 0 ? '+' : '−'}${fmt.shortPhp(Math.abs(v))}`);
  // One card per document, as the House bill project page (HgabRecord's stage cards): its amount, the name it gives, its page.
  const cards: Array<{ stage: string; label: string; sub: string; amount: number | null; name: string | null; href: string | null; page: number | null }> = [
    { stage: 'nep', label: 'NEP', sub: 'National Expenditure Program', amount: r.nep_php, name: null,
      href: r.nep_doc && r.nep_page ? pdfUrl(r.nep_doc, r.nep_page) : null, page: r.nep_page },
    { stage: 'hgab3', label: 'House bill', sub: 'House Bill 10858, third reading', amount: r.house_php, name: r.hb_title,
      href: r.house_doc && r.house_page ? pdfUrl(r.house_doc, r.house_page) : null, page: r.house_page },
    { stage: 'senate', label: 'Senate', sub: 'Senate committee report', amount: r.status === 'nep_only' ? null : r.senate_php,
      name: r.renamed || !r.hb_title ? r.title : null, href: r.senate_page ? senatePdfUrl(r.senate_doc, r.senate_page) : null, page: r.senate_page },
  ];
  return (
    <>
      <SenateHeader crumb={`${PROGRAM_NAV.find((p) => p.key === key)?.label ?? key} · project`} compiledMeta={`${fmt.shortPhp(r.senate_php)} Senate`} />
      <main className="nep-main">
        <div className="hgab-rec-head">
          <p className="hgab-rec-crumb" aria-label="Breadcrumb">
            <Link to={SENATE_ROOT}>The Senate committee report, 2027</Link>
            <span className="sep">›</span>
            <Link to={senateProgramPath(key)}>{PROGRAM_NAV.find((p) => p.key === key)?.label ?? key}</Link>
            <span className="sep">›</span>
            <Link to={senateProgramPath(key, 'projects')}>Projects</Link>
            <span className="sep">›</span>
            This project
          </p>
          <h1 className="hgab-rec-title">{r.title}</h1>
          <p className="hgab-rec-meta">
            {[r.program, r.pap, r.region, r.office].filter(Boolean).join(' · ')}
            {r.house_id && <span className="nep-code" title="Line reference, for citing this line">{r.house_id}</span>}
          </p>
          <div className="hgab-rec-labels">
            <span className="hgab-rec-label"><em>Version</em>Senate committee report</span>
            <SenateStatusChip status={r.status} />
            {r.renamed && <span className="hgab-rec-label"><em>Name</em>Revised by the Senate</span>}
          </div>
          <p className="hgab-rec-help">{SENATE_STATUS[r.status].help}</p>
        </div>
        <SenateReviewBanner compact />

        <div className="hgab-rec-cards">
          {cards.map((c) => (
            <div key={c.stage} className={`hgab-rec-card is-${c.stage} ${c.amount == null ? 'is-empty' : ''}`.trim()}>
              <div className="hgab-rec-card-stage">{c.label}<small>{c.sub}</small></div>
              {c.amount == null ? (
                <>
                  <div className="hgab-rec-card-amt is-empty">—</div>
                  <div className="hgab-rec-card-exact">No such line in this document</div>
                </>
              ) : (
                <>
                  <div className="hgab-rec-card-amt">{c.amount === 0 ? '₱0' : `₱${fmt.shortPhp(c.amount)}`}</div>
                  <div className="hgab-rec-card-exact">{fmt.php(c.amount, { unit: 'full' })}</div>
                </>
              )}
              {c.name && c.name !== r.title && <p className="hgab-rec-card-title" title="The name as this document lists it">“{c.name}”</p>}
              {c.name && c.stage === 'senate' && r.renamed && <p className="hgab-rec-card-title">The name the Senate committee report gives it.</p>}
              <div className="hgab-rec-card-actions">
                {c.href ? <a href={c.href} target="_blank" rel="noopener">Open page {c.page} ↗</a> : <span className="hgab-ds-null">No page linked</span>}
              </div>
            </div>
          ))}
          <div className={`hgab-rec-card is-delta ${delta == null ? 'is-empty' : ''}`.trim()}>
            <div className="hgab-rec-card-stage">Change<small>Senate minus each</small></div>
            <div className={`hgab-rec-card-amt ${delta != null && delta > 0 ? 'is-up' : delta != null && delta < 0 ? 'is-down' : ''}`.trim()}>
              {delta != null ? signed(delta) : '—'}
            </div>
            <div className="hgab-rec-card-exact">{delta != null ? `vs the House bill${pct(delta, r.house_php)}` : 'Not in the House bill'}</div>
            <div className={`hgab-rec-card-amt is-second ${vsNep != null && vsNep > 0 ? 'is-up' : vsNep != null && vsNep < 0 ? 'is-down' : ''}`.trim()}>
              {vsNep != null ? signed(vsNep) : '—'}
            </div>
            <div className="hgab-rec-card-exact">{vsNep != null ? `vs the NEP${pct(vsNep, r.nep_php)}` : 'Not in the NEP'}</div>
          </div>
        </div>

        <p className="senate-rec-actions">
          {key === 'dpwh' && r.house_id && (
            <Link className="senate-review-btn" to={`${REVIEW_ROOT}?p=${encodeURIComponent(r.house_id)}`}>Review this project →</Link>
          )}
          {r.house_id && <Link to={recordPath(key, r.house_id)}>This project in the House bill, with its documents →</Link>}
        </p>
        {cur.replaced && (
          <p className="hgab-ex-gap">
            The Senate inserts this project in place of one it removes, which reads almost the same:{' '}
            <Link to={senateRecordPath(key, cur.replaced.id)}>{cur.replaced.title}</Link> ({fmt.shortPhp(cur.replaced.house_php ?? 0)} in the House bill).
          </p>
        )}
        <SenateNotice />
      </main>
      <SiteFooter />
    </>
  );
}
