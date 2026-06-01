/**
 * JSON → SQLite converter for ai-reports D1 migration.
 *
 * Produces a SINGLE `data/budget.sqlite` covering every requested dept.
 * Every entity table has a `department_id` column (already present in the
 * source JSONs); `yearly_totals` is keyed by (department_id, year). All FK
 * lookups in the Worker layer will be `WHERE department_id = ?` + a FK
 * column, so we index `department_id` on every entity table plus each parent
 * FK column.
 *
 * Schema mirrors the existing `RawDataset<T>` envelope: wide layout with
 * `amount_2020 … amount_2026` / `count_2020 … count_2026` columns, so a
 * `SELECT * FROM agencies WHERE department_id=?` already shape-matches the
 * JSON envelope `dept-data.ts` expects.
 *
 * Run one dept:    npm run build:sqlite -- --dept=01
 * Run all depts:   npm run build:sqlite -- --all
 * Force rebuild:   add --reset (drops + recreates the .sqlite from scratch)
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026] as const;

interface TableSpec {
  /** Source JSON filename (without .json). */
  file: string;
  /** Name of the entity's own code column in source rows. */
  codeCol: string;
  /** FK columns present on each row. */
  fkCols: ReadonlyArray<string>;
  /** Extra columns (beyond department_id) to index for parent-child lookups. */
  indexes: ReadonlyArray<string>;
}

const ENTITY_TABLES: ReadonlyArray<{ name: string; spec: TableSpec }> = [
  {
    name: "agencies",
    spec: { file: "agencies", codeCol: "agency_code", fkCols: [], indexes: [] },
  },
  {
    name: "fpaps",
    spec: {
      file: "fpaps",
      codeCol: "fpap_code",
      fkCols: ["agency_id"],
      indexes: ["agency_id"],
    },
  },
  {
    name: "operating_units",
    spec: {
      file: "operating_units",
      codeCol: "operunit_code",
      fkCols: ["fpap_id", "agency_id"],
      indexes: ["fpap_id"],
    },
  },
  {
    name: "fund_subcategories",
    spec: {
      file: "fund_subcategories",
      codeCol: "fund_code",
      fkCols: ["operating_unit_id", "fpap_id", "agency_id"],
      indexes: ["operating_unit_id"],
    },
  },
  {
    name: "expenses",
    spec: {
      file: "expenses",
      codeCol: "expense_code",
      fkCols: ["fund_id", "operating_unit_id", "fpap_id", "agency_id"],
      indexes: ["fund_id", "agency_id"],
    },
  },
  {
    name: "objects",
    spec: {
      file: "objects",
      codeCol: "object_code",
      fkCols: ["expense_id", "fund_id", "operating_unit_id", "fpap_id", "agency_id"],
      indexes: ["expense_id", "agency_id"],
    },
  },
];

function parseArgs(): { dept?: string; all: boolean; reset: boolean } {
  const args = process.argv.slice(2);
  const get = (k: string) =>
    args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
  return {
    dept: get("dept"),
    all: args.includes("--all"),
    reset: args.includes("--reset"),
  };
}

function listDepts(dataRoot: string): string[] {
  return readdirSync(dataRoot)
    .filter((d) => /^\d{2}$/.test(d))
    .filter((d) => statSync(resolve(dataRoot, d)).isDirectory())
    .sort();
}

function yearAmountCountCols(): string {
  return YEARS.flatMap((y) => [
    `amount_${y} DOUBLE`,
    `count_${y} BIGINT`,
  ]).join(",\n      ");
}

function yearAmountCountSelect(yearsAvailable: ReadonlyArray<number>): string {
  return YEARS.flatMap((y) => {
    if (!yearsAvailable.includes(y)) {
      return [`NULL AS amount_${y}`, `NULL AS count_${y}`];
    }
    return [
      `r.years."${y}".amount AS amount_${y}`,
      `CAST(r.years."${y}".count AS BIGINT) AS count_${y}`,
    ];
  }).join(",\n        ");
}

async function detectYears(
  conn: Awaited<ReturnType<Awaited<ReturnType<typeof DuckDBInstance.create>>["connect"]>>,
  srcPath: string,
): Promise<number[]> {
  const esc = srcPath.replace(/'/g, "''");
  const res = await conn.runAndReadAll(
    `SELECT typeof(data[1].years) AS t
     FROM read_json_auto('${esc}', maximum_object_size = 1073741824)
     LIMIT 1`,
  );
  const typeStr = String(res.getRows()[0][0]);
  return Array.from(typeStr.matchAll(/"(\d{4})"/g), (m) => Number(m[1])).sort();
}

type Conn = Awaited<ReturnType<Awaited<ReturnType<typeof DuckDBInstance.create>>["connect"]>>;

/**
 * Create all tables + indexes in the attached SQLite if they don't exist yet.
 * Idempotent so we can re-run with subsets of depts.
 */
async function ensureSchema(conn: Conn): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      slug TEXT,
      description TEXT,
      ${yearAmountCountCols()}
    );
  `);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS yearly_totals (
      department_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      count BIGINT,
      amount DOUBLE,
      PRIMARY KEY (department_id, year)
    );
  `);

  for (const { name, spec } of ENTITY_TABLES) {
    const fkColDefs = spec.fkCols.map((c) => `${c} TEXT`).join(", ");
    await conn.run(`
      CREATE TABLE IF NOT EXISTS ${name} (
        id TEXT PRIMARY KEY,
        slug TEXT,
        ${spec.codeCol} TEXT,
        description TEXT,
        department_id TEXT NOT NULL${fkColDefs ? ", " + fkColDefs : ""},
        ${yearAmountCountCols()}
      );
    `);
    // Always index department_id (every Worker query filters by it),
    // plus each parent FK column for parent→child drilldowns.
    const idxCols = ["department_id", ...spec.indexes];
    for (const col of idxCols) {
      await conn.run(`CREATE INDEX IF NOT EXISTS ${name}_${col}_idx ON ${name}(${col});`);
    }
  }
}

