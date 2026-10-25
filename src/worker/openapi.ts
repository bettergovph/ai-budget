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

const hearingIdParam = {
  name: "video_id",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "YouTube video id of the hearing (from the list or search endpoints).",
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

const yearPathParam = {
  name: "year",
  in: "path",
  required: true,
  schema: { type: "integer", enum: [2020, 2021, 2022, 2023, 2024, 2025, 2026] },
  description: "Fiscal year, 2020–2026.",
} as const;

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

// ---------------------------------------------------------------------------
// House bill FY2027 (HGAB)
// ---------------------------------------------------------------------------

const HGAB_KEYS = ["dpwh", "fmr", "hfep", "nia"];
const HGAB_GROUPS = ["house_only", "nep_only", "unchanged", "increased", "decreased", "scope_review"];
const HGAB_REGIONS = ["NCR", "CAR", "I", "II", "III", "IV-A", "MIMAROPA", "V", "VI", "NIR", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "BARMM"];

/** Same wording as the docs page and the MCP tool descriptions. */
const HGAB_BRIDGE_WORDING =
  "Bridge figures include unconfirmed matches (so the six groups add up to net_php); each group's " +
  "unconfirmed_rows / unconfirmed_php says how much of it is unconfirmed. The 10 largest per group leave " +
  "unconfirmed matches out.";

const hgabKeyParam = {
  name: "key",
  in: "path",
  required: true,
  schema: { type: "string", enum: HGAB_KEYS },
  description: "Program: `dpwh` (DPWH infrastructure), `fmr` (farm-to-market roads), `hfep` (health facilities), `nia` (irrigation). Unknown keys return 404.",
} as const;

const hgabOk = (data: Record<string, unknown>, desc = "OK") => ({
  description: desc,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: { meta: { $ref: "#/components/schemas/HgabMeta" }, data },
        required: ["meta", "data"],
      },
    },
  },
});

const hgabErrors = { "400": errorResponse, "404": errorResponse, "503": errorResponse } as const;

const pesosOrNull = (description: string) => ({ type: ["integer", "null"], description });

