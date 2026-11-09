/**
 * Indicators section (`/indicators`): PSA statistics and budget figures for each of the 87 areas PSA
 * publishes poverty for (provinces with their highly urbanized cities, the four Metro Manila districts,
 * Isabela City, Maguindanao as one).
 *
 * This module is the contract. scripts/build-indicators.ts reads the measures that
 * scripts/stats-psa/build.mjs writes and applies `value()` below to each area and to the Philippines.
 * The pages read the built file (indicators/indicators.json) and never compute an indicator themselves.
 * No React and no import.meta here, so the builder and the verifier can import it.
 *
 * Copy rules: docs/hgab-copy.md (plain language, "budget" not "money"). Every figure names its year and
 * source. Colours never say good or bad; the scale only orders the areas.
 */

export const INDICATORS_ROOT = '/indicators';
export const INDICATORS_DATA_PATH = 'indicators/indicators.json';
export const INDICATORS_CSV_PATH = 'indicators/indicators.csv';
export const INDICATORS_CSV_NAME = 'bettergov-indicators-by-province.csv';
export const STATISTICS_SITE = 'https://statistics.bettergov.ph';

/** Set to false once the maintainer has reviewed the section. */
export const INDICATORS_UNDER_REVIEW = true;

export type ThemeKey = 'people' | 'poverty' | 'economy' | 'farms' | 'health' | 'local' | 'budget';

export interface ThemeDef { key: ThemeKey; title: string; dek: string }

export const THEMES: ThemeDef[] = [
  { key: 'people', title: 'People', dek: 'How many people live in each area, how fast that is changing, and how old they are.' },
  { key: 'poverty', title: 'Poverty and income', dek: 'How many people are poor, how far below the poverty line, and what families earn.' },
  { key: 'economy', title: 'Economy', dek: 'The value of what each area produces.' },
  { key: 'farms', title: 'Farms', dek: 'Farm and fisheries output, and how much of the rice harvest is irrigated.' },
  { key: 'health', title: 'Births and deaths', dek: 'Births and deaths registered with the civil registry, by where the person lived.' },
  { key: 'local', title: 'Local government', dek: 'What the national government passes on to provincial governments by formula.' },
  { key: 'budget', title: 'National budget', dek: 'DPWH budget placed in each area, per person. These are our figures, built from the budget documents.' },
];

/** How a value is written. */
export type Unit = 'count' | 'percent' | 'pp' | 'peso' | 'per-1000' | 'per-100k' | 'per-km2' | 'tonnes-per-ha' | 'per-100';

/** Measures per area, as scripts/stats-psa/build.mjs writes them (null = not published for that area). */
export type Measures = Record<string, number | string | boolean | null | undefined>;

export type SourceKey =
  | 'poverty_pop' | 'poverty_gap' | 'census2024_pop' | 'census2024_density' | 'census2024_urban' | 'census2024_age'
  | 'fies2023' | 'gdp_level' | 'gdp_pc' | 'gva_construction' | 'agri_value' | 'palay_area' | 'palay_production'
  | 'births2024' | 'deaths2024' | 'nta' | 'dpwh_contracts' | 'hgab_locations';

