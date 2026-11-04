/**
 * Where the source workbench places each FY2027 DPWH line: the contract
 * between scripts/build-hgab-locations.ts (data/hgab/2027/locations.json), the
 * district pages, the API and the verifier. Pure: no runtime imports.
 *
 * Source: the workbench's DPWH location district lens
 * (csiiiv/DPWH-NEP-HB-2027-ANALYSIS, analysis/web/buildLocationLens.py, method
 * in analysis/docs/location_district_lens_method.md). Upstream does not commit
 * its output, so we build it from a pinned commit with upstream's own scripts
 * and keep its bases, targets and flags verbatim. Amounts, matches and offices
 * still come from the main import; the lens only says where a line is placed.
 *
 * Rules:
 * - Every line is placed exactly once, in one of five ways (upstream's order):
 *   the place its title names (`title_psgc`), else an office that serves one
 *   district only (`deo_to_leg`), else its shared office, undivided (`deo`),
 *   else its region, else nowhere (`unassigned`). Placed + shared + region +
 *   unassigned = every line.
 * - A placement is provisional and is not the representative's. It never says
 *   who asked for a project, and does not certify the construction site.
 * - Our one check on top: a `title_psgc` line upstream flags
 *   `office_location_mismatch` (the place named is outside every district its
 *   own DPWH office serves: mostly a road named after the city at one end) is
 *   held out for review, district null, and counted as such everywhere. Those
 *   whose chosen place is not even in the district picked (upstream picks the
 *   place and the district from tied candidates separately) are counted apart.
 *   Their basis stays upstream's.
 * - Integer pesos; null = no figure. NEP and House bill are compared, never added.
 */

export const LOCATIONS_SCHEMA = 2 as const;
export const LOCATIONS_DATA_PATH = 'hgab/2027/locations.json';

/** Upstream's resolution basis, verbatim, in its resolution order. */
export type LocationBasis = 'title_psgc' | 'deo_to_leg' | 'deo' | 'region' | 'unassigned';
export const LOCATION_BASES: readonly LocationBasis[] = ['title_psgc', 'deo_to_leg', 'deo', 'region', 'unassigned'];

/** The two bases that put a line in one legislative district. */
export const DISTRICT_BASES: readonly LocationBasis[] = ['title_psgc', 'deo_to_leg'];

export const LOCATION_BASIS_LABELS: Record<LocationBasis, { label: string; plain: string }> = {
  title_psgc: {
    label: 'Place named',
    plain: 'The title names a place in this district, backed by its DPWH office, a coordinate, the title’s own wording or a reviewed landmark.',
  },
  deo_to_leg: {
    label: 'Office serves only here',
    plain: 'The title fixes no district, but the DPWH office it lists serves this district alone.',
  },
  deo: {
    label: 'Shared office',
    plain: 'The title fixes no district and its DPWH office serves several; the amount stays with the office, not split.',
  },
  region: { label: 'Region only', plain: 'No district engineering office is listed, and the title fixes no district: placed at its region.' },
  unassigned: { label: 'Unassigned', plain: 'No district engineering office or region to place it by.' },
};

/** What backed a `title_psgc` placement (upstream `title_gate`), verbatim. */
export type TitleGate = 'printed_deo' | 'coordinate' | 'title_context' | 'named_site';
export const TITLE_GATE_LABELS: Record<TitleGate, string> = {
  printed_deo: 'its DPWH office is a district engineering office',
  coordinate: 'a coordinate in the title is inside the place',
  title_context: 'the title spells out the place and its town or province',
  named_site: 'a reviewed landmark list pins the site',
};

/** Upstream row flags, verbatim. */
export type LocationFlag = 'changed_office' | 'deo_office_conflict' | 'office_location_mismatch';
export const LOCATION_FLAG_LABELS: Record<LocationFlag, string> = {
  changed_office: 'The documents list this project under different DPWH offices.',
  deo_office_conflict: 'The documents list district engineering offices that disagree.',
  office_location_mismatch: 'The place named is outside the districts its DPWH office serves.',
};

