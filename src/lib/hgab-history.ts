/**
 * Multi-purpose buildings (`/hgab/2027/multi-purpose`, under the DPWH menu):
 * multi-purpose buildings, flood control and the lines around them, from the
 * FY2020 GAA to the FY2027 House bill, one figure per budget and stage.
 * (Code and data keep the name "history": history.json, HISTORY_*.)
 *
 * Data contract for the two files `npm run build:hgab-history` writes
 * (`scripts/build-hgab-history.ts`) and `npm run verify:hgab` re-checks:
 *
 *   data/hgab/2027/history.json   HistoryData: columns, series (with parts), sources, checks
 *   data/hgab/2027/history.csv    one row per series part and column; UTF-8 with BOM, exact integer pesos
 *
 * Where each column comes from:
 *   - FY2020–FY2026 GAA: the DBM GAA extracts (`data/<dept>/fpaps`, re-checked against
 *     `data/<dept>/full_extract.csv`), amounts in thousands of pesos turned into pesos;
 *   - FY2026 NEP, House bill and Senate bill: the People's Budget Coalition FY2026 tracker
 *     (its GAA2025 column must equal our FY2025 GAA to the peso, or nothing is written);
 *   - FY2027 NEP: the DBM NEP extract (`data/2027/<dept>/line_items.parquet`, fy 2027);
 *   - FY2027 House bill: DPWH lines from `data/hgab/2027/dpwh/projects.parquet` (third reading),
 *     DepEd and DOH lines as published in Volume I-A of House Bill No. 10858.
 *
 * Rules:
 *   - integer pesos; null = no line with an amount in that budget (or a stage the sources do
 *     not cover); 0 = a line listed with no amount. Stages are compared, never added;
 *   - a series is the sum of its parts; series overlap (BIP and SIPAG contain their own
 *     multi-purpose and flood lines; foreign-assisted projects sit inside flood control and
 *     roads), so series are never added to each other;
 *   - amounts are new appropriations for that year, not spending.
 *
 * Pure (no runtime imports, no `import.meta.env`): the builder, the verifier and the page read it.
 */

export const HISTORY_SCHEMA = 1 as const;
export const HISTORY_ROOT = '/hgab/2027/multi-purpose';
/** The page's name in the DPWH menu and its breadcrumb. */
export const HISTORY_TITLE = 'Multi-purpose buildings';
/** Paths under the data host (`dataUrl`), the same keys on R2. */
export const HISTORY_DATA_PATH = 'hgab/2027/history.json';
export const HISTORY_CSV_PATH = 'hgab/2027/history.csv';
/** The download's file name: what upload-hgab-to-r2.ts sends as Content-Disposition for every CSV it publishes. */
export const HISTORY_CSV_NAME = 'bettergov-house-bill-2027-history.csv';
/** Volume I-A of the House bill, third reading (DepEd and DOH tables); copied next to the other source PDFs. */
export const HISTORY_VOL_IA_PATH = 'hgab/2027/pdf/hb10858-3r-vol-ia.pdf';

// ---------------------------------------------------------------------------
// Columns: one per budget and stage
// ---------------------------------------------------------------------------

export type HistoryStage = 'gaa' | 'nep' | 'house' | 'senate';
export type HistorySourceKey = 'gaa' | 'pbc2026' | 'nep2027' | 'house2027';

export const STAGE_LABELS: Record<HistoryStage, { label: string; plain: string }> = {
  nep: { label: 'NEP', plain: 'the National Expenditure Program the Executive submits to Congress' },
  house: { label: 'House bill', plain: 'the budget bill as the House of Representatives approved it' },
  senate: { label: 'Senate bill', plain: 'the budget bill as the Senate approved it' },
  gaa: { label: 'GAA', plain: 'the General Appropriations Act, the budget as signed into law' },
};

