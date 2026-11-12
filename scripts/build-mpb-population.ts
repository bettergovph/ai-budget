/**
 * Multi-purpose buildings per person: data/hgab/2027/mpb-years/population.json and population.csv.
 *
 *   npm run fetch:psa              # includes census2024_towns (+ _2015, _2020: every city and municipality)
 *   npm run build:indicators       # areas and regions (data/indicators/)
 *   npm run build:mpb-population   # this script
 *
 * Every MPB line in mpb-years/lines.json is tallied by region, by area (province with its HUCs, or a Metro Manila
 * district) and by city or municipality, for each budget, the FY2020–2026 GAA combined and all years. Every place
 * carries its 2015, 2020 and 2024 census counts, so the page can measure each budget against its own year's
 * population (popInYear). Contract: src/lib/mpb-population.ts. Checks: every budget's region tally + unplaced = its
 * total; towns add up to the country and to PSA's region rows in each census; every town sits in exactly one area.
 * See docs/indicators.md.
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
// @ts-expect-error: plain JS module shared with the stats pipeline
import { clean, key, mapGeography, unitOf } from './stats-psa/geo.mjs';
import { ALL_HOUSE_KEY, ALL_NEP_KEY, COMBINED_KEY, MPB_POPULATION_CSV_PATH, peopleIn, type Census, type MpbPopBudget, type MpbPopTown, type MpbPopulationFile, type PopLevel, type Tally } from '../src/lib/mpb-population';
import { REGION_NAMES, REGION_ORDER, type RegionBudgetFile } from '../src/lib/budget-regions';
import { STATISTICS_SITE, type IndicatorsFile } from '../src/lib/indicators';

const DATA = process.argv.find((a) => a.startsWith('--data='))?.slice(7) ?? 'data';
const read = <T>(p: string): T => JSON.parse(readFileSync(`${DATA}/${p}`, 'utf8')) as T;
const failures: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) failures.push(msg); };

interface Lines {
  budgets: { key: string; fy: number; stage: 'gaa' | 'nep' | 'house' }[];
  regions: string[]; districts: [string, string, number][];
  places: [string, number, string, number, number, number, number[]][];
  cols: string[]; rows: unknown[][];
}
const L = read<Lines>('hgab/2027/mpb-years/lines.json');
const summary = read<{ budgets: { key: string; lines: number; php: number }[] }>('hgab/2027/mpb-years/summary.json');
type Raw = { id: string; title: string; source: string; sourceUpdated: string; retrieved: string; values: Record<string, { code: string; label: string }[]>; rows: { codes: string[]; labels: string[]; value: number }[] };
const T = read<Raw>('stats-psa/raw/census2024_towns.json');
const T15 = read<Raw>('stats-psa/raw/census2024_towns_2015.json'), T20 = read<Raw>('stats-psa/raw/census2024_towns_2020.json');
const D = read<Raw>('stats-psa/raw/census2024_density.json'); // region rows, for the checks
const ind = read<IndicatorsFile>('indicators/indicators.json');
const rb = read<RegionBudgetFile>('indicators/regions.json');
const districts = read<{ districts: { id: string; jurisdiction: string }[] }>('hgab/2027/districts.json');
const areasOut = read<{ rows: { unit: string }[] }>('stats-psa/out/areas.json');

// Indicators area id ↔ geo.mjs unit (the same order in areas.json and indicators.json).
const areaIdOfUnit = new Map(areasOut.rows.map((r, i) => [r.unit, ind.areas[i].id]));
const areaById = new Map(ind.areas.map((a) => [a.id, { ...a, region: a.region.replace(/^Region /, '') }]));
const popOfArea = new Map(ind.areas.map((a) => [a.id, ind.indicators.find((i) => i.id === 'population')!.values[a.id] ?? 0]));
const areaKeys = new Set(areasOut.rows.map((r) => r.unit));

// ---- towns: the census list, each under its province or HUC row (depth 4) ----
const geo = T.values['Geographic Location'];
const pop = new Map(T.rows.map((r) => [r.codes[0], r.value]));
const pop15 = new Map(T15.rows.map((r) => [r.codes[0], r.value])), pop20 = new Map(T20.rows.map((r) => [r.codes[0], r.value]));
const { byCode: depth4Unit } = mapGeography(geo.filter((v) => /^\.{4}[^.]/.test(v.label)), areaKeys) as { byCode: Map<string, string> };
const towns: MpbPopTown[] = [];
const provinceArea = new Map<string, string>(); // census province/HUC code → area id
let parent: { code: string; label: string } | null = null;
const pushTown = (v: { code: string; label: string }, areaUnit: string) => {
  const name = clean(v.label);
  towns.push({
    code: v.code, name, kind: /\bcity\b/i.test(name) ? 'city' : 'municipality', area: areaIdOfUnit.get(areaUnit)!,
    region: areaById.get(areaIdOfUnit.get(areaUnit)!)!.region, population: pop.get(v.code) ?? 0,
    census: [pop15.get(v.code) ?? 0, pop20.get(v.code) ?? 0, pop.get(v.code) ?? 0], lng: null, lat: null,
  });
};
const depth = (l: string) => l.match(/^\.*/)![0].length;
for (let i = 0; i < geo.length; i++) {
  const v = geo[i], d = depth(v.label);
  if (d === 4) {
    parent = v;
    const unit = depth4Unit.get(v.code);
    if (unit) provinceArea.set(v.code, areaIdOfUnit.get(unit)!);
    // A HUC, an NCR city or Pateros has no town rows under it: it is a town itself.
    const next = geo[i + 1];
    if (unit && (!next || depth(next.label) <= 4)) pushTown(v, unit);
  } else if (d === 6 && parent) {
    // A town that is an area of its own (Isabela City, listed under Zamboanga Sibugay) goes to that area.
    const own = unitOf(key(v.label));
    const unit = own.startsWith('city:') && areaKeys.has(own) ? own : depth4Unit.get(parent.code);
    if (unit) pushTown(v, unit);
  }
}
const townByCode = new Map(towns.map((t) => [t.code, t]));
check(towns.length === 1642, `1,642 cities and municipalities (got ${towns.length})`);
check(towns.reduce((s, t) => s + t.population, 0) === 112727776, 'towns add up to the country (112,727,776)');
for (const a of ind.areas) {
  const p = towns.filter((t) => t.area === a.id).reduce((s, t) => s + t.population, 0);
  check(p === popOfArea.get(a.id), `${a.id}: its towns add up to its population (${p} vs ${popOfArea.get(a.id)})`);
}
// The 2015 and 2020 counts: every town has both, and the towns add up to the country and to each of PSA's region rows.
const sumCensus = (list: MpbPopTown[]): Census => [0, 1, 2].map((i) => list.reduce((s, t) => s + t.census[i], 0)) as Census;
check(towns.every((t) => t.census.every((v) => v > 0)), `every town has a 2015, 2020 and 2024 count (${towns.filter((t) => !t.census.every((v) => v > 0)).length} do not)`);
check(sumCensus(towns).join() === '100979303,109033245,112727776', `towns add up to the country in 2015, 2020 and 2024 (${sumCensus(towns).join()})`);
const PSA_REGION: Record<string, string> = {
  'National Capital Region': 'NCR', 'Cordillera': 'CAR', 'Region I ': 'I', 'Region II ': 'II', 'Region III ': 'III', 'Region IV-A': 'IV-A',
  'MIMAROPA': 'MIMAROPA', 'Region V ': 'V', 'Region VI ': 'VI', 'Negros Island': 'NIR', 'Region VII ': 'VII', 'Region VIII': 'VIII',
  'Region IX': 'IX', 'Region X ': 'X', 'Region XI ': 'XI', 'Region XII ': 'XII', 'Region XIII': 'XIII', 'Bangsamoro': 'BARMM',
};
const psaRegion = new Map<string, Census>();
for (const r of D.rows) {
  const i = ['0', '1', '2'].indexOf(r.codes[1]);
  if (i < 0 || !/^\.\.[^.]/.test(r.labels[0])) continue;
  const k = Object.entries(PSA_REGION).find(([s]) => r.labels[0].includes(s))?.[1];
  check(!!k, `PSA region row "${r.labels[0]}" has a key`);
  if (k) (psaRegion.get(k) ?? psaRegion.set(k, [0, 0, 0]).get(k)!)[i] = r.value;
}
const censusOfRegion = new Map(REGION_ORDER.map((k) => [k, sumCensus(towns.filter((t) => t.region === k))]));
for (const k of REGION_ORDER) check(censusOfRegion.get(k)!.join() === psaRegion.get(k)?.join(), `${k}: its towns add up to PSA's region row in each census (${censusOfRegion.get(k)!.join()} vs ${psaRegion.get(k)?.join()})`);

