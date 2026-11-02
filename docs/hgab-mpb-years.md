# Multi-purpose buildings map, FY2015 to FY2027

`/hgab/2027/multi-purpose/map` ("Multi-purpose buildings map" in the DPWH menu) shows every DPWH multi-purpose
building line in every budget we hold on one map and in one list: the FY2015 to FY2026 enacted budgets (GAA), the
FY2027 NEP and the House bill. Budgets before FY2015 do not list multi-purpose buildings by name (see "Earlier years"). It sits under the multi-purpose page (`/hgab/2027/multi-purpose`), whose chart has
the same years as totals; the MPB card links to the map.

- Data: `npm run build:hgab-mpb-years` (`scripts/hgab-mpb-years/run.sh`, about 75 s; the first run also reads the
  2023 PSA shapefiles once, about 90 s, and caches the centroids in `/tmp/hgab-mpb-years-cache/`).
- Contract: `src/lib/hgab-mpb-years.ts` (pure: the page, the Worker's SEO code and the verifier import it).
- Page: `src/pages/HgabMpbYears.tsx`; map: `src/components/MpbMap.tsx` (MapLibre GL, lazy-loaded with the page);
  colours: `src/components/mpb-map-style.ts`; styles: `src/hgab-mpb-years.css`.
- Checks: `npm run verify:hgab` has a `mpb-years/` section (15 checks), recomputed on its own path.
- FY2019 reader: `scripts/hgab-mpb-years/gaa2019.py` (run it on the text file to print its reconciliation).

## Outputs (`data/hgab/2027/mpb-years/`, published with `upload:hgab`)

| File | What |
| --- | --- |
| `lines.json` | Every line (80,286), one array per line with dictionaries for places, offices, PAPs and legislative districts; FY2027-only fields last and trailing nulls dropped. About 10.9 MB, 1.7 MB gzipped |
| `summary.json` | Per budget: lines, pesos, the scope rule, how lines were placed, flags, the reconciliation with the multi-purpose chart; the builder's checks; the pinned source files with SHA-256 |
| `districts.geojson` | The 254 legislative district outlines from the source's PSGC2LEG build, simplified to about 100 m |
| `lines.csv` | Every line, every budget, UTF-8 with BOM (26 MB); the page also builds a CSV of the lines on screen |

## Sources by year

| Years | Source | Grain |
| --- | --- | --- |
| FY2015–FY2018 | The GAA history release (`data/gaa-history/parquet/gaa-YYYY.parquet`): DBM's technical GAA files (2015 CSV, 2016–2018 spreadsheets). The release marks them `source_normalized_pending_pdf_reconciliation` | One row per code, office, fund and object; summed per code (a code split over several offices would show the largest, counted in `multi_office_lines`; 3–11 codes a year are split, none of them multi-purpose building lines) |
| FY2019 | DBM's technical GAA for DPWH (TechGAA2019/DPWH/A.pdf, 1,527 pages), read from the release's text of it (`text/2019/32c79a9eba5fd2a5144e522c.txt`) by `gaa2019.py`. The release itself holds FY2019 DPWH at agency level only | One line per code. Every project group in this edition sits under the Central Office, so FY2019 lines are placed by title only |
| FY2020–FY2026 | The site's GAA extracts (`data/18`) | One line per code |

FY2019 checks (the build fails otherwise): the 21,653 lines read add up to ₱454,016,273,000, the DPWH total the document
publishes; every one of its 67 Operations headings equals the lines under it (by its own code, or a program's over its
PAPs). One heading disagrees with the document's own "New Appropriations, by Program" table: 300200 (CONVERGENCE AND
SPECIAL SUPPORT PROGRAM) prints ₱32,211,352,000, the table ₱30,311,352,000; the lines equal the table, the heading counts
its own ₱1.9 billion group twice. The text has pages printed from DBM's web viewer: an indented code and a stray
`eappro.dbm.gov.ph` line, both handled. The technical edition's DPWH total is ₱95.4 billion below the Volume I
summary (₱549,390,514,000), recorded by the release; about the size of the reported FY2019 veto, not confirmed here.

