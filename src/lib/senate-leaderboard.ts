/**
 * FY2027 Senate committee report leaderboards (`/senate/2027/leaderboard`): the boards and their data, drawn with the
 * House bill leaderboards' pieces (src/components/HgabLeaderboardBits.tsx) and rules (src/lib/hgab-leaderboard.ts).
 * Jason, 2026-11-21: "Next is work on leaderboards, our reports are a good start": the boards rank what the executive
 * report analyses.
 *
 * - DPWH boards rank the House leaderboard's groups of district engineering offices and the legislative districts they
 *   serve (Lone / Shared, never split), with the same people: amounts belong to offices, not people. Their figures are
 *   each entry's `senate` block (scripts/senate-cr/build_leaderboard.py): the Senate DPWH rows under the label the House
 *   bill lists for the office. Central Office and regional offices are never ranked; each board footnotes them.
 * - Whole-bill boards rank departments, agencies (the General Summary) and budget lines (Annex A, outside DPWH) by the
 *   Senate's change: Senate committee report minus the House bill. No offices, districts or people.
 */
import { dataUrl } from './data-url';
import { cached, getJson } from './hgab';
import {
  formatValue, type BoardDef, type BoardSection, type BoardShare, type LeaderEntry, type LeaderRegion, type LeaderboardData,
  type ShareFormat, type WholeBillRow,
} from './hgab-leaderboard';
import { SENATE_BASE, SENATE_ROOT } from './senate';

export const SENATE_LEADERBOARD_ROOT = `${SENATE_ROOT}/leaderboard`;
export const SENATE_LEADERBOARD_PATH = `${SENATE_BASE}/leaderboard.json`;

/** An office group's (or a region's) Senate figures. */
export interface SenateBlock {
  projects: number;
  house_php: number;
  senate_php: number;
  nep_php: number | null;
  change_php: number;
  removed_php: number;
  removed_rows: number;
  removed_share: number | null;
  inserted_php: number;
  inserted_rows: number;
  inserted_removed_php: number;
  inserted_removed_rows: number;
  inserted_kept_php: number;
  inserted_kept_rows: number;
  raised_php: number;
  raised_rows: number;
  renamed_rows: number;
}
export type SenateLeaderEntry = LeaderEntry & { senate: SenateBlock };
export type SenateLeaderRegion = LeaderRegion & { senate: SenateBlock | null };
export type SenateLeaderboardData = LeaderboardData & {
  entries: SenateLeaderEntry[];
  regions: SenateLeaderRegion[];
  totals: LeaderboardData['totals'] & { senate: { all: SenateBlock; deo: SenateBlock; central: SenateBlock; other: SenateBlock } };
};

export const loadSenateLeaderboard = () =>
  cached('senate:leaderboard', () => getJson<SenateLeaderboardData>(dataUrl(SENATE_LEADERBOARD_PATH), 'Could not load the Senate leaderboards'));

export function senateLeaderboardPath(boardId?: string, opts: { region?: string | null; format?: ShareFormat | null } = {}): string {
  const q = new URLSearchParams();
  if (opts.region) q.set('region', opts.region);
  if (opts.format && opts.format !== 'portrait') q.set('format', opts.format);
  const s = q.toString();
  return `${SENATE_LEADERBOARD_ROOT}${boardId ? `/${boardId}` : ''}${s ? `?${s}` : ''}`;
}

export const SENATE_BOARD_SECTIONS: ReadonlyArray<{ key: BoardSection; label: string; blurb: string }> = [
  { key: 'senate-picture', label: 'The big picture', blurb: 'The Senate’s DPWH changes by region.' },
  { key: 'senate-dpwh', label: '2027: the Senate against the House bill', blurb: 'DPWH projects by DPWH office (DEO), as the House bill lists them, in the Senate committee report.' },
  { key: 'senate-wholebill', label: '2027: the whole bill in the Senate, by department', blurb: 'Departments, agencies and budget lines: the Senate committee report against the House bill. Not tied to any district.' },
];

