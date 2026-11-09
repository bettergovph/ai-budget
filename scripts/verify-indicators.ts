/**
 * Independent checks on the Indicators data (data/indicators/indicators.json and .csv).
 *
 *   npm run verify:indicators                  # local files
 *   npm run verify:indicators -- --live        # also compare with what R2 serves
 *
 * It does not reuse the builder's place-name matching: sample areas are recomputed from PSA's raw rows by
 * their codes, so a mapping bug in scripts/stats-psa/geo.mjs would show up here. Exits 1 on any failure.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { INDICATORS, INDICATORS_CSV_PATH, INDICATORS_DATA_PATH, THEMES, type IndicatorsFile } from '../src/lib/indicators';
import { BUDGET_YEARS, REGION_BUDGET_CSV_PATH, REGION_BUDGET_PATH, REGION_BY_CODE, REGION_ORDER, type RegionBudgetFile } from '../src/lib/budget-regions';
import { DuckDBInstance } from '@duckdb/node-api';

const args = process.argv.slice(2);
const DATA = args.find((a) => a.startsWith('--data='))?.slice(7) ?? 'data';
const RAW = `${DATA}/stats-psa/raw`;
const live = args.includes('--live');

let pass = 0;
const fails: string[] = [];
const check = (ok: boolean, msg: string) => { if (ok) pass++; else fails.push(msg); };
const near = (a: number | null | undefined, b: number, tol = 1e-6) => a != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

interface Raw { values: Record<string, { code: string; label: string }[]>; rows: { codes: string[]; value: number | null }[] }
const raw = (n: string) => JSON.parse(readFileSync(`${RAW}/${n}.json`, 'utf8')) as Raw;
/** Sum of a raw table's rows whose codes match `pick` (dimension index → code or codes). */
function sum(t: Raw, pick: Record<number, string | string[]>): number {
  return t.rows.filter((r) => Object.entries(pick).every(([i, c]) => (Array.isArray(c) ? c : [c]).includes(r.codes[+i]))).reduce((s, r) => s + (r.value ?? 0), 0);
}
const codeOf = (t: Raw, dim: string, label: string) => t.values[dim].find((v) => v.label === label)!.code;

const file = JSON.parse(readFileSync(`${DATA}/indicators/indicators.json`, 'utf8')) as IndicatorsFile;
const csv = readFileSync(`${DATA}/indicators/indicators.csv`, 'utf8');
const val = (ind: string, area: string) => file.indicators.find((i) => i.id === ind)!.values[area];

// ---- shape ----
check(file.schema === 1, 'schema 1');
check(file.areas.length === 87, '87 areas');
check(new Set(file.areas.map((a) => a.id)).size === 87, 'area ids unique');
check(file.indicators.length === INDICATORS.length && INDICATORS.every((d) => file.indicators.some((i) => i.id === d.id)), 'every defined indicator is in the file');
check(THEMES.every((t) => INDICATORS.some((d) => d.theme === t.key)), 'every theme has an indicator');
for (const i of file.indicators) {
  const vs = Object.values(i.values);
  check(vs.length === 87 && vs.every((v) => v === null || Number.isFinite(v)), `${i.id}: 87 finite-or-null values`);
  check(i.coverage.areas === vs.filter((v) => v != null).length, `${i.id}: coverage count matches`);
  check(i.overall.value != null && Number.isFinite(i.overall.value), `${i.id}: overall value`);
  const def = INDICATORS.find((d) => d.id === i.id)!;
  check(def.sources.every((k) => file.sources.some((s) => s.key === k)), `${i.id}: every source listed`);
}
const geo = JSON.parse(readFileSync(`${DATA}/hgab/2027/geo/provinces.json`, 'utf8')) as { provinces: { psgc: number }[] };
const psgcs = file.areas.flatMap((a) => a.psgc);
check(psgcs.length === geo.provinces.length && new Set(psgcs).size === psgcs.length, 'every province outline belongs to exactly one area');

