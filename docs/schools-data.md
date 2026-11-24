# Schools directory data (`schools_*` in D1)

The basic-education facilities list behind the schools directory, the classroom-shortage map and the field reporting planned for EDCOM2 and DepEd. Source: the **Classroom Shortages & Projects Data Pack** (`school_shortage_allocation_join_extract.xlsx`, `field_dictionary.csv`, README). It was uploaded on 2026-11-23, and the originals are kept in `/data/schools-src/` on the dev VM.

```
npm run build:schools-d1 -- [extract.xlsx] [field_dictionary.csv]   # writes data/schools/d1-import.sql + scripts/schools/schema.sql
npx wrangler d1 execute budget --local  --file=data/schools/d1-import.sql
npx wrangler d1 execute budget --remote --yes --file=data/schools/d1-import.sql   # go-ahead + off-peak; ~10 s of D1 500s
```

The build (`scripts/schools/build_d1.py`, run through `scripts/schools/run.sh` with openpyxl in a uv venv) reads the workbook directly. It drops and recreates only the `schools_*` tables and the `schools_sbp_rollup_2026` view. **Field reports from the public will hold volunteers' work, so they must live in tables with another prefix that this build never touches.**

## Tables

| Table | Rows | One row per | Source (workbook prefix) |
|---|---:|---|---|
| `schools` | 60,204 | school in the registry (`School_ID_Normalized`, unique) | `school_types_consolidated` (`REGISTRY_*`) + the four join statuses |
| `schools_shortage_2023` | 47,362 | school with an ID-matched shortage row | shortages 2023 (`SHORT_2023_*`) |
| `schools_coordinates_2022` | 47,828 | school with matched coordinates | school_coordinates 2022 (`COORD_2022_*`), LIS before NSBI |
| `schools_facilities_2023` | 59,101 | school with a matched facilities row | facilities 2023 (`FAC_2023_*`) |
| `schools_enrollment_2023` | 47,449 | school with a matched enrolment row | enrollment_ratios_2023 (`ENR_2023_*`) |
| `schools_sbp_projects_2026` | 5,652 | School Building Program project record | sbp_masterlist (Project Records sheet) |
| `schools_sbp_candidates` | 1,247 | review-only candidate school of an unlinked project | `Candidate_School_IDs_For_Review`, split |
| `schools_join_review` | 52,641 | unmatched or ambiguous join | Join Review sheet |
| `schools_fields` | 231 | field in the data dictionary (+9 derived) | `field_dictionary.csv`, plus `d1_table`/`d1_column` |
| `schools_meta` | 6 | key | source SHA-256s, build time, row counts, cleaning counts |
| view `schools_sbp_rollup_2026` | 5,144 | school with ID-linked projects | recomputes the workbook's `SBP_2026_*` roll-ups |

The workbook's 189-column sheet is split into one table per source. A school without a safe ID match simply has no row in that source's table, so **"blank is not zero" holds by construction**: a missing row means no source data, and an explicit `0` is a reported zero. Join to `schools` on `school_id`. `schools_fields` says where every original column now lives (`SELECT * FROM schools_fields WHERE field_name = 'SHORT_2023_Total_Shortage'`).

## What the build normalises (and asserts)

- `''` becomes NULL. IDs are text. TRUE/FALSE become 1/0. Text is trimmed and its inner whitespace collapsed (`'ES and JHS \n(K to 10)'` → `'ES and JHS (K to 10)'`, `'Non-Sectarian '` → `'Non-Sectarian'`).
- Placeholders (`nan`, `#N/A`, `-`, `N/A`, `None`) become NULL **only** in ID, address and school-head fields. Each replacement is counted in `schools_meta.checks` (for example, 58,776 `nan` mother-school IDs). Other text is kept as written; `tls_mr_dependent` keeps `'N/A'` (11,907 rows), which is not the same as `'No'`.
- Enrolment ratios: a non-number (`'No instr. CR'`, 866 rows) goes to `ratio_*_note`, and the ratio itself is NULL.
- Shortage values are REAL as given; many are fractional (`7.999999999999999`). Round them for display only.
- Derived columns: `schools.region_key` (the same keys as `hgab_*`: `XIII` for CARAGA, NULL for PSO schools abroad), `schools.registry_row`, `schools_coordinates_2022.in_ph_bbox` (7 points fall outside the Philippines), and `schools_sbp_projects_2026.school_in_registry`, `scope_storeys` and `scope_classrooms` (parsed from codes like `2STY4CL`; they agree with `classrooms` on every parsable row).
- Asserted on every run: School IDs are unique and equal `REGISTRY_School ID`; a source has values exactly when its join status is `Matched`; the row counts match the workbook's Read Me; a numeric budget appears exactly when the source budget is numeric; and the view reproduces every school's `SBP_2026_*` roll-up (within ₱0.01).