const S = (e: LeaderEntry) => (e as SenateLeaderEntry).senate;
const SR = (r: LeaderRegion) => (r as SenateLeaderRegion).senate;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const php = (v: number | null | undefined) => formatValue(v ?? null, 'php');

const PEOPLE_NOTE = 'Amounts are for the DPWH office serving each legislative district, as the House bill lists it. The Senate committee report does not say why it removes or raises a project, or who asked for it.';
const SHARED_NOTE = 'A DPWH office that serves several legislative districts is shown with all of them. Its amount is not split.';
const INSERTED_NOTE = '“Inserted by the House” means the House bill project has no matching line in the NEP: a candidate, not a confirmed insertion.';
const SCOPE_NOTE = 'Every House bill DPWH project under the office, as the Senate committee report (Annex A-4) changes it. The House bill boards leave out projects whose office changed between the NEP and the House bill, so a few offices’ House bill totals differ slightly.';
const WHOLE_NOTE = 'The Senate committee report’s General Summary against the House bill, department by department, every line added up.';
const LINE_NOTE = 'A budget line is one amount Annex A prints: a program, activity or project and its expense class. DPWH projects have their own boards and are left out; Annex A prints some amounts at more than one level.';
const PCT_FLOOR_NOTE = 'Only departments and funds with ₱1 billion or more in the House bill, so small budgets do not dominate.';

/** "Not in any district": what the Central Office and regional offices carry, for a DPWH board's footnote. */
function outside(d: LeaderboardData, what: (b: SenateBlock) => number, text: (v: string) => string): string | null {
  const t = (d as SenateLeaderboardData).totals.senate;
  if (!t) return null;
  const v = what(t.central) + what(t.other);
  return v ? text(formatValue(v, 'php')) : null;
}
const removedOutside = (d: LeaderboardData) =>
  outside(d, (b) => b.removed_php, (v) => `Not in any district: ${v} removed from projects under the DPWH Central Office and regional offices.`);
const houseOutside = (d: LeaderboardData) =>
  outside(d, (b) => b.house_php, (v) => `Not in any district: ${v} of House bill DPWH projects under the Central Office and regional offices.`);

const houseToSenate = (r: WholeBillRow) => `${php(r.hgab3_php)} → ${php(r.senate_php)}`;

/**
 * Titles in plain words (Jason, 2026-11-25: titles like "Largest share of the House bill budget the Senate removes" are
 * "too complex for some filipinos"): about seven everyday words, past tense, "Senate" in each, "%" not "share",
 * "biggest amount" not "most budget"; "removed" for DPWH projects taken out (the Removed status), "cut" for budgets
 * that shrink. The subtitle under each keeps the exact definition.
 */
