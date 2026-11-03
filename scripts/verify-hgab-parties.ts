/**
 * `parties/` (the House bill by party, npm run build:hgab-parties), for verify-hgab.ts. Recomputed here on its own code
 * path: every seat's candidacy is read back from the elections database, every party total from leaderboard.json's
 * office groups, every Congress from the election rows. Nothing is taken from the builder but the file it wrote.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DISCLAIMER_PARTIES } from "../src/lib/hgab-disclaimers";
import type { LeaderboardData } from "../src/lib/hgab-leaderboard";
import {
  BASIS_LABELS, CENTRAL_NOTE, ELECTION_TERMS, PARTIES_SCHEMA, PARTY_FIGURE_NOTE, PARTY_MEANING, PARTY_NAMES, seatsCsv, type PartiesData,
} from "../src/lib/hgab-parties";

type Check = (name: string, ok: boolean, detail?: string) => void;
interface Opts { out: string; elections?: string; words: (s: string) => number; readerCopyHits: (s: string) => string[] }

const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const HOUSE = "MEMBER, HOUSE OF REPRESENTATIVES";
const ORDINAL: Record<string, string> = { lone: "LONE", "1st": "FIRST", "2nd": "SECOND", "3rd": "THIRD", "4th": "FOURTH", "5th": "FIFTH", "6th": "SIXTH", "7th": "SEVENTH", "8th": "EIGHTH" };
const fold = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

export function verifyParties(check: Check, o: Opts): void {
  process.stdout.write("\nparties/ (the House bill by party)\n");
  const path = resolve(o.out, "parties", "parties.json");
  const inputs = {
    districts: resolve(o.out, "districts.json"),
    leaderboard: resolve(o.out, "leaderboard.json"),
    elections: resolve(o.elections ?? resolve(homedir(), "projects/dynasty/data/dynasty.sqlite")),
  };
  const present = [path, ...Object.values(inputs)].every((p) => existsSync(p));
  check("parties.json present with its inputs (npm run build:hgab-parties)", present, path);
  if (!present) return;
  const P = readJson<PartiesData>(path);
  check("schema 1, built from the current districts.json, leaderboard.json and elections database",
    P.schema === PARTIES_SCHEMA && (Object.keys(inputs) as Array<keyof typeof inputs>).every((k) => P.inputs[k] === sha(inputs[k])),
    (Object.keys(inputs) as Array<keyof typeof inputs>).filter((k) => P.inputs[k] !== sha(inputs[k])).map((k) => `${k} changed since the build`).join(", "));

  const D = readJson<{ districts: Array<{ id: string; label: string; jurisdiction: string; representative: { name: string | null; status: string; leadership_roles?: string[]; candidates?: Array<{ name: string | null }> } | null }> }>(inputs.districts);
  const L = readJson<LeaderboardData>(inputs.leaderboard);
  const db = new DatabaseSync(inputs.elections, { readOnly: true });

  // Seats: one per district, the House directory's representative.
  check(`${D.districts.length} seats, one per district in districts.json order, with the House directory's representative`,
    P.seats.length === D.districts.length && P.seats.every((s, i) => {
      const d = D.districts[i];
      const r = d.representative;
      const holder = r ? (r.status === "ambiguous" ? (r.name || (r.candidates ?? []).map((c) => c.name).filter(Boolean).join(" / ")) : r.name) || null : null;
      return s.district_id === d.id && s.label === d.label && s.holder === holder && s.holder_status === (r ? r.status : "missing")
        && JSON.stringify(s.roles) === JSON.stringify([...new Set(r?.leadership_roles ?? [])]);
    }));

  // Each seat's candidacy, read back from the database.
  const cand = db.prepare(`select c.party, c.votes, c.won, p.last_name, p.first_name, p.display_name, ct.year, ct.district, ct.seats, ct.total_votes,
      ct.uncontested, pr.name as province, pr.slug as province_slug, ci.name as city
    from candidacies c join persons p on p.id = c.person_id join contests ct on ct.id = c.contest_id
    join provinces pr on pr.id = ct.province_id left join cities ci on ci.id = ct.city_id
    where c.contest_id = ? and c.person_id = ? and c.position = ?`);
  const winnersOf = db.prepare(`select count(*) as n from candidacies where contest_id = ? and won = 1`);
  const topOf = db.prepare(`select person_id from candidacies where contest_id = ? order by coalesce(votes, -1) desc limit 1`);
  const wrong: string[] = [];
  const named: string[] = [];
  for (const s of P.seats) {
    if (s.basis === "special_election") {
      if (!s.party || !s.note_source || s.person_id || s.contest_id) wrong.push(`${s.district_id}: special election without a party and a source`);
      continue;
    }
    if (!s.person_id || !s.contest_id) { wrong.push(`${s.district_id}: no candidacy`); continue; }
    const c = cand.get(s.contest_id, s.person_id, HOUSE) as Record<string, string | number | null> | undefined;
    if (!c) { wrong.push(`${s.district_id}: candidacy not in the database`); continue; }
    const won = Number(c.won) === 1;
    const winners = Number((winnersOf.get(s.contest_id) as { n: number }).n);
    const top = (topOf.get(s.contest_id) as { person_id: string }).person_id === s.person_id;
    const basisOk = s.basis === "winner" ? won
      : s.basis === "top_votes" ? !winners && top
      : s.basis === "seated_other" ? !won && winners > 0 && s.holder_status === "resolved"
      : s.basis === "two_listed" ? s.holder_status === "ambiguous"
      : false;
    if (c.year !== 2025 || c.party !== s.party || c.votes !== s.votes || c.province_slug !== s.province_slug || !basisOk) {
      wrong.push(`${s.district_id}: ${s.basis} ${s.party} vs ${c.party} won=${c.won}`);
    }
    // The race is this district: its number, and its city or province.
    const ord = ORDINAL[s.district_id.split(":").pop() ?? ""];
    const place = fold(c.city ? String(c.city) : String(c.province));
    const ours = fold(s.jurisdiction.replace(/^City of\s+/i, "").replace(/\s+City$/i, "")).replace(/^STA /, "SANTA ").replace(/^NORTH COTABATO$/, "COTABATO");
    const taguig = s.district_id.startsWith("leg:taguig-city");
    if (!(taguig ? place === "TAGUIG" && c.district === "LONE" : c.district === ord && place === ours)) wrong.push(`${s.district_id}: race ${s.contest_id}`);
    // The person is the representative: a surname word in common with one of the names the House lists.
    const listed = (s.holder ?? "").split(" / ").map((n) => fold(n.split(",")[0]).split(" ").filter((w) => w.length >= 2));
    const theirs = new Set(fold(String(c.last_name)).split(" "));
    if (!listed.some((ws) => ws.some((w) => theirs.has(w)))) named.push(`${s.district_id}: ${s.holder} vs ${c.display_name}`);
  }
  check("every seat's party is its representative's own 2025 candidacy for that race, read back from the elections database",
    wrong.length === 0, wrong.slice(0, 4).join("; "));
  check("every candidacy read shares a surname with the representative the House lists", named.length === 0, named.slice(0, 4).join("; "));
  check("every seat not simply won in the May 2025 results says why, in at most 25 words",
    P.seats.every((s) => s.basis === "winner" || (!!s.note && o.words(s.note) <= 25 && s.basis in BASIS_LABELS)));

  // Office groups: the seats point to leaderboard.json's, and the copies equal them.
  const unitOf = new Map<string, (typeof L.entries)[number]>();
  for (const e of L.entries) for (const p of e.people) unitOf.set(p.district_id, e);
  const noOffice = new Set(L.totals.districts_without_office.map((d) => d.id));
  check("each seat's office group and tier are leaderboard.json's; the districts with no office have none",
    P.seats.every((s) => (s.unit ?? null) === (unitOf.get(s.district_id)?.key ?? null) && (s.tier ?? null) === (unitOf.get(s.district_id)?.tier ?? null)
      && (!s.unit) === noOffice.has(s.district_id)));
  check(`the ${L.entries.length} office groups copied with their FY2027 figures and FY2026 budget`,
    P.units.length === L.entries.length && P.units.every((u, i) => {
      const e = L.entries[i];
      return u.key === e.key && u.tier === e.tier && u.added_php === e.added_php && u.added_rows === e.added_rows && u.nep_php === e.nep_php
        && u.hgab3_php === e.hgab3_php && u.dropped_php === e.dropped_php && u.gaa2026_php === (e.gaa["2026"] ?? null)
        && JSON.stringify(u.district_ids) === JSON.stringify(e.people.map((p) => p.district_id));
    }));

  // FY2027 by party, recomputed.
  const party = new Map(P.seats.map((s) => [s.district_id, s.party]));
  type Agg = { seats: number; counted: number; units: number; added: number; rows: number; nep: number; house: number; held: number; dropped: number; a: number; addedA: number };
  const zero = (): Agg => ({ seats: 0, counted: 0, units: 0, added: 0, rows: 0, nep: 0, house: 0, held: 0, dropped: 0, a: 0, addedA: 0 });
  const agg = new Map<string, Agg>();
  const get = (k: string) => agg.get(k) ?? (agg.set(k, zero()), agg.get(k)!);
  for (const s of P.seats) if (s.party) get(s.party).seats++;
  const mixed = zero();
  const mixedKeys: string[] = [];
  for (const e of L.entries) {
    const ps = new Set(e.people.map((p) => party.get(p.district_id) ?? "?"));
    const a = ps.size === 1 && !ps.has("?") ? get([...ps][0]) : ps.has("?") ? get("?") : mixed;
    if (a === mixed) mixedKeys.push(e.key);
    a.units++; a.counted += e.people.length; a.added += e.added_php; a.rows += e.added_rows; a.nep += e.nep_php ?? 0; a.house += e.hgab3_php ?? 0;
    a.held += e.held_php; a.dropped += e.dropped_php;
    if (e.tier === "A" && a !== mixed) { a.a++; a.addedA += e.added_php; }
  }
  const f = P.fy2027;
  const rowsOk = f.rows.length === [...agg.keys()].filter((k) => k !== "?").length && f.rows.every((r) => {
    const a = agg.get(r.party) ?? zero();
    return r.seats === a.seats && r.seats_counted === a.counted && r.units === a.units && r.added_php === a.added && r.added_rows === a.rows
      && r.nep_php === a.nep && r.hgab3_php === a.house && r.held_php === a.held && r.dropped_php === a.dropped && r.seats_a === a.a && r.added_php_a === a.addedA;
  });
  check(`FY2027: ${f.rows.length} party rows, each the office groups serving only its districts`, rowsOk);
  check(`FY2027: ${f.shared.units} office groups shared across parties, kept whole and listed`,
    f.shared.units === mixed.units && f.shared.added_php === mixed.added && f.shared.seats === mixed.counted
      && JSON.stringify(f.shared_units.map((u) => u.key).sort()) === JSON.stringify([...mixedKeys].sort())
      && f.shared_units.every((u) => new Set(u.districts.map((d) => d.party)).size > 1));
  const sum = f.rows.reduce((x, r) => x + r.added_php, 0) + f.shared.added_php + f.unknown.added_php;
  const K = L.totals.by_office_kind;
  const resid = K.central.added_php + K.regional.added_php + K.office_change.added_php + K.no_office.added_php;
  check("FY2027: parties + shared + unknown = the district offices' added budget; with the residual, the whole",
    sum === K.deo.added_php && f.deo.added_php === K.deo.added_php && f.residual.added_php === resid && f.all.added_php === L.totals.all.added_php
      && K.deo.added_php + resid === L.totals.all.added_php, `${sum} vs ${K.deo.added_php}`);
  check("FY2027: the seat counts add up to 254 with the no-office seats",
    f.rows.reduce((x, r) => x + r.seats, 0) + P.seats.filter((s) => !s.party).length === P.seats.length
      && f.no_office_seats === noOffice.size);

  // Elections, read back.
  const wonIn = db.prepare(`select count(*) as n from candidacies c join contests ct on ct.id = c.contest_id
    where c.year = ? and c.position = ? and c.won = 1 and ct.district != ''`);
  const wonParty = db.prepare(`select party from candidacies where contest_id = ? and person_id = ? and won = 1`);
  const townCount = db.prepare(`select count(*) as n from district_towns where contest_id = ?`);
  const townNames = db.prepare(`select ci.name from district_towns dt join cities ci on ci.id = dt.city_id where dt.contest_id = ?`);
  const townSet = (id: string) => (townNames.all(id) as Array<{ name: string }>).map((r) => fold(r.name)).sort().join("|");
  const seat25 = new Map(P.seats.map((s) => [s.district_id, s.contest_id]));
  let electionsOk = true;
  const territoryOff: string[] = [];
  for (const t of ELECTION_TERMS) {
    const E = P.elections.find((e) => e.year === t.year);
    if (!E) { electionsOk = false; continue; }
    const n = Number((wonIn.get(t.year, HOUSE) as { n: number }).n);
    const tally = new Map<string, number>();
    for (const s of E.seats) {
      tally.set(s.party, (tally.get(s.party) ?? 0) + 1);
      const w = wonParty.get(s.contest_id, s.person_id) as { party: string } | undefined;
      if (!w || w.party !== s.party || !s.contest_id.startsWith(`${t.year}-`)) electionsOk = false;
      if ((s.territory === null) !== (s.district_ids.length === 0)) territoryOff.push(`${s.contest_id}: territory without a district`);
      if (t.year === 2025 && s.territory !== "same") territoryOff.push(`${s.contest_id}: 2025 not same`);
      // A seat whose towns held has as many towns as the 2025 race of that name.
      const c25 = s.district_ids.map((id) => seat25.get(id)).find(Boolean);
      if (s.territory === "same" && c25 && Number((townCount.get(s.contest_id) as { n: number }).n) !== Number((townCount.get(c25) as { n: number }).n)) {
        territoryOff.push(`${s.contest_id}: same towns but another count`);
      }
      // "Changed" needs a town that is not in the other race under the same name.
      if (s.territory === "changed" && c25 && townSet(s.contest_id) === townSet(c25)) territoryOff.push(`${s.contest_id}: changed with the same towns`);
    }
    const tallied = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (E.seats.length !== n || JSON.stringify(tallied) !== JSON.stringify(E.party_seats) || E.congress !== t.congress) electionsOk = false;
  }
  check("2019, 2022 and 2025: every seat won, read back with its party; seats by party add up", electionsOk);
  check("earlier seats are tied to a 2025 district only by name; \"same towns\" has as many towns as 2025, \"changed\" a town not in it",
    territoryOff.length === 0, territoryOff.slice(0, 4).join("; "));

  // Congresses, recomputed from the election rows (the 20th from the seats).
  let congressOk = true;
  for (const C of P.congresses) {
    const t = ELECTION_TERMS.find((x) => x.congress === C.congress);
    const E = P.elections.find((e) => e.congress === C.congress);
    if (!t || !E) { congressOk = false; continue; }
    const at = new Map<string, string | null>();
    if (C.congress === 20) for (const s of P.seats) at.set(s.district_id, s.party);
    else {
      const byRace = new Map<string, typeof E.seats>();
      for (const s of E.seats) byRace.set(s.contest_id, [...(byRace.get(s.contest_id) ?? []), s]);
      for (const won of byRace.values()) {
        if (won[0].territory !== "same") continue;
        const p = won.length === won[0].district_ids.length && new Set(won.map((w) => w.party)).size === 1 ? won[0].party : null;
        for (const id of won[0].district_ids) at.set(id, p);
      }
    }
    const g = new Map<string, { units: number; gaa: number }>();
    let shared = 0, sharedUnits = 0, nc = 0, ncUnits = 0;
    for (const e of L.entries) {
      const v = e.congress[String(C.congress) as "18" | "19" | "20"] ?? 0;
      const ps = e.people.map((p) => at.get(p.district_id) ?? null);
      if (ps.includes(null) || (C.congress !== 20 && e.reorganised)) { nc += v; ncUnits++; continue; }
      if (new Set(ps).size > 1) { shared += v; sharedUnits++; continue; }
      const x = g.get(ps[0]!) ?? { units: 0, gaa: 0 };
      x.units++; x.gaa += v; g.set(ps[0]!, x);
    }
    const res = L.totals.gaa_residual.filter((r) => t.gaa_years.includes(r.fy));
    const deo = res.reduce((a, r) => a + r.deo_php, 0);
    const seatsBy = new Map<string, number>(C.congress === 20 ? [] : E.party_seats);
    if (C.congress === 20) for (const s of P.seats) if (s.party) seatsBy.set(s.party, (seatsBy.get(s.party) ?? 0) + 1);
    const rowsOk = C.rows.every((r) => (g.get(r.party)?.gaa ?? 0) === r.gaa_php && (g.get(r.party)?.units ?? 0) === r.units && (seatsBy.get(r.party) ?? 0) === r.seats)
      && [...g.keys()].every((k) => C.rows.some((r) => r.party === k)) && [...seatsBy.keys()].every((k) => C.rows.some((r) => r.party === k));
    const total = C.rows.reduce((a, r) => a + r.gaa_php, 0) + C.shared.gaa_php + C.not_comparable.gaa_php;
    if (!rowsOk || C.shared.gaa_php !== shared || C.shared.units !== sharedUnits || C.not_comparable.gaa_php !== nc || C.not_comparable.units !== ncUnits
      || C.deo_php !== deo || total !== deo || C.total_php !== res.reduce((a, r) => a + r.total_php, 0)
      || JSON.stringify(C.years) !== JSON.stringify(t.gaa_years)) congressOk = false;
  }
  check("18th to 20th Congress: enacted budgets by party, shared and not compared recomputed; they add up to the district offices'", congressOk);

  // Names and copy.
  const codes = new Set([...P.seats.map((s) => s.party).filter((x): x is string => !!x), ...P.elections.flatMap((e) => e.seats.map((s) => s.party)).filter(Boolean)]);
  check("every party abbreviation in the file is listed, with our name for it or none",
    [...codes].every((c) => c in P.parties && P.parties[c] === (PARTY_NAMES[c] ?? null)) && Object.keys(P.parties).length === codes.size);
  const copy = [PARTY_MEANING, PARTY_FIGURE_NOTE, CENTRAL_NOTE, ...P.notes, ...P.seats.map((s) => s.note ?? ""), ...Object.values(BASIS_LABELS)];
  const long = copy.flatMap((t) => t.split(/(?<=\.)\s+/)).filter((x) => o.words(x) > 25);
  check("reader copy: plain sentences of at most 25 words, none of the banned pipeline words", long.length === 0 && copy.flatMap(o.readerCopyHits).length === 0
    && o.readerCopyHits(DISCLAIMER_PARTIES.body).length === 0, long.slice(0, 2).join(" | "));
  check("the parties disclaimer says where parties come from, that they may have changed, and that a figure proves nothing",
    /May 2025/.test(DISCLAIMER_PARTIES.body) && /changed party/.test(DISCLAIMER_PARTIES.body) && /stay whole/.test(DISCLAIMER_PARTIES.body)
      && /does not establish that a party or a member requested/.test(DISCLAIMER_PARTIES.body) && /irregularity or wrongdoing/.test(DISCLAIMER_PARTIES.body));
  const csv = seatsCsv(P).split("\n");
  check("the district CSV has every seat once, with its party", csv.length === P.seats.length + 1
    && P.seats.every((s, i) => csv[i + 1].startsWith(`${s.district_id},`)));
  db.close();
}
