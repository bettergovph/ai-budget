/**
 * Projects tab of a `/hgab/2027/:dataset` hub: every comparison row of the
 * dataset, queried in the browser with DuckDB-Wasm over `projects.parquet`.
 *
 * All filter, sort and paging state lives in the URL, so a filtered view is a
 * shareable finding — the same discipline as the workbench this data comes
 * from. The generated SQL is shown verbatim (inside "Details for analysts"),
 * and the CSV export runs the same WHERE without the LIMIT so what you
 * download is what you filtered.
 *
 * Copy: plain first. Filter labels, chips and notes use the section's plain
 * words ("What happened to the line", "unconfirmed matches", "two versions of
 * one budget — compare, don't add"); SQL and timing sit in the Details box.
 *
 * Rules the table enforces: stage amounts are compared, never summed across
 * stages (the summary line gives one sum per stage over the same rows); null
 * is "—", never 0; held rows (fuzzy / ambiguous) are visibly marked; every row
 * links to the PDF page it was read from.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { runQuery } from '../lib/duckdb';
import { downloadCsv } from '../lib/csv';
import * as fmt from '../lib/format';
import {
  BRIDGE_LABELS, BRIDGE_ORDER, READING_LABELS, STAGE_LABELS,
  districtPath, formatPct, pdfUrl, projectsParquetUrl, recordPath, traceInfo,
  type BridgeGroup, type HgabDatasetMeta, type HgabDocument, type ProjectRow,
} from '../lib/hgab';
import {
  PAGE_SIZES, SORT_LABELS, coerceFacets, coerceRow, coerceSummary, defaultSort, exportSql, facetsSql,
  filtersFromParams, flagLabel, hasActiveFilters, matchLabel, papLabel, paramsFromFilters, pickHouseDoc,
  projectsCsv, projectsSql, regionFilterName, splitFlags, summarySql, zoneLabel,
  type FacetRow, type FilterSummary, type ProjectFilters, type SortKey,
} from '../lib/hgab-query';
import { HgabDetails, StatusChip } from './HgabBits';
import { SkeletonRows } from './Nep2027Bits';
import '../hgab-districts.css';

// ---------------------------------------------------------------------------
// Small cells shared with the hub and the record page
// ---------------------------------------------------------------------------

/** A stage amount: short form, exact pesos on hover, "—" for null. */
export function Amt({ v, strong = false, blank = false }: { v: number | null | undefined; strong?: boolean; blank?: boolean }) {
  // Health facilities: the facility is in both lists but this budget column
  // (building works, equipment or vehicles) is left empty in this one. The
  // source counts the empty column as zero when it measures the change.
  if (v == null && blank) {
    return (
      <span className="hgab-ds-null" title="This facility is in this list, but this budget column is left empty. The change is counted from zero.">
        empty
      </span>
    );
  }
  if (v == null) return <span className="hgab-ds-null" title="This document has no such line">—</span>;
  return (
    <span className={strong ? 'nep-td-amt' : undefined} title={fmt.php(v, { unit: 'full' })}>
      {v === 0 ? '0' : fmt.shortPhp(v)}
    </span>
  );
}

/** Signed difference with optional percent of `base`; "—" when either side is missing. */
export function DeltaCell({ delta, base }: { delta: number | null | undefined; base?: number | null }) {
  if (delta == null) return <span className="hgab-ds-null" title="One document has no such line, so there is no difference to show">—</span>;
  const p = base ? (delta / base) * 100 : null;
  const color = delta > 0 ? 'var(--positive)' : delta < 0 ? 'var(--negative)' : 'var(--ink-mute)';
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  return (
    <span className="nep-delta" style={{ color }} title={`${sign}${fmt.php(Math.abs(delta), { unit: 'full' })}`}>
      <span className="nep-delta-abs">{delta === 0 ? '0' : `${sign}${fmt.shortPhp(Math.abs(delta))}`}</span>
      {p != null && delta !== 0 && <span className="nep-delta-pct">{formatPct(p)}</span>}
    </span>
  );
}

