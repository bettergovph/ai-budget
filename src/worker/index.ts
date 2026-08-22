/// <reference path="../../worker-configuration.d.ts" />
/**
 * Worker for the ai-reports D1 query layer.
 *
 * Routes — Stage A/B return `{ metadata, data: [...] }` envelopes that the
 * existing client `loadDept*` flows already know how to parse:
 *
 *   GET /api/dept/:id/core         Stage A — departments + yearly_totals + agencies
 *   GET /api/dept/:id/mid          Stage B — fpaps + operating_units + fund_subcategories + expenses
 *   GET /api/dept/:id/objects      Stage C — full objects dump (legacy; streamed; used by /data view)
 *   GET /api/dept/:id/objects/page Server-paginated objects with filter/sort/keyset cursor + summary
 *
 * The /page route is what the Objects view uses now. It accepts:
 *   year   = 2020…2026   (required, default 2026; filters & sorts on amount_${year})
 *   bureau = agency_id   (optional)
 *   expense = code       (optional; suffix of expense_id)
 *   q      = text        (optional; LIKE against description/object_code/slug)
 *   sort   = amount|description|code  (default amount)
 *   dir    = asc|desc    (default desc for amount, asc otherwise)
 *   cursor = base64 keyset cursor from a previous response
 *   limit  = 1…1000      (default 200)
 *
 * Wide SQLite columns (amount_2020 … amount_2026 / count_2020 … count_2026)
 * are folded back into the nested `years: { YYYY: { count, amount } }`
 * shape on the way out, so the React side keeps consuming the same wire format.
 *
 * Non-API paths fall through to the static asset binding (the React SPA).
 */

// `Env` (DB: D1Database, ASSETS: Fetcher, …) is declared globally in
// worker-configuration.d.ts — rerun `wrangler types` if bindings change.

const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026] as const;

interface WideRow {
  [col: string]: unknown;
}

interface NestedYearMap {
  [year: number]: { count: number; amount: number };
}

/**
 * Strip amount_YYYY / count_YYYY columns off a wide row and re-emit them as
 * a nested `years: { 2020: {count, amount}, ... }` map — matching the JSON
 * envelope shape the React client already expects.
 *
 * `null` cells (years not in the source) are dropped entirely rather than
 * emitting `{count:0, amount:0}` — the client's `rescale()` already handles
 * missing year keys, and skipping them keeps payloads smaller.
 */
function widenToNested(row: WideRow): WideRow & { years: NestedYearMap } {
  const years: NestedYearMap = {};
  const out: WideRow = {};
  for (const [k, v] of Object.entries(row)) {
    const am = /^amount_(\d{4})$/.exec(k);
    const cm = /^count_(\d{4})$/.exec(k);
    if (am) {
      if (v == null) continue;
      const y = Number(am[1]);
      (years[y] ??= { count: 0, amount: 0 }).amount = Number(v);
    } else if (cm) {
      if (v == null) continue;
      const y = Number(cm[1]);
      (years[y] ??= { count: 0, amount: 0 }).count = Number(v);
    } else {
      out[k] = v;
    }
  }
  // Guarantee every canonical year key exists so the client can iterate
  // without holes; missing years come out as zeroed entries.
  for (const y of YEARS) {
    years[y] ??= { count: 0, amount: 0 };
  }
  return { ...out, years };
}

function badRequest(msg: string): Response {
  return Response.json({ error: msg }, { status: 400 });
}

async function queryDept<T = WideRow>(
  env: Env,
  sql: string,
  deptId: string,
): Promise<T[]> {
  const { results } = await env.DB.prepare(sql).bind(deptId).all<T>();
  return results ?? [];
}

async function queryBound<T = WideRow>(
  env: Env,
  sql: string,
  ...bindings: unknown[]
): Promise<T[]> {
  const { results } = await env.DB.prepare(sql).bind(...bindings).all<T>();
  return results ?? [];
}

const DEPT_ID_RE = /^\d{2}$/;

async function handleCore(env: Env, deptId: string): Promise<Response> {
  // Three small queries; D1 doesn't support multi-statement so we fan out
  // and assemble. Each individually is <100 rows so latency is dominated by
  // D1's RTT to the regional replica.
  const [departments, yearly, agencies] = await Promise.all([
    queryDept(env, `SELECT * FROM departments WHERE id = ?`, deptId),
    queryDept(env, `SELECT * FROM yearly_totals WHERE department_id = ? ORDER BY year`, deptId),
    queryDept(env, `SELECT * FROM agencies WHERE department_id = ? ORDER BY id`, deptId),
  ]);
  return Response.json(
    {
      departments: {
        metadata: { table: "departments", department_id: deptId, total_items: departments.length },
        data: departments.map(widenToNested),
      },
      yearly_totals: {
        metadata: { table: "yearly_totals", department_id: deptId, total_items: yearly.length },
        // yearly_totals is already long-form (year/count/amount), no widen needed.
        data: yearly,
      },
      agencies: {
        metadata: { table: "agencies", department_id: deptId, total_items: agencies.length },
        data: agencies.map(widenToNested),
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=3600",
      },
    },
  );
}

