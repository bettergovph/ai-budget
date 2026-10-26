# HGAB data pipeline (FY2027 House General Appropriations Bill)

How `data/hgab/2027/` is produced, what is in it, and how to refresh it. The
UI contract is `src/lib/hgab.ts`; the review that fixed the reconciliation
checks is `docs/dpwh-nep-hb-2027-review.md`; the section plan is
`docs/hgab-plan.md`.

## Rules

- Nothing is re-derived. Matching, pairing, statuses and amounts are carried
  verbatim from the workbench's own builders and committed ledgers
  (BetterGov `DPWH-NEP-HB-2027-ANALYSIS`, pinned at `a0caa778442c`).
- Integer pesos everywhere. `null` means "no record at this stage", never 0.
- Stage totals are compared, never summed across stages.
- The five-group bridge of every dataset is asserted equal to the workbench's
  `analysis/data/main_overview_2027.json`, and the identity
  `house_only − nep_only + increased − decreased + scope_review = House − NEP`
  must hold.
- Our FY2027 NEP tree (`data/2027/`, from the DBM CSV) is reconciled to the
  workbench's PDF extraction on every import; any `mismatch` fails the
  verifier and nothing uploads.

## Reader-facing vs technical copy

Wording follows `docs/hgab-copy.md` ("NEP", "as published"). Of the document
`volume` strings only the NEP farm-to-market roads one was reworded; nothing
matches on NEP volumes, and House volumes are untouched.

Every dataset meta (`HgabDatasetMeta`) carries two registers of text, and the
UI must not mix them:

- **Reader-facing** — `summary` (one sentence, at most 30 words), `one_row`
  and `caveats[]`. This is what heroes, cards, KPIs and the hub's small print
  show. Plain words anyone can follow: no 15-digit UACS codes, no page or
  volume references, none of the pipeline's own vocabulary. The verifier fails
  the build if any of the three contains a 15-digit code or one of these
  words (whole words, case-insensitive): `PDF`, `annex`, `ledger`, `control`,
  `bridge`, `MOOE`, `NEP Volume`, `I-B`, `I-C`, `II-A`, `II-B`, `OCR`. Two
  plain-English uses are allowed because DPWH literally builds them: "flood
  control" and the plural "bridges". The banned senses are the singular
  "bridge" (the five-group bridge) and "control(s)" (published controls).
  Before the per-dataset checks, a self-test runs the filter on the wording
  Jason rejected (the old HFEP `grain` and `scope`) and fails unless every
  banned item is caught and "Roads, bridges and flood control projects."
  passes, so a broken pattern cannot pass silently.
- **Technical** — `grain` and `scope`, which keep the codes, pages, ledgers
  and reading notes. They belong on the Methodology page and behind a Details
  disclosure, never on a hero, card or KPI. `scope` must still state
  everything the caveats summarise (the verifier's HFEP check reads the
  ₱14,472,659,000 / ₱140,000 figures from it).

The same split applies to the other strings the importer and the districts
builder emit for readers:

- Document `title` and `notes`: plain names, with the volume and the reading
  kept ("House Bill 10858, Volume I-C: DPWH project list and program totals,
  second reading"). `volume` and `reading` are never reworded — the Sources
  and Documents tables show them, and `src/lib/hgab-citations.ts` falls back
  on `reading` when a dataset has no `documents.controls`.
- Reconciliation `check` and `note` (the Methodology table): one plain
  sentence each, numbers exact, fund and program codes in parentheses at the
  end. "Our data" is this portal's FY2027 NEP import (the DBM CSV, `ours_php`);
  "the source" is the workbench's extraction from the printed documents
  (`theirs_php`). "Program total:" rows are the six operations programs
  (PREXC prefixes); "Program line:" rows are the 45 printed PAP controls
  (`PLAIN_TERMS.pap`). The verifier's pickers follow the wording (`DPWH total`,
  `DPWH capital outlays`, `Program total:`, `Program line:`,
  `Farm-to-market roads`, `Health facilities: …`, `Irrigation program:`).
- `controls_label`: "Program totals" (DPWH), "Regions", "Categories",
  "Sub-programs". HFEP control `group` headers read "Funding columns, as
  published" and "Categories, as published".
- Printed labels (`ControlRow.label`: PAP names, region names, category rows,
  funding columns) stay verbatim; only internal ids would be reworded, and
  none are emitted as labels. The one composed label is an HFEP category
  printed differently in the two documents: "<House label> (NEP:
  <NEP label>)", both halves verbatim.
- Districts `scope_notes` and `OfficeHistory.notes`: plain sentences of at
  most 25 words each (the verifier enforces it). Their technical versions are
  recorded under "Scope notes (technical record)" below.

## Scripts

| Command | Script | Does |
| --- | --- | --- |
| `npm run import:hgab` | `scripts/import-hgab.ts` | Reads the workbench payloads, writes `data/hgab/2027/`. Flags: `--src=<clone>` (default `/tmp/dpwh-nep-review/repo`), `--out=data/hgab/2027`, `--nep=data/2027`, `--dataset=dpwh[,fmr,…]`, `--no-pdf` |
| `npm run verify:hgab` | `scripts/verify-hgab.ts` | Re-reads the tree and asserts totals, bridges, readings, parquet shape, document keys, reconciliation and the reader-facing copy rules above. Flags: `--out`, `--src` (for the main_overview comparison), `--no-pdf`, `--hash-pdfs`, `--d1=local` (also check the local D1, see "D1 layer"). Exit 1 on failure |
| `npm run upload:hgab` | `scripts/upload-hgab-to-r2.ts` | Runs the verifier, then PUTs everything under the tree except `d1-import*.sql` to R2 `budget` at prefix `hgab/2027/` (size + ETag/MD5 skip). Flags: `--dry-run`, `--force`, `--skip-verify`, `--concurrency=N` |
| `npm run build:hgab-d1` | `scripts/build-hgab-d1.ts` | Writes `d1-import.sql`, the `hgab_*` D1 tables for the public API and MCP server (see "D1 layer"). Flags: `--out`, `--file`, `--split-mb=N` |

Type-check and lint:

```sh
npx eslint scripts/import-hgab.ts scripts/verify-hgab.ts scripts/upload-hgab-to-r2.ts scripts/build-hgab-districts.ts scripts/build-hgab-d1.ts scripts/build-hgab-leaderboard.ts
npx tsc --noEmit --ignoreConfig --strict --target es2023 --module esnext --moduleResolution bundler \
  --types node --skipLibCheck --verbatimModuleSyntax --noUnusedLocals --noUnusedParameters --erasableSyntaxOnly \
  scripts/import-hgab.ts scripts/verify-hgab.ts scripts/upload-hgab-to-r2.ts scripts/build-hgab-districts.ts scripts/build-hgab-d1.ts scripts/build-hgab-leaderboard.ts
```

## Layout

