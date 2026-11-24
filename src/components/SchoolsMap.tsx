/**
 * The schools maps (`/schools`, `/schools/shortage`). MapLibre GL over CARTO's Positron basemap, as the multi-purpose
 * buildings map (MpbMap.tsx).
 *
 * `points`: one dot per school at its 2022 coordinates, coloured by its SY 2023–2024 shortage level (by the Classroom
 * Shortage Rate: Moderate, Severe, Extreme, in blue; a brown ring: no shortage data, which is not zero), with a green ring where the FY 2026
 * School Building Program allocates classrooms; or coloured by allocation status (under, fully, over).
 * `areas`: one disc per schools division at the middle of its schools, sized by its shortage and coloured by how
 * much of it the 2026 list covers. Every value on the map is also in the page's tables.
 */
import { useEffect, useRef } from 'react';
import {
  AttributionControl, LngLatBounds, Map as MapLibreMap, NavigationControl, setWorkerUrl,
  type ExpressionSpecification, type GeoJSONSource, type MapLayerMouseEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { FeatureCollection, Point } from 'geojson';
import {
  ALLOCATION_STATUS, COVERAGE_CLASSES, NO_SHORTAGE_DATA, PROJECT_RING, SHORTAGE_CLASSES, UNRATED, coverageClass, statusOf,
  type AreaRow, type PointsFile, type SectorCode,
} from '../lib/schools';

setWorkerUrl(workerUrl);

const STYLE_URL = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const PH: [[number, number], [number, number]] = [[116.9, 4.6], [126.8, 21.1]];
export type MapProps =
  | {
    mode: 'points'; points: PointsFile['rows']; sectors: SectorCode[]; projectsOnly: boolean;
    /** Colour each school by its shortage level (EDCOM 2's, blue) or by its allocation status. */
    colorBy?: 'level' | 'status';
    selected: string | null; onPick: (id: string) => void; fit?: [[number, number], [number, number]] | null;
  }
  | {
    mode: 'areas'; areas: AreaRow[]; selected: string | null; onPick: (division: string) => void;
    fit?: [[number, number], [number, number]] | null;
  };

const levelColor: ExpressionSpecification = ['match', ['get', 'c'],
  0, SHORTAGE_CLASSES[0].color, 1, SHORTAGE_CLASSES[1].color, 2, SHORTAGE_CLASSES[2].color, 3, SHORTAGE_CLASSES[3].color, '#ffffff'];
/** Hollow marks: no shortage data (brown ring), and short but no classroom count, so no rate (blue ring). */
const HOLLOW: ExpressionSpecification = ['any', ['==', ['get', 'c'], -1], ['==', ['get', 'c'], 4]];
/** `st` = index into ALLOCATION_STATUS; the last (no data) is drawn as a ring only. */
const statusColor: ExpressionSpecification = ['match', ['get', 'st'],
  0, ALLOCATION_STATUS[0].color, 1, ALLOCATION_STATUS[1].color, 2, ALLOCATION_STATUS[2].color, 3, ALLOCATION_STATUS[3].color, '#ffffff'];

function pointsData(rows: PointsFile['rows']): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: rows.map(([id, lon, lat, shortage, cr, sec, level]) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { id, c: level, s: shortage ?? -1, cr, sec, st: ALLOCATION_STATUS.findIndex((x) => x.key === statusOf(shortage, cr)) },
    })),
  };
}

function areasData(rows: AreaRow[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: rows.filter((r) => r.lat != null && r.lon != null && r.division).map((r) => {
      return {
        type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon as number, r.lat as number] },
        properties: { id: r.division, s: r.shortage, k: coverageClass(r.covered, r.shortage) },
      };
    }),
  };
}

