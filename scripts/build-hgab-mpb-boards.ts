/**
 * npm run build:hgab-mpb-boards: the leaderboards' four multi-purpose building boards
 * (data/hgab/2027/mpb-boards/boards.json; contract in src/lib/hgab-leaderboard.ts, MpbBoardsData).
 *
 * Jason (2026-11-03): "leaderboards for top mpb contractors, top mpbs per barangay, top mpbs per deo, top mpbs per
 * legislator"; enacted budgets 2020 to 2026 only; a line counts for the legislative district its title places it in.
 *
 * Inputs, all built already: the multi-purpose map's lines (mpb-years/lines.json, npm run build:hgab-mpb-years),
 * their DPWH contracts (contractors/mpb-links.json, npm run build:hgab-contractors) and districts.json (each
 * district's representative and each office's districts). The contractor board ranks with the map's own
 * rankLineContractors, so it and the map's "Top contractors" agree.
 *
 *   contractors  contract amount (each contract once); lines with no matched contract are the residual
 *   barangays    budget amount of the lines whose title names a barangay (as the map's "Same barangay")
 *   offices      budget amount by the district engineering office the budget lists; Central Office and regional
 *                office lines are the residual
 *   districts    budget amount by the map's legislative district (title place, else a one-district office); the
 *                representative now in the seat
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { LINKED_YEARS, decodeMpbContracts, rankLineContractors, type MpbContractsFile } from "../src/lib/hgab-contractors";
import {
  MPB_BOARD_COLS, MPB_BOARD_SETS, displayName, type LeaderPerson, type MpbBoardRow, type MpbBoardSet, type MpbBoardsFile,
} from "../src/lib/hgab-leaderboard";
import { decodeMpbLines, officeShort, type MpbLine, type MpbLinesFile } from "../src/lib/hgab-mpb-years";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const ROOT = resolve(arg("data", "data/hgab/2027"));
const OUT = resolve(arg("out", `${ROOT}/mpb-boards`));
const INPUTS = {
  lines: resolve(ROOT, "mpb-years/lines.json"),
  contracts: resolve(ROOT, "contractors/mpb-links.json"),
  districts: resolve(ROOT, "districts.json"),
};

interface Representative {
  name: string | null; status: string; candidates?: Array<{ name: string | null }>;
  portrait_url?: string | null; portrait_attribution?: string | null; portrait_license?: string | null; portrait_source_url?: string | null;
  profile_url?: string | null; juris_url?: string | null; bill_count?: number | null; leadership_roles?: string[];
}
interface DistrictsFile {
  districts: Array<{ id: string; label: string; jurisdiction: string; district_label: string; region: string | null; representative: Representative | null }>;
  offices: Record<string, { id: string; name: string; kind: string; region: string | null; district_ids: string[]; years: Array<{ fy: number; matched_label: string | null }> }>;
}

const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const [FROM, TO] = LINKED_YEARS;
/** A row as written: the links and the district's person are attached when the file is read (decodeMpbBoards). */
type Row = Omit<MpbBoardRow, "href" | "page" | "person">;

/** scripts/build-hgab-leaderboard.ts `repName` and `personOf`, so these people equal leaderboard.json's. */
function repName(rep: Representative | null): string | null {
  if (!rep) return null;
  if (rep.status === "ambiguous") {
    if (rep.name) return rep.name;
    const names = (rep.candidates ?? []).map((c) => c.name).filter(Boolean);
    return names.length ? names.join(" / ") : null;
  }
  return rep.name || null;
}
function personOf(d: DistrictsFile["districts"][number], region: string): LeaderPerson {
  const r = d.representative;
  const credit = r?.portrait_url ? [r.portrait_attribution, r.portrait_license].filter(Boolean).join(" · ") || null : null;
  return {
    district_id: d.id, district: d.label, jurisdiction: d.jurisdiction, district_label: d.district_label, region,
    name: repName(r), status: (r ? r.status : "missing") as LeaderPerson["status"],
    portrait_url: r?.portrait_url ?? null, portrait_credit: credit, portrait_source_url: r?.portrait_url ? r.portrait_source_url ?? null : null,
    profile_url: r?.profile_url ?? null, juris_url: r?.juris_url ?? null, bill_count: r?.bill_count ?? null,
    leadership_roles: [...(r?.leadership_roles ?? [])],
    href: `/hgab/2027/districts/${encodeURIComponent(d.id)}`,
  };
}