// ---- the CSV says the same as the JSON ----
const lines = csv.trim().split('\n');
const head = lines[0].split(',');
check(createHash('sha256').update(csv).digest('hex') === file.csv.sha256, 'CSV checksum in the JSON');
check(lines.length === 88, 'CSV has 87 rows');
let csvSame = true;
for (const line of lines.slice(1)) {
  const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
  const id = cells[0];
  for (const d of INDICATORS) {
    const c = cells[head.indexOf(d.id)];
    const v = val(d.id, id);
    if ((c === '' ? null : Number(c)) !== v) csvSame = false;
  }
}
check(csvSame, 'every CSV value equals the JSON value');

// ---- recompute sample areas from PSA's raw rows, by code ----
const pop = raw('census2024_pop');
const POP = (codes: string[]) => sum(pop, { 0: codes, 1: '0' });
const cebuCodes = ['0702200000', '0730600000', '0731100000', '0731300000'];
const ncr2Codes = ['1380500000', '1380700000', '1381200000', '1381300000', '1381400000'];
const ncr3Codes = ['1380100000', '1380400000', '1380900000', '1381600000'];
check(val('population', 'cebu') === POP(cebuCodes), 'Cebu population = Cebu + Cebu City + Lapu-Lapu + Mandaue');
check(val('population', 'metro-manila-2nd-district') === POP(ncr2Codes), 'Metro Manila 2nd District population = its five cities');
check(val('population', 'benguet') === POP(['1401100000', '1430300000']), 'Benguet population includes Baguio');
check(val('population', 'maguindanao') === POP(['1908700000', '1908800000']), 'Maguindanao = del Norte + del Sur');
check(val('population', 'isabela-city') === POP(['0990100000']), 'Isabela City on its own');
check(file.indicators.find((i) => i.id === 'population')!.overall.value === 112729484, 'Philippines population 112,729,484');

const pov = raw('poverty_pop');
const pv = (geoCode: string) => pov.rows.find((r) => r.codes[0] === geoCode && r.codes[1] === '1' && r.codes[2] === '2')!.value;
check(val('poverty', 'cebu') === pv('63'), 'Cebu poverty 2023 is PSA’s Cebu row');
check(val('poverty', 'metro-manila-1st-district') === pv('2'), 'Metro Manila 1st District poverty is PSA’s 1st District row');
check(file.indicators.find((i) => i.id === 'poverty')!.overall.value === pv('0'), 'Philippines poverty is PSA’s national row');

const deaths = raw('deaths2024');
const d3 = sum(deaths, { 0: ncr3Codes, 1: '0', 2: '0' });
check(near(val('death-rate', 'metro-manila-3rd-district'), (1000 * d3) / POP(ncr3Codes), 1e-6), 'Metro Manila 3rd District death rate from its four cities');

const fies = raw('fies2023');
const famInc = (codes: string[]) => {
  const f = (c: string, i: string) => fies.rows.find((r) => r.codes[0] === c && r.codes[1] === i)!.value!;
  return (1000 * codes.reduce((s, c) => s + f(c, '0') * f(c, '1'), 0)) / codes.reduce((s, c) => s + f(c, '0'), 0);
};
check(near(val('family-income', 'cebu'), famInc(['83', '84', '85', '86']), 1e-6), 'Cebu family income = families-weighted province + 3 cities');

const gdp = raw('gdp_level'), gpc = raw('gdp_pc');
const y25 = codeOf(gdp, 'Year', '2025');
const gp = (c: string) => { const g = sum(gdp, { 0: c, 2: y25 }); return { g, people: g / sum(gpc, { 0: c, 2: y25 }) }; };
const b = gp('21'), bg = gp('25');
check(near(val('gdp-per-person', 'benguet'), (b.g + bg.g) / (b.people + bg.people), 1e-6), 'Benguet GDP per person combines Baguio by population');

// ---- budget: House bill placements, from the House bill pages' own file ----
const locations = JSON.parse(readFileSync(`${DATA}/hgab/2027/locations.json`, 'utf8')) as { districts: { district: string; all: { nep_php: number; house_php: number } }[] };
const ilnHouse = locations.districts.filter((d) => d.district.startsWith('leg:ilocos-norte:')).reduce((s, d) => s + d.all.house_php, 0);
check(ilnHouse > 0 && near(val('dpwh-house-per-person', 'ilocos-norte'), ilnHouse / POP(['0102800000']), 1e-6), 'Ilocos Norte House bill DPWH per person = its districts’ placed projects ÷ population');
const placedAll = locations.districts.reduce((s, d) => s + d.all.house_php, 0);
check(placedAll === 466683111000, 'placed House bill DPWH projects = ₱466,683,111,000 (the districts view’s figure)');

