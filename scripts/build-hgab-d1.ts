/**
 * FY2027 HGAB D1 layer: writes `data/hgab/2027/d1-import.sql`, the tables the
 * public API (`/api/v1/hgab/2027/…`) and the MCP tools read. The contract —
 * DDL, row counts, rules — is `docs/hgab-api.md`; the embedded DDL below is
 * asserted equal to the SQL block there on every run.
 *
 * Inputs are the files the pages already read (nothing is rebuilt or
 * re-derived): `overview.json`, `<dataset>/summary.json`,
 * `<dataset>/projects.parquet`, `<dataset>/map.json` and `districts.json`.
 *
 * The file drops and recreates only `hgab_*` tables, then loads them with
 * batched multi-row INSERTs. Every statement stays under 95,000 bytes (D1's
 * limit is 100 KB; asserted). Text literals double their single quotes and
 * nothing else (SQLite has no backslash escapes); integers are written as
 * integers and absent values as NULL. Every value is type-checked against its
 * column's declared type and NOT NULL constraint before it is written.
 *
 * Scripts cannot import `src/lib/hgab.ts` (it reads `import.meta.env`), so
 * `traceInfo()` group/held, `regionKeyOf()`, REGION_ORDER and REGION_LABELS
 * are replicated here and asserted, on every run, to agree with the
 * contract's own source (transpiled and evaluated) on known labels and on
 * every label in the data. PLAIN_TERMS (`hgab_meta.terms_json`) is read from
 * the contract the same way; the notice is the text of `DisclaimerNotice` in
 * `src/components/HgabBits.tsx`.
 *
 *   npm run build:hgab-d1
 *   npm run build:hgab-d1 -- --out=data/hgab/2027 --split-mb=20   (numbered files, schema first)
 *   npx wrangler d1 execute budget --local --file=data/hgab/2027/d1-import.sql
 *   npm run verify:hgab -- --d1=local
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import ts from "typescript";

// ---------------------------------------------------------------------------
// Contract replicas (src/lib/hgab.ts; agreement asserted in contractAgreement())
// ---------------------------------------------------------------------------

type DatasetKey = "dpwh" | "fmr" | "hfep" | "nia";
const DATASET_ORDER: readonly DatasetKey[] = ["dpwh", "fmr", "hfep", "nia"];
type BridgeGroup = "house_only" | "nep_only" | "unchanged" | "increased" | "decreased" | "scope_review";
type RegionKey =
  | "NCR" | "CAR" | "I" | "II" | "III" | "IV-A" | "MIMAROPA" | "V" | "VI" | "VII" | "VIII"
  | "IX" | "X" | "XI" | "XII" | "XIII" | "BARMM" | "NIR";

const REGION_ORDER: readonly RegionKey[] = [
  "NCR", "CAR", "I", "II", "III", "IV-A", "MIMAROPA", "V", "VI", "NIR", "VII", "VIII",
  "IX", "X", "XI", "XII", "XIII", "BARMM",
];
const REGION_LABELS: Record<RegionKey, { short: string; name: string }> = {
  NCR: { short: "NCR", name: "Metro Manila" },
  CAR: { short: "CAR", name: "Cordillera" },
  I: { short: "Region I", name: "Ilocos" },
  II: { short: "Region II", name: "Cagayan Valley" },
  III: { short: "Region III", name: "Central Luzon" },
  "IV-A": { short: "Region IV-A", name: "Calabarzon" },
  MIMAROPA: { short: "MIMAROPA", name: "Mimaropa" },
  V: { short: "Region V", name: "Bicol" },
  VI: { short: "Region VI", name: "Western Visayas" },
  NIR: { short: "NIR", name: "Negros Island" },
  VII: { short: "Region VII", name: "Central Visayas" },
  VIII: { short: "Region VIII", name: "Eastern Visayas" },
  IX: { short: "Region IX", name: "Zamboanga Peninsula" },
  X: { short: "Region X", name: "Northern Mindanao" },
  XI: { short: "Region XI", name: "Davao" },
  XII: { short: "Region XII", name: "Soccsksargen" },
  XIII: { short: "Region XIII", name: "Caraga" },
  BARMM: { short: "BARMM", name: "Bangsamoro" },
};
const ROMAN: Record<string, RegionKey> = {
  I: "I", II: "II", III: "III", V: "V", VI: "VI", VII: "VII", VIII: "VIII", IX: "IX", X: "X", XI: "XI", XII: "XII", XIII: "XIII",
};

/** Exact replica of the contract's regionKeyOf(). */
function regionKeyOf(label: string | null | undefined): RegionKey | null {
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

/** TRACE_LABELS group and held flag per trace (the contract's traceInfo(): unknown traces have no group, held false). */
const TRACE_GROUPS: Record<string, { group: BridgeGroup; held: boolean }> = {
  amount_same: { group: "unchanged", held: false },
  house_only_candidate: { group: "house_only", held: false },
  nep_only_candidate: { group: "nep_only", held: false },
  candidate_increase: { group: "increased", held: false },
  candidate_decrease: { group: "decreased", held: false },
  fuzzy_candidate: { group: "house_only", held: true },
  ambiguous: { group: "house_only", held: true },
  segment_scope_review: { group: "scope_review", held: false },
  transparency_gap_then_amount_same: { group: "unchanged", held: false },
  transparency_gap_then_candidate_increase: { group: "increased", held: false },
  transparency_gap_then_candidate_decrease: { group: "decreased", held: false },
  transparency_gap_then_segment_scope_review: { group: "scope_review", held: false },
  outside_api_then_amount_same: { group: "unchanged", held: false },
  outside_api_then_candidate_increase: { group: "increased", held: false },
  outside_api_then_candidate_decrease: { group: "decreased", held: false },
  outside_api_then_segment_scope_review: { group: "scope_review", held: false },
};
function traceInfo(trace: string | null | undefined): { group: BridgeGroup | null; held: boolean } {
  if (!trace) return { group: null, held: false };
  const t = TRACE_GROUPS[trace];
  return t ? { group: t.group, held: t.held } : { group: null, held: false };
}

/** Known labels the replicas must map exactly so (plus every label in the data, checked against the contract). */
const REGION_PROBES: ReadonlyArray<[string | null, RegionKey | null]> = [
  ["Region IVA - CALABARZON", "IV-A"], ["REGION IVB - MIMAROPA", "MIMAROPA"], ["CALABARZON", "IV-A"], ["Region IV-A", "IV-A"],
  ["Region IV‑A", "IV-A"], ["NEGROS ISLAND REGION (NIR)", "NIR"], ["CORDILLERA ADMINISTRATIVE REGION (CAR)", "CAR"],
  ["REGION XIII - CARAGA", "XIII"], ["Region XIII", "XIII"], ["NCR", "NCR"], ["National Capital Region", "NCR"], ["BARMM", "BARMM"],
  ["ARMM", "BARMM"], ["Region X - NORTHERN MINDANAO", "X"], ["Region IV", null], ["Nationwide", null], ["Central Office", null], ["", null], [null, null],
];
const TRACE_PROBES: ReadonlyArray<[string | null, BridgeGroup | null, boolean]> = [
  ["amount_same", "unchanged", false], ["house_only_candidate", "house_only", false], ["nep_only_candidate", "nep_only", false],
  ["fuzzy_candidate", "house_only", true], ["ambiguous", "house_only", true], ["segment_scope_review", "scope_review", false],
  ["transparency_gap_then_candidate_decrease", "decreased", false], ["outside_api_then_candidate_decrease", "decreased", false],
  ["not_a_trace", null, false], [null, null, false],
];

// ---------------------------------------------------------------------------
// D1 schema (docs/hgab-api.md "D1 tables", verbatim; asserted equal to the doc)
// ---------------------------------------------------------------------------

const DDL = `
CREATE TABLE hgab_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fiscal_year INTEGER NOT NULL,
  built_at TEXT NOT NULL,            -- overview.json built_at
  source_repo TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  notice TEXT NOT NULL,              -- the plain disclaimer paragraph
  terms_json TEXT NOT NULL           -- PLAIN_TERMS from src/lib/hgab.ts
);

CREATE TABLE hgab_datasets (
  key TEXT PRIMARY KEY,              -- dpwh | fmr | hfep | nia
  sort INTEGER NOT NULL,
  label TEXT NOT NULL, short TEXT NOT NULL, agency TEXT NOT NULL, dept_id TEXT NOT NULL,
  summary TEXT NOT NULL, one_row TEXT NOT NULL, caveats_json TEXT NOT NULL,
  grain TEXT NOT NULL, scope TEXT NOT NULL, controls_label TEXT NOT NULL,
  has_readings INTEGER NOT NULL, has_map INTEGER NOT NULL,
  house_stage TEXT NOT NULL,         -- hgab3 for DPWH, hgab2 for the one-list programs
  nep_php INTEGER NOT NULL, hgab2_php INTEGER, hgab3_php INTEGER, api_php INTEGER,
  nep_count INTEGER NOT NULL, hgab2_count INTEGER, hgab3_count INTEGER, api_count INTEGER,
  printed_json TEXT,                 -- HgabDatasetMeta.printed
  bridge_json TEXT NOT NULL,         -- HgabDatasetMeta.bridge
  documents_json TEXT NOT NULL,      -- { nep: [...], house: [...] }
  readings_json TEXT,                -- DPWH: summary.readings minus third_only rows (ids listed instead)
  not_on_map_json TEXT,              -- map.json not_on_map
  map_note TEXT, points_note TEXT, placeable INTEGER NOT NULL
);

CREATE TABLE hgab_documents (
  key TEXT PRIMARY KEY, sort INTEGER NOT NULL, title TEXT NOT NULL, stage TEXT NOT NULL,
  reading INTEGER, volume TEXT, pages_json TEXT, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
  source_url TEXT, notes TEXT, pdf_url TEXT NOT NULL
);

CREATE TABLE hgab_controls (
  dataset TEXT NOT NULL, id TEXT NOT NULL, sort INTEGER NOT NULL,
  label TEXT NOT NULL, grp TEXT,
  nep_php INTEGER, hgab2_php INTEGER, hgab3_php INTEGER, api_php INTEGER,
  delta_php INTEGER, reading_delta_php INTEGER,
  nep_page INTEGER, house_pages_json TEXT NOT NULL,
  PRIMARY KEY (dataset, id)
);

CREATE TABLE hgab_dims (
  dataset TEXT NOT NULL, dim TEXT NOT NULL, sort INTEGER NOT NULL, label TEXT NOT NULL,
  nep_php INTEGER NOT NULL, house_php INTEGER NOT NULL,
  nep_records INTEGER NOT NULL, house_records INTEGER NOT NULL,
  PRIMARY KEY (dataset, dim, label)
);

CREATE TABLE hgab_regions (            -- map.json regions: all 18 keys per dataset
  dataset TEXT NOT NULL, region_key TEXT NOT NULL, sort INTEGER NOT NULL,
  label TEXT NOT NULL, name TEXT NOT NULL,   -- REGION_LABELS short / plain name
  nep_php INTEGER, house_php INTEGER, delta_php INTEGER,
  nep_rows INTEGER NOT NULL, house_rows INTEGER NOT NULL, source_labels_json TEXT NOT NULL,
  PRIMARY KEY (dataset, region_key)
);

CREATE TABLE hgab_projects (           -- one row per comparison record; parquet minus record_json
  dataset TEXT NOT NULL, id TEXT NOT NULL,
  title TEXT NOT NULL, program TEXT, pap TEXT,
  region TEXT, region_key TEXT,        -- region_key via regionKeyOf(); null = nationwide / unplaced
  office TEXT, office_kind TEXT, zone TEXT,
  trace TEXT NOT NULL, bridge_group TEXT, held INTEGER NOT NULL,   -- via TRACE_LABELS
  house_match TEXT, reading_status TEXT, api_presence TEXT, confidence REAL,
  nep_php INTEGER, hgab2_php INTEGER, hgab3_php INTEGER, house_php INTEGER, api_php INTEGER,
  delta_php INTEGER,
  nep_page INTEGER, hgab2_page INTEGER, hgab3_page INTEGER,
  nep_doc TEXT, hgab2_doc TEXT, hgab3_doc TEXT,
  length_m REAL, flags TEXT NOT NULL, suggestions INTEGER NOT NULL,
  lon REAL, lat REAL,                  -- from map.json points, only where coordinates are printed
  search_text TEXT NOT NULL,
  PRIMARY KEY (dataset, id)
);
CREATE INDEX hgab_projects_group  ON hgab_projects (dataset, bridge_group, held);
CREATE INDEX hgab_projects_region ON hgab_projects (dataset, region_key);
CREATE INDEX hgab_projects_office ON hgab_projects (dataset, office);
CREATE INDEX hgab_projects_house  ON hgab_projects (dataset, house_php);
CREATE INDEX hgab_projects_delta  ON hgab_projects (dataset, delta_php);

CREATE TABLE hgab_records (            -- the workbench's full source record, for one-project lookups
  dataset TEXT NOT NULL, id TEXT NOT NULL, record_json TEXT NOT NULL,
  PRIMARY KEY (dataset, id)
);

CREATE TABLE hgab_reconciliation (
  sort INTEGER PRIMARY KEY, dataset TEXT NOT NULL, check_name TEXT NOT NULL,
  ours_php INTEGER, theirs_php INTEGER, diff_php INTEGER, status TEXT NOT NULL, note TEXT NOT NULL
);

CREATE TABLE hgab_districts (
  id TEXT PRIMARY KEY, sort INTEGER NOT NULL,
  label TEXT NOT NULL, jurisdiction TEXT NOT NULL, district_label TEXT NOT NULL,
  region TEXT, region_key TEXT, attribution TEXT NOT NULL,
  rep_name TEXT, rep_status TEXT, rep_json TEXT,
  office_ids_json TEXT NOT NULL, co_served_json TEXT NOT NULL,
  fy2026_gaa_php INTEGER, fy2027_nep_php INTEGER, fy2027_hgab3_php INTEGER,
  search_text TEXT NOT NULL
);
CREATE INDEX hgab_districts_region ON hgab_districts (region_key);

CREATE TABLE hgab_offices (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, region TEXT, region_key TEXT,
  tier TEXT NOT NULL, district_ids_json TEXT NOT NULL,
  years_json TEXT NOT NULL, by_congress_json TEXT NOT NULL, fy2027_json TEXT,
  notes_json TEXT NOT NULL, aliases_json TEXT NOT NULL
);

CREATE TABLE hgab_residual (
  fy INTEGER NOT NULL, stage TEXT NOT NULL, sort INTEGER NOT NULL,
  total_php INTEGER NOT NULL, deo_php INTEGER NOT NULL, central_office_php INTEGER NOT NULL,
  regional_offices_php INTEGER NOT NULL, unmatched_php INTEGER NOT NULL,
  unmatched_labels_json TEXT NOT NULL,
  PRIMARY KEY (fy, stage)
);
`;

/** Contract row counts (docs/hgab-api.md "Expected row counts"). `hgab_dims` is not pinned there; it is printed. */
const EXPECTED_ROWS: Record<string, number> = {
  hgab_meta: 1, hgab_datasets: 4, hgab_documents: 8, hgab_controls: 46 + 16 + 12 + 6, hgab_regions: 72,
  hgab_projects: 20_431, hgab_records: 20_431, hgab_reconciliation: 69, hgab_districts: 254, hgab_offices: 200, hgab_residual: 9,
};
const EXPECTED_PER_DATASET: Record<"controls" | "projects", Record<DatasetKey, number>> = {
  controls: { dpwh: 46, fmr: 16, hfep: 12, nia: 6 },
  projects: { dpwh: 17_613, fmr: 1_059, hfep: 746, nia: 1_013 },
};

/** D1 rejects statements over 100,000 bytes; every statement must stay under this (asserted). */
const MAX_STATEMENT_BYTES = 95_000;
/** Batches are cut before they would pass this, leaving headroom under the assert. */
const TARGET_STATEMENT_BYTES = 90_000;
const PDF_BASE = "https://budget-assets.bettergov.ph/hgab/2027/pdf";
const SITE = "https://budget.bettergov.ph";

// ---------------------------------------------------------------------------
// Input shapes (the subset read here; src/lib/hgab.ts has the full contract)
// ---------------------------------------------------------------------------

interface BridgeCell { rows: number; php: number; nep_php?: number | null; house_php?: number | null }
interface Bridge extends Record<BridgeGroup, BridgeCell> { net_php: number; house_stage: "hgab2" | "hgab3" }
interface DatasetMeta {
  key: DatasetKey; label: string; short: string; agency: string; dept_id: string; summary: string; one_row: string; caveats: string[];
  grain: string; scope: string;
  totals: { nep_php: number; hgab2_php: number | null; hgab3_php: number | null; api_php: number | null };
  counts: { nep: number; hgab2: number | null; hgab3: number | null; api: number | null };
  printed: { nep_new_appropriations_php: number | null; house_new_appropriations_php: number | null } | null;
  bridge: Bridge; documents: { nep: string[]; house: string[] }; controls_label: string; has_readings: boolean; has_map: boolean;
}
interface Doc {
  key: string; title: string; stage: string; reading: number | null; volume: string | null; pages: { from: number; to: number } | null;
  sha256: string; bytes: number; source_url: string | null; notes: string | null;
}
interface Recon { dataset: DatasetKey; check: string; ours_php: number | null; theirs_php: number | null; diff_php: number | null; status: string; note: string }
interface Overview { fiscal_year: number; built_at: string; source_repo: string; source_commit: string; datasets: DatasetMeta[]; documents: Doc[]; reconciliation: Recon[] }
interface ControlRow {
  id: string; label: string; group: string | null; nep_php: number | null; hgab2_php: number | null; hgab3_php: number | null; api_php: number | null;
  delta_php: number | null; reading_delta_php: number | null; nep_page: number | null; house_pages: number[];
}
interface DimRow { label: string; nep_php: number; house_php: number; nep_records: number; house_records: number }
interface Summary {
  dataset: DatasetMeta; controls: ControlRow[]; dims: Record<string, DimRow[]>;
  readings: ({ third_only: Array<{ id: string }> } & Record<string, unknown>) | null;
}
interface MapRegion { key: RegionKey; label: string; nep_php: number | null; house_php: number | null; delta_php: number | null; nep_rows: number; house_rows: number; source_labels: string[] }
interface MapPoint { id: string; lon: number; lat: number; group: BridgeGroup | null; held: boolean; trace: string }
interface DatasetMap {
  dataset: DatasetKey; house_stage: string; regions: MapRegion[]; not_on_map: Record<string, unknown> | null; points: MapPoint[];
  points_note: string; placeable: boolean; note: string;
}
interface Representative { name: string; status: string; candidates?: Representative[] }
interface DistrictCard {
  id: string; label: string; jurisdiction: string; district_label: string; region: string | null; representative: Representative | null;
  office_ids: string[]; attribution: string; co_served_district_ids: string[];
  headline: { fy2026_gaa_php: number | null; fy2027_nep_php: number | null; fy2027_hgab3_php: number | null };
}
interface OfficeHistory {
  id: string; name: string; kind: string; region: string | null; district_ids: string[]; tier: string; years: unknown[]; by_congress: unknown[];
  fy2027: unknown; aliases_used: string[]; notes: string[];
}
interface ResidualYear {
  fy: number; stage: string; total_php: number; deo_php: number; central_office_php: number; regional_offices_php: number; unmatched_php: number; unmatched_labels: string[];
}
interface DistrictIndex { districts: DistrictCard[]; offices: Record<string, OfficeHistory>; residual: ResidualYear[] }

// ---------------------------------------------------------------------------
// Args and helpers
// ---------------------------------------------------------------------------

interface Args { out: string; file: string; contract: string; apiDoc: string; disclaimer: string; splitMb: number }
function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const out = resolve(get("out") ?? "data/hgab/2027");
  const splitMb = Number(get("split-mb") ?? "0");
  if (!Number.isFinite(splitMb) || splitMb < 0) throw new Error(`--split-mb must be a non-negative number of megabytes, got ${get("split-mb")}`);
  return {
    out,
    file: resolve(get("file") ?? resolve(out, "d1-import.sql")),
    contract: resolve(get("contract") ?? "src/lib/hgab.ts"),
    apiDoc: resolve(get("api-doc") ?? "docs/hgab-api.md"),
    disclaimer: resolve(get("disclaimer") ?? "src/components/HgabBits.tsx"),
    splitMb,
  };
}

