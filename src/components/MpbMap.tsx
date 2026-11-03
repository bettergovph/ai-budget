/**
 * The multi-purpose buildings map (`/hgab/2027/multi-purpose/map`). MapLibre GL over CARTO's Positron basemap,
 * ported from the source workbench's Congress map (analysis/web/src/CongressMap.jsx at the pinned commit): its
 * legislative district outlines (PSGC2LEG), GPS published in titles as solid dots, and the places titles name as
 * rings at the centre of that place, never at a site. Ours adds groups (about 80,000 lines over fourteen budgets)
 * and shades each district by its amount in the years chosen.
 *
 * Marks, from most to least precise: GPS (blue, solid); a barangay, town, city or province the title names (white
 * ring, ink edge, sized by its lines); the area of the DPWH office or the region (grey disc). No mark covers another
 * at any zoom: the marks are laid out for each whole zoom level (mpb-dodge.ts), side by side, with a thin line back
 * from any moved aside; groups (dark discs with the count) at the country's scale, from zoom 10 only where there is
 * no room, from zoom 12 none. The districts are shaded in red by amount; what is picked is blue (colours and their
 * checks: mpb-map-style.ts). Every value the map shows is also in the list below it, so the map never gates a figure.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AttributionControl, LngLatBounds, Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl,
  type ExpressionSpecification, type GeoJSONSource, type MapGeoJSONFeature,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { FeatureCollection, Point } from 'geojson';
import type { MarkFeature } from '../lib/hgab-mpb-years';
import {
  AREA_RADIUS, AREA_STROKE, GPS_RADIUS, GPS_STROKE, GROUP_RADIUS, GROUP_STROKE, RING_RADIUS, RING_STROKE,
  groupRadius, layoutMarks, markRadius, type Layout,
} from '../lib/mpb-dodge';
import { MARK_COLORS, PICKED, SHADE_COLORS } from './mpb-map-style';

setWorkerUrl(workerUrl);

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const PH: [[number, number], [number, number]] = [[116.9, 4.6], [126.8, 21.1]];
const FONT = ['Open Sans Bold', 'Noto Sans Regular'];

/** `marks`: every mark as laid out for the zoom level in view (points, and lines back from those moved aside). */
const SRC = { districts: 'mpb-districts', marks: 'mpb-marks', picked: 'mpb-picked' } as const;
const LYR = {
  fill: 'mpb-district-fill', line: 'mpb-district-line', leaders: 'mpb-leaders', area: 'mpb-area', rings: 'mpb-rings',
  gps: 'mpb-gps', groups: 'mpb-groups', groupCount: 'mpb-group-count', count: 'mpb-count', picked: 'mpb-picked-ring',
} as const;
const PICK_LAYERS = [LYR.gps, LYR.rings, LYR.area, LYR.groups];

export type MapPick =
  | { kind: 'place'; place: number }
  | { kind: 'gps'; line: number; place: number }
  | { kind: 'district'; id: string }
  | null;

export interface MapFocus { lng: number; lat: number; zoom: number; seq: number }
/** Fit the view to these bounds (a region or a search picked in the controls). */
export interface MapFit { bounds: [[number, number], [number, number]] }

const lines: ExpressionSpecification = ['get', 'lines'];
const sqrtLines: ExpressionSpecification = ['sqrt', ['max', 1, lines]];
const byLines = (s: typeof RING_RADIUS): ExpressionSpecification =>
  ['interpolate', ['linear'], sqrtLines, s[0][0], s[0][1], s[1][0], s[1][1], s[2][0], s[2][1], s[3][0], s[3][1]];
const isKind = (kind: 'place' | 'area' | 'gps' | 'group'): ExpressionSpecification => ['==', ['get', 'kind'], kind];

