/**
 * Districts index for the HGAB section (`/hgab/2027/districts`): the DEO lens.
 *
 * One card per legislative district, listing the DPWH district engineering
 * office(s) the DEO2LEG crosswalk associates with it, each office's budget
 * history (FY2020–2026 enacted GAA, FY2027 NEP, FY2027 House bill third
 * reading), the FY2027 House-vs-NEP bridge for the office's rows, and the
 * current representative from bills.juris.ph. Emits what `src/lib/hgab.ts`
 * (`HgabDistrictIndex`) describes:
 *
 *   data/hgab/2027/districts.json            HgabDistrictIndex
 *   data/hgab/2027/districts-manifest.json   provenance: inputs + sha256, coverage, aliases
 *   data/hgab/2027/juris-authors.json        cached bills.juris.ph /api/authors response
 *
 * Rules (DEO2LEG/README.md, "The one authorized project-level use"):
 *   - money is grouped by the office the source documents print; nothing infers
 *     which district a project is in;
 *   - a shared office's money is never divided (Tier B = undivided range);
 *   - a 2027 line whose NEP and House sides name different office groups, or a
 *     district office on one side and none on the other, is held out of every
 *     office and of the residual as `office_change` (condition 3; the source's
 *     buildCongressIndex.mjs classifyRow, ported below);
 *   - the Central Office / regional / unmatched residual is published per year
 *     and stage and must satisfy deo + central + regional + unmatched = total;
 *   - a predecessor office's history is never split across successors: it stays
 *     in the residual and each successor carries a note;
 *   - integer pesos; null means "no record", never 0; GAA/NEP whole-department
 *     scope is never summed with the HGAB operations population;
 *   - the crosswalk's scanned allocation amounts are not used anywhere.
 *
 *   npm run build:hgab-districts
 *   npm run build:hgab-districts -- --src=/tmp/dpwh-nep-review/repo --out=data/hgab/2027 --offline
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Contract (mirrors src/lib/hgab.ts; the verifier re-reads that file)
// ---------------------------------------------------------------------------

const FISCAL_YEAR = 2027;
const GAA_YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026] as const;

interface CongressTerm { congress: number; label: string; years: number[]; note: string }
const CONGRESS_TERMS: readonly CongressTerm[] = [
  { congress: 18, label: "18th Congress", years: [2020, 2021, 2022], note: "Convened July 2019; passed the FY2020, FY2021 and FY2022 GAAs." },
  { congress: 19, label: "19th Congress", years: [2023, 2024, 2025], note: "Convened July 2022; passed the FY2023, FY2024 and FY2025 GAAs." },
  { congress: 20, label: "20th Congress", years: [2026, 2027], note: "Convened July 2025; passed the FY2026 GAA. FY2027 is the NEP and the House bill, not yet enacted." },
];

type FiscalStage = "gaa" | "nep" | "hgab3";
type BridgeGroup = "house_only" | "nep_only" | "unchanged" | "increased" | "decreased" | "scope_review";
const BRIDGE_ORDER: readonly BridgeGroup[] = ["house_only", "nep_only", "unchanged", "increased", "decreased", "scope_review"];

interface BridgeCell { rows: number; php: number; nep_php?: number | null; house_php?: number | null }
interface Bridge extends Record<BridgeGroup, BridgeCell> { net_php: number; house_stage: "hgab2" | "hgab3" }

interface YearAmount { fy: number; stage: FiscalStage; php: number | null; matched_label: string | null }
type OfficeKind = "district_engineering_office" | "sub_district_engineering_office" | "regional_group";
interface OfficeHistory {
  id: string; name: string; kind: OfficeKind; region: string | null; district_ids: string[]; tier: "A" | "B";
  years: YearAmount[];
  by_congress: Array<{ congress: number; gaa_php: number | null; years_counted: number[] }>;
  fy2027: { nep_php: number | null; hgab2_php: number | null; hgab3_php: number | null; nep_records: number; hgab3_records: number; bridge: Bridge | null; office_change: OfficeChange } | null;
  aliases_used: string[]; notes: string[];
}
/** Held-out paired lines where either side names this office: an annotation, never in the office's figures. */
interface OfficeChange { rows: number; nep_php: number; hgab3_php: number; row_ids: string[] }
interface OfficeChangeSummary { rows: number; cross_district_rows: number; one_side_rows: number; nep_php: number; hgab2_php: number; hgab3_php: number; row_ids: string[] }
interface NoOfficeSummary { rows: number; nep_php: number; hgab2_php: number; hgab3_php: number; row_ids: string[] }
interface DistrictRepresentative {
  name: string; seat: string; status: "resolved" | "ambiguous"; member_code: string | null; profile_url: string | null;
  juris_id: string | null; juris_url: string | null; portrait_url: string | null; portrait_attribution: string | null;
  portrait_license: string | null; portrait_source_url: string | null; bill_count: number | null; leadership_roles: string[];
  candidates?: DistrictRepresentative[];
}
interface DistrictCard {
  id: string; label: string; jurisdiction: string; district_label: string; region: string | null;
  representative: DistrictRepresentative | null; office_ids: string[]; attribution: "A" | "B" | "mixed" | "none";
  headline: { fy2026_gaa_php: number | null; fy2027_nep_php: number | null; fy2027_hgab3_php: number | null };
  co_served_district_ids: string[];
}
interface ResidualYear {
  fy: number; stage: FiscalStage; total_php: number; deo_php: number; central_office_php: number; regional_offices_php: number;
  unmatched_php: number; unmatched_labels: string[]; office_change_php: number; office_change_rows: number;
  no_office_php: number; no_office_rows: number;
}
interface HgabDistrictIndex {
  fiscal_year: number; built_at: string; source_commit: string;
  crosswalk: { schema_version: string; build_date: string; offices: number; districts: number; relationships: number };
  representatives_source: { url: string; congress: number; fetched_at: string; notice: string; matched: number; unmatched: number };
  terms: CongressTerm[]; districts: DistrictCard[]; offices: Record<string, OfficeHistory>; residual: ResidualYear[];
  office_change: OfficeChangeSummary; no_office: NoOfficeSummary; scope_notes: string[];
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

interface CrosswalkOffice {
  name: string; type: OfficeKind; region: string | null; aliases?: string[]; legislativeDistrictIds: string[];
  legacy?: { status: string; candidateSuccessors: string[]; note: string; law?: string };
  evidence?: { inAllocationTable?: boolean };
}
interface CrosswalkProfile { memberCode: string; officialName?: string; detailUrl?: string; name?: string }
interface CrosswalkRepresentative {
  name: string | null; officialSeat: string; leadershipRoles?: string[]; resolutionStatus: string; profile?: CrosswalkProfile;
  candidates?: string[]; candidateProfiles?: CrosswalkProfile[]; note?: string;
}
interface CrosswalkDistrict {
  jurisdiction: string; districtLabel: string; displayName: string; region: string | null; representative: CrosswalkRepresentative; officeIds: string[];
}
interface Crosswalk {
  schemaVersion: string; buildDate: string; offices: Record<string, CrosswalkOffice>;
  legislativeDistricts: Record<string, CrosswalkDistrict>; relationships: unknown[];
}
interface JurisAuthor {
  id: string; congress: number; chamber: string; officialMemberId: string | null; canonicalName: string; displayName: string;
  position: string | null; representation: string | null; officialProfileUrl: string | null; portraitUrl: string | null;
  portraitSourceUrl: string | null; portraitAttribution: string | null; portraitLicense: string | null; portraitLicenseUrl: string | null;
  lastVerifiedAt: string | null; billCount: number | null;
}
interface JurisResponse { items: JurisAuthor[]; meta?: { total?: number; congress?: number; notice?: string } }
interface JurisCache { url: string; fetched_at: string; meta: JurisResponse["meta"] | null; items: JurisAuthor[] }
interface OperatingUnitRow { description: string; operunit_code?: string; years: Record<string, { count: number; amount: number }> }

const JURIS_API = "https://bills.juris.ph/api/authors";
const JURIS_DIRECTORY = "https://bills.juris.ph/authors/house";
const JURIS_CONGRESS = 20;

// ---------------------------------------------------------------------------
// Args and helpers
// ---------------------------------------------------------------------------

interface Args { src: string; out: string; gaa: string; nep: string; contract: string; offline: boolean }
function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  return {
    src: resolve(get("src") ?? "/tmp/dpwh-nep-review/repo"),
    out: resolve(get("out") ?? "data/hgab/2027"),
    gaa: resolve(get("gaa") ?? "data/18"),
    nep: resolve(get("nep") ?? "data/2027/18"),
    contract: resolve(get("contract") ?? "src/lib/hgab.ts"),
    offline: argv.includes("--offline"),
  };
}

