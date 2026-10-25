# House bill FY2027 in the public API and MCP server — contract

The FY2027 House bill section (House Bill 10858, `/hgab/2027`) served
through the read-only public API (`/api/v1/hgab/2027/…`) and the MCP server
(`/mcp`), alongside the GAA, NEP, budget-cycle and hearings datasets.

The browser pages read static JSON and parquet from R2. A Worker cannot read
parquet, so the API reads **D1** tables built from the same files. The data
does not change: every amount, status and label is the one the pages show,
which is the one the source workbench's own builders produced.

## Rules every endpoint and tool follows

- Amounts are **integer pesos**. `null` means "this version has no such
  line", never zero.
- The NEP (the budget the President submits to Congress each August) and the
  House bill are **two versions of one budget**. Responses compare them;
  nothing returned adds them together. Sums over a filtered set are returned
  per version, labelled `not_additive_across_versions: true`.
- Pairings are **candidates**. Status labels are the plain ones the pages use
  (`TRACE_LABELS` in `src/lib/hgab.ts`), and the raw `trace` code is returned
  beside them. "Insertion" and "deletion" only ever appear as
  "insertion candidate" / "deletion candidate".
- Unconfirmed matches (`held = 1`: fuzzy or ambiguous) are flagged on every
  row. The bridge figures are the stored ones, exactly as on the pages: they
  include unconfirmed matches (counted under "In the House bill only") so
  the six groups add up to `net_php`. Each group also carries
  `unconfirmed_rows` / `unconfirmed_php`, the part of it that is unconfirmed
  (non-zero only on DPWH `house_only`). The "10 largest per group" lists
  leave unconfirmed matches out (`held = 0`).
- District figures carry their tier. Tier B (shared office) money is never
  divided; the unassigned residual is always returned with district lists.
- Every response carries `meta` with `dataset: "hgab"`, `fiscal_year`,
  `currency: "PHP"`, `scale: "pesos"`, `source_commit`, `built_at` and a
  one-paragraph `notice` (the disclaimer), and every row that has a page on
  the site carries `url` (canonical host `https://budget.bettergov.ph`).
  Document page references carry `pdf_url` with `#page=N` on
  `https://budget-assets.bettergov.ph/hgab/2027/pdf/<key>.pdf`.

## D1 tables (`data/hgab/2027/d1-import.sql`)

The script drops and recreates only `hgab_*` tables, so it is idempotent and
never touches the GAA, `nep_*`, `budget_cycle_*` or hearings tables. Inserts
are batched multi-row statements, each under D1's 100 KB statement limit.

