/**
 * npm run build:hgab-parties: the House bill by party (data/hgab/2027/parties/parties.json; contract in
 * src/lib/hgab-parties.ts, page /hgab/2027/parties).
 *
 * Jason (2026-11-03): map each House insertion to the party of the district's representative, from BetterGov
 * Dynasties (~/projects/dynasty, the data behind dynasties.bettergov.ph and officials.bettergov.ph), and get ready for
 * earlier elections.
 *
 * Inputs, all read-only:
 *   districts.json    the 254 districts and the representative the House directory lists for each (the site's own)
 *   leaderboard.json  the DPWH office groups with their FY2027 and FY2020–2026 figures, unchanged
 *   dynasty.sqlite    Open Halalan's 2001–2025 results as BetterGov Dynasties builds them (equal to its live API)
 *
 * What is ours: the join from a legislative district to its race (province or city, and district number), and from
 * the representative to their candidacy (surname, then first name). Every seat whose party is not simply "won the
 * seat in May 2025" carries a note, and the few that rest on facts outside the results carry a source.
 *
 *   --data=data/hgab/2027   --out=<data>/parties   --elections=~/projects/dynasty/data/dynasty.sqlite
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { displayName, type LeaderEntry, type LeaderboardData, type LeaderSlice } from "../src/lib/hgab-leaderboard";
import {
  DYNASTIES_API, DYNASTIES_DEVELOPERS, DYNASTIES_SITE, ELECTION_TERMS, OPEN_HALALAN_URL, PARTIES_SCHEMA, PARTY_NAMES, partyName,
  type CongressByParty, type Election, type ElectionSeat, type Fy2027ByParty, type PartiesData, type PartyBasis, type PartyRow,
  type PartySlice, type Seat, type SharedUnit,
} from "../src/lib/hgab-parties";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const ROOT = resolve(arg("data", "data/hgab/2027"));
const OUT = resolve(arg("out", `${ROOT}/parties`));
const INPUTS = {
  districts: resolve(ROOT, "districts.json"),
  leaderboard: resolve(ROOT, "leaderboard.json"),
  elections: resolve(arg("elections", resolve(homedir(), "projects/dynasty/data/dynasty.sqlite"))),
};
const HOUSE = "MEMBER, HOUSE OF REPRESENTATIVES";

interface Rep { name: string | null; status: string; leadership_roles?: string[]; candidates?: Array<{ name: string | null; leadership_roles?: string[] }> }
interface DistrictsFile {
  representatives_source: { url: string; congress: number; fetched_at: string; notice: string };
  crosswalk: { build_date: string };
  districts: Array<{ id: string; label: string; jurisdiction: string; district_label: string; region: string | null; representative: Rep | null }>;
}

const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const peso = (n: number) => `₱${(n / 1e9).toFixed(2)}B`;

/** BetterGov Dynasties' own name key (scripts/lib/names.ts `key`): upper case, no accents, Ñ → N, words only. */
const key = (s: string | null | undefined) =>
  (s ?? "").normalize("NFC").toUpperCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/Ñ/g, "N")
    .replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string | null | undefined, min = 3) => key(s).split(" ").filter((t) => t.length >= min);
