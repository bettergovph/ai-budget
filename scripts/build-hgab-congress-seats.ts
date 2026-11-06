/**
 * npm run build:hgab-congress-seats: each Congress's representative and party on today's 254 legislative districts,
 * 16th to 20th (elections 2013 to 2025), for the party-by-year grids on the side-by-side pages
 * (data/hgab/2027/parties/congress-seats.json; contract in src/lib/hgab-congress-seats.ts).
 *
 * Jason (2026-11-06): "map the charts based on their political party for that year". A budget carries the party of
 * the representative in the Congress that passed it; a district whose towns changed since that election is kept apart.
 *
 * Matching is the House-bill-by-party page's (scripts/build-hgab-parties.ts, copied, not imported: that script writes on
 * load): a district's race by province or city and district number, and the same towns as the district's 2025 race.
 *   - 20th Congress (2025): parties.json's seats as they are: the House directory's holder and the party they ran under,
 *     with that page's seat facts (special elections, seats the count's runner-up holds);
 *   - earlier: the race's winner and the party they ran under (PARTY_CODE_ALIASES: 2016's "LAKAS-CMD" is "LAKAS"). A
 *     two-seat race (Taguig) whose winners ran under different parties gives no party; a race with no winner on record
 *     gives none. The 2013 results list some races only as a province or Metro Manila total, not by district: those
 *     districts have no race that year.
 * verify:hgab checks the 2019 and 2022 parties against parties.json's elections, seat by seat.
 *
 * Inputs, read-only: districts.json, parties/parties.json, BetterGov Dynasties' dynasty.sqlite (Open Halalan's results).
 *   --data=data/hgab/2027   --out=<data>/parties   --elections=~/projects/dynasty/data/dynasty.sqlite
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CONGRESS_TERMS, PARTY_CODE_ALIASES, type CongressSeat, type CongressSeatsFile } from "../src/lib/hgab-congress-seats";
import type { PartiesData } from "../src/lib/hgab-parties";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const ROOT = resolve(arg("data", "data/hgab/2027"));
const OUT = resolve(arg("out", `${ROOT}/parties`));
const ELECTIONS = resolve(arg("elections", resolve(homedir(), "projects/dynasty/data/dynasty.sqlite")));
const HOUSE = "MEMBER, HOUSE OF REPRESENTATIVES";
const fail = (msg: string): never => { throw new Error(`build-hgab-congress-seats: ${msg}`); };
const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

interface District { id: string; label: string; jurisdiction: string }

// ---- build-hgab-parties.ts's matching, as it is --------------------------------------------------------------
const key = (s: string | null | undefined) =>
  (s ?? "").normalize("NFC").toUpperCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/Ñ/g, "N")
    .replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const ORDINALS: Record<string, string> = {
  lone: "LONE", "1st": "FIRST", "2nd": "SECOND", "3rd": "THIRD", "4th": "FOURTH", "5th": "FIFTH", "6th": "SIXTH", "7th": "SEVENTH", "8th": "EIGHTH",
};
const CITY_ALIASES: Record<string, string> = { "STA ROSA": "SANTA ROSA" };
const PROVINCE_ALIASES: Record<string, string> = { "NORTH COTABATO": "COTABATO" };
const TAGUIG = new Set(["leg:taguig-city-pateros:lone", "leg:taguig-city:2nd"]);
function seatKeyOf(d: District): string {
  if (TAGUIG.has(d.id)) return "C:TAGUIG|LONE";
  const ord = ORDINALS[d.id.split(":").pop() ?? ""];
  if (!ord) fail(`no district number in ${d.id}`);
  if (/\bCity\b/.test(d.jurisdiction)) {
    const j = key(d.jurisdiction.replace(/^City of\s+/i, "").replace(/\s+City$/i, ""));
    return `C:${CITY_ALIASES[j] ?? j}|${ord}`;
  }
  const j = key(d.jurisdiction);
  return `P:${PROVINCE_ALIASES[j] ?? j}|${ord}`;
}
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
// --------------------------------------------------------------------------------------------------------------

interface Contest { id: string; district: string; province: string; city: string | null }
interface Cand { contest_id: string; display_name: string; party: string; won: number }
const db = new DatabaseSync(ELECTIONS, { readOnly: true });
const contestsOf = (year: number) => db.prepare(`
  select ct.id, ct.district, p.name as province, ci.name as city
  from contests ct join provinces p on p.id = ct.province_id left join cities ci on ci.id = ct.city_id
  where ct.year = ? and ct.position = ? and ct.district != '' order by ct.id`).all(year, HOUSE) as unknown as Contest[];
const winnersOf = (year: number) => db.prepare(`
  select c.contest_id, p.display_name, c.party, c.won from candidacies c join persons p on p.id = c.person_id
  where c.year = ? and c.position = ? and c.won = 1 order by c.contest_id, c.id`).all(year, HOUSE) as unknown as Cand[];
const townsStmt = db.prepare(`select ci.name from district_towns dt join cities ci on ci.id = dt.city_id where dt.contest_id = ? order by ci.name`);
const townsOf = (contestId: string) => (townsStmt.all(contestId) as Array<{ name: string }>).map((r) => key(r.name));
const contestKey = (c: Contest) => `${c.city ? `C:${key(c.city)}` : `P:${key(c.province)}`}|${c.district}`;
const keyed = (year: number) => {
  const m = new Map<string, Contest>();
  for (const c of contestsOf(year)) {
    const k = contestKey(c);
    if (m.has(k)) fail(`${year}: two races read as ${k}`);
    m.set(k, c);
  }
  return m;
};

const districts = readJson<{ districts: District[] }>(resolve(ROOT, "districts.json")).districts;
if (districts.length !== 254) fail(`${districts.length} districts, expected 254`);
const P = readJson<PartiesData>(resolve(ROOT, "parties/parties.json"));
const seats25 = new Map(P.seats.map((s) => [s.district_id, s]));
const by25 = keyed(2025);

const terms: CongressSeatsFile["terms"] = CONGRESS_TERMS.map((t) => {
  const seats: Record<string, CongressSeat> = {};
  const counts = { same: 0, changed: 0, absent: 0, no_party: 0 };
  if (t.year === 2025) {
    for (const d of districts) {
      const s = seats25.get(d.id) ?? fail(`parties.json has no seat for ${d.id}`);
      seats[d.id] = [s.party, s.person_name ?? s.holder, "same"];
    }
  } else {
    const byKey = keyed(t.year);
    const winners = new Map<string, Cand[]>();
    for (const w of winnersOf(t.year)) winners.set(w.contest_id, [...(winners.get(w.contest_id) ?? []), w]);
    for (const d of districts) {
      const k = seatKeyOf(d);
      const c = byKey.get(k);
      if (!c) continue;
      const c25 = by25.get(k);
      const territory = c25 && sameTowns(townsOf(c.id), townsOf(c25.id)) ? "same" : "changed";
      const ws = winners.get(c.id) ?? [];
      const parties = new Set(ws.map((w) => (w.party ? PARTY_CODE_ALIASES[w.party] ?? w.party : null)));
      const party = parties.size === 1 ? [...parties][0] : null;
      seats[d.id] = [party, ws.length === 1 ? ws[0].display_name : null, territory];
    }
  }
  for (const d of districts) {
    const s = seats[d.id];
    if (!s) counts.absent++;
    else {
      counts[s[2]]++;
      if (!s[0]) counts.no_party++;
    }
  }
  console.log(`${t.label} (${t.year}): ${counts.same} same towns, ${counts.changed} changed, ${counts.absent} no race, ${counts.no_party} with no party`);
  return { ...t, budget_years: [...t.budget_years], seats, counts };
});

const out: CongressSeatsFile = {
  schema: 1,
  built_at: new Date().toISOString(),
  source: {
    name: "BetterGov Dynasties", url: "https://dynasties.bettergov.ph", via: "Open Halalan's election results (dynasty.sqlite)",
    note: "The party each winner ran under for the seat; LAKAS-CMD (2016) is read as LAKAS. Switches during a term are not recorded.",
  },
  terms,
};
writeFileSync(resolve(OUT, "congress-seats.json"), JSON.stringify(out));
console.log(`wrote ${resolve(OUT, "congress-seats.json")}`);
