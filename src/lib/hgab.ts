/**
 * Data layer for the FY2027 House General Appropriations Bill section (`/hgab`).
 *
 * The section compares what House Bill 10858 prints against the DBM National
 * Expenditure Program for the four programs where the bill carries
 * project-level detail: DPWH, DA farm-to-market roads, DOH Health Facilities
 * Enhancement Program and NIA irrigation.
 *
 * Everything here reads the tree produced by `npm run import:hgab`
 * (`data/hgab/2027/…`), served from `VITE_DATA_BASE_URL` in production and from
 * the `public/data` symlink in dev — same resolution as the GAA portal and the
 * NEP microsite. The importer does NOT re-derive matching: every status,
 * pairing and amount is carried from the source workbench's own builders
 * (BetterGov's DPWH-NEP-HB-2027-ANALYSIS repository) so the figures here are
 * the figures there.
 *
 * Amounts are integer PESOS throughout. Null means "this stage has no record",
 * never zero.
 *
 * Layout under `hgab/2027/`:
 *
 *   manifest.json                 what ran, when, from which pipeline commit
 *   overview.json                 HgabOverview — datasets, bridges, documents, reconciliation
 *   <dataset>/summary.json        HgabDatasetSummary — controls, dimensions, top lists, readings
 *   <dataset>/projects.parquet    one row per comparison record (PROJECT_COLUMNS), DuckDB-Wasm
 *   pdf/<doc_key>.pdf             the source documents the evidence links open
 */
import { dataUrl } from './data-url';

export const HGAB_YEAR = 2027;
export const HGAB_BASE = `hgab/${HGAB_YEAR}`;
export const HGAB_ROOT = `/hgab/${HGAB_YEAR}`;

/** The pipeline repository the figures come from. */
export const HGAB_SOURCE_REPO = 'https://github.com/csiiiv/DPWH-NEP-HB-2027-ANALYSIS';

// ---------------------------------------------------------------------------
// Datasets and stages
// ---------------------------------------------------------------------------

export type DatasetKey = 'dpwh' | 'fmr' | 'hfep' | 'nia';
export const DATASET_ORDER: readonly DatasetKey[] = ['dpwh', 'fmr', 'hfep', 'nia'];

export function isDatasetKey(v: string | undefined): v is DatasetKey {
  return v === 'dpwh' || v === 'fmr' || v === 'hfep' || v === 'nia';
}

/**
 * Stages of one record. `hgab2` is the House bill as printed for second
 * reading, `hgab3` for third reading; `api` is the DPWH Transparency listing
 * (DPWH only). Compare stages, never add them.
 */
export type StageKey = 'nep' | 'hgab2' | 'hgab3' | 'api';
export const STAGE_ORDER: readonly StageKey[] = ['nep', 'hgab2', 'hgab3', 'api'];
export const STAGE_LABELS: Record<StageKey, { short: string; label: string }> = {
  nep: { short: 'NEP', label: 'DBM National Expenditure Program' },
  hgab2: { short: 'HGAB 2R', label: 'House bill, second reading' },
  hgab3: { short: 'HGAB 3R', label: 'House bill, third reading' },
  api: { short: 'Transparency', label: 'DPWH Transparency NEP listing' },
};

// ---------------------------------------------------------------------------
// The five-group bridge
// ---------------------------------------------------------------------------

/**
 * How every record is bucketed. The bridge identity the importer asserts:
 *   house_only − nep_only + increased − decreased + scope_review = House − NEP
 * Unchanged contributes zero by definition.
 */
export type BridgeGroup =
  | 'house_only'
  | 'nep_only'
  | 'unchanged'
  | 'increased'
  | 'decreased'
  | 'scope_review';

export const BRIDGE_ORDER: readonly BridgeGroup[] = [
  'house_only', 'nep_only', 'unchanged', 'increased', 'decreased', 'scope_review',
];

