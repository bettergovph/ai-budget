/**
 * The House bill by party (`/hgab/2027/parties`, Districts menu → By party): each legislative district's
 * representative, the party they ran under in the May 2025 election, and the DPWH budget at the offices serving
 * those districts. The same for the 18th and 19th Congresses, from the 2019 and 2022 elections, with the enacted
 * budgets (GAA) those Congresses passed.
 *
 * Jason (2026-11-03): "For our House insertions, I want to map the current political party … determine the budget
 * allocations based on the currently elected officials. But also get ready for past electoral years."
 *
 * Data: `parties/parties.json` (npm run build:hgab-parties; scripts/build-hgab-parties.ts). Parties come from Open
 * Halalan's election results as BetterGov Dynasties publishes them (dynasties.bettergov.ph, officials.bettergov.ph);
 * the seat holders are the House directory already on the district pages. The money side is leaderboard.json's office
 * groups, unchanged: a shared office's figure is never divided, and the Central Office's lines stay with no party.
 * Pure: the page, the builder, the verifier and the Worker's SEO code import it.
 */

const BASE = 'hgab/2027/parties';
export const PARTIES_SCHEMA = 1 as const;
export const PARTIES_ROOT = '/hgab/2027/parties';
export const PARTIES_TITLE = 'By party';
export const PARTIES_DATA_PATH = `${BASE}/parties.json`;
export const PARTIES_CSV_NAME = 'bettergov-house-bill-2027-seats-by-party.csv';

/** BetterGov Dynasties: the site, its API, and the election source it publishes. */
export const DYNASTIES_SITE = 'https://dynasties.bettergov.ph';
export const DYNASTIES_API = 'https://officials.bettergov.ph/api/v1';
export const DYNASTIES_DEVELOPERS = `${DYNASTIES_SITE}/developers`;
export const OPEN_HALALAN_URL = 'https://robertrleung.github.io/OpenHalalan/';
/** One person's election history on the Dynasties site. */
export const dynastyPersonUrl = (provinceSlug: string, personId: string) => `${DYNASTIES_SITE}/person/${provinceSlug}/${personId}`;
/** One race, every candidate, in the Dynasties API. */
export const dynastyContestApi = (contestId: string) => `${DYNASTIES_API}/contests/${encodeURIComponent(contestId)}`;

/** The elections and the Congress each one seated, with the enacted budgets that Congress passed. */
export interface ElectionTerm { year: number; congress: number; label: string; gaa_years: readonly number[] }
export const ELECTION_TERMS: readonly ElectionTerm[] = [
  { year: 2019, congress: 18, label: '18th Congress', gaa_years: [2020, 2021, 2022] },
  { year: 2022, congress: 19, label: '19th Congress', gaa_years: [2023, 2024, 2025] },
  { year: 2025, congress: 20, label: '20th Congress', gaa_years: [2026] },
];

/**
 * Ballot abbreviations as the election results publish them, with the name we read them as. An abbreviation not here
 * is shown as published: among them the ones local parties in different provinces share (ASENSO is a party in Abra and
 * another in Manila; PPP wins in Palawan and elsewhere), which are counted together under the abbreviation.
 * "IND" is a candidate with no party.
 */
export const PARTY_NAMES: Readonly<Record<string, string>> = {
  LAKAS: 'Lakas–CMD',
  NUP: 'National Unity Party',
  NPC: 'Nationalist People’s Coalition',
  PFP: 'Partido Federal ng Pilipinas',
  NP: 'Nacionalista Party',
  IND: 'Independent',
  LP: 'Liberal Party',
  PDPLBN: 'PDP–Laban',
  AKSYON: 'Aksyon Demokratiko',
  LDP: 'Laban ng Demokratikong Pilipino',
  PMP: 'Pwersa ng Masang Pilipino',
  UNA: 'United Nationalist Alliance',
  PRP: 'People’s Reform Party',
  CDP: 'Centrist Democratic Party',
  HTL: 'Hugpong sa Tawong Lungsod',
  HNP: 'Hugpong ng Pagbabago',
  NVTEÑO: 'Partido Navoteño',
  AZAP: 'Adelante Zamboanga Party',
  MKTZNU: 'Makatizens United Party',
  PDDS: 'Partido Demokratiko Sosyalista ng Pilipinas',
  PDR: 'Partido para sa Demokratikong Reporma',
  BILEG: 'Bileg Ti Ilokano',
  PCM: 'People’s Champ Movement',
  BUP: 'Basilan Unity Party',
  BPP: 'Bukidnon Paglaum Party',
  SZP: 'Sulong Zambales Party',
  PADAYN: 'Padayon Pilipino',
  KABAKA: 'Kabalikat ng Bayan sa Kaunlaran',
};
export const NO_PARTY = 'IND';
/** The names people use for the larger parties, for tight spaces (a seat's earlier parties); otherwise the abbreviation. */
const PARTY_SHORT: Readonly<Record<string, string>> = {
  LAKAS: 'Lakas', NP: 'Nacionalista', PDPLBN: 'PDP–Laban', LP: 'Liberal', IND: 'Independent', AKSYON: 'Aksyon',
};
export const partyShort = (code: string) => PARTY_SHORT[code] ?? code;
/** "Lakas–CMD"; the abbreviation itself when we do not expand it. */
export const partyName = (code: string) => PARTY_NAMES[code] ?? code;
/** "Lakas–CMD (LAKAS)" where the two differ, for tooltips and CSV. */
export const partyFull = (code: string) => (PARTY_NAMES[code] && PARTY_NAMES[code] !== code ? `${PARTY_NAMES[code]} (${code})` : code);

