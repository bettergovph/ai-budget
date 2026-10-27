/**
 * Multi-purpose buildings in the FY2027 DPWH lists (`/hgab/2027/multi-purpose-buildings`).
 *
 * Writes what `src/lib/hgab-mpb.ts` describes:
 *
 *   data/hgab/2027/mpb.json   MpbData (slices by kind, office kind, program, office group, region, subtype;
 *                             House amounts; repeated titles; the largest inserted lines; notes)
 *   data/hgab/2027/mpb.csv    every MPB line; UTF-8 with BOM, exact integer pesos, empty = null
 *
 * Read from files the other builders already wrote, nothing re-derived:
 *
 *   overview.json              source commit, datasets, documents, candidate_changes (DPWH insertions)
 *   <dataset>/projects.parquet the rows (npm run import:hgab); fmr/hfep/nia only to confirm no MPB title
 *   dpwh/summary.json          the DPWH stage totals every line must add up to
 *   districts.json             offices (hgab3 matched_label), districts, office-change and no-office ids
 *   leaderboard.json           the office groups (key, tier, region, offices, people) and their added/held pesos
 *
 * Rules (the section's, verbatim):
 *   - an MPB line is a DPWH line whose title as published passes isMpbTitle (MPB_TITLE_RE: "multi-purpose" in any
 *     spelling, the listed misspellings included; not MPB_EXCLUDE_RE: dams, irrigation, impounding); nothing else
 *     is inferred;
 *   - kind = the trace's bridge group through TRACE_LABELS in src/lib/hgab.ts (evaluated from the source, as
 *     build-hgab-d1.ts does: that module reads import.meta.env): house_only = inserted, the held traces
 *     (fuzzy_candidate, ambiguous) included and flagged unconfirmed; nep_only = dropped; the rest by name;
 *   - the House amount is the third reading (hgab3); NEP and House are compared, never added; integer pesos;
 *   - `records` counts the House bill lines a row stands for (grouped repeated keys individually, as
 *     build-hgab-districts.ts counts hgab3_records); a row with no House amount counts its NEP lines;
 *   - a DEO line is booked to the office the House bill lists (hgab3 matched_label in districts.json), then
 *     to that office's leaderboard entry (asserted equal to a union-find over districts.json, as the
 *     leaderboard builds it). Office-change and no-office lines (ids from districts.json), Central Office and
 *     regional lines sit in no group;
 *   - "inserted" for a group's share is the same on both sides: house_only incl. unconfirmed, i.e. the
 *     leaderboard entry's added_php + held_php for all DPWH lines (asserted against the parquet);
 *   - regions by the line's region as published through regionKeyOf, in REGION_ORDER; every line must place.
 *
 *   npm run build:hgab-mpb
 *   npm run build:hgab-mpb -- --out=data/hgab/2027 --contract=src/lib/hgab.ts
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { displayName, type LeaderEntry, type LeaderboardData } from "../src/lib/hgab-leaderboard";
import { houseCitations } from "../src/lib/hgab-citations";
import { CHANGES_LIST_SITE, NO_DISTRICT_REASON, districtsServedText, type DistrictBasis } from "../src/lib/hgab-changes-list";
import {
  MPB_CSV_COLUMNS, MPB_KINDS, MPB_SCHEMA, MPB_SUBTYPES, MPB_TITLE_RE, isMpbTitle, mpbProjectsHref, mpbSubtypeOf, mpbTitleNorm,
  type MpbAmountBucket, type MpbCell, type MpbData, type MpbKind, type MpbLine, type MpbOffice, type MpbRegion,
  type MpbRepeat, type MpbSlice, type MpbSubtype,
} from "../src/lib/hgab-mpb";

// ---------------------------------------------------------------------------
// Inputs (shapes mirror src/lib/hgab.ts; that module reads import.meta.env, so it is not imported)
// ---------------------------------------------------------------------------

interface Doc { key: string; title: string; reading: 2 | 3 | null }
interface DatasetMeta {
  key: string;
  documents: { nep: string[]; house: string[]; controls?: { hgab2: string | null; hgab3: string | null }; same_pages?: { extracted: string; third: string; pages: number } | null };
}
interface Overview {
  source_commit: string; datasets: DatasetMeta[]; documents: Doc[];
  candidate_changes?: { programs: Array<{ key: string; house_stage: string; insertions: { count: number; comparison_rows: number | null; amount_php: number } }> };
}
interface Representative { name: string; status: "resolved" | "ambiguous"; candidates?: Array<{ name: string }> }
interface DistrictCard { id: string; label: string; jurisdiction: string; district_label: string; representative: Representative | null; office_ids: string[] }
interface OfficeHistory {
  id: string; name: string; kind: string; district_ids: string[]; tier: "A" | "B";
  years: Array<{ fy: number; stage: string; matched_label: string | null }>;
  fy2027: unknown | null;
}
interface DistrictIndex {
  source_commit: string; districts: DistrictCard[]; offices: Record<string, OfficeHistory>;
  office_change: { rows: number; row_ids: string[] }; no_office: { rows: number; row_ids: string[] };
}

interface Args { out: string; contract: string }
function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  return { out: resolve(get("out") ?? "data/hgab/2027"), contract: resolve(get("contract") ?? "src/lib/hgab.ts") };
}

const q = (s: string) => s.replace(/'/g, "''");
const log = (s: string) => process.stdout.write(`${s}\n`);
const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : num(v));
const strOrNull = (v: unknown) => (v == null || v === "" ? null : String(v));
const peso = (n: number | null | undefined) => (n == null ? "—" : `₱${n.toLocaleString("en-US")}`);
const byLabel = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`build-hgab-mpb: ${msg}`);
}
function readJson<T>(path: string): T {
  ensure(existsSync(path), `${path} not found`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** csvCell from src/lib/hgab-query.ts: null → empty, numbers as digits, quote when needed. */
function csvCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------------------------------------------------------------------
// Contract (src/lib/hgab.ts): TRACE_LABELS, REGION_ORDER and regionKeyOf, transpiled from source and evaluated
// ---------------------------------------------------------------------------

interface ContractEval {
  TRACE_LABELS: Record<string, { label: string; group: string; held?: boolean }>;
  REGION_ORDER: string[];
  regionKeyOf: (l: string | null | undefined) => string | null;
}
function evalContract(path: string): ContractEval {
  const src = readFileSync(path, "utf8");
  const block = (re: RegExp, what: string) => {
    const m = re.exec(src);
    ensure(m, `${what} not found in ${path}`);
    return m[1].replace(/^export /gm, "");
  };
  const code = [
    block(/(export const TRACE_LABELS[\s\S]*?\n\};)/, "TRACE_LABELS"),
    block(/(export const REGION_ORDER[\s\S]*?\n\];)/, "REGION_ORDER"),
    block(/(const ROMAN[\s\S]*?\nexport function regionKeyOf[\s\S]*?\n\})/, "regionKeyOf"),
  ].join("\n");
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(`${js}\nreturn { TRACE_LABELS, REGION_ORDER, regionKeyOf };`)() as ContractEval;
}

const KIND_OF_GROUP: Record<string, MpbKind> = {
  house_only: "inserted", nep_only: "dropped", increased: "increased", decreased: "decreased", scope_review: "scope_review", unchanged: "unchanged",
};

// ---------------------------------------------------------------------------
// Office groups: union-find over district offices and the districts they serve (officeGroupsOf in
// build-hgab-changes-list.ts / connectedGroups in build-hgab-leaderboard.ts), used only to check leaderboard.json
// ---------------------------------------------------------------------------

function officeGroupsOf(D: DistrictIndex): Map<string, { offices: string[]; districts: string[] }> {
  const cards = new Map(D.districts.map((d) => [d.id, d] as const));
  const ledger = Object.values(D.offices).filter((o) => o.kind !== "regional_group");
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let y = x;
    while (parent.get(y) !== r) { const next = parent.get(y)!; parent.set(y, r); y = next; }
    return r;
  };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const o of ledger) parent.set(`o:${o.id}`, `o:${o.id}`);
  for (const d of D.districts) parent.set(`d:${d.id}`, `d:${d.id}`);
  for (const o of ledger) for (const id of o.district_ids) if (cards.has(id)) union(`o:${o.id}`, `d:${id}`);
  for (const d of D.districts) for (const id of d.office_ids) if (parent.has(`o:${id}`)) union(`d:${d.id}`, `o:${id}`);
  const parts = new Map<string, { offices: string[]; districts: string[] }>();
  const at = (k: string) => { const r = find(k); let g = parts.get(r); if (!g) { g = { offices: [], districts: [] }; parts.set(r, g); } return g; };
  for (const o of ledger) at(`o:${o.id}`).offices.push(o.id);
  for (const d of D.districts) at(`d:${d.id}`).districts.push(d.id);
  const byOffice = new Map<string, { offices: string[]; districts: string[] }>();
  for (const g of parts.values()) for (const o of g.offices) byOffice.set(o, g);
  return byOffice;
}

/** repName in src/lib/hgab-districts.ts: an ambiguous seat lists every member named. */
function repName(rep: Representative | null): string | null {
  if (!rep) return null;
  if (rep.status === "ambiguous") {
    if (rep.name) return rep.name;
    const names = (rep.candidates ?? []).map((c) => c.name).filter(Boolean);
    return names.length ? names.join(" / ") : null;
  }
  return rep.name || null;
}

// ---------------------------------------------------------------------------
// Slices
// ---------------------------------------------------------------------------

