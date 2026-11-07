# Roads and bridges, every budget (work in progress)

Jason (2026-11-07): "how do we do the same for road, highway, and similar projects … Let's start work the same way we
did for MPBs". The multi-purpose building order is the plan: every line in every budget we hold (FY2015 GAA to the
2027 House bill) on a map, with repeats, contractors, the NEP vs House bill page, the region, party and office grids,
and links to where each line is printed. This file records the decisions and what the data allows; it grows with the
build.

## Decisions (Jason, 2026-11-07)

- **Scope: all roads and bridges.** DPWH capital outlays (UACS expense class 6) under these program codes, shown as
  parts so district roads stay separate from national ones:

  | Part | Codes (FY2018 on; FY2020–FY2026 figures) |
  | --- | --- |
  | National roads: maintenance, rehabilitation, widening, bypasses, new roads | 3101…, 3102… (less road drainage) |
  | Drainage along national roads | 310110, 310111, 310112 |
  | Bridges | 3103… |
  | Access roads (airports, seaports, tourism, trade and industry) | 300201–300204 |
  | Special Road Fund (motor vehicle user's charge) | 300214 |
  | BIP roads and bridges | 300221–300224, 300236, 300239 (src/lib/hgab-history.ts `BIP_CODES.roads`) |
  | SIPAG roads and bridges | 300215–300218, 300233, 300243 (`SIPAG_CODES.roads`) |
  | Local Program roads and bridges | 300110–300119 |

  FY2020–FY2026: 9,509–13,261 lines and ₱338–586 billion a year.

- **Placement, first that works:** the matched DPWH contract's coordinates; then the title (GPS printed in it, then the
  place it names); then the DPWH office; then the region. Each line says which one placed it.

## What the data allows

- **Titles rarely carry GPS** (33 of 10,385 road lines in FY2026). About a third carry road stations
  ("Calapan South Road – K0029+690 – K0031+087"), which give the length (1,397 m). Some carry DPWH's road section ID
  (S01859LZ). Road names fool the place reader: "Masbate–Cataingan–Placer Rd" names three towns.
- **Contract coordinates.** DPWH's contract list has a point for about 99% of FY2018–FY2023 contracts (78% FY2025, 7%
  FY2026). The FY2020–FY2026 line-to-contract links (docs/dpwh-contracts.md) give a point to 6,106 of 9,509 road lines
  in FY2020 … 7,339 of 12,256 in FY2025, but 778 of 10,385 in FY2026. FY2015–FY2019 and 2027 have no links. A contract's
  detail holds one point per component (DPWH's site tracking, marked unverified), never a path.
- **Lines on the map need road geometry.** DPWH's road network with its kilometre posts (RBIA) is not published; it
  takes an FOI request. OpenStreetMap has the roads but only 2,555 kilometre posts nationwide.

## OpenStreetMap drawing test (2026-11-07)

`scripts/hgab-roads/osm_extract.py` reads the Geofabrik Philippines extract (613 MB; about 20 minutes) into
`roads.parquet` (1,414,650 road ways, WKB) and `posts.parquet` (every `highway=milestone`). `osm_draw_test.py` tries
300 FY2023–FY2025 national road lines with stations and a contract point:

| Result | Lines |
| --- | --- |
| Contract point within 50 m of an OSM road | 300 (100%) |
| The title's road name found within 1.5 km | 213 (71%) |
| Drawn | 202 (67%) |
| … at the exact stations, from OSM kilometre posts | 26 (9%) |
| … at the stated length, centred on the contract's point | 176 (59%) |

- Station-cut lines sit a median 194 m from DPWH's point; a quarter are 0.9–7.5 km off, so the posts are not always
  right. Rule for the build: use stations only when they land within about 300 m of the point.
- Centred lines follow the right road through the point; where along the road is approximate.
- Misses are mostly fixable: abbreviations (Sn, Sta, DS, Natl, Hi-way), the name in brackets ("Maharlika Highway
  (Digos-Makar Rd)"), OSM naming the road differently ("Koronadal–Cotabato Highway" for "Cotabato–Marbel Rd") or not
  at all (fall back to the national road under the point, marked lower confidence).
- A title with several station ranges kilometres apart (Iloilo East Coast–Capiz Rd, km 274 and km 282) is not drawn
  as one stretch: it stays a point, with its length.
- Licence: OpenStreetMap is ODbL. The map credits "© OpenStreetMap contributors"; any published file holding the drawn
  geometry is a derivative database, offered under ODbL.

## The build (`npm run build:hgab-roads`)

`scripts/hgab-roads/run.sh` → `build.py`, on the flood control build's frame (scripts/hgab-flood-compare) and the
multi-purpose map's readers (scripts/hgab-mpb-years: GPS screens, the title matcher, FY2019's text, centroids). It
needs the same environment: run `npm run build:hgab-mpb-years` once.

**Which lines.** Each year's own code set:

- FY2018–FY2026: the parts above, under their codes, capital outlays only. The Local Program part uses the chart's
  `LOCAL_ROADS` exactly. 300110, one line a year listing toll expressways (CALAX, TPLEX, NLEX–SLEX Connector …), is
  its own part, "Public–private partnership expressways: right-of-way and support". FY2019 comes from the technical
  GAA's text.
- FY2015–FY2017: the older code set's National Roads and Bridges program, its project families 1650030, 1650040 and
  1650050. 1650020 (regional support, design, equipment, research) is left out. A few drainage and revetment works
  printed under the program stay in: there the program decides, not the work.
- 2027: the Asset Preservation, Network Development and Bridge programs (drainage along national roads as its own
  part), BIP access and coastal roads, and the Local Program's public–private partnership support fund (its title
  lists the same expressways, and a DPWH office building).
