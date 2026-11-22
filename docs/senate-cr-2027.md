# Senate Committee Report on HB 10858 (FY2027): parsed and mapped to the House bill

The Senate Committee on Finance's report on the FY2027 General Appropriations Bill (HB 10858) is the
budget's next stage after the House bill. It comes as born-digital PDFs (the files in
"Senate CR 2027.zip", from Jason, 2026-11-20; prepared by LBRMO 2026-11-19), so it is parsed
from the text layer with word positions (pdfplumber). It is not OCR'd or read by an LLM. Every amount is
checked against a printed total.

`npm run build:senate-cr` runs `scripts/senate-cr/run.sh` (about 2 minutes). The outputs go to
`data/senate-cr/2027/`. That is not under `data/hgab/2027`, so `upload:hgab` does not publish them.

The outputs are not committed: `data/` is gitignored, and they rebuild exactly from the PDFs. The PDFs aren't
committed either. A copy sits in `data/senate-cr/2027/pdf/` with `SHA256SUMS`, and these are the checksums of
the inputs this pipeline was built and checked against:

```
7345416b34d94c36b3696059f1907ddc3d2e64cc4904b484613a30c5b75e53bd  General Summary of Committee Report No. __ on House Bill No. 10858 (FY 2027 GAB).pdf
77065842846fe14f2942464d8ba6ddca9b13200445dfe4ecf483fafeb4a7abb8  Annex A - Line By Line Amendments (1).pdf
176ff3411000942d858d9e4850a965cf1d7cafb85e9137d7d1b74d17c80484e8  Annex A-1 DA Farm-to-Market Roads.pdf
87ff59ac9f0fbd8ec541252370918bc45080b9977d0ca2261bb745229ef5e5dd  Annex A-2 DOH Health Facilities Enhancement Program (HFEP).pdf
587dcd6b83f32c172b88cbaaab601e69f628c46e136faad0347730cf16895824  Annex A-3 BSGC-OEOs-NIA-Details of NIA's Operations Budget.pdf
8b849fd8661d142ae9b35d35238e8d3d76d688f279ee4fbca9f1a90e90750194  Annex A-4 Details of DPWH's Programs-Projects (FY 2027 General Appropriations Bill Volume I-C).pdf
e845de4fdaf729053580eb80b72fe8c7c62c0134f1d7fe9e295eb9f5071541e4  Annex A-5 Details of BSGC-DOT-TIEZA and TPB.pdf
e562247978059abbce55aefb6c2133a10c569522f5fdb3103465776782e51719  Annex B - Amendments to the Special and General Provisions.pdf
```

## What the report contains

| File | What it is | Parser | Output |
|---|---|---|---|
| General Summary (8 pp.) | House bill vs committee report by department and agency, thousand pesos | `parse_summary.py` | `general_summary.json` |
| Annex A (167 pp.) | Line-by-line amendments to Vol I-A and I-B. Each row cites the House bill page and line. | `parse_annex_a.py`, `map_annex_a.py` | `annex_a.json`, `annex_a_mapped.csv` |
| Annex A-1 (148 pp.) | DA farm-to-market roads: House description, committee-report description, five amounts | `parse_two_col.py fmr`, `map_projects.py` | `annex_a1_fmr*.{json,csv}` |
| Annex A-2 (5 pp.) | DOH HFEP: the committee's changes by facility (infrastructure, equipment, vehicles) | `parse_hfep.py`, `map_hfep.py` | `annex_a2_hfep*.{json,csv}` |
| Annex A-3 (107 pp.) | NIA projects, same layout as A-1, plus A-3B (the watershed list, not parsed) | `parse_two_col.py nia`, `map_projects.py` | `annex_a3_nia*.{json,csv}` |
| Annex A-4 (210 pp.) | DPWH projects (Vol I-C) the Senate changed or renamed: House name, "Revised Project Name", five amounts in pesos | `parse_annex_a4.py`, `map_annex_a4.py` | `annex_a4*.{json,csv}` |
| Annex A-5 (3 pp.) | TIEZA (₱5M, Pink Mosque) and TPB (₱15M) inserted under BSGC | not parsed; already in Annex A's BSGC rows | |
| Annex B (120 pp.) | Amendments to special and general provisions, by House volume, page and line | `parse_annex_b.py` | `annex_b.json` (186 amendments) |

