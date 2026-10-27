/**
 * Multi-purpose buildings in the FY2027 DPWH lists: the contract between
 * scripts/build-hgab-mpb.ts (data/hgab/2027/mpb.json + mpb.csv), the page
 * (/hgab/2027/multi-purpose-buildings) and the verifier. Pure: no runtime
 * imports, no import.meta.env.
 *
 * Rules (the section's, unchanged):
 * - A multi-purpose building (MPB) is a DPWH project line whose title as
 *   published contains "multi-purpose" in any spelling the lists use,
 *   common misspellings included (MPB_TITLE_RE), unless it is water
 *   infrastructure that only uses the phrase (MPB_EXCLUDE_RE): isMpbTitle().
 *   Nothing is inferred beyond the title.
 * - Kinds come from the line's trace (TRACE_LABELS in lib/hgab.ts):
 *   inserted = house_only (incl. unconfirmed matches, flagged), dropped =
 *   nep_only, increased, decreased, scope_review, unchanged.
 * - NEP and House bill amounts are compared, never added. Integer pesos;
 *   null = no figure.
 * - Offices are the DPWH offices the House bill lists; districts and
 *   representatives come from the office's group, exactly as on the
 *   leaderboards (Tier B shared offices are never split; office-change and
 *   no-office lines sit in no district). The documents do not say who asked
 *   for any project. Patterns here are leads to check, not findings.
 */

export const MPB_SCHEMA = 1 as const;
export const MPB_ROOT = '/hgab/2027/multi-purpose-buildings';
export const MPB_DATA_PATH = 'hgab/2027/mpb.json';
export const MPB_CSV_PATH = 'hgab/2027/mpb.csv';
export const MPB_CSV_NAME = 'bettergov-house-bill-2027-multi-purpose-buildings.csv';
export const MPB_TITLE = 'Multi-purpose buildings';

/**
 * Which titles count: "multi" and "purpose" joined by nothing, spaces or any dash ("Multi-Purpose",
 * "Multipurpose", "Multi Purpose", "Multi – Purpose", "Multi- Purpose"), any case; plus the exact misspellings
 * of "purpose" the House bill lists (Pupose, Pirpose, Purppose, Purpoe, purpse). Nothing fuzzier: "Multimedia",
 * "Multi Level", "Multi-Specialty" do not count.
 */
export const MPB_TITLE_RE = /multi[\s\u2010-\u2015\u2212-]*(?:purpose|pupose|pirpose|purppose|purpoe|purpse)/i;

/**
 * Water infrastructure that only uses the phrase ("Cabayongan River Multi-Purpose Project Small River
 * Impounding System"): whole words, so barangay names such as Damar or Dampig are not caught.
 */
export const MPB_EXCLUDE_RE = /\b(?:impounding|dam|irrigation)\b/i;

/** The MPB rule, everywhere (builder, verifier, page): MPB_TITLE_RE and not MPB_EXCLUDE_RE. */
export function isMpbTitle(title: string | null | undefined): boolean {
  return !!title && MPB_TITLE_RE.test(title) && !MPB_EXCLUDE_RE.test(title);
}

export type MpbKind = 'inserted' | 'increased' | 'decreased' | 'scope_review' | 'unchanged' | 'dropped';
export const MPB_KINDS: readonly MpbKind[] = ['inserted', 'increased', 'decreased', 'scope_review', 'unchanged', 'dropped'];
export const MPB_KIND_LABELS: Record<MpbKind, { label: string; plain: string }> = {
  inserted: { label: 'Inserted', plain: 'in the House bill only (insertion candidates)' },
  increased: { label: 'Increased', plain: 'in both; more in the House bill' },
  decreased: { label: 'Decreased', plain: 'in both; less in the House bill' },
  scope_review: { label: 'Scope review', plain: 'same road or site, different stretch' },
  unchanged: { label: 'Unchanged', plain: 'in both; same amount' },
  dropped: { label: 'Dropped', plain: 'in the NEP only (deletion candidates)' },
};

/** Counts and pesos for one kind (or a whole slice). `records` counts grouped House lines individually. */
export interface MpbCell {
  rows: number;
  records: number;
  nep_php: number;
  house_php: number;
}
export type MpbKinds = Record<MpbKind, MpbCell>;

/** One slice of the MPB lines (all, an office group, a region, an office kind, a subtype). */
export interface MpbSlice {
  kinds: MpbKinds;
  /** All MPB lines in the slice. */
  all: MpbCell;
  /** Inserted lines whose NEP match is unconfirmed (fuzzy_candidate, ambiguous): part of `inserted`, flagged. */
  unconfirmed: { rows: number; php: number };
}

