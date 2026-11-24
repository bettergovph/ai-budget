/**
 * Small SVG charts for the schools overview (`/schools/overview`): columns (one series), stacked columns (a few kinds,
 * fixed colours from DPWH_KINDS) and a scatter. Thin marks with rounded data ends, a hairline baseline, a tooltip on
 * hover or focus for every mark; every chart has a table beside it on the page, so no value is told by colour alone.
 */
import { useRef, useState, type ReactNode } from 'react';

interface Tip { x: number; y: number; body: ReactNode }

function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (e: { clientX: number; clientY: number } | null, target: Element, body: ReactNode) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const t = target.getBoundingClientRect();
    const x = e ? e.clientX - r.left : t.left + t.width / 2 - r.left;
    const y = e ? e.clientY - r.top : t.top - r.top;
    setTip({ x, y, body });
  };
  const view = tip && (
    <div className="sch-tip" style={{ left: tip.x, top: tip.y }} role="status">{tip.body}</div>
  );
  return { box, show, hide: () => setTip(null), view };
}

/** The top of a column with rounded corners only at the data end (radius r), square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

const W = 720;
const H = 260;
const PAD = { l: 52, r: 12, t: 16, b: 40 };

function ticks(max: number, n = 4) {
  if (max <= 0) return [0];
  const raw = max / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

export interface Column { key: string; label: string; sub?: string; value: number; muted?: boolean }

/** One series of columns, one hue; `muted` columns (another stage, say) are lighter, and say so in their label. */
export function Columns({ data, color, format, title }: { data: Column[]; color: string; format: (v: number) => string; title: string }) {
  const { box, show, hide, view } = useTip();
  const max = Math.max(...data.map((d) => d.value), 0);
  const ys = ticks(max);
  const top = ys[ys.length - 1] || 1;
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const band = iw / data.length, bw = Math.min(24, band * 0.6);
  const y = (v: number) => PAD.t + ih - (v / top) * ih;
  return (
    <div className="sch-chart" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onMouseLeave={hide}>
        {ys.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="sch-grid" />
            <text x={PAD.l - 6} y={y(v)} className="sch-axis" textAnchor="end" dominantBaseline="middle">{format(v)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = PAD.l + band * i + (band - bw) / 2;
          return (
            <g key={d.key}>
              <rect x={PAD.l + band * i} y={PAD.t} width={band} height={ih} fill="transparent" tabIndex={0}
                aria-label={`${d.label}${d.sub ? ` ${d.sub}` : ''}: ${format(d.value)}`}
                onMouseMove={(e) => show(e, e.currentTarget, <><strong>{d.label}</strong>{d.sub ? ` · ${d.sub}` : ''}<br />{format(d.value)}</>)}
                onFocus={(e) => show(null, e.currentTarget, <><strong>{d.label}</strong>{d.sub ? ` · ${d.sub}` : ''}<br />{format(d.value)}</>)}
                onBlur={hide} />
              <path d={columnPath(x, y(d.value), bw, y(0) - y(d.value), 4)} fill={color} opacity={d.muted ? 0.45 : 1} pointerEvents="none" />
              <text x={x + bw / 2} y={y(d.value) - 6} className="sch-val" textAnchor="middle">{format(d.value)}</text>
              <text x={x + bw / 2} y={H - PAD.b + 16} className="sch-axis" textAnchor="middle">{d.label}</text>
              {d.sub && <text x={x + bw / 2} y={H - PAD.b + 30} className="sch-axis sch-axis-sub" textAnchor="middle">{d.sub}</text>}
            </g>
          );
        })}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} className="sch-base" />
      </svg>
      {view}
    </div>
  );
}

export interface StackSeries { key: string; label: string; color: string }

