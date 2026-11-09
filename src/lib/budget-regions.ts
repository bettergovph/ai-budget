/**
 * Budget and poverty by region (`/indicators/budget-by-region`): how much of the NEP and the GAA is
 * assigned to each region, beside its people and its poor.
 *
 * Contract shared by scripts/build-indicators.ts (which writes indicators/regions.json) and the page.
 * No React and no import.meta.
 *
 * "Assigned to a region" means the budget line's region code in DBM's data (data/2027/<dept>/line_items.parquet):
 * the region of the office that manages it. Two kinds of budget sit outside every region:
 * - region 00, "Central Office (nationwide)": automatic appropriations such as the NTA to local governments,
 *   BARMM's block grant and debt service;
 * - most of what DBM codes to NCR: every agency's central office, bureaus and national units. Only NCR's own
 *   offices (NCR_LOCAL_PATTERN, plus NCR's state universities) count as NCR here.
 */

export const BUDGET_BY_REGION_ROOT = '/indicators/budget-by-region';
export const REGION_BUDGET_PATH = 'indicators/regions.json';
export const REGION_BUDGET_CSV_PATH = 'indicators/regions.csv';
export const REGION_BUDGET_CSV_NAME = 'bettergov-budget-and-poverty-by-region.csv';

export type BudgetYear = '2026' | '2027' | 'house2027';
/**
 * The budgets a reader can pick. `compare` is the budget the table's change column is measured against
 * (`from`: this − that; `to`: that − this).
 */
export const BUDGET_YEARS: { key: BudgetYear; label: string; compare: BudgetYear; direction: 'from' | 'to' }[] = [
  { key: '2027', label: '2027 NEP', compare: '2026', direction: 'from' },
  { key: 'house2027', label: '2027 House bill', compare: '2027', direction: 'from' },
  { key: '2026', label: '2026 GAA', compare: '2027', direction: 'to' },
];

/**
 * House Bill 10858 (third reading) by region = the 2027 NEP by region + the House's changes, each placed by
 * the region the bill prints for the changed line (with the NCR rule below). A changed line with no printed
 * region goes to its agency's own region in the NEP, when the agency has one. Automatic appropriations are not
 * in the bill and stay as in the NEP; the unprogrammed appropriations are unchanged and not in the NEP lines.
 */
export const HOUSE_BILL_NOTE = 'The 2027 House bill is the NEP with the House’s changes (₱219.8 billion raised, the same amount cut), each placed in the region the bill prints for the line.';

/** DBM region code → region key (the keys the House bill pages and provinces.json use). */
export const REGION_BY_CODE: Record<string, string> = {
  '01': 'I', '02': 'II', '03': 'III', '04': 'IV-A', '05': 'V', '06': 'VI', '07': 'VII', '08': 'VIII', '09': 'IX',
  '10': 'X', '11': 'XI', '12': 'XII', '13': 'NCR', '14': 'CAR', '16': 'XIII', '17': 'MIMAROPA', '18': 'NIR', '19': 'BARMM',
};

export const REGION_NAMES: Record<string, { label: string; plain: string }> = {
  NCR: { label: 'NCR', plain: 'Metro Manila' }, CAR: { label: 'CAR', plain: 'Cordillera' },
  I: { label: 'Region I', plain: 'Ilocos' }, II: { label: 'Region II', plain: 'Cagayan Valley' },
  III: { label: 'Region III', plain: 'Central Luzon' }, 'IV-A': { label: 'Region IV-A', plain: 'Calabarzon' },
  MIMAROPA: { label: 'MIMAROPA', plain: 'Mimaropa' }, V: { label: 'Region V', plain: 'Bicol' },
  VI: { label: 'Region VI', plain: 'Western Visayas' }, NIR: { label: 'NIR', plain: 'Negros Island' },
  VII: { label: 'Region VII', plain: 'Central Visayas' }, VIII: { label: 'Region VIII', plain: 'Eastern Visayas' },
  IX: { label: 'Region IX', plain: 'Zamboanga Peninsula' }, X: { label: 'Region X', plain: 'Northern Mindanao' },
  XI: { label: 'Region XI', plain: 'Davao' }, XII: { label: 'Region XII', plain: 'Soccsksargen' },
  XIII: { label: 'Region XIII', plain: 'Caraga' }, BARMM: { label: 'BARMM', plain: 'Bangsamoro' },
};
export const REGION_ORDER = Object.keys(REGION_NAMES);

/** BARMM's own lines (block grant, share in national taxes, Special Development Fund) count in BARMM. */
export const BARMM_AGENCY_PREFIX = 'Bangsamoro Autonomous Region';

/**
 * NCR budget lines that belong to Metro Manila itself: its regional offices, schools divisions and district
 * engineering offices (matched on the operating unit's name, case-insensitive). NCR's state universities count
 * too (department 08). Everything else coded NCR is a national office.
 */
export const NCR_LOCAL_PATTERN = '(regional office.*(ncr|national capital)|^division of|district engineering office|metro manila|national capital region)';

export interface BudgetRegion {
  key: string;
  label: string;
  plain: string;
  population_2024: number;
  /** People below the poverty line, 2023: each province's poverty incidence × its 2024 population, added up. */
  poor_2023: number;
  /** poor_2023 ÷ the population of the provinces with a poverty figure. */
  poverty_2023: number;
  /** PSA's own regional estimate, where its 2023 region matches today's (not Region IX or BARMM: Sulu moved). */
  poverty_2023_psa: number | null;
  /** Indicators area ids in the region. */
  areas: string[];
  /**
   * Every indicator for the region, added up from its provinces (counts summed, published rates weighted by
   * RATE_WEIGHTS in src/lib/indicators.ts) over the provinces that have a figure. Null when none has.
   */
  values: Record<string, number | null>;
  /** The counts the indicators' `need` names (poor people, children under 15, births, hectares of palay). */
  needs: Record<string, number | null>;
}

export interface BudgetDepartment {
  /** 'all', or DBM's department id ("07"). */
  id: string;
  name: string;
  short: string;
  total: Record<BudgetYear, number>;
  /** Assigned to one of the 18 regions (NCR's own offices included). */
  regional: Record<BudgetYear, number>;
  /** Coded NCR but national: central offices, bureaus, national units. */
  central: Record<BudgetYear, number>;
  /** Region 00: nationwide items. */
  nationwide: Record<BudgetYear, number>;
}

export interface RegionBudgetFile {
  schema: 1;
  built_at: string;
  source_commit: string | null;
  regions: BudgetRegion[];
  /** 'all' first, then departments by their regional budget, largest first. */
  departments: BudgetDepartment[];
  /** budget[year][departmentId][regionKey] in pesos. */
  budget: Record<BudgetYear, Record<string, Record<string, number>>>;
  csv: { path: string; bytes: number; sha256: string };
  /** READER-FACING. */
  notes: string[];
}

export const shareOf = (part: number, whole: number) => (whole ? (100 * part) / whole : 0);

/** The two rows outside the 18 regions, so the list adds up to the whole budget. */
export const CENTRAL_LABEL = 'Central offices';
export const CENTRAL_PLAIN = 'Head offices, bureaus and national units, which DBM codes to NCR';
export const NATIONWIDE_LABEL = 'Nationwide items';
export const NATIONWIDE_PLAIN = 'The NTA to local governments, debt service and other automatic items, in no region';
