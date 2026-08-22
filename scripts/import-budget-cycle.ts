/**
 * Import the multi-sheet NEP/GAA/SAAODB workbook into a normalized, audited
 * budget-cycle dataset.
 *
 * The importer deliberately produces a separate SQLite database. The source
 * workbook is Current New Appropriations only, while data/budget.sqlite holds
 * the portal's broader GAA hierarchy; sharing crosswalk keys must not silently
 * overwrite either scope.
 *
 * Usage:
 *   npm run import:cycle -- --input=/absolute/path/to/workbook.xlsx
 *   npm run import:cycle -- --input=... --output=data/budget-cycle --force
 */

import { DuckDBInstance } from "@duckdb/node-api";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

const SCHEMA_VERSION = "1.0.0";
const METRIC_RE =
  /^(NEP|GAA|AuthAppro|AdjAppro|AdjAllot|Obligations|Disbursements)_(\d{4})_EXP_(1PS|2MOOE|3FE|6CO|TOTAL)$/;

const STAGE_NAMES = {
  NEP: "nep",
  GAA: "gaa",
  AuthAppro: "authorized_appropriation",
  AdjAppro: "adjusted_appropriation",
  AdjAllot: "adjusted_allotment",
  Obligations: "obligations",
  Disbursements: "disbursements",
} as const;

const EXPENSE_CLASS_NAMES = {
  "1PS": "ps",
  "2MOOE": "mooe",
  "3FE": "finex",
  "6CO": "co",
  TOTAL: "total",
} as const;

type Stage = (typeof STAGE_NAMES)[keyof typeof STAGE_NAMES];
type ExpenseClass = (typeof EXPENSE_CLASS_NAMES)[keyof typeof EXPENSE_CLASS_NAMES];
type Severity = "info" | "warning" | "error";
type MatchMethod =
  | "exact_code"
  | "organization_history"
  | "agency_name_and_pap_code"
  | "agency_name_and_pap_label"
  | "ambiguous"
  | "unmatched";

interface Args {
  input: string;
  output: string;
  portalData: string;
  force: boolean;
  sqlite: boolean;
}

interface MetricColumn {
  sourceColumn: string;
  stage: Stage;
  fiscalYear: number;
  expenseClass: ExpenseClass;
}

interface SourceColumnRecord {
  source_sheet: string;
  column_index: number;
  column_letter: string;
  source_header: string | null;
  normalized_header: string;
  role: "identity" | "metric" | "unlabelled" | "other";
  fiscal_year: number | null;
  stage: Stage | null;
  expense_class: ExpenseClass | null;
  is_production_sheet: boolean;
}

interface SourceRowRecord {
  source_row_id: string;
  source_sheet: string;
  source_row_number: number;
  is_production: boolean;
  subject_id: string | null;
  source_department_code: string | null;
  source_department_name: string | null;
  source_agency_code: string | null;
  source_agency_name: string | null;
  prexc_program_code: string | null;
  prexc_subprogram_code: string | null;
  pap_label: string | null;
  raw_json: string;
}

interface ValueRecord {
  value_id: string;
  source_row_id: string;
  subject_id: string | null;
  source_sheet: string;
  source_column: string;
  fiscal_year: number;
  stage: Stage;
  expense_class: ExpenseClass;
  amount_pesos: number | null;
  is_reported: boolean;
  is_production: boolean;
}

interface CrosswalkRecord {
  source_row_id: string;
  subject_id: string;
  source_department_code: string;
  source_agency_code: string;
  source_pap_code: string;
  source_pap_label: string | null;
  historical_portal_department_id: string | null;
  historical_portal_agency_id: string | null;
  historical_portal_fpap_id: string | null;
  canonical_portal_department_id: string | null;
  canonical_portal_agency_id: string | null;
  canonical_portal_fpap_id: string | null;
  portal_pap_label: string | null;
  match_method: MatchMethod;
  match_confidence: "high" | "medium" | "none";
  candidate_portal_fpap_ids_json: string;
  review_note: string | null;
}

interface SubjectRecord {
  subject_id: string;
  source_sheet: string;
  display_name: string;
  is_primary_subject: boolean;
  canonical_portal_department_id: string | null;
  canonical_portal_agency_id: string | null;
  source_pairs_json: string;
  coverage_json: string;
}

interface QualityFlagRecord {
  quality_flag_id: string;
  severity: Severity;
  code: string;
  source_sheet: string;
  source_row_id: string | null;
  subject_id: string | null;
  fiscal_year: number | null;
  stage: Stage | null;
  message: string;
  details_json: string;
}

interface PortalDepartment {
  id: string;
  description: string;
}

interface PortalAgency {
  id: string;
  agency_code: string;
  description: string;
  department_id: string;
}

interface PortalFpap {
  id: string;
  fpap_code: string;
  description: string;
  agency_id: string;
  department_id: string;
  years?: Record<string, { amount?: number }>;
}

interface SubjectState {
  subjectId: string;
  sourceSheet: string;
  displayName: string;
  isPrimary: boolean;
  sourcePairs: Set<string>;
  reportedCoverage: Map<Stage, Set<number>>;
  matchedAgencyCounts: Map<string, number>;
}

