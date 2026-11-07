/**
 * Roads and bridges, every budget (`/hgab/2027/roads`, DPWH menu). Jason (2026-11-07): "how do we do the same for road,
 * highway, and similar projects", then "We need a roads page to browse the road projects".
 *
 * Data: `roads/` (npm run build:hgab-roads, then npm run draw:hgab-roads; docs/hgab-roads.md). One file of lines per
 * budget (`lines-<key>.json`, the multi-purpose map's format with road columns) and one of lines drawn along
 * OpenStreetMap roads (`geom-<key>.json`, ODbL), loaded when the budget is picked; `summary.json` holds the totals.
 * Pure: no runtime imports beyond types and the shared source-link helper.
 */
import type { RegionKey } from './hgab';
import { lineSource, type LineSource } from './hgab-mpb-years';

export const ROADS_ROOT = '/hgab/2027/roads';
export const ROADS_TITLE = 'Roads and bridges';
const BASE = 'hgab/2027/roads';
export const ROADS_SUMMARY_PATH = `${BASE}/summary.json`;
export const ROADS_DRAW_SUMMARY_PATH = `${BASE}/draw-summary.json`;
export const roadsLinesPath = (key: string) => `${BASE}/lines-${key}.json`;
export const roadsGeomPath = (key: string) => `${BASE}/geom-${key}.json`;
export const ROADS_CSV_PATH = `${BASE}/lines.csv`;
export const ROADS_CSV_NAME = 'bettergov-dpwh-roads-and-bridges-2015-2027.csv';
/** The full CSV's path, versioned by its checksum: the data host caches CSV for hours. */
export const roadsCsvPath = (s: Pick<RoadsSummary, 'outputs'>) => `${ROADS_CSV_PATH}?v=${s.outputs['lines.csv'].sha256.slice(0, 12)}`;

export type RoadPart = 'drainage' | 'national' | 'bridges' | 'access' | 'road_fund' | 'bip' | 'sipag' | 'local' | 'ppp' | 'former';
/** `stations`: the page's own, for a line whose stations DPWH contracts on the same road placed (draw.py `anchored`): it sits at
 * the middle of its stretch, ahead of the place its title names (Jason, 2026-11-07: the contracts come first). */
export type RoadLevel = 'contract' | 'stations' | 'gps' | 'barangay' | 'municipality' | 'city' | 'province' | 'deo' | 'region' | 'none';
export type RoadFlag =
  | 'gps_not_drawn' | 'gps_district_differs' | 'office_elsewhere' | 'maguindanao_successor' | 'text_repaired'
  | 'gps_wider_reader' | 'contract_region_differs' | 'stations_review' | 'several_offices' | 'stretch_differs';

/** Short names for the parts, for chips and the list (summary.json `parts` has the full ones). */
export const PART_SHORT: Record<RoadPart, string> = {
  national: 'National roads',
  drainage: 'Drainage along national roads',
  bridges: 'Bridges',
  access: 'Access roads',
  road_fund: 'Special Road Fund',
  bip: 'BIP roads and bridges',
  sipag: 'SIPAG roads and bridges',
  local: 'Local Program roads and bridges',
  ppp: 'Toll expressways (partnership support)',
  former: 'Roads and bridges (former codes)',
};

export const LEVEL_TEXT: Record<RoadLevel, string> = {
  contract: 'DPWH contract’s point',
  stations: 'Its stations on the road',
  gps: 'GPS in the title',
  barangay: 'Barangay named in the title',
  municipality: 'Town named in the title',
  city: 'City named in the title',
  province: 'Province named in the title',
  deo: 'Area of the DPWH office',
  region: 'Region',
  none: 'Not placed',
};

export const FLAG_TEXT: Partial<Record<RoadFlag, string>> = {
  contract_region_differs: 'The contract’s point is in another region than the line’s DPWH office.',
  stations_review: 'A station range in the title reads oddly (metres past 999, reversed, or over 30 km).',
  several_offices: 'The budget splits this line over several DPWH offices; it is listed under the largest.',
  stretch_differs: 'In both documents at the same amount, but the House bill lists another stretch of the road.',
  office_elsewhere: 'The place the title names lies outside the DPWH office’s area.',
  gps_district_differs: 'The point lies in another legislative district than the place the title names.',
};

export interface RoadsBudget {
  key: string;
  fy: number;
  stage: 'gaa' | 'nep' | 'house';
  note?: 'former_codes';
  lines: number;
  php: number;
  source: string;
  parts: Array<{ key: RoadPart; label: string; lines: number; php: number }>;
  levels: Record<RoadLevel, number>;
  contracts: { linked: number; placed: number };
  stations: { lines: number; length_m: number; review: number };
  classes: Record<string, number>;
  road_titled_elsewhere: { lines: number; php: number };
}

export interface RoadsSummary {
  schema: 1;
  built_at: string;
  parts: Array<{ key: RoadPart; label: string; codes: string[] }>;
  budgets: RoadsBudget[];
  checks: Array<{ key: string; ok: boolean; detail: string }>;
  outputs: Record<string, { sha256: string; bytes: number }>;
}

