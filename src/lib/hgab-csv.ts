/**
 * CSV downloads for a program hub (`/hgab/2027/:dataset`): one builder per
 * table the hub shows, plus the file names. The hub's "Download CSV" menu
 * (`components/HgabDownloads.tsx`) calls these; the project tables reuse
 * `projectCsvColumns` from `hgab-query.ts`, so every download that lists
 * project rows has the Projects export's columns.
 *
 * Pure (no React, no DuckDB, no `window`): rows in, CSV text out.
 *
 * Rules every builder keeps:
 *   - amounts are integer pesos exactly as published: no peso sign, no
 *     thousands separators, no rounding;
 *   - null stays an empty cell, never 0;
 *   - the NEP and each House reading are separate columns, never summed;
 *   - a status code always has a plain label column beside it;
 *   - headers are snake_case; rows keep the data's own order unless the
 *     view ranks them (largest changes, statuses by count).
 */
import {
  BRIDGE_LABELS, BRIDGE_ORDER, HGAB_YEAR, REGION_LABELS, REGION_ORDER, STAGE_LABELS, pctChange, regionKeyOf, traceInfo,
  type BridgeGroup, type ControlRow, type DatasetKey, type DimRow, type HgabDatasetMap, type HgabDatasetMeta,
  type HgabDatasetSummary, type HgabDocument, type MapPoint, type MapRegion, type ProjectRow, type RegionKey,
} from './hgab';
import { SENATE_BUDGET_PORTAL, controlCitations, isSenatePortal, type HouseCitation } from './hgab-citations';
import { projectCsvColumns, readingLabel, tableCsv, type CsvColumn } from './hgab-query';
import { CHANGE_LIST_GROUPS, DIM_TABS } from './hgab-ui';

type Docs = readonly HgabDocument[];

/** `bettergov-house-bill-2027-dpwh-program-totals.csv` */
export function csvFileName(dataset: DatasetKey, table: string): string {
  return `bettergov-house-bill-${HGAB_YEAR}-${dataset}-${table}.csv`;
}

/** Rows in the program's project table: every line lands in exactly one of the six groups. */
export function projectRowCount(dataset: Pick<HgabDatasetMeta, 'bridge'>): number {
  return BRIDGE_ORDER.reduce((n, g) => n + dataset.bridge[g].rows, 0);
}

