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
  fy2027: { nep_php: number | null; hgab2_php: number | null; hgab3_php: number | null; nep_records: number; hgab3_records: number; bridge: Bridge | null } | null;
  aliases_used: string[]; notes: string[];
}
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
  unmatched_php: number; unmatched_labels: string[];
}
interface HgabDistrictIndex {
  fiscal_year: number; built_at: string; source_commit: string;
  crosswalk: { schema_version: string; build_date: string; offices: number; districts: number; relationships: number };
  representatives_source: { url: string; congress: number; fetched_at: string; notice: string; matched: number; unmatched: number };
  terms: CongressTerm[]; districts: DistrictCard[]; offices: Record<string, OfficeHistory>; residual: ResidualYear[]; scope_notes: string[];
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

async function loadHgab(out: string, traceGroups: Map<string, BridgeGroup>): Promise<{ offices: Map<string, OfficeHgab>; totals: { nep: number; hgab3: number } }> {
  const overview = readJson<{ datasets: Array<{ key: string; totals: { nep_php: number; hgab3_php: number | null }; bridge: Bridge }> }>(resolve(out, "overview.json"));
  const dpwh = overview.datasets.find((d) => d.key === "dpwh");
  ensure(dpwh?.totals.hgab3_php != null, "overview.json has no DPWH dataset with an HGAB 3R total");
  const parquet = resolve(out, "dpwh", "projects.parquet");
  ensure(existsSync(parquet), `${parquet} not found — run \`npm run import:hgab\` first`);

  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  const rows = (await c.runAndReadAll(`
    SELECT office, trace, count(*) AS rows,
           sum(nep_php), sum(hgab2_php), sum(hgab3_php),
           sum(hgab3_php - nep_php) FILTER (hgab3_php IS NOT NULL AND nep_php IS NOT NULL),
           sum(coalesce(json_array_length(record_json->'$.nep.records'), 1)) FILTER (nep_php IS NOT NULL),
           sum(coalesce(json_array_length(record_json->'$.third.records'), 1)) FILTER (hgab3_php IS NOT NULL),
           count(*) FILTER (office IS NULL)
    FROM read_parquet('${q(parquet)}') GROUP BY 1, 2 ORDER BY 1, 2`)).getRows();
  c.closeSync(); db.closeSync();

  interface Acc { nep: number | null; h2: number | null; h3: number | null; nepN: number; h3N: number; cells: Record<BridgeGroup, { rows: number; nep: number; house: number; delta: number }> }
  const acc = new Map<string, Acc>();
  for (const r of rows) {
    const office = r[0] == null ? "" : String(r[0]);
    ensure(office, "a DPWH parquet row has no office; the lens needs the printed office");
    const trace = String(r[1]);
    const group = traceGroups.get(trace);
    ensure(group, `trace ${trace} is not in the contract's TRACE_LABELS`);
    const n = num(r[2]);
    const nep = r[3] == null ? null : num(r[3]), h2 = r[4] == null ? null : num(r[4]), h3 = r[5] == null ? null : num(r[5]);
    const delta = r[6] == null ? 0 : num(r[6]);
    const a = acc.get(office) ?? {
      nep: null, h2: null, h3: null, nepN: 0, h3N: 0,
      cells: Object.fromEntries(BRIDGE_ORDER.map((g) => [g, { rows: 0, nep: 0, house: 0, delta: 0 }])) as Acc["cells"],
    };
    a.nep = sumOrNull([a.nep, nep]); a.h2 = sumOrNull([a.h2, h2]); a.h3 = sumOrNull([a.h3, h3]);
    a.nepN += r[7] == null ? 0 : num(r[7]); a.h3N += r[8] == null ? 0 : num(r[8]);
    const cell = a.cells[group];
    cell.rows += n; cell.nep += nep ?? 0; cell.house += h3 ?? 0; cell.delta += delta;
    acc.set(office, a);
  }

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
  ensure(nepSum === dpwh.totals.nep_php, `parquet NEP sum ${nepSum} ≠ overview ${dpwh.totals.nep_php}`);
  ensure(h3Sum === dpwh.totals.hgab3_php, `parquet HGAB3 sum ${h3Sum} ≠ overview ${dpwh.totals.hgab3_php}`);
  return { offices, totals: { nep: dpwh.totals.nep_php, hgab3: dpwh.totals.hgab3_php } };
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
  const hgab = await loadHgab(args.out, traceGroups);
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
    const fy2027 = h ? { nep_php: h.nep_php, hgab2_php: h.hgab2_php, hgab3_php: h.hgab3_php, nep_records: h.nep_records, hgab3_records: h.hgab3_records, bridge: h.bridge } : null;

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

    const notes: string[] = [];
    const missingGaa = years.filter((y) => y.stage === "gaa" && y.matched_label == null).map((y) => y.fy);
    if (missingGaa.length) notes.push(`No operating unit under this office's name in the ${describeYears(missingGaa)} GAA listing.`);
    const zeroGaa = years.filter((y) => y.stage === "gaa" && y.matched_label != null && y.php == null).map((y) => y.fy);
    if (zeroGaa.length) notes.push(`Listed with a zero appropriation in ${describeYears(zeroGaa)} (shown as null, never 0).`);
    if (years[7].php == null) notes.push("No operating unit under this office's name in the FY2027 NEP listing.");
    if (!fy2027) notes.push(o.type === "regional_group" ? "A regional grouping, not an engineering office: no office ledger exists in any year, and its money stays in the residual." : "No rows under this office in the FY2027 House bill / NEP comparison population.");
    // Predecessor offices whose crosswalk legacy block names this office as a candidate successor.
    for (const [legacyId, lo] of Object.entries(crosswalk.offices)) {
      if (!lo.legacy || !lo.legacy.candidateSuccessors.some((n) => officeIdByName.get(n) === id)) continue;
      const uses = legacyUse.get(legacyId) ?? [];
      if (!uses.length) continue;
      const byLabel = new Map<string, Array<{ key: string; php: number }>>();
      for (const u of uses) byLabel.set(u.label, [...(byLabel.get(u.label) ?? []), { key: u.key, php: u.php }]);
      const parts = [...byLabel].map(([label, xs]) => `'${label}' (${describeSlots(xs.map((x) => x.key))}, ${peso(xs.reduce((a, x) => a + x.php, 0))})`);
      const lastGaa = Math.max(...uses.filter((u) => u.key.startsWith("gaa:")).map((u) => Number(u.key.slice(4))), 0);
      const lead = lastGaa && lastGaa < 2026 && !uses.some((u) => u.key === "nep:2027")
        ? `Before FY${lastGaa + 1} this area was served by ${lo.name}`
        : `The DBM listing also prints the undivided ${lo.name}`;
      notes.push(`${lead} (crosswalk legacy status ${lo.legacy.status}${lo.legacy.law ? `, ${lo.legacy.law}` : ""}; successors ${lo.legacy.candidateSuccessors.join(" / ")}). Its amounts are listed under the residual, never split here: ${parts.join("; ")}.`);
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
    ensure(deo + central + regional + unmatched === total, `${s.key}: residual identity failed`);
    const fromOffices = Object.values(offices).reduce((a, o) => a + (o.years.find((y) => y.stage === s.stage && y.fy === s.fy)?.php ?? 0), 0);
    ensure(fromOffices === deo, `${s.key}: Σ offices ${fromOffices} ≠ deo_php ${deo}`);
    return { fy: s.fy, stage: s.stage, total_php: total, deo_php: deo, central_office_php: central, regional_offices_php: regional, unmatched_php: unmatched, unmatched_labels: labels.sort() };
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
    districts, offices, residual,
    scope_notes: [
      "FY2020–2026 figures are enacted GAA appropriations summed by DPWH operating unit from the GAA operating-unit listing: the whole department, all funds and all expense classes (source files in thousands of pesos, converted to pesos).",
      `The FY2027 'nep' slot is the DBM NEP operating-unit listing on the same whole-department basis (department total ${peso(nep.total)}, including automatic appropriations).`,
      `The FY2027 'hgab3' slot and the fy2027 block are the House bill third reading against the NEP for the DPWH operations population compared in the HGAB section (NEP ${peso(hgab.totals.nep)}, HGAB 3R ${peso(hgab.totals.hgab3)}): named projects only, excluding personnel services, MOOE and other non-project items. fy2027.nep_php is therefore smaller than the 'nep' slot for the same office and the two must never be added or compared as like for like.`,
      "GAA, NEP and HGAB totals are each reconciled per year and stage: deo_php + central_office_php + regional_offices_php + unmatched_php = total_php. 'Central Office' is the label matching /^central office$/i; regional offices match /regional office/i (including '… - Proper'); the BARMM regional grouping counts as regional and never as an office.",
      `Offices are joined by normalised name only (DEO expansion, ordinal words, accents, hyphens, the 'Las Pi±as' mojibake, ' - Proper'). ${ALIASES.length} explicit aliases are declared in the builder and recorded on each office's aliases_used; ${unmatchedByKind.legacy} labels match crosswalk legacy (predecessor) offices with no district and ${unmatchedByKind.unmatched} match nothing — all are listed in residual.unmatched_labels with their money, never assigned to a successor.`,
      "A Tier B office's figures are undivided and shared by every district it serves; card headlines sum the serving offices' undivided totals and must be labelled as a range when attribution is B or mixed. Districts linked only to the BARMM regional grouping have attribution 'none' and null headlines.",
      "69 paired FY2027 rows print a different implementing office on the NEP and House sides; as in the HGAB section, both amounts are booked to the office printed on the House side (the parquet's office column). HGAB statuses are carried verbatim through the per-office bridge (fuzzy and ambiguous rows sit in house_only as the contract maps them).",
      "The crosswalk's scanned allocation table (undated) is used for structure only; none of its amounts appear here.",
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
    coverage,
  };
  writeFileSync(resolve(args.out, "districts-manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);

  log(`\n  offices on cards ${manifest.offices.on_cards} (A ${manifest.offices.tier_a} · B ${manifest.offices.tier_b} · with FY2027 block ${manifest.offices.with_fy2027_block})`);
  log(`  districts ${districts.length} · attribution ${JSON.stringify(manifest.districts.attribution)}`);
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
  if (keys.includes("hgab3:2027")) parts.push("FY2027 HGAB 3R");
  return parts.join(", ");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
