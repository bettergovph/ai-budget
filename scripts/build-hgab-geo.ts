/**
 * FY2027 HGAB maps: province outlines and one map layer per dataset.
 *
 * Writes the files `src/lib/hgab.ts` (section "Maps") describes:
 *
 *   data/hgab/2027/geo/provinces.json     HgabGeo — province outlines, each tagged with the region it belongs to today
 *   data/hgab/2027/<dataset>/map.json     HgabDatasetMap — amounts per region per document, and printed coordinates
 *   data/hgab/2027/geo/manifest.json      input sha256s, parameters, coverage, the region-label table, diagnostics
 *
 * Outlines: philippines-json-maps (Copyright (c) James Faeldon, MIT licence),
 * PSGC boundaries as of 31 December 2023. The high-resolution province files
 * are rounded to 4 decimals and Douglas–Peucker simplified with the smallest
 * tolerance that keeps provinces.json under --max-bytes (every province keeps
 * at least one polygon). Negros Occidental, Negros Oriental and Siquijor carry
 * the Negros Island Region key (created 2024, after the PSGC 2023 release);
 * Sulu carries Region IX (out of BARMM by the 2024 Supreme Court ruling, and
 * printed under Region IX by every list here).
 *
 * Amounts: each dataset's summary.json `dims.region` (every document's amounts
 * tallied under the region label it prints), normalised with the contract's
 * regionKeyOf() and merged per key; labels that normalise to null
 * ("Nationwide") go to `not_on_map`. Nothing is re-derived and nothing is
 * geocoded from place names. Conservation is asserted per document.
 *
 * Points: only coordinates a document prints.
 *   FMR   every row's record_json house/nep `coordinates` (segments of [lon, lat])
 *   DPWH  BetterGov's gps-analysis/data/gps_inventory.json (dataset dpwh_comparison_2027),
 *         joined on record_id = projects.parquet id
 *   HFEP, NIA  none
 *
 * The builder replicates the contract's regionKeyOf(), REGION_ORDER,
 * REGION_LABELS and TRACE_LABELS groups (scripts cannot import src/lib/hgab.ts)
 * and asserts on every run that the replica agrees with the contract.
 *
 *   npm run build:hgab-geo
 *   npm run build:hgab-geo -- --check            (then re-read the outputs and verify them)
 *   npm run build:hgab-geo -- --res=low          (the 0.1% files; default hi)
 *   npm run build:hgab-geo -- --tolerance=0.004  (fixed Douglas–Peucker tolerance in degrees)
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

// ---------------------------------------------------------------------------
// Contract (mirrors src/lib/hgab.ts "Maps"; asserted against it on every run)
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

/** Exact replica of the contract's regionKeyOf(); `contractAgreement` proves it on every label seen. */
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

/** TRACE_LABELS → bridge group and held flag (traceInfo semantics: unknown traces have no group). */
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
const traceInfo = (trace: string) => TRACE_GROUPS[trace] ?? { group: null, held: false };

interface HgabGeo {
  source: string;
  bbox: [number, number, number, number];
  regions: Array<{ key: RegionKey; label: string; plain: string }>;
  provinces: Array<{ psgc: number; name: string; region: RegionKey; polygons: number[][][][] }>;
}
interface MapRegion {
  key: RegionKey; label: string; nep_php: number | null; house_php: number | null; delta_php: number | null;
  nep_rows: number; house_rows: number; source_labels: string[];
}
interface MapPoint {
  id: string; lon: number; lat: number; lines?: number[][][]; title: string; trace: string; group: BridgeGroup | null; held: boolean;
  nep_php: number | null; house_php: number | null; printed_by: "house" | "nep" | "both";
}
interface NotOnMap { label: string; nep_php: number | null; house_php: number | null; nep_rows: number; house_rows: number; plain: string }
interface HgabDatasetMap {
  dataset: DatasetKey; house_stage: "hgab2" | "hgab3"; regions: MapRegion[]; not_on_map: NotOnMap | null; points: MapPoint[];
  points_note: string; placeable: boolean; note: string;
  coverage: { rows_total: number; rows_with_points: number; rows_with_region: number };
}

// Inputs we read (subset of the importer's shapes).
interface DimRow { label: string; nep_php: number; house_php: number; nep_records: number; house_records: number }
interface DatasetMeta {
  key: DatasetKey; totals: { nep_php: number; hgab2_php: number | null; hgab3_php: number | null };
  counts: { nep: number; hgab2: number | null; hgab3: number | null }; bridge: { house_stage: "hgab2" | "hgab3" };
}
interface Summary { dataset: DatasetMeta; dims: { region?: DimRow[] } }
interface Overview { datasets: DatasetMeta[] }
interface Row {
  id: string; title: string; region: string | null; trace: string;
  nep_php: number | null; hgab2_php: number | null; hgab3_php: number | null;
  /** FMR only: the full source record. */
  record_json: string | null;
  /** DPWH only: the NEP's own title (record_json nep.title). */
  nep_title: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOUNDS = { lon: [116, 127], lat: [4, 22] } as const;
const OUTLINE_SOURCE =
  "Philippine Standard Geographic Code boundaries as of 31 December 2023 (PSA), from philippines-json-maps by James Faeldon (MIT licence), simplified for display";
const OUTLINE_REPO = "https://github.com/faeldon/philippines-json-maps";

const RESOLUTIONS = {
  low: { file: (adm1: number) => `prov-provdists-region-${adm1}.0.001.json`, label: "low resolution (0.1% of source vertices)" },
  med: { file: (adm1: number) => `prov-medres-provdists-region-${adm1}.0.01.json`, label: "medium resolution (1% of source vertices)" },
  hi: { file: (adm1: number) => `prov-hires-provdists-region-${adm1}.0.1.json`, label: "high resolution (10% of source vertices)" },
} as const;
type Resolution = keyof typeof RESOLUTIONS;

/** PSGC 2023 region (adm1) codes as the files carry them. */
const ADM1_REGION: Record<number, RegionKey> = {
  100000000: "I", 200000000: "II", 300000000: "III", 400000000: "IV-A", 500000000: "V", 600000000: "VI", 700000000: "VII",
  800000000: "VIII", 900000000: "IX", 1000000000: "X", 1100000000: "XI", 1200000000: "XII", 1300000000: "NCR",
  1400000000: "CAR", 1600000000: "XIII", 1700000000: "MIMAROPA", 1900000000: "BARMM",
};
/**
 * Provinces whose region changed after the PSGC 2023 release, tagged with the
 * region they belong to today — the region every document in this section
 * prints for them.
 */
const REGION_OVERRIDES: Record<number, { name: string; region: RegionKey; why: string }> = {
  604500000: { name: "Negros Occidental", region: "NIR", why: "Negros Island Region, Republic Act 12000 (2024)" },
  704600000: { name: "Negros Oriental", region: "NIR", why: "Negros Island Region, Republic Act 12000 (2024)" },
  706100000: { name: "Siquijor", region: "NIR", why: "Negros Island Region, Republic Act 12000 (2024)" },
  1906600000: { name: "Sulu", region: "IX", why: "Supreme Court (2024): Sulu is not part of BARMM; the DPWH, farm-to-market road and health facility lists all print Sulu under Region IX" },
};
/** Features the source leaves unnamed: PSGC's name for the code. */
const UNNAMED: Record<number, string> = { 1909900000: "Special Geographic Area" };
/** Douglas–Peucker tolerances tried in order (degrees) until provinces.json fits --max-bytes. */
const TOLERANCE_LADDER = [0, 0.001, 0.002, 0.003, 0.004, 0.005, 0.006, 0.008, 0.01];

const BANNED_IN_READER_COPY: ReadonlyArray<[string, RegExp]> = [
  ["ledger", /\bledgers?\b/i], ["control", /\bcontrols?\b/i], ["bridge", /\bbridges?\b/i], ["annex", /\bannex(es)?\b/i],
  ["OCR", /\bOCR\b/i], ["trace", /\btraces?\b/i], ["PDF", /\bPDF\b/i], ["15-digit code", /\b\d{15}\b/],
];

// ---------------------------------------------------------------------------
// Args and helpers
// ---------------------------------------------------------------------------

interface Args { out: string; geo: string; gps: string; contract: string; res: Resolution; tolerance: number | null; maxBytes: number; check: boolean }
function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const res = (get("res") ?? "hi") as Resolution;
  if (!(res in RESOLUTIONS)) throw new Error(`--res must be one of ${Object.keys(RESOLUTIONS).join(", ")}`);
  const tol = get("tolerance");
  return {
    out: resolve(get("out") ?? "data/hgab/2027"),
    geo: resolve(get("geo") ?? "/home/jason/projects/dynasty/data/raw/geo"),
    gps: resolve(get("gps") ?? "/tmp/dpwh-nep-review/repo/gps-analysis/data/gps_inventory.json"),
    contract: resolve(get("contract") ?? "src/lib/hgab.ts"),
    res,
    tolerance: tol == null ? null : Number(tol),
    maxBytes: Number(get("max-bytes") ?? 450_000),
    check: argv.includes("--check"),
  };
}

