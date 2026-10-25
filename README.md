# Philippines GAA Budget AI Review

A read-only explorer for the Philippine General Appropriations Act (GAA), covering fiscal years 2020–2026 across 40 national government groups. The portal presents national trends, department hierarchies, programs, expense classes, line-item data, generated reports, and budget-cycle comparisons.

A companion microsite at `/2027` covers the FY2027 National Expenditure Program — the Executive's ₱7.20 T proposal — measured line by line against the FY2026 GAA.

A second companion section at `/hgab` covers the FY2027 House General Appropriations Bill — House Bill 10858 as printed for second and third reading — compared row by row against the NEP for the four programs where the bill prints project-level detail: DPWH, DA farm-to-market roads, the DOH Health Facilities Enhancement Program and NIA irrigation. Every status, pairing and amount is carried from the BetterGov [DPWH-NEP-HB-2027-ANALYSIS](https://github.com/csiiiv/DPWH-NEP-HB-2027-ANALYSIS) workbench at a pinned commit and reconciled against `data/2027` before it is published. Unmatched rows are candidates, not findings.

The application is built with React, TypeScript, and Vite. It runs on Cloudflare Workers, uses D1 for queryable department and budget-cycle data, and reads larger JSON and Parquet assets from Cloudflare R2. DuckDB-Wasm powers in-browser analysis of columnar data.

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`
- npm
- A local copy of the [BetterGov.PH GAA dataset on Hugging Face](https://huggingface.co/datasets/bettergovph/gaa) only when rebuilding datasets
- Wrangler authentication only when working with D1 or deploying

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open the URL printed by Vite. The example environment points the browser at the public R2 data host, so the multi-gigabyte local dataset is not required for normal UI development.

To serve data from `public/data` instead, leave `VITE_DATA_BASE_URL` unset. In this repository `public/data` may be a symlink to the ignored local `data/` directory.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Type-check and create a production build |
| `npm run preview` | Build and preview the application through Wrangler |
| `npm run lint` | Run ESLint |
| `npm run deploy` | Build, exclude local data assets, and deploy the Worker |
| `npm run build:index` | Rebuild the national summary JSON |
| `npm run import:nep2027` | Build the FY2027 NEP tree in `data/2027` from the DBM extract |
| `npm run verify:nep2027` | Reconcile `data/2027` against the raw FY2027 CSV |
| `npm run upload:nep2027` | Publish the FY2027 assets to R2 under `2027/` |
| `npm run import:hgab` | Build the FY2027 HGAB tree in `data/hgab/2027` from the pinned workbench commit — overview, per-dataset summaries, project parquet, source PDFs |
| `npm run verify:hgab` | Reconciliation gate: the HGAB tree's NEP side against `data/2027`, the bridge identity per dataset, hashes and required files; exits non-zero on failure |
| `npm run upload:hgab` | Publish the FY2027 HGAB assets to R2 under `hgab/2027/` (refuses to run on a failed verify) |
| `npm run build:parquet -- --all` | Convert heavy department JSON tables to partitioned Parquet |
| `npm run build:sqlite -- --all --reset` | Rebuild the SQLite database used to prepare D1 data |
| `npm run dump:sql` | Export the SQLite database as D1-compatible SQL |
| `npm run upload:r2 -- --all` | Upload generated JSON and Parquet assets to R2 |
| `hearings` sync | Hearing transcripts are published by the [transcriptions pipeline](../transcriptions): `sync_to_site.py` uploads `hearings/<videoId>/` files to R2 and upserts `hearings` rows into D1. Served at `/hearings` (grid) and `/hearings/:videoId` (interactive transcript + summary). |

Most data scripts also accept a single department, for example:

```bash
npm run build:parquet -- --dept=07 --table=objects
npm run build:sqlite -- --dept=07
npm run upload:r2 -- --dept=07 --dry-run
```

## Environment

Copy `.env.example` and configure only the values needed for your workflow:

```dotenv
# Browser-side base URL for JSON and Parquet assets.
VITE_DATA_BASE_URL=https://budget-assets.bettergov.ph

# Required only by the R2 upload and cleanup scripts.
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=budget
```

Never commit R2 credentials. `.env` and `.env.local` are ignored by Git.

## Architecture

```text
src/pages/          Route-level React views
src/components/     Shared portal and report UI
src/lib/            Data loading, DuckDB, CSV, and formatting utilities
src/worker/         Cloudflare Worker and D1 API routes
scripts/            Dataset conversion, verification, upload, and deploy helpers
docs/               Detailed data-pipeline documentation
data/               Generated/source data (ignored by Git)
```

The main routes are:

- `/` — national overview
- `/explore` — dataset exploration
- `/methodology` — coverage and data-quality notes
- `/d/:deptId/*` — department overview, trends, programs, objects, data, reports, and budget-cycle views
- `/2027` — FY2027 National Expenditure Program microsite (overview, `/2027/d/:deptId`,
  `/2027/explore`, `/2027/methodology`)
- `/hgab` — FY2027 House General Appropriations Bill section; redirects to `/hgab/2027`
  (overview), with `/hgab/2027/:dataset?view=…` for one program's hub (`dpwh`, `fmr`,
  `hfep`, `nia`), `/hgab/2027/:dataset/p/:id` for one comparison record, and
  `/hgab/2027/sources` and `/hgab/2027/methodology`
- `/api/dept/:deptId/*` — internal Worker endpoints backed by D1 (used by the SPA)
- `/api/v1/*` — public REST API (see below)
- `/docs` — public API documentation
- `/mcp` — MCP server for AI agents

## Public API and MCP server

A versioned, CORS-open, read-only public API serves all three datasets (GAA FY2020–2026,
NEP FY2027, budget cycle) with every amount rescaled to exact pesos:

- `GET /api/v1` — endpoint index
- `GET /api/v1/gaa/...` — national totals, departments, agencies, expense classes,
  programs, object-level line items, cross-department program search
- `GET /api/v1/nep/2027/...` — national overview, departments, and rollups by
  agency/program/expense class/fund/region/object/operating unit/division
- `GET /api/v1/budget-cycle/...` — NEP → GAA → execution facts for covered departments
- `GET /api/v1/openapi.json` — OpenAPI 3.1 specification

Human-readable documentation is served at `/docs`. The same data is exposed to AI agents
through a stateless Streamable-HTTP MCP server at `/mcp`
(`claude mcp add --transport http ph-budget https://<host>/mcp`). The REST handlers and MCP
tools share one data layer (`src/worker/public-api.ts`), so the two surfaces cannot drift.

Small core datasets are loaded through the Worker or as JSON. Larger hierarchy and object tables are stored as year-partitioned Parquet and queried with DuckDB-Wasm. Production asset URLs are resolved through `VITE_DATA_BASE_URL`; the Worker serves the SPA and handles `/api/*` requests first.

## Rebuilding and publishing data

The source dataset is intentionally excluded from Git. It is available from the [BetterGov.PH GAA dataset on Hugging Face](https://huggingface.co/datasets/bettergovph/gaa). With a populated `data/<department-id>/` tree, the typical GAA asset workflow is:

```bash
npm run build:index
npm run build:parquet -- --all
npm run build:sqlite -- --all --reset
npm run dump:sql
npm run upload:r2 -- --all --dry-run
npm run upload:r2 -- --all
```

Review generated SQL before applying it to D1. R2 upload commands require the credentials described above.

The FY2027 NEP microsite has its own self-contained pipeline — one CSV in, `data/2027` out, no D1 involved:

```bash
npm run import:nep2027
npm run verify:nep2027
npx wrangler d1 execute budget --local --file=data/2027/d1-import.sql
npm run upload:nep2027 -- --dry-run
npm run upload:nep2027
```

FY2027 is hybrid: the aggregation tables (`nep_meta`, `nep_departments`,
`nep_rollups`) are served live from D1 through `/api/nep2027/*`, and only the
line-item parquet is fetched from the data host.

See [FY2027 NEP import and the `/2027` microsite](docs/nep-2027-import.md) for the field mapping, the two structural corrections it makes over the legacy tree, and the analyst caveats. Note that `.env` points the browser at the production R2 host, which does not yet carry the `2027/` prefix, so the microsite will 404 on a plain `npm run dev`. Until the assets are published, create a `.env.local` (gitignored, and it overrides `.env`) containing:

```dotenv
VITE_DATA_BASE_URL=
```

That serves every dataset from the `public/data` symlink instead. Delete it once `npm run upload:nep2027` has run.

The FY2027 House bill section has the same shape — the pinned workbench in, `data/hgab/2027` out, nothing in D1:

```bash
npm run import:hgab
npm run verify:hgab
npm run upload:hgab -- --dry-run
npm run upload:hgab
```

```text
data/hgab/2027/
  manifest.json                 what ran, when, from which pipeline commit
  overview.json                 datasets, bridges, documents, reconciliation
  <dataset>/summary.json        controls, dimensions, top lists, readings
  <dataset>/projects.parquet    one row per comparison record (DuckDB-Wasm)
  pdf/<doc_key>.pdf             the source documents the evidence links open
```

`<dataset>` is `dpwh`, `fmr`, `hfep` or `nia`. Amounts are integer pesos; null means "this stage has no record", never zero. The importer does not re-derive matching — every status, pairing and amount comes from the workbench's own builders — and the verifier refuses to let a build upload unless its NEP side reconciles to `data/2027` and the bridge identity (House-only − NEP-only + increased − decreased + segment-scope review = House − NEP) holds for every dataset. The browser reads the tree from `VITE_DATA_BASE_URL` under `hgab/2027/`, exactly as `2027/` is served. See [FY2027 HGAB data pipeline](docs/hgab-data.md) and [the plan and implementation notes](docs/hgab-plan.md).

The optional NEP → GAA → execution dataset has a separate import, verification, and D1 loading workflow. See [Budget-cycle import and normalization](docs/budget-cycle-import.md) for the source workbook requirements, crosswalk rules, quality checks, and release procedure.

## Data notes

- GAA source amounts are published in thousands of pesos and converted to full pesos for display.
- GAA appropriations are legal authority to spend; they are not obligations or disbursements.
- UACS object codes changed between 2025 and 2026, so object-level year-over-year comparisons require care.
- The FY2027 NEP is a proposal, not an enacted appropriation; Congress amends it before it becomes the GAA. FY2027 and FY2026 share the post-2025 object-code scheme, so that particular comparison is safe.
- Program renames and organizational changes can break otherwise continuous series.
- AI-assisted aggregation and editorial material should be verified against official source documents before citation.

See the in-app methodology page for the complete set of coverage and data-quality caveats.
