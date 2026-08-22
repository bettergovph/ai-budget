/**
 * Structural verification for data/budget-cycle/budget-cycle.sqlite.
 *
 * Usage:
 *   npm run verify:cycle
 *   npm run verify:cycle -- --database=/path/to/budget-cycle.sqlite
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

function argValue(key: string): string | undefined {
  return process.argv.slice(2).find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
}

function escaped(path: string): string {
  return path.replace(/'/g, "''");
}

type Conn = Awaited<ReturnType<Awaited<ReturnType<typeof DuckDBInstance.create>>["connect"]>>;

async function numberValue(conn: Conn, sql: string): Promise<number> {
  const result = await conn.runAndReadAll(sql);
  return Number(result.getRows()[0][0]);
}

async function rows(conn: Conn, sql: string): Promise<unknown[][]> {
  const result = await conn.runAndReadAll(sql);
  return result.getRows();
}

async function main(): Promise<void> {
  const database = resolve(argValue("database") ?? "data/budget-cycle/budget-cycle.sqlite");
  if (!existsSync(database)) throw new Error(`Normalized database not found: ${database}`);

  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();
  await conn.run("INSTALL sqlite; LOAD sqlite;");
  await conn.run(`ATTACH '${escaped(database)}' AS cycle (TYPE SQLITE, READ_ONLY)`);

  const requiredTables = [
    "budget_cycle_source_columns",
    "budget_cycle_source_rows",
    "budget_cycle_values",
    "budget_cycle_crosswalk",
    "budget_cycle_subjects",
    "budget_cycle_quality_flags",
    "budget_cycle_manifest",
  ];
  const present = new Set(
    (await rows(
      conn,
      "SELECT table_name FROM information_schema.tables WHERE table_catalog='cycle' ORDER BY table_name",
    )).map((row) => String(row[0])),
  );
  const missing = requiredTables.filter((table) => !present.has(table));
  if (missing.length) throw new Error(`Missing normalized tables: ${missing.join(", ")}`);

  const manifestRows = await rows(conn, "SELECT * FROM cycle.budget_cycle_manifest LIMIT 1");
  if (!manifestRows.length) throw new Error("budget_cycle_manifest is empty");
  const manifestDescription = await rows(conn, "DESCRIBE cycle.budget_cycle_manifest");
  const manifestColumns = manifestDescription.map((row) => String(row[0]));
  const manifest = Object.fromEntries(manifestColumns.map((column, index) => [column, manifestRows[0][index]]));
  const counts = JSON.parse(String(manifest.counts_json)) as Record<string, number>;

  const actualCounts: Record<string, number> = {
    source_columns: await numberValue(conn, "SELECT COUNT(*) FROM cycle.budget_cycle_source_columns"),
    source_rows: await numberValue(conn, "SELECT COUNT(*) FROM cycle.budget_cycle_source_rows"),
    production_source_rows: await numberValue(
      conn,
      "SELECT COUNT(*) FROM cycle.budget_cycle_source_rows WHERE is_production",
    ),
    normalized_values: await numberValue(conn, "SELECT COUNT(*) FROM cycle.budget_cycle_values"),
    reported_values: await numberValue(
      conn,
      "SELECT COUNT(*) FROM cycle.budget_cycle_values WHERE is_reported",
    ),
    subjects: await numberValue(conn, "SELECT COUNT(*) FROM cycle.budget_cycle_subjects"),
    primary_subjects: await numberValue(
      conn,
      "SELECT COUNT(*) FROM cycle.budget_cycle_subjects WHERE is_primary_subject",
    ),
    crosswalk_rows: await numberValue(conn, "SELECT COUNT(*) FROM cycle.budget_cycle_crosswalk"),
    quality_flags: await numberValue(conn, "SELECT COUNT(*) FROM cycle.budget_cycle_quality_flags"),
  };

  const structuralErrors: string[] = [];
  for (const [key, actual] of Object.entries(actualCounts)) {
    const expected = counts[key];
    if (expected != null && expected !== actual) {
      structuralErrors.push(`${key}: manifest=${expected}, actual=${actual}`);
    }
  }

  const crosswalkCoverage = await numberValue(
    conn,
    `SELECT COUNT(*)
     FROM cycle.budget_cycle_source_rows r
     LEFT JOIN cycle.budget_cycle_crosswalk x ON x.source_row_id = r.source_row_id
     WHERE r.is_production AND x.source_row_id IS NULL`,
  );
  if (crosswalkCoverage) structuralErrors.push(`${crosswalkCoverage} production source rows lack crosswalk records`);

  const duplicateValues = await numberValue(
    conn,
    `SELECT COUNT(*) FROM (
       SELECT source_row_id, source_column, COUNT(*) AS n
       FROM cycle.budget_cycle_values
       GROUP BY source_row_id, source_column
       HAVING COUNT(*) > 1
     )`,
  );
  if (duplicateValues) structuralErrors.push(`${duplicateValues} duplicate source-row/source-column values`);

  const orphanValues = await numberValue(
    conn,
    `SELECT COUNT(*)
     FROM cycle.budget_cycle_values v
     LEFT JOIN cycle.budget_cycle_source_rows r ON r.source_row_id = v.source_row_id
     WHERE r.source_row_id IS NULL`,
  );
  if (orphanValues) structuralErrors.push(`${orphanValues} normalized values lack source rows`);

  const duplicateCanonicalTotals = await numberValue(
    conn,
    `SELECT COUNT(*) FROM (
       SELECT
         v.subject_id,
         COALESCE(x.canonical_portal_fpap_id, x.source_pap_code),
         v.fiscal_year,
         v.stage,
         COUNT(*) AS n
       FROM cycle.budget_cycle_values v
       JOIN cycle.budget_cycle_crosswalk x ON x.source_row_id = v.source_row_id
       WHERE v.is_production
         AND v.is_reported
         AND v.expense_class = 'total'
         AND v.amount_pesos > 0
       GROUP BY 1, 2, 3, 4
       HAVING COUNT(*) > 1
     )`,
  );
  if (duplicateCanonicalTotals) {
    structuralErrors.push(
      `${duplicateCanonicalTotals} canonical P/A/P-year-stage groups contain duplicate positive TOTAL facts`,
    );
  }

  const productionNegativeAmounts = await numberValue(
    conn,
    `SELECT COUNT(*)
     FROM cycle.budget_cycle_values
     WHERE is_production AND is_reported AND amount_pesos < 0`,
  );
  if (productionNegativeAmounts) {
    structuralErrors.push(`${productionNegativeAmounts} production facts contain negative amounts`);
  }

  const matchMethods = await rows(
    conn,
    `SELECT match_method, COUNT(*) AS rows
     FROM cycle.budget_cycle_crosswalk
     GROUP BY match_method ORDER BY rows DESC, match_method`,
  );
  const flagCounts = await rows(
    conn,
    `SELECT severity, code, COUNT(*) AS rows
     FROM cycle.budget_cycle_quality_flags
     GROUP BY severity, code ORDER BY severity, code`,
  );
  const valueState = await rows(
    conn,
    `SELECT
       COUNT(*) FILTER (WHERE is_reported) AS reported,
       COUNT(*) FILTER (WHERE is_reported AND amount_pesos = 0) AS reported_zero,
       COUNT(*) FILTER (WHERE NOT is_reported AND amount_pesos IS NULL) AS not_reported_null
     FROM cycle.budget_cycle_values`,
  );
  const primaryCoverage = await rows(
    conn,
    `SELECT display_name, canonical_portal_agency_id, coverage_json
     FROM cycle.budget_cycle_subjects
     WHERE is_primary_subject
     ORDER BY source_sheet, display_name`,
  );
  const specialRelationships = await rows(
    conn,
    `SELECT display_name, source_pairs_json, canonical_portal_agency_id
     FROM cycle.budget_cycle_subjects
     WHERE LOWER(display_name) LIKE '%technical education%'
        OR LOWER(display_name) LIKE '%philippine commission on women%'
        OR LOWER(display_name) LIKE '%supreme court%'
     ORDER BY display_name`,
  );
  const unresolvedRows = await rows(
    conn,
    `SELECT
       r.source_row_id,
       r.source_agency_name,
       r.prexc_subprogram_code,
       r.pap_label,
       x.review_note
     FROM cycle.budget_cycle_crosswalk x
     JOIN cycle.budget_cycle_source_rows r ON r.source_row_id = x.source_row_id
     WHERE x.match_method IN ('ambiguous', 'unmatched')
     ORDER BY r.source_row_id`,
  );

  process.stdout.write(`Verified ${database}\n\n`);
  process.stdout.write("Row counts\n");
  for (const [key, value] of Object.entries(actualCounts)) {
    process.stdout.write(`  ${key.padEnd(24)} ${value.toLocaleString()}\n`);
  }
  process.stdout.write("\nCrosswalk methods\n");
  for (const [method, count] of matchMethods) {
    process.stdout.write(`  ${String(method).padEnd(32)} ${Number(count).toLocaleString()}\n`);
  }
  process.stdout.write("\nValue state\n");
  process.stdout.write(`  reported                  ${Number(valueState[0][0]).toLocaleString()}\n`);
  process.stdout.write(`  reported zero             ${Number(valueState[0][1]).toLocaleString()}\n`);
  process.stdout.write(`  not reported / NULL       ${Number(valueState[0][2]).toLocaleString()}\n`);
  process.stdout.write("\nQuality flags\n");
  for (const [severity, code, count] of flagCounts) {
    process.stdout.write(`  ${String(severity).padEnd(8)} ${String(code).padEnd(36)} ${Number(count).toLocaleString()}\n`);
  }
  process.stdout.write("\nSpecial organization relationships\n");
  for (const [name, sourcePairs, canonicalAgency] of specialRelationships) {
    process.stdout.write(`  ${name}\n    source ${sourcePairs} -> canonical ${canonicalAgency}\n`);
  }
  process.stdout.write("\nUnresolved relationships\n");
  if (!unresolvedRows.length) process.stdout.write("  none\n");
  for (const [sourceRowId, agencyName, papCode, papLabel, note] of unresolvedRows) {
    process.stdout.write(
      `  ${sourceRowId}: ${agencyName} / ${papCode} / ${papLabel ?? "(no label)"}${note ? ` — ${note}` : ""}\n`,
    );
  }
  process.stdout.write("\nPrimary subject coverage\n");
  for (const [name, canonicalAgency, coverage] of primaryCoverage) {
    process.stdout.write(`  ${name} (${canonicalAgency ?? "unmapped"})\n    ${coverage}\n`);
  }

  if (structuralErrors.length) {
    throw new Error(`Structural verification failed:\n- ${structuralErrors.join("\n- ")}`);
  }
  process.stdout.write("\nAll structural checks passed. Source quality flags remain visible for review.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
