/**
 * Integrity gate for the generated `data/hgab/2027/` tree.
 *
 * Re-reads what `npm run import:hgab` wrote and asserts, without consulting
 * the importer's in-memory state:
 *
 *   - the stage totals and record counts the review pinned per dataset;
 *   - the five-group bridge identity per dataset
 *       house_only − nep_only + increased − decreased + scope_review = House − NEP
 *     and that every bridge equals the workbench's own main_overview_2027.json;
 *   - the DPWH reading delta (+₱134,000,000, exactly five third_only rows);
 *   - parquet columns == PROJECT_COLUMNS from src/lib/hgab.ts, in order, with
 *     row counts that match the summaries;
 *   - every document key a row or dataset cites exists in the registry (and on
 *     disk unless --no-pdf);
 *   - the reconciliation against our FY2027 NEP tree has no mismatch;
 *   - every dataset's READER-FACING copy (`summary` ≤ 30 words, `one_row`,
 *     `caveats[]`) is present and free of codes, volumes and pipeline jargon
 *     (docs/hgab-data.md "Reader-facing vs technical copy");
 *   - the districts index (`npm run build:hgab-districts`): card/office
 *     referential integrity, tiers, the nine-slot year shape (null never 0),
 *     the residual identity deo + central + regional + unmatched = total per
 *     year and stage (HGAB 3R ₱587,075,661,000; NEP ₱643,953,276,000; GAA
 *     yearly totals), per-office bridge identity and parquet tie-out,
 *     headline sums, and ≥ 250 of 254 representatives joined.
 *
 *   - with `--d1=local`: the hgab_* tables loaded into the local D1 from
 *     `npm run build:hgab-d1` (docs/hgab-api.md), queried through
 *     `wrangler d1 execute budget --local --json`: contract row counts, every
 *     project row column-for-column against the parquet, stage totals, the
 *     bridge recomputed from the rows, regions + not_on_map = totals, the
 *     districts/offices/residual, records ⇄ projects, and 20 random record_json
 *     strings byte-equal to the parquet. Skipped (silently) without the flag.
 *
 *   npm run verify:hgab
 *   npm run verify:hgab -- --out=data/hgab/2027 --src=/tmp/dpwh-nep-review/repo --no-pdf
 *   npm run verify:hgab -- --d1=local
 *
 * Exit code is non-zero if any check fails. `--src` is optional: without the
 * workbench checkout the main_overview comparison is skipped and reported.
 * `--gaa=data/18` points at the GAA tree whose yearly_totals.json the
 * districts residual must reproduce (skipped and reported when absent).
 */

import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = resolve(arg("out", "data/hgab/2027"));
const SRC = resolve(arg("src", "/tmp/dpwh-nep-review/repo"));
const CONTRACT = resolve(arg("contract", "src/lib/hgab.ts"));
const GAA = resolve(arg("gaa", "data/18"));
const CHECK_PDF = !argv.includes("--no-pdf");
const FULL_HASH = argv.includes("--hash-pdfs");
/** Opt-in network probe: does the portrait host send the CORP/CORS header this site's COEP needs? Informational only. */
const PROBE_PORTRAITS = argv.includes("--probe-portraits");
/** `--d1=local`: also verify the hgab_* tables in the local D1. Only `local` exists; nothing here touches a remote database. */
const D1_MODE = arg("d1", "");
if (D1_MODE && D1_MODE !== "local") throw new Error(`--d1=${D1_MODE} is not supported; only --d1=local (the remote database is never queried here)`);

type DatasetKey = "dpwh" | "fmr" | "hfep" | "nia";
const DATASETS: readonly DatasetKey[] = ["dpwh", "fmr", "hfep", "nia"];
type BridgeGroup = "house_only" | "nep_only" | "unchanged" | "increased" | "decreased" | "scope_review";
const GROUPS: readonly BridgeGroup[] = ["house_only", "nep_only", "unchanged", "increased", "decreased", "scope_review"];
const PLAIN_TRACES = new Set(["amount_same", "house_only_candidate", "nep_only_candidate", "candidate_increase", "candidate_decrease"]);

const EXPECTED = {
  dpwh: { nep: 572_924_074_000, hgab2: 586_941_661_000, hgab3: 587_075_661_000, api: 445_378_063_000, printed_nep: 642_612_015_000, printed_house: 654_102_015_000,
    counts: { nep: 11_420, hgab2: 16_270, hgab3: 16_275, api: 11_372 }, reading_delta: 134_000_000, third_only: 5, dept: "18" },
  fmr: { nep: 16_000_000_000, house: 19_628_100_000, counts: { nep: 704, house: 964 }, dept: "05" },
  hfep: { nep_printed: 14_472_659_000, nep_ledger: 14_472_519_000, house: 10_021_659_000, dept: "13" },
  nia: { nep: 17_598_181_000, house: 17_999_305_000, counts: { nep: 791, house: 828 }, dept: "35" },
};

interface BridgeCell { rows: number; php: number; nep_php?: number | null; house_php?: number | null }
interface Bridge extends Record<BridgeGroup, BridgeCell> { net_php: number; house_stage: "hgab2" | "hgab3" }
interface Meta {
  key: DatasetKey; dept_id: string; summary: string; one_row: string; caveats: string[]; grain: string; scope: string;
  has_readings: boolean; has_map: boolean; controls_label: string;
  totals: { nep_php: number; hgab2_php: number | null; hgab3_php: number | null; api_php: number | null };
  counts: { nep: number; hgab2: number | null; hgab3: number | null; api: number | null };
  printed: { nep_new_appropriations_php: number | null; house_new_appropriations_php: number | null } | null;
  bridge: Bridge; documents: { nep: string[]; house: string[] };
}
interface Doc { key: string; sha256: string; bytes: number; stage: string; reading: number | null; pages: { from: number; to: number } | null }
interface Recon { dataset: DatasetKey; check: string; status: string; ours_php: number | null; theirs_php: number | null; diff_php: number | null; note: string }
interface Overview { fiscal_year: number; source_commit: string; datasets: Meta[]; documents: Doc[]; reconciliation: Recon[] }
interface Summary {
  dataset: Meta; controls: Array<{ label: string; nep_php: number | null; hgab2_php: number | null; hgab3_php: number | null; reading_delta_php: number | null }>;
  dims: Record<string, Array<{ nep_php: number; house_php: number }>>; top: Partial<Record<BridgeGroup, Array<{ trace: string; id: string }>>>;
  readings: { second_php: number; third_php: number; delta_php: number; status_counts: Record<string, number>; third_only: unknown[]; changed_controls: unknown[] } | null;
}
// Districts index (src/lib/hgab.ts "Districts: the DEO lens").
type FiscalStage = "gaa" | "nep" | "hgab3";
interface CongressTerm { congress: number; label: string; years: number[]; note: string }
interface YearAmount { fy: number; stage: FiscalStage; php: number | null; matched_label: string | null }
interface OfficeHistory {
  id: string; name: string; kind: string; region: string | null; district_ids: string[]; tier: "A" | "B"; years: YearAmount[];
  by_congress: Array<{ congress: number; gaa_php: number | null; years_counted: number[] }>;
  fy2027: { nep_php: number | null; hgab2_php: number | null; hgab3_php: number | null; nep_records: number; hgab3_records: number; bridge: Bridge | null } | null;
  aliases_used: string[]; notes: string[];
}
interface Representative {
  name: string; seat: string; status: "resolved" | "ambiguous"; member_code: string | null; profile_url: string | null; juris_id: string | null; juris_url: string | null;
  portrait_url: string | null; portrait_attribution: string | null; portrait_license: string | null; portrait_source_url: string | null; bill_count: number | null;
  leadership_roles: string[]; candidates?: Representative[];
}
interface DistrictCard {
  id: string; label: string; jurisdiction: string; district_label: string; region: string | null; representative: Representative | null; office_ids: string[];
  attribution: "A" | "B" | "mixed" | "none"; headline: { fy2026_gaa_php: number | null; fy2027_nep_php: number | null; fy2027_hgab3_php: number | null };
  co_served_district_ids: string[];
}
interface ResidualYear {
  fy: number; stage: FiscalStage; total_php: number; deo_php: number; central_office_php: number; regional_offices_php: number; unmatched_php: number; unmatched_labels: string[];
}
interface DistrictIndex {
  fiscal_year: number; built_at: string; source_commit: string;
  crosswalk: { schema_version: string; build_date: string; offices: number; districts: number; relationships: number };
  representatives_source: { url: string; congress: number; fetched_at: string; notice: string; matched: number; unmatched: number };
  terms: CongressTerm[]; districts: DistrictCard[]; offices: Record<string, OfficeHistory>; residual: ResidualYear[]; scope_notes: string[];
}
const DISTRICT_SLOTS: Array<{ fy: number; stage: FiscalStage }> = [
  ...[2020, 2021, 2022, 2023, 2024, 2025, 2026].map((fy) => ({ fy, stage: "gaa" as FiscalStage })),
  { fy: 2027, stage: "nep" }, { fy: 2027, stage: "hgab3" },
];
const EXPECTED_DISTRICTS = { nep_total: 643_953_276_000, hgab3_total: 587_075_661_000, districts: 254, min_matched: 250 };

interface MainWorkspace {
  key: string; delta_php: number;
  insertions: { count: number; comparison_rows?: number; amount_php: number }; deletions: { count: number; comparison_rows?: number; amount_php: number };
  unchanged: { count: number; comparison_rows?: number; amount_php: number };
  adjustments: { increased_count: number; reduced_count: number; increased_php: number; reduced_php: number }; scope_review?: { count: number; net_php: number };
}

let checks = 0, failures = 0;
const peso = (n: number | null | undefined) => (n == null ? "—" : `₱${n.toLocaleString("en-US")}`);
const words = (s: string | null | undefined) => String(s ?? "").trim().split(/\s+/).filter(Boolean).length;
/**
 * Words that must never reach a hero, card or KPI: 15-digit UACS codes and the pipeline's own vocabulary.
 * Whole words, case-insensitive. "flood control" and the plural "bridges" are plain English (DPWH builds
 * them) and are allowed; the banned senses are the singular "bridge" (the five-group bridge) and "control(s)".
 */
