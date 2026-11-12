/**
 * Multi-purpose buildings per person (`/hgab/2027/multi-purpose/per-person`): every MPB line (FY2015 GAA to the
 * 2027 House bill, `mpb-years/lines.json`) set against the population of its region, its province and its city or
 * municipality in the budget's own year (PSA's 2015, 2020 and 2024 censuses; see popInYear). Budgets of several
 * years are read as a yearly average.
 *
 * Contract shared by scripts/build-mpb-population.ts (which writes `mpb-years/population.json` and `.csv`) and the
 * page. No React and no import.meta.
 *
 * A line is counted where `mpb-years` places it: the town its title names (or its GPS point), else the province,
 * else the one legislative district its office serves; a region always. Placements are our reading of titles.
 */

export const MPB_POPULATION_ROOT = '/hgab/2027/multi-purpose/per-person';
export const MPB_POPULATION_PATH = 'hgab/2027/mpb-years/population.json';
export const MPB_POPULATION_CSV_PATH = 'hgab/2027/mpb-years/population.csv';
export const MPB_POPULATION_CSV_NAME = 'bettergov-multi-purpose-buildings-per-person.csv';
/** The combined budget: the seven enacted budgets FY2020–2026. */
export const COMBINED_KEY = 'gaa-2020-2026';
/**
 * All years: the twelve enacted budgets FY2015–2026 and one 2027 document (the NEP, or the House bill; never both,
 * which would count 2027 twice). Enacted budgets and a proposal are added together; the page reads it as a yearly
 * average over thirteen years.
 */
export const ALL_NEP_KEY = 'all-2015-2027-nep';
export const ALL_HOUSE_KEY = 'all-2015-2027-house';

export type PopLevel = 'region' | 'area' | 'town';

/** [lines, pesos] */
export type Tally = [number, number];

/** A place's population in the 2015, 2020 and 2024 censuses (PSA restates the earlier two on today's boundaries). */
export type Census = [number, number, number];
export const CENSUS_YEARS = [2015, 2020, 2024] as const;

/**
 * A place's population in a budget year: the census of that year, filled in between censuses at a steady rate, and the
 * 2024 count for every year after it (no projection).
 */
export function popInYear(c: Census, fy: number): number {
  if (fy <= 2015) return c[0];
  if (fy === 2020) return c[1];
  if (fy >= 2024) return c[2];
  const [a, b, y0, y1] = fy <= 2020 ? [c[0], c[1], 2015, 2020] : [c[1], c[2], 2020, 2024];
  if (!a || !b) return b || a;
  return a * Math.pow(b / a, (fy - y0) / (y1 - y0));
}

/**
 * The people a budget's figures are measured against: the population in its year, or, for several years, the average
 * over them. With `years.length` budgets, "per person a year" is php / years / people, and "1 project for every N people
 * a year" is N = people × years / lines.
 */
export function peopleIn(c: Census, years: readonly number[]): number {
  return years.reduce((s, y) => s + popInYear(c, y), 0) / years.length;
}

/** READER-FACING. Whose population a budget is measured against, e.g. "2015 census" or "average for FY2015–2027". */
export function populationBasis(years: readonly number[]): string {
  if (years.length > 1) return `average for FY${years[0]}–${years[years.length - 1]}`;
  const y = years[0];
  if (y >= 2024) return '2024 census';
  if (y === 2015 || y === 2020) return `${y} census`;
  return y < 2020 ? `${y}, between the 2015 and 2020 censuses` : `${y}, between the 2020 and 2024 censuses`;
}

export interface MpbPopBudget {
  key: string;
  label: string;
  /** Fiscal years in it, oldest first: one, or several for the combined and all-years budgets. */
  years: number[];
  lines: number;
  php: number;
  /** How much of the budget each level could place. */
  placed: Record<PopLevel, Tally>;
}

export interface MpbPopTown {
  /** PSGC (2024 census code). */
  code: string;
  name: string;
  kind: 'city' | 'municipality';
  /** Indicators area id (province with its HUCs, or a Metro Manila district). */
  area: string;
  region: string;
  /** 2024 census. */
  population: number;
  census: Census;
  /** Where to draw it: the town's own place in the MPB data, else the middle of its barangays there. Null if none. */
  lng: number | null;
  lat: number | null;
}

export interface MpbPopulationFile {
  schema: 2;
  built_at: string;
  source_commit: string | null;
  budgets: MpbPopBudget[];
  /** `population` is the 2024 census; `census` adds 2015 and 2020. */
  regions: { key: string; label: string; plain: string; population: number; census: Census }[];
  areas: { id: string; name: string; region: string; population: number; census: Census; psgc: number[] }[];
  towns: MpbPopTown[];
  /** by[budgetKey][level][unit] = [lines, pesos]; units are region keys, area ids or town codes. Absent = none. */
  by: Record<string, Record<PopLevel, Record<string, Tally>>>;
  population_source: { title: string; url: string; publisher_url: string; as_of: string };
  csv: { path: string; bytes: number; sha256: string };
  /** READER-FACING. */
  notes: string[];
}
