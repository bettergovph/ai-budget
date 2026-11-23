/**
 * The roads map (`/gaa/roads`): one budget's road and bridge lines over CARTO's Positron basemap, as the
 * multi-purpose map draws its lines. A line is a mark where the budget's line sits:
 *   - blue dot: the matched DPWH contract's point, or GPS printed in the title (a site);
 *   - white ring: the barangay, town, city or province the title names (the place's centre, not the site);
 *   - grey disc: the DPWH office's area or the region.
 * Marks group into dark discs with a count until zoom 12. Lines drawn along OpenStreetMap roads (draw.py) are red:
 * solid on the road the title names, dashed on the national road under the point (lower confidence). Clicking a mark
 * or a red line picks it; the page shows it below the map. OpenStreetMap is credited in the attribution.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AttributionControl, LngLatBounds, Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl,
  type GeoJSONSource, type MapGeoJSONFeature,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { FeatureCollection } from 'geojson';

setWorkerUrl(workerUrl);

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const PH: [[number, number], [number, number]] = [[116.9, 4.6], [126.8, 21.1]];
const FONT = ['Open Sans Bold', 'Noto Sans Regular'];
const BLUE = '#0b4fd9';
const RED = '#d62828';
const INK = '#121826';
const SRC = { marks: 'roads-marks', lines: 'roads-lines', picked: 'roads-picked' } as const;
const LYR = {
  lines: 'roads-lines', linesClass: 'roads-lines-class', groups: 'roads-groups', groupCount: 'roads-group-count',
  area: 'roads-area', rings: 'roads-rings', dots: 'roads-dots', pickedLine: 'roads-picked-line', pickedRing: 'roads-picked-ring',
} as const;
const PICK_LAYERS = [LYR.dots, LYR.rings, LYR.area, LYR.lines, LYR.linesClass];

/** Where to look: a point and zoom, or (a drawn line) the box around its stretches. */
export interface RoadsMapFocus { lng: number; lat: number; zoom: number; seq: number; bounds?: [[number, number], [number, number]] }