const BANNED_IN_READER_COPY: ReadonlyArray<[string, RegExp]> = [
  ["15-digit code", /\b\d{15}\b/], ["PDF", /\bPDF\b/i], ["annex", /\bannex(es)?\b/i], ["ledger", /\bledgers?\b/i], ["control", /\bcontrols?\b/i],
  ["bridge", /\bbridge\b/i], ["MOOE", /\bMOOE\b/i], ["NEP Volume", /NEP Volume/i], ["I-B/I-C/II-A/II-B", /\b(I-B|I-C|II-A|II-B)\b/i], ["OCR", /\bOCR\b/i],
];
const readerCopyHits = (text: string): string[] => {
  const t = text.replace(/\bflood control\b/gi, "flood management");
  return BANNED_IN_READER_COPY.filter(([, re]) => re.test(t)).map(([name]) => name);
};
function check(name: string, ok: boolean, detail = ""): void {
  checks++;
  if (ok) process.stdout.write(`  ✓ ${name}\n`);
  else { failures++; process.stdout.write(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}\n`); }
}
const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const q = (s: string) => s.replace(/'/g, "''");
const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : Number(v));

/** PROJECT_COLUMNS as written in src/lib/hgab.ts — the contract is the source of truth. */
function contractColumns(path: string): string[] {
  const src = readFileSync(path, "utf8");
  const m = /export const PROJECT_COLUMNS = \[([\s\S]*?)\] as const;/.exec(src);
  if (!m) throw new Error(`PROJECT_COLUMNS not found in ${path}`);
  return [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
}
function contractTraces(path: string): Set<string> {
  const src = readFileSync(path, "utf8");
  const block = /export const TRACE_LABELS[^{]*\{([\s\S]*?)\n\};/.exec(src)?.[1] ?? "";
  return new Set([...block.matchAll(/^\s*([a-z0-9_]+):\s*\{/gm)].map((x) => x[1]));
}
/** CONGRESS_TERMS as written in src/lib/hgab.ts. */
function contractTerms(path: string): CongressTerm[] {
  const src = readFileSync(path, "utf8");
  const block = /export const CONGRESS_TERMS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(src)?.[1] ?? "";
  return [...block.matchAll(/\{\s*congress:\s*(\d+),\s*label:\s*'([^']*)',\s*years:\s*\[([^\]]*)\],\s*note:\s*'([^']*)'\s*\}/g)]
    .map((m) => ({ congress: Number(m[1]), label: m[2], years: m[3].split(",").map((y) => Number(y.trim())), note: m[4] }));
}

async function main(): Promise<void> {
  if (!existsSync(resolve(OUT, "overview.json"))) throw new Error(`${OUT}/overview.json not found — run \`npm run import:hgab\` first.`);
  process.stdout.write(`verifying ${OUT}\n\n`);
  const overview = readJson<Overview>(resolve(OUT, "overview.json"));
  const manifest = readJson<{ source_commit: string; datasets_built: string[] }>(resolve(OUT, "manifest.json"));
  const columns = contractColumns(CONTRACT);
  const traces = contractTraces(CONTRACT);
  const mainPath = resolve(SRC, "analysis/data/main_overview_2027.json");
  const mainWs = existsSync(mainPath) ? readJson<{ workspaces: MainWorkspace[] }>(mainPath).workspaces : null;

  process.stdout.write("overview.json\n");
  check("fiscal year is 2027", overview.fiscal_year === 2027);
  check("source commit is pinned and matches the manifest", /^[0-9a-f]{40}$/.test(overview.source_commit) && overview.source_commit === manifest.source_commit, overview.source_commit);
  check("all four datasets present in order", overview.datasets.map((d) => d.key).join(",") === DATASETS.join(","), overview.datasets.map((d) => d.key).join(","));
  check("department ids are 18/05/13/35", overview.datasets.every((d) => EXPECTED[d.key].dept === d.dept_id));
  // has_map: the Map tab can draw regions (and, where printed, coordinates) for every program
  // except NIA, whose lists print neither; its tab explains instead.
  check("readings only on DPWH; a drawable map on every program but NIA", overview.datasets.every((d) => d.has_readings === (d.key === "dpwh") && d.has_map === (d.key !== "nia")));
  // Reader-facing copy: what heroes, cards and KPIs show. Plain words only; the technical record stays in grain/scope.
  // Self-test: the filter must catch the copy Jason rejected, and pass the plain uses it exempts.
  const rejected = "One printed funding-column cell (Infrastructure, Medical equipment or Motor vehicle) of one facility; facility totals are controls … HFEP capital outlays (DOH activity 350202100002000) as printed in the NEP Volume II-A annex, the ledger, the bridge, MOOE, PDF pages, Volume I-B, I-C, II-B, OCR copy";
  const caught = readerCopyHits(rejected);
  check("reader-copy filter catches every banned item in the rejected wording and passes 'flood control' and 'bridges'",
    caught.length === BANNED_IN_READER_COPY.length && readerCopyHits("Roads, bridges and flood control projects.").length === 0,
    `caught ${caught.join(", ")}`);
  for (const d of overview.datasets) {
    const nonEmpty = (x: unknown) => typeof x === "string" && x.trim().length > 0;
    check(`${d.key}: reader-facing summary (≤ 30 words), one_row and caveats[] present`,
      nonEmpty(d.summary) && words(d.summary) <= 30 && nonEmpty(d.one_row) && Array.isArray(d.caveats) && d.caveats.length > 0 && d.caveats.every(nonEmpty),
      `summary ${words(d.summary)} words · one_row ${nonEmpty(d.one_row) ? "present" : "missing"} · ${Array.isArray(d.caveats) ? d.caveats.length : 0} caveats`);
    const hits = [d.summary, d.one_row, ...(Array.isArray(d.caveats) ? d.caveats : [])].flatMap((t) => readerCopyHits(String(t ?? "")).map((name) => `${name} in "${t}"`));
    check(`${d.key}: reader-facing copy has no codes, volumes or jargon (${BANNED_IN_READER_COPY.map(([n]) => n).join(", ")})`, hits.length === 0, hits.join("; "));
  }
  const docKeys = new Set(overview.documents.map((d) => d.key));
  check("document registry has the eight expected keys", docKeys.size === 8 && ["hb10858-2r-vol-ib", "hb10858-2r-vol-ic", "hb10858-3r-vol-ib", "hb10858-3r-vol-ic", "nep2027-vol-iib", "nep2027-fmr", "nep2027-nia", "nep2027-hfep"].every((k) => docKeys.has(k)), [...docKeys].join(","));
  check("every dataset document key is registered", overview.datasets.every((d) => [...d.documents.nep, ...d.documents.house].every((k) => docKeys.has(k))));
  if (CHECK_PDF) {
    const missing = overview.documents.filter((d) => { const p = resolve(OUT, "pdf", `${d.key}.pdf`); return !existsSync(p) || statSync(p).size !== d.bytes; });
    check("every registered PDF exists with the registered size", missing.length === 0, missing.map((d) => d.key).join(", "));
    if (FULL_HASH) {
      const bad = overview.documents.filter((d) => createHash("sha256").update(readFileSync(resolve(OUT, "pdf", `${d.key}.pdf`))).digest("hex") !== d.sha256);
      check("every registered PDF hashes to its registered sha256", bad.length === 0, bad.map((d) => d.key).join(", "));
    }
  } else {
    process.stdout.write("  · PDF presence skipped (--no-pdf)\n");
  }

  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  const rows = async (sql: string) => (await c.runAndReadAll(sql)).getRows();
  const one = async (sql: string) => (await rows(sql))[0];

  for (const meta of overview.datasets) {
    const key = meta.key;
    process.stdout.write(`\n${key}\n`);
    const summary = readJson<Summary>(resolve(OUT, key, "summary.json"));
    const parquet = resolve(OUT, key, "projects.parquet");
    check("summary.json dataset block equals overview entry", JSON.stringify(summary.dataset) === JSON.stringify(meta));
    check("projects.parquet exists", existsSync(parquet), parquet);
    if (!existsSync(parquet)) continue;
    const P = `read_parquet('${q(parquet)}')`;

    const cols = (await rows(`DESCRIBE SELECT * FROM ${P}`)).map((r) => String(r[0]));
    check("parquet columns equal PROJECT_COLUMNS in order", cols.join(",") === columns.join(","), `parquet: ${cols.join(",")}`);
    const [n, nepSum, h2Sum, h3Sum, apiSum, nepN, h2N, h3N, apiN, zeroAmounts, badDataset, emptySearch] = (await one(`
      SELECT count(*), sum(nep_php), sum(hgab2_php), sum(hgab3_php), sum(api_php),
             count(nep_php), count(hgab2_php), count(hgab3_php), count(api_php),
             count(*) FILTER (nep_php = 0 OR hgab2_php = 0 OR hgab3_php = 0 OR api_php = 0),
             count(*) FILTER (dataset <> '${key}'), count(*) FILTER (search_text IS NULL OR search_text = '' OR record_json IS NULL)
      FROM ${P}`)).map(num);
    const b = meta.bridge;
    const bridgeRows = GROUPS.reduce((a, g) => a + b[g].rows, 0);
    check("parquet row count equals the bridge's comparison rows", n === bridgeRows, `${n} vs ${bridgeRows}`);
    check("every row carries this dataset key, search_text and record_json", badDataset === 0 && emptySearch === 0, `${badDataset} wrong dataset, ${emptySearch} empty`);
    check("no stage amount is 0 (null means no record)", zeroAmounts === 0, `${zeroAmounts} rows`);
    const ids = num((await one(`SELECT count(DISTINCT id) FROM ${P}`))[0]);
    check("row ids are unique", ids === n, `${ids} distinct of ${n}`);

    // Stage totals, compared never summed across stages.
    const houseSum = b.house_stage === "hgab3" ? h3Sum : h2Sum;
    if (key === "dpwh") {
      const E = EXPECTED.dpwh;
      check("NEP operations total ₱572,924,074,000", meta.totals.nep_php === E.nep && nepSum === E.nep, `${peso(meta.totals.nep_php)} / parquet ${peso(nepSum)}`);
      check("HGAB 2R operations total ₱586,941,661,000", meta.totals.hgab2_php === E.hgab2 && h2Sum === E.hgab2, `${peso(meta.totals.hgab2_php)} / parquet ${peso(h2Sum)}`);
      check("HGAB 3R operations total ₱587,075,661,000", meta.totals.hgab3_php === E.hgab3 && h3Sum === E.hgab3, `${peso(meta.totals.hgab3_php)} / parquet ${peso(h3Sum)}`);
      check("Transparency total ₱445,378,063,000", meta.totals.api_php === E.api && apiSum === E.api, `${peso(meta.totals.api_php)} / parquet ${peso(apiSum)}`);
      check("printed new appropriations NEP ₱642,612,015,000 / House ₱654,102,015,000", meta.printed?.nep_new_appropriations_php === E.printed_nep && meta.printed?.house_new_appropriations_php === E.printed_house);
      // Member counts: grouped repeated House keys count their records[].
      const [m2, m3, mN, mA] = (await one(`
        SELECT sum(coalesce(json_array_length(record_json->'$.second.records'), 1)) FILTER (hgab2_php IS NOT NULL),
               sum(coalesce(json_array_length(record_json->'$.third.records'), 1)) FILTER (hgab3_php IS NOT NULL),
               sum(coalesce(json_array_length(record_json->'$.nep.records'), 1)) FILTER (nep_php IS NOT NULL),
               sum(coalesce(json_array_length(record_json->'$.api.records'), 1)) FILTER (api_php IS NOT NULL)
        FROM ${P}`)).map(num);
      check("record counts 11,420 / 16,270 / 16,275 / 11,372 (members of grouped rows counted)",
        meta.counts.nep === E.counts.nep && meta.counts.hgab2 === E.counts.hgab2 && meta.counts.hgab3 === E.counts.hgab3 && meta.counts.api === E.counts.api
        && mN === E.counts.nep && m2 === E.counts.hgab2 && m3 === E.counts.hgab3 && mA === E.counts.api,
        `meta ${JSON.stringify(meta.counts)} parquet nep ${mN} hgab2 ${m2} hgab3 ${m3} api ${mA} (rows ${nepN}/${h2N}/${h3N}/${apiN})`);
      const unknown = (await rows(`SELECT DISTINCT trace FROM ${P}`)).map((r) => String(r[0])).filter((t) => !traces.has(t));
      check("every trace value is in the contract's TRACE_LABELS", unknown.length === 0, unknown.join(", "));
      // Readings.
      const r = summary.readings;
      const thirdOnlyRows = num((await one(`SELECT count(*) FROM ${P} WHERE reading_status = 'third_only'`))[0]);
      check("readings delta is +₱134,000,000 and ties second → third", !!r && r.delta_php === E.reading_delta && r.third_php - r.second_php === r.delta_php && r.second_php === E.hgab2 && r.third_php === E.hgab3,
        r ? `${peso(r.second_php)} → ${peso(r.third_php)} (${peso(r.delta_php)})` : "no readings block");
      check("exactly five third_only rows (summary, status_counts and parquet)", !!r && r.third_only.length === E.third_only && r.status_counts.third_only === E.third_only && thirdOnlyRows === E.third_only,
        `${r?.third_only.length} / ${r?.status_counts.third_only} / ${thirdOnlyRows}`);
      check("changed PAP controls carry the reading delta", !!r && summary.controls.filter((x) => x.reading_delta_php).reduce((a, x) => a + (x.reading_delta_php ?? 0), 0) === E.reading_delta);
      check("PAP controls present (46 incl. FAP) with NEP and both readings", summary.controls.length === 46 && summary.controls.every((x) => x.nep_php != null && (x.hgab2_php == null || x.hgab3_php != null)));
    } else {
      check("HGAB 2R and 3R amounts are equal on every annex row (annex text identical across readings)",
        num((await one(`SELECT count(*) FROM ${P} WHERE hgab2_php IS DISTINCT FROM hgab3_php`))[0]) === 0 && meta.totals.hgab2_php === meta.totals.hgab3_php);
      const unknown = (await rows(`SELECT DISTINCT trace FROM ${P}`)).map((r) => String(r[0])).filter((t) => !PLAIN_TRACES.has(t));
      check("annex traces use only the five plain values", unknown.length === 0, unknown.join(", "));
      check("no readings block", summary.readings === null);
      if (key === "fmr") {
        const E = EXPECTED.fmr;
        check("NEP ₱16,000,000,000 (704) / House ₱19,628,100,000 (964)", meta.totals.nep_php === E.nep && nepSum === E.nep && meta.totals.hgab2_php === E.house && h2Sum === E.house
          && meta.counts.nep === E.counts.nep && nepN === E.counts.nep && meta.counts.hgab2 === E.counts.house && h2N === E.counts.house,
          `${peso(nepSum)} (${nepN}) / ${peso(h2Sum)} (${h2N})`);
      } else if (key === "nia") {
        const E = EXPECTED.nia;
        check("NEP ₱17,598,181,000 (791) / House ₱17,999,305,000 (828)", meta.totals.nep_php === E.nep && nepSum === E.nep && meta.totals.hgab2_php === E.house && h2Sum === E.house
          && meta.counts.nep === E.counts.nep && nepN === E.counts.nep && meta.counts.hgab2 === E.counts.house && h2N === E.counts.house,
          `${peso(nepSum)} (${nepN}) / ${peso(h2Sum)} (${h2N})`);
      } else {
        const E = EXPECTED.hfep;
        check("NEP ledger ₱14,472,519,000 (totals and parquet) / House ₱10,021,659,000",
          meta.totals.nep_php === E.nep_ledger && nepSum === E.nep_ledger && meta.totals.hgab2_php === E.house && h2Sum === E.house,
          `meta ${peso(meta.totals.nep_php)} parquet ${peso(nepSum)} / ${peso(h2Sum)}`);
        check("printed NEP annex control ₱14,472,659,000 kept visible (controls row, scope sentence, explained reconciliation row)",
          summary.controls.some((x) => x.nep_php === E.nep_printed && x.hgab2_php === E.house) && meta.scope.includes("14,472,659,000") && meta.scope.includes("140,000")
          && overview.reconciliation.some((r) => r.dataset === "hfep" && r.status === "explained" && r.diff_php === 140_000 && r.theirs_php === E.nep_ledger));
        check("funding-column record counts equal the non-null stage cells", meta.counts.nep === nepN && meta.counts.hgab2 === h2N, `${meta.counts.nep}/${nepN} ${meta.counts.hgab2}/${h2N}`);
        const facilities = (await one(`SELECT count(DISTINCT record_json->>'$.house.id') FILTER (hgab2_php IS NOT NULL), count(DISTINCT record_json->>'$.nep.id') FILTER (nep_php IS NOT NULL) FROM ${P}`)).map(num);
        check("513 House / 464 NEP facilities behind the records", facilities[0] === 513 && facilities[1] === 464, facilities.join("/"));
      }
    }

    // Bridge identity and population.
    const identity = b.house_only.php - b.nep_only.php + b.increased.php - b.decreased.php + b.scope_review.php;
    check("bridge identity house_only − nep_only + increased − decreased + scope_review = net", identity === b.net_php, `${peso(identity)} vs ${peso(b.net_php)}`);
    check("bridge net equals House − NEP of the parquet rows", b.net_php === houseSum - nepSum, `${peso(b.net_php)} vs ${peso(houseSum - nepSum)}`);
    const totalsHouse = b.house_stage === "hgab3" ? meta.totals.hgab3_php : meta.totals.hgab2_php;
    check("bridge net equals totals House − NEP (identity holds on the compared population, no exceptions)", totalsHouse != null && b.net_php === totalsHouse - meta.totals.nep_php,
      `${peso(b.net_php)} vs ${peso(totalsHouse)} − ${peso(meta.totals.nep_php)}`);
    check("bridge house_stage is hgab3 for DPWH, hgab2 for annexes", b.house_stage === (key === "dpwh" ? "hgab3" : "hgab2"));
    const byGroup = Object.fromEntries((await rows(`
      SELECT CASE
        WHEN trace LIKE '%segment_scope_review%' THEN 'scope_review'
        WHEN trace LIKE '%house_only_candidate%' OR trace IN ('fuzzy_candidate', 'ambiguous') THEN 'house_only'
        WHEN trace LIKE '%nep_only_candidate%' THEN 'nep_only'
        WHEN trace LIKE '%candidate_increase%' THEN 'increased'
        WHEN trace LIKE '%candidate_decrease%' THEN 'decreased'
        WHEN trace LIKE '%amount_same%' THEN 'unchanged'
        WHEN ${b.house_stage}_php IS NOT NULL AND nep_php IS NULL THEN 'house_only'
        WHEN nep_php IS NOT NULL AND ${b.house_stage}_php IS NULL THEN 'nep_only'
        WHEN delta_php > 0 THEN 'increased' WHEN delta_php < 0 THEN 'decreased' ELSE 'unchanged' END g, count(*) FROM ${P} GROUP BY 1`)).map((r) => [String(r[0]), num(r[1])]));
    const groupBad = GROUPS.filter((g) => (byGroup[g] ?? 0) !== b[g].rows);
    check("bridge cell row counts match the parquet partition by trace", groupBad.length === 0, groupBad.map((g) => `${g}: parquet ${byGroup[g] ?? 0} vs bridge ${b[g].rows}`).join("; "));
    // One-sided rows must be House-/NEP-only candidates — except HFEP cells printed on one side of a paired facility,
    // which the workbench books as 0-base adjustments and the importer flags.
    const oneSided = num((await one(`SELECT count(*) FROM ${P}
      WHERE (${b.house_stage}_php IS NULL) <> (nep_php IS NULL)
        AND trace NOT LIKE '%house_only_candidate%' AND trace NOT LIKE '%nep_only_candidate%' AND trace NOT IN ('fuzzy_candidate', 'ambiguous')
        AND NOT (flags LIKE '%column_added%' OR flags LIKE '%column_dropped%')`))[0]);
    check("every one-sided row is a House-/NEP-only candidate (HFEP column_added/column_dropped excepted)", oneSided === 0, `${oneSided} rows`);
    const pairedNull = num((await one(`SELECT count(*) FROM ${P} WHERE (trace LIKE '%amount_same%' OR trace LIKE '%candidate_increase%' OR trace LIKE '%candidate_decrease%' OR trace LIKE '%segment_scope_review%') AND delta_php IS NULL`))[0]);
    check("every paired row carries delta_php", pairedNull === 0, `${pairedNull} rows`);
    if (mainWs) {
      const w = mainWs.find((x) => x.key === key);
      const bad: string[] = [];
      if (!w) bad.push("workspace missing");
      else {
        const pairs: Array<[string, number, number]> = [
          ["house_only php", b.house_only.php, w.insertions.amount_php], ["house_only rows", b.house_only.rows, w.insertions.comparison_rows ?? w.insertions.count],
          ["nep_only php", b.nep_only.php, w.deletions.amount_php], ["nep_only rows", b.nep_only.rows, w.deletions.comparison_rows ?? w.deletions.count],
          ["unchanged php", b.unchanged.php, w.unchanged.amount_php], ["unchanged rows", b.unchanged.rows, w.unchanged.comparison_rows ?? w.unchanged.count],
          ["increased php", b.increased.php, w.adjustments.increased_php], ["increased rows", b.increased.rows, w.adjustments.increased_count],
          ["decreased php", b.decreased.php, w.adjustments.reduced_php], ["decreased rows", b.decreased.rows, w.adjustments.reduced_count],
          ["scope_review php", b.scope_review.php, w.scope_review?.net_php ?? 0], ["scope_review rows", b.scope_review.rows, w.scope_review?.count ?? 0],
          ["net php", b.net_php, w.delta_php],
        ];
        for (const [name, a, x] of pairs) if (a !== x) bad.push(`${name} ${a} vs ${x}`);
      }
      check("bridge equals the workbench main_overview_2027.json", bad.length === 0, bad.join("; "));
    } else {
      process.stdout.write("  · main_overview comparison skipped (no --src checkout)\n");
    }

    // Documents cited by rows.
    const cited = (await rows(`SELECT DISTINCT d FROM (SELECT nep_doc d FROM ${P} UNION SELECT hgab2_doc FROM ${P} UNION SELECT hgab3_doc FROM ${P}) WHERE d IS NOT NULL`)).map((r) => String(r[0]));
    const unregistered = cited.filter((k) => !docKeys.has(k));
    check("every document key cited by a row is registered and listed on the dataset", unregistered.length === 0 && cited.every((k) => meta.documents.nep.includes(k) || meta.documents.house.includes(k)), `${cited.join(",")} (unregistered: ${unregistered.join(",") || "none"})`);
    const pageless = num((await one(`SELECT count(*) FROM ${P} WHERE (nep_doc IS NOT NULL AND nep_page IS NULL) OR (hgab2_doc IS NOT NULL AND hgab2_page IS NULL) OR (hgab3_doc IS NOT NULL AND hgab3_page IS NULL)`))[0]);
    check("every cited document carries a page", pageless === 0, `${pageless} rows`);

    // Summary lists.
    const topBad = GROUPS.filter((g) => (summary.top[g]?.length ?? 0) > 25 || (summary.top[g]?.length ?? 0) > b[g].rows);
    check("top lists hold at most 25 rows per bridge group", topBad.length === 0, topBad.join(", "));
    const dimBad = Object.entries(summary.dims).filter(([, d]) => d.reduce((a, x) => a + x.house_php, 0) !== houseSum || d.reduce((a, x) => a + x.nep_php, 0) !== nepSum);
    check("every dimension conserves both stage totals", dimBad.length === 0, dimBad.map(([k]) => k).join(", "));
    check(`controls present (${meta.controls_label})`, summary.controls.length > 0);
  }

  process.stdout.write("\nreconciliation against our FY2027 NEP tree\n");
  const R = overview.reconciliation;
  const mismatches = R.filter((r) => r.status === "mismatch");
  check("reconciliation rows exist for every dataset", DATASETS.every((d) => R.some((r) => r.dataset === d)));
  check("no reconciliation mismatch", mismatches.length === 0, mismatches.map((r) => `${r.dataset}: ${r.check} (${peso(r.ours_php)} vs ${peso(r.theirs_php)})`).join("\n      "));
  const pick = (dataset: DatasetKey, startsWith: string) => R.find((r) => r.dataset === dataset && r.check.startsWith(startsWith));
  check("DPWH new appropriations reconcile exactly to ₱642,612,015,000", pick("dpwh", "DPWH total")?.status === "exact" && pick("dpwh", "DPWH total")?.theirs_php === EXPECTED.dpwh.printed_nep);
  check("capital outlays and the six operations programs are exact", pick("dpwh", "DPWH capital outlays")?.status === "exact" && R.filter((r) => r.dataset === "dpwh" && r.check.startsWith("Program total:")).length === 6 && R.filter((r) => r.dataset === "dpwh" && r.check.startsWith("Program total:")).every((r) => r.status === "exact"));
  check("45 printed PAP controls (program lines) each exact or explained", R.filter((r) => r.dataset === "dpwh" && r.check.startsWith("Program line:")).length === 45 && R.filter((r) => r.check.startsWith("Program line:")).every((r) => r.status === "exact" || r.status === "explained"));
  check("FMR activity, HFEP capital outlays and the six NIA sub-programs are exact", pick("fmr", "Farm-to-market roads")?.status === "exact" && pick("hfep", "Health facilities: our construction and equipment budget against the total printed")?.status === "exact"
    && R.filter((r) => r.dataset === "nia" && r.check.startsWith("Irrigation program:")).length === 6 && R.filter((r) => r.dataset === "nia").every((r) => r.status === "exact"));
  const t = { exact: 0, explained: 0, mismatch: 0, info: 0 } as Record<string, number>;
  for (const r of R) t[r.status] = (t[r.status] ?? 0) + 1;
  process.stdout.write(`  ${t.exact} exact · ${t.explained} explained · ${t.info} info · ${t.mismatch} mismatch\n`);

  // -------------------------------------------------------------------------
  // Districts index (the DEO lens)
  // -------------------------------------------------------------------------
  process.stdout.write("\ndistricts.json (DEO lens)\n");
  const districtsPath = resolve(OUT, "districts.json");
  check("districts.json present", existsSync(districtsPath), districtsPath);
  if (existsSync(districtsPath)) {
    const D = readJson<DistrictIndex>(districtsPath);
    const offices = Object.values(D.offices);
    const slotOf = (o: OfficeHistory, stage: FiscalStage, fy: number) => o.years.find((y) => y.stage === stage && y.fy === fy);
    const sumOrNull = (xs: Array<number | null | undefined>) => { const p = xs.filter((x): x is number => x != null); return p.length ? p.reduce((a, b) => a + b, 0) : null; };

    check("fiscal year 2027, source commit equals the overview's, crosswalk 2.1.0 with 254 districts", D.fiscal_year === 2027 && D.source_commit === overview.source_commit && D.crosswalk.schema_version === "2.1.0" && D.crosswalk.districts === EXPECTED_DISTRICTS.districts,
      `${D.fiscal_year} ${D.source_commit} ${D.crosswalk.schema_version} ${D.crosswalk.districts}`);
    check("terms equal CONGRESS_TERMS in the contract", JSON.stringify(D.terms) === JSON.stringify(contractTerms(CONTRACT)));
    const ids = D.districts.map((d) => d.id);
    check(`${EXPECTED_DISTRICTS.districts} district cards with unique ids`, ids.length === EXPECTED_DISTRICTS.districts && new Set(ids).size === ids.length, `${ids.length} cards, ${new Set(ids).size} distinct`);
    const idSet = new Set(ids);
    const badRefs = D.districts.flatMap((d) => d.office_ids.filter((o) => !D.offices[o]).map((o) => `${d.id}→${o}`));
    check("every office_ids entry exists in offices", badRefs.length === 0, badRefs.join(", "));
    const orphan = offices.filter((o) => !D.districts.some((d) => d.office_ids.includes(o.id)));
    check("every office appears on at least one card", orphan.length === 0, orphan.map((o) => o.id).join(", "));
    const inconsistent = offices.filter((o) => o.district_ids.some((x) => !idSet.has(x) || !D.districts.find((d) => d.id === x)!.office_ids.includes(o.id))
      || D.districts.some((d) => d.office_ids.includes(o.id) && !o.district_ids.includes(d.id)));
    check("office.district_ids and card.office_ids agree both ways", inconsistent.length === 0, inconsistent.map((o) => o.id).join(", "));
    const badTier = offices.filter((o) => o.tier !== (o.district_ids.length === 1 ? "A" : "B"));
    check("tier is A exactly when the office serves one district", badTier.length === 0, badTier.map((o) => o.id).join(", "));
    check("office kinds are DEO, sub-DEO or regional_group; BARMM is the regional_group", offices.every((o) => ["district_engineering_office", "sub_district_engineering_office", "regional_group"].includes(o.kind)) && offices.filter((o) => o.kind === "regional_group").map((o) => o.name).join() === "BARMM");

    // Years: nine slots in order, null never 0, integers.
    const badShape = offices.filter((o) => o.years.length !== 9 || o.years.some((y, i) => y.fy !== DISTRICT_SLOTS[i].fy || y.stage !== DISTRICT_SLOTS[i].stage));
    check("years has exactly nine slots in order (FY2020–2026 gaa, FY2027 nep, FY2027 hgab3)", badShape.length === 0, badShape.map((o) => o.id).join(", "));
    const zeroOrFrac = offices.filter((o) => o.years.some((y) => y.php === 0 || (y.php != null && !Number.isInteger(y.php)) || (y.php != null && y.matched_label == null)));
    check("php is null or a non-zero integer, and every amount names its matched label", zeroOrFrac.length === 0, zeroOrFrac.map((o) => o.id).join(", "));
    const badCongress = offices.filter((o) => o.by_congress.length !== D.terms.length || o.by_congress.some((b, i) => {
      const term = D.terms[i];
      const counted = o.years.filter((y) => y.stage === "gaa" && y.php != null && term.years.includes(y.fy));
      return b.congress !== term.congress || JSON.stringify(b.years_counted) !== JSON.stringify(counted.map((y) => y.fy)) || b.gaa_php !== sumOrNull(counted.map((y) => y.php));
    }));
    check("by_congress sums exactly the GAA years present per term (null when none)", badCongress.length === 0, badCongress.map((o) => o.id).join(", "));

    // Residual identity per slot, and the office side ties to deo_php.
    const badResidualShape = D.residual.length !== 9 || D.residual.some((r, i) => r.fy !== DISTRICT_SLOTS[i].fy || r.stage !== DISTRICT_SLOTS[i].stage);
    check("residual has the same nine slots in order", !badResidualShape);
    const badIdentity = D.residual.filter((r) => r.deo_php + r.central_office_php + r.regional_offices_php + r.unmatched_php !== r.total_php);
    check("residual identity deo + central + regional + unmatched = total holds on every slot", badIdentity.length === 0, badIdentity.map((r) => `${r.stage} ${r.fy}`).join(", "));
    const badDeo = D.residual.filter((r) => offices.reduce((a, o) => a + (slotOf(o, r.stage, r.fy)?.php ?? 0), 0) !== r.deo_php);
    check("Σ offices' php equals deo_php on every slot (so Σ offices + residual = total)", badDeo.length === 0, badDeo.map((r) => `${r.stage} ${r.fy}`).join(", "));
    const h3 = D.residual.find((r) => r.stage === "hgab3")!, nepR = D.residual.find((r) => r.stage === "nep")!;
    check("HGAB 3R total ₱587,075,661,000 and FY2027 NEP total ₱643,953,276,000", h3.total_php === EXPECTED_DISTRICTS.hgab3_total && nepR.total_php === EXPECTED_DISTRICTS.nep_total, `${peso(h3.total_php)} / ${peso(nepR.total_php)}`);
    check("HGAB 3R slot has no unmatched money (every printed DEO joined)", h3.unmatched_php === 0 && h3.unmatched_labels.length === 0, `${peso(h3.unmatched_php)} ${h3.unmatched_labels.join(", ")}`);
    const gaaTotalsPath = resolve(GAA, "yearly_totals.json");
    if (existsSync(gaaTotalsPath)) {
      const yt = readJson<{ data: Array<{ year: number; amount: number }> }>(gaaTotalsPath);
      const badGaa = D.residual.filter((r) => r.stage === "gaa" && r.total_php !== Math.round(yt.data.find((d) => d.year === r.fy)?.amount ?? NaN) * 1000);
      check("GAA slot totals equal yearly_totals.json ×1000", badGaa.length === 0, badGaa.map((r) => String(r.fy)).join(", "));
    } else {
      process.stdout.write(`  · GAA yearly totals comparison skipped (${gaaTotalsPath} not found)\n`);
    }
    const residualLeak = D.residual.filter((r) => r.unmatched_labels.some((l) => /^central office$/i.test(l) || /regional office/i.test(l)));
    check("unmatched_labels never contain Central Office or regional labels", residualLeak.length === 0);
    const noDivide = offices.filter((o) => o.tier === "B").every((o) => o.years.every((y) => y.php == null || Number.isInteger(y.php)));
    check("Tier B figures are whole, undivided amounts", noDivide);

    // FY2027 block: bridge identity per office and tie-out to the parquet by printed office label.
    const withBlock = offices.filter((o) => o.fy2027);
    const badBridge = withBlock.filter((o) => {
      const f = o.fy2027!, b = f.bridge;
      if (!b || b.house_stage !== "hgab3") return true;
      const identity = b.house_only.php - b.nep_only.php + b.increased.php - b.decreased.php + b.scope_review.php;
      return identity !== b.net_php || b.net_php !== (f.hgab3_php ?? 0) - (f.nep_php ?? 0) || f.hgab3_php !== slotOf(o, "hgab3", 2027)?.php;
    });
    check("per-office bridge identity holds and nets to hgab3 − nep (hgab3 equals the hgab3 slot)", badBridge.length === 0, badBridge.map((o) => o.id).join(", "));
    const dp = resolve(OUT, "dpwh", "projects.parquet");
    if (existsSync(dp)) {
      const byOffice = new Map((await rows(`SELECT office, sum(nep_php), sum(hgab2_php), sum(hgab3_php), count(*) FROM read_parquet('${q(dp)}') GROUP BY 1`)).map((r) => [String(r[0]), r.slice(1).map((v) => (v == null ? null : num(v)))]));
      const badTie = withBlock.filter((o) => {
        const label = slotOf(o, "hgab3", 2027)?.matched_label;
        const p = label ? byOffice.get(label) : undefined;
        return !p || p[0] !== o.fy2027!.nep_php || p[1] !== o.fy2027!.hgab2_php || p[2] !== o.fy2027!.hgab3_php;
      });
      check("fy2027 nep/hgab2/hgab3 equal the parquet sums for the printed office label", badTie.length === 0, badTie.map((o) => o.id).join(", "));
      const nepOps = withBlock.reduce((a, o) => a + (o.fy2027!.nep_php ?? 0), 0);
      const parquetNep = [...byOffice.values()].reduce((a, p) => a + (p[0] ?? 0), 0);
      const nonDeoNep = [...byOffice].filter(([l]) => /^central office$/i.test(l) || /regional office/i.test(l)).reduce((a, [, p]) => a + (p[0] ?? 0), 0);
      check("Σ offices' fy2027.nep_php + Central Office + regional = NEP operations total ₱572,924,074,000", nepOps + nonDeoNep === parquetNep && parquetNep === EXPECTED.dpwh.nep, `${peso(nepOps)} + ${peso(nonDeoNep)} vs ${peso(parquetNep)}`);
      const labels = new Set([...byOffice.keys()].filter((l) => !/^central office$/i.test(l) && !/regional office/i.test(l)));
      const joined = new Set(withBlock.map((o) => slotOf(o, "hgab3", 2027)?.matched_label));
      check(`every printed DEO in the parquet is on a card (${labels.size} labels)`, [...labels].every((l) => joined.has(l)), [...labels].filter((l) => !joined.has(l)).join(", "));
    }

    // Cards: headline sums, attribution, co-served, labels.
    const ledgerOffices = (d: DistrictCard) => d.office_ids.map((o) => D.offices[o]).filter((o) => o && o.kind !== "regional_group" && (o.years.some((y) => y.php != null) || o.fy2027));
    const badHeadline = D.districts.filter((d) => {
      const lo = ledgerOffices(d);
      return d.headline.fy2026_gaa_php !== sumOrNull(lo.map((o) => slotOf(o, "gaa", 2026)?.php)) || d.headline.fy2027_nep_php !== sumOrNull(lo.map((o) => slotOf(o, "nep", 2027)?.php)) || d.headline.fy2027_hgab3_php !== sumOrNull(lo.map((o) => slotOf(o, "hgab3", 2027)?.php));
    });
    check("headline sums equal the serving offices' undivided values", badHeadline.length === 0, badHeadline.map((d) => d.id).join(", "));
    const badAttr = D.districts.filter((d) => {
      const tiers = [...new Set(ledgerOffices(d).map((o) => o.tier))];
      const want = !tiers.length ? "none" : tiers.length > 1 ? "mixed" : tiers[0];
      return d.attribution !== want || (want === "none") !== (d.headline.fy2026_gaa_php == null && d.headline.fy2027_nep_php == null && d.headline.fy2027_hgab3_php == null);
    });
    check("attribution is A/B/mixed by the serving offices' tiers, none only when no ledger exists", badAttr.length === 0, badAttr.map((d) => d.id).join(", "));
    const badCo = D.districts.filter((d) => {
      const want = [...new Set(d.office_ids.flatMap((o) => (D.offices[o]?.kind === "regional_group" ? [] : D.offices[o]?.district_ids ?? [])))].filter((x) => x !== d.id).sort();
      return JSON.stringify(want) !== JSON.stringify(d.co_served_district_ids);
    });
    check("co_served_district_ids lists every other district sharing an engineering office", badCo.length === 0, badCo.map((d) => d.id).join(", "));
    const badLabel = D.districts.filter((d) => d.label !== `${d.jurisdiction}, ${d.district_label}` || !/ District$/.test(d.district_label));
    check('labels read "<Jurisdiction>, <Nth|Lone> District"', badLabel.length === 0, badLabel.map((d) => d.label).join("; "));

    // Representatives.
    const reps = D.districts.map((d) => d.representative);
    const resolved = reps.filter((r): r is Representative => !!r && r.status === "resolved");
    const ambiguous = reps.filter((r): r is Representative => !!r && r.status === "ambiguous");
    const seatJoined = (r: Representative | null) => !!r && (r.status === "resolved" ? r.juris_id != null : !!r.candidates?.length && r.candidates.every((x) => x.juris_id != null));
    const matched = reps.filter(seatJoined).length;
    const unmatchedNames = D.districts.filter((d) => !seatJoined(d.representative)).flatMap((d) => d.representative
      ? (d.representative.status === "resolved" ? [d.representative.name] : (d.representative.candidates ?? []).filter((x) => x.juris_id == null).map((x) => `${x.name} (candidate)`))
      : [`${d.label}: no representative`]);
    check(`representatives joined to bills.juris.ph on ≥ ${EXPECTED_DISTRICTS.min_matched} of 254 seats (${matched} joined; unmatched: ${unmatchedNames.join("; ") || "none"})`,
      matched >= EXPECTED_DISTRICTS.min_matched && D.representatives_source.matched === matched && D.representatives_source.unmatched === EXPECTED_DISTRICTS.districts - matched,
      `index says ${D.representatives_source.matched}/${D.representatives_source.unmatched}`);
    check("every resolved representative carries a member code and congress.gov.ph profile; ambiguous seats carry ≥ 2 candidates and choose none",
      resolved.every((r) => r.member_code && r.profile_url) && ambiguous.every((r) => (r.candidates?.length ?? 0) >= 2 && r.member_code == null && r.juris_id == null && r.portrait_url == null));
    const portraits = [...resolved, ...ambiguous.flatMap((r) => r.candidates ?? [])].filter((r) => r.portrait_url);
    check(`every portrait carries attribution and licence (${portraits.length} portraits)`, portraits.every((r) => r.portrait_attribution && r.portrait_license && r.portrait_url!.startsWith("https://juris-assets.bettergov.ph/")));
    if (PROBE_PORTRAITS && portraits[0]?.portrait_url) {
      // The portal is served with Cross-Origin-Embedder-Policy: require-corp, so cross-origin images need
      // Cross-Origin-Resource-Policy (or CORS). Reported, not asserted: the asset host is outside this tree.
      try {
        const res = await fetch(portraits[0].portrait_url, { method: "HEAD" });
        const corp = res.headers.get("cross-origin-resource-policy"), acao = res.headers.get("access-control-allow-origin");
        process.stdout.write(`  · portrait host probe: HTTP ${res.status}; Cross-Origin-Resource-Policy ${corp ?? "absent"}; Access-Control-Allow-Origin ${acao ?? "absent"} — ${corp || acao ? "embeddable under COEP require-corp" : "BLOCKED under this site's COEP require-corp until the host sends Cross-Origin-Resource-Policy: cross-origin"}\n`);
      } catch (e) {
        process.stdout.write(`  · portrait host probe failed: ${(e as Error).message}\n`);
      }
    }
    const jurisCache = resolve(OUT, "juris-authors.json");
    check("juris-authors.json cached with the fetched_at the index cites", existsSync(jurisCache) && readJson<{ fetched_at: string }>(jurisCache).fetched_at === D.representatives_source.fetched_at);
    check("representatives_source notice says no per-member page exists and names the directory URL", /no per-member page/i.test(D.representatives_source.notice) && D.representatives_source.url === "https://bills.juris.ph/api/authors" && D.representatives_source.congress === 20);
    check("scope notes separate the whole-department GAA/NEP basis from the project-only House bill figures, ≤ 25 words each", D.scope_notes.length >= 3 && D.scope_notes.some((s) => /whole department/i.test(s)) && D.scope_notes.some((s) => /named projects only/i.test(s)) && D.scope_notes.every((s) => words(s) <= 25),
      D.scope_notes.filter((s) => words(s) > 25).map((s) => `${words(s)} words: ${s}`).join("; "));
    const longNotes = offices.flatMap((o) => o.notes.filter((n) => words(n) > 25).map((n) => `${o.id}: ${n}`));
    check("office notes are plain sentences of at most 25 words", longNotes.length === 0, longNotes.slice(0, 3).join("; "));
    for (const r of D.residual) process.stdout.write(`  ${r.stage.padEnd(5)} FY${r.fy}: residual ${((1 - r.deo_php / r.total_php) * 100).toFixed(1)}% · unmatched ${peso(r.unmatched_php)}${r.unmatched_labels.length ? ` (${r.unmatched_labels.length} labels)` : ""}\n`);
  }

  if (D1_MODE === "local") await verifyD1(overview, c);

  c.closeSync(); db.closeSync();
  process.stdout.write(`\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ""}\n`);
  if (failures) process.exit(1);
}

