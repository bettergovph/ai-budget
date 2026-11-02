/**
 * Multi-purpose buildings map (`/hgab/2027/multi-purpose/map`, DPWH menu): every multi-purpose building line in
 * every budget we hold, the FY2015 to FY2026 enacted budgets (GAA), the FY2027 NEP and the House bill, on one map.
 * Earlier budgets do not list multi-purpose buildings by name (docs/hgab-mpb-years.md).
 *
 * The data is `hgab/2027/mpb-years/` (`npm run build:hgab-mpb-years`, scripts/hgab-mpb-years/):
 *
 *   lines.json         every line, compact: one array per line, with dictionaries for places, offices, PAPs and
 *                      legislative districts (MpbLinesFile)
 *   summary.json       per budget: lines, pesos, the scope rule, how lines were placed, the reconciliation with the
 *                      multi-purpose page's chart; checks; the pinned source files (MpbSummary)
 *   districts.geojson  legislative district outlines (the source's PSGC2LEG build, simplified)
 *   lines.csv          every line, every budget
 *
 * Which lines: the source workbench's MPB rule, a union. PAP: the budget's own multi-purpose building lines (BIP and
 * SIPAG from FY2022, the Local Program's before that; FY2027 BIP), the same codes as the chart on the multi-purpose
 * page, so they add up to it. Title: a title that names a multi-purpose building or hall, under any PAP.
 *
 * Where a line goes, first that works: GPS published in its title; the barangay, town, city or province its title
 * names (the map draws the centre of that place, not the site); the area of its DPWH office; its region; nowhere.
 * FY2027 placements are the source's own MPB lens.
 *
 * Pure: no React, no DOM, no MapLibre, and no import of hgab.ts (it reads import.meta.env), so scripts and the
 * Worker can use it.
 */

/** The region keys of hgab.ts's RegionKey, repeated here so this file needs nothing from hgab.ts. */
export type RegionKey =
  | 'NCR' | 'CAR' | 'I' | 'II' | 'III' | 'IV-A' | 'MIMAROPA' | 'V' | 'VI' | 'VII' | 'VIII'
  | 'IX' | 'X' | 'XI' | 'XII' | 'XIII' | 'BARMM' | 'NIR';

export const MPB_MAP_ROOT = '/hgab/2027/multi-purpose/map';
export const MPB_MAP_TITLE = 'Multi-purpose buildings map';
const BASE = 'hgab/2027/mpb-years';
export const MPB_LINES_PATH = `${BASE}/lines.json`;
export const MPB_SUMMARY_PATH = `${BASE}/summary.json`;
export const MPB_DISTRICTS_PATH = `${BASE}/districts.geojson`;
export const MPB_CSV_PATH = `${BASE}/lines.csv`;
export const MPB_CSV_NAME = 'bettergov-multi-purpose-buildings-2015-2027.csv';

export const MPB_YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027] as const;
export type MpbYear = (typeof MPB_YEARS)[number];
/** The first budget with a multi-purpose building line (FY2018, the Local Program); FY2015–FY2017 are in by title only. */
export const PAP_RULE_FROM = 2018;
/** FY2027 is shown at one stage at a time; the NEP and the House bill are compared, never added. */
export type Stage2027 = 'house' | 'nep';

export type MpbLevel = 'gps' | 'barangay' | 'municipality' | 'city' | 'province' | 'deo' | 'region' | 'none';
export type MpbBasis = 'title' | 'gps' | 'deo' | null;
export type MpbRule = 'pap' | 'title' | 'pap+title';
export type MpbClass = 'house_only' | 'nep_only' | 'paired' | null;

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export interface MpbLinesFile {
  schema: 1;
  built_at: string;
  source_commit: string;
  budgets: Array<{ key: string; fy: number; stage: 'gaa' | 'nep' | 'house' }>;
  levels: MpbLevel[];
  bases: MpbBasis[];
  rules: MpbRule[];
  classes: MpbClass[];
  flag_bits: Record<MpbFlag, number>;
  regions: RegionKey[];
  /** [id, label, region index] */
  districts: Array<[string, string, number]>;
  offices: string[];
  paps: string[];
  place_cols: string[];
  /** [key, level index, label, lng, lat, region index, district indexes] */
  places: Array<[string, number, string, number, number, number, number[]]>;
  cols: string[];
  /** One array per line in `cols` order; trailing nulls are dropped. */
  rows: unknown[][];
}