```
data/hgab/2027/
  manifest.json              what ran, when, from which commit; input sha256s; per-dataset totals; PDF list
  overview.json              HgabOverview: datasets[] (meta + bridge), documents[] (registry), reconciliation[],
                             candidate_changes (main_overview_2027.json's candidate-change table, carried and checked)
  <dataset>/summary.json     HgabDatasetSummary: controls, dims, top (25 per bridge group), readings (DPWH)
  <dataset>/projects.parquet one row per comparison record, PROJECT_COLUMNS in order, ZSTD
  pdf/<doc_key>.pdf          the eight source documents the evidence links open
```

`data/` is a symlink to the main checkout's data dir, so the dev server
serves the tree at `/data/hgab/2027/...`. In production the same paths live
on R2 under `hgab/2027/` and resolve through `VITE_DATA_BASE_URL`.

Parquet column types: peso columns (`nep_php`, `hgab2_php`, `hgab3_php`,
`api_php`, `delta_php`) are `BIGINT` (DuckDB-Wasm returns `BigInt`, as for
`line_items.parquet`); `nep_page`, `hgab2_page`, `hgab3_page`, `length_m`,
`suggestions` are `INTEGER`; `confidence` is `DOUBLE`; everything else is
`VARCHAR`. `flags` is comma-separated and `''` when empty. `record_json` is
the full source row as a JSON string.

## Sources and the workbench builders

The browser payloads are not committed in the workbench; they are regenerated
by its builders. From the clone root (Node 22, Python 3.12, stdlib only):

```sh
npm ci --prefix analysis/web
node analysis/web/buildComparisonData.mjs        # → analysis/data/comparison_{overview,projects}_2027.json
python3 other-analysis/build_hfep_workbench.py   # → other-analysis/data/hfep_workbench.json
python3 analysis-nia/build_nia_workbench.py      # → analysis-nia/data/nia_workbench.json
python3 other-analysis/build_fmr_workbench.py    # → other-analysis/data/fmr_workbench.json  (see FMR note)
node analysis/web/buildMainOverview.mjs          # → analysis/data/main_overview_2027.json
```

What ran for the current tree (recorded in `manifest.json → builders`):

| Step | Status | Note |
| --- | --- | --- |
| `npm ci --prefix analysis/web` | ok | |
| `buildComparisonData.mjs` | ok | 17,613 unified DPWH rows (stage trace + HGAB2↔HGAB3 reading join) |
| `build_fmr_final_dataset.py` | failed | Needs the `philippines-psgc-shapefiles` content inside the `dpwh_coor2psgc_geomapping` submodule plus shapely/pyshp; neither is on the build host. It only feeds the PSGC enrichment |
| `build_fmr_workbench.py` | shim | `build_fmr_workbench.py` refuses to run without the final datasets. The shim `/tmp/dpwh-nep-review/shim/build_fmr_workbench_nopsgc.py` imports that module and calls its own `load_stage()` and `match_projects()` unchanged, skipping only the PSGC block. `match_projects()` never reads PSGC fields, so the comparison is identical by construction; the workbench file carries a `build_note` saying so and `psgc_validation.unavailable: true` |
| `build_hfep_workbench.py` | ok | 513 / 464 facilities |
| `build_nia_workbench.py` | ok | corrected method 606 paired · 222 House-only · 185 NEP-only (strict 509 / 319 / 282 kept as `strict:` flags) |
| `buildMainOverview.mjs` | ok | Four validated workspaces; every bridge here equals it |

Per dataset, what each column is carried from:

- **DPWH** — `comparison_projects_2027.json` rows (hydrated, after
  `regionCandidates()`, which produces no region-difference pairs at this
  commit). `trace`, `house_match`, `reading_status`, `api_presence`,
  `confidence` verbatim; amounts from each side; pages from each side's
  `pdf_page`; `office` from the latest House side else NEP, `office_kind` via
  `headlineStats.officeKind()`; `length_m` summed over chainage spans without a
  length review. Bridge: `overviewSummary.partition()` with the third reading
  as the House stage. Controls: `comparison_overview_2027.json → paps` (46,
  including FAP; `source_comparison` joined to `house_reading_changes` by the
  workbench itself). Dims: `headlineStats.sourceCompare` (region, program,
  PAP) and `headlineStats.sources[*].offices` (office kind). Readings:
  `readingSummary` plus the five `third_only` rows and the two changed PAP
  controls.
- **FMR** — `fmr_workbench.json → comparison` joined to `stages.*.projects`.
  Paired equal → `amount_same`, House > NEP → `candidate_increase`, House <
  NEP → `candidate_decrease`, House-only → `house_only_candidate`, NEP-only →
  `nep_only_candidate`. `house_match` = pairing method
  (`title_and_coordinates` / `title` / `coordinates`). Controls and the region
  dim come from the workbench's `regions` join. House rows cite
  `hb10858-2r-vol-ib` pages 667–726.
- **HFEP** — funding-column record grain, exactly as
  `overviewSummary.hfepSummary()` and `hfepModel.lineItemRecords()`: one row
  per printed Infrastructure / Medical equipment / Motor vehicle cell.
  `same` → `amount_same`; `revised` → increase/decrease by sign; a cell printed
  on one side of a paired facility (`added` / `dropped`) is booked by the
  workbench as a 0-base adjustment, so those 36 rows carry one null stage
  amount, a non-null `delta_php`, and the flag `column_added` /
  `column_dropped`; unmatched facilities' cells are House-/NEP-only.
  `confidence` = title similarity. Controls: the four printed funding-column
  annex controls and the printed category rows joined by their printed number.
  Totals, the bridge and the parquet sums are all on the facility ledgers
  (NEP ₱14,472,519,000, House ₱10,021,659,000) so the bridge identity holds on
  the compared population; the printed NEP annex control (₱14,472,659,000) is
  kept in the controls table (the "Total" row under "Funding columns, as published"), the scope sentence and
  an explained reconciliation row — the ₱140,000 gap is the documented Metro
  Manila medical-equipment printing defect (the workbench's
  `metro_manila_med_overhang_140000`; the reader-facing note calls it an
  error in the published list for a Metro Manila medical-equipment line).
  `printed` carries the HFEP activity rows (CO + MOOE) from the agency tables.
  NEP rows cite `nep2027-hfep` (the 13-page Volume II-A excerpt; page k =
  Volume II-A PDF page 726 + k).
- **NIA** — `nia_workbench.json → comparison` (the `ai_corrected` method the
  main overview uses) joined to `stages.*.projects`. Flags carry the
  workbench's marks without creating pairs: `strict:split_pair`,
  `near_miss:<variant_mark_kind>`, `unresolved`, `ambiguous_title`. Controls
  and the program dim are `subprogram_controls`.

Annex House amounts are the second-reading Volume I-B extraction; the
workbench verified the annex pages text-identical to the third-reading
printing (FMR 60, HFEP 17, NIA 46 pages), so `hgab3_php = hgab2_php`. The
parquet cites the copy read, `hb10858-2r-vol-ib` (`hgab3_doc`/`hgab3_page` are
null); the dataset records the identical third-reading copy in
`documents.same_pages = { extracted: hb10858-2r-vol-ib, third:
hb10858-3r-vol-ib, pages }`, and the pages, the API (`pdf_url.hgab3`) and the
MCP tools link rows and totals to the third-reading copy (the one published
on the Senate Budget Transparency Portal) at the same page, through
`houseCitations()` / `controlCitations()` in `src/lib/hgab-citations.ts`.
`documents.house` lists `hb10858-3r-vol-ib` first.