export interface RoadsDrawSummary {
  built_at: string;
  osm: { extract: string; downloaded: string; license: string; attribution: string };
  budgets: Array<{ key: string; eligible?: number; drawn?: number; scattered?: number; no_road?: number } & Record<string, number | string>>;
}

export interface RoadsLinesFile {
  schema: 1;
  built_at: string;
  budget: { key: string; fy: number; stage: 'gaa' | 'nep' | 'house' };
  levels: RoadLevel[];
  bases: Array<string | null>;
  parts: RoadPart[];
  classes: Array<string | null>;
  flag_bits: Record<RoadFlag, number>;
  regions: RegionKey[];
  districts: Array<[string, string, number]>;
  offices: string[];
  paps: string[];
  /** [key, level index, label, lng, lat, region index, district indexes] */
  places: Array<[string, number, string, number, number, number, number[]]>;
  cols: string[];
  rows: unknown[][];
}

export interface RoadsGeomFile {
  schema: 1 | 2;
  budget: string;
  license: string;
  attribution: string;
  /**
   * [line id, how, confidence, stretches]. How: `anchored` (its stations, from DPWH contracts on the same road used as
   * kilometre posts), `stations` (from OpenStreetMap's kilometre posts), `centred` (its length, centred on its own point).
   */
  rows: Array<[string, RoadDrawHow, 'named' | 'class', Array<Array<[number, number]>>, ([number, number] | null)?, (string | null)?, (RegionKey | null)?]>;
}

export type RoadDrawHow = 'anchored' | 'stations' | 'centred';

export interface RoadPlace { key: string; level: RoadLevel; label: string; lng: number; lat: number }

export interface RoadLine {
  i: number;
  /** The budget the line is in (`gaa-2025`, `house-2027`), and an id unique across budgets (`<budget>:<i>`). */
  budget: string;
  uid: string;
  /** `gaa:<fy>:<UACS code>` for the enacted budgets, the comparison row id for 2027. */
  id: string;
  fy: number;
  code: string | null;
  title: string;
  office: string | null;
  pap: string;
  part: RoadPart;
  level: RoadLevel;
  place: RoadPlace | null;
  district: { id: string; label: string } | null;
  region: RegionKey | null;
  flags: RoadFlag[];
  amount: number;
  pts: Array<[number, number]> | null;
  contract: string | null;
  contractor: string | null;
  stations: Array<[number, number]> | null;
  lengthM: number | null;
  sections: string[] | null;
  cls: 'house_only' | 'nep_only' | 'paired' | null;
  gaaPage: number | null;
  /** Where the map draws it: the point, else the place's anchor; null when not placed. */
  at: [number, number] | null;
  search: string;
}

export interface RoadsData { budget: RoadsLinesFile['budget']; lines: RoadLine[]; districts: Map<string, string> }

export function decodeRoadLines(f: RoadsLinesFile): RoadsData {
  const c = Object.fromEntries(f.cols.map((k, i) => [k, i])) as Record<string, number>;
  const at = (row: unknown[], k: string) => (c[k] != null && row.length > c[k] ? row[c[k]] : null);
  const places: RoadPlace[] = f.places.map(([key, level, label, lng, lat]) => ({ key, level: f.levels[level], label, lng, lat }));
  const stage = f.budget.stage;
  const lines = f.rows.map((row, i): RoadLine => {
    const fy = at(row, 'fy') as number;
    const raw = String(at(row, 'id'));
    const office = at(row, 'office') as number | null;
    const place = at(row, 'place') as number | null;
    const district = at(row, 'district') as number | null;
    const region = at(row, 'region') as number | null;
    const bits = (at(row, 'flags') as number | null) ?? 0;
    const cls = at(row, 'class') as number | null;
    const pts = at(row, 'pts') as Array<[number, number]> | null;
    const p = place != null && place >= 0 ? places[place] : null;
    const title = at(row, 'title') as string;
    const officeName = office != null && office >= 0 ? f.offices[office] : null;
    const contract = at(row, 'contract') as string | null;
    const contractor = at(row, 'contractor') as string | null;
    const d = district != null && district >= 0 ? f.districts[district] : null;
    return {
      i,
      budget: f.budget.key,
      uid: `${f.budget.key}:${i}`,
      id: fy < 2027 ? `gaa:${fy}:${raw}` : raw,
      fy,
      code: fy < 2027 ? raw : null,
      title,
      office: officeName,
      pap: f.paps[at(row, 'pap') as number],
      part: f.parts[at(row, 'part') as number],
      level: f.levels[at(row, 'level') as number],
      place: p,
      district: d ? { id: d[0], label: d[1] } : null,
      region: region != null && region >= 0 ? f.regions[region] : null,
      flags: (Object.keys(f.flag_bits) as RoadFlag[]).filter((k) => bits & f.flag_bits[k]),
      amount: ((stage === 'gaa' ? at(row, 'gaa_php') : stage === 'nep' ? at(row, 'nep_php') : at(row, 'house_php')) as number | null) ?? 0,
      pts,
      contract,
      contractor,
      stations: at(row, 'stations') as Array<[number, number]> | null,
      lengthM: at(row, 'length_m') as number | null,
      sections: at(row, 'sections') as string[] | null,
      cls: cls == null ? null : (f.classes[cls] as RoadLine['cls']),
      gaaPage: at(row, 'gaa_page') as number | null,
      at: pts?.[0] ?? (p ? [p.lng, p.lat] : null),
      search: [title, p?.label, officeName, contract, contractor, d?.[1]].filter(Boolean).join(' ').toLowerCase(),
    };
  });
  return { budget: f.budget, lines, districts: new Map(f.districts.map(([id, label]) => [id, label])) };
}

