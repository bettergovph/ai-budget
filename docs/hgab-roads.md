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