export interface HistoryColumn {
  /** `gaa-2020` … `house-2027`. */
  key: string;
  fy: number;
  stage: HistoryStage;
  /** "FY2026 House bill". */
  label: string;
  /** The axis label under the bar: the year for a GAA before FY2026, the stage within FY2026 and FY2027. */
  axis: string;
  source: HistorySourceKey;
}

const gaa = (fy: number): HistoryColumn => ({ key: `gaa-${fy}`, fy, stage: 'gaa', label: `FY${fy} GAA`, axis: String(fy), source: 'gaa' });

export const HISTORY_COLUMNS: readonly HistoryColumn[] = [
  gaa(2020), gaa(2021), gaa(2022), gaa(2023), gaa(2024), gaa(2025),
  { key: 'nep-2026', fy: 2026, stage: 'nep', label: 'FY2026 NEP', axis: 'NEP', source: 'pbc2026' },
  { key: 'house-2026', fy: 2026, stage: 'house', label: 'FY2026 House bill', axis: 'House', source: 'pbc2026' },
  { key: 'senate-2026', fy: 2026, stage: 'senate', label: 'FY2026 Senate bill', axis: 'Senate', source: 'pbc2026' },
  { key: 'gaa-2026', fy: 2026, stage: 'gaa', label: 'FY2026 GAA', axis: 'GAA', source: 'gaa' },
  { key: 'nep-2027', fy: 2027, stage: 'nep', label: 'FY2027 NEP', axis: 'NEP', source: 'nep2027' },
  { key: 'house-2027', fy: 2027, stage: 'house', label: 'FY2027 House bill', axis: 'House', source: 'house2027' },
];

/** Year groups under the axis: one label per run of columns that share a fiscal year from FY2026 on. */
export const HISTORY_YEAR_GROUPS: ReadonlyArray<{ fy: number; label: string; from: number; to: number }> = [
  { fy: 2026, label: 'FY2026', from: 6, to: 9 },
  { fy: 2027, label: 'FY2027', from: 10, to: 11 },
];

// ---------------------------------------------------------------------------
// Series and their parts
// ---------------------------------------------------------------------------

export type HistorySeriesKey = 'mpb' | 'flood' | 'bip' | 'sipag' | 'local_roads' | 'fap' | 'deped' | 'hfep';
export type HistoryDepartment = 'DPWH' | 'DepEd' | 'DOH';

/**
 * One part of a series and where its figure comes from in each source. GAA codes are
 * six-digit PAP prefixes (UACS `prexc_fpap_id`), or a full PAP code for DepEd and DOH.
 */
export interface HistoryPartDef {
  key: string;
  label: string;
  /** GAA FY2020–FY2026 (and the FY2027 NEP extract, same codes): department and PAP prefixes. */
  codes?: { dept: '18' | '07' | '13'; prefixes: readonly string[] };
  /** Every DPWH Operations line financed by a foreign loan or grant (seventh digit of the PAP code is 3). */
  foreign?: true;
  /** FY2026 NEP, House and Senate: rows of the People's Budget Coalition sheet, matched on the trimmed label. */
  pbc?: { sheet: PbcSheet; rows: RegExp };
  /** FY2027 House bill, DPWH: lines of dpwh/projects.parquet by `program` or `pap`. */
  house?: { program?: RegExp; pap?: RegExp };
  /** FY2027 House bill, DepEd and DOH: the program line as published in Volume I-A. */
  printed?: RegExp;
}

