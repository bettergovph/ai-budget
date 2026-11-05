/**
 * Budgets side by side: the figures, and every line as a dot on maps drawn the same way. One page per topic
 * (`CompareTopic`):
 *   - multi-purpose buildings (`/hgab/2027/multi-purpose/nep-vs-house-bill`): the 2027 NEP and the House bill, two maps;
 *   - flood control (`/hgab/2027/flood-control`, "Flood control projects are back"): the 2025 and 2026 budgets and 2027,
 *     three maps; the 2027 map holds the NEP and the House bill together, told apart by colour.
 *
 * Jason (2026-11-05): "a different page side by side comparison of 2027's NEP vs HGAB for multi-purpose buildings …
 * more points visible in the philippines to demonstrate the density and intensity of the changes … numbers visible
 * … take a screenshot of the section for publishing. Poster can follow after." Then: "grab the flood control
 * projects. With our title 'Flood control projects are back'", and "the proper comparison is 2025, 2026, and 2027. For
 * 2027 combine both nep and gab but with just different colours".
 *
 * Data: lines in the multi-purpose map's format, and the province outlines (geo/provinces.json). Multi-purpose
 * buildings: the map's own lines (mpb-years/lines.json). Flood control: the chart's flood control lines, placed the same
 * way (flood-compare/lines.json, `npm run build:hgab-flood-compare`). Every figure here is computed from them; the
 * verifier checks the totals against each build's summary. Pure, apart from `drawCompareMap`, which only needs a 2D
 * canvas context, so the poster can draw the same maps.
 *
 * Dots: one per line, never grouped. A line sits at its first GPS point, else at the centre of the place its title
 * names (or its office's area). Lines at the same spot fan out in a sunflower so each stays visible; dot area follows
 * the line's amount. A budget's own map is all blue. The House bill map, and flood control's 2027 map (Jason,
 * 2026-11-05: "can the existing ones be blue while the added ones are red, the ones not existing as yellow"), shows the
 * House bill's lines the NEP has too in blue, the added ones in red, and the NEP's lines it does not have in yellow,
 * where they were (not part of its total).
 *
 * The figure compares totals only (Jason, 2026-11-05: "we don't need the in the nep only but let's just compare the
 * totals for both"): no breakdown into lines in both, in one document only.
 */
import type { MpbClass, MpbData, MpbLine } from './hgab-mpb-years';
import type { HgabGeo, RegionKey } from './hgab';

export const MPB_COMPARE_ROOT = '/hgab/2027/multi-purpose/nep-vs-house-bill';
export const MPB_COMPARE_TITLE = 'Multi-purpose buildings: NEP vs House bill';
export const FLOOD_COMPARE_ROOT = '/hgab/2027/flood-control';
export const FLOOD_COMPARE_TITLE = 'Flood control, 2025 to 2027';

export type CompareClass = Exclude<MpbClass, null>;
export type BudgetKey = 'gaa-2025' | 'gaa-2026' | 'nep-2027' | 'house-2027';
export const BUDGET_KEYS: readonly BudgetKey[] = ['gaa-2025', 'gaa-2026', 'nep-2027', 'house-2027'];
export const BUDGET_LABELS: Record<BudgetKey, string> = {
  'gaa-2025': '2025', 'gaa-2026': '2026', 'nep-2027': '2027 NEP', 'house-2027': '2027 House bill',
};
/**
 * A map: one budget's lines (`nep`, `gaa-2025`, `gaa-2026`), or the House bill's with the NEP lines it lacks
 * (`house` on the multi-purpose page, `fy2027` on flood control's: the same dots, named for what the map shows).
 */
export type PanelKey = 'nep' | 'house' | 'gaa-2025' | 'gaa-2026' | 'fy2027';
export type CompareTopicKey = 'mpb' | 'flood';

/** One comparison page: its address, its maps and budgets, its words, and the legend's dot sizes. */
export interface CompareTopic {
  key: CompareTopicKey;
  root: string;
  title: string;
  /** The large title's first line: the subject (Jason, 2026-11-05: "we forgot to put 'Multi Purpose Buildings' … as part of the large title"). */
  subject: string;
  /** What a line is, plural: "multi-purpose building lines". */
  lineWords: string;
  /** The maps, left to right. */
  panels: PanelKey[];
  /** The budgets compared, oldest first (the region table's columns). */
  budgets: BudgetKey[];
  /** The source line. */
  source: string;
  /** One sentence on what the topic covers, for the notes; empty when the subject says it. */
  scope: string;
  /** The page's address, printed on the figure. */
  url: string;
  imageName: string;
  /** The legend's dot sizes (the radius scale is the same for every topic, so the pages compare). */
  sizes: number[];
}

