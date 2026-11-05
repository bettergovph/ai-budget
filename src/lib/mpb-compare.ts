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
 * the line's amount. Drawn with additive blending on a dark ground, so crowded places glow.
 */
import type { MpbClass, MpbData, MpbLine } from './hgab-mpb-years';
import type { HgabGeo, RegionKey } from './hgab';

export const MPB_COMPARE_ROOT = '/hgab/2027/multi-purpose/nep-vs-house-bill';
export const MPB_COMPARE_TITLE = 'Multi-purpose buildings: NEP vs House bill';

export type CompareSide = 'nep' | 'house';
export type CompareClass = Exclude<MpbClass, null>;

/** "In the House bill only" is a candidate: no matching NEP line was found. Said wherever it is shown. */
export const HOUSE_ONLY_NOTE = '“In the House bill only” means no matching NEP line was found: a candidate, not a confirmed insertion.';
export const COMPARE_LABELS: Record<CompareClass, string> = {
  house_only: 'In the House bill only',
  nep_only: 'In the NEP only',
  paired: 'In both',
};

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
  houseOnly: Tally;
  nepOnly: Tally;
}

/** The figures by region (a line's region; null where none), largest House bill amount first. */
export function compareByRegion(data: MpbData): RegionRow[] {
  const by = new Map<RegionKey | null, RegionRow>();
  for (const l of lines2027(data)) {
    const r = by.get(l.region) ?? { region: l.region, nep: { lines: 0, php: 0 }, house: { lines: 0, php: 0 }, houseOnly: { lines: 0, php: 0 }, nepOnly: { lines: 0, php: 0 } };
    if (l.nep != null) { r.nep.lines++; r.nep.php += l.nep; }
    if (l.house != null) { r.house.lines++; r.house.php += l.house; }
    if (l.cls === 'house_only') { r.houseOnly.lines++; r.houseOnly.php += l.house ?? 0; }
    if (l.cls === 'nep_only') { r.nepOnly.lines++; r.nepOnly.php += l.nep ?? 0; }
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
 * barangay with 30 lines shows 30 dots. Highlighted dots (House only, NEP only) are placed last, to draw on top.
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
  const order: Record<CompareClass, number> = { paired: 0, nep_only: 1, house_only: 1 };
  return out.sort((a, b) => order[a.cls] - order[b.cls] || b.r - a.r);
}

// ---------------------------------------------------------------------------
// Drawing (a 2D canvas: the page, and later the poster)
// ---------------------------------------------------------------------------

export const COMPARE_COLORS = {
  ground: '#0c1322',
  land: '#1a2436',
  border: '#2a3750',
  paired: 'rgba(146, 172, 214, 0.34)',
  house_only: 'rgba(255, 64, 64, 0.72)',
  nep_only: 'rgba(255, 190, 60, 0.85)',
  /** Solid swatches for legends and figures. */
  swatch: { paired: '#92acd6', house_only: '#ff4848', nep_only: '#ffbe3c' } as Record<CompareClass, string>,
} as const;

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
 * Draw one map: ground, provinces, then every dot. Lines in both are added together, so crowded places glow; the
 * lines only one side has (House bill only, NEP only) go on top in their own colour with a small halo, so a dense
 * cluster of them stays red (or amber) instead of washing out to white.
 */
export function drawCompareMap(ctx: CanvasRenderingContext2D, frame: MapFrame, provinces: readonly string[], dots: readonly PlacedDot[]): void {
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
  const dot = (d: PlacedDot) => {
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fillStyle = COMPARE_COLORS[d.cls];
    ctx.fill();
  };
  ctx.globalCompositeOperation = 'lighter';
  for (const d of dots) if (d.cls === 'paired') dot(d);
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = Math.max(2, frame.width / 160);
  for (const d of dots) {
    if (d.cls === 'paired') continue;
    ctx.shadowColor = COMPARE_COLORS.swatch[d.cls];
    dot(d);
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
