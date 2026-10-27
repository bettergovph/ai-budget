/**
 * "We are not ignorant" (`/hgab/2027/we-are-not-ignorant`): every inserted
 * and adjusted project in the FY2027 House bill, on one page and in one CSV.
 *
 * Data contract for the two files `npm run build:hgab-changes-list` writes
 * (`scripts/build-hgab-changes-list.ts`) and `npm run verify:hgab` re-checks:
 *
 *   data/hgab/2027/changes-list.json   ChangesListData — one array of rows, short keys, a legend
 *   data/hgab/2027/changes-list.csv    the same rows, UTF-8 with BOM, exact integer pesos
 *
 * The section's own definitions, nothing new:
 *   - inserted  = insertion candidates, bridge group `house_only` (TRACE_LABELS),
 *                 including the unconfirmed matches (`fuzzy_candidate`, `ambiguous`), flagged;
 *   - increased = `increased`, decreased = `decreased`: the same project in both, amount changed.
 * Scope review and unchanged lines are not listed. House amounts are the
 * reading the section compares (DPWH third reading; the three lists, one list
 * identical at both readings). The NEP and House amounts are never added.
 *
 * Representatives follow the district rules (src/lib/hgab-districts.ts): a
 * DPWH line is listed under the office the House bill names; the districts
 * that office's connected group serves and their seat holders are shown,
 * undivided for a shared (Tier B) office. Central Office, regional, office-
 * change and no-office lines name no district and no representative. The
 * documents never say who asked for a project, and nothing here says so.
 *
 * Pure (no runtime imports, no `import.meta.env`): the builder, the verifier,
 * the Worker and the page all read it.
 */

export const CHANGES_LIST_SCHEMA = 1 as const;
export const CHANGES_LIST_ROOT = '/hgab/2027/we-are-not-ignorant';
export const CHANGES_LIST_TITLE = 'We are not ignorant';
/** Paths under the data host (`dataUrl`), the same keys on R2. */
export const CHANGES_LIST_JSON_PATH = 'hgab/2027/changes-list.json';
export const CHANGES_LIST_CSV_PATH = 'hgab/2027/changes-list.csv';
/** The download's file name (the R2 object also sends it as Content-Disposition). */
export const CHANGES_LIST_CSV_NAME = 'bettergov-house-bill-2027-changes-list.csv';
/** Absolute record links in the CSV. */
export const CHANGES_LIST_SITE = 'https://budget.bettergov.ph';

export type ChangeProgram = 'dpwh' | 'fmr' | 'hfep' | 'nia';
export const CHANGE_PROGRAMS: readonly ChangeProgram[] = ['dpwh', 'fmr', 'hfep', 'nia'];
export type ChangeKind = 'inserted' | 'increased' | 'decreased';
export const CHANGE_KINDS: readonly ChangeKind[] = ['inserted', 'increased', 'decreased'];

/** Program names as the section's tabs show them (src/lib/hgab-ui.ts DATASET_SHORT). */
export const CHANGE_PROGRAM_LABELS: Record<ChangeProgram, string> = {
  dpwh: 'DPWH',
  fmr: 'Farm-to-Market Roads',
  hfep: 'Health Facilities',
  nia: 'Irrigation',
};

/**
 * Where a DPWH line sits in the district view. `office`: a district office,
 * so its group's districts and seat holders are listed. The rest name no
 * district: Central Office, a regional office, a paired line whose NEP and
 * House sides name different office groups (`office_change`, held out of
 * every district), or a grouped line the source reads as naming no office.
 */
export type DistrictBasis = 'office' | 'central' | 'regional' | 'office_change' | 'no_office';

/** What a line with no district says in place of districts and representatives. */
export const NO_DISTRICT_TEXT: Record<Exclude<DistrictBasis, 'office'>, string> = {
  central: 'No district (Central Office)',
  regional: 'No district (regional office)',
  office_change: 'No district (office changed from the NEP)',
  no_office: 'No district (grouped lines name no office)',
};
/** The CSV's `no_district_reason`, same facts in a cell (the three lists name no office at all). */
export const NO_DISTRICT_REASON: Record<Exclude<DistrictBasis, 'office'> | 'list', string> = {
  central: 'Central Office',
  regional: 'regional office',
  office_change: 'office changed from the NEP',
  no_office: 'grouped lines name no office',
  list: 'the list names no office',
};

export interface ChangesListRow {
  /** Record id in the program's projects.parquet. */
  i: string;
  p: ChangeProgram;
  k: ChangeKind;
  /** 1: unconfirmed match (`fuzzy_candidate` or `ambiguous`), counted with the insertions. Absent otherwise. */
  u?: 1;
  /** Status label, TRACE_LABELS verbatim. */
  s: string;
  /** Title as published. */
  t: string;
  /** NEP amount, integer pesos; null = no NEP record (never 0). */
  n: number | null;
  /** House bill amount in the compared reading; null = no House record (a health-facility column dropped). */
  h: number | null;
  /** House minus NEP for adjusted rows (the parquet's delta); null for insertions. */
  d: number | null;
  /** Lines the House bill lists for this row, when more than one (grouped repeated lines). */
  m?: number;
  /** Region as published; null when the list names none (irrigation). */
  r: string | null;
  /** Health facilities: the province or city the list names. */
  pv?: string;
  /** Health facilities: the funding column; irrigation: the sub-program. */
  pa?: string;
  /** Office as the House bill lists it (DPWH); null for the three lists. */
  o: string | null;
  /** DPWH: where the line sits in the district view; null for the three lists. */
  w: DistrictBasis | null;
  /** Tier of the office group: A one district, B shared and not split; null when no district. */
  tr: 'A' | 'B' | null;
  /** The districts the office group serves, short ("Batangas 2nd, 5th"); null when no district. */
  ds: string | null;
  /** The seat holder of each of those districts, in the same order (displayName); null when no district. */
  rp: string[] | null;
  /** Record page path on this site. */
  x: string;
}

