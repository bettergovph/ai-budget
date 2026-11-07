# Budget vs PSA statistics (exploratory)

Status: **exploratory, started 2026-11-07.** Nothing here is on the site, and the figures have not been reviewed. Don't publish them, or quote them as findings, until the maintainer has reviewed the method.

The question: does the budget go where the needs are? This work compares budget per person in each province with PSA statistics: poverty, age structure, GDP per person, population and land area.

## Statistics source

The [Philippine Statistics Explorer](https://statistics.bettergov.ph) is BetterGov's mirror of PSA OpenSTAT. The code is in `~/projects/psa` on the dev VM. It offers a REST API at `/api/v1` and MCP at `/mcp`, with no key needed. Its own guide is [api.md](https://statistics.bettergov.ph/api.md).

| Name in the scripts | Dataset id | Table |
|---|---|---|
| `poverty_pop` | `b4a71a27b4e4189c79a8` | Poverty incidence among population, by region and province: 2018, 2021, 2023 (with CV) |
| `census2024_pop` | `a37b2e8af4d42c3d0fbc` | 2024 POPCEN total population by province and HUC |
| `census2024_density` | `05c931eaecec498f9756` | 2024 POPCEN land area (province, HUC and region rows only) |
| `census2024_age` | `04026757fab016161553` | 2024 POPCEN household population by age group |
| `gdp_level` / `gdp_pc` | `85c06b8cbf6e6cdee6f6` / `ac785073d7e6bc1755ae` | GDP and GDP per person by province and HUC, 2018–2025 (2023 current prices used) |

API quirks:

- Python's default `urllib` user agent gets HTTP 403. curl and Node `fetch` work.
- `/values` returns at most 200 codes per page; follow `pagination.nextOffset`.
- A query may select at most 5,000 points.
- Codes are strings; keep their leading zeros.

## Unit of comparison

The unit is the geography PSA publishes poverty for, giving **87 areas**:

- **Provinces, with their highly urbanized cities folded in.** For example, Cebu includes Cebu City, Lapu-Lapu and Mandaue. The census and GDP tables list each HUC right after its province; `CITY_TO_PROVINCE` in `build.mjs` holds the map.
- **The four Metro Manila districts.**
- **Isabela City.**
- **Maguindanao del Norte and del Sur, as one area.** Earlier poverty years don't split them.

Two places are left out:

- **Cotabato City.** PSA publishes its poverty separately, but the province outlines put it inside Maguindanao del Norte.
- **The Special Geographic Area.** It has no poverty figure.

Province outlines come from `data/hgab/2027/geo/provinces.json`, the same file the House bill maps use.

## Budget measures

1. **DPWH contracts, 2018–2025**, from `data/dpwh-contracts/contracts.parquet` (see `docs/dpwh-contracts.md`). Each contract is placed in this order:
   - by its GPS point, inside a province outline, if the point falls in the region DPWH printed for it;
   - otherwise by its DEO's province, via `data/hgab/2027/districts.json`.

   Of the ₱5.63T, 92.8% was placed by GPS, 3.3% by office, and 4.0% could not be placed (mostly regional and Central Office contracts without GPS). An office that serves areas in several units is split by 2024 population. Only two Metro Manila offices do this.
2. **DPWH enacted budget by DEO, FY2020–2026**, plus the **FY2027 NEP and House bill**, both on the project-only basis. These come from `districts.json` offices. This measure covers only about 40% of DPWH's GAA, because the Central Office holds most of it. Offices renamed during 2020–2022 (Southern Leyte, Cavite, South Cotabato…) are unmatched in those years. Treat the contracts as the cleaner measure.

BARMM provinces and Sulu are **excluded from every DPWH comparison**. DPWH barely builds there (BARMM has its own public works ministry, and Sulu was in BARMM until 2024). Keeping them in would make poorer areas look under-served for a reason that has nothing to do with targeting.

## Run

```bash
node scripts/stats-psa/fetch-psa.mjs     # → data/stats-psa/raw/*.json (about 10 s)
node scripts/stats-psa/build.mjs         # → data/stats-psa/out/areas.json, areas.csv (one row per area)
node scripts/stats-psa/analyze.mjs       # → data/stats-psa/out/correlations.json; prints the tables
```

`build.mjs` warns about municipality rows in the land-area table and about Cotabato City; both are expected.

Checks to keep passing:

- The total population is 112.7M, matching the 2024 census.
- Every placed contract peso is counted once: the GPS, office and unplaced shares sum to the total.

`analyze.mjs` reports Spearman rank correlations with permutation p-values. It reports them both raw and with population and land per person controlled for. It also prints poverty-quintile tables: share of people, share of poor people, share of budget, per person and per poor person. "Poor people" means the 2023 poverty rate × 2024 population, so it is approximate.

## First results (unreviewed)

These cover 81 areas.

- **Size drives budget per person, not poverty.** Small, sparse provinces get far more per person. The rank correlation between contracts per person and population is −0.69. Contracts correlate weakly with 2018 poverty (ρ 0.26), and the link disappears once population and land are controlled for (ρ −0.02).
- **Per poor person, poorer areas get much less.** The poorest fifth of areas (29–48% poverty) holds 26.9% of the poor and 11.8% of the people. It received 14.4% of the 2018–2025 contract budget: ₱61.6k per person against ₱37.4k in the least-poor fifth, but ₱183k per poor person against ₱1.2M.
- **The FY2027 House additions don't follow poverty** (ρ −0.11, not significant). The poorest fifth received 14.7% of them.
- **The share aged 60+ tracks budget per person** (ρ ≈ 0.35). This is probably confounded: small island and northern provinces are both older and better funded per person. Areas with more children are also poorer (ρ 0.78 with the share under 15), so age and poverty can't be read separately.

Caveats:

- These are correlations, not causes.
- Small provinces' poverty estimates are imprecise; check `poverty_cv_*` (a CV above 20% is weak).
- The GAA-by-DEO gaps are listed above.

## Next steps (proposed, not agreed)

- Move into `scripts/` with a verifier, as the other builders have.
- Add more budget lines that can be placed by province: farm-to-market roads, health facilities and multi-purpose buildings (`mpb-years`). Most other departments' GAA lines only break down by region, which gives 18 data points.
- Decide whether the work becomes a page, and how to word it. Use the house copy rules in `docs/hgab-copy.md`.