// ---------------------------------------------------------------------------
// Data contract (data/hgab/2027/parties/parties.json)
// ---------------------------------------------------------------------------

/**
 * How a seat's party was read, for the representative the House lists:
 *   winner            they won the seat in the May 2025 results;
 *   top_votes         the results list no winner for the race; they had the most votes;
 *   seated_other      the results put another candidate first; the House seats them, and their own 2025 ballot party is used;
 *   two_listed        the House lists two names; one ran for the seat in May 2025, and that party is used;
 *   special_election  they won a later special election, which the results do not cover: the party is the one that
 *                     election's reports name, with the source in `note_source`;
 *   not_in_results    no 2025 candidacy for the seat is theirs: no party.
 */
export type PartyBasis = 'winner' | 'top_votes' | 'seated_other' | 'two_listed' | 'special_election' | 'not_in_results';

/** The 20th Congress: one row per legislative district (254). */
export interface Seat {
  district_id: string;
  /** "Abra, Lone District" */
  label: string;
  jurisdiction: string;
  district_label: string;
  /** RegionKey, as leaderboard.json. */
  region: string;
  /** The representative the House directory lists ("Bernos, JB"); two names joined by " / " where it lists two. */
  holder: string | null;
  holder_status: 'resolved' | 'ambiguous' | 'missing';
  /** House leadership the directory lists for them ("Speaker of the House"). */
  roles: string[];
  /** Ballot abbreviation as published ("LAKAS"); null when no 2025 candidacy for the seat is the representative's. */
  party: string | null;
  basis: PartyBasis;
  /** One plain sentence where the basis is not `winner`, or the race was unusual. */
  note: string | null;
  /** Where the note's facts come from, when they are not in the election results (news of a ruling or a special election). */
  note_source: string | null;
  /** The 2025 candidacy read: the person on BetterGov Dynasties and their result. */
  person_id: string | null;
  /** Name as the results publish it ("JB NIÑO BERNOS"). */
  person_name: string | null;
  /** Province slug of the race, for the Dynasties person page. */
  province_slug: string | null;
  contest_id: string | null;
  votes: number | null;
  /** Share of all votes in the race (0–1). */
  share: number | null;
  /** Votes over the runner-up, for a winner; null otherwise. */
  margin: number | null;
  uncontested: boolean;
  candidates: number | null;
  /** The leaderboard office group serving the district (leaderboard.json `key`); null for the districts with no office. */
  unit: string | null;
  tier: 'A' | 'B' | null;
}

/** A seat won in one election (2019, 2022, 2025), as the results publish it. */
export interface ElectionSeat {
  contest_id: string;
  /** "Abra, Lone District" (from the race's place and district). */
  label: string;
  /** Our 20th Congress districts with that name (two for Taguig's single two-seat race); empty when none has it. */
  district_ids: string[];
  /** Whether the race's towns are the 2025 race's (town renames aside); null when no 2025 district has the name. */
  territory: 'same' | 'changed' | null;
  party: string;
  person_id: string;
  person_name: string;
  province_slug: string;
  votes: number | null;
  share: number | null;
  margin: number | null;
  uncontested: boolean;
  /** The results have no winner row for the race; the top candidates by votes are taken as the winners. */
  inferred: boolean;
}

