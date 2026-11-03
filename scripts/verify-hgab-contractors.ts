/**
 * `contractors/` (DPWH contractors, npm run build:hgab-contractors), for verify-hgab.ts. Recomputed on its own path
 * from DPWH's contract list (data/dpwh-contracts/contracts.parquet), the GAA links (gaa-2020-2026/links.parquet), the
 * GAA extract and the multi-purpose map's lines, not from the builder's memory. The shard hash is the page's own
 * (src/lib/hgab-contractors.ts), so a Python/TypeScript disagreement fails here.
 */
import type { DuckDBConnection } from "@duckdb/node-api";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AMOUNT_NOTE, CONTRACTOR_SHARDS, DPWH_LINK_NOTE, JV_NOTE, LINKED_YEARS, MATCH_NOTE, METHOD_LABELS, REVOKED_NOTE, decodeContractorIndex,
  decodeContracts, decodeMpbContracts, dpwhContractUrl, rankLineContractors, shardOf, type ContractorIndexFile, type ContractorShardFile, type ContractorSummary,
  type MpbContractsFile,
} from "../src/lib/hgab-contractors";
import { DISCLAIMER_CONTRACTORS } from "../src/lib/hgab-disclaimers";
import { decodeMpbLines, type MpbLinesFile } from "../src/lib/hgab-mpb-years";

type Check = (name: string, ok: boolean, detail?: string) => void;
interface Opts { out: string; gaa: string; contracts: string; words: (s: string) => number; readerCopyHits: (s: string) => string[] }

