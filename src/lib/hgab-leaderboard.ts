/**
 * FY2027 House bill leaderboards: the data contract, the board definitions,
 * the share-image formats and the ranking.
 *
 * Pure on purpose (no runtime imports, no `import.meta.env`) so the builder
 * (`scripts/build-hgab-leaderboard.ts`), the verifier, the Worker's SEO module
 * and the pages all share one definition of every board.
 *
 * Integrity rules carried from the rest of the section:
 * - The unit ranked is a set of DPWH district engineering offices and every
 *   legislative district they serve (a connected group). A one-district group
 *   is Tier A; a group whose office serves several districts is Tier B, is
 *   shown with every district it serves, and is never split.
 * - FY2027 figures are on the compared population: the DPWH project lines of
 *   the NEP and of House Bill 10858 (third reading), the same rows the
 *   district pages compare. The NEP and the House bill are compared, never added.
 * - "Added" = a House line with no matching NEP line (`house_only_candidate`).
 *   Lines whose NEP match is unconfirmed (`fuzzy_candidate`, `ambiguous`) are
 *   held out of the rankings and carried separately.
 * - Amounts belong to offices, not people. A representative is shown because
 *   they hold the district's seat in the 20th Congress; the documents do not
 *   say who asked for any project.
 * - Integer pesos; null is "no figure", never zero.
 *
 * The whole-bill boards (section "wholebill", kind "lines") are the exception:
 * they rank departments, agencies and budget lines across the whole House
 * bill, from the line-by-line explorer's boards.json (WholeBillData), with no
 * offices, districts or people, so none of the office rules above apply to
 * them and they carry the comparison disclaimer, not the office one.
 */

import { CARD_DISCLAIMER } from './hgab-disclaimers';
import { contractorPath } from './hgab-contractors';
import { MPB_MAP_ROOT } from './hgab-mpb-years';

export const LEADERBOARD_SCHEMA = 1 as const;
export const LEADERBOARD_ROOT = '/hgab/2027/leaderboard';
/** R2 key (under the data base URL) of the leaderboard file. */
export const LEADERBOARD_DATA_PATH = 'hgab/2027/leaderboard.json';
/** R2 key prefix of the pre-rendered link-preview images (`<board>.png`, 1200×630, national). */
export const LEADERBOARD_SHARE_PREFIX = 'hgab/2027/share';

// ---------------------------------------------------------------------------
// Data contract (data/hgab/2027/leaderboard.json)
// ---------------------------------------------------------------------------

export interface LeaderPerson {
  district_id: string;
  /** "Abra, Lone District" */
  district: string;
  jurisdiction: string;
  /** "Lone District" */
  district_label: string;
  region: string;
  /** Display name; for an ambiguous seat, every name listed joined by " / ". Null when no representative was found. */
  name: string | null;
  status: 'resolved' | 'ambiguous' | 'missing';
  portrait_url: string | null;
  /** "House of Representatives of the Philippines · Public domain" */
  portrait_credit: string | null;
  portrait_source_url: string | null;
  profile_url: string | null;
  juris_url: string | null;
  bill_count: number | null;
  leadership_roles: string[];
  /** District page path. */
  href: string;
}

export interface LeaderEntry {
  /** The district id for a one-district group; "shared:" + sorted office ids joined by "+" otherwise. */
  key: string;
  tier: 'A' | 'B';
  /** RegionKey of the group's offices. */
  region: string;
  /** Every district the group's offices serve, sorted by district label. */
  people: LeaderPerson[];
  offices: { id: string; name: string }[];
  /** Page to open: the district page (first district for a shared group). */
  href: string;

  // FY2027, DPWH project lines (compared population)
  nep_php: number | null;
  hgab3_php: number | null;
  /** hgab3_php − nep_php; null unless both exist. */
  delta_php: number | null;
  /** (hgab3 − nep) / nep × 100; null when there is no NEP figure or it is zero. */
  delta_pct: number | null;
  /** House bill (third reading) lines. */
  hgab3_rows: number | null;
  /** House lines with no NEP match (`house_only_candidate`). */
  added_php: number;
  added_rows: number;
  /** House lines whose NEP match is unconfirmed (`fuzzy_candidate` + `ambiguous`): held out of rankings. */
  held_php: number;
  held_rows: number;
  /** NEP lines with no House match (`nep_only_candidate`). */
  dropped_php: number;
  dropped_rows: number;

  // Enacted budgets (GAA), whole office as listed in each year's GAA
  /** "2020" … "2026" → pesos, null where the GAA lists no figure for the office. */
  gaa: Record<string, number | null>;
  /** Sum of the non-null GAA years; null when none. */
  gaa_total_php: number | null;
  /** Years that carry a figure. */
  gaa_years: number[];
  /** GAA subtotal by Congress ("18" = 2020–2022, "19" = 2023–2025, "20" = 2026). */
  congress: Record<'18' | '19' | '20', number | null>;
  /** Mean annual GAA, 20th Congress against the 18th, in percent (same rule as the district cards). */
  growth_pct: number | null;
  /**
   * True when an office in the group was created, renamed or carved out of
   * another office since 2020, so part of its earlier money is listed under a
   * different office (its district-page notes say so). Such groups are left
   * out of the growth and decline boards.
   */
  reorganised: boolean;
  /** The office notes that set `reorganised`, verbatim from districts.json. */
  reorganised_notes: string[];

  // Upstream uncertainty annotations carried per group (never folded into the figures above)
  /**
   * Paired lines touching this group's offices whose NEP and House bill sides name
   * different office groups (or one side names no district office). They are held
   * out of every group and counted in `totals.by_office_kind.office_change`.
   */
  office_change_rows: number;
  /** Lines in segment-scope review (same road, different stretch): counted in the totals, never as an increase or a cut. */
  scope_rows: number;
}

/** The same FY2027 figures summed for one slice (an office kind, a region, the whole dataset). */
export interface LeaderSlice {
  nep_php: number;
  hgab3_php: number;
  added_php: number;
  added_rows: number;
  held_php: number;
  held_rows: number;
  dropped_php: number;
  dropped_rows: number;
}

export interface LeaderRegion extends LeaderSlice {
  region: string;
  units: number;
  districts: number;
  delta_php: number;
  gaa2026_php: number | null;
}

export interface LeaderboardData {
  schema: typeof LEADERBOARD_SCHEMA;
  fiscal_year: 2027;
  built_at: string;
  source_commit: string;
  dataset: 'dpwh';
  totals: {
    /** The whole DPWH compared population. */
    all: LeaderSlice;
    /** District engineering offices (incl. sub-district offices), Central Office, regional offices. */
    by_office_kind: {
      deo: LeaderSlice;
      central: LeaderSlice;
      regional: LeaderSlice;
      /** Paired lines whose two sides name different office groups, or one side no district office: held out of every group. */
      office_change: LeaderSlice & { rows: number };
      /**
       * Lines the source reads as naming no office (the side lists one, its grouped records do not): residual
       * as upstream, in no group. deo + central + regional + no_office + office_change = all.
       */
      no_office: LeaderSlice & { rows: number };
    };
    /**
     * Enacted budgets by year: the DPWH total and the part no district office
     * carries (Central Office, regional offices, operating units linked to no
     * district), copied from districts.json `residual`.
     */
    gaa_residual: { fy: number; total_php: number; deo_php: number; central_office_php: number; regional_offices_php: number; unmatched_php: number }[];
    units: number;
    units_tier_a: number;
    units_tier_b: number;
    districts: number;
    /** Districts with no office ledger: never ranked, listed in `districts_without_office`. */
    districts_without_office: { id: string; label: string }[];
  };
  entries: LeaderEntry[];
  /** REGION_ORDER order; DEO groups only. */
  regions: LeaderRegion[];
  credits: { portraits: string; representatives: string; documents: string };
  notes: string[];
  /** The whole-bill boards' rows, attached by the loader from WHOLE_BILL_DATA_PATH (absent in leaderboard.json). */
  whole_bill?: WholeBillData;
  /** The multi-purpose building boards' rows, attached by the loader from MPB_BOARDS_PATH (absent in leaderboard.json). */
  mpb?: MpbBoardsData;
}