const BOARDS_BASE: readonly BoardDef[] = [
  // The big picture
  {
    id: 'regions-removed', section: 'senate-picture', kind: 'regions', value: 'php', order: 'desc',
    kicker: '2027 Senate · DPWH projects · by region',
    title: 'Budget the Senate removed, per region',
    subtitle: 'DPWH projects the Senate committee report removes, by the region of their district office.',
    regionMetric: (r) => SR(r)?.removed_php ?? null,
    notes: [SCOPE_NOTE], regionFilter: false, residual: removedOutside,
  },
  {
    id: 'regions-removed-share', section: 'senate-picture', kind: 'regions', value: 'share', order: 'desc',
    kicker: '2027 Senate · DPWH projects · by region',
    title: '% of budget the Senate removed, per region',
    subtitle: 'The part of each region’s House bill DPWH budget (district offices) the Senate committee report removes.',
    regionMetric: (r) => (SR(r)?.removed_share == null ? null : SR(r)!.removed_share! / 100),
    notes: [SCOPE_NOTE], regionFilter: false, residual: removedOutside,
  },

  // 2027: the Senate against the House bill
  {
    id: 'removed', section: 'senate-dpwh', kind: 'ranking', value: 'php', order: 'desc',
    kicker: '2027 Senate · DPWH projects removed',
    title: 'Biggest amount removed by the Senate',
    subtitle: 'House bill DPWH projects the Senate committee report removes (no budget), by DPWH office.',
    metric: (e) => S(e).removed_php, keep: (e) => S(e).removed_rows > 0,
    detail: (e) => `in ${plural(S(e).removed_rows, 'project', 'projects')}`,
    notes: [PEOPLE_NOTE, SHARED_NOTE, SCOPE_NOTE], regionFilter: true, residual: removedOutside,
  },
  {
    id: 'removed-share', section: 'senate-dpwh', kind: 'ranking', value: 'share', order: 'desc',
    kicker: '2027 Senate · DPWH projects removed',
    title: 'Biggest % of budget removed by the Senate',
    subtitle: 'The part of each office’s House bill DPWH budget the Senate committee report removes.',
    // `share` values are fractions (formatValue prints them as percent); the data's removed_share is a percent.
    metric: (e) => (S(e).removed_share == null ? null : S(e).removed_share! / 100), keep: (e) => S(e).house_php >= 1_000_000_000 && S(e).removed_rows > 0,
    detail: (e) => `${php(S(e).removed_php)} of ${php(S(e).house_php)}`,
    notes: ['Only offices with at least ₱1 billion in the House bill.', PEOPLE_NOTE, SHARED_NOTE], regionFilter: true, residual: removedOutside,
  },
  {
    id: 'removed-count', section: 'senate-dpwh', kind: 'ranking', value: 'count', order: 'desc',
    kicker: '2027 Senate · DPWH projects removed',
    title: 'Most projects removed by the Senate',
    subtitle: 'House bill DPWH projects the Senate committee report removes, counted by DPWH office.',
    metric: (e) => S(e).removed_rows, keep: (e) => S(e).removed_rows > 0,
    detail: (e) => `${php(S(e).removed_php)} of ${php(S(e).house_php)}`,
    notes: [PEOPLE_NOTE, SHARED_NOTE], regionFilter: true, residual: removedOutside,
  },
  {
    id: 'insertions-removed', section: 'senate-dpwh', kind: 'ranking', value: 'php', order: 'desc',
    kicker: '2027 Senate · House insertions removed',
    title: 'Biggest amount removed from House-added projects',
    subtitle: 'House bill projects with no matching NEP line that the Senate committee report removes, by DPWH office.',
    metric: (e) => S(e).inserted_removed_php, keep: (e) => S(e).inserted_removed_rows > 0,
    detail: (e) => `${plural(S(e).inserted_removed_rows, 'project', 'projects')} of ${S(e).inserted_rows.toLocaleString('en-US')} inserted`,
    notes: [INSERTED_NOTE, PEOPLE_NOTE, SHARED_NOTE], regionFilter: true,
    residual: (d) => outside(d, (b) => b.inserted_removed_php, (v) => `Not in any district: ${v} in House insertions removed under the Central Office and regional offices.`),
  },
  {
    id: 'insertions-kept', section: 'senate-dpwh', kind: 'ranking', value: 'php', order: 'desc',
    kicker: '2027 Senate · House insertions kept',
    title: 'Biggest amount kept for House-added projects',
    subtitle: 'House bill projects with no matching NEP line that stay in the Senate committee report, by DPWH office.',
    metric: (e) => S(e).inserted_kept_php, keep: (e) => S(e).inserted_kept_rows > 0,
    detail: (e) => `in ${plural(S(e).inserted_kept_rows, 'project', 'projects')}`,
    notes: [INSERTED_NOTE, PEOPLE_NOTE, SHARED_NOTE], regionFilter: true,
    residual: (d) => outside(d, (b) => b.inserted_kept_php, (v) => `Not in any district: ${v} in House insertions kept under the Central Office and regional offices.`),
  },
  {
    id: 'senate-largest', section: 'senate-dpwh', kind: 'ranking', value: 'php', order: 'desc',
    kicker: '2027 Senate · DPWH projects',
    title: 'Biggest DPWH budgets after the Senate',
    subtitle: 'DPWH offices ranked by their project total in the Senate committee report.',
    metric: (e) => S(e).senate_php, keep: (e) => S(e).senate_php > 0,
    detail: (e) => `House bill ${php(S(e).house_php)}`,
    notes: [PEOPLE_NOTE, SHARED_NOTE, SCOPE_NOTE], regionFilter: true, residual: houseOutside,
  },
  {
    id: 'over-nep', section: 'senate-dpwh', kind: 'ranking', value: 'signed_php', order: 'desc',
    kicker: '2027 Senate · DPWH projects · Senate minus NEP',
    title: 'Biggest increases over the President’s budget',
    subtitle: 'The Senate committee report’s DPWH total for each office minus the NEP’s.',
    metric: (e) => (S(e).nep_php != null ? S(e).senate_php - (S(e).nep_php ?? 0) : null), keep: (e) => S(e).nep_php != null && S(e).senate_php - (S(e).nep_php ?? 0) > 0,
    detail: (e) => `NEP ${php(S(e).nep_php)} → ${php(S(e).senate_php)}`,
    notes: ['The NEP figure is every NEP project under the office, including those the House bill dropped.', PEOPLE_NOTE, SHARED_NOTE], regionFilter: true,
  },

  // 2027: the whole bill in the Senate
  {
    id: 'departments-increase', section: 'senate-wholebill', kind: 'lines', value: 'signed_php', order: 'desc',
    kicker: '2027 Senate · whole bill · by department',
    title: 'Departments the Senate increased the most',
    subtitle: 'Senate committee report minus the House bill for each department and fund (General Summary).',
    rowSet: 'departments', rowMetric: (r) => r.delta_php, rowKeep: (r) => r.delta_php > 0, rowDetail: houseToSenate,
    notes: [WHOLE_NOTE], regionFilter: false,
  },
  {
    id: 'departments-cuts', section: 'senate-wholebill', kind: 'lines', value: 'signed_php', order: 'asc',
    kicker: '2027 Senate · whole bill · by department',
    title: 'Departments the Senate cut the most',
    subtitle: 'Departments and funds whose total is lower in the Senate committee report than in the House bill.',
    rowSet: 'departments', rowMetric: (r) => r.delta_php, rowKeep: (r) => r.delta_php < 0, rowDetail: houseToSenate,
    notes: [WHOLE_NOTE], regionFilter: false,
  },
  {
    id: 'departments-increase-pct', section: 'senate-wholebill', kind: 'lines', value: 'pct', order: 'desc',
    kicker: '2027 Senate · whole bill · by department',
    title: 'Departments the Senate increased the most, in %',
    subtitle: 'The Senate’s change as a share of each department’s House bill total.',
    rowSet: 'departments', rowMetric: (r) => r.delta_pct, rowKeep: (r) => r.hgab3_php >= 1_000_000_000 && r.delta_php > 0, rowDetail: houseToSenate,
    notes: [PCT_FLOOR_NOTE, WHOLE_NOTE], regionFilter: false,
  },
  {
    id: 'departments-cuts-pct', section: 'senate-wholebill', kind: 'lines', value: 'pct', order: 'asc',
    kicker: '2027 Senate · whole bill · by department',
    title: 'Departments the Senate cut the most, in %',
    subtitle: 'The Senate’s cut as a share of each department’s House bill total.',
    rowSet: 'departments', rowMetric: (r) => r.delta_pct, rowKeep: (r) => r.hgab3_php >= 1_000_000_000 && r.delta_php < 0, rowDetail: houseToSenate,
    notes: [PCT_FLOOR_NOTE, WHOLE_NOTE], regionFilter: false,
  },
  {
    id: 'agencies-increase', section: 'senate-wholebill', kind: 'lines', value: 'signed_php', order: 'desc',
    kicker: '2027 Senate · whole bill · by agency',
    title: 'Agencies the Senate increased the most',
    subtitle: 'Senate committee report minus the House bill for each agency (General Summary).',
    rowSet: 'agencies', rowMetric: (r) => r.delta_php, rowKeep: (r) => r.delta_php > 0, rowDetail: houseToSenate,
    notes: [WHOLE_NOTE], regionFilter: false,
  },
  {
    id: 'agencies-cuts', section: 'senate-wholebill', kind: 'lines', value: 'signed_php', order: 'asc',
    kicker: '2027 Senate · whole bill · by agency',
    title: 'Agencies the Senate cut the most',
    subtitle: 'Agencies whose total is lower in the Senate committee report than in the House bill.',
    rowSet: 'agencies', rowMetric: (r) => r.delta_php, rowKeep: (r) => r.delta_php < 0, rowDetail: houseToSenate,
    notes: [WHOLE_NOTE], regionFilter: false,
  },
  {
    id: 'lines-increase', section: 'senate-wholebill', kind: 'lines', value: 'signed_php', order: 'desc',
    kicker: '2027 Senate · whole bill · budget lines',
    title: 'Budget items the Senate increased the most',
    subtitle: 'The largest increases Annex A prints for a line already in the House bill.',
    rowSet: 'lines', rowMetric: (r) => r.delta_php, rowKeep: (r) => r.delta_php > 0 && r.status !== 'senate_new', rowDetail: houseToSenate,
    notes: [LINE_NOTE], regionFilter: false,
  },
  {
    id: 'lines-cuts', section: 'senate-wholebill', kind: 'lines', value: 'signed_php', order: 'asc',
    kicker: '2027 Senate · whole bill · budget lines',
    title: 'Budget items the Senate cut the most',
    subtitle: 'The largest cuts Annex A prints, outside DPWH projects.',
    rowSet: 'lines', rowMetric: (r) => r.delta_php, rowKeep: (r) => r.delta_php < 0, rowDetail: houseToSenate,
    notes: [LINE_NOTE], regionFilter: false,
  },
  {
    id: 'lines-new', section: 'senate-wholebill', kind: 'lines', value: 'php', order: 'desc',
    kicker: '2027 Senate · whole bill · budget lines',
    title: 'Biggest new items the Senate added',
    subtitle: 'Annex A lines with no House bill amount: what the Senate adds, outside DPWH projects.',
    rowSet: 'lines', rowMetric: (r) => r.senate_php ?? null, rowKeep: (r) => r.status === 'senate_new' && (r.senate_php ?? 0) > 0,
    rowDetail: (r) => `Senate ${php(r.senate_php)}`,
    notes: [LINE_NOTE], regionFilter: false,
  },
];

