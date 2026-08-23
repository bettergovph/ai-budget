/**
 * FY2027 National Expenditure Program (NEP) importer.
 *
 * Reads the raw DBM NEP extract (`NEP-FY2027.csv`, 756,629 rows, ~233 MB),
 * normalizes it onto the same canonical column set the existing GAA
 * `data/<dept>/full_extract.csv` files use, joins it against the FY2026 GAA
 * baseline, and emits a per-department aggregation tree under `data/2027/`
 * plus a national index — mirroring the shape the portal already consumes.
 *
 * Source column mapping (NEP → canonical GAA extract column):
 *
 *   SORDER              → sorder              section: 1 = agency budgets, 2 = SPF / automatic
 *   DEPARTMENT          → department          2-digit department code
 *   UACS_DPT_DSC        → uacs_dpt_dsc
 *   AGENCY              → agency              3-digit agency code
 *   UACS_AGY_DSC        → uacs_agy_dsc
 *   PREXC_FPAP_ID       → prexc_fpap_id       15-digit hierarchical P/A/P code
 *   PREXC_LEVEL         → prexc_level         1..7 (7 = leaf activity carrying line items)
 *   DSC                 → dsc                 P/A/P description
 *   UACS_OPERDIV_ID     → uacs_operdiv_id     (DepEd schools divisions etc.)
 *   UACS_DIV_DSC        → uacs_div_dsc
 *   OPERUNIT            → operunit            7-digit operating unit code
 *   UACS_OPER_DSC       → uacs_oper_dsc
 *   UACS_REG_ID         → uacs_reg_id         2-digit region code
 *   UACS_REG_DSC        → (absent from GAA extracts; kept here as region_name)
 *   FUNDCD              → fundcd              8-digit fund subcategory code
 *   UACS_FUNDSUBCAT_DSC → uacs_fundsubcat_dsc
 *   UACS_EXP_CD         → uacs_exp_cd         1 PS, 2 MOOE, 3 FinEx, 6 CO
 *   UACS_EXP_DSC        → uacs_exp_dsc
 *   UACS_OBJ_CD         → uacs_sobj_cd        <-- only real rename
 *   UACS_OBJ_DSC        → uacs_sobj_dsc       <-- only real rename
 *   AMT                 → amt                 thousands of pesos, comma-grouped, "" = no amount
 *
 * Two structural corrections over the legacy GAA tree:
 *
 *  1. `SORDER = 2` rows reuse department codes 01 and 04 for what are really
 *     the Special Purpose Funds and the Automatic Appropriations. The legacy
 *     tree filed ₱2.58 T of automatic appropriations inside DAR (₱17 B) and
 *     ₱448 B of SPFs inside Congress (₱28 B). Here they get their own
 *     department ids, `SPF` and `AUTO`.
 *  2. Rows with no `UACS_OBJ_CD` are P/A/P hierarchy headers, not line items.
 *     They populate the program tree but are excluded from the money-bearing
 *     levels instead of being emitted as `amount: 0` rows.
 *
 * Scale: entity JSONs keep the source scale (THOUSANDS of pesos), matching the
 * legacy `data/<dept>/*.json`. `summary.json` and `national/index.json` are in
 * PESOS, matching the legacy `data/national/index.json`.
 *
 * Usage:
 *   npm run import:nep2027
 *   npm run import:nep2027 -- --dept=07
 *   npm run import:nep2027 -- --lean            # skip the deep per-row levels
 *   npm run import:nep2027 -- --no-baseline     # skip the FY2026 GAA join
 */

import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pipeline } from "node:stream/promises";

const NEP_YEAR = 2027;
const BASE_YEAR = 2026;
/** Source amounts are thousands of pesos. */
const SCALE = 1000;

const DEFAULT_SRC = "/home/jason/projects/2027-budget/NEP-FY2027.csv";
const DEFAULT_OUT = "data/2027";
const DEFAULT_BASELINE = "data/*/full_extract.csv";

interface Args {
  src: string;
  out: string;
  baseline: string | null;
  dept: string | null;
  lean: boolean;
  keepTmp: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  return {
    src: resolve(get("src") ?? DEFAULT_SRC),
    out: resolve(get("out") ?? DEFAULT_OUT),
    baseline: argv.includes("--no-baseline") ? null : resolve(get("baseline") ?? DEFAULT_BASELINE),
    dept: get("dept") ?? null,
    lean: argv.includes("--lean"),
    keepTmp: argv.includes("--keep-tmp"),
  };
}

