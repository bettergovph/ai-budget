# FY2027 NEP import and the `/2027` microsite

How `NEP-FY2027.csv` becomes `data/2027/` and the `/2027` analyst microsite.

- Importer: `scripts/import-nep-2027.ts` (`npm run import:nep2027`)
- Verifier: `scripts/verify-nep-2027.ts` (`npm run verify:nep2027`)
- Publisher: `scripts/upload-nep-2027-to-r2.ts` (`npm run upload:nep2027`)
- UI: `src/pages/Nep2027*.tsx`, `src/components/Nep2027Bits.tsx`, `src/lib/nep2027.ts`

## Source

| | |
| --- | --- |
| File | `/home/jason/projects/2027-budget/NEP-FY2027.csv` |
| Size | 233 MB, UTF-8 with BOM, `\n` line endings |
| Rows | 756,629 data rows; 756,627 after dropping two trailing all-blank rows |
| Money-bearing line items | 532,313 (rows carrying a `UACS_OBJ_CD`) |
| Total | ₱7,200,186,000,000 |
| Units | Thousands of pesos, comma-grouped and double-quoted (`"695,308"`) |

The FY2026 GAA baseline is read straight from the existing extracts in this
repository — `data/*/full_extract.csv` filtered to `year = '2026'`, which totals
₱6,793,162,000,000 and matches `data/national/index.json`.

## Field mapping

The NEP extract and the GAA `full_extract.csv` files are the same table with
different header casing. Only the object-code columns are genuinely renamed,
and the NEP adds a region *name* the GAA extracts never carried.

| NEP FY2027 | GAA extract | Notes |
| --- | --- | --- |
| `SORDER` | `sorder` | Section. `1` = agency budgets (756,495 rows), `2` = SPF + automatic (132 rows). |
| `DEPARTMENT` | `department` | Two-digit code. **Not unique on its own** — see below. |
| `UACS_DPT_DSC` | `uacs_dpt_dsc` | Department name. |
| `AGENCY` | `agency` | Three-digit agency code. |
| `UACS_AGY_DSC` | `uacs_agy_dsc` | Agency name. |
| `PREXC_FPAP_ID` | `prexc_fpap_id` | 15-digit hierarchical P/A/P code. |
| `PREXC_LEVEL` | `prexc_level` | 1–6 hierarchy headers, 7 leaf activity. |
| `DSC` | `dsc` | P/A/P description. |
| `UACS_OPERDIV_ID` | `uacs_operdiv_id` | Sub-unit (DepEd schools divisions); 323,949 rows populated. |
| `UACS_DIV_DSC` | `uacs_div_dsc` | Sub-unit name; 221 distinct. |
| `OPERUNIT` | `operunit` | Seven-digit operating unit code. |
| `UACS_OPER_DSC` | `uacs_oper_dsc` | Operating unit name; 12,185 distinct. |
| `UACS_REG_ID` | `uacs_reg_id` | Two-digit region code. |
| `UACS_REG_DSC` | *(absent)* | **New.** Used to backfill region names for FY2026 too. |
| `FUNDCD` | `fundcd` | Eight-digit fund subcategory code. |
| `UACS_FUNDSUBCAT_DSC` | `uacs_fundsubcat_dsc` | 86 distinct subcategories. |
| `UACS_EXP_CD` | `uacs_exp_cd` | `1` PS, `2` MOOE, `3` financial expenses, `6` capital outlays. |
| `UACS_EXP_DSC` | `uacs_exp_dsc` | Expense class name. |
| `UACS_OBJ_CD` | `uacs_sobj_cd` | **Renamed.** Ten-digit object code. |
| `UACS_OBJ_DSC` | `uacs_sobj_dsc` | **Renamed.** Object name. |
| `AMT` | `amt` | Thousands of pesos. Blank on hierarchy headers. |

Null conventions differ and are normalised on both sides: the NEP writes empty
strings, the GAA extracts write the pandas artefact `nan`. Both become SQL
`NULL`.

Object codes align between FY2026 and FY2027 (both use the post-2025 UACS
scheme), so object-level year-over-year comparison is valid here in a way it is
**not** across the 2025/2026 boundary in the GAA tree.

