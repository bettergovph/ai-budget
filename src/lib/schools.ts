/**
 * The schools directory (`/schools`): basic-education facilities from the Classroom Shortages & Projects Data Pack
 * (D1 `schools_*`, docs/schools-data.md), their 2023 classroom shortages, the 2026 School Building Program (SBP)
 * classrooms, and field reports from the public (D1 `school_reports`, scripts/schools/reports-schema.sql).
 *
 * Shared by the pages and the Worker (src/worker/schools-api.ts), so no `import.meta.env` here.
 */

export const SCHOOLS_ROOT = '/schools';
export const SCHOOLS_LIST = '/schools/list';
export const SCHOOLS_SHORTAGE = '/schools/shortage';
export const SCHOOLS_ABOUT = '/schools/about';
export const schoolPath = (id: string) => `/schools/${encodeURIComponent(id)}`;
export const SCHOOLS_API = '/api/schools';
/**
 * Bump when the shape of a cached answer (points, areas, analysis) changes: the Worker caches them for an hour by
 * address, so a new address is how a new shape reaches readers at once.
 */
export const SCHOOLS_API_VERSION = '7';

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

/** Map points, column-wise for size: one entry per school with usable 2022 coordinates. */
export interface PointsFile {
  meta: { generated_at: string; schools: number; with_coordinates: number };
  /** [school_id, lon, lat, shortage in whole classrooms (null: no SY 2023–2024 shortage row), FY 2026 classrooms allocated, sector code, level index (LEVEL_INDEX; -1 no data)] */
  rows: [string, number, number, number | null, number, SectorCode, number][];
}
/** 0 public (DepEd), 1 private, 2 SUC/LUC, 3 schools abroad (PSO). */
export type SectorCode = 0 | 1 | 2 | 3;
export const SECTOR_OF: Record<string, SectorCode> = { Public: 0, Private: 1, SUCsLUCs: 2, PSO: 3 };
export const SECTOR_LABEL: Record<SectorCode, string> = { 0: 'Public', 1: 'Private', 2: 'State or local university', 3: 'School abroad' };

export interface ListRow {
  school_id: string;
  school_name: string;
  region_key: string | null;
  division: string;
  province: string | null;
  municipality: string | null;
  sector: string;
  curricular_offering: string | null;
  enrolment_total: number | null;
  instructional_classrooms: number | null;
  /** Whole classrooms (DepEd's figure rounded); null = no SY 2023–2024 shortage data. */
  shortage: number | null;
  /** FY 2026 classrooms allocated (ID-linked SBP projects, any modality); 0 when none. */
  allocated: number;
  status: AllocationStatus;
  level: ShortageLevel | null;
  /** Shortage ÷ (instructional classrooms + shortage); null without both figures. */
  shortage_rate: number | null;
  modalities: string | null;
  sbp_budget_php: number | null;
  reports: number;
}
export interface ListFile {
  meta: { total: number; page: number; per: number; sort: ListSort };
  rows: ListRow[];
}
export type ListSort = 'shortage' | 'gap' | 'rate' | 'excess' | 'name' | 'enrolment' | 'reports';
export type ShortageFilter = 'any' | 'short' | 'none' | 'nodata';

/** Totals over a group of schools (an area); shortage figures are whole classrooms, rounded per school. */
export interface AreaTotals {
  schools: number;
  public_schools: number;
  /** Schools with a SY 2023–2024 shortage row (the rest have no shortage data, which is not zero). */
  with_shortage_data: number;
  schools_short: number;
  shortage: number;
  /** FY 2026 classrooms allocated (projects, classrooms with a budget, "for bidding"), and the budget. */
  sbp_projects: number;
  allocated: number;
  sbp_classrooms_funded: number;
  sbp_classrooms_bidding: number;
  sbp_budget_php: number;
  /** Per school: shortage filled by its own allocation; Remaining Unfunded; Excess Allocated Classrooms (EDCOM 2). */
  covered: number;
  gap: number;
  excess: number;
  /** Excess at schools with no recorded shortage; the budget of the excess (each school's budget × excess ÷ allocated). */
  excess_no_shortage: number;
  excess_budget_php: number;
  /** Allocated classrooms at schools with no shortage data (cannot be assessed). */
  allocated_no_data: number;
  schools_under: number;
  schools_fully: number;
  schools_over: number;
  schools_moderate: number;
  schools_severe: number;
  schools_extreme: number;
  schools_unrated: number;
  instructional_classrooms: number;
  /** Instructional classrooms at the schools with shortage data: with the shortage, the "total classrooms needed". */
  instructional_with_data: number;
}
export interface AreaRow extends AreaTotals {
  region_key: string | null;
  division: string | null;
  /** City or municipality, with its province and income class (level=lgu). */
  province?: string | null;
  municipality?: string | null;
  income_class?: string | null;
  /** Mean of the schools' 2022 points, for placing the area on the map; null without any. */
  lat: number | null;
  lon: number | null;
  reports: number;
  reports_confirming: number;
}
export interface AreasFile {
  meta: {
    generated_at: string;
    level: 'region' | 'division' | 'lgu';
    /** ID-linked projects whose School ID is not in the registry: counted nowhere by area. */
    unplaced_projects: number;
    unplaced_classrooms: number;
  };
  rows: AreaRow[];
}

