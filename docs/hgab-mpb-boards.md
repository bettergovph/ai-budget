# Multi-purpose building leaderboards, 2020 to 2026

Four boards on `/hgab/2027/leaderboard`, in their own section ("2020 to 2026: multi-purpose buildings"), each with a
page, a share image and a full table:

| Board | Ranks | Value | Left out (the card's last line) |
| --- | --- | --- | --- |
| `mpb-contractors` | Contractors holding the DPWH contracts matched to the lines | Contract amount, each contract once | Lines with no matched contract |
| `mpb-barangays` | Barangays a line's title names (a GPS line keeps its title's barangay) | Enacted amount | Lines whose title names no barangay |
| `mpb-offices` | District engineering offices (DEOs), as the budget lists each line | Enacted amount | Central Office and regional office lines |
| `mpb-districts` (was `mpb-legislators`, still opens it) | Legislative districts, as the map places each line, with the region under each; no representative for now | Enacted amount | Lines with no district |

Jason (2026-11-03) asked for "top mpb contractors, top mpbs per barangay, top mpbs per deo, top mpbs per legislator". He
chose the enacted budgets 2020 to 2026 only, the years with contracts. For the legislator board, a line counts for the
district its title places it in, the map's rule: GPS or a named barangay, town or province, else an office that serves
one district.

## No representatives, for now

Jason (2026-11-03): "for our legislative rankings for MPBs, let's remove the legislators for now as it crosses over to
18th, 19th, 20th congress".
- The board is `mpb-districts`. `BOARD_ALIASES` sends `mpb-legislators` to it.
- Its kicker reads "by legislative district". Each row is the district with its region; there is no name or portrait.
- The card note says the budgets span the 18th, 19th and 20th Congresses, and the page says why no representative is
  shown.
- `share/mpb-legislators.png` on R2 is overwritten with the district image, so the old image address shows no one.
- The portrait drawing stays behind `mpbPeople` on the board (false). boards.json keeps each district's `people`
  record, unshown, so turning it back on is one line. The verifier checks no row names a representative.

## Disclaimer and portraits

Jason (2026-11-03): "It's missing proper disclaimer. The legislator needs images?" Portraits were then turned off (above).

- **Page.** "Before you share" carries `DISCLAIMER_MPB` (src/lib/hgab-disclaimers.ts). It says:
  - how a line is placed (the place its title names, else the one district its office serves), and that the placement
    is our reading and can be wrong;
  - that a district's total does not establish that any representative requested, sponsored or controlled a project,
    and that the 2020 to 2026 budgets span the 18th, 19th and 20th Congresses;
  - that a line, a total or a ranking is not evidence of wrongdoing;
  - that amounts are allocations, with a line for each year.

  The contractors board adds `DISCLAIMER_CONTRACTORS`. Both are on the Methodology page's notice (`#disclaimer-mpb`,
  `#disclaimer-contractors`).
- **Card.** Every image prints the board's first note and `MPB_CARD_DISCLAIMER`: "A total or a ranking is not evidence
  that anyone asked for a project or did anything wrong." The district card's first note: "A district is where a title
  places the building. These budgets span the 18th, 19th and 20th Congresses."
- **Portraits (off for now, `mpbPeople: false`).** With them on, the district board is drawn like the office boards (`drawRankingVertical`): the district leads, with
  its representative's portrait and name under it, never the person first. There is no office badge and no tier: a
  title places the line, not an office. Every district's person (`people` in boards.json) is built as
  leaderboard.json builds its people, and the verifier checks they are equal. 252 of 254 have a portrait; the photo
  credit is on the card and the page.

## Data

- Build: `npm run build:hgab-mpb-boards` (`scripts/build-hgab-mpb-boards.ts`, a few seconds). It runs after
  `build:hgab-mpb-years` and `build:hgab-contractors`.
- Inputs:
  - the map's lines: `mpb-years/lines.json`;
  - their contracts: `contractors/mpb-links.json`;
  - each district's representative and each office's districts: `districts.json`.
- Output: `data/hgab/2027/mpb-boards/boards.json`, about 2.7 MB, 0.5 MB gzipped. Each set's rows are `cols` plus
  arrays; `decodeMpbBoards` (src/lib/hgab-leaderboard.ts) makes each row's links.
- Published with `upload:hgab --only=mpb-boards`. The four share images are in `share/` (`--only=share`).
- The contractor board ranks with the map's own `rankLineContractors`, so it and the map's "Top contractors" agree.
  Contractor names drop DPWH's trailing "(FORMERLY: …)"; the contractor's page keeps the name whole.
- Offices the district list does not name (12, e.g. "Cavite District Engineering Office", an older or provincial unit)
  are described by where their lines mostly sit. Their displayed names repair "Pi±as" to "Piñas".
- Every row links the map, narrowed to its lines in 2020–2026 (`?contractor=`, `?place=`, `?q=` with the office name,
  `?district=`). Contractors and districts also link their own pages.

## In the code

- Boards: `BOARDS` entries of kind `mpb` with `mpbSet`, `mpbMetric` and `mpbDetail`; ranking in `rankMpb`, units in
  `mpbUnit`, and the left-out line in `residualLine`.
- The share image draws the `mpb` kind with the whole-bill boards' list layout (`listRows`/`linesBody`), so those boards'
  images are unchanged.
- Page: `MpbMini` (gallery tile) and `MpbTable` (full ranking) in `HgabLeaderboardBits.tsx`. The contractor board
  carries the contractors disclaimer.
- The loader (`loadHgabLeaderboard`) and the share-image builder attach the decoded file as `data.mpb`. Without it, the
  boards say their figures are not published yet.

## Checks

`npm run verify:hgab`:
- **Per board, in the leaderboard section:** at least three rows; the first is the pool's maximum, in order; the
  left-out sentence.
- **`mpb-boards/` section** (`scripts/verify-hgab-mpb-boards.ts`, 19 checks):
  - every row's lines, amount, years (and contracts and contract amount) recomputed with its own grouping;
  - representatives as `districts.json` has them, the same people as leaderboard.json;
  - the disclaimers' wording;
  - the left-out lines, and that rows plus left-out lines are every line and peso;
  - the links, and the copy;
  - the file was built from the current inputs (SHA-256).