## Document registry

| Key | File in the clone | Pages used |
| --- | --- | --- |
| `hb10858-2r-vol-ib` | `HB_BUDGET/2 - HB 10858 VOL IB.pdf` | FMR 667–726, HFEP 877–893, NIA 896–941 (lists and their totals; the copy read) |
| `hb10858-2r-vol-ic` | `HB_BUDGET/3 - HB 10858 VOL IC.pdf` | DPWH project rows and PAP controls, second reading |
| `hb10858-3r-vol-ib` | `HB_BUDGET_3rd_reading/2- HB 10858 FOR 3RD READING VOL I-B.pdf` | FMR, HFEP, NIA at the same pages (the copy rows and totals link to) |
| `hb10858-3r-vol-ic` | `HB_BUDGET_3rd_reading/3- HB 10858 FOR 3RD READING VOL I-C .pdf` | DPWH project rows and PAP controls, third reading |
| `nep2027-vol-iib` | `dbm-nep-data/NEP-2027-VOLUME-2B_OCR.pdf` | DPWH NEP rows and PAP controls (one-based pages of the OCR copy) |
| `nep2027-fmr` | `dbm-other-nep-line-data/FMR.pdf` | 1–47 |
| `nep2027-nia` | `dbm-other-nep-line-data/NIA.pdf` | 1–30 |
| `nep2027-hfep` | `dbm-other-nep-line-data/HFEP_2.pdf` | 1–13 (Volume II-A pages 727–739) |

All pages are one-based PDF file pages. `ControlRow.house_pages` are pages of
the document `documents.controls` names per reading: Volume I-C for DPWH
(`hgab2: hb10858-2r-vol-ic`, `hgab3: hb10858-3r-vol-ic`; the PAP totals sit
with the project list, on the same page in both readings, which the importer
asserts), Volume I-B for the annexes (`hgab2: hb10858-2r-vol-ib`, `hgab3:
hb10858-3r-vol-ib`). `nep_page` cites the dataset's NEP document. Volume I-B
stays on DPWH's list for the department's published new appropriations
(`printed`), which no row or total links to.

The two third-reading volumes are the copies published on the Senate Budget
Transparency Portal (General Appropriations Bill, 2027): the importer stops
unless they hash to the SHA-256s pinned in `SENATE_COPIES`
(`src/lib/hgab-citations.ts`), records the portal as their `source_url`, and
says so in their notes. The verifier pins the same hashes and, when
`pdftotext` is installed, finds every House amount on the page the site
links.

## Reconciliation (our DBM CSV tree vs their PDF extraction)

Computed on every import into `overview.json → reconciliation`; 69 rows,
0 mismatches at the current build.

| Dataset | Check | Ours | Theirs | Status |
| --- | --- | ---: | ---: | --- |
| DPWH | Department total minus funds 10401102 (RLIP) and 10403389 (NBCDF) | 642,612,015,000 | 642,612,015,000 | exact |
| DPWH | Capital outlays | 603,003,972,000 | 603,003,972,000 | exact |
| DPWH | Personnel services | 16,235,385,000 | 14,922,297,000 | explained (RLIP 1,313,088,000) |
| DPWH | MOOE | 24,713,919,000 | 24,685,746,000 | explained (NBCDF 28,173,000) |
| DPWH | Asset Preservation (3101), Network Development (3102), Bridge (3103), Flood Management (3201+3202), Convergence (3002), Local (3001) | — | — | 6 × exact |
| DPWH | GAS / STO | 19,314,966,000 / 51,714,236,000 | 18,078,293,000 / 51,609,648,000 | explained (together 1,341,261,000 = automatic appropriations) |
| DPWH | 45 printed PAP controls vs our program groups | — | — | 25 exact · 7 explained by the FAP component folded into the same PREXC code · 5 label differences matched by amount · 8 regroupings (Water supply ×3, PWD/elderly/gender ×3, disaster-related, PPP) whose group sums agree (9,808,600,000) |
| FMR | DA activity 310203206315000 | 16,000,000,000 | 16,000,000,000 | exact |
| HFEP | DOH activity 350202100002000, capital outlays vs printed annex total | 14,472,659,000 | 14,472,659,000 | exact |
| HFEP | Same activity, MOOE (outside the annex) | 67,173,000 | 67,173,000 | explained |
| HFEP | DOH capital outlays vs the annex facility ledger (the compared population) | 14,472,659,000 | 14,472,519,000 | explained (our CO equals the printed control; ₱140,000 printed defect) |
| NIA | Six sub-programs under agency 35-005 (310101, 310102, 310106, 310202, 310204, 310205) and their total | — | — | 7 × exact |

## Refresh procedure

1. Update the clone to the commit you want to pin (`git -C <clone> checkout <sha>`),
   `npm ci --prefix analysis/web`, run the builders above. If
   `build_fmr_final_dataset.py` still cannot run, use the shim.
2. `npm run import:hgab -- --src=<clone>` (add `--no-pdf` while iterating).
3. `npm run verify:hgab -- --src=<clone> --hash-pdfs`. Fix any ✗ before going on;
   if the workbench changed a figure the review pinned, update `EXPECTED` in both
   scripts deliberately and say so in the commit.
4. `npm run upload:hgab -- --dry-run`, then `npm run upload:hgab`. The uploader
   runs the verifier first and stops on failure.
5. Record the new commit in the report/PR; `manifest.json → source_commit` is the
   pin the UI shows.

## Districts index (the DEO lens)

`data/hgab/2027/districts.json` (`HgabDistrictIndex` in `src/lib/hgab.ts`) is
one card per legislative district: the DPWH district engineering office(s)
the DEO2LEG crosswalk links to it, each office's budget history by fiscal year
and by Congress, the FY2027 House bill against the NEP for the office's rows,
and the seat's representative from bills.juris.ph. It follows the one use the
crosswalk authorises ("The one authorized project-level use: the DEO lens",
`DEO2LEG/README.md`): money is grouped by the office the documents print, a
shared office's total is never divided, and the Central Office / regional /
unmatched residual is published for every year and stage.

| Command | Script | Does |
| --- | --- | --- |
| `npm run build:hgab-districts` | `scripts/build-hgab-districts.ts` | Writes `districts.json`, `districts-manifest.json` (inputs with sha256, coverage, aliases) and caches `juris-authors.json`. Flags: `--src=<clone>`, `--out=data/hgab/2027`, `--gaa=data/18`, `--nep=data/2027/18`, `--contract=src/lib/hgab.ts`, `--offline` (reuse the cached juris response) |
| `npm run verify:hgab` | `scripts/verify-hgab.ts` | The "districts.json (DEO lens)" section: 43 checks listed below. `--gaa=data/18` for the GAA yearly totals |

### Inputs

