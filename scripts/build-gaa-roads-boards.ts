/**
 * Road and bridge leaderboards (`/gaa/roads/leaderboards`): data/gaa/roads/boards.json, repeats.json, regions.json and
 * repeats.csv, from the roads build's lines and drawings.
 *
 *   npm run build:gaa-roads          # the lines (docs/gaa-roads.md)
 *   npm run draw:gaa-roads           # the lines drawn along OpenStreetMap roads
 *   npm run build:gaa-roads-boards   # this script
 *
 * Jason (2026-11-23): "Create me leaderboard for our roads": by type, by region, by contractor, and ranked by how many
 * times a project has been funded. Enacted budgets only, FY2015–FY2026: the 2027 bill funds nothing yet.
 *
 * Regions. DBM's extract gives every Central Office line the head office's own region code (13, NCR), so the roads build
 * put each head-office line whose title names no place in NCR (about ₱787B). Here such a line takes the region of the
 * same road's other lines (those placed by a contract's point, GPS, a place in the title or a district office): the one
 * region they share, else the region of the nearest station on that road within 15 km, else none. regions.json carries
 * those reads, so the roads page filters by the same regions.
 *
 * Funded again: the same title in the same region in two budgets or more. Case, accents, punctuation, GPS and the
 * spellings Rd/Road, Br/Bridge, Sn/San, Sta/Santa, Sto/Santo, Jct/Junction, Natl/National, Hwy/Highway and Brgy/Barangay
 * are set aside; phases and station ranges stay, as another phase or stretch is another project.
 *
 * Contractors: lines linked to a DPWH contract (FY2020–FY2026; data/dpwh-contracts). A joint venture's line counts in
 * full for each partner, as on the contractor pages. The kept rows are the top 500 over all years and the top 300 of
 * each year; `count` has every contractor.
 *
 * Contract: src/lib/gaa-roads.ts (RoadsBoardsFile, RoadsRepeatsFile, RoadsRegionsFile). The build stops on any failed check.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  ROADS_YEARS, decodeRoadGeom, decodeRoadLines, placeByStations,
  type ByYear, type RoadLine, type RoadPart, type RoadRepeatLine, type RoadsBoardsFile, type RoadsGeomFile, type RoadsLinesFile,
  type RoadsRegionsFile, type RoadsRepeatsFile, type RoadsSummary,
} from '../src/lib/gaa-roads';
import type { RegionKey } from '../src/lib/hgab';

const DATA = process.argv.find((a) => a.startsWith('--data='))?.slice(7) ?? 'data';
const OUT = `${DATA}/gaa/roads`;
const read = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
const checks: RoadsBoardsFile['checks'] = [];
const check = (key: string, ok: boolean, detail: string) => checks.push({ key, ok, detail });

const YEARS = ROADS_YEARS.filter((y) => y < 2027);
const CONTRACT_YEARS = YEARS.filter((y) => y >= 2020);
const HEAD_OFFICE = 'Central Office';
const NAMES_NCR = /\b(?:NCR|National Capital Region|Metro Manila)\b/i;
const NEAR_M = 15_000;
const KEEP_ALL = 500;
const KEEP_YEAR = 300;
const MIN_BUDGETS_KEPT = 3;

const zeros = (n: number): ByYear => Array.from({ length: n }, () => 0);
const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);

// ---- the lines, placed as the roads page places them ----
const summary = read<RoadsSummary>(`${OUT}/summary.json`);
const lines: RoadLine[] = [];
for (const fy of YEARS) {
  const key = `gaa-${fy}`;
  const data = decodeRoadLines(read<RoadsLinesFile>(`${OUT}/lines-${key}.json`));
  let geom: RoadsGeomFile | null;
  try { geom = read<RoadsGeomFile>(`${OUT}/geom-${key}.json`); } catch { geom = null; }
  placeByStations(data, geom ? decodeRoadGeom(geom) : new Map());
  lines.push(...data.lines);
}
const yi = (fy: number) => YEARS.indexOf(fy);
const ci = (fy: number) => CONTRACT_YEARS.indexOf(fy);
for (const fy of YEARS) {
  const b = summary.budgets.find((x) => x.key === `gaa-${fy}`);
  const mine = lines.filter((l) => l.fy === fy);
  check(`lines_${fy}`, !!b && b.lines === mine.length && b.php === sum(mine.map((l) => l.amount)),
    `FY${fy}: ${mine.length} lines, ₱${sum(mine.map((l) => l.amount))} (summary: ${b?.lines} lines, ₱${b?.php})`);
}

// ---- spellings set aside, for road names and project titles ----
const SPELLINGS: Array<[RegExp, string]> = [
  [/\brd\b/g, 'road'], [/\bbr\b/g, 'bridge'], [/\bsn\b/g, 'san'], [/\bsta\b/g, 'santa'], [/\bsto\b/g, 'santo'],
  [/\bjct\b/g, 'junction'], [/\bnat ?l\b/g, 'national'], [/\bhi way\b|\bhwy\b/g, 'highway'], [/\bb(?:r)?gy\b/g, 'barangay'],
];
function plain(s: string): string {
  let t = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const [re, to] of SPELLINGS) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}
const GPS = /\(?\s*-?\d{1,3}\.\d{3,}\s*[°˚º]?\s*[nsew]?\s*[,;/ ]\s*-?\d{1,3}\.\d{3,}\s*[°˚º]?\s*[nsew]?\s*\)?/gi;
/** The same-project key: the title, spellings set aside (see the header). */
const projectKey = (title: string) => plain(title.replace(GPS, ' '));