const q = (s: string) => s.replace(/'/g, "''");

/** DuckDB expression: normalize a raw cell — trim, empty → NULL, pandas "nan" → NULL. */
const clean = (col: string) => `nullif(nullif(trim(${col}), ''), 'nan')`;

/** DuckDB expression: URL-safe slug from a description. */
const slug = (expr: string) =>
  `nullif(trim(BOTH '-' FROM regexp_replace(lower(coalesce(${expr}, '')), '[^a-z0-9]+', '-', 'g')), '')`;

/** DuckDB expression: id path segment — missing codes collapse to 'na'. */
const seg = (col: string) => `coalesce(${col}, 'na')`;

/**
 * Not every line item carries every dimension: 224,390 rows have no operating
 * unit and 432,680 have no division (all of SPF and AUTO, among others).
 * Dropping those rows would make the dimension silently understate the budget
 * — summing operating units nationally would lose ₱3.03 T. They are bucketed
 * under an explicit code instead, so every dimension reconciles to the total
 * and the unattributed share is visible rather than missing.
 */
const UNASSIGNED = "__unassigned__";
const UNASSIGNED_LABEL = "(not attributed)";

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Both years are projected onto one column set. `department_id` is the
 * section-aware key: SORDER=2 rows split out of the numeric department codes
 * they collide with.
 */
function departmentIdExpr(sorderCol: string, deptCol: string): string {
  return `CASE
      WHEN coalesce(${sorderCol}, '1') <> '2' THEN ${deptCol}
      WHEN ${deptCol} = '01' THEN 'SPF'
      WHEN ${deptCol} = '04' THEN 'AUTO'
      ELSE 'X' || ${deptCol}
    END`;
}

/** Human label for the two synthetic departments; passthrough otherwise. */
const deptLabel = (dsc: string) => `CASE department_id
      WHEN 'SPF'  THEN 'Special Purpose Funds (SPF)'
      WHEN 'AUTO' THEN 'Automatic Appropriations (AUTO)'
      ELSE ${dsc} END`;

async function loadNep(c: DuckDBConnection, src: string): Promise<void> {
  await c.run(`
    CREATE OR REPLACE TABLE nep AS
    SELECT
      ${NEP_YEAR}                                       AS fy,
      coalesce(${clean("SORDER")}, '1')                 AS section,
      ${departmentIdExpr(`coalesce(${clean("SORDER")}, '1')`, clean("DEPARTMENT"))} AS department_id,
      ${clean("DEPARTMENT")}                            AS dept_code,
      ${clean("UACS_DPT_DSC")}                          AS dept_dsc,
      ${clean("AGENCY")}                                AS agency_code,
      ${clean("UACS_AGY_DSC")}                          AS agency_dsc,
      ${clean("PREXC_FPAP_ID")}                         AS fpap_code,
      TRY_CAST(${clean("PREXC_LEVEL")} AS INTEGER)      AS prexc_level,
      ${clean("DSC")}                                   AS fpap_dsc,
      ${clean("UACS_OPERDIV_ID")}                       AS div_code,
      ${clean("UACS_DIV_DSC")}                          AS div_dsc,
      ${clean("OPERUNIT")}                              AS operunit_code,
      ${clean("UACS_OPER_DSC")}                         AS operunit_dsc,
      ${clean("UACS_REG_ID")}                           AS region_code,
      ${clean("UACS_REG_DSC")}                          AS region_dsc,
      ${clean("FUNDCD")}                                AS fund_code,
      ${clean("UACS_FUNDSUBCAT_DSC")}                   AS fund_dsc,
      ${clean("UACS_EXP_CD")}                           AS expense_code,
      ${clean("UACS_EXP_DSC")}                          AS expense_dsc,
      ${clean("UACS_OBJ_CD")}                           AS object_code,
      ${clean("UACS_OBJ_DSC")}                          AS object_dsc,
      coalesce(TRY_CAST(replace(${clean("AMT")}, ',', '') AS DOUBLE), 0.0) AS amount
    FROM read_csv('${q(src)}', header = true, all_varchar = true)
    WHERE ${clean("DEPARTMENT")} IS NOT NULL
  `);
}

async function loadBaseline(c: DuckDBConnection, glob: string): Promise<void> {
  // Legacy GAA extracts: lowercase headers, pandas "nan" sentinels, an `amt`
  // already cast to float, and UACS_OBJ_* named uacs_sobj_*. No region names.
  await c.run(`
    CREATE OR REPLACE TABLE gaa AS
    SELECT
      ${BASE_YEAR}                                      AS fy,
      coalesce(${clean("sorder")}, '1')                 AS section,
      ${departmentIdExpr(`coalesce(${clean("sorder")}, '1')`, clean("department"))} AS department_id,
      ${clean("department")}                            AS dept_code,
      ${clean("uacs_dpt_dsc")}                          AS dept_dsc,
      ${clean("agency")}                                AS agency_code,
      ${clean("uacs_agy_dsc")}                          AS agency_dsc,
      ${clean("prexc_fpap_id")}                         AS fpap_code,
      TRY_CAST(${clean("prexc_level")} AS INTEGER)      AS prexc_level,
      ${clean("dsc")}                                   AS fpap_dsc,
      ${clean("uacs_operdiv_id")}                       AS div_code,
      ${clean("uacs_div_dsc")}                          AS div_dsc,
      ${clean("operunit")}                              AS operunit_code,
      ${clean("uacs_oper_dsc")}                         AS operunit_dsc,
      ${clean("uacs_reg_id")}                           AS region_code,
      NULL                                              AS region_dsc,
      ${clean("fundcd")}                                AS fund_code,
      ${clean("uacs_fundsubcat_dsc")}                   AS fund_dsc,
      ${clean("uacs_exp_cd")}                           AS expense_code,
      ${clean("uacs_exp_dsc")}                          AS expense_dsc,
      ${clean("uacs_sobj_cd")}                          AS object_code,
      ${clean("uacs_sobj_dsc")}                         AS object_dsc,
      coalesce(TRY_CAST(amt AS DOUBLE), 0.0)            AS amount
    FROM read_csv('${q(glob)}', header = true, all_varchar = true, union_by_name = true)
    WHERE year = '${BASE_YEAR}' AND ${clean("department")} IS NOT NULL
  `);
}

/**
 * Union both years, backfill region names (the FY2026 extracts carry codes
 * only, and the NEP leaves them blank on the SORDER=2 rows), and derive the
 * P/A/P program rollup.
 *
 * PREXC_FPAP_ID is positional: digit 1 = major class, digits 1-2 = outcome,
 * 1-4 = program, 1-6 = sub-program, 1-9 = project group, all 15 = activity.
 * `program_code` resolves to the nearest ancestor that actually exists as a
 * header row within the same agency, walking 6 → 4 → 2 → 1 digits.
 */
async function buildFacts(c: DuckDBConnection, hasBaseline: boolean): Promise<void> {
  await c.run(`
    CREATE OR REPLACE TABLE facts_raw AS
    SELECT * FROM nep
    ${hasBaseline ? "UNION ALL BY NAME SELECT * FROM gaa" : ""}
  `);

  await c.run(`
    CREATE OR REPLACE TABLE region_names AS
    SELECT region_code, max(region_dsc) AS region_dsc
    FROM facts_raw WHERE region_code IS NOT NULL AND region_dsc IS NOT NULL
    GROUP BY 1
  `);

  // Header rows (levels 1-6) define the program tree.
  await c.run(`
    CREATE OR REPLACE TABLE headers AS
    SELECT department_id, agency_code, fpap_code,
           min(prexc_level) AS prexc_level,
           max(fpap_dsc)    AS fpap_dsc
    FROM facts_raw
    WHERE prexc_level IS NOT NULL AND prexc_level < 7 AND fpap_code IS NOT NULL
    GROUP BY 1, 2, 3
  `);

  const ancestor = (n: number) =>
    `substr(f.fpap_code, 1, ${n}) || repeat('0', 15 - ${n})`;

  await c.run(`
    CREATE OR REPLACE TABLE facts AS
    SELECT
      f.* EXCLUDE (region_dsc, dept_dsc),
      coalesce(f.dept_dsc, dl.dept_dsc)                        AS dept_dsc,
      CASE WHEN f.region_code = '00' THEN 'Central Office (nationwide)'
           ELSE coalesce(f.region_dsc, rn.region_dsc,
                         CASE WHEN f.region_code IS NULL THEN NULL
                              ELSE 'Region ' || f.region_code END) END AS region_dsc,
      coalesce(h6.fpap_code, h4.fpap_code, h2.fpap_code, h1.fpap_code) AS program_code,
      coalesce(h6.fpap_dsc,  h4.fpap_dsc,  h2.fpap_dsc,  h1.fpap_dsc)  AS program_dsc,
      CASE substr(f.fpap_code, 1, 1)
        WHEN '1' THEN 'General Administration and Support'
        WHEN '2' THEN 'Support to Operations'
        WHEN '3' THEN 'Operations'
        WHEN '4' THEN 'Special Purpose / Automatic'
        ELSE NULL END                                          AS major_class,
      (f.object_code IS NOT NULL)                              AS is_item
    FROM facts_raw f
    LEFT JOIN region_names rn USING (region_code)
    LEFT JOIN (
      SELECT department_id, max(dept_dsc) AS dept_dsc FROM facts_raw
      WHERE dept_dsc IS NOT NULL GROUP BY 1
    ) dl ON dl.department_id = f.department_id
    LEFT JOIN headers h6 ON h6.department_id = f.department_id
      AND h6.agency_code = f.agency_code AND h6.fpap_code = ${ancestor(6)}
    LEFT JOIN headers h4 ON h4.department_id = f.department_id
      AND h4.agency_code = f.agency_code AND h4.fpap_code = ${ancestor(4)}
    LEFT JOIN headers h2 ON h2.department_id = f.department_id
      AND h2.agency_code = f.agency_code AND h2.fpap_code = ${ancestor(2)}
    LEFT JOIN headers h1 ON h1.department_id = f.department_id
      AND h1.agency_code = f.agency_code AND h1.fpap_code = ${ancestor(1)}
  `);

  await c.run(`CREATE OR REPLACE TABLE items AS SELECT * FROM facts WHERE is_item`);
}

// ---------------------------------------------------------------------------
// Emit helpers
// ---------------------------------------------------------------------------

/** `years: {"2026": {count, amount}, "2027": {count, amount}}` + delta/pct. */
const YEAR_AGGS = `
      count(*) FILTER (fy = ${BASE_YEAR})                    AS c_base,
      coalesce(sum(amount) FILTER (fy = ${BASE_YEAR}), 0.0)  AS a_base,
      count(*) FILTER (fy = ${NEP_YEAR})                     AS c_nep,
      coalesce(sum(amount) FILTER (fy = ${NEP_YEAR}), 0.0)   AS a_nep`;

const YEAR_STRUCT = `
      {'${BASE_YEAR}': {'count': c_base, 'amount': a_base},
       '${NEP_YEAR}':  {'count': c_nep,  'amount': a_nep}}          AS years,
      a_nep - a_base                                                AS delta,
      CASE WHEN a_base = 0 THEN NULL
           ELSE round((a_nep - a_base) / a_base * 100, 4) END       AS pct`;

/**
 * Write `{ "metadata": {...}, "data": [ ... ] }` without ever holding the
 * array in memory — DuckDB streams the array to a temp file which is then
 * piped between the envelope's braces.
 */
async function writeEnvelope(
  c: DuckDBConnection,
  outPath: string,
  selectSql: string,
  metadata: Record<string, unknown>,
): Promise<number> {
  await mkdir(dirname(outPath), { recursive: true });
  const tmp = `${outPath}.array.tmp`;
  await rm(tmp, { force: true });
  await c.run(`COPY (${selectSql}) TO '${q(tmp)}' (FORMAT JSON, ARRAY true)`);

  const rows = await scalar(c, `SELECT count(*) FROM (${selectSql})`);
  const out = createWriteStream(outPath);
  const meta = { ...metadata, total_items: Number(rows) };
  out.write(`{\n  "metadata": ${JSON.stringify(meta, null, 2).replace(/\n/g, "\n  ")},\n  "data": `);
  await pipeline(createReadStream(tmp), out, { end: false });
  await new Promise<void>((res, rej) => {
    out.once("error", rej);
    out.end("\n}\n", () => res());
  });
  await rm(tmp, { force: true });
  return Number(rows);
}

async function scalar(c: DuckDBConnection, sql: string): Promise<unknown> {
  const r = await c.runAndReadAll(sql);
  const rows = r.getRows();
  return rows.length ? rows[0][0] : null;
}

async function rowsOf<T = Record<string, unknown>>(
  c: DuckDBConnection,
  sql: string,
): Promise<T[]> {
  const r = await c.runAndReadAll(sql);
  const cols = r.columnNames();
  return r.getRows().map((row) => {
    const o: Record<string, unknown> = {};
    cols.forEach((name, i) => {
      const v = row[i];
      o[name] = typeof v === "bigint" ? Number(v) : v;
    });
    return o as T;
  });
}

// ---------------------------------------------------------------------------
// Level definitions
// ---------------------------------------------------------------------------

interface Level {
  file: string;
  title: string;
  /** Skipped under --lean (one output row per source line item). */
  heavy?: boolean;
  /** Aggregate over all rows (program tree) rather than money-bearing items. */
  source?: "facts" | "items";
  codeField: string;
  codeExpr: string;
  descExpr: string;
  /** Group-by expressions after department_id. */
  groupBy: string[];
  /** id path segments after department_id. */
  idSegs: string[];
  /** Extra output columns: [alias, expression-over-the-aggregate]. */
  extra?: Array<[string, string]>;
  /** Foreign keys: [alias, id-path-segment-count]. */
  fks: Array<[string, number]>;
}

const AG = ["agency_code"];
const FP = [...AG, "fpap_code"];
const OU = [...FP, "operunit_code"];
const FU = [...OU, "fund_code"];
const EX = [...FU, "expense_code"];
const OB = [...EX, "object_code"];

const LEVELS: Level[] = [
  {
    file: "agencies",
    title: "Agencies",
    codeField: "agency_code",
    codeExpr: "agency_code",
    descExpr: "agency_dsc",
    groupBy: AG,
    idSegs: AG,
    fks: [],
  },
  {
    file: "programs",
    title: "Programs",
    source: "items",
    codeField: "program_code",
    codeExpr: "program_code",
    descExpr: "program_dsc",
    groupBy: ["agency_code", "program_code"],
    idSegs: ["agency_code", "program_code"],
    extra: [["major_class", "any_value(major_class)"]],
    fks: [["agency_id", 1]],
  },
  {
    file: "fpaps",
    title: "Fpaps",
    heavy: true,
    source: "facts",
    codeField: "fpap_code",
    codeExpr: "fpap_code",
    descExpr: "fpap_dsc",
    groupBy: FP,
    idSegs: FP,
    extra: [
      ["prexc_level", "min(prexc_level)"],
      ["program_code", "any_value(program_code)"],
      ["major_class", "any_value(major_class)"],
    ],
    fks: [["agency_id", 1]],
  },
  {
    file: "operating_units",
    title: "Operating Units",
    heavy: true,
    codeField: "operunit_code",
    codeExpr: "operunit_code",
    descExpr: "operunit_dsc",
    groupBy: OU,
    idSegs: OU,
    fks: [["fpap_id", 2], ["agency_id", 1]],
  },
  {
    file: "fund_subcategories",
    title: "Fund Subcategories",
    heavy: true,
    codeField: "fund_code",
    codeExpr: "fund_code",
    descExpr: "fund_dsc",
    groupBy: FU,
    idSegs: FU,
    fks: [["operating_unit_id", 3], ["fpap_id", 2], ["agency_id", 1]],
  },
  {
    file: "expenses",
    title: "Expenses",
    heavy: true,
    codeField: "expense_code",
    codeExpr: "expense_code",
    descExpr: "expense_dsc",
    groupBy: EX,
    idSegs: EX,
    fks: [["fund_id", 4], ["operating_unit_id", 3], ["fpap_id", 2], ["agency_id", 1]],
  },
  {
    file: "objects",
    title: "Objects",
    heavy: true,
    codeField: "object_code",
    codeExpr: "object_code",
    descExpr: "object_dsc",
    groupBy: OB,
    idSegs: OB,
    fks: [
      ["expense_id", 5], ["fund_id", 4], ["operating_unit_id", 3],
      ["fpap_id", 2], ["agency_id", 1],
    ],
  },
  {
    file: "regions",
    title: "Regions",
    source: "items",
    codeField: "region_code",
    codeExpr: "region_code",
    descExpr: "region_dsc",
    groupBy: ["region_code"],
    idSegs: ["region_code"],
    fks: [],
  },
  {
    file: "expense_classes",
    title: "Expense Classes",
    source: "items",
    codeField: "expense_code",
    codeExpr: "expense_code",
    descExpr: "expense_dsc",
    groupBy: ["expense_code"],
    idSegs: ["expense_code"],
    fks: [],
  },
];

function levelSql(level: Level, deptId: string): string {
  const src = level.source === "facts" ? "facts" : "items";
  const idPath = ["department_id", ...level.idSegs.map(seg)].join(` || '-' || `);
  const fkCols = level.fks
    .map(([alias, n]) => {
      const path = ["department_id", ...level.idSegs.slice(0, n).map(seg)].join(` || '-' || `);
      return `      ${path} AS ${alias},`;
    })
    .join("\n");
  const extraSel = (level.extra ?? []).map(([alias]) => `      ${alias},`).join("\n");
  const extraAgg = (level.extra ?? [])
    .map(([alias, expr]) => `      ${expr} AS ${alias},`)
    .join("\n");

  return `
    WITH g AS (
      SELECT
        department_id,
        ${level.groupBy.join(",\n        ")},
        coalesce(max(${level.descExpr}) FILTER (fy = ${NEP_YEAR}),
                 max(${level.descExpr}))                       AS description,
${extraAgg}${YEAR_AGGS}
      FROM ${src}
      WHERE department_id = '${q(deptId)}'
      GROUP BY department_id, ${level.groupBy.join(", ")}
    )
    SELECT
      ${idPath}                                                AS id,
      coalesce(${slug("description")}, 'unclassified')          AS slug,
      ${level.codeExpr}                                        AS ${level.codeField},
      coalesce(description, '(not specified)')                 AS description,
${extraSel}${fkCols}
      department_id,
${YEAR_STRUCT}
    FROM g
    ORDER BY a_nep DESC, id
  `;
}

// ---------------------------------------------------------------------------
// Per-department summary (small; drives the /2027 microsite)
// ---------------------------------------------------------------------------

/** Rollup used repeatedly by summary.json; amounts already scaled to pesos. */
function rollupSql(
  deptId: string,
  codeExpr: string,
  descExpr: string,
  opts: { source?: string; limit?: number; extra?: string } = {},
): string {
  const src = opts.source ?? "items";
  return `
    SELECT
      coalesce(${codeExpr}, '${UNASSIGNED}')                   AS code,
      coalesce(max(${descExpr}) FILTER (fy = ${NEP_YEAR}), max(${descExpr}),
               '${UNASSIGNED_LABEL}')                          AS description,
      ${opts.extra ? `${opts.extra},` : ""}
      count(*) FILTER (fy = ${NEP_YEAR})                       AS count,
      coalesce(sum(amount) FILTER (fy = ${NEP_YEAR}), 0.0) * ${SCALE}  AS amount,
      coalesce(sum(amount) FILTER (fy = ${BASE_YEAR}), 0.0) * ${SCALE} AS base_amount,
      (coalesce(sum(amount) FILTER (fy = ${NEP_YEAR}), 0.0)
       - coalesce(sum(amount) FILTER (fy = ${BASE_YEAR}), 0.0)) * ${SCALE} AS delta
    FROM ${src}
    WHERE department_id = '${q(deptId)}'
    GROUP BY 1
    ORDER BY amount DESC
    ${opts.limit ? `LIMIT ${opts.limit}` : ""}
  `;
}

async function buildSummary(
  c: DuckDBConnection,
  deptId: string,
  generatedAt: string,
): Promise<Record<string, unknown>> {
  const [dept] = await rowsOf(c, `
    SELECT
      department_id                                            AS id,
      coalesce(${slug(deptLabel("any_value(dept_dsc)"))},
               'department-' || lower(department_id))           AS slug,
      coalesce(${deptLabel("any_value(dept_dsc)")},
               'Department ' || department_id)                  AS description,
      any_value(dept_dsc)                                      AS source_description,
      any_value(section)                                       AS section,
      any_value(dept_code)                                     AS source_department_code,
      count(*) FILTER (fy = ${NEP_YEAR})                       AS line_items,
      coalesce(sum(amount) FILTER (fy = ${NEP_YEAR}), 0.0) * ${SCALE}  AS amount,
      coalesce(sum(amount) FILTER (fy = ${BASE_YEAR}), 0.0) * ${SCALE} AS base_amount
    FROM items WHERE department_id = '${q(deptId)}'
    GROUP BY department_id
  `);

  const [counts] = await rowsOf(c, `
    SELECT
      count(DISTINCT agency_code)    AS agencies,
      count(DISTINCT program_code)   AS programs,
      count(DISTINCT fpap_code)      AS activities,
      count(DISTINCT operunit_code)  AS operating_units,
      count(DISTINCT object_code)    AS objects,
      count(DISTINCT region_code)    AS regions
    FROM items WHERE department_id = '${q(deptId)}' AND fy = ${NEP_YEAR}
  `);

  const [agencies, expenseClasses, funds, regions, programs, objects, units, divisions] =
    await Promise.all([
      rowsOf(c, rollupSql(deptId, "agency_code", "agency_dsc")),
      rowsOf(c, rollupSql(deptId, "expense_code", "expense_dsc")),
      rowsOf(c, rollupSql(deptId, "fund_code", "fund_dsc", { limit: 40 })),
      rowsOf(c, rollupSql(deptId, "region_code", "region_dsc")),
      rowsOf(c, rollupSql(deptId, "program_code", "program_dsc", {
        limit: 200,
        extra: "any_value(major_class) AS major_class",
      })),
      rowsOf(c, rollupSql(deptId, "object_code", "object_dsc", { limit: 60 })),
      rowsOf(c, rollupSql(deptId, "operunit_code", "operunit_dsc", { limit: 60 })),
      rowsOf(c, rollupSql(deptId, "div_code", "div_dsc", { limit: 60 })),
    ]);

  const movers = [...programs].filter((p) => Number(p.base_amount) > 0 || Number(p.amount) > 0);
  const byDelta = [...movers].sort((a, b) => Number(b.delta) - Number(a.delta));
  const moversUp = byDelta.filter((p) => Number(p.delta) > 0);
  const moversDown = byDelta.filter((p) => Number(p.delta) < 0).reverse();

  return {
    generated_at: generatedAt,
    fiscal_year: NEP_YEAR,
    baseline_year: BASE_YEAR,
    scale: "pesos",
    department: dept ?? null,
    counts: counts ?? null,
    agencies,
    expense_classes: expenseClasses,
    fund_subcategories: funds,
    regions,
    programs,
    top_objects: objects,
    top_operating_units: units,
    top_divisions: divisions,
    top_movers_up: moversUp.slice(0, 10),
    top_movers_down: moversDown.slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// D1 export
// ---------------------------------------------------------------------------

/**
 * Emit `data/2027/d1-import.sql` — the aggregation layer the microsite queries
 * live.
 *
 * Deliberately additive: `nep_*` tables sit alongside the FY2020–2026 GAA
 * tables and never touch them, so publishing FY2027 cannot move a single
 * already-published GAA figure. It also lets FY2027 keep the corrected
 * SPF/AUTO department split without forcing the same migration on the legacy
 * tables.
 *
 * Line items stay in parquet. Only the rollups live here — they are what has
 * to be fast, and what has to be queryable *across* departments.
 *
 * Money is stored as INTEGER pesos. Every source amount is an integral number
 * of thousands (asserted below), so pesos are exact and no float ever touches
 * a budget figure.
 */

/** SQL literal for a possibly-null text column. */
const lit = (expr: string) =>
  `CASE WHEN ${expr} IS NULL THEN 'NULL' ELSE '''' || replace(${expr}, '''', '''''') || '''' END`;

/** Exact peso amount as an integer literal. */
const pesos = (expr: string) => `CAST(ROUND(coalesce(${expr}, 0) * ${SCALE}) AS HUGEINT)::VARCHAR`;

const D1_SCHEMA = `
DROP TABLE IF EXISTS nep_rollups;
DROP TABLE IF EXISTS nep_departments;
DROP TABLE IF EXISTS nep_meta;

CREATE TABLE nep_meta (
  fiscal_year   INTEGER NOT NULL,
  baseline_year INTEGER NOT NULL,
  generated_at  TEXT    NOT NULL,
  source_file   TEXT    NOT NULL,
  line_items    INTEGER NOT NULL,
  amount        INTEGER NOT NULL,
  base_amount   INTEGER NOT NULL
);

CREATE TABLE nep_departments (
  id                     TEXT PRIMARY KEY,
  slug                   TEXT,
  description            TEXT,
  source_description     TEXT,
  source_department_code TEXT,
  section                TEXT,
  line_items             INTEGER NOT NULL,
  amount                 INTEGER NOT NULL,
  base_amount            INTEGER NOT NULL,
  agencies               INTEGER,
  programs               INTEGER,
  activities             INTEGER,
  operating_units        INTEGER,
  objects                INTEGER,
  regions                INTEGER
);

-- One row per (department, dimension, code). Every dimension is COMPLETE, not
-- top-N, so summing across departments gives an exact national total.
CREATE TABLE nep_rollups (
  department_id TEXT    NOT NULL,
  dimension     TEXT    NOT NULL,
  code          TEXT    NOT NULL,
  description   TEXT,
  extra         TEXT,
  count         INTEGER NOT NULL,
  amount        INTEGER NOT NULL,
  base_amount   INTEGER NOT NULL,
  PRIMARY KEY (department_id, dimension, code)
);
CREATE INDEX nep_rollups_dim_idx      ON nep_rollups(dimension, code);
CREATE INDEX nep_rollups_dept_dim_idx ON nep_rollups(department_id, dimension);
`;

/** dimension name → [code expression, description expression, extra expression]. */
const D1_DIMENSIONS: ReadonlyArray<[string, string, string, string | null]> = [
  ["agency", "agency_code", "agency_dsc", null],
  ["program", "program_code", "program_dsc", "any_value(major_class)"],
  ["expense_class", "expense_code", "expense_dsc", null],
  ["fund", "fund_code", "fund_dsc", null],
  ["region", "region_code", "region_dsc", null],
  ["object", "object_code", "object_dsc", null],
  ["operating_unit", "operunit_code", "operunit_dsc", null],
  ["division", "div_code", "div_dsc", null],
];

/** Rows per INSERT — keeps individual statements well inside wrangler's limits. */
const D1_BATCH = 400;

async function writeD1Sql(
  c: DuckDBConnection,
  outPath: string,
  generatedAt: string,
  sourceFile: string,
): Promise<{ bytes: number; rows: number }> {
  // Guard the INTEGER-pesos decision rather than trusting it.
  const fractional = Number(
    await scalar(c, `SELECT count(*) FROM items WHERE amount <> floor(amount)`),
  );
  if (fractional > 0) {
    throw new Error(
      `${fractional} source amounts are not integral thousands; INTEGER peso storage would round. ` +
      `Change nep_* amount columns to REAL before continuing.`,
    );
  }

  const out = createWriteStream(outPath);
  const write = (s: string) =>
    out.write(s) ? Promise.resolve() : new Promise<void>((r) => out.once("drain", () => r()));

  await write(`-- FY${NEP_YEAR} NEP aggregation layer for D1.\n`);
  await write(`-- Generated ${generatedAt} by scripts/import-nep-2027.ts from ${sourceFile}.\n`);
  await write(`-- Additive: these tables do not touch the FY2020-2026 GAA tables.\n`);
  await write(`-- Amounts are exact INTEGER pesos (source thousands x ${SCALE}).\n`);
  await write(D1_SCHEMA);

  let rows = 0;

  // -- nep_meta -------------------------------------------------------------
  const metaRow = (await rowsOf(c, `
    SELECT count(*) FILTER (fy = ${NEP_YEAR}) AS n,
           ${pesos(`sum(amount) FILTER (fy = ${NEP_YEAR})`)} AS amt,
           ${pesos(`sum(amount) FILTER (fy = ${BASE_YEAR})`)} AS base
    FROM items
  `))[0];
  const esc = (s: string) => s.replace(/'/g, "''");
  await write(
    `\nINSERT INTO nep_meta VALUES (${NEP_YEAR}, ${BASE_YEAR}, '${esc(generatedAt)}', ` +
    `'${esc(sourceFile)}', ${metaRow.n}, ${metaRow.amt}, ${metaRow.base});\n`,
  );
  rows++;

  // -- nep_departments ------------------------------------------------------
  const deptValues = await rowsOf<{ v: string }>(c, `
    WITH d AS (
      SELECT department_id,
             any_value(dept_dsc)  AS dept_dsc,
             any_value(section)   AS section,
             any_value(dept_code) AS dept_code,
             count(*) FILTER (fy = ${NEP_YEAR})                       AS line_items,
             ${pesos(`sum(amount) FILTER (fy = ${NEP_YEAR})`)}        AS amount,
             ${pesos(`sum(amount) FILTER (fy = ${BASE_YEAR})`)}       AS base_amount,
             count(DISTINCT agency_code)   FILTER (fy = ${NEP_YEAR}) AS agencies,
             count(DISTINCT program_code)  FILTER (fy = ${NEP_YEAR}) AS programs,
             count(DISTINCT fpap_code)     FILTER (fy = ${NEP_YEAR}) AS activities,
             count(DISTINCT operunit_code) FILTER (fy = ${NEP_YEAR}) AS operating_units,
             count(DISTINCT object_code)   FILTER (fy = ${NEP_YEAR}) AS objects,
             count(DISTINCT region_code)   FILTER (fy = ${NEP_YEAR}) AS regions
      FROM items GROUP BY department_id
    )
    SELECT '(' || ${lit("department_id")}
      || ',' || ${lit(`coalesce(${slug(deptLabel("dept_dsc"))}, 'department-' || lower(department_id))`)}
      || ',' || ${lit(`coalesce(${deptLabel("dept_dsc")}, 'Department ' || department_id)`)}
      || ',' || ${lit("dept_dsc")}
      || ',' || ${lit("dept_code")}
      || ',' || ${lit("section")}
      || ',' || line_items || ',' || amount || ',' || base_amount
      || ',' || agencies || ',' || programs || ',' || activities
      || ',' || operating_units || ',' || objects || ',' || regions || ')' AS v
    FROM d ORDER BY department_id
  `);
  for (let i = 0; i < deptValues.length; i += D1_BATCH) {
    const chunk = deptValues.slice(i, i + D1_BATCH).map((r) => r.v).join(",");
    await write(`INSERT INTO nep_departments VALUES ${chunk};\n`);
  }
  rows += deptValues.length;

  // -- nep_rollups ----------------------------------------------------------
  for (const [dimension, codeExpr, descExpr, extraExpr] of D1_DIMENSIONS) {
    const values = await rowsOf<{ v: string }>(c, `
      WITH g AS (
        SELECT department_id,
               coalesce(${codeExpr}, '${UNASSIGNED}') AS code,
               coalesce(max(${descExpr}) FILTER (fy = ${NEP_YEAR}), max(${descExpr}),
                        '${UNASSIGNED_LABEL}') AS description,
               ${extraExpr ?? "NULL"} AS extra,
               count(*) FILTER (fy = ${NEP_YEAR})                 AS cnt,
               ${pesos(`sum(amount) FILTER (fy = ${NEP_YEAR})`)}  AS amount,
               ${pesos(`sum(amount) FILTER (fy = ${BASE_YEAR})`)} AS base_amount
        FROM items
        GROUP BY department_id, coalesce(${codeExpr}, '${UNASSIGNED}')
      )
      SELECT '(' || ${lit("department_id")}
        || ',''${dimension}'','
        || ${lit("code")}
        || ',' || ${lit("description")}
        || ',' || ${lit("CAST(extra AS VARCHAR)")}
        || ',' || cnt || ',' || amount || ',' || base_amount || ')' AS v
      FROM g ORDER BY department_id, code
    `);
    for (let i = 0; i < values.length; i += D1_BATCH) {
      const chunk = values.slice(i, i + D1_BATCH).map((r) => r.v).join(",");
      await write(`INSERT INTO nep_rollups VALUES ${chunk};\n`);
    }
    rows += values.length;
    process.stdout.write(`    ${dimension.padEnd(15)} ${values.length.toLocaleString().padStart(8)} rows\n`);
  }

  await new Promise<void>((res, rej) => {
    out.once("error", rej);
    out.end(() => res());
  });
  return { bytes: (await stat(outPath)).size, rows };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  if (!existsSync(args.src)) throw new Error(`NEP source not found: ${args.src}`);

  const generatedAt = new Date().toISOString();
  const tmpDb = resolve(args.out, ".import.duckdb");
  await mkdir(args.out, { recursive: true });
  await rm(tmpDb, { force: true });
  await rm(`${tmpDb}.wal`, { force: true });

  const instance = await DuckDBInstance.create(tmpDb);
  const c = await instance.connect();
  await c.run(`SET preserve_insertion_order = false`);

  const t0 = Date.now();
  process.stdout.write(`reading ${args.src}\n`);
  await loadNep(c, args.src);
  const nepRows = Number(await scalar(c, `SELECT count(*) FROM nep`));
  const nepAmt = Number(await scalar(c, `SELECT sum(amount) FROM nep`));
  process.stdout.write(
    `  FY${NEP_YEAR} NEP: ${nepRows.toLocaleString()} rows, ` +
    `₱${(nepAmt * SCALE / 1e12).toFixed(4)}T\n`,
  );

  const hasBaseline = args.baseline !== null;
  if (hasBaseline) {
    process.stdout.write(`reading FY${BASE_YEAR} GAA baseline ${args.baseline}\n`);
    await loadBaseline(c, args.baseline!);
    const n = Number(await scalar(c, `SELECT count(*) FROM gaa`));
    const a = Number(await scalar(c, `SELECT sum(amount) FROM gaa`));
    process.stdout.write(
      `  FY${BASE_YEAR} GAA: ${n.toLocaleString()} rows, ₱${(a * SCALE / 1e12).toFixed(4)}T\n`,
    );
  }

  await buildFacts(c, hasBaseline);
  process.stdout.write(`normalized in ${((Date.now() - t0) / 1000).toFixed(1)}s\n\n`);

  const allDepts = (await rowsOf<{ department_id: string }>(c, `
    SELECT DISTINCT department_id FROM facts
    ORDER BY (department_id ~ '^[0-9]+$') DESC, department_id
  `)).map((r) => r.department_id);
  const depts = args.dept ? allDepts.filter((d) => d === args.dept) : allDepts;
  if (!depts.length) throw new Error(`no such department: ${args.dept}`);

  const levels = LEVELS.filter((l) => !(args.lean && l.heavy));
  const deptSummaries: Array<Record<string, unknown>> = [];

  for (const deptId of depts) {
    const dir = resolve(args.out, deptId);
    await mkdir(dir, { recursive: true });

    // departments.json — single-row envelope, same as the legacy tree.
    await writeEnvelope(c, resolve(dir, "departments.json"), `
      WITH g AS (
        SELECT department_id,
               any_value(dept_dsc) AS dept_dsc,
               any_value(section)  AS section,
               any_value(dept_code) AS dept_code,
               ${YEAR_AGGS}
        FROM items WHERE department_id = '${q(deptId)}' GROUP BY department_id
      )
      SELECT department_id AS id,
             coalesce(${slug(deptLabel("dept_dsc"))},
                      'department-' || lower(department_id)) AS slug,
             coalesce(${deptLabel("dept_dsc")}, 'Department ' || department_id) AS description,
             dept_dsc AS source_description,
             dept_code AS source_department_code,
             section,
             ${YEAR_STRUCT}
      FROM g
    `, { title: `NEP FY${NEP_YEAR} Departments (Department ${deptId})`, source: `National Expenditure Program FY${NEP_YEAR}`, department_id: deptId, scale: "thousands" });

    for (const level of levels) {
      await writeEnvelope(c, resolve(dir, `${level.file}.json`), levelSql(level, deptId), {
        title: `NEP FY${NEP_YEAR} ${level.title} (Department ${deptId})`,
        source: `National Expenditure Program FY${NEP_YEAR}`,
        department_id: deptId,
        scale: "thousands",
      });
    }

    // yearly_totals.json — long form, same as the legacy tree.
    await writeEnvelope(c, resolve(dir, "yearly_totals.json"), `
      SELECT fy AS year, count(*) AS count, sum(amount) AS amount
      FROM items WHERE department_id = '${q(deptId)}'
      GROUP BY fy ORDER BY fy
    `, { title: `NEP FY${NEP_YEAR} Yearly Totals (Department ${deptId})`, source: `National Expenditure Program FY${NEP_YEAR}`, department_id: deptId, scale: "thousands" });

    // Line items as parquet for browser-side DuckDB drill-down.
    //
    // BOTH years are written, discriminated by `fy`. The hierarchy view drills
    // department -> agency -> program -> activity -> operating unit -> fund ->
    // expense class, and every level has to show FY2027 against the FY2026
    // baseline — that comparison is the whole point of the microsite. Any
    // consumer must therefore filter or pivot on `fy`; summing blind
    // double-counts across the two years.
    const parquet = resolve(dir, "line_items.parquet");
    await rm(parquet, { force: true });
    await c.run(`
      COPY (
        SELECT fy, department_id, agency_code, agency_dsc, fpap_code, fpap_dsc,
               program_code, program_dsc, major_class, prexc_level,
               operunit_code, operunit_dsc, div_code, div_dsc,
               region_code, region_dsc, fund_code, fund_dsc,
               expense_code, expense_dsc, object_code, object_dsc,
               amount AS amount_thousands,
               CAST(ROUND(amount * ${SCALE}) AS BIGINT) AS amount
        FROM items WHERE department_id = '${q(deptId)}'
        ORDER BY fy, amount DESC
      ) TO '${q(parquet)}' (FORMAT PARQUET, COMPRESSION ZSTD)
    `);

    const summary = await buildSummary(c, deptId, generatedAt);
    await writeFile(resolve(dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    deptSummaries.push(summary.department as Record<string, unknown>);

    const d = summary.department as Record<string, unknown> | null;
    const amt = Number(d?.amount ?? 0);
    const base = Number(d?.base_amount ?? 0);
    const pct = base ? ((amt - base) / base) * 100 : NaN;
    process.stdout.write(
      `  ${deptId.padEnd(4)} ₱${(amt / 1e9).toFixed(2).padStart(10)}B  ` +
      `${Number.isFinite(pct) ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "  n/a"}`.padEnd(10) +
      `  ${String(d?.description ?? "")}\n`,
    );
  }

  // -- national index ------------------------------------------------------
  if (!args.dept) {
    const [nat] = await rowsOf(c, `
      SELECT
        count(*) FILTER (fy = ${NEP_YEAR})                       AS line_items,
        coalesce(sum(amount) FILTER (fy = ${NEP_YEAR}), 0.0) * ${SCALE}  AS amount,
        coalesce(sum(amount) FILTER (fy = ${BASE_YEAR}), 0.0) * ${SCALE} AS base_amount
      FROM items
    `);
    const [expenseClasses, funds, regions, sections, topPrograms] = await Promise.all([
      rowsOf(c, natRollup("expense_code", "expense_dsc")),
      rowsOf(c, natRollup("fund_code", "fund_dsc", 25)),
      rowsOf(c, natRollup("region_code", "region_dsc")),
      rowsOf(c, natRollup("section", "section")),
      rowsOf(c, `
        SELECT department_id || '-' || agency_code || '-' || program_code AS code,
               any_value(program_dsc) AS description,
               any_value(department_id) AS department_id,
               any_value(agency_dsc) AS agency,
               count(*) FILTER (fy = ${NEP_YEAR}) AS count,
               coalesce(sum(amount) FILTER (fy = ${NEP_YEAR}), 0.0) * ${SCALE} AS amount,
               coalesce(sum(amount) FILTER (fy = ${BASE_YEAR}), 0.0) * ${SCALE} AS base_amount,
               (coalesce(sum(amount) FILTER (fy = ${NEP_YEAR}), 0.0)
                - coalesce(sum(amount) FILTER (fy = ${BASE_YEAR}), 0.0)) * ${SCALE} AS delta
        FROM items WHERE program_code IS NOT NULL
        GROUP BY 1 ORDER BY amount DESC LIMIT 40
      `),
    ]);

    const withDelta = deptSummaries.map((d) => ({
      ...d,
      delta: Number(d.amount) - Number(d.base_amount),
      pct: Number(d.base_amount) ? ((Number(d.amount) - Number(d.base_amount)) / Number(d.base_amount)) * 100 : null,
    }));
    const byDelta = [...withDelta].sort((a, b) => b.delta - a.delta);
    const natUp = byDelta.filter((d) => d.delta > 0);
    const natDown = byDelta.filter((d) => d.delta < 0).reverse();

    const index = {
      generated_at: generatedAt,
      fiscal_year: NEP_YEAR,
      baseline_year: BASE_YEAR,
      scale: "pesos",
      source_file: args.src,
      national: nat,
      departments: withDelta,
      expense_classes: expenseClasses,
      fund_subcategories: funds,
      regions,
      sections,
      top_programs: topPrograms,
      top_movers_up: natUp.slice(0, 10),
      top_movers_down: natDown.slice(0, 10),
    };
    const idxPath = resolve(args.out, "national", "index.json");
    await mkdir(dirname(idxPath), { recursive: true });
    await writeFile(idxPath, `${JSON.stringify(index, null, 2)}\n`);

    process.stdout.write(`\nbuilding D1 aggregation layer\n`);
    const d1 = await writeD1Sql(
      c, resolve(args.out, "d1-import.sql"), generatedAt, args.src,
    );
    process.stdout.write(
      `  data/2027/d1-import.sql  ${d1.rows.toLocaleString()} rows, ` +
      `${(d1.bytes / 1e6).toFixed(1)} MB\n`,
    );

    await writeFile(resolve(args.out, "manifest.json"), `${JSON.stringify({
      generated_at: generatedAt,
      fiscal_year: NEP_YEAR,
      baseline_year: BASE_YEAR,
      source_file: args.src,
      source_rows: nepRows,
      departments: depts,
      levels: ["departments", ...levels.map((l) => l.file), "yearly_totals"],
      lean: args.lean,
      d1: { file: "d1-import.sql", rows: d1.rows, bytes: d1.bytes, scale: "pesos" },
    }, null, 2)}\n`);

    const total = Number(nat.amount);
    const baseTotal = Number(nat.base_amount);
    process.stdout.write(
      `\nnational FY${NEP_YEAR} NEP: ₱${(total / 1e12).toFixed(4)}T` +
      ` vs FY${BASE_YEAR} GAA ₱${(baseTotal / 1e12).toFixed(4)}T` +
      ` (${total >= baseTotal ? "+" : ""}${(((total - baseTotal) / baseTotal) * 100).toFixed(2)}%)\n`,
    );
  }

  c.closeSync();
  instance.closeSync();
  if (!args.keepTmp) {
    await rm(tmpDb, { force: true });
    await rm(`${tmpDb}.wal`, { force: true });
  }

  const size = await dirSize(args.out);
  process.stdout.write(
    `wrote ${depts.length} departments to ${args.out} (${(size / 1e6).toFixed(1)} MB) ` +
    `in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`,
  );
}

function natRollup(codeExpr: string, descExpr: string, limit?: number): string {
  return `
    SELECT ${codeExpr} AS code,
           coalesce(max(${descExpr}) FILTER (fy = ${NEP_YEAR}), max(${descExpr}), '(not specified)') AS description,
           count(*) FILTER (fy = ${NEP_YEAR}) AS count,
           coalesce(sum(amount) FILTER (fy = ${NEP_YEAR}), 0.0) * ${SCALE} AS amount,
           coalesce(sum(amount) FILTER (fy = ${BASE_YEAR}), 0.0) * ${SCALE} AS base_amount,
           (coalesce(sum(amount) FILTER (fy = ${NEP_YEAR}), 0.0)
            - coalesce(sum(amount) FILTER (fy = ${BASE_YEAR}), 0.0)) * ${SCALE} AS delta
    FROM items WHERE ${codeExpr} IS NOT NULL
    GROUP BY 1 ORDER BY amount DESC ${limit ? `LIMIT ${limit}` : ""}
  `;
}

async function dirSize(dir: string): Promise<number> {
  const { readdir } = await import("node:fs/promises");
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else total += (await stat(p)).size;
  }
  return total;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