const log = (s: string) => process.stdout.write(`${s}\n`);
const q = (s: string) => s.replace(/'/g, "''");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRIES = 6;

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
function fileInfo(path: string): { sha256: string; bytes: number } {
  return { sha256: sha256(path), bytes: statSync(path).size };
}
const num = (v: unknown): number | null => (v == null ? null : typeof v === "bigint" ? Number(v) : Number(v));
const str = (v: unknown): string | null => (v == null ? null : String(v));
const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;
/** Great-circle distance in km between two [lon, lat] points. */
function km(a: number[], b: number[]): number {
  const rad = Math.PI / 180, dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
const inBounds = (lon: number, lat: number) => lon >= BOUNDS.lon[0] && lon <= BOUNDS.lon[1] && lat >= BOUNDS.lat[0] && lat <= BOUNDS.lat[1];
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const SMALL = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const count = (n: number) => (n < SMALL.length ? SMALL[n] : n.toLocaleString("en-US"));

/** Another agent may be rewriting the importer's outputs; retry reads that fail mid-write. */
async function readJsonRetry<T>(path: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch (e) {
      if (attempt >= RETRIES) throw e;
      log(`  retry ${attempt} reading ${path}: ${(e as Error).message}`);
      await sleep(5000);
    }
  }
}
async function queryRetry(sql: string): Promise<unknown[][]> {
  for (let attempt = 1; ; attempt++) {
    try {
      const db = await DuckDBInstance.create(":memory:");
      const c = await db.connect();
      try {
        return (await c.runAndReadAll(sql)).getRows() as unknown[][];
      } finally {
        c.closeSync(); db.closeSync();
      }
    } catch (e) {
      if (attempt >= RETRIES) throw e;
      log(`  retry ${attempt} querying parquet: ${(e as Error).message}`);
      await sleep(5000);
    }
  }
}
function writeAtomic(path: string, body: string): number {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, body);
  renameSync(tmp, path);
  return Buffer.byteLength(body);
}

/** One plain sentence, at most 25 words, none of the technical vocabulary. */
function readerSentence(s: string, where: string): string {
  const banned = BANNED_IN_READER_COPY.filter(([, re]) => re.test(s)).map(([n]) => n);
  ensure(banned.length === 0, `${where}: reader-facing text uses ${banned.join(", ")}: ${s}`);
  ensure(words(s) <= 25, `${where}: reader-facing text is ${words(s)} words (max 25): ${s}`);
  ensure(/^[A-Z].*\.$/.test(s) && !/[.!?]\s+\S/.test(s.slice(0, -1)), `${where}: reader-facing text must be one sentence: ${s}`);
  return s;
}

// ---------------------------------------------------------------------------
// Contract agreement
// ---------------------------------------------------------------------------

const PROBE_LABELS = [
  "Region IVA - CALABARZON", "REGION IVB - MIMAROPA", "CALABARZON", "Region IV-A", "Region IV‑A", "NEGROS ISLAND REGION (NIR)",
  "Nationwide", "", "Region XIII", "REGION XIII - CARAGA", "ARMM", "Metro Manila", "National Capital Region", "Region X - NORTHERN MINDANAO",
  "CORDILLERA ADMINISTRATIVE REGION (CAR)", "Region IV", "Central Office",
];

