# DPWH GAA lines to contracts, FY2020 to FY2026

Which DPWH contract carries each DPWH project line of the enacted budget (GAA), so the line can name its contractor,
and every contractor's figures from DPWH's contract list.

- Run: `npm run build:hgab-contractors` (`scripts/dpwh-contracts/run.sh`: download about 17 min, match about 7 min,
  site files 10 s). `REUSE=1` keeps the downloaded pages, `QA=1` adds the sample check. Python venv in
  `/tmp/dpwh-contracts-venv` (duckdb, rapidfuzz, pandas). Needs the multi-purpose map's lines first
  (`npm run build:hgab-mpb-years`).
- Scripts: `fetch.py` (contract list), `match.py` (the links), `qa.py` (sample check), `build_site.py` (the site's files).
- Working outputs: `data/dpwh-contracts/`, a symlink to `/data/backups/projects/ai-reports/data/dpwh-contracts` (the
  root disk is nearly full). Site files: `data/hgab/2027/contractors/`.

## On the site

| Where | What |
| --- | --- |
| `/hgab/2027/contractors` (DPWH menu → Contractors) | Every contractor: contracts, amount, joint ventures, years, main DPWH office, budget lines matched. Search by name or license number; one year or all; sort by amount, contracts, lines matched or name; the whole table as CSV |
| `/hgab/2027/contractors/:key` | One contractor: figures, amount by year, its DPWH offices, joint-venture partners, then every contract with the budget line matched to it (search, year, "with a matched line", CSV) |
| `/hgab/2027/multi-purpose/map` | Each FY2020–FY2026 line with a matched contract shows "Contractor: … · contract 23AE0052 (completed)", linked to the contractor's page, in the side panel and the list; contractor names and contract IDs join the search; "Download these" adds `contract_id, contractors, contract_php, contract_status, contract_match`. **Top contractors** (`src/components/MpbContractors.tsx`, `rankLineContractors`) ranks the contractors of the lines the controls and a picked district or place select, by lines, budget amount or contract amount, with contracts, years and the office that awarded most of them; CSV. "Show their lines" narrows the map and the list to one contractor (`?contractor=<key>`, a chip in the list). Without `mpb-links.json` the map works as before |

- Every contract ID on the contractor pages and the map links to DPWH's own record, in a new tab:
  `https://transparency.dpwh.gov.ph/?project=<contract id>` (`dpwhContractUrl`, `src/components/DpwhContractLink.tsx`).
  The CSVs carry the same URL (`dpwh_url`, `contract_dpwh_url`), so anyone can check our figures against DPWH's.
- Contract: `src/lib/hgab-contractors.ts` (pure: the pages, the map, the Worker's SEO code and the verifier import it).
- Page: `src/pages/HgabContractors.tsx`, styles `src/hgab-contractors.css`.
- Loaders: `loadContractorIndex`, `loadContractorShard`, and `loadMpbYears` in `src/lib/hgab.ts`.
- Nav: `PROGRAM_EXTRAS` in `src/components/HgabBits.tsx`.
- Disclaimer: `DISCLAIMER_CONTRACTORS` in `src/lib/hgab-disclaimers.ts`. The contractor pages carry it alone; the map adds
  it to its own.
- Checks: `npm run verify:hgab` has a `contractors/` section (`scripts/verify-hgab-contractors.ts`, 27 checks). It
  recounts DPWH's list, every contractor's figures against its contracts, the `[REVOKED]` tags, each linked line's
  amount against the GAA extract, the map's lines and awarding offices, the top-contractors count, the CSV and the copy. The shard hash is the page's own, so a
  Python/TypeScript difference fails.
- Publish: after a full verify, `npx tsx scripts/upload-hgab-to-r2.ts --only=contractors --skip-verify` (68 files). The
  CSV link versions itself (`?v=` from its SHA-256); JSON is cached 5 minutes.

Counting rules:
- **Contractor:** a contractor is its license number as DPWH lists it (`(23836)`, or `(OECO_27310)` for a foreign
  contractor). Its most common name is shown, and other names under "Also listed as". The 4 names that appear with two
  license numbers stay apart. A name with no number is keyed by the name.
- **Revoked:** DPWH's list tags some licenses `[REVOKED]`, either before the number or once before the name. A
  contractor tagged on any contract is shown as "license revoked in DPWH's list" (9 contractors).
- **Joint ventures:** contractors separated by ` / `. The contract counts in full for each partner, so amounts are
  never added across contractors.
- **Missing contractor:** 16,570 contracts name no contractor yet (nearly all "For Procurement") and are left out.

## Site files (`data/hgab/2027/contractors/`)

| File | What |
| --- | --- |
| `index.json` | Every contractor (6,728), `cols` + `rows`; offices and regions as dictionaries. 1.7 MB, 0.6 MB gzipped |
| `c/NN.json` | Each contractor's contracts, newest first, with partners and matched budget lines; 64 files by FNV-1a of the key (`shardOf`). 66 MB in all, about 0.2–0.4 MB gzipped each |
| `mpb-links.json` | The matched contract of each multi-purpose building line on the map (39,436 of the 49,376 FY2020–FY2026 lines): contract, contractors, amount, status, how matched, and the office that awarded it (`offices` dictionary). 2.7 MB, 0.6 MB gzipped |
| `contractors.csv` | The index as a spreadsheet, one row per contractor, with amounts by year and the page URL |
| `summary.json` | The list's download, totals, the GAA match table by year, the builder's checks, SHA-256 of every output |

## Sources

| Side | Source | Grain |
| --- | --- | --- |
| Budget | The site's GAA extracts, `data/18/full_extract.csv`: capital outlays (`uacs_exp_cd = 6`) with an amount, FY2020–FY2026 | One line per code and office (`line_id` = `gaa:<year>:<code>`, the same IDs as the multi-purpose map; `:<office>` added for the 2 codes split over two offices) |
| Contracts | `https://api.dpwh.bettergov.ph/projects`, our cached proxy over DPWH's transparency portal (repo `bettergovph/api.dpwh`), downloaded 2026-11-03: 267,292 contracts, FY2016–FY2026 | One row per contract, list fields only |

The list has the contractor (with PCAB IDs, joint ventures separated by `/`), office, amount, status, dates, and the fund
source, e.g. `Regular Infra - GAA 2023 SSP`. That fund year is the GAA year, so a line is compared only with contracts
funded from the same year's GAA. Each contract's detail record (components, bidders, documents) is not downloaded.

## Method

| Link | Rule |
| --- | --- |
| `one_to_one` | The titles agree (rapidfuzz token set ≥ 90 after expanding abbreviations such as Brgy, Bldg and MPB) and the contract is 50–102% of the line |
| `bundle` | One contract whose title takes in 2 or more lines; the contract is 50–102% of the lines together (DPWH "clusters") |
| `none` | No contract found. Never filled with a guess |

- District office lines are compared with that office's contracts. Lines not found there are then compared with the
  region's other offices, at the stricter threshold of 95.
- Central Office lines name no implementing office, so they are compared with every contract of that year.
- Pairs are taken best first: title score, then how close the amount is to a typical award (97% of the line).
- Except in a bundle, a contract links to one line only.
- Guards:
  - A road line's first station (`K0367 + 770`) must be among the contract's stations, when the contract lists any and
    its description is not cut off at 255 characters.
  - A Package or Phase number must not contradict the contract's.
- Splits (several contracts adding up to one line) were tried and left out. The sample check found only a third of
  them right.

## Results

| Year | GAA lines | Linked | in bundles | GAA pesos | Pesos linked | Contracts linked |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| FY2020 | 21,055 | 15,915 (76%) | 233 | ₱558.0B | 58% | 15,751 of 21,152 |
| FY2021 | 28,422 | 17,483 (62%) | 287 | ₱675.4B | 50% | 17,287 of 22,769 |
| FY2022 | 22,866 | 17,132 (75%) | 129 | ₱770.7B | 68% | 17,052 of 22,808 |
| FY2023 | 23,263 | 17,234 (74%) | 168 | ₱874.6B | 68% | 17,119 of 24,528 |
| FY2024 | 24,955 | 18,792 (75%) | 127 | ₱977.7B | 70% | 18,704 of 26,894 |
| FY2025 | 25,596 | 18,447 (72%) | 122 | ₱1,068.7B | 63% | 18,359 of 24,434 |
| FY2026 | 18,132 | 4,599 (25%) | 5 | ₱496.9B | 21% | 4,596 of 5,868 |

- **FY2020–FY2025:** 72% of lines and 64% of pesos are linked.
- **Unlinked pesos** are mostly Central Office lump sums: right-of-way payments, foreign-assisted projects,
  quick-response and rehabilitation funds, and expressway programs. These are not single DPWH contracts.
- **FY2021** has 28,422 lines for 22,769 contracts. Lines there were often merged into fewer contracts that the titles
  don't show.
- **FY2026:** 10,753 of its contracts are still "For Procurement", with no fund source or contractor yet. Re-run as
  they are awarded.

## Accuracy (`qa.json`)

`qa.py` takes a sample of each kind of link and fetches only those contracts' detail records, 299 in this run. DPWH
writes each component as `<type of work> - <title as in the GAA>`, so the check is whether a component's title equals
the line's (ratio ≥ 90).

- 284 of the 299 were confirmed this way: 98–100% for links within the line's own office or region, 90% for region
  links with several candidates, and 86% for bundles.
- Read by hand, most of the rest are the same project worded differently, or cluster contracts cut off at 255
  characters. Real errors were about 1 in 100 one-to-one links and 1–2 in 60 bundle links.
- The errors seen were:
  - a bridge line linked to a river revetment "at the bridge section"
  - an adjacent road segment
  - a road line inside a multi-purpose building cluster

Present links as likely ("matched by title, office and amount"), not as DPWH's own record.

## Working files (`data/dpwh-contracts/`)

| File | What |
| --- | --- |
| `contracts.parquet`, `contracts.jsonl.gz` | The contract list as downloaded, every field, all years |
| `contracts.meta.json` | Source, download times, count (checked equal to the API's total, no repeated IDs), the API's summary |
| `raw/page-NNNN.json.gz` | The 54 API pages as received |
| `gaa-2020-2026/links.csv`, `.parquet` | One row per link: line, title, office, amount; `contract_id`, `contractor`, `contractor_names`, `contractor_pcab_ids`, `contract_php`, the contract's description, office, status, progress and dates; `method`, `searched` (same office, same region, all offices), `title_score`, `amount_ratio`, `candidates` (contracts that qualified for the line) |
| `gaa-2020-2026/lines.csv`, `.parquet` | Every line, linked or not: `match`, `contracts`, `contract_ids`, `contractors`, `contract_php` (for a bundle, the whole contract, shared with its other lines) |
| `gaa-2020-2026/summary.json` | Per year as in the table; the build's checks: line totals equal the extract, IDs unique, a contract used once outside bundles, every link within its own GAA year, the amount rules |
| `gaa-2020-2026/qa.json` | The sample check, with every miss |