const log = (s: string) => process.stdout.write(`${s}\n`);
function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const readJson = <T,>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const fmtBytes = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${(n / 1e3).toFixed(1)} KB`);
const json = (v: unknown) => JSON.stringify(v);
const jsonOrNull = (v: unknown) => (v == null ? null : JSON.stringify(v));
const bool = (v: boolean) => (v ? 1 : 0);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// ---------------------------------------------------------------------------
// Contract agreement: replicas vs the contract's own source
// ---------------------------------------------------------------------------

interface ContractEval {
  PLAIN_TERMS: Record<string, { term: string; meaning: string }>;
  TRACE_LABELS: Record<string, { label: string; group: string; held?: boolean; help: string }>;
  REGION_ORDER: string[];
  REGION_LABELS: Record<string, { short: string; name: string }>;
  regionKeyOf: (l: string | null | undefined) => string | null;
}

/** Transpile the contract's own constants and regionKeyOf() (no import: the module reads import.meta.env) and evaluate them. */
function evalContract(path: string): ContractEval {
  const src = readFileSync(path, "utf8");
  const block = (re: RegExp, what: string) => {
    const m = re.exec(src);
    ensure(m, `${what} not found in ${path}`);
    return m[1].replace(/^export /gm, "");
  };
  const code = [
    block(/(export const PLAIN_TERMS[\s\S]*?\n\};)/, "PLAIN_TERMS"),
    block(/(export const TRACE_LABELS[\s\S]*?\n\};)/, "TRACE_LABELS"),
    block(/(export const REGION_ORDER[\s\S]*?\n\];)/, "REGION_ORDER"),
    block(/(export const REGION_LABELS[\s\S]*?\n\};)/, "REGION_LABELS"),
    block(/(const ROMAN[\s\S]*?\nexport function regionKeyOf[\s\S]*?\n\})/, "regionKeyOf"),
  ].join("\n");
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(`${js}\nreturn { PLAIN_TERMS, TRACE_LABELS, REGION_ORDER, REGION_LABELS, regionKeyOf };`)() as ContractEval;
}

function contractAgreement(c: ContractEval, labels: Iterable<string | null>, traces: Iterable<string>): void {
  ensure(c.REGION_ORDER.join(",") === REGION_ORDER.join(","), `REGION_ORDER differs from the contract: ${c.REGION_ORDER.join(",")}`);
  ensure(JSON.stringify(c.REGION_LABELS) === JSON.stringify(REGION_LABELS), "REGION_LABELS differ from the contract");
  const contractGroups = Object.fromEntries(Object.entries(c.TRACE_LABELS).map(([k, v]) => [k, { group: v.group, held: Boolean(v.held) }]));
  ensure(JSON.stringify(contractGroups) === JSON.stringify(TRACE_GROUPS), "TRACE_LABELS group/held differ from the contract");
  for (const [label, want] of REGION_PROBES) {
    ensure(regionKeyOf(label) === want, `regionKeyOf replica: "${label}" → ${regionKeyOf(label)}, expected ${want}`);
    ensure(c.regionKeyOf(label) === want, `contract regionKeyOf: "${label}" → ${c.regionKeyOf(label)}, expected ${want}`);
  }
  for (const l of labels) ensure(c.regionKeyOf(l) === regionKeyOf(l), `regionKeyOf replica disagrees with the contract on "${l}": ${c.regionKeyOf(l)} vs ${regionKeyOf(l)}`);
  const contractTrace = (t: string | null) => {
    const x = t ? c.TRACE_LABELS[t] : undefined;
    return x ? { group: x.group, held: Boolean(x.held) } : { group: null, held: false };
  };
  for (const [t, group, held] of TRACE_PROBES) {
    const mine = traceInfo(t), theirs = contractTrace(t);
    ensure(mine.group === group && mine.held === held, `traceInfo replica: ${t} → ${mine.group}/${mine.held}, expected ${group}/${held}`);
    ensure(theirs.group === group && theirs.held === held, `contract traceInfo: ${t} → ${theirs.group}/${theirs.held}, expected ${group}/${held}`);
  }
  for (const t of traces) {
    const mine = traceInfo(t), theirs = contractTrace(t);
    ensure(mine.group != null, `trace "${t}" is not in TRACE_LABELS`);
    ensure(mine.group === theirs.group && mine.held === theirs.held, `traceInfo replica disagrees with the contract on ${t}`);
  }
  ensure(Object.keys(c.PLAIN_TERMS).length > 0 && Object.values(c.PLAIN_TERMS).every((t) => t.term && t.meaning), "PLAIN_TERMS empty or malformed");
}

/** The disclaimer paragraph, as `DisclaimerNotice` prints it, plus where the full notice lives. */
function disclaimerNotice(path: string): string {
  const src = readFileSync(path, "utf8");
  const fn = /export function DisclaimerNotice[\s\S]*?\n\}/.exec(src)?.[0] ?? "";
  const eyebrow = /hgab-disclaimer-eyebrow">([^<]+)</.exec(fn)?.[1]?.trim();
  const body = /<p>\s*([\s\S]*?)\{' '\}\s*<Link/.exec(fn)?.[1]?.replace(/\s+/g, " ").trim();
  ensure(eyebrow && body, `DisclaimerNotice text not found in ${path} (its markup changed; update disclaimerNotice())`);
  const text = `${eyebrow}. ${body} Read the full notice: ${SITE}/hgab/2027/methodology#disclaimer.`;
  ensure(!/[<>{}]/.test(text) && /candidates/.test(text) && /not an official record/.test(text), `disclaimer extraction looks wrong: ${text}`);
  return text;
}