function contractAgreement(path: string, labels: Iterable<string>): void {
  const src = readFileSync(path, "utf8");
  const block = (re: RegExp, what: string) => {
    const m = re.exec(src);
    ensure(m, `${what} not found in ${path}`);
    return m[1];
  };
  const order = [...block(/export const REGION_ORDER[^=]*=\s*\[([\s\S]*?)\];/, "REGION_ORDER").matchAll(/'([A-Z-]+)'/g)].map((m) => m[1]);
  ensure(order.join(",") === REGION_ORDER.join(","), `REGION_ORDER differs from the contract: ${order.join(",")}`);

  const labelsBlock = block(/export const REGION_LABELS[^=]*=\s*\{([\s\S]*?)\n\};/, "REGION_LABELS");
  const parsed: Record<string, { short: string; name: string }> = {};
  for (const m of labelsBlock.matchAll(/^\s*'?([A-Z-]+)'?:\s*\{\s*short:\s*'([^']*)',\s*name:\s*'([^']*)'\s*\},?\s*$/gm)) parsed[m[1]] = { short: m[2], name: m[3] };
  ensure(JSON.stringify(parsed) === JSON.stringify(REGION_LABELS), "REGION_LABELS differ from the contract");

  const traceBlock = block(/export const TRACE_LABELS[^=]*=\s*\{([\s\S]*?)\n\};/, "TRACE_LABELS");
  const traces: Record<string, { group: string; held: boolean }> = {};
  for (const m of traceBlock.matchAll(/^\s*([a-z0-9_]+):\s*\{.*?\bgroup:\s*'([a-z_]+)'(?:,\s*held:\s*(true|false))?/gm)) traces[m[1]] = { group: m[2], held: m[3] === "true" };
  ensure(JSON.stringify(traces) === JSON.stringify(TRACE_GROUPS), "TRACE_LABELS groups/held differ from the contract");

  // regionKeyOf: transpile the contract's own source and compare outputs label by label.
  const fnSrc = block(/(const ROMAN[\s\S]*?\nexport function regionKeyOf[\s\S]*?\n\})/, "regionKeyOf").replace(/^export /gm, "");
  const js = ts.transpileModule(fnSrc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const contractFn = new Function(`${js}\nreturn regionKeyOf;`)() as (l: string | null | undefined) => string | null;
  const all = new Set([...labels, ...PROBE_LABELS]);
  for (const l of all) ensure(contractFn(l) === regionKeyOf(l), `regionKeyOf replica disagrees with the contract on "${l}": ${contractFn(l)} vs ${regionKeyOf(l)}`);
  ensure(contractFn(null) === null && regionKeyOf(null) === null, "regionKeyOf(null) must be null");
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

type Pt = [number, number];
type Ring = Pt[];

function douglasPeucker(pts: Ring, tol: number): Ring {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let maxD = -1, maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tol) { keep[maxI] = 1; stack.push([a, maxI], [maxI, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function signedArea(r: Ring): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return s / 2;
}
/** Round to 4 decimals, drop repeats, close, simplify; null when the ring collapses below 4 points. */
function cleanRing(ring: number[][], tol: number, exterior: boolean): Ring | null {
  const r: Ring = [];
  for (const p of ring) {
    const q4: Pt = [round(p[0], 4), round(p[1], 4)];
    const last = r[r.length - 1];
    if (!last || last[0] !== q4[0] || last[1] !== q4[1]) r.push(q4);
  }
  if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push([r[0][0], r[0][1]]);
  const s = tol > 0 ? douglasPeucker(r, tol) : r;
  if (s.length < 4 || signedArea(s) === 0) return null;
  // RFC 7946 winding: exterior counter-clockwise, holes clockwise (SVG nonzero fill then cuts holes).
  if ((signedArea(s) > 0) !== exterior) s.reverse();
  return s;
}
function pointInRing(lon: number, lat: number, r: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

interface GeoFeature {
  properties: { adm1_psgc: number; adm2_psgc: number; adm2_en: string | null; geo_level: string | null };
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] } | null;
}
interface SourceProvince { psgc: number; name: string; region: RegionKey; adm1: number; adm2_en: string | null; raw: number[][][][] }

function shortCity(n: string): string {
  return n.replace(/^City of /, "");
}

function readProvinces(args: Args, inputs: Record<string, { sha256: string; bytes: number }>): { provinces: SourceProvince[]; gaps: string[] } {
  const provinces: SourceProvince[] = [];
  const gaps: string[] = [];
  for (const [adm1Str, region] of Object.entries(ADM1_REGION)) {
    const adm1 = Number(adm1Str);
    const file = RESOLUTIONS[args.res].file(adm1);
    const path = resolve(args.geo, file);
    ensure(existsSync(path), `missing outline file ${path}`);
    inputs[file] = fileInfo(path);
    const fc = JSON.parse(readFileSync(path, "utf8")) as { type: string; features: GeoFeature[] };
    ensure(fc.type === "FeatureCollection" && fc.features.length > 0, `${file}: not a FeatureCollection`);
    for (const f of fc.features) {
      const p = f.properties;
      ensure(p.adm1_psgc === adm1, `${file}: feature ${p.adm2_psgc} carries adm1 ${p.adm1_psgc}`);
      ensure(f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"), `${file}: feature ${p.adm2_psgc} has no polygon geometry`);
      const raw = f.geometry.type === "Polygon" ? [f.geometry.coordinates as number[][][]] : (f.geometry.coordinates as number[][][][]);
      let name: string;
      if (p.adm2_en == null) {
        name = UNNAMED[p.adm2_psgc] ?? `PSGC ${p.adm2_psgc}`;
        gaps.push(`${p.adm2_psgc} (${region}): unnamed in the source; named "${name}"${UNNAMED[p.adm2_psgc] ? " from PSGC" : " from its code"}`);
      } else if (p.geo_level === "Dist" && region === "NCR") {
        // Metro Manila's four districts: name them by the cities the source places in each.
        const cityFile = `city-municities-provdist-${p.adm2_psgc}.0.001.json`;
        const cityPath = resolve(args.geo, cityFile);
        if (existsSync(cityPath)) {
          inputs[cityFile] = fileInfo(cityPath);
          const cities = (JSON.parse(readFileSync(cityPath, "utf8")) as { features?: Array<{ properties: { adm3_en?: string } }> }).features ?? [];
          const names = cities.map((c) => c.properties.adm3_en).filter((n): n is string => Boolean(n)).map(shortCity);
          name = names.length ? `Metro Manila: ${names.join(", ")}` : p.adm2_en.replace(/\s*\(Not a Province\)\s*$/i, "");
        } else {
          name = p.adm2_en.replace(/\s*\(Not a Province\)\s*$/i, "");
        }
      } else {
        name = p.adm2_en.replace(/\s*\(Not a Province\)\s*$/i, "");
      }
      const override = REGION_OVERRIDES[p.adm2_psgc];
      if (override) ensure(p.adm2_en === override.name, `region override: ${p.adm2_psgc} is "${p.adm2_en}", expected ${override.name}`);
      const isBacolod = /bacolod/i.test(p.adm2_en ?? "");
      provinces.push({ psgc: p.adm2_psgc, name, region: override?.region ?? (isBacolod ? "NIR" : region), adm1, adm2_en: p.adm2_en, raw });
    }
  }
  for (const psgc of Object.keys(REGION_OVERRIDES)) ensure(provinces.some((p) => p.psgc === Number(psgc)), `override province ${psgc} not found in the outlines`);
  ensure(new Set(provinces.map((p) => p.psgc)).size === provinces.length, "duplicate province PSGC codes");
  return { provinces, gaps };
}

function buildGeo(src: SourceProvince[], tol: number): HgabGeo {
  const provinces: HgabGeo["provinces"] = [];
  for (const p of src) {
    const polygons: number[][][][] = [];
    for (const poly of p.raw) {
      const ext = cleanRing(poly[0], tol, true);
      if (!ext) continue;
      const holes = poly.slice(1).map((h) => cleanRing(h, tol, false)).filter((h): h is Ring => h != null);
      polygons.push([ext, ...holes]);
    }
    if (!polygons.length) {
      // Keep every province visible: fall back to its largest outer ring, rounded but unsimplified.
      const largest = p.raw.map((poly) => cleanRing(poly[0], 0, true)).filter((r): r is Ring => r != null)
        .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];
      ensure(largest, `province ${p.psgc} has no usable outline`);
      polygons.push([largest]);
    }
    provinces.push({ psgc: p.psgc, name: p.name, region: p.region, polygons });
  }
  provinces.sort((a, b) => REGION_ORDER.indexOf(a.region) - REGION_ORDER.indexOf(b.region) || a.name.localeCompare(b.name));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of provinces) for (const poly of p.polygons) for (const ring of poly) for (const [x, y] of ring) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return {
    source: OUTLINE_SOURCE,
    bbox: [minX, minY, maxX, maxY],
    regions: REGION_ORDER.map((key) => ({ key, label: REGION_LABELS[key].short, plain: REGION_LABELS[key].name })),
    provinces,
  };
}

/** Which province (and so which region) a point falls in, by the simplified outlines. */
function locator(geo: HgabGeo): (lon: number, lat: number) => RegionKey | null {
  const boxes = geo.provinces.map((p) => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const poly of p.polygons) for (const [x, y] of poly[0]) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
    return { p, box: [a, b, c, d] };
  });
  return (lon, lat) => {
    for (const { p, box } of boxes) {
      if (lon < box[0] || lon > box[2] || lat < box[1] || lat > box[3]) continue;
      for (const poly of p.polygons) {
        if (!pointInRing(lon, lat, poly[0])) continue;
        if (poly.slice(1).some((h) => pointInRing(lon, lat, h))) continue;
        return p.region;
      }
    }
    return null;
  };
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

async function readRows(out: string, key: DatasetKey): Promise<Row[]> {
  const path = resolve(out, key, "projects.parquet");
  const rows = await queryRetry(
    `SELECT id, title, region, trace, nep_php, hgab2_php, hgab3_php, ${key === "fmr" ? "record_json" : "NULL"}, `
    + `${key === "dpwh" ? "json_extract_string(record_json, '$.nep.title')" : "NULL"} FROM read_parquet('${q(path)}')`,
  );
  return rows.map((r) => ({
    id: String(r[0]), title: String(r[1] ?? ""), region: str(r[2]), trace: String(r[3] ?? ""),
    nep_php: num(r[4]), hgab2_php: num(r[5]), hgab3_php: num(r[6]), record_json: str(r[7]), nep_title: str(r[8]),
  }));
}

const houseOf = (r: Row) => r.hgab3_php ?? r.hgab2_php;

interface RegionBuild { regions: MapRegion[]; notOnMap: NotOnMap | null; labelKeys: Map<string, RegionKey | null> }

function buildRegions(key: DatasetKey, dims: DimRow[] | undefined, rows: Row[], meta: DatasetMeta): RegionBuild {
  const stage = meta.bridge.house_stage;
  const labelKeys = new Map<string, RegionKey | null>();
  if (!dims) {
    // No region in the documents (NIA): everything is listed beside the map.
    ensure(rows.every((r) => r.region == null), `${key}: rows carry regions but the summary has no region dimension`);
    const nepRows = rows.filter((r) => r.nep_php != null), houseRows = rows.filter((r) => houseOf(r) != null);
    const nep = nepRows.reduce((a, r) => a + (r.nep_php ?? 0), 0), house = houseRows.reduce((a, r) => a + (houseOf(r) ?? 0), 0);
    return {
      regions: [], labelKeys,
      notOnMap: {
        label: "No region listed", nep_php: nep, house_php: house, nep_rows: nepRows.length, house_rows: houseRows.length,
        plain: readerSentence("The irrigation lists give no region, so every project is counted here.", `${key} not_on_map.plain`),
      },
    };
  }
  type Acc = { nep: number; house: number; nepRows: number; houseRows: number; labels: Set<string> };
  const fresh = (): Acc => ({ nep: 0, house: 0, nepRows: 0, houseRows: 0, labels: new Set() });
  const acc = new Map<RegionKey, Acc>(REGION_ORDER.map((k) => [k, fresh()]));
  const off = fresh();
  for (const d of dims) {
    const k = regionKeyOf(d.label);
    labelKeys.set(d.label, k);
    const a = k ? acc.get(k)! : off;
    a.nep += d.nep_php; a.house += d.house_php; a.nepRows += d.nep_records; a.houseRows += d.house_records; a.labels.add(d.label);
  }
  // The labels as printed on each record (FMR prints the same region in upper and title case).
  const rowsPerLabel = new Map<string, number>();
  for (const r of rows) {
    if (r.region != null) rowsPerLabel.set(r.region, (rowsPerLabel.get(r.region) ?? 0) + 1);
  }
  for (const r of rows) {
    if (r.region == null) continue;
    const k = regionKeyOf(r.region);
    labelKeys.set(r.region, k);
    const a = k ? acc.get(k)! : off;
    ensure(a.nepRows + a.houseRows > 0, `${key}: record region "${r.region}" (${k ?? "not on map"}) has no amount in summary dims.region`);
    a.labels.add(r.region);
  }
  // Most-used label first: source_labels[0] is the exact `region` value that filters the most project rows.
  const sortLabels = (s: Set<string>) => [...s].sort((x, y) => (rowsPerLabel.get(y) ?? 0) - (rowsPerLabel.get(x) ?? 0) || x.localeCompare(y));
  const regions: MapRegion[] = REGION_ORDER.map((k) => {
    const a = acc.get(k)!;
    const nep = a.nepRows ? a.nep : null, house = a.houseRows ? a.house : null;
    ensure(a.nepRows || a.nep === 0, `${key} ${k}: NEP amount without rows`);
    ensure(a.houseRows || a.house === 0, `${key} ${k}: House amount without rows`);
    return {
      key: k, label: REGION_LABELS[k].short, nep_php: nep, house_php: house, delta_php: nep != null && house != null ? house - nep : null,
      nep_rows: a.nepRows, house_rows: a.houseRows, source_labels: sortLabels(a.labels),
    };
  });
  const hasOff = off.nepRows + off.houseRows > 0;
  const notOnMap: NotOnMap | null = hasOff ? {
    label: sortLabels(off.labels).join(" · "),
    nep_php: off.nepRows ? off.nep : null, house_php: off.houseRows ? off.house : null, nep_rows: off.nepRows, house_rows: off.houseRows,
    plain: readerSentence(
      /nationwide/i.test([...off.labels].join(" ")) && off.labels.size === 1
        ? "Projects the documents list as nationwide rather than in one region."
        : "Projects the documents list without a region they can be placed in.",
      `${key} not_on_map.plain`,
    ),
  } : null;
  // Conservation, per document: regions + not_on_map = the dataset's stage totals and record counts.
  const sumNep = regions.reduce((s, r) => s + (r.nep_php ?? 0), 0) + (notOnMap?.nep_php ?? 0);
  const sumHouse = regions.reduce((s, r) => s + (r.house_php ?? 0), 0) + (notOnMap?.house_php ?? 0);
  const houseTotal = meta.totals[`${stage}_php`];
  ensure(sumNep === meta.totals.nep_php, `${key}: regions + not_on_map NEP ${sumNep} != totals.nep_php ${meta.totals.nep_php}`);
  ensure(sumHouse === houseTotal, `${key}: regions + not_on_map House ${sumHouse} != totals.${stage}_php ${houseTotal}`);
  const rowsNep = regions.reduce((s, r) => s + r.nep_rows, 0) + (notOnMap?.nep_rows ?? 0);
  const rowsHouse = regions.reduce((s, r) => s + r.house_rows, 0) + (notOnMap?.house_rows ?? 0);
  ensure(rowsNep === meta.counts.nep && rowsHouse === meta.counts[stage], `${key}: region record counts ${rowsNep}/${rowsHouse} != counts ${meta.counts.nep}/${meta.counts[stage]}`);
  return { regions, notOnMap, labelKeys };
}

function point(r: Row, lon: number, lat: number, printedBy: MapPoint["printed_by"], lines: number[][][] | null): MapPoint {
  const t = traceInfo(r.trace);
  const p: MapPoint = {
    id: r.id, lon: round(lon, 5), lat: round(lat, 5), title: r.title, trace: r.trace, group: t.group, held: t.held,
    nep_php: r.nep_php, house_php: houseOf(r), printed_by: printedBy,
  };
  if (lines && lines.length) p.lines = lines.map((seg) => seg.map(([x, y]) => [round(x, 5), round(y, 5)]));
  return p;
}

interface PointStats { rows_with_coordinates: number; points: number; dropped_rows: number; dropped_points: number; both_differ: number; printed_by: Record<string, number>; with_lines: number; unreadable: number }
const freshStats = (): PointStats => ({ rows_with_coordinates: 0, points: 0, dropped_rows: 0, dropped_points: 0, both_differ: 0, printed_by: {}, with_lines: 0, unreadable: 0 });

/** Point at half the length of a polyline (its only point when it has one). */
function midpoint(seg: number[][]): number[] {
  if (seg.length === 1) return seg[0];
  const lens = seg.slice(1).map((p, i) => Math.hypot(p[0] - seg[i][0], p[1] - seg[i][1]));
  const half = lens.reduce((a, b) => a + b, 0) / 2;
  let run = 0;
  for (let i = 0; i < lens.length; i++) {
    if (run + lens[i] >= half && lens[i] > 0) {
      const t = (half - run) / lens[i];
      return [seg[i][0] + t * (seg[i + 1][0] - seg[i][0]), seg[i][1] + t * (seg[i + 1][1] - seg[i][1])];
    }
    run += lens[i];
  }
  return seg[0];
}

function fmrPoints(rows: Row[], stats: PointStats): MapPoint[] {
  const segmentsOf = (c: unknown): number[][][] | null => {
    if (!Array.isArray(c)) return null;
    const segs = c.filter((s): s is number[][] => Array.isArray(s) && s.length > 0 && s.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && Number.isFinite(v))));
    return segs.length ? segs : null;
  };
  const out: MapPoint[] = [];
  for (const r of rows) {
    ensure(r.record_json, `fmr ${r.id}: no record_json`);
    const rec = JSON.parse(r.record_json) as { house?: { coordinates?: unknown } | null; nep?: { coordinates?: unknown } | null };
    const sides = { house: segmentsOf(rec.house?.coordinates), nep: segmentsOf(rec.nep?.coordinates) };
    if (!sides.house && !sides.nep) continue;
    stats.rows_with_coordinates++;
    const same = sides.house && sides.nep ? JSON.stringify(sides.house) === JSON.stringify(sides.nep) : false;
    if (sides.house && sides.nep && !same) stats.both_differ++;
    // House coordinates first; the NEP's only when the House prints none inside the country.
    let chosen: { side: "house" | "nep"; segs: number[][][] } | null = null;
    for (const side of ["house", "nep"] as const) {
      const segs = sides[side]?.filter((s) => s.every(([x, y]) => inBounds(x, y)));
      if (segs?.length) { chosen = { side, segs }; break; }
    }
    const printed = sides.house ?? sides.nep!;
    if (!chosen) {
      stats.dropped_rows++;
      stats.dropped_points += printed.reduce((a, s) => a + s.length, 0);
      continue;
    }
    stats.dropped_points += (sides[chosen.side] ?? []).filter((s) => !s.every(([x, y]) => inBounds(x, y))).reduce((a, s) => a + s.length, 0);
    const printedBy = chosen.side === "house" && same ? "both" : chosen.side;
    const [lon, lat] = midpoint(chosen.segs[0]);
    const lines = chosen.segs.filter((s) => s.length >= 2);
    if (lines.length) stats.with_lines++;
    out.push(point(r, lon, lat, printedBy, lines));
  }
  return out;
}

