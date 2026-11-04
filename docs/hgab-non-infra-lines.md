# House bill line by line (HB 10858 against the NEP)

Status: live since 2026-11-01. The explorer is at `/hgab/2027/explorer`, and the line-by-line
dataset downloads from its "Download the data" section (`#downloads`).

It went live before a full review, so every line-by-line page, the downloads section and the whole-bill
boards carry an "Under citizen review" banner (`UnderReviewBanner`). Its "Report a wrong line" link opens
a GitHub issue on this repo with the page address filled in. Set `LINES_UNDER_REVIEW` in
`src/lib/hgab-explorer.ts` to `false` once the review is done.

| | |
| --- | --- |
| Code | `scripts/hgab-lines/` (Python, PyMuPDF and DuckDB in a uv venv at `/tmp/hgab-lines-venv`) |
| Run | `npm run build:hgab-lines` (`scripts/hgab-lines/run.sh`, about 2 minutes) |
| Working outputs | `data/hgab-lines/2027/`, deliberately not under `data/hgab/2027/`, which `upload:hgab` publishes wholesale |
| Explorer data | `data/hgab/2027/explorer/`, published with the next `upload:hgab` |
| Downloads | `data/hgab/2027/explorer/downloads/` (`build_downloads.py`, the last step of `run.sh`) |
| UI | `src/pages/HgabExplorer*.tsx`, `src/components/HgabExplorerBits.tsx`, `src/lib/hgab-explorer.ts`, `src/hgab-explorer.css` |

Every money line in the House bill's appropriation tables is set beside the NEP line it matches,
in the shape of the GAA/NEP extract. That covers every agency's tables, the special purpose funds,
GOCC subsidies and LGU allocations. DPWH's project list (Vol I-C), farm-to-market roads, HFEP and NIA
irrigation keep their workbench pages. Their lines appear here too, tagged with a link to those pages.

## Sources

HB 10858 as published for the 3rd reading, Vols I-A and I-B. These are byte-identical to
`hgab/2027/pdf/hb10858-3r-vol-i{a,b}.pdf` and to the workbench's `HB_BUDGET_3rd_reading/`. The 2nd
reading is the workbench's `HB_BUDGET/` copy. The NEP side is `NEP-FY2027.csv`, fund 101\* (new
appropriations). For the NEP page of each line, the NEP itself: Vols I, II-A, II-B and III, the
machine-read scans in the workbench's `dbm-nep-data/` (`NEP_PDF_DIR`), hosted as
`hgab/2027/pdf/nep2027-vol-{i,iia,iib,iii}.pdf` (II-B was already hosted for DPWH, byte-identical).

| Volume | Holds | Parsed |
| --- | --- | --- |
| I-A | Congress to DND (I–XXI) | three money tables per agency |
| I-B | DPWH to CHR (XXII–XXXV); special purpose funds, GOCCs and LGUs (XXXVI–XLIII); the Summary of New Appropriations (p. 637); annexes | tables, plus the DepEd and barangay development annexes. FMR, HFEP and NIA stay with the workbench |
| I-C | DPWH project detail | no (workbench) |
| II | Performance indicators, no pesos | no |

The bill prints no UACS codes. Per agency it publishes three tables:

- by program;
- by activity, broken down by region, operating unit and (for DepEd) school, with foreign-assisted
  projects split into loan proceeds and GOP counterpart;
- by object of expenditure, in thousands.

The special purpose funds and LGU allocations print "by Purpose" tables instead.

## Parser (`parse_hb.py`, `flatten.py`)

The parser reads PyMuPDF word boxes, strips the printed line numbers in both margins, and assigns
amounts to columns by each table's own headers. It types every row as section, class, program,
sub-program, activity, region, office, sub-unit or fund. Indent alone is unreliable: DA drifts about
3pt, and programs print at the same indent as their activities. Wrapped names are rejoined, including:

- hanging indents of up to 12pt, or 14pt for a "(" continuation;
- names whose amounts sit on the first line;
- three-line school names;
- labels ending in "-".

Source quirks it absorbs:

- "Regional I - Ilocos"
- "National Island Region (NIR)"
- "TOTAL NEW APPOPRIATIONS"
- "117,681,000.0"
- "1295" with no comma
- a subtotal printed without "Total"
- DPWH labels printed twice
- Coast Guard districts named like regions
- fund splits above the region (DSWD) and below the office (DAR)

