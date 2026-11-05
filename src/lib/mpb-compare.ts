/**
 * `/hgab/2027/multi-purpose/nep-vs-house-bill`: the 2027 NEP and the House bill side by side, for multi-purpose
 * buildings: the figures, and every line as a dot on two maps drawn the same way.
 *
 * Jason (2026-11-05): "a different page side by side comparison of 2027's NEP vs HGAB for multi-purpose buildings …
 * more points visible in the philippines to demonstrate the density and intensity of the changes … numbers visible
 * … take a screenshot of the section for publishing. Poster can follow after."
 *
 * Data: the multi-purpose map's lines (mpb-years/lines.json), FY2027 at both stages, and the province outlines
 * (geo/provinces.json). Every figure here is computed from them; the verifier checks the totals against
 * mpb-years/summary.json. Pure, apart from `drawCompareMap`, which only needs a 2D canvas context, so the poster can
 * draw the same maps.
 *
 * Dots: one per line, never grouped. A line sits at its first GPS point, else at the centre of the place its title
 * names (or its office's area). Lines at the same spot fan out in a sunflower so each stays visible; dot area follows
 * the line's amount. The NEP map is all blue. The House bill map (Jason, 2026-11-05: "can the existing ones be blue
 * while the added ones are red, the ones not existing as yellow") shows its lines that the NEP has too in blue, the added
 * ones in red, and the NEP's lines it does not have in yellow, where they were (not part of its total).
 *
 * The figure compares the two totals only (Jason, 2026-11-05: "we don't need the in the nep only but let's just compare
 * the totals for both"): no breakdown into lines in both, in one document only.
 */
import type { MpbClass, MpbData, MpbLine } from './hgab-mpb-years';
import type { HgabGeo, RegionKey } from './hgab';

export const MPB_COMPARE_ROOT = '/hgab/2027/multi-purpose/nep-vs-house-bill';
export const MPB_COMPARE_TITLE = 'Multi-purpose buildings: NEP vs House bill';

export type CompareSide = 'nep' | 'house';
export type CompareClass = Exclude<MpbClass, null>;


// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

export interface Tally { lines: number; php: number }

export interface CompareFigures {
  nep: Tally;
  house: Tally;
  houseOnly: Tally;
  nepOnly: Tally;
  /** Lines in both: their NEP and House bill amounts, and how many are higher, lower or the same in the House bill. */
  paired: { lines: number; nep_php: number; house_php: number; higher: number; lower: number; same: number };
  /** Lines with no place on the map (none in the current data). */
  unmapped: number;
}

const lines2027 = (data: MpbData) => data.lines.filter((l) => l.fy === 2027 && l.cls != null);

export function compareFigures(data: MpbData): CompareFigures {
  const t = (): Tally => ({ lines: 0, php: 0 });
  const f: CompareFigures = {
    nep: t(), house: t(), houseOnly: t(), nepOnly: t(),
    paired: { lines: 0, nep_php: 0, house_php: 0, higher: 0, lower: 0, same: 0 }, unmapped: 0,
  };
  for (const l of lines2027(data)) {
    if (l.nep != null) { f.nep.lines++; f.nep.php += l.nep; }
    if (l.house != null) { f.house.lines++; f.house.php += l.house; }
    if (l.cls === 'house_only') { f.houseOnly.lines++; f.houseOnly.php += l.house ?? 0; }
    if (l.cls === 'nep_only') { f.nepOnly.lines++; f.nepOnly.php += l.nep ?? 0; }
    if (l.cls === 'paired') {
      const p = f.paired;
      p.lines++; p.nep_php += l.nep ?? 0; p.house_php += l.house ?? 0;
      if ((l.house ?? 0) > (l.nep ?? 0)) p.higher++; else if ((l.house ?? 0) < (l.nep ?? 0)) p.lower++; else p.same++;
    }
    if (!linePoint(data, l)) f.unmapped++;
  }
  return f;
}

export interface RegionRow {
  region: RegionKey | null;
  nep: Tally;
  house: Tally;
}