interface GpsPoint { longitude: number | null; latitude: number | null; role: string }
interface GpsField { field: string; status: string; points: GpsPoint[]; snippet: string }
interface GpsHit { dataset: string; record_id: string; title: string; status: string; fields: GpsField[] }

interface GpsJoin { hits: number; joined: number; titles_truncated_in_inventory: number }
function dpwhPoints(rows: Row[], gps: { hits: GpsHit[] }, stats: PointStats): { points: MapPoint[] } & GpsJoin {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const hits = gps.hits.filter((h) => h.dataset === "dpwh_comparison_2027");
  const out: MapPoint[] = [];
  let joined = 0, truncated = 0;
  // The inventory shortens long titles and snippets with "…"; anything else would mean a bad join.
  const sameText = (shown: string, full: string) => shown === full || (shown.endsWith("…") && full.startsWith(shown.slice(0, -1).trimEnd()));
  for (const h of hits) {
    const r = byId.get(h.record_id);
    ensure(r, `gps_inventory record ${h.record_id} is not a dpwh projects.parquet id`);
    joined++;
    ensure(sameText(h.title, r.title), `gps_inventory ${h.record_id}: title differs from projects.parquet`);
    if (h.title !== r.title) truncated++;
    const hasHouse = houseOf(r) != null;
    // Which document's title each field is: the comparison title is the House title when the House lists the project.
    const fields = h.fields.map((f) => {
      ensure(f.field === "title" || f.field === "nep.title", `gps_inventory ${h.record_id}: unexpected field ${f.field}`);
      const side: "house" | "nep" = f.field === "title" && hasHouse ? "house" : "nep";
      // The full printed title (the inventory's snippet may be shortened).
      const text = f.field === "title" ? r.title : r.nep_title ?? f.snippet;
      ensure(sameText(f.snippet, text), `gps_inventory ${h.record_id}: ${f.field} snippet differs from the printed title`);
      const seen = new Set<string>();
      const pts: Pt[] = [];
      for (const p of f.points) {
        if (p.longitude == null || p.latitude == null || !Number.isFinite(p.longitude) || !Number.isFinite(p.latitude)) continue;
        const k = `${p.longitude},${p.latitude}`;
        if (seen.has(k)) continue;
        seen.add(k);
        pts.push([p.longitude, p.latitude]);
      }
      // Lines only where the title prints Start … End pairs, one pair per segment.
      const starts = (text.match(/\bstart\b/gi) ?? []).length, ends = (text.match(/\bend\b/gi) ?? []).length;
      const paired = starts > 0 && starts === ends && pts.length === 2 * starts && pts.every(([x, y]) => inBounds(x, y));
      const lines = paired ? Array.from({ length: starts }, (_, i) => [pts[2 * i], pts[2 * i + 1]]) : null;
      return { side, pts, lines };
    }).filter((f) => f.pts.length > 0);
    if (!fields.length) { stats.unreadable++; continue; }
    stats.rows_with_coordinates++;
    const house = fields.find((f) => f.side === "house"), nep = fields.find((f) => f.side === "nep");
    const same = house && nep ? JSON.stringify(house.pts) === JSON.stringify(nep.pts) : false;
    if (house && nep && !same) stats.both_differ++;
    const chosen = [house, nep].find((f) => f && f.pts.some(([x, y]) => inBounds(x, y)));
    if (!chosen) {
      stats.dropped_rows++;
      stats.dropped_points += (house ?? nep)!.pts.length;
      continue;
    }
    stats.dropped_points += chosen.pts.filter(([x, y]) => !inBounds(x, y)).length;
    const [lon, lat] = chosen.pts.find(([x, y]) => inBounds(x, y))!;
    const printedBy = chosen.side === "house" && same ? "both" : chosen.side;
    if (chosen.lines) stats.with_lines++;
    out.push(point(r, lon, lat, printedBy, chosen.lines));
  }
  return { points: out, hits: hits.length, joined, titles_truncated_in_inventory: truncated };
}