export type MpbFlag =
  | 'gps_not_drawn' | 'gps_district_differs' | 'office_elsewhere' | 'maguindanao_successor' | 'text_repaired' | 'gps_wider_reader';

export interface MpbBudgetStat {
  key: string;
  fy: number;
  stage: 'gaa' | 'nep' | 'house';
  lines: number;
  php: number;
  pap_lines: number;
  pap_php: number;
  title_only_lines: number;
  title_only_php: number;
  /** The multi-purpose page's chart for this budget (BIP + SIPAG + Local Program); equals `pap_php`. */
  history_php: number | null;
  /** Where the budget's lines come from (FY2015–FY2018 the GAA history release, FY2019 the technical GAA's text). */
  source: string;
  /** False where the budget has no multi-purpose building line (FY2015–FY2017): lines are in by title only. */
  pap_rule: boolean;
  /** Items named for multi-purpose buildings that the source lists at ₱0 (left out). */
  listed_at_zero: number;
  /** Lines whose code the source splits over more than one office (the largest is shown). */
  multi_office_lines: number;
  levels: Record<MpbLevel, number>;
  with_district: number;
  districts: number;
  flags: Record<MpbFlag, number>;
}

export interface MpbSummary {
  schema: 1;
  built_at: string;
  source: {
    repo: string;
    commit: string;
    files: Record<string, string>;
    methods: Record<string, string>;
  };
  inputs: Record<string, unknown>;
  budgets: MpbBudgetStat[];
  totals: { lines: number; places: number; gps_points: number };
  text_repairs: Record<string, number>;
  gaa_place_status: Record<string, number>;
  checks: Array<{ key: string; ok: boolean; detail: string }>;
}

// ---------------------------------------------------------------------------
// Decoded
// ---------------------------------------------------------------------------

export interface MpbPlace {
  i: number;
  key: string;
  level: MpbLevel;
  label: string;
  lng: number;
  lat: number;
  region: RegionKey | null;
  /** Legislative district indexes (MpbData.districts). */
  districts: number[];
}

export interface MpbDistrict {
  i: number;
  id: string;
  label: string;
  region: RegionKey | null;
}

export interface MpbLine {
  i: number;
  /** `gaa:<fy>:<UACS code>` for the enacted budgets, the comparison row id for FY2027. */
  id: string;
  fy: number;
  /** The UACS code (enacted budgets). */
  code: string | null;
  title: string;
  office: string | null;
  pap: string;
  rule: MpbRule;
  level: MpbLevel;
  /** Index into MpbData.places, or -1. A GPS line keeps the place its title names, for its label. */
  place: number;
  /** Index into MpbData.districts, or -1. */
  district: number;
  basis: MpbBasis;
  region: RegionKey | null;
  flags: number;
  gaa: number | null;
  pts: Array<[number, number]> | null;
  nep: number | null;
  house: number | null;
  cls: MpbClass;
  nepPage: number | null;
  housePage: number | null;
  /** Lower-case title, place and office, for the search box. */
  search: string;
  /** The same-title key (titleKey) with the place, or the office when the title names none. */
  tkey: string;
}

export interface MpbData {
  builtAt: string;
  sourceCommit: string;
  lines: MpbLine[];
  places: MpbPlace[];
  districts: MpbDistrict[];
  districtIndex: Map<string, number>;
  flagBits: Record<MpbFlag, number>;
}

