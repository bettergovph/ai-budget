/**
 * Leaderboards for the House bill section (`/hgab/2027/leaderboard`).
 *
 * Writes `data/hgab/2027/leaderboard.json` (`LeaderboardData` in
 * `src/lib/hgab-leaderboard.ts`, which also holds the boards and the ranking).
 * Everything here is read from files the other builders already wrote:
 *
 *   districts.json            offices, districts, representatives (npm run build:hgab-districts)
 *   dpwh/projects.parquet     the DPWH project lines of the NEP and House Bill 10858 (npm run import:hgab)
 *   dpwh/summary.json         the DPWH stage totals the slices must reproduce
 *
 * Rules (the same as the district cards, `src/lib/hgab-districts.ts`):
 *   - the ranked unit is a connected group of engineering offices (regional
 *     groupings excluded) and every district they serve; one district = Tier A,
 *     several = Tier B; a shared office is never split and sits in one entry;
 *   - districts served by no engineering office are never ranked; they are
 *     listed in `totals.districts_without_office`;
 *   - FY2027 figures are the offices' `fy2027` blocks (the compared project
 *     lines); "added" = `house_only_candidate`, "held" = `fuzzy_candidate` +
 *     `ambiguous`, "dropped" = `nep_only_candidate`, read from the parquet by the
 *     office label the House bill lists (the office's hgab3 `matched_label`, the
 *     mapping build-hgab-districts.ts wrote) and tied out to each office's bridge;
 *   - enacted figures sum the offices' GAA years; growth is `cardGrowth`;
 *   - integer pesos; null is "no figure", never 0.
 *
 *   npm run build:hgab-leaderboard
 *   npm run build:hgab-leaderboard -- --out=data/hgab/2027 --contract=src/lib/hgab.ts
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BOARDS, LEADERBOARD_SCHEMA, formatValue, rankByCongress, rankEntries, rankMembers, rankRegions, residualLine,
  type LeaderEntry, type LeaderPerson, type LeaderRegion, type LeaderSlice, type LeaderboardData,
} from "../src/lib/hgab-leaderboard";

// ---------------------------------------------------------------------------
// districts.json shape (mirrors src/lib/hgab.ts; that module reads import.meta.env, so it is not imported)
// ---------------------------------------------------------------------------

type FiscalStage = "gaa" | "nep" | "hgab3";
interface BridgeCell { rows: number; php: number }
interface Bridge { house_only: BridgeCell; nep_only: BridgeCell; scope_review: BridgeCell; net_php: number }
interface OfficeHistory {
  id: string; name: string; kind: string; region: string | null; district_ids: string[]; tier: "A" | "B";
  years: Array<{ fy: number; stage: FiscalStage; php: number | null; matched_label: string | null }>;
  by_congress: Array<{ congress: number; gaa_php: number | null; years_counted: number[] }>;
  fy2027: {
    nep_php: number | null; hgab3_php: number | null; nep_records: number; hgab3_records: number; bridge: Bridge | null;
    office_change: { rows: number; nep_php: number; hgab3_php: number; row_ids: string[] };
  } | null;
  notes: string[];
}
interface Representative {
  name: string; status: "resolved" | "ambiguous"; profile_url: string | null; juris_url: string | null;
  portrait_url: string | null; portrait_attribution: string | null; portrait_license: string | null; portrait_source_url: string | null;
  bill_count: number | null; leadership_roles: string[]; candidates?: Representative[];
}
interface DistrictCard {
  id: string; label: string; jurisdiction: string; district_label: string; region: string | null;
  representative: Representative | null; office_ids: string[]; attribution: "A" | "B" | "mixed" | "none";
}
interface DistrictIndex {
  source_commit: string;
  representatives_source: { url: string; congress: number; fetched_at: string };
  terms: Array<{ congress: number; years: number[] }>;
  districts: DistrictCard[]; offices: Record<string, OfficeHistory>;
  residual: Array<{
    fy: number; stage: FiscalStage; total_php: number; deo_php: number; central_office_php: number; regional_offices_php: number; unmatched_php: number;
    office_change_php: number; office_change_rows: number; no_office_php: number; no_office_rows: number;
  }>;
  office_change: { rows: number; nep_php: number; hgab3_php: number; row_ids: string[] };
  no_office: { rows: number; nep_php: number; hgab3_php: number; row_ids: string[] };
}

const GAA_YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026] as const;
const CONGRESSES = ["18", "19", "20"] as const;
const OFFICE_KINDS = { deo: "District engineering offices (DEOs)", central: "Central Office", regional: "Regional offices" } as const;
type KindKey = keyof typeof OFFICE_KINDS;
/** The trace sets the leaderboard contract names; asserted equal to what TRACE_LABELS in the contract says. */
const ADDED_TRACES = ["house_only_candidate"];
const HELD_TRACES = ["ambiguous", "fuzzy_candidate"];
const DROPPED_TRACES = ["nep_only_candidate"];

// ---------------------------------------------------------------------------
// Args and helpers
// ---------------------------------------------------------------------------

interface Args { out: string; contract: string }
function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  return { out: resolve(get("out") ?? "data/hgab/2027"), contract: resolve(get("contract") ?? "src/lib/hgab.ts") };
}

