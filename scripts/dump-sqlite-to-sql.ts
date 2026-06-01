/**
 * Generate a streaming `data/budget.sql` text dump of `data/budget.sqlite`,
 * suitable for `wrangler d1 execute --remote --file=` or `wrangler d1 import`.
 *
 *   npx tsx scripts/dump-sqlite-to-sql.ts
 *
 * Layout of the output file:
 *   1. DROP TABLE IF EXISTS  (idempotent restore)
 *   2. CREATE TABLE / CREATE INDEX  (regenerated from convert-to-sqlite's schema)
 *   3. INSERT INTO ... VALUES (...), (...), …  — batched 500 rows per INSERT
 *
 * Note: no SQL-level BEGIN/COMMIT — D1 rejects those because Durable Objects
 * route transactions through the JS storage API. The DROP TABLE IF EXISTS
 * prefix gives us idempotency without needing a transaction wrapper.
 *
 * Reads the SQLite via DuckDB's sqlite extension to avoid adding a runtime
 * SQLite dep. Streams row-by-row via DuckDBResultReader.value(col, row) so
 * we don't materialise 2M rows in JS-land for the objects table.
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { createWriteStream, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026] as const;
// D1 caps a single SQL statement at SQLite's 1 MB default. The `objects`
// table has 24 columns of long composite-ID strings, so a row tuple averages
// ~800 bytes; 50 rows/INSERT keeps each statement well under 50 KB. Larger
// batches blow up with `SQLITE_TOOBIG`.
const BATCH_ROWS = 50;
const READ_CHUNK = 4096;

interface TableSpec {
  codeCol: string;
  fkCols: ReadonlyArray<string>;
  indexes: ReadonlyArray<string>;
}

const ENTITY_TABLES: ReadonlyArray<{ name: string; spec: TableSpec }> = [
  { name: "agencies", spec: { codeCol: "agency_code", fkCols: [], indexes: [] } },
  {
    name: "fpaps",
    spec: { codeCol: "fpap_code", fkCols: ["agency_id"], indexes: ["agency_id"] },
  },
  {
    name: "operating_units",
    spec: {
      codeCol: "operunit_code",
      fkCols: ["fpap_id", "agency_id"],
      indexes: ["fpap_id"],
    },
  },
  {
    name: "fund_subcategories",
    spec: {
      codeCol: "fund_code",
      fkCols: ["operating_unit_id", "fpap_id", "agency_id"],
      indexes: ["operating_unit_id"],
    },
  },
  {
    name: "expenses",
    spec: {
      codeCol: "expense_code",
      fkCols: ["fund_id", "operating_unit_id", "fpap_id", "agency_id"],
      indexes: ["fund_id", "agency_id"],
    },
  },
  {
    name: "objects",
    spec: {
      codeCol: "object_code",
      fkCols: ["expense_id", "fund_id", "operating_unit_id", "fpap_id", "agency_id"],
      indexes: ["expense_id", "agency_id"],
    },
  },
];

function yearAmountCountColDefs(): string {
  return YEARS.flatMap((y) => [
    `amount_${y} DOUBLE`,
    `count_${y} BIGINT`,
  ]).join(", ");
}

function schemaSql(): string {
  const out: string[] = [];
  for (const { name } of [...ENTITY_TABLES].reverse()) {
    out.push(`DROP TABLE IF EXISTS ${name};`);
  }
  out.push(`DROP TABLE IF EXISTS yearly_totals;`);
  out.push(`DROP TABLE IF EXISTS departments;`);

  out.push(
    `CREATE TABLE departments (id TEXT PRIMARY KEY, slug TEXT, description TEXT, ${yearAmountCountColDefs()});`,
  );
  out.push(
    `CREATE TABLE yearly_totals (department_id TEXT NOT NULL, year INTEGER NOT NULL, count BIGINT, amount DOUBLE, PRIMARY KEY (department_id, year));`,
  );

  for (const { name, spec } of ENTITY_TABLES) {
    const fkCols = spec.fkCols.map((c) => `${c} TEXT`).join(", ");
    out.push(
      `CREATE TABLE ${name} (id TEXT PRIMARY KEY, slug TEXT, ${spec.codeCol} TEXT, description TEXT, department_id TEXT NOT NULL${fkCols ? ", " + fkCols : ""}, ${yearAmountCountColDefs()});`,
    );
    const idxCols = ["department_id", ...spec.indexes];
    for (const col of idxCols) {
      out.push(`CREATE INDEX ${name}_${col}_idx ON ${name}(${col});`);
    }
  }
  return out.join("\n") + "\n";
}

/** SQL-escape a single value for inclusion in a VALUES tuple. */
function lit(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "boolean") return v ? "1" : "0";
  const s = String(v).replace(/'/g, "''");
  return `'${s}'`;
}