- Titles with road words under other codes are not counted; `road_titled_elsewhere` tallies them per budget.

**Where each line goes**, first that works:

1. the matched DPWH contract's point (FY2020–FY2026), in the Philippines and on land;
2. its stations, placed along the road by DPWH contracts on the same road (the drawing step, below; the page moves the
   line there: Jason, 2026-11-07, the contracts come first);
3. GPS printed in the title;
4. the place the title names (2027: the source's location lens);
5. the DPWH office (an office the crosswalk does not know, an older name: the province it is named for);
6. the region (regional offices read from their name, "Regional Office X - Proper"; FY2019 from the document's
   region headings).

The legislative district follows the same order: contract point, title's place, GPS, the office's one district.
Lines the GAA splits over several offices sit under the largest one (`several_offices`). 2027 lines in both
documents whose House stretch differs from the NEP's (the lens's `scope_review`, 37 lines) count as in both
(`stretch_differs`). A contract point in another region than the line's office is flagged
`contract_region_differs`.

**Stations.** Every station range in a title (`K0029+690 - K0031+087`, `K0379 + (-400) - …`, `Sta. 0+183 - Sta. 0+503`)
gives the line's `length_m`. A range with metres past 999, reversed, or longer than 30 km is kept and flagged
`stations_review`. DPWH road and bridge section IDs (`S01859LZ`, `B03085LZ`) are kept.

| Budget | Lines | Amount | Contract point | GPS | Place in title | Office | Region | Not placed | With stations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gaa-2015 | 6,604 | ₱209.1B | 0 | 0 | 3,624 | 2,311 | 669 | 0 | 1,824 |
| gaa-2016 | 7,336 | ₱260.6B | 0 | 0 | 3,715 | 2,151 | 1,308 | 162 | 2,041 |
| gaa-2017 | 7,575 | ₱297.4B | 0 | 0 | 3,680 | 3,010 | 48 | 837 | 2,402 |
| gaa-2018 | 9,571 | ₱414.5B | 0 | 0 | 5,783 | 2,725 | 1,063 | 0 | 2,561 |
| gaa-2019 | 8,848 | ₱255.0B | 0 | 0 | 6,339 | 0 | 2,509 | 0 | 1,925 |
| gaa-2020 | 9,509 | ₱338.2B | 6,104 | 0 | 1,050 | 1,765 | 590 | 0 | 2,707 |
| gaa-2021 | 13,261 | ₱398.6B | 6,309 | 0 | 3,209 | 2,846 | 897 | 0 | 3,979 |
| gaa-2022 | 11,638 | ₱469.6B | 7,346 | 0 | 1,496 | 1,985 | 811 | 0 | 3,620 |
| gaa-2023 | 10,620 | ₱459.3B | 6,386 | 0 | 1,507 | 1,882 | 845 | 0 | 3,611 |
| gaa-2024 | 11,583 | ₱492.8B | 7,095 | 0 | 1,649 | 1,717 | 1,122 | 0 | 3,641 |
| gaa-2025 | 12,256 | ₱585.8B | 7,336 | 0 | 2,557 | 1,152 | 1,211 | 0 | 3,701 |
| gaa-2026 | 10,385 | ₱372.3B | 778 | 55 | 5,642 | 2,501 | 1,409 | 0 | 8,108 |
| nep-2027 | 6,460 | ₱405.7B | 0 | 84 | 4,234 | 2,099 | 30 | 13 | 2,733 |
| house-2027 | 8,007 | ₱383.1B | 0 | 342 | 5,259 | 2,181 | 212 | 13 | 3,448 |

