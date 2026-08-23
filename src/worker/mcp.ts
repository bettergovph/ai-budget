/**
 * MCP (Model Context Protocol) server at /mcp.
 *
 * Stateless Streamable HTTP transport: every JSON-RPC message arrives as a
 * POST and gets a plain application/json reply — no sessions, no SSE stream,
 * no server-initiated messages. That is all a read-only data server needs,
 * and it keeps the Worker free of Durable Objects. GET/DELETE return 405 as
 * the spec allows for servers that never open a stream.
 *
 * Every tool delegates to the same data functions the public REST API uses
 * (src/worker/public-api.ts), so tool results and REST responses can never
 * disagree. All amounts are exact Philippine pesos.
 *
 * Connect with any MCP client, e.g.:
 *   claude mcp add --transport http ph-budget https://<host>/mcp
 */

import {
  ApiError,
  CORS_HEADERS,
  NEP_DIMENSIONS,
  YEARS,
  preflight,
  budgetCycleDepartment,
  budgetCycleOverview,
  gaaDepartment,
  gaaDepartments,
  gaaDeptObjects,
  gaaDeptPrograms,
  gaaNational,
  gaaSearchPrograms,
  gaaYearChildren,
  gaaYearSnapshot,
  GAA_HIERARCHY_LEVELS,
  nepDepartment,
  nepDepartments,
  nepDeptRollup,
  nepOverview,
  nepRollup,
} from "./public-api";

const SERVER_INFO = {
  name: "ph-budget-data",
  title: "Philippine Budget Data",
  version: "1.0.0",
};

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL = PROTOCOL_VERSIONS[0];

const INSTRUCTIONS = `Read-only Philippine national budget data.

Datasets: (1) GAA — enacted General Appropriations Act, FY2020–2026, 38 departments,
down to UACS object-level line items; (2) NEP FY2027 — the Executive's ₱7.20T proposal,
every figure paired with its FY2026 GAA baseline (amount vs base_amount, plus delta/pct);
(3) budget-cycle — NEP→GAA→execution stages (appropriations, allotments, obligations,
disbursements) for a small set of covered departments, Current New Appropriations scope only.

All amounts are exact Philippine pesos (PHP). GAA and NEP department ids differ:
GAA uses two digits ("07" = DepEd); NEP adds synthetic "SPF" (special purpose funds)
and "AUTO" (automatic appropriations) — do not confuse "AUTO" with department "04".
Start with list_gaa_departments or get_nep_2027_overview to discover valid ids.`;

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (env: Env, args: Record<string, unknown>) => Promise<unknown>;
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v !== "" ? v : undefined;
}