const STATION = /\bK\s*-?\s*\d{1,4}\s*\+|\bSta\.?\s*\d/i;
const ROAD_IDS = /\b[BS]\d{5}[A-Z]{2}\b/g;
/** The road a title names: before its first station, after "along" and a leading "work:" label; with and without brackets. */
function roadKeys(title: string): [string, string] {
  const t = title.replace(ROAD_IDS, ' ');
  const m = STATION.exec(t);
  let head = m ? t.slice(0, m.index) : t;
  const along = head.split(/\balong\b/i);
  head = along[along.length - 1];
  const colon = head.indexOf(':');
  if (colon >= 0) head = head.slice(colon + 1);
  return [plain(head), plain(head.replace(/\([^)]*\)/g, ' '))];
}
const middle = (l: RoadLine) => {
  if (!l.stations?.length) return null;
  const m = l.stations.flat();
  return (Math.min(...m) + Math.max(...m)) / 2;
};

// ---- regions: the head-office lines DBM's code put in NCR ----
const headOffice = (l: RoadLine) => l.office === HEAD_OFFICE && l.level === 'region' && l.region === 'NCR' && !NAMES_NCR.test(l.title);
const known = lines.filter((l) => l.region && !headOffice(l) && l.level !== 'region' && l.level !== 'none');
const byRoad: [Map<string, RoadLine[]>, Map<string, RoadLine[]>] = [new Map(), new Map()];
for (const l of known) {
  const keys = roadKeys(l.title);
  for (const i of [0, 1] as const) {
    if (keys[i].length < 6) continue;
    const g = byRoad[i].get(keys[i]);
    if (g) g.push(l); else byRoad[i].set(keys[i], [l]);
  }
}
function regionOfRoad(l: RoadLine): RegionKey | null {
  const keys = roadKeys(l.title);
  for (const i of [0, 1] as const) {
    const on = keys[i].length >= 6 ? byRoad[i].get(keys[i]) : undefined;
    if (!on) continue;
    const regions = new Set(on.map((x) => x.region));
    if (regions.size === 1) return on[0].region;
    const mid = middle(l);
    if (mid != null) {
      const near = on.map((x) => ({ x, d: (() => { const m = middle(x); return m == null ? Infinity : Math.abs(m - mid); })() }))
        .sort((a, b) => a.d - b.d)[0];
      if (near && near.d <= NEAR_M) return near.x.region;
    }
    return null; // the road crosses regions and no station on it is near
  }
  return null;
}
const reads: RoadsRegionsFile['lines'] = {};
const fromRoad = new Set<string>();
const fix = { lines: 0, php: 0, road_lines: 0, road_php: 0 };
for (const l of lines) {
  if (!headOffice(l)) continue;
  const region = regionOfRoad(l);
  (reads[l.budget] ??= {})[l.code!] = region;
  fix.lines += 1;
  fix.php += l.amount;
  if (region) {
    fix.road_lines += 1;
    fix.road_php += l.amount;
    fromRoad.add(l.uid);
  }
  l.region = region;
}
check('region_fix', fix.lines > 0 && fix.road_lines <= fix.lines, `${fix.lines} head-office lines (₱${fix.php}) re-read; ${fix.road_lines} (₱${fix.road_php}) from the same road`);
check('no_fallback_left', lines.filter(headOffice).every((l) => reads[l.budget]?.[l.code!] === 'NCR'),
  'every head-office line still in NCR is there because its road is');

