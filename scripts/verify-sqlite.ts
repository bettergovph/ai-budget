/**
 * Sanity-check the unified data/budget.sqlite.
 *
 *   npx tsx scripts/verify-sqlite.ts               # global summary
 *   npx tsx scripts/verify-sqlite.ts <deptId>      # per-dept slice
 *
 * Cross-checks that SUM(amount_2026) over the wide-shaped agencies and fpaps
 * tables matches the yearly_totals.amount(2026) value for that dept.
 */
import { DuckDBInstance } from "@duckdb/node-api";
import { resolve } from "node:path";

async function main() {
  const deptId = process.argv[2];

  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();
  await conn.run("INSTALL sqlite; LOAD sqlite;");
  const path = resolve(process.cwd(), `data/budget.sqlite`).replace(/'/g, "''");
  await conn.run(`ATTACH '${path}' AS s (TYPE SQLITE, READ_ONLY)`);

  const tables = [
    "departments",
    "yearly_totals",
    "agencies",
    "fpaps",
    "operating_units",
    "fund_subcategories",
    "expenses",
    "objects",
  ];

  const where = deptId ? ` WHERE department_id = '${deptId}'` : ``;
  const whereDeptId = deptId ? ` WHERE id = '${deptId}'` : ``;

  console.log(deptId ? `\n--- row counts (dept ${deptId}) ---` : `\n--- row counts (all depts) ---`);
  const rows: Array<[string, number]> = [];
  for (const t of tables) {
    const wh = t === "departments" ? whereDeptId : t === "yearly_totals" ? where : where;
    const r = await conn.runAndReadAll(`SELECT COUNT(*) FROM s.${t}${wh}`);
    rows.push([t, Number(r.getRows()[0][0])]);
  }
  console.table(rows);

  if (deptId) {
    console.log(`\n--- yearly_totals for ${deptId} ---`);
    const yt = await conn.runAndReadAll(
      `SELECT year, count, amount FROM s.yearly_totals WHERE department_id='${deptId}' ORDER BY year`,
    );
    console.table(yt.getRows());

    console.log(`\n--- top-5 agencies in ${deptId} by amount_2026 ---`);
    const ag = await conn.runAndReadAll(
      `SELECT id, agency_code, description, amount_2026
       FROM s.agencies WHERE department_id='${deptId}'
       ORDER BY amount_2026 DESC NULLS LAST LIMIT 5`,
    );
    console.table(ag.getRows());

    console.log(`\n--- SUM(amount_2026) sanity check ---`);
    const a = await conn.runAndReadAll(
      `SELECT ROUND(SUM(amount_2026),2) FROM s.agencies WHERE department_id='${deptId}'`,
    );
    const f = await conn.runAndReadAll(
      `SELECT ROUND(SUM(amount_2026),2) FROM s.fpaps WHERE department_id='${deptId}'`,
    );
    const y = await conn.runAndReadAll(
      `SELECT ROUND(amount,2) FROM s.yearly_totals WHERE department_id='${deptId}' AND year=2026`,
    );
    console.log("  agencies      :", a.getRows()[0][0]);
    console.log("  fpaps         :", f.getRows()[0][0]);
    console.log("  yearly_totals :", y.getRows()[0][0]);
  } else {
    console.log(`\n--- national 2026 rollup (sum across all depts) ---`);
    const nat = await conn.runAndReadAll(
      `SELECT ROUND(SUM(amount),2) AS yearly_totals_sum FROM s.yearly_totals WHERE year=2026`,
    );
    console.log("  yearly_totals (national 2026) =", nat.getRows()[0][0]);
    const agSum = await conn.runAndReadAll(
      `SELECT ROUND(SUM(amount_2026),2) FROM s.agencies`,
    );
    console.log("  agencies SUM(amount_2026)     =", agSum.getRows()[0][0]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