export interface HistorySeriesDef {
  key: HistorySeriesKey;
  label: string;
  department: HistoryDepartment;
  /** One or two sentences for an ordinary reader. */
  plain: string;
  parts: readonly HistoryPartDef[];
  /** FY2026 sheet rows that must equal the sum of the parts (the sheet's own subtotal). */
  pbcTotal?: { sheet: PbcSheet; row: RegExp };
  /** Overlaps with other series, for the reader ("never add them"). */
  overlaps?: readonly HistorySeriesKey[];
  /** Whether project lines are counted (DPWH), or the figure is one program line (DepEd, DOH). */
  counted: boolean;
  /**
   * The FY2027 project list this line opens: a program hub's Projects view with exact filters (the
   * `program`, `pap`, `zone` URL parameters of src/lib/hgab-query.ts, matched with `=`). The builder checks
   * that the list adds up to the line's FY2027 NEP and House-bill cells.
   */
  list2027?: { dataset: 'dpwh' | 'hfep'; params: Readonly<Record<string, string>> };
  /**
   * DepEd and DOH: the line in every enacted budget, FY2020–FY2026, on the GAA explorer (its Programs view
   * filtered by name, `?q=`). Their budgets give the line as one amount, so there is no project list before 2027.
   */
  gaaHistory?: { dept: '07' | '13'; q: string };
}

export type PbcSheet = 'DPWH' | 'Educ' | 'Health';
/** The tracker's file names in its `public/citizens-report` folder. */
export const PBC_FILES: Record<PbcSheet, string> = {
  DPWH: '[PBC] 2026 Budget Data Analysis - DPWH.csv',
  Educ: '[PBC] 2026 Budget Data Analysis - Educ.csv',
  Health: '[PBC] 2026 Budget Data Analysis - Health.csv',
};
/** The tracker's columns used here; GAA2025 is the reconciliation column. */
export const PBC_COLUMNS = { gaa2025: 'GAA2025', nep: 'NEP2026', house: 'HGAB2026', senate: 'SGAB2026' } as const;

const BIP = 'Basic Infrastructure Program \\(BIP\\) - ';
const SIPAG = 'Sustainable Infrastructure Projects Alleviating Gaps \\(SIPAG\\) - ';
const rx = (s: string) => new RegExp(`^${s}`, 'i');

export const BIP_CODES = {
  mpb: ['300226'],
  roads: ['300221', '300222', '300223', '300224', '300236', '300239'],
  flood: ['300225', '300237'],
  other: ['300227', '300228', '300229', '300230', '300238', '300240', '300241', '300242'],
} as const;
export const SIPAG_CODES = {
  mpb: ['300220'],
  roads: ['300215', '300216', '300217', '300218', '300233', '300243'],
  flood: ['300219', '300234'],
  other: ['300231', '300232', '300235', '300244', '300245', '300246', '300247'],
} as const;
const LOCAL_MPB = ['300103', '300104'] as const;
const LOCAL_FLOOD = ['300106', '300107', '300108', '300109'] as const;
const LOCAL_ROADS = ['300111', '300112', '300113', '300114', '300116', '300117', '300118', '300119'] as const;

