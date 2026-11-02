import { useEffect, useState } from 'react';
import { dataUrl } from './data-url';

export const GAA_YEARS = Array.from({ length: 27 }, (_, i) => 2026 - i);
export const scopeLabels: Record<string, string> = {
  current_new_appropriations: 'New appropriations',
  published_new_appropriations: 'Published new appropriations',
  current_new_appropriations_first_preference:
    'New appropriations · first preference',
  current_new_appropriations_second_preference:
    'New appropriations · second preference',
  automatic_appropriations: 'Automatic appropriations',
  unprogrammed_appropriations: 'Unprogrammed appropriations (conditional)',
  existing_gaa_extract_scope: 'Existing GAA extract',
};
export function coverageLabel(status: string) {
  return (
    {
      partial_historical_coverage: 'Partial coverage',
      reenacted_no_new_gaa: 'Reenacted budget',
      published_editions_differ: 'Published editions differ',
      published_source_baseline: 'Published source baseline',
    }[status] ?? status.replaceAll('_', ' ')
  );
}
export interface GaaScope {
  id: string;
  amount: number;
  rows: number;
  groups: { name: string | null; amount: number; rows: number }[];
}
export interface GaaCoverage {
  year: number;
  status: string;
  rows: number;
  notes: string[];
  source_year?: number;
  scopes: GaaScope[];
  grains: Record<string, number>;
  file: string;
  sha256: string;
}
export interface GaaManifest {
  schema_version: number;
  currency: string;
  rows: number;
  download: string;
  sha256: string;
  years: GaaCoverage[];
}
let manifestPromise: Promise<GaaManifest> | undefined;
function loadManifest() {
  if (!manifestPromise)
    manifestPromise = fetch(dataUrl('gaa-explorer/manifest.json'))
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            `GAA coverage could not be loaded (HTTP ${r.status}).`,
          );
        const m = (await r.json()) as GaaManifest;
        if (m.schema_version !== 1 || m.years.length !== 27)
          throw new Error('Unsupported GAA coverage manifest.');
        return m;
      })
      .catch((e) => {
        manifestPromise = undefined;
        throw e;
      });
  return manifestPromise;
}
export function useGaaManifest() {
  const [manifest, setManifest] = useState<GaaManifest>();
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    loadManifest()
      .then((m) => {
        if (live) setManifest(m);
      })
      .catch((e) => {
        if (live) setError(String(e.message ?? e));
      });
    return () => {
      live = false;
    };
  }, []);
  return { manifest, error };
}
export function defaultScope(scopes: GaaScope[]) {
  return (
    scopes.find((s) => s.id.startsWith('current_new_appropriations')) ??
    scopes.find((s) => s.id === 'published_new_appropriations') ??
    scopes[0]
  );
}
export const pesos = (amount: number) =>
  new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(amount);
