/**
 * verify:hgab — the foreign-assisted projects file (fap.json + fap.csv, `npm run build:hgab-fap`), recomputed on the
 * verifier's own path: the NEP extract's foreign-assisted total, the DPWH project comparison, the enacted budgets,
 * the projects' parts, DBM's BESF series (every cell's parts add up; the program figures equal the extracts), the
 * unprogrammed figures, and the reader-facing strings.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";
import {
  BESF_EDITIONS, FAP_CSV_COLUMNS, FAP_DEPT_SERIES, FAP_SCHEMA, FAP_SERIES, UNPROGRAMMED, UNPROGRAMMED_RELEASES_2025_PHP, fapStatus,
  sumParts, type FapData,
} from "../src/lib/hgab-fap";

type Check = (name: string, ok: boolean, detail?: string) => void;
interface Opts { out: string; data: string; words: (s: string) => number; readerCopyHits: (s: string) => string[] }

const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const num = (v: unknown) => (v == null ? 0 : typeof v === "bigint" ? Number(v) : Number(v));
const peso = (n: number | null | undefined) => (n == null ? "—" : `₱${n.toLocaleString("en-US")}`);
const FOREIGN = (field: string) => `(substr(${field}, 7, 1) = '3')`;

export async function verifyFap(c: DuckDBConnection, check: Check, o: Opts): Promise<void> {
  process.stdout.write("\nfap.json + fap.csv (Foreign-assisted projects)\n");
  const jsonPath = resolve(o.out, "fap.json");
  const csvPath = resolve(o.out, "fap.csv");
  check("fap.json and fap.csv present (npm run build:hgab-fap)", existsSync(jsonPath) && existsSync(csvPath), `${jsonPath} / ${csvPath}`);
  if (!existsSync(jsonPath) || !existsSync(csvPath)) return;
  const D = readJson<FapData>(jsonPath);
  check("fap.json schema", D.schema === FAP_SCHEMA, String(D.schema));

  // The projects add up, part by part, and their statuses follow the amounts.
  const sum = (f: (p: FapData["projects"][number]) => number) => D.projects.reduce((a, p) => a + f(p), 0);
  check("projects' NEP side = totals.all.nep_php = totals.nep_extract_php", sum((p) => p.nep_php ?? 0) === D.totals.all.nep_php && D.totals.all.nep_php === D.totals.nep_extract_php, peso(D.totals.all.nep_php));
  check("projects' House side = totals.all.house_php", sum((p) => p.house_php ?? 0) === D.totals.all.house_php, peso(D.totals.all.house_php));
  check("loan + counterpart = total, both sides, every project",
    D.projects.every((p) => p.loan_nep_php + p.gop_nep_php === (p.nep_php ?? 0) && p.loan_house_php + p.gop_house_php === (p.house_php ?? 0))
      && D.totals.loan.nep_php + D.totals.gop.nep_php === D.totals.all.nep_php && D.totals.loan.house_php + D.totals.gop.house_php === D.totals.all.house_php);
  check("every status follows its amounts; change = House − NEP", D.projects.every((p) => p.status === fapStatus(p.nep_php, p.house_php) && p.change_php === (p.house_php ?? 0) - (p.nep_php ?? 0)));
  check("status counts", D.totals.cut === D.projects.filter((p) => p.status === "cut").length && D.totals.new === D.projects.filter((p) => p.status === "new").length
    && D.totals.same === D.projects.filter((p) => p.status === "same").length && D.totals.raised === D.projects.filter((p) => p.status === "raised").length && D.totals.projects === D.projects.length,
    `${D.totals.projects} projects: ${D.totals.cut} cut, ${D.totals.raised} raised, ${D.totals.new} new, ${D.totals.same} same`);
  check("departments add up to the projects", D.departments.every((d) => {
    const ps = D.projects.filter((p) => p.dept_code === d.dept_code && p.department === d.department);
    return ps.length === d.projects && ps.reduce((a, p) => a + (p.nep_php ?? 0), 0) === d.nep_php && ps.reduce((a, p) => a + (p.house_php ?? 0), 0) === d.house_php;
  }) && D.departments.reduce((a, d) => a + d.projects, 0) === D.projects.length);
  check("lenders add up to the NEP total", D.lenders.reduce((a, l) => a + l.nep_php, 0) === D.totals.all.nep_php, D.lenders.map((l) => `${l.name} ${peso(l.nep_php)}`).join("; "));
  check("every project names a lender, a department and a page", D.projects.every((p) => p.lenders.length > 0 && p.dept_short && p.pdf_page > 0 && p.volume));
  check("every DPWH line links to a record", D.projects.filter((p) => p.dept_code === "18").every((p) => p.dpwh_id));
  check("at most one project matched to the NEP by name", D.projects.filter((p) => p.nep_match === "name").length <= 1);

  // Recomputed from the sources.
  const nepGlob = resolve(o.data, "2027/*/line_items.parquet");
  const nepTotal = num((await c.runAndReadAll(`SELECT SUM(amount) FROM read_parquet('${nepGlob}', union_by_name = true) WHERE fy = 2027 AND ${FOREIGN("fpap_code")} AND fund_code LIKE '101%'`)).getRows()[0][0]);
  check("NEP extract: every line with the foreign-assisted mark, new appropriations", nepTotal === D.totals.nep_extract_php, `${peso(nepTotal)} vs ${peso(D.totals.nep_extract_php)}`);
  const dpwhPath = resolve(o.out, "dpwh/projects.parquet");
  const dpwh = (await c.runAndReadAll(`SELECT COUNT(*), SUM(nep_php), SUM(hgab3_php) FROM read_parquet('${dpwhPath}') WHERE zone = 'fap'`)).getRows()[0];
  const dpwhDept = D.departments.find((d) => d.dept_code === "18");
  check("DPWH: the project comparison's foreign-assisted lines equal the DPWH rows", num(dpwh[0]) === D.totals.dpwh_workbench.lines && num(dpwh[1]) === dpwhDept?.nep_php && num(dpwh[2]) === dpwhDept?.house_php,
    `${num(dpwh[0])} lines, ${peso(num(dpwh[1]))} → ${peso(num(dpwh[2]))}`);
  const linesPath = resolve(o.out, "explorer/downloads/house-bill-2027-lines-vs-nep.parquet");
  const bill = (await c.runAndReadAll(`SELECT SUM(nep_php), SUM(house_bill_php) FROM read_parquet('${linesPath}') WHERE project_kind ILIKE 'Foreign%'`)).getRows()[0];
  const byName = D.projects.filter((p) => p.nep_match === "name").reduce((a, p) => a + (p.nep_php ?? 0), 0);
  check("line-by-line dataset: its foreign-assisted rows are the projects (plus the one NEP line matched by name)",
    num(bill[0]) + byName === D.totals.all.nep_php && num(bill[1]) === D.totals.all.house_php, `${peso(num(bill[0]))} + ${peso(byName)} → ${peso(num(bill[1]))}`);
  for (const y of D.gaa) {
    const p = resolve(o.data, `gaa-history/parquet/gaa-${y.fy}.parquet`);
    const r = (await c.runAndReadAll(`SELECT SUM(amount), COUNT(DISTINCT department_id || ':' || fpap_code) FROM read_parquet('${p}') WHERE fy = ${y.fy} AND ${FOREIGN("fpap_code")} AND amount > 0`)).getRows()[0];
    check(`FY${y.fy} GAA: foreign-assisted lines recomputed`, num(r[0]) === y.php && num(r[1]) === y.lines && y.by_dept.reduce((a, d) => a + d.php, 0) === y.php, `${peso(y.php)} on ${y.lines} lines`);
  }

  // DBM's series: parts add up; the program figures equal the extracts (FY2022 excepted, as adjusted vs as enacted).
  check("BESF series: gop + loan + grant = total in every cell", FAP_SERIES.every((y) => [y.proposed, y.program, y.actual].every((p) => !p || sumParts(p) === p.total)));
  check("BESF series: every cell names an edition that exists", FAP_SERIES.every((y) => [y.proposed, y.program, y.actual].every((p) => !p || BESF_EDITIONS.some((e) => e.fy === p.besf))));
  check("BESF series: the FY2027 proposed figure is the NEP extract", FAP_SERIES.find((y) => y.fy === 2027)!.proposed!.total === D.totals.nep_extract_php);
  const programOff = D.gaa.filter((y) => y.fy !== 2022).filter((y) => FAP_SERIES.find((s) => s.fy === y.fy)?.program?.total !== y.php);
  check("BESF series: the program figures equal the GAA extracts (FY2020, FY2021, FY2023–FY2026)", programOff.length === 0, programOff.map((y) => `FY${y.fy}`).join(", "));
  check("BESF department rows never exceed the year's total", (Object.keys(FAP_DEPT_SERIES) as (keyof typeof FAP_DEPT_SERIES)[]).every((k) => FAP_DEPT_SERIES[k].every((d) => {
    const y = FAP_SERIES.find((s) => s.fy === d.fy);
    return !!y && (["proposed", "program", "actual"] as const).every((st) => d[st] == null || (y[st] != null && d[st]! <= y[st]!.total));
  })));
  const dpwh2027 = FAP_DEPT_SERIES.dpwh.find((d) => d.fy === 2027)!.proposed;
  const dotr2027 = FAP_DEPT_SERIES.dotr.find((d) => d.fy === 2027)!.proposed;
  check("BESF FY2027 proposed for DPWH and DOTr equal the NEP sides here", dpwh2027 === dpwhDept?.nep_php && dotr2027 === D.departments.find((d) => d.dept_code === "38")?.nep_php);
  check("FY2026 program for DPWH and DOTr equal the FY2026 GAA extract by department",
    FAP_DEPT_SERIES.dpwh.find((d) => d.fy === 2026)!.program === D.gaa.find((y) => y.fy === 2026)!.by_dept.find((d) => d.dept_code === "18")?.php
      && FAP_DEPT_SERIES.dotr.find((d) => d.fy === 2026)!.program === D.gaa.find((y) => y.fy === 2026)!.by_dept.find((d) => d.dept_code === "38")?.php);

  // Unprogrammed figures: the parts add up, the two documents agree.
  check("unprogrammed: FY2027 support = MOOE + capital outlays, the same in the NEP and the House bill",
    UNPROGRAMMED.support_2027.mooe_php + UNPROGRAMMED.support_2027.co_php === UNPROGRAMMED.support.find((s) => s.fy === 2027)!.php);
  check("unprogrammed: FY2025 releases add up by agency", UNPROGRAMMED_RELEASES_2025_PHP === 110_359_495_000, peso(UNPROGRAMMED_RELEASES_2025_PHP));
  check("unprogrammed: the FY2027 total is the bill's and the NEP's ₱111,984,494,000", UNPROGRAMMED.totals.find((t) => t.fy === 2027)!.php === 111_984_494_000);

  // The CSV: one row per project, the contract's columns, exact pesos.
  const csv = readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "").split("\n").filter(Boolean);
  check("fap.csv: header is the contract's columns; one row per project", csv[0] === FAP_CSV_COLUMNS.join(",") && csv.length === D.projects.length + 1, `${csv.length - 1} rows`);

  // Reader-facing strings.
  const copy = [...D.checks.map((x) => x.label), ...D.sources.map((s) => s.label)];
  const hits = copy.flatMap((s) => o.readerCopyHits(s));
  check("reader-facing strings carry no codes or pipeline words", hits.length === 0, hits.slice(0, 5).join("; "));
}
