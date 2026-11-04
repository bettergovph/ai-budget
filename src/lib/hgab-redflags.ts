/**
 * ₱1 trillion in red flags (`/hgab/2027/1T-redflags`): the People's Budget Coalition's red-flag basket through the
 * FY 2027 House bill. Jason (2026-11-04): "Let's create a new poster for our 1Trillion red flags. See the table at the
 * bottom most of the page [research.bettergov.ph/static/nep-preview/flags.html]. We can create a separate page in
 * /hgab/2027/1T-redflags."
 *
 * The basket is PBC's, not ours: a fixed set of budget lines PBC follows through every stage of the budget, in three
 * groups, plus unprogrammed appropriations. Every figure here is PBC's, from the table "PBC's red-flag basket through
 * the House bill (PHP billions)" in "The FY 2027 House General Appropriations Bill: An Assessment" (October 2026), the
 * same figures the research page's table carries. They are rounded to ₱0.1 billion and stored as integer pesos. A
 * change is PBC's own, worked out before rounding, so it can differ by ₱0.1 billion from House bill minus NEP; and a
 * group's lines can miss its subtotal by as much.
 *
 * Each line says how it stands against our own reading of the House bill (`bill`): one line of the bill, with its
 * exact amounts from the line-by-line explorer (data/hgab/2027/explorer/d/); a change that matches though PBC's level
 * is its own; part of DPWH's projects, which add up only as the six DPWH lines; or PBC's own figure. verify:hgab checks
 * that the explorer still lists those exact amounts, that PBC's figures are them rounded, and that the subtotals,
 * totals and the DPWH lines add up.
 *
 * Pure (no `import.meta.env`, no DOM): the page, the poster script (build-hgab-poster-redflags.ts), verify:hgab and the
 * Worker's SEO code import it.
 */

export const RED_FLAGS_ROOT = '/hgab/2027/1T-redflags';
export const RED_FLAGS_TITLE = '₱1 trillion in red flags';

/** Where the figures come from. `anchor` opens the table itself. */
export const PBC_REPORT = {
  by: 'People’s Budget Coalition',
  short: 'PBC',
  title: 'The FY 2027 House General Appropriations Bill: An Assessment',
  date: 'October 2026',
  url: 'https://ajamontesa.github.io/ph-budget-analysis/hgab-2027-assessment.html',
  anchor: '#house-redflags',
  table: 'PBC’s red-flag basket through the House bill (PHP billions)',
} as const;

const HGAB = '/hgab/2027';
const EXPLORER = `${HGAB}/explorer`;

/** Pesos from PBC's billions, which it rounds to one decimal. */
const b = (billions: number) => Math.round(billions * 10) * 100_000_000;
/** How far a PBC figure may sit from the exact amount it rounds: half of ₱0.1 billion. */
export const PBC_ROUNDING = 50_000_000;

export type RedFlagGroupKey = 'patronage' | 'political' | 'infrastructure';

export interface RedFlagGroup {
  key: RedFlagGroupKey;
  /** PBC's name for the group. */
  name: string;
  /** For the poster's tabs and the chart key. */
  short: string;
  /** What PBC counts in it, in plain words (from its own description of the basket). */
  plain: string;
  /** PBC's subtotals. `gaa2026`: what the 2026 enacted budget (GAA) gave the same lines. */
  nep: number;
  house: number;
  change: number;
  gaa2026: number;
}

/** Where a line's figures stand against our reading of the House bill. */
export type BillCheck =
  /** One line of the bill (or a whole department or agency): PBC's figures are these amounts, rounded. */
  | { kind: 'line'; ref: BillRef }
  /** The change matches one line of the bill, but PBC's level is its own: a part of the line, or more lines than the bill names. */
  | { kind: 'change'; ref: BillRef; why: string }
  /** A DPWH program: PBC splits DPWH's projects by program; the six DPWH lines add up to every DPWH project in the bill. */
  | { kind: 'dpwh' }
  /** PBC's own figure, not a line of the bill. */
  | { kind: 'pbc'; why: string };

