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
export const SCHOOLS_API_VERSION = '3';

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

/** Map points, column-wise for size: one entry per school with usable 2022 coordinates. */
export interface PointsFile {
  meta: { generated_at: string; schools: number; with_coordinates: number };
  /** [school_id, lon, lat, shortage (null: no 2023 shortage row), SBP 2026 classrooms, sector code] */
  rows: [string, number, number, number | null, number, SectorCode][];
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
  shortage: number | null;
  sbp_classrooms: number | null;
  sbp_budget_php: number | null;
  reports: number;
}
export interface ListFile {
  meta: { total: number; page: number; per: number; sort: ListSort };
  rows: ListRow[];
}
export type ListSort = 'shortage' | 'gap' | 'name' | 'enrolment' | 'reports';
export type ShortageFilter = 'any' | 'short' | 'none' | 'nodata';

export interface AreaRow {
  region_key: string | null;
  division: string | null;
  schools: number;
  public_schools: number;
  /** Schools with a 2023 shortage row (the rest have no shortage data, which is not zero). */
  with_shortage_data: number;
  schools_short: number;
  shortage: number;
  sbp_projects: number;
  /** SBP 2026 classrooms with a budget, and those still "For Bidding" (PSIP III, no amount). */
  sbp_classrooms_funded: number;
  sbp_classrooms_bidding: number;
  sbp_budget_php: number;
  /** Per school, summed: the part of its own shortage the 2026 list covers, and the part left. */
  covered: number;
  gap: number;
  /** 2026 classrooms listed at schools DepEd counted as not short (0) / with no shortage data. */
  listed_not_short: number;
  listed_no_data: number;
  /** Mean of the schools' 2022 points, for placing the area on the map; null without any. */
  lat: number | null;
  lon: number | null;
  reports: number;
  reports_confirming: number;
}
export interface AreasFile {
  meta: {
    generated_at: string;
    level: 'region' | 'division';
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
// Field reports
// ---------------------------------------------------------------------------
//
// Only what DepEd and EDCOM2 need to act on the list, in this order:
//   1. Is the school here and open?            (checks the facilities list)
//   2. Does it lack classrooms?                 (confirms or disputes the 2023 shortage)
//   3. About how many more does it need?        (only if yes: against DepEd's count)
//   4. What do you see?                         (only if yes: the evidence, any that apply)
//   5. What have you seen of each 2026 project? (only for projects listed at the school)
//   6. How do you know the school?              (so reports can be weighed)
// plus an optional note and photo links.

export const LISTINGS = [
  ['open', 'Yes, it is here and open'],
  ['wrong_place', 'It is open, but somewhere else'],
  ['closed', 'It has closed or merged'],
  ['not_found', 'I could not find it'],
] as const;
export const SHORTAGE_ANSWERS = [
  ['confirmed', 'Yes, not enough classrooms'],
  ['none', 'No, there are enough'],
  ['unsure', 'Not sure'],
] as const;
export const SIGNS = [
  ['shifts', 'Classes take turns in shifts'],
  ['makeshift', 'Classes in makeshift rooms, tents or hallways'],
  ['shared', 'Two or more classes share one room'],
  ['unsafe', 'Rooms in use are unsafe or condemned'],
] as const;
export const PROJECT_SEEN = [
  ['not_started', 'Not started'],
  ['ongoing', 'Under construction'],
  ['done', 'Finished and in use'],
  ['done_unused', 'Finished, not in use'],
  ['no_sign', 'No sign of it'],
] as const;
export const RELATIONS = [
  ['staff', 'Teacher or school staff'],
  ['family', 'Learner or parent'],
  ['official', 'Barangay or LGU official'],
  ['community', 'Live nearby or visited'],
] as const;

type Keys<T extends readonly (readonly [string, string])[]> = T[number][0];
export type Listing = Keys<typeof LISTINGS>;
export type ShortageAnswer = Keys<typeof SHORTAGE_ANSWERS>;
export type Sign = Keys<typeof SIGNS>;
export type ProjectSeen = Keys<typeof PROJECT_SEEN>;
export type Relation = Keys<typeof RELATIONS>;

export interface SchoolReport {
  report_id?: string;
  school_id: string;
  listing: Listing | null;
  shortage: ShortageAnswer | null;
  /** Only with shortage 'confirmed'. */
  classrooms_needed: number | null;
  signs: Sign[];
  /** What the reporter saw of each project, by id: 2026 SBP projects (SBP-P…) and DPWH contracts (dpwh:…). */
  projects: Record<string, ProjectSeen>;
  relation: Relation | null;
  notes: string;
  photo_links: string[];
  updated_at?: string;
}

export const emptyReport = (schoolId: string): SchoolReport => ({
  school_id: schoolId, listing: null, shortage: null, classrooms_needed: null, signs: [], projects: {}, relation: null,
  notes: '', photo_links: [],
});

export const LIMITS = { notes: 1000, photos: 3, photoUrl: 500, classrooms: 200 } as const;
export const SCHOOL_ID_RE = /^[0-9A-Za-z-]{3,20}$/;
const PROJECT_ID_RE = /^(SBP-P\d{6}|dpwh:[A-Za-z0-9-]{4,30})$/;

const pick = <T extends readonly (readonly [string, string])[]>(list: T, v: unknown, field: string, problems: string[]) => {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && list.some(([k]) => k === v)) return v as Keys<T>;
  problems.push(`${field}: not one of the answers`);
  return null;
};

/** A report from the page, checked field by field; `problems` lists anything refused. */
export function readSchoolReport(raw: unknown): { report: SchoolReport | null; problems: string[] } {
  const problems: string[] = [];
  if (!raw || typeof raw !== 'object') return { report: null, problems: ['not a report'] };
  const r = raw as Record<string, unknown>;
  const schoolId = typeof r.school_id === 'string' && SCHOOL_ID_RE.test(r.school_id) ? r.school_id : null;
  if (!schoolId) problems.push('school_id: missing');
  const shortage = pick(SHORTAGE_ANSWERS, r.shortage, 'shortage', problems);

  let needed: number | null = null;
  if (r.classrooms_needed != null && r.classrooms_needed !== '') {
    const v = r.classrooms_needed;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= LIMITS.classrooms) needed = v;
    else problems.push(`classrooms_needed: a whole number from 1 to ${LIMITS.classrooms}`);
  }
  const signs: Sign[] = [];
  if (r.signs != null) {
    if (!Array.isArray(r.signs)) problems.push('signs: a list');
    else for (const v of new Set(r.signs)) { const k = pick(SIGNS, v, 'signs', problems); if (k) signs.push(k); }
  }
  // A school that is closed or can't be found has no shortage to report; the follow-ups belong to a confirmed one only.
  const listing = pick(LISTINGS, r.listing, 'listing', problems);
  const gone = listing === 'closed' || listing === 'not_found';
  const shortageKept = gone ? null : shortage;
  if (shortageKept !== 'confirmed') { needed = null; signs.length = 0; }

