# GAA Explorer, 2000–2026

The `/gaa` archive links all 27 fiscal years. Every year uses the same Explorer heading, year navigation, summary cards, breadcrumb controls and hierarchy table. Year choices run from 2026 back to 2000. Historical year pages aggregate the selected normalized baseline; `/gaa/2020` through `/gaa/2026` retain the existing detailed hierarchy. Historical branches follow the available bureau, program, operating-unit, fund, expense and object fields, skip absent levels, and end at source records. Codes and labels are grouped together within each branch; unlabeled partitions are retained. Historical YoY cells are unavailable because source coverage is not directly comparable. `/gaa/:year/records` provides the same source-record browser and annual download for every year. Filters, scope, group and pagination live in the query string. Changing fiscal years starts at that year's root because historical group names and codes have not been crosswalked.

## Data assets

The selected baseline lives in `data/gaa-history` in the original checkout (on this VM it resolves to `/data/backups/projects/ai-reports/data/gaa-history`). Build a separate Explorer export; never point the output at the source directory:

```sh
python3 -m venv /tmp/gaa-explorer-env
/tmp/gaa-explorer-env/bin/pip install -r scripts/gaa-explorer/requirements.txt
/tmp/gaa-explorer-env/bin/python scripts/gaa-explorer/build.py --source /path/to/gaa-history
```

This verifies each annual row count, PHP total, scope totals and grain counts against coverage.json, then copies the 27 original Parquet files, consolidated Parquet and coverage documentation into `data/gaa-explorer`. The generated `manifest.json` contains scope-specific group summaries and SHA-256 hashes. No PHP conversion is applied: `amount` is already full pesos. Raw archive files are not part of this export. The consolidated file has 5,432,425 rows.

For local development, `public/data` should link to this checkout's `data`. Existing department and national assets are also needed for the older detailed portal. The new record browser queries only the selected annual Parquet with the existing DuckDB-WASM engine; filters use bound parameters. No historical rows are inserted into the existing D1 tables, which remain scoped to 2020–2026. Existing API and department comparison coverage is unchanged.

## Interpretation

- 2001, 2004 and 2006 have empty facts because they reenact the preceding budget. Empty means no new GAA records, never zero budget or spending.
- Early coverage is partial. Historical agency/program/fund summaries and later line items retain their original grains. Null dimensions are not invented.
- Scopes are selected individually; unprogrammed appropriations are conditional. FY2003 preference schedules are separate.
- FY2019 retains the selected technical edition and documents the DPWH discrepancy against the Volume I summary.
- Recorded historical sums are not a comparable national budget series. The existing 2020–2026 trend and department comparison remain explicitly labeled with their narrower range.
- Annual pages and records expose coverage notes, quality flags, source URLs, document/member names, pages/lines when available and checksums. The download's README and coverage documents give detailed limitations.

## Verification and publishing

```sh
npm run test:gaa-explorer
npm run build
npm run upload:gaa-explorer  # checksum verification and dry run; no credentials needed
```

The Vite build copies application public assets but excludes `public/data`; both historical and existing data assets are served separately from R2 using `VITE_DATA_BASE_URL`. Data directories are also excluded from file watching.

When publishing is authorized, load only the required BetterGov R2 environment variables (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, optionally `R2_BUCKET`) and run `npm run upload:gaa-explorer -- --publish`. The existing budget bucket defaults to `budget`; confirm the intended target configuration. The publisher verifies checksums, uploads only the export, and writes the manifest last. Existing bucket CORS must permit browser GET/HEAD and Range requests, as for other Parquet assets. Verify the public manifest and an annual Parquet before deploying the app with its existing production asset base. App deployment is the repository's existing `npm run deploy` workflow. No upload or deployment is performed by building the export.

Worktree preview on this VM: `npm run dev -- --host 0.0.0.0 --port 5133 --strictPort`, reachable at `http://95.217.112.160:5133/gaa`. Port reservation is recorded in `~/projects/ports.md`.

Browser regression check (Chromium installed through Playwright, or supply `CHROMIUM_PATH`):

```sh
GAA_EXPLORER_URL=http://95.217.112.160:5133 node scripts/gaa-explorer/browser-check.mjs
```

Validated on 2026-11-02: all 27 year pages match their selected scope totals; every annual download returns a valid Parquet header over HTTP Range; reenacted pages omit monetary KPIs; FY2003 schedules and conditional appropriations switch independently; record search, provenance, pagination, history navigation and year reset work; the existing FY2026 Congress → Senate hierarchy works; 390px mobile layouts have no horizontal page overflow; no uncaught browser errors. Query tests, the production build, and ESLint for changed TypeScript files pass. Upload dry run verifies 33 files (147.1 MiB) without publishing.

Additional hierarchy regression: run `scripts/gaa-explorer/hierarchy-browser-check.mjs` with the same browser environment. It checks consistent page components, descending year controls, historical drill-down to source records, cold links, back navigation, scope changes, reenacted years, modern hierarchy preservation and mobile layouts.

The historical hierarchy now shares `GaaBrowserChrome` and `GaaHierarchyRow` with the modern browser. Direct historical branches use a validated `branch` query parameter, with scope and code/name filters bound in SQL. Legacy `?view=records` links redirect to `/gaa/:year/records` so scope changes remain in the records view. All year selectors and navigation choices are descending; chronological trend charts retain their time order.

## Published data release · 2026-11-02

Uploaded 33 files (154,289,469 bytes) to the existing `budget` R2 bucket under `gaa-explorer/`. The public [manifest](https://budget-assets.bettergov.ph/gaa-explorer/manifest.json) and [consolidated Parquet](https://budget-assets.bettergov.ph/gaa-explorer/gaa-2000-2026.parquet) are available. Every public file was downloaded and its SHA-256 matched to the local export; production-origin CORS passed for every file, and HTTP Range checks passed for all 28 Parquet files. Chromium queried the public FY2000 and FY2026 files through DuckDB-WASM, matching both row counts and full-PHP totals.

Manifest SHA-256: `fc23a1df10e25e414f735fcc3f8ccb253674d9c7aecae4f0cc6c0e77c04cfad7`.

This publishes the data assets only. The updated Explorer application has not been deployed by this release.
