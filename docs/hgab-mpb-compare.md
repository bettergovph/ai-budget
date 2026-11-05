# Multi-purpose buildings: the 2027 NEP vs the House bill, side by side

`/hgab/2027/multi-purpose/nep-vs-house-bill` (Multi-purpose buildings menu → NEP vs House bill; the menu is hidden in
the nav for now, see `NAV_HIDDEN`).

Jason (2026-11-05): "a different page side by side comparison of 2027's NEP vs HGAB for multi-purpose buildings … more
points visible in the philippines to demonstrate the density and intensity of the changes … numbers visible as I would
be publishing the page and take a screenshot of the section … Poster can follow after. We need the map view for visual
impact."

## The figure (screenshot this)

A dark block, 1200 px wide on desktop:
- **Headline:** "₱43.2 billion in the NEP. ₱86.3 billion in the House bill."
- **Change strip:** the change in pesos and in lines; the lines in the House bill only and in the NEP only; the lines
  in both, with how many are higher or lower.
- **Two maps** drawn the same way. Each carries its total and lines on the open sea west of Luzon, and its own lines in
  the Philippine Sea.
- **Legend, notes and source**, with the page address and the "as of" date.

`?shot=1` shows the figure alone at its full width, for a clean screenshot (in Chrome: DevTools → the
`section.mpbc-figure` node → Capture node screenshot).

**Download image (PNG)** above the figure (Jason, 2026-11-05: "Give me a downloadable version!"):
`src/lib/mpb-compare-image.ts` draws the same figure on a canvas at twice its size (2400 × 2578 px, about 1.4 MB,
`bettergov-multi-purpose-buildings-2027-nep-vs-house-bill.png`). The words come from `compareCopy` (used by the page
too, so the two never differ), the maps from `drawCompareMap`, in the site's fonts. It's loaded only when clicked.

- **Dots:** every line is its own dot, never grouped. A line sits at its first GPS point, else at the centre of the
  place its title names. Lines at the same spot fan out in a sunflower; dot area follows the amount.
- **Drawing:** lines in both are added together, so crowded places glow. The lines only one side has go on top in solid
  red (House bill only) or amber (NEP only) with a small halo, so dense clusters stay red instead of washing out.
- **Canvas:** plain 2D canvas at twice the screen resolution, over the province outlines (`geo/provinces.json`). There
  are no map tiles, so it draws the same offline and in the poster.

Figures (2026-11-02 build of the map's lines):

| | Lines | Amount |
| --- | ---: | ---: |
| NEP | 2,815 | ₱43,209,739,000 |
| House bill | 5,807 | ₱86,264,219,000 |
| House bill only (a candidate: no matching NEP line found) | 3,308 | ₱48.21B |
| NEP only | 316 | ₱5.09B |
| In both | 2,499 (68 higher, 27 lower) | NEP ₱38.12B, House bill ₱38.05B |

Below the figure: the same by region (a line's region), with links to the interactive map and the budget by year.

## Code

- `src/lib/mpb-compare.ts` (pure):
  - figures (`compareFigures`, `compareByRegion`);
  - dots (`sideDots`, `placeDots`, `dotRadius`), and the frame over `COMPARE_VIEW`, with the site's map projection;
  - drawing (`drawCompareMap`, `provincePaths`), which the poster can reuse.
- Page: `src/pages/HgabMpbCompare.tsx`, styles in `src/hgab-mpb-compare.css`, loader `loadMpbCompare` (the map's
  lines and summary, and the outlines).
- Checks: `npm run verify:hgab` has a `multi-purpose/nep-vs-house-bill` section (`scripts/verify-hgab-mpb-compare.ts`,
  7 checks):
  - both totals equal `mpb-years/summary.json`;
  - the three kinds and the regions add up;
  - every line is a dot, none off the drawn view;
  - the House-bill-only note's wording.
- No new data: the page reads `mpb-years/` and `geo/`, already published.