export const COMPARE_TOPICS: Record<CompareTopicKey, CompareTopic> = {
  mpb: {
    key: 'mpb', root: MPB_COMPARE_ROOT, title: MPB_COMPARE_TITLE, subject: 'Multi-purpose buildings',
    lineWords: 'multi-purpose building lines', panels: ['nep', 'house'], budgets: ['nep-2027', 'house-2027'],
    source: 'Source: NEP 2027 (DBM) and House Bill 10858, third reading; DPWH multi-purpose building lines', scope: '',
    url: 'budget.bettergov.ph/hgab/2027/multi-purpose/nep-vs-house-bill',
    imageName: 'bettergov-multi-purpose-buildings-2027-nep-vs-house-bill.png', sizes: [5e6, 25e6, 100e6],
  },
  flood: {
    // Jason, 2026-11-05: "With our title 'Flood control projects are back'".
    key: 'flood', root: FLOOD_COMPARE_ROOT, title: FLOOD_COMPARE_TITLE, subject: 'Flood control projects are back',
    lineWords: 'flood control lines', panels: ['gaa-2025', 'gaa-2026', 'fy2027'], budgets: [...BUDGET_KEYS],
    source: 'Source: GAA 2025 and 2026, NEP 2027 (DBM), House Bill 10858, third reading; DPWH flood control lines',
    scope: 'Flood control here is the DPWH Flood Management Program, with BIP and SIPAG flood mitigation in 2025, as on our budget-by-year chart.',
    url: 'budget.bettergov.ph/hgab/2027/flood-control',
    imageName: 'bettergov-flood-control-2025-2027.png', sizes: [10e6, 50e6, 250e6],
  },
};

/** What a page draws from: the lines, when they were built, the province outlines, and the budgets paid for wholly with foreign loans or grants. */
export interface CompareInput { data: MpbData; builtAt: string; geo: HgabGeo; foreignOnly: BudgetKey[] }

export const FLOOD_LINES_PATH = 'hgab/2027/flood-compare/lines.json';
export const FLOOD_SUMMARY_PATH = 'hgab/2027/flood-compare/summary.json';

/** flood-compare/summary.json (scripts/hgab-flood-compare/build.py). */
export interface FloodCompareSummary {
  schema: 1;
  built_at: string;
  program: string;
  budgets: Array<{
    key: BudgetKey; fy: number; stage: 'gaa' | 'nep' | 'house'; lines: number; php: number;
    /** The flood control series on the chart by year (history.json); equals `php`. */
    history_php: number;
    /** The chart's foreign-assisted part (paid with foreign loans or grants). */
    foreign_php: number | null;
    levels: Record<string, number>;
    /** Lines with no place on the map: counted, not drawn. */
    not_drawn: Tally;
    classes: Record<string, number>;
  }>;
  /** GAA head-office lines the title matcher cannot read: placed by the one province named, or at the listed region. */
  head_office: Record<string, { province_named: number; listed_region: number }>;
  /** FY2027 lines budgeted nationwide: counted, not on the map. */
  nationwide: { lines: number; nep_php: number; house_php: number };
  checks: Array<{ key: string; ok: boolean; detail: string }>;
}