export function decodeMpbLines(f: MpbLinesFile): MpbData {
  const region = (i: number) => (i >= 0 ? f.regions[i] ?? null : null);
  const places: MpbPlace[] = f.places.map(([key, level, label, lng, lat, r, ds], i) => ({
    i, key, level: f.levels[level], label, lng, lat, region: region(r), districts: ds,
  }));
  const districts: MpbDistrict[] = f.districts.map(([id, label, r], i) => ({ i, id, label, region: region(r) }));
  const c = Object.fromEntries(f.cols.map((k, i) => [k, i])) as Record<string, number>;
  const at = (row: unknown[], k: string) => (row.length > c[k] ? row[c[k]] : null);
  const lines: MpbLine[] = f.rows.map((row, i) => {
    const fy = at(row, 'fy') as number;
    const rawId = String(at(row, 'id'));
    const place = (at(row, 'place') as number | null) ?? -1;
    const office = at(row, 'office') as number | null;
    const title = at(row, 'title') as string;
    const officeName = office != null && office >= 0 ? f.offices[office] : null;
    const cls = at(row, 'class') as number | null;
    return {
      i,
      id: fy < 2027 ? `gaa:${fy}:${rawId}` : rawId,
      fy,
      code: fy < 2027 ? rawId : null,
      title,
      office: officeName,
      pap: f.paps[at(row, 'pap') as number],
      rule: f.rules[at(row, 'rule') as number],
      level: f.levels[at(row, 'level') as number],
      place,
      district: (at(row, 'district') as number | null) ?? -1,
      basis: f.bases[(at(row, 'basis') as number | null) ?? 0],
      region: region((at(row, 'region') as number | null) ?? -1),
      flags: (at(row, 'flags') as number | null) ?? 0,
      gaa: at(row, 'gaa_php') as number | null,
      pts: (at(row, 'pts') as Array<[number, number]> | null) ?? null,
      nep: at(row, 'nep_php') as number | null,
      house: at(row, 'house_php') as number | null,
      cls: cls == null ? null : f.classes[cls],
      nepPage: at(row, 'nep_page') as number | null,
      housePage: at(row, 'house_page') as number | null,
      search: `${title} ${place >= 0 ? f.places[place][2] : ''} ${officeName ?? ''}`.toLowerCase(),
      tkey: `${titleKey(title)}|${place >= 0 ? `p${place}` : `o${officeName ?? ''}`}`,
    };
  });
  return {
    builtAt: f.built_at,
    sourceCommit: f.source_commit,
    lines,
    places,
    districts,
    districtIndex: new Map(districts.map((d) => [d.id, d.i])),
    flagBits: f.flag_bits,
  };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export interface MpbSelection {
  years: ReadonlySet<number>;
  stage: Stage2027;
}

/** The line's amount in its year: the enacted amount, or the chosen FY2027 stage's (null when not in it). */
export function lineAmount(l: MpbLine, stage: Stage2027): number | null {
  if (l.fy < 2027) return l.gaa;
  return stage === 'house' ? l.house : l.nep;
}

export const inSelection = (l: MpbLine, s: MpbSelection) => s.years.has(l.fy) && lineAmount(l, s.stage) != null;

/** The year bar for FY2027 at the chosen stage, the enacted budget otherwise. */
export function budgetKey(fy: number, stage: Stage2027): string {
  return fy < 2027 ? `gaa-${fy}` : `${stage}-2027`;
}

/**
 * The same-title key: a title with case, accents, punctuation, "multi-purpose"/"MPB"/"Bldg."/"Brgy." spellings,
 * phase numbers and printed GPS set aside, so "Construction of Multi-Purpose Building (Phase I), Brgy. Batasan Hills"
 * and "Construction of Multipurpose Building, Barangay Batasan Hills" match. Words that change the work (construction,
 * completion, repair) stay: those lines meet in the same barangay instead.
 */
export function titleKey(title: string): string {
  let t = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  t = t.replace(/\(?\s*-?\d{1,3}\.\d{3,}\s*[°˚º]?\s*[nsew]?\s*[,;/ ]\s*-?\d{1,3}\.\d{3,}\s*[°˚º]?\s*[nsew]?\s*\)?/g, ' ');
  t = t.replace(/\bmulti\s*-?\s*purpose\b|\bmultipurpose\b/g, 'multipurpose');
  t = t.replace(/\bmpb\b/g, 'multipurpose building');
  t = t.replace(/\bbldg\b/g, 'building');
  t = t.replace(/\b(?:brgy|bgy)\b/g, 'barangay');
  t = t.replace(/\bphase\s*(?:[ivx]+|\d+)\b/g, ' ');
  return t.replace(/[^a-z0-9]+/g, ' ').trim();
}

/** '' every line; 'title' the same title at the same place more than once; 'barangay' a barangay with more than one line. */
export type RepeatMode = '' | 'title' | 'barangay';

export interface MpbGroup {
  kind: Exclude<RepeatMode, ''>;
  key: string;
  lines: MpbLine[];
  /** Budgets (years) the group has lines in, ascending. */
  years: number[];
  php: number;
  /** The place the lines share (the barangay, or the title's place), or -1. */
  place: number;
}

const barangayOf = (data: MpbData, l: MpbLine) => (l.place >= 0 && data.places[l.place].level === 'barangay' ? l.place : -1);

/**
 * Repeats among a set of lines: the same title at the same place more than once, or more than one line in a barangay
 * (only lines whose title names a barangay). Amounts add across years; FY2027 counts at the chosen stage only.
 * Sorted by budgets, then lines, then pesos.
 */
export function repeatGroups(data: MpbData, lines: readonly MpbLine[], stage: Stage2027, kind: Exclude<RepeatMode, ''>): MpbGroup[] {
  const by = new Map<string, MpbLine[]>();
  for (const l of lines) {
    const k = kind === 'title' ? l.tkey : String(barangayOf(data, l));
    if (k === '-1') continue;
    const g = by.get(k);
    if (g) g.push(l); else by.set(k, [l]);
  }
  const out: MpbGroup[] = [];
  for (const [key, ls] of by) {
    if (ls.length < 2) continue;
    ls.sort((a, b) => a.fy - b.fy || a.i - b.i);
    out.push({
      kind, key, lines: ls,
      years: [...new Set(ls.map((l) => l.fy))],
      php: ls.reduce((a, l) => a + (lineAmount(l, stage) ?? 0), 0),
      place: kind === 'barangay' ? Number(key) : ls[ls.length - 1].place,
    });
  }
  return out.sort((a, b) => b.years.length - a.years.length || b.lines.length - a.lines.length || b.php - a.php);
}

/** Only the lines in a repeat group of that kind. */
export function onlyRepeats(data: MpbData, lines: readonly MpbLine[], stage: Stage2027, kind: Exclude<RepeatMode, ''>): MpbLine[] {
  const keep = new Set(repeatGroups(data, lines, stage, kind).flatMap((g) => g.lines.map((l) => l.i)));
  return lines.filter((l) => keep.has(l.i));
}

export interface MpbFilters {
  q: string;
  region: RegionKey | '';
  /** 'exact' = GPS, 'place' = barangay to province, 'office' = office area or region, 'none'. */
  placed: '' | 'exact' | 'place' | 'office' | 'none';
  rule: '' | 'pap' | 'title';
  /** District index, or -1. */
  district: number;
  /** Place index, or -1. */
  place: number;
  /** Repeats only (applied after the other filters, over the lines they select). */
  repeat: RepeatMode;
}
export const NO_FILTERS: MpbFilters = { q: '', region: '', placed: '', rule: '', district: -1, place: -1, repeat: '' };

export const PLACED_GROUP: Record<MpbLevel, MpbFilters['placed']> = {
  gps: 'exact', barangay: 'place', municipality: 'place', city: 'place', province: 'place', deo: 'office', region: 'office', none: 'none',
};

export function filterLines(data: MpbData, s: MpbSelection, f: MpbFilters): MpbLine[] {
  const q = f.q.trim().toLowerCase();
  const words = q ? q.split(/\s+/) : [];
  return data.lines.filter((l) => {
    if (!inSelection(l, s)) return false;
    if (f.region && l.region !== f.region) return false;
    if (f.placed && PLACED_GROUP[l.level] !== f.placed) return false;
    if (f.rule === 'pap' && l.rule === 'title') return false;
    if (f.rule === 'title' && l.rule !== 'title') return false;
    if (f.district >= 0 && l.district !== f.district) return false;
    if (f.place >= 0 && l.place !== f.place) return false;
    return words.every((w) => l.search.includes(w));
  });
}

export type MpbSort = 'year' | 'amount' | 'title';
export function sortLines(lines: MpbLine[], sort: MpbSort, stage: Stage2027): MpbLine[] {
  const amt = (l: MpbLine) => lineAmount(l, stage) ?? 0;
  const out = [...lines];
  if (sort === 'amount') out.sort((a, b) => amt(b) - amt(a) || b.fy - a.fy || a.i - b.i);
  else if (sort === 'title') out.sort((a, b) => a.title.localeCompare(b.title) || b.fy - a.fy);
  else out.sort((a, b) => b.fy - a.fy || amt(b) - amt(a) || a.i - b.i);
  return out;
}

// ---------------------------------------------------------------------------
// Map features
// ---------------------------------------------------------------------------

export type MarkKind = 'gps' | 'place' | 'area';
export interface MarkProps {
  kind: MarkKind;
  /** Lines this mark stands for (a line with several GPS points counts once, at its first point). */
  lines: number;
  php: number;
  /** Place index (place and area marks), or -1. */
  place: number;
  /** Line index (GPS marks), or -1. */
  line: number;
  level: MpbLevel;
}
export interface MarkFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: MarkProps;
}