The deliverable for the four programs is `{dpwh,fmr,nia,hfep}_senate.csv`. It has one row per House bill
project in `data/hgab/2027/<program>/projects.parquet`, keyed by our `id`, plus one row per Senate
insertion. Its columns are `status` (unchanged / renamed / cut / reduced / raised / added), `hb_php`,
`senate_php`, `hb_title`, `senate_title`, `replaces_id` and `match`. `programs_summary.json` holds the
totals and counts.

## Results (all reconcile to the peso with the report's printed totals)

- **Whole bill:** programmed appropriations stay at ₱4,494,082,001 thousand, with ₱204.63B moved between
  lines (departments −₱28.55B, special purpose funds +₱28.55B). Unprogrammed falls by ₱812.8M, and the
  total is ₱4,605,253,699 thousand.
- **DPWH:** ₱654.10B → ₱587.90B. Projects go from ₱587,075,661,000 to ₱520,876,384,250.
  - 3,479 projects are removed (cut to zero, −₱99.30B). No project is cut partway.
  - 13 foreign-assisted projects are raised (+₱33.10B).
  - 5,182 are renamed with the same amount (the Senate adds stations, coordinates and corrected names).
  - 7,597 are not listed, so they are unchanged.
- **FMR:** ₱19.63B → ₱16.00B.
  - 577 House roads are cut and 391 Senate roads added.
  - 142 of the 391 revise a cut road: the Senate cuts a row and re-adds it with new coordinates or a
    corrected name. `replaces_id` links the two.
  - 122 are renamed in place.
- **NIA:** ₱18.00B → ₱17.75B. 660 are renamed in place (the Senate's description adds stations and
  coordinates), 148 cut and 112 added.
- **HFEP:** ₱10.02B → ₱15.51B. Annex A-2 is the net +₱5,491,400,000.
  - 23 facility components add to a House row; 2 more match after a spelling difference.
  - 164 are facilities the House bill does not fund.
  - Dr. Jose N. Rodriguez Memorial Hospital is cut by ₱100M.
- **Annex A:** 3,185 amount rows (2,894 class and object rows mapped).
  - 1,675 match a House bill node peso for peso, at the cited page and line or a few lines off.
  - 47 add an expense class to an existing House line, 949 are Senate insertions and 177 are subtotals.
  - 19 are in Unprogrammed Appropriations or the DOE corporations' budgets, which our House tables don't
    parse.
  - 19 are unmatched and 8 cite a House amount that differs from the bill (typos in the Senate copy, listed
    in the CSV).
- **Explorer lines:** 902 House bill explorer lines change in the committee report; 3 sit under a changed
  heading whose split the report does not give. Every agency reconciles with the General Summary: its House
  total plus its changed lines, plus the money in lines the House bill does not have (Senate insertions,
  allowed only where Annex A inserts something for that agency), equals its committee-report total.

## How the matching works

- **Annex A → House tables:** a row cites the volume, the printed page (printed only when it changes, so
  it carries forward) and the line. It matches the House node (`data/hgab-lines/2027/tables-vol*.json`) at
  that place whose amount for the same column (PS/MOOE/CO/FinEx/Total, a fund line, or an object of
  expenditure) equals the cited House amount. `hb_doc` + `hb_pdf_page` + `hb_node_line` + `exp_cd` is the
  explorer's key for that line.
  - **Fallbacks, used only when the amount is equal:** the page either side (the Senate copy sometimes
    forgets a page change, e.g. BFAR objects on p. 166 cited as 165), and up to 4 lines off. The House
    bill prints DPWH activities twice, as sub-program and activity, and our parser keeps the first.
- **Annex A-4 → DPWH projects:** the House name plus the House amount is the key (8,682 exact).
  - Then fuzzy names with the same office, and one name being the start of the other. Our House titles
    sometimes carry coordinates or the next printed line on the end.
  - Then a large amount that only one row prints. A title on the last page is drawn twice over itself and
    reads as garbage.
  - All 8,713 Senate rows match. `house_row_split`: our row "Construction of Multi-Purpose Building,
    Poblacion West, Taysan, Batangas" (₱25M) is two printed lines in the House PDF, ₱15M and ₱10M
    ("Barangay Poblacion West"). **This is an error in our House data, from the upstream workbench.**