const q = (s: string) => s.replace(/'/g, "''");
const peso = (n: number | null | undefined) => (n == null ? "—" : `₱${n.toLocaleString("en-US")}`);
const log = (s: string) => process.stdout.write(`${s}\n`);
const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : Number(v));
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
/** Thousands of pesos (as the source files print) → integer pesos. */
function thousandsToPesos(v: number): number {
  const r = Math.round(v);
  ensure(Math.abs(v - r) < 1e-6, `non-integer thousands amount ${v}`);
  return r * 1000;
}
/** Sum of non-null values, or null when every value is null. */
function sumOrNull(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/** trace → bridge group, read from TRACE_LABELS in src/lib/hgab.ts so this cannot drift from the UI. */
function contractTraceGroups(path: string): Map<string, BridgeGroup> {
  const src = readFileSync(path, "utf8");
  const block = /export const TRACE_LABELS[^{]*\{([\s\S]*?)\n\};/.exec(src)?.[1];
  ensure(block, `TRACE_LABELS not found in ${path}`);
  const out = new Map<string, BridgeGroup>();
  for (const m of block.matchAll(/^\s*([a-z0-9_]+):\s*\{[^\n]*?group:\s*'([a-z_]+)'/gm)) out.set(m[1], m[2] as BridgeGroup);
  ensure(out.size > 0, "no trace groups parsed from the contract");
  return out;
}

// ---------------------------------------------------------------------------
// Office-name join
// ---------------------------------------------------------------------------

/**
 * Normalised join key, after buildCongressIndex.mjs `officeJoinKey`: accents
 * off (NFKD), "DEO" / "Sub-DEO" expanded, hyphens to spaces, ordinal words to
 * numerals, " - Proper" stripped, the `Las Pi±as` mojibake repaired, spaces
 * collapsed, lower-cased. Pure formatting — it never adds or removes an
 * ordinal, a province word or a qualifier.
 */
function officeJoinKey(value: string): string {
  let s = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!s) return "";
  s = s.replace(/pi±as/gi, "Pinas");
  s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/\bsub[\s-]*deo\b/gi, "sub district engineering office");
  s = s.replace(/\bDEO\b/gi, "district engineering office");
  s = s.replace(/[-‐-―]/g, " ");
  s = s.replace(/\bfirst\b/gi, "1st").replace(/\bsecond\b/gi, "2nd").replace(/\bthird\b/gi, "3rd")
    .replace(/\bfourth\b/gi, "4th").replace(/\bfifth\b/gi, "5th").replace(/\bsixth\b/gi, "6th").replace(/\bseventh\b/gi, "7th");
  s = s.replace(/\s+proper$/i, "");
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Explicit aliases: source labels the normaliser cannot join by formatting
 * alone. Each entry names its basis; every use is recorded on the office's
 * `aliases_used` and in the manifest. Nothing here splits a predecessor.
 */
interface Alias { label: string; office: string; basis: string; provisional: boolean }
const ALIASES: readonly Alias[] = [
  {
    label: "Surigao del Norte 1st District Engineering Office (formerly Surigao del Norte 2nd District Engineering Office)",
    office: "office:surigao-del-norte-1st-deo",
    basis: "The label's own primary name is the 1st DEO; the DBM operating-unit code (1800181) is the one the plain 'Surigao del Norte 1st District Engineering Office' label carries in FY2024–2026, while 'Surigao del Norte 2nd District Engineering Office' keeps code 1800180 throughout. The parenthetical is treated as a qualifier, not a different office.",
    provisional: true,
  },
  {
    label: "Davao de Oro District Engineering Office",
    office: "office:compostela-valley-deo",
    basis: "Compostela Valley was renamed Davao de Oro by RA 11297; the crosswalk records 'Compostela Valley DEO' as a legacy office (renamed_province) and the FY2022 GAA prints the undivided successor name under the same DBM operating-unit code (1800159). The office is a predecessor with no district, so its amounts stay in the residual.",
    provisional: false,
  },
];

type LabelKind = "central" | "regional" | "office" | "legacy" | "unmatched";
interface LabelMatch { kind: LabelKind; office_id: string | null; via: "exact" | "normalised" | "alias" | "pattern" | null; alias?: Alias; transforms?: string[] }

/** The crosswalk's short form written out as the ledgers print it ("Bulacan 1st DEO" → "Bulacan 1st District Engineering Office"). */
function plainExpansion(name: string): string {
  return name.normalize("NFKC").replace(/\bsub[\s-]*deo\b/gi, "Sub District Engineering Office").replace(/\bDEO\b/g, "District Engineering Office").replace(/\s+/g, " ").trim();
}
/**
 * Which normalisation steps a label actually needed to meet the office's
 * plain-expanded name(s): a step counts only when leaving it out breaks the
 * join. For the audit trail on `aliases_used`.
 */
const JOIN_STEPS: ReadonlyArray<[string, (s: string) => string]> = [
  ["'Las Pi±as' mojibake repaired", (s) => s.replace(/pi±as/gi, "Pinas")],
  ["accents ignored", (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "")],
  ["'DEO' expanded", (s) => s.replace(/\bsub[\s-]*deo\b/gi, "sub district engineering office").replace(/\bDEO\b/gi, "district engineering office")],
  ["hyphen treated as a space", (s) => s.replace(/[-‐-―]/g, " ")],
  ["ordinal word read as a numeral", (s) => s.replace(/\bfirst\b/gi, "1st").replace(/\bsecond\b/gi, "2nd").replace(/\bthird\b/gi, "3rd").replace(/\bfourth\b/gi, "4th").replace(/\bfifth\b/gi, "5th").replace(/\bsixth\b/gi, "6th").replace(/\bseventh\b/gi, "7th")],
  ["' - Proper' dropped", (s) => s.replace(/\s+proper$/i, "")],
];
function transformsNeeded(label: string, names: string[]): string[] {
  const base = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  const keyWithout = (skip: number, s: string) => base(JOIN_STEPS.reduce((acc, [, fn], i) => (i === skip ? acc : fn(acc)), s));
  const plain = names.map(plainExpansion);
  const needed = JOIN_STEPS.map(([name], i) => (plain.some((n) => keyWithout(i, n) === keyWithout(i, label)) ? null : name)).filter((x): x is string => x != null);
  return needed.length ? needed : ["letter case or spacing only"];
}

class OfficeJoiner {
  private readonly byKey = new Map<string, string[]>();
  private readonly byAlias = new Map<string, Alias>();
  private readonly offices: Record<string, CrosswalkOffice>;
  constructor(offices: Record<string, CrosswalkOffice>) {
    this.offices = offices;
    for (const [id, o] of Object.entries(offices)) {
      for (const name of [o.name, ...(o.aliases ?? [])]) {
        const k = officeJoinKey(name);
        if (!k) continue;
        const list = this.byKey.get(k) ?? [];
        if (!list.includes(id)) list.push(id);
        this.byKey.set(k, list);
      }
    }
    for (const a of ALIASES) {
      ensure(offices[a.office], `alias target ${a.office} is not in the crosswalk`);
      this.byAlias.set(a.label.normalize("NFKC").replace(/\s+/g, " ").trim(), a);
    }
  }
  match(label: string): LabelMatch {
    const clean = label.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (/^central office$/i.test(clean)) return { kind: "central", office_id: null, via: "pattern" };
    if (/regional office/i.test(clean)) return { kind: "regional", office_id: null, via: "pattern" };
    const alias = this.byAlias.get(clean);
    if (alias) return this.resolve(alias.office, "alias", alias);
    const ids = this.byKey.get(officeJoinKey(clean)) ?? [];
    if (ids.length !== 1) return { kind: "unmatched", office_id: null, via: null };
    // "Exact" = the crosswalk's name or one of its aliases, or their plain DEO expansion as the ledgers print it.
    const names = [this.offices[ids[0]].name, ...(this.offices[ids[0]].aliases ?? [])];
    const exact = names.some((n) => n === clean || plainExpansion(n) === clean);
    return this.resolve(ids[0], exact ? "exact" : "normalised", undefined, exact ? undefined : transformsNeeded(clean, names));
  }
  private resolve(id: string, via: LabelMatch["via"], alias?: Alias, transforms?: string[]): LabelMatch {
    const o = this.offices[id];
    if (o.type === "regional_group") return { kind: "regional", office_id: id, via, alias, transforms };
    if (!o.legislativeDistrictIds.length) return { kind: "legacy", office_id: id, via, alias, transforms };
    return { kind: "office", office_id: id, via, alias, transforms };
  }
}

// ---------------------------------------------------------------------------
// The source's office lens (analysis/web/buildCongressIndex.mjs at the pinned commit), ported
// ---------------------------------------------------------------------------
//
// DEO2LEG/README.md condition 3: a paired line whose two stages do not agree on one office group is held out of
// every card and of the residual, as its own `office_change` bucket. `classifyRow`, `sideOffices` and the group
// definition below are the source's, line for line; a `no_office` line goes to the residual, as the source does.
// A "group" is the set of engineering offices serving exactly the same district set; it is used only to classify
// rows. Money stays booked by the office the House bill lists, as before.

/** analysis/viewers/project_offices.mjs canonicalOffice(), ported verbatim (the same port as import-hgab.ts). */
function canonicalOffice(office: unknown): string {
  if (office == null || office === "") return "";
  let s = String(office).normalize("NFKC").trim().replace(/\s+/g, " ");
  let prev: string;
  do {
    prev = s;
    s = s.replace(/(\p{L})\s*ñ\s*(\p{L})/gu, (_, a: string, b: string) => `${a}ñ${b}`);
  } while (s !== prev);
  if (/District Engineering Office$/i.test(s)) s = s.replace(/\s*-\s*/g, " ").replace(/\s+/g, " ");
  s = s.replace(/^(Regional Office )([IVXLC]+)([AB])$/i, (_, p: string, n: string, l: string) => `${p}${n.toUpperCase()}-${l.toUpperCase()}`);
  s = s.replace(/Marindugue/gi, "Marinduque").replace(/Siguijor/gi, "Siquijor").replace(/Occidenatal/gi, "Occidental")
    .replace(/Batagas/gi, "Batangas").replace(/Ilolilo/gi, "Iloilo");
  return s;
}
/** buildCongressIndex.mjs officeJoinKey(), verbatim. */
function lensJoinKey(value: string): string {
  let s = canonicalOffice(value || "");
  if (!s) return "";
  s = s.replace(/\bsub[\s-]*deo\b/gi, "sub district engineering office");
  s = s.replace(/\bDEO\b/gi, "district engineering office");
  s = s.replace(/[-\u2010-\u2015]/g, " ");
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}
const LENS_OFFICE_TYPES = new Set<OfficeKind>(["district_engineering_office", "sub_district_engineering_office"]);
/** buildCrosswalk() groups + the officeToGroup closure in buildCongressIndex(): office name → group id, or null. */
function lensGroups(offices: Record<string, CrosswalkOffice>): { groupOf: (name: string) => string | null; officeGroup: Map<string, string> } {
  const keyToOffices = new Map<string, string[]>();
  for (const [id, o] of Object.entries(offices)) {
    if (!LENS_OFFICE_TYPES.has(o.type)) continue;
    for (const name of [o.name, ...(o.aliases ?? [])]) {
      const k = lensJoinKey(name);
      if (!k) continue;
      const list = keyToOffices.get(k) ?? [];
      if (!list.includes(id)) list.push(id);
      keyToOffices.set(k, list);
    }
  }
  const officeGroup = new Map<string, string>();
  for (const [id, o] of Object.entries(offices)) {
    if (!LENS_OFFICE_TYPES.has(o.type) || !o.evidence?.inAllocationTable) continue;
    const ds = [...(o.legislativeDistrictIds ?? [])].sort();
    if (!ds.length) continue;
    officeGroup.set(id, `office-group:${ds.join("+")}`);
  }
  const groupOf = (name: string) => {
    const ids = keyToOffices.get(lensJoinKey(name));
    if (!ids) return null;
    const groups = new Set(ids.map((i) => officeGroup.get(i)).filter((g): g is string => Boolean(g)));
    return groups.size === 1 ? [...groups][0] : null;
  };
  return { groupOf, officeGroup };
}

interface LensSide { office?: string; office_canonical?: string; records?: LensSide[] }
interface LensRow { id: string; third?: LensSide | null; nep?: LensSide | null }
type LensVerdict =
  | { kind: "no_stage" } | { kind: "no_office" } | { kind: "group"; groupId: string } | { kind: "residual" }
  | { kind: "office_change"; groupIds: string[]; crossDistrict: boolean; oneSideUnattributable: boolean };

/** buildCongressIndex.mjs sideOffices(), verbatim: a side with grouped `records` is read from the records only. */
function sideOffices(row: LensRow, side: "third" | "nep"): string[] {
  const source = row[side];
  if (!source) return [];
  const records = source.records ?? [source];
  return records.map((r) => r.office_canonical ?? r.office ?? "").filter(Boolean);
}
/**
 * The source's lens reads these three third-reading `repeated_key` sides as naming no office: each side lists an
 * office, its grouped records do not repeat it. They go to the residual, as upstream; any other `no_office` line
 * stops the build.
 */
const EXPECTED_NO_OFFICE = ["house-reading:12949", "house-reading:15005", "house-reading:8092"];
/** The office a side itself lists (for the note on that office only; never used to classify). */
function sideOwnOffice(row: LensRow, side: "third" | "nep"): string {
  return row[side]?.office_canonical ?? row[side]?.office ?? "";
}
/** buildCongressIndex.mjs classifyRow(), verbatim. */
function classifyRow(row: LensRow, groupOf: (name: string) => string | null): LensVerdict {
  const present = (["third", "nep"] as const).filter((side) => row[side]);
  if (!present.length) return { kind: "no_stage" };
  const attributed = new Set<string>();
  let unattributable = false, officesSeen = 0;
  for (const side of present) {
    for (const office of sideOffices(row, side)) {
      officesSeen += 1;
      const groupId = groupOf(office);
      if (groupId) attributed.add(groupId);
      else unattributable = true;
    }
  }
  if (!officesSeen) return { kind: "no_office" };
  if (attributed.size === 1 && !unattributable) return { kind: "group", groupId: [...attributed][0] };
  if (attributed.size === 0) return { kind: "residual" };
  return { kind: "office_change", groupIds: [...attributed].sort(), crossDistrict: attributed.size > 1, oneSideUnattributable: unattributable };
}

// ---------------------------------------------------------------------------
// Ledgers: one amount per (label) per slot, in integer pesos
// ---------------------------------------------------------------------------

interface Slot { fy: number; stage: FiscalStage; key: string }
const SLOTS: readonly Slot[] = [
  ...GAA_YEARS.map((fy) => ({ fy, stage: "gaa" as FiscalStage, key: `gaa:${fy}` })),
  { fy: FISCAL_YEAR, stage: "nep", key: "nep:2027" },
  { fy: FISCAL_YEAR, stage: "hgab3", key: "hgab3:2027" },
];

/** label → amount for one slot; a label present with a 0 sum is recorded as 0 (then rendered null, never 0). */
type Ledger = Map<string, number>;

function loadGaa(dir: string): { ledgers: Map<string, Ledger>; totals: Map<string, number> } {
  const ou = readJson<{ data: OperatingUnitRow[] }>(resolve(dir, "operating_units.json"));
  const yt = readJson<{ data: Array<{ year: number; amount: number }> }>(resolve(dir, "yearly_totals.json"));
  const acc = new Map<string, Map<string, number>>();
  for (const r of ou.data) {
    const label = r.description;
    if (!label || label === "nan") continue;
    for (const [year, v] of Object.entries(r.years ?? {})) {
      const m = acc.get(`gaa:${year}`) ?? new Map<string, number>();
      m.set(label, (m.get(label) ?? 0) + (v.amount ?? 0));
      acc.set(`gaa:${year}`, m);
    }
  }
  const ledgers = new Map<string, Ledger>();
  const totals = new Map<string, number>();
  for (const fy of GAA_YEARS) {
    const key = `gaa:${fy}`;
    const m = acc.get(key) ?? new Map<string, number>();
    const ledger: Ledger = new Map([...m].map(([label, thousands]) => [label, thousandsToPesos(thousands)]));
    const total = yt.data.find((d) => d.year === fy)?.amount;
    ensure(total != null, `yearly_totals.json has no FY${fy}`);
    const totalPesos = thousandsToPesos(total);
    const sum = [...ledger.values()].reduce((a, b) => a + b, 0);
    ensure(sum === totalPesos, `FY${fy} GAA operating units sum to ${sum}, yearly total is ${totalPesos}`);
    ledgers.set(key, ledger);
    totals.set(key, totalPesos);
  }
  return { ledgers, totals };
}

function loadNep(dir: string): { ledger: Ledger; total: number } {
  const ou = readJson<{ data: OperatingUnitRow[] }>(resolve(dir, "operating_units.json"));
  const summary = readJson<{ scale: string; department: { amount: number } }>(resolve(dir, "summary.json"));
  ensure(summary.scale === "pesos", `summary.json scale is ${summary.scale}`);
  const acc = new Map<string, number>();
  for (const r of ou.data) {
    const label = r.description;
    if (!label || label === "nan") continue;
    acc.set(label, (acc.get(label) ?? 0) + (r.years?.[String(FISCAL_YEAR)]?.amount ?? 0));
  }
  const ledger: Ledger = new Map([...acc].map(([label, thousands]) => [label, thousandsToPesos(thousands)]));
  const sum = [...ledger.values()].reduce((a, b) => a + b, 0);
  ensure(sum === summary.department.amount, `FY2027 NEP operating units sum to ${sum}, department total is ${summary.department.amount}`);
  return { ledger, total: summary.department.amount };
}

interface OfficeHgab {
  office: string; nep_php: number | null; hgab2_php: number | null; hgab3_php: number | null; nep_records: number; hgab3_records: number;
  bridge: Bridge;
}
/** One held-out paired line (office_change): the label the House bill lists, both sides' offices, the amounts. */
interface ChangeRow { id: string; title: string; label: string; third: string[]; nep: string[]; cross: boolean; oneSide: boolean; nep_php: number; hgab2_php: number; hgab3_php: number }
interface LensResult {
  counts: Record<LensVerdict["kind"], number>;
  changeRows: ChangeRow[];
  /** (printed label, lens group) pairs of the rows kept with an office, for the join cross-check. */
  groupLabels: Map<string, Set<string>>;
  /** Printed labels of the rows the lens calls residual. */
  residualLabels: Set<string>;
  /** Rows kept with one group whose two sides name different offices of that group (booked to the House-side office). */
  sameGroupOfficeDiffers: Array<{ id: string; third: string[]; nep: string[]; nep_php: number | null; hgab3_php: number | null }>;
  /** Lines the lens reads as naming no office: residual, in no office's figures. `own` = the offices the sides themselves list. */
  noOfficeRows: Array<{ id: string; title: string; label: string; own: string[]; nep_php: number; hgab2_php: number; hgab3_php: number }>;
}

async function loadHgab(out: string, traceGroups: Map<string, BridgeGroup>, groupOf: (name: string) => string | null):
  Promise<{ offices: Map<string, OfficeHgab>; totals: { nep: number; hgab3: number }; lens: LensResult }> {
  const overview = readJson<{ datasets: Array<{ key: string; totals: { nep_php: number; hgab3_php: number | null }; bridge: Bridge }> }>(resolve(out, "overview.json"));
  const dpwh = overview.datasets.find((d) => d.key === "dpwh");
  ensure(dpwh?.totals.hgab3_php != null, "overview.json has no DPWH dataset with an HGAB 3R total");
  const parquet = resolve(out, "dpwh", "projects.parquet");
  ensure(existsSync(parquet), `${parquet} not found — run \`npm run import:hgab\` first`);

  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  const rows = (await c.runAndReadAll(`
    SELECT id, office, trace, nep_php, hgab2_php, hgab3_php,
           CASE WHEN nep_php IS NOT NULL THEN coalesce(json_array_length(record_json->'$.nep.records'), 1) ELSE 0 END,
           CASE WHEN hgab3_php IS NOT NULL THEN coalesce(json_array_length(record_json->'$.third.records'), 1) ELSE 0 END,
           title, record_json
    FROM read_parquet('${q(parquet)}') ORDER BY id`)).getRows();
  c.closeSync(); db.closeSync();

  interface Acc { nep: number | null; h2: number | null; h3: number | null; nepN: number; h3N: number; cells: Record<BridgeGroup, { rows: number; nep: number; house: number; delta: number }> }
  const acc = new Map<string, Acc>();
  const lens: LensResult = {
    counts: { group: 0, residual: 0, office_change: 0, no_office: 0, no_stage: 0 }, changeRows: [], groupLabels: new Map(),
    residualLabels: new Set(), sameGroupOfficeDiffers: [], noOfficeRows: [],
  };
  for (const r of rows) {
    const id = String(r[0]);
    const office = r[1] == null ? "" : String(r[1]);
    ensure(office, `${id}: a DPWH parquet row has no office; the lens needs the printed office`);
    const trace = String(r[2]);
    const group = traceGroups.get(trace);
    ensure(group, `trace ${trace} is not in the contract's TRACE_LABELS`);
    const nep = r[3] == null ? null : num(r[3]), h2 = r[4] == null ? null : num(r[4]), h3 = r[5] == null ? null : num(r[5]);
    const record = JSON.parse(String(r[9])) as LensRow;
    ensure(record.id === id, `${id}: record_json carries id ${record.id}`);
    const verdict = classifyRow(record, groupOf);
    lens.counts[verdict.kind]++;
    // Every label keeps an entry (amounts may be all held out) so the office's hgab3 label stays joined.
    const a = acc.get(office) ?? {
      nep: null, h2: null, h3: null, nepN: 0, h3N: 0,
      cells: Object.fromEntries(BRIDGE_ORDER.map((g) => [g, { rows: 0, nep: 0, house: 0, delta: 0 }])) as Acc["cells"],
    };
    acc.set(office, a);
    if (verdict.kind === "office_change") {
      lens.changeRows.push({
        id, title: String(r[8] ?? ""), label: office, third: sideOffices(record, "third"), nep: sideOffices(record, "nep"),
        cross: verdict.crossDistrict, oneSide: verdict.oneSideUnattributable, nep_php: nep ?? 0, hgab2_php: h2 ?? 0, hgab3_php: h3 ?? 0,
      });
      continue;
    }
    if (verdict.kind === "no_office") {
      lens.noOfficeRows.push({
        id, title: String(r[8] ?? ""), label: office, own: (["third", "nep"] as const).map((sd) => sideOwnOffice(record, sd)).filter(Boolean),
        nep_php: nep ?? 0, hgab2_php: h2 ?? 0, hgab3_php: h3 ?? 0,
      });
      continue;
    }
    if (verdict.kind === "group") {
      lens.groupLabels.set(office, (lens.groupLabels.get(office) ?? new Set()).add(verdict.groupId));
      const t = sideOffices(record, "third").map(canonicalOffice), n = sideOffices(record, "nep").map(canonicalOffice);
      if (t.length && n.length && new Set([...t, ...n]).size > 1) lens.sameGroupOfficeDiffers.push({ id, third: t, nep: n, nep_php: nep, hgab3_php: h3 });
    } else if (verdict.kind === "residual") {
      lens.residualLabels.add(office);
    }
    a.nep = sumOrNull([a.nep, nep]); a.h2 = sumOrNull([a.h2, h2]); a.h3 = sumOrNull([a.h3, h3]);
    a.nepN += num(r[6]); a.h3N += num(r[7]);
    const cell = a.cells[group];
    cell.rows += 1; cell.nep += nep ?? 0; cell.house += h3 ?? 0; cell.delta += h3 != null && nep != null ? h3 - nep : 0;
  }
  // The source sends no_stage and no_office rows to its residual. No_stage must not exist; no_office must be exactly
  // the three known sides (a new one needs a look before it moves money out of an office).
  ensure(lens.counts.no_stage === 0, `${lens.counts.no_stage} DPWH rows carry neither a House bill 3rd reading nor an NEP side`);
  const noOfficeIds = lens.noOfficeRows.map((x) => x.id).sort();
  ensure(JSON.stringify(noOfficeIds) === JSON.stringify(EXPECTED_NO_OFFICE), `no_office lines are ${noOfficeIds.join(", ") || "none"}; expected exactly ${EXPECTED_NO_OFFICE.join(", ")}`);

  const offices = new Map<string, OfficeHgab>();
  let nepSum = 0, h3Sum = 0;
  for (const [office, a] of acc) {
    const cell = (g: BridgeGroup): BridgeCell => {
      const x = a.cells[g];
      switch (g) {
        case "house_only": return { rows: x.rows, php: x.house, nep_php: null, house_php: x.house };
        case "nep_only": return { rows: x.rows, php: x.nep, nep_php: x.nep, house_php: null };
        case "unchanged": ensure(x.house === x.nep, `${office}: unchanged rows carry different totals`); return { rows: x.rows, php: x.house, nep_php: x.nep, house_php: x.house };
        case "increased": return { rows: x.rows, php: x.delta, nep_php: x.nep, house_php: x.house };
        case "decreased": return { rows: x.rows, php: -x.delta, nep_php: x.nep, house_php: x.house };
        case "scope_review": return { rows: x.rows, php: x.delta, nep_php: x.nep, house_php: x.house };
      }
    };
    const bridge: Bridge = {
      house_only: cell("house_only"), nep_only: cell("nep_only"), unchanged: cell("unchanged"),
      increased: cell("increased"), decreased: cell("decreased"), scope_review: cell("scope_review"),
      net_php: (a.h3 ?? 0) - (a.nep ?? 0), house_stage: "hgab3",
    };
    const identity = bridge.house_only.php - bridge.nep_only.php + bridge.increased.php - bridge.decreased.php + bridge.scope_review.php;
    ensure(identity === bridge.net_php, `${office}: bridge identity failed (${identity} vs ${bridge.net_php})`);
    offices.set(office, { office, nep_php: a.nep, hgab2_php: a.h2, hgab3_php: a.h3, nep_records: a.nepN, hgab3_records: a.h3N, bridge });
    nepSum += a.nep ?? 0; h3Sum += a.h3 ?? 0;
  }
  const held = [...lens.changeRows, ...lens.noOfficeRows];
  const heldNep = held.reduce((t, x) => t + x.nep_php, 0), heldH3 = held.reduce((t, x) => t + x.hgab3_php, 0);
  ensure(nepSum + heldNep === dpwh.totals.nep_php, `parquet NEP ${nepSum} + office change and no office ${heldNep} ≠ overview ${dpwh.totals.nep_php}`);
  ensure(h3Sum + heldH3 === dpwh.totals.hgab3_php, `parquet HGAB3 ${h3Sum} + office change and no office ${heldH3} ≠ overview ${dpwh.totals.hgab3_php}`);
  return { offices, totals: { nep: dpwh.totals.nep_php, hgab3: dpwh.totals.hgab3_php }, lens };
}

// ---------------------------------------------------------------------------
// Representatives (bills.juris.ph)
// ---------------------------------------------------------------------------

async function loadJuris(out: string, offline: boolean): Promise<JurisCache> {
  const cachePath = resolve(out, "juris-authors.json");
  const cached = existsSync(cachePath) ? readJson<JurisCache>(cachePath) : null;
  if (offline) {
    ensure(cached, `--offline but ${cachePath} does not exist`);
    log(`  juris: using cached ${cachePath} (fetched ${cached.fetched_at})`);
    return cached;
  }
  try {
    const res = await fetch(JURIS_API, { headers: { accept: "application/json" } });
    ensure(res.ok, `HTTP ${res.status}`);
    const body = (await res.json()) as JurisResponse;
    ensure(Array.isArray(body.items) && body.items.length > 0, "empty items");
    const cache: JurisCache = { url: JURIS_API, fetched_at: new Date().toISOString(), meta: body.meta ?? null, items: body.items };
    writeFileSync(cachePath, `${JSON.stringify(cache, null, 1)}\n`);
    log(`  juris: fetched ${body.items.length} authors → ${cachePath}`);
    return cache;
  } catch (e) {
    if (cached) {
      log(`  juris: fetch failed (${(e as Error).message}); using cached ${cachePath} (fetched ${cached.fetched_at})`);
      return cached;
    }
    throw e;
  }
}

function jurisUrl(a: JurisAuthor): string {
  return `${JURIS_DIRECTORY}?${new URLSearchParams({ author: a.canonicalName }).toString()}`;
}

function representativeOf(
  p: { name: string; seat: string; memberCode: string | null; profileUrl: string | null; leadership: string[] },
  byCode: Map<string, JurisAuthor>,
): { rep: DistrictRepresentative; joined: boolean } {
  const a = p.memberCode ? byCode.get(p.memberCode) : undefined;
  const leadership = uniq([...p.leadership, ...(a?.position ? [a.position] : [])]);
  return {
    joined: Boolean(a),
    rep: {
      name: p.name, seat: p.seat, status: "resolved", member_code: p.memberCode,
      profile_url: p.profileUrl ?? a?.officialProfileUrl ?? null,
      juris_id: a?.id ?? null, juris_url: a ? jurisUrl(a) : null,
      portrait_url: a?.portraitUrl ?? null, portrait_attribution: a?.portraitAttribution ?? null,
      portrait_license: a?.portraitLicense ?? null, portrait_source_url: a?.portraitSourceUrl ?? null,
      bill_count: a?.billCount ?? null, leadership_roles: leadership,
    },
  };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const SMALL_WORDS = new Set(["of", "de", "del", "y"]);
/** "CITY OF LAS PIÑAS" → "City of Las Piñas"; "TAWI-TAWI" → "Tawi-Tawi"; "STA." → "Sta.". */
function titleCase(s: string): string {
  return s.toLowerCase().split(" ").map((word, i) => {
    if (i > 0 && SMALL_WORDS.has(word)) return word;
    return word.split("-").map((part) => (part ? part[0].toLocaleUpperCase("en-PH") + part.slice(1) : part)).join("-");
  }).join(" ");
}
function districtLabel(d: CrosswalkDistrict): string {
  return d.districtLabel.toLowerCase() === "lone" ? "Lone District" : `${d.districtLabel} District`;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  const builtAt = new Date().toISOString();
  mkdirSync(args.out, { recursive: true });
  log(`building ${resolve(args.out, "districts.json")}`);

  // Inputs.
  const crosswalkPath = resolve(args.src, "DEO2LEG/outputs/deo_leg_crosswalk.json");
  const manifestPath = resolve(args.src, "DEO2LEG/outputs/MANIFEST.json");
  const crosswalk = readJson<Crosswalk>(crosswalkPath);
  ensure(crosswalk.schemaVersion === "2.1.0", `unsupported crosswalk schema ${crosswalk.schemaVersion}`);
  const sourceCommit = execFileSync("git", ["-C", args.src, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const traceGroups = contractTraceGroups(args.contract);
  log(`  crosswalk ${crosswalk.schemaVersion} (${crosswalk.buildDate}): ${Object.keys(crosswalk.offices).length} offices, ${Object.keys(crosswalk.legislativeDistricts).length} districts, ${crosswalk.relationships.length} relationships`);

  const gaa = loadGaa(args.gaa);
  const nep = loadNep(args.nep);
  const lensMap = lensGroups(crosswalk.offices);
  const hgab = await loadHgab(args.out, traceGroups, lensMap.groupOf);
  const juris = await loadJuris(args.out, args.offline);
  log(`  gaa: ${GAA_YEARS.length} years · nep FY2027: ${nep.ledger.size} operating units · hgab: ${hgab.offices.size} printed offices`);

  const ledgers = new Map<string, Ledger>(gaa.ledgers);
  ledgers.set("nep:2027", nep.ledger);
  ledgers.set("hgab3:2027", new Map([...hgab.offices.values()].map((o) => [o.office, o.hgab3_php ?? 0])));
  const totals = new Map<string, number>(gaa.totals);
  totals.set("nep:2027", nep.total);
  totals.set("hgab3:2027", hgab.totals.hgab3);

  // Join every label of every slot once.
  const joiner = new OfficeJoiner(crosswalk.offices);
  const matches = new Map<string, LabelMatch>();
  for (const ledger of ledgers.values()) for (const label of ledger.keys()) if (!matches.has(label)) matches.set(label, joiner.match(label));

  // The lens and our join must agree: a row kept with a group is booked to an office of that group, a residual row to
  // Central/regional, and every office a held-out row names joins (or fails to join) the same way in both.
  for (const [label, groups] of hgab.lens.groupLabels) {
    const m = matches.get(label);
    ensure(groups.size === 1, `${label}: rows kept with ${groups.size} different groups`);
    ensure(m?.kind === "office" && m.office_id && lensMap.officeGroup.get(m.office_id) === [...groups][0], `${label}: booked to ${m?.office_id ?? m?.kind}, but the lens keeps its rows with ${[...groups][0]}`);
  }
  for (const label of hgab.lens.residualLabels) {
    const m = matches.get(label);
    ensure(m && (m.kind === "central" || m.kind === "regional"), `${label}: a residual row would be booked to ${m?.office_id ?? m?.kind}`);
  }
  const officeChange = new Map<string, OfficeChange>();
  for (const r of hgab.lens.changeRows) {
    const ids = new Set<string>();
    for (const name of [...r.third, ...r.nep]) {
      const g = lensMap.groupOf(name), m = joiner.match(name);
      ensure((g == null) === (m.kind !== "office"), `${r.id}: '${name}' joins ${m.kind} here but group ${g} in the lens`);
      if (g == null || !m.office_id) continue;
      ensure(lensMap.officeGroup.get(m.office_id) === g, `${r.id}: '${name}' joins ${m.office_id} here, ${g} in the lens`);
      ids.add(m.office_id);
    }
    ensure(ids.size > 0, `${r.id}: an office-change row names no engineering office`);
    for (const id of ids) {
      const x = officeChange.get(id) ?? { rows: 0, nep_php: 0, hgab3_php: 0, row_ids: [] };
      x.rows++; x.nep_php += r.nep_php; x.hgab3_php += r.hgab3_php; x.row_ids.push(r.id);
      officeChange.set(id, x);
    }
  }
  const changeTotals: OfficeChangeSummary = {
    rows: hgab.lens.changeRows.length, cross_district_rows: hgab.lens.changeRows.filter((r) => r.cross).length,
    one_side_rows: hgab.lens.changeRows.filter((r) => r.oneSide).length,
    nep_php: hgab.lens.changeRows.reduce((a, r) => a + r.nep_php, 0), hgab2_php: hgab.lens.changeRows.reduce((a, r) => a + r.hgab2_php, 0),
    hgab3_php: hgab.lens.changeRows.reduce((a, r) => a + r.hgab3_php, 0), row_ids: hgab.lens.changeRows.map((r) => r.id).sort(),
  };
  ensure(changeTotals.cross_district_rows + changeTotals.one_side_rows === changeTotals.rows, "an office-change row is both cross-district and one-sided; the summary would count it twice");
  const noOffice = hgab.lens.noOfficeRows;
  const noOfficeTotals: NoOfficeSummary = {
    rows: noOffice.length, nep_php: noOffice.reduce((a, r) => a + r.nep_php, 0), hgab2_php: noOffice.reduce((a, r) => a + r.hgab2_php, 0),
    hgab3_php: noOffice.reduce((a, r) => a + r.hgab3_php, 0), row_ids: noOffice.map((r) => r.id).sort(),
  };
  // The office a no_office line's printed label joins (if any) gets a note: the line is listed under it but not counted.
  const noOfficeAt = new Map<string, number>();
  for (const r of noOffice) {
    const m = matches.get(r.label);
    if (m?.kind === "office" && m.office_id) noOfficeAt.set(m.office_id, (noOfficeAt.get(m.office_id) ?? 0) + 1);
  }

  // Offices that may appear on a card: every crosswalk office linked to a district (regional_group included, as kind).
  const cardOffices = Object.entries(crosswalk.offices).filter(([, o]) => o.legislativeDistrictIds.length > 0);
  const officeIdByName = new Map(Object.entries(crosswalk.offices).map(([id, o]) => [o.name, id]));

  // Per office per slot: matched labels and summed pesos.
  const perOffice = new Map<string, Map<string, { labels: string[]; php: number }>>();
  for (const [key, ledger] of ledgers) {
    for (const [label, php] of ledger) {
      const m = matches.get(label);
      if (!m || m.kind !== "office" || !m.office_id) continue;
      const slots = perOffice.get(m.office_id) ?? new Map();
      const cur = slots.get(key) ?? { labels: [], php: 0 };
      cur.labels.push(label); cur.php += php;
      slots.set(key, cur);
      perOffice.set(m.office_id, slots);
    }
  }

  // Legacy (predecessor) offices: which labels and years they hold, for the successors' notes.
  const legacyUse = new Map<string, Array<{ label: string; key: string; php: number }>>();
  for (const [key, ledger] of ledgers) {
    for (const [label, php] of ledger) {
      const m = matches.get(label);
      if (m?.kind === "legacy" && m.office_id && php !== 0) {
        const list = legacyUse.get(m.office_id) ?? [];
        list.push({ label, key, php });
        legacyUse.set(m.office_id, list);
      }
    }
  }
  // Offices.
  const offices: Record<string, OfficeHistory> = {};
  const aliasUses: Array<{ office: string; label: string; via: string; slots: string[]; basis: string | null; provisional: boolean }> = [];
  for (const [id, o] of cardOffices) {
    const slots = perOffice.get(id) ?? new Map<string, { labels: string[]; php: number }>();
    const years: YearAmount[] = SLOTS.map((s) => {
      const hit = slots.get(s.key);
      return { fy: s.fy, stage: s.stage, php: hit && hit.php !== 0 ? hit.php : null, matched_label: hit ? hit.labels.sort().join(" + ") : null };
    });
    const by_congress = CONGRESS_TERMS.map((t) => {
      const counted = years.filter((y) => y.stage === "gaa" && y.php != null && t.years.includes(y.fy));
      return { congress: t.congress, gaa_php: sumOrNull(counted.map((y) => y.php)), years_counted: counted.map((y) => y.fy) };
    });
    const h = years[8].matched_label ? hgab.offices.get(years[8].matched_label) : undefined;
    const oc = officeChange.get(id);
    ensure(h || !oc, `${id}: lines that changed office name it, but it has no 2027 block to carry the note`);
    const fy2027 = h ? {
      nep_php: h.nep_php, hgab2_php: h.hgab2_php, hgab3_php: h.hgab3_php, nep_records: h.nep_records, hgab3_records: h.hgab3_records, bridge: h.bridge,
      office_change: oc ? { ...oc, row_ids: [...oc.row_ids].sort() } : { rows: 0, nep_php: 0, hgab3_php: 0, row_ids: [] },
    } : null;

    // Aliases actually used: every matched label that is not the crosswalk's own spelling, with how it joined.
    const aliases_used: string[] = [];
    const labelSlots = new Map<string, string[]>();
    for (const [key, hit] of slots) for (const label of hit.labels) labelSlots.set(label, [...(labelSlots.get(label) ?? []), key]);
    for (const [label, keys] of labelSlots) {
      const m = matches.get(label)!;
      if (m.via === "exact") continue;
      const where = describeSlots(keys);
      const how = m.via === "alias" ? `explicit alias${m.alias?.provisional ? ", provisional" : ""}: ${m.alias?.basis}` : `normalised name (${(m.transforms ?? []).join(", ")})`;
      aliases_used.push(`${label} — ${where} — ${how}`);
      aliasUses.push({ office: id, label, via: m.via ?? "", slots: keys, basis: m.alias?.basis ?? null, provisional: Boolean(m.alias?.provisional) });
    }

    // Reader-facing small print: plain sentences of at most 25 words (the verifier enforces it). The technical
    // record of what each note stands for is in docs/hgab-data.md ("Scope notes (technical record)").
    const notes: string[] = [];
    const missingGaa = years.filter((y) => y.stage === "gaa" && y.matched_label == null).map((y) => y.fy);
    if (missingGaa.length) notes.push(`Not listed under this name in the ${plainYears(missingGaa)} enacted budget${missingGaa.length > 1 ? "s" : ""}.`);
    const zeroGaa = years.filter((y) => y.stage === "gaa" && y.matched_label != null && y.php == null).map((y) => y.fy);
    if (zeroGaa.length) notes.push(`Listed with no money in ${plainYears(zeroGaa)}; shown as blank rather than zero.`);
    if (years[7].php == null) notes.push("Not listed under this name in the 2027 NEP.");
    if (!fy2027) notes.push(o.type === "regional_group" ? "A regional grouping, not an engineering office; it has no figures of its own, and its money is not assigned to any district." : "No projects under this office in the 2027 House bill or the NEP.");
    if (oc) notes.push(oc.rows === 1 ? "1 project line changed office between the NEP and the House bill; it is not counted here." : `${oc.rows} project lines changed office between the NEP and the House bill; they are not counted here.`);
    const no = noOfficeAt.get(id);
    if (no) notes.push(no === 1 ? "1 House bill line listed here has no office in the source data; it is left unassigned." : `${no} House bill lines listed here have no office in the source data; they are left unassigned.`);
    // Predecessor offices whose crosswalk legacy block names this office as a candidate successor: their money
    // stays in the residual (unmatched_labels), never split between successors.
    for (const [legacyId, lo] of Object.entries(crosswalk.offices)) {
      if (!lo.legacy || !lo.legacy.candidateSuccessors.some((n) => officeIdByName.get(n) === id)) continue;
      const uses = legacyUse.get(legacyId) ?? [];
      if (!uses.length) continue;
      const total = uses.reduce((a, u) => a + u.php, 0);
      const lastGaa = Math.max(...uses.filter((u) => u.key.startsWith("gaa:")).map((u) => Number(u.key.slice(4))), 0);
      const lead = lastGaa && lastGaa < 2026 && !uses.some((u) => u.key === "nep:2027")
        ? `Before ${lastGaa + 1} this area was served by ${lo.name}`
        : `The budget also lists an undivided ${lo.name}`;
      notes.push(`${lead}; its ${peso(total)} (${plainSlots(uses.map((u) => u.key))}) is left unassigned, not split among its ${lo.legacy.candidateSuccessors.length} successors.`);
    }
    offices[id] = {
      id, name: o.name, kind: o.type, region: o.region ?? null, district_ids: [...o.legislativeDistrictIds].sort(),
      tier: o.legislativeDistrictIds.length === 1 ? "A" : "B", years, by_congress, fy2027, aliases_used: aliases_used.sort(), notes,
    };
  }

  // Residual per slot.
  const residual: ResidualYear[] = SLOTS.map((s) => {
    const ledger = ledgers.get(s.key)!;
    let deo = 0, central = 0, regional = 0, unmatched = 0;
    const labels: string[] = [];
    for (const [label, php] of ledger) {
      const m = matches.get(label)!;
      if (m.kind === "office") deo += php;
      else if (m.kind === "central") central += php;
      else if (m.kind === "regional") regional += php;
      else { unmatched += php; if (php !== 0) labels.push(label); }
    }
    const total = totals.get(s.key)!;
    // The House bill's office-change lines are in its total but in no label's figure (held out in loadHgab).
    const h3 = s.key === "hgab3:2027";
    const changePhp = h3 ? changeTotals.hgab3_php : 0, changeRows = h3 ? changeTotals.rows : 0;
    const noOfficePhp = h3 ? noOfficeTotals.hgab3_php : 0, noOfficeRows = h3 ? noOfficeTotals.rows : 0;
    ensure(deo + central + regional + unmatched + noOfficePhp + changePhp === total, `${s.key}: residual identity failed`);
    const fromOffices = Object.values(offices).reduce((a, o) => a + (o.years.find((y) => y.stage === s.stage && y.fy === s.fy)?.php ?? 0), 0);
    ensure(fromOffices === deo, `${s.key}: Σ offices ${fromOffices} ≠ deo_php ${deo}`);
    return {
      fy: s.fy, stage: s.stage, total_php: total, deo_php: deo, central_office_php: central, regional_offices_php: regional, unmatched_php: unmatched,
      unmatched_labels: labels.sort(), office_change_php: changePhp, office_change_rows: changeRows,
      no_office_php: noOfficePhp, no_office_rows: noOfficeRows,
    };
  });

  // Representatives.
  const byCode = new Map<string, JurisAuthor>();
  for (const a of juris.items) if (a.chamber === "house" && a.congress === JURIS_CONGRESS && a.officialMemberId) byCode.set(a.officialMemberId, a);
  let repMatched = 0, repUnmatched = 0;
  const unmatchedNames: string[] = [];

  // Districts.
  const districts: DistrictCard[] = Object.entries(crosswalk.legislativeDistricts).map(([id, d]) => {
    const office_ids = [...d.officeIds].sort();
    for (const oid of office_ids) ensure(offices[oid], `${id} references ${oid}, which is not a card office`);
    const ledgerOffices = office_ids.map((oid) => offices[oid]).filter((o) => o.kind !== "regional_group" && (o.years.some((y) => y.php != null) || o.fy2027));
    const tiers = uniq(ledgerOffices.map((o) => o.tier));
    const attribution: DistrictCard["attribution"] = !ledgerOffices.length ? "none" : tiers.length > 1 ? "mixed" : tiers[0];
    const slot = (stage: FiscalStage, fy: number) => sumOrNull(ledgerOffices.map((o) => o.years.find((y) => y.stage === stage && y.fy === fy)?.php ?? null));
    const co = uniq(office_ids.flatMap((oid) => (offices[oid].kind === "regional_group" ? [] : offices[oid].district_ids))).filter((x) => x !== id).sort();

    const r = d.representative;
    let representative: DistrictRepresentative | null = null;
    if (r.resolutionStatus === "resolved" && r.name) {
      const { rep, joined } = representativeOf({ name: r.name, seat: r.officialSeat, memberCode: r.profile?.memberCode ?? null, profileUrl: r.profile?.detailUrl ?? null, leadership: r.leadershipRoles ?? [] }, byCode);
      representative = rep;
      if (joined) repMatched++; else { repUnmatched++; unmatchedNames.push(`${r.name} (${r.officialSeat}, ${r.profile?.memberCode ?? "no member code"})`); }
    } else if (r.candidateProfiles?.length) {
      const candidates = r.candidateProfiles.map((cp) => representativeOf({ name: cp.name ?? cp.officialName ?? "", seat: r.officialSeat, memberCode: cp.memberCode, profileUrl: cp.detailUrl ?? null, leadership: [] }, byCode));
      const allJoined = candidates.every((c) => c.joined);
      if (allJoined) repMatched++; else { repUnmatched++; unmatchedNames.push(...candidates.filter((c) => !c.joined).map((c) => `${c.rep.name} (${r.officialSeat}, ${c.rep.member_code ?? "no member code"}, candidate)`)); }
      representative = {
        name: candidates.map((c) => c.rep.name).join(" / "), seat: r.officialSeat, status: "ambiguous", member_code: null, profile_url: null,
        juris_id: null, juris_url: JURIS_DIRECTORY, portrait_url: null, portrait_attribution: null, portrait_license: null, portrait_source_url: null,
        bill_count: null, leadership_roles: [], candidates: candidates.map((c) => c.rep),
      };
    } else {
      repUnmatched++; unmatchedNames.push(`${r.officialSeat}: ${r.resolutionStatus}`);
    }

    const jurisdiction = titleCase(d.jurisdiction);
    const district_label = districtLabel(d);
    return {
      id, label: `${jurisdiction}, ${district_label}`, jurisdiction, district_label, region: d.region ?? null, representative, office_ids, attribution,
      headline: { fy2026_gaa_php: slot("gaa", 2026), fy2027_nep_php: slot("nep", FISCAL_YEAR), fy2027_hgab3_php: slot("hgab3", FISCAL_YEAR) },
      co_served_district_ids: co,
    };
  }).sort((a, b) => a.label.localeCompare(b.label, "en"));
  ensure(new Set(districts.map((d) => d.id)).size === districts.length, "duplicate district ids");

  const unmatchedByKind = { legacy: 0, unmatched: 0 };
  for (const m of matches.values()) if (m.kind === "legacy") unmatchedByKind.legacy++; else if (m.kind === "unmatched") unmatchedByKind.unmatched++;

  const index: HgabDistrictIndex = {
    fiscal_year: FISCAL_YEAR, built_at: builtAt, source_commit: sourceCommit,
    crosswalk: {
      schema_version: crosswalk.schemaVersion, build_date: crosswalk.buildDate, offices: Object.keys(crosswalk.offices).length,
      districts: Object.keys(crosswalk.legislativeDistricts).length, relationships: crosswalk.relationships.length,
    },
    representatives_source: {
      url: JURIS_API, congress: JURIS_CONGRESS, fetched_at: juris.fetched_at,
      notice: [
        `Representatives are the congress.gov.ph 20th Congress directory as captured by the DEO2LEG crosswalk (${crosswalk.buildDate}), joined to bills.juris.ph /api/authors on the congress.gov.ph member code.`,
        `${repMatched} of ${districts.length} seats joined (${repUnmatched} did not${unmatchedNames.length ? `: ${unmatchedNames.join("; ")}` : ""}).`,
        "Two seats list two representatives on congress.gov.ph (succession or election protest); both candidates are carried and none is chosen.",
        "bills.juris.ph has no per-member page yet: juris_url opens the House author directory with the member pre-selected (?author=).",
        juris.meta?.notice ?? "Portraits are mirrored from source-attributed government photographs on Wikimedia Commons.",
        "Each portrait carries its attribution, licence and Commons source URL; show them with the image.",
        "Nothing here establishes that a representative requested, sponsored or controlled any project or amount.",
      ].join(" "),
      matched: repMatched, unmatched: repUnmatched,
    },
    terms: CONGRESS_TERMS.map((t) => ({ ...t, years: [...t.years] })),
    districts, offices, residual, office_change: changeTotals, no_office: noOfficeTotals,
    // Reader-facing small print on the districts pages: plain sentences of at most 25 words each (the verifier
    // enforces it). The precise statements they stand for are in docs/hgab-data.md ("Scope notes (technical record)").
    scope_notes: [
      "Figures for 2020 to 2026 are the enacted budgets of each DPWH office: the whole department, every fund and every kind of spending.",
      `The 2027 NEP figure uses the same whole-department basis (${peso(nep.total)} in all, including items released automatically).`,
      `The 2027 House bill figure counts named projects only, not staff or running costs (${peso(hgab.totals.hgab3)} in all), so it is smaller than whole-department figures.`,
      `The 2027 comparison sets the House bill against the NEP's ${peso(hgab.totals.nep)} on that project-only basis; never mix it with whole-department figures.`,
      "Every year's total is fully accounted for: offices, Central Office, regional offices, unmatched names and, in 2027, lines with no or changed office.",
      `Offices are matched by name across years, with ${ALIASES.length} known name changes. ${unmatchedByKind.legacy} names are former offices and ${unmatchedByKind.unmatched} match nothing; their money stays unassigned.`,
      "An office serving several districts shows its full figure on each; district headlines add those undivided figures, so read them as a range.",
      "Districts served only by the BARMM regional grouping have no office figures; their headlines are blank.",
      `${changeTotals.rows} paired projects name different offices in the NEP and the House bill; they are held out of every office's figures.`,
      "The table linking offices to districts is used only for those links; the amounts listed in it are not used.",
    ],
  };

  const outPath = resolve(args.out, "districts.json");
  writeFileSync(outPath, `${JSON.stringify(index, null, 1)}\n`);

  // Provenance manifest.
  const coverage = SLOTS.map((s) => {
    const ledger = ledgers.get(s.key)!;
    const deoLike = [...ledger.keys()].filter((l) => /district engineering office/i.test(l) || /\bdeo\b/i.test(l));
    const matched = deoLike.filter((l) => matches.get(l)!.kind === "office");
    const legacy = deoLike.filter((l) => matches.get(l)!.kind === "legacy");
    const r = residual.find((x) => x.fy === s.fy && x.stage === s.stage)!;
    return {
      slot: s.key, labels: ledger.size, deo_like_labels: deoLike.length, matched_to_card_office: matched.length, matched_to_legacy_office: legacy.length,
      unmatched: deoLike.length - matched.length - legacy.length, offices_with_amount: Object.values(offices).filter((o) => o.years.find((y) => y.fy === s.fy && y.stage === s.stage)?.php != null).length,
      total_php: r.total_php, deo_php: r.deo_php, residual_share: Number(((r.total_php - r.deo_php) / r.total_php).toFixed(4)),
      unmatched_php: r.unmatched_php, unmatched_labels: r.unmatched_labels.map((l) => ({ label: l, php: ledger.get(l)!, kind: matches.get(l)!.kind, office: matches.get(l)!.office_id })),
    };
  });
  const manifest = {
    built_at: builtAt, source_commit: sourceCommit, output: "districts.json",
    inputs: Object.fromEntries([
      ["crosswalk", crosswalkPath], ["crosswalk_manifest", manifestPath], ["contract", args.contract],
      ["gaa_operating_units", resolve(args.gaa, "operating_units.json")], ["gaa_yearly_totals", resolve(args.gaa, "yearly_totals.json")],
      ["nep_operating_units", resolve(args.nep, "operating_units.json")], ["nep_summary", resolve(args.nep, "summary.json")],
      ["hgab_overview", resolve(args.out, "overview.json")], ["hgab_dpwh_parquet", resolve(args.out, "dpwh", "projects.parquet")],
      ["juris_authors", resolve(args.out, "juris-authors.json")],
    ].map(([k, p]) => [k, { path: p, sha256: sha256(p) }])),
    juris: { url: JURIS_API, fetched_at: juris.fetched_at, authors: juris.items.length, house_members_with_code: byCode.size, seats_matched: repMatched, seats_unmatched: repUnmatched, unmatched: unmatchedNames },
    offices: { on_cards: Object.keys(offices).length, tier_a: Object.values(offices).filter((o) => o.tier === "A").length, tier_b: Object.values(offices).filter((o) => o.tier === "B").length, with_fy2027_block: Object.values(offices).filter((o) => o.fy2027).length },
    districts: { total: districts.length, attribution: Object.fromEntries(["A", "B", "mixed", "none"].map((k) => [k, districts.filter((d) => d.attribution === k).length])) },
    aliases: ALIASES.map((a) => ({
      ...a,
      resolves_to: matches.get(a.label)?.kind ?? "unused",
      used_in: SLOTS.filter((s) => ledgers.get(s.key)!.has(a.label)).map((s) => ({ slot: s.key, php: ledgers.get(s.key)!.get(a.label)! })),
    })),
    normalised_joins: aliasUses.filter((u) => u.via === "normalised").map((u) => ({ office: u.office, label: u.label, slots: u.slots, transforms: matches.get(u.label)?.transforms ?? [] })),
    // DEO2LEG condition 3 (buildCongressIndex.mjs classifyRow): how every 2027 DPWH line was classified.
    office_lens: {
      classification: hgab.lens.counts,
      no_office: { ...noOfficeTotals, lines: noOffice.map((r) => ({ id: r.id, title: r.title, label: r.label, side_lists: r.own, nep_php: r.nep_php, hgab3_php: r.hgab3_php })) },
      same_group_office_differs: hgab.lens.sameGroupOfficeDiffers,
      office_change: { ...changeTotals, row_ids: undefined, lines: hgab.lens.changeRows.map((r) => ({ id: r.id, title: r.title, booked_label_before: r.label, third: r.third, nep: r.nep, cross_district: r.cross, nep_php: r.nep_php, hgab3_php: r.hgab3_php })) },
    },
    coverage,
  };
  writeFileSync(resolve(args.out, "districts-manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);

  log(`\n  offices on cards ${manifest.offices.on_cards} (A ${manifest.offices.tier_a} · B ${manifest.offices.tier_b} · with FY2027 block ${manifest.offices.with_fy2027_block})`);
  log(`  districts ${districts.length} · attribution ${JSON.stringify(manifest.districts.attribution)}`);
  const lc = hgab.lens.counts;
  log(`  office lens: group ${lc.group} · residual ${lc.residual} · office_change ${lc.office_change} (cross-district ${changeTotals.cross_district_rows}, one side ${changeTotals.one_side_rows}) · no_office ${lc.no_office} · no_stage ${lc.no_stage}`);
  log(`    office change held out: NEP ${peso(changeTotals.nep_php)} · House ${peso(changeTotals.hgab3_php)} · ${officeChange.size} offices annotated`);
  log(`    no office (residual, as upstream): ${noOffice.length} · House ${peso(noOfficeTotals.hgab3_php)} (${noOffice.map((r) => `${r.id} under ${r.label}`).join("; ")})`);
  log(`    kept with one group though the two sides name different offices of it: ${hgab.lens.sameGroupOfficeDiffers.length} (${hgab.lens.sameGroupOfficeDiffers.map((x) => `${x.id}: ${x.third.join("|")} / NEP ${x.nep.join("|")}`).join("; ")})`);
  log(`  representatives joined ${repMatched}/${districts.length}${unmatchedNames.length ? ` · unmatched: ${unmatchedNames.join("; ")}` : ""}`);
  for (const c of coverage) log(`  ${c.slot.padEnd(10)} DEO-like ${String(c.deo_like_labels).padStart(3)} → card ${c.matched_to_card_office} · legacy ${c.matched_to_legacy_office} · unmatched ${c.unmatched} · residual ${(c.residual_share * 100).toFixed(1)}% · unmatched ${peso(c.unmatched_php)}`);
  log(`\nwrote ${outPath}`);
}

function describeYears(years: number[]): string {
  if (!years.length) return "";
  const runs: Array<[number, number]> = [];
  for (const y of [...years].sort()) {
    const last = runs[runs.length - 1];
    if (last && last[1] === y - 1) last[1] = y; else runs.push([y, y]);
  }
  return runs.map(([a, b]) => (a === b ? `FY${a}` : `FY${a}–${b}`)).join(", ");
}
function describeSlots(keys: string[]): string {
  const gaa = keys.filter((k) => k.startsWith("gaa:")).map((k) => Number(k.slice(4)));
  const parts: string[] = [];
  if (gaa.length) parts.push(`${describeYears(gaa)} GAA`);
  if (keys.includes("nep:2027")) parts.push("FY2027 NEP");
  if (keys.includes("hgab3:2027")) parts.push("FY2027 House bill, third reading");
  return parts.join(", ");
}
/** Reader-facing year runs for office notes: "2020–2022", "2020, 2024". (`describeYears` keeps the FY form for the manifest.) */
function plainYears(years: number[]): string {
  return describeYears(years).replace(/FY/g, "");
}
/** Reader-facing slot list for office notes: "enacted budgets 2020–2026, 2027 NEP". */
function plainSlots(keys: string[]): string {
  const gaa = keys.filter((k) => k.startsWith("gaa:")).map((k) => Number(k.slice(4)));
  const parts: string[] = [];
  if (gaa.length) parts.push(`enacted budget${gaa.length > 1 ? "s" : ""} ${plainYears(gaa)}`);
  if (keys.includes("nep:2027")) parts.push("2027 NEP");
  if (keys.includes("hgab3:2027")) parts.push("2027 House bill");
  return parts.join(", ");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
