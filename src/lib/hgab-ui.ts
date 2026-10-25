/**
 * Small presentational helpers for the `/hgab` section that are not React
 * components. They live apart from `components/HgabBits.tsx` so that file
 * exports components only (Vite's fast refresh needs that), and apart from
 * `lib/hgab.ts` so the data contract stays free of display concerns.
 */
import type { DatasetKey, ReconciliationRow } from './hgab';

/** Tab labels for the four datasets, shared by the sub-nav, the switch and tables. */
export const DATASET_SHORT: Record<DatasetKey, string> = {
  dpwh: 'DPWH',
  fmr: 'Farm-to-Market Roads',
  hfep: 'Health Facilities',
  nia: 'Irrigation',
};

export const RECON_STATUS_LABEL: Record<ReconciliationRow['status'], string> = {
  exact: 'Exact',
  explained: 'Explained',
  mismatch: 'Mismatch',
  info: 'Info',
};

/** Pill class for a reconciliation status, shared by the overview and methodology tables. */
export function reconStatusClass(status: ReconciliationRow['status']): string {
  switch (status) {
    case 'exact': return 'nep-recon-ok';
    case 'mismatch': return 'nep-recon-bad';
    case 'explained': return 'nep-recon-explained';
    default: return 'nep-recon-info';
  }
}

/** 2 → "2nd", 3 → "3rd": for House readings. */
export function ordinal(n: number): string {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}

/** Byte count as a short size: "48 MB", "612 KB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}