/** The totals by region (a line's region; null where none), largest House bill amount first. */
export function compareByRegion(data: MpbData): RegionRow[] {
  const by = new Map<RegionKey | null, RegionRow>();
  for (const l of lines2027(data)) {
    const r = by.get(l.region) ?? { region: l.region, nep: { lines: 0, php: 0 }, house: { lines: 0, php: 0 } };
    if (l.nep != null) { r.nep.lines++; r.nep.php += l.nep; }
    if (l.house != null) { r.house.lines++; r.house.php += l.house; }
    by.set(l.region, r);
  }
  return [...by.values()].sort((a, b) => b.house.php - a.house.php || a.nep.php - b.nep.php);
}

// ---------------------------------------------------------------------------
// Dots
// ---------------------------------------------------------------------------

/** A line's spot: its first GPS point, else the centre of its place; null when it has neither. */
export function linePoint(data: MpbData, l: MpbLine): [number, number] | null {
  if (l.pts?.length) return l.pts[0];
  if (l.level !== 'none' && l.place >= 0) {
    const p = data.places[l.place];
    return [p.lng, p.lat];
  }
  return null;
}

export interface CompareDot { lon: number; lat: number; php: number; cls: CompareClass }

/** Every line on one side's map: the NEP's lines (in both, or NEP only), or the House bill's (in both, or House only). */
export function sideDots(data: MpbData, side: CompareSide): CompareDot[] {
  const out: CompareDot[] = [];
  for (const l of lines2027(data)) {
    const php = side === 'nep' ? l.nep : l.house;
    if (php == null) continue;
    const at = linePoint(data, l);
    if (!at) continue;
    out.push({ lon: at[0], lat: at[1], php, cls: l.cls as CompareClass });
  }
  return out;
}

/**
 * The dots a map draws: the NEP's lines; or the House bill's (in both, added) and the NEP lines it does not have,
 * at their NEP amount (drawn in yellow, outside its total).
 */
export function mapDots(data: MpbData, side: CompareSide): CompareDot[] {
  if (side === 'nep') return sideDots(data, 'nep');
  return [...sideDots(data, 'house'), ...sideDots(data, 'nep').filter((d) => d.cls === 'nep_only')];
}

/** The view: the archipelago, Batanes to Tawi-Tawi (the Kalayaan islands, far west, are counted, not drawn). */
export const COMPARE_VIEW: [number, number, number, number] = [116.75, 4.45, 126.75, 21.2];
const LON_SCALE = Math.cos((12 * Math.PI) / 180);

export interface MapFrame { width: number; height: number; project(lon: number, lat: number): [number, number] }

/** An equirectangular frame `width` pixels wide over COMPARE_VIEW (the site's map projection). */
export function compareFrame(width: number): MapFrame {
  const [x0, y0, x1, y1] = COMPARE_VIEW;
  const k = width / ((x1 - x0) * LON_SCALE);
  return { width, height: Math.round((y1 - y0) * k), project: (lon, lat) => [(lon - x0) * LON_SCALE * k, (y1 - lat) * k] };
}

export const inView = (d: Pick<CompareDot, 'lon' | 'lat'>) =>
  d.lon >= COMPARE_VIEW[0] && d.lon <= COMPARE_VIEW[2] && d.lat >= COMPARE_VIEW[1] && d.lat <= COMPARE_VIEW[3];

/** Dot radius in pixels for an amount, at a frame width (area follows the amount; 600 px wide is the reference). */
export function dotRadius(php: number, width: number): number {
  const s = width / 600;
  return Math.min(9, Math.max(1.4, 1.1 + 0.42 * Math.sqrt(php / 1e6))) * s;
}

export interface PlacedDot extends CompareDot { x: number; y: number; r: number }

/**
 * Pixel positions: dots at the same spot (to half a pixel) fan out in a sunflower, largest at the centre, so a
 * barangay with 30 lines shows 30 dots.
 */