// ---- placing a line ----
/** A PSGC place code (2023 codes in mpb-years) → today's census town code. */
function townCodeOf(code: string): string | null {
  if (!/^\d{10}$/.test(code)) return null;
  let t = code.slice(0, 7) + '000';
  if (t.startsWith('13806')) t = '1380600000'; // Manila's sub-municipalities
  for (const [a, b] of [['06045', '18045'], ['07046', '18046'], ['07061', '18061'], ['19066', '09066']]) if (t.startsWith(a)) t = b + t.slice(5);
  if (townByCode.has(t)) return t;
  // A HUC's own barangays carry the city's 5-digit prefix.
  const city = t.slice(0, 5) + '00000';
  return townByCode.has(city) ? city : null;
}
function provinceAreaOf(code: string): string | null {
  let p = code.slice(0, 5) + '00000';
  for (const [a, b] of [['06045', '18045'], ['07046', '18046'], ['07061', '18061'], ['19066', '09066']]) if (p.startsWith(a)) p = b + p.slice(5);
  return provinceArea.get(p) ?? null;
}
const jurisdiction = new Map(districts.districts.map((d) => [d.id, d.jurisdiction]));
function areaOfDistricts(ids: number[]): string | null {
  const list = [...new Set(ids.map((i) => areaIdOfUnit.get(unitOf(key(jurisdiction.get(L.districts[i][0]) ?? '')))))];
  return list.length === 1 && list[0] ? list[0] : null;
}