| Input | Used for |
| --- | --- |
| `DEO2LEG/outputs/deo_leg_crosswalk.json` (+ `MANIFEST.json`), schema 2.1.0, built 2026-10-23, at `a0caa778` | 213 offices (211 DEOs, 1 sub-DEO, 1 `regional_group` BARMM), 254 districts, 264 relationships; office names and aliases; `legacy` blocks; representatives with congress.gov.ph member codes. Structure only: its scanned allocation amounts (`source_amounts.json`) are never read |
| `data/18/operating_units.json`, `data/18/yearly_totals.json` | FY2020–2026 enacted GAA by operating unit (`description`), thousands of pesos ×1000; rows with `description == 'nan'` skipped (they carry no money). Whole department, all funds, all expense classes |
| `data/2027/18/operating_units.json`, `data/2027/18/summary.json` | FY2027 NEP by operating unit on the same whole-department basis, total ₱643,953,276,000 |
| `data/hgab/2027/dpwh/projects.parquet`, `overview.json` | FY2027 House bill 3R vs NEP per printed `office`: sums, member counts, and a five-group bridge using the `TRACE_LABELS` trace→group map read from the contract (identity asserted per office). Operations population: NEP ₱572,924,074,000, HGAB 3R ₱587,075,661,000 |
| `https://bills.juris.ph/api/authors` (20th Congress, 345 authors, 321 House) | Representatives and portraits, joined on `officialMemberId` = crosswalk `representative.profile.memberCode`. Cached with `fetched_at` in `juris-authors.json` |

### Shape notes

- `offices{}` holds the 200 crosswalk offices linked to at least one district
  (167 Tier A, 33 Tier B; BARMM is `kind: regional_group`, Tier B, with no
  ledger). `years` is always nine entries in order: FY2020–2026 `gaa`, FY2027
  `nep`, FY2027 `hgab3`; `php` is null when no operating unit matched or the
  matched unit carried a zero appropriation (never 0); `matched_label` is the
  source label actually joined, two labels joined with ` + ` when a year prints
  two spellings of one unit. `by_congress` sums only the GAA years present.
  `fy2027` is the parquet block (199 of 200 offices; BARMM has none).
- **Two FY2027 NEP figures per office.** The `nep` slot is the DBM operating-unit
  listing (whole department); `fy2027.nep_php` is the HGAB operations
  population. They differ for the same office and are never added or compared
  as like for like; `scope_notes` say so.
- Cards: `office_ids` are the crosswalk's (may include `office:barmm`);
  `attribution` is computed over offices that are not regional groups and have
  a ledger (A / B / mixed; `none` for the 5 BARMM-only districts, whose
  headlines are null). `headline` sums the serving offices' undivided values.
  `co_served_district_ids` = other districts sharing an engineering office
  (regional-group links excluded). Labels are `"<Jurisdiction>, <Nth|Lone>
  District"` with the crosswalk jurisdiction title-cased.
- 67 paired FY2027 lines name offices of different groups on the two sides
  (or a district office on one side and none on the other). They are held out
  of every office and of Central/regional: see "Office change" below.

### Office-name join and aliases

Labels join the crosswalk by a normalised key only (after the workbench's
`officeJoinKey`): NFKD accents off, `DEO` / `Sub-DEO` / `Sub DEO` expanded to
"(sub) district engineering office", hyphens to spaces, ordinal words
First…Seventh to numerals, trailing ` - Proper` dropped, the `Las Pi±as`
mojibake repaired, spaces collapsed, lower-cased. A key resolving to more than
one office is not a join. `Central Office` is `/^central office$/i`; regional
offices are `/regional office/i`. Every variant that needed more than the plain
DEO expansion is recorded on the office's `aliases_used` with the steps it
needed, and in `districts-manifest.json → normalised_joins`.

Normalised joins (formatting only): `Las Piñas-Muntinlupa` / `Las Pi±as-Muntinlupa`
(GAA) / `Las Piñas Muntinlupa` (HGAB) → `office:las-pinas-muntinlupa-deo`;
`Malabon Navotas` (HGAB) → `office:malabon-navotas-deo`; `Mountain Province
First DEO` → `office:mountain-province-1st-deo`; `Cavite Third DEO` →
`office:cavite-3rd-deo`. (`Camarines Norte Sub District Engineering Office` is
the plain expansion of `Camarines Norte Sub-DEO` and needs no step.)

Explicit aliases (declared in `ALIASES` in the builder, one line each to revert):

| Source label | Office | Basis | Status |
| --- | --- | --- | --- |
| `Surigao del Norte 1st District Engineering Office (formerly Surigao del Norte 2nd District Engineering Office)` (GAA FY2020–2026) | `office:surigao-del-norte-1st-deo` | The label's own primary name is the 1st DEO and it carries DBM operating-unit code 1800181, the code the plain `Surigao del Norte 1st DEO` label uses in FY2024–2026; `Surigao del Norte 2nd DEO` keeps 1800180 throughout | provisional |
| `Davao de Oro District Engineering Office` (GAA FY2022) | `office:compostela-valley-deo` (legacy, no district) | RA 11297 rename; the crosswalk's `legacy.renamed_province` block; same DBM code 1800159 as `Compostela Valley DEO`. A predecessor: its money stays in the residual | firm |

Coverage of DEO-like labels (labels matching "district engineering office"):

| Slot | Labels | Joined a card office | Joined a legacy office (residual) | Unmatched | Residual share |
| --- | ---: | ---: | ---: | ---: | ---: |
| FY2020 GAA | 185 | 177 | 6 | 2 | 59.8% |
| FY2021 GAA | 186 | 179 | 6 | 1 | 63.4% |
| FY2022 GAA | 188 | 181 | 6 | 1 | 63.7% |
| FY2023 GAA | 190 | 184 | 4 | 2 | 70.6% |
| FY2024 GAA | 191 | 186 | 4 | 1 | 74.0% |
| FY2025 GAA | 198 | 191 | 4 | 3 | 75.5% |
| FY2026 GAA | 200 | 195 | 3 | 2 | 62.6% |
| FY2027 NEP | 199 | 196 | 1 | 2 | 80.1% |
| FY2027 HGAB 3R | 199 | 199 | 0 | 0 | 70.0% |

Residual share = 1 − deo_php / total_php; it is mostly the Central Office
(₱326,997,958,000 of the FY2026 GAA; ₱510,414,711,000 of the FY2027 NEP;
₱410,825,229,000 of HGAB 3R).

### The residual and the predecessor rule

`residual[]` has one entry per slot and the verifier proves
`deo_php + central_office_php + regional_offices_php + unmatched_php + no_office_php + office_change_php = total_php`
(`no_office_php` and `office_change_php` are non-zero on the HGAB 3R slot only; see "Office change")
(GAA totals from `yearly_totals.json`, NEP ₱643,953,276,000, HGAB 3R
₱587,075,661,000) and that Σ offices' `php` equals `deo_php`. `unmatched_php`
holds two things, both named in `unmatched_labels` (labels with non-zero money
only): labels that join a crosswalk **legacy** office (a predecessor with no
district, `legacy.status` superseded_by_split / renamed_province /
registry_only) and labels that join nothing. A predecessor's history is never
split across its successors; each successor carries a note saying which label
holds that money and where.