const emptyCell = (): MpbCell => ({ rows: 0, records: 0, nep_php: 0, house_php: 0 });
const emptySlice = (): MpbSlice => ({
  kinds: Object.fromEntries(MPB_KINDS.map((k) => [k, emptyCell()])) as MpbSlice["kinds"],
  all: emptyCell(), unconfirmed: { rows: 0, php: 0 },
});
function addCell(c: MpbCell, x: Line): void {
  c.rows++; c.records += x.records; c.nep_php += x.nep ?? 0; c.house_php += x.house ?? 0;
}
function addLine(s: MpbSlice, x: Line): void {
  addCell(s.kinds[x.kind], x);
  addCell(s.all, x);
  if (x.unconfirmed) { s.unconfirmed.rows++; s.unconfirmed.php += x.house ?? 0; }
}
function sliceOf(lines: Line[]): MpbSlice {
  const s = emptySlice();
  for (const x of lines) addLine(s, x);
  return s;
}
const sameCell = (a: MpbCell, b: MpbCell) => a.rows === b.rows && a.records === b.records && a.nep_php === b.nep_php && a.house_php === b.house_php;
function sumSlices(xs: MpbSlice[]): MpbSlice {
  const s = emptySlice();
  for (const x of xs) {
    for (const k of MPB_KINDS) for (const f of ["rows", "records", "nep_php", "house_php"] as const) s.kinds[k][f] += x.kinds[k][f];
    for (const f of ["rows", "records", "nep_php", "house_php"] as const) s.all[f] += x.all[f];
    s.unconfirmed.rows += x.unconfirmed.rows; s.unconfirmed.php += x.unconfirmed.php;
  }
  return s;
}
function sameSlice(a: MpbSlice, b: MpbSlice): boolean {
  return MPB_KINDS.every((k) => sameCell(a.kinds[k], b.kinds[k])) && sameCell(a.all, b.all) && a.unconfirmed.rows === b.unconfirmed.rows && a.unconfirmed.php === b.unconfirmed.php;
}

