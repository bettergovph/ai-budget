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
import {
  HEARING_STATUSES,
  hearingGet,
  hearingTimeline,
  hearingTopics,
  hearingTranscript,
  hearingsList,
  hearingsSearch,
} from "./hearings-api";
import {
  HGAB_ATTRIBUTIONS,
  HGAB_BRIDGE_GROUPS,
  HGAB_DATASET_KEYS,
  HGAB_DISTRICT_SORTS,
  HGAB_HELD_MODES,
  HGAB_ORDERS,
  HGAB_PROJECT_SORTS,
  HGAB_REGION_KEYS,
  hgabDataset,
  hgabDistrict,
  hgabDistricts,
  hgabOverview,
  hgabProject,
  hgabProjects,
} from "./hgab-api";

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
disbursements) for a small set of covered departments, Current New Appropriations scope only;
(4) hearings — House Committee on Appropriations budget hearings (FY2027 season and on):
per-topic DELIBERATION RECORDS built from the transcript of each 2–9 hour hearing — for every
topic, the question at issue, the chronological thread of who said what (timestamped, with a
deep link that opens the video at that moment), the agency's position, members' positions,
figures as spoken, commitments/document requests, and where it landed (status). Start with
search_hearings for a question ("what did DOH say about PhilHealth?") or list_hearings to
find a hearing, then get_hearing_topics for the full record. Cite the 'url' of a moment when
you quote it — every claim is verifiable against the video. Figures in hearing records are
AS SPOKEN (machine transcript); treat them as evidence to verify, not as exact data.
(5) HGAB FY2027 — the House of Representatives' version of the FY2027 budget (House Bill 10858,
second and third reading) set against the President's proposal (NEP), line by line, for the four
programs where the bill lists projects: dpwh (DPWH infrastructure, one row per named project),
fmr (farm-to-market roads, one row per road), hfep (health facilities, one row per facility and
funding column) and nia (irrigation, one row per irrigation project). Every row sits in one of six
groups: in the House bill only (insertion candidates), in the proposal only (deletion candidates),
same amount, higher, lower, or a different stretch of the same road. Pairings are CANDIDATES found
by comparing names, places and amounts — leads to check, not confirmed changes; never call them
insertions or deletions. The NEP and the House bill are two versions of ONE budget: compare them,
never add them (filtered sums come per version, marked not_additive_across_versions). held = true
marks an unconfirmed (fuzzy or ambiguous) match; bridge figures include those, so the six groups add
up to net_php, and each group's unconfirmed_rows / unconfirmed_php says how much of it is unconfirmed.
Districts: DPWH money by district engineering office, with the congressional districts each office
serves. A Tier A office serves one district; a Tier B office is shared and its money is never
split, so a shared district headline is a range, not that district's own; money under the Central
Office and regional offices is on no district card (the residual). Start with
get_hgab_2027_overview, then get_hgab_2027_dataset or search_hgab_2027_projects. Cite each row's
'url' (its page on the site) and 'pdf_url' (the source page) when you use it.