type Conn = Awaited<ReturnType<Awaited<ReturnType<typeof DuckDBInstance.create>>["connect"]>>;

/**
 * Stream the table out as batched INSERT statements. Reads via
 * `streamAndRead` + `value(col, row)` so DuckDB's chunked buffer is the only
 * full-table copy in memory; we never materialise a JS row array of all 2M
 * rows for `objects`.
 *
 * Returns total row count emitted.
 */
async function dumpTable(
  conn: Conn,
  table: string,
  cols: ReadonlyArray<string>,
  out: NodeJS.WritableStream,
): Promise<number> {
  const reader = await conn.streamAndRead(`SELECT ${cols.join(", ")} FROM s.${table}`);
  const colList = cols.join(", ");
  const insertPrefix = `INSERT INTO ${table} (${colList}) VALUES `;
  let bufferedTuples: string[] = [];
  let consumed = 0;
  let total = 0;

  const flush = (): Promise<void> => {
    if (bufferedTuples.length === 0) return Promise.resolve();
    const line = insertPrefix + bufferedTuples.join(",") + ";\n";
    bufferedTuples = [];
    return new Promise<void>((res, rej) => {
      const ok = out.write(line, (err) => (err ? rej(err) : res()));
      if (!ok) out.once("drain", res);
    });
  };

  while (true) {
    await reader.readUntil(consumed + READ_CHUNK);
    const have = reader.currentRowCount;
    if (have === consumed) break; // no progress → exhausted

    for (let r = consumed; r < have; r++) {
      const parts: string[] = new Array(cols.length);
      for (let c = 0; c < cols.length; c++) {
        parts[c] = lit(reader.value(c, r));
      }
      bufferedTuples.push("(" + parts.join(",") + ")");
      total++;
      if (bufferedTuples.length >= BATCH_ROWS) await flush();
    }
    consumed = have;
    if (reader.done) break;
  }
  await flush();
  return total;
}

async function listColumns(conn: Conn, table: string): Promise<string[]> {
  const r = await conn.runAndReadAll(`DESCRIBE s.${table}`);
  // DESCRIBE returns rows of [column_name, column_type, null, key, default, extra].
  return r.getRows().map((row) => String(row[0]));
}

async function main() {
  const dataRoot = resolve(process.cwd(), "data");
  const sqlitePath = resolve(dataRoot, "budget.sqlite");
  if (!existsSync(sqlitePath)) {
    throw new Error(`${sqlitePath} not found — run \`npm run build:sqlite -- --all\` first.`);
  }
  const sqlPath = resolve(dataRoot, "budget.sql");

  const db = await DuckDBInstance.create(":memory:", { threads: "4" });
  const conn = await db.connect();
  await conn.run("INSTALL sqlite; LOAD sqlite;");
  await conn.run(`ATTACH '${sqlitePath.replace(/'/g, "''")}' AS s (TYPE SQLITE, READ_ONLY)`);

  const out = createWriteStream(sqlPath);
  const writeLine = (s: string) =>
    new Promise<void>((res, rej) => {
      const ok = out.write(s, (err) => (err ? rej(err) : res()));
      if (!ok) out.once("drain", res);
    });

  await writeLine(schemaSql());

  const tStart = performance.now();
  const counts: Record<string, number> = {};
  const tables = ["departments", "yearly_totals", ...ENTITY_TABLES.map((t) => t.name)];

  for (const name of tables) {
    const cols = await listColumns(conn, name);
    const t0 = performance.now();
    counts[name] = await dumpTable(conn, name, cols, out);
    const ms = performance.now() - t0;
    process.stdout.write(
      `  ${name.padEnd(20)} ${counts[name].toString().padStart(8)} rows  (${(ms / 1000).toFixed(1)}s)\n`,
    );
  }

  await new Promise<void>((res) => out.end(res));

  const bytes = statSync(sqlPath).size;
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  process.stdout.write(
    `\nDONE  ${(bytes / 1024 ** 2).toFixed(1)} MB  ${totalRows} rows  total ${((performance.now() - tStart) / 1000).toFixed(1)}s\n  → ${sqlPath}\n`,
  );
  process.stdout.write(
    `\nNext step (one of):\n` +
      `  # Bulk import via D1's HTTP import API — fastest for large files:\n` +
      `  npx wrangler d1 import budget --file=data/budget.sql --remote\n` +
      `\n  # Per-statement execute — slower but useful for incremental updates:\n` +
      `  npx wrangler d1 execute budget --remote --file=data/budget.sql\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