export const BRIDGE_LABELS: Record<BridgeGroup, { label: string; sub: string; help: string }> = {
  house_only: {
    label: 'Insertion candidates',
    sub: 'House-only records',
    help: 'Rows printed in the House bill with no attached NEP record. A candidate is a matching observation, not a confirmed insertion.',
  },
  nep_only: {
    label: 'Deletion candidates',
    sub: 'NEP-only records',
    help: 'Rows printed in the NEP with no attached House record. Not confirmed deletions; a re-titled or re-scoped replacement may exist.',
  },
  unchanged: {
    label: 'Unchanged',
    sub: 'Same title, same amount',
    help: 'Paired rows whose recorded allocation is equal on both stages.',
  },
  increased: {
    label: 'Increased',
    sub: 'Same title, higher House amount',
    help: 'Paired rows where the House amount exceeds the NEP amount. Reported as the signed movement.',
  },
  decreased: {
    label: 'Decreased',
    sub: 'Same title, lower House amount',
    help: 'Paired rows where the House amount is below the NEP amount.',
  },
  scope_review: {
    label: 'Segment-scope review',
    sub: 'Same road, different segment',
    help: 'Same-road pairs whose station spans do not overlap. Their deltas are deliberately not booked as adjustments.',
  },
};

export interface BridgeCell {
  /** Comparison rows in the group. */
  rows: number;
  /**
   * Money basis of the group, always non-negative: the House amount for
   * house_only and unchanged, the NEP amount for nep_only, the |House − NEP|
   * movement for increased and decreased, and the signed net for scope_review.
   * The bridge identity reads house_only − nep_only + increased − decreased
   * + scope_review = House − NEP.
   */
  php: number;
  /** NEP-side sum of the rows, when both sides exist. */
  nep_php?: number | null;
  /** House-side sum of the rows, when both sides exist. */
  house_php?: number | null;
}

export interface Bridge {
  house_only: BridgeCell;
  nep_only: BridgeCell;
  unchanged: BridgeCell;
  increased: BridgeCell;
  decreased: BridgeCell;
  scope_review: BridgeCell;
  /** House total − NEP total for the dataset's compared population. */
  net_php: number;
  /** Which House reading the bridge is measured against. */
  house_stage: 'hgab2' | 'hgab3';
}

// ---------------------------------------------------------------------------
// Record-level vocabulary (carried verbatim from the source workbench)
// ---------------------------------------------------------------------------

/**
 * `trace` on a project row. DPWH rows use the workbench's lifecycle statuses
 * including the Transparency compounds; annex rows are normalised onto the
 * five plain values. Unknown values must still render (label = the raw key).
 */
export const TRACE_LABELS: Record<string, { label: string; group: BridgeGroup; held?: boolean; help: string }> = {
  amount_same: { label: 'Same amount', group: 'unchanged', help: 'Paired on both stages at the same amount.' },
  house_only_candidate: { label: 'House only', group: 'house_only', help: 'No NEP record attached. Insertion candidate, not a confirmed insertion.' },
  nep_only_candidate: { label: 'NEP only', group: 'nep_only', help: 'No House record attached. Deletion candidate, not a confirmed removal.' },
  candidate_increase: { label: 'Increased', group: 'increased', help: 'Paired; House amount above NEP.' },
  candidate_decrease: { label: 'Decreased', group: 'decreased', help: 'Paired; House amount below NEP.' },
  fuzzy_candidate: { label: 'Unresolved · fuzzy', group: 'house_only', held: true, help: 'House row with similar-title NEP suggestions that were not accepted. Held out of headline insertion counts.' },
  ambiguous: { label: 'Ambiguous', group: 'house_only', held: true, help: 'More than one NEP row shares the exact key. No pairing chosen.' },
  segment_scope_review: { label: 'Segment-scope review', group: 'scope_review', help: 'Same road, non-overlapping chainage. Delta not booked as an adjustment.' },
  transparency_gap_then_amount_same: { label: 'Same amount · not in Transparency', group: 'unchanged', help: 'Paired at the same amount; the NEP row is absent from the Transparency listing.' },
  transparency_gap_then_candidate_increase: { label: 'Increased · not in Transparency', group: 'increased', help: 'Paired, House above NEP; the NEP row is absent from the Transparency listing.' },
  transparency_gap_then_candidate_decrease: { label: 'Decreased · not in Transparency', group: 'decreased', help: 'Paired, House below NEP; the NEP row is absent from the Transparency listing.' },
  transparency_gap_then_segment_scope_review: { label: 'Segment-scope review · not in Transparency', group: 'scope_review', help: 'Same road, non-overlapping chainage; NEP row absent from the Transparency listing.' },
  outside_api_then_amount_same: { label: 'Same amount · outside Transparency scope', group: 'unchanged', help: 'Paired at the same amount; the row is outside the Transparency listing scope (mostly FAP).' },
  outside_api_then_candidate_increase: { label: 'Increased · outside Transparency scope', group: 'increased', help: 'Paired, House above NEP; outside the Transparency listing scope.' },
  outside_api_then_candidate_decrease: { label: 'Decreased · outside Transparency scope', group: 'decreased', help: 'Paired, House below NEP; outside the Transparency listing scope (the large FAP reductions sit here).' },
  outside_api_then_segment_scope_review: { label: 'Segment-scope review · outside Transparency scope', group: 'scope_review', help: 'Same road, non-overlapping chainage; outside the Transparency listing scope.' },
};