function addLayers(m: MapLibreMap) {
  m.addSource(SRC.districts, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
  m.addSource(SRC.marks, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  m.addSource(SRC.picked, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  const cls: ExpressionSpecification = ['coalesce', ['feature-state', 'cls'], 0];
  m.addLayer({
    id: LYR.fill, type: 'fill', source: SRC.districts,
    paint: {
      'fill-color': ['match', cls, 1, SHADE_COLORS[0], 2, SHADE_COLORS[1], 3, SHADE_COLORS[2], 4, SHADE_COLORS[3], 5, SHADE_COLORS[4], '#ffffff'],
      // Strong at country scale, a wash once streets and barangay names show.
      'fill-opacity': ['interpolate', ['linear'], ['zoom'],
        7, ['case',
          ['boolean', ['feature-state', 'selected'], false], 0.85,
          ['boolean', ['feature-state', 'hover'], false], 0.78,
          ['==', cls, 0], 0.05, 0.62],
        11, ['case',
          ['boolean', ['feature-state', 'selected'], false], 0.4,
          ['boolean', ['feature-state', 'hover'], false], 0.34,
          ['==', cls, 0], 0.03, 0.22]],
    },
  });
  m.addLayer({
    id: LYR.line, type: 'line', source: SRC.districts,
    paint: {
      'line-color': ['case',
        ['boolean', ['feature-state', 'selected'], false], PICKED,
        ['boolean', ['feature-state', 'hover'], false], '#11151c',
        '#8a92a1'],
      'line-width': ['case',
        ['boolean', ['feature-state', 'selected'], false], 2.8,
        ['boolean', ['feature-state', 'hover'], false], 1.4,
        0.5],
    },
  });
  // From a mark moved aside back to where it belongs; under the marks, so only the part between them shows.
  m.addLayer({
    id: LYR.leaders, type: 'line', source: SRC.marks,
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': MARK_COLORS.ringEdge, 'line-opacity': 0.4, 'line-width': 0.9 },
  });
  m.addLayer({
    id: LYR.area, type: 'circle', source: SRC.marks, filter: isKind('area'),
    paint: {
      'circle-color': MARK_COLORS.area,
      'circle-opacity': 0.9,
      'circle-radius': byLines(AREA_RADIUS),
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': AREA_STROKE,
    },
  });
  m.addLayer({
    id: LYR.rings, type: 'circle', source: SRC.marks, filter: isKind('place'),
    paint: {
      'circle-color': MARK_COLORS.ring,
      'circle-opacity': 0.88,
      'circle-radius': byLines(RING_RADIUS),
      'circle-stroke-color': MARK_COLORS.ringEdge,
      'circle-stroke-width': RING_STROKE,
    },
  });
  m.addLayer({
    id: LYR.gps, type: 'circle', source: SRC.marks, filter: isKind('gps'),
    paint: {
      'circle-color': MARK_COLORS.gps,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], ...GPS_RADIUS.flat()],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': GPS_STROKE,
    },
  });
  m.addLayer({
    id: LYR.groups, type: 'circle', source: SRC.marks, filter: isKind('group'),
    paint: {
      'circle-color': MARK_COLORS.cluster,
      'circle-opacity': 0.85,
      'circle-radius': byLines(GROUP_RADIUS),
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': GROUP_STROKE,
    },
  });
  // What is picked: a blue ring on a white halo, so it shows on any district shade; under the counts, so it never
  // hides a neighbour's number.
  m.addLayer({
    id: `${LYR.picked}-halo`, type: 'circle', source: SRC.picked,
    paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': ['get', 'r'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 6 },
  });
  m.addLayer({
    id: LYR.picked, type: 'circle', source: SRC.picked,
    paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': ['get', 'r'], 'circle-stroke-color': PICKED, 'circle-stroke-width': 3 },
  });
  m.addLayer({
    id: LYR.groupCount, type: 'symbol', source: SRC.marks, filter: isKind('group'),
    layout: {
      'text-field': ['case', ['>=', lines, 1000], ['concat', ['number-format', ['/', lines, 1000], { 'max-fraction-digits': 1 }], 'k'], ['to-string', lines]],
      'text-font': FONT, 'text-size': 11, 'text-allow-overlap': true,
    },
    paint: { 'text-color': '#ffffff' },
  });
  // A place's or an office area's count (a mark of one line has none).
  m.addLayer({
    id: LYR.count, type: 'symbol', source: SRC.marks,
    filter: ['all', ['match', ['get', 'kind'], ['place', 'area'], true, false], ['>=', lines, 2]],
    layout: { 'text-field': ['to-string', lines], 'text-font': FONT, 'text-size': 10, 'text-allow-overlap': true },
    paint: { 'text-color': ['case', isKind('area'), '#ffffff', '#11151c'] },
  });
}

export default function MpbMap({ districts, marks, shade, selectedDistrict, pick, focus, fit, onPick, onError }: {
  districts: FeatureCollection | null;
  marks: MarkFeature[];
  /** District id → shading class 0–5. */
  shade: ReadonlyMap<string, number>;
  selectedDistrict: string | null;
  /** Ringed in blue wherever its mark is drawn: on its own, moved aside, or in a group. */
  pick: MapPick;
  /** Fly here (a place or line picked in the list). */
  focus: MapFocus | null;
  fit: MapFit | null;
  onPick: (p: MapPick) => void;
  onError?: (message: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const handlers = useRef({ onPick, onError });
  useLayoutEffect(() => { handlers.current = { onPick, onError }; });
  // Read by the zoom handler: the marks and pick last drawn; the layouts made for these marks, by whole zoom level,
  // and the one in use.
  const live = useRef({ marks, pick });
  useLayoutEffect(() => { live.current = { marks, pick }; });
  const laid = useRef<{ marks: readonly MarkFeature[]; levels: Map<number, Layout>; level: number; at: Layout } | null>(null);

  /**
   * Lay the marks out for the whole zoom level in view; each level's layout is kept until the marks change. Returns
   * whether the layout in use changed.
   */
  const layOut = useCallback(() => {
    const m = map.current;
    if (!m || !m.getSource(SRC.marks)) return false;
    const level = Math.max(0, Math.floor(m.getZoom()));
    const marks = live.current.marks;
    const s = laid.current;
    if (s && s.marks === marks && s.level === level) return false;
    const levels = s && s.marks === marks ? s.levels : new Map<number, Layout>();
    const at = levels.get(level) ?? layoutMarks(marks, level);
    levels.set(level, at);
    (m.getSource(SRC.marks) as GeoJSONSource).setData({ type: 'FeatureCollection', features: [...at.points, ...at.leaders] });
    laid.current = { marks, levels, level, at };
    return true;
  }, []);

  /** Ring the pick where its mark is drawn: on its own, moved aside, or in a group. */
  const ringPick = useCallback(() => {
    const m = map.current;
    if (!m || !m.getSource(SRC.picked)) return;
    const { marks, pick: p } = live.current;
    const s = laid.current;
    const lay = s && s.marks === marks ? s.at : null;
    const rings = new Map<string, { c: [number, number]; r: number }>();
    const ring = (i: number) => {
      const f = lay ? lay.points[lay.drawnBy[i]] : marks[i];
      const k = f.properties.kind;
      const r = k === 'group' ? groupRadius(f.properties.lines) + 2 : k === 'gps' ? 8 : markRadius(k, f.properties.lines) + 2;
      rings.set(f.geometry.coordinates.join(','), { c: f.geometry.coordinates, r });
    };
    if (p?.kind === 'place') {
      const i = marks.findIndex((x) => x.properties.kind !== 'gps' && x.properties.place === p.place);
      if (i >= 0) ring(i);
    } else if (p?.kind === 'gps') {
      marks.forEach((x, i) => { if (x.properties.kind === 'gps' && x.properties.line === p.line) ring(i); });
    }
    (m.getSource(SRC.picked) as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: [...rings.values()].map(({ c, r }) => ({ type: 'Feature', properties: { r }, geometry: { type: 'Point', coordinates: c } })),
    });
  }, []);

  useEffect(() => {
    if (!box.current) return;
    const m = new MapLibreMap({
      container: box.current,
      style: STYLE_URL,
      bounds: new LngLatBounds(PH[0], PH[1]),
      fitBoundsOptions: { padding: 24 },
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      // On phones the map sits in a long page: one finger scrolls the page, two move the map.
      cooperativeGestures: window.matchMedia('(pointer: coarse)').matches,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new AttributionControl({ compact: true }), 'bottom-left');
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right');
    m.on('error', (e) => handlers.current.onError?.(String(e?.error?.message ?? e)));
    m.on('load', () => {
      addLayers(m);
      setReady(true);
    });
    // A new whole zoom level needs its own layout, and the pick's ring follows it.
    m.on('zoom', () => {
      if (layOut()) ringPick();
    });

    const cursor = (v: string) => { m.getCanvas().style.cursor = v; };
    for (const l of [...PICK_LAYERS, LYR.fill]) {
      m.on('mouseenter', l, () => cursor('pointer'));
      m.on('mouseleave', l, () => cursor(''));
    }
    let hover: string | number | null = null;
    const setHover = (id: string | number | null) => {
      if (hover != null) m.setFeatureState({ source: SRC.districts, id: hover }, { hover: false });
      hover = id;
      if (id != null) m.setFeatureState({ source: SRC.districts, id }, { hover: true });
    };
    m.on('mousemove', LYR.fill, (e) => setHover(e.features?.[0]?.id ?? null));
    m.on('mouseleave', LYR.fill, () => setHover(null));

    m.on('click', (e) => {
      // A hit area larger than the mark: 8 px around the pointer.
      const p = e.point;
      const hits: MapGeoJSONFeature[] = m.queryRenderedFeatures([[p.x - 8, p.y - 8], [p.x + 8, p.y + 8]], { layers: PICK_LAYERS });
      const order = (f: MapGeoJSONFeature) => PICK_LAYERS.indexOf(f.layer.id as (typeof PICK_LAYERS)[number]);
      const hit = hits.sort((a, b) => order(a) - order(b))[0];
      if (hit) {
        const props = hit.properties as Record<string, number | string>;
        const center = (hit.geometry as Point).coordinates as [number, number];
        if (hit.layer.id === LYR.groups) {
          // Into the box around where its marks belong, at least a level closer, where they have room.
          const zoom = m.getZoom();
          const cam = m.cameraForBounds([[Number(props.west), Number(props.south)], [Number(props.east), Number(props.north)]], { padding: 60, maxZoom: 16 });
          m.easeTo({ center: cam?.center ?? center, zoom: Math.min(16, Math.max(zoom + 1, cam?.zoom ?? zoom + 2)) });
          return;
        }
        if (props.kind === 'gps') handlers.current.onPick({ kind: 'gps', line: Number(props.line), place: Number(props.place) });
        else handlers.current.onPick({ kind: 'place', place: Number(props.place) });
        return;
      }
      const d = m.queryRenderedFeatures(p, { layers: [LYR.fill] })[0];
      handlers.current.onPick(d ? { kind: 'district', id: String(d.properties.id) } : null);
    });

    map.current = m;
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      laid.current = null;
      setReady(false);
    };
  }, [layOut, ringPick]);

  useEffect(() => {
    if (!ready || !map.current || !districts) return;
    (map.current.getSource(SRC.districts) as GeoJSONSource).setData(districts);
  }, [ready, districts]);

  useEffect(() => {
    if (!ready) return;
    layOut();
    ringPick();
  }, [ready, marks, layOut, ringPick]);

  useEffect(() => {
    if (ready) ringPick();
  }, [ready, pick, ringPick]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !districts) return;
    for (const f of districts.features) {
      const id = String(f.properties?.id);
      m.setFeatureState({ source: SRC.districts, id }, { cls: shade.get(id) ?? 0 });
    }
  }, [ready, districts, shade]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !selectedDistrict) return;
    m.setFeatureState({ source: SRC.districts, id: selectedDistrict }, { selected: true });
    return () => {
      if (map.current) map.current.setFeatureState({ source: SRC.districts, id: selectedDistrict }, { selected: false });
    };
  }, [ready, selectedDistrict]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !focus) return;
    m.flyTo({ center: [focus.lng, focus.lat], zoom: Math.max(m.getZoom(), focus.zoom), duration: 900 });
  }, [ready, focus]);

  useEffect(() => {
    if (!ready || !map.current || !fit) return;
    map.current.fitBounds(fit.bounds, { padding: 48, maxZoom: 11, duration: 700 });
  }, [ready, fit]);

  return (
    <div className="hgab-mpbm-canvaswrap">
      <div ref={box} className="hgab-mpbm-canvas" role="region" aria-label="Map of multi-purpose building lines" />
      <button type="button" className="hgab-mpbm-reset" onClick={() => map.current?.fitBounds(PH, { padding: 24 })}>Whole country</button>
    </div>
  );
}