```sql
CREATE TABLE hgab_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fiscal_year INTEGER NOT NULL,
  built_at TEXT NOT NULL,            -- overview.json built_at
  source_repo TEXT NOT NULL,
  source_commit TEXT NOT NULL,
  notice TEXT NOT NULL,              -- the plain disclaimer paragraph
  terms_json TEXT NOT NULL           -- PLAIN_TERMS from src/lib/hgab.ts
);

CREATE TABLE hgab_datasets (
  key TEXT PRIMARY KEY,              -- dpwh | fmr | hfep | nia
  sort INTEGER NOT NULL,
  label TEXT NOT NULL, short TEXT NOT NULL, agency TEXT NOT NULL, dept_id TEXT NOT NULL,
  summary TEXT NOT NULL, one_row TEXT NOT NULL, caveats_json TEXT NOT NULL,
  grain TEXT NOT NULL, scope TEXT NOT NULL, controls_label TEXT NOT NULL,
  has_readings INTEGER NOT NULL, has_map INTEGER NOT NULL,
  house_stage TEXT NOT NULL,         -- hgab3 for DPWH, hgab2 for the one-list programs
  nep_php INTEGER NOT NULL, hgab2_php INTEGER, hgab3_php INTEGER, api_php INTEGER,
  nep_count INTEGER NOT NULL, hgab2_count INTEGER, hgab3_count INTEGER, api_count INTEGER,
  printed_json TEXT,                 -- HgabDatasetMeta.printed
  bridge_json TEXT NOT NULL,         -- HgabDatasetMeta.bridge
  documents_json TEXT NOT NULL,      -- { nep: [...], house: [...] }
  readings_json TEXT,                -- DPWH: summary.readings minus third_only rows (ids listed instead)
  not_on_map_json TEXT,              -- map.json not_on_map
  map_note TEXT, points_note TEXT, placeable INTEGER NOT NULL
);

CREATE TABLE hgab_documents (
  key TEXT PRIMARY KEY, sort INTEGER NOT NULL, title TEXT NOT NULL, stage TEXT NOT NULL,
  reading INTEGER, volume TEXT, pages_json TEXT, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
  source_url TEXT, notes TEXT, pdf_url TEXT NOT NULL
);

CREATE TABLE hgab_controls (
  dataset TEXT NOT NULL, id TEXT NOT NULL, sort INTEGER NOT NULL,
  label TEXT NOT NULL, grp TEXT,
  nep_php INTEGER, hgab2_php INTEGER, hgab3_php INTEGER, api_php INTEGER,
  delta_php INTEGER, reading_delta_php INTEGER,
  nep_page INTEGER, house_pages_json TEXT NOT NULL,
  PRIMARY KEY (dataset, id)
);

CREATE TABLE hgab_dims (
  dataset TEXT NOT NULL, dim TEXT NOT NULL, sort INTEGER NOT NULL, label TEXT NOT NULL,
  nep_php INTEGER NOT NULL, house_php INTEGER NOT NULL,
  nep_records INTEGER NOT NULL, house_records INTEGER NOT NULL,
  PRIMARY KEY (dataset, dim, label)
);

CREATE TABLE hgab_regions (            -- map.json regions: all 18 keys per dataset
  dataset TEXT NOT NULL, region_key TEXT NOT NULL, sort INTEGER NOT NULL,
  label TEXT NOT NULL, name TEXT NOT NULL,   -- REGION_LABELS short / plain name
  nep_php INTEGER, house_php INTEGER, delta_php INTEGER,
  nep_rows INTEGER NOT NULL, house_rows INTEGER NOT NULL, source_labels_json TEXT NOT NULL,
  PRIMARY KEY (dataset, region_key)
);

CREATE TABLE hgab_projects (           -- one row per comparison record; parquet minus record_json
  dataset TEXT NOT NULL, id TEXT NOT NULL,
  title TEXT NOT NULL, program TEXT, pap TEXT,
  region TEXT, region_key TEXT,        -- region_key via regionKeyOf(); null = nationwide / unplaced
  office TEXT, office_kind TEXT, zone TEXT,
  trace TEXT NOT NULL, bridge_group TEXT, held INTEGER NOT NULL,   -- via TRACE_LABELS
  house_match TEXT, reading_status TEXT, api_presence TEXT, confidence REAL,
  nep_php INTEGER, hgab2_php INTEGER, hgab3_php INTEGER, house_php INTEGER, api_php INTEGER,
  delta_php INTEGER,
  nep_page INTEGER, hgab2_page INTEGER, hgab3_page INTEGER,
  nep_doc TEXT, hgab2_doc TEXT, hgab3_doc TEXT,
  length_m REAL, flags TEXT NOT NULL, suggestions INTEGER NOT NULL,
  lon REAL, lat REAL,                  -- from map.json points, only where coordinates are printed
  search_text TEXT NOT NULL,
  PRIMARY KEY (dataset, id)
);
CREATE INDEX hgab_projects_group  ON hgab_projects (dataset, bridge_group, held);
CREATE INDEX hgab_projects_region ON hgab_projects (dataset, region_key);
CREATE INDEX hgab_projects_office ON hgab_projects (dataset, office);
CREATE INDEX hgab_projects_house  ON hgab_projects (dataset, house_php);
CREATE INDEX hgab_projects_delta  ON hgab_projects (dataset, delta_php);

CREATE TABLE hgab_records (            -- the workbench's full source record, for one-project lookups
  dataset TEXT NOT NULL, id TEXT NOT NULL, record_json TEXT NOT NULL,
  PRIMARY KEY (dataset, id)
);

CREATE TABLE hgab_reconciliation (
  sort INTEGER PRIMARY KEY, dataset TEXT NOT NULL, check_name TEXT NOT NULL,
  ours_php INTEGER, theirs_php INTEGER, diff_php INTEGER, status TEXT NOT NULL, note TEXT NOT NULL
);

CREATE TABLE hgab_districts (
  id TEXT PRIMARY KEY, sort INTEGER NOT NULL,
  label TEXT NOT NULL, jurisdiction TEXT NOT NULL, district_label TEXT NOT NULL,
  region TEXT, region_key TEXT, attribution TEXT NOT NULL,
  rep_name TEXT, rep_status TEXT, rep_json TEXT,
  office_ids_json TEXT NOT NULL, co_served_json TEXT NOT NULL,
  fy2026_gaa_php INTEGER, fy2027_nep_php INTEGER, fy2027_hgab3_php INTEGER,
  search_text TEXT NOT NULL
);
CREATE INDEX hgab_districts_region ON hgab_districts (region_key);

CREATE TABLE hgab_offices (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, region TEXT, region_key TEXT,
  tier TEXT NOT NULL, district_ids_json TEXT NOT NULL,
  years_json TEXT NOT NULL, by_congress_json TEXT NOT NULL, fy2027_json TEXT,
  notes_json TEXT NOT NULL, aliases_json TEXT NOT NULL
);

CREATE TABLE hgab_residual (
  fy INTEGER NOT NULL, stage TEXT NOT NULL, sort INTEGER NOT NULL,
  total_php INTEGER NOT NULL, deo_php INTEGER NOT NULL, central_office_php INTEGER NOT NULL,
  regional_offices_php INTEGER NOT NULL, unmatched_php INTEGER NOT NULL,
  unmatched_labels_json TEXT NOT NULL,
  PRIMARY KEY (fy, stage)
);
```