export default function RoadsMap({ marks, lines, picked, focus, fitKey, onPick, onError }: {
  /** One Point per placed line: properties `uid` (the line), `kind` ('site' | 'place' | 'area'). */
  marks: FeatureCollection;
  /** Drawn stretches: properties `uid`, `conf` ('named' | 'class'). */
  lines: FeatureCollection;
  /** The picked line: its mark and its stretches, outlined. */
  picked: FeatureCollection;
  focus: RoadsMapFocus | null;
  /** Refit to the marks when this changes (a new budget, region or search). */
  fitKey: string;
  onPick: (uid: string | null) => void;
  onError?: (message: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const handlers = useRef({ onPick, onError });
  useEffect(() => { handlers.current = { onPick, onError }; }, [onPick, onError]);

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
      cooperativeGestures: window.matchMedia('(pointer: coarse)').matches,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new AttributionControl({ compact: true, customAttribution: 'Roads drawn along © OpenStreetMap contributors (ODbL)' }), 'bottom-left');
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right');
    m.on('error', (e) => handlers.current.onError?.(String(e?.error?.message ?? e)));
    m.on('load', () => {
      const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
      m.addSource(SRC.lines, { type: 'geojson', data: empty });
      m.addSource(SRC.marks, { type: 'geojson', data: empty, cluster: true, clusterMaxZoom: 11, clusterRadius: 36 });
      m.addSource(SRC.picked, { type: 'geojson', data: empty });
      const width = ['interpolate', ['linear'], ['zoom'], 6, 2, 10, 3.5, 14, 6] as const;
      m.addLayer({ id: LYR.lines, type: 'line', source: SRC.lines, filter: ['==', ['get', 'conf'], 'named'],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': RED, 'line-width': width as never, 'line-opacity': 0.85 } });
      m.addLayer({ id: LYR.linesClass, type: 'line', source: SRC.lines, filter: ['==', ['get', 'conf'], 'class'],
        layout: { 'line-join': 'round' }, paint: { 'line-color': RED, 'line-width': width as never, 'line-opacity': 0.8, 'line-dasharray': [1.6, 1.2] } });
      m.addLayer({ id: LYR.groups, type: 'circle', source: SRC.marks, filter: ['has', 'point_count'],
        paint: { 'circle-color': INK, 'circle-opacity': 0.82, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
          'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'point_count']], 1, 10, 10, 18, 40, 30] } });
      m.addLayer({ id: LYR.groupCount, type: 'symbol', source: SRC.marks, filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': FONT, 'text-size': 11, 'text-allow-overlap': true },
        paint: { 'text-color': '#fff' } });
      m.addLayer({ id: LYR.area, type: 'circle', source: SRC.marks, filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'kind'], 'area']],
        paint: { 'circle-color': '#8a93a3', 'circle-opacity': 0.55, 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
      m.addLayer({ id: LYR.rings, type: 'circle', source: SRC.marks, filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'kind'], 'place']],
        paint: { 'circle-color': '#ffffff', 'circle-radius': 5.5, 'circle-stroke-color': INK, 'circle-stroke-width': 1.6 } });
      m.addLayer({ id: LYR.dots, type: 'circle', source: SRC.marks, filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'kind'], 'site']],
        paint: { 'circle-color': BLUE, 'circle-radius': 4.5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2 } });
      m.addLayer({ id: LYR.pickedLine, type: 'line', source: SRC.picked, filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round' }, paint: { 'line-color': BLUE, 'line-width': 7, 'line-opacity': 0.55 } }, LYR.lines);
      m.addLayer({ id: LYR.pickedRing, type: 'circle', source: SRC.picked, filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 11, 'circle-stroke-color': BLUE, 'circle-stroke-width': 3 } });
      setReady(true);
    });
    const cursor = (v: string) => { m.getCanvas().style.cursor = v; };
    for (const l of [...PICK_LAYERS, LYR.groups]) {
      m.on('mouseenter', l, () => cursor('pointer'));
      m.on('mouseleave', l, () => cursor(''));
    }
    m.on('click', (e) => {
      const p = e.point;
      const box8: [[number, number], [number, number]] = [[p.x - 8, p.y - 8], [p.x + 8, p.y + 8]];
      const group = m.queryRenderedFeatures(box8, { layers: [LYR.groups] })[0];
      if (group) {
        const id = group.properties.cluster_id as number;
        (m.getSource(SRC.marks) as GeoJSONSource).getClusterExpansionZoom(id).then((zoom) => {
          m.easeTo({ center: (group.geometry as GeoJSON.Point).coordinates as [number, number], zoom: Math.min(zoom, 16) });
        }).catch(() => {});
        return;
      }
      const hits: MapGeoJSONFeature[] = m.queryRenderedFeatures(box8, { layers: PICK_LAYERS });
      const order = (f: MapGeoJSONFeature) => PICK_LAYERS.indexOf(f.layer.id as (typeof PICK_LAYERS)[number]);
      const hit = hits.sort((a, b) => order(a) - order(b))[0];
      handlers.current.onPick(hit ? String(hit.properties.uid) : null);
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
    if (!ready || !map.current) return;
    (map.current.getSource(SRC.marks) as GeoJSONSource).setData(marks);
    (map.current.getSource(SRC.lines) as GeoJSONSource).setData(lines);
  }, [ready, marks, lines]);

  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource(SRC.picked) as GeoJSONSource).setData(picked);
  }, [ready, picked]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of marks.features) {
      const [x, y] = (f.geometry as GeoJSON.Point).coordinates;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x0 <= x1) m.fitBounds([[x0, y0], [x1, y1]], { padding: 40, maxZoom: 12, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only on a new budget, region or search
  }, [ready, fitKey]);

  useEffect(() => {
    if (!ready || !focus || !map.current) return;
    if (focus.bounds) map.current.fitBounds(focus.bounds, { padding: 70, maxZoom: 16, duration: 600 });
    else map.current.easeTo({ center: [focus.lng, focus.lat], zoom: focus.zoom });
  }, [ready, focus]);

  return <div ref={box} className="hgab-roads-mapbox" role="region" aria-label="Map of the budget's road and bridge lines" />;
}
