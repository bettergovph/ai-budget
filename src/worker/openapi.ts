/**
 * OpenAPI 3.1 description of the public /api/v1 surface, served at
 * /api/v1/openapi.json (the `servers` entry is filled in per-request with the
 * caller's origin). Kept as a plain object so it ships inside the Worker
 * bundle with zero build steps.
 */

const yearsMap = {
  type: "object",
  description:
    "Per-fiscal-year figures keyed by year (2020–2026). Amounts are exact pesos; count is the number of underlying line items.",
  additionalProperties: {
    type: "object",
    properties: {
      count: { type: "integer" },
      amount: { type: "integer", description: "Philippine pesos" },
    },
  },
} as const;

const errorResponse = {
  description: "Error",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" },
    },
  },
} as const;

const deptIdParam = (desc: string) => ({
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: desc,
});

const GAA_DEPT_ID = "Two-digit GAA department id, e.g. `07` (DepEd) or `18` (DPWH). List them via /api/v1/gaa/departments.";
const NEP_DEPT_ID = "NEP department id: two digits (e.g. `07`), or the synthetic `SPF` (special purpose funds) / `AUTO` (automatic appropriations).";

const yearQuery = {
  name: "year",
  in: "query",
  schema: { type: "integer", enum: [2020, 2021, 2022, 2023, 2024, 2025, 2026], default: 2026 },
  description: "Fiscal year used for ranking/filtering amounts.",
} as const;

const cursorQuery = {
  name: "cursor",
  in: "query",
  schema: { type: "string" },
  description: "Opaque pagination cursor from a previous response's `next_cursor`. Pass back verbatim.",
} as const;

const limitQuery = (def: number, max: number) => ({
  name: "limit",
  in: "query",
  schema: { type: "integer", minimum: 1, maximum: max, default: def },
  description: "Page size.",
});

const jsonList = (itemRef: string, extra: Record<string, unknown> = {}) => ({
  description: "OK",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          meta: { $ref: "#/components/schemas/Meta" },
          data: { type: "array", items: { $ref: itemRef } },
          ...extra,
        },
      },
    },
  },
});

const paginated = (itemRef: string) =>
  jsonList(itemRef, {
    next_cursor: {
      type: ["string", "null"],
      description: "Cursor for the next page, or null when the list is exhausted.",
    },
  });