/** The budgets the chart says were paid for wholly with foreign loans or grants (FY2026's flood control). */
export function foreignOnlyBudgets(s: FloodCompareSummary): BudgetKey[] {
  return s.budgets.filter((b) => b.php > 0 && b.foreign_php === b.php).map((b) => b.key);
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

export interface Tally { lines: number; php: number }

export interface CompareFigures {
  /** Every budget's lines and amount (a budget the data does not hold is zero). */
  budgets: Record<BudgetKey, Tally>;
  /** The lines of each budget with no place on the map: counted, not drawn. */
  undrawn: Record<BudgetKey, Tally>;
  nep: Tally;
  house: Tally;
  houseOnly: Tally;
  nepOnly: Tally;
  /** Lines in both: their NEP and House bill amounts, and how many are higher, lower or the same in the House bill. */
  paired: { lines: number; nep_php: number; house_php: number; higher: number; lower: number; same: number };
  /** FY2027 lines with no place on the map: budgeted nationwide (flood control has a few; multi-purpose buildings none). */
  unmapped: { lines: number; nep_php: number; house_php: number };
}

/** A line's amount in a budget, or null when the budget does not hold it. */
export function budgetAmount(l: MpbLine, key: BudgetKey): number | null {
  switch (key) {
    case 'gaa-2025': return l.fy === 2025 ? l.gaa : null;
    case 'gaa-2026': return l.fy === 2026 ? l.gaa : null;
    case 'nep-2027': return l.fy === 2027 ? l.nep : null;
    case 'house-2027': return l.fy === 2027 ? l.house : null;
  }
}

const lines2027 = (data: MpbData) => data.lines.filter((l) => l.fy === 2027 && l.cls != null);
const tallies = () => Object.fromEntries(BUDGET_KEYS.map((k) => [k, { lines: 0, php: 0 }])) as Record<BudgetKey, Tally>;

export function compareFigures(data: MpbData): CompareFigures {
  const t = (): Tally => ({ lines: 0, php: 0 });
  const f: CompareFigures = {
    budgets: tallies(), undrawn: tallies(), nep: t(), house: t(), houseOnly: t(), nepOnly: t(),
    paired: { lines: 0, nep_php: 0, house_php: 0, higher: 0, lower: 0, same: 0 },
    unmapped: { lines: 0, nep_php: 0, house_php: 0 },
  };
  for (const l of data.lines) {
    if (l.fy !== 2025 && l.fy !== 2026 && l.fy !== 2027) continue;
    const drawn = linePoint(data, l) != null;
    for (const k of BUDGET_KEYS) {
      const v = budgetAmount(l, k);
      if (v == null) continue;
      f.budgets[k].lines++; f.budgets[k].php += v;
      if (!drawn) { f.undrawn[k].lines++; f.undrawn[k].php += v; }
    }
  }
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
    if (!linePoint(data, l)) {
      f.unmapped.lines++; f.unmapped.nep_php += l.nep ?? 0; f.unmapped.house_php += l.house ?? 0;
    }
  }
  return f;
}

export interface RegionRow {
  region: RegionKey | null;
  by: Record<BudgetKey, Tally>;
}