interface PortalCatalog {
  departmentsById: Map<string, PortalDepartment>;
  agenciesById: Map<string, PortalAgency>;
  agenciesByNormalizedName: Map<string, PortalAgency[]>;
  fpapsById: Map<string, PortalFpap>;
  fpapsByAgencyAndCode: Map<string, PortalFpap[]>;
  fpapsByAgencyAndName: Map<string, PortalFpap[]>;
}

interface RowContext {
  sourceRow: SourceRowRecord;
}

const IDENTITY_HEADERS = new Set([
  "DEPARTMENT",
  "UACS_DPT_DSC",
  "AGENCY",
  "UACS_AGY_DSC",
  "PREXC_PROG",
  "PREXC_SUBPROG",
  "P/A/P",
]);

const HISTORY_AGENCY_OVERRIDES: Record<string, string> = {
  "26-029": "14-010", // Philippine Commission on Women
  "26-041": "16-009", // TESDA before its later departmental homes
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const value = (key: string) => raw.find((v) => v.startsWith(`--${key}=`))?.slice(key.length + 3);
  const positional = raw.find((v) => !v.startsWith("--"));
  const input = value("input") ?? positional;
  if (!input) {
    throw new Error("Pass --input=/absolute/path/to/Compiled_....xlsx");
  }
  return {
    input: resolve(input),
    output: resolve(value("output") ?? "data/budget-cycle"),
    portalData: resolve(value("portal-data") ?? "data"),
    force: raw.includes("--force"),
    sqlite: !raw.includes("--no-sqlite"),
  };
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function simpleExcelValue(value: ExcelJS.CellValue): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return value;
  if ("formula" in value || "sharedFormula" in value) {
    const formulaValue = value as ExcelJS.CellFormulaValue | ExcelJS.CellSharedFormulaValue;
    return simpleExcelValue(formulaValue.result as ExcelJS.CellValue);
  }
  if ("richText" in value) {
    return value.richText.map((part) => part.text).join("");
  }
  if ("text" in value) return value.text;
  if ("error" in value) return value.error;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function rawExcelValue(value: ExcelJS.CellValue): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return value;
  if ("formula" in value || "sharedFormula" in value) {
    const formulaValue = value as ExcelJS.CellFormulaValue | ExcelJS.CellSharedFormulaValue;
    return {
      formula: "formula" in formulaValue ? formulaValue.formula : formulaValue.sharedFormula,
      result: simpleExcelValue(formulaValue.result as ExcelJS.CellValue),
    };
  }
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("text" in value) return { text: value.text, hyperlink: "hyperlink" in value ? value.hyperlink : null };
  if ("error" in value) return { error: value.error };
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function textValue(value: ExcelJS.CellValue): string | null {
  const simple = simpleExcelValue(value);
  if (simple == null) return null;
  const text = String(simple).trim();
  return text.length ? text : null;
}

function codeValue(value: ExcelJS.CellValue, width?: number): string | null {
  const simple = simpleExcelValue(value);
  if (simple == null || simple === "") return null;
  let text: string;
  if (typeof simple === "number") {
    if (!Number.isFinite(simple)) return null;
    text = String(Math.trunc(simple));
  } else {
    text = String(simple).trim().replace(/\.0+$/, "");
  }
  return width ? text.padStart(width, "0") : text;
}

function numericValue(value: ExcelJS.CellValue): number | null {
  const simple = simpleExcelValue(value);
  if (typeof simple === "number") return Number.isFinite(simple) ? simple : null;
  if (typeof simple !== "string") return null;
  const clean = simple.trim().replace(/,/g, "");
  if (!clean || clean === "-") return null;
  const number = Number(clean);
  return Number.isFinite(number) ? number : null;
}

function isReported(value: ExcelJS.CellValue): boolean {
  const simple = simpleExcelValue(value);
  return simple !== null && simple !== undefined && simple !== "";
}

function metricFromHeader(header: string): MetricColumn | null {
  const match = METRIC_RE.exec(header);
  if (!match) return null;
  const sourceStage = match[1] as keyof typeof STAGE_NAMES;
  const sourceExpenseClass = match[3] as keyof typeof EXPENSE_CLASS_NAMES;
  return {
    sourceColumn: header,
    stage: STAGE_NAMES[sourceStage],
    fiscalYear: Number(match[2]),
    expenseClass: EXPENSE_CLASS_NAMES[sourceExpenseClass],
  };
}

function readDataset<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { data?: T[] };
  return parsed.data ?? [];
}