Not placed: FY2016–FY2017 Central Office lines whose title names no place and whose file gives no region ("Daang
Maharlika (MN) - K1435+000 …"); 2027, lines budgeted nationwide. They are counted, listed and in the CSV, not drawn.

**Checks** (80, the build stops on any): BIP, SIPAG and Local Program roads equal the multi-purpose page's chart in
every budget it covers; FY2020–FY2026, every part equals the extract's capital outlays under its codes, to the peso;
FY2019, each heading equals the lines under it; every line placed once; every linked line whose contract has a usable
point is placed by it; the region matrix adds up to each budget.

**Outputs** (`data/hgab/2027/roads/`): `lines-<budget>.json` (one per budget, the multi-purpose map's format with
road columns: part, contract, stations, length_m, sections), `lines.csv` (every budget, 60 MB), `summary.json`.

## Drawing along OpenStreetMap (`npm run draw:hgab-roads`)

`scripts/hgab-roads/draw.sh` → `draw.py`, after the build. It downloads the Geofabrik Philippines extract once
(checksum checked), reads its roads and kilometre posts once (`osm_extract.py`, about 20 minutes), then draws in under a
minute. It draws a line placed at a point (its contract's, or GPS in its title) whose title prints stations:

1. the road the title names (text before its stations, less a leading work such as "Preventive Maintenance along"; the
   name in brackets tried too; Sn, Sta, Sto, Rd, Jct, Hwy, Bdry, Natl, Br. spelled out), matched by name, ref or other
   names among the OSM roads within 1.5 km (score ≥ 85, `named`); else the national-class road within 30 m of the
   point (`class`, lower confidence);
2. that road's same-named ways within about 40 km, merged; the piece the point is on;
3. `stations` when OSM kilometre posts place the title's stations within 300 m of the point; else `centred`, the
   stated length along the road centred on the point. Not drawn: stations scattered over more than the length plus
   1 km (one stretch would be wrong), or no road found.

Outputs beside the build's: `geom-<budget>.json` (`[line id, how, confidence, [[lng, lat] …] per stretch]`, simplified
to 4 m, ODbL with "© OpenStreetMap contributors") and `draw-summary.json` (the extract's checksum and date, the rules,
the census per budget).

First run (extract of 2026-11-07):

| Budget | Eligible | Drawn | at stations | centred, named road | centred, national-class road | Scattered | No road |
| --- | --- | --- | --- | --- | --- | --- | --- |
| gaa-2020 | 397 | 286 | 13 | 190 | 83 | 64 | 47 |
| gaa-2021 | 288 | 240 | 21 | 169 | 50 | 21 | 27 |
| gaa-2022 | 757 | 594 | 25 | 402 | 167 | 89 | 74 |
| gaa-2023 | 819 | 714 | 51 | 490 | 173 | 82 | 23 |
| gaa-2024 | 869 | 726 | 28 | 521 | 177 | 110 | 33 |
| gaa-2025 | 1,325 | 1,083 | 46 | 785 | 252 | 182 | 60 |
| gaa-2026 | 489 | 305 | 5 | 222 | 78 | 61 | 123 |
| nep-2027 | 35 | 19 | 0 | 13 | 6 | 1 | 15 |
| house-2027 | 41 | 23 | 1 | 15 | 7 | 1 | 17 |

**The limit is the anchor, not the road.** Few lines have both stations and a contract point: national road lines
(the ones with stations) are often let as several contracts, and the contract matching drops splits
(docs/dpwh-contracts.md). So 2025 draws 1,083 of its 3,701 lines with stations.

**Next: DPWH's own contracts as kilometre posts.** Contract descriptions repeat the road and its stations
("… along Road - Dagupan-Bonuan-San Fabian Rd - K0379 + (-400) - K0379 + (-200)") and carry a point. Every such
contract, any year, is an anchor: this road, this station, here. Two or more anchors on a road give its stations'
direction and scale along the OSM road, so any line's stations on that road can be cut, with or without its own
contract, in any year. The anchors' scatter against the fit is the check.

## DPWH contracts as kilometre posts (2026-11-07)

Jason: "you can do as recommended dpwh's own contracts as km posts", then "do those 2 items" (stations before the title's
place; contract details). `draw.py` draws a line in any budget, with or without a contract of its own, when DPWH contracts
on the same road place its stations:

- **Anchors.** 28,567 contracts in DPWH's list print stations in their description and carry a point. 21,116 anchor at
  the middle of their stations (span ≤ 5 km, past kilometre 1: a local road's own stations restart at 0 for every road).
  3,421 whose stretches lie further apart give one candidate per stretch: their one point marks one of them, and only
  the right one can agree with the other anchors (a contract counts once in a fit; a fit that leans on candidates needs
  three contracts). Stretches printed from their far end (`K0017+357 - K0016+188`) count. OpenStreetMap's kilometre posts
  on the road join them.
- **Per line**, stations past kilometre 1: the anchors whose road name reads like the line's (token sort ratio ≥ 90;
  "Daang Maharlika" = "Maharlika Highway") and whose stations lie within 20 km of the line's, in one place (within
  45 km of their middle) and within reach of the line's mark (25 km for a barangay … 250 km for a region). The OSM road
  most of them lie on (within 250 m), found by name, else the national road under them. A robust fit of road position
  against station: every pair of anchors from two contracts 300 m of station apart proposes one; the one most contracts
  agree with within 300 m wins; its scale must be 0.8–1.25 m of road per metre of station. The line's own ranges are
  cut from it, each on its own (so titles with stretches kilometres apart draw too), never more than 5 km outside the
  anchors. A line with its own point keeps the cut only within 1 km of that point; else it is drawn as before.