const HGAB_PATHS = {
  "/api/v1/hgab/2027": {
    get: {
      tags: ["hgab-2027"],
      operationId: "getHgab2027Overview",
      summary: "House bill FY2027 overview",
      description:
        "The FY2027 House bill (House Bill 10858) against the NEP (the budget the President submits to Congress each " +
        "August) for the four programs where the bill lists projects. Each dataset: plain summary, caveats, totals " +
        `per version, record counts, the six-group bridge with plain labels, and links. ${HGAB_BRIDGE_WORDING} Also the documents, ` +
        "reconciliation status counts, the plain terms, the rules, and the stage order NEP → House → Senate → GAA.",
      responses: {
        "200": hgabOk({
          type: "object",
          properties: {
            stage_order: { type: "array", items: { type: "object", additionalProperties: true } },
            rules: { type: "array", items: { type: "string" } },
            terms: { type: "object", additionalProperties: { type: "object", properties: { term: { type: "string" }, meaning: { type: "string" } } } },
            datasets: { type: "array", items: { $ref: "#/components/schemas/HgabDataset" } },
            documents: { type: "array", items: { $ref: "#/components/schemas/HgabDocument" } },
            reconciliation: {
              type: "object",
              properties: {
                checks: { type: "integer" },
                by_status: { type: "object", additionalProperties: { type: "integer" } },
                by_dataset: { type: "object", additionalProperties: { type: "object", additionalProperties: { type: "integer" } } },
                link: { type: "string" },
              },
              additionalProperties: true,
            },
            url: { type: "string" },
            links: { type: "object", additionalProperties: { type: "string" } },
          },
          additionalProperties: true,
        }),
        "503": errorResponse,
      },
    },
  },
  "/api/v1/hgab/2027/datasets": {
    get: {
      tags: ["hgab-2027"],
      operationId: "listHgab2027Datasets",
      summary: "The four programs, compact",
      description: `The four datasets without the technical scope, caveats and documents. ${HGAB_BRIDGE_WORDING}`,
      responses: { "200": hgabOk({ type: "array", items: { $ref: "#/components/schemas/HgabDataset" } }), "503": errorResponse },
    },
  },
  "/api/v1/hgab/2027/datasets/{key}": {
    get: {
      tags: ["hgab-2027"],
      operationId: "getHgab2027Dataset",
      summary: "One program in full",
      description:
        "Everything in the dataset's overview entry plus the totals published in each document (`controls`, with PDF " +
        "page links), House vs NEP by recorded label (`dims`: region, office_kind, program, pap as available), the 18 " +
        "regions plus the not-on-map amounts, the second vs third reading comparison (`readings`, DPWH only), and " +
        `\`top\`: the 10 largest rows per bridge group by that group's money basis. ${HGAB_BRIDGE_WORDING}`,
      parameters: [hgabKeyParam],
      responses: {
        "200": hgabOk({
          allOf: [
            { $ref: "#/components/schemas/HgabDataset" },
            {
              type: "object",
              properties: {
                controls: { type: "array", items: { $ref: "#/components/schemas/HgabControl" } },
                dims: { type: "object", additionalProperties: { type: "array", items: { $ref: "#/components/schemas/HgabDim" } } },
                regions: { $ref: "#/components/schemas/HgabRegions" },
                readings: { type: ["object", "null"], additionalProperties: true, description: "DPWH only: second vs third reading totals, status counts, `changed_controls` (totals that changed between the readings) and `printed_controls` (the totals published at each reading)." },
                top: {
                  type: "object",
                  description: "The 10 largest rows per bridge group, unconfirmed matches left out (held = 0).",
                  additionalProperties: { type: "array", items: { $ref: "#/components/schemas/HgabProject" } },
                },
              },
            },
          ],
        }),
        ...hgabErrors,
      },
    },
  },
  "/api/v1/hgab/2027/datasets/{key}/projects": {
    get: {
      tags: ["hgab-2027"],
      operationId: "searchHgab2027Projects",
      summary: "Filter, sort and page comparison rows",
      description:
        "One row per comparison record. Filters combine with AND; one WHERE clause drives the page, `total` and the " +
        "per-version `sums`, which cover every matched row and are never to be added across versions. Rows with no " +
        "amount on the sorted column always sort last; ties break by id.",
      parameters: [
        hgabKeyParam,
        { name: "q", in: "query", schema: { type: "string" }, description: "Words (space-separated) that must all appear in the title, program, program line, region or office." },
        { name: "group", in: "query", schema: { type: "string" }, description: `Comma list of bridge groups: ${HGAB_GROUPS.join(", ")}.` },
        { name: "held", in: "query", schema: { type: "string", enum: ["all", "hide", "only"], default: "all" }, description: "Unconfirmed (fuzzy or ambiguous) matches: keep all, hide them, or only them." },
        { name: "region", in: "query", schema: { type: "string" }, description: `A region key (${HGAB_REGIONS.join(", ")}) or a region label exactly as published ("|"-separated for several).` },
        { name: "program", in: "query", schema: { type: "string" }, description: "Exact program as published." },
        { name: "pap", in: "query", schema: { type: "string" }, description: "Exact program line (PAP / sub-program / funding column) as published." },
        { name: "office", in: "query", schema: { type: "string" }, description: "Exact implementing office as published (DPWH)." },
        { name: "office_kind", in: "query", schema: { type: "string" }, description: "Central Office · District engineering offices (DEOs) · Regional offices · Other recorded offices · No recorded office." },
        { name: "zone", in: "query", schema: { type: "string", enum: ["local", "fap"] }, description: "local = locally funded; fap = foreign-assisted." },
        { name: "trace", in: "query", schema: { type: "string" }, description: "Exact raw status code, e.g. house_only_candidate, fuzzy_candidate." },
        { name: "reading_status", in: "query", schema: { type: "string" }, description: "DPWH second vs third reading: same_amount, third_only, second_only, amount_changed, repeated_key." },
        { name: "flag", in: "query", schema: { type: "string" }, description: "One review flag that must be present, e.g. region_difference." },
        { name: "has_coordinates", in: "query", schema: { type: "string", enum: ["1", "0"] }, description: "1 = only rows whose documents publish coordinates; 0 = only rows without." },
        { name: "sort", in: "query", schema: { type: "string", enum: ["house", "nep", "delta", "abs_delta", "title"], default: "house" }, description: "house = latest House amount." },
        { name: "order", in: "query", schema: { type: "string", enum: ["desc", "asc"] }, description: "Default desc for amounts, asc for title." },
        { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
        { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
      ],
      responses: {
        "200": hgabOk({
          type: "object",
          properties: {
            total: { type: "integer", description: "Rows matched by the filters." },
            sums: { $ref: "#/components/schemas/HgabVersionSums" },
            rows: { type: "array", items: { $ref: "#/components/schemas/HgabProject" } },
            next_offset: { type: ["integer", "null"] },
          },
          required: ["total", "sums", "rows"],
        }),
        ...hgabErrors,
      },
    },
  },
  "/api/v1/hgab/2027/datasets/{key}/projects/{id}": {
    get: {
      tags: ["hgab-2027"],
      operationId: "getHgab2027Project",
      summary: "One comparison row with its source record",
      description:
        "The row, plain labels for its status, pairing, reading, DPWH-site listing, zone and flags, a `pdf_url` per " +
        "version, the row's page `url`, and `record`: the source workbench's full record (shape as the workbench writes it).",
      parameters: [
        hgabKeyParam,
        { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Row id, percent-encoded (ids can contain `:` and `|`)." },
      ],
      responses: { "200": hgabOk({ $ref: "#/components/schemas/HgabProjectRecord" }), ...hgabErrors },
    },
  },
  "/api/v1/hgab/2027/datasets/{key}/regions": {
    get: {
      tags: ["hgab-2027"],
      operationId: "getHgab2027Regions",
      summary: "The 18 regions plus amounts not on the map",
      description: "All 18 regions north to south under the region each document lists (null where a document lists nothing), and `not_on_map`: amounts listed as nationwide or with no region. Nothing is geocoded.",
      parameters: [hgabKeyParam],
      responses: { "200": hgabOk({ $ref: "#/components/schemas/HgabRegions" }), ...hgabErrors },
    },
  },
  "/api/v1/hgab/2027/documents": {
    get: {
      tags: ["hgab-2027"],
      operationId: "listHgab2027Documents",
      summary: "Source documents",
      description: "The eight source PDFs (NEP and House bill volumes) with `pdf_url`, page ranges used, sha256 and size, and which datasets cite each.",
      responses: { "200": hgabOk({ type: "array", items: { $ref: "#/components/schemas/HgabDocument" } }), "503": errorResponse },
    },
  },
  "/api/v1/hgab/2027/reconciliation": {
    get: {
      tags: ["hgab-2027"],
      operationId: "listHgab2027Reconciliation",
      summary: "Checks against this portal's NEP data",
      description: "The 69 checks of the source workbench's figures (from the PDFs) against this portal's own FY2027 NEP import (the DBM CSV).",
      parameters: [
        { name: "dataset", in: "query", schema: { type: "string", enum: HGAB_KEYS } },
        { name: "status", in: "query", schema: { type: "string", enum: ["exact", "explained", "mismatch", "info"] } },
      ],
      responses: { "200": hgabOk({ type: "array", items: { $ref: "#/components/schemas/HgabReconciliation" } }), "400": errorResponse, "503": errorResponse },
    },
  },
  "/api/v1/hgab/2027/districts": {
    get: {
      tags: ["hgab-2027"],
      operationId: "listHgab2027Districts",
      summary: "DPWH money by congressional district",
      description:
        "District cards with the serving offices and their tier, and the residual (money on no district card) for all " +
        "nine year slots. A shared (Tier B) office's money is never divided: when attribution is B or mixed the " +
        "headline carries `shared_office_total: true` and the co-served district ids.",
      parameters: [
        { name: "region", in: "query", schema: { type: "string" }, description: `Region key (${HGAB_REGIONS.join(", ")}) or a region label as published.` },
        { name: "q", in: "query", schema: { type: "string" }, description: "Words that must all appear in the district, representative or office name." },
        { name: "attribution", in: "query", schema: { type: "string", enum: ["A", "B", "mixed", "none"] } },
        { name: "sort", in: "query", schema: { type: "string", enum: ["hgab3", "gaa2026", "change", "name"], default: "hgab3" }, description: "change = House minus NEP on the same rows (fy2027_vs_proposal)." },
        { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 254, default: 50 } },
        { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
      ],
      responses: {
        "200": hgabOk({
          type: "object",
          properties: {
            total: { type: "integer" },
            districts: { type: "array", items: { $ref: "#/components/schemas/HgabDistrictCard" } },
            next_offset: { type: ["integer", "null"] },
            residual: { type: "array", items: { $ref: "#/components/schemas/HgabResidual" } },
          },
          required: ["total", "districts", "residual"],
        }),
        "400": errorResponse,
        "503": errorResponse,
      },
    },
  },
  "/api/v1/hgab/2027/districts/{id}": {
    get: {
      tags: ["hgab-2027"],
      operationId: "getHgab2027District",
      summary: "One district and its offices' full history",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "District id, e.g. `leg:abra:lone` (percent-encode `:` if your client requires it)." }],
      responses: {
        "200": hgabOk({
          allOf: [
            { $ref: "#/components/schemas/HgabDistrictCard" },
            {
              type: "object",
              properties: {
                co_served_districts: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, url: { type: "string" } } } },
                offices: { type: "array", items: { $ref: "#/components/schemas/HgabOffice" } },
              },
            },
          ],
        }),
        ...hgabErrors,
      },
    },
  },
} as const;

