/** The Indicators pages' data: the built indicators file and the province outlines. */
import { useEffect, useState } from 'react';
import { loadHgabGeo, type HgabGeo } from './hgab';
import type { IndicatorsFile } from './indicators';
import { loadIndicators, loadRegionBudget } from './indicators-view';
import type { RegionBudgetFile } from './budget-regions';

export function useIndicatorsData(): { data: IndicatorsFile | null; geo: HgabGeo | null; error: string | null } {
  const [state, setState] = useState<{ data: IndicatorsFile | null; geo: HgabGeo | null; error: string | null }>({ data: null, geo: null, error: null });
  useEffect(() => {
    let live = true;
    Promise.all([loadIndicators(), loadHgabGeo()])
      .then(([data, geo]) => { if (live) setState({ data, geo, error: null }); })
      .catch((e: unknown) => { if (live) setState({ data: null, geo: null, error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, []);
  return state;
}

export function useRegionBudget(): { data: RegionBudgetFile | null; error: string | null } {
  const [state, setState] = useState<{ data: RegionBudgetFile | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    loadRegionBudget()
      .then((data) => { if (live) setState({ data, error: null }); })
      .catch((e: unknown) => { if (live) setState({ data: null, error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, []);
  return state;
}