/** Project columns behind a few leading columns of the caller's own. */
function withProjectColumns<T extends { r: ProjectRow }>(lead: CsvColumn<T>[], dataset: DatasetKey): CsvColumn<T>[] {
  return [...lead, ...projectCsvColumns(dataset).map((c) => ({ key: c.key, pick: (x: T) => c.pick(x.r) }))];
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/** "110;111": the pages one reading cites, in order. */
function pagesOf(cites: readonly HouseCitation[], reading: 2 | 3): { pages: string | null; doc: string | null } {
  const mine = cites.filter((c) => c.reading === reading);
  return { pages: mine.length ? mine.map((c) => c.page).join(';') : null, doc: mine[0]?.doc ?? null };
}

/**
 * Program totals as published (`summary.json` controls, or the readings'
 * changed totals), in the data's order. Pages and document keys follow
 * `hgab-citations.ts`: the NEP page in the program's NEP document; each House
 * reading's pages in the document `controlCitations` names for it.
 */
export function programTotalsCsv(rows: readonly ControlRow[], dataset: HgabDatasetMeta, docs: Docs): string {
  const nepDoc = dataset.documents.nep[0] ?? null;
  const items = rows.map((r) => {
    const cites = controlCitations(r, dataset, docs);
    return { r, h2: pagesOf(cites, 2), h3: pagesOf(cites, 3) };
  });
  return tableCsv<(typeof items)[number]>([
    { key: 'id', pick: ({ r }) => r.id },
    { key: 'group', pick: ({ r }) => r.group },
    { key: 'label', pick: ({ r }) => r.label },
    { key: 'nep_php', pick: ({ r }) => r.nep_php },
    { key: 'hgab2_php', pick: ({ r }) => r.hgab2_php },
    { key: 'hgab3_php', pick: ({ r }) => r.hgab3_php },
    { key: 'delta_house_minus_nep_php', pick: ({ r }) => r.delta_php },
    { key: 'delta_3r_minus_2r_php', pick: ({ r }) => r.reading_delta_php },
    { key: 'nep_page', pick: ({ r }) => r.nep_page },
    { key: 'nep_doc', pick: ({ r }) => (r.nep_page ? nepDoc : null) },
    { key: 'hgab2_pages', pick: (x) => x.h2.pages },
    { key: 'hgab2_doc', pick: (x) => x.h2.doc },
    { key: 'hgab3_pages', pick: (x) => x.h3.pages },
    { key: 'hgab3_doc', pick: (x) => x.h3.doc },
  ], items);
}

/**
 * The sign each group's amount carries in House − NEP (see `BridgeStrip`).
 * Different stretches carry their own sign; "Same amount in both" adds nothing.
 */
function contribution(g: BridgeGroup, php: number): number {
  switch (g) {
    case 'house_only':
    case 'increased': return Math.abs(php);
    case 'nep_only':
    case 'decreased': return -Math.abs(php);
    case 'scope_review': return php;
    default: return 0;
  }
}

/**
 * The six groups every line lands in: rows, each version's pesos, the amount
 * the group counts, and what it adds to House − NEP. The contributions add up
 * to the difference between the two totals, to the peso.
 */
export function changeSummaryCsv(dataset: HgabDatasetMeta): string {
  const b = dataset.bridge;
  return tableCsv<BridgeGroup>([
    { key: 'group', pick: (g) => g },
    { key: 'group_label', pick: (g) => BRIDGE_LABELS[g].label },
    { key: 'group_note', pick: (g) => BRIDGE_LABELS[g].sub },
    { key: 'rows', pick: (g) => b[g].rows },
    { key: 'nep_php', pick: (g) => b[g].nep_php ?? null },
    { key: 'house_php', pick: (g) => b[g].house_php ?? null },
    { key: 'house_stage', pick: () => b.house_stage },
    { key: 'amount_php', pick: (g) => Math.abs(b[g].php) },
    { key: 'contribution_to_change_php', pick: (g) => contribution(g, b[g].php) },
  ], BRIDGE_ORDER);
}

function dimRows(s: HgabDatasetSummary): Array<{ dim: (typeof DIM_TABS)[number]; r: DimRow }> {
  return DIM_TABS.flatMap((dim) => (s.dims[dim.key] ?? []).map((r) => ({ dim, r })));
}

export function dimsRowCount(s: HgabDatasetSummary): number {
  return dimRows(s).length;
}

/** "By label": each version tallied under the label its own document lists, one block per grouping. */
export function dimsCsv(s: HgabDatasetSummary): string {
  return tableCsv<ReturnType<typeof dimRows>[number]>([
    { key: 'dimension', pick: ({ dim }) => dim.key },
    { key: 'dimension_label', pick: ({ dim }) => dim.label },
    { key: 'label', pick: ({ r }) => r.label },
    { key: 'nep_php', pick: ({ r }) => r.nep_php },
    { key: 'house_php', pick: ({ r }) => r.house_php },
    { key: 'delta_house_minus_nep_php', pick: ({ r }) => (r.nep_php != null && r.house_php != null ? r.house_php - r.nep_php : null) },
    { key: 'nep_rows', pick: ({ r }) => r.nep_records },
    { key: 'house_rows', pick: ({ r }) => r.house_records },
  ], dimRows(s));
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

function changeRows(s: HgabDatasetSummary): Array<{ g: BridgeGroup; rank: number; r: ProjectRow }> {
  return CHANGE_LIST_GROUPS.flatMap((g) => (s.top[g] ?? []).map((r, i) => ({ g, rank: i + 1, r })));
}

export function changesRowCount(s: HgabDatasetSummary): number {
  return changeRows(s).length;
}

/** Every row of every list on the Changes view, with its group and rank in that list. */
export function largestChangesCsv(s: HgabDatasetSummary): string {
  return tableCsv(withProjectColumns<ReturnType<typeof changeRows>[number]>([
    { key: 'group', pick: (x) => x.g },
    { key: 'group_label', pick: (x) => BRIDGE_LABELS[x.g].label },
    { key: 'rank', pick: (x) => x.rank },
  ], s.dataset.key), changeRows(s));
}

// ---------------------------------------------------------------------------
// Second vs third reading (DPWH)
// ---------------------------------------------------------------------------

type Readings = NonNullable<HgabDatasetSummary['readings']>;

/** Status counts, largest first (as the view lists them). */
function statusRows(r: Readings): Array<[string, number]> {
  return Object.entries(r.status_counts).sort((a, b) => b[1] - a[1]);
}

export function readingStatusCsv(r: Readings): string {
  return tableCsv<[string, number]>([
    { key: 'reading_status', pick: ([k]) => k },
    { key: 'status_label', pick: ([k]) => readingLabel(k) },
    { key: 'rows', pick: ([, n]) => n },
  ], statusRows(r));
}

/** Rows added at third reading, in the view's order. */
export function newAtThirdCsv(r: Readings, dataset: DatasetKey): string {
  return tableCsv(
    withProjectColumns<{ rank: number; r: ProjectRow }>([{ key: 'rank', pick: (x) => x.rank }], dataset),
    r.third_only.map((row, i) => ({ rank: i + 1, r: row })),
  );
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

/** Region key of a point, from the region its project row lists (null: none, or not a region). */
function pointRegionKey(p: MapPoint, regionById: ReadonlyMap<string, string | null>): RegionKey | null {
  return regionKeyOf(regionById.get(p.id) ?? null);
}

/** "-41.52": percent change to two decimals; empty when there is no base. */
function pct(house: number | null, nep: number | null): string | null {
  const v = pctChange(house, nep);
  return v == null || !Number.isFinite(v) ? null : v.toFixed(2);
}

interface RegionCsvRow {
  key: RegionKey | null;
  short: string | null;
  name: string;
  labels: string;
  onMap: boolean;
  nep: number | null;
  house: number | null;
  delta: number | null;
  nepRows: number;
  houseRows: number;
  points: number;
}

function regionCsvRows(map: HgabDatasetMap, regionById: ReadonlyMap<string, string | null> | null): RegionCsvRow[] {
  const pointsBy = new Map<RegionKey | null, number>();
  if (regionById) {
    for (const p of map.points) {
      const k = pointRegionKey(p, regionById);
      pointsBy.set(k, (pointsBy.get(k) ?? 0) + 1);
    }
  }
  const order = (k: RegionKey) => {
    const i = REGION_ORDER.indexOf(k);
    return i < 0 ? REGION_ORDER.length : i;
  };
  const regions = [...map.regions].sort((a, b) => order(a.key) - order(b.key));
  const out: RegionCsvRow[] = regions.map((r: MapRegion) => ({
    key: r.key,
    short: REGION_LABELS[r.key]?.short ?? r.key,
    name: REGION_LABELS[r.key]?.name ?? r.label,
    labels: r.source_labels.join(' | '),
    onMap: true,
    nep: r.nep_php,
    house: r.house_php,
    delta: r.delta_php,
    nepRows: r.nep_rows,
    houseRows: r.house_rows,
    points: pointsBy.get(r.key) ?? 0,
  }));
  const n = map.not_on_map;
  const loosePoints = pointsBy.get(null) ?? 0;
  if (n || loosePoints) {
    out.push({
      key: null,
      short: null,
      name: n?.label ?? 'No region listed',
      labels: n?.label ?? '',
      onMap: false,
      nep: n?.nep_php ?? null,
      house: n?.house_php ?? null,
      delta: n && n.nep_php != null && n.house_php != null ? n.house_php - n.nep_php : null,
      nepRows: n?.nep_rows ?? 0,
      houseRows: n?.house_rows ?? 0,
      points: loosePoints,
    });
  }
  return out;
}

export function regionsRowCount(map: HgabDatasetMap): number {
  return map.regions.length + (map.not_on_map ? 1 : 0);
}

/**
 * The Map view's region table, north to south, then the amounts listed as
 * nationwide or with no region (shown beside the map, never on it).
 * `points_mapped` counts the dots whose project row lists that region;
 * `regionById` (project id → listed region) is needed only when the program
 * has dots.
 */
export function regionsCsv(map: HgabDatasetMap, regionById: ReadonlyMap<string, string | null> | null): string {
  const houseStage = map.house_stage;
  return tableCsv<RegionCsvRow>([
    { key: 'region_key', pick: (r) => r.key },
    { key: 'region_short', pick: (r) => r.short },
    { key: 'region_name', pick: (r) => r.name },
    { key: 'labels_as_published', pick: (r) => r.labels || null },
    { key: 'on_map', pick: (r) => (r.onMap ? 'yes' : 'no') },
    { key: 'nep_php', pick: (r) => r.nep },
    { key: 'house_php', pick: (r) => r.house },
    { key: 'house_stage', pick: () => houseStage },
    { key: 'delta_house_minus_nep_php', pick: (r) => r.delta },
    { key: 'change_pct', pick: (r) => pct(r.house, r.nep) },
    { key: 'nep_rows', pick: (r) => r.nepRows },
    { key: 'house_rows', pick: (r) => r.houseRows },
    { key: 'points_mapped', pick: (r) => r.points },
  ], regionCsvRows(map, regionById));
}

/** The dots on the map: where each document publishes coordinates, with the region its project row lists. */
export function mapPointsCsv(map: HgabDatasetMap, regionById: ReadonlyMap<string, string | null>): string {
  return tableCsv<MapPoint>([
    { key: 'id', pick: (p) => p.id },
    { key: 'title', pick: (p) => p.title },
    { key: 'region', pick: (p) => regionById.get(p.id) ?? null },
    { key: 'region_key', pick: (p) => pointRegionKey(p, regionById) },
    { key: 'lat', pick: (p) => p.lat },
    { key: 'lon', pick: (p) => p.lon },
    { key: 'trace', pick: (p) => p.trace },
    { key: 'status_label', pick: (p) => traceInfo(p.trace).label },
    { key: 'bridge_group', pick: (p) => p.group },
    { key: 'held', pick: (p) => (p.held ? 'yes' : '') },
    { key: 'nep_php', pick: (p) => p.nep_php },
    { key: 'house_php', pick: (p) => p.house_php },
    { key: 'house_stage', pick: () => map.house_stage },
    { key: 'coordinates_published_by', pick: (p) => p.printed_by },
    { key: 'road_segments', pick: (p) => p.lines?.length ?? 0 },
  ], map.points);
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** The documents a program cites, NEP first, each once; keys missing from the catalogue keep a row. */
export function programDocuments(dataset: HgabDatasetMeta, docs: Docs): Array<{ key: string; doc: HgabDocument | null }> {
  const keys = [...new Set([...dataset.documents.nep, ...dataset.documents.house])];
  return keys.map((key) => ({ key, doc: docs.find((x) => x.key === key) ?? null }));
}

/** Where a document was published, by name: the Senate portal by its name, anything else by its host. */
function sourceName(url: string | null): string | null {
  if (!url) return null;
  if (isSenatePortal(url)) return SENATE_BUDGET_PORTAL.name;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * The Documents view: every file this program's figures cite. `pdfUrl` turns a
 * document key into the address of our retained copy.
 */
export function documentsCsv(dataset: HgabDatasetMeta, docs: Docs, pdfUrl: (key: string) => string): string {
  type Row = ReturnType<typeof programDocuments>[number];
  const version = (d: HgabDocument) =>
    d.stage === 'nep' ? STAGE_LABELS.nep.label : d.reading === 2 ? STAGE_LABELS.hgab2.label : d.reading === 3 ? STAGE_LABELS.hgab3.label : 'House bill';
  return tableCsv<Row>([
    { key: 'key', pick: (x) => x.key },
    { key: 'title', pick: (x) => x.doc?.title },
    { key: 'stage', pick: (x) => x.doc?.stage },
    { key: 'reading', pick: (x) => x.doc?.reading },
    { key: 'version_label', pick: (x) => (x.doc ? version(x.doc) : null) },
    { key: 'volume', pick: (x) => x.doc?.volume },
    { key: 'pages_used_from', pick: (x) => x.doc?.pages?.from },
    { key: 'pages_used_to', pick: (x) => x.doc?.pages?.to },
    { key: 'bytes', pick: (x) => x.doc?.bytes },
    { key: 'sha256', pick: (x) => x.doc?.sha256 },
    { key: 'source_name', pick: (x) => sourceName(x.doc?.source_url ?? null) },
    { key: 'source_url', pick: (x) => x.doc?.source_url },
    { key: 'pdf_url', pick: (x) => (x.doc ? pdfUrl(x.key) : null) },
    { key: 'notes', pick: (x) => x.doc?.notes },
  ], programDocuments(dataset, docs));
}