/** Stacked columns: one per `x`, segments in `series` order from the baseline, a 2px gap between segments. */
export function Stacked({ xs, series, value, format, title }: {
  xs: (string | number)[]; series: StackSeries[]; value: (x: string | number, s: string) => number; format: (v: number) => string; title: string;
}) {
  const { box, show, hide, view } = useTip();
  const totals = xs.map((x) => series.reduce((a, s) => a + value(x, s.key), 0));
  const ys = ticks(Math.max(...totals, 0));
  const top = ys[ys.length - 1] || 1;
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const band = iw / xs.length, bw = Math.min(24, band * 0.6);
  const sy = (v: number) => (v / top) * ih;
  const base = PAD.t + ih;
  return (
    <div className="sch-chart" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onMouseLeave={hide}>
        {ys.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={base - sy(v)} y2={base - sy(v)} className="sch-grid" />
            <text x={PAD.l - 6} y={base - sy(v)} className="sch-axis" textAnchor="end" dominantBaseline="middle">{format(v)}</text>
          </g>
        ))}
        {xs.map((x, i) => {
          const left = PAD.l + band * i + (band - bw) / 2;
          let acc = 0;
          const segs = series.map((s) => {
            const v = value(x, s.key);
            const h = sy(v);
            const yTop = base - sy(acc) - h;
            acc += v;
            return { s, v, h, yTop };
          }).filter((g) => g.h > 0);
          const tipBody = (
            <><strong>{x}</strong> · {format(totals[i])}
              {series.map((s) => <span key={s.key} className="sch-tip-row"><span className="sch-swatch" style={{ background: s.color }} />{s.label}: {format(value(x, s.key))}</span>)}</>
          );
          return (
            <g key={x}>
              <rect x={PAD.l + band * i} y={PAD.t} width={band} height={ih} fill="transparent" tabIndex={0}
                aria-label={`${x}: ${format(totals[i])}`}
                onMouseMove={(e) => show(e, e.currentTarget, tipBody)} onFocus={(e) => show(null, e.currentTarget, tipBody)} onBlur={hide} />
              {segs.map((g, j) => {
                const last = j === segs.length - 1;
                // 2px surface gap between segments: each segment but the lowest gives up its bottom 2px.
                const gap = j === 0 ? 0 : Math.min(2, g.h / 2);
                return last
                  ? <path key={g.s.key} d={columnPath(left, g.yTop, bw, g.h - gap, 4)} fill={g.s.color} pointerEvents="none" />
                  : <rect key={g.s.key} x={left} y={g.yTop} width={bw} height={Math.max(0, g.h - gap)} fill={g.s.color} pointerEvents="none" />;
              })}
              <text x={left + bw / 2} y={H - PAD.b + 16} className="sch-axis" textAnchor="middle">{x}</text>
            </g>
          );
        })}
        <line x1={PAD.l} x2={W - PAD.r} y1={base} y2={base} className="sch-base" />
      </svg>
      <ul className="sch-legend sch-chart-legend">
        {series.map((s) => <li key={s.key}><span className="sch-swatch sch-swatch-sq" style={{ background: s.color }} />{s.label}</li>)}
      </ul>
      {view}
    </div>
  );
}

export interface Dot { key: string; label: string; x: number; y: number; note?: string }

/** A scatter of areas: one hue, 2px surface ring; the dots named in `label` get a direct label. */
export function Scatter({ dots, xLabel, yLabel, fx, fy, color, labelled = [], title }: {
  dots: Dot[]; xLabel: string; yLabel: string; fx: (v: number) => string; fy: (v: number) => string; color: string;
  labelled?: string[]; title: string;
}) {
  const { box, show, hide, view } = useTip();
  const SW = 520, SH = 340, P = { l: 52, r: 16, t: 14, b: 44 };
  const xt = ticks(Math.max(...dots.map((d) => d.x), 0));
  const yt = ticks(Math.max(...dots.map((d) => d.y), 0));
  const xmax = xt[xt.length - 1] || 1, ymax = yt[yt.length - 1] || 1;
  const px = (v: number) => P.l + (v / xmax) * (SW - P.l - P.r);
  const py = (v: number) => SH - P.b - (v / ymax) * (SH - P.t - P.b);
  return (
    <div className="sch-chart" ref={box}>
      <svg viewBox={`0 0 ${SW} ${SH}`} role="img" aria-label={title} onMouseLeave={hide}>
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line x1={P.l} x2={SW - P.r} y1={py(v)} y2={py(v)} className="sch-grid" />
            <text x={P.l - 6} y={py(v)} className="sch-axis" textAnchor="end" dominantBaseline="middle">{fy(v)}</text>
          </g>
        ))}
        {xt.map((v) => <text key={`x${v}`} x={px(v)} y={SH - P.b + 16} className="sch-axis" textAnchor="middle">{fx(v)}</text>)}
        <line x1={P.l} x2={SW - P.r} y1={py(0)} y2={py(0)} className="sch-base" />
        <text x={(P.l + SW - P.r) / 2} y={SH - 6} className="sch-axis sch-axis-title" textAnchor="middle">{xLabel}</text>
        <text x={12} y={(P.t + SH - P.b) / 2} className="sch-axis sch-axis-title" textAnchor="middle" transform={`rotate(-90 12 ${(P.t + SH - P.b) / 2})`}>{yLabel}</text>
        {dots.map((d) => {
          const body = <><strong>{d.label}</strong><br />{xLabel}: {fx(d.x)}<br />{yLabel}: {fy(d.y)}{d.note ? <><br />{d.note}</> : null}</>;
          return (
            <g key={d.key}>
              <circle cx={px(d.x)} cy={py(d.y)} r={10} fill="transparent" tabIndex={0} aria-label={`${d.label}: ${fx(d.x)}, ${fy(d.y)}`}
                onMouseMove={(e) => show(e, e.currentTarget, body)} onFocus={(e) => show(null, e.currentTarget, body)} onBlur={hide} />
              <circle cx={px(d.x)} cy={py(d.y)} r={4.5} fill={color} stroke="#fff" strokeWidth={2} pointerEvents="none" />
              {labelled.includes(d.key) && <text x={px(d.x) + 8} y={py(d.y) - 6} className="sch-val sch-val-left">{d.label}</text>}
            </g>
          );
        })}
      </svg>
      {view}
    </div>
  );
}
