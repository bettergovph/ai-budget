/**
 * npm run build:hgab-fap — foreign-assisted projects in the FY2027 House bill against the NEP, with the enacted
 * budgets since FY2020, for `/hgab/2027/foreign-assisted`.
 *
 * Reads
 *   data/hgab/2027/explorer/downloads/house-bill-2027-lines-vs-nep.parquet   every House bill line against the NEP
 *   data/hgab/2027/explorer/index.json                                       the explorer's department ids
 *   data/2027/<dept>/line_items.parquet                                      FY2027 NEP (fy = 2027), funds per line
 *   data/hgab/2027/dpwh/projects.parquet                                     the DPWH project comparison (zone = fap)
 *   data/gaa-history/parquet/gaa-<fy>.parquet                                FY2020–FY2026 enacted budgets, pesos
 * Writes
 *   data/hgab/2027/fap.json   FapData (contract: src/lib/hgab-fap.ts)
 *   data/hgab/2027/fap.csv    one row per project, UTF-8 with BOM
 *
 * The build fails unless every reconciliation in `checks` holds; verify:hgab recomputes them.
 */
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEPT_SHORT, FAP_CSV_COLUMNS, FAP_SCHEMA, FAP_SERIES, LENDER_SHORT, fapStatus,
  type FapData, type FapDepartment, type FapGaaYear, type FapLender, type FapProject, type FapSide,
} from "../src/lib/hgab-fap";

interface Args { out: string; data: string }
function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  return { out: resolve(get("out") ?? "data/hgab/2027"), data: resolve(get("data") ?? "data") };
}

const log = (s: string) => process.stdout.write(`${s}\n`);
const num = (v: unknown) => (v == null ? 0 : typeof v === "bigint" ? Number(v) : Number(v));
const opt = (v: unknown) => (v == null ? null : num(v));
const str = (v: unknown) => (v == null ? "" : String(v));
const peso = (n: number | null | undefined) => (n == null ? "—" : `₱${n.toLocaleString("en-US")}`);
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`build-hgab-fap: ${msg}`);
}
/** Letters and digits only, for matching names across documents. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
const GAA_YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
/** The UACS mark for a foreign-assisted project: the seventh digit of the P/A/P code is 3 (DOTr and CSC carry some under Support to Operations). */
const FOREIGN = (field: string) => `(substr(${field}, 7, 1) = '3')`;

async function rows(c: DuckDBConnection, sql: string): Promise<unknown[][]> {
  return (await c.runAndReadAll(sql)).getRows() as unknown[][];
}