function loadPortalCatalog(dataRoot: string, sourceAgencyNames: Set<string>, sourceDeptIds: Set<string>): PortalCatalog {
  const departmentsById = new Map<string, PortalDepartment>();
  const agenciesById = new Map<string, PortalAgency>();
  const agenciesByNormalizedName = new Map<string, PortalAgency[]>();
  const deptDirs = readdirSync(dataRoot).filter((name) => /^\d{2}$/.test(name)).sort();

  for (const deptId of deptDirs) {
    for (const department of readDataset<PortalDepartment>(join(dataRoot, deptId, "departments.json"))) {
      departmentsById.set(department.id, department);
    }
    for (const agency of readDataset<PortalAgency>(join(dataRoot, deptId, "agencies.json"))) {
      agenciesById.set(agency.id, agency);
      const key = normalizeName(agency.description);
      const list = agenciesByNormalizedName.get(key) ?? [];
      list.push(agency);
      agenciesByNormalizedName.set(key, list);
    }
  }

  const relevantDepartments = new Set(sourceDeptIds);
  for (const name of sourceAgencyNames) {
    for (const agency of agenciesByNormalizedName.get(normalizeName(name)) ?? []) {
      relevantDepartments.add(agency.department_id);
    }
  }
  for (const agencyId of Object.values(HISTORY_AGENCY_OVERRIDES)) {
    relevantDepartments.add(agencyId.slice(0, 2));
  }

  const fpapsById = new Map<string, PortalFpap>();
  const fpapsByAgencyAndCode = new Map<string, PortalFpap[]>();
  const fpapsByAgencyAndName = new Map<string, PortalFpap[]>();
  for (const deptId of [...relevantDepartments].sort()) {
    for (const fpap of readDataset<PortalFpap>(join(dataRoot, deptId, "fpaps.json"))) {
      fpapsById.set(fpap.id, fpap);
      const codeKey = `${fpap.agency_id}|${fpap.fpap_code}`;
      const codeList = fpapsByAgencyAndCode.get(codeKey) ?? [];
      codeList.push(fpap);
      fpapsByAgencyAndCode.set(codeKey, codeList);
      const nameKey = `${fpap.agency_id}|${normalizeName(fpap.description)}`;
      const nameList = fpapsByAgencyAndName.get(nameKey) ?? [];
      nameList.push(fpap);
      fpapsByAgencyAndName.set(nameKey, nameList);
    }
  }

  return {
    departmentsById,
    agenciesById,
    agenciesByNormalizedName,
    fpapsById,
    fpapsByAgencyAndCode,
    fpapsByAgencyAndName,
  };
}

function isPrimarySubject(sheet: string, agencyName: string): boolean {
  const normalized = normalizeName(agencyName);
  if (sheet === "PCW") return normalized.includes("philippinecommissiononwomen");
  if (sheet === "TESDA") return normalized.includes("technicaleducationandskillsdevelopmentauthority");
  if (sheet === "Judiciary") return normalized.includes("supremecourtofthephilippines");
  return normalized === "officeofthesecretary";
}

function canonicalAgencyOverride(agencyName: string): string | null {
  const normalized = normalizeName(agencyName);
  if (normalized.includes("philippinecommissiononwomen")) return "14-010";
  if (normalized.includes("technicaleducationandskillsdevelopmentauthority")) return "16-009";
  return null;
}

function portalFpapCode(sourcePapCode: string): string {
  return sourcePapCode.padStart(12, "0") + "000";
}

