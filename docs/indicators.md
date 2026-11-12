# Indicators section (`/indicators`)

Status: **built 2026-11-07, under review.** The pages carry a "New · under review" notice (`INDICATORS_UNDER_REVIEW` in `src/lib/indicators.ts`). Turn it off only when the maintainer says the review is done.

The section shows PSA statistics for every province and Metro Manila district, beside the national budget. It has 24 indicators in 7 themes. The exploratory work it grew from is in [budget-vs-statistics.md](budget-vs-statistics.md).

## Pages

| Route | Page | What it shows |
|---|---|---|
| `/indicators` | `src/pages/Indicators.tsx` | Every indicator as a card, by theme (Philippines figure, highest and lowest area), then one sortable table of all 87 areas with a theme switch, and the CSV download |
| `/indicators/:id` | `src/pages/IndicatorDetail.tsx` | Key figures, a province map, every area ranked (with PSA's CV for poverty), a chart against any other indicator, how the figure was made, sources, previous/next |
| `/indicators/budget-by-region` | `src/pages/BudgetByRegion.tsx` | Any indicator beside the budget assigned to each region: bars, a chart and a table. Poverty and DSWD come first. Choices are kept in the URL: indicator, department, 2027 NEP or 2026 GAA, per person or per unit of need, and sort (`?indicator=&dept=&budget=&per=&sort=`). |
| `/indicators/places/:area` | `src/pages/IndicatorPlace.tsx` | One area: every indicator beside the Philippines with its rank, notes on the area, a locator map |

Components:

- `src/components/IndicatorMap.tsx`: SVG choropleth over the House bill maps' province outlines (`hgab/2027/geo/provinces.json`), with a Metro Manila inset.
- `src/components/IndicatorScatter.tsx`: one x and one y axis. It uses a log scale only for pesos, people and density, and draws BARMM and Sulu hollow on budget comparisons. It prints no correlation figure.
- `src/components/IndicatorsBits.tsx`: the notice, the source list and the footer.

Helpers: `src/lib/indicators-view.ts` (colour classes, loader) and `src/lib/use-indicators.ts`.

**Nav:** "Indicators" is a primary tab between "General Appropriations 2000–2026" and "Citizen Reports". The eighth tab no longer fit one row at 1366px. Between 1025px and 1500px the tabs therefore use 6px padding and 15.5px type (`src/site-header.css`). Measured in Chromium, they fit one row from 1349px wide (a 1366px screen with a scrollbar); narrower windows wrap, as before.

**Colours:** sequential indicators use one blue ramp in five quintile classes. Changes (growth, poverty change, House change) are diverging: blue went down, red went up, grey is about zero. The map note says the colours do not mean good or bad. The ramps passed the dataviz validator's CVD checks; the low-contrast light steps are covered by the table under every map.

## Multi-purpose buildings per person (`/hgab/2027/multi-purpose/per-person`)

This page sits in the House bill section's Multi-purpose buildings menu, as "Per person". It sets every MPB line (FY2015 GAA to the 2027 House bill, `mpb-years/lines.json`) against the population in each budget's own year.

- **Map first** (`src/components/MpbPopulationMap.tsx`), because people read a map faster than a long table:
  - **Regions and provinces:** the province outlines in five quintile classes of the blue ramp. A region shades all its provinces the same.
  - **Cities and municipalities:** there are no town outlines, so each town is a circle at its place in the MPB data (its own point, else the middle of its barangays; 1,631 of 1,642 towns). The circle's size is the budget (or the number of projects) and its shade is the per-person class. Clicking a circle finds the town in the table.
  - Metro Manila repeats in an inset. Tips show on hover, and on tap on phones, and stay inside the map.
- **Measures** are written out in full, never as a bare number: "₱1,761 per person", or "1 project for every 990 people", which is easier to read than "101 per 100,000". Projects per 100,000 people is the secondary figure in each row's meta line and in the table.
- **Views under the map:**
  - **Regions and provinces:** bars with the label on each bar; blue above the country's average.
  - **Cities and municipalities:** a population-vs-budget log-log scatter of all 1,642 towns, with the country's average as a line and the ten highest per person labelled, plus a searchable table.

  A plain-language version (find your city, an answer card in sentences) was built and set aside at Jason's choice ("I kind of like it before").
- **Budgets:** any single budget; the FY2020–2026 GAA combined; or all years (`all-2015-2027-nep`: FY2015–2026 GAA + the 2027 NEP, ₱696.5B in 76,978 lines; `all-2015-2027-house`: + the 2027 House bill instead, ₱739.6B). Never both 2027 documents. The page says that all years mixes enacted budgets with a proposal, and that a multi-year building has a line each year.
- **Several years are a yearly average** (Jason, 2026-11-09). The combined and all-years budgets used to be totals over the 2024 population ("79,970 projects: 1 for every 1,410 people"), which reads like a count of buildings that exist. They are now per year: a place's projects and budget ÷ the number of years ÷ its average population over those years. So all years with the House bill is "1 project for every 17,672 people a year", ₱523 per person a year. Each budget lists its `years`; the rates say "a year" whenever there is more than one.
- **Placement:** a line counts where the MPB map places it:
  - the town its title names, or its GPS point (2023 PSGC codes moved to today's: NIR, Sulu, Manila's districts);
  - else the province;
  - else the one district its office serves.

  In the 2027 House bill, 99.2% of the budget is placed in a town and 100% in a region. Lines with no place in the source (₱4.2B in FY2019) stay unplaced, and the page shows the placed share.
- **Population, by budget year** (`popInYear` and `peopleIn` in `src/lib/mpb-population.ts`):
  - Every city and municipality carries its 2015, 2020 and 2024 counts (`census`). They come from one PSA table (`05c931eaecec498f9756`), which restates 2015 and 2020 on today's boundaries, so NIR and the BARMM towns line up. It is saved as three selections, because the three years together pass the API's 5,000-point limit: `census2024_towns`, `census2024_towns_2015` and `census2024_towns_2020`.
  - A budget year's population is that year's census, filled in between censuses at a steady (geometric) rate. Years after 2024, including 2027, use the 2024 count: we do not project. So the 2027 NEP and House bill are measured against the 2024 census, as before.
  - Provinces and regions are the sums of their towns. The build checks the towns against the country (100,979,303, 109,033,245 and 112,727,776) and against PSA's 18 region rows in each census.
  - With each year's own population, regions move 1–4% from the 2024-only figures (Bangsamoro, the fastest growing, about 8%). No region changes rank.
  - Isabela City is listed under Zamboanga Sibugay and is moved to its own area.
- **CSV:** one row per budget and place. Columns: the three census counts, `people` (the budget year's, or the average), totals, and the per-year rates (`php_per_person_per_year`, `people_per_line_per_year`, `lines_per_100k_per_year`).
- **Build:** `npm run fetch:psa -- --only=census2024_towns,census2024_towns_2015,census2024_towns_2020` if the census tables are missing, then `npm run build:mpb-population` (after `build:indicators`). It writes `hgab/2027/mpb-years/population.json` (schema 2, 889 KB) and `population.csv` (4.2 MB). Upload both with `upload:hgab -- --only=mpb-years/population.json,mpb-years/population.csv --skip-verify` after a full verify.
- **Carousel:** `npm run build:hgab-poster-mpb-people` writes five 1080×1350 slides, `mpbs-for-the-people-{1..5}of5`, to `data/hgab/2027/campaign/`. They use the dark figure style of the NEP vs House bill images:
  - 1: the 2027 House bill on a region map, with the most and the fewest;
  - 2: every region ranked;
  - 3: the NEP beside the House bill;
  - 4: all years as a yearly average;
  - 5: "Too many multi-purpose buildings?", in context. It shows:
    - the NEP → House bill beside flood control, DepEd school facilities and DOH health facilities (the budget-by-year chart's program lines in `history.json`, so the four compare like with like);
    - the budget per person each year;
    - how many of PSA's 42,010 barangays (PSGC, Q3 2026) were funded, and how often.

  Figures come from `population.json` (slide 5 also reads `history.json` and `lines.json`). The script stops if a total disagrees, if a claim on slide 5 stops being true (only MPBs went up; MPBs exceed school and health facilities together), or if any text is cut short.

## Budget beside each indicator, by region

Every indicator except the three budget ones can be set beside the budget assigned to each region, in two places:

- on its own page, in the section "Beside the budget, by region" (compact, with local controls);
- on `/indicators/budget-by-region`, the full view.

Both use `src/components/RegionBudgetCompare.tsx`; its state and defaults are in `src/lib/region-compare.ts`.

- **Region values.** `regions.json` `regions[].values` holds every indicator per region. The builder adds up the provinces that have a figure: counts and pesos are summed, and published rates are weighted (`RATE_WEIGHTS` in `src/lib/indicators.ts`). Poverty and the poverty gap are weighted by population, family income by families, and GDP per person by PSA's implied population. The age shares come from counts (`age_under15_2024`, `hh_population_2024`…), so they add up exactly.
- **Need.** An indicator's `need` is the group the budget serves, and turns the view into "share of X beside share of the budget" and "budget per X":
  - poor people: poverty, poverty gap;
  - children under 15: under 15;
  - people aged 60 and over: 60 and over;
  - registered births: births, infant and maternal deaths;
  - hectares of palay harvested: irrigated rice, rice yield.

  Without a need, the view sets the indicator's value beside budget per person. The counts are in `regions[].needs`.
- **Default department** (`budgetDept`):
  - DSWD: poverty, the poverty gap, poverty change, family income, 60 and over;
  - DepEd: under 15;
  - DOH: births and deaths;
  - DA: farms;
  - the whole budget: everything else.

  The reader can pick any department with at least ₱1 billion in the regions.
- **Notes the view adds by itself:**
  - Below 50% of a department in the regions, it warns that the figures leave most of it out.
  - When a department shows ₱0 in BARMM, it explains that BARMM runs those services from its block grant.

## Budget by region (`indicators/regions.json`)

Contract: `src/lib/budget-regions.ts`; built by the same `build:indicators` run. A budget line belongs to a region when DBM codes it there (`region_code` in `data/2027/<dept>/line_items.parquet`, the NEP import; FY2026 rows are the GAA). That is the region of the office that manages it.

| Bucket | 2027 NEP | 2027 House bill | 2026 GAA | Rule |
|---|---|---|---|---|
| Assigned to the 18 regions | ₱2.84T (39.5%) | ₱2.90T | ₱2.92T | region codes 01–19, plus NCR's own offices and BARMM's own lines |
| National offices coded to NCR | ₱2.63T | ₱2.59T | ₱2.45T | NCR lines except `NCR_LOCAL_PATTERN` (regional office NCR, schools divisions, DEOs, "Metro Manila") and NCR's state universities |
| Nationwide | ₱1.72T | ₱1.71T | ₱1.42T | region 00: NTA (₱1.32T), debt interest, other automatic items |

**Every peso is on the list.** Two rows sit below the 18 regions, so that regions + central + nationwide add up to the department's whole budget:
- **Central offices**: head offices, bureaus and national units, which DBM codes to NCR. In the all-departments view the row lists the largest departments.
- **Nationwide items**: the NTA, debt service and other automatic items.

They appear in three places:
- **Whole-budget bar:** a 100% bar above the comparison splits the whole budget into these three parts.
- **Rows under the comparison:** each shows its amount, its share of the whole and its per-person value if spread evenly over the country.
- **Table:** the same rows sit between "All 18 regions" and "Whole budget", with a "Share of the whole budget" column. `regions.csv` has `central` and `nationwide` rows and a `share_of_whole_budget` column; the verifier checks that they add up per budget × department.

The regions-only shares (the bars, "Share of the regions' budget") are kept for the poverty, children and births comparisons, because those groups all live in a region.

**The 2027 House bill** (`house2027`; House Bill 10858, third reading) is the NEP by region plus the House's changes:
- **Where the changes come from:** the line-by-line comparison (`explorer/downloads/house-bill-2027-lines-vs-nep.parquet`): every line raised, cut or added. Also `nep-2027-lines-not-in-house-bill.csv`, the NEP lines the House dropped, which carry DBM's region code.
- **Where each change goes:** to the region the bill prints for the line. The NCR and BARMM rules apply. A line printed with no region goes to its agency's own region in the NEP, when the agency has only one (most state universities); otherwise it counts as national.
- **Department:** each change goes to its department by agency name, because the comparison files special purpose funds under department 01.
- **Automatic appropriations** are not in the bill, so they stay as in the NEP. **Unprogrammed appropriations** are left out: they are unchanged, and not in the NEP lines.
- **Checks:**
  - the changes are ₱219,772,824,000 raised and the same amount cut;
  - the House bill total equals the NEP total;
  - DPWH's change equals the explorer's (₱642.61B → ₱654.10B).

  Printed regions alone are not used: the bill prints some region-coded budgets without a region (₱125.5B of state universities), so they would show differences the House never made.

Rules and caveats:

- **BARMM's own lines** count in BARMM, though DBM codes most of them nationwide: its Annual Block Grant (₱104.2B in 2027), its share in national taxes and its Special Development Fund. BARMM runs its own education, health and public works, so DepEd, DOH and DPWH show ₱0 there.
- **The NTA is not split by region.** That needs DBM's NTA-by-LGU list. PSA's table has only provincial governments.
- **A department's regional share** is shown in the selector and the key figures. Below 50%, the page warns that the regional figures leave most of the budget out: DPWH 19%, DILG 6%, the Judiciary 0%. For DPWH it links to the province-level placements instead.
- **Regional poverty** is each province's 2023 incidence × 2024 population, added up by today's regions. It is within 0.35 points of PSA's own regional estimate except in IX and BARMM, because Sulu moved. The build checks this, and keeps PSA's figure in `poverty_2023_psa`.
- `regions.csv` is long: one row per budget × department × region, with per person and per poor person.

## Data

| File (R2 `indicators/`, local `data/indicators/`) | What |
|---|---|
| `indicators.json` | `IndicatorsFile` (`src/lib/indicators.ts`): the 87 areas (id, name, region, PSGC outlines, notes), each indicator's value per area, its overall figure and coverage, the sources, and the CSV's checksum |
| `indicators.csv` | One row per area, one column per indicator id, plus `poverty_cv`. Linked as `?v=<sha256[:12]>` |
| `regions.json`, `regions.csv` | Budget by region: see above |

### Build

```bash
npm run fetch:psa                  # PSA tables → data/stats-psa/raw/ (statistics.bettergov.ph API, ~10 s)
npm run build:indicators           # measures → data/stats-psa/out/areas.json, then indicators → data/indicators/
npm run verify:indicators          # independent checks (532): PSA rows by code, the regions from DBM's lines, region values, the House bill, the CSV adding up
npm run build:indicators -- --upload   # R2 indicators/ (R2_* keys from the main checkout's .env); CSV first, then JSON
npm run verify:indicators -- --live    # R2 copy equals local, CORS *
```

Inputs besides the PSA tables:

- `data/hgab/2027/geo/provinces.json`, `districts.json` and `locations.json`: outlines, offices, and FY2027 placements;
- `data/dpwh-contracts/contracts.parquet` (`docs/dpwh-contracts.md`).

### How a PSA table becomes a figure per area

`scripts/stats-psa/geo.mjs` maps every source label to an area:

- region and national rows are skipped;
- highly urbanized cities fold into their province;
- NCR cities fold into the four districts PSA uses for poverty.

A whole is never counted together with its parts. When a table prints both, the NCR district row or the combined Maguindanao row is counted and its parts are skipped.

`scripts/stats-psa/build.mjs` has two kinds of readers:

- **`additive()` for quantities** (people, pesos, hectares, deaths). It sums per area and checks the total against PSA's national row, or the regions' sum. It fails below 97% or above 100.05%.
- **`direct()` for published rates** (poverty, poverty gap). Exactly one row per area.

Every check is in `areas.json` `meta.psa_checks`.

`scripts/build-indicators.ts` applies `value()` from the contract to each area and to the Philippines, then checks:

- coverage per indicator;
- shares within 0–100;
- the national population is 112,729,484;
- national poverty is 15.5%;
- the contract budget conserves.

The 1,708-person gap between the areas and the national population is PSA's count of Filipinos in embassies and consulates abroad.

### The Philippines line

Indicators marked `overall: 'national'` use PSA's national figures. These include the official land area of 300,000 km² for density; the provinces' own land areas add up to 322,139 km².

Indicators marked `'covered'` use the ratio of sums over the areas that have a figure, and say "All N areas":
- farm output (no national row);
- the provincial NTA (no Metro Manila);
- the three budget indicators.

## Indicators

| Theme | Indicators | Source |
|---|---|---|
| People | population 2024; growth a year 2020–2024; people per km²; % urban; % under 15; % 60 and over; dependency ratio | 2024 POPCEN |
| Poverty and income | poverty incidence 2023 (with CV); change 2018–2023; poverty gap 2023; average family income 2023 | FIES, PSA official estimates |
| Economy | GDP per person 2025; construction's share of GDP 2023 | Provincial product accounts; PSY Table 3.86 |
| Farms | farm and fisheries output per person 2025; % of palay area irrigated 2025; palay per hectare 2025 | Value of production; palay and corn tables |
| Births and deaths | registered births and deaths per 1,000; infant deaths per 1,000 births; maternal deaths per 100,000 births (2024) | Civil registration, by usual residence |
| Local government | provincial NTA per person 2024 | PSY Table 15.4 |
| National budget | DPWH contract budget per person 2018–2025; House bill DPWH projects per person; House change (House − NEP) per person, 2027 | DPWH contracts (GPS, then DEO); `locations.json` (₱466.7B of ₱587.1B placed in one district) |

## Source issues found (tell PSA / keep in mind)

- **2024 census age table (`0201A6DPAG0`).** For Bicol, Northern Mindanao and Davao, the provinces' rows for ages 80–84 and 85+ add up to 66–115% more than the region's row. Catanduanes, for example, has more people aged 80–84 than aged 75–79. PSA's own API returns the same figures (checked 2026-11-07). The 60+ share and the dependency ratio are left out for those 16 provinces (`areas.json` `meta.age_issues`), and each area says why. The under-15 share is unaffected.
- **NTA table (PSY 15.4).** Titled "in million PhP", but the figures are pesos (the national total is ₱236.2 billion). It covers provincial governments only: the provinces add up to 23% of the total NTA, the provincial share.
- **BIR collections (PSY 15.5)** are not used. They are reported by revenue district, which merges provinces ("Apayao and Kalinga") and books large taxpayers to the Large Taxpayers Service, not a place.
- **Registered vital events** undercount where registration is weak, notably BARMM. The pages say so.
- **Cotabato City** is in no area's poverty or income figures: PSA publishes it separately, and the province outlines put it inside Maguindanao del Norte.

## Not done yet

- Not on R2. The pages need the upload before they work in production.
- No API or MCP endpoints.
- No share or og images.
- No /docs "What's new" entry.
- Region-only PSA series (stunting, unemployment, electricity, safe water) are not included. They would need a region view.
- Barangay populations (2024) are not used; the MPB per-person page stops at cities and municipalities.