## Two structural corrections

### 1. `SORDER = 2` gets its own department ids

The 132 rows with `SORDER = 2` reuse department codes `01` and `04`, which
already belong to Congress and the Department of Agrarian Reform:

| Section | Source dept code | What it actually is | FY2027 |
| --- | --- | --- | --- |
| 2 | `01` | Special purpose funds (pension and gratuity, MPBF, calamity, contingent, LGU shares, AFP modernisation) | ₱447.87 B |
| 2 | `04` | Automatic appropriations (national tax allotment, debt interest, BARMM, net lending, customs) | ₱2,581.48 B |

Filing these by department code — which the legacy GAA tree does — puts ₱2.58 T
of automatic appropriations inside DAR's ₱17 B and ₱448 B of special purpose
funds inside Congress's ₱28 B. The importer keys on `(SORDER, DEPARTMENT)` and
emits them as departments `SPF` and `AUTO`. The FY2026 baseline is split the
same way, so the comparison stays consistent. Both are labelled *derived* in
the UI, and each row keeps `source_description` and `source_department_code`.

Any future `SORDER = 2` department code that is neither `01` nor `04` falls back
to `X<code>` rather than silently colliding.

### 2. Hierarchy headers are not line items

224,314 rows carry a P/A/P description and level but no object code, fund,
expense class or amount. They are the programme tree, not money. The legacy
pipeline emitted them as `amount: 0.0, count: 1` entries at every level, which
inflates counts and produces `description: "nan"` rows in the UI.

Here they populate the programme hierarchy (`fpaps.json`, and the programme
rollup) and are excluded from every money-bearing level. `line_items` counts
therefore mean *line items*, not source rows.

## Derived fields

**Programme rollup.** `PREXC_FPAP_ID` is positional — digit 1 is the major class
(1 GAS, 2 STO, 3 Operations, 4 special/automatic), digits 1–2 the organisational
outcome, 1–4 the programme, 1–6 the sub-programme, 1–9 the project group, and
all 15 the leaf activity. Level 5 codes contain a literal `_`, so pure prefix
matching is not enough. Each line item is attributed to the nearest ancestor
that *exists as a header row in the same agency*, walking 6 → 4 → 2 → 1 digits.
That resolves to a real sub-programme or programme name in practice.

**Region names.** Backfilled from a code → name map built across both years, so
FY2026 rows (codes only) and the NEP's `SORDER = 2` rows (blank names) both get
labels. Region `00` is labelled `Central Office (nationwide)`.

## Output

```text
data/2027/
  manifest.json                      what ran, when, from which source
  national/index.json                national rollups + department table   (pesos)
  <dept>/
    summary.json                     everything the department page needs  (pesos)
    line_items.parquet               FY2027 line items, ZSTD               (both scales)
    departments.json                 \
    agencies.json                     |
    programs.json                     |
    fpaps.json                        | { metadata, data: [...] } envelopes,
    operating_units.json              | same shape as the legacy GAA tree,
    fund_subcategories.json           | years keyed "2026" and "2027"
    expenses.json                     | (thousands)
    objects.json                      |
    regions.json                      |
    expense_classes.json              |
    yearly_totals.json               /
```

**Scales.** `summary.json` and `national/index.json` are in **pesos**, matching
the legacy `data/national/index.json`. The entity envelopes stay in the source
scale, **thousands**, matching the legacy `data/<dept>/*.json`. Every envelope
declares which via `metadata.scale`, and `verify-nep-2027.ts` asserts it.

Each entity row carries `years: { "2026": {count, amount}, "2027": {…} }` plus
precomputed `delta` and `pct`, so the FY2026 comparison is available at every
level without a second fetch.

Sizes: 514 MB for the full tree. The microsite reads only the 39
`line_items.parquet` files (12 MB total, both fiscal years) plus the D1
aggregation layer; everything else is the offline/reproducible copy.

Runtime is about 36 s end to end on a warm page cache.

### Flags

