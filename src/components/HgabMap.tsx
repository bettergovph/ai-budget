/**
 * The Map tab of a dataset hub (`/hgab/2027/:dataset?view=map`).
 *
 * Two layers in one inline SVG, no map library and no tiles:
 *   1. regions — every province filled by its region's figure: the change
 *      (House bill − NEP, diverging) or either version's
 *      amount (sequential, one shared maximum);
 *   2. dots — the projects whose documents give coordinates, coloured by how
 *      the two versions differ, unconfirmed matches hollow. Farm-to-market
 *      roads also draw their published road segments once a region is zoomed in.
 *
 * Performance: outlines and dot paths are built once per data load
 * (`lib/hgab-map.ts`). Each group's dots are one `<path>`, so ~2,400 dots are a
 * few dozen DOM nodes; hit-testing is a nearest-dot scan in the pointer
 * handler, there is one tooltip, and zooming animates the viewBox attribute
 * directly (no React render per frame). The layers are memoised, so hovering
 * re-renders only the outline overlay and the tooltip.
 *
 * Accessibility: the SVG is one `role="img"` with a sentence-long label; the
 * region table beside it is the accessible equivalent and every row is a
 * button (zoom) plus a link (the region's projects).
 *
 * Copy: plain words only. No "bridge", "ledger", "control", "trace" or
 * "stage" on screen; amounts are short with exact pesos on hover; the two
 * versions are compared, never added.
 */
import {
  memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent, type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SectionHead } from './shared';
import { Amt, DeltaCell } from './HgabProjects';
import * as fmt from '../lib/format';
import {
  BRIDGE_LABELS, DATA_BASE_OVERRIDE, REGION_LABELS, STAGE_LABELS, datasetPath, formatPct,
  loadHgabGeo, loadHgabMap, pctChange, recordPath, traceInfo,
  type DatasetKey, type HgabDatasetMap, type HgabDatasetMeta, type HgabGeo, type MapPoint, type RegionKey,
} from '../lib/hgab';
import {
  DOT_ORDER, DOT_PAINT_ORDER, MEASURE_ORDER, boxToViewBox, buildProvinceShapes, clip, count, easeInOut, fitBox,
  groupRegions, lerpBox, makeProjection, measureValue, nearestPoint, plural, projectPoints, projectsRegionLabel,
  regionScale, regionValues, sortRegions,
  type Box, type DotKey, type Measure, type ProjectedPoints, type Projection, type RegionScale, type RegionShape,
  type RegionSort, type RegionValue,
} from '../lib/hgab-map';
import { COMPARE_NOT_ADD, PLAIN } from '../lib/hgab-ui';
import '../hgab-map.css';

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const MEASURE_BUTTON: Record<Measure, string> = {
  delta: 'Change (House bill − NEP)',
  nep: 'NEP',
  house: 'House bill',
};

/** The noun for the comparison lines, for the coverage line. */
const ROW_NOUN: Record<DatasetKey, string> = {
  dpwh: 'DPWH projects',
  fmr: 'farm-to-market road projects',
  hfep: 'health facility lines',
  nia: 'irrigation projects',
};

const DOT_LABELS: Record<DotKey, { label: string; sub: string }> = {
  ...Object.fromEntries(Object.entries(BRIDGE_LABELS).map(([k, v]) => [k, { label: v.label, sub: v.sub }])),
  other: { label: 'Not sorted into a group', sub: 'shown for completeness' },
} as Record<DotKey, { label: string; sub: string }>;

/** Pointer distance, in screen pixels, that still counts as "on" a dot. */
const HIT_PX = 12;
const ZOOM_MS = 520;
/** Free zoom: the closest view is the whole map divided by this. */
const MAX_ZOOM = 40;
/** From this scale the map counts as zoomed in: bigger dots, road lines drawn. */
const ZOOMED_AT = 1.6;
/** One press of + or −, and one arrow-key step as a share of the view. */
const ZOOM_STEP = 1.6;
const PAN_STEP = 0.2;
const STEP_MS = 240;
/** Pixels a press may travel and still count as a click, not a drag. */
const DRAG_SLOP = 5;

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function exact(v: number | null | undefined): string | undefined {
  return v == null ? undefined : fmt.php(v, { unit: 'full' });
}

/** "₱1.23B" for tooltips and prose (tables use the bare short form like the rest of the hub). */
function peso(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v === 0 ? '₱0' : `₱${fmt.shortPhp(v)}`;
}

function signedPeso(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v === 0) return '₱0';
  return `${v > 0 ? '+' : '−'}₱${fmt.shortPhp(Math.abs(v))}`;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

interface Loaded {
  key: DatasetKey;
  map: HgabDatasetMap | null;
  geo: HgabGeo | null;
  err: string | null;
}

export default function HgabMap({ dataset }: { dataset: HgabDatasetMeta }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = dataset.key;

  useEffect(() => {
    let live = true;
    Promise.allSettled([loadHgabMap(key), loadHgabGeo()]).then(([m, g]) => {
      if (!live) return;
      const map = m.status === 'fulfilled' ? m.value : null;
      const geo = g.status === 'fulfilled' ? g.value : null;
      const err = m.status === 'rejected' ? errText(m.reason) : g.status === 'rejected' ? errText(g.reason) : null;
      setLoaded({ key, map, geo, err });
    });
    return () => { live = false; };
  }, [key]);

  const cur = loaded?.key === key ? loaded : null;
  if (!cur) return <p className="nep-empty" role="status" aria-busy="true">Loading the map…</p>;
  if (cur.map && cur.map.placeable === false) return <NotPlaceable dataset={dataset} map={cur.map} />;
  if (!cur.map || !cur.geo) return <MapError dataset={dataset} message={cur.err ?? 'The map files are missing.'} />;
  return <MapView key={key} dataset={dataset} map={cur.map} geo={cur.geo} />;
}