async function handleMid(env: Env, deptId: string): Promise<Response> {
  const [fpaps, opUnits, funds, expenses] = await Promise.all([
    queryDept(env, `SELECT * FROM fpaps WHERE department_id = ? ORDER BY id`, deptId),
    queryDept(env, `SELECT * FROM operating_units WHERE department_id = ? ORDER BY id`, deptId),
    queryDept(env, `SELECT * FROM fund_subcategories WHERE department_id = ? ORDER BY id`, deptId),
    queryDept(env, `SELECT * FROM expenses WHERE department_id = ? ORDER BY id`, deptId),
  ]);
  return Response.json(
    {
      fpaps: {
        metadata: { table: "fpaps", department_id: deptId, total_items: fpaps.length },
        data: fpaps.map(widenToNested),
      },
      operating_units: {
        metadata: { table: "operating_units", department_id: deptId, total_items: opUnits.length },
        data: opUnits.map(widenToNested),
      },
      fund_subcategories: {
        metadata: { table: "fund_subcategories", department_id: deptId, total_items: funds.length },
        data: funds.map(widenToNested),
      },
      expenses: {
        metadata: { table: "expenses", department_id: deptId, total_items: expenses.length },
        data: expenses.map(widenToNested),
      },
    },
    {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=3600" },
    },
  );
}

/**
 * Server-side filter + keyset paginate for the Objects view.
 *
 * Why keyset and not OFFSET: for DepEd the objects table is ~1M rows. OFFSET
 * 900000 forces SQLite to walk through 900K rows. Keyset pagination
 * (`WHERE (sort_col, id) [<|>] (?, ?)`) uses the index on the sort column
 * (or the PK for the id tiebreaker) and stays O(LIMIT) regardless of depth.
 *
 * The cursor is base64-encoded JSON `{ v: sortValue, id: rowId }` from the
 * last row of the previous page. The client treats it as opaque.
 *
 * On the first page (no cursor) we also compute COUNT(*) and SUM(amount)
 * over the same filter set so the UI can show "X items · ₱Y total" without
 * a second round-trip. We deliberately do NOT recompute summary on every
 * page — the client should hold onto it until the filter signature changes.
 */
/**
 * Sort options for the paginated /objects route. Each entry returns the SQL
 * expression to ORDER BY (and to use as the keyset cursor's `v` field).
 *
 * `total` sums every year's amount; this is what the Data tab sorts by by
 * default. We materialise it as a SQL expression rather than a named column
 * to keep the schema unchanged — the cost is roughly free since the wide
 * year columns are already in the same row.
 */
const SORT_COLS = {
  amount: (year: number) => `amount_${year}`,
  description: () => `description`,
  code: () => `object_code`,
  total: () =>
    `(COALESCE(amount_2020,0) + COALESCE(amount_2021,0) + COALESCE(amount_2022,0) + COALESCE(amount_2023,0) + COALESCE(amount_2024,0) + COALESCE(amount_2025,0) + COALESCE(amount_2026,0))`,
} as const;
type SortKey = keyof typeof SORT_COLS;

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 200;

