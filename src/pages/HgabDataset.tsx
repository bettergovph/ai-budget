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
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip } from '../components/Nep2027Bits';
import {
  BridgeStrip, DatasetSwitch, DisclaimerNotice, HgabError, HgabHeader, HgabHero, HgabLoading,
  StageAmounts, StatusChip,
} from '../components/HgabBits';
import HgabProjects, { Amt, DeltaCell, PageLinks } from '../components/HgabProjects';
import * as fmt from '../lib/format';
import {
  BRIDGE_LABELS, HGAB_ROOT, HGAB_SOURCE_REPO, READING_LABELS, STAGE_LABELS,
  datasetPath, formatPct, isDatasetKey, loadHgabDataset, loadHgabOverview, pctChange, pdfUrl, recordPath,
  type BridgeGroup, type ControlRow, type DimKey, type DimRow, type HgabDatasetSummary,
  type HgabDocument, type HgabOverview, type ProjectRow,
} from '../lib/hgab';
import { controlHouseDoc, papLabel } from '../lib/hgab-query';
import '../hgab-dataset.css';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'projects', label: 'Projects' },
  { key: 'changes', label: 'Changes' },
  { key: 'readings', label: '2nd vs 3rd reading' },
  { key: 'documents', label: 'Documents' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

interface Loaded {
  key: string;
  overview: HgabOverview | null;
  summary: HgabDatasetSummary | null;
  err: string | null;
}

export default function HgabDataset() {
  const { dataset: key = '' } = useParams();
  const [params, setParams] = useSearchParams();
  // Keyed by dataset so a slow fetch for the previous route can never paint
  // over the current one.
  const [loaded, setLoaded] = useState<Loaded | null>(null);

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
    return <HgabError message={`There is no HGAB dataset called “${key}”. The four datasets are dpwh, fmr, hfep and nia.`} />;
  }
  if (current?.err) return <HgabError message={current.err} />;
  if (!summary || !overview || !d) return <HgabLoading what={`the ${key.toUpperCase()} dataset`} heroBlend />;

  const tabs = TABS.filter((t) => t.key !== 'readings' || d.has_readings);
  const view = params.get('view');
  const tab: TabKey = tabs.some((t) => t.key === view) ? (view as TabKey) : 'overview';

  const houseKey: 'hgab2' | 'hgab3' = d.totals.hgab3_php != null ? 'hgab3' : 'hgab2';
  const houseTotal = houseKey === 'hgab3' ? d.totals.hgab3_php : d.totals.hgab2_php;
  const houseCount = houseKey === 'hgab3' ? d.counts.hgab3 : d.counts.hgab2;
  const delta = houseTotal != null ? houseTotal - d.totals.nep_php : null;
  const pct = pctChange(houseTotal, d.totals.nep_php);
  const houseLabel = d.has_readings ? STAGE_LABELS[houseKey].short : 'House bill';
  // The scope runs to several sentences on the annexes; the KPI shows the first
  // and keeps the whole text on hover (the hero dek prints it in full).
  const scopeShort = d.scope.split(/(?<=\.)\s+|;\s+/)[0].replace(/[.;]$/, '');

  return (
    <>
      <HgabHeader
        crumb={d.short}
        compiledMeta={houseTotal != null ? `${fmt.shortPhp(houseTotal)} · ${houseLabel}` : undefined}
        heroBlend
      />

      <HgabHero crumb={d.agency} title={d.label} dek={`${d.grain}. ${d.scope}`} />

      <main className="nep-main">
        <div className="hgab-ds-switch"><DatasetSwitch current={d.key} /></div>

        <KpiStrip
          items={[
            {
              label: STAGE_LABELS.nep.short,
              value: fmt.shortPhp(d.totals.nep_php),
              sub: `${d.counts.nep.toLocaleString()} records · ${STAGE_LABELS.nep.label}`,
            },
            {
              label: houseLabel,
              value: houseTotal == null ? '—' : fmt.shortPhp(houseTotal),
              tone: delta == null ? undefined : delta >= 0 ? 'up' : 'down',
              sub: delta == null
                ? 'No House total for this population'
                : `${delta >= 0 ? '+' : '−'}${fmt.shortPhp(Math.abs(delta))} vs NEP · ${formatPct(pct)}`,
            },
            {
              label: 'Records per stage',
              value: `${d.counts.nep.toLocaleString()} → ${houseCount == null ? '—' : houseCount.toLocaleString()}`,
              sub: d.has_readings && d.counts.hgab2 != null && d.counts.hgab3 != null
                ? `NEP → House · 2R ${d.counts.hgab2.toLocaleString()} · 3R ${d.counts.hgab3.toLocaleString()} · compared, not added`
                : 'NEP → House records · compared, not added',
            },
            {
              label: 'Compared population',
              value: <span className="hgab-ds-kpi-text" title={d.scope}>{scopeShort}</span>,
              sub: `${summary.controls.length.toLocaleString()} ${d.controls_label.toLowerCase()}`,
            },
          ]}
        />

        <div className="nep-tabs" role="tablist" aria-label={`${d.short} views`}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={tab === t.key ? 'is-active' : ''}
              onClick={() => setParams(t.key === 'overview' ? {} : { view: t.key }, { replace: true })}
            >
              {t.label}
            </button>
          ))}
          <Link className="nep-tab-link" to={`/2027/d/${d.dept_id}`}>NEP group {d.dept_id} →</Link>
        </div>

        <section className="nep-section" role="tabpanel">
          {tab === 'overview' && <OverviewTab s={summary} docs={overview.documents} />}
          {tab === 'projects' && <HgabProjects dataset={d} docs={overview.documents} />}
          {tab === 'changes' && <ChangesTab s={summary} docs={overview.documents} />}
          {tab === 'readings' && d.has_readings && <ReadingsTab s={summary} docs={overview.documents} />}
          {tab === 'documents' && <DocumentsTab s={summary} docs={overview.documents} />}
        </section>

        <p className="nep-provenance">
          Built {new Date(overview.built_at).toLocaleString('en-PH')} from{' '}
          <a href={HGAB_SOURCE_REPO} target="_blank" rel="noopener">the extraction pipeline</a>
          {overview.source_commit && <> at <code>{overview.source_commit.slice(0, 7)}</code></>}
          {' '}· <Link to={`${HGAB_ROOT}/methodology`}>how pairing works and what the statuses mean</Link>
          {' '}· <Link to={`${HGAB_ROOT}/sources`}>documents and downloads</Link>
        </p>

        <DisclaimerNotice compact />
      </main>
      <SiteFooter source={`SOURCE: HOUSE BILL 10858 VS NEP · FY 2027 · ${d.agency.toUpperCase()}`} />
    </>
  );
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
  return (
    <>
      <SectionHead
        eyebrow="The bridge"
        headline={`From the NEP to ${STAGE_LABELS[b.house_stage].short}`}
        dek="Every comparison row sits in exactly one of these groups. Insertion and deletion are candidates produced by documented matching rules, not confirmed decisions."
      />
      <BridgeStrip bridge={b} dataset={d.key} />
      <p className="hgab-ds-identity">
        {identityHolds
          ? <>The five groups reconcile to the net to the peso. </>
          : <>The groups sum to <code>{fmt.php(check, { unit: 'full' })}</code> against a net of <code>{fmt.php(net, { unit: 'full' })}</code>; see Methodology. </>}
        Unchanged rows contribute zero by definition. Fuzzy and ambiguous rows are held out of these counts;{' '}
        <Link to={`${datasetPath(d.key, 'projects')}&held=only`}>see them under Projects</Link>.
      </p>

      <div className="nep-section">
        <SectionHead
          eyebrow={d.controls_label}
          headline="Printed controls, stage by stage"
          dek="The subtotals each document prints for this population. Columns are separate stages of the same budget — read them side by side, never add them. Page buttons open the source PDF at the cited page."
        />
        <ControlsTable s={s} docs={docs} />
      </div>

      {Object.keys(s.dims).length > 0 && (
        <div className="nep-section">
          <SectionHead
            eyebrow="Recorded labels"
            headline="House vs NEP by …"
            dek="Each side is tallied under its own recorded label. A paired project that the two documents file under different regions or offices counts once on each side, under each document's label — nothing is merged or inferred."
          />
          <DimTable s={s} />
        </div>
      )}
    </>
  );
}