export const HISTORY_SERIES: readonly HistorySeriesDef[] = [
  {
    key: 'mpb',
    label: 'Multi-purpose buildings',
    department: 'DPWH',
    list2027: { dataset: 'dpwh', params: { pap: 'BIP - Multi-Purpose Buildings/ Facilities to support Social Services' } },
    plain: 'DPWH lines for multi-purpose buildings and facilities: BIP and SIPAG from FY2022, the Local Program before that. National government buildings are not included.',
    counted: true,
    parts: [
      { key: 'bip', label: 'BIP', codes: { dept: '18', prefixes: BIP_CODES.mpb }, pbc: { sheet: 'DPWH', rows: rx(`${BIP}Multi-Purpose`) }, house: { pap: /^BIP - Multi-Purpose/ } },
      { key: 'sipag', label: 'SIPAG', codes: { dept: '18', prefixes: SIPAG_CODES.mpb }, pbc: { sheet: 'DPWH', rows: rx(`${SIPAG}Multi-Purpose`) } },
      { key: 'local', label: 'Local Program', codes: { dept: '18', prefixes: LOCAL_MPB } },
    ],
  },
  {
    key: 'flood',
    label: 'Flood control',
    department: 'DPWH',
    list2027: { dataset: 'dpwh', params: { program: 'Flood Management Program' } },
    plain: 'The Flood Management Program, plus the flood lines under BIP and SIPAG (FY2022–FY2025) and the Local Program (FY2020–FY2021). Drainage along national roads is not included.',
    counted: true,
    parts: [
      { key: 'fmp', label: 'Flood Management Program', codes: { dept: '18', prefixes: ['3201'] }, pbc: { sheet: 'DPWH', rows: /^FLOOD MANAGEMENT PROGRAM$/ }, house: { program: /^Flood Management Program$/ } },
      { key: 'bip', label: 'BIP', codes: { dept: '18', prefixes: BIP_CODES.flood }, pbc: { sheet: 'DPWH', rows: rx(`${BIP}Flood`) } },
      { key: 'sipag', label: 'SIPAG', codes: { dept: '18', prefixes: SIPAG_CODES.flood }, pbc: { sheet: 'DPWH', rows: rx(`${SIPAG}Flood`) } },
      { key: 'local', label: 'Local Program', codes: { dept: '18', prefixes: LOCAL_FLOOD } },
    ],
  },
  {
    key: 'bip',
    label: 'BIP, all lines',
    department: 'DPWH',
    plain: 'Every Basic Infrastructure Program line, by what it builds.',
    counted: true,
    overlaps: ['mpb', 'flood'],
    pbcTotal: { sheet: 'DPWH', row: /^Basic Infrastructure Program$/ },
    parts: [
      { key: 'mpb', label: 'Multi-purpose buildings', codes: { dept: '18', prefixes: BIP_CODES.mpb }, pbc: { sheet: 'DPWH', rows: rx(`${BIP}Multi-Purpose`) }, house: { pap: /^BIP - Multi-Purpose/ } },
      { key: 'roads', label: 'Roads and bridges', codes: { dept: '18', prefixes: BIP_CODES.roads }, pbc: { sheet: 'DPWH', rows: rx(`${BIP}(Access Roads|Interjurisdictional|Coastal)`) }, house: { pap: /^BIP - (Access Roads|Interjurisdictional|Coastal)/ } },
      { key: 'flood', label: 'Flood mitigation', codes: { dept: '18', prefixes: BIP_CODES.flood }, pbc: { sheet: 'DPWH', rows: rx(`${BIP}Flood`) }, house: { pap: /^BIP - Flood/ } },
      { key: 'other', label: 'Other', codes: { dept: '18', prefixes: BIP_CODES.other }, pbc: { sheet: 'DPWH', rows: rx(`${BIP}(Public Water|Major|Evacuation|Local Ports|Climate)`) }, house: { pap: /^BIP - (Public Water|Major|Evacuation|Local Ports|Climate)/ } },
    ],
  },
  {
    key: 'sipag',
    label: 'SIPAG, all lines',
    department: 'DPWH',
    plain: 'Every Sustainable Infrastructure Projects Alleviating Gaps line, by what it builds.',
    counted: true,
    overlaps: ['mpb', 'flood'],
    pbcTotal: { sheet: 'DPWH', row: /^Sustainable Infrastructure Projects Alleviating Gaps \(SIPAG\)$/ },
    parts: [
      { key: 'mpb', label: 'Multi-purpose buildings', codes: { dept: '18', prefixes: SIPAG_CODES.mpb }, pbc: { sheet: 'DPWH', rows: rx(`${SIPAG}Multi-Purpose`) } },
      { key: 'roads', label: 'Roads and bridges', codes: { dept: '18', prefixes: SIPAG_CODES.roads }, pbc: { sheet: 'DPWH', rows: rx(`${SIPAG}(Access Roads|Interjurisdictional|Coastal)`) } },
      { key: 'flood', label: 'Flood mitigation', codes: { dept: '18', prefixes: SIPAG_CODES.flood }, pbc: { sheet: 'DPWH', rows: rx(`${SIPAG}Flood`) } },
      { key: 'other', label: 'Other', codes: { dept: '18', prefixes: SIPAG_CODES.other }, pbc: { sheet: 'DPWH', rows: rx(`${SIPAG}(Public Water|Major|Evacuation|Local Ports|Climate)`) } },
    ],
  },
  {
    key: 'local_roads',
    label: 'Local Program roads and bridges',
    department: 'DPWH',
    plain: 'Lines for roads and bridges in the Local Program, which carried district projects before BIP and SIPAG.',
    counted: true,
    parts: [{ key: 'all', label: 'Local Program roads and bridges', codes: { dept: '18', prefixes: LOCAL_ROADS } }],
  },
  {
    key: 'fap',
    label: 'Foreign-assisted projects',
    department: 'DPWH',
    list2027: { dataset: 'dpwh', params: { zone: 'fap' } },
    plain: 'DPWH projects paid for with foreign loans or grants, with their government counterpart funds. They sit inside flood control, roads and bridges.',
    counted: true,
    overlaps: ['flood'],
    parts: [{ key: 'all', label: 'Foreign-assisted projects', foreign: true, house: { pap: /^Foreign-assisted projects$/ } }],
  },
  {
    key: 'deped',
    label: 'DepEd school facilities',
    department: 'DepEd',
    gaaHistory: { dept: '07', q: 'Basic Education Facilities' },
    plain: "DepEd's Basic Education Facilities line, which pays to build, replace and repair school buildings and classrooms.",
    counted: false,
    parts: [{
      key: 'all', label: 'Basic Education Facilities',
      codes: { dept: '07', prefixes: ['310200100006000'] },
      pbc: { sheet: 'Educ', rows: /^Basic Education Facilities$/ },
      printed: /^\s*\d+\s+Basic Education Facilities\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+\d+\s*$/,
    }],
  },
  {
    key: 'hfep',
    label: 'DOH health facilities',
    department: 'DOH',
    list2027: { dataset: 'hfep', params: {} },
    gaaHistory: { dept: '13', q: 'Health Facilities Enhancement' },
    plain: "DOH's Health Facilities Enhancement Program, which pays to build, upgrade and equip public hospitals and health centres.",
    counted: false,
    parts: [{
      key: 'all', label: 'Health Facilities Enhancement Program',
      codes: { dept: '13', prefixes: ['310201100002000', '350202100002000'] },
      pbc: { sheet: 'Health', rows: /^Health Facilities Enhancement Program$/ },
      printed: /^\s*\d+\s+Health Facilities Enhancement Program\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+\d+\s*$/,
    }],
  },
];