/**
 * The map's marks for a set of lines: a dot per GPS point; one ring per place a title names (barangay, town,
 * city, province), sized by its lines; one badge per office area or region. Lines placed nowhere are left out.
 */
export function mapMarks(data: MpbData, lines: readonly MpbLine[], stage: Stage2027): MarkFeature[] {
  const out: MarkFeature[] = [];
  const byPlace = new Map<number, { lines: number; php: number }>();
  for (const l of lines) {
    const php = lineAmount(l, stage) ?? 0;
    if (l.level === 'gps' && l.pts) {
      l.pts.forEach(([lng, lat], k) => out.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: { kind: 'gps', lines: k === 0 ? 1 : 0, php: k === 0 ? php : 0, place: l.place, line: l.i, level: 'gps' },
      }));
    } else if (l.level !== 'none' && l.place >= 0) {
      const a = byPlace.get(l.place) ?? { lines: 0, php: 0 };
      a.lines += 1;
      a.php += php;
      byPlace.set(l.place, a);
    }
  }
  for (const [i, a] of byPlace) {
    const p = data.places[i];
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { kind: p.level === 'deo' || p.level === 'region' ? 'area' : 'place', lines: a.lines, php: a.php, place: i, line: -1, level: p.level },
    });
  }
  return out;
}