export interface MpbPerson {
  district_id: string;
  district: string;
  jurisdiction: string;
  district_label: string;
  name: string | null;
  status: 'resolved' | 'ambiguous' | 'missing';
  portrait_url: string | null;
  href: string;
}

/** An office group (one or more DPWH offices and every legislative district they serve), as on the leaderboards. */
export interface MpbOffice extends MpbSlice {
  /** The leaderboard entry key. */
  key: string;
  tier: 'A' | 'B';
  region: string;
  /**
   * The group's DPWH offices (leaderboard order). `name`: the short leaderboard form ("Abra DEO"); `label`: the
   * office as the House bill lists it (null when it lists nothing in 2027); `rows`: its MPB lines booked to the
   * group; `href`: mpbProjectsHref({ deo: label }), null without a label.
   */
  offices: { id: string; name: string; label: string | null; rows: number; href: string | null }[];
  people: MpbPerson[];
  /** Share of the group's inserted DPWH pesos (all project types) that is MPB; null when the group has no inserted pesos. */
  inserted_mpb_share: number | null;
  /** The group's inserted DPWH pesos, all project types (denominator of inserted_mpb_share). */
  inserted_all_php: number;
  /** Projects page filtered to this office's MPB lines (several offices: the one with the most MPB lines, then name order). */
  href: string;
}

/** By region as published on the line (every office kind, incl. Central Office lines located in the region). */
export interface MpbRegion extends MpbSlice {
  /** RegionKey (lib/hgab.ts REGION_ORDER / REGION_LABELS), from the published label through regionKeyOf. */
  region: string;
  /** Of which under DPWH Central Office (basis 'central'; Σ regions = by_office_kind.central). */
  central: MpbCell;
  /** Of which inserted (unconfirmed matches included, as kinds.inserted) under DPWH Central Office. */
  central_inserted: MpbCell;
  /** Distinct DPWH offices (incl. Central Office) with MPB lines in the region. */
  offices: number;
  /** The region's labels as published on these lines (every spelling). */
  published: string[];
  /** Projects page filtered to the region's MPB lines: mpbProjectsHref({ region: published.join('|') }). */
  href: string;
}

export interface MpbSubtype extends MpbSlice {
  /** 'covered_court' | 'barangay_hall' | 'evacuation_center' | 'senior_citizens' | 'gym' | 'school' | 'health' | 'other' — from the title's words. */
  key: string;
  label: string;
}

/**
 * Subtypes from the title's words: the first rule (in this order) with any pattern matching wins; `other` when
 * none does (most titles name only the building and its barangay). Words are matched case-insensitively and
 * whole; the abbreviations (ES, NHS, BHS, RHU, OSCA) only in capitals. A title naming a school or a health
 * centre may only be sited there: these are words in the title, not findings about the building.
 */
export const MPB_SUBTYPES: ReadonlyArray<{ key: string; label: string; patterns: readonly RegExp[] }> = [
  // "Covered Court" and its misspellings ("Coovered", "Coverd"), "Basketball Court". "Covered Gym" is a gym.
  { key: 'covered_court', label: 'Covered court', patterns: [/\bco+v[a-z]*\s*courts?\b/i, /\bbasketball\s*courts?\b/i] },
  // "Barangay Hall", "Brgy. Hall", "Barangay Session Hall"; not "Multi-Purpose Hall" or "Municipal Hall".
  { key: 'barangay_hall', label: 'Barangay hall', patterns: [/\b(barangay|brgy|bgy)\.?\s*(session\s+)?hall\b/i] },
  { key: 'evacuation_center', label: 'Evacuation center', patterns: [/\bevacuation\b/i] },
  { key: 'senior_citizens', label: "Senior citizens' center", patterns: [/\bsenior\b/i, /\belderly\b/i, /\bOSCA\b/] },
  { key: 'gym', label: 'Gym or gymnasium', patterns: [/\bgym(nasium)?s?\b/i] },
  { key: 'school', label: 'School or classroom', patterns: [/\bschools?\b/i, /\bclassrooms?\b/i, /\belementary\b/i, /\bcolleges?\b/i, /\buniversit(y|ies)\b/i, /\bcampus\b/i, /\b(ES|NHS)\b/] },
  { key: 'health', label: 'Health facility', patterns: [/\bhealth\b/i, /\b(BHS|RHU)\b/, /\bhospitals?\b/i, /\bclinics?\b/i, /\bbirthing\b/i, /\bmedical\b/i, /\blying[\s-]*in\b/i] },
  { key: 'other', label: 'Other or not stated', patterns: [] },
];

/** The subtype key of a title (MPB_SUBTYPES, first match wins). */
export function mpbSubtypeOf(title: string): string {
  for (const s of MPB_SUBTYPES) if (s.patterns.some((re) => re.test(title))) return s.key;
  return 'other';
}