/** Nearest-rank percentile of an ascending list (an amount that is actually listed; integer pesos). */
function nearestRank(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

interface Line {
  id: string; trace: string; kind: MpbKind; unconfirmed: boolean; statusLabel: string;
  title: string; program: string; region: string | null; regionKey: string; office: string; officeKind: string;
  nep: number | null; house: number | null; delta: number | null; records: number;
  basis: DistrictBasis; officeId: string | null; entry: LeaderEntry | null; subtype: string;
  nepDoc: string | null; nepPage: number | null; houseDoc: string | null; housePage: number | null;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const builtAt = new Date().toISOString();
  const overview = readJson<Overview>(resolve(args.out, "overview.json"));
  const D = readJson<DistrictIndex>(resolve(args.out, "districts.json"));
  const LB = readJson<LeaderboardData>(resolve(args.out, "leaderboard.json"));
  const summary = readJson<{ dataset: { key: string; totals: { nep_php: number; hgab3_php: number | null }; counts?: Record<string, number | null> } }>(resolve(args.out, "dpwh", "summary.json"));
  ensure(D.source_commit === overview.source_commit, `districts.json source_commit ${D.source_commit} ≠ overview.json ${overview.source_commit} — rebuild districts`);
  ensure(LB.source_commit === overview.source_commit, `leaderboard.json source_commit ${LB.source_commit} ≠ overview.json ${overview.source_commit} — rebuild the leaderboard`);
  ensure(summary.dataset.key === "dpwh" && summary.dataset.totals.hgab3_php != null, "dpwh/summary.json has no DPWH House bill total");
  const ccDpwh = overview.candidate_changes?.programs.find((p) => p.key === "dpwh");
  ensure(ccDpwh && ccDpwh.house_stage === "hgab3", "overview.json candidate_changes has no DPWH program compared at the third reading");
  const meta = overview.datasets.find((d) => d.key === "dpwh");
  ensure(meta, "overview.json has no dpwh dataset");
  const docTitle = new Map(overview.documents.map((d) => [d.key, d.title] as const));

  // Contract.
  const C = evalContract(args.contract);
  const traces = C.TRACE_LABELS;
  const held = Object.entries(traces).filter(([, t]) => t.held).map(([k]) => k).sort();
  ensure(held.join() === "ambiguous,fuzzy_candidate", `TRACE_LABELS held traces are ${held.join(", ")}, not fuzzy_candidate + ambiguous`);
  ensure(Object.values(traces).filter((t) => t.held).every((t) => t.group === "house_only"), "a held trace is outside house_only");
  for (const [k, t] of Object.entries(traces)) ensure(KIND_OF_GROUP[t.group], `TRACE_LABELS ${k}: group ${t.group} has no MPB kind`);
  ensure(C.REGION_ORDER.length === 18, `REGION_ORDER has ${C.REGION_ORDER.length} regions`);

  // Offices: House bill label → office id (hgab3 matched_label, as build-hgab-districts.ts wrote it) → leaderboard entry.
  const officeOfLabel = new Map<string, string>();
  for (const o of Object.values(D.offices)) {
    if (o.kind === "regional_group" || !o.fy2027) continue;
    const label = o.years.find((y) => y.fy === 2027 && y.stage === "hgab3" && y.matched_label)?.matched_label ?? null;
    ensure(label && !label.includes(" + "), `${o.id} has 2027 figures but no single House bill label (${label})`);
    ensure(!officeOfLabel.has(label), `two offices share the House bill label ${label}`);
    officeOfLabel.set(label, o.id);
  }
  const labelOfOffice = new Map([...officeOfLabel].map(([l, id]) => [id, l] as const));
  const entryOf = new Map<string, LeaderEntry>();
  for (const e of LB.entries) for (const o of e.offices) { ensure(!entryOf.has(o.id), `${o.id} sits in two leaderboard entries`); entryOf.set(o.id, e); }
  // The leaderboard's groups are the union-find groups (same offices, same districts, same key rule).
  const uf = officeGroupsOf(D);
  for (const e of LB.entries) {
    const g = uf.get(e.offices[0].id);
    ensure(g, `${e.key}: office ${e.offices[0].id} is in no union-find group`);
    const wantOffices = [...g.offices].sort().join(), haveOffices = e.offices.map((o) => o.id).sort().join();
    const wantDistricts = [...g.districts].sort().join(), haveDistricts = e.people.map((p) => p.district_id).sort().join();
    const wantKey = g.districts.length === 1 ? g.districts[0] : `shared:${[...g.offices].sort().join("+")}`;
    ensure(wantOffices === haveOffices && wantDistricts === haveDistricts && wantKey === e.key && e.tier === (g.districts.length > 1 ? "B" : "A"),
      `leaderboard entry ${e.key} ≠ the union-find group (${wantKey}: ${wantOffices} / ${wantDistricts}) — rebuild the leaderboard`);
  }
  const officeChange = new Set(D.office_change.row_ids);
  const noOffice = new Set(D.no_office.row_ids);
  ensure(officeChange.size === D.office_change.rows && noOffice.size === D.no_office.rows, "districts.json office_change / no_office row ids disagree with their counts");

  // The three lists: no title there is an MPB (the page and the notes say DPWH only).
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  const otherHits: Record<string, number> = {};
  for (const key of ["fmr", "hfep", "nia"]) {
    const parquet = resolve(args.out, key, "projects.parquet");
    ensure(existsSync(parquet), `${parquet} not found — run npm run import:hgab`);
    const titles = (await c.runAndReadAll(`SELECT title FROM read_parquet('${q(parquet)}')`)).getRows();
    otherHits[key] = titles.filter((r) => isMpbTitle(String(r[0] ?? ""))).length;
  }
  ensure(Object.values(otherHits).every((n) => n === 0), `the three lists carry MPB titles (${JSON.stringify(otherHits)}): the notes and the page say DPWH only — decide before building`);

  // DPWH: every line (the comparison base and each group's inserted pesos), MPB lines kept.
  const parquet = resolve(args.out, "dpwh", "projects.parquet");
  ensure(existsSync(parquet), `${parquet} not found — run npm run import:hgab`);
  const rows = (await c.runAndReadAll(`
    SELECT id, trace, title, program, region, office, office_kind, nep_php, hgab3_php, delta_php,
           nep_doc, nep_page, hgab2_doc, hgab2_page, hgab3_doc, hgab3_page,
           CASE WHEN hgab3_php IS NOT NULL THEN coalesce(json_array_length(record_json->'$.third.records'), 1) ELSE 0 END,
           CASE WHEN nep_php IS NOT NULL THEN coalesce(json_array_length(record_json->'$.nep.records'), 1) ELSE 0 END
    FROM read_parquet('${q(parquet)}') ORDER BY id`)).getRows();
  c.closeSync(); db.closeSync();

  const dpwh = { rows: 0, house_php: 0, nep_php: 0, inserted_rows: 0, inserted_php: 0 };
  const groupInserted = new Map<string, number>();
  const lines: Line[] = [];
  const ids = new Set<string>();
  /** For the log: lines counted only through a dash or a misspelling, and lines MPB_EXCLUDE_RE leaves out. */
  const variants: string[] = [], excluded: string[] = [];
  let heldOutSeen = 0;
  for (const r of rows) {
    const id = String(r[0]);
    ensure(!ids.has(id), `dpwh: duplicate id ${id}`);
    ids.add(id);
    const trace = String(r[1]);
    const t = traces[trace];
    ensure(t, `dpwh ${id}: trace ${trace} is not in TRACE_LABELS`);
    const kind = KIND_OF_GROUP[t.group];
    const nep = numOrNull(r[7]), house = numOrNull(r[8]), delta = numOrNull(r[9]);
    const office = strOrNull(r[5]), officeKind = strOrNull(r[6]);
    ensure(office && officeKind, `dpwh ${id}: no office`);
    ensure(nep != null || house != null, `dpwh ${id}: neither amount`);
    let basis: DistrictBasis;
    if (officeChange.has(id)) basis = "office_change";
    else if (noOffice.has(id)) basis = "no_office";
    else if (officeKind === "Central Office") basis = "central";
    else if (officeKind === "Regional offices") basis = "regional";
    else { ensure(officeKind === "District engineering offices (DEOs)", `dpwh ${id}: office_kind ${officeKind}`); basis = "office"; }
    if (basis === "office_change" || basis === "no_office") heldOutSeen++;
    let officeId: string | null = null, entry: LeaderEntry | null = null;
    if (basis === "office") {
      officeId = officeOfLabel.get(office) ?? null;
      ensure(officeId, `dpwh ${id}: district office label "${office}" maps to no office in districts.json`);
      entry = entryOf.get(officeId) ?? null;
      ensure(entry, `dpwh ${id}: ${officeId} is in no leaderboard entry`);
    }
    dpwh.rows++; dpwh.nep_php += nep ?? 0; dpwh.house_php += house ?? 0;
    if (kind === "inserted") {
      ensure(nep == null && house != null && delta == null, `dpwh ${id}: an insertion with NEP ${peso(nep)}, House ${peso(house)}, delta ${peso(delta)}`);
      dpwh.inserted_rows++; dpwh.inserted_php += house;
      if (entry) groupInserted.set(entry.key, (groupInserted.get(entry.key) ?? 0) + house);
    }
    const title = String(r[2] ?? "");
    if (!isMpbTitle(title)) {
      if (MPB_TITLE_RE.test(title)) excluded.push(`${id} ${peso(house ?? nep)} ${title}`);
      continue;
    }
    if (!/multi[\s-]*purpose/i.test(title)) variants.push(`${id} ${title}`);

    if (kind === "dropped") ensure(nep != null && house == null, `dpwh ${id}: dropped with House ${peso(house)}`);
    if (kind === "increased" || kind === "decreased" || kind === "unchanged") {
      ensure(nep != null && house != null && delta === house - nep, `dpwh ${id}: ${kind} with NEP ${peso(nep)}, House ${peso(house)}, delta ${peso(delta)}`);
      ensure(kind === "increased" ? delta > 0 : kind === "decreased" ? delta < 0 : delta === 0, `dpwh ${id}: ${kind} with delta ${peso(delta)}`);
    }
    const region = strOrNull(r[4]);
    const regionKey = C.regionKeyOf(region);
    ensure(regionKey && C.REGION_ORDER.includes(regionKey), `dpwh ${id}: region "${region}" does not place on REGION_ORDER — every MPB line must`);
    const records = house != null ? num(r[16]) : num(r[17]);
    ensure(records >= 1, `dpwh ${id}: ${records} records`);
    const third = houseCitations(
      { hgab2_page: numOrNull(r[13]), hgab3_page: numOrNull(r[15]), hgab2_doc: strOrNull(r[12]), hgab3_doc: strOrNull(r[14]) },
      meta, overview.documents,
    ).filter((x) => x.reading === 3);
    ensure(house == null || third.length === 1, `dpwh ${id}: ${third.length} third-reading House pages`);
    const nepDoc = strOrNull(r[10]), nepPage = numOrNull(r[11]);
    ensure(nep == null || (nepDoc && nepPage), `dpwh ${id}: an NEP amount without its page`);
    ensure(title.trim() !== "", `dpwh ${id}: no title`);
    lines.push({
      id, trace, kind, unconfirmed: Boolean(t.held), statusLabel: t.label, title, program: String(r[3] ?? ""),
      region, regionKey, office, officeKind, nep, house, delta, records, basis, officeId, entry, subtype: mpbSubtypeOf(title),
      nepDoc: nep == null ? null : nepDoc, nepPage: nep == null ? null : nepPage,
      houseDoc: third[0]?.doc ?? null, housePage: third[0]?.page ?? null,
    });
  }
  ensure(heldOutSeen === officeChange.size + noOffice.size, `${officeChange.size + noOffice.size - heldOutSeen} office-change or no-office ids from districts.json are not in the parquet`);

  // The comparison base ties out: DPWH totals = summary.json; insertions = candidate_changes; each group's
  // inserted pesos = its leaderboard added + held; Σ groups = the leaderboard's district-office slice.
  ensure(dpwh.nep_php === summary.dataset.totals.nep_php && dpwh.house_php === summary.dataset.totals.hgab3_php,
    `DPWH lines ${peso(dpwh.nep_php)} / ${peso(dpwh.house_php)} ≠ summary.json ${peso(summary.dataset.totals.nep_php)} / ${peso(summary.dataset.totals.hgab3_php)}`);
  ensure(dpwh.inserted_rows === (ccDpwh.insertions.comparison_rows ?? ccDpwh.insertions.count) && dpwh.inserted_php === ccDpwh.insertions.amount_php,
    `DPWH insertions ${dpwh.inserted_rows} rows ${peso(dpwh.inserted_php)} ≠ candidate_changes ${ccDpwh.insertions.comparison_rows} ${peso(ccDpwh.insertions.amount_php)}`);
  for (const e of LB.entries) {
    ensure((groupInserted.get(e.key) ?? 0) === e.added_php + e.held_php, `${e.key}: inserted ${peso(groupInserted.get(e.key) ?? 0)} ≠ leaderboard added + held ${peso(e.added_php + e.held_php)}`);
  }
  const deo = LB.totals.by_office_kind.deo;
  ensure([...groupInserted.values()].reduce((a, b) => a + b, 0) === deo.added_php + deo.held_php, "Σ group inserted pesos ≠ the leaderboard's district-office added + held");

  // ---- Slices
  const totals = sliceOf(lines);
  const basisKey: Record<DistrictBasis, keyof MpbData["by_office_kind"]> = { office: "deo", central: "central", regional: "regional", office_change: "office_change", no_office: "no_office" };
  const by_office_kind = Object.fromEntries((["deo", "central", "regional", "office_change", "no_office"] as const)
    .map((k) => [k, sliceOf(lines.filter((x) => basisKey[x.basis] === k))])) as MpbData["by_office_kind"];
  ensure(sameSlice(sumSlices(Object.values(by_office_kind)), totals), "office kinds do not add up to the totals");

  const programs = [...new Set(lines.map((x) => x.program))];
  const by_program = programs.map((program) => ({ program, ...sliceOf(lines.filter((x) => x.program === program)) }))
    .sort((a, b) => b.all.rows - a.all.rows || byLabel(a.program, b.program));
  ensure(sameSlice(sumSlices(by_program), totals), "programs do not add up to the totals");

  // Office groups with at least one MPB line, inserted pesos largest first.
  const grouped = new Map<string, Line[]>();
  for (const x of lines) if (x.entry) grouped.set(x.entry.key, [...(grouped.get(x.entry.key) ?? []), x]);
  const offices: MpbOffice[] = [...grouped].map(([key, xs]) => {
    const e = LB.entries.find((y) => y.key === key)!;
    const s = sliceOf(xs);
    const officeRows = e.offices.map((o) => {
      const label = labelOfOffice.get(o.id) ?? null;
      return { id: o.id, name: o.name, label, rows: xs.filter((x) => x.officeId === o.id).length, href: label ? mpbProjectsHref({ deo: label }) : null };
    });
    ensure(officeRows.reduce((a, o) => a + o.rows, 0) === xs.length, `${key}: lines booked to offices outside the entry`);
    const lead = [...officeRows].sort((a, b) => b.rows - a.rows)[0];
    ensure(lead.href, `${key}: the office with the most MPB lines has no House bill label`);
    const insertedAll = groupInserted.get(key) ?? 0;
    ensure(s.kinds.inserted.house_php <= insertedAll, `${key}: MPB inserted pesos exceed the group's inserted pesos`);
    return {
      key, tier: e.tier, region: e.region, offices: officeRows,
      people: e.people.map((p) => ({ district_id: p.district_id, district: p.district, jurisdiction: p.jurisdiction, district_label: p.district_label, name: p.name, status: p.status, portrait_url: p.portrait_url, href: p.href })),
      ...s,
      inserted_mpb_share: insertedAll > 0 ? s.kinds.inserted.house_php / insertedAll : null,
      inserted_all_php: insertedAll,
      href: lead.href,
    };
  }).sort((a, b) => b.kinds.inserted.house_php - a.kinds.inserted.house_php || b.all.house_php - a.all.house_php || byLabel(a.key, b.key));
  ensure(sameSlice(sumSlices(offices), by_office_kind.deo), "office groups do not add up to the district-office slice");

  // Regions in REGION_ORDER (those with MPB lines), every office kind.
  const regions: MpbRegion[] = C.REGION_ORDER.flatMap((key) => {
    const xs = lines.filter((x) => x.regionKey === key);
    if (!xs.length) return [];
    const central = emptyCell(), centralInserted = emptyCell();
    for (const x of xs) if (x.basis === "central") { addCell(central, x); if (x.kind === "inserted") addCell(centralInserted, x); }
    const published = [...new Set(xs.map((x) => x.region!))].sort(byLabel);
    return [{
      region: key, ...sliceOf(xs), central, central_inserted: centralInserted,
      offices: new Set(xs.map((x) => x.office)).size, published, href: mpbProjectsHref({ region: published.join("|") }),
    }];
  });
  ensure(sameSlice(sumSlices(regions), totals), "regions do not add up to the totals");
  ensure(sameCell(regions.reduce((c2, r) => ({ rows: c2.rows + r.central.rows, records: c2.records + r.central.records, nep_php: c2.nep_php + r.central.nep_php, house_php: c2.house_php + r.central.house_php }), emptyCell()), by_office_kind.central.all),
    "regions' Central Office parts do not add up to the Central Office slice");

  // Subtypes, every key in MPB_SUBTYPES order.
  const subtypes: MpbSubtype[] = MPB_SUBTYPES.map((s) => ({ key: s.key, label: s.label, ...sliceOf(lines.filter((x) => x.subtype === s.key)) }));
  ensure(subtypes.some((s) => s.key === "other") && sameSlice(sumSlices(subtypes), totals), "subtypes do not partition the lines");

  // House amounts (lines with a House amount; a grouped line counts once, at its House amount).
  const withHouse = lines.filter((x) => x.house != null);
  const buckets = new Map<number, MpbAmountBucket>();
  for (const x of withHouse) {
    const b = buckets.get(x.house!) ?? { php: x.house!, rows: 0, inserted_rows: 0 };
    b.rows++; if (x.kind === "inserted") b.inserted_rows++;
    buckets.set(x.house!, b);
  }
  const sortedHouse = withHouse.map((x) => x.house!).sort((a, b) => a - b);
  const amounts: MpbData["amounts"] = {
    top: [...buckets.values()].sort((a, b) => b.rows - a.rows || b.php - a.php).slice(0, 15),
    house_lines: withHouse.length,
    multiple_of_1m: withHouse.filter((x) => x.house! % 1_000_000 === 0).length,
    multiple_of_500k: withHouse.filter((x) => x.house! % 500_000 === 0).length,
    median_php: nearestRank(sortedHouse, 0.5), p90_php: nearestRank(sortedHouse, 0.9), max_php: sortedHouse.length ? sortedHouse[sortedHouse.length - 1] : null,
  };

  // Repeats: one normalised title (mpbTitleNorm: coordinates removed) on at least two House bill lines under one
  // office, a grouped row counting each of its lines (the source folds an identical title and office listed twice
  // into one row). Most lines first, then pesos; top 100.
  const rep = new Map<string, Line[]>();
  for (const x of withHouse) { const k = `${x.office}\u0000${mpbTitleNorm(x.title)}`; rep.set(k, [...(rep.get(k) ?? []), x]); }
  const repeatsAll: MpbRepeat[] = [...rep].map(([k, xs]) => [k, [...xs].sort((a, b) => byLabel(a.id, b.id))] as const).map(([k, xs]) => ({
    title_norm: k.split("\u0000")[1], title: xs[0].title, office: xs[0].office, rows: xs.reduce((a, x) => a + x.records, 0),
    inserted_rows: xs.filter((x) => x.kind === "inserted").reduce((a, x) => a + x.records, 0),
    house_php: xs.reduce((a, x) => a + x.house!, 0), ids: xs.map((x) => x.id).sort(byLabel),
  })).filter((r) => r.rows >= 2)
    .sort((a, b) => b.rows - a.rows || b.house_php - a.house_php || byLabel(a.office ?? "", b.office ?? "") || byLabel(a.title_norm, b.title_norm));
  const repeats = repeatsAll.slice(0, 100);

  // The largest inserted lines.
  const lineOut = (x: Line): MpbLine => ({
    id: x.id, kind: x.kind, unconfirmed: x.unconfirmed, title: x.title, nep_php: x.nep, house_php: x.house, delta_php: x.delta,
    region: x.region, office: x.office, basis: x.basis, group: x.entry?.key ?? null, href: `/hgab/2027/dpwh/p/${encodeURIComponent(x.id)}`,
  });
  const largest_inserted = lines.filter((x) => x.kind === "inserted").sort((a, b) => b.house! - a.house! || byLabel(a.id, b.id)).slice(0, 100).map(lineOut);

  // Reader-facing notes (docs/hgab-copy.md: plain sentences of at most 20 words).
  const notes = [
    "A multi-purpose building is any DPWH project whose title says “multi-purpose”, misspellings included; nothing else is inferred.",
    "Water projects that only use the phrase, such as dams, irrigation and impounding systems, are left out.",
    "“Inserted” means no matching NEP project was found: a candidate, not a confirmed insertion; unconfirmed matches are flagged.",
    "Amounts belong to DPWH offices, not to representatives; the documents do not say who asked for any project.",
    "Repeated titles under one office are leads to check: they may be phases of one project or different sites.",
    "No farm-to-market road, health facility or irrigation project in either document has such a title.",
  ];
  ensure(notes.every((n) => words(n) <= 20), `a note is longer than 20 words: ${notes.filter((n) => words(n) > 20).join(" | ")}`);

  const data: MpbData = {
    schema: MPB_SCHEMA, fiscal_year: 2027, built_at: builtAt, source_commit: overview.source_commit,
    definition: "A DPWH project line whose title, as published, contains “multi-purpose” in any spelling, common misspellings included; water projects (dams, irrigation, impounding systems) that only use the phrase are left out.",
    dpwh, totals, by_office_kind, by_program, offices, regions, subtypes, amounts, repeats, largest_inserted, notes,
  };
  const nonFinite: string[] = [];
  JSON.stringify(data, (k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nonFinite.push(k); return v; });
  ensure(!nonFinite.length, `NaN or Infinity in ${nonFinite.join(", ")}`);
  const jsonPath = resolve(args.out, "mpb.json");
  writeFileSync(jsonPath, `${JSON.stringify(data, null, 1)}\n`);

  // ---- CSV: every MPB line, kind order (as MPB_KINDS), House amount largest first (none last), NEP, id.
  const kindRank = new Map(MPB_KINDS.map((k, i) => [k, i]));
  const csvLines = [...lines].sort((a, b) => kindRank.get(a.kind)! - kindRank.get(b.kind)! || (b.house ?? -1) - (a.house ?? -1) || (b.nep ?? -1) - (a.nep ?? -1) || byLabel(a.id, b.id));
  const cards = new Map(D.districts.map((d) => [d.id, d] as const));
  const subtypeLabel = new Map(MPB_SUBTYPES.map((s) => [s.key, s.label]));
  const docPrefix = (key: string | null) => (key ? (docTitle.get(key) ?? key).split(":")[0] : null);
  const pagesText = (x: Line) => [
    x.nepPage != null ? `${docPrefix(x.nepDoc)}, PDF page ${x.nepPage}` : null,
    x.housePage != null ? `${docPrefix(x.houseDoc)}, third reading, PDF page ${x.housePage}` : null,
  ].filter(Boolean).join("; ");
  const body = csvLines.map((x) => {
    const ds = x.entry ? [...x.entry.people].sort((a, b) => byLabel(a.district, b.district)).map((p) => cards.get(p.district_id)!) : null;
    ensure(!ds || ds.every(Boolean), `${x.id}: a district of ${x.entry?.key} is not in districts.json`);
    const cells: Record<(typeof MPB_CSV_COLUMNS)[number], unknown> = {
      program: x.program, kind: x.kind, status_label: x.statusLabel, unconfirmed_match: x.unconfirmed ? "yes" : null, title: x.title,
      nep_php: x.nep, house_php: x.house, change_php: x.kind === "inserted" || x.kind === "dropped" ? null : x.delta,
      region: x.region, dpwh_office: x.office, tier: x.entry?.tier ?? null,
      legislative_districts_served: ds ? districtsServedText(ds) : null,
      representatives_of_those_districts: ds ? ds.map((d) => displayName(repName(d.representative))).join("; ") : null,
      no_district_reason: x.basis === "office" ? null : NO_DISTRICT_REASON[x.basis],
      subtype: subtypeLabel.get(x.subtype), record_url: `${CHANGES_LIST_SITE}/hgab/2027/dpwh/p/${encodeURIComponent(x.id)}`, pages: pagesText(x) || null,
    };
    return MPB_CSV_COLUMNS.map((k) => csvCell(cells[k])).join(",");
  });
  const csvPath = resolve(args.out, "mpb.csv");
  writeFileSync(csvPath, `\uFEFF${[MPB_CSV_COLUMNS.join(","), ...body].join("\n")}\n`);

  // ---- Summary
  const k = totals.kinds;
  log(`wrote ${jsonPath} (${(readFileSync(jsonPath).length / 1024).toFixed(0)} KB) and ${csvPath} (${(readFileSync(csvPath).length / 1024 / 1024).toFixed(2)} MB)`);
  log(`  MPB ${totals.all.rows.toLocaleString("en-US")} of ${dpwh.rows.toLocaleString("en-US")} DPWH lines · NEP ${peso(totals.all.nep_php)} · House ${peso(totals.all.house_php)} · none in fmr/hfep/nia`);
  log(`  counted only through a dash or misspelling (${variants.length}):${variants.map((v) => `\n    + ${v}`).join("")}`);
  log(`  left out by MPB_EXCLUDE_RE (${excluded.length}):${excluded.map((v) => `\n    - ${v}`).join("")}`);
  for (const kk of MPB_KINDS) log(`  ${kk.padEnd(13)} ${String(k[kk].rows).padStart(5)} rows ${String(k[kk].records).padStart(5)} records · NEP ${peso(k[kk].nep_php)} · House ${peso(k[kk].house_php)}`);
  log(`  unconfirmed ${totals.unconfirmed.rows} ${peso(totals.unconfirmed.php)}`);
  for (const [kk, s] of Object.entries(by_office_kind)) log(`  by office kind ${kk.padEnd(13)} ${s.all.rows} rows · House ${peso(s.all.house_php)} · inserted ${s.kinds.inserted.rows} ${peso(s.kinds.inserted.house_php)}`);
  for (const p of by_program) log(`  program ${p.program}: ${p.all.rows} rows · House ${peso(p.all.house_php)}`);
  log(`  office groups ${offices.length}; top 10 by inserted MPB pesos:`);
  for (const o of offices.slice(0, 10)) log(`    ${o.key.padEnd(40)} ${o.tier} ${o.region.padEnd(8)} inserted ${String(o.kinds.inserted.rows).padStart(3)} ${peso(o.kinds.inserted.house_php).padStart(16)} of ${peso(o.inserted_all_php).padStart(16)} (${o.inserted_mpb_share == null ? "—" : `${(o.inserted_mpb_share * 100).toFixed(1)}%`})`);
  log(`  regions: ${regions.map((r) => `${r.region} ${r.all.rows} ${peso(r.kinds.inserted.house_php)}`).join(" · ")}`);
  log(`  subtypes: ${subtypes.map((s) => `${s.key} ${s.all.rows}`).join(" · ")}`);
  log(`  amounts: ${amounts.house_lines} House lines · ×₱1M ${amounts.multiple_of_1m} · ×₱500k ${amounts.multiple_of_500k} · median ${peso(amounts.median_php)} · p90 ${peso(amounts.p90_php)} · max ${peso(amounts.max_php)}`);
  log(`  top amounts: ${amounts.top.slice(0, 6).map((b) => `${peso(b.php)} ×${b.rows}`).join(" · ")}`);
  log(`  repeats: ${repeatsAll.length} titles repeated under one office (${repeatsAll.reduce((a, r) => a + r.rows, 0)} lines); top: ${repeats.slice(0, 5).map((r) => `${r.rows}× "${r.title_norm.slice(0, 50)}" (${r.office})`).join(" · ")}`);
  log(`  largest inserted: ${largest_inserted.slice(0, 3).map((x) => `${x.id} ${peso(x.house_php)}`).join(" · ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