// ---- by type: each part and its programs ----
const tidyProgram = (s: string) => s.replace(/\b(By|Off|Public) - (\w)/g, '$1-$2').replace(/\s+/g, ' ').trim();
type Tally = { php: ByYear; lines: ByYear };
const tally = (n = YEARS.length): Tally => ({ php: zeros(n), lines: zeros(n) });
const add = (t: Tally, i: number, php: number) => { t.php[i] += php; t.lines[i] += 1; };
const parts = new Map<RoadPart, Tally & { programs: Map<string, Tally & { spellings: Map<string, number> }> }>();
for (const l of lines) {
  const p = parts.get(l.part) ?? { ...tally(), programs: new Map() };
  parts.set(l.part, p);
  add(p, yi(l.fy), l.amount);
  const label = tidyProgram(l.pap);
  const k = label.toLowerCase();
  const g = p.programs.get(k) ?? { ...tally(), spellings: new Map() };
  p.programs.set(k, g);
  add(g, yi(l.fy), l.amount);
  g.spellings.set(label, (g.spellings.get(label) ?? 0) + 1);
}
const types: RoadsBoardsFile['types'] = [...parts].map(([part, t]) => ({
  part, php: t.php, lines: t.lines,
  programs: [...t.programs.values()]
    .map((g) => ({ label: [...g.spellings].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0], php: g.php, lines: g.lines }))
    .sort((a, b) => sum(b.php) - sum(a.php) || a.label.localeCompare(b.label)),
})).sort((a, b) => sum(b.php) - sum(a.php));
const totals = tally();
for (const l of lines) add(totals, yi(l.fy), l.amount);
YEARS.forEach((fy, i) => {
  check(`types_${fy}`, sum(types.map((t) => t.php[i])) === totals.php[i] && types.every((t) => sum(t.programs.map((g) => g.php[i])) === t.php[i]),
    `FY${fy}: the parts and their programs add up to ₱${totals.php[i]}`);
});

// ---- by region ----
const regionRows = new Map<RegionKey | null, Tally & { road: Tally }>();
for (const l of lines) {
  const r = regionRows.get(l.region) ?? { ...tally(), road: tally() };
  regionRows.set(l.region, r);
  add(r, yi(l.fy), l.amount);
  if (fromRoad.has(l.uid)) add(r.road, yi(l.fy), l.amount);
}
const regions: RoadsBoardsFile['regions'] = [...regionRows].map(([region, r]) => ({
  region, php: r.php, lines: r.lines, road_php: r.road.php, road_lines: r.road.lines,
})).sort((a, b) => (a.region == null ? 1 : 0) - (b.region == null ? 1 : 0) || sum(b.php) - sum(a.php));
YEARS.forEach((fy, i) => {
  check(`regions_${fy}`, sum(regions.map((r) => r.php[i])) === totals.php[i] && sum(regions.map((r) => r.lines[i])) === totals.lines[i],
    `FY${fy}: the regions add up to ₱${totals.php[i]} in ${totals.lines[i]} lines`);
});