// Town locations: the town's own place (a city or municipality in the MPB data), else the middle of its barangays.
{
  const own = new Map<string, [number, number]>(), brgy = new Map<string, [number, number, number]>();
  for (const p of L.places) {
    if (p[1] > 3 || p[3] == null || p[4] == null) continue;
    const t = townCodeOf(p[0]);
    if (!t) continue;
    if (p[1] >= 2) own.set(t, [p[3], p[4]]);
    else { const a = brgy.get(t) ?? [0, 0, 0]; brgy.set(t, [a[0] + p[3], a[1] + p[4], a[2] + 1]); }
  }
  for (const t of towns) {
    const o = own.get(t.code), b = brgy.get(t.code);
    const ll = o ?? (b ? [b[0] / b[2], b[1] / b[2]] : null);
    if (ll) { t.lng = Number(ll[0].toFixed(5)); t.lat = Number(ll[1].toFixed(5)); }
  }
}

const c = Object.fromEntries(L.cols.map((k, i) => [k, i]));
const emptyBy = () => ({ region: {}, area: {}, town: {} }) as Record<PopLevel, Record<string, Tally>>;
const by: MpbPopulationFile['by'] = {};
const budgets = new Map<string, MpbPopBudget>();
const BUDGET_LABEL = (k: string) => (k === COMBINED_KEY ? 'FY2020–2026 GAA, seven budgets'
  : k === ALL_NEP_KEY ? 'All years: FY2015–2026 GAA and the 2027 NEP'
  : k === ALL_HOUSE_KEY ? 'All years: FY2015–2026 GAA and the 2027 House bill'
  : k.startsWith('gaa-') ? `FY${k.slice(4)} GAA` : k === 'nep-2027' ? '2027 NEP' : '2027 House bill');
const tally = (bk: string, level: PopLevel, unit: string | null, php: number) => {
  const b = budgets.get(bk)!;
  if (!unit) return;
  const t = ((by[bk] ??= emptyBy())[level][unit] ??= [0, 0]);
  t[0]++; t[1] += php;
  b.placed[level][0]++; b.placed[level][1] += php;
};
const yearsOf = (k: string) => (k === COMBINED_KEY ? [2020, 2021, 2022, 2023, 2024, 2025, 2026]
  : k === ALL_NEP_KEY || k === ALL_HOUSE_KEY ? Array.from({ length: 13 }, (_, i) => 2015 + i)
  : [L.budgets.find((b) => b.key === k)!.fy]);