/**
 * Load one dept's JSONs into the (already attached) SQLite tables.
 * Uses DELETE-then-INSERT inside a transaction so re-running a single dept
 * cleanly replaces just that dept's rows without disturbing others.
 */
async function loadDept(
  conn: Conn,
  deptId: string,
  dataRoot: string,
): Promise<Record<string, number>> {
  const deptDir = resolve(dataRoot, deptId);
  const rows: Record<string, number> = {};

  await conn.run(`BEGIN`);
  try {
    // departments
    {
      const srcFile = resolve(deptDir, "departments.json");
      if (!existsSync(srcFile)) throw new Error(`departments.json missing for dept ${deptId}`);
      const yearsAvail = await detectYears(conn, srcFile);
      const src = srcFile.replace(/'/g, "''");
      await conn.run(`DELETE FROM departments WHERE id = '${deptId}'`);
      await conn.run(`
        INSERT INTO departments
        SELECT r.id, r.slug, r.description,
               ${yearAmountCountSelect(yearsAvail)}
        FROM (
          SELECT unnest(data) AS r
          FROM read_json_auto('${src}', maximum_object_size = 1073741824)
        );
      `);
    }

    // yearly_totals
    {
      const srcFile = resolve(deptDir, "yearly_totals.json");
      const src = srcFile.replace(/'/g, "''");
      await conn.run(`DELETE FROM yearly_totals WHERE department_id = '${deptId}'`);
      await conn.run(`
        INSERT INTO yearly_totals
        SELECT '${deptId}', r.year, CAST(r.count AS BIGINT), CAST(r.amount AS DOUBLE)
        FROM (
          SELECT unnest(data) AS r
          FROM read_json_auto('${src}', maximum_object_size = 1073741824)
        );
      `);
    }

    // entity tables
    for (const { name, spec } of ENTITY_TABLES) {
      const srcFile = resolve(deptDir, `${spec.file}.json`);
      if (!existsSync(srcFile)) {
        console.warn(`  (dept ${deptId}: skipping ${name}, source missing)`);
        continue;
      }
      const yearsAvail = await detectYears(conn, srcFile);
      const src = srcFile.replace(/'/g, "''");
      const fkColSelect = spec.fkCols.map((c) => `r.${c}`).join(", ");
      await conn.run(`DELETE FROM ${name} WHERE department_id = '${deptId}'`);
      await conn.run(`
        INSERT INTO ${name}
        SELECT
          r.id, r.slug, r.${spec.codeCol}, r.description,
          r.department_id${fkColSelect ? ", " + fkColSelect : ""},
          ${yearAmountCountSelect(yearsAvail)}
        FROM (
          SELECT unnest(data) AS r
          FROM read_json_auto('${src}', maximum_object_size = 1073741824)
        );
      `);
      const n = await conn.runAndReadAll(
        `SELECT COUNT(*) FROM ${name} WHERE department_id = '${deptId}'`,
      );
      rows[name] = Number(n.getRows()[0][0]);
    }
    await conn.run(`COMMIT`);
  } catch (e) {
    await conn.run(`ROLLBACK`);
    throw e;
  }
  return rows;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}MB`;
  return `${(n / 1024 ** 3).toFixed(2)}GB`;
}

async function main() {
  const args = parseArgs();
  const dataRoot = resolve(process.cwd(), "data");
  if (!existsSync(dataRoot)) throw new Error(`data/ not found at ${dataRoot}`);

  const depts = args.all
    ? listDepts(dataRoot)
    : args.dept
      ? [args.dept]
      : (() => {
          throw new Error("Pass --all or --dept=NN");
        })();

  const outPath = resolve(dataRoot, "budget.sqlite");
  if (args.reset && existsSync(outPath)) {
    rmSync(outPath);
    console.log(`reset: removed ${outPath}`);
  }

  const db = await DuckDBInstance.create(":memory:", { threads: "4" });
  const conn = await db.connect();
  await conn.run(`INSTALL sqlite; LOAD sqlite;`);
  const escOut = outPath.replace(/'/g, "''");
  await conn.run(`ATTACH '${escOut}' AS db (TYPE SQLITE)`);
  await conn.run(`USE db`);

  await ensureSchema(conn);

  process.stdout.write(`Loading ${depts.length} dept(s) into ${outPath}\n`);
  process.stdout.write("─".repeat(72) + "\n");

  const tStart = performance.now();
  for (const deptId of depts) {
    const label = `  ${deptId}`;
    process.stdout.write(`${label}  …\r`);
    const t0 = performance.now();
    try {
      const rows = await loadDept(conn, deptId, dataRoot);
      const ms = performance.now() - t0;
      const summary = Object.entries(rows)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      process.stdout.write(`${label}  ${(ms / 1000).toFixed(1)}s  ${summary}\n`);
    } catch (e) {
      process.stdout.write(`${label}  FAILED: ${(e as Error).message}\n`);
    }
  }

  await conn.run(`USE memory`);
  await conn.run(`DETACH db`);

  const bytes = statSync(outPath).size;
  process.stdout.write("─".repeat(72) + "\n");
  process.stdout.write(
    `DONE  ${fmtBytes(bytes)}  total ${((performance.now() - tStart) / 1000).toFixed(1)}s\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