export interface SchoolProject {
  project_id: string;
  link_status: string;
  modality: string | null;
  scope_of_work: string | null;
  classrooms: number | null;
  budget_php: number | null;
  budget_status: string | null;
  budget_allocation_raw: string | null;
  funding_source_raw: string | null;
  expected_start_raw: string | null;
  expected_end_raw: string | null;
  src_school_name: string | null;
  /** True when this school is only a review candidate for the project, not its ID-linked school. */
  candidate?: boolean;
}
/** A DPWH contract linked to the school (build_dpwh_links.py): DPWH's own figures, and how the link was made. */
export interface DpwhProject {
  contract_id: string;
  description: string | null;
  category: string | null;
  status: string | null;
  progress: number | null;
  budget_php: number | null;
  amount_paid_php: number | null;
  contractor: string | null;
  start_date: string | null;
  completion_date: string | null;
  infra_year: number | null;
  program_name: string | null;
  source_of_funds: string | null;
  deo: string | null;
  /** How many schools the contract is confidently linked to (a cluster contract's budget covers them all). */
  schools_confident: number | null;
  match: DpwhMatch;
  confident: 0 | 1;
  distance_m: number | null;
}
export type DpwhMatch = 'school_id' | 'school_id_name_differs' | 'name' | 'name_annex' | 'several' | 'near_name' | 'near';
export const DPWH_MATCH_LABEL: Record<DpwhMatch, string> = {
  school_id: 'School ID in the contract',
  school_id_name_differs: 'School ID in the contract; the name is spelt differently',
  name: 'School’s name in the contract',
  name_annex: 'Name in the contract, but it says “annex”: maybe its annex',
  several: 'Name in the contract, but other schools share it',
  near_name: 'Near the school, and part of its name is in the contract',
  near: 'Near the school on DPWH’s map only',
};
/** Key of a DPWH contract in a report's `projects` (SBP projects use their own ids). */
export const dpwhKey = (contractId: string) => `dpwh:${contractId}`;

export interface ReportTally {
  reports: number;
  confirmed: number;
  none: number;
  unsure: number;
  /** Median of the classrooms needed that reporters gave; null when none did. */
  classrooms_needed_median: number | null;
  listing_issues: number;
  last_report_at: string | null;
}
export interface SchoolFile {
  school: Record<string, string | number | null>;
  shortage: Record<string, string | number | null> | null;
  coordinates: Record<string, string | number | null> | null;
  facilities: Record<string, string | number | null> | null;
  enrollment: Record<string, string | number | null> | null;
  projects: SchoolProject[];
  /** DPWH contracts linked to the school, newest first (confident and possible). */
  dpwh: DpwhProject[];
  join_review: { source_sheet: string; join_outcome: string; fallback_method: string | null }[];
  reports: ReportTally;
}

// ---------------------------------------------------------------------------
// Field reports: our form merged with EDCOM 2's School Feedback Form
// ---------------------------------------------------------------------------
//
// One report per member per school. Its parts map one to one to EDCOM 2's four report types, so an export sorts
// into their categories (`edcomTypes`):
//   1. Is the school here and open?                    (ours: checks DepEd's list itself)
//   2. Does it need more classrooms?                   (their type 1 "needs" / type 2 "does not need")
//      2a why (needs) · 2b about how many · 2c optional counts · 2d why not (does not need)
//   3. Is there space to build?                        (their type 3, site issues)
//   4. Each project's status                           (their type 4, FY 2026 list and DPWH contracts)
//   5. When last seen · 6. relationship to the school · details (required when the report disputes the data)
//   · photo links. Name and contact come from the sign-in and are seen only by the review team.