All amounts are exact Philippine pesos (PHP). GAA and NEP department ids differ:
GAA uses two digits ("07" = DepEd); NEP adds synthetic "SPF" (special purpose funds)
and "AUTO" (automatic appropriations) — do not confuse "AUTO" with department "04".
Start with list_gaa_departments or get_nep_2027_overview to discover valid ids.`;

const HGAB_DATASET_SCHEMA = {
  type: "string",
  enum: [...HGAB_DATASET_KEYS],
  description:
    "Program: dpwh (DPWH infrastructure projects), fmr (DA farm-to-market roads), hfep (DOH health facilities), " +
    "nia (NIA irrigation projects)",
};

/** A comma string or an array, as clients send either. */
function strList(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string").join(",") || undefined;
  return str(args, key);
}

const BRIDGE_HELD_WORDING =
  "Bridge figures include unconfirmed matches (so the six groups add up to net_php); each group's " +
  "unconfirmed_rows / unconfirmed_php says how much of it is unconfirmed. The 10 largest per group leave " +
  "unconfirmed matches out.";

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
  {
    name: "list_hearings",
    title: "List budget hearings",
    description:
      "House Committee on Appropriations budget hearings (YouTube streams), newest first: agency under review, date, " +
      "length, whether a transcript and a per-topic deliberation record exist. Filter by fiscal_year (e.g. '2027'), " +
      "agency acronym (e.g. 'DOH'), or a title keyword.",
    inputSchema: {
      type: "object",
      properties: {
        fiscal_year: { type: "string", description: "Budget fiscal year, e.g. '2027'" },
        agency: { type: "string", description: "Agency acronym as in the hearing title, e.g. 'DOH', 'DPWH'" },
        query: { type: "string", description: "Keyword matched against the hearing title" },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
      },
    },
    handler: (env, a) => hearingsList(env, {
      fiscal_year: str(a, "fiscal_year"), agency: str(a, "agency"), query: str(a, "query"),
      limit: typeof a.limit === "number" ? a.limit : undefined,
    }),
  },
  {
    name: "search_hearings",
    title: "Search what was said in the hearings",
    description:
      "Search across every hearing's deliberation topics by keyword(s): returns the matching topic records " +
      "(summary, agency position, outcome/status) plus the specific timestamped moments that mention the terms, each " +
      "with a URL that opens the video there. All terms must match. Use this first for questions like " +
      "'what was said about flood control' or 'which hearings discussed unpaid health-worker benefits'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "One or more keywords, e.g. 'PhilHealth subsidy'" },
        fiscal_year: { type: "string" },
        agency: { type: "string", description: "Restrict to one agency's hearing(s), e.g. 'DOH'" },
        status: { type: "string", enum: [...HEARING_STATUSES], description: "Restrict to topics with this outcome status" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      required: ["query"],
    },
    handler: (env, a) => hearingsSearch(env, {
      query: requireStr(a, "query"), fiscal_year: str(a, "fiscal_year"), agency: str(a, "agency"),
      status: str(a, "status"), limit: typeof a.limit === "number" ? a.limit : undefined,
    }),
  },
  {
    name: "get_hearing",
    title: "Hearing overview and topic index",
    description:
      "One hearing: metadata (agency, date, length, YouTube and page URLs, transcript provenance) and its topic index — " +
      "every deliberation topic with status, first timestamp, one-paragraph summary and outcome. " +
      "Use get_hearing_topics for the full thread of each topic.",
    inputSchema: {
      type: "object",
      properties: { video_id: { type: "string", description: "YouTube video id from list_hearings or search_hearings" } },
      required: ["video_id"],
    },
    handler: (env, a) => hearingGet(env, requireStr(a, "video_id")),
  },
  {
    name: "get_hearing_topics",
    title: "Full deliberation record by topic",
    description:
      "Every topic's full deliberation record for one hearing: question at issue, chronological thread of moments " +
      "(timestamp, speaker, side, kind, what was said, url), agency position, members' positions, figures as spoken, " +
      "actions (document requests, commitments, motions, rulings), outcome and status. Long hearings return 10–25 " +
      "topics with up to 40 moments each; pass topic_index to fetch just one.",
    inputSchema: {
      type: "object",
      properties: {
        video_id: { type: "string" },
        topic_index: { type: "integer", minimum: 0, description: "0-based index from get_hearing's topic list; omit for all topics" },
        include_thread: { type: "boolean", default: true, description: "false = summaries only, no moment-by-moment thread" },
      },
      required: ["video_id"],
    },
    handler: async (env, a) => {
      const id = requireStr(a, "video_id");
      const all = await hearingTopics(env, id, { thread: a.include_thread !== false });
      if (typeof a.topic_index === "number") {
        const one = all.data.find((t) => t.index === a.topic_index);
        if (!one) throw new ApiError(404, "not_found", `Hearing ${id} has no topic ${a.topic_index}`);
        return { meta: all.meta, data: one };
      }
      return all;
    },
  },
  {
    name: "get_hearing_timeline",
    title: "Hearing timeline (section by section)",
    description:
      "The proceedings in order — roll call, agency presentation, each member's interpellation, motions, suspensions — " +
      "with per-section summaries, question/answer exchanges, figures and actions, all timestamped and deep-linked. " +
      "Use when the question is about the flow of the hearing rather than one topic.",
    inputSchema: { type: "object", properties: { video_id: { type: "string" } }, required: ["video_id"] },
    handler: (env, a) => hearingTimeline(env, requireStr(a, "video_id")),
  },
  {
    name: "get_hearing_transcript",
    title: "Raw transcript window",
    description:
      "Machine transcript segments (with inferred speaker names) for a time window of one hearing — to read exactly " +
      "what was said around a moment found via search_hearings or a topic thread. Default window is 20 minutes from " +
      "from_seconds; at most 1000 segments.",
    inputSchema: {
      type: "object",
      properties: {
        video_id: { type: "string" },
        from_seconds: { type: "integer", minimum: 0, default: 0 },
        to_seconds: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: 1000, default: 300 },
      },
      required: ["video_id"],
    },
    handler: (env, a) => hearingTranscript(env, requireStr(a, "video_id"), {
      from: typeof a.from_seconds === "number" ? a.from_seconds : 0,
      to: typeof a.to_seconds === "number" ? a.to_seconds : undefined,
      limit: typeof a.limit === "number" ? a.limit : undefined,
    }),
  },
  {
    name: "get_hgab_2027_overview",
    title: "House bill FY2027 overview",
    description:
      "The FY2027 House bill (House Bill 10858) against the President's proposed budget (NEP) for the four programs " +
      "where the bill lists projects (dpwh, fmr, hfep, nia): for each, a plain summary, what one row is, caveats, " +
      "totals per version (never add them), record counts, and the six-group bridge with plain labels (House bill " +
      "only = insertion candidates, proposal only = deletion candidates, same, higher, lower, different stretch). " +
      `${BRIDGE_HELD_WORDING} Also the source documents with PDF links, the reconciliation status counts, the plain ` +
      "meaning of each term, and the rules. Start here for any House bill question.",
    inputSchema: { type: "object", properties: {} },
    handler: (env) => hgabOverview(env),
  },
  {
    name: "get_hgab_2027_dataset",
    title: "House bill FY2027: one program",
    description:
      "One program's House bill against the proposal: everything in its overview entry plus the totals each document " +
      "prints (controls, with PDF page links), House vs proposal by region / office kind / program / program line " +
      "(dims), the 18 regions plus amounts printed as nationwide, the second vs third reading comparison (DPWH only), " +
      `and the 10 largest rows in each bridge group. ${BRIDGE_HELD_WORDING} Versions are compared, never added.`,
    inputSchema: {
      type: "object",
      properties: { dataset: HGAB_DATASET_SCHEMA },
      required: ["dataset"],
    },
    handler: (env, a) => hgabDataset(env, requireStr(a, "dataset")),
  },
  {
    name: "search_hgab_2027_projects",
    title: "Search House bill FY2027 project rows",
    description:
      "Filter, sort and page one program's comparison rows (one row per project line as the documents print it). " +
      "Each row: title, program, program line (pap), region, office, the amount in each version (nep_php, hgab2_php, " +
      "hgab3_php, house_php = latest House reading; null = no such line, never zero), delta_php (House minus " +
      "proposal), the plain status_label beside the raw trace code, held (true = unconfirmed match), url (the row's " +
      "page) and pdf_url per version (the source page). Statuses are candidates, not confirmed changes. Returns " +
      "total (all matched rows) and per-version sums over every matched row, which are never to be added across " +
      "versions. At most 50 rows per call: when total is larger, page with offset (next_offset).",
    inputSchema: {
      type: "object",
      properties: {
        dataset: HGAB_DATASET_SCHEMA,
        query: { type: "string", description: "Words that must all appear in the title, program, program line, region or office" },
        group: {
          type: "array",
          items: { type: "string", enum: [...HGAB_BRIDGE_GROUPS] },
          description: "Keep rows in these bridge groups: house_only (insertion candidates), nep_only (deletion candidates), unchanged, increased, decreased, scope_review",
        },
        region: {
          type: "string",
          description: `A region key (${HGAB_REGION_KEYS.join(", ")}) or a region label exactly as the documents print it`,
        },
        program: { type: "string", description: "Exact program as printed, e.g. 'Flood Management Program'" },
        office: { type: "string", description: "Exact implementing office as printed (DPWH), e.g. 'Bulacan 1st District Engineering Office'" },
        held: {
          type: "string",
          enum: [...HGAB_HELD_MODES],
          description: "Unconfirmed matches: all (default), hide (confirmed only), only (unconfirmed only)",
        },
        sort: {
          type: "string",
          enum: [...HGAB_PROJECT_SORTS],
          description: "house (latest House amount, default), nep, delta (House minus proposal), abs_delta (size of the change), title",
        },
        order: { type: "string", enum: [...HGAB_ORDERS], description: "desc (default for amounts) or asc (default for title); rows with no amount always sort last" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
        offset: { type: "integer", minimum: 0, default: 0, description: "Rows to skip, for paging (use next_offset)" },
      },
      required: ["dataset"],
    },
    handler: (env, a) =>
      hgabProjects(env, requireStr(a, "dataset"), {
        q: str(a, "query"),
        group: strList(a, "group"),
        region: str(a, "region"),
        program: str(a, "program"),
        office: str(a, "office"),
        held: str(a, "held"),
        sort: str(a, "sort"),
        order: str(a, "order"),
        limit: Math.min(Math.max(Math.trunc(num(a, "limit") ?? 20), 1), 50),
        offset: num(a, "offset"),
      }),
  },
  {
    name: "get_hgab_2027_project",
    title: "One House bill FY2027 project row",
    description:
      "One comparison row in full: the amounts per version, plain labels for its status (with what it means), how the " +
      "pairing was made, second vs third reading, the DPWH website listing, and every review flag; a pdf_url per " +
      "version that opens the source page; the row's page url; and the source workbench's full record. The status " +
      "is a candidate, not a confirmed change.",
    inputSchema: {
      type: "object",
      properties: {
        dataset: HGAB_DATASET_SCHEMA,
        id: { type: "string", description: "Row id from search_hgab_2027_projects or get_hgab_2027_dataset, e.g. 'house-reading:848'" },
      },
      required: ["dataset", "id"],
    },
    handler: (env, a) => hgabProject(env, requireStr(a, "dataset"), requireStr(a, "id")),
  },
  {
    name: "list_hgab_2027_districts",
    title: "DPWH money by congressional district",
    description:
      "Congressional district cards (254): the representative (name, seat, portrait with its attribution and licence, " +
      "bills link), the DPWH district engineering offices that serve the district with their tier, and headline " +
      "amounts (FY2026 enacted, FY2027 proposal, FY2027 House bill). Tier A = the office serves only this district; " +
      "Tier B = shared, and its money is never split, so a shared headline (shared_office_total: true) is a range, " +
      "not the district's own. fy2027_vs_proposal is the like-for-like 2027 change. Always returns the residual: " +
      "DPWH money on no district card (Central Office, regional offices), per year. Nothing here says a " +
      "representative requested or controlled any amount.",
    inputSchema: {
      type: "object",
      properties: {
        region: { type: "string", description: `Region key: ${HGAB_REGION_KEYS.join(", ")}` },
        query: { type: "string", description: "Words that must all appear in the district, representative or office name" },
        attribution: {
          type: "string",
          enum: [...HGAB_ATTRIBUTIONS],
          description: "A (every office serves only this district), B (every office shared), mixed, none (no office found)",
        },
        sort: {
          type: "string",
          enum: [...HGAB_DISTRICT_SORTS],
          description: "hgab3 (largest House bill amount, default), gaa2026 (largest 2026 enacted), change (largest House-minus-proposal on the same rows), name",
        },
        limit: { type: "integer", minimum: 1, maximum: 254, default: 50 },
        offset: { type: "integer", minimum: 0, default: 0 },
      },
    },
    handler: (env, a) =>
      hgabDistricts(env, {
        region: str(a, "region"),
        q: str(a, "query"),
        attribution: str(a, "attribution"),
        sort: str(a, "sort"),
        limit: num(a, "limit"),
        offset: num(a, "offset"),
      }),
  },
  {
    name: "get_hgab_2027_district",
    title: "One congressional district's DPWH offices",
    description:
      "One district: its card and representative, plus the full history of every office that serves it: FY2020–2026 " +
      "enacted budgets and the FY2027 proposal (whole office) and House bill (named projects only), totals per " +
      "Congress, the FY2027 six-group comparison, notes, and links to the office's DPWH project rows. A shared " +
      "(Tier B) office's figures are the whole office's and are not split. null = not found that year, never zero.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "District id from list_hgab_2027_districts, e.g. 'leg:abra:lone'" } },
      required: ["id"],
    },
    handler: (env, a) => hgabDistrict(env, requireStr(a, "id")),
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