/** "NEP p.112 · 3R p.5" — one link per stage that has a page, opening the PDF at that page. */
export function PageLinks({
  row,
  dataset,
  docs,
}: {
  row: ProjectRow;
  dataset: HgabDatasetMeta;
  docs: readonly HgabDocument[] | null;
}) {
  const items: Array<{ label: string; page: number; doc: string | null }> = [];
  if (row.nep_page) {
    items.push({ label: STAGE_LABELS.nep.short, page: row.nep_page, doc: row.nep_doc ?? dataset.documents.nep[0] ?? null });
  }
  if (row.hgab2_page) {
    items.push({ label: '2R', page: row.hgab2_page, doc: row.hgab2_doc ?? pickHouseDoc(docs, dataset, 2, 'projects') });
  }
  if (row.hgab3_page) {
    items.push({ label: '3R', page: row.hgab3_page, doc: row.hgab3_doc ?? pickHouseDoc(docs, dataset, 3, 'projects') });
  }
  if (!items.length) return <span className="hgab-ds-null" title="No page is recorded for this line">—</span>;
  const title = (key: string | null) => docs?.find((d) => d.key === key)?.title ?? key ?? '';
  return (
    <span className="hgab-ds-pages">
      {items.map((it) =>
        it.doc ? (
          <a
            key={it.label}
            href={pdfUrl(it.doc, it.page)}
            target="_blank"
            rel="noopener"
            title={`${title(it.doc)} — PDF page ${it.page}`}
          >
            {it.label} p.{it.page}
          </a>
        ) : (
          <span key={it.label}>{it.label} p.{it.page}</span>
        ),
      )}
    </span>
  );
}