const SMALL = new Set(["de", "del", "dela", "la", "las", "los", "ng", "sa", "y"]);
const titleCase = (s: string) => s.toLowerCase().split(/(\s+|-)/).map((w, i) => (i && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("");

// ---------------------------------------------------------------------------
// A legislative district ↔ its race
// ---------------------------------------------------------------------------

const ORDINALS: Record<string, string> = {
  lone: "LONE", "1st": "FIRST", "2nd": "SECOND", "3rd": "THIRD", "4th": "FOURTH", "5th": "FIFTH", "6th": "SIXTH", "7th": "SEVENTH", "8th": "EIGHTH",
};
const ORDINAL_LABEL: Record<string, string> = Object.fromEntries(Object.entries(ORDINALS).map(([k, v]) => [v, k === "lone" ? "Lone District" : `${k} District`]));
/** Our names that the results spell another way. */
const CITY_ALIASES: Record<string, string> = { "STA ROSA": "SANTA ROSA" };
const PROVINCE_ALIASES: Record<string, string> = { "NORTH COTABATO": "COTABATO" };
/** Taguig's two districts are one two-seat race in the results (its winners are inferred from votes). */
const TAGUIG = new Set(["leg:taguig-city-pateros:lone", "leg:taguig-city:2nd"]);

function seatKeyOf(d: DistrictsFile["districts"][number]): string {
  if (TAGUIG.has(d.id)) return "C:TAGUIG|LONE";
  const ord = ORDINALS[d.id.split(":").pop() ?? ""];
  if (!ord) throw new Error(`no district number in ${d.id}`);
  if (/\bCity\b/.test(d.jurisdiction)) {
    const j = key(d.jurisdiction.replace(/^City of\s+/i, "").replace(/\s+City$/i, ""));
    return `C:${CITY_ALIASES[j] ?? j}|${ord}`;
  }
  const j = key(d.jurisdiction);
  return `P:${PROVINCE_ALIASES[j] ?? j}|${ord}`;
}

interface Contest {
  id: string; year: number; district: string; seats: number; candidates: number; total_votes: number | null; margin: number | null;
  uncontested: number; province: string; province_slug: string; city: string | null; city_slug: string | null;
}
interface Cand {
  contest_id: string; person_id: string; display_name: string; last_name: string; first_name: string; party: string;
  votes: number | null; won: number; link: string;
}

const db = new DatabaseSync(INPUTS.elections, { readOnly: true });
const contestsOf = (year: number) => db.prepare(`
  select ct.id, ct.year, ct.district, ct.seats, ct.candidates, ct.total_votes, ct.margin, ct.uncontested,
         p.name as province, p.slug as province_slug, ci.name as city, ci.slug as city_slug
  from contests ct join provinces p on p.id = ct.province_id left join cities ci on ci.id = ct.city_id
  where ct.year = ? and ct.position = ? and ct.district != '' order by ct.id`).all(year, HOUSE) as unknown as Contest[];
const candsOf = (year: number) => db.prepare(`
  select c.contest_id, c.person_id, p.display_name, p.last_name, p.first_name, c.party, c.votes, c.won, c.link
  from candidacies c join persons p on p.id = c.person_id
  where c.year = ? and c.position = ? order by c.contest_id, c.won desc, coalesce(c.votes, -1) desc, c.id`).all(year, HOUSE) as unknown as Cand[];
const townsStmt = db.prepare(`select ci.name from district_towns dt join cities ci on ci.id = dt.city_id where dt.contest_id = ? order by ci.name`);
const townsOf = (contestId: string) => (townsStmt.all(contestId) as Array<{ name: string }>).map((r) => key(r.name));
const contestKey = (c: Contest) => `${c.city ? `C:${key(c.city)}` : `P:${key(c.province)}`}|${c.district}`;
const vintage = (db.prepare(`select max(year) as y from contests`).get() as { y: number }).y;

/**
 * Two races have the same towns when each town has its counterpart in the other and the counts agree. A counterpart
 * is the same name, or one name inside the other ("SANTO DOMINGO" / "SANTO DOMINGO LIBOG": the results add an old
 * name in some years), or half the words shared. A renamed town counts as a change: that only holds an office out.
 */
function sameTowns(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const words = (s: string) => new Set(s.split(" "));
  const alike = (x: string, y: string) => {
    if (x === y) return true;
    const X = words(x), Y = words(y);
    const shared = [...X].filter((w) => Y.has(w)).length;
    return shared === X.size || shared === Y.size || shared / (X.size + Y.size - shared) >= 0.5;
  };
  return a.every((x) => b.some((y) => alike(x, y))) && b.every((y) => a.some((x) => alike(x, y)));
}

// ---------------------------------------------------------------------------
// The representative ↔ their candidacy
// ---------------------------------------------------------------------------

/** Surname words ("Dy", "Uy" and "Go" included), without the particles many surnames share ("Dela Cruz" → CRUZ). */
const PARTICLES = new Set(["DE", "DEL", "DELA", "DELOS", "DI", "LA", "LAS", "LOS", "SAN", "STA", "STO", "Y"]);
const surnameWords = (s: string | null | undefined) => tokens(s, 2).filter((t) => !PARTICLES.has(t));
/** "Aquino, Jose "Joboy" II S." → surname words, and first-name words (nicknames included). */
function nameParts(name: string): { surname: string[]; first: string[] } {
  const [last, ...rest] = name.split(",");
  return { surname: surnameWords(last), first: tokens(rest.join(" "), 2) };
}
/**
 * The candidate in a race who is this representative. The surname must match. One candidate with the first name too
 * settles it. Where the House lists two people for the seat (`strict`: a family succession shares a surname), nothing
 * else does. Otherwise the only candidate with the surname, or the only winner among several (ballots often carry a
 * nickname: "ADING CRUZ" is Ricardo Cruz Jr.).
 */
function matchCandidate(name: string, cands: Cand[], strict: boolean): Cand | null {
  const n = nameParts(name);
  const bySurname = cands.filter((c) => surnameWords(c.last_name).some((t) => n.surname.includes(t)));
  if (!bySurname.length) return null;
  const firstOk = (c: Cand) => {
    const theirs = new Set([...tokens(c.first_name, 2), ...tokens(c.display_name, 2)]);
    return n.first.some((t) => theirs.has(t));
  };
  const withFirst = bySurname.filter(firstOk);
  if (withFirst.length === 1) return withFirst[0];
  if (strict) return null;
  if (bySurname.length === 1) return bySurname[0];
  const won = bySurname.filter((c) => c.won);
  return won.length === 1 ? won[0] : null;
}

/**
 * Seats whose party rests on facts the results do not hold. Each names its source. Checked by hand on 2026-11-03.
 */
const SEAT_FACTS: Record<string, { match?: string; party?: string; basis?: PartyBasis; note: string; source: string }> = {
  "leg:antipolo-city:2nd": {
    match: "Acop, Philip Conrad",
    party: "NUP",
    basis: "special_election",
    note: "Romeo Acop won the seat in May 2025 and died in December 2025. Philip Conrad Acop won the March 2026 special election for the NUP.",
    source: "https://en.wikipedia.org/wiki/2026_Antipolo%27s_2nd_congressional_district_special_election",
  },
  "leg:manila:6th": {
    note: "COMELEC voided the candidacy of the candidate the count put first and declared this member elected in June 2025.",
    source: "https://en.wikipedia.org/wiki/Benny_Abante",
  },
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const D = readJson<DistrictsFile>(INPUTS.districts);
const L = readJson<LeaderboardData>(INPUTS.leaderboard);
const checks: string[] = [];
const fail = (msg: string): never => { throw new Error(msg); };

const unitOf = new Map<string, LeaderEntry>();
for (const e of L.entries) for (const p of e.people) {
  if (unitOf.has(p.district_id)) fail(`${p.district_id} is in two office groups`);
  unitOf.set(p.district_id, e);
}
const regionKey = (d: DistrictsFile["districts"][number]) =>
  unitOf.get(d.id)?.people.find((p) => p.district_id === d.id)?.region ?? (d.region ?? "").replace(/^Region\s+/, "");
const ourByKey = new Map<string, string[]>();
for (const d of D.districts) ourByKey.set(seatKeyOf(d), [...(ourByKey.get(seatKeyOf(d)) ?? []), d.id]);
const districtById = new Map(D.districts.map((d) => [d.id, d]));

interface Year { contests: Map<string, Contest>; byKey: Map<string, Contest>; cands: Map<string, Cand[]> }
const years = new Map<number, Year>();
for (const t of ELECTION_TERMS) {
  const contests = contestsOf(t.year);
  const byKey = new Map<string, Contest>();
  for (const c of contests) {
    const k = contestKey(c);
    if (byKey.has(k)) fail(`${t.year}: two races read as ${k} (${byKey.get(k)!.id}, ${c.id})`);
    byKey.set(k, c);
  }
  const cands = new Map<string, Cand[]>();
  for (const c of candsOf(t.year)) cands.set(c.contest_id, [...(cands.get(c.contest_id) ?? []), c]);
  years.set(t.year, { contests: new Map(contests.map((c) => [c.id, c])), byKey, cands });
}

// The 20th Congress: the House directory's representative, and the party they ran under for the seat in May 2025.
const Y25 = years.get(2025)!;
const seats: Seat[] = D.districts.map((d) => {
  const contest = Y25.byKey.get(seatKeyOf(d)) ?? fail(`no 2025 race for ${d.id} (${seatKeyOf(d)})`);
  const cands = Y25.cands.get(contest.id) ?? [];
  const rep = d.representative;
  const listed = rep ? (rep.status === "ambiguous" ? (rep.candidates ?? []).map((c) => c.name) : [rep.name]).filter((x): x is string => !!x) : [];
  const holder = rep ? (rep.status === "ambiguous" ? (rep.name || listed.join(" / ")) : rep.name) || null : null;
  const fact = SEAT_FACTS[d.id];
  const strict = rep?.status === "ambiguous";
  let cand: Cand | null = null;
  for (const n of listed) if (!fact?.match || n.startsWith(fact.match)) { cand = matchCandidate(n, cands, strict) ?? cand; if (cand) break; }
  if (fact?.basis === "special_election") cand = null;
  const winners = cands.filter((c) => c.won);
  const top = [...cands].sort((a, b) => (b.votes ?? -1) - (a.votes ?? -1))[0];
  let basis: PartyBasis;
  let note: string | null = fact?.note ?? null;
  if (fact?.basis) basis = fact.basis;
  else if (!cand) { basis = "not_in_results"; note ??= "No candidate in the May 2025 results for this seat is the representative the House lists."; }
  else if (rep?.status === "ambiguous") {
    basis = "two_listed";
    note ??= `The House directory lists two names for this seat. Only one, ${displayName(listed.find((n) => matchCandidate(n, cands, true) === cand))}, ran for it in May 2025.`;
  } else if (cand.won) basis = "winner";
  else if (!winners.length && cand === top) { basis = "top_votes"; note ??= "The results list no winner for this race. This member had the most votes."; }
  else { basis = "seated_other"; note ??= "The May 2025 count in the results puts another candidate first. The House lists this member in the seat."; }
  if (basis === "winner" && cand?.link === "inferred" && contest.seats > 1) note ??= "The results list this city’s two districts as one race; each member is matched to their district by name.";
  const party = fact?.party ?? cand?.party ?? null;
  const unit = unitOf.get(d.id) ?? null;
  return {
    district_id: d.id, label: d.label, jurisdiction: d.jurisdiction, district_label: d.district_label, region: regionKey(d),
    holder, holder_status: (rep ? rep.status : "missing") as Seat["holder_status"],
    roles: [...new Set([...(rep?.leadership_roles ?? []), ...(rep?.candidates ?? []).flatMap((c) => c.leadership_roles ?? [])])],
    party: party || null, basis, note, note_source: fact?.source ?? null,
    person_id: cand?.person_id ?? null, person_name: cand?.display_name ?? null, province_slug: cand ? contest.province_slug : null,
    contest_id: fact?.basis === "special_election" ? null : contest.id,
    votes: cand?.votes ?? null,
    share: cand?.votes != null && contest.total_votes ? cand.votes / contest.total_votes : null,
    margin: cand && cand.won && contest.seats === 1 ? contest.margin : null,
    uncontested: !!cand && contest.uncontested === 1,
    candidates: fact?.basis === "special_election" ? null : contest.candidates,
    unit: unit?.key ?? null, tier: unit?.tier ?? null,
  };
});
const partyOf = new Map(seats.map((s) => [s.district_id, s.party]));
checks.push(`254 seats: ${seats.length}`);
if (seats.length !== D.districts.length) fail("seat count");

// Each election as the results publish it, with the 20th Congress district of the same name and whether its towns held.
const towns25 = new Map<string, string[]>();
const elections: Election[] = ELECTION_TERMS.map((t) => {
  const Y = years.get(t.year)!;
  const out: ElectionSeat[] = [];
  for (const c of Y.contests.values()) {
    const k = contestKey(c);
    const ids = ourByKey.get(k) ?? [];
    let territory: ElectionSeat["territory"] = null;
    if (ids.length) {
      const c25 = Y25.byKey.get(k);
      if (c25) {
        if (!towns25.has(c25.id)) towns25.set(c25.id, townsOf(c25.id));
        territory = t.year === 2025 || sameTowns(townsOf(c.id), towns25.get(c25.id)!) ? "same" : "changed";
      }
    }
    const place = c.city ? (ids.length ? districtById.get(ids[0])!.jurisdiction : `${titleCase(c.city)} City`) : titleCase(c.province);
    const label = ids.length === 1 ? districtById.get(ids[0])!.label : `${place}, ${ORDINAL_LABEL[c.district] ?? titleCase(c.district)}`;
    const cands = Y.cands.get(c.id) ?? [];
    for (const w of cands.filter((x) => x.won)) {
      out.push({
        contest_id: c.id, label, district_ids: ids, territory, party: w.party, person_id: w.person_id, person_name: w.display_name,
        province_slug: c.province_slug, votes: w.votes, share: w.votes != null && c.total_votes ? w.votes / c.total_votes : null,
        margin: c.seats === 1 ? c.margin : null, uncontested: c.uncontested === 1, inferred: w.link === "inferred",
      });
    }
  }
  const tally = new Map<string, number>();
  for (const s of out) tally.set(s.party, (tally.get(s.party) ?? 0) + 1);
  return {
    year: t.year, congress: t.congress, label: t.label, gaa_years: [...t.gaa_years], seats: out,
    party_seats: [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
});

// FY2027: each office group goes to the one party all its districts' representatives ran under, or stays whole as shared.
const slice = (): PartySlice => ({ units: 0, nep_php: 0, hgab3_php: 0, added_php: 0, added_rows: 0, held_php: 0, held_rows: 0, dropped_php: 0, dropped_rows: 0, gaa2026_php: null });
const addTo = (s: PartySlice, e: LeaderEntry) => {
  s.units++;
  s.nep_php += e.nep_php ?? 0; s.hgab3_php += e.hgab3_php ?? 0;
  s.added_php += e.added_php; s.added_rows += e.added_rows; s.held_php += e.held_php; s.held_rows += e.held_rows;
  s.dropped_php += e.dropped_php; s.dropped_rows += e.dropped_rows;
  const g = e.gaa["2026"];
  if (g != null) s.gaa2026_php = (s.gaa2026_php ?? 0) + g;
};
const rows = new Map<string, PartyRow>();
const rowOf = (party: string) => {
  let r = rows.get(party);
  if (!r) { r = { party, seats: 0, seats_counted: 0, seats_a: 0, added_php_a: 0, ...slice() }; rows.set(party, r); }
  return r;
};
for (const s of seats) if (s.party) rowOf(s.party).seats++;
const shared = { seats: 0, ...slice() };
const unknown = { seats: 0, ...slice() };
const sharedUnits: SharedUnit[] = [];
for (const e of L.entries) {
  const ps = e.people.map((p) => partyOf.get(p.district_id) ?? null);
  const set = [...new Set(ps)];
  if (set.includes(null)) { addTo(unknown, e); unknown.seats += e.people.length; continue; }
  if (set.length === 1) {
    const r = rowOf(set[0]!);
    addTo(r, e);
    r.seats_counted += e.people.length;
    if (e.tier === "A") { r.seats_a += 1; r.added_php_a += e.added_php; }
    continue;
  }
  addTo(shared, e); shared.seats += e.people.length;
  sharedUnits.push({
    key: e.key, offices: e.offices.map((o) => ({ id: o.id, name: o.name })),
    districts: e.people.map((p) => ({ district_id: p.district_id, label: p.district, party: partyOf.get(p.district_id) ?? null })),
    parties: (set as string[]).sort((a, b) => ps.filter((x) => x === b).length - ps.filter((x) => x === a).length || a.localeCompare(b)),
    nep_php: e.nep_php ?? 0, hgab3_php: e.hgab3_php ?? 0, added_php: e.added_php, added_rows: e.added_rows, dropped_php: e.dropped_php,
    gaa2026_php: e.gaa["2026"] ?? null,
  });
}
sharedUnits.sort((a, b) => b.added_php - a.added_php || a.key.localeCompare(b.key));
const strip = (s: LeaderSlice) => ({ nep_php: s.nep_php, hgab3_php: s.hgab3_php, added_php: s.added_php, added_rows: s.added_rows, held_php: s.held_php, held_rows: s.held_rows, dropped_php: s.dropped_php, dropped_rows: s.dropped_rows });
const K = L.totals.by_office_kind;
const residual = strip(K.central);
for (const s of [K.regional, K.office_change, K.no_office]) for (const k of Object.keys(residual) as Array<keyof typeof residual>) residual[k] += s[k];
const partyRows = [...rows.values()].sort((a, b) => b.seats - a.seats || b.added_php - a.added_php || a.party.localeCompare(b.party));
const fy2027: Fy2027ByParty = {
  rows: partyRows, shared, shared_units: sharedUnits, unknown,
  no_office_seats: seats.filter((s) => !s.unit).length,
  deo: strip(K.deo), all: strip(L.totals.all), residual, central: strip(K.central),
};
const counted = partyRows.reduce((a, r) => a + r.added_php, 0) + shared.added_php + unknown.added_php;
checks.push(`FY2027 party rows + shared + unknown = district offices' added budget: ${counted === K.deo.added_php}`);
if (counted !== K.deo.added_php) fail(`added ${counted} vs deo ${K.deo.added_php}`);
if (K.deo.added_php + residual.added_php !== L.totals.all.added_php) fail("deo + residual != all");

// Enacted budgets by Congress, read with that Congress's seats. The 20th uses the seats above, as FY2027 does.
const congresses: CongressByParty[] = ELECTION_TERMS.map((t) => {
  const E = elections.find((e) => e.year === t.year)!;
  let partyAt: Map<string, string | null>;
  if (t.congress === 20) partyAt = partyOf;
  else {
    partyAt = new Map();
    const byContest = new Map<string, ElectionSeat[]>();
    for (const s of E.seats) byContest.set(s.contest_id, [...(byContest.get(s.contest_id) ?? []), s]);
    for (const won of byContest.values()) {
      const s = won[0];
      if (s.territory !== "same" || !s.district_ids.length) continue;
      const parties = new Set(won.map((w) => w.party));
      // A race for several seats (Taguig) gives its districts a party only when every winner ran under it.
      const p = won.length === s.district_ids.length && parties.size === 1 ? won[0].party : null;
      for (const id of s.district_ids) partyAt.set(id, p);
    }
  }
  const tally = new Map<string, { seats: number; units: number; gaa_php: number }>();
  const tallyOf = (p: string) => tally.get(p) ?? (tally.set(p, { seats: 0, units: 0, gaa_php: 0 }), tally.get(p)!);
  if (t.congress === 20) { for (const s of seats) if (s.party) tallyOf(s.party).seats++; }
  else for (const [p, n] of E.party_seats) tallyOf(p).seats += n;
  const sharedC = { units: 0, gaa_php: 0 };
  const notComparable = { units: 0, gaa_php: 0 };
  for (const e of L.entries) {
    const g = e.congress[String(t.congress) as "18" | "19" | "20"] ?? 0;
    const ps = e.people.map((p) => (partyAt.has(p.district_id) ? partyAt.get(p.district_id)! : null));
    if (ps.includes(null) || (t.congress !== 20 && e.reorganised)) { notComparable.units++; notComparable.gaa_php += g; continue; }
    const set = new Set(ps);
    if (set.size > 1) { sharedC.units++; sharedC.gaa_php += g; continue; }
    const r = tallyOf(ps[0]!);
    r.units++; r.gaa_php += g;
  }
  const res = L.totals.gaa_residual.filter((r) => t.gaa_years.includes(r.fy));
  const deo = res.reduce((a, r) => a + r.deo_php, 0);
  const total = res.reduce((a, r) => a + r.total_php, 0);
  const sum = [...tally.values()].reduce((a, r) => a + r.gaa_php, 0) + sharedC.gaa_php + notComparable.gaa_php;
  if (sum !== deo) fail(`${t.label}: offices ${sum} vs district offices ${deo}`);
  return {
    congress: t.congress, election: t.year, label: t.label, years: [...t.gaa_years],
    rows: [...tally].map(([party, v]) => ({ party, ...v })).sort((a, b) => b.seats - a.seats || b.gaa_php - a.gaa_php || a.party.localeCompare(b.party)),
    shared: sharedC, not_comparable: notComparable, deo_php: deo, other_php: total - deo, total_php: total,
  };
});
checks.push("each Congress: party rows + shared + not comparable = district offices' enacted budget");

const codes = new Set<string>();
for (const s of seats) if (s.party) codes.add(s.party);
for (const e of elections) for (const s of e.seats) if (s.party) codes.add(s.party);
const parties = Object.fromEntries([...codes].sort().map((c) => [c, PARTY_NAMES[c] ?? null]));

const out: PartiesData = {
  schema: PARTIES_SCHEMA,
  built_at: new Date().toISOString(),
  inputs: { districts: sha(INPUTS.districts), leaderboard: sha(INPUTS.leaderboard), elections: sha(INPUTS.elections) },
  source: {
    name: "Open Halalan: The Philippine National and Local Election Dataset",
    citation: "Leung, Robert R. Open Halalan: The Philippine National and Local Election Dataset.",
    url: OPEN_HALALAN_URL,
    via: "BetterGov Dynasties",
    site: DYNASTIES_SITE,
    api: DYNASTIES_API,
    developers: DYNASTIES_DEVELOPERS,
    data_vintage: "2026-09-14",
    license: "Derived data CC0 1.0 by BetterGov.ph; cite Open Halalan for election results.",
    seat_holders: `House ${D.representatives_source.congress}th Congress directory, as on the district pages (DEO2LEG crosswalk ${D.crosswalk.build_date}).`,
  },
  parties,
  seats,
  units: L.entries.map((e) => ({
    key: e.key, tier: e.tier, offices: e.offices.map((o) => ({ id: o.id, name: o.name })), district_ids: e.people.map((p) => p.district_id),
    nep_php: e.nep_php, hgab3_php: e.hgab3_php, delta_php: e.delta_php, added_php: e.added_php, added_rows: e.added_rows,
    held_php: e.held_php, dropped_php: e.dropped_php, gaa2026_php: e.gaa["2026"] ?? null,
  })),
  elections,
  fy2027,
  congresses,
  notes: [
    "Party is the one each representative ran under for the seat in May 2025, as the results publish it. Members may have changed party since.",
    "A party’s figure adds the DPWH offices serving only its members’ districts. An office shared across parties stays whole, with every party named.",
    "Lines under the DPWH Central Office name no district office, so no party can be read from them.",
    "Earlier Congresses use the seats each election filled, where the district had the same towns as in 2025.",
  ],
};
if (vintage !== 2025) fail(`the elections database ends in ${vintage}, not 2025`);
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "parties.json"), JSON.stringify(out));

// Report
const n = (b: PartyBasis) => seats.filter((s) => s.basis === b);
console.log(`20th Congress: ${seats.length} seats · ${n("winner").length} won the seat · ${seats.filter((s) => !s.party).length} with no party`);
for (const b of ["top_votes", "seated_other", "two_listed", "special_election", "not_in_results"] as PartyBasis[]) {
  for (const s of n(b)) console.log(`  ${b.padEnd(16)} ${s.label.padEnd(40)} ${String(s.holder).padEnd(36)} ${s.party ?? "—"}  (${s.person_name ?? "—"})`);
}
console.log(`FY2027 added at district offices ${peso(K.deo.added_php)} · Central Office and other ${peso(residual.added_php)}`);
for (const r of partyRows.slice(0, 8)) {
  console.log(`  ${partyName(r.party).padEnd(30)} ${String(r.seats).padStart(4)} seats · ${String(r.units).padStart(3)} offices · added ${peso(r.added_php)} (${((r.added_php / K.deo.added_php) * 100).toFixed(1)}%)`);
}
console.log(`  shared by several parties: ${shared.units} offices, ${shared.seats} seats, added ${peso(shared.added_php)} · unknown ${unknown.units} offices`);
for (const c of congresses) {
  const top = c.rows.slice(0, 3).map((r) => `${r.party} ${r.seats}/${peso(r.gaa_php)}`).join(", ");
  console.log(`${c.label} (FY${c.years[0]}–${c.years[c.years.length - 1]}): ${top}; shared ${c.shared.units}, not comparable ${c.not_comparable.units} (${peso(c.not_comparable.gaa_php)})`);
}
for (const e of elections) {
  const t = { same: 0, changed: 0, none: 0 };
  for (const s of e.seats) t[s.territory ?? "none"]++;
  console.log(`${e.year}: ${e.seats.length} seats won · same towns ${t.same} · changed ${t.changed} · no 2025 district ${t.none}`);
}
console.log("checks:", checks);