function num(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function requireStr(args: Record<string, unknown>, key: string): string {
  const v = str(args, key);
  if (v == null) throw new ApiError(400, "bad_request", `${key} is required`);
  return v;
}

const YEAR_SCHEMA = {
  type: "number",
  description: `Fiscal year to rank/filter amounts by. One of ${YEARS.join(", ")}. Default 2026.`,
  enum: [...YEARS],
};

const TOOLS: Tool[] = [
  {
    name: "list_gaa_departments",
    title: "List GAA departments",
    description:
      "List all 38 departments in the enacted GAA (FY2020–2026) with per-year appropriations in pesos " +
      "and line-item counts. Use this first to discover valid GAA department ids (two digits, e.g. '07').",
    inputSchema: { type: "object", properties: {} },
    handler: (env) => gaaDepartments(env),
  },
  {
    name: "get_gaa_national_trends",
    title: "GAA national totals by year",
    description:
      "National GAA totals (pesos) and line-item counts for each fiscal year 2020–2026.",
    inputSchema: { type: "object", properties: {} },
    handler: (env) => gaaNational(env),
  },
  {
    name: "get_gaa_department",
    title: "GAA department detail",
    description:
      "One GAA department: per-year totals, its agencies/bureaus (with ids usable as agency_id filters), " +
      "and expense-class breakdown (PS / MOOE / FinEx / CO) across FY2020–2026. Amounts in pesos.",
    inputSchema: {
      type: "object",
      properties: {
        department_id: { type: "string", description: "Two-digit GAA department id, e.g. '07' for DepEd" },
      },
      required: ["department_id"],
    },
    handler: (env, a) => gaaDepartment(env, requireStr(a, "department_id")),
  },
  {
    name: "search_gaa_programs",
    title: "Search GAA programs",
    description:
      "Search program/activity/project (P/A/P) families by name across all departments, or within one. " +
      "Returns matches ranked by appropriation in the chosen year, with full FY2020–2026 histories. " +
      "Good for questions like 'how much goes to school building programs?'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to match against program names (min 2 chars)" },
        department_id: { type: "string", description: "Optional two-digit department id to scope the search" },
        year: YEAR_SCHEMA,
        limit: { type: "number", description: "Max results, 1–100 (default 25)" },
      },
      required: ["query"],
    },
    handler: (env, a) =>
      gaaSearchPrograms(env, {
        query: requireStr(a, "query"),
        department_id: str(a, "department_id"),
        year: num(a, "year"),
        limit: num(a, "limit"),
      }),
  },
  {
    name: "get_gaa_department_programs",
    title: "GAA department programs (paginated)",
    description:
      "Program families for one department, largest first for the chosen year, with keyset pagination " +
      "(pass next_cursor back as cursor). Also reports the matched total so partial pages still sum correctly.",
    inputSchema: {
      type: "object",
      properties: {
        department_id: { type: "string", description: "Two-digit GAA department id" },
        year: YEAR_SCHEMA,
        query: { type: "string", description: "Optional text filter on program name" },
        agency_id: { type: "string", description: "Optional agency id (from get_gaa_department) to scope to one bureau" },
        limit: { type: "number", description: "Page size, 1–500 (default 100)" },
        cursor: { type: "string", description: "Opaque cursor from a previous call's next_cursor" },
      },
      required: ["department_id"],
    },
    handler: (env, a) =>
      gaaDeptPrograms(env, requireStr(a, "department_id"), {
        year: num(a, "year"),
        query: str(a, "query"),
        agency_id: str(a, "agency_id"),
        limit: num(a, "limit"),
        cursor: str(a, "cursor") ?? null,
      }),
  },
  {
    name: "search_gaa_line_items",
    title: "Search GAA line items",
    description:
      "UACS object-level line items for one department (the finest GAA granularity — up to ~1M rows for DepEd). " +
      "Filter by text, agency, or expense class (1=PS, 2=MOOE, 3=FinEx, 6=CO); ranked by amount in the chosen " +
      "year. Keyset paginated via cursor. Always scope tightly — this queries a 2M-row table.",
    inputSchema: {
      type: "object",
      properties: {
        department_id: { type: "string", description: "Two-digit GAA department id" },
        query: { type: "string", description: "Optional text filter on the line-item description or UACS code" },
        year: YEAR_SCHEMA,
        agency_id: { type: "string", description: "Optional agency id to scope to one bureau" },
        expense_class: { type: "string", description: "Optional expense class digit: 1=PS, 2=MOOE, 3=FinEx, 6=CO", enum: ["1", "2", "3", "6"] },
        limit: { type: "number", description: "Page size, 1–500 (default 100)" },
        cursor: { type: "string", description: "Opaque cursor from a previous call's next_cursor" },
      },
      required: ["department_id"],
    },
    handler: (env, a) =>
      gaaDeptObjects(env, requireStr(a, "department_id"), {
        query: str(a, "query"),
        year: num(a, "year"),
        agency_id: str(a, "agency_id"),
        expense_class: str(a, "expense_class"),
        limit: num(a, "limit"),
        cursor: str(a, "cursor") ?? null,
      }),
  },
  {
    name: "get_gaa_year_snapshot",
    title: "GAA single-year snapshot",
    description:
      "One fiscal year in isolation: the national GAA total plus every department's appropriation, line-item " +
      "count, and share of that year's budget, largest first. Use this when the question is about a specific " +
      "year ('the 2022 budget') rather than trends across years.",
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "number", description: `Fiscal year, one of ${YEARS.join(", ")}`, enum: [...YEARS] },
      },
      required: ["year"],
    },
    handler: (env, a) => {
      const year = num(a, "year");
      if (year == null) throw new ApiError(400, "bad_request", "year is required");
      return gaaYearSnapshot(env, year);
    },
  },
  {
    name: "browse_gaa_hierarchy",
    title: "Browse GAA hierarchy for one year",
    description:
      "Walk one department's GAA hierarchy a level at a time, scoped to a single fiscal year: 'agencies' " +
      "(bureaus — the default, no parent needed), then 'fpaps' of an agency (parent=<agency id>), " +
      "'operating_units' of a program, 'fund_subcategories' of an operating unit, and 'expenses' of a fund " +
      "(the leaf). Rows carry that year's figures only, ranked largest first, with the parent-id columns " +
      "needed to drill deeper; keyset paginated. Zero-amount rows are hidden unless include_zero is true.",
    inputSchema: {
      type: "object",
      properties: {
        department_id: { type: "string", description: "Two-digit GAA department id, e.g. '07' for DepEd" },
        year: { type: "number", description: `Fiscal year, one of ${YEARS.join(", ")}`, enum: [...YEARS] },
        level: {
          type: "string",
          description: "Hierarchy level to list (default 'agencies')",
          enum: [...GAA_HIERARCHY_LEVELS],
        },
        parent: { type: "string", description: "Parent entity id — required for every level below 'agencies'" },
        include_zero: { type: "boolean", description: "Include rows with a zero amount in the chosen year" },
        limit: { type: "number", description: "Page size, 1–500 (default 100)" },
        cursor: { type: "string", description: "Opaque cursor from a previous call's next_cursor" },
      },
      required: ["department_id", "year"],
    },
    handler: (env, a) => {
      const year = num(a, "year");
      if (year == null) throw new ApiError(400, "bad_request", "year is required");
      return gaaYearChildren(env, year, requireStr(a, "department_id"), {
        level: str(a, "level"),
        parent: str(a, "parent"),
        include_zero: a.include_zero === true,
        limit: num(a, "limit"),
        cursor: str(a, "cursor") ?? null,
      });
    },
  },
  {
    name: "get_nep_2027_overview",
    title: "NEP FY2027 national overview",
    description:
      "National view of the FY2027 National Expenditure Program (₱7.20T proposal): every department with its " +
      "FY2027 proposed amount vs FY2026 GAA baseline (delta/pct), expense classes, regions, top funds, " +
      "top programs, and biggest movers. Amounts in pesos.",
    inputSchema: { type: "object", properties: {} },
    handler: (env) => nepOverview(env),
  },
  {
    name: "get_nep_2027_department",
    title: "NEP FY2027 department detail",
    description:
      "One department's FY2027 proposal vs FY2026 baseline: agencies, programs, expense classes, funds, regions, " +
      "top objects/operating units/divisions (long tails capped with an explicit __other__ remainder), and top " +
      "program movers. Ids: two digits, or synthetic 'SPF' / 'AUTO'. Use get_nep_2027_rollup for full long-tail lists.",
    inputSchema: {
      type: "object",
      properties: {
        department_id: { type: "string", description: "NEP department id: two digits (e.g. '07'), 'SPF', or 'AUTO'" },
      },
      required: ["department_id"],
    },
    handler: (env, a) => nepDepartment(env, requireStr(a, "department_id")),
  },
  {
    name: "get_nep_2027_rollup",
    title: "NEP FY2027 rollup by dimension",
    description:
      "Slice the FY2027 NEP by one dimension. Three modes: (1) no department_id/code — national totals per code " +
      "in the dimension; (2) department_id set — the complete, untruncated list for that department (paginated); " +
      "(3) code set with by_department=true — one code broken down across departments. Every dimension is complete " +
      "(untagged rows bucket under '__unassigned__'), so sums reconcile to the ₱7.20T total.",
    inputSchema: {
      type: "object",
      properties: {
        dimension: {
          type: "string",
          description: "Dimension to roll up by",
          enum: [...NEP_DIMENSIONS],
        },
        department_id: { type: "string", description: "Scope to one department (mode 2)" },
        code: { type: "string", description: "With by_department=true, break this code down across departments (mode 3)" },
        by_department: { type: "boolean", description: "Set true with code for a cross-department breakdown" },
        limit: { type: "number", description: "Max rows, 1–2000 (default 200)" },
        cursor: { type: "string", description: "Opaque cursor (mode 2 only) from a previous next_cursor" },
      },
      required: ["dimension"],
    },
    handler: (env, a) => {
      const dimension = requireStr(a, "dimension");
      const deptId = str(a, "department_id");
      if (deptId) {
        return nepDeptRollup(env, deptId, dimension, {
          limit: num(a, "limit"),
          cursor: str(a, "cursor") ?? null,
        });
      }
      return nepRollup(env, dimension, {
        code: str(a, "code"),
        by_department: a.by_department === true,
        limit: num(a, "limit"),
      });
    },
  },
  {
    name: "get_budget_cycle",
    title: "Budget cycle (NEP→GAA→execution)",
    description:
      "How appropriations moved through the budget cycle for one covered department: per program, per fiscal year " +
      "(2018–2026), per stage (nep, gaa, authorized/adjusted appropriation, adjusted allotment, obligations, " +
      "disbursements), per expense class (ps, mooe, finex, co, total). Coverage is limited to a handful of " +
      "departments and to Current New Appropriations only — call without department_id first to see coverage.",
    inputSchema: {
      type: "object",
      properties: {
        department_id: {
          type: "string",
          description: "Two-digit department id. Omit to get the coverage list and dataset manifest instead.",
        },
      },
    },
    handler: (env, a) => {
      const deptId = str(a, "department_id");
      return deptId ? budgetCycleDepartment(env, deptId) : budgetCycleOverview(env);
    },
  },
  {
    name: "list_nep_2027_departments",
    title: "List NEP FY2027 departments",
    description:
      "All 39 FY2027 NEP departments with proposed amount, FY2026 baseline, delta/pct, and per-dimension counts. " +
      "Includes the synthetic 'SPF' and 'AUTO' departments.",
    inputSchema: { type: "object", properties: {} },
    handler: (env) => nepDepartments(env),
  },
];