function resolveCrosswalk(row: RowContext, portal: PortalCatalog): CrosswalkRecord {
  const source = row.sourceRow;
  const dept = source.source_department_code as string;
  const agency = source.source_agency_code as string;
  const papCode = source.prexc_subprogram_code;
  if (!papCode) throw new Error(`Missing P/A/P code for ${source.source_row_id}`);
  const historicalAgencyId = `${dept}-${agency}`;
  const targetFpapCode = portalFpapCode(papCode);
  const exactFpapId = `${historicalAgencyId}-${targetFpapCode}`;
  const exact = portal.fpapsById.get(exactFpapId);
  const canonicalOverride =
    canonicalAgencyOverride(source.source_agency_name ?? "") ?? HISTORY_AGENCY_OVERRIDES[historicalAgencyId] ?? null;

  let match: PortalFpap | null = exact ?? null;
  let method: MatchMethod = exact ? "exact_code" : "unmatched";
  let candidates: PortalFpap[] = [];
  let note: string | null = null;

  if (!match && canonicalOverride) {
    const historyMatches = portal.fpapsByAgencyAndCode.get(`${canonicalOverride}|${targetFpapCode}`) ?? [];
    if (historyMatches.length === 1) {
      match = historyMatches[0];
      method = "organization_history";
      note = `${historicalAgencyId} is related to canonical agency ${canonicalOverride}.`;
    } else {
      candidates = historyMatches;
    }
  }

  if (!match) {
    const namedAgencies = portal.agenciesByNormalizedName.get(normalizeName(source.source_agency_name)) ?? [];
    const sameDept = namedAgencies.filter((candidate) => candidate.department_id === dept);
    const eligibleAgencies = sameDept.length ? sameDept : namedAgencies;
    candidates = eligibleAgencies.flatMap(
      (candidate) => portal.fpapsByAgencyAndCode.get(`${candidate.id}|${targetFpapCode}`) ?? [],
    );
    if (candidates.length === 1) {
      match = candidates[0];
      method = "agency_name_and_pap_code";
    } else if (candidates.length > 1) {
      const labelMatches = candidates.filter(
        (candidate) => normalizeName(candidate.description) === normalizeName(source.pap_label),
      );
      if (labelMatches.length === 1) {
        match = labelMatches[0];
        method = "agency_name_and_pap_code";
      }
    }
  }

  if (!match && source.pap_label) {
    const namedAgencies = portal.agenciesByNormalizedName.get(normalizeName(source.source_agency_name)) ?? [];
    const sameDept = namedAgencies.filter((candidate) => candidate.department_id === dept);
    const eligibleAgencies = sameDept.length ? sameDept : namedAgencies;
    candidates = eligibleAgencies.flatMap(
      (candidate) =>
        portal.fpapsByAgencyAndName.get(`${candidate.id}|${normalizeName(source.pap_label)}`) ?? [],
    );
    if (candidates.length === 1) {
      match = candidates[0];
      method = "agency_name_and_pap_label";
    }
  }

  if (!match && candidates.length > 1) {
    // Amounts are deliberately not used as a fuzzy key: the two datasets have
    // different appropriation scopes. Report ambiguity for human review.
    method = "ambiguous";
    note = `${candidates.length} portal P/A/P candidates share the available relationship fields.`;
  }

  const canonicalAgencyId = canonicalOverride ?? match?.agency_id ?? null;
  const canonicalFpap = canonicalAgencyId
    ? (portal.fpapsByAgencyAndCode.get(`${canonicalAgencyId}|${targetFpapCode}`) ?? [])[0] ?? match
    : match;
  const candidateIds = [...new Set(candidates.map((candidate) => candidate.id))].sort();

  return {
    source_row_id: source.source_row_id,
    subject_id: source.subject_id as string,
    source_department_code: dept,
    source_agency_code: agency,
    source_pap_code: papCode,
    source_pap_label: source.pap_label,
    historical_portal_department_id: match?.department_id ?? null,
    historical_portal_agency_id: match?.agency_id ?? null,
    historical_portal_fpap_id: match?.id ?? null,
    canonical_portal_department_id: canonicalAgencyId?.slice(0, 2) ?? null,
    canonical_portal_agency_id: canonicalAgencyId,
    canonical_portal_fpap_id: canonicalFpap?.id ?? null,
    portal_pap_label: match?.description ?? null,
    match_method: method,
    match_confidence:
      method === "exact_code" || method === "organization_history"
        ? "high"
        : method === "agency_name_and_pap_code" || method === "agency_name_and_pap_label"
          ? "medium"
          : "none",
    candidate_portal_fpap_ids_json: JSON.stringify(candidateIds),
    review_note: note,
  };
}