export interface BillRef {
  /** The explorer department: data/hgab/2027/explorer/d/<dept>.json and its page. */
  dept: string;
  /** The whole department; one agency (its name matches); or every top-most line whose name matches. */
  scope: 'department' | { agency: string } | { label: string };
  /** What to type in the explorer's search box to see the line(s), when it is not the whole page. */
  q?: string;
  /** The exact amounts our explorer lists, in pesos. */
  nep: number;
  house: number;
}

export interface RedFlagLine {
  key: string;
  group: RedFlagGroupKey;
  /** PBC's name for the line, as its table publishes it (its footnote marks dropped; the footnotes are in `note`). */
  name: string;
  /** A short name for the poster. */
  short: string;
  nep: number;
  house: number;
  change: number;
  bill: BillCheck;
  /** PBC's footnote for the line, in plain words. */
  note?: string;
}

export const RED_FLAG_GROUPS: readonly RedFlagGroup[] = [
  {
    key: 'patronage',
    name: 'Programs at high risk of political patronage',
    short: 'Patronage risk',
    plain: 'Aid whose recipients are identified through politicians, confidential and intelligence funds, and assistance to local governments.',
    nep: b(140.1), house: b(209.6), change: b(69.5), gaa2026: b(219.4),
  },
  {
    key: 'political',
    name: 'Political offices',
    short: 'Political offices',
    plain: 'The budgets of the Office of the President, the Office of the Vice President and Congress.',
    nep: b(37.9), house: b(42.9), change: b(5.0), gaa2026: b(67.5),
  },
  {
    key: 'infrastructure',
    name: 'Infrastructure requiring project-level disclosure',
    short: 'Infrastructure',
    plain: 'Public works whose projects are chosen district by district, or where insertions have gathered: DPWH, farm-to-market roads, irrigation, health facilities and school buildings.',
    nep: b(686.0), house: b(695.2), change: b(9.2), gaa2026: b(692.1),
  },
];

/** Unprogrammed appropriations: standby authority, released only if extra revenue or new loans come in. */
export const RED_FLAG_UNPROGRAMMED = {
  name: 'Unprogrammed appropriations',
  short: 'Unprogrammed',
  plain: 'Standby budget, released only if extra revenue or new loans come in. The House bill keeps the NEP’s amount.',
  nep: b(112.0), house: b(112.0), change: 0, gaa2026: b(150.9),
  /** The exact amount, the same in the NEP and the House bill (the explorer's index.json `unprogrammed`). */
  exact: 111_984_494_000,
} as const;

/** PBC's totals: the three groups, then with unprogrammed appropriations. */
export const RED_FLAG_TOTALS = {
  programmed: { nep: b(864.0), house: b(947.7), change: b(83.7), gaa2026: b(979.0) },
  all: { nep: b(976.0), house: b(1059.7), change: b(83.7), gaa2026: b(1129.9) },
} as const;

/** The trillion the title rounds to: the House bill's basket is past it, the NEP's is not. */
export const TRILLION = 1_000_000_000_000;

/**
 * Every DPWH project line in the House bill and the NEP, our DPWH pages' totals (dpwh/summary.json `totals`): DPWH
 * without its administration and support. PBC's six DPWH lines add up to these, rounded.
 */
export const DPWH_PROJECTS = { nep: 572_924_074_000, house: 587_075_661_000 } as const;

const TUPAD_WHY =
  'TUPAD is part of DOLE’s “Livelihood and Emergency Employment” line. PBC applies that line’s change to its own NEP figure for TUPAD.';
const DPWH_NOTE = 'PBC splits DPWH’s projects into programs by their budget codes, which the House bill does not publish.';