/**
 * What each board's share image prints (hgab-share-render.ts, BoardShare): the Senate committee report as the source,
 * the Senate board's address, a short people note and disclaimer for the office boards, and Senate file names.
 */
const SHARE_SOURCE_DPWH = 'Source: Senate committee report on HB 10858 (Annex A-4) and House Bill 10858, DPWH project lists';
const SHARE_SOURCE_WHOLE = 'Source: Senate committee report on HB 10858 (General Summary, Annex A) and House Bill 10858';
const SHARE_NOTE = 'Amounts are for the DPWH office serving each district, as the House bill lists it. The Senate report does not say why it removes a project.';
const SHARE_DISCLAIMER = 'Figures belong to DPWH offices, not to representatives. A Senate change is a document comparison, not evidence of wrongdoing.';

function shareOf(b: BoardDef): BoardShare {
  return {
    source: b.kind === 'lines' ? SHARE_SOURCE_WHOLE : SHARE_SOURCE_DPWH,
    path: (region) => senateLeaderboardPath(b.id, { region: b.regionFilter ? region : null }),
    note: SHARE_NOTE,
    disclaimer: SHARE_DISCLAIMER,
    filePrefix: 'bettergov-senate-cr-2027',
  };
}

export const SENATE_BOARDS: readonly BoardDef[] = BOARDS_BASE.map((b) => ({ ...b, share: shareOf(b) }));

export function senateBoardById(id: string | undefined): BoardDef | undefined {
  return id ? SENATE_BOARDS.find((b) => b.id === id) : undefined;
}
