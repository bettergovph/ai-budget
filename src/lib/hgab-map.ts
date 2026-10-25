/**
 * Pure helpers for the Map tab of a dataset hub (`components/HgabMap.tsx`):
 * the projection, SVG path building, the region colour scales, the zoom
 * boxes per region, the per-group dot paths and the nearest-dot search.
 *
 * No React and no DOM here, so everything can be computed once per data load
 * (`useMemo`) and benchmarked outside the browser.
 *
 * Geometry: an equirectangular projection with longitude scaled by cos(12°)
 * (the archipelago's middle latitude), fitted to the outlines' bbox. Units are
 * "map units": the whole country is MAP_WIDTH wide. Paths are rounded to two
 * decimals, about 20 m on the ground, which still holds up when the view is
 * zoomed into Metro Manila.
 *
 * Dots: each bridge group's dots are ONE `<path>` of zero-length subpaths
 * (`M x y h0`) stroked with round caps and `vector-effect: non-scaling-stroke`,
 * so ~2,400 dots are a handful of DOM nodes, keep their screen size at any
 * zoom, and never need per-dot React state. Hit-testing is done here instead
 * (`nearestPoint`), with a hit radius larger than the dot.
 */
import {
  BRIDGE_ORDER, REGION_LABELS, REGION_ORDER, pctChange,
  type BridgeGroup, type HgabDatasetMap, type HgabGeo, type MapPoint, type MapRegion, type RegionKey,
} from './hgab';

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export const LON_SCALE = Math.cos((12 * Math.PI) / 180);
/** Width of the whole-country view in map units. */
export const MAP_WIDTH = 600;

export interface Box { x: number; y: number; w: number; h: number }

export interface Projection {
  width: number;
  height: number;
  /** Map units per degree of latitude. */
  k: number;
  project(lon: number, lat: number): [number, number];
}