  const projects: Record<string, ProjectSeen> = {};
  if (r.projects != null) {
    if (typeof r.projects !== 'object' || Array.isArray(r.projects)) problems.push('projects: by project id');
    else for (const [id, v] of Object.entries(r.projects as Record<string, unknown>)) {
      if (!PROJECT_ID_RE.test(id)) { problems.push(`projects: unknown id ${id.slice(0, 20)}`); continue; }
      const seen = pick(PROJECT_SEEN, v, `projects.${id}`, problems);
      if (seen) projects[id] = seen;
    }
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
  const report: SchoolReport = {
    school_id: schoolId ?? '',
    listing,
    shortage: shortageKept,
    classrooms_needed: needed,
    signs,
    projects,
    relation: pick(RELATIONS, r.relation, 'relation', problems),
    notes,
    photo_links: photos,
  };
  if (!report.listing) problems.push('Say whether the school is here and open.');
  if (report.listing && !gone && !report.shortage) problems.push('Say whether the school lacks classrooms.');
  if (!report.relation) problems.push('Say how you know the school.');
  return { report: problems.length ? null : report, problems };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** Shortage classes for the map and badges (classrooms short in 2023). */
export const SHORTAGE_CLASSES = [
  { min: 0, max: 0, label: 'None', color: '#c9d3df' },
  { min: 0.0001, max: 2, label: '1–2', color: '#f6c28b' },
  { min: 2.0001, max: 5, label: '3–5', color: '#ee8a4f' },
  { min: 5.0001, max: 10, label: '6–10', color: '#d9502c' },
  { min: 10.0001, max: Infinity, label: 'More than 10', color: '#9e1b1b' },
] as const;
export const NO_SHORTAGE_DATA = '#8a92a1';
export const PROJECT_RING = '#0b4fd9';

/** Coverage of a shortage by 2026 classrooms, for the areas map and its legend. */
export const COVERAGE_CLASSES = [
  { max: 0.05, label: 'Under 5%', color: '#9e1b1b' },
  { max: 0.15, label: '5–15%', color: '#d9502c' },
  { max: 0.5, label: '15–50%', color: '#e9b44c' },
  { max: Infinity, label: '50% or more', color: '#3a7d5c' },
] as const;
export const coverageClass = (covered: number, shortage: number) =>
  shortage <= 0 ? COVERAGE_CLASSES.length - 1 : COVERAGE_CLASSES.findIndex((c) => covered / shortage < c.max);

export const shortageClass = (v: number | null) =>
  v == null ? -1 : SHORTAGE_CLASSES.findIndex((c) => v >= c.min && v <= c.max);

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

export interface AnalysisProvince {
  province: string;
  region_key: string | null;
  schools: number;
  public_schools: number;
  with_shortage_data: number;
  schools_short: number;
  shortage: number;
  /** Learners (2023) at schools that also have a shortage row, so shortage per learner compares like with like. */
  learners_with_shortage: number;
  learners: number;
  classrooms: number;
  makeshift_tls: number;
  sbp_funded: number;
  sbp_bidding: number;
  sbp_budget_php: number;
  covered: number;
  listed_not_short: number;
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
/** What this directory is built from, and the budget and statistics it is read against. */
export const DATA_SOURCES: SchoolSource[] = [
  {
    key: 'pack', who: 'DepEd data, joined', title: 'Classroom Shortages & Projects Data Pack', url: null,
    note: 'The workbook behind every school figure here: DepEd’s school registry, 2023 classroom shortages, 2022 coordinates (LIS, NSBI), 2023 facilities and enrolment, and the 2026 School Building Program list, joined by School ID.',
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