/** Pesos per legislative district for a set of lines (lines with no district are left out). */
export function districtTotals(data: MpbData, lines: readonly MpbLine[], stage: Stage2027): Float64Array {
  const t = new Float64Array(data.districts.length);
  for (const l of lines) if (l.district >= 0) t[l.district] += lineAmount(l, stage) ?? 0;
  return t;
}

/**
 * Five classes for the district shading, at quantiles of the districts that have any amount (0 = none). The
 * breaks are rounded to two significant figures so the key reads cleanly.
 */
export function shadeBreaks(totals: Float64Array): number[] {
  const vals = [...totals].filter((v) => v > 0).sort((a, b) => a - b);
  if (!vals.length) return [];
  const round2 = (v: number) => {
    const p = 10 ** Math.max(0, Math.floor(Math.log10(v)) - 1);
    return Math.round(v / p) * p;
  };
  const qs = [0.2, 0.4, 0.6, 0.8].map((q) => round2(vals[Math.min(vals.length - 1, Math.floor(q * vals.length))]));
  return [...new Set(qs)].sort((a, b) => a - b);
}
export const shadeClass = (v: number, breaks: readonly number[]) => (v <= 0 ? 0 : 1 + breaks.filter((b) => v >= b).length);

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export const LEVEL_LABELS: Record<MpbLevel, string> = {
  gps: 'GPS published in the title',
  barangay: 'Barangay named in the title',
  municipality: 'Town named in the title',
  city: 'City named in the title',
  province: 'Province named in the title',
  deo: 'Area of its DPWH office',
  region: 'Its region',
  none: 'Not on the map',
};
export const LEVEL_SHORT: Record<MpbLevel, string> = {
  gps: 'GPS', barangay: 'Barangay', municipality: 'Town', city: 'City', province: 'Province', deo: 'Office area', region: 'Region', none: 'Not mapped',
};
export const REPEAT_LABELS: Record<Exclude<RepeatMode, ''>, string> = {
  title: 'Same title, same place, more than once',
  barangay: 'Barangays with more than one line',
};
export const PLACED_LABELS: Record<Exclude<MpbFilters['placed'], ''>, string> = {
  exact: 'GPS in the title',
  place: 'Place named in the title',
  office: 'Office area or region only',
  none: 'Not on the map',
};