function notes(key: DatasetKey, stats: PointStats, coverage: HgabDatasetMap["coverage"]): { points_note: string; note: string; placeable: boolean } {
  const n = coverage.rows_with_points;
  const dropped = stats.dropped_rows
    ? `; ${count(stats.dropped_rows)} more ${stats.dropped_rows === 1 ? "gives a point" : "give points"} outside the country and ${stats.dropped_rows === 1 ? "is" : "are"} left off`
    : "";
  switch (key) {
    case "dpwh": {
      const ratio = Math.round(coverage.rows_total / Math.max(n, 1));
      return {
        placeable: true,
        points_note: `Dots show the ${n.toLocaleString("en-US")} projects whose titles give coordinates, about one in ${count(ratio)}${dropped}.`,
        note: "Regional totals follow the region each document lists, so Metro Manila includes projects run from the DPWH head office but built elsewhere.",
      };
    }
    case "fmr": {
      const differ = stats.both_differ ? `; for ${stats.both_differ === 1 ? "the one road" : `the ${count(stats.both_differ)} roads`} where the two lists differ, the House bill's are used` : "";
      const all = n === coverage.rows_total ? "Each dot is a road at its published coordinates" : `Dots show the ${n.toLocaleString("en-US")} roads whose coordinates are published`;
      return { placeable: true, points_note: `${all}${differ}${dropped}.`, note: "Regional totals follow the region each list gives for each road." };
    }
    case "hfep":
      return {
        placeable: true,
        points_note: "The health facilities lists name each facility but give no coordinates, so facilities are shown by region only.",
        note: "Regional totals follow the region each list gives for each facility.",
      };
    case "nia":
      return {
        placeable: false,
        points_note: "No dots are shown because only one irrigation project gives coordinates.",
        note: "The irrigation lists name each system but give no region, and only one project gives coordinates, so the projects cannot be mapped.",
      };
  }
}