export function makeProjection(bbox: HgabGeo['bbox'], width = MAP_WIDTH, padFrac = 0.025): Projection {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const pad = width * padFrac;
  const spanX = Math.max(1e-6, (maxLon - minLon) * LON_SCALE);
  const spanY = Math.max(1e-6, maxLat - minLat);
  const k = (width - 2 * pad) / spanX;
  const height = 2 * pad + spanY * k;
  return {
    width,
    height,
    k,
    project: (lon, lat) => [pad + (lon - minLon) * LON_SCALE * k, pad + (maxLat - lat) * k],
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// Provinces
// ---------------------------------------------------------------------------

export interface ProvinceShape {
  psgc: number;
  name: string;
  region: RegionKey;
  d: string;
  box: Box;
}

function emptyBounds() {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

/** One SVG path for a province's polygons (rings closed with Z; evenodd keeps holes holes). */
export function polygonsToPath(
  polygons: number[][][][],
  proj: Projection,
): { d: string; box: Box } {
  const b = emptyBounds();
  const parts: string[] = [];
  for (const poly of polygons) {
    for (const ring of poly) {
      if (ring.length < 3) continue;
      let s = '';
      let px = NaN;
      let py = NaN;
      let n = 0;
      for (const pt of ring) {
        const [xf, yf] = proj.project(pt[0], pt[1]);
        const x = r2(xf);
        const y = r2(yf);
        if (x === px && y === py) continue;
        s += (n === 0 ? 'M' : 'L') + x + ' ' + y;
        px = x; py = y; n += 1;
        if (x < b.x0) b.x0 = x;
        if (x > b.x1) b.x1 = x;
        if (y < b.y0) b.y0 = y;
        if (y > b.y1) b.y1 = y;
      }
      if (n >= 3) parts.push(s + 'Z');
    }
  }
  const box = Number.isFinite(b.x0)
    ? { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }
    : { x: 0, y: 0, w: 0, h: 0 };
  return { d: parts.join(''), box };
}

export function buildProvinceShapes(geo: HgabGeo, proj: Projection): ProvinceShape[] {
  return geo.provinces.map((p) => {
    const { d, box } = polygonsToPath(p.polygons, proj);
    return { psgc: p.psgc, name: p.name, region: p.region, d, box };
  });
}

export function unionBox(boxes: Box[]): Box | null {
  const b = emptyBounds();
  for (const x of boxes) {
    if (!(x.w > 0 || x.h > 0)) continue;
    b.x0 = Math.min(b.x0, x.x);
    b.y0 = Math.min(b.y0, x.y);
    b.x1 = Math.max(b.x1, x.x + x.w);
    b.y1 = Math.max(b.y1, x.y + x.h);
  }
  return Number.isFinite(b.x0) ? { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 } : null;
}

export interface RegionShape {
  key: RegionKey;
  provinces: ProvinceShape[];
  /** Every province of the region in one path (for the outline pass). */
  d: string;
  box: Box;
}

/** Provinces grouped by region, in REGION_ORDER (north to south). */
export function groupRegions(shapes: ProvinceShape[]): RegionShape[] {
  const by = new Map<RegionKey, ProvinceShape[]>();
  for (const s of shapes) {
    const list = by.get(s.region);
    if (list) list.push(s);
    else by.set(s.region, [s]);
  }
  const out: RegionShape[] = [];
  const keys = [...REGION_ORDER, ...[...by.keys()].filter((k) => !REGION_ORDER.includes(k))];
  for (const key of keys) {
    const provinces = by.get(key);
    if (!provinces?.length) continue;
    out.push({
      key,
      provinces,
      d: provinces.map((p) => p.d).join(''),
      box: unionBox(provinces.map((p) => p.box)) ?? { x: 0, y: 0, w: 0, h: 0 },
    });
  }
  return out;
}

/**
 * The view box that frames `box` in a viewport of the given aspect (w / h):
 * padded, never smaller than `minSpan` map units, grown on one axis to match
 * the aspect so the SVG never letterboxes or changes size.
 */
export function fitBox(box: Box, aspect: number, padFrac = 0.12, minSpan = 46): Box {
  let w = Math.max(box.w * (1 + 2 * padFrac), minSpan);
  let h = Math.max(box.h * (1 + 2 * padFrac), minSpan);
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function boxToViewBox(b: Box): string {
  return `${r2(b.x)} ${r2(b.y)} ${r2(b.w)} ${r2(b.h)}`;
}

export function lerpBox(a: Box, b: Box, t: number): Box {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t };
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------------------------------------------------------------------------
// Regions: values and colour scales
// ---------------------------------------------------------------------------

export type Measure = 'delta' | 'nep' | 'house';
export const MEASURE_ORDER: readonly Measure[] = ['delta', 'nep', 'house'];

export interface RegionValue {
  key: RegionKey;
  name: string;
  short: string;
  nep: number | null;
  house: number | null;
  /** House bill − NEP; computed from the two sides when the data leaves it null but one side exists. */
  delta: number | null;
  pct: number | null;
  nepRows: number;
  houseRows: number;
  /** The labels each document lists for this region. */
  sourceLabels: string[];
  /** True when the map data has an entry for the region at all. */
  listed: boolean;
}

export function regionDelta(r: Pick<MapRegion, 'nep_php' | 'house_php' | 'delta_php'>): number | null {
  if (r.delta_php != null) return r.delta_php;
  if (r.nep_php == null && r.house_php == null) return null;
  return (r.house_php ?? 0) - (r.nep_php ?? 0);
}

/** One value per region that has outlines or amounts, REGION_ORDER first. */
export function regionValues(map: HgabDatasetMap, outlined: readonly RegionKey[]): RegionValue[] {
  const byKey = new Map(map.regions.map((r) => [r.key, r] as const));
  const keys: RegionKey[] = [];
  for (const k of REGION_ORDER) if (byKey.has(k) || outlined.includes(k)) keys.push(k);
  for (const r of map.regions) if (!keys.includes(r.key)) keys.push(r.key);
  return keys.map((key) => {
    const r = byKey.get(key);
    const lab = REGION_LABELS[key] ?? { short: key, name: r?.label ?? key };
    const nep = r?.nep_php ?? null;
    const house = r?.house_php ?? null;
    return {
      key,
      name: lab.name,
      short: lab.short,
      nep,
      house,
      delta: r ? regionDelta(r) : null,
      pct: pctChange(house, nep),
      nepRows: r?.nep_rows ?? 0,
      houseRows: r?.house_rows ?? 0,
      sourceLabels: r?.source_labels ?? [],
      listed: Boolean(r) && (nep != null || house != null),
    };
  });
}

export function measureValue(v: RegionValue, m: Measure): number | null {
  return m === 'delta' ? v.delta : m === 'nep' ? v.nep : v.house;
}

export interface ScaleStep {
  /** CSS class on the region group: `is-d4`…`is-d1`, `is-mid`, `is-u1`…`is-u4`, `is-s1`…`is-s5`. */
  cls: string;
  /** Inclusive lower and exclusive upper bound of the step, in pesos (signed for the change scale). */
  from: number;
  to: number;
}

export interface RegionScale {
  measure: Measure;
  kind: 'diverging' | 'sequential';
  /** Largest |value| the scale is built on (the top step's lower edge is open when `capped`). */
  max: number;
  /**
   * True when one region's figure is more than twice the next largest and the
   * scale tops out at the runner-up instead, so a single outlier (Metro Manila
   * in DPWH) does not wash every other region out. The top step then reads
   * "or more" and the outlier keeps the darkest shade.
   */
  capped: boolean;
  /** The largest |value| actually present, capped or not. */
  peak: number;
  /** The region holding `peak`, and its signed value. */
  peakKey: RegionKey | null;
  peakValue: number | null;
  steps: ScaleStep[];
  classOf(v: number | null): string;
}

/** The scale maximum: the largest value, or the runner-up when the largest is more than twice it. */
export function robustMax(values: number[]): { max: number; capped: boolean; peak: number } {
  const s = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => b - a);
  if (!s.length) return { max: 0, capped: false, peak: 0 };
  if (s.length >= 3 && s[0] > 2 * s[1]) return { max: s[1], capped: true, peak: s[0] };
  return { max: s[0], capped: false, peak: s[0] };
}

const DIV_STEPS = 4;
const SEQ_STEPS = 5;
/** Changes smaller than this share of the largest change read as "about the same". */
export const NEAR_ZERO = 0.02;

/**
 * The scale for one measure. Steps are square-root spaced, and the maximum
 * ignores a lone outlier (`robustMax`), so the largest region does not wash
 * every other region out.
 * The change scale is symmetric around zero (the same step widths on both
 * sides); the two amount scales share one maximum, so switching between
 * "NEP" and "House bill" compares like with like.
 */
export function regionScale(values: RegionValue[], measure: Measure): RegionScale {
  if (measure === 'delta') {
    const { max, capped, peak } = robustMax(values.map((v) => Math.abs(v.delta ?? 0)));
    const top = values.find((v) => v.delta != null && Math.abs(v.delta) === peak) ?? null;
    const edge = (k: number) => (capped && k === DIV_STEPS ? Infinity : max * (k / DIV_STEPS) ** 2);
    const near = max * NEAR_ZERO;
    const steps: ScaleStep[] = [];
    for (let k = DIV_STEPS; k >= 1; k -= 1) steps.push({ cls: `is-d${k}`, from: -edge(k), to: -Math.max(edge(k - 1), near) });
    steps.push({ cls: 'is-mid', from: -near, to: near });
    for (let k = 1; k <= DIV_STEPS; k += 1) steps.push({ cls: `is-u${k}`, from: Math.max(edge(k - 1), near), to: edge(k) });
    return {
      measure,
      kind: 'diverging',
      max,
      capped,
      peak,
      peakKey: top?.key ?? null,
      peakValue: top?.delta ?? null,
      steps,
      classOf: (v) => {
        if (v == null || !Number.isFinite(v)) return 'is-empty';
        if (max <= 0 || Math.abs(v) <= near) return 'is-mid';
        const k = Math.min(DIV_STEPS, Math.max(1, Math.ceil(Math.sqrt(Math.abs(v) / max) * DIV_STEPS)));
        return v > 0 ? `is-u${k}` : `is-d${k}`;
      },
    };
  }
  // One maximum for both amount measures, from each region's larger side.
  const { max, capped, peak } = robustMax(values.map((v) => Math.max(v.nep ?? 0, v.house ?? 0)));
  const top = values.find((v) => Math.max(v.nep ?? 0, v.house ?? 0) === peak) ?? null;
  const edge = (k: number) => (capped && k === SEQ_STEPS ? Infinity : max * (k / SEQ_STEPS) ** 2);
  const steps: ScaleStep[] = [];
  for (let k = 1; k <= SEQ_STEPS; k += 1) steps.push({ cls: `is-s${k}`, from: edge(k - 1), to: edge(k) });
  return {
    measure,
    kind: 'sequential',
    max,
    capped,
    peak,
    peakKey: top?.key ?? null,
    peakValue: top ? measureValue(top, measure) : null,
    steps,
    classOf: (v) => {
      if (v == null || !Number.isFinite(v)) return 'is-empty';
      if (max <= 0 || v <= 0) return 'is-s0';
      const k = Math.min(SEQ_STEPS, Math.max(1, Math.ceil(Math.sqrt(v / max) * SEQ_STEPS)));
      return `is-s${k}`;
    },
  };
}

export type RegionSort = 'order' | 'nep' | 'house' | 'delta' | 'pct';

/** Rows for the region table. Regions with nothing listed always sink to the bottom. */
export function sortRegions(values: RegionValue[], sort: RegionSort, dir: 'asc' | 'desc'): RegionValue[] {
  const m = dir === 'asc' ? 1 : -1;
  const pick = (v: RegionValue): number | null => {
    switch (sort) {
      case 'nep': return v.nep;
      case 'house': return v.house;
      case 'delta': return v.delta;
      case 'pct': return v.pct;
      default: return REGION_ORDER.indexOf(v.key);
    }
  };
  return [...values].sort((a, b) => {
    if (a.listed !== b.listed) return a.listed ? -1 : 1;
    const av = pick(a);
    const bv = pick(b);
    if (av == null && bv == null) return REGION_ORDER.indexOf(a.key) - REGION_ORDER.indexOf(b.key);
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * m || REGION_ORDER.indexOf(a.key) - REGION_ORDER.indexOf(b.key);
  });
}

/**
 * The printed region label to filter the Projects tab by (`&region=`, an
 * exact match on the one label each project row carries). The map data lists
 * a region's labels most-used first, so the first one opens the most rows.
 */
export function projectsRegionLabel(v: Pick<RegionValue, 'sourceLabels'>): string | null {
  // Every printed spelling, "|"-separated: the Projects filter matches any of them.
  return v.sourceLabels.length ? v.sourceLabels.join('|') : null;
}

// ---------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------

/** Legend key of a dot: its bridge group, or `other` when the data carries none. */
export type DotKey = BridgeGroup | 'other';
export const DOT_ORDER: readonly DotKey[] = [...BRIDGE_ORDER, 'other'];
/** Paint order, bottom to top: the unchanged dots recede under the changes. */
export const DOT_PAINT_ORDER: readonly DotKey[] = ['unchanged', 'other', 'scope_review', 'nep_only', 'house_only', 'decreased', 'increased'];

export function dotKey(p: Pick<MapPoint, 'group'>): DotKey {
  return p.group ?? 'other';
}

export interface ProjectedPoints {
  /** Projected positions, index-aligned with the source `points` array. */
  xs: Float64Array;
  ys: Float64Array;
  keys: DotKey[];
  held: Uint8Array;
  /** One path of zero-length subpaths per dot key, solid dots and hollow (unconfirmed) dots apart. */
  solid: Partial<Record<DotKey, string>>;
  hollow: Partial<Record<DotKey, string>>;
  /** Road segments per dot key, when the document prints start and end points. */
  lines: Partial<Record<DotKey, string>>;
  counts: Record<DotKey, number>;
  heldCount: number;
  lineCount: number;
}

export function projectPoints(points: readonly MapPoint[], proj: Projection): ProjectedPoints {
  const n = points.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const keys: DotKey[] = new Array(n);
  const held = new Uint8Array(n);
  const solidParts: Partial<Record<DotKey, string[]>> = {};
  const hollowParts: Partial<Record<DotKey, string[]>> = {};
  const lineParts: Partial<Record<DotKey, string[]>> = {};
  const counts = Object.fromEntries(DOT_ORDER.map((k) => [k, 0])) as Record<DotKey, number>;
  let heldCount = 0;
  let lineCount = 0;
  for (let i = 0; i < n; i += 1) {
    const p = points[i];
    const [x, y] = proj.project(p.lon, p.lat);
    xs[i] = x;
    ys[i] = y;
    const k = dotKey(p);
    keys[i] = k;
    counts[k] += 1;
    const isHeld = Boolean(p.held);
    held[i] = isHeld ? 1 : 0;
    if (isHeld) heldCount += 1;
    const bucket = isHeld ? hollowParts : solidParts;
    (bucket[k] ??= []).push(`M${r2(x)} ${r2(y)}h0`);
    if (p.lines?.length) {
      for (const line of p.lines) {
        if (!line || line.length < 2) continue;
        let s = '';
        for (let j = 0; j < line.length; j += 1) {
          const [lx, ly] = proj.project(line[j][0], line[j][1]);
          s += (j === 0 ? 'M' : 'L') + r2(lx) + ' ' + r2(ly);
        }
        (lineParts[k] ??= []).push(s);
        lineCount += 1;
      }
    }
  }
  const join = (o: Partial<Record<DotKey, string[]>>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, (v as string[]).join('')])) as Partial<Record<DotKey, string>>;
  return { xs, ys, keys, held, solid: join(solidParts), hollow: join(hollowParts), lines: join(lineParts), counts, heldCount, lineCount };
}

/**
 * Index of the visible dot nearest (x, y) within `radius` map units, or -1.
 * A linear scan: ~2,400 squared distances per pointer move is a few
 * microseconds, cheaper than keeping a spatial index in step with the toggles.
 */
export function nearestPoint(
  pp: Pick<ProjectedPoints, 'xs' | 'ys' | 'keys' | 'held'>,
  x: number,
  y: number,
  radius: number,
  isVisible: (key: DotKey, held: boolean) => boolean,
): number {
  let best = -1;
  let bestD = radius * radius;
  const { xs, ys, keys, held } = pp;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - x;
    if (dx > radius || dx < -radius) continue;
    const dy = ys[i] - y;
    if (dy > radius || dy < -radius) continue;
    const d = dx * dx + dy * dy;
    if (d <= bestD && isVisible(keys[i], held[i] === 1)) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** "12,345" */
export function count(n: number): string {
  return n.toLocaleString('en-US');
}

/** "1 line" / "12 lines". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}

/** Shorten a long printed title for a tooltip without cutting a word in half. */
export function clip(s: string, max = 160): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:\s-]+$/, '')}…`;
}