export const FLAG_TEXT: Record<MpbFlag, string> = {
  gps_not_drawn: 'A GPS pair in the title lies outside the country or out at sea, so it is not drawn.',
  gps_district_differs: 'The GPS point lies in another legislative district than the place the title names.',
  office_elsewhere: 'The place in the title lies outside the area of the DPWH office that holds the line.',
  maguindanao_successor: '“Maguindanao” read as the province that holds the town today (Maguindanao del Norte or del Sur).',
  text_repaired: 'Garbled characters in the published text were repaired (for example “Las Pi±as” to “Las Piñas”).',
  gps_wider_reader: 'The GPS pair uses a space, slash, N/E letters or ˚; we read it as published.',
};

export function lineFlags(l: MpbLine, bits: Record<MpbFlag, number>): MpbFlag[] {
  return (Object.keys(bits) as MpbFlag[]).filter((k) => l.flags & bits[k]);
}

/** "DPWH Cebu 3rd DEO", "DPWH Central Office", "DPWH Regional Office IX". */
export function officeShort(name: string | null): string | null {
  if (!name) return null;
  const s = name
    .replace(/\s*-\s*Proper$/i, '')
    .replace(/Sub-District Engineering Office/i, 'Sub-DEO')
    .replace(/District Engineering Office/i, 'DEO');
  return /^DPWH\b/.test(s) ? s : `DPWH ${s}`;
}

export const CLASS_LABELS: Record<Exclude<MpbClass, null>, string> = {
  house_only: 'In the House bill only',
  nep_only: 'In the NEP only',
  paired: 'In the NEP and the House bill',
};

/** The record page of a FY2027 line (its NEP and House bill pages, with the PDFs). */
export const recordHref = (l: MpbLine) => (l.fy === 2027 ? `/hgab/2027/dpwh/p/${encodeURIComponent(l.id)}` : null);

// ---------------------------------------------------------------------------
// CSV of the lines on screen
// ---------------------------------------------------------------------------

const cell = (v: unknown): string => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const MPB_CSV_COLUMNS = [
  'fiscal_year', 'line_id', 'title', 'gaa_php', 'nep_php', 'house_bill_php', 'fy2027_comparison', 'uacs_code', 'pap',
  'scope_rule', 'dpwh_office', 'region', 'placed_by', 'place', 'longitude', 'latitude', 'gps_points',
  'legislative_district', 'legislative_district_id', 'district_from', 'flags',
  'same_title_lines', 'same_barangay_lines', 'same_title_key',
] as const;

/** The lines as CSV (UTF-8, BOM added by the caller's Blob): integer pesos, empty = none, never 0. */
export function linesCsv(data: MpbData, lines: readonly MpbLine[]): string {
  // Group sizes among the lines being written, so a spreadsheet can sort and group the repeats.
  const tCount = new Map<string, number>();
  const bCount = new Map<number, number>();
  for (const l of lines) {
    tCount.set(l.tkey, (tCount.get(l.tkey) ?? 0) + 1);
    const b = barangayOf(data, l);
    if (b >= 0) bCount.set(b, (bCount.get(b) ?? 0) + 1);
  }
  const rows = lines.map((l) => {
    const p = l.place >= 0 ? data.places[l.place] : null;
    const d = l.district >= 0 ? data.districts[l.district] : null;
    const at = l.pts?.[0] ?? (p && l.level !== 'none' ? [p.lng, p.lat] : null);
    return [
      l.fy, l.id, l.title, l.gaa, l.nep, l.house,
      l.cls === 'house_only' ? 'house_bill_only' : l.cls === 'nep_only' ? 'nep_only' : l.cls === 'paired' ? 'in_both' : null,
      l.code, l.pap, l.rule, l.office, l.region, LEVEL_LABELS[l.level], p?.label ?? null, at?.[0] ?? null, at?.[1] ?? null,
      l.pts ? l.pts.map(([a, b]) => `${a},${b}`).join(';') : null,
      d?.label ?? null, d?.id ?? null, l.basis, lineFlags(l, data.flagBits).join(';') || null,
      tCount.get(l.tkey) ?? 1, barangayOf(data, l) >= 0 ? bCount.get(barangayOf(data, l)) ?? 1 : null, l.tkey,
    ].map(cell).join(',');
  });
  return [MPB_CSV_COLUMNS.join(','), ...rows].join('\n') + '\n';
}
