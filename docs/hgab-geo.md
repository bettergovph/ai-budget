# FY2027 HGAB: map data

## Maps

Each dataset hub has a Map tab (`?view=map`). This file covers the data behind it. The loaders and types are in `src/lib/hgab.ts`, section "Maps".

| File | Type | What it holds |
|------|------|---------------|
| `hgab/2027/geo/provinces.json` | `HgabGeo` | 88 province outlines (Metro Manila as its four districts), each tagged with its region today |
| `hgab/2027/<dataset>/map.json` | `HgabDatasetMap` | Amounts per region per document, the amounts not on the map, and dots where a document prints coordinates |
| `hgab/2027/geo/manifest.json` | — | Input sha256s, parameters, coverage, the region-label table, and the diagnostics below |

### Refresh

```bash
npm run build:hgab-geo -- --check
# defaults: --out=data/hgab/2027 --geo=/home/jason/projects/dynasty/data/raw/geo \
#   --gps=/tmp/dpwh-nep-review/repo/gps-analysis/data/gps_inventory.json --res=hi
# --tolerance=<deg> fixes the simplification; --res=low|med|hi picks the source files
```

Run this after `npm run import:hgab`. It reads each dataset's `summary.json` and `projects.parquet` and `overview.json`, and retries a read that fails while the importer is rewriting them. `--check` re-reads every output and verifies it (59 checks; see below).

### Sources and licence