function parsePageQuery(url: URL): {
  year: number;
  bureau: string | null;
  expense: string | null;
  q: string;
  sort: SortKey;
  dir: "ASC" | "DESC";
  limit: number;
  cursor: { v: unknown; id: string } | null;
  /**
   * When true, drop the `amount_${year} > 0` filter from the WHERE clause
   * — Data tab (sort=total) needs to see every row regardless of which
   * single-year column happens to be zero.
   */
  includeZero: boolean;
  error?: string;
} {
  const sp = url.searchParams;

  const yearRaw = sp.get("year");
  const year = yearRaw == null ? 2026 : Number(yearRaw);
  if (!(YEARS as readonly number[]).includes(year)) {
    return { error: `invalid year: ${yearRaw}` } as never;
  }

  const sortRaw = (sp.get("sort") ?? "amount") as SortKey;
  if (!(sortRaw in SORT_COLS)) {
    return { error: `invalid sort: ${sortRaw}` } as never;
  }
  const sort: SortKey = sortRaw;

  const dirRaw = sp.get("dir");
  // Numeric sorts (amount, total) default to DESC so the user sees "biggest
  // first"; string sorts (description, code) default to ASC for A-Z.
  const numericSort = sort === "amount" || sort === "total";
  const dir: "ASC" | "DESC" =
    dirRaw === "asc" ? "ASC" : dirRaw === "desc" ? "DESC" : numericSort ? "DESC" : "ASC";

  const limitRaw = sp.get("limit");
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(limitRaw) || DEFAULT_LIMIT));

  const bureauRaw = sp.get("bureau");
  const bureau = bureauRaw && bureauRaw !== "all" ? bureauRaw : null;

  const expenseRaw = sp.get("expense");
  const expense = expenseRaw && expenseRaw !== "all" ? expenseRaw : null;

  const q = (sp.get("q") ?? "").trim();

  const cursorRaw = sp.get("cursor");
  let cursor: { v: unknown; id: string } | null = null;
  if (cursorRaw) {
    try {
      cursor = JSON.parse(atob(cursorRaw));
      if (typeof cursor !== "object" || cursor == null || typeof cursor.id !== "string") {
        throw new Error("missing fields");
      }
    } catch (e) {
      return { error: `invalid cursor: ${(e as Error).message}` } as never;
    }
  }

  // Default: include_zero is implied when sorting by total (Data tab) since
  // the per-year filter doesn't make sense there. ObjectsView keeps the
  // year filter by sorting on amount/description/code.
  const includeZeroParam = sp.get("include_zero");
  const includeZero =
    includeZeroParam === "1" ||
    includeZeroParam === "true" ||
    sort === "total";

  return { year, bureau, expense, q, sort, dir, limit, cursor, includeZero };
}

async function handleObjectsPage(env: Env, deptId: string, url: URL): Promise<Response> {
  const p = parsePageQuery(url);
  if (p.error) return badRequest(p.error);

  const sortCol = SORT_COLS[p.sort](p.year);

  const where: string[] = [
    "department_id = ?",
    // Always hide the source's NaN sentinels. Whether we hide zero-amount
    // rows depends on the view's semantics — Objects (year-scoped) does;
    // Data (all-years) doesn't.
    "description IS NOT NULL",
    "description != 'nan'",
  ];
  if (!p.includeZero) {
    where.push(`amount_${p.year} > 0`);
  }
  const binds: unknown[] = [deptId];

  if (p.bureau) {
    where.push("agency_id = ?");
    binds.push(p.bureau);
  }
  if (p.expense) {
    // Existing client extracts the trailing segment of expense_id; match the
    // suffix server-side. The suffix is short so LIKE 'pattern' stays cheap.
    where.push("expense_id LIKE ?");
    binds.push(`%-${p.expense}`);
  }
  if (p.q) {
    const like = `%${p.q.toLowerCase()}%`;
    where.push("(LOWER(description) LIKE ? OR LOWER(object_code) LIKE ? OR LOWER(IFNULL(slug, '')) LIKE ?)");
    binds.push(like, like, like);
  }

  // Build the page query — keyset cursor predicate appended only when a
  // cursor was supplied. Tiebreaker on id keeps ordering stable when many
  // rows share the same amount/description/code.
  const pageWhere = where.slice();
  const pageBinds = binds.slice();
  if (p.cursor) {
    const op = p.dir === "DESC" ? "<" : ">";
    pageWhere.push(`(${sortCol} ${op} ? OR (${sortCol} = ? AND id ${op} ?))`);
    pageBinds.push(p.cursor.v, p.cursor.v, p.cursor.id);
  }
  const idDir = p.dir; // tiebreaker direction follows primary, keeps cursor math right

  // We alias the sort expression as `_sort_v` so the keyset cursor logic is
  // uniform across literal columns (`amount_2026`, `description`, …) and
  // computed expressions (the `total` sum). The alias is stripped from each
  // row before we widen it to the response shape.
  const pageSql = `
    SELECT *, ${sortCol} AS _sort_v FROM objects
    WHERE ${pageWhere.join(" AND ")}
    ORDER BY _sort_v ${p.dir}, id ${idDir}
    LIMIT ?
  `;
  // Fetch one extra row to detect whether more pages remain without a
  // second COUNT query.
  pageBinds.push(p.limit + 1);

  const { results: pageRowsRaw } = await env.DB.prepare(pageSql).bind(...pageBinds).all<WideRow>();
  const pageRows = pageRowsRaw ?? [];
  const hasMore = pageRows.length > p.limit;
  const rows = hasMore ? pageRows.slice(0, p.limit) : pageRows;
  const data = rows.map((row) => {
    // Strip the cursor-helper alias so it doesn't leak into the wire format.
    const { _sort_v, ...rest } = row as WideRow & { _sort_v?: unknown };
    void _sort_v;
    return widenToNested(rest);
  });

  let nextCursor: string | null = null;
  if (hasMore && rows.length > 0) {
    const last = rows[rows.length - 1];
    nextCursor = btoa(JSON.stringify({ v: last._sort_v, id: String(last.id) }));
  }

  // Summary covers the full filtered set (ignoring cursor) and is only
  // computed on the first page so subsequent page fetches stay cheap.
  // The `sum` dimension follows the active sort: amount-by-year sorts get a
  // SUM(amount_${year}); `total` sort gets SUM across all years (what the
  // Data tab wants); description/code sorts also use amount_${year} since
  // those views are still year-scoped in the UI.
  let summary: { count: number; sum: number } | null = null;
  if (!p.cursor) {
    const sumExpr = p.sort === "total" ? SORT_COLS.total() : `amount_${p.year}`;
    const summarySql = `
      SELECT COUNT(*) AS n, COALESCE(SUM(${sumExpr}), 0) AS s
      FROM objects WHERE ${where.join(" AND ")}
    `;
    const { results: sumRows } = await env.DB.prepare(summarySql).bind(...binds).all<{ n: number; s: number }>();
    if (sumRows && sumRows[0]) {
      summary = { count: Number(sumRows[0].n), sum: Number(sumRows[0].s) };
    }
  }

  return Response.json(
    {
      metadata: {
        department_id: deptId,
        year: p.year,
        sort: p.sort,
        dir: p.dir.toLowerCase(),
        limit: p.limit,
      },
      data,
      next_cursor: nextCursor,
      summary,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=3600",
      },
    },
  );
}