## Caveats to carry into any page

- **151 ID-linked projects point to a School ID that is not in the registry** (it is in the shortage list only), so they roll up to no school (`school_in_registry = 0`).
- 1,274 PSIP III projects are "N/A (For Bidding)": they have no amount and an expected start of Mar 2027. Their 16,305 classrooms are planned, not funded amounts.
- The numeric 2026 budgets total ₱55.47B. Under the README's rules, project classrooms and budgets are not outcomes: they are not delivered classrooms, awards or disbursements.
- 54 candidate lists are cut short in the source ("… (+N more)"). Those extra IDs are not in the workbook.
- Shortages are from 2023, coordinates from 2022, and facilities and enrolment from 2023. Nothing is field-confirmed: confirming it is the job of the public reporting layer.
- `school_head_name` is a person's name from the registry. It is in D1 but should stay out of public API responses unless the maintainer decides otherwise.

## Pages, API and field reports (preview, 2026-11-24)

Pages (`src/pages/Schools*.tsx`, `School.tsx`; `src/lib/schools.ts`; not in the nav, `noindex`):

| Page | What |
|---|---|
| `/schools` | MapLibre map of every school with usable 2022 coordinates (47,236), coloured by its 2023 shortage, ringed blue when the 2026 SBP lists classrooms; search; a card per school |
| `/schools/list` | the registry, 50 a page; search, region, sector (public by default), shortage, "in the 2026 list", five sorts; filters in the address |
| `/schools/shortage` | the 2023 shortage against the 2026 list by region (bars) and by schools division (map discs + table) |
| `/schools/:id` | everything about one school (no school-head name), its projects, how it was matched, and the field report form |
| `/schools/about` | sources, joins and caveats, in plain words |

API (`src/worker/schools-api.ts`, internal like the reviews API): `GET /api/schools/points` (cached 1 h), `/areas?level=region|division[&region=]` (cached 1 h), `/list`, `/school/:id`, `/reports/mine?school=`, `POST /reports`, `DELETE /reports/:report_id`.

Coverage is measured **school by school**: `covered` = the part of each school's own shortage that its listed classrooms would fill, and `gap` = what is left. Classrooms listed at schools DepEd counted as not short are `listed_not_short`. Totals on 2026-11-24: 164,763 classrooms short; 31,210 listed at registry schools (15,344 with ₱52.92B, 15,866 for bidding); 16,952 of them (10%) cover a school's own shortage; 7,070 are at schools counted as not short; 147,811 remain short.

**Field reports** (`school_reports` + `school_report_revisions`, `scripts/schools/reports-schema.sql`): sign-in is the project reviewer's Clerk accounts (`login`/`memberFor`), so a volunteer has one account. One report per member per school, editable. Every save is an append-only revision, and withdrawing keeps the report. Triggers refuse deletes. The questions (`SchoolReport`, checked by `readSchoolReport`) are kept to what DepEd and EDCOM2 can act on: (1) is the school here and open (`open`, `wrong_place`, `closed`, `not_found`); (2) does it lack classrooms (`confirmed`, `none`, `unsure`; skipped for a closed or missing school); (3) if so, about how many more (1–200, shown next to DepEd's 2023 count); (4) if so, what shows it (any of shifts, makeshift rooms, shared rooms, unsafe rooms); (5) what they saw of each 2026 project at the school; (6) how they know the school (staff, learner or parent, official, nearby or visited). A note and up to 3 photo links are optional. Pages show only counts. The schema is applied **locally only**; production needs a go-ahead (`npx wrangler d1 execute budget --remote --file=scripts/schools/reports-schema.sql`).

## Project history: DPWH contracts linked to schools (2026-11-24)