// ---------------------------------------------------------------------------
// Schema parsing and SQL literals
// ---------------------------------------------------------------------------

type ColType = "INTEGER" | "REAL" | "TEXT";
interface Column { name: string; type: ColType; notNull: boolean }
interface Table { name: string; columns: Column[] }

const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "");
const normaliseSql = (sql: string) => stripComments(sql).replace(/\s+/g, " ").replace(/\s*([(),;])\s*/g, "$1").trim();

/** Split a CREATE TABLE body on top-level commas. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseSchema(ddl: string): { tables: Table[]; statements: string[] } {
  const clean = stripComments(ddl);
  const statements = clean.split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean).map((s) => `${s};`);
  const tables: Table[] = [];
  for (const m of clean.matchAll(/CREATE TABLE (\w+) \(([\s\S]*?)\);/g)) {
    const columns: Column[] = [];
    const pk: string[] = [];
    for (const part of splitTopLevel(m[2])) {
      const tpk = /^PRIMARY KEY \(([^)]*)\)$/i.exec(part);
      if (tpk) { pk.push(...tpk[1].split(",").map((s) => s.trim())); continue; }
      const c = /^(\w+)\s+(INTEGER|REAL|TEXT)\b([\s\S]*)$/i.exec(part);
      ensure(c, `cannot parse column "${part}" of ${m[1]}`);
      columns.push({ name: c[1], type: c[2].toUpperCase() as ColType, notNull: /NOT NULL|PRIMARY KEY/i.test(c[3]) });
    }
    for (const p of pk) {
      const col = columns.find((x) => x.name === p);
      ensure(col, `${m[1]}: primary key column ${p} not declared`);
      col.notNull = true;
    }
    tables.push({ name: m[1], columns });
  }
  ensure(tables.every((t) => t.name.startsWith("hgab_")), "every table must be hgab_*");
  return { tables, statements };
}

/** One SQLite literal, checked against the column's declared type. */
function literal(table: string, col: Column, v: unknown): string {
  const where = `${table}.${col.name}`;
  if (v === null || v === undefined) {
    ensure(!col.notNull, `${where} is NOT NULL but the value is ${v}`);
    return "NULL";
  }
  switch (col.type) {
    case "INTEGER": {
      if (typeof v === "bigint") {
        ensure(v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER), `${where}: ${v} exceeds the JS safe-integer range`);
        return v.toString();
      }
      ensure(typeof v === "number" && Number.isSafeInteger(v), `${where} must be an integer, got ${typeof v} ${String(v)}`);
      return String(v);
    }
    case "REAL":
      ensure(typeof v === "number" && Number.isFinite(v), `${where} must be a finite number, got ${typeof v} ${String(v)}`);
      return String(v); // shortest round-trip form; SQLite reads it back to the same double
    case "TEXT":
      ensure(typeof v === "string", `${where} must be text, got ${typeof v}`);
      ensure(!v.includes("\u0000"), `${where} contains a NUL character`);
      ensure(!LONE_SURROGATE.test(v), `${where} contains a lone UTF-16 surrogate (would not round-trip as UTF-8)`);
      return `'${v.replace(/'/g, "''")}'`;
  }
}