export interface Election {
  year: number;
  congress: number;
  label: string;
  gaa_years: number[];
  seats: ElectionSeat[];
  /** Seats won by each party, largest first. */
  party_seats: Array<[string, number]>;
}

/** FY2027 figures of a set of office groups (leaderboard.json LeaderSlice, plus the FY2026 enacted budget). */
export interface PartySlice {
  /** Office groups (leaderboard units). */
  units: number;
  nep_php: number;
  hgab3_php: number;
  added_php: number;
  added_rows: number;
  held_php: number;
  held_rows: number;
  dropped_php: number;
  dropped_rows: number;
  /** FY2026 enacted budget (whole office, as listed) at the same offices; null when none lists one. */
  gaa2026_php: number | null;
}

/** One party's row: its seats, and the offices that serve only its districts (alone or shared among its members). */
export interface PartyRow extends PartySlice {
  party: string;
  /** Seats the party holds (all 254 districts, including those with no DPWH office). */
  seats: number;
  /** Of those, seats whose office serves only this party's districts: the seats the figures cover. */
  seats_counted: number;
  /** One office, one district (tier A): the seats, and their added budget, for the average. */
  seats_a: number;
  added_php_a: number;
}

/** An office group serving districts of more than one party: its figure stays whole, with every party named. */
export interface SharedUnit {
  key: string;
  offices: Array<{ id: string; name: string }>;
  districts: Array<{ district_id: string; label: string; party: string | null }>;
  parties: string[];
  nep_php: number;
  hgab3_php: number;
  added_php: number;
  added_rows: number;
  dropped_php: number;
  gaa2026_php: number | null;
}

/** A DPWH office group as leaderboard.json has it, with only what this page shows. */
export interface PartyUnit {
  key: string;
  tier: 'A' | 'B';
  offices: Array<{ id: string; name: string }>;
  district_ids: string[];
  nep_php: number | null;
  hgab3_php: number | null;
  delta_php: number | null;
  added_php: number;
  added_rows: number;
  held_php: number;
  dropped_php: number;
  gaa2026_php: number | null;
}

export interface Fy2027ByParty {
  rows: PartyRow[];
  /** Office groups whose districts' representatives ran under different parties. */
  shared: PartySlice & { seats: number };
  shared_units: SharedUnit[];
  /** Office groups with a district whose representative has no party in the results. */
  unknown: PartySlice & { seats: number };
  /** Seats with no DPWH office (served by the BARMM regional grouping): no figures. */
  no_office_seats: number;
  /** All district offices (leaderboard deo slice), and the whole DPWH compared population. */
  deo: Omit<PartySlice, 'units' | 'gaa2026_php'>;
  all: Omit<PartySlice, 'units' | 'gaa2026_php'>;
  /** Lines with no district office: Central Office, regional offices, office changes, no office. */
  residual: Omit<PartySlice, 'units' | 'gaa2026_php'>;
  central: Omit<PartySlice, 'units' | 'gaa2026_php'>;
}

/** One Congress's enacted budgets at the offices serving each party's districts, as the seats stood after its election. */
export interface CongressByParty {
  congress: number;
  election: number;
  label: string;
  years: number[];
  rows: Array<{ party: string; seats: number; units: number; gaa_php: number }>;
  /** Office groups whose districts were won by different parties. */
  shared: { units: number; gaa_php: number };
  /**
   * Office groups not read for this Congress: a district had other towns or no seat then, the race is missing from the
   * results, or an office was created or renamed since 2020 (its earlier budget sits under another name).
   */
  not_comparable: { units: number; gaa_php: number };
  /** Every district office in these years (whole office, as listed), and what no district office carries. */
  deo_php: number;
  other_php: number;
  total_php: number;
}

