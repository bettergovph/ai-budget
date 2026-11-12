// Join PSA province statistics with DPWH budget data, one row per poverty-statistics area.
// node scripts/stats-psa/build.mjs [data dir] [raw dir] [out dir]
// defaults: data, data/stats-psa/raw (from fetch-psa.mjs), data/stats-psa/out. See docs/budget-vs-statistics.md.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { DuckDBInstance } from '@duckdb/node-api';

const [DATA = 'data', RAW = 'data/stats-psa/raw', OUT = 'data/stats-psa/out'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const raw = (name) => readJson(`${RAW}/${name}.json`);

import { clean, key, unitOf, mapGeography } from './geo.mjs';

// ---------- areas: the province outlines, merged to the poverty-statistics geography ----------
const geo = readJson(`${DATA}/hgab/2027/geo/provinces.json`);
const NCR_FEATURE = { 1303900000: 'ncr1', 1307400000: 'ncr2', 1307500000: 'ncr3', 1307600000: 'ncr4' };
const NCR_NAME = { ncr1: 'Metro Manila 1st District (Manila)', ncr2: 'Metro Manila 2nd District', ncr3: 'Metro Manila 3rd District', ncr4: 'Metro Manila 4th District' };
const areas = new Map();
const featureUnit = new Map();
for (const f of geo.provinces) {
  const u = NCR_FEATURE[f.psgc] ?? unitOf(key(f.name));
  featureUnit.set(f.psgc, u);
  if (!areas.has(u)) areas.set(u, { unit: u, name: NCR_NAME[u] ?? (u === 'maguindanao' ? 'Maguindanao (del Norte and del Sur)' : f.name), region: f.region, psgc: [] });
  areas.get(u).psgc.push(f.psgc);
}
// Sulu was in BARMM until the 2024 Supreme Court ruling; DPWH did not build there for most of the period.
for (const a of areas.values()) a.barmm_period = a.region === 'BARMM' || a.unit === 'sulu';

// ---------- PSA tables: generic readers ----------
// Every reader maps the table's geography with mapGeography() (region and national rows skipped, HUCs folded
// into their province, NCR cities into the four districts) and records a check in psaChecks.
const areaKeys = new Set(areas.keys());
const psaChecks = [];
function readTable(name) {
  const t = raw(name);
  const dims = Object.keys(t.values);
  const labelOf = Object.fromEntries(dims.map((d) => [d, new Map(t.values[d].map((v) => [v.code, v.label]))]));
  return { t, dims, labelOf };
}
// where: { dim: label | (label) => bool } on the non-geography dimensions
function matches(T, r, where) {
  return Object.entries(where).every(([d, want]) => {
    const l = T.labelOf[d].get(r.codes[T.dims.indexOf(d)]);
    return typeof want === 'function' ? want(l) : l === want;
  });
}
const isNationalLabel = (l) => /^philippines/i.test(clean(l));
const isRegionLabel = (l) => !isNationalLabel(l) && !/^(total|others?|tax|foreign|island|luzon|visayas|mindanao)/i.test(clean(l));

/** Sum of a quantity per area. Checks the placed total against the national row (or the regions' sum). */
function additive(name, geoDim, where, { only, minShare = 0.97, label = name, against = 'national', check = true } = {}) {
  const T = readTable(name);
  const gi = T.dims.indexOf(geoDim);
  const present = new Set(T.t.rows.map((r) => r.codes[gi]));
  const { byCode, unmatched, skipped } = mapGeography(T.t.values[geoDim], areaKeys, { only: (v) => present.has(v.code) && (!only || only(v)) });
  const skippedCodes = new Set(T.t.values[geoDim].filter((v) => skipped.includes(clean(v.label))).map((v) => v.code));
  const out = new Map();
  let placed = 0, national = null, regions = 0;
  for (const r of T.t.rows) {
    if (r.value == null || !matches(T, r, where)) continue;
    const code = r.codes[gi], l = T.labelOf[geoDim].get(code);
    const u = byCode.get(code);
    if (u) { out.set(u, (out.get(u) ?? 0) + r.value); placed += r.value; continue; }
    if (skippedCodes.has(code) && isNationalLabel(l)) national = (national ?? 0) + r.value;
    else if (skippedCodes.has(code) && isRegionLabel(l) && /^\.{0,2}[^.]/.test(l)) regions += r.value;
  }
  const total = against === 'regions' ? regions || null : national ?? (regions || null);
  const share = total ? placed / total : null;
  out.total = total;
  out.nationalRow = national;
  psaChecks.push({ table: name, measure: label, kind: 'additive', areas: out.size, placed, total, total_from: against === 'regions' || national == null ? 'sum of regions' : 'national row', share, unmatched });
  if (check && share != null && (share < minShare || share > 1.0005)) throw new Error(`${name} ${label}: placed ${placed} of ${total} (${(100 * share).toFixed(2)}%)`);
  return out;
}

/** A published rate per area: exactly one row per area (a combined row wins over its parts, e.g. Maguindanao). */
function direct(name, geoDim, where, { label = name } = {}) {
  const T = readTable(name);
  const gi = T.dims.indexOf(geoDim);
  const present = new Set(T.t.rows.map((r) => r.codes[gi]));
  const { byCode, unmatched } = mapGeography(T.t.values[geoDim], areaKeys, { only: (v) => present.has(v.code) });
  const out = new Map(), exact = new Set();
  for (const r of T.t.rows) {
    if (!matches(T, r, where)) continue;
    const code = r.codes[gi], u = byCode.get(code);
    if (!u) { if (isNationalLabel(T.labelOf[geoDim].get(code))) out.national = r.value; continue; }
    const isExact = key(T.labelOf[geoDim].get(code)) === u || /^ncr\d$/.test(u);
    if (out.has(u)) {
      if (exact.has(u) && !isExact) continue;
      if (isExact && exact.has(u)) throw new Error(`${name} ${label}: two rows for ${u}`);
      if (!isExact) throw new Error(`${name} ${label}: ${u} has several rows and none is the area itself`);
    }
    out.set(u, r.value);
    if (isExact) exact.add(u);
  }
  psaChecks.push({ table: name, measure: label, kind: 'direct', areas: out.size, unmatched });
  return out;
}
// The Philippines as a whole, for the "Philippines" line beside each indicator: PSA's national row for a
// published rate, the national total (or the regions' sum) for a quantity.
const national = {};
const put = (field, m, f = (v) => v) => {
  for (const [u, v] of m) areas.get(u)[field] = v == null ? null : f(v);
  const n = m.national ?? m.total;
  if (n != null) national[field] = f(n);
};

// ---------- poverty (rates published per area) ----------
for (const y of ['2018', '2021', '2023']) {
  put(`poverty_incidence_${y}`, direct('poverty_pop', 'Geolocation', { Parameters: 'Poverty Incidence among Population (%)', Year: y }, { label: `incidence ${y}` }));
  put(`poverty_cv_${y}`, direct('poverty_pop', 'Geolocation', { Parameters: 'Coefficient of Variation', Year: y }, { label: `cv ${y}` }));
}
for (const [field, ind] of [['income_gap_2023', 'Income Gap (%)'], ['poverty_gap_2023', 'Poverty Gap (%)'], ['poverty_severity_2023', 'Severity of Poverty']]) {
  put(field, direct('poverty_gap', 'Region and Provinces', { Indicator: ind, Year: '2023' }, { label: field }));
}

// ---------- 2024 census: population, land, earlier censuses, urban, age ----------
put('population_2024', additive('census2024_pop', 'Geographic Location', { Parameter: 'Total Population' }, { label: 'population 2024' }));
const DEN = { '2015 Population': 'population_2015', '2020 Population': 'population_2020', '***Land Area (square kilometers)  a1/ a2/': 'land_km2' };
// The national land area is the official round 300,000 km²; provinces' own areas add up to the regions' 322,139.
for (const [param, field] of Object.entries(DEN)) {
  const m = additive('census2024_density', 'Geographic Location', { Parameter: param }, { label: field, against: field === 'land_km2' ? 'regions' : 'national' });
  put(field, m);
  if (field === 'land_km2') national.land_km2 = m.nationalRow; // the official figure, so national density matches PSA's
}
put('urban_population_2024', additive('census2024_urban', 'Geographic Location', { Parameter: 'Urban Population' }, { label: 'urban population 2024' }));
// PSA's 2024 age table is inconsistent in a few regions: the provinces' rows for some age groups add up to
// more than the region's row (verified against PSA's own API on 2026-11-07). Shares that use those age
// groups are left out for the provinces of those regions; ageIssues records which.
const age = readTable('census2024_age');
const ageGroups = age.t.values['Age Group'].map((v) => v.label);
const ageBy = Object.fromEntries(ageGroups.map((g) => [g, additive('census2024_age', 'Geographic Location', { 'Age Group': g, Sex: 'Both Sexes' }, { label: `age ${g}`, check: false })]));
const ageIssues = [];
{
  const geoVals = age.t.values['Geographic Location'];
  const { byCode } = mapGeography(geoVals, areaKeys);
  const val = new Map(age.t.rows.filter((r) => age.labelOf.Sex.get(r.codes[2]) === 'Both Sexes').map((r) => [r.codes[0] + '|' + r.codes[1], r.value]));
  for (const g of ageGroups) {
    const gc = age.t.values['Age Group'].find((v) => v.label === g).code;
    let region = null, units = [], sum = 0;
    const flush = () => {
      if (region && Math.abs(sum - val.get(gc + '|' + region.code)) > 0.5) ageIssues.push({ age_group: g, region: clean(region.label), region_total: val.get(gc + '|' + region.code), provinces_total: sum, areas: [...new Set(units)] });
    };
    for (const v of geoVals) {
      if (/^\.\.[^.]/.test(v.label)) { flush(); region = v; units = []; sum = 0; continue; }
      if (!region || !byCode.has(v.code)) continue;
      sum += val.get(gc + '|' + v.code) ?? 0; units.push(byCode.get(v.code));
    }
    flush();
  }
}
const badAgeGroups = (unit) => new Set(ageIssues.filter((i) => i.areas.includes(unit)).map((i) => i.age_group));
const OLD_GROUPS = ['60 - 64', '65 - 69', '70 - 74', '75 - 79', '80 - 84', '85 and over'];
for (const a of areas.values()) {
  const g = (k) => ageBy[k].get(a.unit) ?? 0;
  const all = g('All Ages');
  if (!all) continue;
  const bad = badAgeGroups(a.unit);
  const young = g('Under 5') + g('5 - 9') + g('10 - 14');
  const old65 = g('65 - 69') + g('70 - 74') + g('75 - 79') + g('80 - 84') + g('85 and over');
  a.pct_under15 = ['Under 5', '5 - 9', '10 - 14', 'All Ages'].some((k) => bad.has(k)) ? null : (100 * young) / all;
  const oldOk = !OLD_GROUPS.concat('All Ages').some((k) => bad.has(k));
  // Counts (household population), so regions can be added up exactly. Null where PSA's rows are inconsistent.
  a.hh_population_2024 = bad.has('All Ages') ? null : all;
  a.age_under15_2024 = a.pct_under15 == null ? null : young;
  a.age_60plus_2024 = oldOk ? old65 + g('60 - 64') : null;
  a.age_65plus_2024 = oldOk ? old65 : null;
  a.age_15_64_2024 = oldOk && a.pct_under15 != null ? all - young - old65 : null;
  a.pct_60plus = oldOk ? (100 * (old65 + g('60 - 64'))) / all : null;
  a.pct_65plus = oldOk ? (100 * old65) / all : null;
  a.dependency_ratio = oldOk && a.pct_under15 != null ? (100 * (young + old65)) / (all - young - old65) : null;
  if (bad.size) a.age_note = `PSA's 2024 table counts more people aged ${[...bad].join(' and ')} in this region's provinces than in the region itself`;
}
{
  const n = (k) => ageBy[k].total;
  const all = n('All Ages'), young = n('Under 5') + n('5 - 9') + n('10 - 14');
  const old65 = n('65 - 69') + n('70 - 74') + n('75 - 79') + n('80 - 84') + n('85 and over');
  Object.assign(national, { pct_under15: (100 * young) / all, pct_60plus: (100 * (old65 + n('60 - 64'))) / all, pct_65plus: (100 * old65) / all, dependency_ratio: (100 * (young + old65)) / (all - young - old65) });
  Object.assign(national, { hh_population_2024: all, age_under15_2024: young, age_60plus_2024: old65 + n('60 - 64'), age_65plus_2024: old65, age_15_64_2024: all - young - old65 });
}

// ---------- 2023 FIES: average family income (families in thousands, income in thousand pesos) ----------
{
  const fam = additive('fies2023', 'Region, Province, and HUC', { Indicators: 'Number of Families  (In thousands)' }, { label: 'families 2023' });
  const T = readTable('fies2023');
  const { byCode } = mapGeography(T.t.values['Region, Province, and HUC'], areaKeys);
  const famByCode = new Map(), incomeTotal = new Map();
  for (const r of T.t.rows) if (T.labelOf.Indicators.get(r.codes[1]).startsWith('Number of Families')) famByCode.set(r.codes[0], r.value);
  for (const r of T.t.rows) {
    if (!T.labelOf.Indicators.get(r.codes[1]).startsWith('Average Income')) continue;
    const u = byCode.get(r.codes[0]);
    if (u) incomeTotal.set(u, (incomeTotal.get(u) ?? 0) + famByCode.get(r.codes[0]) * r.value);
  }
  for (const [u, f] of fam) { areas.get(u).families_2023 = f * 1000; areas.get(u).avg_family_income_2023 = (1000 * incomeTotal.get(u)) / f; }
  national.families_2023 = fam.total * 1000;
  national.avg_family_income_2023 = 1000 * T.t.rows.find((r) => isNationalLabel(T.labelOf['Region, Province, and HUC'].get(r.codes[0])) && T.labelOf.Indicators.get(r.codes[1]).startsWith('Average Income')).value;
}

// ---------- GDP (thousand pesos) and GDP per person; construction's share ----------
{
  const T = readTable('gdp_level'), P = readTable('gdp_pc');
  const pcBy = new Map(P.t.rows.map((r) => [r.codes[0] + '|' + r.codes[2], r.value]));
  for (const year of ['2023', '2025']) {
    const gdp = additive('gdp_level', 'Geolocation', { Year: year }, { label: `GDP ${year}` });
    // people = GDP ÷ GDP per person, so a province and its HUCs combine correctly
    const people = new Map();
    const { byCode } = mapGeography(T.t.values.Geolocation, areaKeys);
    for (const r of T.t.rows) {
      if (T.labelOf.Year.get(r.codes[2]) !== year) continue;
      const u = byCode.get(r.codes[0]);
      if (u) people.set(u, (people.get(u) ?? 0) + r.value / pcBy.get(r.codes[0] + '|' + r.codes[2]));
    }
    for (const [u, g] of gdp) { areas.get(u)[`gdp_${year}`] = g * 1000; areas.get(u)[`gdp_per_person_${year}`] = g / people.get(u); }
    national[`gdp_${year}`] = gdp.total * 1000;
    national[`gdp_per_person_${year}`] = gdp.total / [...people.values()].reduce((s, x) => s + x, 0);
  }
  put('construction_gva_2023', additive('gva_construction', 'Provinces', { Year: '2023' }, { label: 'construction GVA 2023' }), (v) => v * 1000);
}

// ---------- farms: value of production (million pesos), palay (hectares, tonnes) ----------
put('agri_value_2025', additive('agri_value', 'Province', { 'Type of Valuation': 'Current Prices', Subsector: 'Agriculture and Fisheries', Year: '2025' }, { label: 'agri value 2025' }), (v) => v * 1e6);
for (const [field, eco] of [['palay_area_irrigated_2025', 'Irrigated Palay'], ['palay_area_rainfed_2025', 'Rainfed Palay'], ['palay_area_2025', 'Palay']]) {
  put(field, additive('palay_area', 'Geolocation', { 'Ecosystem/Croptype': eco, Year: '2025', Period: 'Annual' }, { label: field }));
}
put('palay_production_2025', additive('palay_production', 'Geolocation', { 'Ecosystem/Croptype': 'Palay', Year: '2025', Period: 'Annual' }, { label: 'palay production 2025' }));

// ---------- 2024 registered births and deaths, by usual residence ----------
put('births_2024', additive('births2024', 'Geolocation', { 'Birth Weights': 'Total' }, { label: 'births 2024' }));
for (const [field, type] of [['deaths_2024', 'Total Deaths'], ['maternal_deaths_2024', 'Maternal Deaths'], ['infant_deaths_2024', 'Infant Deaths']]) {
  put(field, additive('deaths2024', 'Geolocation', { 'Type of Death': type, Place: 'Place of Usual Residence' }, { label: field, minShare: 0.95 }));
}

// ---------- National Tax Allotment to provincial governments, 2024 (pesos, though the title says millions) ----------
put('nta_province_2024', additive('nta', 'Province', { Year: '2024' }, { label: 'NTA 2024', minShare: 0.8 }));

// ---------- DEO → area, from the legislative-district crosswalk ----------
const districts = readJson(`${DATA}/hgab/2027/districts.json`);
const distById = new Map(districts.districts.map((d) => [d.id, d]));
const officeArea = new Map(); // office name key → Map(unit → weight)
const cityPop = new Map(); // city key → 2024 population, to split offices that serve several areas
{
  const pop = raw('census2024_pop');
  for (const v of pop.values['Geographic Location']) {
    const row = pop.rows.find((r) => r.codes[0] === v.code && r.codes[1] === '0');
    if (row) cityPop.set(key(v.label), row.value);
  }
}
const officeKey = (s) => s.toLowerCase().replace(/ñ/g, 'n').replace(/district engineering office/g, 'deo').replace(/\s+/g, ' ').trim();
for (const o of Object.values(districts.offices)) {
  const w = new Map();
  for (const id of o.district_ids) {
    const d = distById.get(id);
    const k = key(d.jurisdiction);
    const u = unitOf(k);
    if (!areas.has(u)) { console.warn('office', o.name, 'jurisdiction not mapped', d.jurisdiction); continue; }
    w.set(u, (w.get(u) ?? 0) + (cityPop.get(k) ?? 1));
  }
  // Isabela City shares Basilan's lone legislative district but is not in BARMM; its DEO builds in the city.
  if (o.name === 'Isabela City DEO') { w.clear(); w.set('city:isabela', 1); }
  const total = [...w.values()].reduce((s, x) => s + x, 0);
  if (total) officeArea.set(officeKey(o.name), new Map([...w].map(([u, x]) => [u, x / total])));
}

// ---------- DPWH contracts, 2018–2025, placed by GPS then by office ----------
const featureBoxes = geo.provinces.map((f) => {
  let b = [180, 90, -180, -90];
  for (const poly of f.polygons) for (const [x, y] of poly[0]) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
  return { f, b };
});
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function featureAt(x, y) {
  for (const { f, b } of featureBoxes) {
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
    for (const poly of f.polygons) if (inRing(x, y, poly[0]) && !poly.slice(1).some((h) => inRing(x, y, h))) return f;
  }
  return null;
}
const REGION_KEY = { 'National Capital Region': 'NCR', 'Cordillera Administrative Region': 'CAR', 'MIMAROPA Region': 'MIMAROPA', 'Region IV-B': 'MIMAROPA', 'Negros Island Region': 'NIR' };
const regionKey = (r) => REGION_KEY[r] ?? (r ? r.replace(/^Region /, '') : null);
const compatible = (polyRegion, contractRegion) =>
  !contractRegion || contractRegion === 'Central Office' || polyRegion === contractRegion ||
  (polyRegion === 'NIR' && ['VI', 'VII'].includes(contractRegion)) || (contractRegion === 'NIR' && ['VI', 'VII'].includes(polyRegion));

const db = await (await DuckDBInstance.create(':memory:')).connect();
const res = await db.runAndReadAll(`select infraYear::int y, budget, location.province office, location.region region, latitude lat, longitude lon, status
  from '${DATA}/dpwh-contracts/contracts.parquet' where infraYear between '2018' and '2025'`);
const tally = { gps: 0, office: 0, office_split: 0, unplaced: 0, gps_region_mismatch: 0 };
const tallyPhp = { gps: 0, office: 0, office_split: 0, unplaced: 0 };
const YEARS_C = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
for (const a of areas.values()) for (const y of YEARS_C) a[`dpwh_contracts_${y}`] = 0;
let totalPhp = 0, contractRows = 0;
for (const r of res.getRowObjectsJS()) {
  const php = r.budget ?? 0;
  totalPhp += php;
  contractRows++;
  const cr = regionKey(r.region);
  let placed = null, how = null;
  const okGps = r.lat != null && r.lat > 4 && r.lat < 22 && r.lon > 114 && r.lon < 127;
  if (okGps) {
    const f = featureAt(r.lon, r.lat);
    if (f && compatible(f.region, cr)) { placed = new Map([[featureUnit.get(f.psgc), 1]]); how = 'gps'; }
    else if (f) tally.gps_region_mismatch++;
  }
  if (!placed) {
    const w = officeArea.get(officeKey(r.office ?? ''));
    if (w) { placed = w; how = w.size > 1 ? 'office_split' : 'office'; }
  }
  if (!placed) { tally.unplaced++; tallyPhp.unplaced += php; continue; }
  tally[how]++; tallyPhp[how] += php;
  for (const [u, share] of placed) areas.get(u)[`dpwh_contracts_${r.y}`] += php * share;
}

// ---------- DPWH appropriations by DEO: GAA 2020–2026, FY2027 NEP and House bill ----------
for (const a of areas.values()) Object.assign(a, { dpwh_gaa_2020_2026: 0, dpwh_nep_2027: 0, dpwh_house_2027: 0 });
let gaaAll = 0, gaaPlaced = 0;
for (const o of Object.values(districts.offices)) {
  const w = officeArea.get(officeKey(o.name));
  const gaa = o.years.filter((y) => y.stage === 'gaa' && y.fy >= 2020 && y.fy <= 2026).reduce((s, y) => s + y.php, 0);
  gaaAll += gaa;
  if (!w) continue;
  gaaPlaced += gaa;
  for (const [u, share] of w) {
    const a = areas.get(u);
    a.dpwh_gaa_2020_2026 += gaa * share;
    // project-only basis on both sides (see districts.json scope_notes)
    a.dpwh_nep_2027 += (o.fy2027?.nep_php ?? 0) * share;
    a.dpwh_house_2027 += (o.fy2027?.hgab3_php ?? 0) * share;
  }
}

// ---------- FY2027 DPWH projects placed in one legislative district (the House bill pages' location lens) ----------
// locations.json `districts[].all` holds the NEP and House bill amounts of the lines the lens places in that
// district (by the title's place, or a lone DEO). Lines it leaves on a shared office or a region are not here.
const locations = readJson(`${DATA}/hgab/2027/locations.json`);
const placed2027 = { nep_php: 0, house_php: 0, unmapped_districts: [] };
for (const a of areas.values()) Object.assign(a, { dpwh_nep_2027_placed: 0, dpwh_house_2027_placed: 0 });
for (const d of locations.districts) {
  const j = distById.get(d.district)?.jurisdiction;
  const u = j ? unitOf(key(j)) : null;
  if (!u || !areas.has(u)) { placed2027.unmapped_districts.push(d.district); continue; }
  areas.get(u).dpwh_nep_2027_placed += d.all.nep_php;
  areas.get(u).dpwh_house_2027_placed += d.all.house_php;
  placed2027.nep_php += d.all.nep_php; placed2027.house_php += d.all.house_php;
}
if (placed2027.unmapped_districts.length) throw new Error('locations.json districts with no area: ' + placed2027.unmapped_districts.join(', '));
placed2027.lens_totals = locations.totals;

// ---------- per person ----------
const rows = [...areas.values()].filter((a) => a.population_2024);
for (const a of rows) {
  const p = a.population_2024;
  a.dpwh_contracts_2018_2025 = YEARS_C.reduce((s, y) => s + a[`dpwh_contracts_${y}`], 0);
  a.dpwh_contracts_pp = a.dpwh_contracts_2018_2025 / p;
  a.dpwh_gaa_2020_2026_pp = a.dpwh_gaa_2020_2026 / p;
  a.dpwh_nep_2027_pp = a.dpwh_nep_2027 / p;
  a.dpwh_house_2027_pp = a.dpwh_house_2027 / p;
  a.dpwh_house_minus_nep_2027_pp = (a.dpwh_house_2027 - a.dpwh_nep_2027) / p;
  a.km2_per_1000_people = a.land_km2 / (p / 1000);
  a.poor_people_2023 = a.poverty_incidence_2023 != null ? (a.poverty_incidence_2023 / 100) * p : null;
  a.poverty_change_2018_2023 = a.poverty_incidence_2023 != null && a.poverty_incidence_2018 != null ? a.poverty_incidence_2023 - a.poverty_incidence_2018 : null;
}

const meta = {
  built_at: new Date().toISOString(),
  areas: rows.length,
  psa_tables: [...new Set(psaChecks.map((c) => c.table).concat('gdp_pc'))].map((n) => { const t = raw(n); return { name: n, id: t.id, title: t.title, source: t.source, release: t.release, sourceUpdated: t.sourceUpdated, retrieved: t.retrieved }; }),
  psa_checks: psaChecks,
  age_issues: ageIssues,
  national: { ...national, dpwh_contracts_2018_2025: totalPhp, dpwh_nep_2027_placed: placed2027.nep_php, dpwh_house_2027_placed: placed2027.house_php, dpwh_nep_2027: [...areas.values()].reduce((s, a) => s + a.dpwh_nep_2027, 0), dpwh_house_2027: [...areas.values()].reduce((s, a) => s + a.dpwh_house_2027, 0) },
  contracts: { years: '2018–2025 (infraYear)', rows: contractRows, total_php: totalPhp, placed_rows: tally, placed_php: tallyPhp },
  gaa_by_office: { total_php: gaaAll, placed_php: gaaPlaced },
  placed_2027: placed2027,
  missing: rows.filter((a) => a.poverty_incidence_2023 == null || a.gdp_per_person_2023 == null || a.pct_60plus == null).map((a) => a.unit),
};
writeFileSync(`${OUT}/areas.json`, JSON.stringify({ meta, rows }, null, 1));
const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => k !== 'psgc');
const csv = [cols.join(',')].concat(rows.map((a) => cols.map((c) => { const v = a[c]; return v == null ? '' : typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : typeof v === 'number' ? +v.toFixed(4) : v; }).join(',')));
writeFileSync(`${OUT}/areas.csv`, csv.join('\n') + '\n');
console.log(JSON.stringify(meta, null, 1));