export const RED_FLAG_LINES: readonly RedFlagLine[] = [
  // Programs at high risk of political patronage
  {
    key: 'aics', group: 'patronage', name: 'DSWD Protective Services (AICS)', short: 'AICS (DSWD)',
    nep: b(33.3), house: b(58.1), change: b(24.8),
    bill: { kind: 'line', ref: { dept: 'department-of-social-welfare-and-development', scope: { label: '^Protective Services for Individuals and Families in Difficult Circumstances$' }, q: 'Protective Services for Individuals', nep: 33_284_583_000, house: 58_090_583_000 } },
  },
  {
    key: 'tupad', group: 'patronage', name: 'DOLE TUPAD', short: 'TUPAD (DOLE)',
    nep: b(14.2), house: b(19.0), change: b(4.7),
    bill: { kind: 'change', ref: { dept: 'department-of-labor-and-employment', scope: { label: '^Livelihood and Emergency Employment$' }, q: 'Livelihood and Emergency Employment', nep: 16_701_891_000, house: 21_451_461_000 }, why: TUPAD_WHY },
    note: TUPAD_WHY,
  },
  {
    key: 'map', group: 'patronage', name: 'DOH Medical Assistance Program (MAP, formerly MAIFIP)', short: 'MAP, formerly MAIFIP (DOH)',
    nep: b(24.2), house: b(48.2), change: b(24.0),
    bill: { kind: 'line', ref: { dept: 'department-of-health', scope: { label: '^Medical Assistance Program \\(MAP\\)$' }, q: 'Medical Assistance Program', nep: 24_238_078_000, house: 48_203_854_000 } },
  },
  {
    key: 'tulong-dunong', group: 'patronage', name: 'CHED Tulong Dunong', short: 'Tulong Dunong (CHED)',
    nep: 0, house: b(1.8), change: b(1.8),
    bill: { kind: 'line', ref: { dept: 'other-executive-offices', scope: { label: '^Tulong Dunong Program$' }, q: 'Tulong Dunong', nep: 0, house: 1_766_390_000 } },
  },
  {
    key: 'paff', group: 'patronage', name: 'DA Presidential Assistance to Farmers and Fisherfolk', short: 'Assistance to Farmers (DA)',
    nep: 0, house: b(10.0), change: b(10.0),
    bill: { kind: 'line', ref: { dept: 'department-of-agriculture', scope: { label: '^Presidential Assistance for Farmers and Fisherfolk Program$' }, q: 'Presidential Assistance for Farmers', nep: 0, house: 10_000_000_000 } },
  },
  {
    key: 'cif', group: 'patronage', name: 'Confidential and intelligence funds · all agencies', short: 'Confidential funds (CIF)',
    nep: b(10.8), house: b(10.9), change: b(0.1),
    bill: { kind: 'pbc', why: 'PBC’s own tally of confidential and intelligence funds across agencies; the House change (₱140 million) is from the budget amendments subcommittee’s livestream.' },
    note: 'PBC’s own tally across agencies. The House change is from the budget amendments subcommittee’s livestream. The Office of the President’s share is also in its own budget, so the total counts it twice (historically about ₱4.5 billion).',
  },
  {
    key: 'fa-lgus', group: 'patronage', name: 'Financial Assistance to LGUs', short: 'Financial Assistance to LGUs',
    nep: b(37.5), house: b(41.6), change: b(4.1),
    bill: { kind: 'line', ref: { dept: 'allocations-to-local-government-units', scope: { label: '^Financial Assistance to Local Government Units$' }, q: 'Financial Assistance to Local Government Units', nep: 37_492_578_000, house: 41_583_978_000 } },
  },
  {
    key: 'ntf-elcac', group: 'patronage', name: 'NTF-ELCAC support to barangays', short: 'NTF-ELCAC barangays',
    nep: b(9.7), house: b(9.7), change: 0,
    bill: { kind: 'line', ref: { dept: 'allocations-to-local-government-units', scope: { label: '^Support to the Barangay Development Program' }, q: 'Barangay Development Program', nep: 9_740_000_000, house: 9_740_000_000 } },
  },
  {
    key: 'gef', group: 'patronage', name: 'Growth Equity Fund', short: 'Growth Equity Fund',
    nep: b(10.3), house: b(10.3), change: 0,
    bill: { kind: 'line', ref: { dept: 'allocations-to-local-government-units', scope: { label: '^Growth Equity Fund$' }, q: 'Growth Equity Fund', nep: 10_300_000_000, house: 10_300_000_000 } },
  },
  // Political offices
  {
    key: 'op', group: 'political', name: 'Office of the President', short: 'Office of the President',
    nep: b(10.1), house: b(10.1), change: 0,
    bill: { kind: 'line', ref: { dept: 'office-of-the-president', scope: 'department', nep: 10_083_518_000, house: 10_083_518_000 } },
  },
  {
    key: 'ovp', group: 'political', name: 'Office of the Vice President', short: 'Office of the Vice President',
    nep: b(0.8), house: b(0.8), change: 0,
    bill: { kind: 'line', ref: { dept: 'office-of-the-vice-president', scope: 'department', nep: 785_204_000, house: 785_204_000 } },
  },
  {
    key: 'congress', group: 'political', name: 'Congress', short: 'Congress',
    nep: b(27.0), house: b(32.0), change: b(5.0),
    bill: { kind: 'line', ref: { dept: 'congress-of-the-philippines', scope: 'department', nep: 27_023_408_000, house: 32_023_408_000 } },
  },
  // Infrastructure requiring project-level disclosure
  {
    key: 'fmr', group: 'infrastructure', name: 'DA farm-to-market roads', short: 'Farm-to-market roads (DA)',
    nep: b(16.0), house: b(19.6), change: b(3.6),
    bill: { kind: 'line', ref: { dept: 'department-of-agriculture', scope: { label: '^Repair/Rehabilitation and Construction of Farm-to-Market Roads' }, q: 'Farm-to-Market Roads', nep: 16_000_000_000, house: 19_628_100_000 } },
  },
  {
    key: 'da-equipment', group: 'infrastructure', name: 'DA and BFAR equipment, postharvest facilities, and cold storage', short: 'Farm equipment, cold storage',
    nep: b(5.7), house: b(5.8), change: b(0.1),
    bill: {
      kind: 'change',
      ref: { dept: 'department-of-agriculture', scope: { label: '^(Provision of Agricultural Equipment and Facilities|Provision of Fishery On-farm/Postharvest Equipment|Cold Storage)' }, q: 'Equipment', nep: 1_872_707_000, house: 1_977_707_000 },
      why: 'PBC’s NEP figure (₱5.7 billion) is larger than the three lines the bill names this way (₱1.9 billion); the House change, ₱0.1 billion, matches.',
    },
  },
  {
    key: 'nia', group: 'infrastructure', name: 'National Irrigation Administration', short: 'Irrigation (NIA)',
    nep: b(46.4), house: b(45.2), change: b(-1.2),
    bill: { kind: 'line', ref: { dept: 'budgetary-support-to-government-corporations', scope: { agency: '^NATIONAL IRRIGATION ADMINISTRATION$' }, q: 'National Irrigation', nep: 46_355_900_000, house: 45_172_024_000 } },
    note: 'The House bill lists NIA’s restoration and development programs only as program totals, so which activities changed inside them is not known.',
  },
  {
    key: 'hfep', group: 'infrastructure', name: 'DOH Health Facilities Enhancement Program', short: 'Health facilities (DOH)',
    nep: b(14.5), house: b(10.1), change: b(-4.5),
    bill: { kind: 'line', ref: { dept: 'department-of-health', scope: { label: '^Health Facilities Enhancement Program$' }, q: 'Health Facilities Enhancement', nep: 14_539_832_000, house: 10_088_832_000 } },
  },
  {
    key: 'bef', group: 'infrastructure', name: 'DepEd Basic Education Facilities', short: 'School buildings (DepEd)',
    nep: b(30.6), house: b(27.5), change: b(-3.1),
    bill: { kind: 'line', ref: { dept: 'department-of-education', scope: { label: '^Basic Education Facilities$' }, q: 'Basic Education Facilities', nep: 30_551_016_000, house: 27_453_016_000 } },
  },
  {
    key: 'dpwh-asset', group: 'infrastructure', name: 'DPWH Asset Preservation Program', short: 'DPWH asset preservation',
    nep: b(76.5), house: b(82.6), change: b(6.1), bill: { kind: 'dpwh' }, note: DPWH_NOTE,
  },
  {
    key: 'dpwh-network', group: 'infrastructure', name: 'DPWH Network Development Program', short: 'DPWH network development',
    nep: b(176.6), house: b(122.0), change: b(-54.6), bill: { kind: 'dpwh' }, note: DPWH_NOTE,
  },
  {
    key: 'dpwh-bridge', group: 'infrastructure', name: 'DPWH Bridge Program', short: 'DPWH bridges',
    nep: b(44.4), house: b(40.9), change: b(-3.5), bill: { kind: 'dpwh' }, note: DPWH_NOTE,
  },
  {
    key: 'dpwh-flood', group: 'infrastructure', name: 'DPWH Flood Management Program', short: 'DPWH flood management',
    nep: b(103.5), house: b(96.1), change: b(-7.3), bill: { kind: 'dpwh' }, note: DPWH_NOTE,
  },
  {
    key: 'dpwh-convergence', group: 'infrastructure',
    name: 'DPWH Convergence and Special Support Program (BIP, SIPAG, other convergence roads)', short: 'DPWH convergence: BIP, SIPAG',
    nep: b(157.3), house: b(231.4), change: b(74.1),
    bill: { kind: 'line', ref: { dept: 'department-of-public-works-and-highways', scope: { label: '^CONVERGENCE AND SPECIAL SUPPORT PROGRAM$' }, q: 'Convergence and Special Support', nep: 157_303_648_000, house: 231_448_287_000 } },
  },
  {
    key: 'dpwh-local', group: 'infrastructure', name: 'DPWH Local Program', short: 'DPWH local program',
    nep: b(14.6), house: b(14.1), change: b(-0.6), bill: { kind: 'dpwh' }, note: DPWH_NOTE,
  },
];