function writeNdjson<T extends object>(path: string, rows: T[]): void {
  const body = rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
  writeFileSync(path, body);
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function sqlPath(path: string): string {
  return path.replace(/'/g, "''");
}

async function buildSqlite(outputDir: string, force: boolean): Promise<string> {
  const finalPath = join(outputDir, "budget-cycle.sqlite");
  const tempPath = `${finalPath}.tmp`;
  if ((existsSync(finalPath) || existsSync(tempPath)) && !force) {
    throw new Error(`${finalPath} already exists; pass --force to replace generated import artifacts.`);
  }
  if (force) {
    if (existsSync(finalPath)) rmSync(finalPath);
    if (existsSync(tempPath)) rmSync(tempPath);
  }

  const specs = [
    ["budget_cycle_source_columns", "source-columns.ndjson"],
    ["budget_cycle_source_rows", "source-rows.ndjson"],
    ["budget_cycle_values", "values.ndjson"],
    ["budget_cycle_crosswalk", "crosswalk.ndjson"],
    ["budget_cycle_subjects", "subjects.ndjson"],
    ["budget_cycle_quality_flags", "quality-flags.ndjson"],
    ["budget_cycle_manifest", "manifest.ndjson"],
  ] as const;

  const db = await DuckDBInstance.create(":memory:");
  const conn = await db.connect();
  await conn.run("INSTALL sqlite; LOAD sqlite;");
  await conn.run(`ATTACH '${sqlPath(tempPath)}' AS cycle (TYPE SQLITE)`);
  await conn.run("USE cycle");
  for (const [table, file] of specs) {
    await conn.run(
      `CREATE TABLE ${table} AS SELECT * FROM read_ndjson_auto('${sqlPath(join(outputDir, file))}')`,
    );
  }
  await conn.run("CREATE INDEX budget_cycle_values_subject_year_idx ON budget_cycle_values(subject_id, fiscal_year)");
  await conn.run("CREATE INDEX budget_cycle_values_source_row_idx ON budget_cycle_values(source_row_id)");
  await conn.run("CREATE INDEX budget_cycle_crosswalk_portal_fpap_idx ON budget_cycle_crosswalk(canonical_portal_fpap_id)");
  await conn.run("CREATE INDEX budget_cycle_crosswalk_portal_agency_idx ON budget_cycle_crosswalk(canonical_portal_agency_id)");
  await conn.run("CREATE INDEX budget_cycle_flags_source_row_idx ON budget_cycle_quality_flags(source_row_id)");
  await conn.run("USE memory");
  await conn.run("DETACH cycle");
  renameSync(tempPath, finalPath);
  return finalPath;
}

function ensureOutput(outputDir: string, force: boolean): void {
  mkdirSync(outputDir, { recursive: true });
  const generated = [
    "source-columns.ndjson",
    "source-rows.ndjson",
    "values.ndjson",
    "crosswalk.ndjson",
    "subjects.ndjson",
    "subjects.json",
    "quality-flags.ndjson",
    "quality-report.json",
    "manifest.ndjson",
    "manifest.json",
    "budget-cycle.sqlite",
    "budget-cycle.sqlite.tmp",
  ];
  const existing = generated.filter((name) => existsSync(join(outputDir, name)));
  if (existing.length && !force) {
    throw new Error(
      `${outputDir} contains generated artifacts (${existing.join(", ")}); pass --force to replace them.`,
    );
  }
  if (force) {
    for (const name of existing) rmSync(join(outputDir, name));
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!existsSync(args.input)) throw new Error(`Workbook not found: ${args.input}`);
  if (!existsSync(args.portalData)) throw new Error(`Portal data directory not found: ${args.portalData}`);
  ensureOutput(args.output, args.force);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(args.input);

  const sourceColumns: SourceColumnRecord[] = [];
  const sourceRows: SourceRowRecord[] = [];
  const values: ValueRecord[] = [];
  const qualityFlags: QualityFlagRecord[] = [];
  const subjects = new Map<string, SubjectState>();
  const rowContexts: RowContext[] = [];
  let qualitySequence = 0;

  const addFlag = (
    severity: Severity,
    code: string,
    message: string,
    details: Record<string, unknown>,
    sourceSheet: string,
    sourceRowId: string | null = null,
    subjectId: string | null = null,
    fiscalYear: number | null = null,
    stage: Stage | null = null,
  ) => {
    qualitySequence += 1;
    qualityFlags.push({
      quality_flag_id: `qf-${String(qualitySequence).padStart(6, "0")}`,
      severity,
      code,
      source_sheet: sourceSheet,
      source_row_id: sourceRowId,
      subject_id: subjectId,
      fiscal_year: fiscalYear,
      stage,
      message,
      details_json: JSON.stringify(details),
    });
  };

  for (const worksheet of workbook.worksheets) {
    const usedColumns = new Set<number>();
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        if (isReported(cell.value)) usedColumns.add(columnNumber);
      });
    });
    const columns = [...usedColumns].sort((a, b) => a - b);
    const seenHeaders = new Map<string, number>();
    const headerByColumn = new Map<number, string>();
    const metricByColumn = new Map<number, MetricColumn>();
    const sourceHeaderByColumn = new Map<number, string | null>();

    for (const columnNumber of columns) {
      const sourceHeader = textValue(worksheet.getCell(1, columnNumber).value);
      const baseHeader = sourceHeader ?? `__COLUMN_${worksheet.getColumn(columnNumber).letter}`;
      const count = (seenHeaders.get(baseHeader) ?? 0) + 1;
      seenHeaders.set(baseHeader, count);
      const normalizedHeader = count === 1 ? baseHeader : `${baseHeader}__${count}`;
      headerByColumn.set(columnNumber, normalizedHeader);
      sourceHeaderByColumn.set(columnNumber, sourceHeader);
      const metric = sourceHeader ? metricFromHeader(sourceHeader) : null;
      if (metric) metricByColumn.set(columnNumber, metric);
    }

    const namedHeaders = new Set([...sourceHeaderByColumn.values()].filter((v): v is string => v != null));
    const isProductionSheet =
      namedHeaders.has("DEPARTMENT") &&
      namedHeaders.has("AGENCY") &&
      namedHeaders.has("PREXC_SUBPROG") &&
      namedHeaders.has("P/A/P") &&
      metricByColumn.size > 0;

    for (const columnNumber of columns) {
      const sourceHeader = sourceHeaderByColumn.get(columnNumber) ?? null;
      const normalizedHeader = headerByColumn.get(columnNumber) as string;
      const metric = metricByColumn.get(columnNumber) ?? null;
      sourceColumns.push({
        source_sheet: worksheet.name,
        column_index: columnNumber,
        column_letter: worksheet.getColumn(columnNumber).letter,
        source_header: sourceHeader,
        normalized_header: normalizedHeader,
        role: metric
          ? "metric"
          : sourceHeader == null
            ? "unlabelled"
            : IDENTITY_HEADERS.has(sourceHeader)
              ? "identity"
              : "other",
        fiscal_year: metric?.fiscalYear ?? null,
        stage: metric?.stage ?? null,
        expense_class: metric?.expenseClass ?? null,
        is_production_sheet: isProductionSheet,
      });
    }

    const columnFor = (header: string): number | null => {
      for (const [columnNumber, sourceHeader] of sourceHeaderByColumn) {
        if (sourceHeader === header) return columnNumber;
      }
      return null;
    };
    const identityColumn = {
      departmentCode: columnFor("DEPARTMENT"),
      departmentName: columnFor("UACS_DPT_DSC"),
      agencyCode: columnFor("AGENCY"),
      agencyName: columnFor("UACS_AGY_DSC"),
      prexcProgram: columnFor("PREXC_PROG"),
      prexcSubprogram: columnFor("PREXC_SUBPROG"),
      papLabel: columnFor("P/A/P"),
    };

    for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      if (!columns.some((columnNumber) => isReported(row.getCell(columnNumber).value))) continue;

      const raw: Record<string, unknown> = {};
      for (const columnNumber of columns) {
        raw[headerByColumn.get(columnNumber) as string] = rawExcelValue(row.getCell(columnNumber).value);
      }

      const departmentCode = identityColumn.departmentCode
        ? codeValue(row.getCell(identityColumn.departmentCode).value, 2)
        : null;
      const departmentName = identityColumn.departmentName
        ? textValue(row.getCell(identityColumn.departmentName).value)
        : null;
      const agencyCode = identityColumn.agencyCode
        ? codeValue(row.getCell(identityColumn.agencyCode).value, 3)
        : null;
      const agencyName = identityColumn.agencyName
        ? textValue(row.getCell(identityColumn.agencyName).value)
        : null;
      const prexcProgramCode = identityColumn.prexcProgram
        ? codeValue(row.getCell(identityColumn.prexcProgram).value)
        : null;
      const prexcSubprogramCode = identityColumn.prexcSubprogram
        ? codeValue(row.getCell(identityColumn.prexcSubprogram).value, 12)
        : null;
      const papLabel = identityColumn.papLabel ? textValue(row.getCell(identityColumn.papLabel).value) : null;
      const subjectId = agencyName ? `${slug(worksheet.name)}:${slug(agencyName)}` : null;
      const sourceRowId = `${slug(worksheet.name)}:${rowNumber}`;
      const isProduction =
        isProductionSheet &&
        departmentCode != null &&
        agencyCode != null &&
        prexcSubprogramCode != null &&
        subjectId != null;

      const sourceRow: SourceRowRecord = {
        source_row_id: sourceRowId,
        source_sheet: worksheet.name,
        source_row_number: rowNumber,
        is_production: isProduction,
        subject_id: subjectId,
        source_department_code: departmentCode,
        source_department_name: departmentName,
        source_agency_code: agencyCode,
        source_agency_name: agencyName,
        prexc_program_code: prexcProgramCode,
        prexc_subprogram_code: prexcSubprogramCode,
        pap_label: papLabel,
        raw_json: JSON.stringify(raw),
      };
      sourceRows.push(sourceRow);

      if (isProduction && !papLabel) {
        addFlag(
          "warning",
          "missing_pap_label",
          "The source row has a P/A/P code but no P/A/P label.",
          { prexc_subprogram_code: prexcSubprogramCode },
          worksheet.name,
          sourceRowId,
          subjectId,
        );
      }

      if (isProduction && subjectId && agencyName && departmentCode && agencyCode) {
        const state = subjects.get(subjectId) ?? {
          subjectId,
          sourceSheet: worksheet.name,
          displayName: agencyName,
          isPrimary: isPrimarySubject(worksheet.name, agencyName),
          sourcePairs: new Set<string>(),
          reportedCoverage: new Map<Stage, Set<number>>(),
          matchedAgencyCounts: new Map<string, number>(),
        };
        state.sourcePairs.add(`${departmentCode}-${agencyCode}`);
        subjects.set(subjectId, state);
      }

      const rowMetricValues = new Map<string, number>();
      for (const [columnNumber, metric] of metricByColumn) {
        if (!prexcSubprogramCode) continue;
        const cell = row.getCell(columnNumber);
        const reported = isReported(cell.value);
        const amount = numericValue(cell.value);
        const valueId = `${sourceRowId}:${metric.sourceColumn}`;
        values.push({
          value_id: valueId,
          source_row_id: sourceRowId,
          subject_id: subjectId,
          source_sheet: worksheet.name,
          source_column: metric.sourceColumn,
          fiscal_year: metric.fiscalYear,
          stage: metric.stage,
          expense_class: metric.expenseClass,
          amount_pesos: amount,
          is_reported: reported,
          is_production: isProduction,
        });
        if (reported && amount == null) {
          addFlag(
            "error",
            "non_numeric_metric_value",
            "A populated budget-cycle cell could not be parsed as a number.",
            { source_column: metric.sourceColumn, raw_value: rawExcelValue(cell.value) },
            worksheet.name,
            sourceRowId,
            subjectId,
            metric.fiscalYear,
            metric.stage,
          );
        }
        if (amount != null) {
          rowMetricValues.set(`${metric.fiscalYear}|${metric.stage}|${metric.expenseClass}`, amount);
          if (amount < 0) {
            addFlag(
              isProduction ? "error" : "warning",
              "negative_amount",
              "A budget-cycle amount is negative.",
              { source_column: metric.sourceColumn, amount_pesos: amount },
              worksheet.name,
              sourceRowId,
              subjectId,
              metric.fiscalYear,
              metric.stage,
            );
          }
        }
        // Subject-level coverage drives the UI's stage availability. Require
        // a reported TOTAL: isolated zero component cells do not establish
        // that a complete stage was reported for the year.
        if (reported && subjectId && metric.expenseClass === "total") {
          const state = subjects.get(subjectId);
          if (state) {
            const years = state.reportedCoverage.get(metric.stage) ?? new Set<number>();
            years.add(metric.fiscalYear);
            state.reportedCoverage.set(metric.stage, years);
          }
        }
      }

      if (isProduction) rowContexts.push({ sourceRow });

      const availableYears = new Set<number>();
      for (const metric of metricByColumn.values()) availableYears.add(metric.fiscalYear);
      for (const fiscalYear of availableYears) {
        for (const stage of Object.values(STAGE_NAMES)) {
          const total = rowMetricValues.get(`${fiscalYear}|${stage}|total`);
          const components = (["ps", "mooe", "finex", "co"] as const)
            .map((expenseClass) => rowMetricValues.get(`${fiscalYear}|${stage}|${expenseClass}`))
            .filter((amount): amount is number => amount != null);
          if (total != null && components.length) {
            const componentSum = components.reduce((sum, amount) => sum + amount, 0);
            const residual = total - componentSum;
            if (Math.abs(residual) > 1) {
              const material = Math.abs(residual) > Math.max(1000, Math.abs(total) * 0.001);
              addFlag(
                material ? "error" : "warning",
                "total_component_mismatch",
                "Published TOTAL does not equal the sum of reported expense-class components.",
                { total_pesos: total, component_sum_pesos: componentSum, residual_pesos: residual },
                worksheet.name,
                sourceRowId,
                subjectId,
                fiscalYear,
                stage,
              );
            }
          }
        }

        const allotment = rowMetricValues.get(`${fiscalYear}|adjusted_allotment|total`);
        const obligations = rowMetricValues.get(`${fiscalYear}|obligations|total`);
        const disbursements = rowMetricValues.get(`${fiscalYear}|disbursements|total`);
        const ratios: Array<[string, number | undefined, number | undefined]> = [
          ["obligations_to_allotment", obligations, allotment],
          ["disbursements_to_obligations", disbursements, obligations],
          ["disbursements_to_allotment", disbursements, allotment],
        ];
        for (const [ratioName, numerator, denominator] of ratios) {
          if (numerator == null || denominator == null || denominator <= 0) continue;
          const ratio = numerator / denominator;
          if (ratio > 1.000001) {
            addFlag(
              "warning",
              "execution_ratio_above_100pct",
              "An execution ratio exceeds 100%; retain it without clamping and review the source adjustments.",
              { ratio_name: ratioName, ratio, numerator_pesos: numerator, denominator_pesos: denominator },
              worksheet.name,
              sourceRowId,
              subjectId,
              fiscalYear,
              ratioName === "obligations_to_allotment" ? "obligations" : "disbursements",
            );
          }
        }
      }
    }
  }

  const sourceAgencyNames = new Set(
    sourceRows.map((row) => row.source_agency_name).filter((name): name is string => name != null),
  );
  const sourceDeptIds = new Set(
    sourceRows.map((row) => row.source_department_code).filter((id): id is string => id != null),
  );
  const portal = loadPortalCatalog(args.portalData, sourceAgencyNames, sourceDeptIds);
  const crosswalk = rowContexts.map((row) => resolveCrosswalk(row, portal));

  for (const relation of crosswalk) {
    const subject = subjects.get(relation.subject_id);
    if (subject && relation.historical_portal_agency_id) {
      subject.matchedAgencyCounts.set(
        relation.historical_portal_agency_id,
        (subject.matchedAgencyCounts.get(relation.historical_portal_agency_id) ?? 0) + 1,
      );
    }
    if (relation.match_method === "unmatched" || relation.match_method === "ambiguous") {
      const row = sourceRows.find((candidate) => candidate.source_row_id === relation.source_row_id);
      addFlag(
        "warning",
        relation.match_method === "ambiguous" ? "ambiguous_portal_crosswalk" : "unmatched_portal_crosswalk",
        relation.match_method === "ambiguous"
          ? "Multiple portal P/A/P records match the available relationship fields."
          : "No portal P/A/P record matches the available relationship fields.",
        { candidates: JSON.parse(relation.candidate_portal_fpap_ids_json) as unknown },
        row?.source_sheet ?? "unknown",
        relation.source_row_id,
        relation.subject_id,
      );
    }
  }

  for (const row of rowContexts) {
    const relation = crosswalk.find((candidate) => candidate.source_row_id === row.sourceRow.source_row_id);
    if (!relation?.historical_portal_department_id) continue;
    const portalDepartment = portal.departmentsById.get(relation.historical_portal_department_id);
    if (
      portalDepartment &&
      normalizeName(portalDepartment.description) !== normalizeName(row.sourceRow.source_department_name)
    ) {
      addFlag(
        "warning",
        "department_name_mismatch",
        "Source and portal department names differ even though the structural codes relate.",
        {
          source_department_name: row.sourceRow.source_department_name,
          portal_department_name: portalDepartment.description,
        },
        row.sourceRow.source_sheet,
        row.sourceRow.source_row_id,
        row.sourceRow.subject_id,
      );
    }
  }

  const subjectRecords: SubjectRecord[] = [...subjects.values()]
    .map((subject) => {
      const override = canonicalAgencyOverride(subject.displayName);
      const mostFrequent = [...subject.matchedAgencyCounts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0]?.[0];
      const canonicalAgencyId = override ?? mostFrequent ?? null;
      const coverage = Object.fromEntries(
        [...subject.reportedCoverage.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([stage, years]) => [stage, [...years].sort((a, b) => a - b)]),
      );
      return {
        subject_id: subject.subjectId,
        source_sheet: subject.sourceSheet,
        display_name: subject.displayName,
        is_primary_subject: subject.isPrimary,
        canonical_portal_department_id: canonicalAgencyId?.slice(0, 2) ?? null,
        canonical_portal_agency_id: canonicalAgencyId,
        source_pairs_json: JSON.stringify([...subject.sourcePairs].sort()),
        coverage_json: JSON.stringify(coverage),
      };
    })
    .sort((a, b) => a.subject_id.localeCompare(b.subject_id));

  const matchCounts = Object.fromEntries(
    [...crosswalk.reduce((counts, row) => {
      counts.set(row.match_method, (counts.get(row.match_method) ?? 0) + 1);
      return counts;
    }, new Map<string, number>())].sort(([a], [b]) => a.localeCompare(b)),
  );
  const qualityCounts = Object.fromEntries(
    [...qualityFlags.reduce((counts, row) => {
      counts.set(row.code, (counts.get(row.code) ?? 0) + 1);
      return counts;
    }, new Map<string, number>())].sort(([a], [b]) => a.localeCompare(b)),
  );
  const manifest = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    source_file: args.input,
    source_filename: basename(args.input),
    source_sha256: await sha256(args.input),
    source_size_bytes: statSync(args.input).size,
    scope: "current_new_appropriations",
    units: "PHP",
    years: [...new Set(values.map((row) => row.fiscal_year))].sort((a, b) => a - b),
    stages: Object.values(STAGE_NAMES),
    expense_classes: Object.values(EXPENSE_CLASS_NAMES),
    counts: {
      worksheets: workbook.worksheets.length,
      source_columns: sourceColumns.length,
      source_rows: sourceRows.length,
      production_source_rows: sourceRows.filter((row) => row.is_production).length,
      normalized_values: values.length,
      reported_values: values.filter((row) => row.is_reported).length,
      production_reported_values: values.filter((row) => row.is_production && row.is_reported).length,
      subjects: subjectRecords.length,
      primary_subjects: subjectRecords.filter((row) => row.is_primary_subject).length,
      crosswalk_rows: crosswalk.length,
      quality_flags: qualityFlags.length,
    },
    match_counts: matchCounts,
    quality_counts: qualityCounts,
  };

  writeNdjson(join(args.output, "source-columns.ndjson"), sourceColumns);
  writeNdjson(join(args.output, "source-rows.ndjson"), sourceRows);
  writeNdjson(join(args.output, "values.ndjson"), values);
  writeNdjson(join(args.output, "crosswalk.ndjson"), crosswalk);
  writeNdjson(join(args.output, "subjects.ndjson"), subjectRecords);
  writeFileSync(join(args.output, "subjects.json"), JSON.stringify(subjectRecords, null, 2) + "\n");
  writeNdjson(join(args.output, "quality-flags.ndjson"), qualityFlags);
  writeFileSync(join(args.output, "quality-report.json"), JSON.stringify({ counts: qualityCounts, flags: qualityFlags }, null, 2) + "\n");
  writeNdjson(join(args.output, "manifest.ndjson"), [
    {
      schema_version: manifest.schema_version,
      generated_at: manifest.generated_at,
      source_file: manifest.source_file,
      source_filename: manifest.source_filename,
      source_sha256: manifest.source_sha256,
      source_size_bytes: manifest.source_size_bytes,
      scope: manifest.scope,
      units: manifest.units,
      years_json: JSON.stringify(manifest.years),
      stages_json: JSON.stringify(manifest.stages),
      expense_classes_json: JSON.stringify(manifest.expense_classes),
      counts_json: JSON.stringify(manifest.counts),
      match_counts_json: JSON.stringify(manifest.match_counts),
      quality_counts_json: JSON.stringify(manifest.quality_counts),
    },
  ]);
  writeFileSync(join(args.output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  let sqlitePath: string | null = null;
  if (args.sqlite) sqlitePath = await buildSqlite(args.output, args.force);

  process.stdout.write(
    [
      `Imported ${manifest.source_filename}`,
      `  source rows:       ${manifest.counts.source_rows.toLocaleString()} (${manifest.counts.production_source_rows.toLocaleString()} production)`,
      `  normalized values: ${manifest.counts.normalized_values.toLocaleString()} (${manifest.counts.reported_values.toLocaleString()} reported)`,
      `  subjects:          ${manifest.counts.subjects.toLocaleString()} (${manifest.counts.primary_subjects.toLocaleString()} primary)`,
      `  crosswalk:         ${JSON.stringify(matchCounts)}`,
      `  quality flags:     ${manifest.counts.quality_flags.toLocaleString()} ${JSON.stringify(qualityCounts)}`,
      `  output:            ${args.output}`,
      sqlitePath ? `  sqlite:            ${sqlitePath}` : "  sqlite:            skipped",
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