/**
 * CSV export of the objects table for the active filter combo, with parent
 * tables JOINed in so the file is fully denormalised — same column shape as
 * the legacy client-side `objectsToCsv()` so existing pipelines don't break.
 *
 * Streams the body via TransformStream + cursor pagination so we can dump
 * DepEd's million rows without OOMing workerd. The amount columns are
 * multiplied ×1000 here so the CSV matches what the on-screen view shows
 * (the DB stores thousands; the client rescales to pesos).
 */
const CSV_PAGE_SIZE = 2000;
const SCALE = 1000;

const CSV_HEADERS = [
  "department_id",
  "department",
  "agency_id",
  "agency",
  "fpap_id",
  "fpap_code",
  "fpap (program)",
  "operating_unit_id",
  "operating_unit",
  "fund_id",
  "fund",
  "expense_id",
  "ec_code",
  "ec",
  "expense_class",
  "object_id",
  "uacs",
  "object",
];
// Append amt_YYYY, cnt_YYYY pairs + 7-year totals below at runtime.

const EXPENSE_CLASS_LABELS: Record<string, string> = {
  "1": "PS",
  "2": "MOOE",
  "3": "FE",
  "4": "CO",
  "5": "CO",
};

function escapeCsv(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "number") return Number.isFinite(val) ? String(val) : "";
  const s = String(val);
  if (/["\n,]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

interface JoinedRow {
  // Object row + JOINed parent descriptions (prefixed below to avoid clashes
  // with object columns). All fields nullable since LEFT JOINs may not hit.
  id: string;
  object_code: string | null;
  description: string | null;
  department_id: string;
  agency_id: string | null;
  fpap_id: string | null;
  operating_unit_id: string | null;
  fund_id: string | null;
  expense_id: string | null;
  amount_2020: number | null; count_2020: number | null;
  amount_2021: number | null; count_2021: number | null;
  amount_2022: number | null; count_2022: number | null;
  amount_2023: number | null; count_2023: number | null;
  amount_2024: number | null; count_2024: number | null;
  amount_2025: number | null; count_2025: number | null;
  amount_2026: number | null; count_2026: number | null;
  // Parent JOIN aliases (NULL if missing).
  d_description: string | null;
  a_description: string | null;
  f_description: string | null; f_code: string | null;
  ou_description: string | null;
  fn_description: string | null;
  e_description: string | null;
}

async function handleObjectsCsv(env: Env, deptId: string, url: URL): Promise<Response> {
  const p = parsePageQuery(url);
  if (p.error) return badRequest(p.error);

  // Same filter clauses as handleObjectsPage, but every column lives on the
  // objects table (`o.…`) since we're JOINing parents in here too.
  const where: string[] = [
    "o.department_id = ?",
    "o.description IS NOT NULL",
    "o.description != 'nan'",
  ];
  const binds: unknown[] = [deptId];
  if (!p.includeZero) {
    where.push(`o.amount_${p.year} > 0`);
  }
  if (p.bureau) {
    where.push("o.agency_id = ?");
    binds.push(p.bureau);
  }
  if (p.expense) {
    where.push("o.expense_id LIKE ?");
    binds.push(`%-${p.expense}`);
  }
  if (p.q) {
    const like = `%${p.q.toLowerCase()}%`;
    where.push("(LOWER(o.description) LIKE ? OR LOWER(o.object_code) LIKE ? OR LOWER(IFNULL(o.slug, '')) LIKE ?)");
    binds.push(like, like, like);
  }

  // CSV ignores the user's chosen sort — exports always come back ordered by
  // primary key, which keeps keyset pagination cheap (id is the PK).
  const baseSql = `
    SELECT
      o.id, o.object_code, o.description,
      o.department_id, o.agency_id, o.fpap_id, o.operating_unit_id, o.fund_id, o.expense_id,
      o.amount_2020, o.count_2020, o.amount_2021, o.count_2021,
      o.amount_2022, o.count_2022, o.amount_2023, o.count_2023,
      o.amount_2024, o.count_2024, o.amount_2025, o.count_2025,
      o.amount_2026, o.count_2026,
      d.description AS d_description,
      a.description AS a_description,
      f.description AS f_description, f.fpap_code AS f_code,
      ou.description AS ou_description,
      fn.description AS fn_description,
      e.description AS e_description
    FROM objects o
    LEFT JOIN departments d ON o.department_id = d.id
    LEFT JOIN agencies a ON o.agency_id = a.id
    LEFT JOIN fpaps f ON o.fpap_id = f.id
    LEFT JOIN operating_units ou ON o.operating_unit_id = ou.id
    LEFT JOIN fund_subcategories fn ON o.fund_id = fn.id
    LEFT JOIN expenses e ON o.expense_id = e.id
    WHERE ${where.join(" AND ")}
  `;

  // Full header row: static breadcrumb columns + amount_YYYY/count_YYYY
  // pairs + 7-year totals. Matches the existing buildColumns()/objectsToCsv()
  // output so consumers' pipelines don't break.
  const headerRow = [
    ...CSV_HEADERS,
    ...YEARS.flatMap((y) => [`amt_${y}`, `cnt_${y}`]),
    "7y_total_php",
    "7y_total_count",
  ].join(",");

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  (async () => {
    try {
      await writer.write(enc.encode(headerRow + "\n"));

      let cursor = "";
      while (true) {
        const sql = `${baseSql} AND o.id > ? ORDER BY o.id LIMIT ?`;
        const { results } = await env.DB.prepare(sql)
          .bind(...binds, cursor, CSV_PAGE_SIZE)
          .all<JoinedRow>();
        if (!results || results.length === 0) break;

        const lines: string[] = [];
        for (const r of results) {
          const expCode = (r.expense_id ?? "").split("-").pop() ?? "";
          const expClass = EXPENSE_CLASS_LABELS[expCode] ?? "";
          let totalAmt = 0;
          let totalCnt = 0;
          const yearCells: (string | number)[] = [];
          for (const y of YEARS) {
            const a = (r[`amount_${y}` as keyof JoinedRow] as number | null) ?? 0;
            const c = (r[`count_${y}` as keyof JoinedRow] as number | null) ?? 0;
            const aScaled = a * SCALE;
            yearCells.push(aScaled, c);
            totalAmt += aScaled;
            totalCnt += c;
          }
          const cells: (string | number)[] = [
            r.department_id,
            r.d_description ?? "",
            r.agency_id ?? "",
            r.a_description ?? "",
            r.fpap_id ?? "",
            r.f_code ?? "",
            r.f_description ?? "",
            r.operating_unit_id ?? "",
            r.ou_description ?? "",
            r.fund_id ?? "",
            r.fn_description ?? "",
            r.expense_id ?? "",
            expCode,
            expClass,
            r.e_description ?? "",
            r.id,
            r.object_code ?? "",
            r.description ?? "",
            ...yearCells,
            totalAmt,
            totalCnt,
          ];
          lines.push(cells.map(escapeCsv).join(","));
        }
        await writer.write(enc.encode(lines.join("\n") + "\n"));

        cursor = String(results[results.length - 1].id);
        if (results.length < CSV_PAGE_SIZE) break;
      }
      await writer.close();
    } catch (e) {
      console.error("handleObjectsCsv stream failed", e);
      try { await writer.abort(e); } catch { /* ignore */ }
    }
  })();

  const suffix = [
    p.bureau ? `-${p.bureau}` : "",
    p.expense ? `-class${p.expense}` : "",
    p.q ? "-q" : "",
    `-fy${p.year}`,
  ].join("");
  const filename = `gaa-${deptId}-objects${suffix}.csv`;

  return new Response(readable, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * The objects table can have up to ~1M rows for DepEd (07) and ~350K for
 * DPWH (18). A single `SELECT *` would materialise every row in workerd's
 * heap before we even start serialising — easily 500 MB of JS objects,
 * which OOM-kills the dev workerd and isn't friendly in production either.
 *
 * Instead we stream the response: cursor-paginate D1 by primary key
 * (`WHERE id > ? ORDER BY id LIMIT N`, which uses the PK index), serialise
 * each batch to JSON, and write it to the response body as it comes off
 * the database. Memory stays bounded to ~one batch at a time.
 *
 * This legacy full-dump path is still used by the `/data` (DataBrowserView)
 * tab and the CSV export. The Objects view uses `handleObjectsPage` now.
 */
const OBJECTS_PAGE_SIZE = 5000;

async function handleObjects(env: Env, deptId: string): Promise<Response> {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  // Kick off the streaming producer; we return the readable end immediately
  // so the runtime can flush bytes to the client as they're written.
  (async () => {
    let total = 0;
    try {
      await writer.write(
        enc.encode(
          `{"metadata":{"table":"objects","department_id":${JSON.stringify(deptId)}},"data":[`,
        ),
      );
      let cursor = "";
      let first = true;
      while (true) {
        const { results } = await env.DB.prepare(
          `SELECT * FROM objects
             WHERE department_id = ? AND id > ?
             ORDER BY id
             LIMIT ?`,
        )
          .bind(deptId, cursor, OBJECTS_PAGE_SIZE)
          .all<WideRow>();
        if (!results || results.length === 0) break;
        // Build the batch's JSON once, write once — much cheaper than
        // per-row writes into the stream.
        const pieces: string[] = [];
        for (const row of results) {
          pieces.push(JSON.stringify(widenToNested(row)));
        }
        await writer.write(enc.encode((first ? "" : ",") + pieces.join(",")));
        first = false;
        total += results.length;
        cursor = String(results[results.length - 1].id ?? "");
        if (results.length < OBJECTS_PAGE_SIZE) break;
      }
      await writer.write(enc.encode(`],"total":${total}}`));
      await writer.close();
    } catch (e) {
      // Best-effort: the headers are already flushed by this point, so all
      // we can do is abort the stream and let the client see the JSON
      // truncate. Surface the failure in server logs.
      console.error("handleObjects stream failed", e);
      try { await writer.abort(e); } catch { /* ignore */ }
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=3600",
    },
  });
}

// ---------------------------------------------------------------------------
// FY2027 NEP aggregation layer (`nep_*` tables)
// ---------------------------------------------------------------------------
//
// Additive tables, independent of the FY2020-2026 GAA tables above: publishing
// FY2027 cannot move an already-published GAA figure, and FY2027 keeps its
// corrected SPF/AUTO department split without forcing that migration on the
// legacy tables.
//
// Every dimension in `nep_rollups` is COMPLETE per department (untagged rows
// are bucketed under `__unassigned__`, not dropped), so summing across
// departments yields an exact national total. That is what makes the
// cross-department queries below trustworthy.
//
// Amounts are exact INTEGER pesos.

const NEP_DEPT_ID_RE = /^[A-Z0-9]{1,6}$/;

const NEP_DIMENSIONS = new Set([
  "agency", "program", "expense_class", "fund",
  "region", "object", "operating_unit", "division",
]);

interface NepMetaRow {
  fiscal_year: number;
  baseline_year: number;
  generated_at: string;
  source_file: string;
  line_items: number;
  amount: number;
  base_amount: number;
}

interface NepRollupRow {
  code: string;
  description: string | null;
  extra: string | null;
  count: number;
  amount: number;
  base_amount: number;
}

type WithDelta<T> = T & { delta: number; pct: number | null };

/** Attach the delta/pct the UI would otherwise recompute on every row. */
function withDelta<T extends { amount: number; base_amount: number }>(r: T): WithDelta<T> {
  const delta = r.amount - r.base_amount;
  return {
    ...r,
    delta,
    pct: r.base_amount ? (delta / r.base_amount) * 100 : null,
  };
}

/** Roll a dimension up across every department — the query D1 exists to serve. */
async function nepNationalRollup(env: Env, dimension: string, limit?: number) {
  const rows = await queryBound<NepRollupRow>(
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

async function handleNepNational(env: Env): Promise<Response> {
  const [meta] = await queryBound<NepMetaRow>(env, `SELECT * FROM nep_meta LIMIT 1`);
  if (!meta) {
    return Response.json(
      { error: "not_loaded", message: "nep_meta is empty — load data/2027/d1-import.sql" },
      { status: 503 },
    );
  }

  const departments = (
    await queryBound<Record<string, never>>(env, `SELECT * FROM nep_departments ORDER BY amount DESC`)
  ).map(withDelta as never) as Array<{ id: string; description: string; amount: number; base_amount: number; delta: number; section: string }>;

  const [expense_classes, regions, fund_subcategories, top_programs] = await Promise.all([
    nepNationalRollup(env, "expense_class"),
    nepNationalRollup(env, "region"),
    nepNationalRollup(env, "fund", 25),
    queryBound<NepRollupRow & { department_id: string }>(
      env,
      `SELECT department_id, code, description, extra, count, amount, base_amount
         FROM nep_rollups WHERE dimension = 'program'
        ORDER BY amount DESC LIMIT 40`,
    ).then((rs) => rs.map(withDelta)),
  ]);

  // `sections` is derived from the department rows rather than stored twice.
  const sectionMap = new Map<string, { code: string; description: string; count: number; amount: number; base_amount: number }>();
  for (const d of departments) {
    const code = d.section ?? "1";
    const e = sectionMap.get(code) ?? {
      code,
      description: code === "2" ? "Special purpose and automatic appropriations" : "Agency budgets",
      count: 0,
      amount: 0,
      base_amount: 0,
    };
    e.count += 1;
    e.amount += d.amount;
    e.base_amount += d.base_amount;
    sectionMap.set(code, e);
  }

  const byDelta = [...departments].sort((a, b) => b.delta - a.delta);

  return Response.json({
    generated_at: meta.generated_at,
    fiscal_year: meta.fiscal_year,
    baseline_year: meta.baseline_year,
    scale: "pesos",
    source: "d1",
    source_file: meta.source_file,
    national: {
      line_items: meta.line_items,
      amount: meta.amount,
      base_amount: meta.base_amount,
    },
    departments,
    expense_classes,
    fund_subcategories,
    regions,
    sections: [...sectionMap.values()].map(withDelta),
    top_programs,
    top_movers_up: byDelta.slice(0, 10),
    top_movers_down: byDelta.slice(-10).reverse(),
  });
}

async function handleNepDept(env: Env, deptId: string): Promise<Response> {
  const [department] = await queryBound<Record<string, never>>(
    env, `SELECT * FROM nep_departments WHERE id = ?`, deptId,
  );
  if (!department) {
    return Response.json({ error: "not_found", message: `No FY2027 data for ${deptId}` }, { status: 404 });
  }

  const rows = await queryBound<NepRollupRow & { dimension: string }>(
    env,
    `SELECT dimension, code, description, extra, count, amount, base_amount
       FROM nep_rollups WHERE department_id = ? ORDER BY dimension, amount DESC`,
    deptId,
  );

  const byDim = new Map<string, Array<WithDelta<NepRollupRow>>>();
  for (const r of rows) {
    const { dimension, ...rest } = r;
    if (!byDim.has(dimension)) byDim.set(dimension, []);
    byDim.get(dimension)!.push(withDelta(rest));
  }
  const dim = (k: string) => byDim.get(k) ?? [];

  /**
   * Long-tail dimensions are capped for payload size — DepEd alone has ~13k
   * operating units, which serializes to 2 MB. The remainder is folded into a
   * single explicit row rather than dropped, so the list still sums to the
   * department total and the UI can never quietly understate it. Use
   * /api/nep2027/rollup/:dimension for the untruncated set.
   */
  const CAP = 50;
  const capped = (k: string) => {
    const all = dim(k);
    if (all.length <= CAP + 1) return all;
    const head = all.slice(0, CAP);
    const tail = all.slice(CAP);
    const amount = tail.reduce((a, r) => a + r.amount, 0);
    const base_amount = tail.reduce((a, r) => a + r.base_amount, 0);
    const delta = amount - base_amount;
    head.push({
      code: "__other__",
      description: `Other (${tail.length.toLocaleString()} more)`,
      extra: null,
      count: tail.reduce((a, r) => a + r.count, 0),
      amount,
      base_amount,
      delta,
      pct: base_amount ? (delta / base_amount) * 100 : null,
    });
    return head;
  };

  const programs = dim("program");
  const movers = [...programs].sort((a, b) => b.delta - a.delta);

  const dept = withDelta(department as unknown as { amount: number; base_amount: number });

  return Response.json({
    generated_at: null,
    fiscal_year: 2027,
    baseline_year: 2026,
    scale: "pesos",
    source: "d1",
    department: dept,
    counts: {
      agencies: (department as Record<string, number>).agencies,
      programs: (department as Record<string, number>).programs,
      activities: (department as Record<string, number>).activities,
      operating_units: (department as Record<string, number>).operating_units,
      objects: (department as Record<string, number>).objects,
      regions: (department as Record<string, number>).regions,
    },
    agencies: dim("agency"),
    expense_classes: dim("expense_class"),
    fund_subcategories: dim("fund"),
    regions: dim("region"),
    programs,
    top_objects: capped("object"),
    top_operating_units: capped("operating_unit"),
    top_divisions: capped("division"),
    top_movers_up: movers.slice(0, 10),
    top_movers_down: movers.slice(-10).reverse(),
  });
}

/** Cross-department slice of one dimension — not possible from per-dept parquet. */
async function handleNepRollup(env: Env, dimension: string, url: URL): Promise<Response> {
  if (!NEP_DIMENSIONS.has(dimension)) {
    return badRequest(`dimension must be one of: ${[...NEP_DIMENSIONS].join(", ")}`);
  }
  const limitRaw = Number(url.searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 2000) : 200;
  const byDept = url.searchParams.get("by") === "department";

  if (byDept) {
    const code = url.searchParams.get("code");
    if (!code) return badRequest("by=department requires a code parameter");
    const rows = await queryBound<NepRollupRow & { department_id: string }>(
      env,
      `SELECT r.department_id, d.description AS department, r.code, r.description,
              r.count, r.amount, r.base_amount
         FROM nep_rollups r JOIN nep_departments d ON d.id = r.department_id
        WHERE r.dimension = ? AND r.code = ?
        ORDER BY r.amount DESC LIMIT ?`,
      dimension, code, limit,
    );
    return Response.json({ dimension, code, scale: "pesos", data: rows.map(withDelta) });
  }

  return Response.json({
    dimension,
    scale: "pesos",
    data: await nepNationalRollup(env, dimension, limit),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ---- FY2027 NEP aggregation layer ----
    if (url.pathname === "/api/nep2027/national" || url.pathname === "/api/nep2027/national/") {
      try {
        return await handleNepNational(env);
      } catch (e) {
        return Response.json({ error: "query_failed", message: (e as Error).message }, { status: 500 });
      }
    }

    const nepDeptMatch = /^\/api\/nep2027\/dept\/([^/]+)\/?$/.exec(url.pathname);
    if (nepDeptMatch) {
      const [, deptId] = nepDeptMatch;
      if (!NEP_DEPT_ID_RE.test(deptId)) return badRequest("invalid department id");
      try {
        return await handleNepDept(env, deptId);
      } catch (e) {
        return Response.json({ error: "query_failed", message: (e as Error).message }, { status: 500 });
      }
    }

    const nepRollupMatch = /^\/api\/nep2027\/rollup\/([a-z_]+)\/?$/.exec(url.pathname);
    if (nepRollupMatch) {
      try {
        return await handleNepRollup(env, nepRollupMatch[1], url);
      } catch (e) {
        return Response.json({ error: "query_failed", message: (e as Error).message }, { status: 500 });
      }
    }


    // /api/dept/:id/objects/page — server-paginated Objects view
    const pageMatch = /^\/api\/dept\/([^/]+)\/objects\/page\/?$/.exec(url.pathname);
    if (pageMatch) {
      const [, deptId] = pageMatch;
      if (!DEPT_ID_RE.test(deptId)) return badRequest("deptId must be two digits");
      try {
        return await handleObjectsPage(env, deptId, url);
      } catch (e) {
        return Response.json(
          { error: "query_failed", message: (e as Error).message },
          { status: 500 },
        );
      }
    }

    // /api/dept/:id/objects/csv — streamed CSV export for the active filter
    const csvMatch = /^\/api\/dept\/([^/]+)\/objects\/csv\/?$/.exec(url.pathname);
    if (csvMatch) {
      const [, deptId] = csvMatch;
      if (!DEPT_ID_RE.test(deptId)) return badRequest("deptId must be two digits");
      try {
        return await handleObjectsCsv(env, deptId, url);
      } catch (e) {
        return Response.json(
          { error: "query_failed", message: (e as Error).message },
          { status: 500 },
        );
      }
    }

    // /api/dept/:id/:stage — Stage A/B/C envelopes (objects = full dump)
    const m = /^\/api\/dept\/([^/]+)\/(core|mid|objects)\/?$/.exec(url.pathname);
    if (m) {
      const [, deptId, stage] = m;
      if (!DEPT_ID_RE.test(deptId)) return badRequest("deptId must be two digits");
      try {
        if (stage === "core") return await handleCore(env, deptId);
        if (stage === "mid") return await handleMid(env, deptId);
        if (stage === "objects") return await handleObjects(env, deptId);
      } catch (e) {
        return Response.json(
          { error: "query_failed", message: (e as Error).message },
          { status: 500 },
        );
      }
    }

    // Everything else — SPA assets, the data/*.json / *.parquet tree, etc.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