export function traceInfo(trace: string | null | undefined): { label: string; group: BridgeGroup | null; held: boolean; help: string } {
  if (!trace) return { label: '—', group: null, held: false, help: '' };
  const t = TRACE_LABELS[trace];
  if (t) return { label: t.label, group: t.group, held: Boolean(t.held), help: t.help };
  return { label: trace.replace(/_/g, ' '), group: null, held: false, help: '' };
}

/** `house_match` on DPWH rows: how the pairing was made. */
export const MATCH_LABELS: Record<string, string> = {
  exact_candidate: 'Exact title, region and PAP',
  chainage_candidate: 'Same road, chainage differs',
  segment_scope_candidate: 'Same road, disjoint segment',
  location_amendment_candidate: 'Same title, location amended',
  scope_amendment_candidate: 'Same title, scope amended',
  soft_match_candidate: 'Soft match',
  fuzzy_candidate: 'Fuzzy suggestion only',
  ambiguous: 'Ambiguous key',
  house_unmatched: 'No NEP counterpart',
  nep_unmatched: 'No House counterpart',
  // Annex pairing methods (FMR, NIA, HFEP), carried from their workbenches.
  title_and_coordinates: 'Same title and coordinates',
  title: 'Same title within region',
  coordinates: 'Same coordinates, title differs',
  ai_corrected: 'Same title after verified OCR correction',
  title_similarity: 'Title similarity within region and province',
};

/** `reading_status` on DPWH rows: second vs third reading. */
export const READING_LABELS: Record<string, string> = {
  same_amount: 'Same in both readings',
  third_only: 'New at third reading',
  second_only: 'Dropped at third reading',
  amount_changed: 'Amount changed between readings',
  repeated_key: 'Repeated key (grouped)',
  no_house_record: 'No House record',
};

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface HgabDocument {
  /** Stable key, also the file name under `pdf/`: e.g. `hb10858-2r-vol-ib`. */
  key: string;
  title: string;
  stage: 'nep' | 'house';
  /** 2 or 3 for House readings; null for NEP documents. */
  reading: 2 | 3 | null;
  volume: string | null;
  /** One-based PDF file pages the section uses, when known. */
  pages: { from: number; to: number } | null;
  sha256: string;
  bytes: number;
  /** Where the original was published, when known. */
  source_url: string | null;
  notes: string | null;
}