/** Why we hold a line out of every district (null = not held out). */
export type LocationReview = 'outside_office_districts' | 'place_district_mismatch';
export const LOCATION_REVIEWS: readonly LocationReview[] = ['outside_office_districts', 'place_district_mismatch'];
export const LOCATION_REVIEW_LABELS: Record<LocationReview, string> = {
  outside_office_districts: 'The place named is outside every district its own DPWH office serves; held out for review.',
  place_district_mismatch: 'The place the source chose is not in the district it picked, and is outside its office’s districts; held out for review.',
};

/** One DPWH comparison line (projects.parquet id) and where upstream places it. */
export interface LineLocation {
  /** projects.parquet id ("house-reading:848", "nep:…"). */
  id: string;
  basis: LocationBasis;
  /** Our district id ("leg:caloocan-city:2nd") for `title_psgc` / `deo_to_leg`, else null (and null when held out). */
  district: string | null;
  /** Upstream `target_id`: the district id, the DEO group id ("office-group:leg:…+leg:…"), the region, or "unassigned". */
  target: string;
  /** The title place upstream chose, short: "Barangay 171, City of Caloocan"; null when it chose none. */
  place: string | null;
  /** For `title_psgc`: what backed the place. */
  gate: TitleGate | null;
  flags: LocationFlag[];
  /** Held out of every district, and why. */
  review: LocationReview | null;
}

/** Counts and pesos for a set of lines. */
export interface LocatedCell {
  rows: number;
  nep_php: number;
  house_php: number;
}

export interface DistrictLocated {
  district: string;
  /** Lines placed here, by kind (inserted = house_only incl. unconfirmed, flagged in `unconfirmed`). */
  kinds: Record<'inserted' | 'increased' | 'decreased' | 'scope_review' | 'unchanged' | 'dropped', LocatedCell>;
  unconfirmed: { rows: number; php: number };
  all: LocatedCell;
  /** Of which placed by the title's place / by an office serving only this district. */
  by_basis: Record<'title_psgc' | 'deo_to_leg', LocatedCell>;
  /** Of which under the district's own DPWH office(s) / another DEO / Central Office / regional office. */
  by_office: Record<'own' | 'other_deo' | 'central' | 'regional', LocatedCell>;
  /** Lines placed here, ids, House amount largest first (for the page's list). */
  ids: string[];
}

export interface OfficeLocatedSummary {
  /** Leaderboard group key: the district id for a one-district group, else "shared:" + sorted office ids joined by "+". */
  group: string;
  /** Every DPWH line listed under the group's offices. */
  all: LocatedCell;
  /** Placed in one of the districts the group serves (district id → cell). */
  per_district: Record<string, LocatedCell>;
  /** Placed in a district the group does not serve (the title names a place elsewhere). */
  elsewhere: LocatedCell;
  /** Kept with the shared office, undivided (`deo`). */
  shared: LocatedCell;
  /** Region only or unassigned. */
  unplaced: LocatedCell;
  /** Placed by upstream, held out by our check (`review`). */
  held_out: LocatedCell;
}

export interface LocationsData {
  schema: typeof LOCATIONS_SCHEMA;
  built_at: string;
  /** The comparison's source commit (amounts, matches). */
  source_commit: string;
  /** The upstream commit the lens was built from. */
  lens_commit: string;
  /** Upstream's own lens statement, verbatim. */
  lens: { name: string; authority: string; not_claimed: string; tiers: Record<LocationBasis, string> };
  /** Every line, by upstream basis (held-out lines included under theirs). */
  totals: Record<LocationBasis, LocatedCell>;
  /** Lines held out of every district by our check, per reason. */
  held_out: Record<LocationReview, LocatedCell>;
  /** Lines carrying each upstream flag. */
  flags: Record<LocationFlag, number>;
  lines: LineLocation[];
  districts: DistrictLocated[];
  offices: OfficeLocatedSummary[];
  /** The upstream files the lens was built from, as upstream records them (path → SHA-256). */
  inputs: Record<string, string>;
  /** How the build was reproduced (steps beyond upstream's documented chain). */
  build_notes: string[];
  /** Plain sentences (≤ 20 words each). */
  notes: string[];
}