interface Statement { table: string | null; sql: string; bytes: number; rows: number }

/** Batched multi-row INSERTs, each cut before it would pass TARGET_STATEMENT_BYTES. */
function inserts(table: Table, rows: Array<Record<string, unknown>>): Statement[] {
  const names = table.columns.map((c) => c.name);
  const head = `INSERT INTO ${table.name} (${names.join(", ")}) VALUES\n`;
  const headBytes = Buffer.byteLength(head);
  const out: Statement[] = [];
  let tuples: string[] = [], bytes = headBytes;
  const flush = () => {
    if (!tuples.length) return;
    const sql = `${head}${tuples.join(",\n")};\n`;
    out.push({ table: table.name, sql, bytes: Buffer.byteLength(sql), rows: tuples.length });
    tuples = []; bytes = headBytes;
  };
  for (const r of rows) {
    const keys = Object.keys(r);
    ensure(keys.length === names.length && names.every((n) => n in r), `${table.name}: row keys ${keys.join(",")} differ from the DDL columns ${names.join(",")}`);
    const tuple = `(${table.columns.map((c) => literal(table.name, c, r[c.name])).join(", ")})`;
    const tb = Buffer.byteLength(tuple) + 2; // ",\n" or ";\n"
    ensure(headBytes + tb < MAX_STATEMENT_BYTES, `${table.name}: one row alone is ${headBytes + tb} bytes, over the ${MAX_STATEMENT_BYTES}-byte statement limit`);
    if (tuples.length && bytes + tb > TARGET_STATEMENT_BYTES) flush();
    tuples.push(tuple); bytes += tb;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface ParquetRow extends Record<string, unknown> { id: string; title: string; region: string | null; trace: string; record_json: string }

async function readParquet(path: string): Promise<ParquetRow[]> {
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  try {
    const reader = await c.runAndReadAll(`SELECT * FROM read_parquet('${path.replace(/'/g, "''")}')`);
    return reader.getRowObjects() as unknown as ParquetRow[];
  } finally {
    c.closeSync(); db.closeSync();
  }
}

const searchText = (parts: Array<string | null | undefined>) =>
  [...new Set(parts.map((p) => (p ?? "").toLowerCase().replace(/\s+/g, " ").trim()).filter(Boolean))].join("|");

function repNames(r: Representative | null): string[] {
  if (!r) return [];
  return [r.name, ...(r.candidates ?? []).flatMap(repNames)];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  const t0 = performance.now();
  for (const f of ["overview.json", "districts.json", ...DATASET_ORDER.flatMap((k) => [`${k}/summary.json`, `${k}/projects.parquet`, `${k}/map.json`])]) {
    ensure(existsSync(resolve(args.out, f)), `${args.out}/${f} missing — run npm run import:hgab, build:hgab-geo and build:hgab-districts first`);
  }

  // Schema: the embedded DDL must be the contract's, word for word.
  if (existsSync(args.apiDoc)) {
    const doc = readFileSync(args.apiDoc, "utf8");
    const block = /## D1 tables[\s\S]*?```sql\n([\s\S]*?)```/.exec(doc)?.[1];
    ensure(block, `no SQL block under "D1 tables" in ${args.apiDoc}`);
    ensure(normaliseSql(block) === normaliseSql(DDL), `the DDL in scripts/build-hgab-d1.ts differs from ${args.apiDoc}; update one to match the other`);
    log(`schema: equal to ${args.apiDoc}`);
  } else {
    log(`schema: ${args.apiDoc} not found, contract comparison skipped`);
  }
  const { tables, statements: ddlStatements } = parseSchema(DDL);
  ensure(tables.length === 12, `expected 12 hgab_* tables in the DDL, found ${tables.length}`);

  const overview = readJson<Overview>(resolve(args.out, "overview.json"));
  ensure(overview.datasets.map((d) => d.key).join(",") === DATASET_ORDER.join(","), "overview datasets out of order");
  const summaries = Object.fromEntries(DATASET_ORDER.map((k) => [k, readJson<Summary>(resolve(args.out, k, "summary.json"))])) as Record<DatasetKey, Summary>;
  const maps = Object.fromEntries(DATASET_ORDER.map((k) => [k, readJson<DatasetMap>(resolve(args.out, k, "map.json"))])) as Record<DatasetKey, DatasetMap>;
  const districts = readJson<DistrictIndex>(resolve(args.out, "districts.json"));
  const parquet = {} as Record<DatasetKey, ParquetRow[]>;
  for (const k of DATASET_ORDER) parquet[k] = await readParquet(resolve(args.out, k, "projects.parquet"));

  // Contract agreement on known labels and every label and trace in the data.
  const contract = evalContract(args.contract);
  const labels = new Set<string | null>([
    ...DATASET_ORDER.flatMap((k) => parquet[k].map((r) => r.region)),
    ...DATASET_ORDER.flatMap((k) => maps[k].regions.flatMap((r) => r.source_labels)),
    ...districts.districts.map((d) => d.region), ...Object.values(districts.offices).map((o) => o.region),
  ]);
  const traces = new Set(DATASET_ORDER.flatMap((k) => parquet[k].map((r) => r.trace)));
  contractAgreement(contract, labels, traces);
  log(`contract agreement: traceInfo group/held, regionKeyOf (${labels.size} labels + ${REGION_PROBES.length} probes), REGION_ORDER, REGION_LABELS ok`);
  const notice = disclaimerNotice(args.disclaimer);

  const rows: Record<string, Array<Record<string, unknown>>> = Object.fromEntries(tables.map((t) => [t.name, []]));

  // hgab_meta
  rows.hgab_meta.push({
    id: 1, fiscal_year: overview.fiscal_year, built_at: overview.built_at, source_repo: overview.source_repo,
    source_commit: overview.source_commit, notice, terms_json: json(contract.PLAIN_TERMS),
  });

  // hgab_datasets
  overview.datasets.forEach((d, i) => {
    const s = summaries[d.key], m = maps[d.key];
    ensure(JSON.stringify(s.dataset) === JSON.stringify(d), `${d.key}: summary.json dataset block differs from overview.json`);
    ensure(m.dataset === d.key && m.house_stage === d.bridge.house_stage, `${d.key}: map.json dataset/house_stage mismatch`);
    ensure(d.has_readings === (s.readings != null), `${d.key}: has_readings disagrees with summary.readings`);
    rows.hgab_datasets.push({
      key: d.key, sort: i, label: d.label, short: d.short, agency: d.agency, dept_id: d.dept_id,
      summary: d.summary, one_row: d.one_row, caveats_json: json(d.caveats), grain: d.grain, scope: d.scope, controls_label: d.controls_label,
      has_readings: bool(d.has_readings), has_map: bool(d.has_map), house_stage: d.bridge.house_stage,
      nep_php: d.totals.nep_php, hgab2_php: d.totals.hgab2_php, hgab3_php: d.totals.hgab3_php, api_php: d.totals.api_php,
      nep_count: d.counts.nep, hgab2_count: d.counts.hgab2, hgab3_count: d.counts.hgab3, api_count: d.counts.api,
      printed_json: jsonOrNull(d.printed), bridge_json: json(d.bridge), documents_json: json(d.documents),
      readings_json: s.readings ? json({ ...s.readings, third_only: s.readings.third_only.map((r) => r.id) }) : null,
      not_on_map_json: jsonOrNull(m.not_on_map), map_note: m.note, points_note: m.points_note, placeable: bool(m.placeable),
    });
  });

  // hgab_documents
  overview.documents.forEach((d, i) => {
    ensure(/^[a-z0-9-]+$/.test(d.key), `document key ${d.key} is not URL-safe`);
    rows.hgab_documents.push({
      key: d.key, sort: i, title: d.title, stage: d.stage, reading: d.reading, volume: d.volume, pages_json: jsonOrNull(d.pages),
      sha256: d.sha256, bytes: d.bytes, source_url: d.source_url, notes: d.notes, pdf_url: `${PDF_BASE}/${d.key}.pdf`,
    });
  });

  for (const key of DATASET_ORDER) {
    const s = summaries[key], m = maps[key];

    // hgab_controls
    ensure(s.controls.length === EXPECTED_PER_DATASET.controls[key], `${key}: ${s.controls.length} controls, contract says ${EXPECTED_PER_DATASET.controls[key]}`);
    ensure(new Set(s.controls.map((c) => c.id)).size === s.controls.length, `${key}: control ids repeat`);
    s.controls.forEach((c, i) => rows.hgab_controls.push({
      dataset: key, id: c.id, sort: i, label: c.label, grp: c.group,
      nep_php: c.nep_php, hgab2_php: c.hgab2_php, hgab3_php: c.hgab3_php, api_php: c.api_php,
      delta_php: c.delta_php, reading_delta_php: c.reading_delta_php, nep_page: c.nep_page, house_pages_json: json(c.house_pages ?? []),
    }));

    // hgab_dims
    for (const [dim, list] of Object.entries(s.dims)) {
      ensure(["region", "office_kind", "program", "pap"].includes(dim), `${key}: unknown dim ${dim}`);
      ensure(new Set(list.map((r) => r.label)).size === list.length, `${key}.${dim}: labels repeat`);
      list.forEach((r, i) => rows.hgab_dims.push({
        dataset: key, dim, sort: i, label: r.label, nep_php: r.nep_php, house_php: r.house_php, nep_records: r.nep_records, house_records: r.house_records,
      }));
    }

    // hgab_regions: all 18 keys. NIA's map.json lists none (its lists print no region), so its 18 rows are empty.
    ensure(m.regions.length === 0 || (m.regions.length === REGION_ORDER.length && m.regions.every((r, i) => r.key === REGION_ORDER[i])),
      `${key}: map.json regions must be empty or the 18 keys in REGION_ORDER`);
    REGION_ORDER.forEach((k, i) => {
      const r = m.regions.find((x) => x.key === k);
      if (r) ensure(r.label === REGION_LABELS[k].short, `${key} ${k}: map label "${r.label}" is not REGION_LABELS short "${REGION_LABELS[k].short}"`);
      rows.hgab_regions.push({
        dataset: key, region_key: k, sort: i, label: REGION_LABELS[k].short, name: REGION_LABELS[k].name,
        nep_php: r?.nep_php ?? null, house_php: r?.house_php ?? null, delta_php: r?.delta_php ?? null,
        nep_rows: r?.nep_rows ?? 0, house_rows: r?.house_rows ?? 0, source_labels_json: json(r?.source_labels ?? []),
      });
    });

    // hgab_projects + hgab_records
    const P = parquet[key];
    ensure(P.length === EXPECTED_PER_DATASET.projects[key], `${key}: ${P.length} parquet rows, contract says ${EXPECTED_PER_DATASET.projects[key]}`);
    const points = new Map<string, MapPoint>();
    for (const p of m.points) { ensure(!points.has(p.id), `${key}: map point ${p.id} repeats`); points.set(p.id, p); }
    const ids = new Set(P.map((r) => r.id));
    ensure(ids.size === P.length, `${key}: parquet ids repeat`);
    for (const id of points.keys()) ensure(ids.has(id), `${key}: map point ${id} has no project row`);
    for (const r of P) {
      ensure(r.dataset === key, `${key}: row ${r.id} carries dataset ${String(r.dataset)}`);
      const info = traceInfo(r.trace);
      const pt = points.get(r.id);
      if (pt) ensure(pt.trace === r.trace && pt.group === info.group && pt.held === info.held, `${key} ${r.id}: map point trace/group/held disagree with the row`);
      const hgab2 = r.hgab2_php as bigint | null, hgab3 = r.hgab3_php as bigint | null;
      rows.hgab_projects.push({
        dataset: key, id: r.id, title: r.title, program: r.program, pap: r.pap,
        region: r.region, region_key: regionKeyOf(r.region),
        office: r.office, office_kind: r.office_kind, zone: r.zone,
        trace: r.trace, bridge_group: info.group, held: bool(info.held),
        house_match: r.house_match, reading_status: r.reading_status, api_presence: r.api_presence, confidence: r.confidence,
        nep_php: r.nep_php, hgab2_php: hgab2, hgab3_php: hgab3, house_php: hgab3 ?? hgab2, api_php: r.api_php, delta_php: r.delta_php,
        nep_page: r.nep_page, hgab2_page: r.hgab2_page, hgab3_page: r.hgab3_page,
        nep_doc: r.nep_doc, hgab2_doc: r.hgab2_doc, hgab3_doc: r.hgab3_doc,
        length_m: r.length_m, flags: r.flags, suggestions: r.suggestions,
        lon: pt?.lon ?? null, lat: pt?.lat ?? null,
        search_text: r.search_text,
      });
      rows.hgab_records.push({ dataset: key, id: r.id, record_json: r.record_json });
    }
  }

  // hgab_reconciliation
  overview.reconciliation.forEach((r, i) => rows.hgab_reconciliation.push({
    sort: i, dataset: r.dataset, check_name: r.check, ours_php: r.ours_php, theirs_php: r.theirs_php, diff_php: r.diff_php, status: r.status, note: r.note,
  }));

  // hgab_districts / hgab_offices / hgab_residual
  const offices = districts.offices;
  districts.districts.forEach((d, i) => {
    for (const o of d.office_ids) ensure(offices[o], `${d.id}: office ${o} not in districts.json offices`);
    const rep = d.representative;
    rows.hgab_districts.push({
      id: d.id, sort: i, label: d.label, jurisdiction: d.jurisdiction, district_label: d.district_label,
      region: d.region, region_key: regionKeyOf(d.region), attribution: d.attribution,
      rep_name: rep?.name ?? null, rep_status: rep?.status ?? null, rep_json: jsonOrNull(rep),
      office_ids_json: json(d.office_ids), co_served_json: json(d.co_served_district_ids),
      fy2026_gaa_php: d.headline.fy2026_gaa_php, fy2027_nep_php: d.headline.fy2027_nep_php, fy2027_hgab3_php: d.headline.fy2027_hgab3_php,
      search_text: searchText([d.label, ...repNames(rep), ...d.office_ids.map((o) => offices[o].name)]),
    });
  });
  for (const [id, o] of Object.entries(offices)) {
    ensure(id === o.id, `offices key ${id} differs from its id ${o.id}`);
    rows.hgab_offices.push({
      id: o.id, name: o.name, kind: o.kind, region: o.region, region_key: regionKeyOf(o.region), tier: o.tier,
      district_ids_json: json(o.district_ids), years_json: json(o.years), by_congress_json: json(o.by_congress),
      fy2027_json: jsonOrNull(o.fy2027), notes_json: json(o.notes), aliases_json: json(o.aliases_used),
    });
  }
  districts.residual.forEach((r, i) => rows.hgab_residual.push({
    fy: r.fy, stage: r.stage, sort: i, total_php: r.total_php, deo_php: r.deo_php, central_office_php: r.central_office_php,
    regional_offices_php: r.regional_offices_php, unmatched_php: r.unmatched_php, unmatched_labels_json: json(r.unmatched_labels),
  }));

  for (const [t, n] of Object.entries(EXPECTED_ROWS)) ensure(rows[t].length === n, `${t}: ${rows[t].length} rows, contract says ${n}`);

  // Statements: drops, the contract DDL, then batched inserts in table order.
  const header = [
    `-- FY2027 House General Appropriations Bill (HGAB) tables for D1 (contract: docs/hgab-api.md).`,
    `-- Generated ${new Date().toISOString()} by scripts/build-hgab-d1.ts from ${args.out.replace(process.cwd() + "/", "")}`,
    `-- (overview.json built ${overview.built_at}, source commit ${overview.source_commit}).`,
    `-- Drops and recreates only hgab_* tables. Amounts are integer pesos; NULL means no record at that stage.`,
    "",
  ].join("\n");
  const schema: Statement[] = [
    ...tables.map((t) => `DROP TABLE IF EXISTS ${t.name};`),
    ...ddlStatements,
  ].map((sql) => ({ table: null, sql: `${sql}\n`, bytes: Buffer.byteLength(`${sql}\n`), rows: 0 }));
  const data: Statement[] = tables.flatMap((t) => inserts(t, rows[t.name]));
  const all = [...schema, ...data];
  const maxStmt = all.reduce((a, s) => Math.max(a, s.bytes), 0);
  ensure(maxStmt < MAX_STATEMENT_BYTES, `a statement is ${maxStmt} bytes, over ${MAX_STATEMENT_BYTES}`);
  for (const s of all) {
    // wrangler strips "BEGIN TRANSACTION" / "COMMIT;" textually before splitting; neither may appear anywhere.
    ensure(!s.sql.includes("BEGIN TRANSACTION"), `a ${s.table ?? "schema"} statement contains "BEGIN TRANSACTION", which wrangler would rewrite`);
  }

  // Files: one, or (--split-mb) the schema first then numbered data files.
  const dir = dirname(args.file);
  const base = args.file.replace(/\.sql$/, "");
  const stem = basename(base).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stale = readdirSync(dir).filter((n) => new RegExp(`^${stem}(-\\d+)?\\.sql$`).test(n)).map((n) => resolve(dir, n));
  for (const f of stale) rmSync(f);
  const files: Array<{ path: string; statements: number; bytes: number }> = [];
  if (!args.splitMb) {
    const body = header + all.map((s) => s.sql).join("");
    writeFileSync(args.file, body);
    files.push({ path: args.file, statements: all.length, bytes: Buffer.byteLength(body) });
  } else {
    const limit = args.splitMb * 1e6;
    const groups: Statement[][] = [schema];
    let cur: Statement[] = [], size = 0;
    for (const s of data) {
      if (cur.length && size + s.bytes > limit) { groups.push(cur); cur = []; size = 0; }
      cur.push(s); size += s.bytes;
    }
    if (cur.length) groups.push(cur);
    groups.forEach((g, i) => {
      const path = `${base}-${String(i + 1).padStart(2, "0")}.sql`;
      const body = `${header}-- Part ${i + 1} of ${groups.length}${i === 0 ? " (schema; load first)" : ""}.\n` + g.map((s) => s.sql).join("");
      writeFileSync(path, body);
      files.push({ path, statements: g.length, bytes: Buffer.byteLength(body) });
    });
  }

  // Size summary.
  log("\ntable                 rows   statements        bytes");
  for (const t of tables) {
    const st = data.filter((s) => s.table === t.name);
    const n = st.reduce((a, s) => a + s.rows, 0);
    log(`${t.name.padEnd(20)} ${n.toLocaleString("en-US").padStart(6)} ${String(st.length).padStart(12)} ${fmtBytes(st.reduce((a, s) => a + s.bytes, 0)).padStart(12)}`);
  }
  log(`schema statements: ${schema.length} (${tables.length} drops, ${tables.length} tables, ${ddlStatements.length - tables.length} indexes)`);
  log(`statements: ${all.length.toLocaleString("en-US")} · largest ${maxStmt.toLocaleString("en-US")} bytes (limit ${MAX_STATEMENT_BYTES.toLocaleString("en-US")})`);
  for (const f of files) log(`wrote ${f.path.replace(process.cwd() + "/", "")}: ${fmtBytes(f.bytes)}, ${f.statements.toLocaleString("en-US")} statements`);
  log(`done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  if (files.length > 1) {
    log(`\nload in order: for f in ${base.replace(process.cwd() + "/", "")}-*.sql; do npx wrangler d1 execute budget --local --file="$f" || break; done`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