function MapError({ dataset, message }: { dataset: HgabDatasetMeta; message: string }) {
  return (
    <div className="hgab-map-panel is-error" role="alert">
      <p className="hgab-map-panel-title">The map could not be loaded.</p>
      <p>
        The figures by region are still in the{' '}
        <Link to={datasetPath(dataset.key)}>Overview tab</Link>, and every project is in the{' '}
        <Link to={datasetPath(dataset.key, 'projects')}>Projects tab</Link>.
      </p>
      <details className="hgab-map-maint">
        <summary>For maintainers</summary>
        <p><code>{message}</code></p>
        <p>
          The map reads <code>hgab/2027/geo/provinces.json</code> (province outlines) and{' '}
          <code>hgab/2027/{dataset.key}/map.json</code> (figures by region and project dots). Build them
          with <code>npm run build:hgab-geo</code> after <code>npm run import:hgab</code>
          {DATA_BASE_OVERRIDE ? (
            <>
              {' '}and publish them with <code>npm run upload:hgab</code>: the browser is reading from{' '}
              <code>{DATA_BASE_OVERRIDE}</code> (<code>VITE_DATA_BASE_URL</code>).
            </>
          ) : (
            <>; in development they are served from the local <code>public/data</code> tree.</>
          )}
        </p>
      </details>
    </div>
  );
}

