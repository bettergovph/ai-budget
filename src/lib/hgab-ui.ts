/**
 * Small presentational helpers for the `/hgab` section that are not React
 * components. They live apart from `components/HgabBits.tsx` so that file
 * exports components only (Vite's fast refresh needs that), and apart from
 * `lib/hgab.ts` so the data contract stays free of display concerns.
 *
 * The plain-language helpers at the bottom are the one place the pages read
 * the READER-FACING fields of `HgabDatasetMeta` (`summary`, `caveats`). Until
 * the data carries them the summary falls back to `grain`, so a page never
 * prints "undefined"; the TECHNICAL fields (`grain`, `scope`) are only ever
 * shown inside a "Details for analysts" block (labelled "Each row") or on
 * Methodology. `one_row` stays in the data but no page shows it.
 */
import type { DatasetKey, HgabDatasetMeta, ReconciliationRow } from './hgab';

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

// ---------------------------------------------------------------------------
// Plain language
// ---------------------------------------------------------------------------

/** The one rule every page repeats, in the words the section uses everywhere. */
export const COMPARE_NOT_ADD = 'two versions of one budget — compare them, don’t add them';

/** Fixed plain phrases, so the same idea reads the same on every page. */
export const PLAIN = {
  nep: 'the NEP',
  nepShort: 'the NEP',
  house: 'the House bill (HB 10858)',
  houseShort: 'the House bill',
  unconfirmed: 'unconfirmed matches',
  /** Under the first bridge strip on a page. */
  bridgeMeans:
    'Every project line lands in exactly one of these groups. “Candidates” are leads for checking, not confirmed changes. The six amounts add up to the difference between the two versions.',
  candidateMeans: 'A candidate is a match or a gap found by comparing names, places and amounts. It is a lead for checking, not a confirmed change.',
} as const;

type Plainable = Pick<HgabDatasetMeta, 'grain'> & Partial<Pick<HgabDatasetMeta, 'summary' | 'caveats'>>;

/** READER-FACING one-sentence summary; falls back to the technical grain until the data carries one. */
export function datasetSummary(d: Plainable): string {
  const s = typeof d.summary === 'string' ? d.summary.trim() : '';
  return s || d.grain;
}

/** READER-FACING caveats, always an array (empty until the data carries them). */
export function datasetCaveats(d: Plainable): string[] {
  return Array.isArray(d.caveats) ? d.caveats.filter((c): c is string => typeof c === 'string' && c.trim() !== '') : [];
}

/** The first sentence or clause of a longer text, without its trailing stop. */
export function firstClause(text: string): string {
  return text.split(/(?<=\.)\s+|;\s+/)[0].replace(/[.;,]$/, '');
}

/**
 * `controls_label` as the data prints it ("PAP controls", "Regions",
 * "Sub-programs", "Categories") in the words a reader uses. The data may
 * already be plain, in which case this is the identity.
 */
export function plainControlsLabel(label: string): string {
  return label
    .replace(/\bPAP controls\b/i, 'program lines')
    .replace(/\bPAPs?\b/g, 'program lines')
    .replace(/\bcontrols\b/i, 'totals');
}

/** Capitalise the first letter: for a plain label at the start of a heading. */
export function sentenceCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * The views of a program hub (`/hgab/2027/:dataset?view=`). The section
 * sub-nav lists them in each program's dropdown and the hub reads the same
 * list to validate `?view=`, so the two can never disagree. Only DPWH prints
 * two House readings that differ, so only it has the readings view.
 */
export const HUB_VIEWS = [
  { key: 'overview', label: 'Overview' },
  { key: 'projects', label: 'Projects' },
  { key: 'changes', label: 'Changes' },
  { key: 'map', label: 'Map' },
  { key: 'readings', label: '2nd vs 3rd reading' },
  { key: 'documents', label: 'Documents' },
] as const;

export type HubView = (typeof HUB_VIEWS)[number]['key'];

export function hubViews(hasReadings: boolean): ReadonlyArray<(typeof HUB_VIEWS)[number]> {
  return HUB_VIEWS.filter((v) => v.key !== 'readings' || hasReadings);
}

/** The program hubs in sub-nav order, with whether each has the readings view. */
export const PROGRAM_NAV: ReadonlyArray<{ key: DatasetKey; label: string; hasReadings: boolean }> = [
  { key: 'dpwh', label: 'DPWH', hasReadings: true },
  { key: 'fmr', label: 'Farm-to-Market Roads', hasReadings: false },
  { key: 'hfep', label: 'Health Facilities', hasReadings: false },
  { key: 'nia', label: 'Irrigation', hasReadings: false },
];

/**
 * The Districts section has two views: an overview (the summary figures and
 * the money no district card shows) and the list of districts. The list is
 * `?view=list`; links that still carry list filters (q, region, tier, sort,
 * group) without a view open the list too, so older shared URLs keep working.
 */
export const DISTRICT_VIEWS = [
  { key: 'overview', label: 'Overview', to: '/hgab/2027/districts' },
  { key: 'list', label: 'Districts', to: '/hgab/2027/districts?view=list' },
] as const;

export type DistrictView = (typeof DISTRICT_VIEWS)[number]['key'];

export function districtsView(params: URLSearchParams): DistrictView {
  const v = params.get('view');
  if (v === 'list' || v === 'overview') return v;
  return ['q', 'region', 'tier', 'sort', 'group'].some((k) => params.has(k)) ? 'list' : 'overview';
}
