/**
 * Each Congress's representative and party on today's 254 legislative districts, for the side-by-side pages'
 * party-by-year grids (`npm run build:hgab-congress-seats` → data/hgab/2027/parties/congress-seats.json).
 *
 * Jason (2026-11-06): "map the charts based on their political party for that year". His choices: a budget carries the
 * party of the representative in the Congress that passed it (FY N's GAA is passed in year N−1); a district whose towns
 * changed since that election is kept apart, never guessed.
 *
 * Pure: no runtime imports, safe in scripts and the Worker.
 */

export const CONGRESS_SEATS_PATH = 'hgab/2027/parties/congress-seats.json';
export const CONGRESS_SEATS_CSV_PATH = 'hgab/2027/parties/congress-seats.csv';
export const CONGRESS_SEATS_CSV_NAME = 'bettergov-house-seats-by-congress-2013-2025.csv';
/**
 * The page that shows every seat and how it was read (Jason, 2026-11-06: "We need the data exposed on how we mapped the
 * parties. This is risky so it requires transparency. It could be a different page linked via sources").
 */
export const PARTY_DATA_ROOT = '/hgab/2027/parties/by-congress';
export const PARTY_DATA_TITLE = 'How we read parties';

/** A Congress, the election that seated it, and the budgets it passed (the 20th: the FY2026 GAA and the 2027 NEP and House bill). */
export interface CongressTerm { year: number; congress: number; label: string; budget_years: readonly number[] }

export const CONGRESS_TERMS: readonly CongressTerm[] = [
  { year: 2013, congress: 16, label: '16th Congress', budget_years: [2015, 2016] },
  { year: 2016, congress: 17, label: '17th Congress', budget_years: [2017, 2018, 2019] },
  { year: 2019, congress: 18, label: '18th Congress', budget_years: [2020, 2021, 2022] },
  { year: 2022, congress: 19, label: '19th Congress', budget_years: [2023, 2024, 2025] },
  { year: 2025, congress: 20, label: '20th Congress', budget_years: [2026, 2027] },
];

/**
 * A party's code as the results print it, where one year spells it differently from the rest ("LAKAS-CMD" in 2016,
 * "LAKAS" in every other year). Joint tickets ("NUP/PPP") and local chapters are kept as printed.
 */
export const PARTY_CODE_ALIASES: Readonly<Record<string, string>> = { 'LAKAS-CMD': 'LAKAS' };

/** The Congress that passed a budget year's GAA (2027: the one that takes up the NEP and passes the House bill). */
export const termOfYear = (fy: number): CongressTerm | undefined => CONGRESS_TERMS.find((t) => t.budget_years.includes(fy));

/**
 * A district in one Congress: [party, representative, territory, race, person id, province slug, party as printed,
 * note]. `party` is the one the winner ran under (null: none on record, or a two-seat race whose winners ran under
 * different parties), read through PARTY_CODE_ALIASES; `printed` is the code as the results print it when it differs.
 * `territory`: `same` when the race had the same towns as the district's 2025 race, else `changed` (kept apart).
 * `race` and `person` are BetterGov Dynasties ids (dynastyContestApi, dynastyPersonUrl). A district with no race that
 * year (created since, or listed only as a total) is absent. The first three are what the grids read.
 */
export type CongressSeat = [
  party: string | null, person: string | null, territory: 'same' | 'changed',
  race?: string | null, personId?: string | null, provinceSlug?: string | null, printed?: string | null, note?: string | null,
];

/** congress-seats.csv, column by column (the builder's CSV columns, in order; verify:hgab checks the header). */
export const CONGRESS_SEATS_CSV_FIELDS: ReadonlyArray<{ name: string; about: string }> = [
  { name: 'congress', about: 'The Congress: 16 to 20.' },
  { name: 'election_year', about: 'The May election that seated it.' },
  { name: 'budget_years', about: 'The budgets that Congress passed, as the party grids read them.' },
  { name: 'district_id', about: 'Today’s legislative district’s id on this site.' },
  { name: 'district', about: 'Today’s legislative district.' },
  { name: 'region', about: 'Its region.' },
  { name: 'towns', about: 'same (the race had the district’s 2025 towns), changed (kept apart), or no_race (none on record that year).' },
  { name: 'representative', about: 'The winner, as the results name them (the 20th Congress: the House directory’s member).' },
  { name: 'party', about: 'The party code the grids use; blank when none.' },
  { name: 'party_as_printed', about: 'The code as the results print it, when it differs (LAKAS-CMD in 2016).' },
  { name: 'party_name', about: 'The party’s name as we read the code; the code itself when we do not expand it.' },
  { name: 'race_id', about: 'The race in BetterGov Dynasties.' },
  { name: 'race_api', about: 'That race, every candidate and vote, in the Dynasties API.' },
  { name: 'person_url', about: 'The winner’s election history on the Dynasties site.' },
  { name: 'note', about: 'How a seat was read when not simply “won the race” (20th Congress), or why it has no party.' },
];

export interface CongressSeatsFile {
  schema: 1;
  built_at: string;
  /** The election data and how to cite it (parties.json's source, with this file's note). */
  source: {
    name: string; citation?: string; url: string; via: string; site?: string; api?: string; developers?: string;
    data_vintage?: string; license?: string; note: string;
  };
  /** Today's districts: [id, label, region]. */
  districts?: Array<[string, string, string | null]>;
  aliases?: Record<string, string>;
  outputs?: Record<'congress-seats.csv', { sha256: string; bytes: number }>;
  terms: Array<CongressTerm & {
    seats: Record<string, CongressSeat>;
    counts: { same: number; changed: number; absent: number; no_party: number };
  }>;
}