`flatten.py` writes one row per leaf and expense class, in integer pesos. Each row keeps its
volume, PDF page, the page number shown on the page and the line. The columns map onto the GAA
extract: department, agency, P/A/P path, region, operating unit (division and school for DepEd),
fund source, `uacs_exp_cd` and amount.

## Checks (all pass)

| Check | Result |
| --- | --- |
| Every printed parent = sum of its children; every table's leaves = its TOTAL NEW APPROPRIATIONS | 1,110 tables, both readings |
| Per agency: program table = activity table = object table × 1,000 = line items | 370 / 370 |
| Agency and department lines of the bill's own Summary of New Appropriations | 378 equal (the other 54 are group headings); all 440 Summary lines identical in both readings |
| Grand total | ₱4,606,066,495,000, both readings, equal to the Summary |
| Without Unprogrammed Appropriations (₱111,984,494,000) | ₱4,494,082,001,000 = NEP new appropriations, to the peso |
| DepEd annex: schools sum to divisions, divisions to regions, regions to its Grand Total | 221 divisions, 8,573 schools; all 663 division values equal the main table's "Division Office - Proper" lines |
| Barangay development annex | 1,948 barangays, numbered 1–1,948 with no gaps, as the special provision says |
| Object comparison: bill leaves = TOTAL NEW APPROPRIATIONS; NEP objects = NEP agency totals | 370 / 370; 368 / 368 |
| Explorer: every agency tree sums to its NEP and House bill totals | 370 / 370 |

## Matching (`compare.py`)

**Agencies.** Matched by name: 351 directly. Another 10 match under a different department; for
example, the bill files NAPC and PCUP under OEOs and the NEP files them under DSWD. Special purpose
funds match their NEP section-2 names.

**Activities.** Each bill leaf is matched at the deepest P/A/P level it prints. GOCC subsidies
print only the program, matched through NEP's code hierarchy (program = 4 digits, sub-program = 6).
Methods, in order:

