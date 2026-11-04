# Foreign-assisted projects (`/hgab/2027/foreign-assisted`)

Status: built 2026-11-04, PR #62 (branch `hgab-foreign-assisted`); fap.json and fap.csv are on R2 (uploaded 2026-11-04); the page goes live when the PR merges. Not yet reviewed by Jason. Jason: "let's start our
report on foreign assisted projects", with section 2.3.1 of PBC's House bill assessment as the reference and a
look back at how previous budgets compared.

| | |
| --- | --- |
| Contract | `src/lib/hgab-fap.ts` (pure: the page, the builder, the verifier and the Worker's SEO read it) |
| Build | `npm run build:hgab-fap` (`scripts/build-hgab-fap.ts`, DuckDB, about 20 seconds) |
| Output | `data/hgab/2027/fap.json` (`FapData`) and `fap.csv` (one row per project); published by the next `upload:hgab` |
| Verify | `npm run verify:hgab` (`scripts/verify-hgab-fap.ts`, 30-odd checks) |
| Page | `src/pages/HgabFap.tsx`, `src/hgab-fap.css`; sub-nav tab "Foreign-assisted" after Leaderboards (`HgabBits.tsx`) |

## What the page says

- **FY2027.** The House bill lists 65 projects paid for with foreign loans or grants: ₱416.6 billion in the NEP,
  ₱285.9 billion in the bill, a cut of ₱130.7 billion. 31 projects cut, 30 unchanged, 4 new DPWH lines
  (₱0.8 billion together), none raised. The cut is 64% of everything the House took out of the bill's lines
  (₱203.3 billion at the activity grain). Loan proceeds take ₱103.5 billion of the cut (₱271.2 → ₱167.7 billion),
  the government counterpart ₱27.2 billion (₱145.4 → ₱118.2 billion). DPWH loses 62% (₱117.7 → ₱44.7 billion on
  29 lines), DOTr 18% (₱232.2 → ₱189.4 billion). Largest cuts: Laguna Lakeshore Road Network −₱27.0B, Metro
  Manila Subway −₱19.7B, NSCR −₱15.0B, Bataan–Cavite Interlink Bridge −₱14.0B, Cebu–Mactan 4th Bridge −₱6.0B.
- **The look back (DBM's own series, BESF Table B.13).** Every enacted budget since FY2021 carried 53% to 98%
  less for these projects than the NEP proposed (FY2024: ₱246.1 billion proposed, ₱4.0 billion enacted). Actual
  obligations stayed between ₱142 and ₱194 billion a year regardless, because releases from the unprogrammed
  appropriations ("Support to Foreign-Assisted Projects") covered the projects: ₱110.4 billion released in FY2025
  alone (DPWH ₱58.8B, DOTr ₱30.7B, …), listed in the FY2027 NEP Volume III page 961. The FY2027 NEP programmed
  ₱416.6 billion, more than any year before it, and brought the standby down to ₱42.6 billion (from ₱97.3 billion
  in FY2026). The House's 31% cut is smaller than any enacted cut since FY2021, but the bill leaves the standby at
  ₱42.6 billion and adds nothing; it does rank the purpose first among the four (Special Provision No. 1,
  Volume I-B page 607).
- **Three questions for the Senate**: restore or move to unprogrammed; the cost of late drawdowns against a
  ₱42.6 billion standby; what the ₱27.2 billion counterpart cut paid for.

## Sources and reconciliations

| Figure | Source | Check |
| --- | --- | --- |
| FY2027 NEP and House bill by project | the line-by-line dataset (`explorer/downloads/house-bill-2027-lines-vs-nep.parquet`), rows under "Foreign-Assisted Project(s)" with their Loan Proceeds / GOP Counterpart parts | the projects' NEP side equals every line of the DBM NEP extract whose seventh P/A/P digit is 3 (fund 101\*), ₱416,592,948,000, which is also BESF 2027 Table B.13's FY2027 proposed figure to the thousand |
| One DPWH line (Accelerated Bridge Construction Project, ₱1.76B NEP → ₱0.96B) | the matcher left it without an NEP side; taken from the NEP extract by exact name | `nep_match: 'name'`; at most one such line |
| DPWH | `dpwh/projects.parquet` `zone = 'fap'` (29 lines) | equal to the DPWH rows here, and every line links to its record (name, else the unique pair of amounts) |
| Lenders | NEP fund names per line (ADB ₱115.3B, Japan ₱97.8B, IBRD ₱49.0B, Korea ₱6.8B, IFAD ₱1.9B, AIIB ₱0.5B; counterpart ₱145.4B) | add up to the NEP total; the bill has no lender split, only proceeds vs counterpart |
| FY2020–FY2026 enacted | `data/gaa-history/parquet/gaa-<fy>.parquet`, same code mark | equal to BESF's "program" figure for FY2020, FY2021, FY2023–FY2026; FY2022 differs by ₱1.69B (BESF = as adjusted) |
| DBM series FY2019–FY2027 | BESF Table B.13 editions 2021–2027 (`BESF_EDITIONS`); the 2023, 2024 and 2027 editions are image-only PDFs, read with tesseract (`/tmp/fap-ref/besf/`) | every cell's GOP + loan + grant = total; department rows ≤ totals |
| Unprogrammed | FY2027 NEP Vol III pp. 961–965 (FY2025 releases by agency, FY2025/2026 totals, FY2027 purposes); HB 10858 Vol I-B pp. 607–608; PBC's FY2026 UA-Items sheet (₱97.3B support in NEP, House and Senate; House added ₱35.8B "GOP Counterpart of FAPs") | parts add up; NEP and bill identical for FY2027 |

The reference (PBC 2.3.1) puts the cut at ₱130.0 billion on ₱414.8 → ₱284.8 billion: it leaves out the
corporations (NIA's Jalaur under BSGC) and the smallest departments and counts the Accelerated Bridge line as a
cut of ₱0.8B, as we do now. Its 30 cuts and 4 raises match our 31 cuts and 4 new lines (the Accelerated Bridge is
our 31st cut).

## Not done yet

- Deploys with the merge (Workers Builds). Re-run `build:hgab-fap` and the upload if the line-by-line dataset or the
  NEP extract changes.
- No poster or share image. No "What's new" entry on `/docs`. No API endpoint.
- The FY2026 enacted standby (₱97.3B) is PBC's Senate-bill figure; the GAA's own unprogrammed annex was not read.
- Jason's review of the copy.