| Label | Kind | Crosswalk office | FY2020 | FY2021 | FY2022 | FY2023 | FY2024 | FY2025 | FY2026 | FY2027 NEP | Total (₱ bn) |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Cavite District Engineering Office (code 1800061) | legacy | `office:cavite-deo` | 3.524 | 2.987 | 3.841 | 2.209 | 3.230 | 2.643 | 1.305 | 1.790 | 21.529 |
| Compostela Valley District Engineering Office (1800159) | legacy | `office:compostela-valley-deo` | 3.320 | 3.370 | — | — | — | — | — | — | 6.691 |
| Davao de Oro District Engineering Office (1800159, alias) | legacy | `office:compostela-valley-deo` | — | — | 2.268 | — | — | — | — | — | 2.268 |
| Cotabato City District Engineering Office | legacy | `office:cotabato-city-deo` | 1.264 | 0.884 | 0.030 | 0.033 | 0.047 | 0.010 | — | — | 2.268 |
| South Cotabato District Engineering Office | legacy | `office:south-cotabato-deo` | 1.040 | 1.420 | 0.035 | — | — | — | — | — | 2.495 |
| Southern Leyte District Engineering Office | legacy | `office:southern-leyte-deo` | 1.655 | 2.132 | 2.179 | 0.982 | 0.907 | 0.046 | 0.046 | — | 7.948 |
| Zamboanga City District Engineering Office | legacy | `office:zamboanga-city-deo` | 1.284 | 1.313 | 0.987 | 1.408 | 1.277 | 0.035 | 0.035 | — | 6.340 |
| Misamis Occidental District Engineering Office (1800155) | unmatched | — | 0.861 | 1.303 | 0.974 | 1.301 | 0.867 | 1.160 | 0.898 | 0.212 | 7.576 |
| Cagayan de Oro 2nd District Engineering Office (1800188) | unmatched | — | 0.030 | — | — | — | — | 0.100 | 0.010 | 0 | 0.140 |
| Cavite 5th District Engineering Office (1800205) | unmatched | — | — | — | — | — | — | 0.180 | — | — | 0.180 |
| Southern Sub Leyte District Engineering Office | unmatched | — | — | — | — | 0.003 | — | — | — | — | 0.003 |
| **Total** | | | 12.980 | 13.410 | 10.314 | 5.936 | 6.329 | 4.175 | 2.294 | 2.002 | 57.439 |

`Road Board` (GAA, ₱0 every year) is also unmatched and never listed. The
HGAB 3R slot has no unmatched money: all 199 printed DEOs join.

Two of these are candidate aliases the rules do not allow without a decision:
`Misamis Occidental DEO` (DBM 1800155) is the only unnumbered Misamis
Occidental unit beside `Misamis Occidental 2nd DEO` (1800156) and the printed
FY2027 NEP volume calls the same office `Misamis Occidental 1st DEO`; `Cavite
DEO` (1800061) sits beside `Cavite 2nd` and `Cavite Third` while the printed
volume prints `Cavite 1st DEO`. The crosswalk has no legacy block for the
former and marks the latter `superseded_by_split` with three candidate
successors, so both stay in the residual. Likewise DBM code 1800159 runs
through `Compostela Valley DEO` → `Davao de Oro DEO` → `Davao de Oro 1st DEO`
(the 2nd DEO has its own code 1800193 from FY2023), which would let the
Compostela Valley history be assigned to the 1st DEO; the crosswalk calls that
succession unverified, so it is not done.

### Office change (DEO2LEG condition 3)

`DEO2LEG/README.md` ("Disclaimers", condition 3) requires that a paired line
whose two stages do not agree on one office group is held out of every card
and published separately, never folded into a card or the residual.
`build-hgab-districts.ts` ports the source's rule from
`analysis/web/buildCongressIndex.mjs`: `canonicalOffice`, `officeJoinKey`, the
group definition (engineering offices, `evidence.inAllocationTable`, keyed by
their exact sorted district set, so Apayao 1st + 2nd DEO are one group while
North and South Manila DEO are two), `sideOffices` and `classifyRow`, reading
the `third` and `nep` sides of each parquet row's `record_json`:

- `group`: every office named on either side is in one group. Booked to the
  House side's office as before (13,547 lines; one of them names Ifugao 2nd
  DEO on the House side and Ifugao 1st DEO in the NEP, same group).
- `residual`: no side names a district office (Central Office, regional
  offices; 3,996 lines). Stays under Central/regional as before.
- `no_office`: no side names any office (3 lines). Residual, as upstream:
  `residual[hgab3].no_office_php` / `no_office_rows` and the top-level
  `no_office` summary; in no office's figures.
- `office_change`: the sides name two groups (10 lines) or a group and no
  district office (57). Removed from every office's `fy2027` figures, bridge
  and hgab3 slot. The House side is `residual[hgab3].office_change_php` /
  `office_change_rows`; both sides are the top-level `office_change`
  summary; each office either side names carries
  `fy2027.office_change` (`rows`, `nep_php`, `hgab3_php`, `row_ids`; an
  annotation, a line naming two offices is on both) and the note "N project
  lines changed office between the NEP and the House bill; they are not
  counted here."
- `no_stage` stops the build (none), and so does any `no_office` set other
  than the three ids below.

The three `no_office` lines are third-reading `repeated_key` sides
(house-reading:8092, listed under Pampanga 2nd DEO, ₱24,000,000;
house-reading:12949, Batangas 4th DEO, ₱25,000,000; house-reading:15005,
Central Office, ₱150,000,000; House only). The source reads only the records;
these sides list an office on the side but not on its records, so they are
residual, as upstream. The two DEOs carry the note "1 House bill line listed
here has no office in the source data; it is left unassigned." In the
leaderboard they are `totals.by_office_kind.no_office`.

Reconciliation with the source (its builder run on the pinned checkout; the
verifier repeats this whenever `--src` is present):

| Bucket | Ours: lines | NEP | House | Source: lines | NEP | House | Difference |
|---|---:|---:|---:|---:|---:|---:|---|
| District offices | 13,547 | ₱121,119,847,000 | ₱174,826,097,000 | 13,547 | ₱121,119,847,000 | ₱174,826,097,000 | none |
| Residual (Central, regional, no office) | 3,999 | ₱447,727,490,000 | ₱408,582,191,000 | 3,999 | ₱447,727,490,000 | ₱408,582,191,000 | none; same line ids |
| Office change | 67 | ₱4,076,737,000 | ₱3,667,373,000 | 67 | ₱4,076,737,000 | ₱3,667,373,000 | none; same 67 line ids |
| Whole | 17,613 | ₱572,924,074,000 | ₱587,075,661,000 | 17,613 | ₱572,924,074,000 | ₱587,075,661,000 | none |