| Flag | Effect |
| --- | --- |
| `--dept=07` | One department; skips the national index. |
| `--lean` | Skip `fpaps`/`operating_units`/`fund_subcategories`/`expenses`/`objects` (the one-row-per-line-item levels). Cuts output to ~30 MB. |
| `--no-baseline` | Skip the FY2026 join; every `2026` entry comes out zero. |
| `--src=` / `--out=` / `--baseline=` | Override paths. |
| `--keep-tmp` | Keep the intermediate DuckDB file for debugging. |

## Verification

`npm run verify:nep2027` re-reads the raw CSV and asserts 27 invariants across
both the JSON tree and the local D1 tables:
national and per-department totals and line-item counts against the source,
department amounts summing to the national total, the full (non-truncated)
rollups summing to their parent, `summary.json` agreeing with `index.json`,
`expense_classes.json` agreeing with `summary.json` after scaling, required
files present, declared scales correct, and no orphaned directories. It exits
non-zero on failure.

It also checks the D1 layer: `nep_meta` against the raw CSV, department
coverage and sums, all eight dimensions present, every dimension complete, every
department × dimension reconciling, and amounts being exact integer pesos. Pass
`--skip-d1` when the local D1 has not been loaded.

Current state: 27/27 passing, reconciling exactly to ₱7,200,186,000,000.

## D1 aggregation layer

The rollups are served live from D1; the line items stay in parquet. That split
is deliberate — the aggregations are small, have to be fast, and have to be
queryable *across* departments (which per-department parquet cannot do without
fetching 39 files), while a full-department `GROUP BY` scans 100k–330k rows and
D1 bills rows read.

The importer emits `data/2027/d1-import.sql` (17,830 rows, 1.7 MB):

```sql
nep_meta         -- one row: totals, source file, generated_at
nep_departments  -- 39 rows: totals + structural counts per spending group
nep_rollups      -- 17,790 rows: (department_id, dimension, code) -> count/amount/base_amount
```

Eight dimensions: `agency`, `program`, `expense_class`, `fund`, `region`,
`object`, `operating_unit`, `division`.

Three properties this layer guarantees:

1. **Additive.** The `nep_*` tables sit beside the FY2020–2026 GAA tables and
   never touch them. Publishing FY2027 cannot move an already-published GAA
   figure, and FY2027 keeps the corrected SPF/AUTO split without forcing that
   migration on the legacy tables.
2. **Exact integers.** Every source amount is an integral number of thousands
   (the importer asserts this and aborts otherwise), so amounts are stored as
   INTEGER pesos. No float touches a budget figure.
3. **Complete, not top-N.** Untagged rows are bucketed under code
   `__unassigned__` rather than dropped, so *every* dimension sums to the exact
   national total and cross-department sums are trustworthy. This matters: the
   first cut filtered `WHERE code IS NOT NULL`, which made the operating-unit
   dimension sum to ₱4.17 T instead of ₱7.20 T — all of SPF and AUTO
   (₱3.03 T) carry no operating unit. The verifier now asserts completeness on
   every dimension.

The per-department endpoint caps the three long-tail dimensions (`object`,
`operating_unit`, `division`) at 50 rows and folds the remainder into one
explicit `__other__` row, so the payload stays ~35 KB instead of 2 MB for DepEd
*and* still reconciles. `/api/nep2027/rollup/:dimension` returns the
untruncated set.

### Loading

```bash
npx wrangler d1 execute budget --local  --file=data/2027/d1-import.sql
npx wrangler d1 execute budget --remote --file=data/2027/d1-import.sql
```

The script is idempotent — it drops and recreates only the `nep_*` tables.

### Endpoints

| Route | Returns |
| --- | --- |
| `GET /api/nep2027/national` | Totals, all 39 departments, national expense-class / region / fund rollups, top programmes, movers |
| `GET /api/nep2027/dept/:id` | One group: totals, structural counts, all eight dimensions |
| `GET /api/nep2027/rollup/:dimension` | One dimension across every department (`?limit=`) |
| `GET /api/nep2027/rollup/:dimension?by=department&code=` | One code broken down by department |

Measured locally: 59 ms for `/national`, 16 ms for a rollup, 24–81 ms per
department.

## The microsite