- **A-1 / A-3 → FMR / NIA:** name and amount, one-to-one, region first. Every House row matches (964/964 and
  828/828).
  - **Revision links (FMR):** a Senate insertion is linked to the nearest cut row above it in the same
    region that names the same municipality and whose site words are ≥ 80 similar. "Site words" are the
    places and features before the municipality, not "Construction of Brgy … FMR".
  - A looser rule linked different barangays in one town, so it is not used.
- **A-2 → HFEP:** the same facility name and component, or a similar name with the same kind of facility
  (hospital / RHU / health center) in the same region.

## Source quirks (in the Senate copy, not our parse)

- A few rows don't add up as printed:
  - "REPAIRS AND MAINTENANCE 23,683" (NMIS) prints no committee-report amount.
  - The DSWD Northern Mindanao centre is re-inserted with only a committee-report amount.
  - Two SUC "Supplies and Materials" rows print the amount on the line above.
- FMR region headings count gross increases and decreases; project rows print only the net, so the
  headings' increase and decrease columns don't sum. The House and Senate amounts do, region by region.
- NIA prints a big project as an activity (its name, then region headings). MARIIS and UPRIIS sit at
  region level.

## The site: `/senate/2027` and the Senate column on the House pages

`build_explorer_senate.py` and `build_site.py` (the last steps of run.sh) write `data/senate/2027/`, which the
pages read from R2 `senate/2027/`. `npm run upload:senate` publishes it (the House uploader with
`--out=data/senate/2027 --prefix=senate/2027/`). **Upload before the merge that ships the pages.**