export const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "Philippine Budget Data API",
    version: "1.0.0",
    summary: "Public read-only API over Philippine national budget data",
    description:
      "Covers three datasets: the enacted **General Appropriations Act (GAA) FY2020–2026** " +
      "(38 departments, down to UACS object-level line items), the **FY2027 National Expenditure " +
      "Program (NEP)** — the Executive's ₱7.20T proposal, every figure paired with its FY2026 GAA " +
      "baseline — and **budget-cycle** data tracing NEP → GAA → execution stages for selected " +
      "departments.\n\n" +
      "**Units.** Every amount is an exact Philippine peso figure (`currency: PHP`, `scale: pesos` " +
      "in each response's `meta`). NEP responses carry `amount` (FY2027 proposal), `base_amount` " +
      "(FY2026 GAA), `delta`, and `pct`.\n\n" +
      "**Department ids.** GAA ids are two digits (`07` = DepEd). NEP FY2027 adds two synthetic " +
      "departments: `SPF` (special purpose funds) and `AUTO` (automatic appropriations); `AUTO` is " +
      "not department `04`.\n\n" +
      "**Pagination.** List endpoints use opaque keyset cursors: pass `next_cursor` back as " +
      "`cursor`. Cursors are tied to the query's filters — changing filters invalidates them.\n\n" +
      "**Access.** No authentication; CORS is open (`Access-Control-Allow-Origin: *`); fair-use " +
      "rate limits may apply. An MCP server exposing the same data as tools lives at `/mcp`.\n\n" +
      "Source data: https://huggingface.co/datasets/bettergovph/gaa",
    contact: { name: "BetterGov.PH" },
    license: {
      name: "CC BY 4.0",
      identifier: "CC-BY-4.0",
    },
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "meta", description: "API discovery" },
    { name: "gaa", description: "General Appropriations Act, FY2020–2026 (enacted)" },
    { name: "nep-2027", description: "FY2027 National Expenditure Program (proposed) vs FY2026 GAA baseline" },
    { name: "budget-cycle", description: "NEP → GAA → execution stages for covered departments" },
  ],
  paths: {
    "/api/v1": {
      get: {
        tags: ["meta"],
        operationId: "getApiIndex",
        summary: "API index",
        description: "Names every endpoint and links to the documentation, OpenAPI spec, and MCP server.",
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/v1/gaa": {
      get: {
        tags: ["gaa"],
        operationId: "getGaaNational",
        summary: "National totals per fiscal year",
        description: "Total enacted appropriations (pesos) and line-item counts for each year 2020–2026, summed across all departments.",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    meta: { $ref: "#/components/schemas/Meta" },
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          year: { type: "integer" },
                          line_items: { type: "integer" },
                          amount: { type: "integer", description: "Pesos" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "500": errorResponse,
        },
      },
    },
    "/api/v1/gaa/departments": {
      get: {
        tags: ["gaa"],
        operationId: "listGaaDepartments",
        summary: "List departments",
        description: "All 38 departments with per-year appropriations and line-item counts, largest FY2026 budget first.",
        responses: { "200": jsonList("#/components/schemas/GaaEntity"), "500": errorResponse },
      },
    },
    "/api/v1/gaa/departments/{id}": {
      get: {
        tags: ["gaa"],
        operationId: "getGaaDepartment",
        summary: "Department detail",
        description: "One department's yearly totals, agencies/bureaus, and expense-class breakdown (PS / MOOE / FinEx / CO).",
        parameters: [deptIdParam(GAA_DEPT_ID)],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    meta: { $ref: "#/components/schemas/Meta" },
                    data: {
                      type: "object",
                      properties: {
                        department: { $ref: "#/components/schemas/GaaEntity" },
                        yearly_totals: { type: "array", items: { type: "object" } },
                        agencies: { type: "array", items: { $ref: "#/components/schemas/GaaEntity" } },
                        expense_classes: { type: "array", items: { $ref: "#/components/schemas/GaaExpenseClass" } },
                      },
                    },
                  },
                },
              },
            },
          },
          "404": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/v1/gaa/departments/{id}/expense-classes": {
      get: {
        tags: ["gaa"],
        operationId: "getGaaDepartmentExpenseClasses",
        summary: "Department expense classes",
        description: "PS / MOOE / FinEx / CO totals per year for one department.",
        parameters: [deptIdParam(GAA_DEPT_ID)],
        responses: { "200": jsonList("#/components/schemas/GaaExpenseClass"), "404": errorResponse, "500": errorResponse },
      },
    },
    "/api/v1/gaa/departments/{id}/programs": {
      get: {
        tags: ["gaa"],
        operationId: "listGaaDepartmentPrograms",
        summary: "Department programs (paginated)",
        description:
          "Program/activity/project (P/A/P) families for one department, ranked by appropriation in the chosen year. " +
          "`meta.matched` / `meta.matched_amount` cover the whole filtered set, not just the page.",
        parameters: [
          deptIdParam(GAA_DEPT_ID),
          yearQuery,
          { name: "q", in: "query", schema: { type: "string" }, description: "Text filter on program name." },
          { name: "agency_id", in: "query", schema: { type: "string" }, description: "Scope to one agency/bureau (ids from the department detail)." },
          limitQuery(100, 500),
          cursorQuery,
        ],
        responses: { "200": paginated("#/components/schemas/GaaProgram"), "400": errorResponse, "500": errorResponse },
      },
    },
    "/api/v1/gaa/departments/{id}/objects": {
      get: {
        tags: ["gaa"],
        operationId: "listGaaDepartmentObjects",
        summary: "Department line items (paginated)",
        description:
          "UACS object-level line items — the finest GAA granularity (DepEd alone has ~1M rows). " +
          "Filter and paginate; `meta.matched` / `meta.matched_amount` describe the whole filtered set. " +
          "By default rows with a zero amount in the chosen year are hidden; pass `include_zero=1` to keep them.",
        parameters: [
          deptIdParam(GAA_DEPT_ID),
          yearQuery,
          { name: "q", in: "query", schema: { type: "string" }, description: "Text filter on description / UACS object code." },
          { name: "agency_id", in: "query", schema: { type: "string" }, description: "Scope to one agency/bureau." },
          { name: "expense_class", in: "query", schema: { type: "string", enum: ["1", "2", "3", "6"] }, description: "1=PS, 2=MOOE, 3=FinEx, 6=CO." },
          { name: "sort", in: "query", schema: { type: "string", enum: ["amount", "description", "code", "total"], default: "amount" }, description: "`total` sorts by the 7-year sum (and implies include_zero)." },
          { name: "dir", in: "query", schema: { type: "string", enum: ["asc", "desc"] }, description: "Defaults: desc for amount/total, asc otherwise." },
          { name: "include_zero", in: "query", schema: { type: "string", enum: ["1", "true"] } },
          limitQuery(100, 500),
          cursorQuery,
        ],
        responses: { "200": paginated("#/components/schemas/GaaObject"), "400": errorResponse, "500": errorResponse },
      },
    },
    "/api/v1/gaa/search": {
      get: {
        tags: ["gaa"],
        operationId: "searchGaaPrograms",
        summary: "Search programs across departments",
        description: "Full-text-ish (substring) search over P/A/P family names across all 38 departments, ranked by amount in the chosen year.",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string", minLength: 2 }, description: "Search text (min 2 characters)." },
          { name: "department_id", in: "query", schema: { type: "string" }, description: "Optional two-digit department scope." },
          yearQuery,
          limitQuery(25, 100),
        ],
        responses: { "200": jsonList("#/components/schemas/GaaProgram"), "400": errorResponse, "500": errorResponse },
      },
    },
    "/api/v1/nep/2027": {
      get: {
        tags: ["nep-2027"],
        operationId: "getNep2027Overview",
        summary: "National overview",
        description:
          "The FY2027 proposal at national level: all departments (with deltas vs FY2026), sections, expense classes, " +
          "regions, top funds and programs, and the biggest movers.",
        responses: { "200": { description: "OK" }, "500": errorResponse, "503": errorResponse },
      },
    },
    "/api/v1/nep/2027/departments": {
      get: {
        tags: ["nep-2027"],
        operationId: "listNep2027Departments",
        summary: "List departments",
        description: "All 39 NEP departments (including synthetic `SPF` and `AUTO`) with FY2027 amount, FY2026 baseline, delta/pct, and per-dimension counts.",
        responses: { "200": jsonList("#/components/schemas/NepRow"), "500": errorResponse },
      },
    },
    "/api/v1/nep/2027/departments/{id}": {
      get: {
        tags: ["nep-2027"],
        operationId: "getNep2027Department",
        summary: "Department detail",
        description:
          "Full department view: agencies, programs, expense classes, funds, regions, plus top-50 objects / operating " +
          "units / divisions with an explicit `__other__` remainder so every list still sums to the department total. " +
          "Use the rollups endpoint for the untruncated long tails.",
        parameters: [deptIdParam(NEP_DEPT_ID)],
        responses: { "200": { description: "OK" }, "404": errorResponse, "500": errorResponse },
      },
    },
    "/api/v1/nep/2027/departments/{id}/rollups/{dimension}": {
      get: {
        tags: ["nep-2027"],
        operationId: "getNep2027DepartmentRollup",
        summary: "Department rollup by dimension (untruncated, paginated)",
        description: "Complete rows for one dimension within one department. Untagged source rows appear under code `__unassigned__` rather than being dropped.",
        parameters: [
          deptIdParam(NEP_DEPT_ID),
          { $ref: "#/components/parameters/NepDimension" },
          limitQuery(200, 2000),
          cursorQuery,
        ],
        responses: { "200": paginated("#/components/schemas/NepRow"), "400": errorResponse, "404": errorResponse, "500": errorResponse },
      },
    },
    "/api/v1/nep/2027/rollups/{dimension}": {
      get: {
        tags: ["nep-2027"],
        operationId: "getNep2027Rollup",
        summary: "National rollup by dimension",
        description:
          "Without `code`: national totals per code in the dimension, summed across all departments (exact — every " +
          "dimension is complete). With `code` and `by=department`: that code broken down by department.",
        parameters: [
          { $ref: "#/components/parameters/NepDimension" },
          { name: "code", in: "query", schema: { type: "string" }, description: "A code within the dimension (with `by=department`)." },
          { name: "by", in: "query", schema: { type: "string", enum: ["department"] } },
          limitQuery(200, 2000),
        ],
        responses: { "200": jsonList("#/components/schemas/NepRow"), "400": errorResponse, "500": errorResponse },
      },
    },
    "/api/v1/budget-cycle": {
      get: {
        tags: ["budget-cycle"],
        operationId: "getBudgetCycleOverview",
        summary: "Coverage and manifest",
        description:
          "Which departments the budget-cycle workbook covers, the fiscal years (2018–2026), stages, and expense " +
          "classes available. Scope is Current New Appropriations only — narrower than the main GAA series.",
        responses: { "200": { description: "OK" }, "503": errorResponse },
      },
    },
    "/api/v1/budget-cycle/departments/{id}": {
      get: {
        tags: ["budget-cycle"],
        operationId: "getBudgetCycleDepartment",
        summary: "Department budget-cycle facts",
        description:
          "Programs (with source→portal crosswalk and match confidence) and facts: one row per program × fiscal year × " +
          "stage × expense class, amounts in pesos.",
        parameters: [deptIdParam("Two-digit department id from the coverage list.")],
        responses: { "200": { description: "OK" }, "404": errorResponse, "500": errorResponse },
      },
    },
  },
  components: {
    parameters: {
      NepDimension: {
        name: "dimension",
        in: "path",
        required: true,
        schema: {
          type: "string",
          enum: ["agency", "program", "expense_class", "fund", "region", "object", "operating_unit", "division"],
        },
        description: "Rollup dimension.",
      },
    },
    schemas: {
      Meta: {
        type: "object",
        description: "Response metadata. Always states the dataset, currency (PHP), and scale (pesos); list endpoints add filters, limits, and whole-set totals.",
        properties: {
          dataset: { type: "string", enum: ["gaa", "nep", "budget-cycle"] },
          currency: { type: "string", const: "PHP" },
          scale: { type: "string", const: "pesos" },
        },
        additionalProperties: true,
      },
      Error: {
        type: "object",
        properties: {
          error: {
            type: "string",
            description: "Machine-readable slug: bad_request, bad_cursor, not_found, method_not_allowed, not_loaded, query_failed.",
          },
          message: { type: "string" },
        },
        required: ["error", "message"],
      },
      GaaEntity: {
        type: "object",
        description: "A GAA hierarchy node (department or agency) with per-year figures.",
        properties: {
          id: { type: "string" },
          slug: { type: "string" },
          description: { type: "string", description: "Display name." },
          years: yearsMap,
        },
        additionalProperties: true,
      },
      GaaExpenseClass: {
        type: "object",
        properties: {
          expense_code: { type: "string", description: "1=PS, 2=MOOE, 3=FinEx, 6=CO." },
          label: { type: ["string", "null"] },
          years: yearsMap,
        },
      },
      GaaProgram: {
        type: "object",
        description: "A program/activity/project family (P/A/P rows deduplicated by normalized name within an agency).",
        properties: {
          department_id: { type: "string" },
          agency_id: { type: "string" },
          fam_key: { type: "string", description: "Stable family key (agency id + normalized name)." },
          name: { type: "string" },
          ids_count: { type: "integer", description: "How many raw P/A/P rows the family folds together." },
          department: { type: "string", description: "Department name (search endpoint only)." },
          years: yearsMap,
        },
        additionalProperties: true,
      },
      GaaObject: {
        type: "object",
        description: "A UACS object-level line item with its full parent-id breadcrumb.",
        properties: {
          id: { type: "string" },
          object_code: { type: "string", description: "UACS sub-object code." },
          description: { type: "string" },
          department_id: { type: "string" },
          agency_id: { type: ["string", "null"] },
          fpap_id: { type: ["string", "null"] },
          operating_unit_id: { type: ["string", "null"] },
          fund_id: { type: ["string", "null"] },
          expense_id: { type: ["string", "null"], description: "Trailing digit is the expense class." },
          years: yearsMap,
        },
        additionalProperties: true,
      },
      NepRow: {
        type: "object",
        description: "An FY2027 NEP figure paired with its FY2026 GAA baseline.",
        properties: {
          code: { type: "string", description: "Code within the dimension; `__unassigned__` buckets untagged rows, `__other__` is a capped-list remainder." },
          description: { type: ["string", "null"] },
          count: { type: "integer", description: "Underlying line items." },
          amount: { type: "integer", description: "FY2027 proposed, pesos." },
          base_amount: { type: "integer", description: "FY2026 GAA baseline, pesos." },
          delta: { type: "integer", description: "amount − base_amount." },
          pct: { type: ["number", "null"], description: "delta / base_amount × 100; null when the baseline is zero." },
        },
        additionalProperties: true,
      },
    },
  },
} as const;