export const HISTORY_SERIES_KEYS: readonly HistorySeriesKey[] = HISTORY_SERIES.map((s) => s.key);

// ---------------------------------------------------------------------------
// Definitions (as published), for the page and the poster
// ---------------------------------------------------------------------------

export interface HistoryDefinition {
  key: 'bip' | 'sipag';
  term: string;
  name: string;
  /** For an ordinary reader. */
  plain: readonly string[];
  /** The provision as published, when the budget has one. */
  quote: { text: string; where: string; doc: 'house3r_ib' | 'gaa2026'; page: number } | null;
}

/**
 * BIP is defined by a DPWH special provision: No. 5 of the FY2026 GAA and No. 3 of the FY2027 House
 * bill (third reading, Volume I-B, page 10), the same words in both. SIPAG has no special provision
 * in the FY2026 GAA, and no line in the FY2027 NEP or House bill.
 */
export const HISTORY_DEFINITIONS: readonly HistoryDefinition[] = [
  {
    key: 'bip',
    term: 'BIP',
    name: 'Basic Infrastructure Program',
    plain: [
      'DPWH builds local roads and bridges, multi-purpose buildings, flood mitigation, water systems and evacuation centres.',
      'When a project is done, DPWH hands it to the local government, which pays for its upkeep.',
      'Its budget lines first appear in the FY2022 GAA; the FY2020 and FY2021 GAAs have none.',
    ],
    quote: {
      text: 'The amount appropriated herein for the implementation of the Basic Infrastructure Program shall be subject to the following: (a) engineering and administrative overhead (EAO) expenses shall not exceed one percent (1%) of the project cost; (b) compliance with the standards, designs, or specifications set by law and the following agencies: (i) DPWH for local roads and bridges, flood control and drainage systems, multi-purpose buildings, or government buildings; or (ii) DPWH and DepEd or CHED, as the case may be, for classrooms, school buildings, or academic buildings; and (c) turnover of the management and ownership of the infrastructure projects upon completion thereof to LGUs, which shall shoulder the maintenance and repair costs.',
      where: 'DPWH Special Provision No. 3, House Bill No. 10858 (third reading), Volume I-B. The FY2026 GAA has the same words as Special Provision No. 5.',
      doc: 'house3r_ib',
      page: 10,
    },
  },
  {
    key: 'sipag',
    term: 'SIPAG',
    name: 'Sustainable Infrastructure Projects Alleviating Gaps',
    plain: [
      'A second set of DPWH lines for the same kinds of local projects as BIP.',
      'It pays for access roads, flood mitigation, multi-purpose buildings, public buildings and evacuation centres.',
      'Its lines run from FY2022 to FY2026, and the FY2026 GAA sets no special rules for it.',
      'The FY2027 NEP and House bill have no SIPAG lines.',
    ],
    quote: null,
  },
];