Residual shares: NEP 78.1%, House 69.6%, as the source states. Our residual
splits into Central Office (House ₱408,230,191,000), regional offices
(₱153,000,000) and no office (₱199,000,000).
A count of rows whose two `office_canonical` strings differ (the parquet's
`office_difference` flag) gives 69 (NEP ₱4,146,737,000 / House
₱3,715,473,000): the 67 above, the Ifugao line (same group; NEP ₱31,600,000,
House ₱9,700,000) and house-reading:5501 (Central Office in the House bill,
BARMM in the NEP: no district office on either side, so residual; ₱38,400,000
each).
`districts-manifest.json` → `office_lens` lists every held-out line with both
sides' offices, the no-office lines and the same-group line.

### Representatives and portraits

Seats and names are the crosswalk's capture of the congress.gov.ph 20th
Congress directory (2026-10-22; 252 resolved, 2 ambiguous). Each is joined to
bills.juris.ph `/api/authors` on the member code: 253 of 254 seats join
(`representatives_source.matched`); the one gap is Jennifer Austria-Barzaga
(I007), one of the two candidates listed for Cavite 4th, who has no juris
profile. Ambiguous seats (Antipolo City 2nd, Cavite 4th) have
`status: 'ambiguous'`, `candidates[]` with both members, and no chosen member.
bills.juris.ph has no per-member page: `juris_url` is
`https://bills.juris.ph/authors/house?author=<canonicalName>`, which opens the
House directory with the member selected (`BrowseAuthorDirectoryPage` reads the
`author` query parameter); ambiguous seats link the bare directory.

Portraits are the juris mirror (`https://juris-assets.bettergov.ph/…`), sourced
from attributed government photographs on Wikimedia Commons; every entry
carries `portrait_attribution`, `portrait_license` (all "Public domain" at this
fetch) and `portrait_source_url`, which the UI must show with the image. The
crosswalk's own scraped portraits under `DEO2LEG/legislative_profiles/` are not
used (reuse rights unclear). Nothing in the index establishes that a
representative requested, sponsored or controlled any project or amount.

Deployment note (2026-10-25): this portal is served with
`Cross-Origin-Embedder-Policy: require-corp` (`vite.config.ts` and production,
needed by DuckDB-Wasm), and `juris-assets.bettergov.ph` sends neither
`Cross-Origin-Resource-Policy` nor `Access-Control-Allow-Origin`, so browsers
block every `portrait_url` and the UI falls back to a placeholder. Photos will
show once that host adds `Cross-Origin-Resource-Policy: cross-origin` (a
Cloudflare response-header rule on the asset host is enough). `npm run
verify:hgab -- --probe-portraits` prints the host's current headers as an
informational line; it is not a failing check because the host is outside this
data tree.

### Verifier checks (districts section)

File present; fiscal year, source commit and crosswalk counts; `terms` equal
`CONGRESS_TERMS` parsed from the contract; 254 unique card ids; every
`office_ids` entry exists and every office is on a card, with
`district_ids`/`office_ids` agreeing both ways; tier A iff one district; nine
slots in order with `php` null or a non-zero integer and a `matched_label`;
`by_congress` recomputed; residual identity and Σ offices = `deo_php` on every
slot; HGAB 3R and NEP totals pinned; GAA totals equal `yearly_totals.json`;
no Central/regional label in `unmatched_labels`; per-office bridge identity
and net = hgab3 − nep; `fy2027` sums re-derived from the parquet by printed
label with office-change lines left out, Σ offices' `fy2027.nep_php` + Central
+ regional + office change = ₱572,924,074,000, every printed DEO on a card;
the office lens recomputed on its own code path (counts pinned: group 13,547,
residual 3,996, office change 67 = 10 + 57, no office 3 by id, no stage 0),
the `office_change` and `no_office` summaries and hgab3 residual slot, every
kept line booked inside its group and every residual line to
Central/regional, per-office annotations and notes, and, with `--src`, the
source's own `buildCongressIndex` run and compared in every cell and line id; headline, attribution and co-served recomputed;
label format; ≥ 250 seats joined (exact number and unmatched names printed);
resolved reps carry member code and profile, ambiguous seats choose none;
portraits carry attribution and licence; juris cache `fetched_at` matches;
notice says what it must; scope notes separate the whole-department basis
from the project-only House bill figures and, like every office note, run to
at most 25 words.

### Scope notes (technical record)

`scope_notes` in `districts.json` and each office's `notes` are the plain
reader-facing versions (at most 25 words each). The precise statements they
stand for:

1. FY2020–2026 figures are enacted GAA appropriations summed by DPWH operating
   unit from the GAA operating-unit listing: the whole department, all funds
   and all expense classes (source files in thousands of pesos, converted to
   pesos).
2. The FY2027 `nep` slot is the DBM NEP operating-unit listing on the same
   whole-department basis (department total ₱643,953,276,000, including
   automatic appropriations).
3. The FY2027 `hgab3` slot and the `fy2027` block are the House bill third
   reading against the NEP for the DPWH operations population compared in the
   HGAB section (NEP ₱572,924,074,000, HGAB 3R ₱587,075,661,000): named
   projects only, excluding personnel services, MOOE and other non-project
   items. `fy2027.nep_php` is therefore smaller than the `nep` slot for the
   same office and the two must never be added or compared as like for like.
4. GAA, NEP and HGAB totals are each reconciled per year and stage:
   `deo_php + central_office_php + regional_offices_php + unmatched_php =
   total_php`. "Central Office" is the label matching `/^central office$/i`;
   regional offices match `/regional office/i` (including "… - Proper"); the
   BARMM regional grouping counts as regional and never as an office.
5. Offices are joined by normalised name only (DEO expansion, ordinal words,
   accents, hyphens, the "Las Pi±as" mojibake, " - Proper"). The explicit
   aliases are declared in `ALIASES` and recorded on each office's
   `aliases_used`; labels matching crosswalk legacy (predecessor) offices
   with no district, and labels matching nothing, are listed in
   `residual.unmatched_labels` (names; their money is in
   `districts-manifest.json` `coverage[].unmatched_labels`), never assigned
   to a successor. The plain note calls the aliases "known name changes":
   one is a renamed label qualifier (Surigao del Norte 1st DEO), the other a
   province renamed by RA 11297 (Compostela Valley → Davao de Oro).
6. A Tier B office's figures are undivided and shared by every district it
   serves; card headlines sum the serving offices' undivided totals and must
   be labelled as a range when attribution is B or mixed. Districts linked
   only to the BARMM regional grouping have attribution `none` and null
   headlines.