// ---------------------------------------------------------------------------
// D1 layer (--d1=local): the hgab_* tables `npm run build:hgab-d1` writes
// ---------------------------------------------------------------------------

const EXPECTED_D1 = {
  tables: ["hgab_controls", "hgab_datasets", "hgab_dims", "hgab_districts", "hgab_documents", "hgab_meta", "hgab_offices", "hgab_projects", "hgab_reconciliation", "hgab_records", "hgab_regions", "hgab_residual"],
  indexes: ["hgab_districts_region", "hgab_projects_delta", "hgab_projects_group", "hgab_projects_house", "hgab_projects_office", "hgab_projects_region"],
  /** docs/hgab-api.md "Expected row counts"; hgab_dims is checked against the summaries instead. */
  rows: {
    hgab_meta: 1, hgab_datasets: 4, hgab_documents: 8, hgab_controls: 80, hgab_regions: 72, hgab_projects: 20_431, hgab_records: 20_431,
    hgab_reconciliation: 69, hgab_districts: 254, hgab_offices: 200, hgab_residual: 9,
  } as Record<string, number>,
  projects: { dpwh: 17_613, fmr: 1_059, hfep: 746, nia: 1_013 } as Record<DatasetKey, number>,
  controls: { dpwh: 46, fmr: 16, hfep: 12, nia: 6 } as Record<DatasetKey, number>,
  /** Unconfirmed matches (held = 1) sit inside house_only, as the pages count them: DPWH only. */
  held: { dpwh: { rows: 389, php: 10_517_119_000 }, fmr: { rows: 0, php: 0 }, hfep: { rows: 0, php: 0 }, nia: { rows: 0, php: 0 } } as Record<DatasetKey, { rows: number; php: number }>,
  pdfBase: "https://budget-assets.bettergov.ph/hgab/2027/pdf/",
  sampleRecordsPerDataset: 5,
};

