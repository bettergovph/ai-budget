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
import { LEADERBOARD_DATA_PATH, type LeaderboardData } from './hgab-leaderboard';

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
export const STAGE_LABELS: Record<StageKey, { short: string; label: string; plain: string }> = {
  nep: { short: 'NEP', label: 'NEP', plain: 'the NEP' },
  hgab2: { short: 'House 2R', label: 'House bill, second reading', plain: 'the House bill at second reading' },
  hgab3: { short: 'House 3R', label: 'House bill, third reading', plain: 'the House bill at third reading' },
  api: { short: 'DPWH site', label: 'DPWH transparency website listing', plain: "the DPWH transparency website's list" },
};

/**
 * Plain-language meanings for the terms the section cannot avoid. Pages show
 * these as tooltips or "What this means" notes the first time a term appears;
 * nothing technical should appear on a reader-facing surface without one.
 */
export const PLAIN_TERMS: Record<string, { term: string; meaning: string }> = {
  nep: { term: 'NEP', meaning: 'National Expenditure Program: the budget the President submits to Congress each August.' },
  hgab: { term: 'House bill', meaning: "The House of Representatives' version of the budget, House Bill 10858 for 2027. It goes to the Senate next." },
  reading: { term: 'Second and third reading', meaning: 'The House votes on a bill twice. The third-reading text is the version it sends to the Senate.' },
  pap: { term: 'Program line', meaning: "A heading in the budget under which projects are listed, for example 'Preventive Maintenance - Primary Roads'." },
  deo: { term: 'District engineering office', meaning: 'The DPWH field office that carries out projects in an area. One office can serve more than one congressional district.' },
  fap: { term: 'Foreign-assisted project', meaning: 'A project paid for partly with a loan or grant from abroad.' },
  candidate: { term: 'Candidate', meaning: 'A match or a gap found by comparing project names, places and amounts. It is a lead for checking, not a confirmed change.' },
  tier: { term: 'Tier A and Tier B', meaning: 'Tier A: the office serves one district, so its figure can be read as that district’s. Tier B: the office serves several districts, so the figure is shared and is not split between them.' },
  residual: { term: 'Not assigned to a district', meaning: 'Money listed under the DPWH Central Office or a regional office. It does not appear on any district card.' },
  stages: { term: 'Two versions, not two budgets', meaning: 'The NEP and the House bill are two versions of the same budget. Compare them; never add them together.' },
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
    label: 'In the House bill only',
    sub: 'insertion candidates',
    help: 'Projects listed in the House bill that we could not find in the NEP. Some may be new; others may be renamed or re-scoped lines. That is why they are called candidates.',
  },
  nep_only: {
    label: 'In the NEP only',
    sub: 'deletion candidates',
    help: 'Projects in the NEP that we could not find in the House bill. They may have been dropped, renamed or merged, so they are called candidates.',
  },
  unchanged: {
    label: 'Same amount in both',
    sub: 'matched, no change',
    help: 'Projects found in both documents with the same amount.',
  },
  increased: {
    label: 'Higher in the House bill',
    sub: 'matched, amount raised',
    help: 'Projects found in both documents where the House bill carries a larger amount than the NEP.',
  },
  decreased: {
    label: 'Lower in the House bill',
    sub: 'matched, amount reduced',
    help: 'Projects found in both documents where the House bill carries a smaller amount than the NEP.',
  },
  scope_review: {
    label: 'Different stretch of the same road',
    sub: 'not counted as a change',
    help: 'The same road appears in both documents, but each covers a different stretch of it. The amounts are not comparable, so they are left out of the increases and reductions.',
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
  amount_same: { label: 'Same amount in both', group: 'unchanged', help: 'Found in both documents with the same amount.' },
  house_only_candidate: { label: 'House bill only', group: 'house_only', help: 'Listed in the House bill; no matching line found in the NEP. A candidate, not a confirmed addition.' },
  nep_only_candidate: { label: 'NEP only', group: 'nep_only', help: 'Listed in the NEP; no matching line found in the House bill. A candidate, not a confirmed removal.' },
  candidate_increase: { label: 'Higher in the House bill', group: 'increased', help: 'Found in both documents; the House bill carries a larger amount.' },
  candidate_decrease: { label: 'Lower in the House bill', group: 'decreased', help: 'Found in both documents; the House bill carries a smaller amount.' },
  fuzzy_candidate: { label: 'Possible match, unconfirmed', group: 'house_only', held: true, help: "A House line with a similar-looking line in the NEP that could not be confirmed as the same project. Counted under 'In the House bill only'; left out of the ranked lists of largest changes." },
  ambiguous: { label: 'Several possible matches', group: 'house_only', held: true, help: 'More than one line in the NEP could be this project, so none was chosen.' },
  segment_scope_review: { label: 'Different stretch of the same road', group: 'scope_review', help: 'Same road in both documents, but a different stretch of it. Not counted as an increase or a reduction.' },
  transparency_gap_then_amount_same: { label: 'Same amount in both · not on the DPWH site', group: 'unchanged', help: "Same amount in both documents. The project is missing from the DPWH transparency website's list." },
  transparency_gap_then_candidate_increase: { label: 'Higher in the House bill · not on the DPWH site', group: 'increased', help: "Larger amount in the House bill. The project is missing from the DPWH transparency website's list." },
  transparency_gap_then_candidate_decrease: { label: 'Lower in the House bill · not on the DPWH site', group: 'decreased', help: "Smaller amount in the House bill. The project is missing from the DPWH transparency website's list." },
  transparency_gap_then_segment_scope_review: { label: 'Different stretch of the same road · not on the DPWH site', group: 'scope_review', help: "A different stretch of the same road. The project is missing from the DPWH transparency website's list." },
  outside_api_then_amount_same: { label: 'Same amount in both · not covered by the DPWH site', group: 'unchanged', help: 'Same amount in both documents. The DPWH transparency website does not list this kind of project (mostly foreign-assisted ones).' },
  outside_api_then_candidate_increase: { label: 'Higher in the House bill · not covered by the DPWH site', group: 'increased', help: 'Larger amount in the House bill. The DPWH transparency website does not list this kind of project.' },
  outside_api_then_candidate_decrease: { label: 'Lower in the House bill · not covered by the DPWH site', group: 'decreased', help: 'Smaller amount in the House bill. The DPWH transparency website does not list this kind of project; the large foreign-assisted reductions are here.' },
  outside_api_then_segment_scope_review: { label: 'Different stretch of the same road · not covered by the DPWH site', group: 'scope_review', help: 'A different stretch of the same road. The DPWH transparency website does not list this kind of project.' },
};