7. 67 paired FY2027 lines whose NEP and House sides name different office
   groups, or a district office on one side and none on the other, are held
   out of every office and of the Central/regional residual (DEO2LEG
   condition 3; "Office change" below). Every other line is booked to the
   office the House side lists (the parquet's `office` column), including the
   one line whose two sides name different offices of the same group (Ifugao
   1st and 2nd DEO, both serving the lone district). HGAB statuses are carried
   verbatim through the per-office bridge (fuzzy and ambiguous rows sit in
   `house_only` as the contract maps them).
8. The crosswalk's scanned allocation table (undated) is used for structure
   only; none of its amounts appear here.

Office `notes` stand for, in order: no operating unit under the office's name
in the listed GAA years; a zero appropriation in the listed years (`php` null,
never 0); no operating unit under the name in the FY2027 NEP listing; no rows
under the office in the FY2027 comparison population (or, for BARMM, a
`regional_group` with no ledger in any year); and the predecessor rule — a
crosswalk legacy office (`legacy.status` superseded_by_split /
renamed_province, with its law when recorded, e.g. RA 11297 for Compostela
Valley → Davao de Oro) that names this office among its `candidateSuccessors`
and whose labels, years and amounts sit in the residual (table above), never
split between successors. "Before <year>" is used when the predecessor's last
GAA year is before FY2026 and it has no FY2027 NEP row; otherwise "The budget
also lists an undivided <office>".

The plain notes print years without "FY" and name the stages as "enacted
budget(s) <years>" (GAA), "2027 NEP" (NEP) and "2027 House bill" (HGAB
3R). The predecessor note gives one combined amount; the per-label
breakdown (e.g. Compostela Valley DEO FY2020–2021 ₱6,690,874,000 plus the
Davao de Oro label FY2022 ₱2,267,594,000 = ₱8,958,468,000) is in
`districts-manifest.json` (`coverage[].unmatched_labels`: label, php, kind,
office); `residual[].unmatched_labels` in `districts.json` lists the label
names only; the legacy status and law are in the crosswalk.
`aliases_used` and `districts-manifest.json` keep the technical FY / GAA /
NEP / HGAB 3R forms.

### Refresh

1. Re-run `npm run import:hgab` if the parquet changed (the index reads it and
   `overview.json`).
2. `npm run build:hgab-districts -- --src=<clone>` (add `--offline` to keep the
   cached juris response; without it the response is re-fetched and
   `fetched_at` moves).
3. `npm run verify:hgab -- --src=<clone>`; fix any ✗.
4. When adding an alias, add one `ALIASES` entry with its basis; when the
   crosswalk gains a legacy block or alias that resolves one of the labels
   above, the join picks it up without code changes.

## Leaderboards

`data/hgab/2027/leaderboard.json` (`LeaderboardData` in
`src/lib/hgab-leaderboard.ts`, which also defines the 17 boards, the ranking
and the share formats) ranks DPWH district offices on the 2027 House bill
against the NEP and on their enacted budgets. It reads only `districts.json`,
`overview.json`, `dpwh/projects.parquet`, `dpwh/summary.json` and the
contract, so the order is `import:hgab` → `build:hgab-districts` →
`build:hgab-leaderboard` → `verify:hgab -- --src=<clone>`. The upload walks
the tree, so it lands on R2 at `hgab/2027/leaderboard.json`
(`LEADERBOARD_DATA_PATH`).

| Command | Script | Does |
| --- | --- | --- |
| `npm run build:hgab-leaderboard` | `scripts/build-hgab-leaderboard.ts` | Writes `leaderboard.json`, prints the slices and the top 3 of every board. Flags: `--out=data/hgab/2027`, `--contract=src/lib/hgab.ts` (`TRACE_LABELS`, `REGION_ORDER`). Fails on any broken rule below |
| `npm run verify:hgab` | `scripts/verify-hgab.ts` | The "leaderboard.json (leaderboards)" section: 47 checks, recomputed from `districts.json` and the parquet. Required: a missing file fails |

**The unit** is a connected group of engineering offices (the BARMM
`regional_group` excluded) and every district they serve, found by union-find
over `office.district_ids` / `district.office_ids`. One district is Tier A;
several is Tier B, shown with every district and never split. Each office is
in exactly one entry; group tier = every office's `tier` = every district's
`attribution` (asserted). `key` is the district id, or `shared:` + the sorted
office ids joined by `+`. At this build: 190 entries, 159 Tier A (151 with one
office, 8 with two) and 31 Tier B (2 to 7 districts; North + South Manila is
the 7-district, 2-office group). The 5 BARMM-only districts go to
`totals.districts_without_office`; `totals.districts` counts the 249 ranked.

**Fields** (integer pesos; null = no figure, never 0):

- 2027, the compared DPWH project lines: `nep_php`, `hgab3_php` = Σ the
  offices' `fy2027` figures; `delta_php` = House − NEP when both exist;
  `delta_pct` = delta / NEP × 100 when NEP > 0 (`pctChange`); `hgab3_rows` =
  Σ `fy2027.hgab3_records` (House bill records as published).
- `added_*` = `house_only_candidate` rows at the House amount; `held_*` =
  `fuzzy_candidate` + `ambiguous` (unconfirmed match: carried, never counted as
  added); `dropped_*` = `nep_only_candidate` at the NEP amount. Row counts are
  parquet rows, joined by the office's hgab3 `matched_label` (the label the
  House bill lists). Per office, added + held = `bridge.house_only` and dropped
  = `bridge.nep_only`. The three trace sets are read from `TRACE_LABELS`
  (`group`, `held`); the builder stops if they change.
- Enacted: `gaa` "2020"–"2026" = Σ the offices' GAA slots (null where none),
  `gaa_total_php`, `gaa_years`, `congress` "18"/"19"/"20" = Σ `by_congress`,
  `growth_pct` = `cardGrowth` (mean annual GAA per office per term, summed
  over offices; 20th against 18th).
- `reorganised_notes`: the group's offices' `notes` (verbatim, deduplicated,
  in office order) that record a change of office within the enacted years
  2020–2026, so part of the earlier money sits under another name: "Not
  listed under this name in the <years> enacted budget(s)", "Before <year>
  this area was served by …" and "The budget also lists an undivided …" (the
  last two only when their amount covers enacted years). Notes about the 2027
  documents or the BARMM grouping do not count. `reorganised` = any such
  note. Every note pattern is classified explicitly in `NOTE_PATTERNS`; an
  unknown one (including "Listed with no money in …", which no office carries
  yet) stops the build. Nothing else is inferred: Davao City DEO, whose
  decline starts in 2023, has no such note and is not flagged. At this build
  26 entries are reorganised (34 of the 39 notes on 27 offices count). The
  growth and decline boards keep only `steadyHistory` entries (not
  reorganised, 18th-Congress average at least ₱500 million a year).
- `people[]`: one per district, sorted by label, from the district's
  `representative`: `name` by the `repName` rule (ambiguous seats: both names
  joined " / "; null when there is no representative), `status`
  (`resolved` / `ambiguous` / `missing`), portrait with
  `"<attribution> · <licence>"`, profile and juris links, `bill_count`,
  `leadership_roles`, `href` = the district page. The entry's `region` is its
  offices' `RegionKey` (the builder warns and takes the first office's if a
  group ever spans two); each person's is the district's own, and they agree.
