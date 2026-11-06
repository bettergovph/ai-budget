# Budgets side by side on maps: multi-purpose buildings and flood control

Two pages, one design (`CompareTopic` in `src/lib/mpb-compare.ts`):
- `/hgab/2027/multi-purpose/nep-vs-house-bill`: the 2027 NEP vs the House bill, two maps. It's in the Multi-purpose
  buildings menu → NEP vs House bill, which is hidden in the nav for now (see `NAV_HIDDEN`).
- `/hgab/2027/flood-control`, "Flood control projects are back": 2025, 2026 and 2027, three maps. No menu entry yet;
  see [Flood control](#flood-control) below.

Jason (2026-11-05): "a different page side by side comparison of 2027's NEP vs HGAB for multi-purpose buildings … more
points visible in the philippines to demonstrate the density and intensity of the changes … numbers visible as I would
be publishing the page and take a screenshot of the section … Poster can follow after. We need the map view for visual
impact."

## The figure (screenshot this)

A dark block, 1200 px wide on desktop:
- **Headline**, two lines (Jason, 2026-11-05: "we forgot to put 'Multi Purpose Buildings' … as part of the large
  title"): "Multi-purpose buildings" / "₱43.2 billion in the NEP. ₱86.3 billion in the House bill." The kicker above
  it reads "2027 budget · NEP vs House bill".
- **Change strip:** +₱43.1 billion (100% more), and +2,992 lines (2,815 → 5,807).
- **Two maps** drawn the same way, each with its total and its lines on the open sea west of Luzon:
  - **NEP:** all blue.
  - **House bill** (Jason, 2026-11-05: "can the existing ones be blue while the added ones are red, the ones not existing
    as yellow"):
    - blue: lines the NEP has too (2,499);
    - red: lines added in the House bill (3,308);
    - yellow: the NEP's lines it does not have, where they were (316), drawn on top, outside its total.

  The notes say red and yellow are candidates (no matching line found), not confirmed changes. The numbers stay totals
  only.
- **Legend, notes and source**, with the page address and the "as of" date.

**Totals only.** Jason (2026-11-05): "we don't need the in the nep only but let's just compare the totals for both".
An earlier version broke the lines down into in both (2,499), not in the House bill (316) and not in the NEP (3,308).
"In the NEP only: 316" beside the NEP map read as if the NEP had only 316 multi-purpose buildings, so the figure and
the region table now show each document's totals and the change only. `compareFigures` still counts the breakdown, and
the verifier checks it adds up.

`?shot=1` shows the figure alone at its full width, for a clean screenshot (in Chrome: DevTools → the
`section.mpbc-figure` node → Capture node screenshot).

**Download image (PNG)** above the figure (Jason, 2026-11-05: "Give me a downloadable version!"):
`src/lib/mpb-compare-image.ts` draws the same figure on a canvas at twice its size (2400 × 2578 px, about 1.4 MB,
`bettergov-multi-purpose-buildings-2027-nep-vs-house-bill.png`). The words come from `compareCopy` (used by the page
too, so the two never differ), the maps from `drawCompareMap`, in the site's fonts. It's loaded only when clicked.

- **Dots:** every line is its own dot, never grouped. A line sits at its first GPS point, else at the centre of the
  place its title names. Lines at the same spot fan out in a sunflower; dot area follows the amount.
- **Drawing:** every dot with a small halo, in passes (blue, red, then yellow on top), both maps the same way, so the
  density compares. Crowded places build up into solid colour.
- **Canvas:** plain 2D canvas at twice the screen resolution, over the province outlines (`geo/provinces.json`). There
  are no map tiles, so it draws the same offline and in the poster.

Figures (2026-11-02 build of the map's lines):

| | Lines | Amount |
| --- | ---: | ---: |
| NEP | 2,815 | ₱43,209,739,000 |
| House bill | 5,807 | ₱86,264,219,000 |
| Change | +2,992 | +₱43,054,480,000 (+100%) |

Below the figure:
- the NEP vs House bill totals by region (a line's region);
- the region-by-year matrix (see [By region and year](#by-region-and-year));
- links to the interactive map and the budget by year.

## Code

- `src/lib/mpb-compare.ts` (pure):
  - figures (`compareFigures`, `compareByRegion`);
  - dots (`sideDots`, `placeDots`, `dotRadius`), and the frame over `COMPARE_VIEW`, with the site's map projection;
  - drawing (`drawCompareMap`, `provincePaths`), which the poster can reuse.
- Page: `src/pages/HgabMpbCompare.tsx`, styles in `src/hgab-mpb-compare.css`, loader `loadMpbCompare` (the map's
  lines and summary, and the outlines).
- Checks: `npm run verify:hgab` has a `multi-purpose/nep-vs-house-bill` section (`scripts/verify-hgab-mpb-compare.ts`,
  10 checks):
  - both totals equal `mpb-years/summary.json`;
  - the three kinds and the regions add up;
  - every line is a dot, none off the drawn view;
  - the figure's numbers show the totals only, with no count by match, in plain words;
  - the House bill map's colours (blue = in both, red = added, yellow = NEP lines it lacks), and the NEP map all blue;
  - the large title names multi-purpose buildings, then both totals.
- The multi-purpose page reads `mpb-years/` and `geo/`, already published.

## Flood control

Jason (2026-11-05):
- "grab the flood control projects. With our title 'Flood control projects are back'";
- then, "the proper comparison is 2025, 2026, and 2027. For 2027 combine both nep and gab but with just different
  colours".

The same figure with three maps, and the same dot scale, so the pages compare.

**Headline,** three lines:
- "Flood control projects are back"
- "₱346.6 billion in 2025. ₱4.8 billion in 2026."
- "₱96.1 billion in the 2027 House bill." (the amount in red)

**Change strip:**
- −₱341.9 billion in 2026 (99% less than 2025);
- +₱98.7 billion in the 2027 NEP;
- −₱7.3 billion in the House bill (7% less than the NEP).

**Maps,** each labelled above: three maps leave no open sea for the labels.
- **2025:** the GAA, all red: its title run, amount and dots (Jason, 2026-11-05: "Make 2025 red themed").
- **2026:** the GAA, all blue. Its sub-line reads "all foreign-assisted", from the chart's foreign-assisted part.
- **2027:** the NEP and the House bill on one map, coloured as the multi-purpose House bill map:
  - blue 982 (in both);
  - red 478 (added in the House bill);
  - yellow 275 (NEP lines the House bill lacks, outside its total).

  Its label carries both amounts, named.

**Notes** add:
- what flood control means here;
- where head-office lines that name no place sit;
- that 4 FY2027 lines budgeted nationwide are counted but not on the map.

**Legend,** two rows, because red means two things (Jason, 2026-11-05: "the legend with red made it confusing for
2025 as 2025 is red"):
- "● 2025 budget lines ● 2026 budget lines";
- "On the 2027 map: ● In the NEP and the House bill ● Added in the House bill ● In the NEP, not in the House bill",
  with the dot sizes on the right.

verify:hgab checks that each map's colours are named.

**Below the figure:** the region-by-year matrix (FY2020 GAA to the 2027 House bill), which replaces the earlier
four-column region table.

**Disclaimers** (Jason, 2026-11-05: "I need a disclaimer"):
- **On the figure** (page, `?shot=1`, PNG), both topics, since the figure travels without the page:
  `COMPARE_CARD_DISCLAIMER`, "Independent and unofficial: our reading of the published budget documents. A line or a
  total is not evidence of wrongdoing."
- **Below the page:** `DISCLAIMER_FLOOD` after "Independent and unofficial". It says:
  - 2025 and 2026 are enacted budgets; 2027 is the proposal and the House bill, not yet law;
  - placement is our reading and can be wrong;
  - red and yellow are candidates;
  - no allegations;
  - amounts are allocations, not spending.

  It is also on the Methodology page's disclaimers. Both are in `src/lib/hgab-disclaimers.ts`, and verify:hgab checks
  them.

| | Lines | Amount |
| --- | ---: | ---: |
| FY2025 GAA | 4,766 | ₱346,620,462,000 |
| FY2026 GAA (all foreign-assisted) | 10 | ₱4,760,870,000 |
| 2027 NEP | 1,261 | ₱103,450,431,000 |
| 2027 House bill | 1,464 | ₱96,109,265,000 |

### The lines

`npm run build:hgab-flood-compare` (`scripts/hgab-flood-compare/`, about 11 s) writes `data/hgab/2027/flood-compare/`:
`lines.json` in the multi-purpose map's format, and `summary.json`. The lines are the flood control series on the chart
by year, so every budget adds up to it, or nothing is written:
- **FY2025 and FY2026 GAA** (the site's DPWH extract): the Flood Management Program (3201…), plus BIP and SIPAG flood
  mitigation (300225/300237, 300219/300234), which only 2025 has.
- **2027:** the Flood Management Program.
- **Left out,** as on the chart: drainage and flood titles under other programs (522 lines in 2027, mostly the
  Convergence and Special Support Program).

**Placement** follows the multi-purpose map's order:
1. GPS in the title.
2. The place the title names:
   - **GAA:** upstream's Matcher, with the office's region and province as hints, as the multi-purpose map reads GAA
     titles. A head-office (Central Office) line has no office hint, so when the Matcher can't read it, it goes to the
     one province its title names (upstream's name finder), never a town. That covers 54 lines in 2025 and 2 in 2026.
   - **2027:** the source's location lens (`row_psgc`).
3. The DPWH office.
4. The region. A head-office line goes to the region the budget lists it under (16 in 2025, 8 in 2026, all Metro
   Manila). The 2027 lens places head-office lines the same way.

**The lens** is the one behind the district pages (`locations.json`, commit d76863a):
- the build checks every 2027 line's basis and target against it;
- it checks the lens's comparison against ours, line for line;
- "in both / added / not in the House bill" are the lens's own buckets.

**Environment:** the build reuses the multi-purpose map's venv, pinned workbench files and centroid cache. Run
`npm run build:hgab-mpb-years` once first, with the lens checkout at `/tmp/dpwh-nep-head` (`LENS_DIR`).

**Checks:** the `flood-control` verify section adds:
- all four budgets equal the chart;
- 2026, and only 2026, is all foreign-assisted;
- every 2025 and 2026 line is drawn;
- the nationwide lines.

It also runs the shared checks per budget and per map.

**Publish:** upload before the page deploys, with
`npx tsx scripts/upload-hgab-to-r2.ts --only=flood-compare --skip-verify`.

## By region and year

Jason (2026-11-06):
- "I want a matrix of the MPBs per region and per year. I want the same for flood control as well. You can put it in
  their individual pages";
- "For flood control we need it for multiple years that we have";
- "we need a description how we grouped them, what fields and caveats as well";
- "Let's use a light green to red tone for the grid colours".

Each page has a "By region and year" table:
- **Rows:** the regions, north to south, then "No region"; the last row is "All regions".
- **Columns:** the budgets, oldest first.
- **Cells:** the amount (₱4.2B, ₱512M). The colour runs from light green through soft amber to red by the square root of
  the cell's share of the largest cell (`heatColor`). Hover a cell for its line count. On phones the region column
  stays fixed and shows the short name.
- **A line's region** is the one its title or office places it in, the same as on the maps.

**Download image (PNG)** beside the heading (Jason, 2026-11-06: "a shareable version of that with our BetterGov logo,
our disclaimer, that I can download as well"). `src/lib/mpb-matrix-image.ts` draws the same table on a white card,
2560 × about 2030 px, loaded only when clicked:
- the BetterGov logo (`bettergov-horizontal-primary.png`), a red top rule, the kicker and the title;
- every cell in the page's colours, and a less-to-more colour key;
- the notes, the disclaimer (`COMPARE_CARD_DISCLAIMER`), the source, the page address and the "as of" date.

The words come from `matrixCopy`, which the page's table uses too. The region column fits its longest name.
- Flood control: `bettergov-flood-control-by-region-2015-2027.png`.
- Multi-purpose buildings: `bettergov-multi-purpose-buildings-by-region-2015-2027.png`.

**Multi-purpose buildings:** every budget the map holds, FY2015 GAA to the 2027 House bill (14 columns). It's computed
in the browser from `mpb-years/lines.json` (`linesMatrix`).
- FY2015–FY2017 are starred (`note: title_only`): those budgets have no multi-purpose building line, so their lines
  are counted by title.
- Totals are the map's, title-only lines included.

**Flood control:** every budget we have line by line, FY2015 GAA to the 2027 House bill (14 columns). The matrix is in
`summary.json` (`matrix`); `lines.json` keeps only the mapped budgets.

### Multi-purpose buildings: About this data

Jason (2026-11-06): "Let's do the same for MPBs". The page's "About this data" section (#about-data, `AboutThisData`,
shared with flood control) has three parts:
- **How we grouped them** (`mpbScope`, from the map's lines and summary): per budget, the budget lines by heading
  (Local Program 2018–2021; BIP and SIPAG from 2022; BIP in 2027), then the lines under other headings whose titles name
  a multi-purpose building. The checks are the chart by year for the budget lines from 2020, and the printed headings
  in 2019. The last column is the items listed at ₱0 (2017: 3,165).
- **Fields:** `MPB_CSV_FIELDS`, the map build's `CSV_COLUMNS` in order. It links the map's `lines.csv` (36.4 MB,
  `mpbCsvPath`).
- **Caveats:**
  - the budget lines change with the structure;
  - 2015–2017 are in by title only;
  - title lines put the totals above the chart;
  - the title rule;
  - the ₱0 items;
  - the 2019 edition;
  - regions and No region;
  - offices matched by name;
  - 2027's candidates;
  - allocations, not spending.

verify:hgab checks:
- the grouping's parts add up to the map's budget figures (budget lines = `pap_php`, titles = `title_only_php`);
- the checks;
- the CSV header against the fields;
- plain words.

No new data: it reads `mpb-years/`, already published.

### Flood control: how the lines are grouped

`build:hgab-flood-compare` counts each budget by its own flood control codes:

| Budget | Source | Counted | Total checked against |
| --- | --- | --- | --- |
| FY2015–FY2017 GAA | GAA history release (CSV 2015, spreadsheets 2016–2017) | the older code set's flood families, 162… and 292…, named from their lines (maintenance and repair, river basins and master plans, local flood works and a disaster fund, foreign-assisted projects) | no published total |
| FY2018 GAA | GAA history release (spreadsheet) | Flood Management Program (3201…), Local Program flood control and drainage (300106–300109) | no published total |
| FY2019 GAA | the technical GAA's text (`gaa2019.py`) | the same codes | the headings the document prints |
| FY2020–FY2026 GAA | the site's extract | the chart's flood series: Flood Management Program, Local Program flood lines (2020–2021), BIP and SIPAG flood mitigation (2022–2025) | the chart by year |
| 2027 NEP, House bill | the source workbench | the Flood Management Program | the chart by year |

`summary.json` `scope` records each budget's source, parts (lines, pesos), check, and the lines with flood words in
their titles under other codes (`FLOOD_WORDS`, not counted; ₱13–25B a year). The page's "About this data" section shows
the grouping table, the CSV's fields (`FLOOD_CSV_FIELDS`, the build's `CSV_COLUMNS` in order) and the caveats.

**`lines.csv`:** every line of every budget, 39,572 rows, about 16.5 MB. The page links it with
`?v=<sha256[:12]>`, since the data host caches CSV for a day.

**Placement before 2020:**
- 2015–2019 offices are matched to today's offices by name, as on the multi-purpose map.
- District qualifiers are dropped from titles for matching, and "Maguindanao" is read as its successor province.
- The 2016, 2017 and 2019 files carry no region field. Their head-office lines that name no place stay under "No
  region": ₱9.3B, ₱8.4B and ₱5.9B.

**Checks:** verify:hgab checks both matrices. For each:
- every column adds up to its total;
- every total is the build's (flood control: the chart's from FY2020);
- the mapped columns equal the drawn lines region by region.

It also checks:
- flood control's columns run FY2015 GAA to the 2027 House bill, with 2015–2017 starred;
- the shareable image's words: the title, disclaimer, source, address and notes, in plain words;
- (About this data) for flood control:
  - each grouping row's parts add up to the matrix's total;
  - each row's check is named;
  - the CSV's header matches the described fields, it has one row per line, and its amounts add up to the matrix
    per budget;
  - plain words.

517/517.

**Publish:** upload `flood-compare/` (`lines.json`, `lines.csv`, `summary.json`) before the code deploys. The summary only
adds fields, so the live page keeps working.