export const LISTINGS = [
  ['open', 'Yes, it is here and open'],
  ['wrong_place', 'It is open, but somewhere else'],
  ['closed', 'It has closed or merged'],
  ['not_found', 'I could not find it'],
] as const;
export const NEEDS = [
  ['yes', 'Yes, it needs more classrooms'],
  ['no', 'No, it does not'],
  ['unsure', 'Not sure'],
] as const;
export const NEED_REASONS = [
  ['enrolment', 'Not enough classrooms for current enrolment'],
  ['growing', 'Enrolment is increasing'],
  ['damaged', 'Classrooms are damaged or unusable'],
  ['temporary', 'Classes rely on temporary or makeshift spaces'],
  ['other', 'Other'],
] as const;
export const NO_NEED_REASONS = [
  ['enough', 'The existing classrooms are enough'],
  ['built', 'New classrooms have been completed'],
  ['fewer', 'Enrolment has decreased'],
  ['other', 'Other'],
] as const;
export const SITE = [
  ['available', 'There is space to build'],
  ['no_space', 'No space for more classrooms'],
  ['unsuitable', 'The space is unsuitable for building'],
  ['land', 'Land ownership or permission issues'],
  ['overlooked', 'There is suitable space, but it has not been considered'],
  ['unsure', 'Not sure'],
] as const;
export const PROJECT_SEEN = [
  ['not_started', 'Not yet started'],
  ['ongoing', 'Under construction'],
  ['delayed', 'Delayed or stalled'],
  ['done', 'Completed and in use'],
  ['done_unused', 'Completed, not in use'],
  ['unsure', 'Not sure'],
] as const;
export const RELATIONS = [
  ['principal', 'Principal or OIC'],
  ['personnel', 'Teacher or school personnel'],
  ['parent', 'Parent or guardian'],
  ['student', 'Student'],
  ['lgu', 'LGU official or personnel'],
  ['citizen', 'Concerned citizen'],
  ['other', 'Other'],
] as const;

type Keys<T extends readonly (readonly [string, string])[]> = T[number][0];
export type Listing = Keys<typeof LISTINGS>;
export type Needs = Keys<typeof NEEDS>;
export type NeedReason = Keys<typeof NEED_REASONS>;
export type NoNeedReason = Keys<typeof NO_NEED_REASONS>;
export type Site = Keys<typeof SITE>;
export type ProjectSeen = Keys<typeof PROJECT_SEEN>;
export type Relation = Keys<typeof RELATIONS>;

/** Optional counts (EDCOM 2's suggestion), matching DepEd's Project BUKAS facility fields. */
export interface ReportCounts { makeshift_tls: number | null; shift_classes: number | null; condemned: number | null }
export const COUNT_FIELDS: [keyof ReportCounts, string][] = [
  ['makeshift_tls', 'Makeshift rooms or temporary learning spaces in use'],
  ['shift_classes', 'Classes held in shifts'],
  ['condemned', 'Classrooms for condemnation (unsafe, or past 50 years)'],
];

export interface SchoolReport {
  report_id?: string;
  school_id: string;
  listing: Listing | null;
  needs: Needs | null;
  need_reasons: NeedReason[];
  /** About how many more classrooms, if known (needs = yes). */
  classrooms_needed: number | null;
  counts: ReportCounts;
  no_need_reasons: NoNeedReason[];
  site: Site | null;
  /** Each project's status, by id: FY 2026 SBP projects (SBP-P…) and DPWH contracts (dpwh:…). */
  projects: Record<string, ProjectSeen>;
  /** When the reporter last saw this, YYYY-MM-DD. */
  observed_on: string | null;
  relation: Relation | null;
  notes: string;
  photo_links: string[];
  updated_at?: string;
}

export const emptyReport = (schoolId: string): SchoolReport => ({
  school_id: schoolId, listing: null, needs: null, need_reasons: [], classrooms_needed: null,
  counts: { makeshift_tls: null, shift_classes: null, condemned: null }, no_need_reasons: [], site: null, projects: {},
  observed_on: null, relation: null, notes: '', photo_links: [],
});

export const LIMITS = { notes: 1000, photos: 3, photoUrl: 500, classrooms: 200, count: 500 } as const;
export const SCHOOL_ID_RE = /^[0-9A-Za-z-]{3,20}$/;
const PROJECT_ID_RE = /^(SBP-P\d{6}|dpwh:[A-Za-z0-9-]{4,30})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a report disputes the data, so its details are required: the school isn't where the registry says, or the
 * answer on classrooms goes against DepEd's count (needs more but DepEd recorded none; doesn't but DepEd recorded some).
 */
export function disputesData(r: Pick<SchoolReport, 'listing' | 'needs'>, depedShortage: number | null): boolean {
  if (r.listing && r.listing !== 'open') return true;
  if (depedShortage == null) return false;
  return (r.needs === 'yes' && depedShortage === 0) || (r.needs === 'no' && depedShortage > 0);
}

/** EDCOM 2's report types a report covers (their School Feedback Form, 1–4), for exports. */
export function edcomTypes(r: SchoolReport): string[] {
  const out: string[] = [];
  if (r.needs === 'yes') out.push('1. This school needs additional classrooms');
  if (r.needs === 'no') out.push('2. This school does not need additional classrooms');
  if (r.site && r.site !== 'available' && r.site !== 'unsure') out.push('3. Issue with available space for classroom construction');
  if (Object.keys(r.projects).length) out.push('4. Update on the project’s construction status');
  return out;
}

