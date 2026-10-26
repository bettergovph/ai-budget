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
 */

import { CARD_DISCLAIMER } from './hgab-disclaimers';

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
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

export type BoardKind = 'ranking' | 'members' | 'congress' | 'shift' | 'regions';
export type BoardSection = 'fy2027' | 'history' | 'members' | 'picture';
export type ValueKind = 'php' | 'signed_php' | 'count' | 'pct' | 'share';

export const BOARD_SECTIONS: ReadonlyArray<{ key: BoardSection; label: string; blurb: string }> = [
  { key: 'picture', label: 'The big picture', blurb: 'Where the DPWH budget sits in the NEP and in the House bill.' },
  { key: 'fy2027', label: '2027: the House bill against the NEP', blurb: 'DPWH projects by district office, as listed in each document.' },
  { key: 'history', label: '2020 to 2026: enacted budgets', blurb: 'What each district office received in the enacted budgets.' },
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
}

const PEOPLE_NOTE = 'Amounts are for the DPWH district office serving each district. The documents do not say who asked for any project.';
/** Printed on every share card that shows people when the board's first note is not PEOPLE_NOTE. */
/** Printed on every share image that shows people beside amounts (see hgab-disclaimers.ts). */
export const PEOPLE_LINE = CARD_DISCLAIMER;
const ADDED_NOTE = '“Added” means no matching line was found in the NEP: a candidate, not a confirmed insertion. Projects whose NEP match is unconfirmed are left out.';
const SHARED_NOTE = 'An office that serves several districts is shown with every district it serves. Its amount is not split.';
const GAA_NOTE = 'Enacted budgets list the whole office. New or renamed offices have fewer years; earlier years stay with their old office.';

const REORG_NOTE = 'Offices created, renamed or carved out since 2020 are left out: part of their earlier budget sits with another office.';

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
    subtitle: 'Budget for House bill projects with no matching line in the NEP, summed over each region’s district offices.',
    regionMetric: (r) => r.added_php,
    notes: [ADDED_NOTE, 'Central Office and regional office projects are not in any region’s total.'],
    regionFilter: false,
  },
  {
    id: 'regions-change', section: 'picture', kind: 'regions', value: 'signed_php', order: 'desc',
    kicker: '2027 · DPWH projects · by region',
    title: 'Change from the NEP, by region',
    subtitle: 'House bill minus the NEP on the same DPWH project lists, summed over each region’s district offices.',
    regionMetric: (r) => r.delta_php,
    notes: ['Central Office and regional office projects are not in any region’s total.', SHARED_NOTE],
    regionFilter: false,
  },

  // 2027: the House bill against the NEP
  {
    id: 'house-bill-largest', section: 'fy2027', kind: 'ranking', value: 'php', order: 'desc',
    kicker: '2027 House bill · DPWH projects',
    title: 'Largest DPWH amounts in the House bill',
    subtitle: 'District offices ranked by their DPWH project total in House Bill 10858, third reading.',
    metric: (e) => e.hgab3_php,
    detail: (e) => (e.hgab3_rows != null ? `in ${plural(e.hgab3_rows, 'budget line', 'budget lines')}` : null),
    notes: [PEOPLE_NOTE, SHARED_NOTE],
    regionFilter: true,
  },
  {
    id: 'added-budget', section: 'fy2027', kind: 'ranking', value: 'php', order: 'desc',
    kicker: '2027 House bill · DPWH projects',
    title: 'Largest budget in projects the House added',
    subtitle: 'House bill projects with no matching line in the NEP, by district office.',
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
    subtitle: 'Number of House bill projects with no matching line in the NEP, by district office.',
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
    subtitle: 'House bill minus the NEP on the same DPWH project lists, by district office.',
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
    subtitle: 'Percent change from the NEP to the House bill, for district offices with at least ₱500 million in the NEP.',
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
    subtitle: 'District offices whose DPWH project total is lower in the House bill than in the NEP.',
    metric: (e) => e.delta_php,
    keep: (e) => (e.delta_php ?? 0) < 0,
    detail: (e) => (e.nep_php != null && e.hgab3_php != null ? `${formatValue(e.nep_php, 'php')} → ${formatValue(e.hgab3_php, 'php')}` : null),
    notes: ['Few district offices have a smaller budget. The largest cut is in Central Office projects; see “Where the DPWH project budget sits”.', PEOPLE_NOTE, SHARED_NOTE],
    regionFilter: true,
  },
  {
    id: 'dropped', section: 'fy2027', kind: 'ranking', value: 'php', order: 'desc',
    kicker: '2027 · DPWH projects · NEP only',
    title: 'Largest budget in NEP projects the House bill does not list',
    subtitle: 'NEP projects with no matching line in the House bill, by district office.',
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

  // 2020 to 2026: enacted budgets
  {
    id: 'enacted-total', section: 'history', kind: 'ranking', value: 'php', order: 'desc',
    kicker: 'Enacted budgets (GAA) · 2020 to 2026 · DPWH',
    title: 'Largest enacted DPWH budgets, 2020 to 2026',
    subtitle: 'Seven enacted budgets added up, by district office.',
    metric: (e) => e.gaa_total_php,
    detail: (e) => (e.gaa_years.length && e.gaa_years.length < 7 ? `${e.gaa_years.length} of 7 years` : null),
    notes: [GAA_NOTE, PEOPLE_NOTE, SHARED_NOTE],
    regionFilter: true,
  },
  {
    id: 'enacted-2026', section: 'history', kind: 'ranking', value: 'php', order: 'desc',
    kicker: 'Enacted budget (GAA) · 2026 · DPWH',
    title: 'Largest enacted DPWH budgets in 2026',
    subtitle: 'The 2026 enacted budget of each district office.',
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

export function boardById(id: string | undefined): BoardDef | undefined {
  return BOARDS.find((b) => b.id === id);
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
 * The headline for a group, in plain words. A shared (Tier B) group is named by
 * its office(s), never by one representative, so a shared total never reads as
 * one person's: "Metro Manila 1st district office", "North Manila and South
 * Manila district offices". A one-district group returns null (show the person).
 */
export function officeLabel(entry: Pick<LeaderEntry, 'tier' | 'offices' | 'people'>): string | null {
  if (entry.tier === 'A' && entry.people.length <= 1) return null;
  const plain = entry.offices.map((o) =>
    o.name
      .replace(/\bSub-DEO\b/, 'sub-district office')
      .replace(/\bDEO\b/, 'district office')
      .replace(/\bDistrict Engineering Office\b/i, 'district office'),
  );
  if (plain.length === 1) return plain[0];
  const stems = plain.map((p) => p.replace(/ (sub-)?district office$/, ''));
  return `${stems.slice(0, -1).join(', ')} and ${stems[stems.length - 1]} district offices`;
}

// ---------------------------------------------------------------------------
// Attribution tier and residual (required on every office-based view)
// ---------------------------------------------------------------------------

/** "Tier A · only this district" / "Tier B · shared by 3 districts, not split". */
export function tierText(entry: Pick<LeaderEntry, 'tier' | 'people'>, short = false): string {
  if (entry.tier === 'A') return short ? 'Tier A' : 'Tier A · only this district';
  const n = entry.people.length;
  return short ? `Tier B · ${n} districts` : `Tier B · shared by ${n} districts, not split`;
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
 * A row's headline is always a place, never a person: the district for a
 * one-district group ("Ilocos Norte, 1st District"), the office for a shared
 * group ("Metro Manila 1st district office"). Upstream forbids presenting an
 * office total as a representative's own insertions or changes.
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