type D1Row = Record<string, unknown>;

/** Run statements against the local D1 (one wrangler invocation) and return each statement's rows. */
function d1Local(statements: string[]): D1Row[][] {
  const sql = statements.map((s) => s.trim().replace(/;$/, "")).join(";\n");
  let out: string;
  try {
    out = execFileSync("npx", ["wrangler", "d1", "execute", "budget", "--local", "--json", "--command", sql],
      { encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    throw new Error(`wrangler d1 execute --local failed: ${(err.stdout || err.stderr || err.message).trim().slice(0, 600)}`, { cause: e });
  }
  const parsed = JSON.parse(out) as Array<{ results: D1Row[]; success: boolean }> | { error?: { text?: string } };
  if (!Array.isArray(parsed)) throw new Error(`wrangler d1 execute --local: ${JSON.stringify(parsed).slice(0, 600)}`);
  if (parsed.length !== statements.length || parsed.some((r) => !r.success)) throw new Error(`wrangler returned ${parsed.length} results for ${statements.length} statements`);
  return parsed.map((r) => r.results);
}

/** Contract constants the D1 rows must agree with, read from src/lib/hgab.ts. */
function contractD1(path: string): {
  regionOrder: string[]; regionLabels: Record<string, { short: string; name: string }>;
  traceGroups: Record<string, { group: string; held: boolean }>; plainTerms: Record<string, string>;
} {
  const src = readFileSync(path, "utf8");
  const block = (re: RegExp, what: string) => {
    const m = re.exec(src);
    if (!m) throw new Error(`${what} not found in ${path}`);
    return m[1];
  };
  const regionOrder = [...block(/export const REGION_ORDER[^=]*=\s*\[([\s\S]*?)\];/, "REGION_ORDER").matchAll(/'([A-Z-]+)'/g)].map((m) => m[1]);
  const regionLabels: Record<string, { short: string; name: string }> = {};
  for (const m of block(/export const REGION_LABELS[^=]*=\s*\{([\s\S]*?)\n\};/, "REGION_LABELS").matchAll(/^\s*'?([A-Z-]+)'?:\s*\{\s*short:\s*'([^']*)',\s*name:\s*'([^']*)'\s*\},?\s*$/gm)) {
    regionLabels[m[1]] = { short: m[2], name: m[3] };
  }
  const traceGroups: Record<string, { group: string; held: boolean }> = {};
  for (const m of block(/export const TRACE_LABELS[^=]*=\s*\{([\s\S]*?)\n\};/, "TRACE_LABELS").matchAll(/^\s*([a-z0-9_]+):\s*\{.*?\bgroup:\s*'([a-z_]+)'(?:,\s*held:\s*(true|false))?/gm)) {
    traceGroups[m[1]] = { group: m[2], held: m[3] === "true" };
  }
  const plainTerms: Record<string, string> = {};
  for (const m of block(/export const PLAIN_TERMS[^=]*=\s*\{([\s\S]*?)\n\};/, "PLAIN_TERMS").matchAll(/^\s*([a-z_]+):\s*\{\s*term:\s*'([^']*)'/gm)) plainTerms[m[1]] = m[2];
  return { regionOrder, regionLabels, traceGroups, plainTerms };
}

const normVal = (v: unknown) => (typeof v === "bigint" ? Number(v) : v === undefined ? null : v);
const shortVal = (v: unknown) => { const s = typeof v === "string" ? JSON.stringify(v) : String(normVal(v)); return s.length > 80 ? `${s.slice(0, 77)}…` : s; };
/** Fields of `expected` that differ in `actual` (=== after bigint → number). */
function rowDiff(actual: D1Row | undefined, expected: Record<string, unknown>): string[] {
  if (!actual) return ["row missing"];
  return Object.keys(expected).filter((k) => normVal(actual[k]) !== normVal(expected[k])).map((k) => `${k}: D1 ${shortVal(actual[k])} vs ${shortVal(expected[k])}`);
}
const json = (v: unknown) => JSON.stringify(v);
const jsonOrNull = (v: unknown) => (v == null ? null : JSON.stringify(v));
const firstFew = (xs: string[], n = 3) => (xs.length > n ? `${xs.slice(0, n).join("; ")} … (+${xs.length - n} more)` : xs.join("; "));

interface MapJson {
  dataset: DatasetKey; house_stage: string; points_note: string; placeable: boolean; note: string; points: Array<{ id: string; lon: number; lat: number }>;
  regions: Array<{ key: string; label: string; nep_php: number | null; house_php: number | null; delta_php: number | null; nep_rows: number; house_rows: number; source_labels: string[] }>;
  not_on_map: { label: string; nep_php: number | null; house_php: number | null; nep_rows: number; house_rows: number } | null;
}
interface SummaryD1 {
  controls: Array<{
    id: string; label: string; group: string | null; nep_php: number | null; hgab2_php: number | null; hgab3_php: number | null; api_php: number | null;
    delta_php: number | null; reading_delta_php: number | null; nep_page: number | null; house_pages: number[];
  }>;
  dims: Record<string, Array<{ label: string; nep_php: number; house_php: number; nep_records: number; house_records: number }>>;
  readings: ({ third_only: Array<{ id: string }> } & Record<string, unknown>) | null;
}
interface RawOverview {
  built_at: string; source_repo: string; source_commit: string; fiscal_year: number;
  datasets: Array<Meta & { label: string; short: string; agency: string }>;
  documents: Array<{ key: string; title: string; stage: string; reading: number | null; volume: string | null; pages: unknown; sha256: string; bytes: number; source_url: string | null; notes: string | null }>;
  reconciliation: Recon[];
}

async function verifyD1(overview: Overview, c: DuckDBConnection): Promise<void> {
  process.stdout.write("\nD1 (local): hgab_* tables from npm run build:hgab-d1\n");
  const t0 = performance.now();
  const raw = readJson<RawOverview>(resolve(OUT, "overview.json"));
  const summaries = Object.fromEntries(DATASETS.map((k) => [k, readJson<SummaryD1>(resolve(OUT, k, "summary.json"))])) as Record<DatasetKey, SummaryD1>;
  const maps = Object.fromEntries(DATASETS.map((k) => [k, readJson<MapJson>(resolve(OUT, k, "map.json"))])) as Record<DatasetKey, MapJson>;
  const D = readJson<DistrictIndex>(resolve(OUT, "districts.json"));
  const K = contractD1(CONTRACT);
  const reload = "run: npm run build:hgab-d1 && npx wrangler d1 execute budget --local --file=data/hgab/2027/d1-import.sql";

  let tables: string[];
  try {
    tables = d1Local([`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'hgab%' ORDER BY name`])[0].map((r) => String(r.name));
  } catch (e) {
    check("local D1 reachable", false, `${(e as Error).message}\n      ${reload}`);
    return;
  }
  check(`the 12 contract tables are loaded (${EXPECTED_D1.tables.length})`, tables.join(",") === EXPECTED_D1.tables.join(","), `${tables.join(", ") || "none"} — ${reload}`);
  if (EXPECTED_D1.tables.some((t) => !tables.includes(t))) return;

  const sumHouse = (stageCol: string) => `coalesce(sum(${stageCol}), 0)`;
  const [
    indexes, counts, perDataset, meta, datasets, documents, controls, dims, regions, recon,
    sums, bridge, traceRows, orphans, districts, offices, residual, residualChecks, badOfficeRefs,
  ] = d1Local([
    `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'hgab%' ORDER BY name`,
    `SELECT ${[...Object.keys(EXPECTED_D1.rows), "hgab_dims"].map((t) => `(SELECT count(*) FROM ${t}) AS ${t}`).join(", ")}`,
    `SELECT p.dataset, count(*) AS projects, (SELECT count(*) FROM hgab_records r WHERE r.dataset = p.dataset) AS records,
            (SELECT count(*) FROM hgab_controls x WHERE x.dataset = p.dataset) AS controls, count(p.lon) AS with_lonlat
       FROM hgab_projects p GROUP BY p.dataset ORDER BY p.dataset`,
    `SELECT * FROM hgab_meta`,
    `SELECT * FROM hgab_datasets ORDER BY sort`,
    `SELECT * FROM hgab_documents ORDER BY sort`,
    `SELECT * FROM hgab_controls ORDER BY dataset, sort`,
    `SELECT * FROM hgab_dims ORDER BY dataset, dim, sort`,
    `SELECT * FROM hgab_regions ORDER BY dataset, sort`,
    `SELECT * FROM hgab_reconciliation ORDER BY sort`,
    `SELECT dataset, ${sumHouse("nep_php")} AS nep, ${sumHouse("hgab2_php")} AS hgab2, ${sumHouse("hgab3_php")} AS hgab3, ${sumHouse("api_php")} AS api,
            count(nep_php) AS nep_n, count(hgab2_php) AS hgab2_n, count(hgab3_php) AS hgab3_n
       FROM hgab_projects GROUP BY dataset`,
    // The bridge, recomputed from the rows: every row in its TRACE_LABELS group, unconfirmed matches included, as the pages count them.
    `SELECT p.dataset, p.bridge_group, count(*) AS n,
            coalesce(sum(iif(d.house_stage = 'hgab3', p.hgab3_php, p.hgab2_php)), 0) AS house, coalesce(sum(p.nep_php), 0) AS nep,
            coalesce(sum(p.delta_php), 0) AS delta, coalesce(sum(p.held), 0) AS held_rows,
            coalesce(sum(iif(p.held = 1, iif(d.house_stage = 'hgab3', p.hgab3_php, p.hgab2_php), 0)), 0) AS held_php
       FROM hgab_projects p JOIN hgab_datasets d ON d.key = p.dataset GROUP BY p.dataset, p.bridge_group`,
    `SELECT dataset, trace, bridge_group, held, count(*) AS n FROM hgab_projects GROUP BY dataset, trace, bridge_group, held`,
    `SELECT (SELECT count(*) FROM hgab_records r WHERE NOT EXISTS (SELECT 1 FROM hgab_projects p WHERE p.dataset = r.dataset AND p.id = r.id)) AS records_without_project,
            (SELECT count(*) FROM hgab_projects p WHERE NOT EXISTS (SELECT 1 FROM hgab_records r WHERE r.dataset = p.dataset AND r.id = p.id)) AS projects_without_record`,
    `SELECT * FROM hgab_districts ORDER BY sort`,
    `SELECT * FROM hgab_offices`,
    `SELECT * FROM hgab_residual ORDER BY sort`,
    `SELECT r.fy, r.stage, r.total_php - (r.deo_php + r.central_office_php + r.regional_offices_php + r.unmatched_php) AS gap, r.deo_php,
            (SELECT coalesce(sum(json_extract(j.value, '$.php')), 0) FROM hgab_offices o, json_each(o.years_json) j
              WHERE json_extract(j.value, '$.fy') = r.fy AND json_extract(j.value, '$.stage') = r.stage) AS offices_php
       FROM hgab_residual r ORDER BY r.sort`,
    `SELECT d.id, j.value AS office_id FROM hgab_districts d, json_each(d.office_ids_json) j WHERE NOT EXISTS (SELECT 1 FROM hgab_offices o WHERE o.id = j.value)`,
  ]);

  // Shape and counts.
  check(`the 6 contract indexes exist`, EXPECTED_D1.indexes.every((i) => indexes.some((r) => r.name === i)), indexes.map((r) => String(r.name)).join(", "));
  const n = counts[0];
  const dimsExpected = DATASETS.reduce((a, k) => a + Object.values(summaries[k].dims).reduce((b, d) => b + d.length, 0), 0);
  const countBad = Object.entries(EXPECTED_D1.rows).filter(([t, want]) => num(n[t]) !== want).map(([t, want]) => `${t} ${n[t]} (contract ${want})`);
  check(`contract row counts: ${Object.entries(EXPECTED_D1.rows).map(([t, v]) => `${t.replace("hgab_", "")} ${v.toLocaleString("en-US")}`).join(", ")}`, countBad.length === 0, countBad.join("; "));
  check(`hgab_dims holds every summary dimension row (${dimsExpected})`, num(n.hgab_dims) === dimsExpected, `${n.hgab_dims}`);
  const perBad = DATASETS.filter((k) => {
    const r = perDataset.find((x) => x.dataset === k);
    return !r || num(r.projects) !== EXPECTED_D1.projects[k] || num(r.records) !== EXPECTED_D1.projects[k] || num(r.controls) !== EXPECTED_D1.controls[k];
  });
  check("projects, records and controls per dataset: 17,613/1,059/746/1,013 and 46/16/12/6", perBad.length === 0, perBad.map((k) => `${k}: ${JSON.stringify(perDataset.find((x) => x.dataset === k))}`).join("; "));
  check("every hgab_records row has a hgab_projects row and vice versa", num(orphans[0].records_without_project) === 0 && num(orphans[0].projects_without_record) === 0, JSON.stringify(orphans[0]));

  // hgab_meta.
  const m = meta[0];
  const terms = (() => { try { return JSON.parse(String(m?.terms_json)) as Record<string, { term: string; meaning: string }>; } catch { return null; } })();
  check("hgab_meta: fiscal year, built_at, source repo and commit equal overview.json",
    !!m && num(m.id) === 1 && num(m.fiscal_year) === raw.fiscal_year && m.built_at === raw.built_at && m.source_repo === raw.source_repo && m.source_commit === raw.source_commit,
    JSON.stringify(m ?? {}).slice(0, 300));
  check("hgab_meta.notice is the one-paragraph disclaimer (unofficial, candidates, no wrongdoing, printed amounts, link)",
    typeof m?.notice === "string" && !/\n/.test(m.notice) && /Independent and unofficial/.test(m.notice) && /not an official record/.test(m.notice)
    && /candidates/.test(m.notice) && /did anything wrong/.test(m.notice) && /not money spent/.test(m.notice) && m.notice.includes("https://budget.bettergov.ph/hgab/2027/methodology#disclaimer"),
    String(m?.notice ?? "").slice(0, 200));
  check(`hgab_meta.terms_json is PLAIN_TERMS (${Object.keys(K.plainTerms).length} terms, keys and terms as in the contract)`,
    !!terms && Object.keys(terms).join(",") === Object.keys(K.plainTerms).join(",") && Object.entries(K.plainTerms).every(([k, t]) => terms[k]?.term === t && !!terms[k]?.meaning),
    terms ? Object.keys(terms).join(",") : "unparseable");

  // hgab_datasets: overview entry + summary readings + map.json.
  for (const [i, d] of raw.datasets.entries()) {
    const s = summaries[d.key], mp = maps[d.key];
    const readings = s.readings ? json({ ...s.readings, third_only: s.readings.third_only.map((r) => r.id) }) : null;
    const diff = rowDiff(datasets[i], {
      key: d.key, sort: i, label: d.label, short: d.short, agency: d.agency, dept_id: d.dept_id, summary: d.summary, one_row: d.one_row,
      caveats_json: json(d.caveats), grain: d.grain, scope: d.scope, controls_label: d.controls_label,
      has_readings: d.has_readings ? 1 : 0, has_map: d.has_map ? 1 : 0, house_stage: d.bridge.house_stage,
      nep_php: d.totals.nep_php, hgab2_php: d.totals.hgab2_php, hgab3_php: d.totals.hgab3_php, api_php: d.totals.api_php,
      nep_count: d.counts.nep, hgab2_count: d.counts.hgab2, hgab3_count: d.counts.hgab3, api_count: d.counts.api,
      printed_json: jsonOrNull(d.printed), bridge_json: json(d.bridge), documents_json: json(d.documents), readings_json: readings,
      not_on_map_json: jsonOrNull(mp.not_on_map), map_note: mp.note, points_note: mp.points_note, placeable: mp.placeable ? 1 : 0,
    });
    check(`hgab_datasets ${d.key}: every column equals overview.json, the summary readings (third_only as ids) and map.json`, diff.length === 0, firstFew(diff));
  }

  // hgab_documents, hgab_reconciliation: row for row.
  const docBad = raw.documents.flatMap((d, i) => rowDiff(documents[i], {
    key: d.key, sort: i, title: d.title, stage: d.stage, reading: d.reading, volume: d.volume, pages_json: jsonOrNull(d.pages),
    sha256: d.sha256, bytes: d.bytes, source_url: d.source_url, notes: d.notes, pdf_url: `${EXPECTED_D1.pdfBase}${d.key}.pdf`,
  }).map((x) => `${d.key} ${x}`));
  check(`hgab_documents equal the registry, pdf_url on ${EXPECTED_D1.pdfBase}<key>.pdf`, docBad.length === 0, firstFew(docBad));
  const reconBad = raw.reconciliation.flatMap((r, i) => rowDiff(recon[i], {
    sort: i, dataset: r.dataset, check_name: r.check, ours_php: r.ours_php, theirs_php: r.theirs_php, diff_php: r.diff_php, status: r.status, note: r.note,
  }).map((x) => `#${i} ${x}`));
  check("hgab_reconciliation equals overview.json reconciliation, row for row", reconBad.length === 0, firstFew(reconBad));

  // hgab_controls, hgab_dims: row for row against the summaries.
  const ctlBad: string[] = [], dimBad: string[] = [];
  for (const k of DATASETS) {
    const mine = controls.filter((r) => r.dataset === k);
    summaries[k].controls.forEach((x, i) => ctlBad.push(...rowDiff(mine[i], {
      dataset: k, id: x.id, sort: i, label: x.label, grp: x.group, nep_php: x.nep_php, hgab2_php: x.hgab2_php, hgab3_php: x.hgab3_php, api_php: x.api_php,
      delta_php: x.delta_php, reading_delta_php: x.reading_delta_php, nep_page: x.nep_page, house_pages_json: json(x.house_pages ?? []),
    }).map((d) => `${k}/${String(x.id)} ${d}`)));
    for (const [dim, list] of Object.entries(summaries[k].dims)) {
      const got = dims.filter((r) => r.dataset === k && r.dim === dim);
      if (got.length !== list.length) dimBad.push(`${k}.${dim}: ${got.length} rows vs ${list.length}`);
      list.forEach((x, i) => dimBad.push(...rowDiff(got[i], {
        dataset: k, dim, sort: i, label: x.label, nep_php: x.nep_php, house_php: x.house_php, nep_records: x.nep_records, house_records: x.house_records,
      }).map((d) => `${k}.${dim}#${i} ${d}`)));
    }
  }
  check("hgab_controls equal summary.json controls, row for row", ctlBad.length === 0, firstFew(ctlBad));
  check("hgab_dims equal summary.json dims, row for row", dimBad.length === 0, firstFew(dimBad));

  // Stage totals over hgab_projects.
  for (const d of overview.datasets) {
    const s = sums.find((r) => r.dataset === d.key);
    check(`${d.key}: Σ nep_php / hgab2_php / hgab3_php${d.key === "dpwh" ? " / api_php" : ""} over hgab_projects equal overview totals (${peso(d.totals.nep_php)} / ${peso(d.totals.hgab2_php)} / ${peso(d.totals.hgab3_php)})`,
      !!s && num(s.nep) === d.totals.nep_php && num(s.hgab2) === (d.totals.hgab2_php ?? 0) && num(s.hgab3) === (d.totals.hgab3_php ?? 0) && num(s.api) === (d.totals.api_php ?? 0),
      JSON.stringify(s ?? {}));
  }

  // Bridge recomputed from hgab_projects (unconfirmed matches counted in house_only, exactly as the pages and the workbench do).
  for (const d of overview.datasets) {
    const b = JSON.parse(String(datasets.find((r) => r.key === d.key)?.bridge_json ?? "null")) as Bridge | null;
    const cell = (g: BridgeGroup) => {
      const r = bridge.find((x) => x.dataset === d.key && x.bridge_group === g);
      const rows = r ? num(r.n) : 0, house = r ? num(r.house) : 0, nep = r ? num(r.nep) : 0, delta = r ? num(r.delta) : 0;
      switch (g) {
        case "house_only": return { rows, php: house, nep_php: null, house_php: house };
        case "nep_only": return { rows, php: nep, nep_php: nep, house_php: null };
        case "unchanged": return { rows, php: house, nep_php: nep, house_php: house };
        case "increased": return { rows, php: delta, nep_php: nep, house_php: house };
        case "decreased": return { rows, php: -delta, nep_php: nep, house_php: house };
        case "scope_review": return { rows, php: delta, nep_php: nep, house_php: house };
      }
    };
    const bad = b ? GROUPS.flatMap((g) => {
      const want = cell(g), got = b[g];
      return (["rows", "php", "nep_php", "house_php"] as const).filter((f) => normVal(got[f]) !== normVal(want[f])).map((f) => `${g}.${f} stored ${got[f]} vs rows ${want[f]}`);
    }) : ["bridge_json unparseable"];
    const ungrouped = bridge.filter((x) => x.dataset === d.key && x.bridge_group == null).reduce((a, x) => a + num(x.n), 0);
    const houseAll = bridge.filter((x) => x.dataset === d.key).reduce((a, x) => a + num(x.house), 0), nepAll = bridge.filter((x) => x.dataset === d.key).reduce((a, x) => a + num(x.nep), 0);
    check(`${d.key}: bridge recomputed from hgab_projects (rows and pesos per group, unconfirmed included) equals hgab_datasets.bridge_json, net ${peso(d.bridge.net_php)}`,
      bad.length === 0 && ungrouped === 0 && !!b && b.net_php === houseAll - nepAll && JSON.stringify(b) === JSON.stringify(d.bridge),
      `${firstFew(bad)}${ungrouped ? `; ${ungrouped} rows without a group` : ""}${b && b.net_php !== houseAll - nepAll ? `; net ${b.net_php} vs ${houseAll - nepAll}` : ""}`);
    const held = bridge.filter((x) => x.dataset === d.key).reduce<{ rows: number; php: number }>((a, x) => ({ rows: a.rows + num(x.held_rows), php: a.php + num(x.held_php) }), { rows: 0, php: 0 });
    const heldOutside = bridge.filter((x) => x.dataset === d.key && x.bridge_group !== "house_only").reduce((a, x) => a + num(x.held_rows), 0);
    const E = EXPECTED_D1.held[d.key];
    const ho = d.bridge.house_only;
    check(`${d.key}: unconfirmed matches (held = 1) all sit in house_only: ${held.rows.toLocaleString("en-US")} rows, ${peso(held.php)}${held.rows ? ` (house_only without them: ${(ho.rows - held.rows).toLocaleString("en-US")} rows, ${peso(ho.php - held.php)})` : ""}`,
      held.rows === E.rows && held.php === E.php && heldOutside === 0, `expected ${E.rows} rows ${peso(E.php)}; ${heldOutside} held rows outside house_only`);
  }
  const traceBad = traceRows.filter((r) => {
    const t = K.traceGroups[String(r.trace)];
    return !t || r.bridge_group !== t.group || num(r.held) !== (t.held ? 1 : 0);
  }).map((r) => `${r.dataset} ${r.trace} → ${r.bridge_group}/${r.held}`);
  check(`bridge_group and held equal the contract's TRACE_LABELS for every trace (${new Set(traceRows.map((r) => r.trace)).size} traces)`, traceBad.length === 0, firstFew(traceBad));

  // Regions: 18 per dataset in REGION_ORDER, equal to map.json, and regions + not_on_map = totals.
  for (const d of overview.datasets) {
    const mp = maps[d.key];
    const got = regions.filter((r) => r.dataset === d.key);
    const bad = K.regionOrder.flatMap((k, i) => {
      const r = mp.regions.find((x) => x.key === k);
      return rowDiff(got[i], {
        dataset: d.key, region_key: k, sort: i, label: K.regionLabels[k]?.short, name: K.regionLabels[k]?.name,
        nep_php: r?.nep_php ?? null, house_php: r?.house_php ?? null, delta_php: r?.delta_php ?? null,
        nep_rows: r?.nep_rows ?? 0, house_rows: r?.house_rows ?? 0, source_labels_json: json(r?.source_labels ?? []),
      }).map((x) => `${k} ${x}`);
    });
    check(`${d.key}: hgab_regions holds the 18 keys in REGION_ORDER with REGION_LABELS names, equal to map.json${mp.regions.length ? "" : " (map.json lists none: all empty)"}`,
      got.length === K.regionOrder.length && bad.length === 0, `${got.length} rows; ${firstFew(bad)}`);
    const stage = d.bridge.house_stage;
    const nom = mp.not_on_map;
    const sNep = got.reduce((a, r) => a + num(r.nep_php ?? 0), 0) + (nom?.nep_php ?? 0);
    const sHouse = got.reduce((a, r) => a + num(r.house_php ?? 0), 0) + (nom?.house_php ?? 0);
    const rNep = got.reduce((a, r) => a + num(r.nep_rows), 0) + (nom?.nep_rows ?? 0);
    const rHouse = got.reduce((a, r) => a + num(r.house_rows), 0) + (nom?.house_rows ?? 0);
    check(`${d.key}: Σ hgab_regions + not_on_map = NEP ${peso(d.totals.nep_php)} and House ${peso(d.totals[`${stage}_php`])}, records ${d.counts.nep.toLocaleString("en-US")} / ${(d.counts[stage] ?? 0).toLocaleString("en-US")}`,
      sNep === d.totals.nep_php && sHouse === d.totals[`${stage}_php`] && rNep === d.counts.nep && rHouse === d.counts[stage],
      `${peso(sNep)} / ${peso(sHouse)}; records ${rNep} / ${rHouse}`);
  }

  // hgab_projects: every row, column for column, against the parquet; derived columns against map.json and the contract.
  const projRows = d1Local([`SELECT * FROM hgab_projects`])[0];
  const byKey = new Map(projRows.map((r) => [`${String(r.dataset)}\u0000${String(r.id)}`, r]));
  const cols = contractColumns(CONTRACT).filter((col) => col !== "record_json");
  for (const k of DATASETS) {
    const mp = maps[k];
    const points = new Map(mp.points.map((p) => [p.id, p]));
    const labelKey = new Map<string, string>();
    for (const r of mp.regions) for (const l of r.source_labels) labelKey.set(l, r.key);
    const pq = (await c.runAndReadAll(`SELECT ${cols.join(", ")} FROM read_parquet('${q(resolve(OUT, k, "projects.parquet"))}')`)).getRowObjects();
    const colBad: string[] = [], derivedBad: string[] = [];
    let missing = 0;
    for (const p of pq) {
      const got = byKey.get(`${k}\u0000${String(p.id)}`);
      if (!got) { missing++; continue; }
      colBad.push(...rowDiff(got, Object.fromEntries(cols.map((col) => [col, p[col]]))).map((x) => `${String(p.id)} ${x}`));
      const pt = points.get(String(p.id));
      const t = K.traceGroups[String(p.trace)];
      derivedBad.push(...rowDiff(got, {
        house_php: normVal(p.hgab3_php) ?? normVal(p.hgab2_php), bridge_group: t?.group ?? null, held: t?.held ? 1 : 0,
        lon: pt?.lon ?? null, lat: pt?.lat ?? null, region_key: p.region == null ? null : labelKey.get(String(p.region)) ?? null,
      }).map((x) => `${String(p.id)} ${x}`));
    }
    const lonlat = projRows.filter((r) => r.dataset === k && r.lon != null).length;
    check(`${k}: all ${pq.length.toLocaleString("en-US")} hgab_projects rows equal the parquet in every column (${cols.length} columns, record_json aside)`,
      missing === 0 && colBad.length === 0 && pq.length === projRows.filter((r) => r.dataset === k).length, `${missing} missing; ${firstFew(colBad)}`);
    check(`${k}: house_php = hgab3 ?? hgab2, bridge_group/held from TRACE_LABELS, region_key from map.json labels, lon/lat on the ${mp.points.length.toLocaleString("en-US")} printed points`,
      derivedBad.length === 0 && lonlat === mp.points.length, `${lonlat} rows with lon/lat; ${firstFew(derivedBad)}`);
  }

  // Districts, offices, residual.
  const distBad = D.districts.flatMap((d, i) => {
    const got = districts[i];
    const diff = rowDiff(got, {
      id: d.id, sort: i, label: d.label, jurisdiction: d.jurisdiction, district_label: d.district_label, region: d.region, attribution: d.attribution,
      rep_name: d.representative?.name ?? null, rep_status: d.representative?.status ?? null, rep_json: jsonOrNull(d.representative),
      office_ids_json: json(d.office_ids), co_served_json: json(d.co_served_district_ids),
      fy2026_gaa_php: d.headline.fy2026_gaa_php, fy2027_nep_php: d.headline.fy2027_nep_php, fy2027_hgab3_php: d.headline.fy2027_hgab3_php,
    });
    const st = String(got?.search_text ?? "");
    const names = [d.label, d.representative?.name, ...(d.representative?.candidates ?? []).map((x) => x.name), ...d.office_ids.map((o) => D.offices[o]?.name)];
    if (!names.every((x) => !x || st.includes(x.toLowerCase().replace(/\s+/g, " ").trim()))) diff.push("search_text misses the label, a representative or an office name");
    if (st !== st.toLowerCase()) diff.push("search_text not lower-cased");
    if (d.region && K.regionLabels[String(got?.region_key)]?.short !== d.region) diff.push(`region_key ${String(got?.region_key)} for ${d.region}`);
    return diff.map((x) => `${d.id} ${x}`);
  });
  check(`hgab_districts equal districts.json cards (${D.districts.length}); search_text carries label, representatives incl. candidates, office names`, distBad.length === 0, firstFew(distBad));
  const officeById = new Map(offices.map((r) => [String(r.id), r]));
  const offBad = Object.values(D.offices).flatMap((o) => {
    const got = officeById.get(o.id);
    const diff = rowDiff(got, {
      id: o.id, name: o.name, kind: o.kind, region: o.region, tier: o.tier, district_ids_json: json(o.district_ids), years_json: json(o.years),
      by_congress_json: json(o.by_congress), fy2027_json: jsonOrNull(o.fy2027), notes_json: json(o.notes), aliases_json: json(o.aliases_used),
    });
    if (o.region && K.regionLabels[String(got?.region_key)]?.short !== o.region) diff.push(`region_key ${String(got?.region_key)} for ${o.region}`);
    return diff.map((x) => `${o.id} ${x}`);
  });
  check(`hgab_offices equal districts.json offices (${Object.keys(D.offices).length})`, offBad.length === 0 && offices.length === Object.keys(D.offices).length, firstFew(offBad));
  check("every hgab_districts office id exists in hgab_offices", badOfficeRefs.length === 0, firstFew(badOfficeRefs.map((r) => `${r.id}→${r.office_id}`)));
  const resBad = D.residual.flatMap((r, i) => rowDiff(residual[i], {
    fy: r.fy, stage: r.stage, sort: i, total_php: r.total_php, deo_php: r.deo_php, central_office_php: r.central_office_php,
    regional_offices_php: r.regional_offices_php, unmatched_php: r.unmatched_php, unmatched_labels_json: json(r.unmatched_labels),
  }).map((x) => `${r.stage} ${r.fy} ${x}`));
  check(`hgab_residual equals districts.json residual (${D.residual.length} slots)`, resBad.length === 0, firstFew(resBad));
  const idBad = residualChecks.filter((r) => num(r.gap) !== 0 || num(r.offices_php) !== num(r.deo_php)).map((r) => `${r.stage} ${r.fy}: gap ${r.gap}, Σ offices ${r.offices_php} vs deo ${r.deo_php}`);
  check("residual identity in D1: deo + central + regional + unmatched = total, and Σ hgab_offices years php = deo_php, every slot", idBad.length === 0, firstFew(idBad));

  // record_json: 20 random rows (5 per dataset) byte-equal to the parquet, plus the longest, one with a quote and one with non-ASCII text.
  const P = (k: string) => `read_parquet('${q(resolve(OUT, k, "projects.parquet"))}')`;
  const picks = (await c.runAndReadAll(`
    SELECT * FROM (${DATASETS.map((k) => `(SELECT dataset, id, record_json, 'random' AS why FROM ${P(k)} ORDER BY random() LIMIT ${EXPECTED_D1.sampleRecordsPerDataset})`).join(" UNION ALL ")})
    UNION ALL (SELECT dataset, id, record_json, 'longest' FROM (${DATASETS.map((k) => `SELECT dataset, id, record_json FROM ${P(k)}`).join(" UNION ALL ")}) ORDER BY strlen(record_json) DESC LIMIT 1)
    UNION ALL (SELECT dataset, id, record_json, 'single quote' FROM (${DATASETS.map((k) => `SELECT dataset, id, record_json FROM ${P(k)}`).join(" UNION ALL ")}) WHERE contains(record_json, '''') ORDER BY id LIMIT 1)
    UNION ALL (SELECT dataset, id, record_json, 'non-ASCII' FROM (${DATASETS.map((k) => `SELECT dataset, id, record_json FROM ${P(k)}`).join(" UNION ALL ")}) WHERE strlen(record_json) <> length(record_json) ORDER BY id LIMIT 1)
  `)).getRowObjects().map((r) => ({ dataset: String(r.dataset), id: String(r.id), json: String(r.record_json), why: String(r.why) }));
  const fetched = d1Local([`SELECT dataset, id, record_json FROM hgab_records WHERE ${picks.map((p) => `(dataset = '${q(p.dataset)}' AND id = '${q(p.id)}')`).join(" OR ")}`])[0];
  const fetchedBy = new Map(fetched.map((r) => [`${String(r.dataset)}\u0000${String(r.id)}`, String(r.record_json)]));
  const recBad = picks.filter((p) => {
    const got = fetchedBy.get(`${p.dataset}\u0000${p.id}`);
    return got == null || !Buffer.from(got, "utf8").equals(Buffer.from(p.json, "utf8"));
  }).map((p) => `${p.dataset}/${p.id} (${p.why})`);
  const random = picks.filter((p) => p.why === "random").length;
  const extra = picks.filter((p) => p.why !== "random").map((p) => `${p.why} ${p.dataset}/${p.id}, ${Buffer.byteLength(p.json).toLocaleString("en-US")} bytes`);
  check(`record_json byte-equal to the parquet: ${random} random rows (${EXPECTED_D1.sampleRecordsPerDataset} per dataset) + ${extra.join("; ")}`,
    random === EXPECTED_D1.sampleRecordsPerDataset * DATASETS.length && recBad.length === 0, firstFew(recBad));
  process.stdout.write(`  · D1 checks ran in ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