// ---------------------------------------------------------------------------
// The data file
// ---------------------------------------------------------------------------

/** One value per column (HISTORY_COLUMNS order). */
export type HistoryCells = ReadonlyArray<number | null>;

export interface HistoryPart {
  key: string;
  label: string;
  /** Integer pesos per column. */
  php: HistoryCells;
  /** Project lines with an amount per column (GAA: PAP codes; FY2027: published lines); null where not counted. */
  projects: HistoryCells;
  /** Of `php`, the foreign-assisted lines (DPWH only; null where the source does not separate them). */
  foreign_php: HistoryCells;
}

export interface HistorySeries {
  key: HistorySeriesKey;
  label: string;
  department: HistoryDepartment;
  plain: string;
  /** Sum of the parts per column; null when every part is null. */
  php: HistoryCells;
  projects: HistoryCells;
  /** Of `php`, the foreign-assisted lines (sum of the parts'). */
  foreign_php: HistoryCells;
  parts: HistoryPart[];
  overlaps: HistorySeriesKey[];
  /** The FY2027 project list the card opens; null when the line has none. */
  list2027: HistoryList | null;
}

export interface HistoryList {
  dataset: 'dpwh' | 'hfep';
  params: Record<string, string>;
  /** What the list adds up to, and its rows with an amount, per stage. */
  nep_php: number;
  house_php: number;
  nep_rows: number;
  house_rows: number;
  /**
   * Part of the line's FY2027 cells the list does not itemise: DOH's operating costs, published once for the
   * whole program. 0 when the list is the whole line.
   */
  unlisted_php: number;
  /**
   * NEP only: how much less the published list's lines add up to than the total published on it (the
   * section's documented ₱140,000 error in the NEP health-facilities list); 0 elsewhere.
   */
  nep_list_gap_php: number;
}

/** A DepEd or DOH line in every enacted budget, on the GAA explorer's Programs view. */
export function gaaHistoryHref(h: { dept: string; q: string }): string {
  return `/d/${h.dept}/programs?${new URLSearchParams({ q: h.q }).toString()}`;
}

/** The Projects view a list opens: `/hgab/2027/<dataset>?view=projects&…`. */
export function listHref(l: Pick<HistoryList, 'dataset' | 'params'>): string {
  const q = new URLSearchParams({ view: 'projects', ...l.params });
  return `/hgab/2027/${l.dataset}?${q.toString()}`;
}

export interface HistorySource {
  key: HistorySourceKey | 'vol_ia' | 'pbc_files';
  label: string;
  /** Path or URL as read by the builder (local paths are not published). */
  path: string;
  sha256?: string;
}