const q = (s: string) => s.replace(/'/g, "''");
const log = (s: string) => process.stdout.write(`${s}\n`);
const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : Number(v));
const peso = (n: number | null | undefined) => (n == null ? "—" : `₱${n.toLocaleString("en-US")}`);
const byLabel = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function readJson<T>(path: string): T {
  ensure(existsSync(path), `${path} not found`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
/** Sum of non-null values, or null when every value is null. */
function sumOrNull(values: Array<number | null | undefined>): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}
/** Same rule as `pctChange` in src/lib/hgab.ts. */
function pctChange(amount: number | null, base: number | null): number | null {
  if (amount == null || base == null || !base) return null;
  return ((amount - base) / base) * 100;
}
function sameSlice(a: LeaderSlice, b: LeaderSlice): boolean {
  return SLICE_KEYS.every((k) => a[k] === b[k]);
}
const SLICE_KEYS: ReadonlyArray<keyof LeaderSlice> = ["nep_php", "hgab3_php", "added_php", "added_rows", "held_php", "held_rows", "dropped_php", "dropped_rows"];
const emptySlice = (): LeaderSlice => ({ nep_php: 0, hgab3_php: 0, added_php: 0, added_rows: 0, held_php: 0, held_rows: 0, dropped_php: 0, dropped_rows: 0 });
function addSlice(into: LeaderSlice, x: LeaderSlice): void {
  for (const k of SLICE_KEYS) into[k] += x[k];
}

// ---------------------------------------------------------------------------
// Contract constants (src/lib/hgab.ts), read as text
// ---------------------------------------------------------------------------

function contractTraces(path: string): Map<string, { group: string; held: boolean }> {
  const src = readFileSync(path, "utf8");
  const block = /export const TRACE_LABELS[^{]*\{([\s\S]*?)\n\};/.exec(src)?.[1];
  ensure(block, `TRACE_LABELS not found in ${path}`);
  const out = new Map<string, { group: string; held: boolean }>();
  for (const m of block.matchAll(/^\s*([a-z0-9_]+):\s*\{.*?\bgroup:\s*'([a-z_]+)'(?:,\s*held:\s*(true|false))?/gm)) out.set(m[1], { group: m[2], held: m[3] === "true" });
  ensure(out.size > 0, "no traces parsed from TRACE_LABELS");
  return out;
}
function contractRegionOrder(path: string): string[] {
  const src = readFileSync(path, "utf8");
  const block = /export const REGION_ORDER[^=]*=\s*\[([\s\S]*?)\];/.exec(src)?.[1];
  ensure(block, `REGION_ORDER not found in ${path}`);
  return [...block.matchAll(/'([A-Z-]+)'/g)].map((m) => m[1]);
}

/** Copy of `regionKeyOf` in src/lib/hgab.ts (that module cannot be imported at runtime here). */
const ROMAN: Record<string, string> = { I: "I", II: "II", III: "III", V: "V", VI: "VI", VII: "VII", VIII: "VIII", IX: "IX", X: "X", XI: "XI", XII: "XII", XIII: "XIII" };
function regionKeyOf(label: string | null | undefined): string | null {
  if (!label) return null;
  const s = label.toUpperCase().replace(/[‐-―]/g, "-");
  if (/\bNCR\b|NATIONAL CAPITAL|METRO MANILA/.test(s)) return "NCR";
  if (/\bCAR\b|CORDILLERA/.test(s)) return "CAR";
  if (/\bBARMM\b|BANGSAMORO|\bARMM\b/.test(s)) return "BARMM";
  if (/\bNIR\b|NEGROS ISLAND/.test(s)) return "NIR";
  if (/MIMAROPA|\bIV-?B\b/.test(s)) return "MIMAROPA";
  if (/CALABARZON|\bIV-?A\b/.test(s)) return "IV-A";
  if (/CARAGA/.test(s)) return "XIII";
  const m = /\bREGION\s+([IVX]+)\b/.exec(s);
  return m ? ROMAN[m[1]] ?? null : null;
}

// ---------------------------------------------------------------------------
// Parquet: added / held / dropped per office label, slices per office kind
// ---------------------------------------------------------------------------

interface LabelSums { kind: string; slice: LeaderSlice; scope_rows: number }
type CountedSlice = LeaderSlice & { rows: number };
interface ParquetSums { byLabel: Map<string, LabelSums>; byKind: Record<KindKey, LeaderSlice>; officeChange: CountedSlice; noOffice: CountedSlice }

/**
 * Per printed office label and per office kind, without the office-change and no-office lines (ids from
 * districts.json), which form their own slices: the districts builder holds them out of every office and of
 * Central/regional.
 */
async function loadParquet(path: string, traces: Map<string, { group: string; held: boolean }>, heldOut: Set<string>, noOfficeIds: Set<string>): Promise<ParquetSums> {
  ensure(existsSync(path), `${path} not found — run \`npm run import:hgab\` first`);
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  const rows = (await c.runAndReadAll(`SELECT id, office, office_kind, trace, nep_php, hgab3_php FROM read_parquet('${q(path)}') ORDER BY id`)).getRows();
  c.closeSync(); db.closeSync();

  const kindKey = new Map(Object.entries(OFFICE_KINDS).map(([k, v]) => [v as string, k as KindKey]));
  const byLabel = new Map<string, LabelSums>();
  const byKind: Record<KindKey, LeaderSlice> = { deo: emptySlice(), central: emptySlice(), regional: emptySlice() };
  const officeChange: CountedSlice = { ...emptySlice(), rows: 0 }, noOffice: CountedSlice = { ...emptySlice(), rows: 0 };
  const seen = new Set<string>();
  for (const r of rows) {
    const id = String(r[0]);
    const office = r[1] == null ? "" : String(r[1]);
    const kind = r[2] == null ? "" : String(r[2]);
    const trace = String(r[3]);
    ensure(office, `${id}: a DPWH parquet row has no office`);
    const k = kindKey.get(kind);
    ensure(k, `${office}: office_kind '${kind}' is not one of ${Object.values(OFFICE_KINDS).join(" / ")}`);
    const t = traces.get(trace);
    ensure(t, `trace ${trace} is not in the contract's TRACE_LABELS`);
    const nep = r[4] == null ? 0 : num(r[4]);
    const h3 = r[5] == null ? 0 : num(r[5]);
    const s: LeaderSlice = { ...emptySlice(), nep_php: nep, hgab3_php: h3 };
    if (ADDED_TRACES.includes(trace)) { s.added_php = h3; s.added_rows = 1; }
    if (HELD_TRACES.includes(trace)) { s.held_php = h3; s.held_rows = 1; }
    if (DROPPED_TRACES.includes(trace)) { s.dropped_php = nep; s.dropped_rows = 1; }
    const cur = byLabel.get(office) ?? { kind, slice: emptySlice(), scope_rows: 0 };
    ensure(cur.kind === kind, `${office} is listed under two office kinds (${cur.kind}, ${kind})`);
    byLabel.set(office, cur);
    if (heldOut.has(id)) { addSlice(officeChange, s); officeChange.rows++; seen.add(id); continue; }
    if (noOfficeIds.has(id)) { addSlice(noOffice, s); noOffice.rows++; seen.add(id); continue; }
    addSlice(cur.slice, s);
    if (t.group === "scope_review") cur.scope_rows++;
    addSlice(byKind[k], s);
  }
  ensure(seen.size === heldOut.size + noOfficeIds.size, `${heldOut.size + noOfficeIds.size - seen.size} office-change or no-office ids from districts.json are not in the parquet`);
  return { byLabel, byKind, officeChange, noOffice };
}

// ---------------------------------------------------------------------------
// Reorganisation: the office notes (build-hgab-districts.ts writes them) that record a history change in 2020–2026
// ---------------------------------------------------------------------------

/** "2020–2024, 2026" → [2020, …, 2024, 2026]; null when the text is not a list of years and year runs. */
function parseYearRuns(text: string): number[] | null {
  const out: number[] = [];
  for (const part of text.split(", ")) {
    const m = /^(\d{4})(?:–(\d{4}))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]), b = Number(m[2] ?? m[1]);
    if (b < a) return null;
    for (let y = a; y <= b; y++) out.push(y);
  }
  return out;
}
const enactedYears = (ys: number[]) => ys.length > 0 && ys.every((y) => y >= GAA_YEARS[0] && y <= GAA_YEARS[GAA_YEARS.length - 1]);

/**
 * The slot list in a predecessor note's parentheses ("enacted budgets 2020–2026, 2027 NEP"): the enacted years it
 * names, or null when it is not exactly enacted years and/or the 2027 documents.
 */
function parseSlots(text: string): number[] | null {
  const m = /^(?:enacted budgets? ((?:\d{4}(?:–\d{4})?)(?:, \d{4}(?:–\d{4})?)*))?((?:(?:^|, )2027 (?:NEP|House bill))*)$/.exec(text);
  if (!m || (!m[1] && !m[2])) return null;
  if (!m[1]) return [];
  return parseYearRuns(m[1]);
}

/**
 * Every note pattern build-hgab-districts.ts can write, each classified explicitly. `counts` = the note records a
 * change of office within the enacted years 2020–2026 (created, renamed or carved out, so earlier money sits under
 * another name). A note matching none of these stops the build: a new pattern needs a decision, not a guess.
 */
const NOTE_PATTERNS: ReadonlyArray<{ kind: string; re: RegExp; counts: (m: RegExpExecArray) => boolean }> = [
  // (a) Missing from some enacted budgets under this name: counts (the years are always within 2020–2026).
  { kind: "not listed in enacted budgets", re: /^Not listed under this name in the (.+) enacted budgets?\.$/, counts: (m) => {
    const ys = parseYearRuns(m[1]);
    ensure(ys && enactedYears(ys), `unrecognised years in office note: ${m[0]}`);
    return true;
  } },
  // (b) A predecessor served the area before a given year: counts when its money is in enacted years.
  { kind: "predecessor", re: /^Before (\d{4}) this area was served by .+?; its ₱[\d,]+ \((.+)\) is left unassigned, not split among its \d+ successors\.$/, counts: (m) => {
    const ys = parseSlots(m[2]);
    ensure(ys && (ys.length === 0 || enactedYears(ys)), `unrecognised slots in office note: ${m[0]}`);
    return ys.length > 0;
  } },
  // (c) An undivided predecessor still listed beside this office: counts when it is listed in enacted years.
  { kind: "undivided predecessor", re: /^The budget also lists an undivided .+?; its ₱[\d,]+ \((.+)\) is left unassigned, not split among its \d+ successors\.$/, counts: (m) => {
    const ys = parseSlots(m[1]);
    ensure(ys && (ys.length === 0 || enactedYears(ys)), `unrecognised slots in office note: ${m[0]}`);
    return ys.length > 0;
  } },
  // About the 2027 documents only: does not count.
  { kind: "not listed in the 2027 NEP", re: /^Not listed under this name in the 2027 NEP\.$/, counts: () => false },
  { kind: "no 2027 projects", re: /^No projects under this office in the 2027 House bill or the NEP\.$/, counts: () => false },
  // The office-change annotation (lines held out because the NEP and the House bill name different offices): a 2027
  // note, not a change of office in the enacted years. Does not count.
  { kind: "office-change lines", re: /^(?:1 project line changed office between the NEP and the House bill; it is not counted here|\d+ project lines changed office between the NEP and the House bill; they are not counted here)\.$/, counts: () => false },
  // A line listed under this office that the source records with no office (residual): a 2027 note. Does not count.
  { kind: "no-office lines", re: /^(?:1 House bill line listed here has no office in the source data; it is|\d+ House bill lines listed here have no office in the source data; they are) left unassigned\.$/, counts: () => false },
  // About a regional grouping (never ranked): does not count.
  { kind: "regional grouping", re: /^A regional grouping, not an engineering office; it has no figures of its own, and its money is not assigned to any district\.$/, counts: () => false },
];

// "Listed with no money in <years>; shown as blank rather than zero." (build-hgab-districts.ts can write it; no office
// carries it at this build) is deliberately left unclassified, so it stops the build until someone decides.
function classifyNote(o: OfficeHistory, note: string): { kind: string; counts: boolean } {
  for (const p of NOTE_PATTERNS) {
    const m = p.re.exec(note);
    if (m) return { kind: p.kind, counts: p.counts(m) };
  }
  throw new Error(`${o.id}: unrecognised office note pattern — classify it in NOTE_PATTERNS: ${note}`);
}

/** The notes of an office that record a reorganisation within 2020–2026, verbatim. */
function reorganisationNotes(o: OfficeHistory): string[] {
  return o.notes.filter((note) => classifyNote(o, note).counts);
}

// ---------------------------------------------------------------------------
// Groups (union-find over engineering offices and the districts they serve)
// ---------------------------------------------------------------------------

function connectedGroups(offices: OfficeHistory[], districts: DistrictCard[]): Array<{ offices: OfficeHistory[]; districts: DistrictCard[] }> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let y = x;
    while (parent.get(y) !== r) { const next = parent.get(y)!; parent.set(y, r); y = next; }
    return r;
  };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const ledgerIds = new Set(offices.map((o) => o.id));
  const districtIds = new Set(districts.map((d) => d.id));
  for (const o of offices) parent.set(`o:${o.id}`, `o:${o.id}`);
  for (const d of districts) parent.set(`d:${d.id}`, `d:${d.id}`);
  for (const o of offices) {
    ensure(o.district_ids.length > 0, `${o.id} serves no district`);
    for (const did of o.district_ids) { ensure(districtIds.has(did), `${o.id} serves ${did}, which is not a ranked district`); union(`o:${o.id}`, `d:${did}`); }
  }
  for (const d of districts) for (const oid of d.office_ids) if (ledgerIds.has(oid)) union(`d:${d.id}`, `o:${oid}`);
  const groups = new Map<string, { offices: OfficeHistory[]; districts: DistrictCard[] }>();
  const at = (k: string) => { const r = find(k); const g = groups.get(r) ?? { offices: [], districts: [] }; groups.set(r, g); return g; };
  for (const o of offices) at(`o:${o.id}`).offices.push(o);
  for (const d of districts) at(`d:${d.id}`).districts.push(d);
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** `repName` in src/lib/hgab-districts.ts, with null for a seat with no representative (the contract's "no figure"). */
function repName(rep: Representative | null): string | null {
  if (!rep) return null;
  if (rep.status === "ambiguous") {
    if (rep.name) return rep.name;
    const names = (rep.candidates ?? []).map((c) => c.name).filter(Boolean);
    return names.length ? names.join(" / ") : null;
  }
  return rep.name || null;
}

function personOf(d: DistrictCard, region: string): LeaderPerson {
  const r = d.representative;
  const credit = r?.portrait_url ? [r.portrait_attribution, r.portrait_license].filter(Boolean).join(" · ") || null : null;
  return {
    district_id: d.id, district: d.label, jurisdiction: d.jurisdiction, district_label: d.district_label, region,
    name: repName(r), status: r ? r.status : "missing",
    portrait_url: r?.portrait_url ?? null, portrait_credit: credit, portrait_source_url: r?.portrait_url ? r.portrait_source_url ?? null : null,
    profile_url: r?.profile_url ?? null, juris_url: r?.juris_url ?? null, bill_count: r?.bill_count ?? null,
    leadership_roles: [...(r?.leadership_roles ?? [])],
    href: `/hgab/2027/districts/${encodeURIComponent(d.id)}`,
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  const builtAt = new Date().toISOString();
  const outPath = resolve(args.out, "leaderboard.json");
  log(`building ${outPath}`);

  const D = readJson<DistrictIndex>(resolve(args.out, "districts.json"));
  const overview = readJson<{ source_commit: string }>(resolve(args.out, "overview.json"));
  const summary = readJson<{ dataset: { key: string; totals: { nep_php: number; hgab3_php: number | null } } }>(resolve(args.out, "dpwh", "summary.json"));
  ensure(D.source_commit === overview.source_commit, `districts.json source_commit ${D.source_commit} ≠ overview.json ${overview.source_commit} — rebuild districts`);
  ensure(summary.dataset.key === "dpwh" && summary.dataset.totals.hgab3_php != null, "dpwh/summary.json has no DPWH House bill total");

  // Contract: trace sets and region order.
  const traces = contractTraces(args.contract);
  const pick = (f: (t: { group: string; held: boolean }) => boolean) => [...traces].filter(([, t]) => f(t)).map(([k]) => k).sort();
  ensure(JSON.stringify(pick((t) => t.group === "house_only" && !t.held)) === JSON.stringify(ADDED_TRACES), "TRACE_LABELS: the house_only, not-held traces are no longer just house_only_candidate");
  ensure(JSON.stringify(pick((t) => t.group === "house_only" && t.held)) === JSON.stringify(HELD_TRACES), "TRACE_LABELS: the held traces are no longer fuzzy_candidate + ambiguous");
  ensure(JSON.stringify(pick((t) => t.group === "nep_only")) === JSON.stringify(DROPPED_TRACES), "TRACE_LABELS: the nep_only traces are no longer just nep_only_candidate");
  const regionOrder = contractRegionOrder(args.contract);
  ensure(regionOrder.length === 18, `REGION_ORDER has ${regionOrder.length} regions`);

  // Office-change lines (DEO2LEG condition 3), held out by the districts builder: every office's annotation, together.
  const heldOut = new Set(Object.values(D.offices).flatMap((o) => o.fy2027?.office_change.row_ids ?? []));
  const h3Slot = D.residual.find((r) => r.stage === "hgab3" && r.fy === 2027);
  ensure(h3Slot, "districts.json residual has no House bill 2027 slot");
  ensure(heldOut.size === D.office_change.rows && heldOut.size === h3Slot.office_change_rows && [...heldOut].sort().join() === [...D.office_change.row_ids].sort().join(),
    `office-change lines: ${heldOut.size} on offices, ${D.office_change.rows} in the summary, ${h3Slot.office_change_rows} on the residual slot`);
  const noOfficeIds = new Set(D.no_office.row_ids);
  ensure(noOfficeIds.size === D.no_office.rows && noOfficeIds.size === h3Slot.no_office_rows && [...noOfficeIds].every((id) => !heldOut.has(id)), "no-office lines disagree across districts.json");
  const parquet = await loadParquet(resolve(args.out, "dpwh", "projects.parquet"), traces, heldOut, noOfficeIds);
  ensure(parquet.noOffice.hgab3_php === D.no_office.hgab3_php && parquet.noOffice.nep_php === D.no_office.nep_php && parquet.noOffice.hgab3_php === h3Slot.no_office_php,
    `no-office slice ${peso(parquet.noOffice.hgab3_php)} ≠ districts.json ${peso(D.no_office.hgab3_php)}`);
  ensure(parquet.officeChange.nep_php === D.office_change.nep_php && parquet.officeChange.hgab3_php === D.office_change.hgab3_php && parquet.officeChange.hgab3_php === h3Slot.office_change_php,
    `office-change slice ${peso(parquet.officeChange.nep_php)} / ${peso(parquet.officeChange.hgab3_php)} ≠ districts.json ${peso(D.office_change.nep_php)} / ${peso(D.office_change.hgab3_php)}`);

  // Engineering offices (not regional groupings) and the districts they serve.
  const allOffices = Object.values(D.offices);
  const ledger = allOffices.filter((o) => o.kind !== "regional_group");
  const ledgerIds = new Set(ledger.map((o) => o.id));
  const ranked = D.districts.filter((d) => d.office_ids.some((id) => ledgerIds.has(id)));
  const unranked = D.districts.filter((d) => !d.office_ids.some((id) => ledgerIds.has(id)));
  for (const d of unranked) ensure(d.attribution === "none", `${d.id} has no engineering office but attribution ${d.attribution}`);
  for (const d of ranked) ensure(d.attribution !== "none", `${d.id} has an engineering office but attribution none`);

  // Office → the label the House bill lists (hgab3 matched_label), tied to the parquet both ways.
  const labelOf = new Map<string, string>();
  for (const o of ledger) {
    const label = o.years.find((y) => y.stage === "hgab3" && y.fy === 2027)?.matched_label ?? null;
    if (!o.fy2027) { ensure(!label || !parquet.byLabel.has(label), `${o.id} has parquet rows under ${label} but no fy2027 block`); continue; }
    ensure(label && !label.includes(" + "), `${o.id} has an fy2027 block but no single House bill label (${label})`);
    ensure(parquet.byLabel.has(label), `${o.id}: label ${label} not in the parquet`);
    ensure(parquet.byLabel.get(label)!.kind === OFFICE_KINDS.deo, `${o.id}: ${label} is office_kind ${parquet.byLabel.get(label)!.kind}, not a district office`);
    labelOf.set(o.id, label);
  }
  ensure(new Set(labelOf.values()).size === labelOf.size, "two offices share one House bill label");
  const deoLabels = [...parquet.byLabel].filter(([, v]) => v.kind === OFFICE_KINDS.deo).map(([l]) => l);
  const mapped = new Set(labelOf.values());
  const orphanLabels = deoLabels.filter((l) => !mapped.has(l));
  ensure(orphanLabels.length === 0, `district-office labels in the parquet with no office: ${orphanLabels.join(", ")}`);

  // Per-office FY2027 slice, tied out to the office's own figures and bridge.
  const officeSlice = new Map<string, LeaderSlice>();
  const officeScope = new Map<string, number>();
  for (const o of ledger) {
    const label = labelOf.get(o.id);
    const s = label ? parquet.byLabel.get(label)!.slice : emptySlice();
    officeScope.set(o.id, label ? parquet.byLabel.get(label)!.scope_rows : 0);
    if (o.fy2027) {
      const b = o.fy2027.bridge;
      ensure(b, `${o.id}: fy2027 block without a bridge`);
      ensure(s.nep_php === (o.fy2027.nep_php ?? 0) && s.hgab3_php === (o.fy2027.hgab3_php ?? 0), `${o.id}: parquet NEP/House sums differ from fy2027`);
      ensure(s.added_rows + s.held_rows === b.house_only.rows && s.added_php + s.held_php === b.house_only.php,
        `${o.id}: added + held (${s.added_rows + s.held_rows} rows, ${peso(s.added_php + s.held_php)}) ≠ bridge house_only (${b.house_only.rows}, ${peso(b.house_only.php)})`);
      ensure(s.dropped_rows === b.nep_only.rows && s.dropped_php === b.nep_only.php,
        `${o.id}: dropped (${s.dropped_rows}, ${peso(s.dropped_php)}) ≠ bridge nep_only (${b.nep_only.rows}, ${peso(b.nep_only.php)})`);
      ensure(officeScope.get(o.id) === b.scope_review.rows, `${o.id}: ${officeScope.get(o.id)} segment-scope lines ≠ bridge scope_review ${b.scope_review.rows}`);
    }
    officeSlice.set(o.id, s);
  }

  // Region of each engineering office.
  const regionOf = new Map<string, string>();
  for (const o of ledger) {
    const k = regionKeyOf(o.region);
    ensure(k && regionOrder.includes(k), `${o.id}: region '${o.region}' does not map to a REGION_ORDER key`);
    regionOf.set(o.id, k);
  }

  // Every office note is classified, ranked or not (an unrecognised pattern stops here).
  const noteKinds = new Map<string, number>();
  for (const o of allOffices) for (const n of o.notes) { const k = classifyNote(o, n); const key = `${k.kind}${k.counts ? " (counts)" : ""}`; noteKinds.set(key, (noteKinds.get(key) ?? 0) + 1); }

  // Groups → entries.
  const termYears = new Map(D.terms.map((t) => [String(t.congress), t.years.filter((fy) => fy !== 2027)]));
  ensure(CONGRESSES.every((c) => termYears.has(c)), "districts.json terms do not list the 18th, 19th and 20th Congress");
  const gaaOf = (o: OfficeHistory, fy: number) => o.years.find((y) => y.stage === "gaa" && y.fy === fy)?.php ?? null;
  const warnings: string[] = [];
  const groups = connectedGroups(ledger, ranked);
  const entries: LeaderEntry[] = groups.map((g) => {
    const offices = [...g.offices].sort((a, b) => byLabel(a.name, b.name));
    const districts = [...g.districts].sort((a, b) => byLabel(a.label, b.label));
    ensure(offices.length > 0 && districts.length > 0, "empty group");
    const tier: "A" | "B" = districts.length === 1 ? "A" : "B";
    const badTier = offices.filter((o) => o.tier !== tier);
    ensure(!badTier.length, `group ${districts.map((d) => d.id).join(", ")} is Tier ${tier} but ${badTier.map((o) => `${o.id} is Tier ${o.tier}`).join(", ")}`);
    for (const d of districts) ensure(d.attribution === tier, `${d.id}: attribution ${d.attribution}, group tier ${tier}`);

    const regions = [...new Set(offices.map((o) => regionOf.get(o.id)!))];
    if (regions.length > 1) warnings.push(`group ${offices.map((o) => o.id).join(" + ")} spans regions ${regions.join(", ")}; using ${regions[0]}`);
    const region = regionOf.get(offices[0].id)!;
    const people = districts.map((d) => {
      const pr = regionKeyOf(d.region) ?? region;
      if (pr !== region) warnings.push(`${d.id}: district region ${d.region} (${pr}) differs from its office region ${region}`);
      return personOf(d, pr);
    });

    const reorganisedNotes = [...new Set(offices.flatMap((o) => reorganisationNotes(o)))];
    const blocks = offices.map((o) => o.fy2027);
    const nep = sumOrNull(blocks.map((f) => f?.nep_php));
    const h3 = sumOrNull(blocks.map((f) => f?.hgab3_php));
    const slice = emptySlice();
    for (const o of offices) addSlice(slice, officeSlice.get(o.id)!);

    const gaa: Record<string, number | null> = {};
    for (const fy of GAA_YEARS) gaa[String(fy)] = sumOrNull(offices.map((o) => gaaOf(o, fy)));
    const gaaYears = GAA_YEARS.filter((fy) => gaa[String(fy)] != null).map(Number);
    const congress = Object.fromEntries(CONGRESSES.map((c) => [c, sumOrNull(offices.map((o) => o.by_congress.find((b) => String(b.congress) === c)?.gaa_php))])) as Record<"18" | "19" | "20", number | null>;
    // cardGrowth: mean annual GAA per office over the term's years with a figure, summed across offices.
    const meanAnnual = (c: string): number | null => {
      let total: number | null = null;
      for (const o of offices) {
        const vals = termYears.get(c)!.map((fy) => gaaOf(o, fy)).filter((v): v is number => v != null);
        if (!vals.length) continue;
        total = (total ?? 0) + vals.reduce((a, b) => a + b, 0) / vals.length;
      }
      return total;
    };

    return {
      key: districts.length === 1 ? districts[0].id : `shared:${offices.map((o) => o.id).sort().join("+")}`,
      tier, region, people,
      offices: offices.map((o) => ({ id: o.id, name: o.name })),
      href: people[0].href,
      nep_php: nep, hgab3_php: h3,
      delta_php: nep != null && h3 != null ? h3 - nep : null,
      delta_pct: nep != null && h3 != null && nep > 0 ? ((h3 - nep) / nep) * 100 : null,
      hgab3_rows: sumOrNull(blocks.map((f) => f?.hgab3_records)),
      added_php: slice.added_php, added_rows: slice.added_rows,
      held_php: slice.held_php, held_rows: slice.held_rows,
      dropped_php: slice.dropped_php, dropped_rows: slice.dropped_rows,
      gaa, gaa_total_php: sumOrNull(Object.values(gaa)), gaa_years: gaaYears,
      congress, growth_pct: pctChange(meanAnnual("20"), meanAnnual("18")),
      reorganised: reorganisedNotes.length > 0, reorganised_notes: reorganisedNotes,
      office_change_rows: new Set(offices.flatMap((o) => o.fy2027?.office_change.row_ids ?? [])).size,
      scope_rows: offices.reduce((a, o) => a + officeScope.get(o.id)!, 0),
    };
  }).sort((a, b) => byLabel(a.people[0].district, b.people[0].district));

  // Integrity of the units.
  const seenOffices = entries.flatMap((e) => e.offices.map((o) => o.id));
  ensure(seenOffices.length === ledger.length && new Set(seenOffices).size === ledger.length, "an engineering office is missing or appears twice");
  const seenDistricts = entries.flatMap((e) => e.people.map((p) => p.district_id));
  ensure(seenDistricts.length === ranked.length && new Set(seenDistricts).size === ranked.length, "a district is missing or appears twice");
  ensure(new Set(entries.map((e) => e.key)).size === entries.length, "duplicate entry keys");

  // Slices: entries add up to the district-office slice; the three kinds add up to everything.
  const entrySum = emptySlice();
  for (const e of entries) addSlice(entrySum, { nep_php: e.nep_php ?? 0, hgab3_php: e.hgab3_php ?? 0, added_php: e.added_php, added_rows: e.added_rows, held_php: e.held_php, held_rows: e.held_rows, dropped_php: e.dropped_php, dropped_rows: e.dropped_rows });
  ensure(sameSlice(entrySum, parquet.byKind.deo), `entries sum ${JSON.stringify(entrySum)} ≠ district offices ${JSON.stringify(parquet.byKind.deo)}`);
  const all = emptySlice();
  for (const k of Object.keys(OFFICE_KINDS) as KindKey[]) addSlice(all, parquet.byKind[k]);
  addSlice(all, parquet.officeChange);
  addSlice(all, parquet.noOffice);
  ensure(all.nep_php === summary.dataset.totals.nep_php && all.hgab3_php === summary.dataset.totals.hgab3_php,
    `parquet totals ${peso(all.nep_php)} / ${peso(all.hgab3_php)} ≠ summary.json ${peso(summary.dataset.totals.nep_php)} / ${peso(summary.dataset.totals.hgab3_php)}`);

  // Regions (district offices only), in REGION_ORDER.
  const regions: LeaderRegion[] = regionOrder.flatMap((key) => {
    const es = entries.filter((e) => e.region === key);
    if (!es.length) return [];
    const s = emptySlice();
    for (const e of es) addSlice(s, { nep_php: e.nep_php ?? 0, hgab3_php: e.hgab3_php ?? 0, added_php: e.added_php, added_rows: e.added_rows, held_php: e.held_php, held_rows: e.held_rows, dropped_php: e.dropped_php, dropped_rows: e.dropped_rows });
    return [{
      region: key, units: es.length, districts: es.reduce((a, e) => a + e.people.length, 0),
      ...s, delta_php: s.hgab3_php - s.nep_php, gaa2026_php: sumOrNull(es.map((e) => e.gaa["2026"])),
    }];
  });

  // Credits: every portrait carries the same attribution and licence and comes from Wikimedia Commons.
  const portraits = entries.flatMap((e) => e.people).filter((p) => p.portrait_url);
  const credits = [...new Set(portraits.map((p) => p.portrait_credit))];
  ensure(credits.length === 1 && credits[0] === "House of Representatives of the Philippines · Public domain",
    `portrait credits are not uniform: ${credits.join(" | ")} — rewrite credits.portraits`);
  ensure(portraits.every((p) => p.portrait_source_url?.startsWith("https://commons.wikimedia.org/")), "a portrait source is not on Wikimedia Commons");
  const fetched = new Date(D.representatives_source.fetched_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Manila" });

  const data: LeaderboardData = {
    schema: LEADERBOARD_SCHEMA, fiscal_year: 2027, built_at: builtAt, source_commit: D.source_commit, dataset: "dpwh",
    totals: {
      all, by_office_kind: { ...parquet.byKind, office_change: parquet.officeChange, no_office: parquet.noOffice },
      gaa_residual: D.residual.filter((r) => r.stage === "gaa").map((r) => ({
        fy: r.fy, total_php: r.total_php, deo_php: r.deo_php, central_office_php: r.central_office_php, regional_offices_php: r.regional_offices_php, unmatched_php: r.unmatched_php,
      })),
      units: entries.length,
      units_tier_a: entries.filter((e) => e.tier === "A").length,
      units_tier_b: entries.filter((e) => e.tier === "B").length,
      districts: seenDistricts.length,
      districts_without_office: unranked.map((d) => ({ id: d.id, label: d.label })).sort((a, b) => byLabel(a.label, b.label)),
    },
    entries, regions,
    credits: {
      portraits: "Photos: House of Representatives of the Philippines, public domain, via Wikimedia Commons",
      representatives: `Representatives from the House 20th Congress directory; bill counts and photos from bills.juris.ph /api/authors, fetched ${fetched}.`,
      documents: "NEP 2027 Volume II-B and House Bill 10858 Volume I-C (third reading), DPWH project lists",
    },
    // Reader-facing: plain sentences of at most 20 words (docs/hgab-copy.md; the verifier enforces it).
    notes: [
      "Amounts belong to DPWH district offices, not to representatives; the documents do not say who asked for any project.",
      "“Added” means no matching NEP project was found for a House bill project: a candidate, not a confirmed insertion.",
      `House bill projects whose NEP match is unconfirmed (${all.held_rows.toLocaleString("en-US")}, worth ${peso(all.held_php)}) are not counted as added.`,
      "Enacted budgets for 2020 to 2026 cover each office’s whole budget; the 2027 figures cover listed projects only.",
    ],
  };
  // JSON.stringify turns NaN and Infinity into null silently; refuse them instead.
  const nonFinite: string[] = [];
  JSON.stringify(data, (k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nonFinite.push(k); return v; });
  ensure(!nonFinite.length, `NaN or Infinity in ${nonFinite.join(", ")}`);
  writeFileSync(outPath, `${JSON.stringify(data, null, 1)}\n`);

  // Summary.
  const shape = new Map<string, number>();
  for (const e of entries) { const k = `${e.people.length} district${e.people.length > 1 ? "s" : ""} / ${e.offices.length} office${e.offices.length > 1 ? "s" : ""}`; shape.set(k, (shape.get(k) ?? 0) + 1); }
  log(`  entries ${entries.length} (Tier A ${data.totals.units_tier_a} · Tier B ${data.totals.units_tier_b}) · districts ranked ${seenDistricts.length} · without an office ${unranked.length} · regions ${regions.length}`);
  log(`  shapes: ${[...shape].sort().map(([k, n]) => `${k} ×${n}`).join(" · ")}`);
  for (const k of ["all", ...Object.keys(OFFICE_KINDS), "office_change", "no_office"] as Array<"all" | KindKey | "office_change" | "no_office">) {
    const s = k === "all" ? all : k === "office_change" ? parquet.officeChange : k === "no_office" ? parquet.noOffice : parquet.byKind[k];
    log(`  ${k.padEnd(8)} NEP ${peso(s.nep_php)} → House ${peso(s.hgab3_php)} · added ${s.added_rows} ${peso(s.added_php)} · held ${s.held_rows} ${peso(s.held_php)} · dropped ${s.dropped_rows} ${peso(s.dropped_php)}`);
  }
  for (const w of warnings) log(`  ! ${w}`);
  log(`  office notes: ${allOffices.filter((o) => o.notes.length).length} offices · ${[...noteKinds].map(([k, n]) => `${k} ×${n}`).join(" · ")}`);
  const reorg = entries.filter((e) => e.reorganised);
  log(`  reorganised entries ${reorg.length}: ${reorg.map((e) => e.key).join(", ")}`);
  log("\n  boards (top 3)");
  const who = (e: LeaderEntry) => e.key;
  for (const b of BOARDS) {
    if (b.kind === "ranking") {
      const r = rankEntries(data, b);
      log(`  ${b.id.padEnd(18)} ${String(r.eligible).padStart(3)} rows · ${r.rows.slice(0, 3).map((x) => `${who(x.entry)} ${formatValue(x.value, b.value)}`).join(" · ")}`);
    } else if (b.kind === "members") {
      const r = rankMembers(data);
      log(`  ${b.id.padEnd(18)} ${String(r.eligible).padStart(3)} rows · ${r.rows.slice(0, 3).map((x) => `${x.person.district_id} ${x.person.name} ${formatValue(x.value, b.value)}`).join(" · ")}`);
    } else if (b.kind === "congress") {
      for (const t of rankByCongress(data, { limit: 3 })) log(`  ${`${b.id} ${t.congress}`.padEnd(18)}     ${t.rows.map((x) => `${who(x.entry)} ${formatValue(x.value, b.value)}`).join(" · ")}`);
    } else if (b.kind === "regions") {
      const r = rankRegions(data, b);
      log(`  ${b.id.padEnd(18)} ${String(r.length).padStart(3)} rows · ${r.slice(0, 3).map((x) => `${x.region.region} ${formatValue(x.value, b.value)}`).join(" · ")}`);
    } else {
      log(`  ${b.id.padEnd(18)}     ${(Object.keys(OFFICE_KINDS) as KindKey[]).map((k) => `${k} ${formatValue(parquet.byKind[k].nep_php, "php")} → ${formatValue(parquet.byKind[k].hgab3_php, "php")}`).join(" · ")}`);
    }
  }
  log("\n  residualLine()");
  for (const b of BOARDS) log(`  ${b.id.padEnd(18)} ${residualLine(data, b) ?? "—"}`);
  log(`\nwrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
