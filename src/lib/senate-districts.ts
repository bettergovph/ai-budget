/**
 * The Senate committee report's district pages (`/senate/2027/districts`, `/senate/2027/districts/:id`). Jason
 * (2026-11-23): "Next is do the district, similar to HGAB's district pages."
 *
 * The pages read the House bill's district index (`hgab/2027/districts.json`: districts, offices, tiers,
 * representatives) beside the Senate layer `senate/2027/districts.json` (scripts/senate-cr/build_districts.py, the last
 * step of `npm run build:senate-cr`): each DPWH office's House bill and Senate amounts, the report's status for its
 * projects, the House insertions it cuts and keeps, its largest cuts, the money on no district card, each region, and the
 * projects placed in each legislative district. Office figures follow the House pages' rules (DEO lens; an office that
 * serves several districts is shown whole, never split; office-change and no-office lines held out). Pure.
 */
import { createContext, useContext } from 'react';
import { dataUrl } from './data-url';
import { cached, getJson, loadHgabDistricts, type HgabDistrictIndex } from './hgab';
import { SENATE_BASE, SENATE_ROOT } from './senate';

export const SENATE_DISTRICTS_ROOT = `${SENATE_ROOT}/districts`;
export const SENATE_DISTRICTS_PATH = `${SENATE_BASE}/districts.json`;
export const senateDistrictPath = (id: string) => `${SENATE_DISTRICTS_ROOT}/${encodeURIComponent(id)}`;

/** The views of the districts index, as the House bill's: overview, every district's offices, projects placed. */
export const SENATE_DISTRICT_VIEWS = [
  { key: 'overview', label: 'Overview' },
  { key: 'list', label: 'District Engineering Offices' },
  { key: 'list-legislative', label: 'Legislative Districts' },
] as const;
export type SenateDistrictView = (typeof SENATE_DISTRICT_VIEWS)[number]['key'];
export const senateDistrictsHref = (view: SenateDistrictView = 'overview') => (view === 'overview' ? SENATE_DISTRICTS_ROOT : `${SENATE_DISTRICTS_ROOT}?view=${view}`);

export const SENATE_OFFICE_STATUSES = ['unchanged', 'renamed', 'cut', 'reduced', 'raised'] as const;
export type SenateOfficeStatus = (typeof SENATE_OFFICE_STATUSES)[number];
export const SENATE_STATUS_WORDS: Record<SenateOfficeStatus, { label: string; plain: string }> = {
  unchanged: { label: 'Kept as is', plain: 'not listed in the report, so unchanged' },
  renamed: { label: 'Kept, renamed', plain: 'same amount; the report adds stations, coordinates or a corrected name' },
  raised: { label: 'Raised', plain: 'the report gives it more' },
  reduced: { label: 'Reduced', plain: 'the report gives it less' },
  cut: { label: 'Cut to ₱0', plain: 'the report removes it' },
};

export interface SenateTally { rows: number; house_php: number; senate_php: number }
export interface SenateOffice extends SenateTally {
  status: Record<SenateOfficeStatus, SenateTally>;
  /** The House insertions (no matching NEP line): cut (at House bill amounts) and kept (at the report's). */
  inserted: { rows: number; house_php: number; cut_rows: number; cut_php: number; kept_rows: number; kept_php: number };
  /** Its largest projects the report cuts: [House bill row id, title, House bill amount]. */
  top_cut: Array<[string, string, number]>;
}
export interface SenatePlaced { rows: number; house_php: number; senate_php: number; cut_rows: number; cut_php: number }

export interface SenateDistrictsFile {
  schema: 1;
  built_at: string;
  source_commit: string | null;
  /** The House district index this was built against. */
  house_districts_built_at: string;
  statuses: SenateOfficeStatus[];
  /** By the House index's office id. */
  offices: Record<string, SenateOffice>;
  /** Every office together: the money on district cards. */
  deo: SenateTally;
  /** The money on no district card, as the House index splits it. */
  residual: Record<'central_office' | 'regional_offices' | 'unmatched' | 'office_change' | 'no_office', SenateTally>;
  unmatched_labels: string[];
  /** The DPWH program: offices plus the money on no card. */
  total: SenateTally;
  regions: Record<string, { offices: number; districts: number; rows: number; house_php: number; senate_php: number; cut_rows: number; cut_php: number }>;
  /** Projects placed in each legislative district (locations.json). */
  placed: Record<string, SenatePlaced>;
  checks: string[];
}

export interface SenateDistrictsData { house: HgabDistrictIndex; senate: SenateDistrictsFile }

export function loadSenateDistricts(): Promise<SenateDistrictsData> {
  return cached('senate-districts', async () => {
    const [house, senate] = await Promise.all([
      loadHgabDistricts(),
      getJson<SenateDistrictsFile>(dataUrl(SENATE_DISTRICTS_PATH), 'Failed to load the Senate committee report by district'),
    ]);
    return { house, senate };
  });
}

/** A district's offices with their Senate figures (an office may serve several districts; it is never split). */
export function districtOffices(d: SenateDistrictsData, officeIds: readonly string[]) {
  return officeIds.map((id) => ({ id, house: d.house.offices[id], senate: d.senate.offices[id] })).filter((x) => x.house && x.senate);
}

/** Several offices' Senate figures added up (a district with more than one office). */
export function sumOffices(offices: ReadonlyArray<{ senate: SenateOffice }>): SenateTally & { cut_rows: number; cut_php: number } {
  return offices.reduce((a, o) => ({
    rows: a.rows + o.senate.rows, house_php: a.house_php + o.senate.house_php, senate_php: a.senate_php + o.senate.senate_php,
    cut_rows: a.cut_rows + o.senate.status.cut.rows, cut_php: a.cut_php + o.senate.status.cut.house_php,
  }), { rows: 0, house_php: 0, senate_php: 0, cut_rows: 0, cut_php: 0 });
}

/** The offices' House bill and Senate figures added up, by House index office id; null when none has a Senate figure. */
export function sumOfficeIds(d: SenateDistrictsFile, ids: readonly string[]): SenateTally | null {
  const offices = [...new Set(ids)].map((id) => d.offices[id]).filter(Boolean);
  if (!offices.length) return null;
  return offices.reduce<SenateTally>((a, o) => ({ rows: a.rows + o.rows, house_php: a.house_php + o.house_php, senate_php: a.senate_php + o.senate_php }),
    { rows: 0, house_php: 0, senate_php: 0 });
}

/** The Senate layer for the House district cards drawn on the Senate pages (src/components/SenateDistrictBits.tsx). */
export const SenateDistrictsContext = createContext<SenateDistrictsFile | null>(null);
export function useSenateDistricts(): SenateDistrictsFile | null {
  return useContext(SenateDistrictsContext);
}