/** Inline failure block for the parquet query — the page chrome stays up. */
export function ParquetError({ message, dataset }: { message: string; dataset: HgabDatasetMeta }) {
  return (
    <div className="hgab-ds-parquet-err" role="alert">
      <p>The project list could not be loaded. Try reloading the page.</p>
      <HgabDetails>
        <p>
          Could not read <code>hgab/2027/{dataset.key}/projects.parquet</code>. If the file has not been
          built, run <code>npm run import:hgab</code> (or publish it with <code>npm run upload:hgab</code>);
          if it exists, the query below failed.
        </p>
        <pre>{message}</pre>
      </HgabDetails>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

type Tagged<T> = { sql: string } & T;

export default function HgabProjects({
  dataset,
  docs,
}: {
  dataset: HgabDatasetMeta;
  /** Document catalogue from the overview; used for PDF titles and doc fallbacks. */
  docs: readonly HgabDocument[] | null;
}) {
  const key = dataset.key;
  const url = useMemo(() => projectsParquetUrl(key), [key]);
  const [params, setParams] = useSearchParams();
  const sortDefault = defaultSort(dataset);
  const filters = useMemo(() => filtersFromParams(params, sortDefault), [params, sortDefault]);

  /**
   * Write a filter change to the URL. Any change but paging goes back to page 1.
   * Built from the URL as it is at write time (not the render that created the
   * handler), so two writes in one tick — a chip click and a select change —
   * compose instead of the second clobbering the first.
   */
  const update = useCallback(
    (patch: Partial<ProjectFilters>) => {
      setParams((prev) => {
        const next: ProjectFilters = { ...filtersFromParams(prev, sortDefault), ...patch };
        if (!('page' in patch)) next.page = 1;
        return paramsFromFilters(next, prev, sortDefault);
      }, { replace: true });
    },
    [setParams, sortDefault],
  );

  // Search is debounced: the box shows what you type at once, the URL (and
  // the query) follow 250 ms after you pause. `seenQ` is the last URL value we
  // adopted, so a change that arrives from outside — a "See all" link, Back —
  // replaces the draft, while our own debounced write does not clobber typing.
  const urlQ = filters.q;
  const [draft, setDraft] = useState(urlQ);
  const [seenQ, setSeenQ] = useState(urlQ);
  if (urlQ !== seenQ) {
    setSeenQ(urlQ);
    if (draft.trim() !== urlQ) setDraft(urlQ);
  }
  useEffect(() => {
    if (draft.trim() === urlQ) return;
    const t = setTimeout(() => {
      setSeenQ(draft.trim());
      update({ q: draft });
    }, 250);
    return () => clearTimeout(t);
  }, [draft, urlQ, update]);

  // Results are tagged with the SQL that produced them, so a slow answer for a
  // filter we have already left can never paint under the current heading,
  // and "loading" is simply "the tag does not match".
  const sql = useMemo(() => projectsSql(url, filters), [url, filters]);
  const sumSql = useMemo(() => summarySql(url, filters), [url, filters]);
  const [result, setResult] = useState<Tagged<{ rows: ProjectRow[]; ms: number }> | null>(null);
  const [summary, setSummary] = useState<Tagged<{ data: FilterSummary }> | null>(null);
  const [error, setError] = useState<Tagged<{ message: string }> | null>(null);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const [res, sum] = await Promise.all([runQuery(sql), runQuery(sumSql)]);
        if (!live) return;
        setResult({ sql, rows: res.rows.map((r) => coerceRow(r as Record<string, unknown>)), ms: Math.round(res.ms) });
        setSummary({ sql, data: coerceSummary(sum.rows[0] as Record<string, unknown> | undefined) });
        setError(null);
      } catch (e) {
        if (!live) return;
        setError({ sql, message: String((e as Error)?.message || e) });
      }
    }, 0);
    return () => { live = false; clearTimeout(t); };
  }, [sql, sumSql]);

  // Facets (distinct values per filter column) are per dataset, not per filter.
  const [facets, setFacets] = useState<{ url: string; rows: FacetRow[] } | null>(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await runQuery(facetsSql(url));
        if (live) setFacets({ url, rows: coerceFacets(res.rows as Record<string, unknown>[]) });
      } catch {
        /* the main query reports the failure */
      }
    }, 0);
    return () => { live = false; clearTimeout(t); };
  }, [url]);

  const fresh = result?.sql === sql ? result : null;
  const failed = error?.sql === sql ? error : null;
  const loading = !fresh && !failed;
  const rows = fresh?.rows ?? [];
  const sum = summary?.sql === sql ? summary.data : null;
  const facetRows = useMemo(() => (facets?.url === url ? facets.rows : []), [facets, url]);
  const facet = (dim: FacetRow['dim']) => facetRows.filter((r) => r.dim === dim);

  const groupCounts = useMemo(() => {
    const out: Record<BridgeGroup, number> = {
      house_only: 0, nep_only: 0, unchanged: 0, increased: 0, decreased: 0, scope_review: 0,
    };
    for (const r of facetRows) {
      if (r.dim !== 'trace') continue;
      const info = traceInfo(r.value);
      if (!info.group) continue;
      if (filters.held === 'hide' && info.held) continue;
      if (filters.held === 'only' && !info.held) continue;
      out[info.group] += r.n;
    }
    return out;
  }, [facetRows, filters.held]);

  // A stale link can point past the last page; clamp rather than show nothing.
  const total = sum?.n ?? null;
  const pageCount = total != null ? Math.max(1, Math.ceil(total / filters.size)) : null;
  useEffect(() => {
    if (pageCount != null && filters.page > pageCount) update({ page: pageCount });
  }, [pageCount, filters.page, update]);

  const [exporting, setExporting] = useState(false);
  async function exportCsv() {
    setExporting(true);
    try {
      const res = await runQuery(exportSql(url, filters));
      const all = res.rows.map((r) => coerceRow(r as Record<string, unknown>));
      downloadCsv(`hgab-2027-${key}-projects${hasActiveFilters(filters) ? '-filtered' : ''}.csv`, projectsCsv(all, key));
    } catch (e) {
      setError({ sql, message: `CSV export failed: ${String((e as Error)?.message || e)}` });
    } finally {
      setExporting(false);
    }
  }

  const [copied, setCopied] = useState(false);
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the address bar still has the link */
    }
  }

  function toggleGroup(g: BridgeGroup) {
    const has = filters.groups.includes(g);
    update({ groups: has ? filters.groups.filter((x) => x !== g) : [...filters.groups, g] });
  }

  function head(k: SortKey, text: string, cls = '', title?: string) {
    const active = filters.sort === k;
    return (
      <th className={`${cls} ${active ? 'nep-th-active' : ''}`.trim()} title={title}>
        <button
          type="button"
          onClick={() =>
            update(active
              ? { dir: filters.dir === 'asc' ? 'desc' : 'asc' }
              : { sort: k, dir: k === 'title' ? 'asc' : 'desc' })
          }
        >
          {text}
          <span className="nep-sort-caret">{active ? (filters.dir === 'asc' ? '▲' : '▼') : ''}</span>
        </button>
      </th>
    );
  }

  function select(
    label: string,
    dim: FacetRow['dim'],
    value: string,
    onChange: (v: string) => void,
    name: (v: string) => string = (v) => v,
  ) {
    const opts = facet(dim);
    if (!opts.length && !value) return null;
    return (
      <label>
        <span>{label}</span>
        <select className="select-input" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">All</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>{name(o.value)} ({o.n.toLocaleString()})</option>
          ))}
          {value && !opts.some((o) => o.value === value) && <option value={value}>{name(value)}</option>}
        </select>
      </label>
    );
  }

  // Which House columns to draw. DPWH prints two readings; the annexes print
  // the same text at both, so one column labelled as such is the honest view.
  const twoReadings = dataset.has_readings;
  const houseKey: 'hgab2' | 'hgab3' = dataset.totals.hgab3_php != null ? 'hgab3' : 'hgab2';
  const pap = papLabel(dataset.key);
  const colCount = 7 + (twoReadings ? 1 : 0) + (pap ? 1 : 0);
  const sortLabel = (k: SortKey) =>
    !twoReadings && (k === 'hgab3' || k === 'hgab2') ? 'House amount' : SORT_LABELS[k];
  const firstRow = total != null && total > 0 ? (filters.page - 1) * filters.size + 1 : 0;
  const lastRow = total != null ? Math.min(total, filters.page * filters.size) : 0;

  return (
    <div className="hgab-ds-projects">
      <div className="hgab-ds-groups" role="group" aria-label="What happened to the line">
        <span className="hgab-ds-groups-label">What happened to the line</span>
        {BRIDGE_ORDER.map((g) => (
          <button
            key={g}
            type="button"
            className={`hgab-ds-group is-${g}`}
            aria-pressed={filters.groups.includes(g)}
            title={BRIDGE_LABELS[g].help}
            onClick={() => toggleGroup(g)}
          >
            {BRIDGE_LABELS[g].label}
            {facetRows.length > 0 && <small>{groupCounts[g].toLocaleString()}</small>}
          </button>
        ))}
        <label className="hgab-ds-held">
          Unconfirmed matches
          <select
            className="select-input"
            value={filters.held}
            onChange={(e) => update({ held: e.target.value as ProjectFilters['held'] })}
            title="House lines with a similar-looking line in the proposal, or several, that could not be confirmed. They are left out of the headline counts."
          >
            <option value="all">Show all</option>
            <option value="hide">Hide unconfirmed</option>
            <option value="only">Unconfirmed only</option>
          </select>
        </label>
      </div>

      {filters.deo && (
        <div className="hgab-ds-chips" role="group" aria-label="Active office filter">
          <span className="hgab-ds-chip">
            <em>Office</em>
            {filters.deo}
            <button
              type="button"
              aria-label={`Remove the office filter ${filters.deo}`}
              title="Remove this filter"
              onClick={() => update({ deo: '' })}
            >
              ×
            </button>
          </span>
          <Link className="hgab-ds-chip-link" to={districtPath()} title="District engineering offices and the districts they serve">
            All districts →
          </Link>
        </div>
      )}

      <div className="nep-explore-controls hgab-ds-filters">
        <label>
          <span>Search</span>
          <input
            className="text-input"
            type="search"
            placeholder="project name, program line, region, office…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') update({ q: draft }); }}
          />
        </label>
        {select('Region', 'region', filters.region, (v) => update({ region: v }), regionFilterName)}
        {select('Program', 'program', filters.program, (v) => update({ program: v }))}
        {pap && select(pap, 'pap', filters.pap, (v) => update({ pap: v }))}
        {select('Type of office', 'office_kind', filters.officeKind, (v) => update({ officeKind: v }))}
        {select('Funding', 'zone', filters.zone, (v) => update({ zone: v }), (v) => zoneLabel(v) ?? v)}
        {twoReadings && select('Between the House votes', 'reading_status', filters.reading, (v) => update({ reading: v }), (v) => READING_LABELS[v] ?? v)}
        {select('Marked for checking', 'flag', filters.flag, (v) => update({ flag: v }), flagLabel)}
        <label>
          <span>Sort</span>
          <select
            className="select-input"
            value={`${filters.sort}:${filters.dir}`}
            onChange={(e) => {
              const [s, d] = e.target.value.split(':') as [SortKey, ProjectFilters['dir']];
              update({ sort: s, dir: d });
            }}
          >
            {(Object.keys(SORT_LABELS) as SortKey[])
              .filter((k) => (k === 'hgab2' ? dataset.totals.hgab2_php != null && twoReadings : k === 'hgab3' ? dataset.totals.hgab3_php != null : true))
              .flatMap((k) => [
                <option key={`${k}:desc`} value={`${k}:desc`}>{sortLabel(k)} · {k === 'title' ? 'Z→A' : 'largest first'}</option>,
                <option key={`${k}:asc`} value={`${k}:asc`}>{sortLabel(k)} · {k === 'title' ? 'A→Z' : 'smallest first'}</option>,
              ])}
          </select>
        </label>
      </div>

      <div className="nep-explore-summary hgab-ds-summary">
        {loading && (
          <span className="nep-busy">
            <span className="busy-sweep" aria-hidden="true" />
            {result ? 'Updating…' : 'Loading the project list… the first view downloads it'}
          </span>
        )}
        {!loading && sum && (
          <>
            <span><strong>{sum.n.toLocaleString()}</strong> {sum.n === 1 ? 'row' : 'rows'} shown</span>
            <ul className="hgab-ds-stage-sums" aria-label="Total of these rows in each version">
              <li title={`${sum.nep_rows.toLocaleString()} rows have an amount in the President’s proposal`}>
                <em>{STAGE_LABELS.nep.short}</em><strong><Amt v={sum.nep_php} /></strong>
              </li>
              {twoReadings && (
                <li title={`${sum.hgab2_rows.toLocaleString()} rows have an amount at second reading`}>
                  <em>{STAGE_LABELS.hgab2.short}</em><strong><Amt v={sum.hgab2_php} /></strong>
                </li>
              )}
              <li title={`${(houseKey === 'hgab3' ? sum.hgab3_rows : sum.hgab2_rows).toLocaleString()} rows have an amount in the House bill`}>
                <em>{twoReadings ? STAGE_LABELS[houseKey].short : 'House'}</em>
                <strong><Amt v={houseKey === 'hgab3' ? sum.hgab3_php : sum.hgab2_php} /></strong>
              </li>
            </ul>
            <span className="hgab-ds-notadditive">two versions of one budget — compare, don’t add</span>
          </>
        )}
        <span className="nep-explore-actions hgab-ds-actions">
          {hasActiveFilters(filters) && (
            <button type="button" onClick={() => setParams(new URLSearchParams({ view: 'projects' }), { replace: true })}>
              Clear filters
            </button>
          )}
          <button type="button" className={copied ? 'hgab-ds-copied' : undefined} onClick={copyLink}>
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          <button type="button" disabled={exporting || !total} onClick={exportCsv} title="Every row shown, in exact pesos, one column per version">
            {exporting ? 'Exporting…' : `Download CSV${total ? ` (${total.toLocaleString()})` : ''}`}
          </button>
        </span>
      </div>

      {failed && <ParquetError message={failed.message} dataset={dataset} />}


      <div className="nep-table-wrap">
        <table className="nep-table hgab-ds-table">
          <thead>
            <tr>
              {head('title', 'Project', 'nep-th-name')}
              <th className="hgab-ds-col-region">Region</th>
              <th className="hgab-ds-col-office">Office</th>
              {pap && <th className="hgab-ds-col-pap">{pap}</th>}
              <th title="Which of the six groups this line falls in">What happened</th>
              {head('nep', STAGE_LABELS.nep.short, 'num', STAGE_LABELS.nep.label)}
              {twoReadings && head('hgab2', STAGE_LABELS.hgab2.short, 'num', STAGE_LABELS.hgab2.label)}
              {head(houseKey, twoReadings ? STAGE_LABELS[houseKey].short : 'House', 'num',
                twoReadings ? STAGE_LABELS[houseKey].label : 'House bill; the second and third reading print the same list')}
              {head('delta', `Change vs ${STAGE_LABELS.nep.short}`, 'num', 'Latest House amount minus the President’s proposal, when both exist')}
              <th>Pages</th>
            </tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows cols={colCount} rows={6} />}
            {!loading && rows.map((r) => {
              const info = traceInfo(r.trace);
              const match = matchLabel(r.house_match);
              const reading = r.reading_status ? (READING_LABELS[r.reading_status] ?? r.reading_status) : null;
              return (
                <tr key={r.id} className={info.held ? 'is-held' : undefined}>
                  <td className="nep-td-name">
                    <Link to={recordPath(key, r.id)}>{r.title}</Link>
                    {r.program && <span className="nep-code">{r.program}</span>}
                  </td>
                  <td className="nep-td-dim hgab-ds-col-region">{r.region ?? <span className="hgab-ds-null">—</span>}</td>
                  <td className="nep-td-dim hgab-ds-col-office" title={r.office ?? undefined}>
                    {r.office ?? <span className="hgab-ds-null">—</span>}
                  </td>
                  {pap && (
                    <td className="nep-td-dim hgab-ds-col-pap" title={r.pap ?? undefined}>
                      {r.pap ?? <span className="hgab-ds-null">—</span>}
                    </td>
                  )}
                  <td className="hgab-ds-td-status">
                    <StatusChip trace={r.trace} />
                    {match && !/^(exact_candidate|house_unmatched|nep_unmatched)$/.test(r.house_match ?? '') && (
                      <span className="hgab-ds-sub">{match}</span>
                    )}
                    {reading && twoReadings && r.reading_status !== 'same_amount' && r.reading_status !== 'no_house_record' && (
                      <span className="hgab-ds-sub">{reading}</span>
                    )}
                  </td>
                  <td className="num"><Amt v={r.nep_php} blank={splitFlags(r.flags).includes('column_dropped')} /></td>
                  {twoReadings && <td className="num"><Amt v={r.hgab2_php} /></td>}
                  <td className="num"><Amt v={houseKey === 'hgab3' ? r.hgab3_php : r.hgab2_php} strong blank={splitFlags(r.flags).includes('column_added')} /></td>
                  <td className="num"><DeltaCell delta={r.delta_php} base={r.nep_php} /></td>
                  <td><PageLinks row={r} dataset={dataset} docs={docs} /></td>
                </tr>
              );
            })}
            {!loading && !failed && !rows.length && (
              <tr>
                <td colSpan={colCount} className="nep-empty">
                  No rows match these filters.
                  {hasActiveFilters(filters) && (
                    <>
                      {' '}
                      <button type="button" className="nep-more" onClick={() => setParams(new URLSearchParams({ view: 'projects' }), { replace: true })}>
                        Clear filters
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="hgab-ds-pager">
        <button type="button" disabled={filters.page <= 1} onClick={() => update({ page: filters.page - 1 })}>← Previous</button>
        <span>
          {total != null
            ? total > 0
              ? `Rows ${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${total.toLocaleString()} · page ${filters.page} of ${pageCount}`
              : 'No rows'
            : 'Page ' + filters.page}
        </span>
        <button
          type="button"
          disabled={pageCount == null || filters.page >= pageCount}
          onClick={() => update({ page: filters.page + 1 })}
        >
          Next →
        </button>
        <select
          className="select-input"
          value={filters.size}
          onChange={(e) => update({ size: Number(e.target.value) })}
          aria-label="Rows per page"
        >
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n.toLocaleString()} per page</option>)}
        </select>
      </div>

      <p className="nep-hier-note">
        Rows are lines in the documents, not unique projects. A House line and an unmatched proposal
        line for the same project can both appear. Amounts are the pesos printed in each document, not
        money spent. A dash means that document has no such line; it is not zero. Region, office and
        {pap ? ` ${pap.toLowerCase()}` : ' program'} are as each document prints them; a project’s own page shows both sides.{' '}
        {dataset.has_readings
          ? '“Change” is the third reading minus the proposal, when both exist.'
          : '“Change” is the House bill minus the proposal, when both exist.'}
      </p>

      <HgabDetails>
        <p>
          Queried in the browser with DuckDB-Wasm over <code>hgab/2027/{key}/projects.parquet</code>
          {fresh ? <> in {fresh.ms.toLocaleString()} ms</> : null}. The CSV runs the same filter without the
          page limit. Unconfirmed matches are the <code>fuzzy_candidate</code> and <code>ambiguous</code> statuses.
        </p>
        <pre>{sql}</pre>
        <pre>{sumSql}</pre>
      </HgabDetails>
    </div>
  );
}