export const linesOf = (g: RedFlagGroupKey) => RED_FLAG_LINES.filter((l) => l.group === g);
export const isDpwhLine = (l: RedFlagLine) => l.key.startsWith('dpwh-');

/** The explorer page (and search) that shows a line, or our DPWH project pages for DPWH; null for PBC's own figures. */
export function billHref(l: RedFlagLine): string | null {
  if (l.bill.kind === 'pbc') return null;
  if (l.bill.kind === 'dpwh') return `${HGAB}/dpwh`;
  const { dept, q } = l.bill.ref;
  return `${EXPLORER}/${dept}${q ? `?q=${encodeURIComponent(q)}` : ''}`;
}

/** "₱58.1B", "₱1,059.7B": PBC's billions, one decimal, as it publishes them. */
export function pbcBillions(php: number): string {
  return `₱${(Math.abs(php) / 1e9).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}B`;
}
/** "+₱24.8B", "−₱54.6B", "0" for no change. */
export function pbcChange(php: number): string {
  if (php === 0) return '0';
  return `${php > 0 ? '+' : '−'}${pbcBillions(php)}`;
}
/** "₱1,059.7 billion", for sentences. */
export function pbcBillionsWords(php: number): string {
  return `${pbcBillions(php).slice(0, -1)} billion`;
}

/**
 * The posters (npm run build:hgab-poster-redflags), published on the data host at hgab/2027/campaign/ with upload:hgab.
 * `v` is the first 8 hex digits of each file's MD5: the data host caches images for a day and link previews keep them
 * longer, so a rebuilt poster needs a new address. The poster script prints them; verify:hgab compares them with the
 * local files.
 */
export const RED_FLAG_POSTERS = [
  { key: 'portrait', file: '1t-red-flags-1080x1350.png', width: 1080, height: 1350, label: 'Feed, 4:5', v: '6b156d25' },
  { key: 'square', file: '1t-red-flags-1080x1080.png', width: 1080, height: 1080, label: 'Square', v: '20726bc8' },
  { key: 'og', file: '1t-red-flags-1200x630.png', width: 1200, height: 630, label: 'Link preview', v: '624cd811' },
] as const;
export type RedFlagPoster = (typeof RED_FLAG_POSTERS)[number];
export const posterPath = (p: RedFlagPoster) => `hgab/2027/campaign/${p.file}${p.v ? `?v=${p.v}` : ''}`;