// ---------------------------------------------------------------------------
// Check (re-reads the outputs)
// ---------------------------------------------------------------------------

async function verify(args: Args, overview: Overview): Promise<number> {
  let checks = 0, failures = 0;
  const check = (name: string, ok: boolean, detail = "") => {
    checks++;
    if (ok) log(`  ✓ ${name}`);
    else { failures++; log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`); }
  };
  log("\ncheck");
  const geo = JSON.parse(readFileSync(resolve(args.out, "geo", "provinces.json"), "utf8")) as HgabGeo;
  const keys = new Set<string>(REGION_ORDER);
  check("provinces.json: every province has a valid region key", geo.provinces.every((p) => keys.has(p.region)));
  check("provinces.json: every region key has at least one province", REGION_ORDER.every((k) => geo.provinces.some((p) => p.region === k)));
  check("provinces.json: NIR is Negros Occidental, Negros Oriental and Siquijor; Sulu is Region IX",
    geo.provinces.filter((p) => p.region === "NIR").map((p) => p.psgc).sort().join() === [604500000, 704600000, 706100000].join()
    && geo.provinces.find((p) => p.psgc === 1906600000)?.region === "IX");
  check("provinces.json: PSGC codes unique, names present", new Set(geo.provinces.map((p) => p.psgc)).size === geo.provinces.length && geo.provinces.every((p) => p.name.trim().length > 0));
  const ringsOk = geo.provinces.every((p) => p.polygons.length > 0 && p.polygons.every((poly) => poly.every((ring) =>
    ring.length >= 4 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    && ring.every(([x, y]) => round(x, 4) === x && round(y, 4) === y && x >= geo.bbox[0] && x <= geo.bbox[2] && y >= geo.bbox[1] && y <= geo.bbox[3]))));
  check("provinces.json: every province has a polygon; rings closed, ≥ 4 points, 4 decimals, inside bbox", ringsOk);
  check("provinces.json: regions list equals REGION_ORDER with contract labels",
    JSON.stringify(geo.regions) === JSON.stringify(REGION_ORDER.map((key) => ({ key, label: REGION_LABELS[key].short, plain: REGION_LABELS[key].name }))));

  for (const key of DATASET_ORDER) {
    const m = JSON.parse(readFileSync(resolve(args.out, key, "map.json"), "utf8")) as HgabDatasetMap;
    const meta = overview.datasets.find((d) => d.key === key)!;
    const stage = meta.bridge.house_stage;
    check(`${key}: dataset and house_stage (${stage})`, m.dataset === key && m.house_stage === stage);
    check(`${key}: region keys valid, unique, in REGION_ORDER`, m.regions.map((r) => r.key).join() === REGION_ORDER.filter((k) => m.regions.some((r) => r.key === k)).join()
      && new Set(m.regions.map((r) => r.key)).size === m.regions.length && m.regions.every((r) => keys.has(r.key)));
    const ints = (v: number | null) => v == null || Number.isSafeInteger(v);
    check(`${key}: amounts are integer pesos; delta = House − NEP; null only where no rows`, m.regions.every((r) =>
      ints(r.nep_php) && ints(r.house_php) && ints(r.delta_php)
      && r.delta_php === (r.nep_php != null && r.house_php != null ? r.house_php - r.nep_php : null)
      && (r.nep_php == null) === (r.nep_rows === 0) && (r.house_php == null) === (r.house_rows === 0)));
    const sNep = m.regions.reduce((s, r) => s + (r.nep_php ?? 0), 0) + (m.not_on_map?.nep_php ?? 0);
    const sHouse = m.regions.reduce((s, r) => s + (r.house_php ?? 0), 0) + (m.not_on_map?.house_php ?? 0);
    check(`${key}: Σ regions + not_on_map = NEP total (${meta.totals.nep_php.toLocaleString("en-US")})`, sNep === meta.totals.nep_php, `${sNep}`);
    check(`${key}: Σ regions + not_on_map = House total (${(meta.totals[`${stage}_php`] ?? 0).toLocaleString("en-US")})`, sHouse === meta.totals[`${stage}_php`], `${sHouse}`);
    const rows = await readRows(args.out, key);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const missing = m.points.filter((p) => !byId.has(p.id));
    check(`${key}: every point id exists in projects.parquet (${m.points.length} points)`, missing.length === 0, missing.slice(0, 5).map((p) => p.id).join(", "));
    check(`${key}: point ids unique`, new Set(m.points.map((p) => p.id)).size === m.points.length);
    const badVals = m.points.filter((p) => {
      const r = byId.get(p.id);
      const t = traceInfo(p.trace);
      return !r || p.trace !== r.trace || p.title !== r.title || p.nep_php !== r.nep_php || p.house_php !== houseOf(r) || p.group !== t.group || p.held !== t.held
        || !["house", "nep", "both"].includes(p.printed_by);
    });
    check(`${key}: point title, trace, group, held and amounts equal the parquet row`, badVals.length === 0, badVals.slice(0, 5).map((p) => p.id).join(", "));
    const outside = m.points.filter((p) => !inBounds(p.lon, p.lat) || (p.lines ?? []).some((s) => s.length < 2 || s.some(([x, y]) => !inBounds(x, y))));
    check(`${key}: every point and line vertex inside lon 116–127, lat 4–22`, outside.length === 0, outside.slice(0, 5).map((p) => p.id).join(", "));
    const perLabel = new Map<string, number>();
    for (const r of rows) if (r.region != null) perLabel.set(r.region, (perLabel.get(r.region) ?? 0) + 1);
    check(`${key}: source_labels ordered by project rows carrying each label, most first`, m.regions.every((r) =>
      r.source_labels.every((l, i) => i === 0 || (perLabel.get(r.source_labels[i - 1]) ?? 0) >= (perLabel.get(l) ?? 0))
      && (r.nep_rows + r.house_rows === 0 || (perLabel.get(r.source_labels[0]) ?? 0) > 0 || !rows.some((x) => regionKeyOf(x.region) === r.key))));
    const withRegion = rows.filter((r) => regionKeyOf(r.region) != null).length;
    check(`${key}: coverage re-derives (rows ${rows.length}, with region ${withRegion}, with points ${m.points.length})`,
      m.coverage.rows_total === rows.length && m.coverage.rows_with_region === withRegion && m.coverage.rows_with_points === m.points.length);
    const copy = [m.points_note, m.note, ...(m.not_on_map ? [m.not_on_map.plain] : [])];
    let copyOk = true, copyDetail = "";
    for (const s of copy) {
      try { readerSentence(s, key); } catch (e) { copyOk = false; copyDetail = (e as Error).message; }
    }
    check(`${key}: reader-facing notes are one plain sentence of ≤ 25 words`, copyOk, copyDetail);
    if (key === "nia") check("nia: placeable false, no regions, no points", !m.placeable && m.regions.length === 0 && m.points.length === 0);
    else check(`${key}: placeable`, m.placeable);
    if (key === "hfep") check("hfep: no points", m.points.length === 0);
  }
  log(`\n${checks - failures}/${checks} checks passed`);
  return failures;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  log(`build:hgab-geo  out=${args.out}  geo=${args.geo} (${args.res})  gps=${args.gps}\n`);
  ensure(existsSync(args.contract), `${args.contract} not found`);
  ensure(existsSync(args.gps), `${args.gps} not found`);
  mkdirSync(resolve(args.out, "geo"), { recursive: true });

  // Outlines
  const outlineInputs: Record<string, { sha256: string; bytes: number }> = {};
  const { provinces: srcProvinces, gaps } = readProvinces(args, outlineInputs);
  let geo: HgabGeo | null = null, geoBody = "", tolerance = 0;
  for (const tol of args.tolerance != null ? [args.tolerance] : TOLERANCE_LADDER) {
    geo = buildGeo(srcProvinces, tol);
    geoBody = `${JSON.stringify(geo)}\n`;
    tolerance = tol;
    if (Buffer.byteLength(geoBody) <= args.maxBytes) break;
  }
  ensure(geo, "no outlines built");
  ensure(args.tolerance != null || Buffer.byteLength(geoBody) <= args.maxBytes, `provinces.json is ${Buffer.byteLength(geoBody)} bytes even at tolerance ${tolerance}`);
  const geoBytes = writeAtomic(resolve(args.out, "geo", "provinces.json"), geoBody);
  const vertices = geo.provinces.reduce((a, p) => a + p.polygons.reduce((b, poly) => b + poly.reduce((c, r) => c + r.length, 0), 0), 0);
  log(`geo/provinces.json  ${geo.provinces.length} provinces · ${vertices.toLocaleString()} vertices · tolerance ${tolerance}° · ${(geoBytes / 1024).toFixed(0)} KB`);
  for (const g of gaps) log(`  name gap: ${g}`);
  const locate = locator(geo);

  // Datasets
  const overviewPath = resolve(args.out, "overview.json");
  const overview = await readJsonRetry<Overview>(overviewPath);
  const gps = await readJsonRetry<{ hits: GpsHit[] }>(args.gps);
  const datasetInputs: Record<string, { sha256: string; bytes: number }> = { "overview.json": fileInfo(overviewPath) };
  const labelTable = new Map<string, { key: RegionKey | null; datasets: Set<DatasetKey> }>();
  const manifestDatasets: Record<string, unknown> = {};
  let gpsJoin: GpsJoin | null = null;

  for (const key of DATASET_ORDER) {
    const summaryPath = resolve(args.out, key, "summary.json");
    const summary = await readJsonRetry<Summary>(summaryPath);
    const meta = overview.datasets.find((d) => d.key === key);
    ensure(meta, `overview.json has no ${key} dataset`);
    ensure(summary.dataset.totals.nep_php === meta.totals.nep_php, `${key}: summary.json and overview.json totals differ (mid-rewrite?)`);
    const rows = await readRows(args.out, key);
    datasetInputs[`${key}/summary.json`] = fileInfo(summaryPath);
    datasetInputs[`${key}/projects.parquet`] = fileInfo(resolve(args.out, key, "projects.parquet"));

    const { regions, notOnMap, labelKeys } = buildRegions(key, summary.dims.region, rows, meta);
    for (const [label, k] of labelKeys) {
      const e = labelTable.get(label) ?? { key: k, datasets: new Set<DatasetKey>() };
      e.datasets.add(key);
      labelTable.set(label, e);
    }

    const stats = freshStats();
    let points: MapPoint[] = [];
    if (key === "fmr") points = fmrPoints(rows, stats);
    if (key === "dpwh") {
      const r = dpwhPoints(rows, gps, stats);
      points = r.points;
      gpsJoin = { hits: r.hits, joined: r.joined, titles_truncated_in_inventory: r.titles_truncated_in_inventory };
      ensure(r.joined === r.hits, `dpwh: ${r.joined} of ${r.hits} gps_inventory hits join projects.parquet`);
    }
    points.sort((a, b) => Math.max(b.house_php ?? 0, b.nep_php ?? 0) - Math.max(a.house_php ?? 0, a.nep_php ?? 0) || a.id.localeCompare(b.id));
    for (const p of points) stats.printed_by[p.printed_by] = (stats.printed_by[p.printed_by] ?? 0) + 1;
    stats.points = points.length;

    const coverage = { rows_total: rows.length, rows_with_points: points.length, rows_with_region: rows.filter((r) => regionKeyOf(r.region) != null).length };
    const text = notes(key, stats, coverage);
    const map: HgabDatasetMap = {
      dataset: key, house_stage: meta.bridge.house_stage, regions, not_on_map: notOnMap, points,
      points_note: readerSentence(text.points_note, `${key} points_note`), placeable: text.placeable, note: readerSentence(text.note, `${key} note`),
      coverage,
    };
    const bytes = writeAtomic(resolve(args.out, key, "map.json"), `${JSON.stringify(map)}\n`);

    // Diagnostic: does each dot fall inside a province of the region its record prints?
    const where = { in_printed_region: 0, other_region: 0, outside_outlines: 0, no_printed_region: 0, other_region_ids: [] as string[] };
    const rowById = new Map(rows.map((r) => [r.id, r]));
    for (const p of points) {
      const printed = regionKeyOf(rowById.get(p.id)?.region);
      const at = locate(p.lon, p.lat);
      if (!printed) where.no_printed_region++;
      else if (!at) where.outside_outlines++;
      else if (at === printed) where.in_printed_region++;
      else { where.other_region++; where.other_region_ids.push(`${p.id} (printed ${printed}, falls in ${at})`); }
    }
    // Diagnostic: printed lines longer than 20 km are kept as printed but listed for audit (likely typing errors).
    const longLines = points.flatMap((p) => (p.lines ?? []).map((seg) => ({ id: p.id, km: seg.slice(1).reduce((a, q, i) => a + km(seg[i], q), 0) })))
      .filter((l) => l.km > 20).sort((a, b) => b.km - a.km).map((l) => `${l.id} (${l.km.toFixed(1)} km)`);
    const placed = regions.filter((r) => r.nep_rows + r.house_rows > 0).length;
    log(`${key}/map.json  ${placed} regions with rows${notOnMap ? ` + not on map "${notOnMap.label}"` : ""} · conservation ok · ${points.length} points`
      + (stats.dropped_rows ? ` (${stats.dropped_rows} dropped outside the country)` : "") + ` · ${(bytes / 1024).toFixed(0)} KB`);
    if (points.length) log(`  printed_by ${JSON.stringify(stats.printed_by)} · both printed but differ ${stats.both_differ} · with lines ${stats.with_lines} (${longLines.length} over 20 km) · in printed region ${where.in_printed_region}, other region ${where.other_region}, outside outlines ${where.outside_outlines}`);
    manifestDatasets[key] = {
      house_stage: meta.bridge.house_stage, bytes,
      totals: { nep_php: meta.totals.nep_php, house_php: meta.totals[`${meta.bridge.house_stage}_php`] },
      conservation: "regions + not_on_map = totals and counts, per document (asserted)",
      regions_with_rows: placed, not_on_map: notOnMap ? { label: notOnMap.label, nep_php: notOnMap.nep_php, house_php: notOnMap.house_php } : null,
      coverage, points: { ...stats, placement: where, lines_over_20_km: longLines },
    };
  }

  // The replica must agree with the contract on every label this run saw.
  contractAgreement(args.contract, labelTable.keys());
  log("\ncontract agreement: regionKeyOf, REGION_ORDER, REGION_LABELS, TRACE_LABELS groups ok");

  const table = [...labelTable.entries()].sort((a, b) => (REGION_ORDER.indexOf(a[1].key as RegionKey) + 100 * Number(a[1].key == null)) - (REGION_ORDER.indexOf(b[1].key as RegionKey) + 100 * Number(b[1].key == null)) || a[0].localeCompare(b[0]));
  log("\nregion labels → key");
  for (const [label, e] of table) log(`  ${(e.key ?? "(not on map)").padEnd(12)} ${label}  [${[...e.datasets].join(", ")}]`);

  const manifest = {
    built_at: new Date().toISOString(),
    builder: "scripts/build-hgab-geo.ts",
    command: `npm run build:hgab-geo -- ${process.argv.slice(2).join(" ")}`.trim(),
    contract: { path: "src/lib/hgab.ts", sha256: sha256(args.contract) },
    outlines: {
      output: "geo/provinces.json", bytes: geoBytes, provinces: geo.provinces.length, vertices,
      source: OUTLINE_SOURCE, repository: OUTLINE_REPO, licence: "MIT, Copyright (c) James Faeldon", psgc_as_of: "2023-12-31",
      directory: args.geo, resolution: `${args.res}: ${RESOLUTIONS[args.res].label}`, rounding: "4 decimals",
      simplification: { method: "Douglas–Peucker per ring after rounding", tolerance_deg: tolerance, max_bytes: args.maxBytes, ladder: args.tolerance != null ? null : TOLERANCE_LADDER },
      winding: "exterior rings counter-clockwise, holes clockwise",
      region_rule: "adm1_psgc → region, then per-province overrides (below). Bacolod is not a separate feature in this release (it sits inside Negros Occidental).",
      region_overrides: Object.entries(REGION_OVERRIDES).map(([psgc, o]) => ({ psgc: Number(psgc), ...o })),
      name_gaps: gaps,
      inputs: outlineInputs,
    },
    gps_inventory: { path: args.gps, ...fileInfo(args.gps), dataset: "dpwh_comparison_2027", ...gpsJoin },
    bounds: BOUNDS,
    datasets: manifestDatasets,
    dataset_inputs: datasetInputs,
    region_labels: table.map(([label, e]) => ({ label, key: e.key, datasets: [...e.datasets] })),
  };
  writeAtomic(resolve(args.out, "geo", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  log("\ngeo/manifest.json");

  if (args.check) {
    const failures = await verify(args, overview);
    if (failures) process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
