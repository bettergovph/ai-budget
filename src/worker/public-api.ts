/**
 * Public REST API (v1) over the Philippine budget datasets in D1.
 *
 * Everything under /api/v1 is versioned, CORS-open, read-only, and — unlike
 * the internal /api routes the SPA uses — serves every amount in EXACT PESOS.
 * The GAA tables store thousands of pesos (DOUBLE); we rescale on the way out
 * so public consumers never have to know that. NEP FY2027 tables already store
 * integer pesos and budget-cycle values are REAL pesos, so those pass through.
 *
 * Datasets:
 *   gaa           FY2020–2026 General Appropriations Act (38 departments)
 *   nep/2027      FY2027 National Expenditure Program vs the FY2026 GAA
 *   budget-cycle  NEP → GAA → execution stages for selected departments
 *
 * Conventions:
 *   - Envelope: { meta: {...}, data: ... } (+ next_cursor on paginated lists)
 *   - Errors:   { error: "<slug>", message } with a matching HTTP status
 *   - Cursors:  opaque base64; pass back verbatim, never construct
 *   - CORS:     Access-Control-Allow-Origin: * on every response
 *
 * The MCP server (src/worker/mcp.ts) calls the same data functions, so the
 * REST API and MCP tools can never drift apart.
 */

import { OPENAPI_SPEC } from "./openapi";

export const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026] as const;

/** GAA D1 columns hold thousands of pesos; the public API serves pesos. */
const GAA_SCALE = 1000;

const DEPT_ID_RE = /^\d{2}$/;
const NEP_DEPT_ID_RE = /^[A-Z0-9]{1,6}$/;

export const NEP_DIMENSIONS = [
  "agency", "program", "expense_class", "fund",
  "region", "object", "operating_unit", "division",
] as const;
const NEP_DIMENSION_SET = new Set<string>(NEP_DIMENSIONS);

/** UACS expense classes as they appear in this dataset (there is no 4/5). */
export const EXPENSE_CLASS_LABELS: Record<string, string> = {
  "1": "Personnel Services",
  "2": "Maintenance and Other Operating Expenses",
  "3": "Financial Expenses",
  "6": "Capital Outlays",
};

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

interface WideRow {
  [col: string]: unknown;
}

type YearMap = Record<number, { count: number; amount: number }>;

async function q<T = WideRow>(env: Env, sql: string, ...binds: unknown[]): Promise<T[]> {
  const { results } = await env.DB.prepare(sql).bind(...binds).all<T>();
  return results ?? [];
}

/** Round away float dust from DOUBLE(thousands) × 1000. */
function pesos(v: unknown): number {
  return Math.round(Number(v ?? 0) * GAA_SCALE);
}

/**
 * Fold wide amount_YYYY / count_YYYY columns into a nested
 * `years: { "2020": { count, amount }, ... }` map with amounts rescaled from
 * thousands to pesos. Every canonical year key is present (zeroed when the
 * source has no row for that year).
 */
function widenPesos(row: WideRow): WideRow & { years: YearMap } {
  const years: YearMap = {};
  const out: WideRow = {};
  for (const [k, v] of Object.entries(row)) {
    const am = /^amount_(\d{4})$/.exec(k);
    const cm = /^count_(\d{4})$/.exec(k);
    if (am) {
      if (v == null) continue;
      (years[Number(am[1])] ??= { count: 0, amount: 0 }).amount = pesos(v);
    } else if (cm) {
      if (v == null) continue;
      (years[Number(cm[1])] ??= { count: 0, amount: 0 }).count = Number(v);
    } else {
      out[k] = v;
    }
  }
  for (const y of YEARS) years[y] ??= { count: 0, amount: 0 };
  return { ...out, years };
}

/**
 * Strip the wide per-year columns and emit ONE year's figures in pesos — the
 * per-year-exclusive counterpart of widenPesos. Non-year columns (ids, slug,
 * description, parent FKs) pass through, so drill consumers keep the ids they
 * need for the next level.
 */
function singleYearPesos(row: WideRow, year: number): WideRow & { year: number; line_items: number; amount: number } {
  const out: WideRow = {};
  for (const [k, v] of Object.entries(row)) {
    if (/^(amount|count)_\d{4}$/.test(k)) continue;
    out[k] = v;
  }
  return { ...out, year, line_items: Number(row[`count_${year}`] ?? 0), amount: pesos(row[`amount_${year}`]) };
}

function intParam(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function yearParam(raw: string | null): number {
  const y = Number(raw ?? 2026);
  if (!(YEARS as readonly number[]).includes(y)) {
    throw new ApiError(400, "bad_request", `year must be one of ${YEARS.join(", ")}`);
  }
  return y;
}

function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (m) => `\\${m}`);
}

/** Opaque keyset cursor: base64(JSON {v: sortValue, k: tiebreakKey}). */
function encodeCursor(v: unknown, k: string): string {
  return btoa(JSON.stringify({ v, k }));
}

function decodeCursor(raw: string | null): { v: unknown; k: string } | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(atob(raw)) as { v: unknown; k: string };
    if (typeof c !== "object" || c == null || typeof c.k !== "string") throw new Error("bad shape");
    return c;
  } catch {
    throw new ApiError(400, "bad_cursor", "cursor is not a cursor this API issued");
  }
}