type CtlSort = 'label' | 'nep' | 'hgab2' | 'hgab3' | 'delta' | 'reading';

function ControlsTable({ s, docs }: { s: HgabDatasetSummary; docs: HgabDocument[] }) {
  const d = s.dataset;
  const [sort, setSort] = useState<CtlSort>('nep');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [q, setQ] = useState('');
  const rows = s.controls;

  const hasGroup = rows.some((r) => r.group);
  const twoReadings = d.has_readings;
  const has2 = twoReadings && rows.some((r) => r.hgab2_php != null);
  const houseKey: 'hgab2' | 'hgab3' = rows.some((r) => r.hgab3_php != null) ? 'hgab3' : 'hgab2';
  const houseOf = useCallback(
    (r: ControlRow) => (houseKey === 'hgab3' ? r.hgab3_php : r.hgab2_php),
    [houseKey],
  );
  const nepDoc = d.documents.nep[0] ?? null;
  const houseDoc = controlHouseDoc(docs, d);
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

  // The footer proves the controls add up to the totals each document prints.
  // Usually one partition; when a dataset prints two alternative partitions of
  // the same money (HFEP: funding columns and facility categories) each group
  // is reconciled on its own, because adding them together would double count.
  const partitions = useMemo(() => {
    const add = (list: ControlRow[], pick: (r: ControlRow) => number | null) =>
      list.reduce<number | null>((acc, r) => { const v = pick(r); return v == null ? acc : (acc ?? 0) + v; }, null);
    // A partition may carry its own printed "Total" control (HFEP's funding
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
    return [{ label: `All ${rows.length.toLocaleString()} ${d.controls_label.toLowerCase()}`, rows, sums: all }];
  }, [rows, houseOf, houseKey, d.totals, d.controls_label]);

  const recon = (sum: number | null, printed: number | null) => {
    if (sum == null || printed == null) return null;
    const diff = sum - printed;
    return Math.abs(diff) < 1
      ? <span className="nep-recon-ok">= printed total</span>
      : <span className="nep-recon-bad" title={`Controls sum to ${fmt.php(sum, { unit: 'full' })}; printed total ${fmt.php(printed, { unit: 'full' })}`}>off by {fmt.shortPhp(Math.abs(diff))}</span>;
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

  if (!rows.length) return <p className="nep-empty">No printed controls for this dataset.</p>;

  const cols = 4 + (has2 ? 1 : 0) + (twoReadings ? 1 : 0) + 1;

  return (
    <div className="nep-table-block">
      <div className="nep-table-toolbar">
        <input
          className="text-input nep-filter"
          type="search"
          placeholder={`Filter ${d.controls_label.toLowerCase()}…`}
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
              {head('label', d.controls_label, 'nep-th-name')}
              {head('nep', STAGE_LABELS.nep.short, 'num', STAGE_LABELS.nep.label)}
              {has2 && head('hgab2', STAGE_LABELS.hgab2.short, 'num', STAGE_LABELS.hgab2.label)}
              {head('hgab3', twoReadings ? STAGE_LABELS[houseKey].short : 'House bill', 'num',
                twoReadings ? STAGE_LABELS[houseKey].label : 'Second and third reading print the same annex')}
              {head('delta', 'Δ vs NEP', 'num', 'Latest House reading minus NEP')}
              {twoReadings && head('reading', 'Δ 3R − 2R', 'num', 'Third reading minus second reading')}
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
                        NEP p.{r.nep_page}
                      </a>
                    )}
                    {r.house_pages.map((p) => houseDoc ? (
                      <a key={p} href={pdfUrl(houseDoc.key, p)} target="_blank" rel="noopener" title={`${docTitle(houseDoc.key)} — PDF page ${p}`}>
                        {houseDoc.reading}R p.{p}
                      </a>
                    ) : <span key={p}>House p.{p}</span>)}
                    {!r.nep_page && !r.house_pages.length && <span>—</span>}
                  </span>
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={cols} className="nep-empty">No controls match.</td></tr>}
          </tbody>
          <tfoot>
            {partitions.map(({ label, rows: part, sums }) => (
              <tr key={label}>
                <td className="nep-td-name">
                  {label}
                  {(partitions.length > 1 || sums.excluded > 0) && (
                    <span className="nep-code">
                      {(part.length - sums.excluded).toLocaleString()} controls summed
                      {sums.excluded > 0 && ` · the printed Total row is shown above but not added again`}
                      {partitions.length > 1 && ' · one partition of the same money'}
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
        Each column is checked against the total its own document prints. Stages are not additive: the
        columns describe the same population at different points in the budget process.
        {partitions.length > 1 && ' This dataset prints more than one breakdown of the same money; each is reconciled on its own and they must not be added together.'}
      </p>
    </div>
  );
}

const DIMS: ReadonlyArray<{ key: DimKey; label: string; param: string }> = [
  { key: 'region', label: 'Region', param: 'region' },
  { key: 'office_kind', label: 'Office kind', param: 'office' },
  { key: 'program', label: 'Program', param: 'program' },
  { key: 'pap', label: 'PAP', param: 'pap' },
];

type DimSort = 'label' | 'nep' | 'house' | 'delta';

function DimTable({ s }: { s: HgabDatasetSummary }) {
  const d = s.dataset;
  const present = DIMS.filter((x) => (s.dims[x.key]?.length ?? 0) > 0);
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

  function head(k: DimSort, text: string, cls = '') {
    const active = sort === k;
    return (
      <th className={`${cls} ${active ? 'nep-th-active' : ''}`.trim()}>
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
      <div className="hgab-ds-dims" role="group" aria-label="Dimension">
        {present.map((x) => (
          <button key={x.key} type="button" aria-pressed={x.key === dim.key} onClick={() => setDimKey(x.key)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="nep-table-wrap">
        <table className="nep-table">
          <thead>
            <tr>
              {head('label', dim.label, 'nep-th-name')}
              {head('nep', STAGE_LABELS.nep.short, 'num')}
              {head('house', 'House', 'num')}
              <th className="nep-th-bar" />
              {head('delta', 'Δ House − NEP', 'num')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const href = isBucket(r.label) ? null : `${datasetPath(d.key, 'projects')}&${dim.param}=${encodeURIComponent(r.label)}`;
              return (
                <tr key={r.label}>
                  <td className="nep-td-name">
                    {href ? <Link to={href} title="Open the projects filtered to this recorded label">{r.label}</Link> : r.label}
                    <span className="nep-code">{r.nep_records.toLocaleString()} NEP · {r.house_records.toLocaleString()} House records</span>
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
        Grey bar: NEP; blue bar: House, on one shared scale. Clicking a label opens the projects whose
        row-level label matches — the row carries the House label where both exist, so the filtered
        count can differ from the tally here.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

const CHANGE_GROUPS: readonly BridgeGroup[] = ['house_only', 'nep_only', 'increased', 'decreased', 'scope_review'];

function ChangesTab({ s, docs }: { s: HgabDatasetSummary; docs: HgabDocument[] }) {
  const d = s.dataset;
  return (
    <>
      <SectionHead
        eyebrow="Ranked lists"
        headline="What moved between the NEP and the House bill"
        dek={`The largest rows in each bridge group, by the amount the group is measured on. Counts and totals are comparison rows of the compared population; fuzzy and ambiguous rows are held out of these headline figures and can be inspected under Projects with the “Held only” toggle.`}
      />
      {CHANGE_GROUPS.map((g) => {
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
            <TopTable rows={rows} dataset={d} docs={docs} emptyLabel={`No ${meta.label.toLowerCase()} in this dataset.`} />
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
  return (
    <div className="nep-table-wrap">
      <table className="nep-table">
        <thead>
          <tr>
            <th className="hgab-ds-rank">#</th>
            <th className="nep-th-name">Project</th>
            <th>Region</th>
            {papLabel(dataset.key) && <th>{papLabel(dataset.key)}</th>}
            <th>Stage amounts</th>
            <th className="num">Δ vs NEP</th>
            <th>Status</th>
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
              {papLabel(dataset.key) && <td className="nep-td-dim" title={r.pap ?? undefined}>{r.pap ?? <span className="hgab-ds-null">—</span>}</td>}
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
  if (!r) return <p className="nep-empty">This dataset has a single House reading.</p>;
  const pct = pctChange(r.third_php, r.second_php);
  const statuses = Object.entries(r.status_counts).sort((a, b) => b[1] - a[1]);
  const houseDoc = controlHouseDoc(docs, d);
  const nepDoc = d.documents.nep[0] ?? null;
  return (
    <>
      <SectionHead
        eyebrow="Second vs third reading"
        headline="What the House changed between its own readings"
        dek="House Bill 10858 as printed for the second reading against the version printed for the third. Rows are keyed on title, PAP, region, office and funding zone; where a key repeats, rows are grouped rather than guessed."
      />
      <KpiStrip
        items={[
          { label: STAGE_LABELS.hgab2.short, value: fmt.shortPhp(r.second_php), sub: STAGE_LABELS.hgab2.label },
          { label: STAGE_LABELS.hgab3.short, value: fmt.shortPhp(r.third_php), sub: STAGE_LABELS.hgab3.label },
          {
            label: 'Δ third − second',
            value: `${r.delta_php >= 0 ? '+' : '−'}${fmt.shortPhp(Math.abs(r.delta_php))}`,
            tone: r.delta_php >= 0 ? 'up' : 'down',
            sub: formatPct(pct),
          },
          { label: 'New at third reading', value: r.third_only.length.toLocaleString(), sub: 'rows with no second-reading record' },
        ]}
      />

      <div className="nep-two-up">
        <div>
          <SectionHead size="sm" eyebrow="Reading status" headline="Rows by outcome" />
          <div className="nep-table-wrap">
            <table className="nep-table">
              <thead><tr><th className="nep-th-name">Outcome</th><th className="num">Rows</th></tr></thead>
              <tbody>
                {statuses.map(([k, n]) => (
                  <tr key={k}>
                    <td className="nep-td-name">
                      <Link to={`${datasetPath(d.key, 'projects')}&reading=${encodeURIComponent(k)}`}>{READING_LABELS[k] ?? k.replace(/_/g, ' ')}</Link>
                      <span className="nep-code">{k}</span>
                    </td>
                    <td className="num">{n.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <SectionHead size="sm" eyebrow="Controls that moved" headline="PAP controls with a reading difference" />
          {r.changed_controls.length ? (
            <div className="nep-table-wrap">
              <table className="nep-table">
                <thead>
                  <tr>
                    <th className="nep-th-name">Control</th>
                    <th className="num">{STAGE_LABELS.hgab2.short}</th>
                    <th className="num">{STAGE_LABELS.hgab3.short}</th>
                    <th className="num">Δ 3R − 2R</th>
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
                          {c.nep_page && nepDoc && <a href={pdfUrl(nepDoc, c.nep_page)} target="_blank" rel="noopener">NEP p.{c.nep_page}</a>}
                          {c.house_pages.map((p) => houseDoc && (
                            <a key={p} href={pdfUrl(houseDoc.key, p)} target="_blank" rel="noopener">{houseDoc.reading}R p.{p}</a>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="nep-empty">No control changed between readings.</p>}
        </div>
      </div>

      <div className="nep-section">
        <SectionHead
          size="sm"
          eyebrow="New at third reading"
          headline={`${r.third_only.length.toLocaleString()} rows with no second-reading record`}
          dek="Printed in the third-reading volume with no matching key in the second. These are reading differences inside the House bill, not NEP comparisons."
          right={<Link className="hgab-ds-seeall" to={`${datasetPath(d.key, 'projects')}&reading=third_only`}>Open in Projects →</Link>}
        />
        <TopTable rows={r.third_only} dataset={d} docs={docs} emptyLabel="No third-reading additions." />
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
        headline="The PDFs this dataset's evidence opens"
        dek="Every amount on these pages cites a page in one of these files. Hashes are of the files as downloaded; page ranges are the PDF file pages the extraction read, which differ from the printed folio."
      />
      <div className="nep-table-wrap hgab-ds-docs">
        <table className="nep-table">
          <thead>
            <tr>
              <th className="nep-th-name">Document</th>
              <th>Stage</th>
              <th>Pages used</th>
              <th className="num">Size</th>
              <th>SHA-256</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((doc) => (
              <tr key={doc.key}>
                <td className="nep-td-name">
                  {doc.title}
                  <span className="nep-code">{doc.key}{doc.volume ? ` · ${doc.volume}` : ''}</span>
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
                    {doc.source_url && <a href={doc.source_url} target="_blank" rel="noopener">Original ↗</a>}
                  </span>
                </td>
              </tr>
            ))}
            {missing.map((k) => (
              <tr key={k}>
                <td className="nep-td-name"><span className="nep-code">{k}</span></td>
                <td className="nep-td-dim" colSpan={5}>Not in the document catalogue.</td>
              </tr>
            ))}
            {!rows.length && !missing.length && <tr><td colSpan={6} className="nep-empty">No documents listed.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="nep-hier-note">
        The full catalogue, including downloads of the extracted tables, is on the{' '}
        <Link to={`${HGAB_ROOT}/sources`}>Sources</Link> page.
      </p>
    </>
  );
}

