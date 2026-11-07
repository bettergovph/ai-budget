// Join PSA province statistics with DPWH budget data, one row per poverty-statistics area.
// node scripts/stats-psa/build.mjs [data dir] [raw dir] [out dir]
// defaults: data, data/stats-psa/raw (from fetch-psa.mjs), data/stats-psa/out. See docs/budget-vs-statistics.md.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { DuckDBInstance } from '@duckdb/node-api';

const [DATA = 'data', RAW = 'data/stats-psa/raw', OUT = 'data/stats-psa/out'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const raw = (name) => readJson(`${RAW}/${name}.json`);

// ---------- names ----------
function clean(label) {
  let s = label.replace(/^\.+/, '').replace(/\(not a province\)/i, '').trim();
  for (let i = 0; i < 8; i++) s = s.replace(/[\s,]+(r\d+|[0-9a-z]{1,2}\/\**|\d*\*+)$/i, '').trim();
  return s;
}
function key(label) {
  let s = clean(label).toLowerCase().replace(/ñ/g, 'n').replace(/\s+/g, ' ').trim();
  const alias = { 'mt. province': 'mountain province', 'north cotabato': 'cotabato', 'city of sta. rosa': 'city:santa rosa' };
  if (alias[s]) return alias[s];
  if (s.startsWith('city of ')) return 'city:' + s.slice(8);
  if (s.endsWith(' city')) return 'city:' + s.slice(0, -5);
  return s;
}

// Highly urbanized cities and the province they sit in (PSA poverty estimates include them in that province).
const CITY_TO_PROVINCE = {
  'city:baguio': 'benguet', 'city:angeles': 'pampanga', 'city:olongapo': 'zambales', 'city:lucena': 'quezon',
  'city:puerto princesa': 'palawan', 'city:iloilo': 'iloilo', 'city:bacolod': 'negros occidental',
  'city:cebu': 'cebu', 'city:lapu-lapu': 'cebu', 'city:mandaue': 'cebu', 'city:tacloban': 'leyte',
  'city:zamboanga': 'zamboanga del sur', 'city:iligan': 'lanao del norte', 'city:cagayan de oro': 'misamis oriental',
  'city:davao': 'davao del sur', 'city:general santos': 'south cotabato', 'city:butuan': 'agusan del norte',
  // component cities that are their own legislative districts
  'city:antipolo': 'rizal', 'city:binan': 'laguna', 'city:calamba': 'laguna', 'city:santa rosa': 'laguna',
  'city:san jose del monte': 'bulacan',
  // Metro Manila, by the four districts PSA publishes poverty for
  'city:manila': 'ncr1',
  'city:mandaluyong': 'ncr2', 'city:marikina': 'ncr2', 'city:pasig': 'ncr2', 'city:quezon': 'ncr2', 'city:san juan': 'ncr2',
  'city:caloocan': 'ncr3', 'city:malabon': 'ncr3', 'city:navotas': 'ncr3', 'city:valenzuela': 'ncr3',
  'city:las pinas': 'ncr4', 'city:makati': 'ncr4', 'city:muntinlupa': 'ncr4', 'city:paranaque': 'ncr4',
  'city:pasay': 'ncr4', 'city:taguig': 'ncr4', 'pateros': 'ncr4',
  'maguindanao del norte': 'maguindanao', 'maguindanao del sur': 'maguindanao',
};
const unitOf = (k) => CITY_TO_PROVINCE[k] ?? k;

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

// ---------- PSA: poverty ----------
const pov = raw('poverty_pop');
const povCode = new Map(); // poverty geo code -> unit
for (const v of pov.values.Geolocation) {
  const depth = (v.label.match(/^\.*/)[0].length);
  if (depth !== 4) continue; // provinces and NCR districts only (regions are depth 2, Maguindanao split depth 6)
  const name = clean(v.label);
  const m = name.match(/^(\d)(st|nd|rd|th) District$/);
  const u = m ? 'ncr' + m[1] : unitOf(key(name));
  povCode.set(v.code, u);
}
const YEARS = Object.fromEntries(pov.values.Year.map((y) => [y.code, y.label]));
const PARAM = { 1: 'incidence', 2: 'cv' };
for (const r of pov.rows) {
  const [g, p, y] = r.codes;
  const u = povCode.get(g);
  if (!u || !PARAM[p]) continue;
  const a = areas.get(u);
  if (!a) { if (r.value != null && p === '1' && y === '2') console.warn('poverty area not on map:', u); continue; }
  a[`poverty_${PARAM[p]}_${YEARS[y]}`] = r.value;
}

// ---------- PSA: census 2024 population, land area and age ----------
function foldByUnit(table, geoDim, valueOf) {
  // HUC and province rows → unit; region rows (code ending 00000000) skipped.
  const out = new Map();
  for (const v of table.values[geoDim]) {
    if (/^\d{2}00000000$/.test(v.code) || v.code === '0000000000') continue;
    const k = key(v.label);
    const u = unitOf(k);
    if (!areas.has(u)) { if (k !== 'special geographic area') console.warn(table.id, 'no area for', v.label); continue; }
    out.set(v.code, u);
  }
  return out;
}
const pop = raw('census2024_pop');
const popGeo = foldByUnit(pop, 'Geographic Location');
for (const r of pop.rows) {
  const u = popGeo.get(r.codes[0]);
  if (!u || r.codes[1] !== '0') continue;
  const a = areas.get(u);
  a.population_2024 = (a.population_2024 ?? 0) + r.value;
}
const den = raw('census2024_density');
const denGeo = foldByUnit(den, 'Geographic Location');
for (const r of den.rows) {
  const u = denGeo.get(r.codes[0]);
  if (!u || r.codes[1] !== '3') continue;
  const a = areas.get(u);
  a.land_km2 = (a.land_km2 ?? 0) + r.value;
}
const age = raw('census2024_age');
const ageGeo = foldByUnit(age, 'Geographic Location');
const AGE = Object.fromEntries(age.values['Age Group'].map((x) => [x.code, x.label]));
for (const r of age.rows) {
  const [ag, g] = r.codes;
  const u = ageGeo.get(g);
  if (!u) continue;
  const a = (areas.get(u).age ??= {});
  a[AGE[ag]] = (a[AGE[ag]] ?? 0) + r.value;
}
for (const a of areas.values()) {
  if (!a.age) continue;
  const g = a.age, all = g['All Ages'];
  const sum = (...ks) => ks.reduce((s, k) => s + g[k], 0);
  const young = sum('Under 5', '5 - 9', '10 - 14');
  const old65 = sum('65 - 69', '70 - 74', '75 - 79', '80 - 84', '85 and over');
  const old60 = old65 + g['60 - 64'];
  a.pct_under15 = (100 * young) / all;
  a.pct_60plus = (100 * old60) / all;
  a.pct_65plus = (100 * old65) / all;
  a.dependency_ratio = (100 * (young + old65)) / (all - young - old65);
  delete a.age;
}

// ---------- PSA: GDP per person, 2023 current prices ----------
const gdp = raw('gdp_level'), gdppc = raw('gdp_pc');
const gdpGeo = new Map();
for (const v of gdp.values.Geolocation) {
  if (!v.label.startsWith('..')) continue;
  const u = unitOf(key(v.label));
  if (areas.has(u)) gdpGeo.set(v.code, u); else console.warn('gdp: no area for', v.label);
}
const GY = Object.fromEntries(gdp.values.Year.map((y) => [y.code, y.label]));
const pcBy = new Map(gdppc.rows.map((r) => [r.codes[0] + '|' + r.codes[2], r.value]));
const gdpAcc = new Map();
for (const r of gdp.rows) {
  const u = gdpGeo.get(r.codes[0]);
  if (!u || GY[r.codes[2]] !== '2023') continue;
  const pc = pcBy.get(r.codes[0] + '|' + r.codes[2]);
  const acc = gdpAcc.get(u) ?? { gdp: 0, people: 0 };
  acc.gdp += r.value; acc.people += r.value / pc; // people = GDP ÷ GDP per person, so GDP's unit cancels out
  gdpAcc.set(u, acc);
}
for (const [u, acc] of gdpAcc) areas.get(u).gdp_per_person_2023 = acc.gdp / acc.people;

// ---------- DEO → area, from the legislative-district crosswalk ----------
const districts = readJson(`${DATA}/hgab/2027/districts.json`);
const distById = new Map(districts.districts.map((d) => [d.id, d]));
const officeArea = new Map(); // office name key → Map(unit → weight)
const cityPop = new Map(); // city key → 2024 population, to split offices that serve several areas
for (const v of pop.values['Geographic Location']) {
  const row = pop.rows.find((r) => r.codes[0] === v.code && r.codes[1] === '0');
  if (row) cityPop.set(key(v.label), row.value);
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
  psa_tables: ['poverty_pop', 'census2024_pop', 'census2024_density', 'census2024_age', 'gdp_level', 'gdp_pc'].map((n) => { const t = raw(n); return { name: n, id: t.id, title: t.title, source: t.source, release: t.release, sourceUpdated: t.sourceUpdated }; }),
  contracts: { years: '2018–2025 (infraYear)', rows: contractRows, total_php: totalPhp, placed_rows: tally, placed_php: tallyPhp },
  gaa_by_office: { total_php: gaaAll, placed_php: gaaPlaced },
  missing: rows.filter((a) => a.poverty_incidence_2023 == null || a.gdp_per_person_2023 == null || a.pct_60plus == null).map((a) => a.unit),
};
writeFileSync(`${OUT}/areas.json`, JSON.stringify({ meta, rows }, null, 1));
const cols = Object.keys(rows[0]).filter((k) => k !== 'psgc');
const csv = [cols.join(',')].concat(rows.map((a) => cols.map((c) => { const v = a[c]; return v == null ? '' : typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : typeof v === 'number' ? +v.toFixed(4) : v; }).join(',')));
writeFileSync(`${OUT}/areas.csv`, csv.join('\n') + '\n');
console.log(JSON.stringify(meta, null, 1));
