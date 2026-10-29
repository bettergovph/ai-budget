/**
 * One budget line across twelve budgets: FY2020–FY2025 enacted, the four FY2026
 * stages, the FY2027 NEP and House bill (HISTORY_COLUMNS). Plain inline SVG in
 * the section's bar styles (enacted ink, NEP hatched, House accent; the Senate
 * bill amber, the one new style). A null cell is a short dashed slot, never a
 * zero bar; a listed zero is a rule on the baseline. Every bar carries a
 * `<title>` with the exact figure and its parts, and the chart's aria-label
 * lists every value, so the tooltip never gates a number (the table below the
 * charts has them all too).
 *
 * Cards on the page share one scale (`max`), so heights compare across lines.
 */
import { useId } from 'react';
import {
  HISTORY_COLUMNS, HISTORY_YEAR_GROUPS, STAGE_LABELS,
  type HistorySeries, type HistoryStage,
} from '../lib/hgab-history';
import { bn, cellTitle, count, niceTicks, type HistoryMode } from '../lib/hgab-history-view';

const tickText = (v: number, mode: HistoryMode) => (mode === 'php' ? (v >= 1e9 ? `${Math.round(v / 1e9)}B` : `${Math.round(v / 1e6)}M`) : v >= 1000 ? `${v / 1000}k` : String(v));

const STAGE_CLASS: Record<HistoryStage, string> = { gaa: 'is-gaa', nep: 'is-nep', house: 'is-house', senate: 'is-senate' };

/** A bar with a 4px rounded top, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

export function HistoryBars({ series, mode, max, labelled }: {
  series: HistorySeries;
  mode: HistoryMode;
  /** The shared scale (the largest value across every card in this mode). */
  max: number;
  /** Column indexes that get a value on the cap (selective labels). */
  labelled: readonly number[];
}) {
  const hatchId = `hgab-hy-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const W = 560;
  const H = 236;
  const left = 34;
  const top = 20;
  const bottom = 40;
  const gap = 12;
  const plotBottom = H - bottom;
  const plotH = plotBottom - top;
  const n = HISTORY_COLUMNS.length;
  // Gaps before FY2026 and before FY2027 set the stage groups apart.
  const slotW = (W - left - 2 * gap) / n;
  const barW = Math.min(24, slotW * 0.62);
  const xOf = (i: number) => left + i * slotW + (i >= 6 ? gap : 0) + (i >= 10 ? gap : 0);
  const cells = mode === 'php' ? series.php : series.projects;
  const y = (v: number) => plotBottom - (v / max) * plotH;
  const ticks = niceTicks(max);
  const summary = `${series.label}, ${mode === 'php' ? 'amount' : 'project lines'} per budget: ${HISTORY_COLUMNS.map((c, i) => `${c.label} ${cells[i] == null ? 'none' : mode === 'php' ? bn(cells[i]) : count(cells[i])}`).join('; ')}.`;

  return (
    <svg className="hgab-hy-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} focusable="false">
      <defs>
        <pattern id={hatchId} className="hgab-hy-hatch" patternUnits="userSpaceOnUse" width="4" height="4">
          <path d="M0 4 L4 0 M-1 1 L1 -1 M3 5 L5 3" />
        </pattern>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line className="hgab-hy-gridline" x1={left} x2={W} y1={y(t)} y2={y(t)} />
          <text className="hgab-hy-tick" x={left - 6} y={y(t) + 3}>{tickText(t, mode)}</text>
        </g>
      ))}
      <line className="hgab-hy-axis" x1={left} x2={W} y1={plotBottom} y2={plotBottom} />
      {HISTORY_COLUMNS.map((c, i) => {
        const v = cells[i];
        const x = xOf(i) + (slotW - barW) / 2;
        const cx = x + barW / 2;
        let body;
        if (v == null) {
          body = <rect className="hgab-hy-empty" x={x + 0.5} y={plotBottom - 14} width={barW - 1} height={13.5} rx={1} />;
        } else if (v === 0) {
          body = <line className="hgab-hy-zero" x1={x} x2={x + barW} y1={plotBottom - 1} y2={plotBottom - 1} />;
        } else {
          const h = Math.max((v / max) * plotH, 1.5);
          body = (
            <path
              className={`hgab-hy-bar ${STAGE_CLASS[c.stage]}`}
              d={barPath(x, plotBottom - h, barW, h)}
              fill={c.stage === 'nep' ? `url(#${hatchId})` : undefined}
            />
          );
        }
        const label = v != null && v > 0 && labelled.includes(i);
        return (
          <g key={c.key} className="hgab-hy-slot">
            <title>{cellTitle(series, i, mode)}</title>
            {/* The hit area is the whole slot, not only the painted bar. */}
            <rect className="hgab-hy-hit" x={xOf(i)} y={top - 14} width={slotW} height={plotBottom - top + 14} />
            {body}
            {label && (
              <text className="hgab-hy-val" x={cx} y={y(v) - 5}>
                {mode === 'php' ? bn(v).replace('₱', '') : count(v)}
              </text>
            )}
            <text className={`hgab-hy-x ${c.stage === 'gaa' && c.fy < 2026 ? '' : 'is-stage'}`} x={cx} y={plotBottom + 13}>{c.axis}</text>
          </g>
        );
      })}
      {HISTORY_YEAR_GROUPS.map((g) => {
        const x1 = xOf(g.from) + 2;
        const x2 = xOf(g.to) + slotW - 2;
        return (
          <g key={g.fy}>
            <line className="hgab-hy-group" x1={x1} x2={x2} y1={plotBottom + 21} y2={plotBottom + 21} />
            <text className="hgab-hy-group-label" x={(x1 + x2) / 2} y={plotBottom + 34}>{g.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** The key: the four bar styles and the empty slot, on one line. */
export function HistoryKey() {
  const stages: HistoryStage[] = ['gaa', 'nep', 'house', 'senate'];
  const text: Record<HistoryStage, string> = { gaa: 'enacted budget (GAA)', nep: 'NEP', house: 'House bill', senate: 'Senate bill' };
  return (
    <ul className="hgab-hy-key" aria-label="Bar styles">
      {stages.map((s) => (
        <li key={s} title={STAGE_LABELS[s].plain}><i className={STAGE_CLASS[s]} aria-hidden="true" />{text[s]}</li>
      ))}
      <li title="No line with an amount in that budget, or a stage the sources do not cover. This never means zero.">
        <i className="is-empty" aria-hidden="true" />no line
      </li>
    </ul>
  );
}
