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
  divided; the unassigned residual is always returned with district lists
  and district pages. Office-based views (the district routes, and DPWH
  project lists filtered with `office`) also carry the co-served districts
  and the source's uncertainty annotations (below), as the DEO mapping's
  restrictions require.
- Every response carries `meta` with `dataset: "hgab"`, `fiscal_year`,
  `currency: "PHP"`, `scale: "pesos"`, `source_commit`, `built_at` and a
  one-paragraph `notice` (the disclaimer), plus a top-level `disclaimers`
  array (see Disclaimers), and every row that has a page on
  the site carries `url` (canonical host `https://budget.bettergov.ph`).
  Document page references carry `pdf_url` with `#page=N` on
  `https://budget-assets.bettergov.ph/hgab/2027/pdf/<key>.pdf`.

## Disclaimers

Every response (and every MCP tool result, which is the same JSON) carries
`disclaimers` beside `meta` and `data`: an array of
`{ id, title, body, url }` taken verbatim from `src/lib/hgab-disclaimers.ts`,
the module the pages print them from, so the wording cannot drift. `url` is
the paragraph's anchor on the Methodology page. Which routes carry which:

| Routes | `disclaimers` |
| --- | --- |
| `/districts`, `/districts/{id}`, and `/datasets/dpwh/projects?office=…` (office-based views) | `disclaimer-offices`, `disclaimer-no-allegations` |
| Every other route | `disclaimer-no-allegations` |