1. exact names;
2. names within 0.88 similarity;
3. a bill name whose words all appear in exactly one NEP name (DPWH drops "...and Other Related
   Activities -");
4. the 2nd reading's label for anything the 3rd reading renamed. DOH's "Medical Assistance Program
   (MAP)" is MAIFIP in the 2nd reading, with the same amounts.

**Locations.** Matching runs in three passes:

1. exact names;
2. office and school names within 0.85 similarity inside the same office or division;
3. DepEd division offices take whatever their division has left.

**DepEd.** The bill's main table names only implementing-unit schools. The annex
(`parse_annex_deped.py`) splits each division-office line into the office and its schools, the
grain the NEP uses.

**Outputs.**

| File | Contents |
| --- | --- |
| `hb_vs_nep_lines.csv` | every bill line (49,084 after the annex split), with NEP amount, status and how it was matched |
| `nep_only_lines.csv` | NEP rows no bill line claims |
| `activity_rollup.csv` | per activity and expense class; separates money that changed from money moved between offices |
| `rename_candidates.csv` | bill-only and NEP-only pairs in the same agency |
| `review_matches.csv` | 309 lines to look at before publishing (fuzzy or unmatched) |

**Results** (non-infra scope, 47,519 lines, ₱3.94T):

| Status | Lines | House bill | NEP |
| --- | ---: | ---: | ---: |
| same, to the peso | 46,877 | ₱2,946.58B | ₱2,946.58B |
| lower | 257 | ₱541.06B | ₱655.54B |
| higher | 86 | ₱315.12B | ₱238.11B |
| House bill only (activity found, location not) | 242 | ₱11.09B | — |
| House bill only (no such activity in the NEP) | 51 | ₱17.05B | — |
| unprogrammed (not in the NEP extract) | 5 | ₱111.98B | — |

NEP coverage overall: ₱4,488.43B of ₱4,494.08B claimed (99.87%). There are 257 NEP-only rows (₱5.66B).

**By activity.** 4,559 activity × expense-class pairs are the same. 58 are higher (+₱75.40B) and 73
lower (−₱111.86B). Another 15 keep the same total but move money between offices (₱303.87B, mostly
DepEd schools; also PDEA's regional pay, now under its Central Office). 15 are House-bill-only
(₱7.37B) and 6 NEP-only (₱0.95B).

**By department** (against full NEP totals):

| Department | Change |
| --- | ---: |
| DOTr | −₱40.45B |
| DSWD | +₱22.17B |
| DOH | +₱12.23B |
| DA | +₱11.15B |
| DOLE | +₱6.19B |
| DepEd | −₱6.17B |
| Congress | +₱5.00B |
| DICT | −₱4.17B |

**Largest single lines** (checked against the PDF text):

| Line | NEP | House bill | Change |
| --- | ---: | ---: | ---: |
| DSWD crisis assistance (Protective Services) | ₱33.23B | ₱58.04B | +₱24.81B |
| DOH MAP/MAIFIP | ₱24.23B | ₱48.19B | +₱23.97B |
| NSCR loan proceeds | ₱97.61B | ₱82.61B | −₱15.00B |
| Metro Manila Subway loan proceeds | ₱26.71B | ₱11.71B | −₱15.00B |
| DA Presidential Assistance for Farmers and Fisherfolk | none | ₱10.00B | +₱10.00B |
| Pension and Gratuity Fund | | | −₱10.00B |
| NDRRMF rehabilitation | | | −₱7.75B |

## Other comparisons

**2nd vs 3rd reading** (`compare_readings.py`, `reading_changes.csv`). Five lines change, a gross
₱768M, all within one agency each:

- DPWH right-of-way −₱134M, against +₱68M and +₱66M for the Metro Manila 3rd DEO;
- DOTr Service Contracting moves ₱250M from operating expenses to capital outlays.

DOH's MAIFIP is renamed MAP with the same amounts.

**Objects** (`compare_objects.py`, `object_compare.csv`, thousands). Bill object lines map to NEP
7-digit objects by name, by UACS sub-object names, and by sum evidence across agencies. 99.90% of
House bill thousands land in comparable units:

| Status | Units | Change |
| --- | ---: | ---: |
| same | 10,667 | — |
| increased | 134 | +₱123.80B |
| decreased | 116 | −₱128.11B |
| bill-only | 17 | ₱4.48B |
| NEP-only | 3 | ₱0.21B |

The biggest moves:

- DOTr infrastructure outlay −₱42.0B
- DPWH buildings +₱42.0B against infrastructure −₱30.5B
- DOH financial assistance +₱22.7B
- DSWD subsidies +₱22.0B

**Barangay development program** (`parse_annex_sbdp.py`, `sbdp_barangays.csv`). The annex lists the
1,948 NTF-ELCAC-cleared barangays that share ₱9,740,000,000. It prints no amount per barangay, so
none is assigned.

## The explorer (`/hgab/2027/explorer`)

`build_explorer.py` writes `index.json` (43 departments) and one file per department under
`d/<id>.json`. DepEd is the largest, at 4.4 MB (0.6 MB compressed).

- **Index ("Line by line" in the sub-nav).** Departments with NEP, House bill, change and the
  number of lines that differ.
- **Department page.** Agencies, then the bill's own hierarchy down to expense classes, built from
  the existing NEP and HGAB components:
  - status chips: Same, Higher, Lower, House bill only, NEP only, Unprogrammed;
  - "Same total, moved within" on rolled-up rows;
  - a search box, and an "Only lines that differ" toggle (on by default; `?all=1` turns it off);
  - a CSV download per agency;
  - every row links the page that prints it in the NEP and in the House bill (below). A group row
    links the first page where it appears in each.
- Copy follows `docs/hgab-copy.md`, and every page carries the comparison disclaimer.

## On the overview (`HgabWholeBill`, `explorer/summary.json`)

The overview opens with "The whole House bill · line by line", above the four programs' sections,
which are unchanged. `build_explorer.py` writes `summary.json` from the same rows as the explorer and
`boards.json`, so the overview, the explorer and the leaderboards cannot disagree. It holds:

- the totals;
- what was raised or added and what was cut or dropped, line by line without unprogrammed
  appropriations (equal, ₱219,772,824,000 each, since the programmed totals are equal);
- the status counts and the number of departments up, down and unchanged;
- the top 5 departments each way, the top 3 by percent (₱1B or more in the NEP);
- the top 5 lines each way, and the new lines (43, ₱21.85B, excluding the four project-list
  programs);
- the second-to-third-reading changes.

The section carries the compact "Under citizen review" banner. Each list links its leaderboard and
each row its explorer page. A note says the figures are at the level the bill's tables print, and
quotes DPWH's insertion candidates from `overview.json` to show projects moving inside lines.
`verify:hgab` checks `summary.json` against `index.json` and `boards.json` (six checks).

## Why the NEP browser shows a bigger department total (`index.json` `nep_departments`)

The NEP browser (`/2027/d/<code>`) shows a department's money in every fund, for every agency DBM files
under it. For DPWH it shows ₱643.95B, while the line-by-line NEP is ₱642.61B. The bill carries new
appropriations (fund 101) only. The rest is automatic appropriations (fund 104): retirement and life
insurance premiums, debt interest and special accounts, which no bill votes on. A few agencies are
also filed under another department in the bill. For example, DBM files the National Anti-Poverty
Commission and the Presidential Commission for the Urban Poor under DSWD; the bill lists them under
Other Executive Offices.

`build_explorer.py` reconciles each of the 37 section-1 NEP departments:

```
NEP browser total = automatic appropriations + new appropriations of the agencies the bill keeps there
                    + new appropriations of the agencies it files elsewhere
```

It then puts the result in `index.json` (`nep_departments`) and on each department page
(`nep_browser`). The live API's department totals equal `all_funds_php` for all 37.

- **Explorer department page:** says why the NEP browser shows more.
- **NEP browser department page:** a "House bill, line by line" card with new appropriations against
  the House bill, the same explanation, and a link to every line.
- **Checks:** `verify:hgab` checks both reconciliations.

| DPWH | Amount |
| --- | --- |
| New appropriations (NEP Vol II-B p. 4; the workbench's "full agency new appropriations") | ₱642,612,015,000 |
| Retirement and life insurance premiums (automatic) | ₱1,313,088,000 |
| National Building Code Development Fund (automatic) | ₱28,173,000 |
| NEP browser | ₱643,953,276,000 |

The workbench's own tables, and our DPWH pages (`/hgab/2027/dpwh`), compare DPWH projects only:
₱572.924B in the NEP and ₱587.076B in the House bill. They leave out administration and support (the
bill's General Administration and Support and Support to Operations): ₱69.688B in the NEP and ₱67.026B
in the House bill.

| DPWH | NEP | House bill |
| --- | --- | --- |
| Projects (DPWH pages) | ₱572,924,074,000 | ₱587,075,661,000 |
| General Administration and Support | ₱18,078,293,000 | ₱18,078,293,000 |
| Support to Operations | ₱51,609,648,000 | ₱48,948,061,000 |
| All of DPWH (explorer) | ₱642,612,015,000 | ₱654,102,015,000 |

All of DPWH is the headline everywhere. It comes from the documents' printed new appropriations
(`overview.json` `printed`), which equal the explorer's line-by-line totals; `verify:hgab` checks this.
The projects are the breakdown.

- **DPWH page figures:** "NEP · all of DPWH" and "House 3R · all of DPWH", with the projects in their
  sub-lines.
- **DPWH page header:** the same totals.
- **Overview's DPWH card:** "All of DPWH", then its projects by reading.

Where each page says so:

- **DPWH page:** a line under its figures (`ProjectsVsWholeNote`).
- **Explorer's DPWH page:** the same line.
- **NEP browser's DPWH projects card:** "projects only".
- **Check:** `verify:hgab` confirms that the explorer's DPWH, minus those two classes, equals the DPWH
  pages' totals in both documents.

## Proof of reference: NEP pages (`nep_pages.py`)

The NEP CSV has no page numbers. The NEP volumes print the same lines in each agency's table "New
Appropriations, by Programs/Activities/Projects (Cash-Based), by Operating Units". Each activity's
UACS code is printed, then each region and office on one visual line, with amounts by expense class.

`nep_pages.py` reads every page into visual lines of label, amounts and the activity code in force,
in about 17 seconds, cached as `nep_pdf_lines.json.gz`. Running heads give each page's department
or fund; within a department, an agency's pages are where its amounts cluster. It then gives each of
the 48,910 NEP rows (compare.py's grouping) a page, in this order:

| How | Rows | Share of NEP pesos | What the page prints |
| --- | --- | --- | --- |
| line | 27,436 | 89.3% | this line: same activity code, the office's name, the amount |
| amount | 392 | 3.3% | this line: same activity code and amount (activity-level rows, or a name the scan garbled) |
| division | 20,297 | 1.7% | a DepEd school with no budget of its own (on the bill's Vol I-B list): its division's "Division Office - Proper" line |
| division_list | 149 | 0.0% | another DepEd school whose name was not found: where its division's list begins |
| program | 93 | 3.1% | an activity printed only inside its program total (GOCC subsidies, e.g. PhilHealth's two activities inside "National Health Insurance Program") |
| activity | 515 | 2.5% | where the activity's table begins (e.g. DPWH Central Office projects printed on the NCR line) |
| none | 28 | 0.0% | no page |

`compare.py` gives each line the page of its most firmly pinned NEP row. A House-bill-only line
gets the NEP's table for its activity, which has no such line: the proof of absence. In the
explorer these are `q` (`[volume, PDF page, printed page, how?]`) beside the House bill's `p`.

The rules that keep false pages out came from checking against the PDFs:

- **Generic words.** Names are compared on their distinctive words. "Tinubdan Integrated School"
  otherwise looks like "Tabunan Integrated School".
- **Crowded activities.** Under an activity with many lines, such as DepEd's junior high schools
  (3,380 lines), an equal amount alone is not enough; the label must agree, and a school must sit
  under its own division.
- **OCR variants.** A running head read as "DEPARTMENT DF EDUCATION" does not count as a new section.
- **Missing page numbers.** Printed page numbers missing from the scan are filled from neighbouring
  pages when both sides agree.

**Spot check** (independent, from the PDFs): of 1,800 random lines linked to their own NEP line,
1,793 have the amount printed on that page and 7 have the name, with an amount the scan misread.
All 150 sampled division links land on a page with a Division Office line, and 400 of 400 House
bill links have the House bill amount printed on the page.

**Checks** in `verify:hgab`:

- every House bill line links its House bill page;
- at least 99.5% of NEP lines link their NEP page (48,827 of 48,855);
- House-bill-only links are marked as such;
- every linked PDF is in the tree.

## Downloads (`explorer/downloads/`)

`build_downloads.py` turns the working outputs into reader-facing files. The columns are renamed
for readers, amounts are in whole pesos, and the status codes are spelled out. It writes:

| File | Rows | From |
| --- | --- | --- |
| `house-bill-2027-lines.csv` + `.parquet` | 29,022 | every 3rd-reading line (`hb_line_items.csv`) |
| `house-bill-2027-lines-2nd-reading.csv` | 29,021 | the 2nd-reading print |
| `house-bill-2027-reading-changes.csv` | 7 | lines that differ between the readings |
| `house-bill-2027-lines-vs-nep.csv` + `.parquet` | 49,084 | `hb_vs_nep_lines.csv`, DepEd schools expanded from the annex |
| `nep-2027-lines-not-in-house-bill.csv` | 257 | `nep_only_lines.csv` |
| `house-bill-2027-objects-vs-nep.csv` + `.parquet` | 10,959 | `object_compare.csv`; thousands × 1,000, and multi-page references kept as text (`27;33;34`) |
| `house-bill-2027-deped-schools.csv` | 8,811 | the Vol I-B non-implementing schools list |
| `house-bill-2027-sbdp-barangays.csv` | 1,948 | the SBDP barangay list (no amounts) |

It also writes:

- `README.md`, the data dictionary, generated from the same `FILES` table that writes the CSVs, so the
  two cannot drift;
- `manifest.json`, with the build time, the pipeline commit, totals, and each file's rows, columns,
  size and SHA-256;
- `house-bill-2027-line-by-line.zip` (2.3 MB), which holds every CSV and the README.

The vs-NEP status values are `same`, `higher`, `lower`, `house_bill_only_line`,
`house_bill_only_activity`, `unprogrammed` and `agency_not_in_nep`. The `scope` column marks lines
covered by a workbench page: `dpwh_projects`, `farm_to_market_roads`, `health_facilities`,
`nia_irrigation`; everything else is `whole_bill`.

**Where they show.** The explorer index has a "Download the data" section (`#downloads`): the zip, the
README, and a table of files with rows, sizes, and CSV and Parquet links. Each department page links
to it, and `/hgab/2027/sources` lists the zip, the two main Parquet files and the README.
Links carry `?v=` plus the first 12 characters of the file's SHA-256. Cloudflare caches `.csv` and
`.zip` under their fixed names, keeps the old headers when it revalidates, and neither of our tokens
can purge it, so each rebuild gets new addresses.

**Checks.** `verify:hgab` adds five:

- the manifest is present;
- every listed file matches its size and SHA-256;
- rows and columns match the manifest, and each CSV matches its Parquet;
- lines add up to the House bill, vs-NEP rows add up to both documents (NEP plus NEP-only rows
  equals the NEP), and the bill minus unprogrammed equals the NEP;
- the zip holds the README and every CSV.

**Fixes made while building them.** Annex school rows now point to Vol I-B, where the schools list
is printed; they used to point to the Vol I-A division line. A printed page number ("711") no longer
leaks into the first school name on an annex page.

## Leaderboards (section "2027: the whole House bill, by department")

There are nine boards of kind `lines` in `src/lib/hgab-leaderboard.ts`. They rank rows from
`explorer/boards.json`, which `build_explorer.py` writes and the leaderboard loader attaches as
`whole_bill`. `leaderboard.json` itself is unchanged.

| Board | Ranks | Top of the board |
| --- | --- | --- |
| `departments-increase` / `departments-cuts` | departments and special purpose funds, House bill minus the NEP | DSWD +₱22.07B; DOTr −₱40.45B |
| `departments-increase-pct` / `departments-cuts-pct` | the same, in percent (₱1B+ in the NEP); the mixed-sign `departments-pct` was split on 2026-11-01 and its links open the cuts board | Congress +18.5%, DOLE +13.1%; DICT −33.3%, CSC −27.8% |
| `agencies-increase` / `agencies-cuts` | agencies, GOCC subsidies and funds | DSWD Office of the Secretary +₱22.07B; DOTr Office of the Secretary −₱40.45B |
| `lines-increase` / `lines-cuts` | budget lines in both documents, all regions, offices and expense classes added up | DSWD crisis assistance +₱24.81B; Metro Manila Subway −₱19.70B |
| `lines-added` | budget lines with no line of that name in the NEP (candidates) | DA Presidential Assistance for Farmers and Fisherfolk ₱10.00B |

**What the boards include.**

- **Department and agency boards:** everything, DPWH projects included.
- **Line boards:** leave out DPWH projects, farm-to-market roads, HFEP and NIA projects; DPWH's
  administration and support lines stay. A line renamed between readings is one line (MAP is
  MAIFIP).

**How they look.**

- No faces and no districts, and the comparison disclaimer instead of the office one.
- The as-of date is the whole-bill build date.
- Each table row links to its explorer page.

**Checks.** `verify:hgab` adds four:

- `boards.json` is present;
- departments and agencies each add up to the bill's programmed total and the NEP;
- every row's change equals House bill minus NEP, and every row has an explorer link;
- the line boards contain no farm-to-market, HFEP or NIA lines.

It also checks that every whole-bill board's first row is the true extreme of its pool, that an
increases board holds no cut and a cuts board no increase, and that every retired board id opens a
current board.

**Link previews.** Build them with
`npm run build:hgab-share -- --boards=departments-increase,departments-cuts,departments-increase-pct,departments-cuts-pct,agencies-increase,agencies-cuts,lines-increase,lines-cuts,lines-added`.
They land in `data/hgab/2027/share/`. Rebuild them after `npm run build:hgab-lines` whenever the
figures change.

## Open

- Review `review_matches.csv` (309 lines): fuzzy agency, activity, office and school names, and 51
  House-bill-only activities. Then switch off the "Under citizen review" banner (`LINES_UNDER_REVIEW`).
- Live since 2026-11-01 (PRs #34 and #36). A data refresh means `npm run build:hgab-lines` (which
  rebuilds the downloads too), then the whole-bill previews with `build:hgab-share`, then
  `upload:hgab`. That uploads the whole `hgab/2027` tree, including anything else built locally, so
  check its dry run first. Rebuild the downloads after committing, so `manifest.json` names a commit
  that exists.
- Not yet in the D1 API or MCP.