`npm run build:schools-dpwh` (`scripts/schools/build_dpwh_links.py`, after `build:schools-d1`, which writes `data/schools/registry-names.csv`) links the 33,275 school-related DPWH contracts in `data/dpwh-contracts/contracts.parquet` (infra years 2016–2026) to registry schools. It writes `data/schools/dpwh-import.sql`, which holds three tables: `schools_dpwh_contracts` (30,462 contracts with at least one link), `schools_dpwh_links` (33,463 contract × school links, each with `match`, `confident` and `distance_m`) and `schools_dpwh_meta`.

DPWH rarely writes the School ID (1,616 links), so most links come from the school's full registry name in the description, within the province of the contract's district engineering office (26,557). Each link is labelled with how it was made. `confident` = 1 for `school_id`, `school_id_name_differs` and `name`; pages list the rest (`name_annex`, `several`, `near_name`, `near`) apart, as possible matches. Results: 26,802 contracts (80.5%) are confidently linked, to 16,985 schools; 3,660 have only possible links; 2,813 are unplaced. A 25-link sample of `name` links had 24 right (the doubtful one was an older school name). Contracts that quote a School ID under another school's name (121) are themselves feedback for DepEd.

The school page shows these contracts as "Project history" (confident ones in a table, possible ones folded away), and the report form's question 5 asks about the 2026 projects and the 5 newest confident DPWH contracts (`projects["dpwh:<contract id>"]`).

Load: `npx wrangler d1 execute budget --local --file=data/schools/dpwh-import.sql`. **Production: loaded 2026-11-24** (maintainer's go-ahead) one statement at a time through the D1 query API rather than a file import, so D1 never went down. The 32 descriptions holding `\r\n` were then rewritten from the local copy, and production matches local on counts, budgets, text lengths and distances.

## Overview: the shortage, the budget and the indicators (`/schools/overview`, 2026-11-24)

`GET /api/schools/analysis` (cached 1 h; pages add `?v=SCHOOLS_API_VERSION`, bumped whenever a cached answer changes shape) returns, by registry province: the need (shortage, learners, classrooms, makeshift rooms), the 2026 list (funded, for bidding, covered school by school, at schools not short) and DPWH's confidently linked school contracts for 2016–2026 (a contract for n schools counts 1/n toward each). It also gives DPWH school contracts by year × kind and by funding × kind, the 2026 list by modality, and DepEd's "Basic Education Facilities" line in the GAA (fpaps `07-001-310200100006000`, stored in thousands).

- **The 2027 figures for that line are constants** in `src/lib/schools.ts` (`BEFF_2027`): NEP ₱30,551,016,000 (`data/2027/07/fpaps.json`, NEP Vol. I p. 389, PDF p. 413) and House bill ₱27,453,016,000 (HB 10858 3rd reading Vol. IA p. 302, PDF p. 312, `hgab/2027/explorer/d/department-of-education.json`). Each is a single line.
- **Kind of work** comes from the contract description (`DPWH_KIND` in the Worker): repair/rehab/improvement first, then multi-purpose/MPB/covered court/gym/sports, then buildings, else other. **Whose budget** comes from DPWH's `source_of_funds`: "DepEd BEFF" means DepEd's line carried out by DPWH (₱228B of ₱268B); anything else is DPWH's own (₱40B, 57% of it multi-purpose buildings and covered courts). The GAA line and the "DepEd BEFF" contracts are the same budget seen from two sides, so they must not be added together.
- **Indicators:** the page joins the provinces to PSA's 87 areas (`areaOfProvince`; Cotabato City goes with Maguindanao) and reads poverty 2023 and under-15 share 2024 from `indicators/indicators.json`. It reports Spearman rank correlations across areas: on 2026-11-24, poverty vs shortage per 1,000 learners ρ = 0.21, poverty vs 2026 coverage ρ = −0.34, and poverty vs DPWH school budget per learner ρ = −0.29.
- **Cost of the whole shortage** is an estimate: the shortage × the 2026 list's average cost of a classroom with a budget (₱3.44M), about ₱567B.

## Sources (2026-11-24)

Every schools page ends with a source line, and the About page lists them in full (`OFFICIAL_SOURCES` and `DATA_SOURCES` in `src/lib/schools.ts`). The official sources the maintainer named are EDCOM 2's classroom supply and demand dashboard (Tableau Public, by Rafaela Manasan, last published 2026-11-13, from Tableau's public workbook information), DepEd's machine-ready files and DepEd's Paaralang Bukas dashboard. deped.gov.ph refused automated requests (403) and the Tableau views only render in a browser, so **their contents were not checked against our figures**. The source notes therefore say only what was verified.