export function placeDots(dots: readonly CompareDot[], frame: MapFrame): PlacedDot[] {
  const spots = new Map<string, CompareDot[]>();
  for (const d of dots) {
    if (!inView(d)) continue;
    const [x, y] = frame.project(d.lon, d.lat);
    const key = `${Math.round(x * 2)}:${Math.round(y * 2)}`;
    spots.set(key, [...(spots.get(key) ?? []), d]);
  }
  const step = (frame.width / 600) * 1.7;
  const out: PlacedDot[] = [];
  for (const group of spots.values()) {
    const sorted = [...group].sort((a, b) => b.php - a.php);
    const [cx, cy] = frame.project(sorted[0].lon, sorted[0].lat);
    sorted.forEach((d, k) => {
      const rr = k === 0 ? 0 : step * Math.sqrt(k);
      const a = k * 2.399963;
      out.push({ ...d, x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a), r: dotRadius(d.php, frame.width) });
    });
  }
  // Largest first, so the small dots stay visible on top.
  return out.sort((a, b) => b.r - a.r);
}

// ---------------------------------------------------------------------------
// Drawing (a 2D canvas: the page, and later the poster)
// ---------------------------------------------------------------------------

export type DotColor = 'blue' | 'red' | 'yellow';
export const COMPARE_COLORS = {
  ground: '#0c1322',
  land: '#1a2436',
  border: '#2a3750',
  /** Dots: blue = in the NEP (on the House bill map: and in the House bill), red = added in the House bill, yellow = in the NEP, not the House bill. */
  dot: { blue: 'rgba(150, 182, 232, 0.66)', red: 'rgba(255, 64, 64, 0.72)', yellow: 'rgba(255, 204, 64, 0.92)' } as Record<DotColor, string>,
  /** Solid swatches for legends and halos. */
  swatch: { blue: '#96b6e8', red: '#ff4848', yellow: '#ffcc40' } as Record<DotColor, string>,
} as const;

/** A dot's colour on a map: the NEP map is all blue; the House bill map colours by match. */
export function dotColor(side: CompareSide, cls: CompareClass): DotColor {
  if (side === 'nep') return 'blue';
  return cls === 'house_only' ? 'red' : cls === 'nep_only' ? 'yellow' : 'blue';
}

/** Province outlines as Path2D-ready strings in a frame (computed once per width). */
export function provincePaths(geo: HgabGeo, frame: MapFrame): string[] {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return geo.provinces.map((p) => {
    let d = '';
    for (const poly of p.polygons) for (const ring of poly) {
      if (ring.length < 3) continue;
      ring.forEach((pt, i) => {
        const [x, y] = frame.project(pt[0], pt[1]);
        d += `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`;
      });
      d += 'Z';
    }
    return d;
  });
}

/**
 * Draw one map: ground, provinces, then every dot with a small halo, in passes: blue, then red, then yellow on top (the
 * few yellow dots stay visible). Both maps are drawn the same way, so their density compares; crowded places build up
 * into solid colour rather than washing out to white.
 */
export function drawCompareMap(
  ctx: CanvasRenderingContext2D, frame: MapFrame, provinces: readonly string[], dots: readonly PlacedDot[], side: CompareSide,
): void {
  ctx.save();
  ctx.fillStyle = COMPARE_COLORS.ground;
  ctx.fillRect(0, 0, frame.width, frame.height);
  ctx.fillStyle = COMPARE_COLORS.land;
  ctx.strokeStyle = COMPARE_COLORS.border;
  ctx.lineWidth = Math.max(0.5, frame.width / 1200);
  for (const d of provinces) {
    const p = new Path2D(d);
    ctx.fill(p, 'evenodd');
    ctx.stroke(p);
  }
  ctx.shadowBlur = Math.max(2, frame.width / 160);
  for (const color of ['blue', 'red', 'yellow'] as const) {
    ctx.shadowColor = COMPARE_COLORS.swatch[color];
    ctx.fillStyle = COMPARE_COLORS.dot[color];
    for (const d of dots) {
      if (dotColor(side, d.cls) !== color) continue;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Words and numbers
// ---------------------------------------------------------------------------

/** "₱43.2 billion", "₱512 million". */
export function phpWords(v: number): string {
  if (Math.abs(v) >= 1e9) return `₱${(v / 1e9).toFixed(1)} billion`;
  return `₱${Math.round(v / 1e6).toLocaleString('en-US')} million`;
}
export const signed = (v: number, f: (x: number) => string) => (v > 0 ? `+${f(v)}` : v < 0 ? `−${f(-v)}` : f(0));
export const pct = (to: number, from: number) => (from ? Math.round(((to - from) / from) * 100) : null);

// ---------------------------------------------------------------------------
// The figure's words: one builder for the page and the downloadable image, so they never differ
// ---------------------------------------------------------------------------

const n = (v: number) => v.toLocaleString('en-US');
/** "₱43.2B". */
export const phpShort = (v: number) => `₱${(v / 1e9).toFixed(1)}B`;
export const MPB_COMPARE_URL = 'budget.bettergov.ph/hgab/2027/multi-purpose/nep-vs-house-bill';
export const MPB_COMPARE_IMAGE_NAME = 'bettergov-multi-purpose-buildings-2027-nep-vs-house-bill.png';

/** "November 2, 2026", in Manila. */
export function asOfDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });
}