export function traceInfo(trace: string | null | undefined): { label: string; group: BridgeGroup | null; held: boolean; help: string } {
  if (!trace) return { label: '—', group: null, held: false, help: '' };
  const t = TRACE_LABELS[trace];
  if (t) return { label: t.label, group: t.group, held: Boolean(t.held), help: t.help };
  return { label: trace.replace(/_/g, ' '), group: null, held: false, help: '' };
}

/** `house_match` on DPWH rows: how the pairing was made. */
export const MATCH_LABELS: Record<string, string> = {
  exact_candidate: 'Same name, region and program line',
  chainage_candidate: 'Same road, different kilometre markers',
  segment_scope_candidate: 'Same road, different stretch',
  location_amendment_candidate: 'Same name, location changed',
  scope_amendment_candidate: 'Same name, scope changed',
  soft_match_candidate: 'Close match',
  fuzzy_candidate: 'Similar name only',
  ambiguous: 'Several possible matches',
  house_unmatched: 'No match in the NEP',
  nep_unmatched: 'No match in the House bill',
  // Annex pairing methods (FMR, NIA, HFEP), carried from their workbenches.
  title_and_coordinates: 'Same name and map coordinates',
  title: 'Same name in the same region',
  coordinates: 'Same map coordinates, name differs',
  ai_corrected: 'Same name after fixing a scanning error',
  title_similarity: 'Similar name in the same province',
};

