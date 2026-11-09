/**
 * Two indicators against each other, one dot per area (Indicators section). One x and one y axis, never
 * two y scales. Skewed positive measures (budget per person, population) switch to a log scale, and the
 * axis says so. BARMM provinces and Sulu are drawn hollow on budget comparisons, because DPWH builds
 * little there for reasons that have nothing to do with need.
 *
 * It only shows the pattern. It prints no correlation figure and makes no claim about cause.
 */
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { areaPath, formatIndicator, formatSigned, type IndicatorDef, type IndicatorsFile } from '../lib/indicators';

const W = 720, H = 440, M = { l: 72, r: 20, t: 16, b: 52 };

interface Pt { id: string; name: string; x: number; y: number; hollow: boolean }

/** Log scale for skewed magnitudes only (pesos, people, density), never for shares or rates. */
function wantsLog(vs: number[], def: IndicatorDef): boolean {
  if (!['peso', 'count', 'per-km2'].includes(def.unit) || !vs.length || vs.some((v) => v <= 0)) return false;
  const min = Math.min(...vs), max = Math.max(...vs);
  return max / min > 30;
}

function ticks(lo: number, hi: number, log: boolean): number[] {
  if (log) {
    const out: number[] = [];
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const m of [1, 3]) {
      const t = m * 10 ** e;
      if (t >= lo && t <= hi) out.push(t);
    }
    return out;
  }
  const span = hi - lo || 1, step0 = span / 5, p = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => span / s <= 6)!;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Number(t.toFixed(10)));
  return out;
}

export default function IndicatorScatter({ data, x, y, highlight }: {
  data: IndicatorsFile;
  x: IndicatorDef;
  y: IndicatorDef;
  highlight?: string | null;
}) {
  const xs = data.indicators.find((i) => i.id === x.id)!.values;
  const ys = data.indicators.find((i) => i.id === y.id)!.values;
  const budget = x.theme === 'budget' || y.theme === 'budget';
  const pts: Pt[] = useMemo(() => data.areas
    .filter((a) => xs[a.id] != null && ys[a.id] != null)
    .map((a) => ({ id: a.id, name: a.name, x: xs[a.id]!, y: ys[a.id]!, hollow: budget && a.barmm_period })), [data, xs, ys, budget]);
  const logX = wantsLog(pts.map((p) => p.x), x), logY = wantsLog(pts.map((p) => p.y), y);
  const ext = (vs: number[], log: boolean) => {
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (log) return [lo / 1.15, hi * 1.15];
    const pad = (hi - lo) * 0.05 || 1;
    lo -= pad; hi += pad;
    return [lo, hi];
  };
  const [x0, x1] = ext(pts.map((p) => p.x), logX), [y0, y1] = ext(pts.map((p) => p.y), logY);
  const sx = (v: number) => M.l + ((logX ? Math.log(v) - Math.log(x0) : v - x0) / (logX ? Math.log(x1) - Math.log(x0) : x1 - x0)) * (W - M.l - M.r);
  const sy = (v: number) => H - M.b - ((logY ? Math.log(v) - Math.log(y0) : v - y0) / (logY ? Math.log(y1) - Math.log(y0) : y1 - y0)) * (H - M.t - M.b);
  const fx = (v: number) => (x.scale === 'diverging' ? formatSigned(v, x) : formatIndicator(v, x, { compact: true }));
  const fy = (v: number) => (y.scale === 'diverging' ? formatSigned(v, y) : formatIndicator(v, y, { compact: true }));
  const [hover, setHover] = useState<Pt | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  return (
    <figure className="ind-scatter">
      <div className="ind-scatter-frame" ref={frame}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${pts.length} areas: ${y.short} against ${x.short}.`}>
          {ticks(y0, y1, logY).map((t) => (
            <g key={`y${t}`} className="ind-scatter-grid">
              <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} />
              <text x={M.l - 8} y={sy(t)} dy="0.32em" textAnchor="end">{fy(t)}</text>
            </g>
          ))}
          {ticks(x0, x1, logX).map((t) => (
            <g key={`x${t}`} className="ind-scatter-grid">
              <line y1={M.t} y2={H - M.b} x1={sx(t)} x2={sx(t)} />
              <text y={H - M.b + 18} x={sx(t)} textAnchor="middle">{fx(t)}</text>
            </g>
          ))}
          {(x.scale === 'diverging' && x0 < 0 && x1 > 0) && <line className="ind-scatter-zero" y1={M.t} y2={H - M.b} x1={sx(0)} x2={sx(0)} />}
          {(y.scale === 'diverging' && y0 < 0 && y1 > 0) && <line className="ind-scatter-zero" x1={M.l} x2={W - M.r} y1={sy(0)} y2={sy(0)} />}
          <text className="ind-scatter-axis" x={(M.l + W - M.r) / 2} y={H - 10} textAnchor="middle">{x.short}{logX ? ' (log scale)' : ''}</text>
          <text className="ind-scatter-axis" transform={`translate(16 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle">{y.short}{logY ? ' (log scale)' : ''}</text>
          {pts.map((p) => (
            <circle
              key={p.id}
              cx={sx(p.x)} cy={sy(p.y)} r={p.id === highlight ? 7 : 4.5}
              className={`ind-scatter-dot${p.hollow ? ' is-hollow' : ''}${p.id === highlight ? ' is-highlight' : ''}${hover?.id === p.id ? ' is-on' : ''}`}
              onPointerEnter={() => setHover(p)}
              onPointerLeave={() => setHover(null)}
            />
          ))}
          {/* Bigger invisible targets on top, so a dot is easy to hit. */}
          {pts.map((p) => (
            <circle key={`hit-${p.id}`} cx={sx(p.x)} cy={sy(p.y)} r={11} className="ind-scatter-hit" onPointerEnter={() => setHover(p)} onPointerLeave={() => setHover(null)} />
          ))}
        </svg>
        {hover && (
          <div className="ind-map-tip" style={{ left: `${(sx(hover.x) / W) * 100}%`, top: `${(sy(hover.y) / H) * 100}%` }} role="status">
            <strong>{hover.name}</strong>
            <span>{x.short}: {fx(hover.x)}</span>
            <span>{y.short}: {fy(hover.y)}</span>
          </div>
        )}
      </div>
      <figcaption className="ind-scatter-cap">
        {pts.length} areas with both figures. Hover a dot for its name; every value is in the tables.
        {budget && pts.some((p) => p.hollow) && <> Hollow dots are the BARMM provinces and Sulu, where DPWH builds little.</>}
        {highlight && pts.some((p) => p.id === highlight) && <> The large dot is <Link to={areaPath(highlight)}>{data.areas.find((a) => a.id === highlight)?.name}</Link>.</>}
      </figcaption>
    </figure>
  );
}
