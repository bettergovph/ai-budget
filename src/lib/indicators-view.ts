/**
 * Pure helpers for the Indicators pages: map colour classes, the legend, and the loader.
 *
 * Colours (checked with the dataviz validator, 2026-11-07):
 * - sequential: one blue ramp, light → dark, in five classes of about equal size (quintiles), so a few
 *   very large values (Batanes, Abra) do not wash every other area out;
 * - diverging (changes): blue arm below zero, red arm above, a grey middle for "about zero". Red means
 *   "went up" and blue "went down", as on the House bill maps; neither means good or bad.
 * Every map sits above a table with every value, so no figure is told by colour alone.
 */
import { cached, getJson } from './hgab';
import { dataUrl } from './data-url';
import {
  INDICATORS_DATA_PATH, formatIndicator, formatSigned,
  type IndicatorDef, type IndicatorsFile,
} from './indicators';
import { REGION_BUDGET_PATH, type RegionBudgetFile } from './budget-regions';

export const SEQUENTIAL = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'] as const;
export const DIVERGING = { low2: '#1c5cab', low1: '#86b6ef', mid: '#f0efec', high1: '#ed9189', high2: '#9b2b2a' } as const;
export const NO_DATA = '#eceef2';

export function csvHref(data: IndicatorsFile): string {
  return `${dataUrl(data.csv.path)}?v=${data.csv.sha256.slice(0, 12)}`;
}

export function loadRegionBudget(): Promise<RegionBudgetFile> {
  return cached('indicators-regions', () => getJson<RegionBudgetFile>(dataUrl(REGION_BUDGET_PATH), 'Failed to load the budget by region'));
}

export function loadIndicators(): Promise<IndicatorsFile> {
  return cached('indicators', () => getJson<IndicatorsFile>(dataUrl(INDICATORS_DATA_PATH), 'Failed to load the indicators'));
}

export interface MapClass { color: string; label: string; count: number; test: (v: number) => boolean }

function quantile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** The map's colour classes for one indicator's values. */
export function mapClasses(def: IndicatorDef, values: Record<string, number | null>): MapClass[] {
  const vs = Object.values(values).filter((v): v is number => v != null).sort((a, b) => a - b);
  if (!vs.length) return [];
  const fmt = (v: number) => formatIndicator(v, def, { compact: true });
  if (def.scale === 'diverging') {
    // "About zero": half a point or half a peso; a tenth of a percent for yearly growth.
    const near = def.unit === 'percent' ? 0.1 : 0.5;
    const abs = vs.map(Math.abs).filter((v) => v >= near).sort((a, b) => a - b);
    const t = abs.length ? quantile(abs, 0.5) : near;
    const sfmt = (v: number) => formatSigned(v, def);
    const classes: MapClass[] = [
      { color: DIVERGING.low2, label: `${sfmt(-t)} or lower`, count: 0, test: (v) => v <= -t },
      { color: DIVERGING.low1, label: `${sfmt(-t)} to ${sfmt(-near)}`, count: 0, test: (v) => v > -t && v <= -near },
      { color: DIVERGING.mid, label: 'About zero', count: 0, test: (v) => Math.abs(v) < near },
      { color: DIVERGING.high1, label: `${sfmt(near)} to ${sfmt(t)}`, count: 0, test: (v) => v >= near && v < t },
      { color: DIVERGING.high2, label: `${sfmt(t)} or higher`, count: 0, test: (v) => v >= t },
    ];
    for (const v of vs) classes.find((c) => c.test(v))!.count++;
    return classes;
  }
  // Quintile breaks; equal breaks (many tied values) collapse into fewer classes.
  const breaks = [0.2, 0.4, 0.6, 0.8].map((q) => quantile(vs, q));
  const edges = [vs[0], ...breaks, vs[vs.length - 1]];
  const classes: MapClass[] = [];
  for (let i = 0; i < 5; i++) {
    const lo = edges[i], hi = edges[i + 1];
    if (i > 0 && hi === edges[i]) continue;
    const last = i === 4;
    classes.push({
      color: SEQUENTIAL[i], label: `${fmt(lo)} – ${fmt(hi)}`, count: 0,
      test: (v) => (i === 0 || v > lo) && (last || v <= hi),
    });
  }
  for (const v of vs) (classes.find((c) => c.test(v)) ?? classes[classes.length - 1]).count++;
  return classes;
}

export function colorOf(classes: MapClass[], v: number | null | undefined): string {
  if (v == null) return NO_DATA;
  return (classes.find((c) => c.test(v)) ?? classes[classes.length - 1])?.color ?? NO_DATA;
}

/** "12th of 86". */
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}
