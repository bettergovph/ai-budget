/**
 * Formatting and tooltip text for the budget-history charts and page
 * (src/components/HgabHistoryChart.tsx, src/pages/HgabHistory.tsx). Pure.
 */
import { HISTORY_COLUMNS, type HistorySeries } from './hgab-history';

export type HistoryMode = 'php' | 'projects';

/** "₱83.7B" / "₱420M" / "₱8,000". */
export function bn(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v >= 1e9) return `₱${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `₱${Math.round(v / 1e6).toLocaleString('en-US')}M`;
  return `₱${v.toLocaleString('en-US')}`;
}
/** "83.7 billion" for sentences. */
export function billions(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v >= 1e9) return `₱${(v / 1e9).toFixed(1)} billion`;
  return `₱${Math.round(v / 1e6).toLocaleString('en-US')} million`;
}
export const fullPeso = (v: number | null | undefined) => (v == null ? '—' : `₱${v.toLocaleString('en-US')}`);
export const count = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-US'));

/** Clean gridline steps for a peso or count scale: three or four lines up to the top. */
export function niceTicks(max: number): number[] {
  if (!(max > 0)) return [];
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const out: number[] = [];
  for (let t = step; t <= max * 1.001; t += step) out.push(t);
  return out;
}

/** Why a cell has no bar, for its tooltip. */
export function emptyReason(series: HistorySeries, i: number, mode: HistoryMode): string {
  const c = HISTORY_COLUMNS[i];
  if (mode === 'projects') {
    if (series.department !== 'DPWH') return 'One program line; projects are not counted';
    if (c.source === 'pbc2026') return 'Projects are not listed for this stage';
  }
  if (series.key === 'fap' && c.source === 'pbc2026') return 'Not compiled for this stage';
  if (series.key === 'fap' && c.key === 'gaa-2024') return 'The FY2024 GAA data lists no foreign-assisted DPWH lines';
  return 'No line with an amount in this budget';
}

/** The tooltip of one bar: stage, exact figure, parts, foreign-assisted share, projects. */
export function cellTitle(series: HistorySeries, i: number, mode: HistoryMode): string {
  const c = HISTORY_COLUMNS[i];
  const v = mode === 'php' ? series.php[i] : series.projects[i];
  if (v == null) return `${series.label}, ${c.label}: ${emptyReason(series, i, mode)}.`;
  const lines = [`${series.label}, ${c.label}`];
  if (mode === 'php') {
    lines.push(fullPeso(v));
    const parts = series.parts.filter((p) => p.php[i] != null && p.php[i]! > 0);
    if (series.parts.length > 1 && parts.length) lines.push(parts.map((p) => `${p.label} ${bn(p.php[i])}`).join(' · '));
    const f = series.foreign_php[i];
    if (series.key !== 'fap' && f != null && f > 0) lines.push(`Foreign-assisted: ${bn(f)}${f === v ? ' (all of it)' : ''}`);
    if (series.projects[i] != null) lines.push(`${count(series.projects[i])} project lines`);
  } else {
    lines.push(`${count(v)} project lines`);
    if (series.php[i] != null) lines.push(fullPeso(series.php[i]));
  }
  return lines.join('\n');
}