// ---- the known PSA table issue stays handled ----
check(val('aged-60', 'albay') === null && val('under-15', 'albay') != null, 'Albay: 60+ left out (PSA age table issue), under-15 kept');
check(file.areas.find((a) => a.id === 'albay')!.notes.some((n) => n.includes('80')), 'Albay carries the note about PSA’s age table');

// ---- budget by region (regions.json), recomputed from DBM's lines with a plain query ----
const rf = JSON.parse(readFileSync(`${DATA}/indicators/regions.json`, 'utf8')) as RegionBudgetFile;
const rcsv = readFileSync(`${DATA}/indicators/regions.csv`, 'utf8');
check(rf.regions.length === 18 && rf.regions.map((r) => r.key).join() === REGION_ORDER.join(), '18 regions in order');
const inRegions = rf.regions.flatMap((r) => r.areas);
check(inRegions.length === 87 && new Set(inRegions).size === 87, 'every area is in exactly one region');
check(rf.regions.reduce((s, r) => s + r.population_2024, 0) === 112727776, 'regions add up to the areas’ population');
check(createHash('sha256').update(rcsv).digest('hex') === rf.csv.sha256, 'regions CSV checksum in the JSON');
check(rcsv.trim().split('\n').length === 1 + 3 * rf.departments.length * 20, 'regions CSV: one row per budget × department × (18 regions + central + nationwide)');
{
  // The CSV's rows for one budget and department add up to that department's whole budget.
  const lines = rcsv.trim().split('\n').slice(1).map((l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')));
  for (const d of rf.departments) for (const y of BUDGET_YEARS) {
    const sum = lines.filter((c) => c[0] === y.label && c[1] === d.id).reduce((s, c) => s + Number(c[5]), 0);
    check(Math.abs(sum - d.total[y.key]) < 25, `CSV ${y.label} ${d.id}: regions + central + nationwide = the whole budget`);
  }
}
for (const d of rf.departments) for (const y of ['2026', '2027', 'house2027'] as const) {
  check(Math.abs(d.regional[y] + d.central[y] + d.nationwide[y] - d.total[y]) < 1, `${d.id} ${y}: regional + central + nationwide = total`);
  const sumRegions = Object.values(rf.budget[y][d.id] ?? {}).reduce((s, v) => s + v, 0);
  check(Math.abs(sumRegions - d.regional[y]) < 1, `${d.id} ${y}: regions add up to the regional total`);
}
// Every indicator by region: present, and adding up where it is a count.
for (const d of INDICATORS.filter((x) => x.theme !== 'budget')) {
  const have = rf.regions.filter((r) => r.values[d.id] != null).length;
  check(have >= (d.id === 'aged-60' || d.id === 'dependency' ? 15 : d.theme === 'farms' || d.id === 'nta-per-person' ? 17 : 18), `${d.id}: a value for ${have} regions`);
}
check(rf.regions.every((r) => r.values.population === r.population_2024), 'regional population indicator = the regions’ population');
const bt = raw('births2024');
const births = bt.rows.find((r) => r.codes[0] === bt.values.Geolocation.find((v) => /^PHILIPPINES/i.test(v.label))!.code && r.codes[1] === '0')!.value!;
const regBirths = rf.regions.reduce((s, r) => s + (r.needs.births_2024 ?? 0), 0);
check(regBirths <= births && regBirths / births > 0.999, `regions’ births add up to PSA’s national births less those abroad (${regBirths} of ${births})`);
const cebuU15 = rf.regions.find((r) => r.key === 'VII')!;
check(near(cebuU15.values['under-15'], (100 * cebuU15.needs.age_under15_2024!) / rf.regions.find((r) => r.key === 'VII')!.areas.reduce((s, id) => s + (file.indicators.find((i) => i.id === 'population')!.values[id] ?? 0), 0), 0.05), 'Region VII under-15 share ≈ its children ÷ its people (household vs total population)');
{
  const db = await (await DuckDBInstance.create(':memory:')).connect();
  const q = async (sql: string) => (await db.runAndReadAll(sql)).getRowObjectsJS() as Record<string, unknown>[];
  const lines = `'${DATA}/2027/*/line_items.parquet'`;
  const [tot] = await q(`select sum(amount)::double t from ${lines} where fy = 2027`);
  check(Math.abs(Number(tot.t) - rf.departments.find((d) => d.id === 'all')!.total['2027']) < 1, '2027 NEP total equals the sum of every line');
  const byCode = await q(`select region_code r, sum(amount)::double t from ${lines} where fy = 2027 and agency_dsc not ilike 'Bangsamoro Autonomous Region%' group by 1`);
  const barmmOwn = await q(`select sum(amount)::double t from ${lines} where fy = 2027 and agency_dsc ilike 'Bangsamoro Autonomous Region%'`);
  for (const [code, key] of Object.entries(REGION_BY_CODE)) {
    if (key === 'NCR') continue;
    let want = Number(byCode.find((x) => x.r === code)?.t ?? 0);
    if (key === 'BARMM') want += Number(barmmOwn[0].t);
    check(Math.abs((rf.budget['2027'].all[key] ?? 0) - want) < 1, `2027 ${key}: the region's lines${key === 'BARMM' ? ' + BARMM’s own lines' : ''}`);
  }
  // House bill = NEP + changes. Recompute DPWH in Region I from the comparison's Ilocos lines and the dropped NEP lines.
  const dl = `${DATA}/hgab/2027/explorer/downloads`;
  const [ch1] = await q(`select coalesce(sum(change_php), 0)::double t from '${dl}/house-bill-2027-lines-vs-nep.parquet' where department_no = 'XXII' and region ilike '%ilocos%' and status not in ('same', 'unprogrammed')`);
  const [ch2] = await q(`select coalesce(sum(nep_php::bigint), 0)::double t from read_csv_auto('${dl}/nep-2027-lines-not-in-house-bill.csv', all_varchar = true) where nep_department_code = '18' and region_code = '01'`);
  check(Math.abs((rf.budget.house2027['18']?.I ?? 0) - (rf.budget['2027']['18']?.I ?? 0) - (Number(ch1.t) - Number(ch2.t))) < 1, 'House bill DPWH in Region I = NEP + the House’s Ilocos changes');
  const allD = rf.departments.find((d) => d.id === 'all')!;
  check(Math.abs(allD.total.house2027 - allD.total['2027']) < 1, 'House bill total = NEP total (raised = cut)');
  const deped = await q(`select sum(amount)::double t from ${lines} where fy = 2026 and department_id = '07' and region_code = '05'`);
  check(Math.abs((rf.budget['2026']['07']?.V ?? 0) - Number(deped[0].t)) < 1, '2026 DepEd in Region V equals its lines');
  const ncr = rf.budget['2027'].all.NCR, ncrAll = Number(byCode.find((x) => x.r === '13')!.t);
  check(ncr > 0 && ncr < 0.1 * ncrAll, `NCR's own offices are a small part of what DBM codes NCR (${(ncr / 1e9).toFixed(1)}B of ${(ncrAll / 1e9).toFixed(1)}B)`);
}

// ---- live copy on R2 ----
if (live) {
  for (const [path, local] of [
    [INDICATORS_DATA_PATH, readFileSync(`${DATA}/indicators/indicators.json`)], [INDICATORS_CSV_PATH, Buffer.from(csv)],
    [REGION_BUDGET_PATH, readFileSync(`${DATA}/indicators/regions.json`)], [REGION_BUDGET_CSV_PATH, Buffer.from(rcsv)],
  ] as const) {
    const r = await fetch(`https://budget-assets.bettergov.ph/${path}?v=${Date.now()}`, { cache: 'no-store' });
    const body = Buffer.from(await r.arrayBuffer());
    check(r.ok && createHash('sha256').update(body).digest('hex') === createHash('sha256').update(local).digest('hex'), `R2 ${path} equals the local file`);
    check(r.headers.get('access-control-allow-origin') === '*', `R2 ${path} sends CORS *`);
  }
}

console.log(`verify-indicators: ${pass} passed, ${fails.length} failed`);
if (fails.length) { console.error('  ' + fails.join('\n  ')); process.exit(1); }
