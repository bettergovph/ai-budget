/**
 * `/hgab/2027/:dataset` — one program's House bill against the NEP.
 *
 * Everything above the Projects tab comes from a single `summary.json`, so
 * switching tabs is instant. Projects hands off to DuckDB-Wasm over the
 * dataset's parquet (see `HgabProjects`). Tabs are `?view=` so a tab is a
 * link; unknown views fall back to the overview.
 *
 * The numbers here are the workbench's, carried verbatim. Stage amounts are
 * compared and never summed across stages; "insertion" and "deletion" appear
 * only as candidates; held rows (fuzzy / ambiguous) are excluded from headline
 * counts and say so.
 *
 * Copy: plain first. The hero and KPIs read the dataset's reader-facing
 * `summary` and `caveats`; the technical `grain` and `scope` sit in
 * a "Details for analysts" block under the KPIs. Table headers and notes avoid
 * the workbench's vocabulary ("bridge", "ledger", "controls", "stages").
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip } from '../components/Nep2027Bits';
import {
  BridgeStrip, Caveats, DisclaimerNotice, HgabDetails, HgabError, HgabHeader, HgabHero,
  HgabLoading, StageAmounts, StatusChip, WhatThisMeans,
} from '../components/HgabBits';
import HgabProjects, { Amt, DeltaCell, PageLinks } from '../components/HgabProjects';
import HgabDownloads from '../components/HgabDownloads';
import * as fmt from '../lib/format';
import {
  BRIDGE_LABELS, HGAB_ROOT, HGAB_SOURCE_REPO, PLAIN_TERMS, READING_LABELS, STAGE_LABELS,
  datasetPath, formatPct, isDatasetKey, loadHgabDataset, loadHgabOverview, pctChange, pdfUrl, recordPath,
  type ControlRow, type DimKey, type DimRow, type HgabDatasetSummary,
  type HgabDocument, type HgabOverview, type ProjectRow,
} from '../lib/hgab';
import { papLabel } from '../lib/hgab-query';
import { MPB_ROOT } from '../lib/hgab-mpb';
import {
  SENATE_BUDGET_PORTAL, controlCitations, isSenatePortal, shownCitations, type HouseCitation,
} from '../lib/hgab-citations';
import {
  CHANGE_LIST_GROUPS, COMPARE_NOT_ADD, DATASET_SHORT, DIM_TABS, PLAIN, datasetCaveats, datasetSummary, hubViews,
  plainControlsLabel, sentenceCase, type HubView,
} from '../lib/hgab-ui';
import '../hgab-dataset.css';

// The map (outlines, points, its own styles) is fetched only when the Map tab
// is opened, so the hub's first load does not pay for it.
const HgabMap = lazy(() => import('../components/HgabMap'));

type TabKey = HubView;

interface Loaded {
  key: string;
  overview: HgabOverview | null;
  summary: HgabDatasetSummary | null;
  err: string | null;
}

export default function HgabDataset() {
  const { dataset: key = '' } = useParams();
  const [params] = useSearchParams();
  // Keyed by dataset so a slow fetch for the previous route can never paint
  // over the current one.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Rows the Projects view currently shows, for the Download CSV menu's label.
  const [projectsTotal, setProjectsTotal] = useState<number | null>(null);

  useEffect(() => {
    if (!isDatasetKey(key)) return;
    let live = true;
    Promise.all([loadHgabOverview(), loadHgabDataset(key)])
      .then(([overview, summary]) => { if (live) setLoaded({ key, overview, summary, err: null }); })
      .catch((e) => { if (live) setLoaded({ key, overview: null, summary: null, err: String(e?.message || e) }); });
    return () => { live = false; };
  }, [key]);

  const current = loaded?.key === key ? loaded : null;
  const summary = current?.summary ?? null;
  const overview = current?.overview ?? null;
  const d = summary?.dataset ?? null;

  useEffect(() => {
    if (d) document.title = `${d.label} · House bill vs NEP, FY2027 · BetterGov Budget`;
  }, [d]);

  if (!isDatasetKey(key)) {
    return <HgabError message={`There is no House-bill program called “${key}”. The four programs are dpwh, fmr, hfep and nia.`} />;
  }
  if (current?.err) return <HgabError message={current.err} />;
  // Overview keeps the navy band and the headline figures; the other views open
  // with a compact heading and go straight to their content.
  const viewParam = params.get('view');
  const wantsOverview = !viewParam || viewParam === 'overview';
  if (!summary || !overview || !d) return <HgabLoading what={`the ${key.toUpperCase()} program`} heroBlend={wantsOverview} />;

  const tabs = hubViews(d.has_readings);
  const view = params.get('view');
  const tab: TabKey = tabs.some((t) => t.key === view) ? (view as TabKey) : 'overview';
  const tabLabel = tabs.find((t) => t.key === tab)?.label ?? 'Overview';
  const isOverview = tab === 'overview';

  const houseKey: 'hgab2' | 'hgab3' = d.totals.hgab3_php != null ? 'hgab3' : 'hgab2';
  const houseTotal = houseKey === 'hgab3' ? d.totals.hgab3_php : d.totals.hgab2_php;
  const houseCount = houseKey === 'hgab3' ? d.counts.hgab3 : d.counts.hgab2;
  const delta = houseTotal != null ? houseTotal - d.totals.nep_php : null;
  const pct = pctChange(houseTotal, d.totals.nep_php);
  const houseLabel = d.has_readings ? STAGE_LABELS[houseKey].short : 'House bill';
  const plainSummary = datasetSummary(d);
  const caveats = datasetCaveats(d);
  const totalsLabel = plainControlsLabel(d.controls_label).toLowerCase();

  return (
    <>
      <HgabHeader
        crumb={DATASET_SHORT[d.key]}
        compiledMeta={houseTotal != null ? `${fmt.shortPhp(houseTotal)} · ${houseLabel}` : undefined}
        heroBlend={isOverview}
      />

      <HgabHero
        compact={!isOverview}
        crumb={isOverview ? d.agency : <>{d.agency}<span className="hgab-crumb-sep" aria-hidden="true">·</span><span className="hgab-crumb-here">{tabLabel}</span></>}
        title={d.label}
        dek={plainSummary}
      >
        <div className="hgab-ds-headtools">
          <HgabDownloads
            key={d.key}
            summary={summary}
            docs={overview.documents}
            view={tab}
            projectsTotal={projectsTotal}
            tone={isOverview ? 'dark' : 'light'}
          />
        </div>
      </HgabHero>

      <main className="nep-main">
        {isOverview && (
          <>
            <KpiStrip
              items={[
                {
                  label: STAGE_LABELS.nep.short,
                  value: fmt.shortPhp(d.totals.nep_php),
                  sub: `${d.counts.nep.toLocaleString()} rows in the ${STAGE_LABELS.nep.short}`,
                },
                {
                  label: houseLabel,
                  value: houseTotal == null ? '—' : fmt.shortPhp(houseTotal),
                  tone: delta == null ? undefined : delta >= 0 ? 'up' : 'down',
                  sub: delta == null
                    ? 'No House total for these projects'
                    : `${delta >= 0 ? '+' : '−'}${fmt.shortPhp(Math.abs(delta))} vs ${STAGE_LABELS.nep.short} · ${formatPct(pct)}`,
                },
                {
                  label: 'Rows in each version',
                  value: `${d.counts.nep.toLocaleString()} → ${houseCount == null ? '—' : houseCount.toLocaleString()}`,
                  sub: d.has_readings && d.counts.hgab2 != null && d.counts.hgab3 != null
                    ? `${STAGE_LABELS.nep.short} → House · 2R ${d.counts.hgab2.toLocaleString()} · 3R ${d.counts.hgab3.toLocaleString()} · ${COMPARE_NOT_ADD}`
                    : `${STAGE_LABELS.nep.short} → House · ${COMPARE_NOT_ADD}`,
                },
                {
                  label: 'What is compared',
                  value: <span className="hgab-ds-kpi-text" title={plainSummary}>The project lists, not the agency’s whole budget</span>,
                  sub: `${summary.controls.length.toLocaleString()} published totals, by ${singular(totalsLabel)}`,
                },
              ]}
            />

            <Caveats items={caveats} />

            <HgabDetails>
              <dl>
                <dt>Each row</dt>
                <dd>{d.grain}</dd>
                <dt>Scope</dt>
                <dd>{d.scope}</dd>
                <dt>Totals table</dt>
                <dd>{summary.controls.length.toLocaleString()} {d.controls_label.toLowerCase()} as published in the documents</dd>
              </dl>
            </HgabDetails>
          </>
        )}

        <div className="hgab-view-bar">
          <h2 className="hgab-view-title">{tabLabel}</h2>
          <Link className="nep-tab-link" to={`/2027/d/${d.dept_id}`} title={`Department group ${d.dept_id} in the NEP browser`}>
            This agency in the NEP →
          </Link>
        </div>

        <section className="nep-section" aria-label={tabLabel}>
          {tab === 'overview' && <OverviewTab s={summary} docs={overview.documents} />}
          {tab === 'projects' && <HgabProjects dataset={d} docs={overview.documents} onTotal={setProjectsTotal} />}
          {tab === 'changes' && <ChangesTab s={summary} docs={overview.documents} />}
          {tab === 'map' && (
            <Suspense fallback={<p className="nep-empty" role="status" aria-busy="true">Loading the map…</p>}>
              <HgabMap dataset={d} />
            </Suspense>
          )}
          {tab === 'readings' && d.has_readings && <ReadingsTab s={summary} docs={overview.documents} />}
          {tab === 'documents' && <DocumentsTab s={summary} docs={overview.documents} />}
        </section>

        <p className="nep-provenance">
          Built {new Date(overview.built_at).toLocaleString('en-PH')} from{' '}
          <a href={HGAB_SOURCE_REPO} target="_blank" rel="noopener">the analysis repository</a>
          {overview.source_commit && <> at <code>{overview.source_commit.slice(0, 7)}</code></>}
          {' '}· <Link to={`${HGAB_ROOT}/methodology`}>how lines were matched and what each label means</Link>
          {' '}· <Link to={`${HGAB_ROOT}/sources`}>documents and downloads</Link>
        </p>

        <DisclaimerNotice compact />
      </main>
      <SiteFooter source={`SOURCE: HOUSE BILL 10858 VS NEP · FY 2027 · ${d.agency.toUpperCase()}`} />
    </>
  );
}

/** "program lines" → "program line"; "regions" → "region"; "categories" → "category". */
function singular(plural: string): string {
  if (/ies$/.test(plural)) return plural.replace(/ies$/, 'y');
  return plural.replace(/s$/, '');
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewTab({ s, docs }: { s: HgabDatasetSummary; docs: HgabDocument[] }) {
  const d = s.dataset;
  const b = d.bridge;
  const net = b.net_php;
  const check = b.house_only.php - b.nep_only.php + b.increased.php - b.decreased.php + b.scope_review.php;
  const identityHolds = Math.abs(check - net) < 1;
  const houseLabel = d.has_readings ? STAGE_LABELS[b.house_stage].plain : 'the House bill';
  const netText = net === 0 ? 'no change' : `${net > 0 ? '+' : '−'}₱${fmt.shortPhp(Math.abs(net))}`;
  return (
    <>
      <SectionHead
        eyebrow="How the two versions differ"
        headline={`${sentenceCase(STAGE_LABELS.nep.plain)} to ${houseLabel}: ${netText}`}
        dek="The difference between the two totals, split into six groups by what happened to each line."
      />
      <BridgeStrip bridge={b} dataset={d.key} explain />
      <p className="hgab-ds-identity">
        {identityHolds
          ? <>The six groups add up to the difference exactly, to the peso. </>
          : <>The groups add up to <code>{fmt.php(check, { unit: 'full' })}</code> against a difference of <code>{fmt.php(net, { unit: 'full' })}</code>; see Methodology. </>}
        “Same amount in both” adds nothing to the difference. “In the House bill only” includes lines with a possible
        but unconfirmed match in the NEP;{' '}
        <Link to={`${datasetPath(d.key, 'projects')}&held=only`}>see them under Projects</Link>.
      </p>
      {d.key === 'dpwh' && (
        <p className="hgab-ds-identity">
          <Link to={MPB_ROOT}>Multi-purpose buildings in these lists, by DPWH office, region and amount →</Link>
        </p>
      )}

      <div className="nep-section">
        <SectionHead
          eyebrow={sentenceCase(plainControlsLabel(d.controls_label))}
          headline={`${s.controls.length.toLocaleString()} totals published in each document`}
          dek={`The subtotals each document publishes for these projects, side by side. The columns are ${COMPARE_NOT_ADD}. Page buttons open the source PDF at the cited page.`}
        />
        <ControlsTable s={s} docs={docs} />
      </div>

      {Object.keys(s.dims).length > 0 && (
        <div className="nep-section">
          <SectionHead
            eyebrow="By label"
            headline="House bill vs the NEP, by region, office or program"
            dek="Each side is tallied under the label its own document shows. A project filed under one region in the NEP and another in the House bill counts once on each side. Nothing is merged or guessed."
          />
          <DimTable s={s} />
        </div>
      )}
    </>
  );
}

type CtlSort = 'label' | 'nep' | 'hgab2' | 'hgab3' | 'delta' | 'reading';

/** "2R p.110 · 3R p.110": one link per House citation of a published total, opening the PDF at that page. */
function HousePageLinks({ cites, docTitle }: { cites: HouseCitation[]; docTitle: (k: string | null) => string }) {
  return (
    <>
      {cites.map((c) => c.doc ? (
        <a key={`${c.reading}:${c.page}`} href={pdfUrl(c.doc, c.page)} target="_blank" rel="noopener" title={`${docTitle(c.doc)} — PDF page ${c.page}`}>
          {c.reading}R p.{c.page}
        </a>
      ) : <span key={`${c.reading}:${c.page}`}>House p.{c.page}</span>)}
    </>
  );
}

function ControlsTable({ s, docs }: { s: HgabDatasetSummary; docs: HgabDocument[] }) {
  const d = s.dataset;
  const [sort, setSort] = useState<CtlSort>('nep');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [q, setQ] = useState('');
  const rows = s.controls;
  const totalsLabel = plainControlsLabel(d.controls_label).toLowerCase();

  const hasGroup = rows.some((r) => r.group);
  const twoReadings = d.has_readings;
  const has2 = twoReadings && rows.some((r) => r.hgab2_php != null);
  const houseKey: 'hgab2' | 'hgab3' = rows.some((r) => r.hgab3_php != null) ? 'hgab3' : 'hgab2';
  const houseOf = useCallback(
    (r: ControlRow) => (houseKey === 'hgab3' ? r.hgab3_php : r.hgab2_php),
    [houseKey],
  );
  const nepDoc = d.documents.nep[0] ?? null;
  const docTitle = (k: string | null) => docs.find((x) => x.key === k)?.title ?? k ?? '';

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((r) => r.label.toLowerCase().includes(needle) || (r.group ?? '').toLowerCase().includes(needle))
      : rows;
    const val = (r: ControlRow): number | string => {
      switch (sort) {
        case 'label': return `${r.group ?? ''} ${r.label}`.toLowerCase();
        case 'hgab2': return r.hgab2_php ?? -Infinity;
        case 'hgab3': return houseOf(r) ?? -Infinity;
        case 'delta': return r.delta_php ?? -Infinity;
        case 'reading': return r.reading_delta_php ?? -Infinity;
        default: return r.nep_php ?? -Infinity;
      }
    };
    const m = dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * m;
      return (av - bv) * m;
    });
  }, [rows, q, sort, dir, houseOf]);

  // The footer proves the printed subtotals add up to the totals each document
  // prints. Usually one partition; when a dataset prints two alternative
  // breakdowns of the same money (HFEP: funding columns and facility
  // categories) each group is reconciled on its own, because adding them
  // together would double count.
  const partitions = useMemo(() => {
    const add = (list: ControlRow[], pick: (r: ControlRow) => number | null) =>
      list.reduce<number | null>((acc, r) => { const v = pick(r); return v == null ? acc : (acc ?? 0) + v; }, null);
    // A partition may carry its own printed "Total" row (HFEP's funding
    // columns do). It is shown as a row but left out of the partition's sum.
    const isTotalRow = (r: ControlRow, list: ControlRow[]) => {
      if (/(^|[:/ ])total$/i.test(r.id) || /^total\b/i.test(r.label)) return true;
      if (list.length < 3) return false;
      const others = list.filter((x) => x !== r);
      return r.nep_php != null && r.nep_php === add(others, (x) => x.nep_php)
        && houseOf(r) != null && houseOf(r) === add(others, houseOf);
    };
    const sumsOf = (list: ControlRow[]) => {
      const body = list.filter((r) => !isTotalRow(r, list));
      return {
        nep: add(body, (r) => r.nep_php), hgab2: add(body, (r) => r.hgab2_php), house: add(body, houseOf),
        excluded: list.length - body.length,
      };
    };
    const printedHouse = houseKey === 'hgab3' ? d.totals.hgab3_php : d.totals.hgab2_php;
    const close = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) < 1;
    const all = sumsOf(rows);
    const groups = [...new Set(rows.map((r) => r.group).filter((g): g is string => Boolean(g)))];
    if (!close(all.nep, d.totals.nep_php) && groups.length > 1) {
      const byGroup = groups.map((g) => ({ label: g, rows: rows.filter((r) => r.group === g) }))
        .map((p) => ({ ...p, sums: sumsOf(p.rows) }));
      // Alternative partitions: every group alone is (close to) the printed total.
      if (byGroup.some((p) => close(p.sums.nep, d.totals.nep_php) || close(p.sums.house, printedHouse))) return byGroup;
    }
    return [{ label: `All ${rows.length.toLocaleString()} ${totalsLabel}`, rows, sums: all }];
  }, [rows, houseOf, houseKey, d.totals, totalsLabel]);

  const recon = (sum: number | null, printed: number | null) => {
    if (sum == null || printed == null) return null;
    const diff = sum - printed;
    return Math.abs(diff) < 1
      ? <span className="nep-recon-ok" title="These subtotals add up to the total used on this page">= the total above</span>
      : <span className="nep-recon-bad" title={`These subtotals add up to ${fmt.php(sum, { unit: 'full' })}; the total used on this page is ${fmt.php(printed, { unit: 'full' })}. The notes under “What is compared” explain any gap.`}>off by {fmt.shortPhp(Math.abs(diff))}</span>;
  };

  function head(k: CtlSort, text: string, cls = '', title?: string) {
    const active = sort === k;
    return (
      <th className={`${cls} ${active ? 'nep-th-active' : ''}`.trim()} title={title}>
        <button
          type="button"
          onClick={() => {
            if (active) setDir(dir === 'asc' ? 'desc' : 'asc');
            else { setSort(k); setDir(k === 'label' ? 'asc' : 'desc'); }
          }}
        >
          {text}<span className="nep-sort-caret">{active ? (dir === 'asc' ? '▲' : '▼') : ''}</span>
        </button>
      </th>
    );
  }

  if (!rows.length) return <p className="nep-empty">The documents publish no subtotals for this program.</p>;

  const cols = 4 + (has2 ? 1 : 0) + (twoReadings ? 1 : 0) + 1;

  return (
    <div className="nep-table-block">
      <div className="nep-table-toolbar">
        <input
          className="text-input nep-filter"
          type="search"
          placeholder={`Filter ${totalsLabel}…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="nep-table-count">
          {shown.length.toLocaleString()} {shown.length === 1 ? 'row' : 'rows'}
          {shown.length !== rows.length && ` of ${rows.length.toLocaleString()}`}
        </span>
      </div>
      <div className="nep-table-wrap">
        <table className="nep-table hgab-ds-controls">
          <thead>
            <tr>
              {head('label', sentenceCase(plainControlsLabel(d.controls_label)), 'nep-th-name')}
              {head('nep', STAGE_LABELS.nep.short, 'num', STAGE_LABELS.nep.label)}
              {has2 && head('hgab2', STAGE_LABELS.hgab2.short, 'num', STAGE_LABELS.hgab2.label)}
              {head('hgab3', twoReadings ? STAGE_LABELS[houseKey].short : 'House bill', 'num',
                twoReadings ? STAGE_LABELS[houseKey].label : 'House bill; the second and third reading publish the same list')}
              {head('delta', `Change from the ${STAGE_LABELS.nep.short}`, 'num', 'Latest House reading minus the NEP')}
              {twoReadings && head('reading', '3R − 2R', 'num', 'Third reading minus second reading')}
              <th>Pages</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="nep-td-name">
                  {r.label}
                  {hasGroup && r.group && <span className="nep-code">{r.group}</span>}
                </td>
                <td className="num"><Amt v={r.nep_php} /></td>
                {has2 && <td className="num"><Amt v={r.hgab2_php} /></td>}
                <td className="num"><Amt v={houseOf(r)} strong /></td>
                <td className="num"><DeltaCell delta={r.delta_php} base={r.nep_php} /></td>
                {twoReadings && <td className="num"><DeltaCell delta={r.reading_delta_php} base={r.hgab2_php} /></td>}
                <td>
                  <span className="hgab-ds-pages">
                    {r.nep_page && nepDoc && (
                      <a href={pdfUrl(nepDoc, r.nep_page)} target="_blank" rel="noopener" title={`${docTitle(nepDoc)} — PDF page ${r.nep_page}`}>
                        {STAGE_LABELS.nep.short} p.{r.nep_page}
                      </a>
                    )}
                    <HousePageLinks cites={shownCitations(controlCitations(r, d, docs), d)} docTitle={docTitle} />
                    {!r.nep_page && !r.house_pages.length && <span>—</span>}
                  </span>
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={cols} className="nep-empty">Nothing matches.</td></tr>}
          </tbody>
          <tfoot>
            {partitions.map(({ label, rows: part, sums }) => (
              <tr key={label}>
                <td className="nep-td-name">
                  {label}
                  {(partitions.length > 1 || sums.excluded > 0) && (
                    <span className="nep-code">
                      {(part.length - sums.excluded).toLocaleString()} rows added up
                      {sums.excluded > 0 && ' · the published Total row is shown above but not added again'}
                      {partitions.length > 1 && ' · one way of splitting the same money'}
                    </span>
                  )}
                </td>
                <td className="num"><Amt v={sums.nep} /> <span className="nep-code">{recon(sums.nep, d.totals.nep_php)}</span></td>
                {has2 && <td className="num"><Amt v={sums.hgab2} /> <span className="nep-code">{recon(sums.hgab2, d.totals.hgab2_php)}</span></td>}
                <td className="num"><Amt v={sums.house} strong /> <span className="nep-code">{recon(sums.house, houseKey === 'hgab3' ? d.totals.hgab3_php : d.totals.hgab2_php)}</span></td>
                <td className="num"><DeltaCell delta={sums.house != null && sums.nep != null ? sums.house - sums.nep : null} base={sums.nep} /></td>
                {twoReadings && <td className="num"><DeltaCell delta={sums.house != null && sums.hgab2 != null ? sums.house - sums.hgab2 : null} base={sums.hgab2} /></td>}
                <td />
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
      <p className="nep-hier-note">
        Each column is checked against that document’s total for this program. The columns are {COMPARE_NOT_ADD}.
        {partitions.length > 1 && ' The documents publish two ways of splitting this program’s money. Each is checked on its own; do not add them together.'}
      </p>
    </div>
  );
}

type DimSort = 'label' | 'nep' | 'house' | 'delta';

function DimTable({ s }: { s: HgabDatasetSummary }) {
  const d = s.dataset;
  const present = DIM_TABS.filter((x) => (s.dims[x.key]?.length ?? 0) > 0);
  const [dimKey, setDimKey] = useState<DimKey>(present[0]?.key ?? 'region');
  const [sort, setSort] = useState<DimSort>('house');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const dim = present.find((x) => x.key === dimKey) ?? present[0];
  // At most a few dozen labels per dimension: sorting on every render is free.
  const rows: DimRow[] = dim ? s.dims[dim.key] ?? [] : [];
  const val = (r: DimRow): number | string => {
    switch (sort) {
      case 'label': return r.label.toLowerCase();
      case 'nep': return r.nep_php;
      case 'delta': return r.house_php - r.nep_php;
      default: return r.house_php;
    }
  };
  const m = dir === 'asc' ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * m;
    return (av - bv) * m;
  });

  const max = Math.max(1, ...rows.map((r) => Math.max(r.nep_php, r.house_php)));
  const nepTotal = rows.reduce((a, r) => a + r.nep_php, 0);
  const houseTotal = rows.reduce((a, r) => a + r.house_php, 0);

  function head(k: DimSort, text: string, cls = '', title?: string) {
    const active = sort === k;
    return (
      <th className={`${cls} ${active ? 'nep-th-active' : ''}`.trim()} title={title}>
        <button
          type="button"
          onClick={() => {
            if (active) setDir(dir === 'asc' ? 'desc' : 'asc');
            else { setSort(k); setDir(k === 'label' ? 'asc' : 'desc'); }
          }}
        >
          {text}<span className="nep-sort-caret">{active ? (dir === 'asc' ? '▲' : '▼') : ''}</span>
        </button>
      </th>
    );
  }

  if (!dim) return null;
  const isBucket = (label: string) => /^\(|^—$|^none$|^unassigned$/i.test(label);

  return (
    <div className="nep-table-block">
      <div className="hgab-ds-dims" role="group" aria-label="Group the rows by">
        {present.map((x) => (
          <button key={x.key} type="button" aria-pressed={x.key === dim.key} onClick={() => setDimKey(x.key)} title={x.help}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="nep-table-wrap">
        <table className="nep-table">
          <thead>
            <tr>
              {head('label', dim.label, 'nep-th-name', dim.help)}
              {head('nep', STAGE_LABELS.nep.short, 'num', STAGE_LABELS.nep.label)}
              {head('house', 'House', 'num', 'The House bill, latest reading')}
              <th className="nep-th-bar" />
              {head('delta', `Change from the ${STAGE_LABELS.nep.short}`, 'num', 'House bill minus the NEP')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const href = isBucket(r.label) ? null : `${datasetPath(d.key, 'projects')}&${dim.param}=${encodeURIComponent(r.label)}`;
              return (
                <tr key={r.label}>
                  <td className="nep-td-name">
                    {href ? <Link to={href} title="Open the projects filed under this label">{r.label}</Link> : r.label}
                    <span className="nep-code">{r.nep_records.toLocaleString()} {STAGE_LABELS.nep.short} · {r.house_records.toLocaleString()} House rows</span>
                  </td>
                  <td className="num nep-td-base"><Amt v={r.nep_php} /></td>
                  <td className="num"><Amt v={r.house_php} strong /></td>
                  <td className="nep-td-bar">
                    <span className="hgab-ds-barpair" aria-hidden="true">
                      <span className="is-nep" style={{ '--w': `${(r.nep_php / max) * 100}%` } as CSSProperties} />
                      <span className="is-house" style={{ '--w': `${(r.house_php / max) * 100}%` } as CSSProperties} />
                    </span>
                  </td>
                  <td className="num"><DeltaCell delta={r.house_php - r.nep_php} base={r.nep_php} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="nep-td-name">All {rows.length.toLocaleString()} {dim.label.toLowerCase()} labels</td>
              <td className="num nep-td-base"><Amt v={nepTotal} /></td>
              <td className="num"><Amt v={houseTotal} strong /></td>
              <td />
              <td className="num"><DeltaCell delta={houseTotal - nepTotal} base={nepTotal} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="nep-hier-note">
        Grey bar: the NEP. Blue bar: the House bill. Both on one shared scale. Click a
        label to open those projects. A paired row carries the House label where both exist, so the
        filtered count can differ from the tally here.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

function ChangesTab({ s, docs }: { s: HgabDatasetSummary; docs: HgabDocument[] }) {
  const d = s.dataset;
  return (
    <>
      <SectionHead
        eyebrow="Largest changes"
        headline="What moved between the NEP and the House bill"
        dek={`The largest lines in each group, by the amount that group counts. Unconfirmed matches are left out of these lists; see them under Projects with “Unconfirmed only”.`}
      />
      <WhatThisMeans>{PLAIN.candidateMeans}</WhatThisMeans>
      {CHANGE_LIST_GROUPS.map((g) => {
        const rows = s.top[g] ?? [];
        const cell = d.bridge[g];
        const meta = BRIDGE_LABELS[g];
        return (
          <div className={`hgab-ds-change is-${g}`} key={g}>
            <SectionHead
              size="sm"
              eyebrow={meta.sub}
              headline={`${meta.label} · ${cell.rows.toLocaleString()} rows · ${fmt.shortPhp(Math.abs(cell.php))}`}
              dek={meta.help}
              right={
                <Link className="hgab-ds-seeall" to={`${datasetPath(d.key, 'projects')}&group=${g}&held=hide`}>
                  See all {cell.rows.toLocaleString()} in Projects →
                </Link>
              }
            />
            <TopTable rows={rows} dataset={d} docs={docs} emptyLabel={`No rows in “${meta.label}” for this program.`} />
          </div>
        );
      })}
    </>
  );
}

function TopTable({
  rows,
  dataset,
  docs,
  emptyLabel,
}: {
  rows: ProjectRow[];
  dataset: HgabDatasetSummary['dataset'];
  docs: HgabDocument[];
  emptyLabel: string;
}) {
  if (!rows.length) return <p className="nep-empty">{emptyLabel}</p>;
  const pap = papLabel(dataset.key);
  return (
    <div className="nep-table-wrap">
      <table className="nep-table">
        <thead>
          <tr>
            <th className="hgab-ds-rank">#</th>
            <th className="nep-th-name">Project</th>
            <th>Region</th>
            {pap && <th title={dataset.key === 'dpwh' ? PLAIN_TERMS.pap.meaning : undefined}>{pap}</th>}
            <th title={COMPARE_NOT_ADD}>Amount in each version</th>
            <th className="num" title="Latest House reading minus the NEP">Change from the {STAGE_LABELS.nep.short}</th>
            <th>What happened to this line</th>
            <th>Pages</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td className="hgab-ds-rank">{i + 1}</td>
              <td className="nep-td-name">
                <Link to={recordPath(dataset.key, r.id)}>{r.title}</Link>
                {r.office && <span className="nep-code">{r.office}</span>}
              </td>
              <td className="nep-td-dim">{r.region ?? <span className="hgab-ds-null">—</span>}</td>
              {pap && <td className="nep-td-dim" title={r.pap ?? undefined}>{r.pap ?? <span className="hgab-ds-null">—</span>}</td>}
              <td><StageAmounts row={r} /></td>
              <td className="num"><DeltaCell delta={r.delta_php} base={r.nep_php} /></td>
              <td><StatusChip trace={r.trace} /></td>
              <td><PageLinks row={r} dataset={dataset} docs={docs} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Readings (DPWH)
// ---------------------------------------------------------------------------

function ReadingsTab({ s, docs }: { s: HgabDatasetSummary; docs: HgabDocument[] }) {
  const d = s.dataset;
  const r = s.readings;
  if (!r) return <p className="nep-empty">The House published this program once; there is no second version to compare.</p>;
  const pct = pctChange(r.third_php, r.second_php);
  const statuses = Object.entries(r.status_counts).sort((a, b) => b[1] - a[1]);
  const docTitle = (k: string | null) => docs.find((x) => x.key === k)?.title ?? k ?? '';
  const nepDoc = d.documents.nep[0] ?? null;
  return (
    <>
      <SectionHead
        eyebrow="Second vs third reading"
        headline="Changes between the House’s second and third reading"
        dek={`${PLAIN_TERMS.reading.meaning} This compares the text published for each vote.`}
      />
      <HgabDetails>
        <p>
          Rows are keyed on title, PAP, region, office and funding zone. Where a key repeats, the rows
          are grouped rather than guessed. Second-reading rows cite Volume I-C of the second-reading
          text; third-reading rows cite Volume I-C of the third.
        </p>
      </HgabDetails>
      <KpiStrip
        items={[
          { label: STAGE_LABELS.hgab2.short, value: fmt.shortPhp(r.second_php), sub: STAGE_LABELS.hgab2.label },
          { label: STAGE_LABELS.hgab3.short, value: fmt.shortPhp(r.third_php), sub: STAGE_LABELS.hgab3.label },
          {
            label: 'Third minus second',
            value: `${r.delta_php >= 0 ? '+' : '−'}${fmt.shortPhp(Math.abs(r.delta_php))}`,
            tone: r.delta_php >= 0 ? 'up' : 'down',
            sub: formatPct(pct),
          },
          { label: 'New at third reading', value: r.third_only.length.toLocaleString(), sub: 'rows not in the second-reading text' },
        ]}
      />

      <div className="nep-two-up">
        <div>
          <SectionHead size="sm" eyebrow="Between the two votes" headline="Rows by what happened" />
          <div className="nep-table-wrap">
            <table className="nep-table">
              <thead><tr><th className="nep-th-name">What happened</th><th className="num">Rows</th></tr></thead>
              <tbody>
                {statuses.map(([k, n]) => (
                  <tr key={k}>
                    <td className="nep-td-name">
                      <Link to={`${datasetPath(d.key, 'projects')}&reading=${encodeURIComponent(k)}`} title={`Code: ${k}`}>{READING_LABELS[k] ?? k.replace(/_/g, ' ')}</Link>
                    </td>
                    <td className="num">{n.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <SectionHead size="sm" eyebrow="Totals that moved" headline="Program lines whose published total changed" />
          {r.changed_controls.length ? (
            <div className="nep-table-wrap">
              <table className="nep-table">
                <thead>
                  <tr>
                    <th className="nep-th-name" title={PLAIN_TERMS.pap.meaning}>Program line</th>
                    <th className="num">{STAGE_LABELS.hgab2.short}</th>
                    <th className="num">{STAGE_LABELS.hgab3.short}</th>
                    <th className="num" title="Third reading minus second reading">3R − 2R</th>
                    <th>Pages</th>
                  </tr>
                </thead>
                <tbody>
                  {r.changed_controls.map((c) => (
                    <tr key={c.id}>
                      <td className="nep-td-name">{c.label}{c.group && <span className="nep-code">{c.group}</span>}</td>
                      <td className="num"><Amt v={c.hgab2_php} /></td>
                      <td className="num"><Amt v={c.hgab3_php} strong /></td>
                      <td className="num"><DeltaCell delta={c.reading_delta_php} base={c.hgab2_php} /></td>
                      <td>
                        <span className="hgab-ds-pages">
                          {c.nep_page && nepDoc && <a href={pdfUrl(nepDoc, c.nep_page)} target="_blank" rel="noopener">{STAGE_LABELS.nep.short} p.{c.nep_page}</a>}
                          <HousePageLinks cites={controlCitations(c, d, docs)} docTitle={docTitle} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="nep-empty">No published total changed between the two votes.</p>}
        </div>
      </div>

      <div className="nep-section">
        <SectionHead
          size="sm"
          eyebrow="New at third reading"
          headline={`${r.third_only.length.toLocaleString()} rows not in the second-reading text`}
          dek="Listed in the third-reading volume with no matching line in the second. These are changes inside the House bill itself, not comparisons with the NEP."
          right={<Link className="hgab-ds-seeall" to={`${datasetPath(d.key, 'projects')}&reading=third_only`}>Open in Projects →</Link>}
        />
        <TopTable rows={r.third_only} dataset={d} docs={docs} emptyLabel="Nothing was added at third reading." />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

function DocumentsTab({ s, docs }: { s: HgabDatasetSummary; docs: HgabDocument[] }) {
  const d = s.dataset;
  const keys = [...d.documents.nep, ...d.documents.house];
  const rows = keys.map((k) => docs.find((x) => x.key === k)).filter((x): x is HgabDocument => Boolean(x));
  const missing = keys.filter((k) => !docs.some((x) => x.key === k));
  return (
    <>
      <SectionHead
        eyebrow="Source documents"
        headline="The PDFs behind this program’s figures"
        dek="Every amount on these pages cites a page in one of these files. Page numbers count PDF file pages, not the page numbers shown on the page. The fingerprint identifies the exact copy we read."
      />
      <div className="nep-table-wrap hgab-ds-docs">
        <table className="nep-table">
          <thead>
            <tr>
              <th className="nep-th-name">Document</th>
              <th>Version</th>
              <th>Pages used</th>
              <th className="num">Size</th>
              <th title="SHA-256 checksum of the file as retained">Fingerprint</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((doc) => (
              <tr key={doc.key}>
                <td className="nep-td-name">
                  {doc.title}
                  {doc.notes && <span className="nep-code">{doc.notes}</span>}
                </td>
                <td className="nep-td-dim">
                  {doc.stage === 'nep' ? STAGE_LABELS.nep.label : `House bill, ${doc.reading === 2 ? 'second' : doc.reading === 3 ? 'third' : ''} reading`}
                </td>
                <td className="nep-td-dim">{doc.pages ? `${doc.pages.from.toLocaleString()}–${doc.pages.to.toLocaleString()}` : '—'}</td>
                <td className="num">{doc.bytes ? `${(doc.bytes / 1e6).toFixed(1)} MB` : '—'}</td>
                <td><span className="hgab-ds-sha" title={doc.sha256}>{doc.sha256.slice(0, 12)}…</span></td>
                <td>
                  <span className="hgab-ds-pages">
                    <a href={pdfUrl(doc.key, doc.pages?.from ?? null)} target="_blank" rel="noopener">Open PDF ↗</a>
                    {doc.source_url && (
                      <a href={doc.source_url} target="_blank" rel="noopener" title={isSenatePortal(doc.source_url) ? `Official copy: ${SENATE_BUDGET_PORTAL.name}` : 'Where the original was published'}>
                        {isSenatePortal(doc.source_url) ? SENATE_BUDGET_PORTAL.short : 'Original'} ↗
                      </a>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {missing.map((k) => (
              <tr key={k}>
                <td className="nep-td-name"><span className="nep-code">{k}</span></td>
                <td className="nep-td-dim" colSpan={5}>Not in the document list.</td>
              </tr>
            ))}
            {!rows.length && !missing.length && <tr><td colSpan={6} className="nep-empty">No documents listed.</td></tr>}
          </tbody>
        </table>
      </div>
      <HgabDetails>
        <dl>
          {rows.map((doc) => (
            <div key={doc.key} style={{ display: 'contents' }}>
              <dt>{doc.key}</dt>
              <dd>{doc.volume ? `${/^[IVX]+(-[A-Z])?\b/.test(doc.volume) ? 'Volume ' : ''}${doc.volume} · ` : ''}SHA-256 <code>{doc.sha256}</code></dd>
            </div>
          ))}
        </dl>
      </HgabDetails>
      <p className="nep-hier-note">
        The full list, with downloads of the extracted tables, is on the{' '}
        <Link to={`${HGAB_ROOT}/sources`}>Sources</Link> page.
      </p>
    </>
  );
}