function assertGaaDept(id: string): void {
  if (!DEPT_ID_RE.test(id)) {
    throw new ApiError(400, "bad_request", "GAA department ids are two digits, e.g. 07");
  }
}

function assertNepDept(id: string): void {
  if (!NEP_DEPT_ID_RE.test(id)) {
    throw new ApiError(400, "bad_request", "NEP department ids are 1–6 uppercase alphanumerics, e.g. 07 or SPF");
  }
}

const GAA_META = { dataset: "gaa", years: YEARS, currency: "PHP", scale: "pesos" } as const;
const NEP_META = { dataset: "nep", fiscal_year: 2027, baseline_year: 2026, currency: "PHP", scale: "pesos" } as const;
const CYCLE_META = { dataset: "budget-cycle", currency: "PHP", scale: "pesos" } as const;

// ---------------------------------------------------------------------------
// GAA (FY2020–2026) data layer
// ---------------------------------------------------------------------------

export async function gaaNational(env: Env) {
  const [years, [{ n: departments }]] = await Promise.all([
    q<{ year: number; count: number; amount: number }>(
      env,
      `SELECT year, SUM(count) AS count, SUM(amount) AS amount
         FROM yearly_totals GROUP BY year ORDER BY year`,
    ),
    q<{ n: number }>(env, `SELECT COUNT(*) AS n FROM departments`),
  ]);
  return {
    meta: { ...GAA_META, departments },
    data: years.map((r) => ({ year: r.year, line_items: Number(r.count), amount: pesos(r.amount) })),
  };
}

export async function gaaDepartments(env: Env) {
  const rows = await q(env, `SELECT * FROM departments ORDER BY amount_2026 DESC`);
  return {
    meta: { ...GAA_META, total_items: rows.length },
    data: rows.map(widenPesos),
  };
}

function assertYear(year: number): void {
  if (!(YEARS as readonly number[]).includes(year)) {
    throw new ApiError(400, "bad_request", `year must be one of ${YEARS.join(", ")}`);
  }
}

/** Per-year national snapshot: every department's figure for one fiscal year,
    largest first — the API face of the /gaa/:year browser's top level. */
export async function gaaYearSnapshot(env: Env, year: number) {
  assertYear(year);
  const rows = await q<{ id: string; slug: string; description: string; count: number; amount: number }>(
    env,
    `SELECT d.id, d.slug, d.description, y.count, y.amount
       FROM yearly_totals y JOIN departments d ON d.id = y.department_id
      WHERE y.year = ? ORDER BY y.amount DESC, d.id`,
    year,
  );
  const totalRaw = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const lineItems = rows.reduce((s, r) => s + Number(r.count ?? 0), 0);
  return {
    meta: { ...GAA_META, year, departments: rows.length },
    data: {
      total: { year, line_items: lineItems, amount: pesos(totalRaw) },
      departments: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        description: r.description,
        year,
        line_items: Number(r.count ?? 0),
        amount: pesos(r.amount),
        share: totalRaw ? Number((Number(r.amount ?? 0) / totalRaw).toFixed(6)) : null,
      })),
    },
  };
}

export const GAA_HIERARCHY_LEVELS = [
  "agencies", "fpaps", "operating_units", "fund_subcategories", "expenses",
] as const;

/** level → backing table, parent FK, and a human hint for the 400 message. */
const GAA_CHILD_SPECS: Record<string, { table: string; parentCol: string | null; parentHint: string }> = {
  agencies: { table: "agencies", parentCol: null, parentHint: "" },
  fpaps: { table: "fpaps", parentCol: "agency_id", parentHint: "an agency id (from level=agencies)" },
  operating_units: { table: "operating_units", parentCol: "fpap_id", parentHint: "a program id (from level=fpaps)" },
  fund_subcategories: { table: "fund_subcategories", parentCol: "operating_unit_id", parentHint: "an operating-unit id (from level=operating_units)" },
  expenses: { table: "expenses", parentCol: "fund_id", parentHint: "a fund id (from level=fund_subcategories)" },
};

export interface GaaYearChildrenOpts {
  level?: string;
  parent?: string;
  limit?: number;
  cursor?: string | null;
  include_zero?: boolean;
}

/**
 * One drill level's children for a single fiscal year — the API face of the
 * /gaa/:year browser's hierarchy (department → agency → program (FPAP) →
 * operating unit → fund → expense class). Rows carry that year's figures
 * only, plus the parent-id columns needed to drill further. Zero-amount rows
 * (lines that exist only in other budget years) are hidden by default.
 */
