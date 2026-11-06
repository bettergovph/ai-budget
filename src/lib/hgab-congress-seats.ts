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
 * A district in one Congress: [party, representative, territory]. `party` is the one the winner ran under (null: none
 * on record, or a two-seat race whose winners ran under different parties). `territory`: `same` when the race had
 * the same towns as the district's 2025 race, else `changed` (kept apart). A district with no race that year
 * (created since) is absent.
 */
export type CongressSeat = [party: string | null, person: string | null, territory: 'same' | 'changed'];

export interface CongressSeatsFile {
  schema: 1;
  built_at: string;
  source: { name: string; url: string; via: string; note: string };
  terms: Array<CongressTerm & {
    seats: Record<string, CongressSeat>;
    counts: { same: number; changed: number; absent: number; no_party: number };
  }>;
}