- **Province outlines.** [philippines-json-maps](https://github.com/faeldon/philippines-json-maps), MIT licence, Copyright (c) James Faeldon. The boundaries follow PSGC as of 31 December 2023 (Philippine Statistics Authority). The upstream shapefiles are [philippines-psgc-shapefiles](https://github.com/faeldon/philippines-psgc-shapefiles), also MIT. The files are the cached copies in the dynasty project, `data/raw/geo/` (`2023/geojson/regions/{lowres,medres,hires}`). `HgabGeo.source` carries this citation.
- **DPWH coordinates.** BetterGov DPWH-NEP-HB-2027-ANALYSIS, `gps-analysis/data/gps_inventory.json` (hits with `dataset == "dpwh_comparison_2027"`). That repository has no licence; see `docs/hgab-data.md`.
- **FMR coordinates.** The `coordinates` the source workbench normalised from each list's START/END cells. They reach us through `fmr/projects.parquet` `record_json` (`house.coordinates`, `nep.coordinates`).

**Resolution.** The builder uses the high-resolution province files (`prov-hires-provdists-region-<adm1>.0.1.json`, 10% of source vertices). It rounds them to 4 decimals and applies Douglas–Peucker per ring, using the smallest tolerance in 0, 0.001, … 0.01° that keeps `provinces.json` under 450 KB. That tolerance is currently **0.004° (about 450 m)**, which gives 19,477 vertices and 369 KB. The low-resolution files (`prov-provdists-region-*.0.001.json`) are simplified region by region upstream, so shared borders do not meet. They leave gaps tens of kilometres wide between neighbouring regions (for example, between Cordillera and Ilocos or Cagayan Valley), and some Cordillera provinces come out as 5–7-point polygons. `--res=low` reproduces them. Islets smaller than the tolerance disappear, but every province keeps at least one polygon. Exterior rings run counter-clockwise and holes clockwise (RFC 7946), so SVG `nonzero` fill cuts the holes.

`bbox` is [114.2779, 4.616, 126.605, 21.1219]. The western edge is the Kalayaan Island Group, which is part of Palawan. The main archipelago starts at about 116.9°E.

### Regions on the outlines

Each feature's `adm1_psgc` sets its region: 100000000 → I … 1200000000 → XII, 1300000000 → NCR, 1400000000 → CAR, 1600000000 → XIII, 1700000000 → MIMAROPA, 1900000000 → BARMM. These provinces are then moved to the region they belong to today, which is the region every list in this section prints for them:

| PSGC | Province | 2023 region | Map region | Why |
|------|----------|-------------|------------|-----|
| 604500000 | Negros Occidental | VI | **NIR** | Negros Island Region, Republic Act 12000 (2024) |
| 704600000 | Negros Oriental | VII | **NIR** | same |
| 706100000 | Siquijor | VII | **NIR** | same |
| 1906600000 | Sulu | BARMM | **IX** | The Supreme Court ruled in 2024 that Sulu is not part of BARMM. The DPWH list (Sulu 1st and 2nd District Engineering Offices), the farm-to-market road list and the health facilities list all print Sulu under Region IX |

- Bacolod is not a separate feature in this release; it sits inside Negros Occidental, so it is NIR.
- The City of Isabela (990100000) is its own feature on Basilan island, and it is Region IX, as PSGC places it.
- **Name gaps.** The source leaves 1909900000 (BARMM) unnamed. It is the Special Geographic Area, the North Cotabato barangays that joined BARMM, and it is named "Special Geographic Area" from PSGC. Every other feature carries its own `adm2_en`, with " (Not a Province)" removed.
- The four Metro Manila districts are named by the cities the source's municipal files place in them, for example "Metro Manila: Mandaluyong, Marikina, Pasig, Quezon City, San Juan".

### Amounts per region

- **Source.** Amounts come from `summary.json` `dims.region`. Each document's amounts there are already tallied under the region label it prints. Labels are normalised with the contract's `regionKeyOf()`, and rows that share a key are merged. The builder keeps an exact copy of `regionKeyOf` and checks on every run that it gives the same key as the contract's own code for every label it saw.
- **Region list.** `regions` lists all 18 keys in `REGION_ORDER`. A side is `null` when that document lists nothing there, and `delta_php` is null unless both sides exist. `source_labels` holds every label printed for the key, both the summary's labels and those on the records. This is how FMR's upper-case House and title-case NEP spellings both appear. The labels are ordered by how many `projects.parquet` rows carry each exact `region` value, most first, so `source_labels[0]` is the best exact-match Projects-tab filter. For FMR, the title-case label holds only the NEP-only remainder, for example 8 of Ilocos's 104 rows, so a filter that matches all of `source_labels` catches every row.
- **Not on the map.** Labels that normalise to null go to `not_on_map`: DPWH's "Nationwide", 18 rows with ₱6,726,400,000 in the NEP and ₱3,726,400,000 in the House bill. NIA prints no region at all, so its whole total is `not_on_map` ("No region printed"), `regions` is empty and `placeable` is false.
- **House figures.** These are the latest reading: third reading for DPWH (`hgab3`). FMR, HFEP and NIA have one House list (`hgab2`, identical at third reading).
- **Conservation.** For each document, Σ regions + `not_on_map` must equal `overview.json` `totals.nep_php` and the House total, and the row counts must equal `counts`. The builder stops otherwise, and `--check` re-verifies.

| Dataset | Regions with rows | Not on map | NEP total | House total |
|---------|------------------:|------------|----------:|------------:|
| DPWH | 17 (no BARMM) | Nationwide | 572,924,074,000 | 587,075,661,000 |
| FMR | 16 (no NCR, BARMM) | — | 16,000,000,000 | 19,628,100,000 |
| HFEP | 18 | — | 14,472,519,000 | 10,021,659,000 |
| NIA | 0 | No region printed | 17,598,181,000 | 17,999,305,000 |

**DPWH caveat.** The DPWH documents print Central Office projects under "NCR". Of NCR's NEP ₱159.1 billion, ₱149.1 billion is Central Office money, mostly foreign-assisted projects built elsewhere: the Laguna Lakeshore Road Network, the Bataan–Cavite Interlink Bridge, the Cebu–Mactan 4th Bridge and the Davao City Bypass. The DPWH `note` says so in plain words.

#### Every printed label and its key

| Printed label | Key | Datasets |
|---------------|-----|----------|
| NCR | NCR | DPWH, HFEP |
| CAR | CAR | DPWH, HFEP |
| CORDILLERA ADMINISTRATIVE REGION (CAR) | CAR | FMR |
| Region I | I | DPWH, HFEP |
| Region I - ILOCOS | I | FMR |
| REGION I - ILOCOS | I | FMR |
| Region II | II | DPWH, HFEP |
| Region II - CAGAYAN VALLEY | II | FMR |
| REGION II - CAGAYAN VALLEY | II | FMR |
| Region III | III | DPWH, HFEP |
| Region III - CENTRAL LUZON | III | FMR |
| REGION III - CENTRAL LUZON | III | FMR |
| CALABARZON | IV-A | HFEP |
| Region IV-A | IV-A | DPWH |
| Region IVA - CALABARZON | IV-A | FMR |
| REGION IVA - CALABARZON | IV-A | FMR |
| MIMAROPA | MIMAROPA | DPWH, HFEP |
| Region IVB - MIMAROPA | MIMAROPA | FMR |
| REGION IVB - MIMAROPA | MIMAROPA | FMR |
| Region V | V | DPWH, HFEP |
| Region V - BICOL | V | FMR |
| REGION V - BICOL | V | FMR |
| Region VI | VI | DPWH, HFEP |
| Region VI - WESTERN VISAYAS | VI | FMR |
| REGION VI - WESTERN VISAYAS | VI | FMR |
| NEGROS ISLAND REGION (NIR) | NIR | FMR |
| NIR | NIR | DPWH, HFEP |
| Region VII | VII | DPWH, HFEP |
| Region VII - CENTRAL VISAYAS | VII | FMR |
| REGION VII - CENTRAL VISAYAS | VII | FMR |
| Region VIII | VIII | DPWH, HFEP |
| Region VIII - EASTERN VISAYAS | VIII | FMR |
| REGION VIII - EASTERN VISAYAS | VIII | FMR |
| Region IX | IX | DPWH, HFEP |
| Region IX - ZAMBOANGA PENINSULA | IX | FMR |
| REGION IX - ZAMBOANGA PENINSULA | IX | FMR |
| Region X | X | DPWH, HFEP |
| Region X - NORTHERN MINDANAO | X | FMR |
| REGION X - NORTHERN MINDANAO | X | FMR |
| Region XI | XI | DPWH, HFEP |
| Region XI - DAVAO | XI | FMR |
| REGION XI - DAVAO | XI | FMR |
| Region XII | XII | DPWH, HFEP |
| Region XII - SOCCSKSARGEN | XII | FMR |
| REGION XII - SOCCSKSARGEN | XII | FMR |
| Region XIII | XIII | DPWH, HFEP |
| Region XIII - CARAGA | XIII | FMR |
| REGION XIII - CARAGA | XIII | FMR |
| BARMM | BARMM | HFEP |
| Nationwide | — (not on map) | DPWH |

The manifest's `region_labels` regenerates this table on every run.

### Points

Dots appear only where a document prints coordinates. Nothing is geocoded from place names.

- **Fields on every point.** `trace`, `title`, `nep_php` and `house_php` (= `hgab3_php ?? hgab2_php`) come from the parquet row. `group` and `held` come from `TRACE_LABELS`, checked against the contract on every run. Coordinates are rounded to 5 decimals. Points are sorted largest amount first.
- **Bounds.** Any point outside lon 116–127, lat 4–22 is dropped and counted, and a line segment with a vertex outside is dropped. A point inside the bounds is kept even when it is clearly a typing error. For example, DPWH `house-reading:6548` (the Bolinao–Santiago Island bridge) prints "6.38299, 119.92525 + 16.38329, 119.92648". Its dot uses the first pair, which lands in the Sulu Sea. It is the only multi-point DPWH title where the first point misses the printed region.
- **FMR.** Each row's `record_json` `house.coordinates` / `nep.coordinates` (segments of [lon, lat]).
  - The House coordinates are used when both lists print them; the NEP's are used only when the House prints none inside the bounds.
  - `printed_by` is `both` when the two lists print identical coordinates, otherwise the list used.
  - The dot is the midpoint (by length) of the first segment, and `lines` holds every segment of two or more points.
- **DPWH.** Hits in `gps_inventory.json`, joined on `record_id` = parquet `id` (all 2,350 join; titles agree, apart from 21 the inventory shortens with "…").
  - The inventory's `title` field is the House title when the House lists the project, and the NEP title otherwise. Its `nep.title` field is the NEP title. `printed_by` follows from that, and is `both` when both titles print the same points.
  - Points are de-duplicated (the scanner repeats START/END pairs as unspecified points), and the dot is the first point.
  - `lines` are drawn only when the full printed title has as many "Start" as "End" words and exactly two points per pair, as in "Start 18.59, 120.85 End 18.59, 120.85" or "Segment 1 - Start … End … Segment 2 - Start … End …". Multi-site titles, such as covered courts in seven barangays, get a dot only.
- **HFEP.** The lists print no coordinates.
- **NIA.** One project (the Tarlac RIS headgate) prints a coordinate pair in both lists. The rest print none, and there is no region, so the tab explains instead of drawing.

### Coverage (current build)

| Dataset | Rows | With region | With points | Printed by (house / nep / both) | Dropped | Notes |
|---------|-----:|------------:|------------:|---------------------------------|--------:|-------|
| DPWH | 17,613 | 17,595 | 2,348 | 1,965 / 108 / 275 | 1 | 2,350 inventory hits. One is unreadable: its DMS pair is OCR-damaged. One prints (10.609, 10.609) and is dropped. 20 rows print different points in the two titles, and the House's are used. 138 have lines |
| FMR | 1,059 | 1,059 | 1,059 | 356 / 95 / 608 | 0 | Every road prints coordinates. One road differs between the lists, and the House's are used. 1,058 have lines |
| HFEP | 746 | 746 | 0 | — | — | |
| NIA | 1,013 | 0 | 0 | — | — | |

### Diagnostics (manifest only, not shown to readers)

- **`placement`.** Whether each dot falls inside a province of the region its record prints:
  - DPWH: 2,236 inside, 66 in another region and 46 just outside the outlines (coastal works). Of the 66, 37 are BARMM-area projects (mostly Lanao del Sur) that the DPWH list puts under Region X (31) or Region XII (6), and 24 are Central Office projects listed under NCR but built elsewhere. The other 5 look like boundary or typing cases.
  - FMR: 1,048 inside, 7 elsewhere and 4 outside the outlines. These are likely printed-coordinate errors, for example a "Talakag, Palawan" road whose point is in Bukidnon.
- **`lines_over_20_km`.** Nine FMR segments run 20–95 km, likely typing errors in one endpoint. They are kept as printed and listed for audit.

### Reader-facing text

`points_note`, `note` and `not_on_map.plain` are plain single sentences of at most 25 words. They cannot contain "ledger", "control", "bridge", "annex", "OCR", "trace" or "PDF". The builder and `--check` both enforce this.

- **DPWH** note: "Regional totals follow the region each document prints, so Metro Manila includes projects run from the DPWH head office but built elsewhere."
- **FMR** points note: "Each dot is a road at its printed coordinates; for the one road where the two lists differ, the House bill's are used."
- **HFEP** points note: "The health facilities lists name each facility but print no coordinates, so facilities are shown by region only."
- **NIA** note: "The irrigation lists name each system but print no region, and only one project prints coordinates, so the projects cannot be mapped."

### What `--check` verifies

- **Outlines.**
  - Every province has a valid region, every region has a province, and the NIR and Sulu overrides are in place.
  - PSGC codes are unique.
  - Rings are closed, have four or more points and 4 decimals, and fall inside `bbox`.
  - `regions` equals `REGION_ORDER` with the contract's labels.
- **Each map.json.**
  - The dataset key and `house_stage` are correct.
  - Region keys are valid, unique and in order.
  - Amounts are integer pesos. `delta_php` = House − NEP, and a side is null only when it has no rows.
  - Conservation holds against `overview.json`.
  - Every point id exists in `projects.parquet`, ids are unique, and each point's title, trace, group, held and amounts equal its row.
  - Every point and line vertex is inside the bounds.
  - `source_labels` are ordered by parquet row count, most first.
  - Coverage re-derives from the parquet.
  - The reader-facing text follows the rules above.
  - NIA has `placeable: false` with no regions and no points; HFEP has no points.