The office paragraph also carries `restrictions_url` (our summary,
`https://budget.bettergov.ph/hgab/2027/methodology#deo-mapping-restrictions`)
and `upstream_restrictions_url` (the
[DEO mapping restrictions upstream](https://github.com/csiiiv/DPWH-NEP-HB-2027-ANALYSIS/blob/main/DEO2LEG/README.md#disclaimers)).
Both paragraphs, verbatim:

> **Office and legislative-district associations.** The DEO mapping associates offices with legislative districts; it does not establish that a representative requested, sponsored, or controlled a project, or that each project lies in every district associated with its office. Shared-office totals remain undivided and must not be split among the districts served. Office-based views must retain attribution tiers, co-served districts, unattributable residuals, and upstream uncertainty annotations. Historical or undated amounts retained as mapping evidence are separate from the FY2027 project ledger and must not be quoted as FY2027 allocations. See the DEO mapping restrictions.

> **No allegations.** An insertion, deletion, or amount-change candidate describes a provisional comparison between identified sources. That classification alone does not establish irregularity or wrongdoing by any office or official and should not be represented as such. Absence from an API snapshot likewise does not establish absence from the published NEP or concealment.

What the office paragraph's "must retain" means in the responses:

- **Attribution tiers.** Every card has `attribution` (A, B, mixed, none);
  every office has `tier` and `tier_text`; the `office_lens` of an
  office-filtered project list has the office's `tier`.
- **Co-served districts.** Card headlines carry `shared_office_total` and
  `co_served_district_ids`; each office lists its co-served districts; the
  `office_lens` lists every district the office is associated with.
- **Unattributable residuals.** `residual` (all nine year slots) comes with
  `/districts` and `/districts/{id}`; for the FY2027 House bill it includes
  `office_change_php` / `office_change_rows`, the paired lines held out of
  every office because their two versions name different office groups, and
  `no_office_php` / `no_office_rows`, the lines whose grouped records name no
  office. deo + central + regional + unmatched + no_office + office_change =
  total; `not_on_any_district_php` is everything but deo. Each bucket's fields
  are omitted on a deployment whose D1 predates it, never shown as 0.
- **Upstream uncertainty annotations.** Each office's `fy2027.annotations`
  (unconfirmed matches, different-stretch rows, second-to-third-reading
  markers), `unconfirmed_rows` / `unconfirmed_php` on each office bridge
  group and on the card's `fy2027_vs_proposal`, and `fy2027.office_change`
  / `fy2027.no_office` (the office's held-out lines, with links).

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
  office_change_rows INTEGER, office_change_nep_php INTEGER, office_change_hgab3_php INTEGER,
  notes_json TEXT NOT NULL, aliases_json TEXT NOT NULL
);

CREATE TABLE hgab_residual (
  fy INTEGER NOT NULL, stage TEXT NOT NULL, sort INTEGER NOT NULL,
  total_php INTEGER NOT NULL, deo_php INTEGER NOT NULL, central_office_php INTEGER NOT NULL,
  regional_offices_php INTEGER NOT NULL, unmatched_php INTEGER NOT NULL,
  unmatched_labels_json TEXT NOT NULL,
  office_change_php INTEGER NOT NULL, office_change_rows INTEGER NOT NULL,
  no_office_php INTEGER NOT NULL, no_office_rows INTEGER NOT NULL,
  PRIMARY KEY (fy, stage)
);
```

Expected row counts: datasets 4, documents 8, controls 46 + 16 + 12 + 6,
regions 72, projects and records 17,613 + 1,059 + 746 + 1,013 = 20,431,
reconciliation 69, districts 254, offices 200, residual 9.

Office change (DEO2LEG condition 3, see `docs/hgab-data.md` "Office change"):
`hgab_residual.office_change_php` / `office_change_rows` are the 2027 House bill
lines held out of every office because the NEP and the House bill name
different office groups; `no_office_php` / `no_office_rows` are the 3 lines the
source reads as naming no office, residual as upstream (both 0 on the GAA and
NEP slots; deo + central + regional + unmatched + no_office + office_change =
total). `hgab_offices.office_change_rows`,
`office_change_nep_php`, `office_change_hgab3_php` annotate the office those
lines name (null without a 2027 block); the amounts are not in the office's
figures, and a line naming two offices is on both.

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
| `/api/v1/hgab/2027/districts/{id}` | One district: card, representative, every serving office's full history with its annotations, and the residual per year |

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
`status_label`, `url`). Filtered with `office` on `dpwh`, `data` also has
`office_lens`: `printed_office`, the matched crosswalk `offices` (each with
`tier`, `tier_text`, every associated `districts` entry, and `office_change`
when it has held-out lines; empty for the Central Office and regional
offices, whose money is in the residual), `no_office` (lines printed under
this office whose grouped records name no office, when any),
`shared_office_total`, `tier_meaning`, `note` and `residual_api`. Lines in
`office_change` and `no_office` are among the list's rows and sums but in no
office's district-card figures.

Districts query parameters: `region` (key), `q` (district, representative,
office), `attribution` (`A` | `B` | `mixed` | `none`), `sort` (`hgab3`
default | `gaa2026` | `change` | `name`), `limit` (1–254, default 50),
`offset`. Each card: label, region, attribution with its plain meaning,
representative (name, seat, status, portrait and its attribution and licence,
bills link), offices (id, name, tier, co-served districts), headline amounts
labelled as shared office totals when attribution is not `A`,
`fy2027_vs_proposal` (with `unconfirmed_rows` / `unconfirmed_php`, the
unconfirmed matches inside it), and `url`. The list's `data` also has
`residual` (nine slots; the FY2027 House bill slot with `no_office_php` /
`no_office_rows` and `office_change_php` / `office_change_rows`, both counted
in `not_on_any_district_php`) and `residual_note`, which states the identity
for the buckets present.

`/districts/{id}` adds, per serving office: `years`, `by_congress`, and
`fy2027` with the bridge (each group with `unconfirmed_rows` /
`unconfirmed_php`), `annotations` `{ unconfirmed_rows, unconfirmed_php,
scope_review_rows, reading_markers: [{ code, label, rows }], note }` and,
when the office has any, `office_change` `{ rows, nep_php, hgab3_php,
lines: [{ id, url, api_url }], note }` and `no_office` `{ rows, hgab3_php,
lines, note }` (lines printed under the office whose grouped records name no
office; present only when the data has that bucket), whose amounts are in no
figure on the card. Annotations count the rows printed under the office
minus its office-change and no-office lines, so they match the office's
figures. No-office lines are found with the source lens's own rule
(`sideOffices` / `classifyRow`: a grouped side is read from its `records`
only) on the record of each repeated line. The page also returns `residual`
and `residual_note`.

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
of a row. It ends with both disclaimers verbatim
(`disclaimerText(OFFICE_VIEW_DISCLAIMERS)`) and the restrictions links, and
says every result carries `disclaimers`. The two district tools' descriptions
say plainly that results are office associations, that tiers must be kept,
shared totals must not be split, the residual must be reported, annotations
kept apart, and that nothing attributes a project or amount to a
representative.

## Loading

```bash
npm run build:hgab-d1                       # writes data/hgab/2027/d1-import.sql
npx wrangler d1 execute budget --local  --file=data/hgab/2027/d1-import.sql
npm run verify:hgab -- --d1=local           # D1 rows and totals equal the JSON
npx wrangler d1 execute budget --remote --file=data/hgab/2027/d1-import.sql   # production, after review
```