const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const q = (s: string) => s.replace(/'/g, "''");
const num = (v: unknown) => Number(v);

export async function verifyContractors(c: DuckDBConnection, check: Check, o: Opts): Promise<void> {
  process.stdout.write("\ncontractors/ (DPWH contractors)\n");
  const dir = resolve(o.out, "contractors");
  const shardFiles = Array.from({ length: CONTRACTOR_SHARDS }, (_, s) => resolve(dir, "c", `${String(s).padStart(2, "0")}.json`));
  const files = ["index.json", "summary.json", "mpb-links.json", "contractors.csv"].map((f) => resolve(dir, f));
  const parquet = resolve(o.contracts, "contracts.parquet");
  const links = resolve(o.contracts, "gaa-2020-2026", "links.parquet");
  const present = [...files, ...shardFiles, parquet, links].every((f) => existsSync(f));
  check(`index, summary, map links, CSV and ${CONTRACTOR_SHARDS} contract files present, with the contract list and links`, present, dir);
  if (!present) return;
  const S = readJson<ContractorSummary>(files[1]);
  const ix = decodeContractorIndex(readJson<ContractorIndexFile>(files[0]));
  const shards = shardFiles.map((f) => readJson<ContractorShardFile>(f));

  // 1. The files are the ones the summary describes.
  const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
  const outs = Object.entries(S.outputs);
  const badSha = outs.filter(([name, h]) => sha(resolve(dir, name)) !== h).map(([n]) => n);
  check(`summary.json: SHA-256 of all ${outs.length} outputs`, outs.length === 3 + CONTRACTOR_SHARDS && badSha.length === 0,
    `${outs.length} listed; differ: ${badSha.slice(0, 5).join(", ")}`);
  check("the builder's own checks all passed", Object.values(S.checks).every(Boolean), JSON.stringify(S.checks));
  check("index, contract files and summary are one build", shards.every((f) => f.built_at === S.built_at) && ix.builtAt === S.built_at);

  // 2. DPWH's list, counted again: every contract naming a contractor, and its amount.
  const [cnt, php] = (await c.runAndReadAll(`SELECT count(*), sum(budget) FROM read_parquet('${q(parquet)}') WHERE trim(coalesce(contractor, '')) <> ''`)).getRows()[0].map(num);
  check("contracts naming a contractor equal the list's", cnt === S.totals.contracts_with_contractor, `${cnt} vs ${S.totals.contracts_with_contractor}`);
  check("their amount equals the list's (to the peso)", Math.abs(php - S.totals.amount_php) < 1, `${php} vs ${S.totals.amount_php}`);
  const [all] = (await c.runAndReadAll(`SELECT count(*) FROM read_parquet('${q(parquet)}')`)).getRows()[0].map(num);
  check("the list is complete: as many contracts as the API reported", all === S.source.contracts && all === S.totals.contracts_with_contractor + S.totals.contracts_without_contractor);

  // 3. Each contractor sits in the file its key hashes to, and its index figures equal its contracts.
  const misplaced: string[] = [];
  const seen = new Map<string, number>();
  const officeOf = new Map<string, string>();
  let mismatch = 0;
  let linkPairs = 0;
  for (const f of shards) for (const key of Object.keys(f.contractors)) if (shardOf(key) !== f.shard) misplaced.push(key);
  check("every contractor is in the file its key hashes to (the page's hash equals the builder's)", misplaced.length === 0, misplaced.slice(0, 5).join(", "));
  const missing = ix.list.filter((x) => !shards[shardOf(x.key)].contractors[x.key]).map((x) => x.key);
  check(`all ${ix.list.length} contractors have their contracts`, missing.length === 0 && shards.reduce((a, f) => a + Object.keys(f.contractors).length, 0) === ix.list.length,
    missing.slice(0, 5).join(", "));
  for (const x of ix.list) {
    const rows = decodeContracts(shards[shardOf(x.key)], x.key, ix) ?? [];
    const sum = rows.reduce((a, r) => a + r.php, 0);
    const jv = rows.filter((r) => r.partners.length > 0);
    const lines = new Set(rows.flatMap((r) => r.lines.map((l) => l.id)));
    if (rows.length !== x.contracts || Math.abs(sum - x.php) > 1 || jv.length !== x.jvContracts || lines.size !== x.linkedLines
      || rows.filter((r) => r.lines.length).length !== x.linkedContracts || x.yearsN.reduce((a, n) => a + n, 0) > x.contracts) mismatch++;
    for (const r of rows) {
      seen.set(r.id, r.php);
      officeOf.set(r.id, r.office);
      if (r.partners.some((p) => !ix.byKey.has(p))) mismatch++;
      linkPairs += r.lines.length * (r.partners.length ? 0 : 1);
    }
  }
  check("each contractor's contracts, amount, joint ventures and budget lines equal its index row", mismatch === 0, `${mismatch} contractors differ`);
  check("every contract naming a contractor appears, once per contractor", seen.size === S.totals.contracts_with_contractor,
    `${seen.size} distinct contracts`);
  check("their amounts add up to the list's", Math.abs([...seen.values()].reduce((a, v) => a + v, 0) - S.totals.amount_php) < 1);

  // 4. Licenses DPWH's list marks "[REVOKED]".
  // The tag sits before the number ("NAME ([REVOKED] 12345)") or, once, before the name ("[REVOKED] NAME (12345)").
  const revoked = (await c.runAndReadAll(`SELECT DISTINCT regexp_extract(p, '((OECO_)?\\d+)\\)\\s*$', 1) FROM (
      SELECT unnest(string_split_regex(contractor, '\\s+/\\s+')) p FROM read_parquet('${q(parquet)}')) WHERE p LIKE '%[REVOKED]%'`)).getRows().map((r) => String(r[0])).sort();
  const flagged = ix.list.filter((x) => x.revoked).map((x) => x.key).sort();
  check("contractors marked revoked are exactly those DPWH's list tags [REVOKED]", JSON.stringify(revoked) === JSON.stringify(flagged), `${revoked.join(",")} vs ${flagged.join(",")}`);

  // 5. Budget lines: the links file, and each line's amount from the GAA extract.
  const extract = resolve(o.gaa, "full_extract.csv");
  // Sole contractor: one distinct license number (or name) among the parties, as the builder counts them.
  const [lk, lkContracts, lkSole] = (await c.runAndReadAll(`SELECT count(*), count(DISTINCT contract_id),
      count(*) FILTER (WHERE len(list_distinct(list_transform(string_split_regex(trim(contractor), '\\s+/\\s+'),
        p -> coalesce(nullif(regexp_extract(p, '((OECO_)?\\d+)\\)\\s*$', 1), ''), trim(p))))) = 1)
      FROM read_parquet('${q(links)}')`)).getRows()[0].map(num);
  const shardLinked = new Set<string>();
  for (const f of shards) for (const rows of Object.values(f.contractors)) for (const r of rows) if ((r[10] as unknown[]).length) shardLinked.add(String(r[0]));
  check("every linked contract shows its budget lines on its contractors' pages", shardLinked.size === lkContracts, `${shardLinked.size} vs ${lkContracts}`);
  check("sole-contractor contracts carry exactly the links file's lines", linkPairs === lkSole, `${linkPairs} vs ${lkSole}`);
  const [bad] = (await c.runAndReadAll(`WITH g AS (
      SELECT CAST(year AS INTEGER) fy, prexc_fpap_id pap, CAST(ROUND(SUM(CAST(amt AS DOUBLE)) * 1000) AS BIGINT) php
      FROM read_csv('${q(extract)}', all_varchar = true) WHERE uacs_exp_cd = '6' AND CAST(amt AS DOUBLE) > 0 GROUP BY 1, 2)
    SELECT count(*) FROM read_parquet('${q(links)}') l
    LEFT JOIN g ON g.fy = l.fiscal_year AND g.pap = split_part(l.line_id, ':', 3)
    -- a code split over two offices carries ':<office>' and its own share, so only its presence is checked
    WHERE g.php IS NULL OR (l.line_id NOT LIKE 'gaa:%:%:%' AND g.php <> l.gaa_php)`)).getRows()[0].map(num);
  check(`${lk.toLocaleString("en-US")} links: each budget line and its amount are the GAA extract's`, bad === 0, `${bad} differ`);
  const [lines] = (await c.runAndReadAll(`SELECT count(*) FROM (SELECT DISTINCT year, prexc_fpap_id, operunit FROM read_csv('${q(extract)}', all_varchar = true)
      WHERE uacs_exp_cd = '6' AND CAST(amt AS DOUBLE) > 0 AND CAST(year AS INTEGER) BETWEEN ${LINKED_YEARS[0]} AND ${LINKED_YEARS[1]})`)).getRows()[0].map(num);
  const counted = S.gaa_links.years.reduce((a, y) => a + y.lines, 0);
  check(`the match table counts every GAA capital-outlay line, ${LINKED_YEARS[0]}–${LINKED_YEARS[1]}`, counted === lines,
    `${counted} vs ${lines}`);
  check("each year's lines are one-to-one, in a cluster or unmatched, with nothing else",
    S.gaa_links.years.every((y) => y.one_to_one.lines + y.bundle.lines + y.none.lines === y.lines));

  // 6. The map's contracts: real map lines, FY2020–FY2026, each with a contract its contractors' pages list.
  const map = decodeMpbContracts(readJson<MpbContractsFile>(files[2]));
  const mpb = decodeMpbLines(readJson<MpbLinesFile>(resolve(o.out, "mpb-years", "lines.json")));
  const mpbIds = new Map(mpb.lines.map((l) => [l.id, l.fy]));
  const offMap = [...map.keys()].filter((id) => { const fy = mpbIds.get(id); return fy == null || fy < LINKED_YEARS[0] || fy > LINKED_YEARS[1]; });
  check(`map contracts: ${map.size.toLocaleString("en-US")} lines, each a FY${LINKED_YEARS[0]}–FY${LINKED_YEARS[1]} map line`, offMap.length === 0 && map.size === S.totals.map_lines_with_contract,
    offMap.slice(0, 3).join(", "));
  const notShown = [...map.values()].filter((v) => !seen.has(v.contractId) || v.contractors.some((x) => !ix.byKey.has(x.key))).length;
  check("each map contract and its contractors exist in the contractor files", notShown === 0, `${notShown} missing`);
  const wrongOffice = [...map.values()].filter((v) => v.office !== (officeOf.get(v.contractId) || null)).length;
  check("each map contract carries the office that awarded it, as the contract list has it", wrongOffice === 0, `${wrongOffice} differ`);
  // The map's "Top contractors" over every line: each contracted line counted once per contractor on its contract.
  const top = rankLineContractors(mpb.lines, map);
  const perLine = [...map.values()].reduce((a, v) => a + v.contractors.length, 0);
  check(`top contractors over every map line: ${top.rows.length.toLocaleString("en-US")} contractors, each contracted line once per contractor`,
    top.eligible === S.totals.map_lines_fy2020_2026 && top.withContract === map.size
      && top.rows.reduce((a, r) => a + r.lines, 0) === perLine && top.rows.every((r) => r.contracts <= r.lines && r.jvLines <= r.lines),
    `eligible ${top.eligible}, with a contract ${top.withContract}, lines ${top.rows.reduce((a, r) => a + r.lines, 0)} vs ${perLine}`);

  // 7. The CSV and the copy.
  const csv = readFileSync(files[3], "utf8").replace(/^\uFEFF/, "").trimEnd().split("\n");
  check("contractors.csv: a header and one row per contractor", csv.length === ix.list.length + 1 && csv[0].startsWith("contractor,license_id,"), `${csv.length - 1} rows`);
  const copy = [AMOUNT_NOTE, DPWH_LINK_NOTE, JV_NOTE, MATCH_NOTE, REVOKED_NOTE, ...Object.values(METHOD_LABELS)];
  const long = copy.flatMap((t) => t.split(/(?<=[.!?])\s+/)).filter((s) => o.words(s) > 20);
  check("contractor notes: sentences of at most 20 words", long.length === 0, long.join(" | "));
  const hits = [...copy, DISCLAIMER_CONTRACTORS.body].flatMap(o.readerCopyHits);
  check("contractor notes and disclaimer use no banned words", hits.length === 0, hits.join(", "));
  // Contract IDs open DPWH's own record (Jason's example: https://transparency.dpwh.gov.ph/?project=24CN0169).
  const ids = [...seen.keys()];
  check("contract IDs link to DPWH's transparency portal, one page per contract",
    dpwhContractUrl("24CN0169") === "https://transparency.dpwh.gov.ph/?project=24CN0169" && ids.every((id) => /^[A-Za-z0-9-]+$/.test(id)),
    ids.filter((id) => !/^[A-Za-z0-9-]+$/.test(id)).slice(0, 5).join(", "));
  check("the disclaimer says links are our match, and amounts are not payments",
    /our match/i.test(DISCLAIMER_CONTRACTORS.body) && /not payments/i.test(DISCLAIMER_CONTRACTORS.body) && /does not establish/i.test(DISCLAIMER_CONTRACTORS.body));
}