const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

// ---------------------------------------------------------------------------
// JSON-RPC plumbing
// ---------------------------------------------------------------------------

interface RpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: number | string, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function rpcError(id: number | string | null, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0" as const, id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

async function callTool(env: Env, params: Record<string, unknown>) {
  const name = typeof params.name === "string" ? params.name : "";
  const tool = TOOL_MAP.get(name);
  if (!tool) throw new ApiError(400, "unknown_tool", `Unknown tool: ${name}`);
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  try {
    const result = await tool.handler(env, args);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  } catch (e) {
    // Tool execution failures are results (isError), not protocol errors —
    // the model should see them and correct its inputs.
    const msg = e instanceof ApiError ? `${e.code}: ${e.message}` : (e as Error).message;
    return {
      content: [{ type: "text", text: `Error — ${msg}` }],
      isError: true,
    };
  }
}

async function handleMessage(env: Env, msg: RpcMessage): Promise<object | null> {
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(msg.id ?? null, -32600, "Invalid Request");
  }
  const isNotification = msg.id === undefined || msg.id === null;
  const id = msg.id as number | string;
  const params = msg.params ?? {};

  switch (msg.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, {
        tools: TOOLS.map(({ name, title, description, inputSchema }) => ({
          name, title, description, inputSchema,
        })),
      });
    case "tools/call": {
      if (isNotification) return null;
      try {
        return rpcResult(id, await callTool(env, params));
      } catch (e) {
        const msgText = e instanceof ApiError ? e.message : (e as Error).message;
        return rpcError(id, -32602, msgText);
      }
    }
    default:
      if (isNotification) return null;
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP entry point
// ---------------------------------------------------------------------------

const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return preflight();

  if (request.method !== "POST") {
    // Stateless server: no SSE stream to open (GET) and no session to end
    // (DELETE). 405 with Allow is what the Streamable HTTP spec prescribes.
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "This MCP server is stateless — send JSON-RPC messages via POST" },
      },
      { status: 405, headers: { ...CORS_HEADERS, Allow: "POST, OPTIONS" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error: body is not valid JSON"), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  // Older protocol revisions allow JSON-RPC batches; answer them too.
  const messages: RpcMessage[] = Array.isArray(body) ? body : [body as RpcMessage];
  if (messages.length === 0) {
    return Response.json(rpcError(null, -32600, "Invalid Request: empty batch"), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  const responses = (await Promise.all(messages.map((m) => handleMessage(env, m))))
    .filter((r): r is object => r !== null);

  // Notifications only — acknowledge with 202 and no body.
  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  const payload = Array.isArray(body) ? responses : responses[0];
  return Response.json(payload, { headers: JSON_HEADERS });
}