// ---------------------------------------------------------------------------
// Multi-purpose buildings, 2020 to 2026 (data/hgab/2027/mpb-boards/boards.json)
// ---------------------------------------------------------------------------

/** npm run build:hgab-mpb-boards, from the multi-purpose map's lines and contracts. */
export const MPB_BOARDS_PATH = 'hgab/2027/mpb-boards/boards.json';

export type MpbBoardSet = 'contractors' | 'barangays' | 'offices' | 'districts';

export interface MpbBoardRow {
  /** Contractor key, place key, office name or legislative district id. */
  key: string;
  /** The contractor, the barangay, the DPWH office or the legislative district: a place leads, never a person. */
  label: string;
  /** A second line: where, the contracts, or the district's region. */
  sub: string;
  /** The map, narrowed to this row's lines (2020 to 2026). */
  href: string;
  /** RegionKey; null for contractors, who work across regions. */
  region: string | null;
  lines: number;
  /** The lines' enacted-budget amount. */
  gaa_php: number;
  /** Contractors only: contracts, each once, and their amount. */
  contracts: number | null;
  contract_php: number | null;
  first_year: number;
  last_year: number;
  /** Contractors: the contractor's page; districts: the district page. */
  page: string | null;
  /** Districts: the representative now in the seat, shown only on a board with `mpbPeople` (none for now). */
  person: LeaderPerson | null;
}

export interface MpbBoardsData {
  schema: 1;
  built_at: string;
  /** The enacted budgets ranked. */
  years: [number, number];
  /** Every multi-purpose building line in those budgets. */
  totals: { lines: number; gaa_php: number };
  /** Per board, the lines no row carries: no matched contract, no barangay in the title, not under a district office, no district. */
  residual: Record<MpbBoardSet, { lines: number; gaa_php: number }>;
  contractors: MpbBoardRow[];
  barangays: MpbBoardRow[];
  offices: MpbBoardRow[];
  districts: MpbBoardRow[];
  /** SHA-256 of the inputs: mpb-years/lines.json, contractors/mpb-links.json, districts.json. */
  sources: Record<string, string>;
  /** Every legislative district's representative, by district id (built as leaderboard.json builds its people). */
  people: Record<string, LeaderPerson>;
}

/** The file as written: each set's rows as arrays in MPB_BOARD_COLS order; links are made by decodeMpbBoards. */
export type MpbBoardsFile = Omit<MpbBoardsData, MpbBoardSet> & { cols: string[]; sets: Record<MpbBoardSet, unknown[][]> };
export const MPB_BOARD_COLS = [
  'key', 'label', 'sub', 'region', 'lines', 'gaa_php', 'contracts', 'contract_php', 'first_year', 'last_year',
] as const;
export const MPB_BOARD_SETS: readonly MpbBoardSet[] = ['contractors', 'barangays', 'offices', 'districts'];

/** The map, narrowed to a row's lines in the boards' years; and the contractor's or district's own page. */
export function mpbRowLinks(set: MpbBoardSet, key: string, years: readonly [number, number]): { href: string; page: string | null } {
  const ys = Array.from({ length: years[1] - years[0] + 1 }, (_, i) => years[0] + i).join(',');
  const param = { contractors: 'contractor', barangays: 'place', offices: 'q', districts: 'district' }[set];
  return {
    href: `${MPB_MAP_ROOT}?years=${ys}&${param}=${encodeURIComponent(key)}`,
    page: set === 'contractors' ? contractorPath(key) : set === 'districts' ? `/hgab/2027/districts/${encodeURIComponent(key)}` : null,
  };
}

export function decodeMpbBoards(f: MpbBoardsFile): MpbBoardsData {
  const c = Object.fromEntries(f.cols.map((n, k) => [n, k])) as Record<string, number>;
  for (const n of MPB_BOARD_COLS) if (c[n] == null) throw new Error(`mpb-boards/boards.json has no column ${n}`);
  const decode = (set: MpbBoardSet) => f.sets[set].map((r): MpbBoardRow => {
    const key = String(r[c.key]);
    return {
      key, label: String(r[c.label]), sub: String(r[c.sub] ?? ''), region: (r[c.region] as string | null) ?? null,
      lines: Number(r[c.lines]), gaa_php: Number(r[c.gaa_php]),
      contracts: r[c.contracts] == null ? null : Number(r[c.contracts]),
      contract_php: r[c.contract_php] == null ? null : Number(r[c.contract_php]),
      first_year: Number(r[c.first_year]), last_year: Number(r[c.last_year]),
      ...mpbRowLinks(set, key, f.years),
      person: set === 'districts' ? f.people[key] ?? null : null,
    };
  });
  const { cols: _cols, sets: _sets, ...rest } = f;
  void _cols; void _sets;
  return { ...rest, contractors: decode('contractors'), barangays: decode('barangays'), offices: decode('offices'), districts: decode('districts') };
}

// ---------------------------------------------------------------------------
// Whole House bill (data/hgab/2027/explorer/boards.json)
// ---------------------------------------------------------------------------

/**
 * R2 key of the whole-bill boards' rows, built with the line-by-line explorer
 * (`npm run build:hgab-lines`, scripts/hgab-lines/build_explorer.py). The
 * leaderboard loader attaches it to LeaderboardData as `whole_bill`; it is not
 * part of leaderboard.json, and the DPWH boards never read it.
 */
export const WHOLE_BILL_DATA_PATH = 'hgab/2027/explorer/boards.json';

export type WholeBillSet = 'departments' | 'agencies' | 'lines';

/** One department (or fund), agency or budget line, the NEP against the House bill (third reading). */
export interface WholeBillRow {
  /** "DSWD", "DOH Office of the Secretary", "Medical Assistance Program (MAP)". */
  label: string;
  /** Where it sits: the department's full name, or "DOH · Office of the Secretary" for a line. */
  sub: string;
  nep_php: number;
  hgab3_php: number;
  /** hgab3_php − nep_php. */
  delta_php: number;
  /** Percent; null when the NEP has nothing for it. */
  delta_pct: number | null;
  /** The explorer page that lists its lines. */
  href: string;
  /** Lines only: "house_only" when no line of that name is in the NEP for the agency (a candidate). */
  status?: 'same' | 'higher' | 'lower' | 'house_only' | 'nep_only';
  note?: string | null;
}

