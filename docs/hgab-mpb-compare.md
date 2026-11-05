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

Below the figure: the totals by region (a line's region), with links to the interactive map and the budget by year.

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

**Region table:** 2025, 2026, 2027 NEP and 2027 House bill; amounts, with lines below.

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