export default function SchoolsMap(props: MapProps) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    if (!box.current) return;
    const m = new MapLibreMap({
      container: box.current, style: STYLE_URL, bounds: PH, fitBoundsOptions: { padding: 16 },
      attributionControl: false, dragRotate: false, pitchWithRotate: false, maxZoom: 17,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new AttributionControl({ compact: true }));
    map.current = m;
    // The box can change size after the map starts (data arriving above it, a panel opening): keep the canvas in step.
    const resize = new ResizeObserver(() => { m.resize(); m.triggerRepaint(); });
    resize.observe(box.current);
    m.on('load', () => {
      m.addSource('sch', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
      const p = latest.current;
      if (p.mode === 'points') {
        m.addLayer({
          id: 'sch-dots', type: 'circle', source: 'sch',
          layout: { 'circle-sort-key': ['get', 'c'] }, // the biggest shortages on top
          paint: {
            'circle-color': levelColor,
            'circle-opacity': ['case', HOLLOW, 0, 0.85],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, ['case', ['>=', ['get', 'c'], 2], 2.4, 1.6], 9, 3.5, 13, 7],
            'circle-stroke-color': ['case', ['==', ['get', 'c'], -1], NO_SHORTAGE_DATA, ['==', ['get', 'c'], 4], UNRATED.color, '#ffffff'],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, ['case', HOLLOW, 0.9, 0], 10, ['case', HOLLOW, 1.6, 1]],
          },
        });
        m.addLayer({
          id: 'sch-projects', type: 'circle', source: 'sch', filter: ['>', ['get', 'cr'], 0],
          paint: {
            'circle-color': 'rgba(0,0,0,0)',
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 9, 6, 13, 11],
            'circle-stroke-color': PROJECT_RING,
            // Faint at the country's scale, where 5,000 rings would hide the shortage colours; full from zoom 8.
            'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.18, 8, 1],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 12, 2],
          },
        });
      } else {
        m.addLayer({
          id: 'sch-dots', type: 'circle', source: 'sch',
          paint: {
            'circle-color': ['match', ['get', 'k'], 0, COVERAGE_CLASSES[0].color, 1, COVERAGE_CLASSES[1].color,
              2, COVERAGE_CLASSES[2].color, COVERAGE_CLASSES[3].color],
            'circle-opacity': 0.75,
            'circle-radius': ['interpolate', ['linear'], ['sqrt', ['max', 0, ['get', 's']]], 0, 3, 20, 9, 60, 22, 120, 38],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1,
          },
        });
      }
      m.addLayer({
        id: 'sch-picked', type: 'circle', source: 'sch', filter: ['==', ['get', 'id'], ''],
        paint: {
          'circle-color': 'rgba(0,0,0,0)',
          'circle-radius': p.mode === 'points' ? ['interpolate', ['linear'], ['zoom'], 5, 6, 13, 14]
            : ['interpolate', ['linear'], ['sqrt', ['max', 0, ['get', 's']]], 0, 6, 20, 12, 60, 25, 120, 41],
          'circle-stroke-color': '#11151c',
          'circle-stroke-width': 2.5,
        },
      });
      const pick = (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === 'string') latest.current.onPick(id);
      };
      m.on('click', 'sch-dots', pick);
      m.on('mouseenter', 'sch-dots', () => { m.getCanvas().style.cursor = 'pointer'; });
      m.on('mouseleave', 'sch-dots', () => { m.getCanvas().style.cursor = ''; });
      ready.current = true;
      sync();
    });
    return () => { resize.disconnect(); ready.current = false; m.remove(); map.current = null; };
  }, []);

  function sync() {
    const m = map.current;
    if (!m || !ready.current) return;
    const p = latest.current;
    const src = m.getSource('sch') as GeoJSONSource | undefined;
    if (!src) return;
    if (p.mode === 'points') {
      src.setData(pointsData(p.points));
      const sectorFilter: ExpressionSpecification = ['in', ['get', 'sec'], ['literal', p.sectors]];
      m.setFilter('sch-dots', p.projectsOnly ? ['all', sectorFilter, ['>', ['get', 'cr'], 0]] : sectorFilter);
      m.setFilter('sch-projects', p.colorBy === 'status' ? ['==', ['get', 'cr'], -1] : ['all', sectorFilter, ['>', ['get', 'cr'], 0]]);
      m.setPaintProperty('sch-dots', 'circle-color', p.colorBy === 'status' ? statusColor : levelColor);
    } else {
      src.setData(areasData(p.areas));
    }
    m.setFilter('sch-picked', ['==', ['get', 'id'], p.selected ?? '']);
  }

  const dataKey = props.mode === 'points'
    ? `${props.points.length}|${props.sectors.join(',')}|${props.projectsOnly}|${props.colorBy ?? 'level'}`
    : `${props.areas.length}|${props.areas[0]?.division ?? ''}`;
  useEffect(sync, [dataKey, props.selected]);

  const fitKey = props.fit ? props.fit.flat().join(',') : '';
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const go = () => m.fitBounds(new LngLatBounds(props.fit ?? PH), { padding: 32, maxZoom: 12, duration: 600 });
    if (ready.current) go(); else m.once('load', go);
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className="sch-map" role="region" aria-label="Map of schools" />;
}