- **Placement.** An anchored line sits at the middle of its stretch, with that stretch's district and region
  (`placeByStations`, "Its stations on the road"), unless its own contract's point or GPS in its title placed it:
  6,034 lines, 5,396 that sat only at an office's area, a region or nowhere, and 638 at a place their title names
  (often a province inside the road's name, "Davao-Bukidnon Rd" at Bukidnon's centre: a median 24 km from their
  stretch). A 2015 Central Office line listed under NCR, Calapan South Rd K0126–K0140, now sits in Oriental Mindoro.
  The placement is the page's (the geometry files hold the stretches and are ODbL); lines.csv keeps the build's.

| Budget | With stations | Drawn | anchored | OSM posts | centred | Anchor residual, median / 90th pct |
| --- | --- | --- | --- | --- | --- | --- |
| gaa-2015 | 1,824 | 264 | 264 | 0 | 0 | 63 m / 121 m |
| gaa-2016 | 2,041 | 356 | 356 | 0 | 0 | 66 m / 116 m |
| gaa-2017 | 2,402 | 423 | 423 | 0 | 0 | 68 m / 128 m |
| gaa-2018 | 2,561 | 328 | 328 | 0 | 0 | 57 m / 132 m |
| gaa-2019 | 1,925 | 145 | 145 | 0 | 0 | 53 m / 113 m |
| gaa-2020 | 2,707 | 740 | 533 | 11 | 196 | 68 m / 132 m |
| gaa-2021 | 3,979 | 1,012 | 833 | 22 | 157 | 70 m / 131 m |
| gaa-2022 | 3,620 | 1,179 | 715 | 28 | 436 | 73 m / 130 m |
| gaa-2023 | 3,611 | 1,291 | 735 | 44 | 512 | 68 m / 126 m |
| gaa-2024 | 3,641 | 1,255 | 701 | 31 | 523 | 69 m / 132 m |
| gaa-2025 | 3,701 | 1,510 | 656 | 52 | 802 | 65 m / 135 m |
| gaa-2026 | 8,108 | 872 | 640 | 2 | 230 | 69 m / 132 m |
| nep-2027 | 2,733 | 352 | 333 | 0 | 19 | 66 m / 127 m |
| house-2027 | 3,448 | 406 | 383 | 1 | 22 | 64 m / 127 m |

10,133 lines drawn in all (3,971 before the anchors). The residuals (how far the anchors a fit kept sit from it) are
53–73 m at the median and 113–135 m at the 90th percentile. `draw-summary.json` records why a line was not anchored
(`not_anchored:*`): mostly too few contracts on its road near its stations (`few_candidates`), then anchors not in one
place, not on the road found, no fit, or stations outside the anchors.

**Contract details do not help (checked 2026-11-07).** A contract's detail (`/projects/<id>` through
api.dpwh.bettergov.ph) has one point per component, but components are kinds of work (asphalt overlay, concrete
pavement), not stretches: each lists every stretch. In 40 random multi-stretch contracts, all 40 had one point listing all
their stretches, as the list does; none would anchor. So the ~28,500 details were not fetched; the candidates above use
those contracts instead.