| File | What |
|---|---|
| `overview.json`, `manifest.json` | whole-bill totals, the four programs, the report's documents; build info |
| `departments.json` | the General Summary by department and agency, pesos |
| `lines/<dept id>.json` | Annex A rows of one department (department ids are the House explorer's) |
| `explorer/<dept id>.json` | the Senate amount of every House explorer line that changes, plus agency totals |
| `<program>/projects.parquet`, `summary.json` | every House project, the Senate's insertions and the NEP-only projects (status `nep_only`): NEP, House, Senate, status; by region, program line, office; largest changes |
| `provisions.json` | Annex B, with the House bill PDF page of each cited page |
| `pdf/senate-cr-*.pdf` | the report, for page links |

Pages (`src/lib/senate.ts`, `src/components/SenateBits.tsx`, `src/pages/Senate*.tsx`), its own primary
nav tab "Senate Budget 2027":
- `/senate/2027/overview`: totals, the four programs, departments that change most.
- `/senate/2027/explorer` and `/explorer/:deptId`: each department's amendments as Annex A prints them, then
  the House bill's tree with a Senate column (`ExTree` with `senate` and `compare="house"`).
- `/senate/2027/:program` (`?view=overview|projects|changes`) and `/:program/p/:id`: project by project.
- `/senate/2027/provisions`, `/sources`, `/methodology`.

On the House pages: a Senate column on the explorer index and department pages (`compare` stays House vs NEP),
on the program project tables (a second query on the Senate parquet for the rows on screen), and an "In the
Senate committee report" box on each project page. The budget-stage timeline has the Senate as current once `SENATE_PUBLIC` (budget-stage.ts) is on; until then the landing notice and timelines stay on the House bill (2026-11-22).
Everything carries the "Under citizen review" banner while `SENATE_UNDER_REVIEW` is true. Every Senate table and
figure shows the NEP beside the House bill and the Senate (Jason, 2026-11-20: "a full view"); Annex A rows take the
NEP amount of the House line they cite (`annex_a_nep.json`, from build_explorer_senate.py). A zero amount reads
"0" site-wide (`shortPhp`), not "0K". Every change is shown twice, amount and percent: "vs House bill" (Senate − House) and "vs NEP"
(Senate − NEP). The "only those that change" filters start off, so every department and line shows by default.
Unprogrammed appropriations have no NEP figure here (the explorer's NEP data leaves them out; they are the same in
both), so their "vs NEP" is blank rather than an addition.

Layout and navigation follow the House bill section (Jason, 2026-11-21: "the navigation for the pages is
inconsistent compared to the hgab version"): `SenateHeader` uses the House sub-nav's program labels and menus,
pages have the House bill's heroes, page trails and project page layout (`SenateRecord.tsx`).

**DPWH projects link to the reviewer** (`SenateDpwhProjects.tsx`, Jason: "link it to our reviewer so a project can
be reviewed"): every House DPWH project with its review status and a **Review** button (`/hgab/2027/review?p=<house
id>`); House projects not in the reviewer show "Not in the reviewer". Totals count each Senate row once; rows that
share one Senate row (one House row printed as two lines) carry `*`. Filters (Jason, 2026-11-21: "the review filters
doesn't fit well … only filter by Region, DPWH Office, Budget, Senate (rename to Changes, also add Inserted),
Documents"): four of the reviewer's (`FilterBar` with `only=`, from `src/components/ReviewFilterBar.tsx`, shared
with `HgabReview.tsx`) and **Changes**: the Senate status (`sv=`) and **Inserted** (`ins=yes|no`: a House line with
no NEP line, 6,193 DPWH projects, 3,078 of them removed). Reviewer steps the list doesn't show (red flags,
questions, review status) are ignored in its URL. The FMR, HFEP and NIA lists have Region and the same Changes menu
(`status=`, `ins=`); no reviewer link, the reviewer covers DPWH only.

**Department pages** (`SenateExplorerDept.tsx`, 2026-11-21, Jason: "the text is overwhelming especially the Annex
A"): the amendments read one line each, the activity or project with its region and office below, the expense class
as a tag (PS, MOOE, CO) and Inserted / Removed / New expense class tags; consecutive rows of one activity sit under
its name with their sum; the report's instruction ("Between lines 36 and 37, insert …") shows once; an agency folds
after 12 lines. All-caps names from the report are set in title case, keeping acronyms (`nameCase`). The section sits in a tinted
box (`.senate-annex-box`), each agency a white card, apart from "Every line" below (Jason: "a container … so it feels
like a different section").

**"Senate" on every page** (2026-11-21, Jason: "some people may get lost so it's important for the Senate pages
explicitly state Senate around"): page titles end "in the Senate" (programs, departments), section headings name the
Senate ("11 Senate amendments in Annex A", "Largest Senate cuts", "186 Senate amendments to the bill's provisions"),
and each project page carries a "Version: Senate committee report" label. Headings inside the Annex A box are small.

**Renamed, restored or a possible duplicate** (`pairs.py`; Jason, 2026-11-21: "Some FMRs, NIA, DOH are showing
inserted instead of renamed or have potential duplicates. It needs further checking"). The project annexes print a
corrected House project as a removal plus an insertion, and an NEP project the House dropped as an insertion:
- FMR: 178 insertions are paired with the removed House road they revise (`build_versions.py`: the annex's own link,
  then the same region and names >= 85 similar, or >= 75 with the same amount and municipality). They read as
  renamed, raised or reduced under the Senate's name. NIA has none (its insertions are other systems).
- 85 insertions are NEP projects the House bill doesn't have (FMR 72, NIA 8, HFEP 5): status **Restored from the
  NEP** (`restored`), one row with the NEP amount instead of an insertion plus an NEP-only row (`build_site.py`).
- Insertions that still look like a House project are flagged, not merged (`check_note`): 3 FMR possible
  duplicates; 15 HFEP components for a facility whose other component the House bill funds.
- 29 FMR pairs whose names differ more than a spelling carry a "check the pairing" note.
Every pairing and flag: `senate-2027-pairings.csv` in the dataset; `matched_by`, `check_id`, `check_note` on each
project. The list and project pages show the note (⚑). Totals and checks are unchanged.

**Pages on every list row** (Jason, 2026-11-21: "we need to display their page numbers in the lists, we need to make
it trustworthy"): the project lists (DPWH and the other three) have a Pages column, NEP p. · HB p. · Senate p., each
opening the PDF at that page (`SenatePages`), and the lists' CSVs carry them. FMR, NIA and HFEP rows had no House bill
page: the House data reads those programs from the second-reading copy, whose pages the third reading repeats
(`same_pages`), so build_site.py now cites the third reading at that page. **Page checks** (`page_check.py`, in
`build_downloads.py`): every page link is opened and must print the project's distinctive words (spaces ignored;
NEP OCR misreadings within ~75 similarity). 12 checks, one per program and document, non-blocking; misses go to
`senate-2027-page-misses.csv`. On 2026-11-21 all Senate, House bill and NEP links pass but 2: an HFEP NEP-only row whose
name our House data reads as "cYanmGtalo Tab]" (NEP p. 10: Governor Benjamin T. Romualdez General Hospital and
Schistosomiasis Center), an upstream fix for the House data.

**Status names** (Jason, 2026-11-21, again: the Senate's own projects in FMR, NIA and HFEP are **Documented addition**, not
"Inserted"; "Inserted by the House" and the Annex A line tag keep their wording.) (2026-11-21, Jason: "rename Cut to Zero to Removed across pages"): Removed, Reduced, Raised,
Inserted (by the Senate), Renamed, Unchanged (`SENATE_STATUS`; the data keeps `cut` and `added`). In the Changes menu
every Senate status shows even at 0 (DPWH has no Senate insertions), and the House column reads "Inserted by the
House" / "Not inserted by the House".

**No "Changes" page** (2026-11-21, "we don't need the changes page anymore as it does both now"): the lists filter
by change, so `?view=changes` redirects to the list (`&status=` kept, as `sv=` on DPWH). Links into the DPWH list
use the reviewer's URL (`senateListPath`).

**Regions** (`regions.py`, Jason 2026-11-21: "why are so many regions with 0 numbers"): every project's region is
put in one form ("Region I", "Region IV-A", "MIMAROPA", "CAR", "NCR", "NIR", "BARMM"), as the DPWH data spells
them. Before, one region showed as two or three rows: FMR's NEP-only rows say "Region I - ILOCOS" where its House
rows say "REGION I - ILOCOS"; the NIA annex says "REGION 1", "REGION 4A" and "REGION IV-A"; HFEP's additions say
"Cordillera Administrative Region (CAR)" for the House rows' "CAR". The House bill's NIA rows have no region (it
lists them by sub-program), so they take the region the annex prints them under; rows the annex doesn't list take
their irrigation system's region when all its listed rows share one. 30 NIA rows (₱100M in the House bill, ₱1.24B
NEP) are left "Not recorded". The annex's MARIIS and UPRIIS headings count under Region II and Region III.

## The dataset: downloadable and verifiable

(Jason, 2026-11-21: "we need to have our dataset downloadable and verifiable.") `build_downloads.py`, the last
step of `npm run build:senate-cr`, writes `data/senate/2027/downloads/` (published with `upload:senate`):

- `senate-2027-projects` (21,098 rows: the four programs, NEP / House bill / Senate, status, inserted by the
  House, and the Senate, House bill and NEP page of each), `senate-2027-annex-a` (2,719 rows, as printed),
  `senate-2027-general-summary` (450 rows: totals, departments, agencies, sub-agencies, group headings, the
  DOE-attached corporate budgets regrouped) and `senate-2027-provisions` (186), each CSV (UTF-8 with BOM) and Parquet.
- `senate-2027-checks.csv`: 38 checks: 26 on totals and arithmetic, all passing (a failure stops the build), and 12 on
  page links (one per program and document, reported; see "Pages on every list row"). They cover the source PDFs' SHA-256, each program's House bill
  and Senate totals against the annex's printed total, row arithmetic, the General Summary's own sums (agencies
  only: sub-agencies and group headings would count twice), and the line-by-line Senate amounts against the
  General Summary. **A failed check stops the build.**
- `README.md` (data dictionary, caveats, how to verify), `manifest.json` (sources, tables, files with SHA-256),
  `SHA256SUMS.txt` (files and source PDFs: `sha256sum -c --ignore-missing SHA256SUMS.txt`), the ZIP, and
  `index.json`, the site's listing (with the ZIP's checksum, which the manifest inside it can't hold).

Annex A rows can't be summed: the report prints some insertions at more than one level (a project, its region, its
office, each with the same amount), so the dataset says so, and the totals come from the General Summary. While
building the checks, two SUC rows (Apayao State College, Ifugao State University, pp. 42-43) turned out to be
an unnamed +1,000 the parser had joined to the line below. `parse_annex_a.py` now joins amounts to the next label
only if they add up with its own House amount.

The page: `/senate/2027/data` ("Download data" in About, `SenateData.tsx`): the ZIP, each table's CSV and Parquet
with rows and SHA-256, the five ways to check, every check with its result, and the source PDFs' SHA-256.

## Executive report (unlinked)

`/senate/2027/report/*` (Jason, 2026-11-21: "an executive report of what was changed and our analysis based on that
data ... don't link it for now"): no menu, not in the sitemap, noindex (`seo.ts` and a robots meta tag). It looks like
the House bill review report ("make it look like our hgab's review report"): its own bar, pages listed on the left,
a notice box, cards and tables, with `hgab-review-report.css`. Ten pages: Overview (key findings), The whole bill,
Largest amendments, Unprogrammed, Infrastructure programs, DPWH, District offices, Red flags, Provisions, About this
report. `SenateReport.tsx` renders
`senate/2027/report.json`, which `build_report.py` (after `build_downloads.py` in `build:senate-cr`) computes from
the published dataset and, for DPWH red flags and documents, the reviewer's `documents/review.json`. Sections: key
findings; the whole bill and departments; the largest single amendments (Annex A, one per printed amount, DPWH
apart); unprogrammed appropriations; the four programs; DPWH by origin (House insertion or NEP), program line,
multi-purpose buildings, region, district engineering office (office, not district: Lone/Shared shown); removed vs
kept by red flags and documents; the foreign-assisted projects raised; FMR, NIA, HFEP; provisions; what the report
does not say. The red-flag comparison is a pattern in the data, never the Senate's reason: the report gives none.
To publish it, link it from the Senate overview and drop `noindex`.

**Program cards on the overview** (Jason, 2026-11-21: "needs a better design. They are hard to understand. Will a pie
chart for each help as well?"): each program is two bars on one scale, House bill above and Senate below. What stays
is grey on both; what the Senate removes (projects removed, and the reduced part) is red on the House bar; what it
adds (raises, insertions, restored NEP projects) is coloured on the Senate bar. Each part has a plain sentence with its
count and amount, and the NEP is a line under them. Not pies: a pie splits one total, and the Senate both takes from
the House budget and adds from outside it; four pies of different sizes don't compare.

## Leaderboards

`/senate/2027/leaderboard` (Jason, 2026-11-21: "Next is work on leaderboards, our reports are a good start"; "Leaderboards"
after "Line by line" in the Senate sub-nav). 18 boards in three sections, ranking what the executive report analyses:
- **The big picture:** House bill budget the Senate removes, by region, and the share removed.
- **The Senate against the House bill** (DPWH, by office): most budget removed, largest share removed (offices with
  ₱1B+), most projects removed, most House insertions removed, most House insertions kept, largest Senate DPWH
  amounts, biggest increases over the NEP.
- **The whole bill:** departments (₱ and % with a ₱1B floor), agencies and Annex A lines by the Senate's change, and
  the largest lines the Senate inserts.

Data: `build_leaderboard.py` (in `build:senate-cr`) writes `senate/2027/leaderboard.json` in the House leaderboard's
shape. It reuses `data/hgab/2027/leaderboard.json`'s 190 office groups and people (Lone/Shared, never split) and adds
a `senate` block to each. The block holds the Senate DPWH rows under the label the House bill lists for the office
(`districts.json` 2027 hgab3 `matched_label`). Entries + Central Office tie out to the program totals (the build
checks). The Senate figures count every House bill DPWH line under the office, so 23 offices' House totals differ
slightly from the House boards, which hold out lines that changed office.

Page: `SenateLeaderboard.tsx`, with the House pieces (`BoardTile`, `PlaceCell`, `ValueCell`, `BoardPager`, ...) given
the Senate boards and address through `LeaderboardSiteContext` (`src/lib/leaderboard-site.ts`; the House's by
default). Its tables show the House bill and the Senate beside the ranked figure. Boards: `src/lib/senate-leaderboard.ts`
(`BoardDef.residual` gives each its "not in any district" footnote). No share images yet: the renderer
(`hgab-share-render.ts`) is House-specific.

## Not done yet

- Not in the API, MCP or D1; no link-preview images or share cards for the Senate pages.
- Districts, maps and leaderboards for the Senate version; MPB, flood control and foreign-assisted pages
  don't have a Senate column yet.
- Unprogrammed Appropriations and DOE corporations: Annex A rows are parsed, but our House tables don't
  hold those sections.
- Annex A-3B (the NIA watershed list) and Annex A-5 (TIEZA/TPB pages) are not parsed into rows.
- Annex B is text only, keyed to House page and line; we don't hold parsed House provisions to diff against.
