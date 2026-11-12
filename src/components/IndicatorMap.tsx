/**
 * A province map shaded by one indicator (Indicators section). SVG, one path per province outline
 * (data/hgab/2027/geo/provinces.json, the House bill maps' outlines), coloured by the area it belongs to.
 * Metro Manila's four districts are too small to see at country scale, so they repeat in an inset.
 *
 * Hover (or tap) a province for its value and rank; click to open the area's page. The table beside the
 * map carries every value, so nothing is told by colour alone.
 */
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { HgabGeo } from '../lib/hgab';
import { makeProjection, polygonsToPath, type Box } from '../lib/hgab-map';
import { areaPath, formatIndicator, formatSigned, ranks, type IndicatorDef, type IndicatorsFile } from '../lib/indicators';
import { NO_DATA, colorOf, ordinal, type MapClass } from '../lib/indicators-view';

interface Shape { psgc: number; d: string; box: Box; region: string }
interface Hover { areaId: string; x: number; y: number }

export default function IndicatorMap({ geo, data, def, values, classes, highlight, compact = false }: {
  geo: HgabGeo;
  data: IndicatorsFile;
  def: IndicatorDef;
  values: Record<string, number | null>;
  classes: MapClass[];
  /** An area to outline (the area page's locator). */
  highlight?: string | null;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const frame = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const proj = useMemo(() => makeProjection(geo.bbox), [geo]);
  const shapes: Shape[] = useMemo(
    () => geo.provinces.map((f) => ({ psgc: f.psgc, region: f.region, ...polygonsToPath(f.polygons, proj) })),
    [geo, proj],
  );
  const areaOf = useMemo(() => {
    const m = new Map<number, string>();
    for (const a of data.areas) for (const p of a.psgc) m.set(p, a.id);
    return m;
  }, [data]);
  const nameOf = useMemo(() => new Map(data.areas.map((a) => [a.id, a.name])), [data]);
  const rankOf = useMemo(() => ranks(values), [values]);
  const ranked = rankOf.size;

  // Metro Manila inset, top right over the sea.
  const ncr = shapes.filter((s) => s.region === 'NCR');
  const nb = ncr.reduce(
    (b, s) => ({ x0: Math.min(b.x0, s.box.x), y0: Math.min(b.y0, s.box.y), x1: Math.max(b.x1, s.box.x + s.box.w), y1: Math.max(b.y1, s.box.y + s.box.h) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  );
  const inset = { x: proj.width * 0.7, y: proj.height * 0.03, w: proj.width * 0.22 };
  const insetScale = inset.w / Math.max(1e-6, nb.x1 - nb.x0);
  const insetH = (nb.y1 - nb.y0) * insetScale;

  const onMove = (e: ReactPointerEvent, areaId: string | undefined) => {
    if (!areaId || !frame.current) return;
    const r = frame.current.getBoundingClientRect();
    setHover({ areaId, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const fmt = (v: number | null) => (def.scale === 'diverging' ? formatSigned(v, def) : formatIndicator(v, def));

  const paths = (list: Shape[], strokeScale = 1) =>
    list.map((s) => {
      const id = areaOf.get(s.psgc);
      const v = id ? values[id] : null;
      const on = id != null && (hover?.areaId === id || highlight === id);
      return (
        <path
          key={s.psgc}
          d={s.d}
          fill={compact && highlight ? (id === highlight ? '#0b4fd9' : NO_DATA) : colorOf(classes, v)}
          className={`ind-map-shape${on ? ' is-on' : ''}`}
          strokeWidth={0.5 / strokeScale}
          fillRule="evenodd"
          onPointerMove={(e) => onMove(e, id)}
          onPointerLeave={() => setHover(null)}
          onClick={() => id && navigate(areaPath(id))}
        />
      );
    });

  const hv = hover ? values[hover.areaId] : null;
  const hr = hover ? rankOf.get(hover.areaId) : undefined;

  return (
    <figure className={`ind-map${compact ? ' is-compact' : ''}`}>
      <div className="ind-map-frame" ref={frame}>
        <svg
          viewBox={`0 0 ${proj.width} ${proj.height}`}
          role="img"
          aria-label={`Map of the Philippines by province: ${def.title}. Every value is in the table below the map.`}
        >
          <g>{paths(shapes)}</g>
          {!compact && ncr.length > 0 && (
            <g className="ind-map-inset">
              <rect x={inset.x - 6} y={inset.y - 6} width={inset.w + 12} height={insetH + 26} rx={4} />
              <g transform={`translate(${inset.x} ${inset.y}) scale(${insetScale}) translate(${-nb.x0} ${-nb.y0})`}>{paths(ncr, insetScale)}</g>
              <text x={inset.x} y={inset.y + insetH + 15}>Metro Manila</text>
            </g>
          )}
        </svg>
        {hover && (
          <div className="ind-map-tip" style={{ left: hover.x, top: hover.y }} role="status">
            <strong>{nameOf.get(hover.areaId)}</strong>
            <span className="ind-map-tip-v">{fmt(hv ?? null)}</span>
            <span className="ind-map-tip-r">{hv == null ? 'No figure' : hr ? `${ordinal(hr)} highest of ${ranked}` : ''}</span>
          </div>
        )}
      </div>
      {!compact && (
        <figcaption className="ind-map-legend">
          <ul>
            {classes.map((c) => (
              <li key={c.label}>
                <span className="ind-map-sw" style={{ background: c.color }} aria-hidden="true" />
                <span>{c.label}</span>
                <span className="ind-map-count">{c.count}</span>
              </li>
            ))}
            {Object.values(values).some((v) => v == null) && (
              <li>
                <span className="ind-map-sw is-none" style={{ background: NO_DATA }} aria-hidden="true" />
                <span>No figure</span>
                <span className="ind-map-count">{Object.values(values).filter((v) => v == null).length}</span>
              </li>
            )}
          </ul>
          <p className="ind-map-note">
            {def.scale === 'diverging'
              ? 'Blue went down, red went up. The colours do not mean good or bad.'
              : 'Darker is higher. Each shade holds about a fifth of the areas; the colours do not mean good or bad.'}
          </p>
        </figcaption>
      )}
    </figure>
  );
}