export interface IndicatorDef {
  id: string;
  theme: ThemeKey;
  /** Heading, with the year. */
  title: string;
  /** Column label in tables. */
  short: string;
  unit: Unit;
  decimals: number;
  year: string;
  /** READER-FACING. One or two plain sentences: what the number is. */
  plain: string;
  /** READER-FACING. How we got it from the source tables. */
  how: string;
  /** READER-FACING. What to keep in mind. */
  caveats: string[];
  sources: SourceKey[];
  /** 'sequential' orders low → high; 'diverging' centres on zero (changes). */
  scale: 'sequential' | 'diverging';
  /**
   * The Philippines line beside the indicator: 'national' applies value() to PSA's national figures;
   * 'covered' applies it to the sum over the areas that have a value (and says so).
   */
  overall: 'national' | 'covered';
  /** The measures summed for an 'covered' overall (ratio of sums). */
  sums?: string[];
  /**
   * Who or what the budget serves, for the region comparison: "share of the poor beside share of the budget",
   * "budget per child under 15". `measure` is a count in the area measures.
   */
  need?: { measure: string; one: string; many: string };
  /** The department set beside this indicator first on the region comparison ('all' = the whole budget). */
  budgetDept?: string;
  value: (m: Measures) => number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ratio = (a: unknown, b: unknown, k = 1): number | null => {
  const x = num(a), y = num(b);
  return x == null || y == null || y === 0 ? null : (k * x) / y;
};
/** Years from 1 May 2020 (2020 census) to 1 July 2024 (2024 POPCEN). */
const CENSUS_YEARS_2020_2024 = 4 + 2 / 12;

const FARMS_NO_NCR = 'PSA does not publish this for Metro Manila or Isabela City.';
const VITAL = [
  'These are events registered with the civil registry. Where many births or deaths go unregistered, the rate looks lower than it is.',
  'Counted by where the person lived, not where the birth or death happened.',
];

export const INDICATORS: IndicatorDef[] = [
  // ---- people ----
  {
    id: 'population', theme: 'people', title: 'Population, 2024', short: 'Population', unit: 'count', decimals: 0, year: '2024',
    plain: 'People counted by the 2024 Census of Population (POPCEN), as of 1 July 2024.',
    how: 'A province includes its highly urbanized cities; each Metro Manila district is the sum of its cities.',
    caveats: [], sources: ['census2024_pop'], scale: 'sequential', overall: 'national',
    budgetDept: 'all',
    value: (m) => num(m.population_2024),
  },
  {
    id: 'population-growth', theme: 'people', title: 'Population growth a year, 2020–2024', short: 'Growth a year', unit: 'percent', decimals: 2, year: '2020–2024',
    plain: 'How fast the population grew each year between the 2020 census and the 2024 census.',
    how: 'The average yearly rate between the 1 May 2020 and 1 July 2024 counts (4 years and 2 months).',
    caveats: ['PSA’s counts show 12 areas with fewer people in 2024 than in 2020.'], sources: ['census2024_density'], scale: 'diverging', overall: 'national',
    budgetDept: 'all',
    value: (m) => {
      const a = num(m.population_2020), b = num(m.population_2024);
      return a && b ? (Math.pow(b / a, 1 / CENSUS_YEARS_2020_2024) - 1) * 100 : null;
    },
  },
  {
    id: 'density', theme: 'people', title: 'People per square kilometre, 2024', short: 'Per km²', unit: 'per-km2', decimals: 0, year: '2024',
    plain: 'People for every square kilometre of land.',
    how: 'The 2024 population divided by the land area PSA lists with the census.',
    caveats: ['For the Philippines we use PSA’s official land area of 300,000 km², as PSA does. The provinces’ own land areas add up to 322,139 km².'], sources: ['census2024_density', 'census2024_pop'], scale: 'sequential', overall: 'national',
    budgetDept: 'all',
    value: (m) => ratio(m.population_2024, m.land_km2),
  },
  {
    id: 'urban', theme: 'people', title: 'Share of people in urban areas, 2024', short: 'Urban', unit: 'percent', decimals: 1, year: '2024',
    plain: 'The share of people who live in barangays PSA classes as urban.',
    how: 'People in urban barangays divided by all people, from the 2024 census.',
    caveats: [], sources: ['census2024_urban'], scale: 'sequential', overall: 'national',
    budgetDept: 'all',
    value: (m) => ratio(m.urban_population_2024, m.population_2024, 100),
  },
  {
    id: 'under-15', theme: 'people', title: 'Share aged under 15, 2024', short: 'Under 15', unit: 'percent', decimals: 1, year: '2024',
    plain: 'Children under 15 as a share of everyone living in households.',
    how: 'From the 2024 census household population by age group.',
    caveats: [], sources: ['census2024_age'], scale: 'sequential', overall: 'national',
    budgetDept: '07',
    need: { measure: 'age_under15_2024', one: 'child under 15', many: 'children under 15' },
    value: (m) => ratio(m.age_under15_2024, m.hh_population_2024, 100),
  },
  {
    id: 'aged-60', theme: 'people', title: 'Share aged 60 and over, 2024', short: '60 and over', unit: 'percent', decimals: 1, year: '2024',
    plain: 'People aged 60 and over as a share of everyone living in households.',
    how: 'From the 2024 census household population by age group.',
    caveats: ['PSA’s 2024 table counts more people aged 80 and over in the provinces of Bicol, Northern Mindanao and Davao than in those regions as a whole, so this figure is left out for them.'],
    sources: ['census2024_age'], scale: 'sequential', overall: 'national',
    budgetDept: '20',
    need: { measure: 'age_60plus_2024', one: 'person aged 60 and over', many: 'people aged 60 and over' },
    value: (m) => ratio(m.age_60plus_2024, m.hh_population_2024, 100),
  },
  {
    id: 'dependency', theme: 'people', title: 'Dependency ratio, 2024', short: 'Dependency', unit: 'per-100', decimals: 1, year: '2024',
    plain: 'Children under 15 and people 65 and over for every 100 people aged 15 to 64.',
    how: 'From the 2024 census household population by age group.',
    caveats: ['Left out for the provinces of Bicol, Northern Mindanao and Davao, for the same reason as the 60-and-over share.'],
    sources: ['census2024_age'], scale: 'sequential', overall: 'national',
    budgetDept: 'all',
    value: (m) => {
      const y = num(m.age_under15_2024), o = num(m.age_65plus_2024), w = num(m.age_15_64_2024);
      return y == null || o == null || !w ? null : (100 * (y + o)) / w;
    },
  },
  // ---- poverty and income ----
  {
    id: 'poverty', theme: 'poverty', title: 'Poverty incidence, 2023', short: 'Poverty', unit: 'percent', decimals: 1, year: '2023',
    plain: 'The share of people whose family income is below the poverty line.',
    how: 'PSA’s official full-year 2023 estimate, from the Family Income and Expenditure Survey. A province’s figure includes its highly urbanized cities.',
    caveats: ['A survey estimate. In small provinces it can be off by several points; the table shows PSA’s coefficient of variation (CV), and a CV above 20 means the estimate is weak.'],
    sources: ['poverty_pop'], scale: 'sequential', overall: 'national',
    budgetDept: '20',
    need: { measure: 'poor_people_2023', one: 'poor person', many: 'poor people' },
    value: (m) => num(m.poverty_incidence_2023),
  },
  {
    id: 'poverty-change', theme: 'poverty', title: 'Change in poverty incidence, 2018–2023', short: 'Change since 2018', unit: 'pp', decimals: 1, year: '2018–2023',
    plain: 'How much the poverty incidence went up or down between 2018 and 2023, in percentage points.',
    how: 'PSA’s 2023 estimate minus its 2018 estimate.',
    caveats: ['Both estimates carry survey error, so small changes may not be real.'],
    sources: ['poverty_pop'], scale: 'diverging', overall: 'national',
    budgetDept: '20',
    value: (m) => {
      const a = num(m.poverty_incidence_2018), b = num(m.poverty_incidence_2023);
      return a == null || b == null ? null : b - a;
    },
  },
  {
    id: 'poverty-gap', theme: 'poverty', title: 'Poverty gap, 2023', short: 'Poverty gap', unit: 'percent', decimals: 1, year: '2023',
    plain: 'How far below the poverty line people are on average, as a share of the line, counting the non-poor as zero. It shows depth, not just how many.',
    how: 'PSA’s published 2023 figure.',
    caveats: ['A survey estimate, like the poverty incidence.'],
    sources: ['poverty_gap'], scale: 'sequential', overall: 'national',
    budgetDept: '20',
    need: { measure: 'poor_people_2023', one: 'poor person', many: 'poor people' },
    value: (m) => num(m.poverty_gap_2023),
  },
  {
    id: 'family-income', theme: 'poverty', title: 'Average family income, 2023', short: 'Family income', unit: 'peso', decimals: 0, year: '2023',
    plain: 'What a family earned in 2023 on average, in pesos a year.',
    how: 'From the 2023 Family Income and Expenditure Survey. Where PSA lists a province and its highly urbanized cities separately, we combine them, weighting by the number of families.',
    caveats: ['A survey average: a few very high incomes pull it up. Cotabato City is left out, as in the poverty figures.'],
    sources: ['fies2023'], scale: 'sequential', overall: 'national',
    budgetDept: '20',
    value: (m) => num(m.avg_family_income_2023),
  },
  // ---- economy ----
  {
    id: 'gdp-per-person', theme: 'economy', title: 'GDP per person, 2025', short: 'GDP per person', unit: 'peso', decimals: 0, year: '2025',
    plain: 'The value of everything produced in the area in 2025, divided by its people, at current prices.',
    how: 'PSA’s provincial product accounts. A province and its highly urbanized cities are combined using PSA’s own population figures behind each per-person number.',
    caveats: ['Output is counted where it is produced, not where the earners live.'],
    sources: ['gdp_level', 'gdp_pc'], scale: 'sequential', overall: 'national',
    budgetDept: 'all',
    value: (m) => num(m.gdp_per_person_2025),
  },
  {
    id: 'construction-share', theme: 'economy', title: 'Construction’s share of the economy, 2023', short: 'Construction share', unit: 'percent', decimals: 1, year: '2023',
    plain: 'Construction’s part of the area’s GDP, public and private together.',
    how: 'Gross value added in construction divided by GDP, both at 2023 current prices.',
    caveats: ['Covers all construction, not only government projects.'],
    sources: ['gva_construction', 'gdp_level'], scale: 'sequential', overall: 'national',
    budgetDept: 'all',
    value: (m) => ratio(m.construction_gva_2023, m.gdp_2023, 100),
  },
  // ---- farms ----
  {
    id: 'farm-output-per-person', theme: 'farms', title: 'Farm and fisheries output per person, 2025', short: 'Farm output per person', unit: 'peso', decimals: 0, year: '2025',
    plain: 'The value of crops, livestock, poultry and fish produced in the area in 2025, per person, at current prices.',
    how: 'PSA’s provincial value of production in agriculture and fisheries, divided by the 2024 population.',
    caveats: [FARMS_NO_NCR],
    sources: ['agri_value', 'census2024_pop'], scale: 'sequential', overall: 'covered', sums: ['agri_value_2025', 'population_2024'],
    budgetDept: '05',
    value: (m) => ratio(m.agri_value_2025, m.population_2024),
  },
  {
    id: 'irrigated-rice', theme: 'farms', title: 'Share of the rice harvest area that is irrigated, 2025', short: 'Irrigated rice', unit: 'percent', decimals: 1, year: '2025',
    plain: 'Of the land harvested for palay in 2025, the share that is irrigated rather than rain-fed.',
    how: 'Irrigated palay area harvested divided by all palay area harvested, for the whole year.',
    caveats: [FARMS_NO_NCR, 'Area harvested counts a field once per harvest, so land cropped twice counts twice.'],
    sources: ['palay_area'], scale: 'sequential', overall: 'national',
    budgetDept: '05',
    need: { measure: 'palay_area_2025', one: 'hectare of palay harvested', many: 'hectares of palay harvested' },
    value: (m) => ratio(m.palay_area_irrigated_2025, m.palay_area_2025, 100),
  },
  {
    id: 'rice-yield', theme: 'farms', title: 'Palay harvested per hectare, 2025', short: 'Palay per hectare', unit: 'tonnes-per-ha', decimals: 2, year: '2025',
    plain: 'Tonnes of palay for each hectare harvested in 2025.',
    how: 'Palay production divided by palay area harvested, for the whole year.',
    caveats: [FARMS_NO_NCR],
    sources: ['palay_production', 'palay_area'], scale: 'sequential', overall: 'national',
    budgetDept: '05',
    need: { measure: 'palay_area_2025', one: 'hectare of palay harvested', many: 'hectares of palay harvested' },
    value: (m) => ratio(m.palay_production_2025, m.palay_area_2025),
  },
  // ---- health ----
  {
    id: 'birth-rate', theme: 'health', title: 'Registered births per 1,000 people, 2024', short: 'Births per 1,000', unit: 'per-1000', decimals: 1, year: '2024',
    plain: 'Live births registered in 2024 for every 1,000 people, by the mother’s home.',
    how: 'Registered live births by usual residence of the mother, divided by the 2024 population.',
    caveats: VITAL, sources: ['births2024', 'census2024_pop'], scale: 'sequential', overall: 'national',
    budgetDept: '13',
    need: { measure: 'births_2024', one: 'registered birth', many: 'registered births' },
    value: (m) => ratio(m.births_2024, m.population_2024, 1000),
  },
  {
    id: 'death-rate', theme: 'health', title: 'Registered deaths per 1,000 people, 2024', short: 'Deaths per 1,000', unit: 'per-1000', decimals: 1, year: '2024',
    plain: 'Deaths registered in 2024 for every 1,000 people, by where the person lived.',
    how: 'Registered deaths by usual residence, divided by the 2024 population.',
    caveats: [...VITAL, 'Older populations have more deaths; this is not adjusted for age.'],
    sources: ['deaths2024', 'census2024_pop'], scale: 'sequential', overall: 'national',
    budgetDept: '13',
    value: (m) => ratio(m.deaths_2024, m.population_2024, 1000),
  },
  {
    id: 'infant-deaths', theme: 'health', title: 'Registered infant deaths per 1,000 births, 2024', short: 'Infant deaths', unit: 'per-1000', decimals: 1, year: '2024',
    plain: 'Babies who died before their first birthday, for every 1,000 live births, both as registered in 2024.',
    how: 'Registered infant deaths by usual residence divided by registered live births by the mother’s usual residence.',
    caveats: [...VITAL, 'This is not PSA’s infant mortality rate, which is estimated from surveys and is higher.'],
    sources: ['deaths2024', 'births2024'], scale: 'sequential', overall: 'national',
    budgetDept: '13',
    need: { measure: 'births_2024', one: 'registered birth', many: 'registered births' },
    value: (m) => ratio(m.infant_deaths_2024, m.births_2024, 1000),
  },
  {
    id: 'maternal-deaths', theme: 'health', title: 'Registered maternal deaths per 100,000 births, 2024', short: 'Maternal deaths', unit: 'per-100k', decimals: 0, year: '2024',
    plain: 'Women who died from pregnancy or childbirth, for every 100,000 live births, both as registered in 2024.',
    how: 'Registered maternal deaths by usual residence divided by registered live births by the mother’s usual residence.',
    caveats: [...VITAL, 'Small numbers: one or two deaths move a small province’s figure a lot.'],
    sources: ['deaths2024', 'births2024'], scale: 'sequential', overall: 'national',
    budgetDept: '13',
    need: { measure: 'births_2024', one: 'registered birth', many: 'registered births' },
    value: (m) => ratio(m.maternal_deaths_2024, m.births_2024, 100000),
  },
  // ---- local government ----
  {
    id: 'nta-per-person', theme: 'local', title: 'National Tax Allotment to the provincial government, per person, 2024', short: 'Provincial NTA per person', unit: 'peso', decimals: 0, year: '2024',
    plain: 'The share of national taxes passed on to the provincial government in 2024, per person. The formula weighs population, land area and an equal share for every province.',
    how: 'PSA’s Philippine Statistical Yearbook table of the NTA by province, divided by the 2024 population.',
    caveats: [
      'Only the provincial government’s share. Cities, towns and barangays receive their own NTA, which is not in this table.',
      'Metro Manila has no provincial government, so it has no figure here. Isabela City is not listed.',
      'PSA labels the table “in million PhP”, but its figures are in pesos.',
    ],
    sources: ['nta', 'census2024_pop'], scale: 'sequential', overall: 'covered', sums: ['nta_province_2024', 'population_2024'],
    budgetDept: 'all',
    value: (m) => ratio(m.nta_province_2024, m.population_2024),
  },
  // ---- national budget (ours) ----
  {
    id: 'dpwh-contracts-per-person', theme: 'budget', title: 'DPWH contract budget per person, 2018–2025', short: 'DPWH contracts per person', unit: 'peso', decimals: 0, year: '2018–2025',
    plain: 'The budget of DPWH contracts for 2018 to 2025 that we can place in the area, per person.',
    how: 'Each contract is placed by its GPS point inside the province outline, checked against the region DPWH printed for it; contracts without a usable point go to their district engineering office’s province. Divided by the 2024 population.',
    caveats: [
      'About 4% of the budget can’t be placed (mostly regional and Central Office contracts without GPS).',
      'The BARMM provinces have their own public works ministry, and Sulu was in BARMM until 2024, so DPWH builds little there.',
      'Small provinces with large land areas get much more per person; this follows size more than need.',
    ],
    sources: ['dpwh_contracts', 'census2024_pop'], scale: 'sequential', overall: 'covered', sums: ['dpwh_contracts_2018_2025', 'population_2024'],
    value: (m) => ratio(m.dpwh_contracts_2018_2025, m.population_2024),
  },
  {
    id: 'dpwh-house-per-person', theme: 'budget', title: 'DPWH projects in the 2027 House bill, per person', short: 'House bill DPWH per person', unit: 'peso', decimals: 0, year: '2027',
    plain: 'The budget for DPWH projects in the 2027 House bill that the documents place in the area, per person.',
    how: 'The same placements as the House bill’s “projects placed in each district” view: a project counts where its title names a place, or with a district office that serves one district. Districts are added up to their province.',
    caveats: [
      '₱466.7 billion of the ₱587.1 billion in House bill DPWH projects is placed this way; projects left with a shared office or a whole region are not counted.',
      'A placement is where the documents put the work, not who asked for it.',
    ],
    sources: ['hgab_locations', 'census2024_pop'], scale: 'sequential', overall: 'covered', sums: ['dpwh_house_2027_placed', 'population_2024'],
    value: (m) => ratio(m.dpwh_house_2027_placed, m.population_2024),
  },
  {
    id: 'dpwh-house-change-per-person', theme: 'budget', title: 'House change to DPWH projects, per person, 2027', short: 'House change per person', unit: 'peso', decimals: 0, year: '2027',
    plain: 'How much the House bill moved DPWH project budget into or out of the area compared with the NEP, per person.',
    how: 'The placed House bill amount minus the placed NEP amount, on the same placements, divided by the 2024 population.',
    caveats: [
      'Placements cover about 80% of the projects; the rest are not counted on either side.',
      'A placement is where the documents put the work, not who asked for it.',
    ],
    sources: ['hgab_locations', 'census2024_pop'], scale: 'diverging', overall: 'covered', sums: ['dpwh_house_2027_placed', 'dpwh_nep_2027_placed', 'population_2024'],
    value: (m) => {
      const h = num(m.dpwh_house_2027_placed), n = num(m.dpwh_nep_2027_placed), p = num(m.population_2024);
      return h == null || n == null || !p ? null : (h - n) / p;
    },
  },
];

export const INDICATOR_BY_ID = new Map(INDICATORS.map((d) => [d.id, d]));

/**
 * Adding up areas into a region: counts and pesos are summed; a published rate is averaged with this weight
 * (a count measure, or a function of the area's measures). Used by the builder only.
 */
export const RATE_WEIGHTS: Record<string, string | ((m: Measures) => number | null)> = {
  poverty_incidence_2018: 'population_2024', poverty_incidence_2021: 'population_2024', poverty_incidence_2023: 'population_2024',
  poverty_gap_2023: 'population_2024', income_gap_2023: 'population_2024', poverty_severity_2023: 'population_2024',
  avg_family_income_2023: 'families_2023',
  gdp_per_person_2025: (m) => ratio(m.gdp_2025, m.gdp_per_person_2025),
  gdp_per_person_2023: (m) => ratio(m.gdp_2023, m.gdp_per_person_2023),
};

// ---------------------------------------------------------------------------
// The built file
// ---------------------------------------------------------------------------

export interface IndicatorSource {
  key: SourceKey;
  title: string;
  /** Where the reader can check it: the statistics site's dataset page, or our own page. */
  url: string;
  /** The publisher's page (PSA OpenSTAT), when there is one. */
  publisher_url: string | null;
  publisher: string;
  /** Release or retrieval information, as published. */
  as_of: string | null;
}

export interface IndicatorArea {
  id: string;
  name: string;
  region: string;
  /** PSGC codes of the province outlines this area covers (data/hgab/2027/geo/provinces.json). */
  psgc: number[];
  /** BARMM provinces, and Sulu (in BARMM until 2024). */
  barmm_period: boolean;
  /** READER-FACING. Notes about this area's figures. */
  notes: string[];
}

export interface IndicatorValues {
  id: string;
  /** One value per area id; null when the source has no figure for it. */
  values: Record<string, number | null>;
  /** Poverty incidence only: PSA's coefficient of variation per area. */
  cv?: Record<string, number | null>;
  overall: { value: number | null; label: string };
  coverage: { areas: number; population_share: number };
}

export interface IndicatorsFile {
  schema: 1;
  built_at: string;
  source_commit: string | null;
  areas: IndicatorArea[];
  indicators: IndicatorValues[];
  sources: IndicatorSource[];
  /** READER-FACING. */
  notes: string[];
  /** The download: one row per area, one column per indicator. Link it with `?v=<sha256[:12]>`. */
  csv: { path: string; bytes: number; sha256: string };
}

// ---------------------------------------------------------------------------
// Helpers shared by the pages
// ---------------------------------------------------------------------------

export function indicatorPath(id?: string): string {
  return id ? `${INDICATORS_ROOT}/${id}` : INDICATORS_ROOT;
}

export function areaPath(id: string): string {
  return `${INDICATORS_ROOT}/places/${id}`;
}

/** Rank 1 = highest value. Ties share a rank. */
export function ranks(values: Record<string, number | null>): Map<string, number> {
  const sorted = Object.entries(values).filter((e): e is [string, number] => e[1] != null).sort((a, b) => b[1] - a[1]);
  const out = new Map<string, number>();
  sorted.forEach(([id, v], i) => out.set(id, i > 0 && v === sorted[i - 1][1] ? out.get(sorted[i - 1][0])! : i + 1));
  return out;
}

export function formatIndicator(v: number | null | undefined, def: Pick<IndicatorDef, 'unit' | 'decimals'>, opts: { compact?: boolean } = {}): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const n = (x: number, d = def.decimals) => x.toLocaleString('en-PH', { minimumFractionDigits: d, maximumFractionDigits: d });
  switch (def.unit) {
    case 'count':
      if (opts.compact && Math.abs(v) >= 1e6) return `${n(v / 1e6, 2)} million`;
      return n(v, 0);
    case 'percent': return `${n(v)}%`;
    case 'pp': return `${v > 0 ? '+' : v < 0 ? '−' : ''}${n(Math.abs(v))} pts`;
    case 'peso': {
      const sign = v < 0 ? '−' : '';
      if (opts.compact && Math.abs(v) >= 1e6) return `${sign}₱${n(Math.abs(v) / 1e6, 1)}M`;
      return `${sign}₱${n(Math.abs(v), 0)}`;
    }
    case 'per-1000': return n(v);
    case 'per-100k': return n(v);
    case 'per-km2': return n(v);
    case 'per-100': return n(v);
    case 'tonnes-per-ha': return `${n(v)} t`;
  }
}

/** A signed peso figure for diverging budget indicators ("+₱1,234", "−₱56"). */
export function formatSigned(v: number | null | undefined, def: Pick<IndicatorDef, 'unit' | 'decimals'>): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (def.unit === 'pp') return formatIndicator(v, def);
  const body = formatIndicator(Math.abs(v), def);
  return v > 0 ? `+${body}` : v < 0 ? `−${body}` : body;
}

export const UNIT_WORDS: Record<Unit, string> = {
  count: 'people', percent: 'percent', pp: 'percentage points', peso: 'pesos', 'per-1000': 'per 1,000',
  'per-100k': 'per 100,000', 'per-km2': 'people per km²', 'tonnes-per-ha': 'tonnes per hectare', 'per-100': 'per 100 working-age people',
};