export interface PartiesData {
  schema: typeof PARTIES_SCHEMA;
  built_at: string;
  /** SHA-256 of each input: districts.json, leaderboard.json, and the elections database. */
  inputs: Record<'districts' | 'leaderboard' | 'elections', string>;
  source: {
    name: string;
    citation: string;
    url: string;
    via: string;
    site: string;
    api: string;
    developers: string;
    data_vintage: string;
    license: string;
    seat_holders: string;
  };
  /** Every ballot abbreviation in the file → the name we read it as (null where we do not expand it). */
  parties: Record<string, string | null>;
  seats: Seat[];
  /** The office groups the seats point to (Seat `unit`). */
  units: PartyUnit[];
  elections: Election[];
  fy2027: Fy2027ByParty;
  congresses: CongressByParty[];
  notes: string[];
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** What "party" means on this page: said under every table that shows one. */
export const PARTY_MEANING =
  'Party is the one each representative ran under in the May 2025 election, as the results publish it. Members may have changed party since.';
/** What a party's figure is. */
export const PARTY_FIGURE_NOTE =
  'A party’s figure adds the DPWH offices that serve only its members’ districts. An office shared across parties is never divided.';
/** Why the largest part has no party. */
export const CENTRAL_NOTE =
  'Lines under the DPWH Central Office name no district office, so no party can be read from them.';
export const BASIS_LABELS: Record<PartyBasis, string> = {
  winner: 'Won the seat in May 2025',
  top_votes: 'Most votes in May 2025 (the results list no winner)',
  seated_other: 'Seated by the House; the results put another candidate first',
  two_listed: 'The House lists two names; one ran in May 2025',
  special_election: 'Won a later special election',
  not_in_results: 'Not in the May 2025 results',
};

/** One seat's 2025 result in a few words: "62.3% · won by 41,200", "Unopposed". */
export function resultText(s: Pick<Seat, 'share' | 'margin' | 'uncontested' | 'basis'>): string {
  if (s.basis === 'not_in_results' || s.basis === 'special_election') return '—';
  if (s.uncontested) return 'Unopposed';
  const share = s.share == null ? null : `${(s.share * 100).toFixed(1)}%`;
  const margin = s.margin == null ? null : `won by ${s.margin.toLocaleString('en-US')}`;
  return [share, margin].filter(Boolean).join(' · ') || '—';
}

/**
 * The party each earlier election gave a district's seat, where a district of that name had the same towns as in 2025
 * (`changed`: it had other towns then). A two-seat race (Taguig) gives a party only when both winners share it.
 */
export function seatHistory(data: Pick<PartiesData, 'elections'>, districtId: string): Array<{ year: number; party: string | null; changed: boolean }> {
  return data.elections.filter((e) => e.year < 2025).map((e) => {
    const won = e.seats.filter((s) => s.district_ids.includes(districtId));
    const parties = new Set(won.map((s) => s.party));
    return { year: e.year, party: parties.size === 1 ? won[0].party : null, changed: won.some((s) => s.territory === 'changed') };
  });
}

/** Mean added budget per one-office district (tier A), or null when the party has none. */
export const addedPerSeatA = (r: Pick<PartyRow, 'seats_a' | 'added_php_a'>) => (r.seats_a ? r.added_php_a / r.seats_a : null);

const csvCell = (v: string | number | boolean | null | undefined) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Every seat with its party and its office's FY2027 figures, as CSV. A shared office's figures repeat on each of its
 * districts (the `office_districts` column says how many share them): never add them up across rows.
 */
export function seatsCsv(data: Pick<PartiesData, 'seats' | 'units'>): string {
  const units = new Map(data.units.map((u) => [u.key, u]));
  const head = [
    'district_id', 'district', 'region', 'representative', 'house_roles', 'party', 'party_name', 'party_basis', 'note', 'note_source',
    'votes_2025', 'vote_share_2025', 'margin_2025', 'unopposed_2025', 'dynasties_person_url', 'dynasties_contest_api', 'dpwh_offices',
    'office_tier', 'office_districts', 'office_nep_php', 'office_house_bill_php', 'office_added_php', 'office_added_lines',
    'office_dropped_php', 'office_gaa2026_php',
  ];
  const rows = data.seats.map((s) => {
    const u = s.unit ? units.get(s.unit) : undefined;
    return [
      s.district_id, s.label, s.region, s.holder, s.roles.join('; '), s.party, s.party ? partyName(s.party) : null, s.basis, s.note,
      s.note_source, s.votes, s.share == null ? null : s.share.toFixed(4), s.margin, s.uncontested,
      s.person_id && s.province_slug ? dynastyPersonUrl(s.province_slug, s.person_id) : null,
      s.contest_id ? dynastyContestApi(s.contest_id) : null, u ? u.offices.map((o) => o.name).join('; ') : null, s.tier,
      u ? u.district_ids.length : null, u?.nep_php ?? null, u?.hgab3_php ?? null, u?.added_php ?? null, u?.added_rows ?? null,
      u?.dropped_php ?? null, u?.gaa2026_php ?? null,
    ].map(csvCell).join(',');
  });
  return [head.join(','), ...rows].join('\n');
}