export async function gaaYearChildren(env: Env, year: number, deptId: string, opts: GaaYearChildrenOpts = {}) {
  assertYear(year);
  assertGaaDept(deptId);
  const level = opts.level ?? "agencies";
  const spec = GAA_CHILD_SPECS[level];
  if (!spec) {
    throw new ApiError(400, "bad_request", `level must be one of ${GAA_HIERARCHY_LEVELS.join(", ")}`);
  }
  if (spec.parentCol && !opts.parent) {
    throw new ApiError(400, "bad_request", `level=${level} requires parent=${spec.parentHint}`);
  }
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
  const cursor = decodeCursor(opts.cursor ?? null);
  const amt = `COALESCE(amount_${year}, 0)`;

  const conds = [
    `department_id = ?`,
    `LOWER(COALESCE(description,'')) <> 'nan'`,
    `COALESCE(slug,'') <> 'nan'`,
  ];
  const binds: unknown[] = [deptId];
  if (spec.parentCol) {
    conds.push(`${spec.parentCol} = ?`);
    binds.push(opts.parent);
  }
  if (!opts.include_zero) conds.push(`${amt} > 0`);
  const sumConds = [...conds];
  const sumBinds = [...binds];
  if (cursor) {
    conds.push(`(${amt} < ? OR (${amt} = ? AND id > ?))`);
    binds.push(cursor.v, cursor.v, cursor.k);
  }

  const rows = await q<WideRow & { id: string }>(
    env,
    `SELECT * FROM ${spec.table} WHERE ${conds.join(" AND ")}
      ORDER BY ${amt} DESC, id ASC LIMIT ${limit + 1}`,
    ...binds,
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  const [summary] = await q<{ n: number; total: number }>(
    env,
    `SELECT COUNT(*) AS n, COALESCE(SUM(${amt}), 0) AS total FROM ${spec.table} WHERE ${sumConds.join(" AND ")}`,
    ...sumBinds,
  );

  return {
    meta: {
      ...GAA_META,
      year,
      department_id: deptId,
      level,
      parent: opts.parent ?? null,
      limit,
      matched: Number(summary.n),
      matched_amount: pesos(summary.total),
    },
    data: page.map((row) => singleYearPesos(row, year)),
    next_cursor: hasMore && last
      ? encodeCursor(Number(last[`amount_${year}`] ?? 0), String(last.id))
      : null,
  };
}

export async function gaaDepartment(env: Env, deptId: string) {
  assertGaaDept(deptId);
  const [depts, yearly, agencies, expenseClasses] = await Promise.all([
    q(env, `SELECT * FROM departments WHERE id = ?`, deptId),
    q<{ year: number; count: number; amount: number }>(
      env, `SELECT year, count, amount FROM yearly_totals WHERE department_id = ? ORDER BY year`, deptId,
    ),
    q(env, `SELECT * FROM agencies WHERE department_id = ? ORDER BY id`, deptId),
    gaaExpenseClassRows(env, deptId),
  ]);
  if (!depts.length) throw new ApiError(404, "not_found", `No GAA department ${deptId}`);
  return {
    meta: { ...GAA_META, department_id: deptId },
    data: {
      department: widenPesos(depts[0]),
      yearly_totals: yearly.map((r) => ({ year: r.year, line_items: Number(r.count), amount: pesos(r.amount) })),
      agencies: agencies.map(widenPesos),
      expense_classes: expenseClasses,
    },
  };
}

async function gaaExpenseClassRows(env: Env, deptId: string) {
  const rows = await q(
    env,
    `SELECT expense_code,
            ${YEARS.map((y) => `SUM(COALESCE(amount_${y},0)) AS amount_${y}, SUM(COALESCE(count_${y},0)) AS count_${y}`).join(", ")}
       FROM gaa_dept_expense_classes
      WHERE department_id = ?
      GROUP BY expense_code ORDER BY expense_code`,
    deptId,
  );
  return rows.map((r) => ({
    ...widenPesos(r),
    label: EXPENSE_CLASS_LABELS[String(r.expense_code)] ?? null,
  }));
}

export async function gaaDeptExpenseClasses(env: Env, deptId: string) {
  assertGaaDept(deptId);
  const data = await gaaExpenseClassRows(env, deptId);
  if (!data.length) throw new ApiError(404, "not_found", `No GAA department ${deptId}`);
  return { meta: { ...GAA_META, department_id: deptId }, data };
}

export interface GaaProgramsOpts {
  year?: number;
  query?: string;
  agency_id?: string;
  limit?: number;
  cursor?: string | null;
}

/** Program families (deduplicated P/A/P names) for one department, largest first. */
export async function gaaDeptPrograms(env: Env, deptId: string, opts: GaaProgramsOpts = {}) {
  assertGaaDept(deptId);
  const year = opts.year ?? 2026;
  if (!(YEARS as readonly number[]).includes(year)) {
    throw new ApiError(400, "bad_request", `year must be one of ${YEARS.join(", ")}`);
  }
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
  const cursor = decodeCursor(opts.cursor ?? null);
  const amt = `COALESCE(amount_${year}, 0)`;

  const conds = [`department_id = ?`];
  const binds: unknown[] = [deptId];
  if (opts.agency_id) {
    conds.push(`agency_id = ?`);
    binds.push(opts.agency_id);
  }
  if (opts.query) {
    conds.push(`name LIKE ? ESCAPE '\\'`);
    binds.push(`%${escapeLike(opts.query)}%`);
  }
  const sumConds = conds.join(" AND ");
  const sumBinds = [...binds];
  if (cursor) {
    conds.push(`(${amt} < ? OR (${amt} = ? AND fam_key > ?))`);
    binds.push(cursor.v, cursor.v, cursor.k);
  }

  const rows = await q<WideRow & { fam_key: string }>(
    env,
    `SELECT * FROM gaa_fpap_families WHERE ${conds.join(" AND ")}
      ORDER BY ${amt} DESC, fam_key ASC LIMIT ${limit + 1}`,
    ...binds,
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  const [summary] = await q<{ n: number; total: number }>(
    env,
    `SELECT COUNT(*) AS n, COALESCE(SUM(${amt}), 0) AS total FROM gaa_fpap_families WHERE ${sumConds}`,
    ...sumBinds,
  );

  return {
    meta: {
      ...GAA_META,
      department_id: deptId,
      year,
      query: opts.query ?? null,
      agency_id: opts.agency_id ?? null,
      limit,
      matched: Number(summary.n),
      matched_amount: pesos(summary.total),
    },
    data: page.map(widenPesos),
    next_cursor: hasMore && last
      ? encodeCursor(Number(last[`amount_${year}`] ?? 0), String(last.fam_key))
      : null,
  };
}

export interface GaaSearchOpts {
  query: string;
  department_id?: string;
  year?: number;
  limit?: number;
}

/** Cross-department search over program-family names. */
export async function gaaSearchPrograms(env: Env, opts: GaaSearchOpts) {
  const query = (opts.query ?? "").trim();
  if (query.length < 2) throw new ApiError(400, "bad_request", "query must be at least 2 characters");
  const year = opts.year ?? 2026;
  if (!(YEARS as readonly number[]).includes(year)) {
    throw new ApiError(400, "bad_request", `year must be one of ${YEARS.join(", ")}`);
  }
  const limit = Math.max(1, Math.min(100, opts.limit ?? 25));

  const conds = [`f.name LIKE ? ESCAPE '\\'`];
  const binds: unknown[] = [`%${escapeLike(query)}%`];
  if (opts.department_id) {
    assertGaaDept(opts.department_id);
    conds.push(`f.department_id = ?`);
    binds.push(opts.department_id);
  }
  const rows = await q(
    env,
    `SELECT f.*, d.description AS department
       FROM gaa_fpap_families f JOIN departments d ON d.id = f.department_id
      WHERE ${conds.join(" AND ")}
      ORDER BY COALESCE(f.amount_${year}, 0) DESC, f.fam_key ASC
      LIMIT ?`,
    ...binds,
    limit,
  );
  return {
    meta: { ...GAA_META, query, year, department_id: opts.department_id ?? null, limit, returned: rows.length },
    data: rows.map(widenPesos),
  };
}

export interface GaaObjectsOpts {
  year?: number;
  query?: string;
  agency_id?: string;
  expense_class?: string;
  sort?: "amount" | "description" | "code" | "total";
  dir?: "asc" | "desc";
  limit?: number;
  cursor?: string | null;
  include_zero?: boolean;
}

const OBJECT_SORTS = {
  amount: (year: number) => `amount_${year}`,
  description: () => `description`,
  code: () => `object_code`,
  total: () => `(${YEARS.map((y) => `COALESCE(amount_${y},0)`).join(" + ")})`,
} as const;

/** Keyset-paginated line items (UACS object level) for one department. */
export async function gaaDeptObjects(env: Env, deptId: string, opts: GaaObjectsOpts = {}) {
  assertGaaDept(deptId);
  const year = opts.year ?? 2026;
  if (!(YEARS as readonly number[]).includes(year)) {
    throw new ApiError(400, "bad_request", `year must be one of ${YEARS.join(", ")}`);
  }
  const sort = opts.sort ?? "amount";
  if (!(sort in OBJECT_SORTS)) {
    throw new ApiError(400, "bad_request", `sort must be one of ${Object.keys(OBJECT_SORTS).join(", ")}`);
  }
  const numericSort = sort === "amount" || sort === "total";
  const dir = opts.dir === "asc" ? "ASC" : opts.dir === "desc" ? "DESC" : numericSort ? "DESC" : "ASC";
  const limit = Math.max(1, Math.min(500, opts.limit ?? 100));
  const cursor = decodeCursor(opts.cursor ?? null);
  const includeZero = opts.include_zero || sort === "total";
  const sortCol = OBJECT_SORTS[sort](year);

  const where = [
    "department_id = ?",
    "description IS NOT NULL",
    "description != 'nan'",
  ];
  const binds: unknown[] = [deptId];
  if (!includeZero) where.push(`amount_${year} > 0`);
  if (opts.agency_id) {
    where.push("agency_id = ?");
    binds.push(opts.agency_id);
  }
  if (opts.expense_class) {
    if (!(opts.expense_class in EXPENSE_CLASS_LABELS)) {
      throw new ApiError(400, "bad_request", "expense_class must be one of 1 (PS), 2 (MOOE), 3 (FinEx), 6 (CO)");
    }
    where.push("expense_id LIKE ?");
    binds.push(`%-${opts.expense_class}`);
  }
  if (opts.query) {
    const like = `%${opts.query.toLowerCase()}%`;
    where.push("(LOWER(description) LIKE ? OR LOWER(object_code) LIKE ? OR LOWER(IFNULL(slug,'')) LIKE ?)");
    binds.push(like, like, like);
  }

  const pageWhere = where.slice();
  const pageBinds = binds.slice();
  if (cursor) {
    const op = dir === "DESC" ? "<" : ">";
    pageWhere.push(`(${sortCol} ${op} ? OR (${sortCol} = ? AND id ${op} ?))`);
    pageBinds.push(cursor.v, cursor.v, cursor.k);
  }
  pageBinds.push(limit + 1);

  const rows = await q<WideRow & { id: string; _sort_v?: unknown }>(
    env,
    `SELECT *, ${sortCol} AS _sort_v FROM objects
      WHERE ${pageWhere.join(" AND ")}
      ORDER BY _sort_v ${dir}, id ${dir}
      LIMIT ?`,
    ...pageBinds,
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  let summary: { count: number; amount: number } | null = null;
  if (!cursor) {
    const sumExpr = sort === "total" ? OBJECT_SORTS.total() : `amount_${year}`;
    const [s] = await q<{ n: number; s: number }>(
      env,
      `SELECT COUNT(*) AS n, COALESCE(SUM(${sumExpr}), 0) AS s FROM objects WHERE ${where.join(" AND ")}`,
      ...binds,
    );
    summary = { count: Number(s.n), amount: pesos(s.s) };
  }

  return {
    meta: {
      ...GAA_META,
      department_id: deptId,
      year,
      sort,
      dir: dir.toLowerCase(),
      limit,
      ...(summary ? { matched: summary.count, matched_amount: summary.amount } : {}),
    },
    data: page.map((row) => {
      const { _sort_v, ...rest } = row;
      void _sort_v;
      return widenPesos(rest);
    }),
    next_cursor: hasMore && last ? encodeCursor(last._sort_v, String(last.id)) : null,
  };
}

// ---------------------------------------------------------------------------
// NEP FY2027 data layer
// ---------------------------------------------------------------------------

interface NepRollupRow {
  code: string;
  description: string | null;
  extra: string | null;
  count: number;
  amount: number;
  base_amount: number;
}

type WithDelta<T> = T & { delta: number; pct: number | null };

function withDelta<T extends { amount: number; base_amount: number }>(r: T): WithDelta<T> {
  const delta = r.amount - r.base_amount;
  return { ...r, delta, pct: r.base_amount ? (delta / r.base_amount) * 100 : null };
}

async function nepMeta(env: Env) {
  const [meta] = await q<{
    fiscal_year: number; baseline_year: number; generated_at: string;
    source_file: string; line_items: number; amount: number; base_amount: number;
  }>(env, `SELECT * FROM nep_meta LIMIT 1`);
  if (!meta) throw new ApiError(503, "not_loaded", "FY2027 NEP data is not loaded");
  return meta;
}

async function nepNationalRollup(env: Env, dimension: string, limit?: number) {
  const rows = await q<NepRollupRow>(
    env,
    `SELECT code,
            MAX(description) AS description,
            MAX(extra)       AS extra,
            SUM(count)       AS count,
            SUM(amount)      AS amount,
            SUM(base_amount) AS base_amount
       FROM nep_rollups
      WHERE dimension = ?
      GROUP BY code
      ORDER BY amount DESC
      ${limit ? "LIMIT ?" : ""}`,
    ...(limit ? [dimension, limit] : [dimension]),
  );
  return rows.map(withDelta);
}

export async function nepOverview(env: Env) {
  const meta = await nepMeta(env);
  const departments = (await q(env, `SELECT * FROM nep_departments ORDER BY amount DESC`))
    .map((d) => withDelta(d as { amount: number; base_amount: number }));

  const [expense_classes, regions, funds, top_programs] = await Promise.all([
    nepNationalRollup(env, "expense_class"),
    nepNationalRollup(env, "region"),
    nepNationalRollup(env, "fund", 25),
    q<NepRollupRow & { department_id: string }>(
      env,
      `SELECT department_id, code, description, extra, count, amount, base_amount
         FROM nep_rollups WHERE dimension = 'program'
        ORDER BY amount DESC LIMIT 25`,
    ).then((rs) => rs.map(withDelta)),
  ]);

  const byDelta = [...departments].sort((a, b) => b.delta - a.delta);

  return {
    meta: { ...NEP_META, generated_at: meta.generated_at, source_file: meta.source_file },
    data: {
      national: withDelta({
        line_items: meta.line_items,
        amount: meta.amount,
        base_amount: meta.base_amount,
      }),
      departments,
      expense_classes,
      regions,
      top_funds: funds,
      top_programs,
      top_movers_up: byDelta.slice(0, 10),
      top_movers_down: byDelta.slice(-10).reverse(),
    },
  };
}

export async function nepDepartments(env: Env) {
  const rows = (await q(env, `SELECT * FROM nep_departments ORDER BY amount DESC`))
    .map((d) => withDelta(d as { amount: number; base_amount: number }));
  if (!rows.length) throw new ApiError(503, "not_loaded", "FY2027 NEP data is not loaded");
  return { meta: { ...NEP_META, total_items: rows.length }, data: rows };
}

/** Long-tail dimensions are capped in the department detail; the remainder is
    folded into an explicit `__other__` row so lists still sum to the total. */
const NEP_DETAIL_CAP = 50;

export async function nepDepartment(env: Env, deptId: string) {
  assertNepDept(deptId);
  const [department] = await q(env, `SELECT * FROM nep_departments WHERE id = ?`, deptId);
  if (!department) throw new ApiError(404, "not_found", `No FY2027 NEP department ${deptId}`);

  const rows = await q<NepRollupRow & { dimension: string }>(
    env,
    `SELECT dimension, code, description, extra, count, amount, base_amount
       FROM nep_rollups WHERE department_id = ? ORDER BY dimension, amount DESC`,
    deptId,
  );
  const byDim = new Map<string, Array<WithDelta<NepRollupRow>>>();
  for (const r of rows) {
    const { dimension, ...rest } = r;
    (byDim.get(dimension) ?? byDim.set(dimension, []).get(dimension)!).push(withDelta(rest));
  }
  const dim = (k: string) => byDim.get(k) ?? [];
  const capped = (k: string) => {
    const all = dim(k);
    if (all.length <= NEP_DETAIL_CAP + 1) return all;
    const head = all.slice(0, NEP_DETAIL_CAP);
    const tail = all.slice(NEP_DETAIL_CAP);
    const amount = tail.reduce((a, r) => a + r.amount, 0);
    const base_amount = tail.reduce((a, r) => a + r.base_amount, 0);
    head.push(withDelta({
      code: "__other__",
      description: `Other (${tail.length.toLocaleString()} more — use the rollups endpoint for the full list)`,
      extra: null,
      count: tail.reduce((a, r) => a + r.count, 0),
      amount,
      base_amount,
    }));
    return head;
  };

  const programs = dim("program");
  const movers = [...programs].sort((a, b) => b.delta - a.delta);

  return {
    meta: { ...NEP_META, department_id: deptId },
    data: {
      department: withDelta(department as { amount: number; base_amount: number }),
      agencies: dim("agency"),
      programs,
      expense_classes: dim("expense_class"),
      funds: dim("fund"),
      regions: dim("region"),
      top_objects: capped("object"),
      top_operating_units: capped("operating_unit"),
      top_divisions: capped("division"),
      top_movers_up: movers.slice(0, 10),
      top_movers_down: movers.slice(-10).reverse(),
    },
  };
}

export interface NepDeptRollupOpts {
  limit?: number;
  cursor?: string | null;
}

/** Complete, untruncated dimension rows for one department (keyset paginated). */
export async function nepDeptRollup(env: Env, deptId: string, dimension: string, opts: NepDeptRollupOpts = {}) {
  assertNepDept(deptId);
  if (!NEP_DIMENSION_SET.has(dimension)) {
    throw new ApiError(400, "bad_request", `dimension must be one of ${NEP_DIMENSIONS.join(", ")}`);
  }
  const limit = Math.max(1, Math.min(2000, opts.limit ?? 200));
  const cursor = decodeCursor(opts.cursor ?? null);

  const conds = [`department_id = ?`, `dimension = ?`];
  const binds: unknown[] = [deptId, dimension];
  if (cursor) {
    conds.push(`(amount < ? OR (amount = ? AND code > ?))`);
    binds.push(cursor.v, cursor.v, cursor.k);
  }
  const rows = await q<NepRollupRow>(
    env,
    `SELECT code, description, extra, count, amount, base_amount
       FROM nep_rollups WHERE ${conds.join(" AND ")}
      ORDER BY amount DESC, code ASC LIMIT ${limit + 1}`,
    ...binds,
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  const [summary] = await q<{ n: number }>(
    env,
    `SELECT COUNT(*) AS n FROM nep_rollups WHERE department_id = ? AND dimension = ?`,
    deptId, dimension,
  );

  return {
    meta: { ...NEP_META, department_id: deptId, dimension, limit, total_items: Number(summary.n) },
    data: page.map(withDelta),
    next_cursor: hasMore && last ? encodeCursor(last.amount, last.code) : null,
  };
}

export interface NepRollupOpts {
  code?: string;
  by_department?: boolean;
  limit?: number;
}

/** National rollup of one dimension, or one code broken down by department. */
export async function nepRollup(env: Env, dimension: string, opts: NepRollupOpts = {}) {
  if (!NEP_DIMENSION_SET.has(dimension)) {
    throw new ApiError(400, "bad_request", `dimension must be one of ${NEP_DIMENSIONS.join(", ")}`);
  }
  const limit = Math.max(1, Math.min(2000, opts.limit ?? 200));

  if (opts.by_department) {
    if (!opts.code) throw new ApiError(400, "bad_request", "by=department requires a code parameter");
    const rows = await q<NepRollupRow & { department_id: string }>(
      env,
      `SELECT r.department_id, d.description AS department, r.code, r.description,
              r.count, r.amount, r.base_amount
         FROM nep_rollups r JOIN nep_departments d ON d.id = r.department_id
        WHERE r.dimension = ? AND r.code = ?
        ORDER BY r.amount DESC LIMIT ?`,
      dimension, opts.code, limit,
    );
    return {
      meta: { ...NEP_META, dimension, code: opts.code, by: "department", limit },
      data: rows.map(withDelta),
    };
  }

  return {
    meta: { ...NEP_META, dimension, limit },
    data: await nepNationalRollup(env, dimension, limit),
  };
}

// ---------------------------------------------------------------------------
// Budget cycle data layer
// ---------------------------------------------------------------------------

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

async function cycleManifest(env: Env) {
  const [m] = await q<{
    generated_at: string; source_filename: string; source_sha256: string;
    scope: string; units: string; years_json: string; stages_json: string;
    expense_classes_json: string;
  }>(
    env,
    `SELECT generated_at, source_filename, source_sha256, scope, units,
            years_json, stages_json, expense_classes_json
       FROM budget_cycle_manifest ORDER BY generated_at DESC LIMIT 1`,
  );
  if (!m) throw new ApiError(503, "not_loaded", "Budget-cycle data is not loaded");
  return {
    generated_at: m.generated_at,
    source_filename: m.source_filename,
    source_sha256: m.source_sha256,
    scope: m.scope,
    units: m.units,
    years: parseJson<number[]>(m.years_json, []),
    stages: parseJson<string[]>(m.stages_json, []),
    expense_classes: parseJson<string[]>(m.expense_classes_json, []),
  };
}

export async function budgetCycleOverview(env: Env) {
  const [manifest, subjects] = await Promise.all([
    cycleManifest(env),
    q<WideRow & { source_pairs_json: string; coverage_json: string }>(
      env,
      `SELECT subject_id, source_sheet, display_name, is_primary_subject,
              canonical_portal_department_id, canonical_portal_agency_id,
              source_pairs_json, coverage_json
         FROM budget_cycle_subjects
        ORDER BY is_primary_subject DESC, display_name`,
    ),
  ]);
  return {
    meta: { ...CYCLE_META, ...manifest },
    data: {
      note: "Coverage is limited to the departments listed here, and to Current New Appropriations only — these figures are narrower in scope than the main GAA series and must not be compared 1:1 with it.",
      subjects: subjects.map(({ source_pairs_json, coverage_json, ...s }) => ({
        ...s,
        source_pairs: parseJson<string[]>(source_pairs_json, []),
        coverage: parseJson<Record<string, number[]>>(coverage_json, {}),
      })),
    },
  };
}

export async function budgetCycleDepartment(env: Env, deptId: string) {
  assertGaaDept(deptId);
  const departmentFilter = `(
    x.canonical_portal_department_id = ?
    OR (x.canonical_portal_department_id IS NULL AND x.source_department_code = ?)
  )`;

  const [manifest, programs, facts] = await Promise.all([
    cycleManifest(env),
    q(
      env,
      `SELECT
         x.source_row_id, x.subject_id, x.source_department_code,
         r.source_department_name, x.source_agency_code, r.source_agency_name,
         x.source_pap_code, x.source_pap_label,
         x.canonical_portal_fpap_id, x.portal_pap_label,
         x.match_method, x.match_confidence
       FROM budget_cycle_crosswalk x
       JOIN budget_cycle_source_rows r ON r.source_row_id = x.source_row_id
       WHERE ${departmentFilter}
       ORDER BY COALESCE(x.source_pap_label, x.portal_pap_label), x.source_row_id`,
      deptId, deptId,
    ),
    q(
      env,
      `SELECT v.source_row_id, v.fiscal_year, v.stage, v.expense_class, v.amount_pesos AS amount
         FROM budget_cycle_values v
         JOIN budget_cycle_crosswalk x ON x.source_row_id = v.source_row_id
        WHERE ${departmentFilter}
        ORDER BY v.fiscal_year, v.stage, v.expense_class, v.source_row_id`,
      deptId, deptId,
    ),
  ]);

  if (!programs.length) {
    throw new ApiError(404, "not_found",
      `No budget-cycle data for department ${deptId} — see /api/v1/budget-cycle for covered departments`);
  }

  return {
    meta: {
      ...CYCLE_META,
      ...manifest,
      department_id: deptId,
      counts: { programs: programs.length, facts: facts.length },
    },
    data: { programs, facts },
  };
}

// ---------------------------------------------------------------------------
// CORS + HTTP routing
// ---------------------------------------------------------------------------

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function ok(body: unknown, cacheSeconds = 300): Response {
  return Response.json(body, {
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": `public, max-age=${cacheSeconds}, s-maxage=3600`,
    },
  });
}

export function apiErrorResponse(e: unknown): Response {
  const err = e instanceof ApiError
    ? e
    : new ApiError(500, "query_failed", (e as Error).message ?? "internal error");
  return Response.json(
    { error: err.code, message: err.message },
    { status: err.status, headers: CORS_HEADERS },
  );
}

function apiIndex(origin: string) {
  return {
    name: "Philippine Budget Data API",
    version: "1.0.0",
    description:
      "Public read-only API over the Philippine General Appropriations Act (FY2020–2026), " +
      "the FY2027 National Expenditure Program, and NEP→GAA→execution budget-cycle data. " +
      "All amounts are exact Philippine pesos.",
    documentation: `${origin}/docs`,
    openapi: `${origin}/api/v1/openapi.json`,
    mcp: `${origin}/mcp`,
    source_data: "https://huggingface.co/datasets/bettergovph/gaa",
    endpoints: {
      gaa: [
        "GET /api/v1/gaa",
        "GET /api/v1/gaa/departments",
        "GET /api/v1/gaa/departments/{id}",
        "GET /api/v1/gaa/departments/{id}/expense-classes",
        "GET /api/v1/gaa/departments/{id}/programs",
        "GET /api/v1/gaa/departments/{id}/objects",
        "GET /api/v1/gaa/search",
        "GET /api/v1/gaa/years/{year}",
        "GET /api/v1/gaa/years/{year}/departments/{id}/children",
      ],
      nep_2027: [
        "GET /api/v1/nep/2027",
        "GET /api/v1/nep/2027/departments",
        "GET /api/v1/nep/2027/departments/{id}",
        "GET /api/v1/nep/2027/departments/{id}/rollups/{dimension}",
        "GET /api/v1/nep/2027/rollups/{dimension}",
      ],
      budget_cycle: [
        "GET /api/v1/budget-cycle",
        "GET /api/v1/budget-cycle/departments/{id}",
      ],
    },
  };
}

/** Route anything under /api/v1. Returns a CORS-tagged Response for every path. */
export async function handlePublicApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") return preflight();
  if (request.method !== "GET") {
    return Response.json(
      { error: "method_not_allowed", message: "The public API is read-only; use GET" },
      { status: 405, headers: { ...CORS_HEADERS, Allow: "GET, OPTIONS" } },
    );
  }

  const path = url.pathname.replace(/\/+$/, "") || "/api/v1";
  const sp = url.searchParams;

  try {
    if (path === "/api/v1") return ok(apiIndex(url.origin), 3600);
    if (path === "/api/v1/openapi.json") {
      const spec = { ...OPENAPI_SPEC, servers: [{ url: url.origin }] };
      return ok(spec, 3600);
    }

    // ---- GAA ----
    if (path === "/api/v1/gaa") return ok(await gaaNational(env));
    if (path === "/api/v1/gaa/departments") return ok(await gaaDepartments(env));
    if (path === "/api/v1/gaa/search") {
      return ok(await gaaSearchPrograms(env, {
        query: sp.get("q") ?? "",
        department_id: sp.get("department_id") ?? undefined,
        year: yearParam(sp.get("year")),
        limit: intParam(sp.get("limit"), 25, 1, 100),
      }));
    }
    let m = /^\/api\/v1\/gaa\/departments\/([^/]+)$/.exec(path);
    if (m) return ok(await gaaDepartment(env, m[1]));
    m = /^\/api\/v1\/gaa\/departments\/([^/]+)\/expense-classes$/.exec(path);
    if (m) return ok(await gaaDeptExpenseClasses(env, m[1]));
    m = /^\/api\/v1\/gaa\/departments\/([^/]+)\/programs$/.exec(path);
    if (m) {
      return ok(await gaaDeptPrograms(env, m[1], {
        year: yearParam(sp.get("year")),
        query: sp.get("q") ?? undefined,
        agency_id: sp.get("agency_id") ?? undefined,
        limit: intParam(sp.get("limit"), 100, 1, 500),
        cursor: sp.get("cursor"),
      }));
    }
    m = /^\/api\/v1\/gaa\/departments\/([^/]+)\/objects$/.exec(path);
    if (m) {
      return ok(await gaaDeptObjects(env, m[1], {
        year: yearParam(sp.get("year")),
        query: sp.get("q") ?? undefined,
        agency_id: sp.get("agency_id") ?? undefined,
        expense_class: sp.get("expense_class") ?? undefined,
        sort: (sp.get("sort") ?? undefined) as GaaObjectsOpts["sort"],
        dir: (sp.get("dir") ?? undefined) as GaaObjectsOpts["dir"],
        limit: intParam(sp.get("limit"), 100, 1, 500),
        cursor: sp.get("cursor"),
        include_zero: sp.get("include_zero") === "1" || sp.get("include_zero") === "true",
      }));
    }

    // Per-year exclusive views (the API face of the /gaa/:year browser).
    m = /^\/api\/v1\/gaa\/years\/(\d+)$/.exec(path);
    if (m) return ok(await gaaYearSnapshot(env, Number(m[1])));
    m = /^\/api\/v1\/gaa\/years\/(\d+)\/departments\/([^/]+)\/children$/.exec(path);
    if (m) {
      return ok(await gaaYearChildren(env, Number(m[1]), m[2], {
        level: sp.get("level") ?? undefined,
        parent: sp.get("parent") ?? undefined,
        limit: intParam(sp.get("limit"), 100, 1, 500),
        cursor: sp.get("cursor"),
        include_zero: sp.get("include_zero") === "1" || sp.get("include_zero") === "true",
      }));
    }

    // ---- NEP FY2027 ----
    if (path === "/api/v1/nep/2027") return ok(await nepOverview(env));
    if (path === "/api/v1/nep/2027/departments") return ok(await nepDepartments(env));
    m = /^\/api\/v1\/nep\/2027\/departments\/([^/]+)$/.exec(path);
    if (m) return ok(await nepDepartment(env, m[1]));
    m = /^\/api\/v1\/nep\/2027\/departments\/([^/]+)\/rollups\/([a-z_]+)$/.exec(path);
    if (m) {
      return ok(await nepDeptRollup(env, m[1], m[2], {
        limit: intParam(sp.get("limit"), 200, 1, 2000),
        cursor: sp.get("cursor"),
      }));
    }
    m = /^\/api\/v1\/nep\/2027\/rollups\/([a-z_]+)$/.exec(path);
    if (m) {
      return ok(await nepRollup(env, m[1], {
        code: sp.get("code") ?? undefined,
        by_department: sp.get("by") === "department",
        limit: intParam(sp.get("limit"), 200, 1, 2000),
      }));
    }

    // ---- Budget cycle ----
    if (path === "/api/v1/budget-cycle") return ok(await budgetCycleOverview(env));
    m = /^\/api\/v1\/budget-cycle\/departments\/([^/]+)$/.exec(path);
    if (m) return ok(await budgetCycleDepartment(env, m[1]));

    throw new ApiError(404, "not_found", `No such endpoint: ${path} — see /api/v1 for the endpoint index`);
  } catch (e) {
    return apiErrorResponse(e);
  }
}