- `totals.all` and `by_office_kind` come from the parquet grouped by
  `office_kind` (the Camarines Norte Sub-DEO is listed under "District
  engineering offices (DEOs)"), with the 67 office-change lines and the 3
  no-office lines (ids from districts.json) as their own `office_change` and
  `no_office` slices (plus `rows`). Σ entries = `deo` on every field (NEP
  ₱121,119,847,000, House ₱174,826,097,000, the source's district-office
  figures); deo + central + regional + no_office + office_change = all = the
  DPWH totals (NEP
  ₱572,924,074,000, House ₱587,075,661,000); held = 389 rows,
  ₱10,517,119,000.
- Per entry, `office_change_rows` = distinct office-change lines naming any of
  its offices (an annotation; 41 entries), `scope_rows` = its segment-scope
  lines (= Σ the offices' `bridge.scope_review.rows`; 15 in all).
  `totals.gaa_residual` copies the GAA slots of districts.json `residual`.
  `residualLine()` (in the contract) prints the part no district carries on
  every board but shift and bills; the verifier checks it returns a sentence.
- `regions[]`: in `REGION_ORDER`, district offices only (Central Office and
  regional offices are in no region), each the sum of its entries.
- `credits` and `notes` are reader-facing: plain sentences of at most 20
  words, `docs/hgab-copy.md` wording, the banned-word list above.
  `credits.documents` keeps its volume names, as document titles do.

**`bill_count`** is bills.juris.ph `billCount`: the House bills in its 20th
Congress catalog that list the member as a principal author (checked on a
sample against `/api/authors/{id}/bills`: `total = primaryTotal`, no coauthor
credits counted). The catalog says it is not yet complete
(`meta.listingComplete: false`), and many bills list dozens of principal
authors.

## D1 layer (public API and MCP)

The pages read the static tree from R2; the Worker cannot read parquet, so
`/api/v1/hgab/2027/…` and the MCP tools read `hgab_*` tables in D1. The
contract (DDL, row counts, endpoint rules) is `docs/hgab-api.md`.

- **In D1:** everything the API returns. That is the overview and dataset
  meta (bridge, readings, not-on-map, map notes), documents with `pdf_url`,
  controls, dims, the 18 regions per dataset, one `hgab_projects` row per
  parquet row (the parquet columns plus `region_key`, `bridge_group`,
  `held`, `house_php` and the printed `lon`/`lat`), each row's
  `record_json` in `hgab_records`, reconciliation, district cards, offices
  and the residual. Nothing is re-derived. Every value is a copy of the JSON
  and parquet above.
- **Only on R2:** the parquet and JSON the browser reads, the province
  outlines (`geo/`), map dots with their road lines, the summaries' `top`
  lists (the API ranks rows in SQL instead), and the PDFs. The API links to
  the PDFs by `pdf_url`.
- NIA's `map.json` lists no regions, so its 18 `hgab_regions` rows are empty
  and its money is in `hgab_datasets.not_on_map_json`. The bridge in
  `bridge_json` counts unconfirmed matches (`held = 1`, DPWH only: 389 rows,
  ₱10,517,119,000) under `house_only`, as the pages do.

```sh
npm run build:hgab-d1                                                     # → data/hgab/2027/d1-import.sql (~88 MB, ~1,040 statements, ~2 s)
npx wrangler d1 execute budget --local --file=data/hgab/2027/d1-import.sql  # ~65 s, ~1.2 GB RSS
npm run verify:hgab -- --src=/tmp/dpwh-nep-review/repo --d1=local          # 52 D1 checks on top of the tree checks
```

Statement size: D1 rejects statements over 100,000 bytes. The builder cuts
INSERT batches at 90,000 bytes and fails if any statement reaches 95,000. A
single `record_json` is at most 26 KB, so each `hgab_records` batch holds a
few dozen rows. Text literals double their single quotes and nothing else.
The builder type-checks every value against its column's declared type and
NOT NULL constraint, and refuses NUL characters, lone surrogates and the text
`BEGIN TRANSACTION` (wrangler rewrites that text before splitting).

The builder also asserts that its DDL equals the contract's SQL block word
for word. It checks its replicas of `traceInfo` and `regionKeyOf` against
the contract source, on probe labels and on every label in the data. It
reads `PLAIN_TERMS` from the contract and the notice from `DisclaimerNotice`.

The file drops and recreates only `hgab_*` tables, so reloading is
idempotent and leaves the GAA, `nep_*`, `budget_cycle_*` and hearings tables
alone. One file loads fine locally. If it ever does not, run
`npm run build:hgab-d1 -- --split-mb=20`. That writes
`d1-import-01.sql` (schema only) and numbered data files after it; load them
in order and stop at the first failure:

```sh
for f in data/hgab/2027/d1-import-*.sql; do npx wrangler d1 execute budget --local --file="$f" || break; done
```

`.wrangler` is shared with the main checkout, so `--local` loads the same dev
database `wrangler dev` uses. Production is `--remote` with the same file,
run by hand after review (`docs/hgab-api.md` "Loading"). No script here
touches the remote database, and `verify:hgab` accepts only `--d1=local`.
`upload:hgab` skips `d1-import*.sql`: the export is never served from R2.

`--d1=local` queries through `npx wrangler d1 execute budget --local --json`
and checks:

- the 12 tables, the 6 indexes, and the contract row counts in total and per
  dataset;
- meta, datasets, documents, reconciliation, controls, dims, regions,
  districts, offices and the residual, row for row against the JSON;
- all 20,431 project rows, column for column against the parquet. The
  derived columns are checked against `map.json` and `TRACE_LABELS`;
- stage totals per dataset;
- the bridge recomputed from the rows, with unconfirmed matches in
  `house_only`, against `bridge_json`;
- unconfirmed rows only in `house_only`;
- regions plus not-on-map adding back to the totals and record counts;
- the residual identity, and Σ office slots = `deo_php`, in SQL;
- that records and projects join both ways;
- `record_json` byte-equal to the parquet for 20 random rows plus the
  longest, one with a quote and one with non-ASCII text.

Without the flag the verifier runs exactly as before.

## Known limits

- FMR's PSGC enrichment (per-point geocoding, location agreement) is absent
  from `record_json` because the final-dataset builder could not run here.
  Matching is unaffected. `has_map` is informational; the map is not shipped.
- HFEP `delta_php` on `column_added` / `column_dropped` rows departs from the
  contract's "null when either stage is absent" rule on purpose, to keep the
  bridge equal to the workbench's; the flags mark those 36 rows.
- `BridgeCell.php` for `increased` / `decreased` is the signed movement (gross
  increase / gross reduction), not the House side, so the bridge identity
  holds; `nep_php` / `house_php` on the cell carry the bases.
- Annex `house_match` values (`title_and_coordinates`, `title`,
  `coordinates`, `ai_corrected`, `title_similarity`) and the HFEP flags are not
  in `MATCH_LABELS`; unknown keys render as their raw text.
- `ControlRow` has no document key; link `house_pages` through
  `controlCitations()` (`documents.controls`: Volume I-C for DPWH, Volume I-B
  for the annexes) and `nep_page` to the dataset's NEP document.
- The `source_url` for the second-reading House volumes is the congress.gov.ph
  CSO page; for the third-reading volumes, the Senate Budget Transparency
  Portal's 2027 documents page; for NEP II-B the DBM department extract, whose
  pagination differs from the retained OCR copy. The registry notes say so.
- The workbench's matching is provisional (`comparison_ready: false`,
  `reviewed_pairs: 0`); candidate vocabulary must stay candidate vocabulary.