/** mpb.csv header, in order (snake_case; empty cell = null). One row per MPB line. */
export const MPB_CSV_COLUMNS = [
  'program', 'kind', 'status_label', 'unconfirmed_match', 'title', 'nep_php', 'house_php', 'change_php',
  'region', 'dpwh_office', 'tier', 'legislative_districts_served', 'representatives_of_those_districts', 'no_district_reason',
  'subtype', 'record_url', 'pages',
] as const;

/** One line, as listed (for the largest-lines table, repeats and the CSV). */
export interface MpbLine {
  id: string;
  kind: MpbKind;
  unconfirmed: boolean;
  title: string;
  nep_php: number | null;
  house_php: number | null;
  delta_php: number | null;
  region: string | null;
  office: string | null;
  /** 'office' | 'central' | 'regional' | 'office_change' | 'no_office' */
  basis: string;
  /** The office group's key (leaderboard), when the line sits in a district. */
  group: string | null;
  /** Record page path. */
  href: string;
}

/**
 * One title listed more than once under one office in the House bill. The title is compared lower-cased, with
 * coordinates removed (decimals of four or more places: the same site is sometimes listed once with and once
 * without them) and every run of other characters than letters and digits read as one space. A lead to check:
 * repeats may be phases of one project or separate sites with the same name.
 */
export interface MpbRepeat {
  /** Lower-cased title with coordinates removed and spacing and punctuation normalised (mpbTitleNorm). */
  title_norm: string;
  /** The title as published on the first line (ids[0]). */
  title: string;
  /** The office as the House bill lists it. */
  office: string | null;
  /** House bill lines with this title under this office; a grouped line counts each of its lines, so `ids` may be fewer. */
  rows: number;
  /** Of those, lines with no matching NEP project (inserted, unconfirmed matches included). */
  inserted_rows: number;
  house_php: number;
  /** Record ids (project pages), id order. */
  ids: string[];
}

/** The repeats' title key: lower-case, coordinates removed, runs of non-letters/digits as one space. */
export function mpbTitleNorm(title: string): string {
  return title.toLowerCase().replace(/-?\d{1,3}\s?\.\s?\d{4,}/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export interface MpbAmountBucket {
  /** The exact House amount, integer pesos. */
  php: number;
  rows: number;
  inserted_rows: number;
}

export interface MpbData {
  schema: typeof MPB_SCHEMA;
  fiscal_year: 2027;
  built_at: string;
  source_commit: string;
  definition: string;
  /** MPB against every DPWH line (the comparison base). */
  dpwh: {
    rows: number;
    house_php: number;
    nep_php: number;
    inserted_rows: number;
    inserted_php: number;
  };
  totals: MpbSlice;
  by_office_kind: Record<'deo' | 'central' | 'regional' | 'office_change' | 'no_office', MpbSlice>;
  /** DPWH programs (PAP) the MPB lines sit under. */
  by_program: Array<MpbSlice & { program: string }>;
  /** Every office group with at least one MPB line, inserted pesos largest first. */
  offices: MpbOffice[];
  /** REGION_ORDER order. */
  regions: MpbRegion[];
  subtypes: MpbSubtype[];
  /** House amounts: the most common exact amounts, and how many amounts are round. */
  amounts: {
    top: MpbAmountBucket[];
    house_lines: number;
    /** Lines whose House amount is an exact multiple of ₱1,000,000 / ₱500,000. */
    multiple_of_1m: number;
    multiple_of_500k: number;
    median_php: number | null;
    p90_php: number | null;
    max_php: number | null;
  };
  /** Identical normalised titles listed more than once under the same office. */
  repeats: MpbRepeat[];
  /** The largest inserted lines (House amount), top 100. */
  largest_inserted: MpbLine[];
  /** Plain sentences a reader needs (≤ 20 words each). */
  notes: string[];
}

/**
 * The DPWH projects list filtered to MPB lines: optionally one office (`deo`,
 * the office label as the House bill lists it), a region and change groups
 * (`group`: house_only, nep_only, increased, decreased, unchanged, scope_review).
 * The text search "multi" matches every MPB_TITLE_RE spelling (and some titles that do not count: excluded
 * water projects, "Multimedia", "Multi Level"); the page says so.
 */
export function mpbProjectsHref(opts: { deo?: string | null; region?: string | null; group?: string | null } = {}): string {
  const q = new URLSearchParams({ view: 'projects', q: 'multi' });
  if (opts.deo) q.set('deo', opts.deo);
  if (opts.region) q.set('region', opts.region);
  if (opts.group) q.set('group', opts.group);
  return `/hgab/2027/dpwh?${q.toString()}`;
}
