/**
 * One group (or the nation) across the 27 GAA years, FY2000–2026: bars with a
 * line, in the portal's trend styles. A null year is a dashed slot on the
 * baseline, never a zero bar; a partial-coverage year is a lighter, dashed bar.
 * Every bar carries a `<title>` with the exact figure and the year's coverage
 * note, and the chart's aria-label lists every value, so nothing depends on
 * hover.
 */
import type { ReactNode } from 'react';
import * as fmt from '../lib/format';

export interface SeriesChartPoint {
  year: number;
  amount: number | null;
  /** The manifest's coverage status for the year. */
  status: string;
  note?: string | null;
}

const PARTIAL = new Set(['partial_historical_coverage', 'published_editions_differ']);

function statusText(status: string): string {
  return {
    partial_historical_coverage: 'partial coverage',
    reenacted_no_new_gaa: 'reenacted budget, no new GAA',
    published_editions_differ: 'published editions differ',
    published_source_baseline: 'published source baseline',
  }[status] ?? status.replaceAll('_', ' ');
}

export default function GaaSeriesChart({
  title, meta, points, unit, height = 280,
}: {
  title: ReactNode;
  meta?: string;
  points: SeriesChartPoint[];
  unit: 'T' | 'B';
  height?: number;
}) {
  const w = 1000;
  const h = height;
  const pad = { l: 56, r: 16, t: 22, b: 36 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const n = points.length;
  const slot = innerW / n;
  const barW = slot * 0.6;
  const values = points.map((p) => p.amount);
  const maxV = Math.max(1, ...values.map((v) => v ?? 0)) * 1.12;
  const x = (i: number) => pad.l + slot * (i + 0.5);
  const y = (v: number) => pad.t + innerH - (v / maxV) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => maxV * t);

  // The line breaks at every null year.
  const runs: string[] = [];
  let run: string[] = [];
  values.forEach((v, i) => {
    if (v == null) { if (run.length > 1) runs.push(run.join(' ')); run = []; return; }
    run.push(`${x(i)},${y(v)}`);
  });
  if (run.length > 1) runs.push(run.join(' '));

  // Value labels only where they help: the first recorded year, the peak, the latest.
  const recorded = values.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0);
  const first = recorded[0];
  const last = recorded[recorded.length - 1];
  const peak = recorded.reduce((best, i) => ((values[i] ?? 0) > (values[best] ?? 0) ? i : best), first);
  const labelled = new Set([first, peak, last]);

  const aria = points
    .map((p) => `FY${p.year}: ${p.amount == null ? statusText(p.status) : fmt.shortPhp(p.amount, unit)}`)
    .join('; ');

  return (
    <div className="trend gaa-series-chart">
      <div className="trend-title">
        <h2>{title}</h2>
        {meta && <span className="meta">{meta}</span>}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={aria}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--rule-soft)" strokeWidth="1" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--ink-3)' }}>
              {fmt.shortPhp(t, unit)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const partial = PARTIAL.has(p.status);
          const tip = `FY${p.year} · ${p.amount == null ? statusText(p.status) : fmt.php(p.amount)}${p.note ? ` · ${p.note}` : p.amount != null ? ` · ${statusText(p.status)}` : ''}`;
          return (
            <g key={p.year}>
              {p.amount == null ? (
                <line
                  x1={x(i) - barW / 2} x2={x(i) + barW / 2} y1={y(0) - 3} y2={y(0) - 3}
                  stroke="var(--ink-3)" strokeWidth="2" strokeDasharray="3 3"
                >
                  <title>{tip}</title>
                </line>
              ) : (
                <rect
                  x={x(i) - barW / 2} y={y(p.amount)} width={barW} height={innerH - (y(p.amount) - pad.t)}
                  fill="var(--accent-soft)" fillOpacity={partial ? 0.45 : 1}
                  stroke={partial ? 'var(--accent-deep)' : 'none'} strokeDasharray={partial ? '3 2' : undefined}
                >
                  <title>{tip}</title>
                </rect>
              )}
              <text
                x={x(i)} y={h - 14} textAnchor="middle"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: p.amount == null ? 'var(--ink-mute)' : 'var(--ink-3)' }}
              >
                {p.year}
              </text>
            </g>
          );
        })}
        {runs.map((pts, i) => <polyline key={i} points={pts} fill="none" stroke="var(--accent-deep)" strokeWidth="2" />)}
        {points.map((p, i) => p.amount == null ? null : (
          <g key={`d${p.year}`}>
            <circle cx={x(i)} cy={y(p.amount)} r={3} fill="var(--accent-deep)" />
            {labelled.has(i) && (
              <text
                x={x(i)} y={y(p.amount) - 10} textAnchor="middle"
                style={{ fontFamily: 'var(--font-hero)', fontSize: 12, fontWeight: 700, fill: 'var(--ink)' }}
              >
                {fmt.shortPhp(p.amount, unit)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <p className="gaa-series-legend">
        <span className="gaa-series-key is-full" aria-hidden="true" /> recorded ·{' '}
        <span className="gaa-series-key is-partial" aria-hidden="true" /> partial coverage ·{' '}
        <span className="gaa-series-key is-none" aria-hidden="true" /> reenacted budget, no new GAA.
        Hover a bar for the exact figure.
      </p>
    </div>
  );
}
