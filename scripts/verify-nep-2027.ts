/**
 * Integrity checks for the generated `data/2027/` tree.
 *
 * Re-reads the raw NEP CSV and asserts that everything the microsite serves
 * still reconciles to it. Run after `npm run import:nep2027`, and any time the
 * source file is replaced.
 *
 *   npm run verify:nep2027
 *   npm run verify:nep2027 -- --out=data/2027 --src=/path/to/NEP-FY2027.csv
 *
 * Exit code is non-zero if any check fails, so it drops straight into CI.
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { existsSync, readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { globSync } from "node:fs";
import { resolve } from "node:path";

const NEP_YEAR = 2027;
const BASE_YEAR = 2026;
const SCALE = 1000;
/** Tolerance in pesos — everything is integer thousands, so this is generous. */
const EPS = 1;

const argv = process.argv.slice(2);
const arg = (k: string, d: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = resolve(arg("out", "data/2027"));
const SRC = resolve(arg("src", "/home/jason/projects/2027-budget/NEP-FY2027.csv"));

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checks++;
  if (ok) {
    process.stdout.write(`  ✓ ${name}\n`);
  } else {
    failures++;
    process.stdout.write(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}\n`);
  }
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS;
}

const peso = (n: number) => `₱${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

interface Rollup { code: string; description: string; count: number; amount: number; base_amount: number; delta: number }
interface DeptRow { id: string; description: string; line_items: number; amount: number; base_amount: number }
interface Envelope<T> { metadata: { total_items: number; scale?: string }; data: T[] }
interface Entity { id: string; years: Record<string, { count: number; amount: number }> }

async function main() {
  if (!existsSync(OUT)) throw new Error(`${OUT} not found — run \`npm run import:nep2027\` first.`);
  if (!existsSync(SRC)) throw new Error(`${SRC} not found.`);

  process.stdout.write(`verifying ${OUT}\n\n`);

  // --- ground truth straight from the raw CSV ------------------------------
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  await c.run(`
    CREATE TABLE src AS
    SELECT
      CASE WHEN coalesce(nullif(trim(SORDER), ''), '1') <> '2' THEN nullif(trim(DEPARTMENT), '')
           WHEN trim(DEPARTMENT) = '01' THEN 'SPF'
           WHEN trim(DEPARTMENT) = '04' THEN 'AUTO'
           ELSE 'X' || trim(DEPARTMENT) END                        AS department_id,
      nullif(trim(UACS_OBJ_CD), '')                                AS object_code,
      nullif(trim(UACS_EXP_CD), '')                                AS expense_code,
      coalesce(TRY_CAST(replace(nullif(trim(AMT), ''), ',', '') AS DOUBLE), 0.0) * ${SCALE} AS amount
    FROM read_csv('${SRC.replace(/'/g, "''")}', header = true, all_varchar = true)
    WHERE nullif(trim(DEPARTMENT), '') IS NOT NULL
  `);

  const one = async (sql: string) => (await c.runAndReadAll(sql)).getRows()[0];
  const [srcTotalRaw, srcItemsRaw] = await one(
    `SELECT sum(amount), count(*) FILTER (object_code IS NOT NULL) FROM src`,
  ) as [number, bigint];
  const srcTotal = Number(srcTotalRaw);
  const srcItems = Number(srcItemsRaw);

  const srcDepts = new Map<string, { amount: number; items: number }>();
  for (const row of (await c.runAndReadAll(`
      SELECT department_id, sum(amount), count(*) FILTER (object_code IS NOT NULL)
      FROM src GROUP BY 1`)).getRows()) {
    srcDepts.set(String(row[0]), { amount: Number(row[1]), items: Number(row[2]) });
  }

  const srcClasses = new Map<string, number>();
  for (const row of (await c.runAndReadAll(`
      SELECT expense_code, sum(amount) FROM src WHERE expense_code IS NOT NULL GROUP BY 1`)).getRows()) {
    srcClasses.set(String(row[0]), Number(row[1]));
  }

  // --- national index ------------------------------------------------------
  process.stdout.write("national/index.json\n");
  const idxPath = resolve(OUT, "national", "index.json");
  if (!existsSync(idxPath)) {
    check("index exists", false, idxPath);
  } else {
    const idx = readJson<{
      fiscal_year: number; baseline_year: number; scale: string;
      national: { line_items: number; amount: number; base_amount: number };
      departments: DeptRow[]; expense_classes: Rollup[]; regions: Rollup[]; sections: Rollup[];
    }>(idxPath);

    check("fiscal year is 2027", idx.fiscal_year === NEP_YEAR);
    check("baseline year is 2026", idx.baseline_year === BASE_YEAR);
    check("scale is pesos", idx.scale === "pesos");
    check(
      "national total matches the raw CSV",
      near(idx.national.amount, srcTotal),
      `index ${peso(idx.national.amount)} vs source ${peso(srcTotal)}`,
    );
    check(
      "national line-item count matches the raw CSV",
      idx.national.line_items === srcItems,
      `index ${idx.national.line_items} vs source ${srcItems}`,
    );

    const deptSum = idx.departments.reduce((a, d) => a + d.amount, 0);
    check(
      "department amounts sum to the national total",
      near(deptSum, idx.national.amount),
      `${peso(deptSum)} vs ${peso(idx.national.amount)}`,
    );
    check(
      "every source department is present",
      idx.departments.length === srcDepts.size,
      `index ${idx.departments.length} vs source ${srcDepts.size}`,
    );

    const bad = idx.departments.filter((d) => {
      const s = srcDepts.get(d.id);
      return !s || !near(s.amount, d.amount) || s.items !== d.line_items;
    });
    check(
      "each department reconciles to the raw CSV",
      bad.length === 0,
      bad.slice(0, 5).map((d) => `${d.id}: ${peso(d.amount)} vs ${peso(srcDepts.get(d.id)?.amount ?? NaN)}`).join("; "),
    );

    for (const key of ["expense_classes", "regions", "sections"] as const) {
      const rows = idx[key];
      const sum = rows.reduce((a, r) => a + r.amount, 0);
      check(`${key} sum to the national total`, near(sum, idx.national.amount), `${peso(sum)} vs ${peso(idx.national.amount)}`);
    }

    const clsBad = idx.expense_classes.filter((r) => !near(srcClasses.get(r.code) ?? NaN, r.amount));
    check("expense-class amounts match the raw CSV", clsBad.length === 0,
      clsBad.map((r) => `${r.code}: ${peso(r.amount)}`).join("; "));

    // --- per-department ----------------------------------------------------
    process.stdout.write("\nper-department trees\n");
    let summaryTotal = 0;
    const problems: string[] = [];

    for (const d of idx.departments) {
      const dir = resolve(OUT, d.id);
      const sPath = resolve(dir, "summary.json");
      if (!existsSync(sPath)) { problems.push(`${d.id}: summary.json missing`); continue; }
      const s = readJson<{
        department: DeptRow | null; expense_classes: Rollup[]; agencies: Rollup[]; regions: Rollup[];
      }>(sPath);
      if (!s.department) { problems.push(`${d.id}: summary has no department row`); continue; }
      summaryTotal += s.department.amount;

      if (!near(s.department.amount, d.amount)) {
        problems.push(`${d.id}: summary ${peso(s.department.amount)} vs index ${peso(d.amount)}`);
      }
      // Rollups the importer emits in full (not top-N) must be exact.
      for (const key of ["expense_classes", "agencies", "regions"] as const) {
        const sum = s[key].reduce((a, r) => a + r.amount, 0);
        if (!near(sum, s.department.amount)) {
          problems.push(`${d.id}: ${key} sum ${peso(sum)} vs ${peso(s.department.amount)}`);
        }
      }
      for (const f of ["departments.json", "agencies.json", "expense_classes.json", "yearly_totals.json", "line_items.parquet"]) {
        if (!existsSync(resolve(dir, f))) problems.push(`${d.id}: ${f} missing`);
      }
      // Entity JSONs stay in thousands; check one of them against the summary.
      const ec = readJson<Envelope<Entity>>(resolve(dir, "expense_classes.json"));
      const ecSum = ec.data.reduce((a, r) => a + (r.years[String(NEP_YEAR)]?.amount ?? 0), 0) * SCALE;
      if (!near(ecSum, s.department.amount)) {
        problems.push(`${d.id}: expense_classes.json ${peso(ecSum)} vs summary ${peso(s.department.amount)}`);
      }
      if (ec.metadata.scale !== "thousands") problems.push(`${d.id}: expense_classes.json scale is not "thousands"`);
    }

    check("every department has a complete tree", problems.length === 0, problems.slice(0, 8).join("\n      "));
    check(
      "summary.json amounts sum to the national total",
      near(summaryTotal, idx.national.amount),
      `${peso(summaryTotal)} vs ${peso(idx.national.amount)}`,
    );

    // --- stray directories -------------------------------------------------
    const known = new Set([...idx.departments.map((d) => d.id), "national"]);
    const stray = readdirSync(OUT)
      .filter((n) => statSync(resolve(OUT, n)).isDirectory() && !known.has(n));
    check("no orphaned department directories", stray.length === 0, stray.join(", "));
  }

  // --- D1 aggregation layer ------------------------------------------------
  //
  // The microsite reads these tables live, so they have to reconcile to the
  // same raw CSV the JSON tree does. Checked against the local miniflare D1;
  // pass --skip-d1 when it has not been loaded.
  if (!argv.includes("--skip-d1")) {
    process.stdout.write("\nD1 aggregation layer (local)\n");
    const dbFiles = globSync(
      ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite",
    ).filter((f) => !f.endsWith("metadata.sqlite"));

    if (!dbFiles.length) {
      check("local D1 present", false, "run: npx wrangler d1 execute budget --local --file=data/2027/d1-import.sql");
    } else {
      await c.run(`INSTALL sqlite; LOAD sqlite;`);
      await c.run(`ATTACH '${dbFiles[0].replace(/'/g, "''")}' AS d1 (TYPE sqlite, READ_ONLY)`);

      const tables = (await c.runAndReadAll(
        `SELECT table_name FROM duckdb_tables() WHERE database_name = 'd1' AND table_name LIKE 'nep_%'`,
      )).getRows().map((r) => String(r[0]));
      const loaded = ["nep_meta", "nep_departments", "nep_rollups"].every((t) => tables.includes(t));
      check("nep_* tables loaded", loaded, tables.join(", ") || "none");

      if (loaded) {
        const meta = (await c.runAndReadAll(
          `SELECT line_items, amount, base_amount FROM d1.nep_meta`,
        )).getRows()[0] as [bigint | number, bigint | number, bigint | number];
        check("nep_meta line_items matches the raw CSV", Number(meta[0]) === srcItems,
          `${Number(meta[0])} vs ${srcItems}`);
        check("nep_meta amount matches the raw CSV", near(Number(meta[1]), srcTotal),
          `${peso(Number(meta[1]))} vs ${peso(srcTotal)}`);

        const deptAgg = (await c.runAndReadAll(
          `SELECT count(*), sum(line_items), sum(amount) FROM d1.nep_departments`,
        )).getRows()[0] as [bigint, bigint, bigint];
        check("nep_departments covers every source department",
          Number(deptAgg[0]) === srcDepts.size, `${Number(deptAgg[0])} vs ${srcDepts.size}`);
        check("nep_departments amounts sum to the national total",
          near(Number(deptAgg[2]), srcTotal), `${peso(Number(deptAgg[2]))} vs ${peso(srcTotal)}`);
        check("nep_departments line items sum to the raw CSV",
          Number(deptAgg[1]) === srcItems, `${Number(deptAgg[1])} vs ${srcItems}`);

        // Every dimension must be COMPLETE: dropping untagged rows would let a
        // cross-department sum silently understate the budget.
        const dims = (await c.runAndReadAll(
          `SELECT dimension, sum(amount) a, count(*) n FROM d1.nep_rollups GROUP BY 1 ORDER BY 1`,
        )).getRows() as Array<[string, bigint, bigint]>;
        check("nep_rollups carries all 8 dimensions", dims.length === 8,
          dims.map((d) => d[0]).join(", "));
        const incomplete = dims.filter((d) => !near(Number(d[1]), srcTotal));
        check("every dimension sums to the national total (completeness)",
          incomplete.length === 0,
          incomplete.map((d) => `${d[0]}: ${peso(Number(d[1]))} vs ${peso(srcTotal)}`).join("; "));

        const mismatch = (await c.runAndReadAll(`
          SELECT r.department_id, r.dimension
          FROM d1.nep_rollups r JOIN d1.nep_departments d ON d.id = r.department_id
          GROUP BY 1, 2 HAVING sum(r.amount) <> any_value(d.amount)
        `)).getRows();
        check("every department x dimension reconciles to its department total",
          mismatch.length === 0,
          mismatch.slice(0, 5).map((m) => `${m[0]}/${m[1]}`).join(", "));

        const drift = (await c.runAndReadAll(`
          SELECT count(*) FROM d1.nep_departments WHERE amount % 1000 <> 0
        `)).getRows()[0][0];
        check("D1 amounts are exact integer pesos", Number(drift) === 0,
          `${Number(drift)} departments have non-thousand peso amounts`);

        // The site is a hybrid: flat rollups come from D1, the hierarchy
        // drill-down aggregates the parquet in the browser. Both must produce
        // identical numbers or the same page contradicts itself.
        const DIMS: ReadonlyArray<[string, string]> = [
          ["agency", "agency_code"], ["program", "program_code"],
          ["expense_class", "expense_code"], ["fund", "fund_code"],
          ["region", "region_code"], ["object", "object_code"],
          ["operating_unit", "operunit_code"], ["division", "div_code"],
        ];
        const disagree: string[] = [];
        for (const [dimension, col] of DIMS) {
          const n = Number((await c.runAndReadAll(`
            WITH pq AS (
              SELECT department_id, coalesce(${col}, '__unassigned__') AS code,
                     sum(amount) FILTER (fy = ${NEP_YEAR})  AS a,
                     sum(amount) FILTER (fy = ${BASE_YEAR}) AS b
              FROM read_parquet('${OUT.replace(/'/g, "''")}/*/line_items.parquet')
              GROUP BY 1, 2
            ), dd AS (
              SELECT department_id, code, amount AS a, base_amount AS b
              FROM d1.nep_rollups WHERE dimension = '${dimension}'
            )
            SELECT count(*) FROM (
              SELECT * FROM pq FULL OUTER JOIN dd USING (department_id, code)
              WHERE coalesce(pq.a, 0) <> coalesce(dd.a, 0)
                 OR coalesce(pq.b, 0) <> coalesce(dd.b, 0)
            )`)).getRows()[0][0]);
          if (n > 0) disagree.push(`${dimension}: ${n} rows`);
        }
        check("parquet and D1 agree on every rollup row (hybrid consistency)",
          disagree.length === 0, disagree.join("; "));

        // The parquet carries both years; anything summing it without pinning
        // `fy` double-counts, so assert both are actually present.
        const years = (await c.runAndReadAll(`
          SELECT DISTINCT fy FROM read_parquet('${OUT.replace(/'/g, "''")}/*/line_items.parquet') ORDER BY 1
        `)).getRows().map((r) => Number(r[0]));
        check("line-item parquet carries both fiscal years",
          years.length === 2 && years[0] === BASE_YEAR && years[1] === NEP_YEAR,
          `found: ${years.join(", ")}`);
      }
    }
  }

  c.closeSync();
  db.closeSync();

  process.stdout.write(
    `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED\n` : "\n"),
  );
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
