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
 *   - the reconciliation against our FY2027 NEP tree has no mismatch.
 *
 *   npm run verify:hgab
 *   npm run verify:hgab -- --out=data/hgab/2027 --src=/tmp/dpwh-nep-review/repo --no-pdf
 *
 * Exit code is non-zero if any check fails. `--src` is optional: without the
 * workbench checkout the main_overview comparison is skipped and reported.
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
const CHECK_PDF = !argv.includes("--no-pdf");
const FULL_HASH = argv.includes("--hash-pdfs");

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
  key: DatasetKey; dept_id: string; grain: string; scope: string; has_readings: boolean; has_map: boolean; controls_label: string;
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
interface MainWorkspace {
  key: string; delta_php: number;
  insertions: { count: number; comparison_rows?: number; amount_php: number }; deletions: { count: number; comparison_rows?: number; amount_php: number };
  unchanged: { count: number; comparison_rows?: number; amount_php: number };
  adjustments: { increased_count: number; reduced_count: number; increased_php: number; reduced_php: number }; scope_review?: { count: number; net_php: number };
}

let checks = 0, failures = 0;
const peso = (n: number | null | undefined) => (n == null ? "—" : `₱${n.toLocaleString("en-US")}`);
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
  check("readings only on DPWH, map flag only on FMR", overview.datasets.every((d) => d.has_readings === (d.key === "dpwh") && d.has_map === (d.key === "fmr")));
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
  check("DPWH new appropriations reconcile exactly to ₱642,612,015,000", pick("dpwh", "DPWH new appropriations")?.status === "exact" && pick("dpwh", "DPWH new appropriations")?.theirs_php === EXPECTED.dpwh.printed_nep);
  check("capital outlays and the six operations programs are exact", pick("dpwh", "Capital outlays")?.status === "exact" && R.filter((r) => r.dataset === "dpwh" && r.check.startsWith("Program:")).length === 6 && R.filter((r) => r.dataset === "dpwh" && r.check.startsWith("Program:")).every((r) => r.status === "exact"));
  check("45 printed PAP controls each exact or explained", R.filter((r) => r.dataset === "dpwh" && r.check.startsWith("PAP:")).length === 45 && R.filter((r) => r.check.startsWith("PAP:")).every((r) => r.status === "exact" || r.status === "explained"));
  check("FMR activity, HFEP capital outlays and the six NIA sub-programs are exact", pick("fmr", "DA activity")?.status === "exact" && pick("hfep", "DOH activity 350202100002000, capital")?.status === "exact"
    && R.filter((r) => r.dataset === "nia" && r.check.startsWith("NIA sub-program")).length === 6 && R.filter((r) => r.dataset === "nia").every((r) => r.status === "exact"));
  const t = { exact: 0, explained: 0, mismatch: 0, info: 0 } as Record<string, number>;
  for (const r of R) t[r.status] = (t[r.status] ?? 0) + 1;
  process.stdout.write(`  ${t.exact} exact · ${t.explained} explained · ${t.info} info · ${t.mismatch} mismatch\n`);

  c.closeSync(); db.closeSync();
  process.stdout.write(`\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ""}\n`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