Expected row counts: datasets 4, documents 8, controls 46 + 16 + 12 + 6,
regions 72, projects and records 17,613 + 1,059 + 746 + 1,013 = 20,431,
reconciliation 69, districts 254, offices 200, residual 9.

## REST endpoints (`/api/v1/hgab/2027`)

All GET, CORS-open, cached like the other public routes. Errors use the
existing `ApiError` shape (`400 bad_request`, `404 not_found`).

| Route | Returns |
| --- | --- |
| `/api/v1/hgab/2027` | Overview: `meta`, the four datasets (plain summary, one_row, caveats, totals per version, record counts, bridge with plain labels, links), documents, reconciliation status counts, the stage order NEP → House → Senate → GAA |
| `/api/v1/hgab/2027/datasets` | The four datasets, compact |
| `/api/v1/hgab/2027/datasets/{key}` | One dataset: everything in its overview entry plus program totals (`controls`), House-vs-NEP by dimension (`dims`), regions, `readings` (DPWH), and the 10 largest rows per bridge group (computed in SQL, unconfirmed matches excluded) |
| `/api/v1/hgab/2027/datasets/{key}/projects` | Filtered, sorted, paginated rows (below) |
| `/api/v1/hgab/2027/datasets/{key}/projects/{id}` | One row, its parsed source `record`, plain labels for trace / match / reading / flags, `url`, and `pdf_url`s per version |
| `/api/v1/hgab/2027/datasets/{key}/regions` | The 18 regions plus the not-on-map amounts |
| `/api/v1/hgab/2027/documents` | Document registry with `pdf_url` |
| `/api/v1/hgab/2027/reconciliation` | The 69 checks against this portal's NEP data |
| `/api/v1/hgab/2027/districts` | District cards (below), plus the residual per year |
| `/api/v1/hgab/2027/districts/{id}` | One district: card, representative, and every serving office's full history |

Projects query parameters: `q` (every word must appear in `search_text`),
`group` (comma list of `house_only,nep_only,unchanged,increased,decreased,scope_review`),
`held` (`all` default | `hide` | `only`), `region` (a region key such as
`IV-A`, or a label as published), `program`, `pap`, `office`, `office_kind`,
`zone` (`local`|`fap`), `trace`, `reading_status`, `flag` (contained in
`flags`), `has_coordinates` (`1`), `sort` (`house` default | `nep` | `delta`
| `abs_delta` | `title`), `order` (`desc` default for amounts, `asc` for
title), `limit` (1–200, default 50), `offset`. Response `data`: `total`
(matched rows), `sums` `{ nep_php, hgab2_php, hgab3_php,
not_additive_across_versions: true }`, `rows` (no `record_json`; each with
`status_label`, `url`).

Districts query parameters: `region` (key), `q` (district, representative,
office), `attribution` (`A` | `B` | `mixed` | `none`), `sort` (`hgab3`
default | `gaa2026` | `change` | `name`), `limit` (1–254, default 50),
`offset`. Each card: label, region, attribution with its plain meaning,
representative (name, seat, status, portrait and its attribution and licence,
bills link), offices (id, name, tier, co-served districts), headline amounts
labelled as shared office totals when attribution is not `A`, and `url`.

## MCP tools

Added to `src/worker/mcp.ts`, each a thin wrapper over the REST functions:

| Tool | Input | Wraps |
| --- | --- | --- |
| `get_hgab_2027_overview` | — | `/api/v1/hgab/2027` |
| `get_hgab_2027_dataset` | `dataset` (enum dpwh, fmr, hfep, nia) | `/datasets/{key}` |
| `search_hgab_2027_projects` | `dataset` (required), `query`, `group`, `region`, `program`, `office`, `held`, `sort`, `order`, `limit` (≤ 50), `offset` (paging; the response carries `total` and `next_offset`) | `/datasets/{key}/projects` |
| `get_hgab_2027_project` | `dataset`, `id` | `/datasets/{key}/projects/{id}` |
| `list_hgab_2027_districts` | `region`, `query`, `attribution`, `sort`, `limit`, `offset` | `/districts` |
| `get_hgab_2027_district` | `id` | `/districts/{id}` |

The server `INSTRUCTIONS` gain a fifth dataset paragraph: what the House bill
and the NEP are, the four programs and their grain, that pairings are
candidates and versions are compared not added, that district figures carry
tiers and shared offices are not split, and that tools should cite the `url`
of a row.

## Loading

```bash
npm run build:hgab-d1                       # writes data/hgab/2027/d1-import.sql
npx wrangler d1 execute budget --local  --file=data/hgab/2027/d1-import.sql
npm run verify:hgab -- --d1=local           # D1 rows and totals equal the JSON
npx wrangler d1 execute budget --remote --file=data/hgab/2027/d1-import.sql   # production, after review
```