// ---- by contractor ----
interface IndexFile { cols: string[]; rows: unknown[][] }
const index = read<IndexFile>(`${DATA}/hgab/2027/contractors/index.json`);
const col = (k: string) => index.cols.indexOf(k);
const keyOfName = new Map<string, string>();
for (const row of index.rows) {
  const key = String(row[col('key')]);
  for (const n of [row[col('name')] as string, ...((row[col('aliases')] as string[] | null) ?? [])]) {
    if (n && !keyOfName.has(plain(n))) keyOfName.set(plain(n), key);
  }
}
const linked = tally(CONTRACT_YEARS.length);
type Who = Tally & { jv: Tally };
const who = new Map<string, Who>();
let linkedNoName = 0;
for (const l of lines) {
  if (!CONTRACT_YEARS.includes(l.fy) || !l.contract) continue;
  const i = ci(l.fy);
  add(linked, i, l.amount);
  const partners = [...new Set((l.contractor ?? '').split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean))];
  if (!partners.length) linkedNoName += 1;
  for (const name of partners) {
    const w = who.get(name) ?? { ...tally(CONTRACT_YEARS.length), jv: tally(CONTRACT_YEARS.length) };
    who.set(name, w);
    add(w, i, l.amount);
    if (partners.length > 1) add(w.jv, i, l.amount);
  }
}
check('contracts_linked', CONTRACT_YEARS.every((fy) => {
  const b = summary.budgets.find((x) => x.key === `gaa-${fy}`);
  return b?.contracts.linked === linked.lines[ci(fy)];
}), `lines linked to a DPWH contract match the roads summary in FY${CONTRACT_YEARS[0]}–FY${CONTRACT_YEARS.at(-1)}`);
check('contracts_named', linkedNoName === 0, `${linkedNoName} linked lines without a contractor's name`);
const ranked = (score: (w: Who) => number) => [...who].filter(([, w]) => score(w) > 0).sort((a, b) => score(b[1]) - score(a[1]) || a[0].localeCompare(b[0]));
const kept = new Set<string>(ranked((w) => sum(w.php)).slice(0, KEEP_ALL).map(([n]) => n));
CONTRACT_YEARS.forEach((_, i) => { for (const [n] of ranked((w) => w.php[i]).slice(0, KEEP_YEAR)) kept.add(n); });
let matched = 0;
const contractorRows = [...kept].map((name) => {
  const w = who.get(name)!;
  const key = keyOfName.get(plain(name)) ?? null;
  if (key) matched += 1;
  return { name, key, php: w.php, lines: w.lines, jv_php: w.jv.php, jv_lines: w.jv.lines };
}).sort((a, b) => sum(b.php) - sum(a.php) || a.name.localeCompare(b.name));
check('contractors_keyed', matched / contractorRows.length > 0.9, `${matched} of ${contractorRows.length} kept contractors match a contractor page`);
const contractors: RoadsBoardsFile['contractors'] = {
  linked,
  count: CONTRACT_YEARS.map((_, i) => [...who.values()].filter((w) => w.lines[i] > 0).length),
  count_all: who.size,
  kept: { all: KEEP_ALL, year: KEEP_YEAR },
  rows: contractorRows,
};

// ---- funded again: the same title in the same region, in two budgets or more ----
const projects = new Map<string, RoadLine[]>();
for (const l of lines) {
  const k = `${projectKey(l.title)}|${l.region ?? '-'}`;
  const g = projects.get(k);
  if (g) g.push(l); else projects.set(k, [l]);
}
const budgetsOf = (ls: readonly RoadLine[]) => new Set(ls.map((l) => l.fy)).size;
const again = [...projects.values()].filter((ls) => budgetsOf(ls) >= 2)
  .map((ls) => ls.sort((a, b) => a.fy - b.fy || a.id.localeCompare(b.id)))
  .sort((a, b) => budgetsOf(b) - budgetsOf(a) || b.length - a.length
    || sum(b.map((l) => l.amount)) - sum(a.map((l) => l.amount)) || a[a.length - 1].title.localeCompare(b[b.length - 1].title));
