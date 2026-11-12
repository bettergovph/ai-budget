/**
 * Build the Indicators section's data: data/indicators/indicators.json and indicators.csv.
 *
 *   node scripts/stats-psa/fetch-psa.mjs        # the PSA tables, from statistics.bettergov.ph
 *   node scripts/stats-psa/build.mjs            # measures per area → data/stats-psa/out/areas.json
 *   npm run build:indicators                    # this script: the indicators, from src/lib/indicators.ts
 *   npm run build:indicators -- --upload        # also put both files on R2 under indicators/ (R2_* env)
 *
 * The indicator definitions (titles, copy, formulas) live in src/lib/indicators.ts. This script applies
 * them, checks the result and fails rather than write a file that does not add up. See docs/indicators.md.
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  INDICATORS, INDICATORS_CSV_PATH, INDICATORS_DATA_PATH, RATE_WEIGHTS, STATISTICS_SITE, THEMES,
  type IndicatorArea, type IndicatorSource, type IndicatorValues, type IndicatorsFile, type Measures, type SourceKey,
} from '../src/lib/indicators';
import {
  BARMM_AGENCY_PREFIX, BUDGET_YEARS, CENTRAL_LABEL, HOUSE_BILL_NOTE, NATIONWIDE_LABEL, NCR_LOCAL_PATTERN, REGION_BUDGET_CSV_PATH, REGION_BUDGET_PATH, REGION_BY_CODE, REGION_NAMES, REGION_ORDER,
  type BudgetDepartment, type BudgetRegion, type BudgetYear, type RegionBudgetFile,
} from '../src/lib/budget-regions';
import { DuckDBInstance } from '@duckdb/node-api';

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const DATA = opt('data', 'data');
const AREAS = opt('areas', `${DATA}/stats-psa/out/areas.json`);
const OUT = opt('out', `${DATA}/indicators`);
const upload = args.includes('--upload');
const PUBLIC = 'https://budget-assets.bettergov.ph';

interface AreaRow extends Record<string, unknown> { unit: string; name: string; region: string; psgc: number[]; barmm_period: boolean; population_2024: number }
interface PsaTable { name: string; id: string; title: string; source: string; release: string; sourceUpdated: string | null; retrieved: string | null }
interface AreasFile { meta: { built_at: string; national: Measures; psa_tables: PsaTable[]; contracts: { total_php: number; placed_php: Record<string, number> } }; rows: AreaRow[] }

const { meta, rows } = JSON.parse(readFileSync(AREAS, 'utf8')) as AreasFile;
const failures: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) failures.push(msg); };

// ---- area ids: URL slugs ----
const NCR_SLUG: Record<string, string> = { ncr1: 'metro-manila-1st-district', ncr2: 'metro-manila-2nd-district', ncr3: 'metro-manila-3rd-district', ncr4: 'metro-manila-4th-district' };
const slug = (unit: string) => NCR_SLUG[unit] ?? (unit.startsWith('city:') ? `${unit.slice(5)}-city` : unit).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const REGION_LABEL: Record<string, string> = { NCR: 'NCR', CAR: 'CAR', MIMAROPA: 'MIMAROPA', NIR: 'NIR', BARMM: 'BARMM' };

const areas: IndicatorArea[] = rows.map((r) => {
  const notes: string[] = [];
  if (typeof r.age_note === 'string') notes.push(`${r.age_note}, so the 60-and-over share and the dependency ratio are left out.`);
  if (r.unit === 'maguindanao') notes.push('Maguindanao del Norte and del Sur are shown together, because PSA’s earlier poverty figures do not split them. Cotabato City is not included in the poverty and income figures.');
  if (r.unit === 'special geographic area') notes.push('The Special Geographic Area (the former Cotabato barangays that joined BARMM) has census figures but no poverty, income or economic figures of its own.');
  if (r.unit === 'sulu') notes.push('Sulu was part of BARMM until the 2024 Supreme Court ruling; DPWH now lists it under Region IX.');
  if (r.barmm_period && r.unit !== 'sulu') notes.push('BARMM has its own public works ministry, so DPWH builds little here.');
  return { id: slug(r.unit), name: r.name, region: REGION_LABEL[r.region] ?? `Region ${r.region}`, psgc: r.psgc, barmm_period: r.barmm_period, notes };
});
const idOf = new Map(rows.map((r, i) => [r.unit, areas[i].id]));
check(new Set(areas.map((a) => a.id)).size === areas.length, 'area ids are unique');
check(areas.length === 87, `87 areas (got ${areas.length})`);

// ---- sources ----
const date = (s: string | null) => (s ? s.slice(0, 10) : null);
const sources: IndicatorSource[] = meta.psa_tables.map((t) => ({
  key: t.name as SourceKey, title: t.title, url: `${STATISTICS_SITE}/datasets/${t.id}`, publisher_url: t.source,
  publisher: 'Philippine Statistics Authority (PSA OpenSTAT)',
  as_of: [t.sourceUpdated && `PSA updated ${date(t.sourceUpdated)}`, t.retrieved && `saved ${date(t.retrieved)}`].filter(Boolean).join('; ') || null,
}));
const contractsMeta = JSON.parse(readFileSync(`${DATA}/dpwh-contracts/contracts.meta.json`, 'utf8')) as { downloaded_to?: string };
const locations = JSON.parse(readFileSync(`${DATA}/hgab/2027/locations.json`, 'utf8')) as { built_at: string };
sources.push(
  { key: 'dpwh_contracts', title: 'DPWH contracts, 2016–2026 (every contract in the DPWH transparency listing)', url: '/hgab/2027/contractors#downloads', publisher_url: 'https://transparency.dpwh.gov.ph/', publisher: 'DPWH, through api.dpwh.bettergov.ph', as_of: contractsMeta.downloaded_to ? `downloaded ${date(contractsMeta.downloaded_to)}` : null },
  { key: 'hgab_locations', title: 'FY2027 House bill: DPWH projects placed in each district', url: '/hgab/2027/districts?view=list-legislative', publisher_url: null, publisher: 'BetterGov.ph House bill pages (from the NEP and House Bill 10858 as published)', as_of: `built ${date(locations.built_at)}` },
);
const sourceKeys = new Set(sources.map((s) => s.key));

// ---- indicators ----
const nationalPop = meta.national.population_2024 as number;
const round = (v: number | null, d: number) => (v == null ? null : Number(v.toFixed(Math.max(d + 3, 4))));
const PERCENT_LIKE = new Set(['percent']);
const indicators: IndicatorValues[] = INDICATORS.map((def) => {
  for (const s of def.sources) check(sourceKeys.has(s), `${def.id}: source ${s} exists`);
  const values: Record<string, number | null> = {};
  let covered = 0, coveredPop = 0;
  const sums: Record<string, number> = {};
  for (const r of rows) {
    const v = def.value(r as Measures);
    check(v == null || Number.isFinite(v), `${def.id} ${r.unit}: finite`);
    if (v != null && PERCENT_LIKE.has(def.unit) && def.scale === 'sequential') check(v >= 0 && v <= 100, `${def.id} ${r.unit}: ${v} within 0–100`);
    values[idOf.get(r.unit)!] = round(v, def.decimals);
    if (v == null) continue;
    covered++; coveredPop += r.population_2024;
    for (const f of def.sums ?? []) sums[f] = (sums[f] ?? 0) + Number(r[f] ?? 0);
  }
  const overallValue = def.overall === 'national' ? def.value(meta.national) : def.value(sums);
  check(overallValue != null && Number.isFinite(overallValue), `${def.id}: overall value`);
  const label = def.overall === 'national' ? 'Philippines'
    : covered === rows.length ? `All ${covered} areas`
    : `All ${covered} areas with a figure`;
  const out: IndicatorValues = {
    id: def.id, values,
    overall: { value: round(overallValue, def.decimals), label },
    coverage: { areas: covered, population_share: Number((coveredPop / nationalPop).toFixed(4)) },
  };
  if (def.id === 'poverty') out.cv = Object.fromEntries(rows.map((r) => [idOf.get(r.unit)!, (r.poverty_cv_2023 as number | null) ?? null]));
  const minAreas = def.theme === 'farms' || def.id === 'nta-per-person' ? 78 : def.id === 'aged-60' || def.id === 'dependency' ? 65 : 84;
  check(covered >= minAreas, `${def.id}: ${covered} areas with a value (need ${minAreas})`);
  return out;
});
for (const t of THEMES) check(INDICATORS.some((d) => d.theme === t.key), `theme ${t.key} has indicators`);

// ---- spot checks against the national figures PSA publishes ----
const ov = (id: string) => indicators.find((i) => i.id === id)!.overall.value!;
check(nationalPop === 112729484, `national population is the 2024 POPCEN total (got ${nationalPop})`);
check(Math.abs(ov('poverty') - 15.5) < 1e-9, `national poverty incidence 2023 is 15.5 (got ${ov('poverty')})`);
// The national total also counts 1,708 Filipinos in Philippine embassies, consulates and missions abroad,
// who belong to no province; the areas add up to the regions' sum, 112,727,776.
check(nationalPop - rows.reduce((s, r) => s + r.population_2024, 0) === 1708, 'areas add up to the national population less the 1,708 counted abroad');
const placedContracts = rows.reduce((s, r) => s + Number(r.dpwh_contracts_2018_2025), 0);
const p = meta.contracts.placed_php;
check(Math.abs(placedContracts - (p.gps + p.office + p.office_split)) < 1, 'contract budget placed = GPS + office + split office');
check(Math.abs(placedContracts + p.unplaced - meta.contracts.total_php) < 1, 'placed + unplaced = all 2018–2025 contracts');

// ---- budget by region (indicators/regions.json) ----
// NEP 2027 and GAA 2026 lines by region code, from the NEP import (docs/nep-2027-import.md). NCR lines count
// as NCR only for Metro Manila's own offices and state universities; the rest are national (`central`).
const db = await (await DuckDBInstance.create(':memory:')).connect();
const res = await db.runAndReadAll(`
  select fy::varchar fy, department_id d,
    case when agency_dsc ilike '${BARMM_AGENCY_PREFIX}%' then '19'
         when region_code = '13' and not (department_id = '08' or regexp_matches(coalesce(operunit_dsc, ''), '(?i)${NCR_LOCAL_PATTERN}')) then 'central'
         when region_code = '00' or region_code is null then 'nationwide' else region_code end r,
    sum(amount)::double amt
  from '${DATA}/2027/*/line_items.parquet' where fy in (2026, 2027) group by all`);