export interface HgabDatasetMeta {
  key: DatasetKey;
  /** Long label: "DPWH national infrastructure". */
  label: string;
  /** Tab label: "DPWH". */
  short: string;
  agency: string;
  /** Our `/2027/d/:deptId` group this dataset belongs to (18, 05, 13, 35). */
  dept_id: string;
  /** What one row is: "Named project with chainage, region and implementing office". */
  grain: string;
  /** What the compared population covers and excludes, in one sentence. */
  scope: string;
  /** Printed stage totals of the compared population. */
  totals: { nep_php: number; hgab2_php: number | null; hgab3_php: number | null; api_php: number | null };
  /** Record counts per stage. */
  counts: { nep: number; hgab2: number | null; hgab3: number | null; api: number | null };
  /** Agency-level printed controls above the compared population, when the documents print them. */
  printed: { nep_new_appropriations_php: number | null; house_new_appropriations_php: number | null } | null;
  bridge: Bridge;
  /** Document keys this dataset's evidence opens. */
  documents: { nep: string[]; house: string[] };
  /** What the controls table on the hub is called: "PAP controls", "Regions", "Sub-programs", "Categories". */
  controls_label: string;
  has_readings: boolean;
  has_map: boolean;
}

export interface ReconciliationRow {
  dataset: DatasetKey;
  check: string;
  /** From this portal's FY2027 NEP import (DBM CSV). */
  ours_php: number | null;
  /** From the workbench's extraction (PDF). */
  theirs_php: number | null;
  diff_php: number | null;
  status: 'exact' | 'explained' | 'mismatch' | 'info';
  note: string;
}

export interface HgabOverview {
  fiscal_year: number;
  built_at: string;
  source_repo: string;
  source_commit: string;
  datasets: HgabDatasetMeta[];
  documents: HgabDocument[];
  reconciliation: ReconciliationRow[];
}

// ---------------------------------------------------------------------------
// Dataset summary
// ---------------------------------------------------------------------------

export interface ControlRow {
  id: string;
  label: string;
  /** Grouping above the control (program for DPWH PAPs, null elsewhere). */
  group: string | null;
  nep_php: number | null;
  hgab2_php: number | null;
  hgab3_php: number | null;
  api_php: number | null;
  /** Latest House reading − NEP, null when either side is absent. */
  delta_php: number | null;
  /** Third − second reading, null when the dataset has one reading. */
  reading_delta_php: number | null;
  nep_page: number | null;
  house_pages: number[];
}

export interface DimRow {
  label: string;
  nep_php: number;
  house_php: number;
  nep_records: number;
  house_records: number;
}

export type DimKey = 'region' | 'office_kind' | 'program' | 'pap';

export interface HgabDatasetSummary {
  dataset: HgabDatasetMeta;
  controls: ControlRow[];
  /** House vs NEP by each source's own recorded label. Keys present depend on the dataset. */
  dims: Partial<Record<DimKey, DimRow[]>>;
  /** Largest rows per bridge group, 25 each, for the Changes tab. */
  top: Partial<Record<BridgeGroup, ProjectRow[]>>;
  /** DPWH only: second vs third reading. */
  readings: {
    second_php: number;
    third_php: number;
    delta_php: number;
    status_counts: Record<string, number>;
    third_only: ProjectRow[];
    changed_controls: ControlRow[];
  } | null;
}

// ---------------------------------------------------------------------------
// Project rows (parquet)
// ---------------------------------------------------------------------------

/**
 * Columns of `<dataset>/projects.parquet`, in order. The importer writes
 * exactly these; the hub and record pages SELECT by these names. `flags` is a
 * comma-separated list; `record_json` is the full source record for the
 * record page and is never selected in list queries.
 */
export const PROJECT_COLUMNS = [
  'id', 'dataset', 'title', 'program', 'pap', 'region', 'office', 'office_kind', 'zone',
  'trace', 'house_match', 'reading_status', 'api_presence', 'confidence',
  'nep_php', 'hgab2_php', 'hgab3_php', 'api_php', 'delta_php',
  'nep_page', 'hgab2_page', 'hgab3_page', 'nep_doc', 'hgab2_doc', 'hgab3_doc',
  'length_m', 'flags', 'suggestions', 'search_text', 'record_json',
] as const;

export type ProjectColumn = (typeof PROJECT_COLUMNS)[number];

