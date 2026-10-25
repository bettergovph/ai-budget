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

## Scripts

| Command | Script | Does |
| --- | --- | --- |
| `npm run import:hgab` | `scripts/import-hgab.ts` | Reads the workbench payloads, writes `data/hgab/2027/`. Flags: `--src=<clone>` (default `/tmp/dpwh-nep-review/repo`), `--out=data/hgab/2027`, `--nep=data/2027`, `--dataset=dpwh[,fmr,…]`, `--no-pdf` |
| `npm run verify:hgab` | `scripts/verify-hgab.ts` | Re-reads the tree and asserts totals, bridges, readings, parquet shape, document keys and reconciliation. Flags: `--out`, `--src` (for the main_overview comparison), `--no-pdf`, `--hash-pdfs`. Exit 1 on failure |
| `npm run upload:hgab` | `scripts/upload-hgab-to-r2.ts` | Runs the verifier, then PUTs everything under the tree to R2 `budget` at prefix `hgab/2027/` (size + ETag/MD5 skip). Flags: `--dry-run`, `--force`, `--skip-verify`, `--concurrency=N` |

Type-check and lint:

```sh
npx eslint scripts/import-hgab.ts scripts/verify-hgab.ts scripts/upload-hgab-to-r2.ts
npx tsc --noEmit --ignoreConfig --strict --target es2023 --module esnext --moduleResolution bundler \
  --types node --skipLibCheck --verbatimModuleSyntax --noUnusedLocals --noUnusedParameters --erasableSyntaxOnly \
  scripts/import-hgab.ts scripts/verify-hgab.ts scripts/upload-hgab-to-r2.ts
```

## Layout

```
data/hgab/2027/
  manifest.json              what ran, when, from which commit; input sha256s; per-dataset totals; PDF list
  overview.json              HgabOverview: datasets[] (meta + bridge), documents[] (registry), reconciliation[]
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
  kept in the controls table ("Funding column: Total"), the scope sentence and
  an explained reconciliation row — the ₱140,000 gap is the documented Metro
  Manila medical-equipment printing defect.
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
printing (FMR 60, HFEP 17, NIA 46 pages), so `hgab3_php = hgab2_php` and only
`hb10858-2r-vol-ib` is cited (`hgab3_doc`/`hgab3_page` are null).

## Document registry

| Key | File in the clone | Pages used |
| --- | --- | --- |
| `hb10858-2r-vol-ib` | `HB_BUDGET/2 - HB 10858 VOL IB.pdf` | DPWH PAP controls; FMR 667–726, HFEP 877–893, NIA 896–941 |
| `hb10858-2r-vol-ic` | `HB_BUDGET/3 - HB 10858 VOL IC.pdf` | DPWH project rows, second reading |
| `hb10858-3r-vol-ib` | `HB_BUDGET_3rd_reading/2- HB 10858 FOR 3RD READING VOL I-B.pdf` | DPWH PAP controls, third reading |
| `hb10858-3r-vol-ic` | `HB_BUDGET_3rd_reading/3- HB 10858 FOR 3RD READING VOL I-C .pdf` | DPWH project rows, third reading |
| `nep2027-vol-iib` | `dbm-nep-data/NEP-2027-VOLUME-2B_OCR.pdf` | DPWH NEP rows and PAP controls (one-based pages of the OCR copy) |
| `nep2027-fmr` | `dbm-other-nep-line-data/FMR.pdf` | 1–47 |
| `nep2027-nia` | `dbm-other-nep-line-data/NIA.pdf` | 1–30 |
| `nep2027-hfep` | `dbm-other-nep-line-data/HFEP_2.pdf` | 1–13 (Volume II-A pages 727–739) |

All pages are one-based PDF file pages. `ControlRow.house_pages` cite Volume
I-B (`hb10858-3r-vol-ib` for DPWH, `hb10858-2r-vol-ib` for annexes) and
`nep_page` the dataset's NEP document.

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
- `ControlRow` has no document key; the UI must link `house_pages` to the
  Volume I-B document of the dataset and `nep_page` to its NEP document.
- The `source_url` for the House volumes is the congress.gov.ph CSO page and
  for NEP II-B the DBM department extract, whose pagination differs from the
  retained OCR copy; the registry notes say so.
- The workbench's matching is provisional (`comparison_ready: false`,
  `reviewed_pairs: 0`); candidate vocabulary must stay candidate vocabulary.
