/**
 * `/hgab/2027/:dataset/p/:id` — one comparison record across its stages, with
 * the evidence that backs each figure.
 *
 * The row comes from the dataset's parquet (one DuckDB-Wasm lookup by id);
 * `record_json` is the workbench's full source record and is rendered
 * defensively, because its shape differs per dataset: DPWH rows carry
 * `second` / `third` / `nep` / `api` sides and fuzzy `suggestions`; the annex
 * rows carry `house` / `nep` sides with `path_labels` and a `comparison` (or,
 * for HFEP, a per-column `record`). Whatever the shape, the raw JSON is one
 * click away at the bottom of the page.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { DisclaimerNotice, HgabError, HgabHeader, HgabLoading, StatusChip } from '../components/HgabBits';
import { Amt } from '../components/HgabProjects';
import HgabEvidence from '../components/HgabEvidence';
import { runQuery } from '../lib/duckdb';
import * as fmt from '../lib/format';
import {
  HGAB_ROOT, READING_LABELS, STAGE_LABELS,
  datasetPath, formatPct, houseAmount, isDatasetKey, loadHgabOverview, pctChange, pdfUrl, projectsParquetUrl,
  traceInfo,
  type HgabDatasetMeta, type HgabOverview, type ProjectRecord, type StageKey,
} from '../lib/hgab';
import {
  apiPresenceInfo, coerceRow, flagLabel, matchLabel, pickHouseDoc, recordSql, recordSqlLiteral, splitFlags, zoneLabel,
} from '../lib/hgab-query';
import '../hgab-dataset.css';

type Side = Record<string, unknown>;

const obj = (v: unknown): Side | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Side) : null);
const arr = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : null);
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};

interface Loaded {
  key: string;
  id: string;
  row: ProjectRecord | null;
  err: string | null;
  ms: number;
}

interface Card {
  stage: StageKey;
  label: string;
  sub: string;
  amount: number | null;
  page: number | null;
  doc: string | null;
  side: Side | null;
}

export default function HgabRecord() {
  const { dataset: key = '', id = '' } = useParams();
  const [overview, setOverview] = useState<{ data: HgabOverview | null; err: string | null } | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  /** Which stage card has its evidence pane open — one at a time. */
  const [evidence, setEvidence] = useState<StageKey | null>(null);

  useEffect(() => {
    let live = true;
    loadHgabOverview()
      .then((o) => { if (live) setOverview({ data: o, err: null }); })
      .catch((e) => { if (live) setOverview({ data: null, err: String(e?.message || e) }); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!isDatasetKey(key) || !id) return;
    let live = true;
    const url = projectsParquetUrl(key);
    const t = setTimeout(async () => {
      try {
        let res;
        try {
          res = await runQuery(recordSql(url), [id]);
        } catch {
          // Parameter binding unavailable or rejected: the escaped literal is equivalent.
          res = await runQuery(recordSqlLiteral(url, id));
        }
        if (!live) return;
        const raw = res.rows[0] as Record<string, unknown> | undefined;
        if (!raw) { setLoaded({ key, id, row: null, err: null, ms: Math.round(res.ms) }); return; }
        let record: unknown = null;
        const rj = raw.record_json;
        if (typeof rj === 'string' && rj) {
          try { record = JSON.parse(rj); } catch { record = rj; }
        }
        setLoaded({ key, id, row: { ...coerceRow(raw), record }, err: null, ms: Math.round(res.ms) });
      } catch (e) {
        if (live) setLoaded({ key, id, row: null, err: String((e as Error)?.message || e), ms: 0 });
      }
    }, 0);
    return () => { live = false; clearTimeout(t); };
  }, [key, id]);

  const current = loaded?.key === key && loaded.id === id ? loaded : null;
  const row = current?.row ?? null;
  const data = overview?.data ?? null;
  const meta = (data?.datasets.find((x) => x.key === key) as HgabDatasetMeta | undefined) ?? null;
  const docs = data?.documents ?? null;

  useEffect(() => {
    if (row) document.title = `${row.title} · House bill vs NEP, FY2027 · BetterGov Budget`;
  }, [row]);

  if (!isDatasetKey(key)) {
    return <HgabError message={`There is no HGAB dataset called “${key}”. The four datasets are dpwh, fmr, hfep and nia.`} />;
  }
  if (overview?.err) return <HgabError message={overview.err} />;
  if (current?.err) {
    return <HgabError message={`Could not read record ${id} from hgab/2027/${key}/projects.parquet — ${current.err}`} />;
  }
  if (!current || !data) return <HgabLoading what={`record ${id}`} />;
  if (!row) return <HgabError message={`No record with id “${id}” in the ${key.toUpperCase()} dataset.`} />;

  const datasetMeta: HgabDatasetMeta = meta ?? {
    key, label: key.toUpperCase(), short: key.toUpperCase(), agency: '', dept_id: '', grain: '', scope: '',
    totals: { nep_php: 0, hgab2_php: null, hgab3_php: null, api_php: null },
    counts: { nep: 0, hgab2: null, hgab3: null, api: null }, printed: null,
    bridge: {} as HgabDatasetMeta['bridge'], documents: { nep: [], house: [] },
    controls_label: '', has_readings: true, has_map: false,
  };
  const docTitle = (k: string | null) => docs?.find((x) => x.key === k)?.title ?? k ?? null;

  const rec = obj(row.record);
  const info = traceInfo(row.trace);
  const twoReadings = meta ? meta.has_readings : row.hgab3_page != null;

  // Stage sides from the source record. DPWH: second / third / nep / api.
  // Annexes: house / nep (one House side; both readings print the same text).
  const sideNep = obj(rec?.nep);
  const sideSecond = obj(rec?.second);
  const sideThird = obj(rec?.third);
  const sideHouse = obj(rec?.house);
  const sideApi = obj(rec?.api);

  const cards: Card[] = [
    {
      stage: 'nep',
      label: STAGE_LABELS.nep.short,
      sub: STAGE_LABELS.nep.label,
      amount: row.nep_php,
      page: row.nep_page,
      doc: row.nep_doc ?? datasetMeta.documents.nep[0] ?? null,
      side: sideNep,
    },
  ];
  if (twoReadings) {
    cards.push(
      {
        stage: 'hgab2',
        label: STAGE_LABELS.hgab2.short,
        sub: STAGE_LABELS.hgab2.label,
        amount: row.hgab2_php,
        page: row.hgab2_page,
        doc: row.hgab2_doc ?? pickHouseDoc(docs, datasetMeta, 2, 'projects'),
        side: sideSecond ?? (sideThird ? null : sideHouse),
      },
      {
        stage: 'hgab3',
        label: STAGE_LABELS.hgab3.short,
        sub: STAGE_LABELS.hgab3.label,
        amount: row.hgab3_php,
        page: row.hgab3_page,
        doc: row.hgab3_doc ?? pickHouseDoc(docs, datasetMeta, 3, 'projects'),
        side: sideThird ?? sideHouse,
      },
    );
  } else {
    cards.push({
      stage: 'hgab2',
      label: 'House bill',
      sub: 'HB 10858 · the 2nd and 3rd reading print the same annex text',
      amount: houseAmount(row),
      page: row.hgab2_page ?? row.hgab3_page,
      doc: row.hgab2_doc ?? row.hgab3_doc ?? pickHouseDoc(docs, datasetMeta, 2, 'projects'),
      side: sideHouse ?? sideSecond ?? sideThird,
    });
  }
  if (row.api_php != null || sideApi) {
    cards.push({
      stage: 'api',
      label: STAGE_LABELS.api.short,
      sub: STAGE_LABELS.api.label,
      amount: row.api_php,
      page: null,
      doc: null,
      side: sideApi,
    });
  }

  const house = houseAmount(row);
  const delta = row.delta_php ?? (house != null && row.nep_php != null ? house - row.nep_php : null);
  const deltaPct = pctChange(house, row.nep_php);
  const open = evidence ? cards.find((c) => c.stage === evidence && c.doc && c.page) ?? null : null;

  const flags = splitFlags(row.flags);
  const suggestions = (arr(rec?.suggestions) ?? []).map(obj).filter((s): s is Side => Boolean(s));
  const nepDoc = row.nep_doc ?? datasetMeta.documents.nep[0] ?? null;
  const api = apiPresenceInfo(row.api_presence);
  const match = matchLabel(row.house_match);
  const reading = row.reading_status ? (READING_LABELS[row.reading_status] ?? row.reading_status) : null;

  // Pairing notes: scalar fields the workbench attaches to explain a pairing.
  const notes: Array<[string, string]> = [];
  const note = (label: string, v: unknown) => { const s = str(v); if (s) notes.push([label, s]); };
  note('Reason', rec?.reason);
  note('Match basis', rec?.match_basis);
  note('Identity score', num(rec?.identity_score) != null ? num(rec?.identity_score)!.toFixed(3) : null);
  note('Segment overlap', num(rec?.segment_overlap_ratio) != null ? num(rec?.segment_overlap_ratio)!.toFixed(3) : null);
  note('Δ third − second', num(rec?.reading_delta_php) != null ? fmt.php(num(rec?.reading_delta_php), { unit: 'full' }) : null);
  const diffTags = (arr(rec?.diff_tags) ?? []).map(str).filter(Boolean) as string[];
  if (diffTags.length) notes.push(['Title differences', diffTags.join(', ')]);
  note('Grouping flag', obj(rec?.road_group)?.flag);
  const comparison = obj(rec?.comparison);
  note('Pairing method', comparison?.method);
  note('Comparison status', comparison?.status);
  note('Strict status', comparison?.strict_status);
  const hfep = obj(rec?.record);
  note('Funding column', hfep?.column_label ?? hfep?.column);
  note('Event', hfep?.event);
  note('Similarity', num(hfep?.similarity) != null ? num(hfep?.similarity)!.toFixed(3) : null);

  // Source-tree paths: annex sides carry `path_labels`; also accept a flat string.
  const paths: Array<{ label: string; steps: string[] }> = [];
  const pushPath = (label: string, v: unknown) => {
    const list = arr(v);
    if (list) {
      const steps = list.map((x) => str(x) ?? str(obj(x)?.label)).filter(Boolean) as string[];
      if (steps.length) paths.push({ label, steps });
      return;
    }
    const s = str(v);
    if (s && s.includes('→')) paths.push({ label, steps: s.split('→').map((x) => x.trim()).filter(Boolean) });
  };
  for (const c of cards) {
    if (c.side) pushPath(c.label, c.side.path_labels ?? c.side.path);
  }
  pushPath('Record', rec?.path_labels ?? rec?.path);

  return (
    <>
      <HgabHeader crumb={`${datasetMeta.short} · record`} compiledMeta={house != null ? `${fmt.shortPhp(house)} House` : undefined} />
      <main className="nep-main">
        <div className="hgab-rec-head">
          <p className="hgab-rec-crumb" aria-label="Breadcrumb">
            <Link to={HGAB_ROOT}>HGAB 2027</Link>
            <span className="sep">›</span>
            <Link to={datasetPath(key)}>{datasetMeta.short}</Link>
            <span className="sep">›</span>
            <Link to={datasetPath(key, 'projects')}>Projects</Link>
            <span className="sep">›</span>
            Record
          </p>
          <h1 className="hgab-rec-title">{row.title}</h1>
          <p className="hgab-rec-meta">
            {[row.program, row.pap, row.region, row.office].filter(Boolean).join(' · ') || datasetMeta.label}
            <span className="nep-code">{row.id}</span>
          </p>
          <div className="hgab-rec-labels">
            <StatusChip trace={row.trace} />
            {match && <span className="hgab-rec-label" title={row.house_match ?? undefined}><em>pairing</em>{match}</span>}
            {reading && twoReadings && <span className="hgab-rec-label" title={row.reading_status ?? undefined}><em>readings</em>{reading}</span>}
            {api && <span className="hgab-rec-label" title={api.help}><em>Transparency</em>{api.label}</span>}
            {row.confidence != null && (
              <span className="hgab-rec-label" title="Title similarity of the pairing (0–1). A text measure, not a probability."><em>similarity</em>{row.confidence.toFixed(3)}</span>
            )}
            {row.zone && <span className="hgab-rec-label"><em>zone</em>{zoneLabel(row.zone)}</span>}
            {row.length_m != null && <span className="hgab-rec-label"><em>length</em>{(row.length_m / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} km</span>}
          </div>
          {(info.help || api?.help) && (
            <p className="hgab-rec-help">
              {info.help}{info.held ? ' This row is held out of the headline counts.' : ''}
              {api?.help ? ` ${api.help}` : ''}
            </p>
          )}
        </div>

        <div className="hgab-rec-cards">
          {cards.map((c) => <StageCard key={c.stage} card={c} row={row} docTitle={docTitle} open={evidence === c.stage} onToggle={() => setEvidence(evidence === c.stage ? null : c.stage)} />)}
          <div className={`hgab-rec-card is-delta ${delta == null ? 'is-empty' : ''}`.trim()}>
            <div className="hgab-rec-card-stage">
              Δ House − NEP
              <small>{twoReadings ? 'Latest House reading minus the NEP' : 'House bill minus the NEP'}</small>
            </div>
            {delta == null ? (
              <>
                <div className="hgab-rec-card-amt is-empty">—</div>
                <p className="hgab-rec-card-title">
                  {row.nep_php == null && house == null
                    ? 'Neither side carries an amount.'
                    : row.nep_php == null
                      ? 'No NEP record is attached, so there is no difference to compute. A House-only row is an insertion candidate, not a confirmed insertion.'
                      : 'No House record is attached, so there is no difference to compute. An NEP-only row is a deletion candidate, not a confirmed removal.'}
                </p>
              </>
            ) : (
              <>
                <div className={`hgab-rec-card-amt ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}`.trim()}>
                  {delta === 0 ? '0' : `${delta > 0 ? '+' : '−'}${fmt.shortPhp(Math.abs(delta))}`}
                </div>
                <div className="hgab-rec-card-exact">
                  {delta === 0
                    ? 'Same amount on both stages'
                    : `${delta > 0 ? '+' : '−'}${fmt.php(Math.abs(delta), { unit: 'full' })}${deltaPct != null ? ` · ${formatPct(deltaPct)}` : ' · no NEP base'}`}
                </div>
                {info.group === 'scope_review' && (
                  <p className="hgab-rec-card-title">Segment-scope pair: this difference is deliberately not booked as an adjustment.</p>
                )}
              </>
            )}
          </div>
        </div>

        {open && open.doc && (
          <HgabEvidence docKey={open.doc} page={open.page} docTitle={docTitle(open.doc)} onClose={() => setEvidence(null)} />
        )}

        {(flags.length > 0 || notes.length > 0) && (
          <div className="hgab-rec-section">
            <SectionHead size="sm" eyebrow="Review" headline="Flags and pairing notes" dek="Flags mark things a reviewer should look at. They do not establish error or intent." />
            {flags.length > 0 && (
              <ul className="hgab-rec-flags">
                {flags.map((f) => (
                  <li className="hgab-rec-flag" key={f}>{flagLabel(f)}<code>{f}</code></li>
                ))}
              </ul>
            )}
            {notes.length > 0 && (
              <dl className="hgab-rec-kv" style={{ marginTop: flags.length ? 14 : 0, maxWidth: 820 }}>
                {notes.map(([k, v]) => (<div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>))}
              </dl>
            )}
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="hgab-rec-section">
            <SectionHead
              size="sm"
              eyebrow="Not attached"
              headline={`${suggestions.length} NEP suggestion${suggestions.length === 1 ? '' : 's'}`}
              dek="Similar-title NEP rows the matcher found but did not accept. Similarity is a text measure (0–1), not a probability; suggestions add nothing to any total. Review for a re-titled or re-scoped counterpart before reading this row as an insertion."
            />
            <div className="nep-table-wrap">
              <table className="nep-table hgab-rec-sugg">
                <thead>
                  <tr>
                    <th className="num">Similarity</th>
                    <th className="num">Identity</th>
                    <th className="nep-th-name">NEP row</th>
                    <th className="num">{STAGE_LABELS.nep.short}</th>
                    <th>Differences</th>
                    <th>Page</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((s, i) => {
                    const n = obj(s.nep) ?? s;
                    const page = num(n.pdf_page) ?? num(obj(n.source)?.pdf_page);
                    const tags = (arr(s.diff_tags) ?? []).map(str).filter(Boolean) as string[];
                    const where = [str(n.region), str(n.office), str(n.pap)].filter(Boolean).join(' · ');
                    return (
                      <tr key={str(n.id) ?? i}>
                        <td className="num">{num(s.confidence)?.toFixed(3) ?? '—'}</td>
                        <td className="num">{num(s.identity_score)?.toFixed(3) ?? '—'}</td>
                        <td className="nep-td-name">
                          {str(n.title) ?? '—'}
                          {where && <span className="nep-code">{where}</span>}
                          {str(n.id) && <span className="nep-code">{str(n.id)}</span>}
                        </td>
                        <td className="num"><Amt v={num(n.amount_php)} /></td>
                        <td>
                          <span className="hgab-rec-tags">{tags.map((t) => <span key={t}>{t.replace(/_/g, ' ')}</span>)}</span>
                        </td>
                        <td>
                          {page && nepDoc ? (
                            <span className="hgab-ds-pages">
                              <a href={pdfUrl(nepDoc, page)} target="_blank" rel="noopener">NEP p.{page}</a>
                            </span>
                          ) : <span className="hgab-ds-null">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {paths.length > 0 && (
          <div className="hgab-rec-section">
            <SectionHead size="sm" eyebrow="Where it sits" headline="Source-tree path" dek="The heading hierarchy each document prints above this row." />
            {paths.map((p) => (
              <div key={p.label}>
                <p className="hgab-rec-path-stage">{p.label}</p>
                <ol className="hgab-rec-path">{p.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              </div>
            ))}
          </div>
        )}

        <div className="hgab-rec-section">
          <details className="nep-sql hgab-rec-json">
            <summary>Source record (JSON)</summary>
            <pre>{row.record == null ? 'No source record attached.' : typeof row.record === 'string' ? row.record : JSON.stringify(row.record, null, 2)}</pre>
          </details>
          <p className="nep-hier-note">
            Queried from <code>hgab/2027/{key}/projects.parquet</code> in {current.ms} ms ·{' '}
            <Link to={datasetPath(key, 'projects')}>back to all {datasetMeta.short} projects</Link>
          </p>
        </div>

        <DisclaimerNotice compact />
      </main>
      <SiteFooter source={`SOURCE: HOUSE BILL 10858 VS NEP · FY 2027 · ${datasetMeta.agency.toUpperCase()}`} />
    </>
  );
}

function StageCard({
  card,
  row,
  docTitle,
  open,
  onToggle,
}: {
  card: Card;
  row: ProjectRecord;
  docTitle: (k: string | null) => string | null;
  open: boolean;
  onToggle: () => void;
}) {
  const s = card.side;
  const empty = card.amount == null && !s;
  const sideTitle = str(s?.title);
  const source = obj(s?.source);
  const printed = num(source?.printed_page) ?? num(s?.printed_page);
  const kv: Array<[string, string]> = [];
  const put = (k: string, v: unknown) => { const t = str(v); if (t) kv.push([k, t]); };
  put('Region', s?.region ?? (card.stage === 'nep' || !s ? row.region : null));
  put('Office', s?.office ?? (!s ? row.office : null));
  put('Program', s?.program ?? s?.program_group);
  put('PAP', s?.pap ?? s?.subprogram_label ?? s?.sub_program ?? (!s ? row.pap : null));
  put('Zone', zoneLabel(str(s?.zone) ?? (!s ? row.zone : null)));
  put('Category', s?.category);
  put('Sub-category', s?.subcategory);
  put('Province', s?.province);
  put('Source id', s?.id);
  put('Record kind', s?.record_kind);
  put('Amount evidence', s?.evidence);
  if (printed) kv.push(['Printed page', String(printed)]);
  const amounts = obj(s?.amounts_php);
  const members = arr(s?.records);
  const funding = obj(s?.funding_php);

  return (
    <div className={`hgab-rec-card is-${card.stage} ${empty ? 'is-empty' : ''}`.trim()}>
      <div className="hgab-rec-card-stage">{card.label}<small>{card.sub}</small></div>
      {card.amount == null ? (
        <>
          <div className="hgab-rec-card-amt is-empty">—</div>
          <div className="hgab-rec-card-exact">No record on this stage</div>
        </>
      ) : (
        <>
          <div className="hgab-rec-card-amt">{card.amount === 0 ? '₱0' : `₱${fmt.shortPhp(card.amount)}`}</div>
          <div className="hgab-rec-card-exact">{fmt.php(card.amount, { unit: 'full' })}</div>
        </>
      )}
      {sideTitle && sideTitle !== row.title && (
        <p className="hgab-rec-card-title" title="Title as printed on this stage">“{sideTitle}”</p>
      )}
      {kv.length > 0 && (
        <dl className="hgab-rec-kv">
          {kv.map(([k, v]) => (<div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
      )}
      {amounts && (
        <dl className="hgab-rec-kv">
          {Object.entries(amounts).map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}><dt>{k.replace(/_/g, ' ')}</dt><dd><Amt v={num(v)} /></dd></div>
          ))}
        </dl>
      )}
      {funding && (
        <dl className="hgab-rec-kv">
          {Object.entries(funding).map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}><dt>{k.replace(/_/g, ' ')} funding</dt><dd><Amt v={num(v)} /></dd></div>
          ))}
        </dl>
      )}
      {members && members.length > 1 && (
        <p className="hgab-rec-card-title">
          Grouped: {members.length} printed rows share this key
          {members.every((m) => num(obj(m)?.amount_php) != null)
            ? ` (${members.map((m) => fmt.shortPhp(num(obj(m)?.amount_php))).join(' + ')})`
            : ''}.
        </p>
      )}
      <div className="hgab-rec-card-actions">
        {card.doc && card.page ? (
          <>
            <a href={pdfUrl(card.doc, card.page)} target="_blank" rel="noopener" title={docTitle(card.doc) ?? undefined}>
              Open page {card.page} ↗
            </a>
            <button type="button" aria-expanded={open} onClick={onToggle}>
              {open ? 'Hide evidence' : 'Show evidence'}
            </button>
          </>
        ) : card.stage === 'api' ? (
          <span className="hgab-ds-null">Listing record · no page</span>
        ) : (
          <span className="hgab-ds-null">No page reference</span>
        )}
      </div>
    </div>
  );
}