const HGAB_SCHEMAS = {
  HgabMeta: {
    type: "object",
    description: "Every House bill response's meta. `notice` is the disclaimer paragraph; quote it when republishing.",
    properties: {
      dataset: { type: "string", const: "hgab" },
      fiscal_year: { type: "integer", const: 2027 },
      currency: { type: "string", const: "PHP" },
      scale: { type: "string", const: "pesos" },
      source_repo: { type: "string" },
      source_commit: { type: "string" },
      built_at: { type: "string", format: "date-time" },
      notice: { type: "string" },
    },
    required: ["dataset", "fiscal_year", "currency", "scale", "source_commit", "built_at", "notice"],
    additionalProperties: true,
  },
  HgabBridgeGroup: {
    type: "object",
    properties: {
      group: { type: "string", enum: HGAB_GROUPS },
      label: { type: "string", description: "Plain label, e.g. 'In the House bill only'." },
      sub: { type: "string", description: "e.g. 'insertion candidates'." },
      help: { type: "string" },
      rows: { type: "integer", description: "Stored figure; includes unconfirmed matches." },
      php: { type: "integer", description: "The group's money basis in pesos (stored figure; includes unconfirmed matches)." },
      nep_php: pesosOrNull("NEP-side sum of the group's rows, when that side exists."),
      house_php: pesosOrNull("House-side sum of the group's rows, when that side exists."),
      unconfirmed_rows: { type: "integer", description: "How many of `rows` are unconfirmed matches." },
      unconfirmed_php: { type: "integer", description: "How much of `php` is unconfirmed matches." },
    },
  },
  HgabBridge: {
    type: "object",
    description: `The six groups every row falls in. ${HGAB_BRIDGE_WORDING}`,
    properties: {
      house_stage: { type: "string", enum: ["hgab2", "hgab3"] },
      house_stage_label: { type: "string" },
      net_php: { type: "integer", description: "House total minus NEP total for the compared population." },
      identity: { type: "string" },
      groups: { type: "object", additionalProperties: { $ref: "#/components/schemas/HgabBridgeGroup" } },
      note: { type: "string" },
    },
  },
  HgabVersionTotals: {
    type: "object",
    description: "One figure per version. Versions are compared, never added.",
    properties: {
      nep_php: pesosOrNull("The NEP (the budget the President submits to Congress each August)."),
      hgab2_php: pesosOrNull("House bill, second reading."),
      hgab3_php: pesosOrNull("House bill, third reading."),
      api_php: pesosOrNull("DPWH transparency website listing (DPWH only)."),
      not_additive_across_versions: { type: "boolean", const: true },
    },
  },
  HgabVersionSums: {
    type: "object",
    description: "Per-version sums over every matched row. Never add them across versions.",
    properties: {
      nep_php: pesosOrNull("null when no matched row has an NEP amount."),
      hgab2_php: pesosOrNull(""),
      hgab3_php: pesosOrNull(""),
      api_php: pesosOrNull(""),
      rows_with_amount: { type: "object", additionalProperties: { type: "integer" } },
      unconfirmed_rows: { type: "integer" },
      not_additive_across_versions: { type: "boolean", const: true },
    },
  },
  HgabDataset: {
    type: "object",
    properties: {
      key: { type: "string", enum: HGAB_KEYS },
      label: { type: "string" },
      short: { type: "string" },
      agency: { type: "string" },
      dept_id: { type: "string", description: "The NEP / GAA department id this program belongs to." },
      summary: { type: "string", description: "One plain sentence." },
      one_row: { type: "string", description: "Each row, in plain words, e.g. 'One irrigation project.'" },
      caveats: { type: "array", items: { type: "string" } },
      grain: { type: "string" },
      scope: { type: "string" },
      house_stage: { type: "string", enum: ["hgab2", "hgab3"], description: "Which House reading the comparison uses." },
      totals: { $ref: "#/components/schemas/HgabVersionTotals" },
      counts: { type: "object", additionalProperties: { type: ["integer", "null"] } },
      unconfirmed_rows: { type: "integer" },
      bridge: { $ref: "#/components/schemas/HgabBridge" },
      documents: { type: "object", additionalProperties: true },
      url: { type: "string" },
      links: { type: "object", additionalProperties: { type: "string" } },
    },
    additionalProperties: true,
  },
  HgabControl: {
    type: "object",
    description: "A subtotal published in each document, side by side.",
    properties: {
      id: { type: "string" },
      label: { type: "string" },
      group: { type: ["string", "null"] },
      nep_php: pesosOrNull(""),
      hgab2_php: pesosOrNull(""),
      hgab3_php: pesosOrNull(""),
      api_php: pesosOrNull(""),
      delta_php: pesosOrNull("Latest House reading minus the NEP."),
      reading_delta_php: pesosOrNull("Third minus second reading."),
      nep_page: { type: ["integer", "null"] },
      house_pages: { type: "array", items: { type: "integer" } },
      nep_pdf_url: { type: ["string", "null"] },
      house_pdf_urls: { type: "array", items: { type: "string" } },
    },
  },
  HgabDim: {
    type: "object",
    properties: {
      label: { type: "string" },
      nep_php: { type: "integer" },
      house_php: { type: "integer" },
      nep_records: { type: "integer" },
      house_records: { type: "integer" },
    },
  },
  HgabRegions: {
    type: "object",
    properties: {
      house_stage: { type: "string" },
      placeable: { type: "boolean", description: "False when the documents give no location (NIA)." },
      note: { type: ["string", "null"] },
      points_note: { type: ["string", "null"] },
      regions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", enum: HGAB_REGIONS },
            label: { type: "string" },
            name: { type: "string" },
            nep_php: pesosOrNull(""),
            house_php: pesosOrNull(""),
            delta_php: pesosOrNull(""),
            nep_rows: { type: "integer" },
            house_rows: { type: "integer" },
            source_labels: { type: "array", items: { type: "string" }, description: "The region labels exactly as published." },
          },
          additionalProperties: true,
        },
      },
      not_on_map: { type: ["object", "null"], additionalProperties: true },
      not_additive_across_versions: { type: "boolean", const: true },
      url: { type: "string" },
    },
  },
  HgabProject: {
    type: "object",
    description: "One comparison row. Amounts are pesos; null = this version has no such line.",
    properties: {
      id: { type: "string" },
      dataset: { type: "string", enum: HGAB_KEYS },
      title: { type: "string" },
      program: { type: ["string", "null"] },
      pap: { type: ["string", "null"] },
      region: { type: ["string", "null"], description: "As published." },
      region_key: { type: ["string", "null"], enum: [...HGAB_REGIONS, null] },
      office: { type: ["string", "null"] },
      office_kind: { type: ["string", "null"] },
      zone: { type: ["string", "null"], enum: ["local", "fap", null] },
      trace: { type: "string", description: "Raw status code." },
      status_label: { type: "string", description: "Plain status, a candidate rather than a finding." },
      bridge_group: { type: ["string", "null"], enum: [...HGAB_GROUPS, null] },
      group_label: { type: ["string", "null"] },
      held: { type: "boolean", description: "True = an unconfirmed (fuzzy or ambiguous) match." },
      house_match: { type: ["string", "null"] },
      reading_status: { type: ["string", "null"] },
      api_presence: { type: ["string", "null"] },
      confidence: { type: ["number", "null"] },
      nep_php: pesosOrNull(""),
      hgab2_php: pesosOrNull(""),
      hgab3_php: pesosOrNull(""),
      house_php: pesosOrNull("Latest House reading."),
      api_php: pesosOrNull(""),
      delta_php: pesosOrNull("Latest House reading minus the NEP, when both exist."),
      nep_page: { type: ["integer", "null"] },
      hgab2_page: { type: ["integer", "null"] },
      hgab3_page: { type: ["integer", "null"] },
      nep_doc: { type: ["string", "null"] },
      hgab2_doc: { type: ["string", "null"] },
      hgab3_doc: { type: ["string", "null"] },
      pdf_url: { type: "object", additionalProperties: { type: ["string", "null"] }, description: "Per version: the source PDF opened at the page (#page=N)." },
      length_m: { type: ["number", "null"] },
      flags: { type: "array", items: { type: "string" } },
      suggestions: { type: "integer" },
      lon: { type: ["number", "null"] },
      lat: { type: ["number", "null"] },
      url: { type: "string", description: "The row's page on budget.bettergov.ph." },
      api_url: { type: "string" },
    },
  },
  HgabProjectRecord: {
    allOf: [
      { $ref: "#/components/schemas/HgabProject" },
      {
        type: "object",
        properties: {
          labels: {
            type: "object",
            properties: {
              status: { type: "object", additionalProperties: true },
              match: { type: ["object", "null"], properties: { code: { type: "string" }, label: { type: ["string", "null"] } } },
              reading: { type: ["object", "null"], properties: { code: { type: "string" }, label: { type: "string" } } },
              dpwh_site: { type: ["object", "null"], additionalProperties: true },
              zone: { type: ["object", "null"], additionalProperties: true },
              flags: { type: "array", items: { type: "object", properties: { code: { type: "string" }, label: { type: "string" } } } },
              pap: { type: ["string", "null"], description: "What the pap field means for this program." },
            },
            additionalProperties: true,
          },
          record: { description: "The source workbench's full record, as it writes it." },
          links: { type: "object", additionalProperties: { type: "string" } },
        },
      },
    ],
  },
  HgabDocument: {
    type: "object",
    properties: {
      key: { type: "string" },
      title: { type: "string" },
      stage: { type: "string", enum: ["nep", "house"] },
      reading: { type: ["integer", "null"] },
      volume: { type: ["string", "null"] },
      pages: { type: ["object", "null"], properties: { from: { type: "integer" }, to: { type: "integer" } } },
      sha256: { type: "string" },
      bytes: { type: "integer" },
      source_url: { type: ["string", "null"] },
      notes: { type: ["string", "null"] },
      pdf_url: { type: "string" },
      used_by: { type: "array", items: { type: "string" } },
    },
  },
  HgabReconciliation: {
    type: "object",
    properties: {
      dataset: { type: "string", enum: HGAB_KEYS },
      check: { type: "string" },
      ours_php: pesosOrNull("From this portal's FY2027 NEP import (DBM CSV)."),
      theirs_php: pesosOrNull("From the source workbench's extraction (PDF)."),
      diff_php: pesosOrNull("ours − theirs."),
      status: { type: "string", enum: ["exact", "explained", "mismatch", "info"] },
      status_label: { type: "string" },
      note: { type: "string" },
    },
  },
  HgabDistrictCard: {
    type: "object",
    properties: {
      id: { type: "string" },
      label: { type: "string" },
      jurisdiction: { type: "string" },
      district_label: { type: "string" },
      region: { type: ["string", "null"] },
      region_key: { type: ["string", "null"] },
      attribution: {
        type: "object",
        properties: { code: { type: "string", enum: ["A", "B", "mixed", "none"] }, label: { type: "string" }, meaning: { type: "string" } },
      },
      representative: { type: ["object", "null"], additionalProperties: true, description: "Name, seat, status, portrait (url, attribution, license, source_url), bills_url." },
      offices: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            tier: { type: "string", enum: ["A", "B"] },
            tier_text: { type: "string" },
            co_served_district_ids: { type: "array", items: { type: "string" } },
          },
          additionalProperties: true,
        },
      },
      headline: {
        type: "object",
        properties: {
          fy2026_gaa_php: pesosOrNull("Enacted 2026, whole office."),
          fy2027_nep_php: pesosOrNull("2027 NEP, whole office."),
          fy2027_hgab3_php: pesosOrNull("2027 House bill, named projects only."),
          shared_office_total: { type: "boolean", description: "True when attribution is B or mixed: undivided office totals, a range, not the district's own." },
          co_served_district_ids: { type: "array", items: { type: "string" } },
          note: { type: "string" },
        },
        additionalProperties: true,
      },
      fy2027_vs_proposal: {
        type: "object",
        description: "House bill against the NEP on the same project rows of the serving offices: the like-for-like change.",
        properties: {
          nep_php: pesosOrNull(""),
          hgab3_php: pesosOrNull(""),
          delta_php: pesosOrNull(""),
          offices: { type: "integer" },
        },
        additionalProperties: true,
      },
      url: { type: "string" },
      api_url: { type: "string" },
    },
    additionalProperties: true,
  },
  HgabOffice: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      kind: { type: "string" },
      tier: { type: "string", enum: ["A", "B"] },
      district_ids: { type: "array", items: { type: "string" } },
      years: {
        type: "array",
        items: {
          type: "object",
          properties: {
            fy: { type: "integer" },
            stage: { type: "string", enum: ["gaa", "nep", "hgab3"] },
            php: pesosOrNull("null = office not found that year, never zero."),
            matched_label: { type: ["string", "null"] },
          },
          additionalProperties: true,
        },
      },
      by_congress: { type: "array", items: { type: "object", additionalProperties: true } },
      fy2027: { type: ["object", "null"], additionalProperties: true },
      notes: { type: "array", items: { type: "string" } },
      projects_url: { type: "string" },
      projects_api: { type: "string" },
    },
    additionalProperties: true,
  },
  HgabResidual: {
    type: "object",
    description: "DPWH money on no district card for one year slot.",
    properties: {
      fy: { type: "integer" },
      stage: { type: "string", enum: ["gaa", "nep", "hgab3"] },
      total_php: { type: "integer" },
      deo_php: { type: "integer", description: "Under offices on at least one district card." },
      central_office_php: { type: "integer" },
      regional_offices_php: { type: "integer" },
      unmatched_php: { type: "integer" },
      unmatched_labels: { type: "array", items: { type: "string" } },
      not_on_any_district_php: { type: "integer" },
      share_not_on_any_district: { type: ["number", "null"] },
    },
    additionalProperties: true,
  },
} as const;

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
      "departments. Also the **House budget hearings** (per-topic deliberation records) and the " +
      "**FY2027 House bill** (House Bill 10858) compared with the NEP project by project for four programs, with DPWH " +
      "money by district engineering office.\n\n" +
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
    { name: "hearings", description: "House budget hearings: per-topic deliberation records, timelines, transcripts" },
    {
      name: "hgab-2027",
      description:
        "FY2027 House bill (House Bill 10858) against the NEP (the budget the President submits to Congress each " +
        "August), project by project for DPWH, farm-to-market roads, health facilities and irrigation, plus DPWH " +
        "money by district. Pairings are " +
        "candidates; versions are compared, never added. " + HGAB_BRIDGE_WORDING,
    },
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
    "/api/v1/gaa/years/{year}": {
      get: {
        tags: ["gaa"],
        operationId: "getGaaYearSnapshot",
        summary: "Single-year national snapshot",
        description:
          "One fiscal year in isolation: the national total plus every department's appropriation, line-item count, " +
          "and share of the year's budget, largest first. The per-year-exclusive counterpart of /api/v1/gaa/departments " +
          "(which returns all seven years per row).",
        parameters: [yearPathParam],
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
                        total: { $ref: "#/components/schemas/GaaYearEntity" },
                        departments: {
                          type: "array",
                          items: { $ref: "#/components/schemas/GaaYearEntity" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/v1/gaa/years/{year}/departments/{id}/children": {
      get: {
        tags: ["gaa"],
        operationId: "listGaaYearChildren",
        summary: "Hierarchy drill for one year (paginated)",
        description:
          "Walk one department's GAA hierarchy a level at a time, scoped to a single fiscal year: `agencies` " +
          "(bureaus — the default, no parent needed), then `fpaps` of an agency (`parent=<agency id>`), " +
          "`operating_units` of a program, `fund_subcategories` of an operating unit, and `expenses` of a fund " +
          "(the leaf). Rows carry that year's figures only, ranked largest first, and include the parent-id " +
          "columns to drill with. Rows with a zero amount in that year are hidden unless `include_zero=1`.",
        parameters: [
          yearPathParam,
          deptIdParam(GAA_DEPT_ID),
          {
            name: "level",
            in: "query",
            schema: {
              type: "string",
              enum: ["agencies", "fpaps", "operating_units", "fund_subcategories", "expenses"],
              default: "agencies",
            },
            description: "Which hierarchy level to list.",
          },
          {
            name: "parent",
            in: "query",
            schema: { type: "string" },
            description: "Parent entity id — required for every level below `agencies`.",
          },
          { name: "include_zero", in: "query", schema: { type: "string", enum: ["1", "true"] } },
          limitQuery(100, 500),
          cursorQuery,
        ],
        responses: { "200": paginated("#/components/schemas/GaaYearEntity"), "400": errorResponse, "500": errorResponse },
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

    // ---- Budget hearings ----
    "/api/v1/hearings": {
      get: {
        tags: ["hearings"],
        operationId: "listHearings",
        summary: "List budget hearings",
        description:
          "House Committee on Appropriations budget hearings (one per YouTube stream), newest first, with agency, date, " +
          "length, transcript provenance and whether a per-topic deliberation record exists.",
        parameters: [
          { name: "fiscal_year", in: "query", schema: { type: "string" }, description: "Budget fiscal year, e.g. 2027" },
          { name: "agency", in: "query", schema: { type: "string" }, description: "Agency acronym as in the title, e.g. DOH" },
          { name: "status", in: "query", schema: { type: "string", enum: ["ok", "no_captions"] } },
          { name: "q", in: "query", schema: { type: "string" }, description: "Keyword matched against the title" },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: { type: "object", properties: {
              meta: { $ref: "#/components/schemas/Meta" },
              data: { type: "array", items: { $ref: "#/components/schemas/Hearing" } },
            } } } },
          },
          "500": errorResponse,
        },
      },
    },
    "/api/v1/hearings/search": {
      get: {
        tags: ["hearings"],
        operationId: "searchHearings",
        summary: "Search what was said across all hearings",
        description:
          "Keyword search over every hearing's deliberation topics (topic, summary, question, outcome and every spoken " +
          "moment). All terms must match. Each hit returns the topic record and the timestamped moments that mention " +
          "the terms, with URLs that open the video at that moment.",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string", minLength: 2 } },
          { name: "fiscal_year", in: "query", schema: { type: "string" } },
          { name: "agency", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["resolved", "committed", "parked", "unresolved", "informational"] } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: { type: "object", properties: {
              meta: { $ref: "#/components/schemas/Meta" },
              data: { type: "array", items: { type: "object", properties: {
                hearing: { type: "object", additionalProperties: true },
                topic: { $ref: "#/components/schemas/HearingTopic" },
                matching_moments: { type: "array", items: { $ref: "#/components/schemas/HearingMoment" } },
              } } },
            } } } },
          },
          "400": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/v1/hearings/{video_id}": {
      get: {
        tags: ["hearings"],
        operationId: "getHearing",
        summary: "Hearing overview and topic index",
        description: "One hearing's metadata plus its topic index (topic, status, first timestamp, summary, outcome).",
        parameters: [hearingIdParam],
        responses: { "200": { description: "OK" }, "404": errorResponse, "500": errorResponse },
      },
    },
    "/api/v1/hearings/{video_id}/topics": {
      get: {
        tags: ["hearings"],
        operationId: "getHearingTopics",
        summary: "Deliberation record, topic by topic",
        description:
          "For every topic deliberated in the hearing: the question at issue, the chronological thread of who said what " +
          "(timestamped, deep-linked), the agency's position, members' positions, figures as spoken, actions, outcome and status.",
        parameters: [
          hearingIdParam,
          { name: "thread", in: "query", schema: { type: "string", enum: ["0", "1"], default: "1" }, description: "0 = omit the moment-by-moment thread" },
        ],
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: { type: "object", properties: {
              meta: { $ref: "#/components/schemas/Meta" },
              data: { type: "array", items: { $ref: "#/components/schemas/HearingTopic" } },
            } } } },
          },
          "404": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/v1/hearings/{video_id}/topics/{index}": {
      get: {
        tags: ["hearings"],
        operationId: "getHearingTopic",
        summary: "One topic's deliberation record",
        parameters: [hearingIdParam, { name: "index", in: "path", required: true, schema: { type: "integer", minimum: 0 } }],
        responses: { "200": { description: "OK" }, "404": errorResponse, "500": errorResponse },
      },
    },
    "/api/v1/hearings/{video_id}/timeline": {
      get: {
        tags: ["hearings"],
        operationId: "getHearingTimeline",
        summary: "Timeline of the proceedings",
        description:
          "Contiguous sections in order (procedural, presentation, interpellation, motion, suspension) with summaries, " +
          "question/answer exchanges, figures and actions, each timestamped and deep-linked. Served from the hearing's " +
          "sections.json in the data host.",
        parameters: [hearingIdParam],
        responses: { "200": { description: "OK" }, "404": errorResponse, "502": errorResponse },
      },
    },
    "/api/v1/hearings/{video_id}/transcript": {
      get: {
        tags: ["hearings"],
        operationId: "getHearingTranscript",
        summary: "Transcript segments for a time window",
        description: "Machine transcript segments (inferred speaker names when known) between from and to seconds; default window 20 minutes, at most 1000 segments.",
        parameters: [
          hearingIdParam,
          { name: "from", in: "query", schema: { type: "integer", minimum: 0, default: 0 }, description: "Start, seconds into the video" },
          { name: "to", in: "query", schema: { type: "integer", minimum: 0 }, description: "End, seconds (default from + 1200)" },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 1000, default: 300 } },
        ],
        responses: { "200": { description: "OK" }, "404": errorResponse, "502": errorResponse },
      },
    },
    ...HGAB_PATHS,
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
          dataset: { type: "string", enum: ["gaa", "nep", "budget-cycle", "hearings", "hgab"] },
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
            description: "Machine-readable slug: bad_request, bad_cursor, not_found, method_not_allowed, not_loaded, query_failed, upstream_failed.",
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
      GaaYearEntity: {
        type: "object",
        description:
          "A GAA node (national total, department, agency, program, operating unit, fund, or expense class) with " +
          "figures for a single fiscal year — the per-year-exclusive shape. Hierarchy rows keep their parent-id " +
          "columns (agency_id, fpap_id, …) so consumers can drill further.",
        properties: {
          id: { type: "string" },
          slug: { type: "string" },
          description: { type: "string", description: "Display name." },
          year: { type: "integer" },
          line_items: { type: "integer" },
          amount: { type: "integer", description: "Pesos, for `year` only." },
          share: { type: ["number", "null"], description: "Fraction of the year's national total (snapshot departments only)." },
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
      Hearing: {
        type: "object",
        description: "One House budget hearing stream.",
        properties: {
          video_id: { type: "string", description: "YouTube video id" },
          title: { type: "string" },
          agency: { type: ["string", "null"], description: "Agency acronym under review" },
          fiscal_year: { type: ["string", "null"] },
          hearing_date: { type: ["string", "null"], format: "date" },
          duration_seconds: { type: ["integer", "null"] },
          youtube_url: { type: "string" },
          page_url: { type: "string", description: "Hearing page on the site; append ?t=<seconds> to open at a moment" },
          has_transcript: { type: "boolean" },
          transcript_source: { type: ["string", "null"], description: "captions | nova3 | whisper | hybrid" },
          has_record: { type: "boolean", description: "A per-topic deliberation record exists" },
          topic_count: { type: ["integer", "null"] },
          status: { type: "string" },
          links: { type: "object", additionalProperties: { type: "string" } },
        },
        additionalProperties: true,
      },
      HearingMoment: {
        type: "object",
        description: "One timestamped moment in a topic's deliberation thread.",
        properties: {
          seconds: { type: "integer" },
          timestamp: { type: "string" },
          speaker: { type: ["string", "null"] },
          side: { type: "string", enum: ["committee", "agency", "executive", "other"] },
          kind: { type: "string", enum: ["question", "answer", "statement", "figure", "commitment", "motion", "ruling", "procedural"] },
          said: { type: "string" },
          url: { type: "string", description: "Opens the hearing page with the video at this moment" },
        },
      },
      HearingTopic: {
        type: "object",
        description: "What transpired on one topic across the whole hearing, built from the transcript.",
        properties: {
          video_id: { type: "string" },
          index: { type: "integer" },
          topic: { type: "string" },
          status: { type: ["string", "null"], enum: ["resolved", "committed", "parked", "unresolved", "informational", null] },
          summary: { type: ["string", "null"] },
          question: { type: ["string", "null"], description: "What the committee was trying to establish" },
          agency_position: { type: ["string", "null"] },
          outcome: { type: ["string", "null"] },
          first_seconds: { type: ["integer", "null"] },
          timestamp: { type: ["string", "null"] },
          url: { type: "string" },
          timeline_sections: { type: "array", items: { type: "integer" }, description: "Indices into the timeline's sections" },
          positions: { type: "array", items: { type: "object", properties: { who: { type: "string" }, position: { type: "string" } } } },
          figures: { type: "array", items: { type: "object", additionalProperties: true, description: "amount_text as spoken; amount = best-effort pesos or null" } },
          actions: { type: "array", items: { type: "object", additionalProperties: true } },
          moment_count: { type: "integer" },
          thread: { type: "array", items: { $ref: "#/components/schemas/HearingMoment" } },
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
      ...HGAB_SCHEMAS,
    },
  },
} as const;