/** The totals by region (a line's region; null where none) for the budgets given, largest in the last budget first. */
export function compareByRegion(data: MpbData, budgets: readonly BudgetKey[]): RegionRow[] {
  const by = new Map<RegionKey | null, RegionRow>();
  for (const l of data.lines) {
    for (const k of budgets) {
      const v = budgetAmount(l, k);
      if (v == null) continue;
      const r = by.get(l.region) ?? { region: l.region, by: tallies() };
      r.by[k].lines++; r.by[k].php += v;
      by.set(l.region, r);
    }
  }
  const last = budgets[budgets.length - 1];
  const first = budgets[0];
  return [...by.values()].sort((a, b) => b.by[last].php - a.by[last].php || a.by[first].php - b.by[first].php);
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

export type DotColor = 'blue' | 'red' | 'yellow';
export interface CompareDot { lon: number; lat: number; php: number; color: DotColor }

/** A GAA year's map is one colour: 2025 red (Jason, 2026-11-05: "Make 2025 red themed"), 2026 blue. */
export const GAA_PANEL_COLOR: Record<'gaa-2025' | 'gaa-2026', DotColor> = { 'gaa-2025': 'red', 'gaa-2026': 'blue' };

/**
 * The dots a map draws. A budget's own map: its lines, in one colour (the NEP blue; GAA_PANEL_COLOR). The House bill map (and flood control's 2027 map): the
 * House bill's lines, blue when the NEP has them too and red when added, then the NEP lines it does not have, yellow,
 * at their NEP amount (outside its total).
 */
export function panelDots(data: MpbData, panel: PanelKey): CompareDot[] {
  const out: CompareDot[] = [];
  const push = (l: MpbLine, php: number, color: DotColor) => {
    const at = linePoint(data, l);
    if (at) out.push({ lon: at[0], lat: at[1], php, color });
  };
  if (panel === 'gaa-2025' || panel === 'gaa-2026') {
    for (const l of data.lines) {
      const v = budgetAmount(l, panel);
      if (v != null) push(l, v, GAA_PANEL_COLOR[panel]);
    }
    return out;
  }
  const fy27 = lines2027(data);
  if (panel === 'nep') {
    for (const l of fy27) if (l.nep != null) push(l, l.nep, 'blue');
    return out;
  }
  for (const l of fy27) if (l.house != null) push(l, l.house, l.cls === 'house_only' ? 'red' : 'blue');
  for (const l of fy27) if (l.cls === 'nep_only' && l.nep != null) push(l, l.nep, 'yellow');
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

/** The frame width the legend's dot sizes are drawn at: the figure's 1200 units shared by its maps. */
export const legendWidth = (panels: number) => 1200 / panels;

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

export const COMPARE_COLORS = {
  ground: '#0c1322',
  land: '#1a2436',
  border: '#2a3750',
  /** Dots: blue = in the budget (on the House bill map: and in the NEP), red = added in the House bill, yellow = in the NEP, not the House bill. */
  dot: { blue: 'rgba(150, 182, 232, 0.66)', red: 'rgba(255, 64, 64, 0.72)', yellow: 'rgba(255, 204, 64, 0.92)' } as Record<DotColor, string>,
  /** Solid swatches for legends and halos. */
  swatch: { blue: '#96b6e8', red: '#ff4848', yellow: '#ffcc40' } as Record<DotColor, string>,
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
 * Draw one map: ground, provinces, then every dot with a small halo, in passes: blue, then red, then yellow on top (the
 * few yellow dots stay visible). Every map is drawn the same way, so their density compares; crowded places build up
 * into solid colour rather than washing out to white.
 */
export function drawCompareMap(
  ctx: CanvasRenderingContext2D, frame: MapFrame, provinces: readonly string[], dots: readonly PlacedDot[],
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
      if (d.color !== color) continue;
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

/** "November 2, 2026", in Manila. */
export function asOfDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });
}

/** `tone: 'red'`: drawn in red, the House bill's colour (and flood control's 2025: Jason, 2026-11-05, "Make 2025 red themed"). */
export interface CompareCell { strong: string; span: string; tone: 'red' | null }
/** An amount on a map's label; `label` names it when the map shows two (flood control's 2027: NEP, House bill). */
export interface CompareAmount { php: string; label: string | null; tone: 'red' | null }
export interface ComparePanelCopy { key: PanelKey; name: string; sub: string; amounts: CompareAmount[]; lines: string }
export interface CompareCopy {
  kicker: string;
  /** The headline, line by line, each in runs; `red` runs are drawn in red. It names the subject first. */
  title: Array<Array<{ text: string; red?: boolean }>>;
  /** The changes between the totals. */
  cells: CompareCell[];
  /** One per map, left to right. */
  panels: ComparePanelCopy[];
  /** Names what the legend explains when the colours mean something on one map only (flood control: "On the 2027 map:"). */
  legendTitle: string | null;
  legend: Array<{ color: DotColor; label: string }>;
  sizes: Array<{ php: number; label: string }>;
  notes: string;
  source: [string, string];
}

const DOTS_NOTE = 'One dot is one budget line, sized by its amount and placed by the place its title names (GPS where published). ';
const CANDIDATES_NOTE = 'Both are candidates, not confirmed changes; yellow lines are not in the House bill’s total. ';

export function compareCopy(
  topic: CompareTopic, f: CompareFigures, builtAt: string, opts: { offMap?: number; foreignOnly?: readonly BudgetKey[] } = {},
): CompareCopy {
  const { offMap = 0, foreignOnly = [] } = opts;
  const B = f.budgets;
  const nepVsHouse: CompareCell = (() => {
    const p = pct(f.house.php, f.nep.php) ?? 0;
    return {
      strong: `${signed(f.house.php - f.nep.php, phpWords)} in the House bill`,
      span: `${Math.abs(p)}% ${p >= 0 ? 'more' : 'less'} than the NEP (${phpShort(f.nep.php)} → ${phpShort(f.house.php)})`,
      tone: 'red',
    };
  })();
  const tail = 'Amounts are allocations, not spending.'
    + (offMap > 0 ? ` ${n(offMap)} House bill lines in the Kalayaan islands are counted but off the map’s edge.` : '')
    + (f.unmapped.lines > 0
      ? ` ${n(f.unmapped.lines)} lines budgeted nationwide (${phpWords(f.unmapped.house_php)} in the House bill) are counted but not on the map.`
      : '');
  const shared = {
    sizes: topic.sizes.map((v) => ({ php: v, label: phpWords(v).replace(' million', 'M') })),
    source: [topic.source, `${topic.url} · As of ${asOfDate(builtAt)}`] as [string, string],
  };
  const one = (php: number, tone: 'red' | null = null): CompareAmount[] => [{ php: phpShort(php), label: null, tone }];

  if (topic.key === 'flood') {
    const [g25, g26] = [B['gaa-2025'], B['gaa-2026']];
    const drop = pct(g26.php, g25.php) ?? 0;
    return {
      kicker: 'DPWH flood control · 2025, 2026 and 2027 budgets',
      title: [
        [{ text: topic.subject }],
        [{ text: `${phpWords(g25.php)} in 2025.`, red: true }, { text: ` ${phpWords(g26.php)} in 2026.` }],
        [{ text: phpWords(f.house.php), red: true }, { text: ' in the 2027 House bill.' }],
      ],
      cells: [
        { strong: `${signed(g26.php - g25.php, phpWords)} in 2026`, span: `${Math.abs(drop)}% less than 2025 (${phpShort(g25.php)} → ${phpShort(g26.php)})`, tone: null },
        { strong: `${signed(f.nep.php - g26.php, phpWords)} in the 2027 NEP`, span: `${phpShort(g26.php)} in 2026 → ${phpShort(f.nep.php)} in the President’s budget`, tone: null },
        nepVsHouse,
      ],
      panels: [
        { key: 'gaa-2025', name: '2025', sub: 'The 2025 budget (GAA)', amounts: one(g25.php, 'red'), lines: `${n(g25.lines)} lines` },
        {
          key: 'gaa-2026', name: '2026',
          sub: `The 2026 budget (GAA)${foreignOnly.includes('gaa-2026') ? ', all foreign-assisted' : ''}`,
          amounts: one(g26.php), lines: `${n(g26.lines)} lines`,
        },
        {
          key: 'fy2027', name: '2027', sub: 'The NEP and House Bill 10858',
          amounts: [{ php: phpShort(f.nep.php), label: 'NEP', tone: null }, { php: phpShort(f.house.php), label: 'House bill', tone: 'red' }],
          lines: `${n(f.nep.lines)} → ${n(f.house.lines)} lines`,
        },
      ],
      legendTitle: 'On the 2027 map:',
      legend: [
        { color: 'blue', label: 'In the NEP and the House bill' },
        { color: 'red', label: 'Added in the House bill' },
        { color: 'yellow', label: 'In the NEP, not in the House bill' },
      ],
      notes: `${topic.scope} ${DOTS_NOTE}`
        + 'Head-office lines that name no place sit at the region the budget lists them under. '
        + 'The 2025 map’s lines are red, the 2026 map’s blue. '
        + 'On the 2027 map, red marks House bill lines with no matching NEP line, and yellow marks NEP lines with no '
        + `matching House bill line. ${CANDIDATES_NOTE}${tail}`,
      ...shared,
    };
  }

  return {
    kicker: '2027 budget · NEP vs House bill',
    title: [
      [{ text: topic.subject }],
      [{ text: `${phpWords(f.nep.php)} in the NEP. ` }, { text: phpWords(f.house.php), red: true }, { text: ' in the House bill.' }],
    ],
    cells: [
      nepVsHouse,
      { strong: `${signed(f.house.lines - f.nep.lines, n)} lines`, span: `${n(f.nep.lines)} in the NEP → ${n(f.house.lines)} in the House bill`, tone: null },
    ],
    panels: [
      { key: 'nep', name: 'NEP', sub: 'The President’s budget', amounts: one(f.nep.php), lines: `${n(f.nep.lines)} lines` },
      { key: 'house', name: 'House bill', sub: 'House Bill 10858, third reading', amounts: one(f.house.php, 'red'), lines: `${n(f.house.lines)} lines` },
    ],
    legendTitle: null,
    legend: [
      { color: 'blue', label: 'In the NEP' },
      { color: 'red', label: 'Added in the House bill' },
      { color: 'yellow', label: 'In the NEP, not in the House bill' },
    ],
    notes: `${topic.scope ? `${topic.scope} ` : ''}${DOTS_NOTE}`
      + 'On the House bill map, red marks lines with no matching NEP line, and yellow marks NEP lines with no matching '
      + `House bill line. ${CANDIDATES_NOTE}${tail}`,
    ...shared,
  };
}