async function main(): Promise<void> {
  const args = parseArgs();
  const builtAt = new Date().toISOString();
  const linesPath = resolve(args.out, "explorer/downloads/house-bill-2027-lines-vs-nep.parquet");
  const indexPath = resolve(args.out, "explorer/index.json");
  const dpwhPath = resolve(args.out, "dpwh/projects.parquet");
  for (const p of [linesPath, indexPath, dpwhPath]) ensure(existsSync(p), `${p} not found`);
  const nepGlob = resolve(args.data, "2027/*/line_items.parquet");
  const gaaPaths = GAA_YEARS.map((fy) => resolve(args.data, `gaa-history/parquet/gaa-${fy}.parquet`));
  for (const p of gaaPaths) ensure(existsSync(p), `${p} not found`);

  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  const checks: FapData["checks"] = [];
  const check = (key: string, label: string, detail: string) => checks.push({ key, label, ok: true, detail });

  // -------------------------------------------------------------------------
  // The explorer's department ids, by the House bill's department name
  // -------------------------------------------------------------------------
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as { departments: { id: string; name: string }[] };
  const slugByName = new Map(index.departments.map((d) => [fold(d.name), d.id]));

  // -------------------------------------------------------------------------
  // FY2027: every foreign-assisted line of the House bill against the NEP, one row per project (activity)
  // -------------------------------------------------------------------------
  await c.run(`CREATE VIEW lines AS SELECT * FROM read_parquet('${linesPath}')`);
  const lineRows = await rows(c, `
    SELECT nep_department_code, department, agency, activity,
      SUM(nep_php) AS nep, SUM(house_bill_php) AS house,
      SUM(CASE WHEN fund_source = 'Loan Proceeds' THEN nep_php ELSE 0 END) AS loan_nep,
      SUM(CASE WHEN fund_source = 'Loan Proceeds' THEN house_bill_php ELSE 0 END) AS loan_house,
      SUM(CASE WHEN fund_source = 'GOP Counterpart' THEN nep_php ELSE 0 END) AS gop_nep,
      SUM(CASE WHEN fund_source = 'GOP Counterpart' THEN house_bill_php ELSE 0 END) AS gop_house,
      SUM(CASE WHEN fund_source IS NULL THEN COALESCE(nep_php, 0) + COALESCE(house_bill_php, 0) ELSE 0 END) AS unsplit,
      list_distinct(list(nep_prexc_fpap_id) FILTER (WHERE nep_prexc_fpap_id IS NOT NULL)) AS codes,
      min(volume) AS volume, min(pdf_page) AS pdf_page, count(*) AS n
    FROM lines WHERE project_kind ILIKE 'Foreign%'
    GROUP BY 1, 2, 3, 4 ORDER BY 1, 4`);
  ensure(lineRows.length > 0, "no foreign-assisted lines in the line-by-line dataset");
  const unsplit = lineRows.reduce((a, r) => a + num(r[10]), 0);
  ensure(unsplit === 0, `foreign-assisted rows without a loan/counterpart part: ${peso(unsplit)}`);

  // The NEP's funds per line (lender), and its own foreign-assisted total
  const nepFund = await rows(c, `
    SELECT department_id, fpap_code, fund_dsc, SUM(amount) FROM read_parquet('${nepGlob}', union_by_name = true)
    WHERE fy = 2027 AND ${FOREIGN("fpap_code")} AND fund_code LIKE '101%' AND amount > 0
    GROUP BY 1, 2, 3 ORDER BY 1, 2, 4 DESC`);
  const fundsByCode = new Map<string, { fund: string; php: number }[]>();
  for (const r of nepFund) {
    const key = `${str(r[0])}:${str(r[1])}`;
    const list = fundsByCode.get(key) ?? [];
    list.push({ fund: str(r[2]), php: num(r[3]) });
    fundsByCode.set(key, list);
  }
  const nepLines = await rows(c, `
    SELECT department_id, fpap_code, max(fpap_dsc), SUM(amount) FROM read_parquet('${nepGlob}', union_by_name = true)
    WHERE fy = 2027 AND ${FOREIGN("fpap_code")} AND fund_code LIKE '101%' GROUP BY 1, 2 HAVING SUM(amount) > 0`);
  const nepExtractPhp = nepLines.reduce((a, r) => a + num(r[3]), 0);
  const nepByName = new Map<string, { dept: string; code: string; php: number }>();
  for (const r of nepLines) nepByName.set(`${str(r[0])}:${fold(str(r[2]))}`, { dept: str(r[0]), code: str(r[1]), php: num(r[3]) });
  const nepCodesUsed = new Set<string>();

  // DPWH records, for the links into the project comparison
  const dpwhRows = await rows(c, `SELECT id, title, nep_php, hgab3_php FROM read_parquet('${dpwhPath}') WHERE zone = 'fap'`);
  const dpwhByTitle = new Map(dpwhRows.map((r) => [fold(str(r[1])), str(r[0])]));
  // The two documents word some titles differently ("4432 - PHI" / "4432-PHI", a dropped loan number): a line the name
  // does not find is taken by its pair of amounts when exactly one record carries that pair.
  const dpwhByAmounts = new Map<string, string[]>();
  for (const r of dpwhRows) {
    const key = `${num(r[2])}:${num(r[3])}`;
    dpwhByAmounts.set(key, [...(dpwhByAmounts.get(key) ?? []), str(r[0])]);
  }
  const dpwhRecord = (title: string, nep: number | null, house: number | null): string | null => {
    const byName = dpwhByTitle.get(fold(title));
    if (byName) return byName;
    const ids = dpwhByAmounts.get(`${nep ?? 0}:${house ?? 0}`) ?? [];
    return ids.length === 1 ? ids[0] : null;
  };
  const dpwhWorkbench: FapSide & { lines: number } = {
    nep_php: dpwhRows.reduce((a, r) => a + num(r[2]), 0),
    house_php: dpwhRows.reduce((a, r) => a + num(r[3]), 0),
    lines: dpwhRows.length,
  };

  const projects: FapProject[] = [];
  const counters = new Map<string, number>();
  let byName = 0;
  for (const r of lineRows) {
    const department = str(r[1]);
    const title = str(r[3]).replace(/\s+/g, " ").trim();
    const deptCode = str(r[0]);
    // DuckDB's node API hands a LIST back as a value object with `items`.
    const rawCodes = r[11] as { items?: unknown[] } | unknown[] | null;
    let codes = (Array.isArray(rawCodes) ? rawCodes : (rawCodes?.items ?? [])).map(str).sort();
    let nep = opt(r[4]);
    let gopNep = num(r[8]);
    let loanNep = num(r[6]);
    let nepMatch: FapProject["nep_match"] = nep == null ? null : "line";
    // A House line the line-by-line match left without an NEP side (null, or a listed zero): the DBM extract by
    // exact name, same department.
    if (!nep) {
      const hit = deptCode ? nepByName.get(`${deptCode}:${fold(title)}`) : null;
      if (hit && !nepCodesUsed.has(`${hit.dept}:${hit.code}`)) {
        nep = hit.php;
        codes = [hit.code];
        nepMatch = "name";
        byName++;
        const funds = fundsByCode.get(`${hit.dept}:${hit.code}`) ?? [];
        gopNep = funds.filter((f) => /counterpart/i.test(f.fund)).reduce((a, f) => a + f.php, 0);
        loanNep = nep - gopNep;
      }
    }
    for (const code of codes) nepCodesUsed.add(`${deptCode}:${code}`);
    ensure(deptCode !== "" || nep == null, `${title}: NEP side without a department code`);
    const house = opt(r[5]);
    const lenders = [...new Set(
      codes.flatMap((code) => (fundsByCode.get(`${deptCode}:${code}`) ?? []).filter((f) => !/counterpart/i.test(f.fund)).map((f) => LENDER_SHORT[f.fund] ?? f.fund)),
    )];
    if (!lenders.length) {
      // No NEP fund to go by (a new line): the lender the bill's own title names.
      for (const [re, name] of [[/JICA|Japan/i, "Japan (JICA)"], [/\bADB\b/i, "ADB"], [/IBRD|World Bank|\bWB\b/i, "World Bank (IBRD)"], [/KEDCF|EDCF|Korea/i, "Korea (EDCF)"], [/AIIB/i, "AIIB"], [/CEXIM|China/i, "China"], [/French|France|AFD/i, "France"], [/IFAD/i, "IFAD"]] as const) {
        if (re.test(title)) lenders.push(name);
      }
      // Only counterpart funds so far (DAR's PBBM bridges): the loan is not yet charged to a lender's fund.
      if (!lenders.length) lenders.push("Counterpart only");
    }
    const n = (counters.get(deptCode) ?? 0) + 1;
    counters.set(deptCode, n);
    projects.push({
      key: `${deptCode || "x"}:${n}`,
      dept_code: deptCode,
      department,
      dept_short: DEPT_SHORT[deptCode] ?? department,
      dept_slug: slugByName.get(fold(department)) ?? null,
      agency: str(r[2]),
      title,
      fpap_codes: codes,
      lenders,
      nep_php: nep,
      house_php: house,
      change_php: (house ?? 0) - (nep ?? 0),
      status: fapStatus(nep, house),
      loan_nep_php: loanNep,
      loan_house_php: num(r[7]),
      gop_nep_php: gopNep,
      gop_house_php: num(r[9]),
      volume: str(r[12]),
      pdf_page: num(r[13]),
      dpwh_id: deptCode === "18" ? dpwhRecord(title, nep, house) : null,
      nep_match: nepMatch,
    });
  }
  ensure(byName <= 1, `${byName} House lines matched to the NEP by name; expected at most one (DPWH's Accelerated Bridge project)`);
  for (const p of projects) {
    ensure(p.loan_nep_php + p.gop_nep_php === (p.nep_php ?? 0), `${p.title}: NEP parts ${peso(p.loan_nep_php)} + ${peso(p.gop_nep_php)} ≠ ${peso(p.nep_php)}`);
    ensure(p.loan_house_php + p.gop_house_php === (p.house_php ?? 0), `${p.title}: House parts ${peso(p.loan_house_php)} + ${peso(p.gop_house_php)} ≠ ${peso(p.house_php)}`);
  }
  // Every NEP foreign-assisted line with an amount is on one project, and no project borrows a code twice.
  const missing = nepLines.filter((r) => !nepCodesUsed.has(`${str(r[0])}:${str(r[1])}`));
  ensure(missing.length === 0, `NEP foreign-assisted lines with no House bill row: ${missing.map((r) => `${str(r[0])} ${str(r[2])} ${peso(num(r[3]))}`).join("; ")}`);
  const nepSum = projects.reduce((a, p) => a + (p.nep_php ?? 0), 0);
  ensure(nepSum === nepExtractPhp, `projects' NEP side ${peso(nepSum)} ≠ NEP extract ${peso(nepExtractPhp)}`);
  check("nep", "The projects' NEP side equals every foreign-assisted line of the DBM NEP extract", `${peso(nepSum)} on ${projects.length} projects`);
  const dpwhNep = projects.filter((p) => p.dept_code === "18").reduce((a, p) => a + (p.nep_php ?? 0), 0);
  const dpwhHouse = projects.filter((p) => p.dept_code === "18").reduce((a, p) => a + (p.house_php ?? 0), 0);
  ensure(dpwhNep === dpwhWorkbench.nep_php && dpwhHouse === dpwhWorkbench.house_php,
    `DPWH ${peso(dpwhNep)} → ${peso(dpwhHouse)} ≠ the DPWH project comparison ${peso(dpwhWorkbench.nep_php)} → ${peso(dpwhWorkbench.house_php)}`);
  check("dpwh", "DPWH's rows equal the DPWH project comparison's foreign-assisted lines", `${dpwhWorkbench.lines} lines, ${peso(dpwhNep)} → ${peso(dpwhHouse)}`);
  const dpwhLinked = projects.filter((p) => p.dept_code === "18" && p.dpwh_id).length;
  ensure(dpwhLinked === dpwhWorkbench.lines, `only ${dpwhLinked} of ${dpwhWorkbench.lines} DPWH lines link to a record: ${projects.filter((p) => p.dept_code === "18" && !p.dpwh_id).map((p) => p.title).join("; ")}`);
  check("dpwh-links", "Every DPWH line links to its record in the DPWH project comparison", `${dpwhLinked} of ${dpwhWorkbench.lines}`);
  const besf2027 = FAP_SERIES.find((y) => y.fy === 2027)!.proposed!.total;
  ensure(nepExtractPhp === besf2027, `NEP extract ${peso(nepExtractPhp)} ≠ BESF 2027 Table B.13 FY2027 proposed ${peso(besf2027)}`);
  check("besf2027", "The NEP extract's foreign-assisted total equals BESF 2027 Table B.13, FY2027 proposed", peso(besf2027));

  // Departments
  const departments: FapDepartment[] = [];
  for (const p of projects) {
    let d = departments.find((x) => x.dept_code === p.dept_code && x.department === p.department);
    if (!d) {
      d = { dept_code: p.dept_code, department: p.department, dept_short: p.dept_short, dept_slug: p.dept_slug, projects: 0, cut: 0, raised: 0, nep_php: 0, house_php: 0, change_php: 0, loan_nep_php: 0, loan_house_php: 0, gop_nep_php: 0, gop_house_php: 0 };
      departments.push(d);
    }
    d.projects++;
    if (p.status === "cut") d.cut++;
    if (p.status === "raised" || p.status === "new") d.raised++;
    d.nep_php += p.nep_php ?? 0;
    d.house_php += p.house_php ?? 0;
    d.change_php += p.change_php;
    d.loan_nep_php += p.loan_nep_php;
    d.loan_house_php += p.loan_house_php;
    d.gop_nep_php += p.gop_nep_php;
    d.gop_house_php += p.gop_house_php;
  }
  departments.sort((a, b) => a.change_php - b.change_php || b.nep_php - a.nep_php);

  // Lenders (NEP side only: the bill splits loan proceeds from counterpart, not lender from lender)
  const lenderMap = new Map<string, FapLender>();
  for (const [key, funds] of fundsByCode) {
    const [dept, code] = key.split(":");
    if (!projects.some((p) => p.dept_code === dept && p.fpap_codes.includes(code))) continue;
    for (const f of funds) {
      const name = /counterpart/i.test(f.fund) ? "Government counterpart" : (LENDER_SHORT[f.fund] ?? f.fund);
      const l = lenderMap.get(name) ?? { name, nep_php: 0, projects: 0 };
      l.nep_php += f.php;
      l.projects++;
      lenderMap.set(name, l);
    }
  }
  const lenders = [...lenderMap.values()].sort((a, b) => b.nep_php - a.nep_php);
  ensure(lenders.reduce((a, l) => a + l.nep_php, 0) === nepExtractPhp, "lenders do not add up to the NEP total");

  // Everything the House took out of lines, across the whole bill (activity grain), for the share
  const cutsRow = (await rows(c, `
    WITH a AS (SELECT department, agency, activity, SUM(COALESCE(nep_php, 0)) nep, SUM(COALESCE(house_bill_php, 0)) house FROM lines GROUP BY 1, 2, 3)
    SELECT SUM(CASE WHEN house < nep THEN nep - house ELSE 0 END) FROM a`))[0];
  const billCuts = num(cutsRow[0]);

  // -------------------------------------------------------------------------
  // FY2020–FY2026 enacted budgets: every line with the foreign-assisted mark
  // -------------------------------------------------------------------------
  const gaa: FapGaaYear[] = [];
  for (const [i, fy] of GAA_YEARS.entries()) {
    const r = await rows(c, `
      SELECT department_id, max(department_dsc), SUM(amount), COUNT(DISTINCT fpap_code) FROM read_parquet('${gaaPaths[i]}')
      WHERE fy = ${fy} AND ${FOREIGN("fpap_code")} AND amount > 0 GROUP BY 1 ORDER BY 3 DESC`);
    const php = r.reduce((a, x) => a + num(x[2]), 0);
    gaa.push({
      fy, php, lines: r.reduce((a, x) => a + num(x[3]), 0),
      by_dept: r.map((x) => ({ dept_code: str(x[0]), dept_short: DEPT_SHORT[str(x[0])] ?? str(x[1]).replace(/\s*\(.*$/, ""), php: num(x[2]) })),
    });
    const besf = FAP_SERIES.find((y) => y.fy === fy)?.program?.total;
    if (besf != null && fy !== 2022) ensure(php === besf, `FY${fy} GAA extract ${peso(php)} ≠ BESF program ${peso(besf)}`);
  }
  check("gaa", "FY2020, FY2021 and FY2023–FY2026: the GAA extract's foreign-assisted lines equal DBM's BESF program figure",
    gaa.filter((y) => y.fy !== 2022).map((y) => `FY${y.fy} ${peso(y.php)}`).join("; "));
  const g2022 = gaa.find((y) => y.fy === 2022)!;
  check("gaa2022", "FY2022: the extract carries the budget as enacted, the BESF the budget as adjusted",
    `extract ${peso(g2022.php)}, BESF ${peso(FAP_SERIES.find((y) => y.fy === 2022)!.program!.total)}`);

  const data: FapData = {
    schema: FAP_SCHEMA,
    built_at: builtAt,
    totals: {
      projects: projects.length,
      cut: projects.filter((p) => p.status === "cut").length,
      raised: projects.filter((p) => p.status === "raised").length,
      same: projects.filter((p) => p.status === "same").length,
      new: projects.filter((p) => p.status === "new").length,
      all: { nep_php: nepSum, house_php: projects.reduce((a, p) => a + (p.house_php ?? 0), 0) },
      loan: { nep_php: projects.reduce((a, p) => a + p.loan_nep_php, 0), house_php: projects.reduce((a, p) => a + p.loan_house_php, 0) },
      gop: { nep_php: projects.reduce((a, p) => a + p.gop_nep_php, 0), house_php: projects.reduce((a, p) => a + p.gop_house_php, 0) },
      nep_extract_php: nepExtractPhp,
      bill_cuts_php: billCuts,
      dpwh_workbench: dpwhWorkbench,
    },
    departments,
    projects,
    lenders,
    gaa,
    checks,
    sources: [
      { key: "lines", label: "Every House bill line against the NEP (third reading), the line-by-line dataset", path: "hgab/2027/explorer/downloads/house-bill-2027-lines-vs-nep.parquet", sha256: sha256(linesPath) },
      { key: "nep2027", label: "FY2027 National Expenditure Program, DBM extract", path: "data/2027/<dept>/line_items.parquet" },
      { key: "dpwh", label: "DPWH project comparison (third reading)", path: "hgab/2027/dpwh/projects.parquet", sha256: sha256(dpwhPath) },
      { key: "gaa", label: "FY2020–FY2026 General Appropriations Acts, DBM extracts", path: "data/gaa-history/parquet/gaa-<fy>.parquet" },
    ],
  };
  ensure(data.totals.loan.nep_php + data.totals.gop.nep_php === data.totals.all.nep_php, "NEP parts ≠ NEP total");
  ensure(data.totals.loan.house_php + data.totals.gop.house_php === data.totals.all.house_php, "House parts ≠ House total");

  const jsonPath = resolve(args.out, "fap.json");
  writeFileSync(jsonPath, JSON.stringify(data));
  const csvCell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csvLines = projects.map((p) => [
    p.department, p.dept_code, p.agency, p.title, p.lenders.join("; "), p.status, p.nep_php, p.house_php, p.change_php,
    p.loan_nep_php, p.loan_house_php, p.gop_nep_php, p.gop_house_php, p.fpap_codes.join(" "), p.volume, p.pdf_page,
  ].map(csvCell).join(","));
  const csvPath = resolve(args.out, "fap.csv");
  writeFileSync(csvPath, `\uFEFF${[FAP_CSV_COLUMNS.join(","), ...csvLines].join("\n")}\n`);

  log(`fap.json: ${projects.length} projects, NEP ${peso(nepSum)} → House ${peso(data.totals.all.house_php)} (${peso(data.totals.all.house_php - nepSum)})`);
  log(`  loan proceeds ${peso(data.totals.loan.nep_php)} → ${peso(data.totals.loan.house_php)}; counterpart ${peso(data.totals.gop.nep_php)} → ${peso(data.totals.gop.house_php)}`);
  log(`  cut ${data.totals.cut}, raised ${data.totals.raised}, new ${data.totals.new}, same ${data.totals.same}; whole-bill cuts ${peso(billCuts)}`);
  for (const d of departments) log(`  ${d.dept_short.padEnd(7)} ${String(d.projects).padStart(2)} projects ${peso(d.nep_php).padStart(20)} → ${peso(d.house_php).padStart(20)}`);
  for (const y of gaa) log(`  GAA FY${y.fy}: ${peso(y.php)} on ${y.lines} lines`);
  for (const ch of checks) log(`  ✓ ${ch.label}: ${ch.detail}`);
  log(`wrote ${jsonPath} and ${csvPath}`);
  c.closeSync();
  db.closeSync();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
