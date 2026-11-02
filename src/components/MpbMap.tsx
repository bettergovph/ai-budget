/**
 * The multi-purpose buildings map (`/hgab/2027/multi-purpose/map`). MapLibre GL over CARTO's Positron basemap,
 * ported from the source workbench's Congress map (analysis/web/src/CongressMap.jsx at the pinned commit): its
 * legislative district outlines (PSGC2LEG), GPS published in titles as solid dots, and the places titles name as
 * rings at the centre of that place, never at a site. Ours adds clusters (about 55,000 lines over eight budgets)
 * and shades each district by its amount in the years chosen.
 *
 * Marks, from most to least precise: GPS (blue, solid); a barangay, town, city or province the title names (white
 * ring, ink edge, sized by its lines); the area of the DPWH office or the region (grey disc). The districts are
 * shaded in red by amount; what is picked is blue (colours and their checks: mpb-map-style.ts). Every value the map shows is also in the
 * list below it, so the map never gates a figure.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AttributionControl, LngLatBounds, Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl,
  type ExpressionSpecification, type GeoJSONSource, type MapGeoJSONFeature,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { FeatureCollection, Point } from 'geojson';
import type { MarkFeature } from '../lib/hgab-mpb-years';
import { MARK_COLORS, PICKED, SHADE_COLORS } from './mpb-map-style';

setWorkerUrl(workerUrl);

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const PH: [[number, number], [number, number]] = [[116.9, 4.6], [126.8, 21.1]];
const FONT = ['Open Sans Bold', 'Noto Sans Regular'];

const SRC = { districts: 'mpb-districts', marks: 'mpb-marks', focus: 'mpb-focus' } as const;
const LYR = {
  fill: 'mpb-district-fill', line: 'mpb-district-line', clusters: 'mpb-clusters', clusterCount: 'mpb-cluster-count',
  area: 'mpb-area', rings: 'mpb-rings', gps: 'mpb-gps', count: 'mpb-count', focus: 'mpb-focus-ring',
} as const;
const PICK_LAYERS = [LYR.gps, LYR.rings, LYR.area, LYR.clusters];

export type MapPick =
  | { kind: 'place'; place: number }
  | { kind: 'gps'; line: number; place: number }
  | { kind: 'district'; id: string }
  | null;

export interface MapFocus { lng: number; lat: number; zoom: number; seq: number }
/** Fit the view to these bounds (a region or a search picked in the controls). */
export interface MapFit { bounds: [[number, number], [number, number]] }

const unclustered: ExpressionSpecification = ['!', ['has', 'point_count']];
const sqrtLines: ExpressionSpecification = ['sqrt', ['max', 1, ['get', 'lines']]];

function addLayers(m: MapLibreMap) {
  m.addSource(SRC.districts, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
  m.addSource(SRC.marks, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterRadius: 42,
    clusterMaxZoom: 9,
    clusterProperties: { lines: ['+', ['get', 'lines']] },
  });
  m.addSource(SRC.focus, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

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
  m.addLayer({
    id: LYR.area, type: 'circle', source: SRC.marks,
    filter: ['all', unclustered, ['==', ['get', 'kind'], 'area']],
    paint: {
      'circle-color': MARK_COLORS.area,
      'circle-opacity': 0.9,
      'circle-radius': ['interpolate', ['linear'], sqrtLines, 1, 6, 4, 9, 10, 14, 30, 22],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
    },
  });
  m.addLayer({
    id: LYR.rings, type: 'circle', source: SRC.marks,
    filter: ['all', unclustered, ['==', ['get', 'kind'], 'place']],
    paint: {
      'circle-color': MARK_COLORS.ring,
      'circle-opacity': 0.88,
      'circle-radius': ['interpolate', ['linear'], sqrtLines, 1, 4.5, 3, 8, 10, 14, 30, 22],
      'circle-stroke-color': MARK_COLORS.ringEdge,
      'circle-stroke-width': 1.4,
    },
  });
  m.addLayer({
    id: LYR.gps, type: 'circle', source: SRC.marks,
    filter: ['all', unclustered, ['==', ['get', 'kind'], 'gps']],
    paint: {
      'circle-color': MARK_COLORS.gps,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3.2, 10, 4.5, 14, 6.5],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.2,
    },
  });
  m.addLayer({
    id: LYR.clusters, type: 'circle', source: SRC.marks,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': MARK_COLORS.cluster,
      'circle-opacity': 0.85,
      'circle-radius': ['interpolate', ['linear'], sqrtLines, 1, 8, 10, 11, 40, 16, 130, 24],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
    },
  });
  const k: ExpressionSpecification = ['get', 'lines'];
  m.addLayer({
    id: LYR.clusterCount, type: 'symbol', source: SRC.marks,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['case', ['>=', k, 1000], ['concat', ['number-format', ['/', k, 1000], { 'max-fraction-digits': 1 }], 'k'], ['to-string', k]],
      'text-font': FONT, 'text-size': 11, 'text-allow-overlap': true,
    },
    paint: { 'text-color': '#ffffff' },
  });
  m.addLayer({
    id: LYR.count, type: 'symbol', source: SRC.marks,
    filter: ['all', unclustered, ['!=', ['get', 'kind'], 'gps'], ['>=', k, 2]],
    layout: { 'text-field': ['to-string', k], 'text-font': FONT, 'text-size': 10, 'text-allow-overlap': true },
    paint: { 'text-color': ['case', ['==', ['get', 'kind'], 'area'], '#ffffff', '#11151c'] },
  });
  // The picked place: a blue ring on a white halo, so it shows on any district shade.
  m.addLayer({
    id: `${LYR.focus}-halo`, type: 'circle', source: SRC.focus,
    paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 16, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 6 },
  });
  m.addLayer({
    id: LYR.focus, type: 'circle', source: SRC.focus,
    paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 16, 'circle-stroke-color': PICKED, 'circle-stroke-width': 3 },
  });
}

export default function MpbMap({ districts, marks, shade, selectedDistrict, focus, fit, onPick, onError }: {
  districts: FeatureCollection | null;
  marks: MarkFeature[];
  /** District id → shading class 0–5. */
  shade: ReadonlyMap<string, number>;
  selectedDistrict: string | null;
  /** Fly here and ring it (a place or line picked in the list). */
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
        if (hit.layer.id === LYR.clusters) {
          const src = m.getSource(SRC.marks) as GeoJSONSource;
          const center = (hit.geometry as Point).coordinates as [number, number];
          src.getClusterExpansionZoom(Number(props.cluster_id))
            .then((zoom) => m.easeTo({ center, zoom: Math.min(zoom, 14) }))
            .catch(() => m.easeTo({ center, zoom: m.getZoom() + 2 }));
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
      setReady(false);
    };
  }, []);

  useEffect(() => {
    if (!ready || !map.current || !districts) return;
    (map.current.getSource(SRC.districts) as GeoJSONSource).setData(districts);
  }, [ready, districts]);

  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource(SRC.marks) as GeoJSONSource).setData({ type: 'FeatureCollection', features: marks });
  }, [ready, marks]);

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
    if (!ready || !m) return;
    const src = m.getSource(SRC.focus) as GeoJSONSource;
    if (!focus) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    src.setData({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [focus.lng, focus.lat] } });
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