export interface WholeBillData {
  schema: 1;
  built_at: string;
  scope: { hgab3_php: number; nep_php: number; unprogrammed_php: number; line_groups: number };
  departments: WholeBillRow[];
  agencies: WholeBillRow[];
  /** Programs, activities and projects outside the DPWH, farm-to-market road, HFEP and NIA project lists. */
  lines: WholeBillRow[];
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

export type BoardKind = 'ranking' | 'members' | 'congress' | 'shift' | 'regions' | 'lines' | 'mpb';
export type BoardSection = 'fy2027' | 'wholebill' | 'history' | 'mpb' | 'members' | 'picture';
export type ValueKind = 'php' | 'signed_php' | 'count' | 'pct' | 'share';

export const BOARD_SECTIONS: ReadonlyArray<{ key: BoardSection; label: string; blurb: string }> = [
  { key: 'picture', label: 'The big picture', blurb: 'Where the DPWH budget sits in the NEP and in the House bill.' },
  { key: 'fy2027', label: '2027: the House bill against the NEP', blurb: 'DPWH projects by DPWH office (DEO), as listed in each document.' },
  { key: 'wholebill', label: '2027: the whole House bill, by department', blurb: 'Departments, agencies and budget lines across the House bill, against the NEP. Not tied to any district.' },
  { key: 'history', label: '2020 to 2026: enacted budgets', blurb: 'What each DPWH office (DEO) received in the enacted budgets.' },
  { key: 'mpb', label: '2020 to 2026: multi-purpose buildings', blurb: 'Multi-purpose building lines in the enacted budgets, by contractor, barangay, DPWH office and legislative district.' },
  { key: 'members', label: 'The members', blurb: 'The representatives themselves, from their legislative records.' },
];

export interface BoardDef {
  id: string;
  section: BoardSection;
  kind: BoardKind;
  /** Small caps line above the title. */
  kicker: string;
  /** Card headline: plain words, at most about 60 characters. */
  title: string;
  /** One sentence: what is ranked and from which document. */
  subtitle: string;
  value: ValueKind;
  order: 'desc' | 'asc';
  /** Ranking boards: the figure ranked. */
  metric?: (e: LeaderEntry) => number | null;
  /** Ranking boards: who may appear (sign, floors). Rows with a null metric never appear. */
  keep?: (e: LeaderEntry) => boolean;
  /** Regions boards: the figure ranked per region. */
  regionMetric?: (r: LeaderRegion) => number | null;
  /** A short second line under the value ("in 14 projects"). */
  detail?: (e: LeaderEntry) => string | null;
  /** Footnotes, most important first; the first one is printed on the card. */
  notes: string[];
  /** Whether `?region=` applies. */
  regionFilter: boolean;
  /** Lines boards: which whole-bill rows are ranked, by what, and who may appear. */
  rowSet?: WholeBillSet;
  rowMetric?: (r: WholeBillRow) => number | null;
  rowKeep?: (r: WholeBillRow) => boolean;
  rowDetail?: (r: WholeBillRow) => string | null;
  /** Multi-purpose building boards: which rows are ranked, by what, and the line under the value. */
  mpbSet?: MpbBoardSet;
  /**
   * The district board: show each district's representative now in the seat (portrait and name, as the office boards
   * do). Off for now (Jason, 2026-11-03): 2020 to 2026 spans the 18th, 19th and 20th Congresses.
   */
  mpbPeople?: boolean;
  mpbMetric?: (r: MpbBoardRow) => number | null;
  mpbDetail?: (r: MpbBoardRow) => string | null;
}

const PEOPLE_NOTE = 'Amounts are for the DPWH office serving each legislative district. The documents do not say who asked for any project.';
/** Printed on every share card that shows people when the board's first note is not PEOPLE_NOTE. */
/** Printed on every share image that shows people beside amounts (see hgab-disclaimers.ts). */
export const PEOPLE_LINE = CARD_DISCLAIMER;
const ADDED_NOTE = '“Added” means no matching line was found in the NEP: a candidate, not a confirmed insertion. Projects whose NEP match is unconfirmed are left out.';
const SHARED_NOTE = 'A DPWH office that serves several legislative districts is shown with all of them. Its amount is not split.';
const GAA_NOTE = 'Enacted budgets list the whole office. New or renamed offices have fewer years; earlier years stay with their old office.';

const WHOLE_NOTE = 'Every appropriation line of the House bill (third reading) against the NEP. Unprogrammed appropriations are not in the NEP data and are left out.';
const PCT_FLOOR_NOTE = 'Only departments and funds with ₱1 billion or more in the NEP, so small budgets do not dominate.';
const DPWH_IN_NOTE = 'DPWH figures include its project list, which the DPWH boards rank by office.';
const LINE_NOTE = 'A budget line is a program, activity or project, all its regions, offices and expense classes added up. DPWH projects, farm-to-market roads, health facilities and irrigation have their own pages and are left out.';
const MATCH_NOTE = 'Lines are matched by name within each agency. A line renamed between the two documents is matched through the House bill’s second reading where it can be.';
const ADDED_LINE_NOTE = '“No match” means no line of that name was found in the NEP for the agency: a candidate, not a confirmed insertion. It may be renamed or moved.';

/** "₱240.69B → ₱262.76B": a row's NEP and House bill figures. */
function nepToHouse(r: WholeBillRow): string {
  return `${formatValue(r.nep_php, 'php')} → ${formatValue(r.hgab3_php, 'php')}`;
}

const REORG_NOTE = 'Offices created, renamed or carved out since 2020 are left out: part of their earlier budget sits with another office.';

const MPB_KICKER = 'Multi-purpose buildings · 2020–2026';
const MPB_REPEAT_NOTE = 'A building funded over several years has a line in each year. Amounts are allocations, not spending.';
const MPB_LINES = (r: MpbBoardRow) => `${plural(r.lines, 'line', 'lines')}, ${r.first_year === r.last_year ? r.first_year : `${r.first_year}–${r.last_year}`}`;

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** For the growth boards: no recorded reorganisation and at least ₱500 million a year on average in 2020–2022. */
function steadyHistory(e: LeaderEntry): boolean {
  const base = e.congress['18'];
  return !e.reorganised && base != null && base / 3 >= 500_000_000;
}

export const BOARDS: readonly BoardDef[] = [
  // The big picture
  {
    id: 'shift', section: 'picture', kind: 'shift', value: 'php', order: 'desc',
    kicker: '2027 · DPWH projects · NEP and House bill',
    title: 'Where the DPWH project budget sits',
    subtitle: 'DPWH project lines by type of office, in the NEP and in the House bill (third reading).',
    notes: ['Same project lists in both documents. The NEP and the House bill are compared, not added.', PEOPLE_NOTE],
    regionFilter: false,
  },
  {
    id: 'regions-added', section: 'picture', kind: 'regions', value: 'php', order: 'desc',
    kicker: '2027 · DPWH projects · by region',
    title: 'Projects the House added, by region',
    subtitle: 'Budget for House bill projects with no matching line in the NEP, summed over each region’s DEOs.',
    regionMetric: (r) => r.added_php,
    notes: [ADDED_NOTE, 'Central Office and regional office projects are not in any region’s total.'],
    regionFilter: false,
  },
  {
    id: 'regions-change', section: 'picture', kind: 'regions', value: 'signed_php', order: 'desc',
    kicker: '2027 · DPWH projects · by region',
    title: 'Change from the NEP, by region',
    subtitle: 'House bill minus the NEP on the same DPWH project lists, summed over each region’s DEOs.',
    regionMetric: (r) => r.delta_php,
    notes: ['Central Office and regional office projects are not in any region’s total.', SHARED_NOTE],
    regionFilter: false,
  },

  // 2027: the House bill against the NEP
  {
    id: 'house-bill-largest', section: 'fy2027', kind: 'ranking', value: 'php', order: 'desc',
    kicker: '2027 House bill · DPWH projects',
    title: 'Largest DPWH amounts in the House bill',
    subtitle: 'DPWH offices ranked by their project total in House Bill 10858, third reading.',
    metric: (e) => e.hgab3_php,
    detail: (e) => (e.hgab3_rows != null ? `in ${plural(e.hgab3_rows, 'budget line', 'budget lines')}` : null),
    notes: [PEOPLE_NOTE, SHARED_NOTE],
    regionFilter: true,
  },
  {
    id: 'added-budget', section: 'fy2027', kind: 'ranking', value: 'php', order: 'desc',
    kicker: '2027 House bill · DPWH projects',
    title: 'Largest budget in projects the House added',
    subtitle: 'House bill projects with no matching line in the NEP, by DPWH office.',
    metric: (e) => e.added_php,
    keep: (e) => e.added_rows > 0,
    detail: (e) => `in ${plural(e.added_rows, 'project', 'projects')}`,
    notes: [ADDED_NOTE, PEOPLE_NOTE, SHARED_NOTE],
    regionFilter: true,
  },
  {
    id: 'added-count', section: 'fy2027', kind: 'ranking', value: 'count', order: 'desc',
    kicker: '2027 House bill · DPWH projects',
    title: 'Most projects the House added',
    subtitle: 'Number of House bill projects with no matching line in the NEP, by DPWH office.',
    metric: (e) => e.added_rows,
    keep: (e) => e.added_rows > 0,
    detail: (e) => `worth ${formatValue(e.added_php, 'php')}`,
    notes: [ADDED_NOTE, PEOPLE_NOTE, SHARED_NOTE],
    regionFilter: true,
  },
  {
    id: 'increase', section: 'fy2027', kind: 'ranking', value: 'signed_php', order: 'desc',
    kicker: '2027 · DPWH projects · House bill minus NEP',
    title: 'Biggest increases over the NEP',
    subtitle: 'House bill minus the NEP on the same DPWH project lists, by DPWH office.',
    metric: (e) => e.delta_php,
    keep: (e) => (e.delta_php ?? 0) > 0,
    detail: (e) => (e.nep_php != null && e.hgab3_php != null ? `${formatValue(e.nep_php, 'php')} → ${formatValue(e.hgab3_php, 'php')}` : null),
    notes: [PEOPLE_NOTE, SHARED_NOTE],
    regionFilter: true,
  },
  {
    id: 'increase-pct', section: 'fy2027', kind: 'ranking', value: 'pct', order: 'desc',
    kicker: '2027 · DPWH projects · House bill against NEP',
    title: 'Biggest increases over the NEP, in percent',
    subtitle: 'Percent change from the NEP to the House bill, for DPWH offices with at least ₱500 million in the NEP.',
    metric: (e) => e.delta_pct,
    keep: (e) => (e.nep_php ?? 0) >= 500_000_000 && (e.delta_pct ?? 0) > 0,
    detail: (e) => (e.nep_php != null && e.hgab3_php != null ? `${formatValue(e.nep_php, 'php')} → ${formatValue(e.hgab3_php, 'php')}` : null),
    notes: ['Only offices with at least ₱500 million in the NEP, so small bases do not dominate.', PEOPLE_NOTE, SHARED_NOTE],
    regionFilter: true,
  },
  {
    id: 'cuts', section: 'fy2027', kind: 'ranking', value: 'signed_php', order: 'asc',
    kicker: '2027 · DPWH projects · House bill minus NEP',
    title: 'Biggest cuts from the NEP',
    subtitle: 'DPWH offices whose project total is lower in the House bill than in the NEP.',
    metric: (e) => e.delta_php,
    keep: (e) => (e.delta_php ?? 0) < 0,
    detail: (e) => (e.nep_php != null && e.hgab3_php != null ? `${formatValue(e.nep_php, 'php')} → ${formatValue(e.hgab3_php, 'php')}` : null),
    notes: ['Few DPWH offices have a smaller budget. The largest cut is in Central Office projects; see “Where the DPWH project budget sits”.', PEOPLE_NOTE, SHARED_NOTE],
    regionFilter: true,
  },
  {
    id: 'dropped', section: 'fy2027', kind: 'ranking', value: 'php', order: 'desc',
    kicker: '2027 · DPWH projects · NEP only',
    title: 'Largest budget in NEP projects the House bill does not list',
    subtitle: 'NEP projects with no matching line in the House bill, by DPWH office.',
    metric: (e) => e.dropped_php,
    keep: (e) => e.dropped_rows > 0,
    detail: (e) => `in ${plural(e.dropped_rows, 'project', 'projects')}`,
    notes: ['“Not listed” means no matching line was found in the House bill: a candidate, not a confirmed removal.', PEOPLE_NOTE, SHARED_NOTE],
    regionFilter: true,
  },
  {
    id: 'added-share', section: 'fy2027', kind: 'ranking', value: 'share', order: 'desc',
    kicker: '2027 House bill · DPWH projects',
    title: 'Largest share of the House bill in projects the House added',
    subtitle: 'Share of each office’s House bill total in projects with no NEP match. Offices with ₱1 billion or more only.',
    metric: (e) => (e.hgab3_php && e.hgab3_php > 0 ? e.added_php / e.hgab3_php : null),
    keep: (e) => (e.hgab3_php ?? 0) >= 1_000_000_000 && e.added_rows > 0,
    detail: (e) => `${formatValue(e.added_php, 'php')} of ${formatValue(e.hgab3_php, 'php')}`,
    notes: ['Only offices with at least ₱1 billion in the House bill.', ADDED_NOTE, PEOPLE_NOTE],
    regionFilter: true,
  },

  // 2027: the whole House bill, by department
  {
    id: 'departments-increase', section: 'wholebill', kind: 'lines', value: 'signed_php', order: 'desc',
    kicker: '2027 · whole House bill · by department',
    title: 'Departments with the biggest increases over the NEP',
    subtitle: 'House bill minus the NEP for each department and fund, every one of its lines added up.',
    rowSet: 'departments', rowMetric: (r) => r.delta_php, rowKeep: (r) => r.delta_php > 0, rowDetail: nepToHouse,
    notes: [WHOLE_NOTE, DPWH_IN_NOTE],
    regionFilter: false,
  },
  {
    id: 'departments-cuts', section: 'wholebill', kind: 'lines', value: 'signed_php', order: 'asc',
    kicker: '2027 · whole House bill · by department',
    title: 'Departments with the biggest cuts from the NEP',
    subtitle: 'Departments and funds whose total is lower in the House bill than in the NEP.',
    rowSet: 'departments', rowMetric: (r) => r.delta_php, rowKeep: (r) => r.delta_php < 0, rowDetail: nepToHouse,
    notes: [WHOLE_NOTE],
    regionFilter: false,
  },
  {
    id: 'departments-increase-pct', section: 'wholebill', kind: 'lines', value: 'pct', order: 'desc',
    kicker: '2027 · whole House bill · by department',
    title: 'Biggest increases in percent, by department',
    subtitle: 'Percent change from the NEP to the House bill, for departments and funds with ₱1 billion or more in the NEP.',
    rowSet: 'departments', rowMetric: (r) => r.delta_pct, rowKeep: (r) => r.nep_php >= 1_000_000_000 && (r.delta_pct ?? 0) > 0, rowDetail: nepToHouse,
    notes: [PCT_FLOOR_NOTE, WHOLE_NOTE],
    regionFilter: false,
  },
  {
    id: 'departments-cuts-pct', section: 'wholebill', kind: 'lines', value: 'pct', order: 'asc',
    kicker: '2027 · whole House bill · by department',
    title: 'Biggest cuts in percent, by department',
    subtitle: 'Percent change from the NEP to the House bill, for departments and funds with ₱1 billion or more in the NEP.',
    rowSet: 'departments', rowMetric: (r) => r.delta_pct, rowKeep: (r) => r.nep_php >= 1_000_000_000 && (r.delta_pct ?? 0) < 0, rowDetail: nepToHouse,
    notes: [PCT_FLOOR_NOTE, WHOLE_NOTE],
    regionFilter: false,
  },
  {
    id: 'agencies-increase', section: 'wholebill', kind: 'lines', value: 'signed_php', order: 'desc',
    kicker: '2027 · whole House bill · by agency',
    title: 'Agencies with the biggest increases over the NEP',
    subtitle: 'House bill minus the NEP for each agency, GOCC subsidy and fund, every one of its lines added up.',
    rowSet: 'agencies', rowMetric: (r) => r.delta_php, rowKeep: (r) => r.delta_php > 0, rowDetail: nepToHouse,
    notes: [WHOLE_NOTE, DPWH_IN_NOTE],
    regionFilter: false,
  },
  {
    id: 'agencies-cuts', section: 'wholebill', kind: 'lines', value: 'signed_php', order: 'asc',
    kicker: '2027 · whole House bill · by agency',
    title: 'Agencies with the biggest cuts from the NEP',
    subtitle: 'Agencies, GOCC subsidies and funds whose total is lower in the House bill than in the NEP.',
    rowSet: 'agencies', rowMetric: (r) => r.delta_php, rowKeep: (r) => r.delta_php < 0, rowDetail: nepToHouse,
    notes: [WHOLE_NOTE],
    regionFilter: false,
  },
  {
    id: 'lines-increase', section: 'wholebill', kind: 'lines', value: 'signed_php', order: 'desc',
    kicker: '2027 · whole House bill · budget lines',
    title: 'Budget lines with the biggest increases',
    subtitle: 'Programs, activities and projects found in both documents, House bill minus the NEP.',
    rowSet: 'lines', rowMetric: (r) => r.delta_php, rowKeep: (r) => r.status === 'higher', rowDetail: nepToHouse,
    notes: [LINE_NOTE, MATCH_NOTE],
    regionFilter: false,
  },
  {
    id: 'lines-cuts', section: 'wholebill', kind: 'lines', value: 'signed_php', order: 'asc',
    kicker: '2027 · whole House bill · budget lines',
    title: 'Budget lines with the biggest cuts',
    subtitle: 'Programs, activities and projects found in both documents, House bill minus the NEP.',
    rowSet: 'lines', rowMetric: (r) => r.delta_php, rowKeep: (r) => r.status === 'lower', rowDetail: nepToHouse,
    notes: [LINE_NOTE, MATCH_NOTE],
    regionFilter: false,
  },
  {
    id: 'lines-added', section: 'wholebill', kind: 'lines', value: 'php', order: 'desc',
    kicker: '2027 · whole House bill · budget lines',
    title: 'Largest budget lines with no match in the NEP',
    subtitle: 'House bill programs, activities and projects with no line of the same name in the NEP for that agency.',
    rowSet: 'lines', rowMetric: (r) => r.hgab3_php, rowKeep: (r) => r.status === 'house_only',
    notes: [ADDED_LINE_NOTE, LINE_NOTE],
    regionFilter: false,
  },

  // 2020 to 2026: enacted budgets
  {
    id: 'enacted-total', section: 'history', kind: 'ranking', value: 'php', order: 'desc',
    kicker: 'Enacted budgets (GAA) · 2020 to 2026 · DPWH',
    title: 'Largest enacted DPWH budgets, 2020 to 2026',
    subtitle: 'Seven enacted budgets added up, by DPWH office.',
    metric: (e) => e.gaa_total_php,
    detail: (e) => (e.gaa_years.length && e.gaa_years.length < 7 ? `${e.gaa_years.length} of 7 years` : null),
    notes: [GAA_NOTE, PEOPLE_NOTE, SHARED_NOTE],
    regionFilter: true,
  },
  {
    id: 'enacted-2026', section: 'history', kind: 'ranking', value: 'php', order: 'desc',
    kicker: 'Enacted budget (GAA) · 2026 · DPWH',
    title: 'Largest enacted DPWH budgets in 2026',
    subtitle: 'The 2026 enacted budget of each DPWH office.',
    metric: (e) => e.gaa['2026'] ?? null,
    notes: [PEOPLE_NOTE, SHARED_NOTE],
    regionFilter: true,
  },
  {
    id: 'by-congress', section: 'history', kind: 'congress', value: 'php', order: 'desc',
    kicker: 'Enacted budgets (GAA) · by Congress · DPWH',
    title: 'The top five under each Congress',
    subtitle: 'Enacted DPWH budgets added up per Congress: 2020–2022, 2023–2025 and 2026.',
    notes: ['The 20th Congress has passed one budget so far (2026); the others passed three.', GAA_NOTE, PEOPLE_NOTE],
    regionFilter: true,
  },
  {
    id: 'growth', section: 'history', kind: 'ranking', value: 'pct', order: 'desc',
    kicker: 'Enacted budgets (GAA) · 18th to 20th Congress',
    title: 'Fastest growth from the 18th to the 20th Congress',
    subtitle: 'Average yearly enacted budget, 2026 against 2020 to 2022. Offices averaging ₱500 million or more a year then.',
    metric: (e) => e.growth_pct,
    keep: (e) => (e.growth_pct ?? 0) > 0 && steadyHistory(e),
    notes: [REORG_NOTE, PEOPLE_NOTE, SHARED_NOTE],
    regionFilter: true,
  },
  {
    id: 'decline', section: 'history', kind: 'ranking', value: 'pct', order: 'asc',
    kicker: 'Enacted budgets (GAA) · 18th to 20th Congress',
    title: 'Steepest drop from the 18th to the 20th Congress',
    subtitle: 'Average yearly enacted budget, 2026 against 2020 to 2022. Offices averaging ₱500 million or more a year then.',
    metric: (e) => e.growth_pct,
    keep: (e) => (e.growth_pct ?? 0) < 0 && steadyHistory(e),
    notes: [REORG_NOTE, 'A drop can also come from part of an office’s area moving to a newer office.', PEOPLE_NOTE, SHARED_NOTE],
    regionFilter: true,
  },

  // Multi-purpose buildings, 2020 to 2026
  {
    id: 'mpb-contractors', section: 'mpb', kind: 'mpb', value: 'php', order: 'desc',
    kicker: MPB_KICKER,
    title: 'Contractors with the most multi-purpose building contracts',
    subtitle: 'DPWH contract amounts for the multi-purpose building lines of the 2020 to 2026 enacted budgets, by contractor.',
    mpbSet: 'contractors', mpbMetric: (r) => r.contract_php,
    mpbDetail: (r) => `${plural(r.lines, 'line', 'lines')}, ${plural(r.contracts ?? 0, 'contract', 'contracts')}`,
    notes: [
      'We matched each contract to its budget line by title, office and amount. DPWH does not publish the link.',
      'Amounts are contract amounts in DPWH’s list, not payments. A joint-venture contract counts in full for each partner.',
    ],
    regionFilter: false,
  },
  {
    id: 'mpb-barangays', section: 'mpb', kind: 'mpb', value: 'php', order: 'desc',
    kicker: MPB_KICKER,
    title: 'Barangays with the largest multi-purpose building budget',
    subtitle: 'Multi-purpose building lines in the 2020 to 2026 enacted budgets, added up by the barangay each title names.',
    mpbSet: 'barangays', mpbMetric: (r) => r.gaa_php, mpbDetail: MPB_LINES,
    notes: ['A barangay counts only when a line’s title names it.', MPB_REPEAT_NOTE],
    regionFilter: true,
  },
  {
    id: 'mpb-offices', section: 'mpb', kind: 'mpb', value: 'php', order: 'desc',
    kicker: MPB_KICKER,
    title: 'DPWH offices with the largest multi-purpose building budget',
    subtitle: 'Multi-purpose building lines in the 2020 to 2026 enacted budgets, by the district engineering office (DEO) each lists.',
    mpbSet: 'offices', mpbMetric: (r) => r.gaa_php, mpbDetail: MPB_LINES,
    notes: ['By the DPWH office the budget names for each line. Central Office and regional office lines are left out.', MPB_REPEAT_NOTE],
    regionFilter: true,
  },
  {
    // No representatives for now (Jason, 2026-11-03): the years span three Congresses. `mpb-legislators` opens it.
    id: 'mpb-districts', section: 'mpb', kind: 'mpb', value: 'php', order: 'desc',
    kicker: 'Multi-purpose buildings · by legislative district',
    title: 'Legislative districts with the largest multi-purpose building budget',
    subtitle: 'Multi-purpose building lines in the 2020 to 2026 enacted budgets, by the legislative district each title places them in.',
    mpbSet: 'districts', mpbMetric: (r) => r.gaa_php, mpbDetail: MPB_LINES, mpbPeople: false,
    notes: [
      // The first note is printed on the card, with MPB_CARD_DISCLAIMER after it.
      'A district is where a title places the building. These budgets span the 18th, 19th and 20th Congresses.',
      'No representative is shown, since three Congresses passed these budgets. The documents do not say who asked for any building.',
      MPB_REPEAT_NOTE,
    ],
    regionFilter: true,
  },

  // The members
  {
    id: 'bills', section: 'members', kind: 'members', value: 'count', order: 'desc',
    kicker: 'House members · 20th Congress',
    title: 'Most bills as principal author',
    subtitle: 'District representatives ranked by 20th Congress House bills that list them as a principal author, on bills.juris.ph.',
    notes: [
      'Counts come from bills.juris.ph, whose 20th Congress list is not yet complete. Some bills list many principal authors.',
      'District representatives only; party-list members are not in this data. Seats with two listed members are left out.',
    ],
    regionFilter: true,
  },
];

/**
 * Board ids that were retired, and the board their links now open. "departments-pct"
 * ranked rises and cuts together by size; it was split on 2026-11-01, and its old
 * links open the cuts board, which held most of its top rows.
 */
export const BOARD_ALIASES: Readonly<Record<string, string>> = {
  'departments-pct': 'departments-cuts-pct',
  // The district board showed representatives on 2026-11-03 only; its address then is kept.
  'mpb-legislators': 'mpb-districts',
};

export function boardById(id: string | undefined): BoardDef | undefined {
  const want = id != null ? BOARD_ALIASES[id] ?? id : id;
  return BOARDS.find((b) => b.id === want);
}

// ---------------------------------------------------------------------------
// Share formats
// ---------------------------------------------------------------------------

export type ShareFormat = 'portrait' | 'square' | 'story' | 'landscape';

export const SHARE_FORMATS: Record<ShareFormat, { label: string; width: number; height: number; rows: number; use: string }> = {
  portrait: { label: 'Portrait 4:5', width: 1080, height: 1350, rows: 10, use: 'Facebook and Instagram posts' },
  square: { label: 'Square 1:1', width: 1080, height: 1080, rows: 6, use: 'Instagram, Facebook and Viber' },
  story: { label: 'Story 9:16', width: 1080, height: 1920, rows: 10, use: 'Stories, Reels and TikTok' },
  landscape: { label: 'Link 1.91:1', width: 1200, height: 630, rows: 5, use: 'X and Facebook link previews' },
};

export const SHARE_FORMAT_ORDER: readonly ShareFormat[] = ['portrait', 'square', 'story', 'landscape'];

export function isShareFormat(v: string | null | undefined): v is ShareFormat {
  return v === 'portrait' || v === 'square' || v === 'story' || v === 'landscape';
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function leaderboardPath(boardId?: string, opts: { region?: string | null; format?: ShareFormat | null } = {}): string {
  const base = boardId ? `${LEADERBOARD_ROOT}/${encodeURIComponent(boardId)}` : LEADERBOARD_ROOT;
  const q = new URLSearchParams();
  if (opts.region) q.set('region', opts.region);
  if (opts.format && opts.format !== 'portrait') q.set('format', opts.format);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

/** R2 key of a board's pre-rendered link preview (national, 1200×630). */
export function shareImageKey(boardId: string): string {
  return `${LEADERBOARD_SHARE_PREFIX}/${boardId}.png`;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface RankedRow {
  /** Competition rank: ties share a rank (1, 2, 2, 4). */
  rank: number;
  entry: LeaderEntry;
  value: number;
}

export interface RankedPerson {
  rank: number;
  person: LeaderPerson;
  entry: LeaderEntry;
  value: number;
}

export interface RankedRegion {
  rank: number;
  region: LeaderRegion;
  value: number;
}

function firstLabel(e: LeaderEntry): string {
  return e.people[0]?.district ?? e.key;
}

function competitionRanks<T>(sorted: T[], valueOf: (t: T) => number): number[] {
  const ranks: number[] = [];
  sorted.forEach((t, i) => {
    ranks.push(i > 0 && valueOf(sorted[i - 1]) === valueOf(t) ? ranks[i - 1] : i + 1);
  });
  return ranks;
}

function inRegion(e: LeaderEntry, region: string | null | undefined): boolean {
  return !region || e.region === region;
}

/** A ranking board's rows: eligible entries with a figure, best first, ties by district label. */
export function rankEntries(
  data: LeaderboardData,
  board: BoardDef,
  opts: { region?: string | null; limit?: number } = {},
): { rows: RankedRow[]; eligible: number } {
  if (!board.metric) return { rows: [], eligible: 0 };
  const m = board.metric;
  const dir = board.order === 'asc' ? 1 : -1;
  const pool = data.entries
    .filter((e) => inRegion(e, opts.region))
    .map((e) => ({ e, v: m(e) }))
    .filter((x): x is { e: LeaderEntry; v: number } => x.v != null && Number.isFinite(x.v) && (!board.keep || board.keep(x.e)))
    .sort((a, b) => (a.v - b.v) * dir || firstLabel(a.e).localeCompare(firstLabel(b.e)));
  const ranks = competitionRanks(pool, (x) => x.v);
  const rows = pool.map((x, i) => ({ rank: ranks[i], entry: x.e, value: x.v }));
  return { rows: opts.limit != null ? rows.slice(0, opts.limit) : rows, eligible: pool.length };
}

/** The members board: one row per resolved representative with a bill count. */
export function rankMembers(
  data: LeaderboardData,
  opts: { region?: string | null; limit?: number } = {},
): { rows: RankedPerson[]; eligible: number } {
  const pool: { person: LeaderPerson; entry: LeaderEntry; v: number }[] = [];
  for (const e of data.entries) {
    for (const p of e.people) {
      if (p.status !== 'resolved' || p.bill_count == null) continue;
      if (opts.region && p.region !== opts.region) continue;
      pool.push({ person: p, entry: e, v: p.bill_count });
    }
  }
  pool.sort((a, b) => b.v - a.v || a.person.district.localeCompare(b.person.district));
  const ranks = competitionRanks(pool, (x) => x.v);
  const rows = pool.map((x, i) => ({ rank: ranks[i], person: x.person, entry: x.entry, value: x.v }));
  return { rows: opts.limit != null ? rows.slice(0, opts.limit) : rows, eligible: pool.length };
}

/** The by-Congress board: the top `limit` groups under each Congress. */
export function rankByCongress(
  data: LeaderboardData,
  opts: { region?: string | null; limit?: number } = {},
): { congress: '18' | '19' | '20'; years: string; rows: RankedRow[] }[] {
  const terms: { congress: '18' | '19' | '20'; years: string }[] = [
    { congress: '18', years: '2020–2022' },
    { congress: '19', years: '2023–2025' },
    { congress: '20', years: '2026' },
  ];
  return terms.map((t) => {
    const def: BoardDef = { ...BOARDS.find((b) => b.id === 'by-congress')!, kind: 'ranking', metric: (e) => e.congress[t.congress] };
    return { ...t, rows: rankEntries(data, def, { region: opts.region, limit: opts.limit ?? 5 }).rows };
  });
}

/** A regions board: regions with a figure, best first, in REGION order on ties. */
export function rankRegions(data: LeaderboardData, board: BoardDef): RankedRegion[] {
  if (!board.regionMetric) return [];
  const m = board.regionMetric;
  const dir = board.order === 'asc' ? 1 : -1;
  const order = new Map(data.regions.map((r, i) => [r.region, i]));
  const pool = data.regions
    .map((r) => ({ r, v: m(r) }))
    .filter((x): x is { r: LeaderRegion; v: number } => x.v != null && Number.isFinite(x.v))
    .sort((a, b) => (a.v - b.v) * dir || (order.get(a.r.region)! - order.get(b.r.region)!));
  const ranks = competitionRanks(pool, (x) => x.v);
  return pool.map((x, i) => ({ rank: ranks[i], region: x.r, value: x.v }));
}

export interface RankedLine {
  rank: number;
  row: WholeBillRow;
  value: number;
}

/** What a lines board counts: "departments and funds", "agencies", "budget lines". */
export function lineUnit(board: BoardDef, n: number): string {
  const u: Record<WholeBillSet, [string, string]> = {
    departments: ['department or fund', 'departments and funds'],
    agencies: ['agency', 'agencies'],
    lines: ['budget line', 'budget lines'],
  };
  const [one, many] = u[board.rowSet ?? 'lines'];
  return n === 1 ? one : many;
}

/** A lines board's rows, best first, ties by label. Empty when the data is not loaded. */
export function rankLines(data: LeaderboardData, board: BoardDef, opts: { limit?: number } = {}): { rows: RankedLine[]; eligible: number } {
  const set = board.rowSet ? data.whole_bill?.[board.rowSet] : undefined;
  if (!set || !board.rowMetric) return { rows: [], eligible: 0 };
  const m = board.rowMetric;
  const dir = board.order === 'asc' ? 1 : -1;
  const pool = set
    .map((r) => ({ r, v: m(r) }))
    .filter((x): x is { r: WholeBillRow; v: number } => x.v != null && Number.isFinite(x.v) && (!board.rowKeep || board.rowKeep(x.r)))
    .sort((a, b) => (a.v - b.v) * dir || a.r.label.localeCompare(b.r.label));
  const ranks = competitionRanks(pool, (x) => x.v);
  const rows = pool.map((x, i) => ({ rank: ranks[i], row: x.r, value: x.v }));
  return { rows: opts.limit != null ? rows.slice(0, opts.limit) : rows, eligible: pool.length };
}

export interface RankedMpb {
  rank: number;
  row: MpbBoardRow;
  value: number;
}

/** What a multi-purpose building board counts: "contractors", "barangays", "DPWH offices", "legislative districts". */
export function mpbUnit(board: Pick<BoardDef, 'mpbSet'>, n: number): string {
  const u: Record<MpbBoardSet, [string, string]> = {
    contractors: ['contractor', 'contractors'],
    barangays: ['barangay', 'barangays'],
    offices: ['DPWH office', 'DPWH offices'],
    districts: ['legislative district', 'legislative districts'],
  };
  const [one, many] = u[board.mpbSet ?? 'barangays'];
  return n === 1 ? one : many;
}

/** A multi-purpose building board's rows, largest first, ties by label; `region` narrows boards with `regionFilter`. */
export function rankMpb(data: LeaderboardData, board: BoardDef, opts: { region?: string | null; limit?: number } = {}): { rows: RankedMpb[]; eligible: number } {
  const set = board.mpbSet ? data.mpb?.[board.mpbSet] : undefined;
  if (!set || !board.mpbMetric) return { rows: [], eligible: 0 };
  const m = board.mpbMetric;
  const region = board.regionFilter ? opts.region ?? null : null;
  const dir = board.order === 'asc' ? 1 : -1;
  const pool = set
    .filter((r) => !region || r.region === region)
    .map((r) => ({ r, v: m(r) }))
    .filter((x): x is { r: MpbBoardRow; v: number } => x.v != null && Number.isFinite(x.v) && x.v > 0)
    .sort((a, b) => (a.v - b.v) * dir || a.r.label.localeCompare(b.r.label) || a.r.key.localeCompare(b.r.key));
  const ranks = competitionRanks(pool, (x) => x.v);
  const rows = pool.map((x, i) => ({ rank: ranks[i], row: x.r, value: x.v }));
  return { rows: opts.limit != null ? rows.slice(0, opts.limit) : rows, eligible: pool.length };
}

/** A row of a list board (whole-bill and multi-purpose building boards) as the image draws it. */
export interface ListRow {
  rank: number;
  label: string;
  sub: string;
  value: number;
  detail: string | null;
}

/** The rows a list board draws, best first. */
export function listRows(data: LeaderboardData, board: BoardDef, opts: { region?: string | null; limit?: number } = {}): { rows: ListRow[]; eligible: number } {
  if (board.kind === 'mpb') {
    const r = rankMpb(data, board, opts);
    return { rows: r.rows.map((x) => ({ rank: x.rank, label: x.row.label, sub: x.row.sub, value: x.value, detail: board.mpbDetail?.(x.row) ?? null })), eligible: r.eligible };
  }
  const r = rankLines(data, board, { limit: opts.limit });
  return { rows: r.rows.map((x) => ({ rank: x.rank, label: x.row.label, sub: x.row.sub, value: x.value, detail: board.rowDetail?.(x.row) ?? null })), eligible: r.eligible };
}

/** What a list board counts. */
export function listUnit(board: BoardDef, n: number): string {
  return board.kind === 'mpb' ? mpbUnit(board, n) : lineUnit(board, n);
}

// ---------------------------------------------------------------------------
// Value text (shared by the cards, the tables and the pre-rendered images)
// ---------------------------------------------------------------------------

const MINUS = '−';

function shortMoney(n: number): string {
  const a = Math.abs(n);
  const fmt = (v: number, d: number) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  if (a >= 1e12) return `₱${fmt(a / 1e12, 2)}T`;
  if (a >= 1e9) return `₱${fmt(a / 1e9, a >= 1e11 ? 1 : 2)}B`;
  if (a >= 1e6) return `₱${fmt(a / 1e6, a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `₱${fmt(a / 1e3, 0)}K`;
  return `₱${fmt(a, 0)}`;
}

/** "₱3.42B", "+₱1.20B", "−₱845M", "1,204", "+41.7%", "62%". Null renders as "—". */
export function formatValue(v: number | null | undefined, kind: ValueKind): string {
  if (v == null || !Number.isFinite(v)) return '—';
  switch (kind) {
    case 'php': return (v < 0 ? MINUS : '') + shortMoney(v);
    case 'signed_php': return (v > 0 ? '+' : v < 0 ? MINUS : '') + shortMoney(v);
    case 'count': return Math.round(v).toLocaleString('en-US');
    case 'pct': return `${v > 0 ? '+' : v < 0 ? MINUS : ''}${Math.abs(v).toFixed(1)}%`;
    case 'share': return `${(v * 100).toFixed(1)}%`;
  }
}

/** Full pesos for tables and alt text: "₱1,234,567,000". */
export function formatPesoFull(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v < 0 ? MINUS : '') + '₱' + Math.abs(Math.round(v)).toLocaleString('en-US');
}

/**
 * "Bernos, JB" → "JB Bernos"; keeps suffixes and nicknames ("Faustino “Bojie” Dy III"),
 * drops a trailing middle initial and post-nominals ("…, M.D.", "…, RN"). A seat
 * listing two members formats each: "Philip Conrad “Dok Bong” Acop / Romeo Acop".
 */
export function displayName(name: string | null | undefined): string {
  if (!name) return 'No representative found';
  if (name.includes(' / ')) return name.split(' / ').map((n) => displayName(n.trim())).join(' / ');
  const m = /^([^,]+),\s*(.+)$/.exec(name);
  if (!m) return name;
  // Anything after a further comma is a post-nominal ("B., M.D., FPSO-HNS", "C., RN").
  let given = m[2].split(',')[0].trim();
  const suffix = /\s+(Jr\.?|Sr\.?|II|III|IV|V)(?=\s|$)/.exec(given);
  let tail = '';
  if (suffix) {
    tail = ` ${suffix[1]}`;
    given = given.replace(suffix[0], '');
  }
  // Drop a leading honorific ("Atty.") and trailing middle initials ("G.", "D.L.", "S.J.") for space; keep nicknames.
  given = given.replace(/^(?:Atty|Dr|Engr|Hon)\.\s+/, '').replace(/\s+(?:[A-Z]\.)+$/, '');
  return `${given} ${m[1].trim()}${tail}`.replace(/"([^"]+)"/g, '“$1”');
}

/** "Abra" or "Isabela 6th" style short district label for tight rows. */
export function shortDistrict(p: Pick<LeaderPerson, 'jurisdiction' | 'district_label'>): string {
  const d = p.district_label.replace(/\s*District$/i, '').replace(/^Lone$/i, 'Lone');
  return `${p.jurisdiction} · ${d}`;
}

/**
 * What "DEO" means, said once wherever offices and legislative districts
 * appear together. A DEO's number is its own: the Davao de Oro 1st DEO
 * serves the province's 2nd legislative district.
 */
export const DEO_MEANING =
  'DEO: district engineering office, the DPWH unit that carries out projects in its area. Its number is its own and need not match the legislative district it serves.';

/** The label put before an office name wherever it could be read as a legislative district. */
export const OFFICE_PREFIX = 'DPWH office';

/**
 * The DPWH office(s) a group's amounts are listed under, named as DPWH
 * offices so they are never read as legislative districts:
 * "DPWH Davao de Oro 1st DEO"; two offices: "DPWH Ifugao 1st DEO + Ifugao 2nd DEO".
 */
export function officeName(entry: Pick<LeaderEntry, 'offices'>): string {
  const names = entry.offices.map((o) => o.name.replace(/\bDistrict Engineering Office\b/i, 'DEO'));
  return names.length ? `DPWH ${names.join(' + ')}` : '';
}

/**
 * "DPWH office: Davao de Oro 1st DEO" — the line under a one-district row, so
 * the legislative district (the headline) and the office it is served by
 * always appear together.
 */
export function officeLine(entry: Pick<LeaderEntry, 'offices'>): string {
  const names = entry.offices.map((o) => o.name.replace(/\bDistrict Engineering Office\b/i, 'DEO'));
  return names.length ? `${OFFICE_PREFIX}${names.length > 1 ? 's' : ''}: ${names.join(' + ')}` : '';
}

/**
 * The headline for a shared group, in plain words: its DPWH office(s), never
 * one representative, so a shared total never reads as one person's
 * ("DPWH Isabela 4th DEO"). A one-district group returns null (the headline
 * is the legislative district; see entryTitle).
 */
export function officeLabel(entry: Pick<LeaderEntry, 'tier' | 'offices' | 'people'>): string | null {
  if (entry.tier === 'A' && entry.people.length <= 1) return null;
  return officeName(entry);
}

// ---------------------------------------------------------------------------
// Attribution tier and residual (required on every office-based view)
// ---------------------------------------------------------------------------

/** "Lone · only this district" / "Shared by 3 districts, not split" (short: "Lone" / "Shared · 3 districts"). */
export function tierText(entry: Pick<LeaderEntry, 'tier' | 'people'>, short = false): string {
  if (entry.tier === 'A') return short ? 'Lone' : 'Lone · only this district';
  const n = entry.people.length;
  return short ? `Shared · ${n} districts` : `Shared by ${n} districts, not split`;
}

const pctOf = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

type ResidualKind = 'central' | 'regional' | 'no_office' | 'office_change';

function sliceSum(d: LeaderboardData, f: (s: LeaderSlice) => number, kinds: ResidualKind[]): number {
  return kinds.reduce((a, k) => a + f(d.totals.by_office_kind[k]), 0);
}

/**
 * The unattributable residual for a board, in one plain sentence, or null
 * where none applies (members, shift — the shift board is the residual).
 * Every office-based card and page prints it so district rows never read as
 * the whole budget.
 */
export function residualLine(d: LeaderboardData, board: BoardDef): string | null {
  if (board.kind === 'mpb') {
    const r = board.mpbSet && d.mpb ? d.mpb.residual[board.mpbSet] : null;
    if (!r) return null;
    const what = `${formatValue(r.gaa_php, 'php')} in ${plural(r.lines, 'line', 'lines')}`;
    switch (board.mpbSet) {
      case 'contractors': return `No contract found: ${what}, budget amount.`;
      case 'barangays': return `No barangay in the title: ${what}.`;
      case 'offices': return `Not under a district office: ${what}, mostly Central Office.`;
      default: return `Not in any district: ${what} whose title names no place in one district.`;
    }
  }
  const allKinds: ResidualKind[] = ['central', 'regional', 'no_office', 'office_change'];
  const unpaired: ResidualKind[] = ['central', 'regional', 'no_office'];
  const outside = 'Central Office, regional offices, lines with no office and lines that changed office';
  switch (board.id) {
    case 'house-bill-largest': {
      const r = sliceSum(d, (s) => s.hgab3_php, allKinds);
      return `Not in any district: ${formatValue(r, 'php')} (${pctOf(r, d.totals.all.hgab3_php)}) of the DPWH House bill project budget, under ${outside}.`;
    }
    case 'added-budget': case 'added-count': case 'added-share': case 'regions-added': {
      const r = sliceSum(d, (s) => s.added_php, unpaired);
      const n = sliceSum(d, (s) => s.added_rows, unpaired);
      return `Not in any district: ${formatValue(r, 'php')} in ${n.toLocaleString('en-US')} added projects under Central Office, regional offices or no office.`;
    }
    case 'dropped': {
      const r = sliceSum(d, (s) => s.dropped_php, unpaired);
      return `Not in any district: ${formatValue(r, 'php')} in NEP projects missing from the House bill, under Central Office, regional offices or no office.`;
    }
    case 'increase': case 'increase-pct': case 'cuts': case 'regions-change': {
      const r = sliceSum(d, (s) => s.hgab3_php - s.nep_php, allKinds);
      return `Not in any district: ${formatValue(r, 'signed_php')} change under ${outside}.`;
    }
    case 'enacted-total': case 'by-congress': case 'growth': case 'decline': {
      const years = d.totals.gaa_residual.filter((y) => y.fy >= 2020 && y.fy <= 2026);
      const total = years.reduce((a, y) => a + y.total_php, 0);
      const r = years.reduce((a, y) => a + (y.total_php - y.deo_php), 0);
      return `Not in any district: ${formatValue(r, 'php')} (${pctOf(r, total)}) of DPWH enacted budgets 2020–2026, under Central Office, regional offices or units linked to no district.`;
    }
    case 'enacted-2026': {
      const y = d.totals.gaa_residual.find((x) => x.fy === 2026);
      if (!y) return null;
      const r = y.total_php - y.deo_php;
      return `Not in any district: ${formatValue(r, 'php')} (${pctOf(r, y.total_php)}) of the 2026 DPWH enacted budget, under Central Office, regional offices or units linked to no district.`;
    }
    default:
      return null;
  }
}

/**
 * A row's headline is always a place, never a person: the legislative
 * district for a one-district group ("Ilocos Norte, 1st District", with
 * `officeLine` under it), the DPWH office for a shared group ("DPWH Isabela
 * 4th DEO"). Upstream forbids presenting an office total as a
 * representative's own insertions or changes.
 */
export function entryTitle(entry: Pick<LeaderEntry, 'tier' | 'offices' | 'people' | 'key'>): string {
  return officeLabel(entry) ?? entry.people[0]?.district ?? entry.key;
}

/**
 * The seat holder(s), shown under the headline beside the photo:
 * "Rep. JB Bernos"; a shared office lists every name ("Reps. A · B · C");
 * a seat listing two members keeps both. `max` caps the names (then "+N").
 */
export function seatHolders(entry: Pick<LeaderEntry, 'people'>, max = Infinity): string {
  const names = entry.people.map((p) => displayName(p.name));
  if (!names.length) return '';
  const shown = names.slice(0, max);
  const more = names.length - shown.length;
  return `${names.length > 1 ? 'Reps.' : 'Rep.'} ${shown.join(' · ')}${more > 0 ? ` +${more}` : ''}`;
}

/**
 * "As of October 26, 2026": the date the leaderboard data was built, in
 * Manila time. Printed on every share image and beside the board, so a
 * screenshot shared later still says how current its figures are.
 */
export function asOfText(data: Pick<LeaderboardData, 'built_at'>): string {
  const d = new Date(data.built_at);
  if (Number.isNaN(d.getTime())) return '';
  return `As of ${d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' })}`;
}

/** The build the board's figures come from: the whole-bill boards have their own. */
export function boardBuiltAt(data: Pick<LeaderboardData, 'built_at' | 'whole_bill' | 'mpb'>, board: Pick<BoardDef, 'kind'>): string {
  if (board.kind === 'mpb' && data.mpb) return data.mpb.built_at;
  return board.kind === 'lines' && data.whole_bill ? data.whole_bill.built_at : data.built_at;
}

/**
 * The small badge beside a legislative district: the DPWH office that serves
 * it, short. The office name loses the province when it matches the
 * district's ("Davao de Oro 1st DEO" beside "Davao de Oro, 2nd District" →
 * "1st DEO"), so a crossed number shows at a glance; otherwise it stays whole
 * ("Abra DEO", "North Manila DEO", "Metro Manila 3rd DEO").
 */
export function deoBadge(officeName: string, jurisdiction?: string | null): string {
  const name = officeName.replace(/\bDistrict Engineering Office\b/i, 'DEO').trim();
  const j = (jurisdiction ?? '').trim();
  if (j && name.toLowerCase().startsWith(`${j.toLowerCase()} `)) {
    const rest = name.slice(j.length + 1);
    if (/^\d+(st|nd|rd|th)\b/i.test(rest) || /^sub-deo$/i.test(rest)) return rest;
  }
  return name;
}

/** The badge's tooltip: the full office name and why the badge is there. */
export function deoBadgeTitle(officeName: string): string {
  const name = officeName.replace(/\bDistrict Engineering Office\b/i, 'DEO').trim();
  return `DPWH ${name}: the district engineering office that serves this legislative district. A DEO's number is its own and need not match the district's.`;
}

/** Badges for an entry's office(s), given the district they sit beside. */
export function entryDeoBadges(entry: Pick<LeaderEntry, 'offices'>, jurisdiction?: string | null): { text: string; title: string }[] {
  return entry.offices.map((o) => ({ text: deoBadge(o.name, jurisdiction), title: deoBadgeTitle(o.name) }));
}
