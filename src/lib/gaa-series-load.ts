import { useEffect, useState } from 'react';
import { dataUrl } from './data-url';
import { SERIES_PATH, type GaaSeries } from './gaa-series';

let seriesPromise: Promise<GaaSeries> | undefined;

/** The 27-year series, fetched once per session. */
export function loadGaaSeries(): Promise<GaaSeries> {
  if (!seriesPromise) {
    seriesPromise = fetch(dataUrl(SERIES_PATH))
      .then(async (r) => {
        if (!r.ok) throw new Error(`The 2000–2026 series could not be loaded (HTTP ${r.status}).`);
        const s = (await r.json()) as GaaSeries;
        if (s.schema_version !== 1 || s.years.length !== 27) throw new Error('Unsupported GAA series file.');
        return s;
      })
      .catch((e) => {
        seriesPromise = undefined;
        throw e;
      });
  }
  return seriesPromise;
}

/** `series` is undefined while loading; `error` is set when it cannot be loaded (pages fall back to 2020–2026). */
export function useGaaSeries() {
  const [series, setSeries] = useState<GaaSeries>();
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    loadGaaSeries()
      .then((s) => { if (live) setSeries(s); })
      .catch((e) => { if (live) setError(String(e?.message ?? e)); });
    return () => { live = false; };
  }, []);
  return { series, error };
}