/** `reading_status` on DPWH rows: second vs third reading. */
export const READING_LABELS: Record<string, string> = {
  same_amount: 'Same in both House readings',
  third_only: 'Added at third reading',
  second_only: 'Dropped at third reading',
  amount_changed: 'Amount changed between readings',
  repeated_key: 'Repeated line (grouped)',
  no_house_record: 'Not in the House bill',
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
  /**
   * READER-FACING. One plain sentence anyone can follow: what the program
   * pays for and what the two documents list. No acronyms, no codes, no
   * page numbers; at most 30 words. This is what heroes, cards and KPIs show.
   */
  summary: string;
  /** READER-FACING. What one row in the tables is, in plain words: "One named road or bridge project". */
  one_row: string;
  /**
   * READER-FACING. Short caveats a reader needs before comparing the numbers,
   * one plain sentence each ("Operating costs are not in these lists."). Shown
   * as a small note; the technical version lives in `scope`.
   */
  caveats: string[];
  /** TECHNICAL. What one row is, precisely, for the Methodology page and the Details disclosure. */
  grain: string;
  /** TECHNICAL. What the compared population covers and excludes, with pages, codes and ledger notes. Never shown on a hero, card or KPI. */
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
    /**
     * The agency-level printed controls at each reading (new appropriations,
     * expense classes, GAS, support to operations, operations), carried from
     * the source's reading comparison so "unchanged between readings" is a
     * data fact, not prose.
     */
    printed_controls: Array<{ id: string; label: string; second_php: number | null; third_php: number | null; delta_php: number | null }>;
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
// Districts: the DEO lens (`/hgab/2027/districts`)
// ---------------------------------------------------------------------------
//
// Groups DPWH money by the district engineering office the documents print,
// then lists the legislative districts that office serves. It never infers
// which district a project is in, never divides a shared office's money, and
// publishes the Central Office / regional residual that no district card
// shows. Representatives come from bills.juris.ph (our own directory, joined
// on the congress.gov.ph member code); portraits are its Commons-mirrored,
// attributed images.

/** Which Congress deliberated each fiscal year's budget. */
export interface CongressTerm {
  congress: number;
  label: string;
  /** Fiscal years whose GAA (or, for FY2027, NEP and House bill) this Congress handled. */
  years: number[];
  note: string;
}

export const CONGRESS_TERMS: readonly CongressTerm[] = [
  { congress: 18, label: '18th Congress', years: [2020, 2021, 2022], note: 'Convened July 2019; passed the FY2020, FY2021 and FY2022 GAAs.' },
  { congress: 19, label: '19th Congress', years: [2023, 2024, 2025], note: 'Convened July 2022; passed the FY2023, FY2024 and FY2025 GAAs.' },
  { congress: 20, label: '20th Congress', years: [2026, 2027], note: 'Convened July 2025; passed the FY2026 GAA. FY2027 is the NEP and the House bill, not yet enacted.' },
];

/** Where a fiscal year's figure comes from. GAA is enacted; NEP and HGAB are proposals. */
export type FiscalStage = 'gaa' | 'nep' | 'hgab3';

export interface YearAmount {
  fy: number;
  stage: FiscalStage;
  /** Integer pesos; null when the office could not be found in that year's data (never 0). */
  php: number | null;
  /** The operating-unit or office label actually matched in that year's source, for audit. */
  matched_label: string | null;
}

export interface OfficeHistory {
  /** Crosswalk office id, e.g. `office:bulacan-1st-deo`. */
  id: string;
  name: string;
  kind: 'district_engineering_office' | 'sub_district_engineering_office' | 'regional_group';
  region: string | null;
  /** Districts this office serves (crosswalk ids). */
  district_ids: string[];
  /** A = serves exactly one district; B = shared, figures are undivided. */
  tier: 'A' | 'B';
  /** FY2020–2026 GAA, FY2027 NEP, FY2027 HGAB 3R, in that order. */
  years: YearAmount[];
  /** GAA totals per Congress term (FY2027 is listed separately as nep/hgab3). */
  by_congress: Array<{ congress: number; gaa_php: number | null; years_counted: number[] }>;
  /** FY2027 House bill against the NEP for this office's rows. */
  fy2027: {
    nep_php: number | null;
    hgab2_php: number | null;
    hgab3_php: number | null;
    nep_records: number;
    hgab3_records: number;
    bridge: Bridge | null;
  } | null;
  /** Name variants used to join this office across years, and any gaps. */
  aliases_used: string[];
  notes: string[];
}

export interface DistrictRepresentative {
  name: string;
  seat: string;
  status: 'resolved' | 'ambiguous';
  member_code: string | null;
  /** congress.gov.ph profile. */
  profile_url: string | null;
  /** bills.juris.ph author profile id and page. */
  juris_id: string | null;
  juris_url: string | null;
  portrait_url: string | null;
  portrait_attribution: string | null;
  portrait_license: string | null;
  portrait_source_url: string | null;
  bill_count: number | null;
  leadership_roles: string[];
  /** Ambiguous seats list every candidate and choose none. */
  candidates?: DistrictRepresentative[];
}

export interface DistrictCard {
  /** Crosswalk id, e.g. `leg:bulacan:1st`. */
  id: string;
  /** "Bulacan, 1st District". */
  label: string;
  jurisdiction: string;
  district_label: string;
  region: string | null;
  representative: DistrictRepresentative | null;
  office_ids: string[];
  /** A when every serving office is Tier A, B when every one is shared, mixed otherwise, none when no office ledger exists. */
  attribution: 'A' | 'B' | 'mixed' | 'none';
  /**
   * Headline figures: the sum of the serving offices' UNDIVIDED totals. When
   * attribution is B or mixed these include money shared with other districts
   * and must be labelled as a range, never as the district's own.
   */
  headline: { fy2026_gaa_php: number | null; fy2027_nep_php: number | null; fy2027_hgab3_php: number | null };
  co_served_district_ids: string[];
}

export interface ResidualYear {
  fy: number;
  stage: FiscalStage;
  /** DPWH total for the year in this stage's own scope. */
  total_php: number;
  /** Money under offices that appear on at least one district card. */
  deo_php: number;
  central_office_php: number;
  regional_offices_php: number;
  /** Operating units that matched no crosswalk office (named in `unmatched_labels`). */
  unmatched_php: number;
  unmatched_labels: string[];
}

export interface HgabDistrictIndex {
  fiscal_year: number;
  built_at: string;
  source_commit: string;
  crosswalk: { schema_version: string; build_date: string; offices: number; districts: number; relationships: number };
  representatives_source: { url: string; congress: number; fetched_at: string; notice: string; matched: number; unmatched: number };
  terms: CongressTerm[];
  districts: DistrictCard[];
  offices: Record<string, OfficeHistory>;
  residual: ResidualYear[];
  /** What the GAA scope per year is (all funds, all expense classes) versus FY2027 (operations population), in one sentence each. */
  scope_notes: string[];
}

export function loadHgabDistricts(): Promise<HgabDistrictIndex> {
  return cached('districts', () =>
    getJson<HgabDistrictIndex>(dataUrl(`${HGAB_BASE}/districts.json`), 'Failed to load the FY2027 House bill district index'),
  );
}

/** The leaderboards file (`npm run build:hgab-leaderboard`); the boards themselves live in `lib/hgab-leaderboard.ts`. */
export function loadHgabLeaderboard(): Promise<LeaderboardData> {
  return cached('leaderboard', () =>
    getJson<LeaderboardData>(dataUrl(LEADERBOARD_DATA_PATH), 'Failed to load the FY2027 House bill leaderboards'),
  );
}

export function districtPath(id?: string): string {
  return id ? `${HGAB_ROOT}/districts/${encodeURIComponent(id)}` : `${HGAB_ROOT}/districts`;
}

// ---------------------------------------------------------------------------
// Maps (`?view=map` on each dataset hub)
// ---------------------------------------------------------------------------
//
// Province outlines come from the PSA boundaries as of 31 December 2023
// (philippines-json-maps, MIT, simplified), each tagged with the region it
// belongs to today: Negros Occidental, Negros Oriental and Siquijor carry the
// Negros Island Region (2024) key, and Sulu is drawn in Region IX after the
// 2024 Supreme Court ruling, matching how every list prints it. Amounts are
// tallied under the region each document prints, normalised to one key per
// region; `regions` always lists all 18 keys (nulls where a document lists
// nothing), and anything printed as nationwide or with no region — all of
// NIA — sits in `not_on_map`. Points are drawn only where a document prints
// coordinates: every farm-to-market road, and the DPWH projects whose titles
// carry them. Nothing is geocoded from place names. DPWH's Metro Manila
// figure includes head-office projects built elsewhere; the map note says so.

export type RegionKey =
  | 'NCR' | 'CAR' | 'I' | 'II' | 'III' | 'IV-A' | 'MIMAROPA' | 'V' | 'VI' | 'VII' | 'VIII'
  | 'IX' | 'X' | 'XI' | 'XII' | 'XIII' | 'BARMM' | 'NIR';

/** North to south, the order regions are listed in on maps and the districts page. */
export const REGION_ORDER: readonly RegionKey[] = [
  'NCR', 'CAR', 'I', 'II', 'III', 'IV-A', 'MIMAROPA', 'V', 'VI', 'NIR', 'VII', 'VIII',
  'IX', 'X', 'XI', 'XII', 'XIII', 'BARMM',
];

/** Short label and the plain name readers know. */
export const REGION_LABELS: Record<RegionKey, { short: string; name: string }> = {
  NCR: { short: 'NCR', name: 'Metro Manila' },
  CAR: { short: 'CAR', name: 'Cordillera' },
  I: { short: 'Region I', name: 'Ilocos' },
  II: { short: 'Region II', name: 'Cagayan Valley' },
  III: { short: 'Region III', name: 'Central Luzon' },
  'IV-A': { short: 'Region IV-A', name: 'Calabarzon' },
  MIMAROPA: { short: 'MIMAROPA', name: 'Mimaropa' },
  V: { short: 'Region V', name: 'Bicol' },
  VI: { short: 'Region VI', name: 'Western Visayas' },
  NIR: { short: 'NIR', name: 'Negros Island' },
  VII: { short: 'Region VII', name: 'Central Visayas' },
  VIII: { short: 'Region VIII', name: 'Eastern Visayas' },
  IX: { short: 'Region IX', name: 'Zamboanga Peninsula' },
  X: { short: 'Region X', name: 'Northern Mindanao' },
  XI: { short: 'Region XI', name: 'Davao' },
  XII: { short: 'Region XII', name: 'Soccsksargen' },
  XIII: { short: 'Region XIII', name: 'Caraga' },
  BARMM: { short: 'BARMM', name: 'Bangsamoro' },
};

const ROMAN: Record<string, RegionKey> = {
  I: 'I', II: 'II', III: 'III', V: 'V', VI: 'VI', VII: 'VII', VIII: 'VIII', IX: 'IX', X: 'X', XI: 'XI', XII: 'XII', XIII: 'XIII',
};

/**
 * One key for every way the documents print a region ("Region IVA - CALABARZON",
 * "REGION IVB - MIMAROPA", "CALABARZON", "Region IV-A", "NEGROS ISLAND REGION (NIR)").
 * Null for "Nationwide", blanks and anything unrecognised — those are shown
 * beside the map, never guessed onto it.
 */
export function regionKeyOf(label: string | null | undefined): RegionKey | null {
  if (!label) return null;
  const s = label.toUpperCase().replace(/[‐-―]/g, '-');
  if (/\bNCR\b|NATIONAL CAPITAL|METRO MANILA/.test(s)) return 'NCR';
  if (/\bCAR\b|CORDILLERA/.test(s)) return 'CAR';
  if (/\bBARMM\b|BANGSAMORO|\bARMM\b/.test(s)) return 'BARMM';
  if (/\bNIR\b|NEGROS ISLAND/.test(s)) return 'NIR';
  if (/MIMAROPA|\bIV-?B\b/.test(s)) return 'MIMAROPA';
  if (/CALABARZON|\bIV-?A\b/.test(s)) return 'IV-A';
  if (/CARAGA/.test(s)) return 'XIII';
  const m = /\bREGION\s+([IVX]+)\b/.exec(s);
  return m ? ROMAN[m[1]] ?? null : null;
}

export interface HgabGeo {
  /** PSA boundary release the outlines come from. */
  source: string;
  /** [minLon, minLat, maxLon, maxLat] of every outline. */
  bbox: [number, number, number, number];
  regions: Array<{ key: RegionKey; label: string; plain: string }>;
  provinces: Array<{
    psgc: number;
    name: string;
    region: RegionKey;
    /** Polygons as rings of [lon, lat], 4 decimals. */
    polygons: number[][][][];
  }>;
}

export interface MapRegion {
  key: RegionKey;
  label: string;
  /** Integer pesos per document; null when the document lists nothing there. */
  nep_php: number | null;
  house_php: number | null;
  delta_php: number | null;
  nep_rows: number;
  house_rows: number;
  /**
   * The region labels exactly as the documents print them, most-used first.
   * The map's "See projects" link passes all of them to the Projects filter,
   * "|"-separated, because one region can be printed more than one way.
   */
  source_labels: string[];
}

export interface MapPoint {
  /** Project id in `<dataset>/projects.parquet`; links to the record page. */
  id: string;
  /** Representative point (first printed coordinate, or a segment midpoint). */
  lon: number;
  lat: number;
  /** Road segments as [lon, lat] lines, when the document prints start and end points. */
  lines?: number[][][];
  title: string;
  trace: string;
  group: BridgeGroup | null;
  held: boolean;
  nep_php: number | null;
  house_php: number | null;
  /** Whose coordinates these are. */
  printed_by: 'house' | 'nep' | 'both';
}

export interface HgabDatasetMap {
  dataset: DatasetKey;
  /** Which House reading the house figures are. */
  house_stage: 'hgab2' | 'hgab3';
  regions: MapRegion[];
  /** Amounts the documents list as nationwide or with no region; shown beside the map, never on it. */
  not_on_map: { label: string; nep_php: number | null; house_php: number | null; nep_rows: number; house_rows: number; plain: string } | null;
  points: MapPoint[];
  /** READER-FACING. One plain sentence on what the dots are, or why there are none. */
  points_note: string;
  /** False when the documents print no location at all (NIA). The tab then explains instead of drawing. */
  placeable: boolean;
  /** READER-FACING. Shown when placeable is false, or as a caveat under the map. */
  note: string;
  coverage: { rows_total: number; rows_with_points: number; rows_with_region: number };
}

export function loadHgabGeo(): Promise<HgabGeo> {
  return cached('geo', () => getJson<HgabGeo>(dataUrl(`${HGAB_BASE}/geo/provinces.json`), 'Failed to load the map outlines'));
}

export function loadHgabMap(key: DatasetKey): Promise<HgabDatasetMap> {
  return cached(`map:${key}`, () =>
    getJson<HgabDatasetMap>(dataUrl(`${HGAB_BASE}/${key}/map.json`), `Failed to load the ${key.toUpperCase()} map`),
  );
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
    getJson<HgabOverview>(dataUrl(`${HGAB_BASE}/overview.json`), 'Failed to load the FY2027 House bill overview'),
  );
}

export function loadHgabDataset(key: DatasetKey): Promise<HgabDatasetSummary> {
  return cached(`dataset:${key}`, () =>
    getJson<HgabDatasetSummary>(
      dataUrl(`${HGAB_BASE}/${key}/summary.json`),
      `Failed to load the FY2027 House bill ${key.toUpperCase()} summary`,
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