const byBudgets = new Map<number, { budgets: number; groups: number; lines: number; php: number }>();
for (const ls of again) {
  const n = budgetsOf(ls);
  const r = byBudgets.get(n) ?? { budgets: n, groups: 0, lines: 0, php: 0 };
  byBudgets.set(n, r);
  r.groups += 1;
  r.lines += ls.length;
  r.php += sum(ls.map((l) => l.amount));
}
const repeats: RoadsBoardsFile['repeats'] = {
  groups: again.length,
  lines: sum(again.map((ls) => ls.length)),
  php: sum(again.map((ls) => sum(ls.map((l) => l.amount)))),
  by_budgets: [...byBudgets.values()].sort((a, b) => b.budgets - a.budgets),
};
check('repeats', again.every((ls) => budgetsOf(ls) >= 2 && new Set(ls.map((l) => l.region)).size === 1) && repeats.lines <= lines.length,
  `${repeats.groups} projects funded in two budgets or more, ${repeats.lines} lines`);

const offices: string[] = [];
const officeIx = new Map<string, number>();
const officeOf = (o: string | null) => {
  if (!o) return -1;
  if (!officeIx.has(o)) { officeIx.set(o, offices.length); offices.push(o); }
  return officeIx.get(o)!;
};
const keptGroups = again.filter((ls) => budgetsOf(ls) >= MIN_BUDGETS_KEPT);
const repeatsFile: RoadsRepeatsFile = {
  schema: 1,
  built_at: new Date().toISOString(),
  offices,
  min_budgets: MIN_BUDGETS_KEPT,
  groups: keptGroups.map((ls) => {
    const last = ls[ls.length - 1];
    return {
      title: last.title, region: last.region, part: last.part, php: sum(ls.map((l) => l.amount)),
      lines: ls.map((l): RoadRepeatLine => [l.fy, l.code ?? '', l.amount, officeOf(l.office), l.gaaPage]),
    };
  }),
};

// ---- the CSV: every project funded in two budgets or more, a row per line ----
const cell = (v: unknown) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = [
  ['rank', 'budgets_funded', 'lines_in_project', 'project_total_php', 'region', 'fiscal_year', 'uacs_code', 'title', 'gaa_php',
    'part', 'program', 'dpwh_office', 'dpwh_contract', 'contractor', 'region_from'].join(','),
  ...again.flatMap((ls, k) => {
    const total = sum(ls.map((l) => l.amount));
    return ls.map((l) => [k + 1, budgetsOf(ls), ls.length, total, l.region ?? '', l.fy, l.code, l.title, l.amount, l.part,
      tidyProgram(l.pap), l.office, l.contract, l.contractor,
      fromRoad.has(l.uid) ? 'same_road' : l.code && reads[l.budget] && l.code in reads[l.budget] ? 'none' : 'line'].map(cell).join(','));
  }),
].join('\n') + '\n';

// ---- write ----
const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.key}: ${c.detail}`);
if (failed.length) {
  console.error(`build-gaa-roads-boards: ${failed.length} check(s) failed`);
  process.exit(1);
}
const outputs: RoadsBoardsFile['outputs'] = {};
const write = (name: string, body: string) => {
  writeFileSync(`${OUT}/${name}`, body);
  outputs[name] = { sha256: createHash('sha256').update(body).digest('hex'), bytes: Buffer.byteLength(body) };
};
const regionsFile: RoadsRegionsFile = { schema: 1, built_at: repeatsFile.built_at, lines: reads };
write('repeats.json', JSON.stringify(repeatsFile));
write('regions.json', JSON.stringify(regionsFile));
write('repeats.csv', csv);
const boards: RoadsBoardsFile = {
  schema: 1,
  built_at: repeatsFile.built_at,
  years: YEARS,
  contract_years: CONTRACT_YEARS,
  totals,
  types,
  regions,
  region_fix: fix,
  contractors,
  repeats,
  checks,
  outputs,
};
writeFileSync(`${OUT}/boards.json`, JSON.stringify(boards));
const kb = (n: number) => `${Math.round(n / 1024)} KB`;
console.log(`boards.json ${kb(Buffer.byteLength(JSON.stringify(boards)))}; ${Object.entries(outputs).map(([k, v]) => `${k} ${kb(v.bytes)}`).join('; ')}`);
console.log(`types ${types.length}, regions ${regions.length}, contractors kept ${contractorRows.length} of ${who.size}, projects funded again ${again.length} (${keptGroups.length} in ${MIN_BUDGETS_KEPT}+ budgets)`);