export interface ProjectRow {
  id: string;
  dataset: DatasetKey;
  title: string;
  program: string | null;
  pap: string | null;
  region: string | null;
  office: string | null;
  /** Central Office · District engineering offices (DEOs) · Regional offices · Other recorded offices · No recorded office */
  office_kind: string | null;
  /** `local` or `fap`. */
  zone: string | null;
  trace: string;
  house_match: string | null;
  reading_status: string | null;
  api_presence: string | null;
  confidence: number | null;
  nep_php: number | null;
  hgab2_php: number | null;
  hgab3_php: number | null;
  api_php: number | null;
  /** Latest House reading − NEP when both exist, else null. */
  delta_php: number | null;
  nep_page: number | null;
  hgab2_page: number | null;
  hgab3_page: number | null;
  nep_doc: string | null;
  hgab2_doc: string | null;
  hgab3_doc: string | null;
  /** Summed chainage length in metres, when the title parses. */
  length_m: number | null;
  /** Comma-separated review flags, e.g. `region_difference,twin_review`. Empty string when none. */
  flags: string;
  /** Count of fuzzy NEP suggestions attached. */
  suggestions: number;
  /** Lower-cased concatenation of title, program, PAP, region and office for LIKE search. */
  search_text: string;
}

export interface ProjectRecord extends ProjectRow {
  /** The full source record, parsed from `record_json`. Shape is the workbench's; render defensively. */
  record: unknown;
}

// ---------------------------------------------------------------------------
// Loaders and URLs
// ---------------------------------------------------------------------------

export const DATA_BASE_OVERRIDE =
  (import.meta.env.VITE_DATA_BASE_URL as string | undefined)?.trim() || null;

async function getJson<T>(url: string, hint: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${hint} — HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

const cache = new Map<string, Promise<unknown>>();
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = load();
    cache.set(key, p as Promise<unknown>);
    p.catch(() => cache.delete(key));
  }
  return p;
}

export function loadHgabOverview(): Promise<HgabOverview> {
  return cached('overview', () =>
    getJson<HgabOverview>(dataUrl(`${HGAB_BASE}/overview.json`), 'Failed to load the FY2027 HGAB overview'),
  );
}

export function loadHgabDataset(key: DatasetKey): Promise<HgabDatasetSummary> {
  return cached(`dataset:${key}`, () =>
    getJson<HgabDatasetSummary>(
      dataUrl(`${HGAB_BASE}/${key}/summary.json`),
      `Failed to load the FY2027 HGAB ${key.toUpperCase()} summary`,
    ),
  );
}

/** Absolute URL of a dataset's project parquet (for DuckDB-Wasm). */
export function projectsParquetUrl(key: DatasetKey): string {
  const u = dataUrl(`${HGAB_BASE}/${key}/projects.parquet`);
  return u.startsWith('http') ? u : `${window.location.origin}${u}`;
}

/** URL of a source PDF; `page` appends a `#page=` fragment that browser viewers honour. */
export function pdfUrl(docKey: string, page?: number | null): string {
  const base = dataUrl(`${HGAB_BASE}/pdf/${docKey}.pdf`);
  return page ? `${base}#page=${page}` : base;
}

export function datasetPath(key: DatasetKey, view?: string): string {
  return view && view !== 'overview' ? `${HGAB_ROOT}/${key}?view=${view}` : `${HGAB_ROOT}/${key}`;
}

export function recordPath(key: DatasetKey, id: string): string {
  return `${HGAB_ROOT}/${key}/p/${encodeURIComponent(id)}`;
}

/** Percent change, or null when there is no base to divide by. */
export function pctChange(amount: number | null, base: number | null): number | null {
  if (amount == null || base == null || !base) return null;
  return ((amount - base) / base) * 100;
}

export function formatPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  // Typographic minus, matching the rest of the site.
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
}

/** The latest House amount on a row: third reading when present, else second. */
export function houseAmount(row: Pick<ProjectRow, 'hgab2_php' | 'hgab3_php'>): number | null {
  return row.hgab3_php ?? row.hgab2_php ?? null;
}