for (const k of [...L.budgets.map((b) => b.key), COMBINED_KEY, ALL_NEP_KEY, ALL_HOUSE_KEY]) {
  budgets.set(k, { key: k, label: BUDGET_LABEL(k), years: yearsOf(k), lines: 0, php: 0, placed: { region: [0, 0], area: [0, 0], town: [0, 0] } });
  by[k] = emptyBy();
}
for (const r of L.rows) {
  const fy = r[c.fy] as number;
  const amounts: [string, number | null][] = fy <= 2026
    ? [[`gaa-${fy}`, r[c.gaa_php] as number | null]]
    : [['nep-2027', r[c.nep_php] as number | null], ['house-2027', r[c.house_php] as number | null]];
  if (fy >= 2020 && fy <= 2026) amounts.push([COMBINED_KEY, r[c.gaa_php] as number | null]);
  if (fy <= 2026) amounts.push([ALL_NEP_KEY, r[c.gaa_php] as number | null], [ALL_HOUSE_KEY, r[c.gaa_php] as number | null]);
  else amounts.push([ALL_NEP_KEY, r[c.nep_php] as number | null], [ALL_HOUSE_KEY, r[c.house_php] as number | null]);
  const place = r[c.place] == null ? null : L.places[r[c.place] as number];
  let town: string | null = null, area: string | null = null;
  if (place && place[1] <= 3) { town = townCodeOf(place[0]); area = town ? townByCode.get(town)!.area : null; }
  if (!area && place && place[1] === 4) area = provinceAreaOf(place[0]);
  if (!area && place && place[1] === 5) area = areaOfDistricts(place[6]);
  // The region the documents give (index -1 = none), else the region of the place.
  const ri = r[c.region] as number | null;
  const region = ri != null && ri >= 0 ? L.regions[ri] : area ? areaById.get(area)!.region : null;
  for (const [bk, php] of amounts) {
    if (php == null) continue;
    const b = budgets.get(bk)!;
    b.lines++; b.php += php;
    tally(bk, 'region', region && REGION_ORDER.includes(region) ? region : null, php);
    tally(bk, 'area', area, php);
    tally(bk, 'town', town, php);
  }
}

// ---- checks against the MPB build's own totals ----
for (const s of summary.budgets) {
  const b = budgets.get(s.key)!;
  check(b.lines === s.lines && b.php === s.php, `${s.key}: ${b.lines} lines ₱${b.php} = mpb-years summary (${s.lines}, ₱${s.php})`);
  check(b.placed.region[1] / b.php > 0.88, `${s.key}: ${((100 * b.placed.region[1]) / b.php).toFixed(1)}% placed in a region`);
  check(b.placed.town[1] / b.php > 0.8, `${s.key}: ${((100 * b.placed.town[1]) / b.php).toFixed(1)}% placed in a town`);
}
const comb = budgets.get(COMBINED_KEY)!;
check(comb.php === summary.budgets.filter((s) => /^gaa-202[0-6]$/.test(s.key)).reduce((a, s) => a + s.php, 0), 'the combined budget = FY2020–2026 GAA');
const gaaAll = summary.budgets.filter((s) => s.key.startsWith('gaa-'));
for (const [k, doc] of [[ALL_NEP_KEY, 'nep-2027'], [ALL_HOUSE_KEY, 'house-2027']] as const) {
  const want = gaaAll.reduce((a, s) => a + s.php, 0) + summary.budgets.find((s) => s.key === doc)!.php;
  const wantLines = gaaAll.reduce((a, s) => a + s.lines, 0) + summary.budgets.find((s) => s.key === doc)!.lines;
  check(budgets.get(k)!.php === want && budgets.get(k)!.lines === wantLines, `${k} = FY2015–2026 GAA + ${doc} (₱${want}, ${wantLines} lines)`);
}
for (const t of Object.keys(by['house-2027'].town)) check(townByCode.has(t), `town ${t} is a census town`);
for (const bk of budgets.keys()) for (const [t, v] of Object.entries(by[bk].town)) {
  const area = townByCode.get(t)!.area;
  check((by[bk].area[area]?.[1] ?? 0) >= v[1], `${bk}: ${t}'s area has at least the town's budget`);
}

// Every town with a project can be drawn.
for (const bk of budgets.keys()) for (const t of Object.keys(by[bk].town)) check(townByCode.get(t)!.lng != null, `${bk}: town ${t} has a location`);

if (failures.length) {
  console.error(`build-mpb-population: ${failures.length} check(s) failed:\n  ` + failures.slice(0, 40).join('\n  '));
  process.exit(1);
}