const national2027 = JSON.parse(readFileSync(`${DATA}/2027/national/index.json`, 'utf8')) as {
  national: Record<string, number>; departments: { id: string; description: string; amount?: number; base_amount?: number }[];
};
const deptName = new Map(national2027.departments.map((d) => [d.id, d.description]));
const YEARS = BUDGET_YEARS.map((y) => y.key);
const zero = () => Object.fromEntries(YEARS.map((y) => [y, 0])) as Record<BudgetYear, number>;
const depts = new Map<string, BudgetDepartment>();
const budget = Object.fromEntries(YEARS.map((y) => [y, {} as Record<string, Record<string, number>>])) as RegionBudgetFile['budget'];
const deptOf = (id: string): BudgetDepartment => {
  let d = depts.get(id);
  if (!d) {
    const full = id === 'all' ? 'All departments' : deptName.get(id) ?? id;
    const m = full.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    // Plain names where the acronym means little to a reader.
    const PLAIN: Record<string, string> = { AUTO: 'Automatic appropriations', SPF: 'Special purpose funds', '08': 'State universities and colleges', '35': 'Government corporations (BSGC)', '36': 'Allocations to local governments', '26': 'Other executive offices' };
    d = { id, name: m ? m[1] : full, short: id === 'all' ? 'All departments' : PLAIN[id] ?? (m ? m[2] : full), total: zero(), regional: zero(), central: zero(), nationwide: zero() };
    depts.set(id, d);
  }
  return d;
};
for (const row of res.getRowObjectsJS() as { fy: BudgetYear; d: string; r: string; amt: number }[]) {
  for (const id of [row.d, 'all']) {
    const d = deptOf(id);
    d.total[row.fy] += row.amt;
    if (row.r === 'central') d.central[row.fy] += row.amt;
    else if (row.r === 'nationwide') d.nationwide[row.fy] += row.amt;
    else {
      const key = REGION_BY_CODE[row.r];
      check(key != null, `region code ${row.r} is known`);
      d.regional[row.fy] += row.amt;
      const by = (budget[row.fy][id] ??= {});
      by[key] = (by[key] ?? 0) + row.amt;
    }
  }
}
// The 2027 House bill = the NEP + the House's changes (docs/indicators.md). Changes come from the line-by-line
// comparison (explorer downloads): every line the House raised, cut or added, and the NEP lines it dropped.
{
  const DL = `${DATA}/hgab/2027/explorer/downloads`;
  // Department by agency name where the name is unique in the NEP (the comparison files special purpose
  // funds under "01"); otherwise the comparison's NEP department code; for a House-only agency, the bill's number.
  const agencyRows = (await db.runAndReadAll(`select department_id d, agency_dsc a, list(distinct region_code) codes
    from '${DATA}/2027/*/line_items.parquet' where fy = 2027 group by all`)).getRowObjectsJS() as { d: string; a: string; codes: string[] }[];
  const deptsOfAgency = new Map<string, Set<string>>();
  const codesOf = new Map<string, Set<string>>();
  for (const r of agencyRows) {
    (deptsOfAgency.get(r.a) ?? deptsOfAgency.set(r.a, new Set()).get(r.a)!).add(r.d);
    const k = `${r.d}|${r.a}`;
    for (const c of r.codes) (codesOf.get(k) ?? codesOf.set(k, new Set()).get(k)!).add(c);
  }
  const ROMAN_DEPT: Record<string, string> = { XXXVI: '35' };
  const deptFor = (agency: string | null, code: string | null, roman: string | null) => {
    const ds = agency ? deptsOfAgency.get(agency) : undefined;
    if (ds && ds.size === 1) return [...ds][0];
    if (code && (!ds || ds.has(code))) return code;
    return roman ? ROMAN_DEPT[roman] ?? null : null;
  };
  const LABEL_KEY: [RegExp, string][] = [
    [/national capital|\bncr\b/i, 'NCR'], [/cordillera|\bcar\b/i, 'CAR'], [/mimaropa|\biv-?b\b/i, 'MIMAROPA'], [/calabarzon|\biv-?a\b/i, 'IV-A'],
    [/negros island|national island|\bnir\b/i, 'NIR'], [/bangsamoro|barmm/i, 'BARMM'], [/ilocos/i, 'I'], [/cagayan valley/i, 'II'],
    [/central luzon/i, 'III'], [/bicol/i, 'V'], [/western visayas/i, 'VI'], [/central visayas/i, 'VII'], [/eastern visayas/i, 'VIII'],
    [/zamboanga/i, 'IX'], [/northern mindanao/i, 'X'], [/davao/i, 'XI'], [/socc?sk?sargen/i, 'XII'], [/caraga/i, 'XIII'],
  ];
  const ncrLocal = new RegExp(NCR_LOCAL_PATTERN, 'i');
  const barmmAgency = new RegExp(`^${BARMM_AGENCY_PREFIX}`, 'i');
  /** Region key, or 'central' / 'nationwide'. DBM's code or the printed label first, else the agency's own region in the NEP. */
  const bucketFor = (dept: string, agency: string | null, label: string | null, ou: string | null, dbmCode: string | null): string => {
    if (agency && barmmAgency.test(agency)) return 'BARMM';
    let key: string | null = dbmCode ? REGION_BY_CODE[dbmCode] ?? (dbmCode === '00' ? 'nationwide' : null)
      : label ? LABEL_KEY.find(([re]) => re.test(label))?.[1] ?? null : null;
    if (key == null) {
      const codes = agency ? codesOf.get(`${dept}|${agency}`) : undefined;
      if (codes && codes.size === 1) { const c = [...codes][0]; key = c === '00' ? 'nationwide' : REGION_BY_CODE[c] ?? null; }
    }
    if (key == null) return 'central';
    if (key === 'NCR' && !(dept === '08' || ncrLocal.test(ou ?? ''))) return 'central';
    return key;
  };
  const changes = (await db.runAndReadAll(`
    select department_no roman, nep_department_code code, nep_agency agency, region "label", operating_unit ou, null::varchar dbm, change_php::double ch
      from '${DL}/house-bill-2027-lines-vs-nep.parquet' where status not in ('same', 'unprogrammed') and coalesce(change_php, 0) <> 0
    union all
    select null, nep_department_code, nep_agency, region, operating_unit, lpad(region_code::varchar, 2, '0'), -(nep_php::double)
      from read_csv_auto('${DL}/nep-2027-lines-not-in-house-bill.csv', all_varchar = true)`)).getRowObjectsJS() as {
    roman: string | null; code: string | null; agency: string | null; label: string | null; ou: string | null; dbm: string | null; ch: number;
  }[];
  for (const d of depts.values()) { d.total.house2027 = d.total['2027']; d.regional.house2027 = d.regional['2027']; d.central.house2027 = d.central['2027']; d.nationwide.house2027 = d.nationwide['2027']; }
  for (const [id, by] of Object.entries(budget['2027'])) budget.house2027[id] = { ...by };
  let raised = 0, cut = 0, unmapped = 0;
  for (const c of changes) {
    const dept = deptFor(c.agency, c.code, c.roman);
    if (!dept) { unmapped += c.ch; continue; }
    if (c.ch > 0) raised += c.ch; else cut -= c.ch;
    const bucket = bucketFor(dept, c.agency, c.label, c.ou, c.dbm);
    for (const id of [dept, 'all']) {
      const d = deptOf(id);
      d.total.house2027 += c.ch;
      if (bucket === 'central') d.central.house2027 += c.ch;
      else if (bucket === 'nationwide') d.nationwide.house2027 += c.ch;
      else {
        d.regional.house2027 += c.ch;
        const by = (budget.house2027[id] ??= {});
        by[bucket] = (by[bucket] ?? 0) + c.ch;
      }
    }
  }
  check(unmapped === 0, `every House change has a department (${unmapped} unmapped)`);
  check(Math.abs(raised - 219772824000) < 1 && Math.abs(cut - 219772824000) < 1, `House changes: raised ${raised}, cut ${cut} (₱219,772,824,000 each)`);
  check(Math.abs(deptOf('all').total.house2027 - deptOf('all').total['2027']) < 1, 'the House bill total equals the NEP total');
  const dpwh = deptOf('18');
  check(Math.abs(dpwh.total.house2027 - dpwh.total['2027'] - (654102000000 - 642612015000)) < 2e6, `DPWH House bill − NEP = the explorer's change (${dpwh.total.house2027 - dpwh.total['2027']})`);
}
const all = deptOf('all');
for (const d of depts.values()) check(d.id === 'all' || d.name !== d.id, `department ${d.id} has a name`);
check(Math.abs(all.total['2027'] - national2027.national.amount) < 1, `2027 lines add up to the NEP total (${all.total['2027']} vs ${national2027.national.amount})`);
check(Math.abs(all.total['2026'] - national2027.national.base_amount) < 1, `2026 lines add up to the 2026 GAA total (${all.total['2026']} vs ${national2027.national.base_amount})`);
for (const d of depts.values()) for (const y of YEARS) check(Math.abs(d.regional[y] + d.central[y] + d.nationwide[y] - d.total[y]) < 1, `${d.id} ${y}: regional + central + nationwide = total`);
for (const y of YEARS) check(REGION_ORDER.every((k) => (budget[y].all[k] ?? 0) > 0), `${y}: every region has budget`);
for (const d of depts.values()) for (const y of YEARS) check(Math.abs(Object.values(budget[y][d.id] ?? {}).reduce((s, v) => s + v, 0) - d.regional[y]) < 1, `${d.id} ${y}: regions add up`);