const data = decodeMpbLines(readJson<MpbLinesFile>(INPUTS.lines));
const contracts = decodeMpbContracts(readJson<MpbContractsFile>(INPUTS.contracts));
const D = readJson<DistrictsFile>(INPUTS.districts);

const lines = data.lines.filter((l) => l.fy >= FROM && l.fy <= TO && (l.gaa ?? 0) > 0);
const total = { lines: lines.length, gaa_php: lines.reduce((a, l) => a + (l.gaa ?? 0), 0) };

/** Lines grouped by a key; each group's lines, budget amount and years. */
function groups(pick: (l: MpbLine) => string | null) {
  const by = new Map<string, MpbLine[]>();
  for (const l of lines) {
    const k = pick(l);
    if (k == null) continue;
    by.set(k, [...(by.get(k) ?? []), l]);
  }
  const rest = lines.filter((l) => pick(l) == null);
  return {
    by,
    residual: { lines: rest.length, gaa_php: rest.reduce((a, l) => a + (l.gaa ?? 0), 0) },
  };
}
const sum = (ls: MpbLine[]) => ls.reduce((a, l) => a + (l.gaa ?? 0), 0);
const span = (ls: MpbLine[]) => ({ first_year: Math.min(...ls.map((l) => l.fy)), last_year: Math.max(...ls.map((l) => l.fy)) });
const mostCommon = <T,>(xs: T[]): T | null => {
  const n = new Map<T, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
const byAmount = (a: Row, b: Row) => b.gaa_php - a.gaa_php || a.label.localeCompare(b.label) || a.key.localeCompare(b.key);

// Contractors: the map's own ranking over these lines.
const ranked = rankLineContractors(lines, contracts, "contract");
const contractorRows: Row[] = ranked.rows.map((r) => ({
  key: r.key,
  // DPWH's list often trails a former name, cut short ("… (FORMERLY: MRB CONS"); the contractor's page keeps it whole.
  label: r.name.replace(/\s*\(FORMERLY\b.*$/i, "").replace(/\s+/g, " ").trim() || r.name,
  sub: r.topOffice ? `Mostly ${officeShort(r.topOffice)}${r.offices > 1 ? ` · ${r.offices} offices` : ""}` : "",
  region: null,
  lines: r.lines,
  gaa_php: r.gaaPhp,
  contracts: r.contracts,
  contract_php: Math.round(r.contractPhp * 100) / 100,
  first_year: r.firstYear,
  last_year: r.lastYear,
}));
const noContract = lines.filter((l) => !contracts.has(l.id));

// Barangays: lines whose title names one (a GPS line keeps the barangay its title names).
const brgy = groups((l) => (l.place >= 0 && data.places[l.place].level === "barangay" ? data.places[l.place].key : null));
const placeByKey = new Map(data.places.map((p) => [p.key, p]));
const barangayRows: Row[] = [...brgy.by].map(([key, ls]) => {
  const p = placeByKey.get(key)!;
  const d = p.districts.map((i) => data.districts[i]?.label).filter(Boolean);
  return {
    key, label: p.label, sub: d.join(" · "), region: p.region, lines: ls.length, gaa_php: sum(ls),
    contracts: null, contract_php: null, ...span(ls),
  };
}).sort(byAmount);

// DPWH district engineering offices, as the budget lists them; the districts each serves from districts.json.
const officeByLabel = new Map<string, DistrictsFile["offices"][string]>();
for (const o of Object.values(D.offices)) for (const y of o.years) if (y.matched_label && y.fy >= FROM && y.fy <= TO) officeByLabel.set(y.matched_label, o);
const districtLabel = new Map(D.districts.map((d) => [d.id, d.label]));
const isDeo = (name: string | null) => Boolean(name && /District Engineering Office/i.test(name));
const off = groups((l) => (isDeo(l.office) ? l.office : null));
// An office the district list does not name (an older or provincial unit) is described by where its lines sit.
const notListed: string[] = [];
const officeRows: Row[] = [...off.by].map(([name, ls]) => {
  const o = officeByLabel.get(name);
  const served = (o?.district_ids ?? []).map((id) => districtLabel.get(id)).filter(Boolean) as string[];
  const where = mostCommon(ls.filter((l) => l.district >= 0).map((l) => data.districts[l.district].label));
  if (!served.length) notListed.push(name);
  return {
    // The key stays as the budget prints it (the map searches it); the label repairs "Pi±as" (a mis-encoded ñ).
    key: name, label: (officeShort(name) ?? name).replace(/±/g, "ñ"),
    sub: served.length ? `Serves ${served.join(" · ")}` : where ? `Lines mostly in ${where}` : "",
    region: o?.region ?? mostCommon(ls.map((l) => l.region)), lines: ls.length, gaa_php: sum(ls),
    contracts: null, contract_php: null, ...span(ls),
  };
}).sort(byAmount);

// Legislative districts, as the map places each line; the district leads, the representative now in the seat under it.
// A person's region is the RegionKey ("XIII"), as leaderboard.json has it, not districts.json's label ("Region XIII").
const people = Object.fromEntries(D.districts.map((d) => [d.id, personOf(d, data.districts[data.districtIndex.get(d.id) ?? -1]?.region ?? "")]));
const dist = groups((l) => (l.district >= 0 ? data.districts[l.district].id : null));
const districtRows: Row[] = [...dist.by].map(([id, ls]) => {
  const d = data.districts[data.districtIndex.get(id)!];
  const p = people[id];
  return {
    key: id,
    label: d.label,
    sub: p?.name ? `Rep. ${displayName(p.name)}` : "No representative found",
    region: d.region, lines: ls.length, gaa_php: sum(ls),
    contracts: null, contract_php: null, ...span(ls),
  };
}).sort(byAmount);

const residual: Record<MpbBoardSet, { lines: number; gaa_php: number }> = {
  contractors: { lines: noContract.length, gaa_php: sum(noContract) },
  barangays: brgy.residual,
  offices: off.residual,
  districts: dist.residual,
};
const rowsOf: Record<MpbBoardSet, Row[]> = { contractors: contractorRows, barangays: barangayRows, offices: officeRows, districts: districtRows };
const out: MpbBoardsFile = {
  schema: 1,
  built_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  years: [FROM, TO],
  totals: total,
  residual,
  sources: Object.fromEntries(Object.entries(INPUTS).map(([k, p]) => [k, sha(p)])),
  people,
  cols: [...MPB_BOARD_COLS],
  sets: Object.fromEntries(MPB_BOARD_SETS.map((set) => [set, rowsOf[set].map((r) => MPB_BOARD_COLS.map((k) => r[k]))])) as MpbBoardsFile["sets"],
};

// Every board adds up: its rows plus its residual are every line (contractors count a joint venture's line per partner).
const adds = (rows: Row[], set: MpbBoardSet) =>
  rows.reduce((a, r) => a + r.lines, 0) + residual[set].lines === total.lines && rows.reduce((a, r) => a + r.gaa_php, 0) + residual[set].gaa_php === total.gaa_php;
const checks = {
  barangays_add_up: adds(barangayRows, "barangays"),
  offices_add_up: adds(officeRows, "offices"),
  districts_add_up: adds(districtRows, "districts"),
  contractors_cover_every_contracted_line: ranked.withContract + noContract.length === total.lines && ranked.eligible === total.lines,
  every_office_described: officeRows.every((r) => r.sub !== ""),
  every_district_has_its_person: districtRows.every((r) => people[r.key]?.district_id === r.key),
};
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "boards.json"), JSON.stringify(out));
const peso = (n: number) => `₱${(n / 1e9).toFixed(1)}B`;
console.log(`FY${FROM}–FY${TO}: ${total.lines.toLocaleString()} lines, ${peso(total.gaa_php)}`);
for (const [set, rows] of Object.entries({ contractors: contractorRows, barangays: barangayRows, offices: officeRows, districts: districtRows })) {
  const r = residual[set as MpbBoardSet];
  console.log(`  ${set.padEnd(12)} ${rows.length.toLocaleString().padStart(6)} rows · residual ${r.lines.toLocaleString()} lines ${peso(r.gaa_php)} · #1 ${rows[0]?.label} (${rows[0]?.lines} lines)`);
}
console.log(`  offices not in districts.json, described by their lines (${notListed.length}): ${notListed.join("; ")}`);
console.log("checks:", checks);
if (!Object.values(checks).every(Boolean)) process.exit(1);