// ---- write ----
const regions = REGION_ORDER.map((k) => ({ key: k, label: REGION_NAMES[k].label, plain: REGION_NAMES[k].plain, population: rb.regions.find((r) => r.key === k)!.population_2024, census: censusOfRegion.get(k)! }));
const areas = ind.areas.map((a) => ({ id: a.id, name: a.name, region: a.region, population: popOfArea.get(a.id)!, census: sumCensus(towns.filter((t) => t.area === a.id)), psgc: a.psgc }));
const order = [...L.budgets.map((b) => b.key)].reverse(); // newest first
const budgetList = [...order.map((k) => budgets.get(k)!), comb, budgets.get(ALL_NEP_KEY)!, budgets.get(ALL_HOUSE_KEY)!];
const esc = (v: unknown) => (v == null ? '' : typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : String(v));
// One row per budget and place. `people` is the population in the budget's year (the average over its years for the
// combined and all-years budgets); the three rates are per year: totals ÷ years ÷ people.
const csvRows = ['budget,years,level,code,name,area,region,population_2015,population_2020,population_2024,people,lines,budget_php,php_per_person_per_year,people_per_line_per_year,lines_per_100k_per_year'];
const csvRow = (b: MpbPopBudget, level: string, code: string, name: string, area: string, region: string, c: Census, t: Tally) => {
  const yrs = b.years.length, people = peopleIn(c, b.years);
  return [b.label, `${b.years[0]}-${b.years[yrs - 1]}`, level, code, name, area, region, ...c, Math.round(people), t[0], t[1],
    (t[1] / yrs / people).toFixed(2), t[0] ? Math.round((people * yrs) / t[0]) : '', ((1e5 * t[0]) / yrs / people).toFixed(3)].map(esc).join(',');
};
for (const b of budgetList) {
  for (const r of regions) csvRows.push(csvRow(b, 'region', r.key, r.plain, '', r.key, r.census, by[b.key].region[r.key] ?? [0, 0]));
  for (const a of areas) csvRows.push(csvRow(b, 'province', a.id, a.name, a.id, a.region, a.census, by[b.key].area[a.id] ?? [0, 0]));
  for (const tw of towns) csvRows.push(csvRow(b, tw.kind, tw.code, tw.name, tw.area, tw.region, tw.census, by[b.key].town[tw.code] ?? [0, 0]));
}
const csv = csvRows.join('\n') + '\n';
let commit: string | null;
try { commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { commit = null; }
const file: MpbPopulationFile = {
  schema: 2, built_at: new Date().toISOString(), source_commit: commit,
  budgets: budgetList, regions, areas, towns, by,
  population_source: {
    title: T.title, url: `${STATISTICS_SITE}/datasets/${T.id}`, publisher_url: T.source,
    as_of: `PSA updated ${T.sourceUpdated.slice(0, 10)}; saved ${T.retrieved.slice(0, 10)}`,
  },
  csv: { path: MPB_POPULATION_CSV_PATH, bytes: Buffer.byteLength(csv), sha256: createHash('sha256').update(csv).digest('hex') },
  notes: [
    'Each line is counted where the multi-purpose building map places it: the barangay or town its title names (or its GPS point), else the province, else the one legislative district its DPWH office serves. Regions come from the budget documents.',
    'Each budget is measured against the population in its own year: PSA’s 2015, 2020 and 2024 censuses (the earlier two restated on today’s boundaries), filled in between them at a steady rate. Budgets after 2024 use the 2024 count; we do not project.',
    'The combined and all-years budgets are a yearly average: their projects and budget divided by the number of years and by the average population over those years.',
    'A province includes its highly urbanized cities; Metro Manila is its four districts, as in the Indicators section.',
    'Amounts are allocations in the budget documents, not spending; a building funded over several years has a line in each year.',
  ],
};
writeFileSync(`${DATA}/hgab/2027/mpb-years/population.json`, JSON.stringify(file));
writeFileSync(`${DATA}/hgab/2027/mpb-years/population.csv`, csv);
console.log(`wrote mpb-years/population.json (${(JSON.stringify(file).length / 1024).toFixed(0)} KB) and population.csv (${(csv.length / 1024).toFixed(0)} KB): ${towns.length} towns, ${budgetList.length} budgets`);
for (const b of budgetList) console.log(`  ${b.key.padEnd(14)} ${String(b.lines).padStart(5)} lines ₱${(b.php / 1e9).toFixed(1)}B  placed: region ${((100 * b.placed.region[1]) / b.php).toFixed(1)}%, province ${((100 * b.placed.area[1]) / b.php).toFixed(1)}%, town ${((100 * b.placed.town[1]) / b.php).toFixed(1)}%`);