// Regions' people and poor, from the areas (today's regions: Sulu in IX, NIR its own).
const povTable = JSON.parse(readFileSync(`${DATA}/stats-psa/raw/poverty_pop.json`, 'utf8')) as { values: Record<string, { code: string; label: string }[]>; rows: { codes: string[]; value: number | null }[] };
const PSA_REGION: Record<string, string> = {
  'National Capital Region': 'NCR', 'Cordillera Administrative Region': 'CAR', 'Region I ': 'I', 'Region II ': 'II', 'Region III ': 'III',
  'Region IV-A': 'IV-A', 'MIMAROPA': 'MIMAROPA', 'Region V ': 'V', 'Region VI ': 'VI', 'Negros Island': 'NIR', 'Region VII ': 'VII',
  'Region VIII': 'VIII', 'Region IX': 'IX', 'Region X ': 'X', 'Region XI ': 'XI', 'Region XII ': 'XII', 'Region XIII': 'XIII', 'Bangsamoro': 'BARMM',
};
const psaRegion = new Map<string, number>();
for (const v of povTable.values.Geolocation) {
  if (!/^\.\.[^.]/.test(v.label)) continue;
  const label = v.label.replace(/^\.+/, '');
  const k = Object.entries(PSA_REGION).find(([p]) => label.startsWith(p))?.[1];
  const r = povTable.rows.find((x) => x.codes[0] === v.code && x.codes[1] === '1' && x.codes[2] === '2');
  if (k && r?.value != null) psaRegion.set(k, r.value);
}
check(psaRegion.size === 18, `PSA's 18 regional poverty figures found (${psaRegion.size})`);
/** The region's measures for one indicator: its provinces that have a figure, counts summed, rates weighted. */
function regionMeasures(list: AreaRow[]): Measures {
  const m: Measures = {};
  const keys = new Set(list.flatMap((r) => Object.keys(r)));
  for (const k of keys) {
    const w = RATE_WEIGHTS[k];
    const nums = list.filter((r) => typeof r[k] === 'number' && Number.isFinite(r[k] as number));
    if (!nums.length) { m[k] = null; continue; }
    if (w) {
      const wt = (r: AreaRow) => (typeof w === 'string' ? Number(r[w] ?? 0) : w(r as Measures) ?? 0);
      const ws = nums.reduce((s, r) => s + wt(r), 0);
      m[k] = ws ? nums.reduce((s, r) => s + (r[k] as number) * wt(r), 0) / ws : null;
    } else m[k] = nums.reduce((s, r) => s + (r[k] as number), 0);
  }
  return m;
}
const NEED_MEASURES = [...new Set(INDICATORS.flatMap((d) => (d.need ? [d.need.measure] : [])))];
const budgetRegions: BudgetRegion[] = REGION_ORDER.map((key) => {
  const rs = rows.filter((r) => r.region === key);
  const withPov = rs.filter((r) => r.poverty_incidence_2023 != null);
  const poor = withPov.reduce((s, r) => s + (Number(r.poverty_incidence_2023) / 100) * r.population_2024, 0);
  const popPov = withPov.reduce((s, r) => s + r.population_2024, 0);
  return {
    key, label: REGION_NAMES[key].label, plain: REGION_NAMES[key].plain,
    population_2024: rs.reduce((s, r) => s + r.population_2024, 0),
    poor_2023: Math.round(poor), poverty_2023: Number(((100 * poor) / popPov).toFixed(2)),
    poverty_2023_psa: key === 'IX' || key === 'BARMM' ? null : psaRegion.get(key) ?? null,
    areas: rs.map((r) => idOf.get(r.unit)!),
    values: Object.fromEntries(INDICATORS.filter((d) => d.theme !== 'budget').map((d) => {
      const v = d.value(regionMeasures(rs.filter((r) => d.value(r as Measures) != null)));
      return [d.id, v == null ? null : round(v, d.decimals)];
    })),
    needs: Object.fromEntries(NEED_MEASURES.map((f) => {
      const vs = rs.map((r) => r[f]).filter((v): v is number => typeof v === 'number');
      return [f, vs.length ? Math.round(vs.reduce((s, v) => s + v, 0)) : null];
    })),
  };
});
// A region's poverty from regionMeasures (population-weighted) is the same figure as poor ÷ population above.
for (const r of budgetRegions) check(Math.abs((r.values.poverty ?? 0) - r.poverty_2023) < 0.01, `${r.key}: region poverty two ways`);
check(Math.abs((budgetRegions.find((r) => r.key === 'NCR')!.values.population ?? 0) - budgetRegions.find((r) => r.key === 'NCR')!.population_2024) < 1, 'NCR population as an indicator = its areas');
check(budgetRegions.filter((r) => ['V', 'X', 'XI'].includes(r.key)).every((r) => r.values['aged-60'] == null), 'Bicol, X, XI: no 60-and-over figure (PSA age table)');
for (const r of budgetRegions) {
  check(r.areas.length > 0, `${r.key} has areas`);
  if (r.poverty_2023_psa != null) check(Math.abs(r.poverty_2023 - r.poverty_2023_psa) <= 0.35, `${r.key}: provinces' poverty ${r.poverty_2023} within 0.35 pts of PSA's ${r.poverty_2023_psa}`);
}
check(budgetRegions.reduce((s, r) => s + r.population_2024, 0) === nationalPop - 1708, 'regions add up to the areas');