FY2017: DBM's technical file lists 3,165 more items whose titles name a multi-purpose building (the same title rule) at ₱0 (`AMT`, `NEW_SPENDING`
and `HARD_CEILING` all 0); they are left out, as ₱0 codes are in every year (`listed_at_zero`).

## Earlier years

The release has FY2000–FY2008 and FY2014 at agency or program level only (2001, 2004 and 2006 were reenacted), and its
text of those budgets names at most 29 multi-purpose buildings a year. FY2009–FY2013 list program and area lines
with 0–17 titles naming a multi-purpose building a year, mostly DPWH's own office buildings. None are on the map.

## Which lines

The source workbench's MPB scope rule (`buildMpbLegislativeLens.in_scope`), applied to every budget. A line is in
when either holds:

- **PAP**: it sits on a multi-purpose building budget line. GAA: BIP 300226 and SIPAG 300220 from FY2022, the Local
  Program's MULTIPURPOSE / FACILITIES lines 300103 and 300104 in FY2018–FY2021 (FY2015–FY2017 use an older code set
  with no such line, so they are in by title only) (the codes of the multi-purpose page's
  chart, `BIP_CODES.mpb`, `SIPAG_CODES.mpb`, `LOCAL_MPB`). FY2027: `BIP - Multi-Purpose Buildings/ Facilities to
  support Social Services`.
- **Title**: its title names a multi-purpose building or hall (`mpb_title_scope()`, imported from the source), under
  any PAP: evacuation centres, government buildings, military facilities and so on.

From FY2020 the PAP lines add up to the chart, to the peso; the builder and the verifier both check it (the chart
starts in FY2020). FY2015–FY2018 lines equal the release amount for amount, and the FY2019 PAP lines equal the two
headings its text prints (₱13,173,063,000 + ₱27,505,141,000), both checked by the verifier on its own path. The
title-only lines (1,082) are extra, so the map's totals are larger than the chart's. A GAA line is a UACS code with
an amount in that year (the PAP tables carry earlier codes forward at ₱0; those are not lines). FY2027 is the
source's comparison rows: a row in both the NEP and the House bill is one line with two amounts.

## Where each line goes

First that works, as Jason set it (2026-11-02):

1. **GPS published in the title** (`scan_gps_inventory.analyze_text`; when it finds no pair at all, `WIDER_GPS` in
   `build.py` reads pairs it skips: written with a space, a slash, N/E letters or a ˚ ring for the degree sign, two
   numbers of at least four decimals, a Philippine latitude and longitude in either order; 207 FY2026 and 4 FY2027
   lines, flagged `gps_wider_reader`). A pair is dropped when it lies outside
   112–127°E, 4–22°N (the source's 116–127°E screen, widened west for the Kalayaan Island Group: Pag-asa is at
   114.28°E) or more than 0.02° (about 2 km) from every legislative district outline, that is out at sea. A line
   whose pairs are all dropped falls through to step 2 and is flagged `gps_not_drawn`.
2. **The place the title names** (`locations.Matcher.match`, `location_evidence_v6.5`, with the office's region and
   province as hints, as the source's master list calls it): a barangay, else a municipality or city, else a
   province. Several places: the one specific place when the rest is province context (an independent city written
   with its old province, "Barangay 29, Bacolod City, Negros Occidental", which the source's shared method names
   as the normative reading), else the town they share, else the province they share. Drawn at the centre of the
   place's 2023 PSA outline (`buildMpbPsgcApproxOverlay.resolve_centroid`; a barangay with no outline falls back to
   its town, a town to its province). FY2027 uses the source lens's `row_psgc` through the same function.
3. **The DPWH office (DEO)**: the legislative district it serves, or the union of the districts a shared office
   serves (from `districts.json`, joined on the GAA label per year).
4. **The region**: the office's region (never the Central Office's), else a region the title names
   ("… Evacuation Centers - Region VIII").
5. **Nowhere**: listed, not mapped (1 to 21 lines a year, mostly Central Office lines that name no place).

The legislative district of a line is a separate lookup, in the source's order: the title's place (PSGC2LEG; split
cities by barangay; a province only when it is one district), else the GPS point (inside one district outline),
else an office that serves one district. FY2027 keeps the source lens's district resolution
(`title_psgc`, `deo_to_leg`; `deo` and `region` rows get none).