| Route | Page |
| --- | --- |
| `/2027` | National overview — KPIs, expense-class comparison, movers, all 39 groups, top programmes, regions, funds |
| `/2027/d/:deptId` | One group — KPIs, the hierarchy drill-down (default), plus flat tabs for agencies, programmes, expense class, fund source, regions, operating units, objects |
| `/2027/explore` | Line-item explorer: DuckDB-Wasm over `line_items.parquet`, with visible SQL and CSV export |

The flat tabs read D1 through the Worker; the hierarchy and the explorer read
parquet.

### Hierarchy drill-down

The department page opens on a drill-down matching the GAA portal's:

```
Agency → Program → Activity / project → Operating unit → Fund → Expense class → Object code
```

Two differences from the GAA version, both forced by the data:

- **Every level compares FY2027 to FY2026.** That is the point of the
  microsite, so the department parquet carries *both* years discriminated by an
  `fy` column. Anything reading `line_items.parquet` must pin or pivot on `fy`;
  summing blind double-counts.
- **It goes one level deeper.** The GAA portal stops at expense class; down a
  drill path the object list is small, so there is no reason to stop short.

It reads parquet rather than D1 because this is a per-department drill that is
180k projects wide for DPWH — exactly the grain parquet is here for. Measured:
~630 ms for the first query (parquet fetch), then 14–29 ms per level.

Untagged codes are bucketed as `(not attributed)` rather than filtered, and
each level's footer states whether it sums back to the row above, so a level
that fails to reconcile is visible on screen rather than silent.

**Hybrid consistency.** The same numbers are reachable two ways — D1 for the
flat tabs, parquet for the hierarchy. `verify:nep2027` asserts they agree on
all 17,790 rollup rows across all eight dimensions and both years; if they ever
diverge, the same page would contradict itself.
| `/2027/methodology` | Field mapping, corrections, derived fields, caveats |

`deptId` is `01`…`40`, `SPF` or `AUTO`.

The explorer range-reads parquet directly from the data host — no D1, no API
route, nothing added to the Worker. Filtering DepEd's 327k line items runs in
under a second in the browser. This does mean the data host must honour
`Range` requests; Vite's dev server and R2 both do.

Only `SiteHeader.tsx` (one nav entry, a route-aware coverage label) and
`App.tsx` (four routes) were touched outside the new files — the GAA portal is
otherwise untouched.

## Publishing

```bash
npm run import:nep2027
npm run verify:nep2027
export R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=budget
npm run upload:nep2027 -- --dry-run
npm run upload:nep2027
npx wrangler d1 execute budget --remote --file=data/2027/d1-import.sql
```

R2 now carries only the line-item parquet (~5.5 MB); the aggregations go to D1.

Until `2027/` exists in the bucket, the microsite only works locally.
`.env` sets `VITE_DATA_BASE_URL=https://budget-assets.bettergov.ph`, which
serves the FY2020–2026 GAA data but returns 404 for `2027/national/index.json`,
so a plain `npm run dev` fails with "Failed to load the FY2027 NEP index".

The fix is a `.env.local` — gitignored, and Vite loads it after `.env` so it
wins:

```dotenv
VITE_DATA_BASE_URL=
```

An empty value is falsy in `data-url.ts`, so every dataset resolves to the
local `public/data` symlink. Delete the file once the assets are published.

`NepError` distinguishes the two failure modes: if `VITE_DATA_BASE_URL` is set
it names the host and tells you to publish or override; if it is unset it tells
you to run the importer.

Add `--all-levels` to also publish the deep entity JSONs (482 MB).

## Caveats for analysts

- The NEP is a **proposal**. Congress amends it before enactment; nothing here
  is an appropriation.
- FY2027 NEP vs FY2026 GAA compares a proposal to an enacted law. It is the
  comparison analysts usually want, but it is not like-for-like — the FY2026
  NEP would be.
- P/A/P codes are reassigned between years. "New" programmes are often renames
  or restructurings, and large drops are often transfers rather than cuts.
- Appropriations are legal authority to spend, not obligations or disbursements.
- Aggregation is machine-generated; verify against the DBM source before
  publication.
