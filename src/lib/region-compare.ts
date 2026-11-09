/** State and defaults for the region comparison (components/RegionBudgetCompare.tsx). */
import type { BudgetYear, RegionBudgetFile } from './budget-regions';
import { INDICATORS, type IndicatorDef } from './indicators';

export type Per = 'person' | 'need';
export type SortKey = 'indicator' | 'per' | 'gap' | 'budget';
export interface CompareState { year: BudgetYear; dept: string; per: Per; sort: SortKey }

/** Indicators that can sit beside the budget (the budget indicators themselves cannot). */
export const COMPARABLE = INDICATORS.filter((d) => d.theme !== 'budget');

export function defaultState(def: IndicatorDef, rb: RegionBudgetFile | null, over: Partial<CompareState> = {}): CompareState {
  const known = (id: string | undefined) => id != null && (rb ? rb.departments.some((d) => d.id === id) : true);
  return {
    year: over.year ?? '2027',
    dept: known(over.dept) ? over.dept! : def.budgetDept ?? 'all',
    per: def.need && over.per !== 'person' ? (over.per ?? 'need') : 'person',
    sort: over.sort ?? 'indicator',
  };
}