/**
 * Where a line sits, first that works (Jason, 2026-11-07: "Contract coordinates first, then title then the others", then
 * the drawn stations before the title's place): its own DPWH contract's point; its stations, placed by DPWH contracts on
 * the same road (`anchored`: the middle of its stretch, with that stretch's district and region); GPS in its title; the
 * place its title names; its office's area; its region. The build places by the rest; this moves anchored lines.
 */
export const BEFORE_STATIONS: ReadonlySet<RoadLevel> = new Set(['contract', 'gps']);
export function placeByStations(data: RoadsData, geom: ReturnType<typeof decodeRoadGeom>): void {
  for (const l of data.lines) {
    const g = geom.get(l.id);
    if (!g || g.how !== 'anchored' || !g.middle || BEFORE_STATIONS.has(l.level)) continue;
    l.level = 'stations';
    l.at = g.middle;
    l.place = null;
    if (g.region) l.region = g.region;
    if (g.district) l.district = { id: g.district, label: data.districts.get(g.district) ?? g.district };
  }
}

/** Each drawn line's stretches, by line id. */
export interface RoadGeom {
  how: RoadDrawHow;
  conf: 'named' | 'class';
  coords: Array<Array<[number, number]>>;
  /** The middle of the longest stretch, its legislative district and region (schema 2). */
  middle: [number, number] | null;
  district: string | null;
  region: RegionKey | null;
}
export function decodeRoadGeom(f: RoadsGeomFile): Map<string, RoadGeom> {
  return new Map(f.rows.map(([id, how, conf, coords, middle, district, region]) =>
    [id, { how, conf, coords, middle: middle ?? null, district: district ?? null, region: region ?? null }]));
}

/** Where the budget prints the line: as the multi-purpose map links its lines (lineSource). */
export const roadSource = (l: RoadLine): LineSource | null => lineSource(l);

/** Every year the page offers; 2027 is the NEP or the House bill, never both. */
export const ROADS_YEARS = Array.from({ length: 13 }, (_, k) => 2015 + k);
export type Stage2027 = 'house' | 'nep';
export const roadsBudgetKey = (fy: number, stage: Stage2027) => (fy < 2027 ? `gaa-${fy}` : `${stage}-2027`);

export const budgetLabel = (b: { fy: number; stage: string }) =>
  b.stage === 'gaa' ? `${b.fy} GAA` : b.stage === 'nep' ? '2027 NEP' : '2027 House bill';

/** "820 m", "1.4 km", "12 km". */
export function lengthText(m: number | null | undefined): string {
  if (m == null) return '—';
  if (m < 1000) return `${m.toLocaleString('en-US')} m`;
  return `${(m / 1000).toLocaleString('en-US', { maximumFractionDigits: m < 10_000 ? 1 : 0 })} km`;
}

/** "K0029+690 – K0031+087" for one range. */
export function stationText([a, b]: [number, number]): string {
  const k = (m: number) => `K${String(Math.floor(m / 1000)).padStart(4, '0')}+${String(Math.abs(m % 1000)).padStart(3, '0')}`;
  return `${k(a)} – ${k(b)}`;
}

export interface RoadFilters { q: string; part: RoadPart | ''; region: RegionKey | ''; length: boolean; drawn: boolean }
export type RoadSort = 'amount' | 'length' | 'title';

/** `drawn`: the uids of the lines drawn along a road. */
export function filterRoads(lines: readonly RoadLine[], f: RoadFilters, drawn: ReadonlySet<string> | null): RoadLine[] {
  const words = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return lines.filter((l) => (!f.part || l.part === f.part) && (!f.region || l.region === f.region)
    && (!f.length || l.lengthM != null) && (!f.drawn || (drawn?.has(l.uid) ?? false))
    && words.every((w) => l.search.includes(w)));
}

export function sortRoads(lines: RoadLine[], sort: RoadSort): RoadLine[] {
  const by = sort === 'title' ? (a: RoadLine, b: RoadLine) => a.title.localeCompare(b.title)
    : sort === 'length' ? (a: RoadLine, b: RoadLine) => (b.lengthM ?? -1) - (a.lengthM ?? -1) || b.amount - a.amount
      : (a: RoadLine, b: RoadLine) => b.amount - a.amount || a.title.localeCompare(b.title);
  return [...lines].sort(by);
}