const pick = <T extends readonly (readonly [string, string])[]>(list: T, v: unknown, field: string, problems: string[]) => {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && list.some(([k]) => k === v)) return v as Keys<T>;
  problems.push(`${field}: not one of the answers`);
  return null;
};
const pickMany = <T extends readonly (readonly [string, string])[]>(list: T, v: unknown, field: string, problems: string[]) => {
  if (v == null) return [];
  if (!Array.isArray(v)) { problems.push(`${field}: a list`); return []; }
  return [...new Set(v)].map((x) => pick(list, x, field, problems)).filter((x): x is Keys<T> => x != null);
};
const count = (v: unknown, min: number, max: number, field: string, problems: string[]) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) return v;
  problems.push(`${field}: a whole number from ${min} to ${max}`);
  return null;
};

/**
 * A report from the page, checked field by field; `problems` lists anything refused. `depedShortage` (the school's
 * SY 2023–2024 shortage in whole classrooms, null without one) decides whether details are required.
 */
export function readSchoolReport(raw: unknown, depedShortage: number | null = null): { report: SchoolReport | null; problems: string[] } {
  const problems: string[] = [];
  if (!raw || typeof raw !== 'object') return { report: null, problems: ['not a report'] };
  const r = raw as Record<string, unknown>;
  const schoolId = typeof r.school_id === 'string' && SCHOOL_ID_RE.test(r.school_id) ? r.school_id : null;
  if (!schoolId) problems.push('school_id: missing');
  const listing = pick(LISTINGS, r.listing, 'listing', problems);
  const gone = listing === 'closed' || listing === 'not_found';
  let needs = pick(NEEDS, r.needs, 'needs', problems);
  if (gone) needs = null; // a school that is closed or can't be found has no classroom need to report
  const c = (r.counts && typeof r.counts === 'object' ? r.counts : {}) as Record<string, unknown>;
  const counts: ReportCounts = {
    makeshift_tls: count(c.makeshift_tls, 0, LIMITS.count, 'counts.makeshift_tls', problems),
    shift_classes: count(c.shift_classes, 0, LIMITS.count, 'counts.shift_classes', problems),
    condemned: count(c.condemned, 0, LIMITS.count, 'counts.condemned', problems),
  };
  const projects: Record<string, ProjectSeen> = {};
  if (r.projects != null) {
    if (typeof r.projects !== 'object' || Array.isArray(r.projects)) problems.push('projects: by project id');
    else for (const [id, v] of Object.entries(r.projects as Record<string, unknown>)) {
      if (!PROJECT_ID_RE.test(id)) { problems.push(`projects: unknown id ${id.slice(0, 20)}`); continue; }
      const seen = pick(PROJECT_SEEN, v, `projects.${id}`, problems);
      if (seen) projects[id] = seen;
    }
  }
  let observed: string | null = null;
  if (r.observed_on != null && r.observed_on !== '') {
    const t = typeof r.observed_on === 'string' && DATE_RE.test(r.observed_on) ? Date.parse(r.observed_on) : NaN;
    if (Number.isNaN(t) || t > Date.now() + 86_400_000 || t < Date.parse('2016-01-01')) problems.push('observed_on: a date from 2016 to today');
    else observed = r.observed_on as string;
  }
  let notes = '';
  if (r.notes != null) {
    if (typeof r.notes !== 'string') problems.push('notes: text');
    else if ((notes = r.notes.trim()).length > LIMITS.notes) problems.push(`notes: at most ${LIMITS.notes} characters`);
  }
  const photos: string[] = [];
  if (r.photo_links != null) {
    if (!Array.isArray(r.photo_links)) problems.push('photo_links: a list');
    else {
      if (r.photo_links.length > LIMITS.photos) problems.push(`photo_links: at most ${LIMITS.photos}`);
      for (const u of r.photo_links.slice(0, LIMITS.photos)) {
        if (typeof u !== 'string' || u.trim() === '') continue;
        const s = u.trim();
        const ok = (() => { try { return new URL(s).protocol === 'https:' && s.length <= LIMITS.photoUrl; } catch { return false; } })();
        if (ok) photos.push(s); else problems.push('photo_links: https links only');
      }
    }
  }
  const yes = needs === 'yes', no = needs === 'no';
  const report: SchoolReport = {
    school_id: schoolId ?? '',
    listing,
    needs,
    need_reasons: yes ? pickMany(NEED_REASONS, r.need_reasons, 'need_reasons', problems) : [],
    classrooms_needed: yes ? count(r.classrooms_needed, 1, LIMITS.classrooms, 'classrooms_needed', problems) : null,
    counts: gone ? { makeshift_tls: null, shift_classes: null, condemned: null } : counts,
    no_need_reasons: no ? pickMany(NO_NEED_REASONS, r.no_need_reasons, 'no_need_reasons', problems) : [],
    site: gone ? null : pick(SITE, r.site, 'site', problems),
    projects,
    observed_on: observed,
    relation: pick(RELATIONS, r.relation, 'relation', problems),
    notes,
    photo_links: photos,
  };
  if (!report.listing) problems.push('Say whether the school is here and open.');
  if (report.listing && !gone && !report.needs) problems.push('Say whether the school needs more classrooms.');
  if (!report.relation) problems.push('Say how you know the school.');
  if (disputesData(report, depedShortage) && report.notes.length < 10) problems.push('Explain the school’s situation in a few words: your report differs from the records.');
  return { report: problems.length ? null : report, problems };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

// EDCOM 2's terms and levels (their Classroom Construction Dashboard v3; docs/schools-edcom2-reconciliation.md).
// A school's shortage is DepEd's SY 2023–2024 figure rounded to whole classrooms; levels and status use that.

export type ShortageLevel = 'none' | 'moderate' | 'severe' | 'extreme' | 'unrated';
/**
 * Classroom shortage levels by the Classroom Shortage Rate, shortage ÷ (available classrooms + shortage) (EDCOM 2's
 * proposed change, adopted by Jason 2026-11-24): Moderate up to 20%, Severe more than 20% to 50%, Extreme more than 50%.
 * It reflects relative severity: 1 short of 6 needed (16.7%) is not 1 short of 31 (3.2%). The absolute shortage is
 * always shown beside it. Moderate and Severe are blue (shortage is blue in EDCOM 2's legend); Extreme is red.
 */
export const SHORTAGE_LEVELS: { key: Exclude<ShortageLevel, 'unrated'>; label: string; range: string; max: number; color: string }[] = [
  { key: 'none', label: 'No recorded shortage', range: '0%', max: 0, color: '#c9d3df' },
  { key: 'moderate', label: 'Moderate', range: 'up to 20%', max: 0.2, color: '#74a9f2' },
  { key: 'severe', label: 'Severe', range: 'more than 20% to 50%', max: 0.5, color: '#2a78d6' },
  // Extreme in red, to stand out (Jason, 2026-11-24: "Make the extreme reddish so it shows importance"); the three
  // colours pass the colour-blindness checks against each other (dataviz validate_palette, all pairs).
  { key: 'extreme', label: 'Extreme', range: 'more than 50%', max: Infinity, color: '#c62828' },
];
/** A school short of classrooms whose classroom count is missing, so its rate is unknown (64 schools). */
export const UNRATED = { key: 'unrated' as const, label: 'Short, rate unknown', range: 'no classroom count', color: '#2a78d6' };
/** The level of a school: shortage in whole classrooms (null = no data) and its available classrooms. */
export function levelOf(shortage: number | null | undefined, available: number | null | undefined): ShortageLevel | null {
  if (shortage == null) return null;
  if (shortage === 0) return 'none';
  const rate = shortageRate(shortage, available);
  if (rate == null) return 'unrated';
  return rate <= 0.2 ? 'moderate' : rate <= 0.5 ? 'severe' : 'extreme';
}
/** Index of a level for the map: 0–3 into SHORTAGE_LEVELS, 4 unrated, -1 no data. */
export const LEVEL_INDEX: Record<ShortageLevel, number> = { none: 0, moderate: 1, severe: 2, extreme: 3, unrated: 4 };
export const levelInfo = (k: ShortageLevel) => (k === 'unrated' ? UNRATED : SHORTAGE_LEVELS.find((x) => x.key === k)!);
/** Kept for the map: SHORTAGE_LEVELS by index. */
export const SHORTAGE_CLASSES = SHORTAGE_LEVELS;
/** No shortage data: brown in EDCOM 2's legend; drawn as a hollow ring so it never reads as a filled red dot. */
export const NO_SHORTAGE_DATA = '#9c5b1a';
/** Allocation is green in EDCOM 2's legend: the ring around schools with FY 2026 classrooms. */
export const PROJECT_RING = '#1f8a70';

export type AllocationStatus = 'under' | 'fully' | 'over' | 'none' | 'no_data';
/**
 * EDCOM 2's allocation status of a school. Colours follow their legend (underallocated red, fully allocated green,
 * overallocated orange, no data brown) with the reds and greens set apart in lightness for colour-blind readers
 * (validated); always shown with the label.
 */
export const ALLOCATION_STATUS: { key: AllocationStatus; label: string; plain: string; color: string }[] = [
  { key: 'under', label: 'Underallocated', plain: 'Allocations fall below the recorded shortage, including schools with no allocation.', color: '#c63b31' },
  { key: 'fully', label: 'Fully allocated', plain: 'Allocations match the recorded shortage.', color: '#1f8a70' },
  { key: 'over', label: 'Overallocated', plain: 'Allocations exceed the recorded shortage, including allocations to schools with no recorded shortage.', color: '#f0a030' },
  { key: 'none', label: 'No recorded shortage', plain: 'A recorded shortage of zero, and no allocation.', color: '#a7b0bd' },
  { key: 'no_data', label: 'No shortage data', plain: 'No SY 2023–2024 shortage figure, so the allocation cannot be assessed.', color: NO_SHORTAGE_DATA },
];
export const statusInfo = (k: AllocationStatus) => ALLOCATION_STATUS.find((x) => x.key === k) ?? ALLOCATION_STATUS[4];
export function statusOf(shortage: number | null | undefined, allocated: number): AllocationStatus {
  if (shortage == null) return 'no_data';
  if (allocated === 0 && shortage === 0) return 'none';
  return allocated < shortage ? 'under' : allocated === shortage ? 'fully' : 'over';
}
/** EDCOM 2's proposed Classroom Shortage Rate: shortage ÷ (available classrooms + shortage). */
export const shortageRate = (shortage: number | null | undefined, available: number | null | undefined) =>
  shortage == null || available == null || available + shortage <= 0 ? null : shortage / (available + shortage);
/** Why a school has no shortage figure (EDCOM 2's answer, 2026-10-16). */
export const NO_DATA_EXPLAINED =
  'Shortage estimates use SY 2023–2024 as the reference year. No figure means the School ID was not found in that year’s data: it was missing from the dataset, or the school opened after SY 2023–2024.';
/** EDCOM 2's assumed cost of a classroom, for the funds tied to excess allocations. */
export const EDCOM2_COST_PER_CLASSROOM = 2_500_000;

/** Coverage of a shortage by 2026 classrooms, for the areas map and its legend. */
export const COVERAGE_CLASSES = [
  { max: 0.05, label: 'Under 5%', color: '#9e1b1b' },
  { max: 0.15, label: '5–15%', color: '#d9502c' },
  { max: 0.5, label: '15–50%', color: '#e9b44c' },
  { max: Infinity, label: '50% or more', color: '#3a7d5c' },
] as const;
export const coverageClass = (covered: number, shortage: number) =>
  shortage <= 0 ? COVERAGE_CLASSES.length - 1 : COVERAGE_CLASSES.findIndex((c) => covered / shortage < c.max);


/** Classrooms are counted in whole numbers; the source's shortages are often fractional (7.999…). */
export const rooms = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
/** A School Building Program scope code in words: "2STY4CL" → "2 storeys, 4 classrooms"; free text as given. */
export function scopeLabel(scope: string | null | undefined): string {
  const m = /^(?:(\d+)STY)?(\d+)CL$/.exec(scope ?? '');
  if (!m) return scope ?? 'Project';
  const cr = `${m[2]} classroom${m[2] === '1' ? '' : 's'}`;
  return m[1] ? `${m[1]} ${m[1] === '1' ? 'storey' : 'storeys'}, ${cr}` : cr;
}
/** "1 classroom", "3 classrooms" (rounded like `rooms`). */
export const classrooms = (v: number | null | undefined) => (v == null ? '—' : `${rooms(v)} classroom${Math.round(v) === 1 ? '' : 's'}`);
export const num = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-US'));
export const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

export const label = <T extends readonly (readonly [string, string])[]>(list: T, v: string | null | undefined) =>
  list.find(([k]) => k === v)?.[1] ?? '—';

/** Region keys as the House bill pages show them. */
export const REGION_SHORT: Record<string, string> = {
  NCR: 'NCR', CAR: 'CAR', I: 'Region I', II: 'Region II', III: 'Region III', 'IV-A': 'Region IV-A', MIMAROPA: 'MIMAROPA',
  V: 'Region V', VI: 'Region VI', NIR: 'NIR', VII: 'Region VII', VIII: 'Region VIII', IX: 'Region IX', X: 'Region X',
  XI: 'Region XI', XII: 'Region XII', XIII: 'Caraga', BARMM: 'BARMM',
};
export const REGION_KEYS = Object.keys(REGION_SHORT);
export const regionName = (k: string | null | undefined) => (k ? REGION_SHORT[k] ?? k : 'Schools abroad');

// ---------------------------------------------------------------------------
// Overview / analysis (`/schools/overview`, GET /api/schools/analysis)
// ---------------------------------------------------------------------------

export const SCHOOLS_OVERVIEW = '/schools/overview';

/** DepEd's "Basic Education Facilities" activity, the national school building line (GAA fpaps id; amounts in ₱ thousands). */
export const BEFF_FPAP_ID = '07-001-310200100006000';
/**
 * FY2027 figures for the same line. NEP: data/2027/07/fpaps.json (NEP 2027 Vol. I p. 389, PDF p. 413). House bill:
 * HB 10858, 3rd reading (Vol. IA p. 302, PDF p. 312), from hgab/2027/explorer/d/department-of-education.json. One line
 * in each; pesos.
 */
export const BEFF_2027 = { nep: 30_551_016_000, house: 27_453_016_000 } as const;

export type DpwhKind = 'buildings' | 'mpb' | 'repair' | 'other';
/** How a DPWH school contract is grouped by its description (first rule that fits, in this order: repair, mpb, buildings). */
export const DPWH_KINDS: { key: DpwhKind; label: string; color: string }[] = [
  { key: 'buildings', label: 'School buildings and classrooms', color: '#2a78d6' },
  { key: 'mpb', label: 'Multi-purpose buildings and covered courts', color: '#eb6834' },
  { key: 'repair', label: 'Repairs and improvements', color: '#1baf7a' },
  { key: 'other', label: 'Other (water, fences, overpasses, sites)', color: '#eda100' },
];

export interface AnalysisProvince extends AreaTotals {
  province: string;
  region_key: string | null;
  /** Learners (SY 2023–2024) at schools that also have a shortage row, so shortage per learner compares like with like. */
  learners_with_shortage: number;
  learners: number;
  classrooms: number;
  makeshift_tls: number;
  /** DPWH contracts confidently linked to the province's schools, 2016-2026; a contract for n schools counts 1/n each. */
  dpwh_contracts: number;
  dpwh_budget_php: number;
  dpwh_buildings_php: number;
  dpwh_mpb_php: number;
}
export interface AnalysisFile {
  meta: { generated_at: string };
  provinces: AnalysisProvince[];
  dpwh_years: { infra_year: number; kind: DpwhKind; contracts: number; budget_php: number }[];
  sbp_modality: { modality: string; projects: number; classrooms: number; budget_php: number; classrooms_with_budget: number }[];
  /**
   * The same contracts by who funds them: 'beff' = DepEd's school-building line carried out by DPWH (DPWH's source of
   * funds says "DepEd BEFF"), 'dpwh' = DPWH's own budget (regular infra, including SSP and other programs).
   */
  dpwh_funds: { fund: 'beff' | 'dpwh'; kind: DpwhKind; contracts: number; budget_php: number }[];
  /** GAA amounts of BEFF_FPAP_ID by year, in pesos. */
  beff_gaa: { year: number; amount_php: number }[];
  /** EDCOM 2's "Classroom Allocation Status by Shortage Level": schools (and classrooms) per level × status. */
  status_levels: { level: ShortageLevel | null; status: AllocationStatus; schools: number; shortage: number; allocated: number }[];
  /** Schools short of classrooms by size, in steps of 10 (lo = 1, 11, … 91; 101 = over 100). */
  shortage_sizes: { lo: number; schools: number; shortage: number }[];
  /** Short schools by Classroom Shortage Rate, in tenths closed at the top: 0 = up to 10%, 1 = more than 10% to 20%, … 9 = more than 90%. */
  shortage_rates: { tenth: number; schools: number }[];
}

/** Registry provinces whose names differ from PSA's 87 areas (src/lib/indicators.ts); others match by slug. */
const AREA_ALIAS: Record<string, string> = {
  'NORTH COTABATO': 'cotabato', '(SGA - North Cotabato)': 'special-geographic-area', 'WESTERN SAMAR': 'samar',
  'COMPOSTELA VALLEY': 'davao-de-oro', 'CITY OF ISABELA': 'isabela-city',
  // PSA has no area of its own for Cotabato City; it is counted with Maguindanao, as PSA's tables did before 2019.
  'CITY OF COTABATO': 'maguindanao',
  'MANILA, NCR, FIRST DISTRICT': 'metro-manila-1st-district', 'NCR SECOND DISTRICT': 'metro-manila-2nd-district',
  'NCR THIRD DISTRICT': 'metro-manila-3rd-district', 'NCR FOURTH DISTRICT': 'metro-manila-4th-district',
};
/** The PSA area (indicators) a registry province belongs to; null for schools abroad. */
export function areaOfProvince(province: string | null | undefined): string | null {
  if (!province) return null;
  return AREA_ALIAS[province] ?? province.toLowerCase().replace(/ñ/g, 'n').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Sources (every schools page cites them; the About page lists them in full)
// ---------------------------------------------------------------------------

export interface SchoolSource { key: string; who: string; title: string; url: string | null; note: string }
const R2 = 'https://budget-assets.bettergov.ph';
/** The official sources to check the directory against, as the maintainer named them (2026-11-24). */
export const OFFICIAL_SOURCES: SchoolSource[] = [
  {
    key: 'edcom2', who: 'EDCOM 2', title: 'Classroom supply and demand dashboard (LGU Breakdown)',
    url: 'https://public.tableau.com/app/profile/rafaela.manasan/viz/classroom_supply_demand_v3_backup2/LGUBreakdown',
    note: 'Tableau Public workbook by Rafaela Manasan, last published 13 November 2026.',
  },
  {
    key: 'deped-files', who: 'DepEd', title: 'Machine-ready files', url: 'https://www.deped.gov.ph/machine-ready-files/',
    note: 'DepEd’s downloadable data files.',
  },
  {
    key: 'deped-bukas', who: 'DepEd', title: 'Paaralang Bukas public dashboard', url: 'https://www.deped.gov.ph/paaralang-bukas/',
    note: 'DepEd’s public dashboard.',
  },
];
/**
 * What this directory is built from, worded as EDCOM 2's dashboard cites DepEd's datasets ("the latest datasets
 * submitted by DepEd to EDCOM II"), and the budget and statistics it is read against.
 */
export const DATA_SOURCES: SchoolSource[] = [
  {
    key: 'sbp', who: 'DepEd', title: 'FY 2026 School Building Program (SBP) Masterlist', url: null,
    note: '5,652 projects across all implementation modalities: DPWH, PSIP III, DepEd LCS/LMS, and provincial, city and municipal LGUs. As of 20 August 2026.',
  },
  {
    key: 'shortage', who: 'DepEd', title: 'School-level classroom shortage, SY 2023–2024', url: null,
    note: 'Kindergarten to Grade 12 classroom shortage per public school, submitted 13 October 2025.',
  },
  {
    key: 'lis', who: 'DepEd', title: 'Learner Information System (LIS): school-level enrollment, SY 2023–2024', url: null,
    note: 'All public and private schools. As of 31 January 2024.',
  },
  {
    key: 'bukas', who: 'DepEd', title: 'Project BUKAS facilities data, SY 2023–2024', url: 'https://www.deped.gov.ph/paaralang-bukas/',
    note: 'Temporary learning spaces, makeshift rooms and condemnation. As of July 2026.',
  },
  {
    key: 'tags', who: 'DepEd', title: 'Public schools with IPEd and Last Mile School tags, SY 2025–2026', url: null,
    note: '48,129 public schools. As of February 2026.',
  },
  {
    key: 'blgf', who: 'DOF–BLGF', title: 'LGU income classification, FY 2025', url: null, note: 'As of September 2026.',
  },
  {
    key: 'pack', who: 'BetterGov.ph', title: 'Classroom Shortages & Projects Data Pack', url: null,
    note: 'The workbook that joins these by School ID, with the school registry and 2022 school coordinates (LIS, then NSBI). Source years are kept in every field name.',
  },
  {
    key: 'dpwh', who: 'DPWH', title: 'Transparency portal: contracts', url: 'https://transparency.dpwh.gov.ph',
    note: 'Contracts with infra years 2016 to 2026, as listed on 3 November 2026; linked to schools by School ID or name.',
  },
  {
    key: 'gaa', who: 'DBM', title: 'General Appropriations Act, 2020 to 2026', url: '/gaa',
    note: 'DepEd’s “Basic Education Facilities” line, from our GAA data.',
  },
  {
    key: 'nep', who: 'DBM', title: 'National Expenditure Program 2027, Volume I', url: `${R2}/hgab/2027/pdf/nep2027-vol-i.pdf#page=413`,
    note: 'Basic Education Facilities, p. 389 (PDF p. 413).',
  },
  {
    key: 'house', who: 'House of Representatives', title: 'HB 10858 (third reading), Volume IA', url: `${R2}/hgab/2027/pdf/hb10858-3r-vol-ia.pdf#page=312`,
    note: 'Basic Education Facilities, p. 302 (PDF p. 312).',
  },
  {
    key: 'psa', who: 'PSA', title: 'Poverty 2023 and Census 2024, by province', url: 'https://statistics.bettergov.ph',
    note: 'Through our Indicators section (PSA’s 87 areas).',
  },
];
/** EDCOM 2's data note, carried on every schools page. */
export const DATA_NOTE =
  'The dashboard uses the latest datasets submitted by DepEd to EDCOM II as of publication. Classroom shortage figures are from SY 2023–2024, while classroom allocations are from FY 2026. Reported concerns will be subject to review and validation before any changes are made to the dashboard.';
