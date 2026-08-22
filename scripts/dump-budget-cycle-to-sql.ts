/**
 * Build an incremental D1 import from the normalized budget-cycle archive.
 *
 * The lossless archive remains in data/budget-cycle/*.ndjson + SQLite. The
 * D1 serving layer intentionally contains only production rows and reported
 * facts, because an absent fact already means "not reported" to the API and
 * carrying ~118K explicit NULL rows would add no information to responses.
 *
 * Usage:
 *   npm run dump:cycle-sql
 *   npm run dump:cycle-sql -- --database=/path/to/budget-cycle.sqlite
 *   npm run dump:cycle-sql -- --output=/path/to/d1-import.sql
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const BATCH_ROWS = 50;
const READ_CHUNK = 4096;

interface TableSpec {
  name: string;
  columns: readonly string[];
  sourceWhere?: string;
  create: string;
  indexes: readonly string[];
}

const TABLES: readonly TableSpec[] = [
  {
    name: "budget_cycle_source_rows",
    columns: [
      "source_row_id", "source_sheet", "source_row_number", "is_production", "subject_id",
      "source_department_code", "source_department_name", "source_agency_code", "source_agency_name",
      "prexc_program_code", "prexc_subprogram_code", "pap_label",
    ],
    sourceWhere: "is_production = 1",
    create: `CREATE TABLE budget_cycle_source_rows (
      source_row_id TEXT PRIMARY KEY,
      source_sheet TEXT NOT NULL,
      source_row_number INTEGER NOT NULL,
      is_production INTEGER NOT NULL,
      subject_id TEXT,
      source_department_code TEXT,
      source_department_name TEXT,
      source_agency_code TEXT,
      source_agency_name TEXT,
      prexc_program_code TEXT,
      prexc_subprogram_code TEXT,
      pap_label TEXT
    );`,
    indexes: [
      "CREATE INDEX budget_cycle_source_rows_department_idx ON budget_cycle_source_rows(source_department_code);",
      "CREATE INDEX budget_cycle_source_rows_subject_idx ON budget_cycle_source_rows(subject_id);",
    ],
  },
  {
    name: "budget_cycle_crosswalk",
    columns: [
      "source_row_id", "subject_id", "source_department_code", "source_agency_code", "source_pap_code",
      "source_pap_label", "historical_portal_department_id", "historical_portal_agency_id",
      "historical_portal_fpap_id", "canonical_portal_department_id", "canonical_portal_agency_id",
      "canonical_portal_fpap_id", "portal_pap_label", "match_method", "match_confidence",
      "candidate_portal_fpap_ids_json", "review_note",
    ],
    create: `CREATE TABLE budget_cycle_crosswalk (
      source_row_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      source_department_code TEXT NOT NULL,
      source_agency_code TEXT NOT NULL,
      source_pap_code TEXT NOT NULL,
      source_pap_label TEXT,
      historical_portal_department_id TEXT,
      historical_portal_agency_id TEXT,
      historical_portal_fpap_id TEXT,
      canonical_portal_department_id TEXT,
      canonical_portal_agency_id TEXT,
      canonical_portal_fpap_id TEXT,
      portal_pap_label TEXT,
      match_method TEXT NOT NULL,
      match_confidence TEXT NOT NULL,
      candidate_portal_fpap_ids_json TEXT NOT NULL,
      review_note TEXT
    );`,
    indexes: [
      "CREATE INDEX budget_cycle_crosswalk_department_idx ON budget_cycle_crosswalk(canonical_portal_department_id, source_department_code);",
      "CREATE INDEX budget_cycle_crosswalk_agency_idx ON budget_cycle_crosswalk(canonical_portal_agency_id);",
      "CREATE INDEX budget_cycle_crosswalk_fpap_idx ON budget_cycle_crosswalk(canonical_portal_fpap_id);",
    ],
  },
  {
    name: "budget_cycle_values",
    columns: [
      "value_id", "source_row_id", "subject_id", "source_sheet", "source_column", "fiscal_year",
      "stage", "expense_class", "amount_pesos", "is_reported", "is_production",
    ],
    sourceWhere: "is_production = 1 AND is_reported = 1",
    create: `CREATE TABLE budget_cycle_values (
      value_id TEXT PRIMARY KEY,
      source_row_id TEXT NOT NULL,
      subject_id TEXT,
      source_sheet TEXT NOT NULL,
      source_column TEXT NOT NULL,
      fiscal_year INTEGER NOT NULL,
      stage TEXT NOT NULL,
      expense_class TEXT NOT NULL,
      amount_pesos REAL,
      is_reported INTEGER NOT NULL,
      is_production INTEGER NOT NULL
    );`,
    indexes: [
      "CREATE INDEX budget_cycle_values_source_row_idx ON budget_cycle_values(source_row_id);",
      "CREATE INDEX budget_cycle_values_slice_idx ON budget_cycle_values(fiscal_year, stage, expense_class);",
    ],
  },
  {
    name: "budget_cycle_subjects",
    columns: [
      "subject_id", "source_sheet", "display_name", "is_primary_subject", "canonical_portal_department_id",
      "canonical_portal_agency_id", "source_pairs_json", "coverage_json",
    ],
    create: `CREATE TABLE budget_cycle_subjects (
      subject_id TEXT PRIMARY KEY,
      source_sheet TEXT NOT NULL,
      display_name TEXT NOT NULL,
      is_primary_subject INTEGER NOT NULL,
      canonical_portal_department_id TEXT,
      canonical_portal_agency_id TEXT,
      source_pairs_json TEXT NOT NULL,
      coverage_json TEXT NOT NULL
    );`,
    indexes: [
      "CREATE INDEX budget_cycle_subjects_department_idx ON budget_cycle_subjects(canonical_portal_department_id);",
    ],
  },
  {
    name: "budget_cycle_quality_flags",
    columns: [
      "quality_flag_id", "severity", "code", "source_sheet", "source_row_id", "subject_id",
      "fiscal_year", "stage", "message", "details_json",
    ],
    create: `CREATE TABLE budget_cycle_quality_flags (
      quality_flag_id TEXT PRIMARY KEY,
      severity TEXT NOT NULL,
      code TEXT NOT NULL,
      source_sheet TEXT NOT NULL,
      source_row_id TEXT,
      subject_id TEXT,
      fiscal_year INTEGER,
      stage TEXT,
      message TEXT NOT NULL,
      details_json TEXT NOT NULL
    );`,
    indexes: [
      "CREATE INDEX budget_cycle_quality_flags_source_row_idx ON budget_cycle_quality_flags(source_row_id);",
      "CREATE INDEX budget_cycle_quality_flags_subject_idx ON budget_cycle_quality_flags(subject_id);",
    ],
  },
  {
    name: "budget_cycle_manifest",
    columns: [
      "schema_version", "generated_at", "source_file", "source_filename", "source_sha256",
      "source_size_bytes", "scope", "units", "years_json", "stages_json", "expense_classes_json",
      "counts_json", "match_counts_json", "quality_counts_json",
    ],
    create: `CREATE TABLE budget_cycle_manifest (
      schema_version TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      source_file TEXT NOT NULL,
      source_filename TEXT NOT NULL,
      source_sha256 TEXT NOT NULL,
      source_size_bytes INTEGER NOT NULL,
      scope TEXT NOT NULL,
      units TEXT NOT NULL,
      years_json TEXT NOT NULL,
      stages_json TEXT NOT NULL,
      expense_classes_json TEXT NOT NULL,
      counts_json TEXT NOT NULL,
      match_counts_json TEXT NOT NULL,
      quality_counts_json TEXT NOT NULL
    );`,
    indexes: [],
  },
];

function argValue(key: string): string | undefined {
  return process.argv.slice(2).find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
}

function literal(value: unknown): string {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function writeChunk(stream: NodeJS.WritableStream, chunk: string): Promise<void> {
  return new Promise<void>((done, fail) => {
    const onError = (error: Error) => {
      stream.off("error", onError);
      fail(error);
    };
    stream.once("error", onError);
    const accepted = stream.write(chunk, () => {
      stream.off("error", onError);
      done();
    });
    if (!accepted) stream.once("drain", () => undefined);
  });
}

type Conn = Awaited<ReturnType<Awaited<ReturnType<typeof DuckDBInstance.create>>["connect"]>>;

async function dumpTable(conn: Conn, spec: TableSpec, output: NodeJS.WritableStream): Promise<number> {
  const where = spec.sourceWhere ? ` WHERE ${spec.sourceWhere}` : "";
  const reader = await conn.streamAndRead(`SELECT ${spec.columns.join(", ")} FROM source.${spec.name}${where}`);
  const prefix = `INSERT INTO ${spec.name} (${spec.columns.join(", ")}) VALUES `;
  let tuples: string[] = [];
  let consumed = 0;
  let total = 0;

  const flush = async () => {
    if (!tuples.length) return;
    await writeChunk(output, `${prefix}${tuples.join(",")};\n`);
    tuples = [];
  };

  while (true) {
    await reader.readUntil(consumed + READ_CHUNK);
    const available = reader.currentRowCount;
    if (available === consumed) break;
    for (let row = consumed; row < available; row++) {
      const values = spec.columns.map((_, column) => literal(reader.value(column, row)));
      tuples.push(`(${values.join(",")})`);
      total += 1;
      if (tuples.length >= BATCH_ROWS) await flush();
    }
    consumed = available;
    if (reader.done) break;
  }
  await flush();
  return total;
}

async function main(): Promise<void> {
  const database = resolve(argValue("database") ?? "data/budget-cycle/budget-cycle.sqlite");
  const outputPath = resolve(argValue("output") ?? "data/budget-cycle/d1-import.sql");
  if (!existsSync(database)) throw new Error(`Normalized database not found: ${database}`);
  mkdirSync(dirname(outputPath), { recursive: true });

  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();
  await conn.run("INSTALL sqlite; LOAD sqlite;");
  await conn.run(`ATTACH '${database.replace(/'/g, "''")}' AS source (TYPE SQLITE, READ_ONLY)`);

  const output = createWriteStream(outputPath);
  for (const spec of [...TABLES].reverse()) {
    await writeChunk(output, `DROP TABLE IF EXISTS ${spec.name};\n`);
  }
  await writeChunk(output, "\n");

  const counts: Record<string, number> = {};
  for (const spec of TABLES) {
    await writeChunk(output, `${spec.create}\n`);
    counts[spec.name] = await dumpTable(conn, spec, output);
    for (const index of spec.indexes) await writeChunk(output, `${index}\n`);
    await writeChunk(output, "\n");
    process.stdout.write(`  ${spec.name.padEnd(34)} ${counts[spec.name].toLocaleString()} rows\n`);
  }

  await new Promise<void>((done) => output.end(done));
  const sizeMb = statSync(outputPath).size / 1024 ** 2;
  process.stdout.write(`\nWrote ${outputPath} (${sizeMb.toFixed(1)} MB)\n`);
  process.stdout.write(`Load locally with: npx wrangler d1 execute budget --local --file=${outputPath}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
