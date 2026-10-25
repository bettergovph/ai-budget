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
 *   npm run verify:hgab
 *   npm run verify:hgab -- --out=data/hgab/2027 --src=/tmp/dpwh-nep-review/repo --no-pdf
 *
 * Exit code is non-zero if any check fails. `--src` is optional: without the
 * workbench checkout the main_overview comparison is skipped and reported.
 * `--gaa=data/18` points at the GAA tree whose yearly_totals.json the
 * districts residual must reproduce (skipped and reported when absent).
 */

import { DuckDBInstance } from "@duckdb/node-api";
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

  c.closeSync(); db.closeSync();
  process.stdout.write(`\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ""}\n`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