function NotPlaceable({ dataset, map }: { dataset: HgabDatasetMeta; map: HgabDatasetMap }) {
  return (
    <div className="hgab-map-panel">
      <p className="hgab-map-panel-title">There is no map for this program</p>
      <p>{map.note || 'The documents do not show where these projects are.'}</p>
      <NotOnMap map={map} onMap={false} />
      <p>
        <Link to={datasetPath(dataset.key, 'projects')}>See every project in the Projects tab →</Link>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

function MapView({ dataset, map, geo }: { dataset: HgabDatasetMeta; map: HgabDatasetMap; geo: HgabGeo }) {
  const proj = useMemo(() => makeProjection(geo.bbox), [geo]);
  const regions = useMemo(() => groupRegions(buildProvinceShapes(geo, proj)), [geo, proj]);
  const values = useMemo(() => regionValues(map, regions.map((r) => r.key)), [map, regions]);
  const valueByKey = useMemo(() => new Map(values.map((v) => [v.key, v] as const)), [values]);
  const pp = useMemo(() => projectPoints(map.points, proj), [map, proj]);

  const [measure, setMeasure] = useState<Measure>('delta');
  const [selected, setSelected] = useState<RegionKey | null>(null);
  const [rowHover, setRowHover] = useState<RegionKey | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<DotKey>>(() => new Set());
  const [showHeld, setShowHeld] = useState(true);
  const [showDots, setShowDots] = useState(true);
  const [sort, setSort] = useState<{ by: RegionSort; dir: 'asc' | 'desc' }>({ by: 'delta', dir: 'desc' });
  const mapRef = useRef<HTMLDivElement>(null);

  const scale = useMemo(() => regionScale(values, measure), [values, measure]);
  const classes = useMemo(() => {
    const out: Partial<Record<RegionKey, string>> = {};
    for (const v of values) out[v.key] = scale.classOf(measureValue(v, measure));
    return out;
  }, [values, scale, measure]);

  const hasPoints = map.points.length > 0;
  const dotsOn = hasPoints && showDots;
  const houseLabel = dataset.has_readings ? STAGE_LABELS[map.house_stage].label : 'House bill';
  const housePlain = dataset.has_readings ? `${STAGE_LABELS[map.house_stage].plain} (HB 10858)` : PLAIN.house;

  const rows = useMemo(() => sortRegions(values, sort.by, sort.dir), [values, sort]);

  const ariaLabel = useMemo(
    () => mapAriaLabel(values, measure, houseLabel, dotsOn ? map.points.length : 0, selected),
    [values, measure, houseLabel, dotsOn, map.points.length, selected],
  );

  const onSelect = useCallback((k: RegionKey) => setSelected(k), []);

  const toggleDot = (k: DotKey) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  function selectFromTable(k: RegionKey) {
    setSelected((prev) => (prev === k ? null : k));
    // On narrow screens the map sits above the table: bring it back into view.
    const el = mapRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 80 || r.top > window.innerHeight - 80) {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
      }
    }
  }

  const sel = selected ? valueByKey.get(selected) ?? null : null;

  // The site masthead is sticky and its height changes with the viewport;
  // publish it so the map fits below it and scrolls into view beneath it.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.masthead');
    const root = rootRef.current;
    if (!el || !root || typeof ResizeObserver === 'undefined') return;
    const set = () => root.style.setProperty('--hgab-map-top', `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="hgab-map" ref={rootRef}>
      <SectionHead
        eyebrow="Map"
        headline="Where the two versions differ, region by region"
        dek={
          <>
            Each region is shaded by how much more or less {housePlain} lists there than{' '}
            {PLAIN.nep}: blue where the House bill lists more, red where it lists less. Switch to see
            either version’s own amounts. They are {COMPARE_NOT_ADD}.
          </>
        }
      />

      <div className="hgab-map-controls">
        <div className="hgab-map-seg" role="group" aria-label="Shade the regions by">
          {MEASURE_ORDER.map((m) => (
            <button key={m} type="button" aria-pressed={measure === m} onClick={() => setMeasure(m)}>
              {MEASURE_BUTTON[m]}
            </button>
          ))}
        </div>
        <label className="hgab-map-select">
          <span>Zoom to</span>
          <select value={selected ?? ''} onChange={(e) => setSelected((e.target.value || null) as RegionKey | null)}>
            <option value="">Whole country</option>
            {regions.map((r) => (
              <option key={r.key} value={r.key}>
                {REGION_LABELS[r.key]?.name ?? r.key} ({REGION_LABELS[r.key]?.short ?? r.key})
              </option>
            ))}
          </select>
        </label>
        {hasPoints && (
          <label className="hgab-map-check">
            <input type="checkbox" checked={showDots} onChange={(e) => setShowDots(e.target.checked)} />
            <span>Show project dots</span>
          </label>
        )}
      </div>

      <div className="hgab-map-body">
        <figure className="hgab-map-figure">
          <div ref={mapRef} className="hgab-map-anchor">
            <MapCanvas
              dataset={dataset}
              points={map.points}
              proj={proj}
              regions={regions}
              valueByKey={valueByKey}
              classes={classes}
              selected={selected}
              externalHover={rowHover}
              pp={pp}
              hidden={hidden}
              showHeld={showHeld}
              showDots={dotsOn}
              houseLabel={houseLabel}
              ariaLabel={ariaLabel}
              onSelect={onSelect}
              onReset={() => setSelected(null)}
              selectedName={sel ? sel.name : null}
            />
          </div>

          <ScaleKey scale={scale} measure={measure} houseLabel={houseLabel} />

          {hasPoints && (
            <DotsKey
              pp={pp}
              hidden={hidden}
              showHeld={showHeld}
              disabled={!showDots}
              lines={pp.lineCount > 0}
              onToggle={toggleDot}
              onToggleHeld={() => setShowHeld((v) => !v)}
            />
          )}

          <figcaption className="hgab-map-caption">
            <Coverage dataset={dataset} map={map} />
            {map.note && <p>{map.note}</p>}
            <p className="hgab-map-credit">Province outlines: {geo.source}. Each province is shaded by its region’s figure.</p>
          </figcaption>
        </figure>

        <div className="hgab-map-side">
          <RegionTable
            dataset={dataset}
            rows={rows}
            sort={sort}
            onSort={setSort}
            scale={scale}
            measure={measure}
            selected={selected}
            houseLabel={houseLabel}
            onSelect={selectFromTable}
            onHover={setRowHover}
          />
          <NotOnMap map={map} />
        </div>
      </div>
    </div>
  );
}

function mapAriaLabel(
  values: RegionValue[],
  measure: Measure,
  houseLabel: string,
  dots: number,
  selected: RegionKey | null,
): string {
  const listed = values.filter((v) => v.listed);
  const parts = [`Map of the Philippines, ${listed.length} regions shaded by`];
  if (measure === 'delta') {
    parts[0] += ` the change from the NEP to the ${houseLabel}.`;
    const withDelta = listed.filter((v) => v.delta != null);
    const up = [...withDelta].sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))[0];
    const down = [...withDelta].sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))[0];
    if (up && (up.delta ?? 0) > 0) parts.push(`Largest increase: ${up.name}, ${signedPeso(up.delta)}.`);
    if (down && (down.delta ?? 0) < 0) parts.push(`Largest reduction: ${down.name}, ${signedPeso(down.delta)}.`);
  } else {
    parts[0] += measure === 'nep' ? ' the amounts in the NEP.' : ` the amounts in the ${houseLabel}.`;
    const top = [...listed].sort((a, b) => (measureValue(b, measure) ?? 0) - (measureValue(a, measure) ?? 0))[0];
    if (top) parts.push(`Largest: ${top.name}, ${peso(measureValue(top, measure))}.`);
  }
  if (dots) parts.push(`${count(dots)} project dots where the documents list coordinates.`);
  if (selected) parts.push(`Zoomed to ${REGION_LABELS[selected]?.name ?? selected}.`);
  parts.push('The table of regions lists every figure.');
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Canvas: SVG, hit-testing, zoom, tooltip
// ---------------------------------------------------------------------------

type Hover = { kind: 'point'; idx: number } | { kind: 'region'; key: RegionKey } | null;

function sameHover(a: Hover, b: Hover): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === 'point' ? a.idx === (b as { idx: number }).idx : a.key === (b as { key: RegionKey }).key;
}

/** Keep the tooltip inside the map frame: right of and below the pointer, flipped near the edges. */
function positionTip(frame: HTMLElement | null, tip: HTMLElement | null, pos: { x: number; y: number }) {
  if (!frame || !tip) return;
  const W = frame.clientWidth;
  const H = frame.clientHeight;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  let left = pos.x + 16;
  if (left + w > W - 4) left = pos.x - 16 - w;
  left = Math.max(Math.min(left, W - w - 4), Math.min(4, (W - w) / 2));
  let top = pos.y + 16;
  if (top + h > H - 4) top = pos.y - 16 - h;
  top = Math.max(4, top);
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

interface CanvasProps {
  dataset: HgabDatasetMeta;
  points: readonly MapPoint[];
  proj: Projection;
  regions: RegionShape[];
  valueByKey: Map<RegionKey, RegionValue>;
  classes: Partial<Record<RegionKey, string>>;
  selected: RegionKey | null;
  externalHover: RegionKey | null;
  pp: ProjectedPoints;
  hidden: ReadonlySet<DotKey>;
  showHeld: boolean;
  showDots: boolean;
  houseLabel: string;
  ariaLabel: string;
  selectedName: string | null;
  onSelect: (k: RegionKey) => void;
  onReset: () => void;
}

function MapCanvas({
  dataset, points, proj, regions, valueByKey, classes, selected, externalHover, pp, hidden, showHeld, showDots,
  houseLabel, ariaLabel, selectedName, onSelect, onReset,
}: CanvasProps) {
  const navigate = useNavigate();
  const svgRef = useRef<SVGSVGElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const posRef = useRef({ x: 0, y: 0 });
  const pointerType = useRef<string>('mouse');
  const [hover, setHover] = useState<Hover>(null);
  const [touch, setTouch] = useState(false);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const hatchId = `hgab-map-hatch-${uid}`;

  const full = useMemo<Box>(() => ({ x: 0, y: 0, w: proj.width, h: proj.height }), [proj]);
  const aspect = proj.width / proj.height;
  const regionByKey = useMemo(() => new Map(regions.map((r) => [r.key, r] as const)), [regions]);
  const curBox = useRef<Box>(full);
  const rafRef = useRef(0);
  // Zoomed in (bigger dots, road lines): React state only flips when the scale crosses ZOOMED_AT.
  const zoomedRef = useRef(false);
  const [zoomedIn, setZoomedIn] = useState(false);
  // Any zoom at all (for "Whole country" and zoom-out).
  const awayRef = useRef(false);
  const [away, setAway] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<number | undefined>(undefined);

  /** Keep a view inside the map: no closer than MAX_ZOOM, no wider than the whole map, centre on the map. */
  const clampBox = useCallback((b: Box): Box => {
    const w = Math.min(full.w, Math.max(full.w / MAX_ZOOM, b.w));
    const h = w / aspect;
    const cx = Math.min(full.x + full.w - w / 2, Math.max(full.x + w / 2, b.x + b.w / 2));
    const cy = h >= full.h ? full.y + full.h / 2 : Math.min(full.y + full.h - h / 2, Math.max(full.y + h / 2, b.y + b.h / 2));
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }, [full, aspect]);

  /** Write a view straight to the viewBox attribute; React never renders per frame. */
  const applyBox = useCallback((b: Box) => {
    const svg = svgRef.current;
    curBox.current = b;
    if (svg) svg.setAttribute('viewBox', boxToViewBox(b));
    const scale = full.w / b.w;
    const z = scale >= ZOOMED_AT;
    if (z !== zoomedRef.current) {
      zoomedRef.current = z;
      setZoomedIn(z);
    }
    const a = scale > 1.01;
    if (a !== awayRef.current) {
      awayRef.current = a;
      setAway(a);
    }
  }, [full]);

  const animateTo = useCallback((target: Box, ms: number) => {
    cancelAnimationFrame(rafRef.current);
    const from = curBox.current;
    if (ms <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      applyBox(target);
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      applyBox(lerpBox(from, target, easeInOut(t)));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [applyBox]);

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    window.clearTimeout(hintTimer.current);
  }, []);

  /** Zoom by `factor` keeping the map point (px, py) under the same spot. */
  const zoomAround = useCallback((factor: number, px: number, py: number, ms = 0) => {
    const b = curBox.current;
    const w = b.w / factor;
    const k = w / b.w;
    const next = clampBox({ x: px - (px - b.x) * k, y: py - (py - b.y) * k, w, h: w / aspect });
    if (ms > 0) animateTo(next, ms);
    else { cancelAnimationFrame(rafRef.current); applyBox(next); }
  }, [aspect, clampBox, animateTo, applyBox]);

  const zoomStep = useCallback((dir: 1 | -1) => {
    const b = curBox.current;
    zoomAround(dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP, b.x + b.w / 2, b.y + b.h / 2, STEP_MS);
  }, [zoomAround]);

  const panBy = useCallback((dxFrac: number, dyFrac: number) => {
    const b = curBox.current;
    animateTo(clampBox({ ...b, x: b.x + b.w * dxFrac, y: b.y + b.h * dyFrac }), STEP_MS);
  }, [animateTo, clampBox]);

  const showHint = useCallback((text: string) => {
    setHint(text);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 1600);
  }, []);

  // A picked region: animate to it; no region: back to the whole map.
  useEffect(() => {
    const r = selected ? regionByKey.get(selected) : null;
    animateTo(r ? clampBox(fitBox(r.box, aspect)) : full, ZOOM_MS);
  }, [selected, regionByKey, aspect, full, animateTo, clampBox]);

  /** Screen point → map units for the view `b` (the frame keeps the map's aspect, so no letterbox). */
  const toMap = useCallback((clientX: number, clientY: number, b: Box = curBox.current) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    return { x: b.x + ((clientX - rect.left) / rect.width) * b.w, y: b.y + ((clientY - rect.top) / rect.height) * b.h };
  }, []);

  // Wheel: Ctrl/⌘ + scroll (and trackpad pinch, which arrives as a ctrl-wheel) zooms at the pointer.
  // A plain scroll keeps scrolling the page and says how to zoom.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        showHint('Hold Ctrl (⌘ on a Mac) and scroll to zoom');
        return;
      }
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const factor = Math.exp(-e.deltaY * unit * 0.0022);
      const pt = toMap(e.clientX, e.clientY);
      zoomAround(factor, pt.x, pt.y);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [toMap, zoomAround, showHint]);

  // Drag to pan (mouse and pen; one finger once zoomed in), two fingers to pinch-zoom.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    startX: number; startY: number; box: Box; moved: boolean;
    pinch: { dist: number; mid: { x: number; y: number }; box: Box } | null;
  } | null>(null);
  const suppressClick = useRef(false);

  function startGesture(e: ReactPointerEvent<SVGSVGElement>) {
    pointerType.current = e.pointerType;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const [a, b] = pts;
      gesture.current = {
        startX: e.clientX, startY: e.clientY, box: curBox.current, moved: true,
        pinch: { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, box: curBox.current },
      };
      setHover(null);
      return;
    }
    if (pts.length === 1) {
      gesture.current = { startX: e.clientX, startY: e.clientY, box: curBox.current, moved: false, pinch: null };
    }
  }

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = gesture.current;
      if (!g) return;
      const pts = [...pointers.current.values()];
      if (g.pinch && pts.length >= 2) {
        const [a, b] = pts;
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const b0 = g.pinch.box;
        const anchor = toMap(g.pinch.mid.x, g.pinch.mid.y, b0);
        const w = b0.w / (dist / g.pinch.dist);
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect || !rect.width) return;
        const h = w / aspect;
        // Keep the anchor under the fingers' moving midpoint.
        const x = anchor.x - ((mid.x - rect.left) / rect.width) * w;
        const y = anchor.y - ((mid.y - rect.top) / rect.height) * h;
        cancelAnimationFrame(rafRef.current);
        applyBox(clampBox({ x, y, w, h }));
        return;
      }
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (!g.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      // One finger pans only once the map is zoomed in; at the whole map it scrolls the page.
      if (e.pointerType === 'touch' && !awayRef.current) return;
      if (!g.moved) {
        g.moved = true;
        setHover(null);
        frameRef.current?.classList.add('is-panning');
      }
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || !rect.width) return;
      cancelAnimationFrame(rafRef.current);
      applyBox(clampBox({
        ...g.box,
        x: g.box.x - (dx / rect.width) * g.box.w,
        y: g.box.y - (dy / rect.height) * g.box.h,
      }));
    };
    const onEnd = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.delete(e.pointerId);
      const g = gesture.current;
      if (g?.moved) suppressClick.current = true;
      if (pointers.current.size === 0) {
        gesture.current = null;
        frameRef.current?.classList.remove('is-panning');
      } else if (g?.pinch) {
        // One finger left after a pinch: continue as a pan from here.
        const [rest] = [...pointers.current.values()];
        gesture.current = { startX: rest.x, startY: rest.y, box: curBox.current, moved: true, pinch: null };
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
  }, [applyBox, aspect, clampBox, toMap]);

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;
    const zoomed = awayRef.current;
    let handled = true;
    if (e.key === '+' || e.key === '=') zoomStep(1);
    else if (e.key === '-' || e.key === '_') zoomStep(-1);
    else if (e.key === '0') resetView();
    else if (zoomed && e.key === 'ArrowLeft') panBy(-PAN_STEP, 0);
    else if (zoomed && e.key === 'ArrowRight') panBy(PAN_STEP, 0);
    else if (zoomed && e.key === 'ArrowUp') panBy(0, -PAN_STEP);
    else if (zoomed && e.key === 'ArrowDown') panBy(0, PAN_STEP);
    else handled = false;
    if (handled) e.preventDefault();
  }

  function resetView() {
    if (selected) onReset();
    else animateTo(full, ZOOM_MS);
  }

  // After the tooltip's content changes, re-measure and place it.
  useLayoutEffect(() => {
    positionTip(frameRef.current, tipRef.current, posRef.current);
  }, [hover]);

  // A tapped tooltip closes when the reader taps anywhere outside the map.
  useEffect(() => {
    if (!touch || !hover) return;
    const close = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !svgRef.current?.contains(e.target)) setHover(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [touch, hover]);

  function hitTest(clientX: number, clientY: number, target: EventTarget | null): Hover {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    if (showDots && pp.xs.length) {
      const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      const idx = nearestPoint(pp, p.x, p.y, HIT_PX / ctm.a, (k, h) => !hidden.has(k) && (showHeld || !h));
      if (idx >= 0) return { kind: 'point', idx };
    }
    const el = target instanceof Element ? target.closest('[data-r]') : null;
    const r = el?.getAttribute('data-r') as RegionKey | null | undefined;
    return r ? { kind: 'region', key: r } : null;
  }

  function track(clientX: number, clientY: number) {
    const frame = frameRef.current;
    if (!frame) return;
    const fr = frame.getBoundingClientRect();
    posRef.current = { x: clientX - fr.left, y: clientY - fr.top };
    positionTip(frame, tipRef.current, posRef.current);
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.pointerType === 'touch') return;
    pointerType.current = e.pointerType;
    const h = hitTest(e.clientX, e.clientY, e.target);
    if (touch) setTouch(false);
    setHover((prev) => (sameHover(prev, h) ? prev : h));
    track(e.clientX, e.clientY);
  }

  function onClick(e: ReactMouseEvent<SVGSVGElement>) {
    if (suppressClick.current) {
      // The press was a drag or a pinch, not a click.
      suppressClick.current = false;
      return;
    }
    const isTouch = pointerType.current === 'touch' || pointerType.current === 'pen';
    const h = hitTest(e.clientX, e.clientY, e.target);
    if (isTouch !== touch) setTouch(isTouch);
    if (h?.kind === 'point') {
      // Touch: the first tap shows what the dot is, a second tap opens it.
      if (isTouch && !sameHover(hover, h)) {
        track(e.clientX, e.clientY);
        setHover(h);
        return;
      }
      const p = points[h.idx];
      if (p) navigate(recordPath(dataset.key, p.id));
      return;
    }
    if (h?.kind === 'region') {
      onSelect(h.key);
      if (isTouch) {
        track(e.clientX, e.clientY);
        setHover(h);
      }
      return;
    }
    if (isTouch) setHover(null);
  }

  const hoverRegion = hover?.kind === 'region' ? hover.key : hover ? null : externalHover;
  const hoverShape = hoverRegion && hoverRegion !== selected ? regionByKey.get(hoverRegion) : null;
  const selectedShape = selected ? regionByKey.get(selected) : null;
  const hp = hover?.kind === 'point' ? hover.idx : -1;

  return (
    <div
      ref={frameRef}
      className={`hgab-map-frame ${away ? 'is-away' : ''}`.trim()}
      style={{ '--hgab-map-ar': `${proj.width} / ${proj.height}`, '--hgab-map-ar-n': aspect } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      <svg
        ref={svgRef}
        className={`hgab-map-svg ${showDots ? 'has-dots' : ''} ${selected || zoomedIn ? 'is-zoomed' : ''}`.trim()}
        viewBox={boxToViewBox(full)}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={ariaLabel}
        style={{ '--hgab-map-hatch': `url(#${hatchId})` } as CSSProperties}
        onPointerDown={startGesture}
        onPointerMove={onPointerMove}
        onPointerLeave={(e) => { if (e.pointerType !== 'touch') setHover(null); }}
        onClick={onClick}
      >
        <defs>
          <pattern id={hatchId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" className="hgab-map-hatch-bg" />
            <line x1="0" y1="0" x2="0" y2="5" className="hgab-map-hatch-line" />
          </pattern>
        </defs>
        <RegionLayer regions={regions} classes={classes} selected={selected} />
        {selectedShape && <RegionOverlay shape={selectedShape} cls={classes[selectedShape.key] ?? 'is-empty'} kind="selected" />}
        {hoverShape && <RegionOverlay shape={hoverShape} cls={classes[hoverShape.key] ?? 'is-empty'} kind="hover" />}
        {showDots && (selected || zoomedIn) && pp.lineCount > 0 && <LineLayer pp={pp} hidden={hidden} />}
        {showDots && <DotLayer pp={pp} hidden={hidden} showHeld={showHeld} />}
        {hp >= 0 && (
          <g className={`hgab-map-dot-hi is-${pp.keys[hp]}`} aria-hidden="true">
            <path className="hgab-map-dot-hi-ring" d={`M${pp.xs[hp]} ${pp.ys[hp]}h0`} />
            <path className={`hgab-map-dot-hi-core ${pp.held[hp] ? 'is-hollow' : ''}`} d={`M${pp.xs[hp]} ${pp.ys[hp]}h0`} />
          </g>
        )}
      </svg>

      {(selected || away) && (
        <button type="button" className="hgab-map-reset" onClick={resetView}>
          <span aria-hidden="true">←</span> Whole country
          {selectedName && <span className="visually-hidden"> (now showing {selectedName})</span>}
        </button>
      )}

      <div className="hgab-map-zoom" role="group" aria-label="Map zoom">
        <button type="button" onClick={() => zoomStep(1)} aria-label="Zoom in" title="Zoom in (+)">+</button>
        <button type="button" onClick={() => zoomStep(-1)} aria-label="Zoom out" title="Zoom out (−)" disabled={!away}>−</button>
      </div>
      <p className="hgab-map-howto" aria-hidden="true">
        <span className="is-mouse">Drag to move · Ctrl/⌘ + scroll to zoom</span>
        <span className="is-touch">Pinch to zoom · then drag to move</span>
      </p>
      {hint && <p className="hgab-map-hint" role="status">{hint}</p>}

      {hover && (
        <div ref={tipRef} className="hgab-map-tip" role="presentation">
          {hover.kind === 'point' && points[hover.idx] ? (
            <PointTip p={points[hover.idx]} houseLabel={houseLabel} touch={touch} />
          ) : hover.kind === 'region' ? (
            <RegionTip v={valueByKey.get(hover.key)} k={hover.key} houseLabel={houseLabel} touch={touch} zoomed={selected === hover.key} />
          ) : null}
        </div>
      )}
    </div>
  );
}

// --- layers (memoised: hover never re-renders them) -------------------------

const RegionLayer = memo(function RegionLayer({ regions, classes, selected }: {
  regions: RegionShape[];
  classes: Partial<Record<RegionKey, string>>;
  selected: RegionKey | null;
}) {
  // Per region: the outline pass first (its outer half shows as the region
  // border), then the province fills, which cover the inner half and every
  // border between provinces of the same region.
  return (
    <g className="hgab-map-regions">
      {regions.map((r) => (
        <g
          key={r.key}
          data-r={r.key}
          className={`hgab-map-region ${classes[r.key] ?? 'is-empty'} ${selected && selected !== r.key ? 'is-dim' : ''}`.trim()}
        >
          <path className="hgab-map-rb" d={r.d} />
          {r.provinces.map((p) => <path key={p.psgc} className="hgab-map-rf" d={p.d} />)}
        </g>
      ))}
    </g>
  );
});

function RegionOverlay({ shape, cls, kind }: { shape: RegionShape; cls: string; kind: 'hover' | 'selected' }) {
  return (
    <g className={`hgab-map-overlay is-${kind} ${cls}`} aria-hidden="true">
      <path className="hgab-map-ob" d={shape.d} />
      {shape.provinces.map((p) => <path key={p.psgc} className="hgab-map-rf" d={p.d} />)}
    </g>
  );
}

const DotLayer = memo(function DotLayer({ pp, hidden, showHeld }: {
  pp: ProjectedPoints;
  hidden: ReadonlySet<DotKey>;
  showHeld: boolean;
}) {
  return (
    <g className="hgab-map-dots" aria-hidden="true">
      {DOT_PAINT_ORDER.map((k) => {
        if (hidden.has(k)) return null;
        const solid = pp.solid[k];
        const hollow = showHeld ? pp.hollow[k] : undefined;
        if (!solid && !hollow) return null;
        return (
          <g key={k} className={`hgab-map-dotset is-${k}`}>
            {solid && (
              <>
                <path className="hgab-map-dot-halo" d={solid} />
                <path className="hgab-map-dot" d={solid} />
              </>
            )}
            {hollow && (
              <>
                <path className="hgab-map-dot-halo" d={hollow} />
                <path className="hgab-map-dot" d={hollow} />
                <path className="hgab-map-dot-hole" d={hollow} />
              </>
            )}
          </g>
        );
      })}
    </g>
  );
});

const LineLayer = memo(function LineLayer({ pp, hidden }: { pp: ProjectedPoints; hidden: ReadonlySet<DotKey> }) {
  return (
    <g className="hgab-map-lines" aria-hidden="true">
      {DOT_PAINT_ORDER.map((k) => (hidden.has(k) || !pp.lines[k] ? null : (
        <path key={k} className={`hgab-map-line is-${k}`} d={pp.lines[k]} />
      )))}
    </g>
  );
});

// --- tooltips --------------------------------------------------------------

function PointTip({ p, houseLabel, touch }: { p: MapPoint; houseLabel: string; touch: boolean }) {
  const t = traceInfo(p.trace);
  const key: DotKey = p.group ?? 'other';
  const delta = p.nep_php != null && p.house_php != null ? p.house_php - p.nep_php : null;
  return (
    <>
      <p className="hgab-map-tip-title">{clip(p.title)}</p>
      <dl className="hgab-map-tip-rows">
        <div><dt>NEP</dt><dd>{p.nep_php == null ? 'not listed' : peso(p.nep_php)}</dd></div>
        <div><dt>{houseLabel}</dt><dd>{p.house_php == null ? 'not listed' : peso(p.house_php)}</dd></div>
        {delta != null && delta !== 0 && (
          <div><dt>Change</dt><dd>{signedPeso(delta)} · {formatPct(pctChange(p.house_php, p.nep_php))}</dd></div>
        )}
      </dl>
      <p className={`hgab-map-tip-what is-${key}`}>
        <i aria-hidden="true" className={p.held ? 'is-hollow' : ''} />
        <span>What happened to this line: <strong>{t.label}</strong></span>
      </p>
      <p className="hgab-map-tip-hint">{touch ? 'Tap the dot again to open this project' : 'Click to open this project'}</p>
    </>
  );
}

function RegionTip({ v, k, houseLabel, touch, zoomed }: {
  v: RegionValue | undefined;
  k: RegionKey;
  houseLabel: string;
  touch: boolean;
  zoomed: boolean;
}) {
  const lab = REGION_LABELS[k];
  return (
    <>
      <p className="hgab-map-tip-title">
        {lab?.name ?? k} <small>{lab?.short ?? ''}</small>
      </p>
      {v?.listed ? (
        <dl className="hgab-map-tip-rows">
          <div><dt>NEP</dt><dd>{peso(v.nep)} <small>· {plural(v.nepRows, 'line')}</small></dd></div>
          <div><dt>{houseLabel}</dt><dd>{peso(v.house)} <small>· {plural(v.houseRows, 'line')}</small></dd></div>
          <div><dt>Change</dt><dd>{signedPeso(v.delta)} · {formatPct(v.pct)}</dd></div>
        </dl>
      ) : (
        <p className="hgab-map-tip-none">Neither version lists an amount here.</p>
      )}
      {!zoomed && <p className="hgab-map-tip-hint">{touch ? 'Zoomed in. Tap a dot to see what it is' : 'Click to zoom in'}</p>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

function ScaleKey({ scale, measure, houseLabel }: { scale: RegionScale; measure: Measure; houseLabel: string }) {
  const title = measure === 'delta'
    ? `Change: ${houseLabel} minus the NEP`
    : measure === 'nep' ? 'NEP, amount listed in each region' : `${houseLabel}, amount listed in each region`;
  const v = (n: number) => (measure === 'delta' ? signedPeso(n) : peso(n));
  const stepTitle = (from: number, to: number, cls: string) => {
    const text = !Number.isFinite(from) ? `${v(to)} or lower`
      : !Number.isFinite(to) ? `${v(from)} or higher`
      : `${v(from)} to ${v(to)}`;
    return cls === 'is-mid' ? `About the same: ${text}` : text;
  };
  // A lone outlier tops the scale out at the runner-up; say so in words.
  const outlierName = scale.capped && scale.peakKey ? REGION_LABELS[scale.peakKey]?.name ?? scale.peakKey : null;
  const outlier = outlierName && scale.peakValue != null
    ? `${outlierName} (${v(scale.peakValue)}) is off the top of this scale, so the darkest ${measure === 'delta' ? `shades mean ${peso(scale.max)} or more either way` : `shade means ${peso(scale.max)} or more`}.`
    : '';
  return (
    <div className="hgab-map-key">
      <p className="hgab-map-key-title">{title}</p>
      {scale.kind === 'diverging' && (
        <div className="hgab-map-ramp-words" aria-hidden="true">
          <span>← Less in the House bill</span>
          <span>More in the House bill →</span>
        </div>
      )}
      <div className={`hgab-map-ramp is-${scale.kind}`} aria-hidden="true">
        {scale.steps.map((s) => (
          <span key={s.cls} className={`hgab-map-sw ${s.cls}`} title={stepTitle(s.from, s.to, s.cls)} />
        ))}
      </div>
      <div className="hgab-map-ramp-labels" aria-hidden="true">
        {scale.kind === 'diverging' ? (
          <>
            <span><b>{signedPeso(-scale.max)}</b>{scale.capped ? ' or lower' : ''}</span>
            <span className="is-mid">about the same</span>
            <span><b>{signedPeso(scale.max)}</b>{scale.capped ? ' or higher' : ''}</span>
          </>
        ) : (
          <>
            <span><b>₱0</b></span>
            <span><b>{peso(scale.max)}</b>{scale.capped ? ' or more' : ''}</span>
          </>
        )}
      </div>
      <p className="hgab-map-key-empty">
        <span className="hgab-map-sw is-empty" aria-hidden="true" />
        {measure === 'delta' ? 'Nothing listed in either version' : 'Nothing listed in this version'}
      </p>
      {outlier && <p className="hgab-map-key-note">{outlier}</p>}
      <p className="visually-hidden">
        {scale.kind === 'diverging'
          ? `Darker blue means the House bill lists more money in the region than the NEP, darker red means less, light grey means about the same. The darkest shades stand for ${signedPeso(scale.max)}${scale.capped ? ' or more' : ''} either way.`
          : `Darker blue means a larger amount; the darkest shade stands for ${peso(scale.max)}${scale.capped ? ' or more' : ''}.`}
      </p>
    </div>
  );
}

function DotsKey({ pp, hidden, showHeld, disabled, lines, onToggle, onToggleHeld }: {
  pp: ProjectedPoints;
  hidden: ReadonlySet<DotKey>;
  showHeld: boolean;
  disabled: boolean;
  lines: boolean;
  onToggle: (k: DotKey) => void;
  onToggleHeld: () => void;
}) {
  const keys = DOT_ORDER.filter((k) => pp.counts[k] > 0);
  return (
    <div className={`hgab-map-dotkey ${disabled ? 'is-off' : ''}`.trim()}>
      <p className="hgab-map-key-title">
        Project dots: how the two versions differ <span>(press to show or hide)</span>
      </p>
      <div className="hgab-map-dotkey-items" role="group" aria-label="Show or hide each kind of project dot">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            className={`hgab-map-dotkey-item is-${k}`}
            aria-pressed={!hidden.has(k)}
            disabled={disabled}
            onClick={() => onToggle(k)}
          >
            <i aria-hidden="true" />
            <span>
              {DOT_LABELS[k].label}
              <small>{DOT_LABELS[k].sub} · {count(pp.counts[k])}</small>
            </span>
          </button>
        ))}
        {pp.heldCount > 0 && (
          <button
            type="button"
            className="hgab-map-dotkey-item is-held"
            aria-pressed={showHeld}
            disabled={disabled}
            onClick={onToggleHeld}
          >
            <i aria-hidden="true" />
            <span>
              Unconfirmed matches
              <small>drawn hollow · {count(pp.heldCount)}</small>
            </span>
          </button>
        )}
      </div>
      {lines && <p className="hgab-map-dotkey-note">Zoom into a region to see each road drawn from its published start and end points.</p>}
    </div>
  );
}

function Coverage({ dataset, map }: { dataset: HgabDatasetMeta; map: HgabDatasetMap }) {
  const c = map.coverage;
  const noun = ROW_NOUN[dataset.key];
  const n = c.rows_with_points;
  // The data's own note often already gives the count; don't say it twice.
  const noteHasCount = map.points_note.includes(count(n));
  let lead: ReactNode = null;
  if (map.points.length > 0 && c.rows_total > 0 && !noteHasCount) {
    lead = n >= c.rows_total
      ? <><strong>All {count(c.rows_total)} {noun}</strong> are listed with map coordinates and are shown as dots. </>
      : <><strong>{count(n)} of {count(c.rows_total)} {noun}</strong> are listed with map coordinates; only those are shown as dots. </>;
  }
  return (
    <p className="hgab-map-coverage">
      {lead}
      {map.points_note}
      {noteHasCount && c.rows_total > 0 && <> That is <strong>{count(n)} of {count(c.rows_total)} {noun}</strong>.</>}
      {c.rows_total > 0 && c.rows_with_region < c.rows_total && (
        <> {count(c.rows_with_region)} of {count(c.rows_total)} name a region and are counted in the shading.</>
      )}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Table: the accessible equivalent of the map
// ---------------------------------------------------------------------------

function RegionTable({
  dataset, rows, sort, onSort, scale, measure, selected, houseLabel, onSelect, onHover,
}: {
  dataset: HgabDatasetMeta;
  rows: RegionValue[];
  sort: { by: RegionSort; dir: 'asc' | 'desc' };
  onSort: (s: { by: RegionSort; dir: 'asc' | 'desc' }) => void;
  scale: RegionScale;
  measure: Measure;
  selected: RegionKey | null;
  houseLabel: string;
  onSelect: (k: RegionKey) => void;
  onHover: (k: RegionKey | null) => void;
}) {
  function head(by: RegionSort, text: string, cls: string, title?: string) {
    const active = sort.by === by;
    return (
      <th scope="col" className={`${cls} ${active ? 'nep-th-active' : ''}`.trim()} title={title}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
        <button
          type="button"
          onClick={() => onSort(active
            ? { by, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
            : { by, dir: by === 'order' ? 'asc' : 'desc' })}
        >
          {text}<span className="nep-sort-caret" aria-hidden="true">{active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
        </button>
      </th>
    );
  }
  const sortedBy = sort.by === 'delta' ? 'by change' : sort.by === 'nep' ? 'by the NEP'
    : sort.by === 'house' ? 'by the House bill' : sort.by === 'pct' ? 'by percent change' : 'north to south';
  return (
    <div className="hgab-map-tablewrap">
      <h3 className="hgab-map-h">Regions, {sortedBy}</h3>
      <p className="hgab-map-tablenote">
        Press a region to zoom the map to it; “See projects” opens that region’s list.
      </p>
      <div className="hgab-map-tablescroll">
      <table className="nep-table hgab-map-table" onPointerLeave={() => onHover(null)}>
        <caption className="visually-hidden">
          Amount listed in each region by the NEP and the {houseLabel}, and the change between them, {sortedBy}.
        </caption>
        <thead>
          <tr>
            {head('order', 'Region', 'hgab-map-th-name', 'Sort north to south')}
            {head('nep', 'NEP', 'num')}
            {head('house', 'House bill', 'num', houseLabel)}
            {head('delta', 'Change', 'num', 'House bill minus the NEP')}
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const label = projectsRegionLabel(v);
            const href = label ? `${datasetPath(dataset.key, 'projects')}&region=${encodeURIComponent(label)}` : null;
            const isSel = selected === v.key;
            return (
              <tr
                key={v.key}
                className={`${isSel ? 'is-selected' : ''} ${v.listed ? '' : 'is-unlisted'}`.trim()}
                onPointerEnter={() => onHover(v.key)}
              >
                <th scope="row" className="hgab-map-td-name">
                  <button
                    type="button"
                    className="hgab-map-rowbtn"
                    aria-pressed={isSel}
                    onClick={() => onSelect(v.key)}
                    onFocus={() => onHover(v.key)}
                    onBlur={() => onHover(null)}
                    title={isSel ? 'Show the whole country again' : `Zoom the map to ${v.name}`}
                  >
                    <span className={`hgab-map-sw ${scale.classOf(measureValue(v, measure))}`} aria-hidden="true" />
                    <span className="hgab-map-rowname">
                      {v.name}
                      <small>{v.short}</small>
                    </span>
                  </button>
                  {href && (
                    <Link
                      className="hgab-map-rowlink"
                      to={href}
                      title={`Open the projects listed under ${v.sourceLabels.map((l) => `“${l}”`).join(' or ')}`}
                    >
                      See projects<span className="visually-hidden"> in {v.name}</span>
                    </Link>
                  )}
                </th>
                <td className="num nep-td-base">
                  <Amt v={v.nep} />
                  <small className="hgab-map-rows">{v.nep != null ? plural(v.nepRows, 'line') : ''}</small>
                </td>
                <td className="num">
                  <Amt v={v.house} strong />
                  <small className="hgab-map-rows">{v.house != null ? plural(v.houseRows, 'line') : ''}</small>
                </td>
                <td className="num"><DeltaCell delta={v.delta} base={v.nep} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function NotOnMap({ map, onMap = true }: { map: HgabDatasetMap; onMap?: boolean }) {
  const n = map.not_on_map;
  if (!n || (n.nep_php == null && n.house_php == null && !n.nep_rows && !n.house_rows)) return null;
  return (
    <div className="hgab-map-noregion">
      <p>
        <strong>{onMap ? 'Listed as nationwide or with no region:' : 'Listed with no region:'}</strong>{' '}
        <span title={exact(n.nep_php)}>{peso(n.nep_php)}</span> in the NEP ({plural(n.nep_rows, 'line')})
        {' '}and <span title={exact(n.house_php)}>{peso(n.house_php)}</span> in the House bill ({plural(n.house_rows, 'line')}).
        {n.house_php != null && n.nep_php != null && n.house_php !== n.nep_php && (
          <> Change: <span title={exact(n.house_php - n.nep_php)}>{signedPeso(n.house_php - n.nep_php)}</span>.</>
        )}
      </p>
      {n.plain && <p className="hgab-map-noregion-plain">{n.plain}</p>}
      {onMap && <p className="hgab-map-noregion-plain">These amounts are not on the map.</p>}
    </div>
  );
}