if (failures.length) {
  console.error(`build-indicators: ${failures.length} check(s) failed:\n  ` + failures.join('\n  '));
  process.exit(1);
}

// ---- write ----
mkdirSync(OUT, { recursive: true });
const csvCols = ['area_id', 'area', 'region', ...INDICATORS.map((d) => d.id), 'poverty_cv'];
const esc = (v: unknown) => (v == null ? '' : typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : String(v));
const csv = [csvCols.join(','), ...areas.map((a) => [a.id, a.name, a.region, ...indicators.map((i) => i.values[a.id]), indicators.find((i) => i.id === 'poverty')!.cv![a.id]].map(esc).join(','))].join('\n') + '\n';
const csvSha = createHash('sha256').update(csv).digest('hex');
let commit: string | null;
try { commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch { commit = null; }

const file: IndicatorsFile = {
  schema: 1, built_at: new Date().toISOString(), source_commit: commit, areas, indicators, sources,
  notes: [
    'Areas are the provinces and districts PSA publishes poverty for: a province includes its highly urbanized cities, and Metro Manila is its four districts.',
    'Each figure is the latest PSA has published for every province; its year is in its title.',
    'Colours only order the areas from lowest to highest. They do not mean good or bad.',
  ],
  csv: { path: INDICATORS_CSV_PATH, bytes: Buffer.byteLength(csv), sha256: csvSha },
};
const json = JSON.stringify(file);
writeFileSync(`${OUT}/indicators.json`, json);
writeFileSync(`${OUT}/indicators.csv`, csv);

const departments = [...depts.values()].sort((a, b) => (a.id === 'all' ? -1 : b.id === 'all' ? 1 : b.regional['2027'] - a.regional['2027']));
// Every peso: the 18 regions, then the central offices and the nationwide items, which add up to the total.
const rcsvCols = ['budget', 'department_id', 'department', 'region', 'region_name', 'budget_php', 'share_of_whole_budget', 'population_2024', 'poor_2023', 'poverty_2023', 'php_per_person', 'php_per_poor_person'];
const rcsvRows: string[] = [rcsvCols.join(',')];
for (const y of BUDGET_YEARS) for (const d of departments) {
  const whole = d.total[y.key];
  const sh = (php: number) => (whole ? ((100 * php) / whole).toFixed(4) : '');
  for (const r of budgetRegions) {
    const php = budget[y.key][d.id]?.[r.key] ?? 0;
    rcsvRows.push([y.label, d.id, d.short, r.key, r.plain, Math.round(php), sh(php), r.population_2024, r.poor_2023, r.poverty_2023, (php / r.population_2024).toFixed(2), (php / r.poor_2023).toFixed(2)].map(esc).join(','));
  }
  for (const [key, name, php] of [['central', CENTRAL_LABEL, d.central[y.key]], ['nationwide', NATIONWIDE_LABEL, d.nationwide[y.key]]] as const) {
    rcsvRows.push([y.label, d.id, d.short, key, name, Math.round(php), sh(php), '', '', '', '', ''].map(esc).join(','));
  }
}
const rcsv = rcsvRows.join('\n') + '\n';
const regionFile: RegionBudgetFile = {
  schema: 1, built_at: file.built_at, source_commit: commit, regions: budgetRegions, departments, budget,
  csv: { path: REGION_BUDGET_CSV_PATH, bytes: Buffer.byteLength(rcsv), sha256: createHash('sha256').update(rcsv).digest('hex') },
  notes: [
    'A budget line belongs to a region when DBM codes it there: the region of the office that manages it.',
    HOUSE_BILL_NOTE,
    'Central offices, bureaus and national units that DBM codes to NCR are counted as national, not as Metro Manila’s.',
    'BARMM’s own budget lines (its annual block grant, its share in national taxes and its Special Development Fund) are counted in BARMM, though DBM codes most of them nationwide. BARMM runs its own education, health and public works, so national departments spend little there.',
    'Other nationwide items (DBM region 00) are in no region: the NTA to local governments (₱1.32 trillion in the 2027 NEP), debt service and other automatic appropriations.',
    'Poor people are each province’s 2023 poverty incidence times its 2024 population, added up by today’s regions (Sulu in Region IX).',
  ],
};
const rjson = JSON.stringify(regionFile);
writeFileSync(`${OUT}/regions.json`, rjson);
writeFileSync(`${OUT}/regions.csv`, rcsv);
console.log(`wrote ${OUT}/regions.json (${(rjson.length / 1024).toFixed(0)} KB), regions.csv: ${budgetRegions.length} regions × ${departments.length} departments × ${YEARS.length} budgets`);
for (const y of YEARS) console.log(`  ${y}: total ₱${(all.total[y] / 1e9).toFixed(1)}B; regions ₱${(all.regional[y] / 1e9).toFixed(1)}B; NCR national ₱${(all.central[y] / 1e9).toFixed(1)}B; nationwide ₱${(all.nationwide[y] / 1e9).toFixed(1)}B`);
console.log(`wrote ${OUT}/indicators.json (${(json.length / 1024).toFixed(0)} KB) and indicators.csv (${(csv.length / 1024).toFixed(0)} KB): ${areas.length} areas × ${indicators.length} indicators`);
for (const i of indicators) {
  const def = INDICATORS.find((d) => d.id === i.id)!;
  console.log(`  ${i.id.padEnd(30)} ${String(i.coverage.areas).padStart(2)} areas  ${def.overall.padEnd(8)} ${i.overall.value}`);
}

if (upload) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const accountId = process.env.R2_ACCOUNT_ID, accessKeyId = process.env.R2_ACCESS_KEY_ID, secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) throw new Error('Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY to upload.');
  const s3 = new S3Client({ region: 'auto', endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } });
  // The CSV first: the JSON names its checksum.
  for (const [Key, body, type, disposition] of [
    [INDICATORS_CSV_PATH, csv, 'text/csv; charset=utf-8', `attachment; filename="bettergov-indicators-by-province.csv"`],
    [INDICATORS_DATA_PATH, json, 'application/json; charset=utf-8', undefined],
    [REGION_BUDGET_CSV_PATH, rcsv, 'text/csv; charset=utf-8', `attachment; filename="bettergov-budget-and-poverty-by-region.csv"`],
    [REGION_BUDGET_PATH, rjson, 'application/json; charset=utf-8', undefined],
  ] as const) {
    await s3.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET || 'budget', Key, Body: body, ContentType: type, CacheControl: 'public, max-age=300', ContentDisposition: disposition }));
    const sha = createHash('sha256').update(body).digest('hex');
    const r = await fetch(`${PUBLIC}/${Key}?v=${sha.slice(0, 12)}`, { cache: 'no-store' });
    const back = createHash('sha256').update(await r.text()).digest('hex');
    console.log(`uploaded ${Key}: HTTP ${r.status}, sha256 ${back === sha ? 'matches' : 'DIFFERS'}`);
  }
}