export interface CompareCell { strong: string; span: string; tone: CompareSide | null }
export interface CompareSideCopy { name: string; sub: string; php: string; lines: string }
export interface CompareCopy {
  kicker: string;
  /** The headline in runs; `house` runs are drawn in the House bill's red. */
  title: Array<{ text: string; house?: boolean }>;
  /** The change between the two totals. */
  cells: CompareCell[];
  sides: Record<CompareSide, CompareSideCopy>;
  legend: Array<{ color: DotColor; label: string }>;
  sizes: Array<{ php: number; label: string }>;
  notes: string;
  source: [string, string];
}

export function compareCopy(f: CompareFigures, builtAt: string, offMap = 0): CompareCopy {
  const change = f.house.php - f.nep.php;
  const p = pct(f.house.php, f.nep.php) ?? 0;
  const side = (s: CompareSide): CompareSideCopy => {
    const t = s === 'nep' ? f.nep : f.house;
    return {
      name: s === 'nep' ? 'NEP' : 'House bill',
      sub: s === 'nep' ? 'The President’s budget' : 'House Bill 10858, third reading',
      php: phpShort(t.php),
      lines: `${n(t.lines)} lines`,
    };
  };
  return {
    kicker: 'Multi-purpose buildings · 2027 budget',
    title: [{ text: `${phpWords(f.nep.php)} in the NEP. ` }, { text: phpWords(f.house.php), house: true }, { text: ' in the House bill.' }],
    cells: [
      { strong: `${signed(change, phpWords)} in the House bill`, span: p >= 0 ? `${p}% more than the NEP (${phpShort(f.nep.php)} → ${phpShort(f.house.php)})` : `${-p}% less than the NEP`, tone: 'house' },
      { strong: `${signed(f.house.lines - f.nep.lines, n)} lines`, span: `${n(f.nep.lines)} in the NEP → ${n(f.house.lines)} in the House bill`, tone: null },
    ],
    sides: { nep: side('nep'), house: side('house') },
    legend: [
      { color: 'blue', label: 'In the NEP' },
      { color: 'red', label: 'Added in the House bill' },
      { color: 'yellow', label: 'In the NEP, not in the House bill' },
    ],
    sizes: [5e6, 25e6, 100e6].map((v) => ({ php: v, label: phpWords(v).replace(' million', 'M') })),
    notes: 'One dot is one budget line, sized by its amount and placed by the place its title names (GPS where published). '
      + 'On the House bill map, red marks lines with no matching NEP line, and yellow marks NEP lines with no matching '
      + 'House bill line. Both are candidates, not confirmed changes; yellow lines are not in the House bill’s total. '
      + 'Amounts are allocations, not spending.'
      + (offMap > 0 ? ` ${n(offMap)} House bill lines in the Kalayaan islands are counted but off the map’s edge.` : ''),
    source: [
      'Source: NEP 2027 (DBM) and House Bill 10858, third reading; DPWH multi-purpose building lines',
      `${MPB_COMPARE_URL} · As of ${asOfDate(builtAt)}`,
    ],
  };
}