Placement by year (2026-11-02 build): FY2020–FY2025 place 96–97% of lines at a barangay, town or city from the title alone;
FY2026 has GPS in 79% of titles; FY2027 House bill 30% GPS, the rest almost all by title.

## Text repairs, district qualifiers and the Maguindanao rule

FY2015–FY2017 titles often end a place with the legislative district of the time ("San Luis, Pampanga 4th LD",
"Mandaluyong City Lone District"). `DISTRICT_QUALIFIER` sets it aside before matching, not in the title shown; it
moved FY2015 lines placed by office from 211 to 69. The map uses today's districts, from the place.
FY2015 titles carry their program in front ("Local Infrastructure Program - Construction of …"); it is kept as the
line's PAP and taken off the title.


The GAA extract has garbled characters. Exact character rules (`GAA_TEXT_REPAIRS` in `build.py`) fix them before
matching and for display, never a place name; the published text stays in the CSV (`title_as_published`):
`±` for ñ between letters ("Las Pi±as", 456 lines), byte-order marks, `\x96` and ` û ` for dashes, `Æ` for an
apostrophe, a stray trailing `á`, `ň`/`ń` for ñ, and Cyrillic look-alikes in "Davao deОго". Titles from before 2023
that say "Maguindanao" (split by RA 11550) are matched as the successor province that holds the named town, when
exactly one does (`maguindanao_successor`, about 230 lines).

## Flags (per line, shown under the line)

| Flag | Meaning |
| --- | --- |
| `gps_not_drawn` | A published GPS pair lies outside the country or out at sea; not drawn, not used |
| `gps_district_differs` | The GPS point lies in another legislative district than the title's place |
| `office_elsewhere` | GAA: the title's place is in another province than the one the DEO is named for. FY2027: the source's `office_location_mismatch` |
| `maguindanao_successor` | See above |
| `text_repaired` | A character repair changed the title |
| `gps_wider_reader` | The GPS pair was read by `WIDER_GPS`, not the source's reader |

`office_elsewhere` compares provinces, not districts: offices served other districts before the 2025 crosswalk,
so a district comparison flagged hundreds of ordinary FY2020–FY2022 lines.

## The map

MapLibre GL 6 over CARTO's Positron basemap (the source's map uses CARTO Voyager; Positron is greyer, so the data
reads). The basemap and its fonts load from `basemaps.cartocdn.com`; if they fail the page says so and the list
still has every line. Districts are shaded in red by amount in the chosen years (Jason, 2026-11-02): the campaign
red `#d62828` mixed light to dark as the site mixes its blue ramp, five quantile classes, fading at street zoom.
Marks: GPS (blue dot), a place a title names (white ring sized by its lines), an office area or region (grey disc),
clusters below zoom 10 (dark ink, with the count). What is picked is blue: the place picked from the list (ring on
a white halo) and the district clicked on the map (outline). Against every red step, worst colour-blind ΔE (dataviz
validator, target ≥ 8): blue 25, grey 10, ink 9.3 (with a white edge). Colours live in `src/components/mpb-map-style.ts`. One control row scopes the map and the list; a
district or place picked on the map narrows the list only. Every control is in the URL (`years`, `stage`, `q`,
`region`, `placed`, `rule`, `district`, `place`, `sort`).

## Refresh

```sh
UPSTREAM_GIT=/tmp/dpwh-nep-review/repo npm run build:hgab-mpb-years   # or without UPSTREAM_GIT: raw.githubusercontent.com
npx tsx scripts/verify-hgab.ts --no-pdf
```

To move the pin, change `COMMIT` in `scripts/hgab-mpb-years/upstream.py`. The build fails unless: the PAP lines
equal `history.json` in all nine budgets; the lens was built from the pinned `comparison_projects_2027.json`
(SHA-256); our `dpwh/projects.parquet` equals those comparison rows (title, NEP, House, PAP) for every FY2027 line;
every line is placed exactly once; the lens's GPS points are all accounted for (drawn or at sea), apart from
the pairs `WIDER_GPS` adds for rows the lens has none for.

Publish only this folder (the shared data tree holds other branches' files): copy `mpb-years/` into an empty
staging tree and run `npm run upload:hgab -- --out=<staging> --skip-verify` after a full verify passes.