export interface HistoryData {
  schema: typeof HISTORY_SCHEMA;
  built_at: string;
  columns: HistoryColumn[];
  series: HistorySeries[];
  sources: HistorySource[];
  /** Reconciliations the builder ran; each must hold or nothing is written. */
  checks: Array<{ key: string; label: string; ok: true; detail: string }>;
  /**
   * FY2027 House bill figures read from Volume I-A: the program line and its page, and the page of the special
   * provision that says what the line pays for (null when the bill has none).
   */
  printed: Array<{ series: HistorySeriesKey; label: string; mooe_php: number; co_php: number; total_php: number; page: number; provision_page: number | null }>;
  /** Other FY2027 lines for the same kind of facility (DEPED_EXTRA_LINES): NEP and House bill, with the bill's page. */
  extras: HistoryExtra[];
}

export interface HistoryExtra {
  series: HistorySeriesKey;
  key: string;
  label: string;
  plain: string;
  nep_php: number | null;
  house_php: number | null;
  page: number;
}

/**
 * DepEd's other lines for school facilities, besides Basic Education Facilities (2027 only):
 * - the Quick Response Fund, a standby fund to rebuild and repair school buildings after disasters;
 * - Infrastructure for Safer and Resilient Schools, a World Bank loan project;
 * - Improvement and Acquisition of School Sites.
 * NEP: the DBM extract by PAP code. House bill: the line in Volume I-A. Every capture but the last are its
 * expense classes, which must add up to the last (the total). "Quick Response Fund" also names other agencies'
 * lines, so DepEd's is the first one after its Basic Education Facilities line (`after`, in lines).
 */
export interface HistoryExtraDef {
  key: 'qrf' | 'isrs' | 'sites';
  series: 'deped';
  code: string;
  label: string;
  plain: string;
  printed: RegExp;
  after?: number;
}
export const DEPED_EXTRA_LINES: readonly HistoryExtraDef[] = [
  {
    key: 'qrf', series: 'deped', code: '310200100010000', label: 'Quick Response Fund', plain: 'repairs after disasters',
    printed: /^\s*\d+\s+Quick Response Fund\s+([\d,]+)\s+([\d,]+)\s+\d+\s*$/, after: 20,
  },
  {
    key: 'isrs', series: 'deped', code: '310200300001000', label: 'Infrastructure for Safer and Resilient Schools (World Bank loan)', plain: 'a World Bank school project',
    printed: /^\s*\d+\s+Project WB Loan No\. 9704-PH\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+\d+\s*$/,
  },
  {
    key: 'sites', series: 'deped', code: '310200100001000', label: 'Improvement and Acquisition of School Sites', plain: 'school sites',
    printed: /^\s*\d+\s+Improvement and Acquisition of School Sites\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+\d+\s*$/,
  },
];

export const HISTORY_CSV_COLUMNS = [
  'series', 'part', 'department', 'fiscal_year', 'stage', 'column', 'amount_php', 'project_lines', 'source',
] as const;

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

export function columnIndex(key: string): number {
  const i = HISTORY_COLUMNS.findIndex((c) => c.key === key);
  if (i < 0) throw new Error(`unknown history column ${key}`);
  return i;
}

/** Sum of non-null cells; null when all are null. */
export function sumCells(cells: ReadonlyArray<number | null>): number | null {
  let any = false;
  let s = 0;
  for (const v of cells) {
    if (v == null) continue;
    any = true;
    s += v;
  }
  return any ? s : null;
}

/** Column-wise sum of several rows of cells (parts into a series). */
export function sumRows(rows: ReadonlyArray<HistoryCells>): (number | null)[] {
  return HISTORY_COLUMNS.map((_, i) => sumCells(rows.map((r) => r[i] ?? null)));
}

export function seriesOf(data: HistoryData, key: HistorySeriesKey): HistorySeries {
  const s = data.series.find((x) => x.key === key);
  if (!s) throw new Error(`series ${key} missing from history.json`);
  return s;
}