export interface ChangesListKindTotals {
  rows: number;
  /** House-bill lines (grouped DPWH rows count each line). */
  records: number;
  nep_php: number;
  house_php: number;
  /** Σ House minus NEP (adjusted kinds); 0 for insertions, whose change is not booked per row. */
  delta_php: number;
  unconfirmed_rows: number;
  unconfirmed_php: number;
}

export interface ChangesListProgram {
  key: ChangeProgram;
  label: string;
  /** The House reading the amounts are from. */
  house_stage: 'hgab2' | 'hgab3';
  kinds: Record<ChangeKind, ChangesListKindTotals>;
}

export interface ChangesListData {
  schema: typeof CHANGES_LIST_SCHEMA;
  fiscal_year: 2027;
  built_at: string;
  source_commit: string;
  /** What each short key means. */
  legend: Record<keyof ChangesListRow, string>;
  programs: ChangesListProgram[];
  totals: { rows: number; records: number; inserted_records: number; adjusted_rows: number };
  /** Every row: inserted, then increased, then decreased; within each, House amount largest first (no House amount last), then the largest change. */
  rows: ChangesListRow[];
}

export const CHANGES_LIST_LEGEND: ChangesListData['legend'] = {
  i: 'record id in the program’s projects.parquet',
  p: 'program: dpwh, fmr (farm-to-market roads), hfep (health facilities), nia (irrigation)',
  k: 'inserted (insertion candidate, in the House bill only), increased or decreased (same project, amount changed)',
  u: '1 = unconfirmed match, counted with the insertions; absent otherwise',
  s: 'status label, as the section shows it',
  t: 'title as published',
  n: 'NEP amount, integer pesos; null = no NEP record',
  h: 'House bill amount (DPWH third reading; the three lists: the House list), integer pesos; null = no House record',
  d: 'House minus NEP, adjusted rows only; null for insertions',
  m: 'lines the House bill lists for this row, when more than one',
  r: 'region as published; null when the list names none',
  pv: 'health facilities: the province or city the list names',
  pa: 'health facilities: the funding column; irrigation: the sub-program',
  o: 'DPWH office as the House bill lists it; null for the three lists',
  w: 'DPWH: office (districts served are listed), central, regional, office_change or no_office (no district); null for the three lists',
  tr: 'tier of the office group: A = one district, B = several districts, not split; null when no district',
  ds: 'districts the office serves; null when no district',
  rp: 'the representative of each district the office serves, same order; null when no district',
  x: 'record page path on budget.bettergov.ph',
};

/** CSV header, in order (snake_case; empty cell = null). */
export const CHANGES_LIST_CSV_COLUMNS = [
  'program', 'kind', 'status_label', 'unconfirmed_match', 'title', 'detail',
  'nep_php', 'house_php', 'change_php', 'house_lines',
  'region', 'province', 'office', 'tier', 'districts_served', 'representatives_of_those_districts', 'no_district_reason',
  'record_id', 'record_url', 'nep_document', 'nep_page', 'house_document', 'house_page',
] as const;

// ---------------------------------------------------------------------------
// Display (shared by the builder and the page)
// ---------------------------------------------------------------------------

/** "Batangas 2nd District Engineering Office" → "Batangas 2nd DEO" (and "Sub-DEO"). */
export function shortOffice(label: string): string {
  return label
    .replace(/\bSub[\s-]*District Engineering Office\b/i, 'Sub-DEO')
    .replace(/\bDistrict Engineering Office\b/i, 'DEO');
}

/**
 * The districts an office group serves, short and grouped by province or
 * city, in the group's order: "Batangas 2nd, 5th", "Abra (lone)",
 * "Manila 1st, 2nd; Caloocan 1st", "Taguig City 2nd, lone".
 */
export function districtsServedText(districts: ReadonlyArray<{ jurisdiction: string; district_label: string }>): string {
  const by = new Map<string, string[]>();
  for (const d of districts) {
    const list = by.get(d.jurisdiction) ?? [];
    list.push(d.district_label.replace(/\s*District$/i, '').trim().replace(/^lone$/i, 'lone'));
    by.set(d.jurisdiction, list);
  }
  return [...by].map(([j, ns]) => (ns.length === 1 && ns[0] === 'lone' ? `${j} (lone)` : `${j} ${ns.join(', ')}`)).join('; ');
}

/** "Rep. JB Bernos" / "Reps. Gerville Luistro · Beverley Rose Dimacuha". */
export function seatHoldersText(names: readonly string[] | null | undefined): string {
  if (!names?.length) return '';
  return `${names.length > 1 ? 'Reps.' : 'Rep.'} ${names.join(' · ')}`;
}
