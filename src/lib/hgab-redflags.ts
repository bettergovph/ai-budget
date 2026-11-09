/**
 * ₱1 trillion in red flags (`/hgab/2027/1T-redflags`): the People's Budget Coalition's red-flag basket through the
 * FY 2027 House bill. Jason (2026-11-04): "Let's create a new poster for our 1Trillion red flags. See the table at the
 * bottom most of the page [research.bettergov.ph/static/nep-preview/flags.html]. We can create a separate page in
 * /hgab/2027/1T-redflags." Then (2026-11-09): "Link the title [to] the page that we have to see the data", and "We need
 * more information justifying them rather than just displaying a list without explanation".
 *
 * The basket is PBC's, not ours: a fixed set of budget lines PBC follows through every stage of the budget, in three
 * groups, plus unprogrammed appropriations. Every figure here is PBC's, from the table "PBC's red-flag basket through
 * the House bill (PHP billions)" in "The FY 2027 House General Appropriations Bill: An Assessment" (October 2026), with
 * its NEP 2026 and GAA 2026 columns. They are rounded to ₱0.1 billion and stored as integer pesos. A change is PBC's
 * own, worked out before rounding, so it can differ by ₱0.1 billion from House bill minus NEP; and a group's lines can
 * miss its subtotal by as much.
 *
 * Each line's `why` says, in plain words, what the line is and what its record shows. Every claim is PBC's (its
 * sections 2.3, 2.7, 2.8 and 5.1 to 6.5) or a count from our own data; none says anything is wrong. A reviewer
 * (2026-11-09) asked us not to be too forceful: these budgets have faced risks in the past, so they are red flags by
 * default. So the reasons stay with the record (what was proposed, enacted and added) and leave out who might steer a
 * line. `bill` is where the
 * line's figures stand in our own reading of the House bill: one line in the line-by-line explorer
 * (data/hgab/2027/explorer/d/), one or more DPWH programs in our DPWH project pages (dpwh/projects.parquet), a change
 * that matches though PBC's level is its own, or PBC's own figure. The page links each line's name there. verify:hgab
 * checks that our data still holds those exact amounts and counts, that PBC's figures are them rounded, and that the
 * subtotals and totals add up.
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
/** The explorer's page for unprogrammed appropriations. */
export const UNPROGRAMMED_HREF = `${EXPLORER}/unprogrammed-appropriations`;

/** Pesos from PBC's billions, which it rounds to one decimal. */
const b = (billions: number) => Math.round(billions * 10) * 100_000_000;
/** How far a PBC figure may sit from the exact amount it rounds: half of ₱0.1 billion. */
export const PBC_ROUNDING = 50_000_000;
const n = (x: number) => x.toLocaleString('en-US');

export type RedFlagGroupKey = 'patronage' | 'political' | 'infrastructure';

/** PBC's figures for one line, group or total: 2026 proposed (NEP) and enacted (GAA), then 2027. */
export interface RedFlagFigures {
  nep2026: number;
  gaa2026: number;
  nep: number;
  house: number;
  /** House bill minus NEP 2027, as PBC publishes it. */
  change: number;
}

export interface RedFlagGroup extends RedFlagFigures {
  key: RedFlagGroupKey;
  /** PBC's name for the group. */
  name: string;
  /** For the poster's tabs and the chart key. */
  short: string;
  /** What PBC counts in it, in plain words (from its own description of the basket). */
  plain: string;
  /** Why PBC watches it, in one sentence. */
  why: string;
}

/** Where a line's figures stand against our own reading of the House bill. */
export type BillCheck =
  /** One line of the bill (or a whole department or agency) in the explorer: PBC's figures are these amounts, rounded. */
  | { kind: 'line'; ref: BillRef }
  /** The change matches a line of the bill, but PBC's level is its own: a part of the line, or more lines than the bill names. */
  | { kind: 'change'; ref: BillRef; why: string }
  /** DPWH's projects in these programs, from our DPWH project pages: PBC's figures are these amounts, rounded. */
  | { kind: 'dpwh'; ref: DpwhRef }
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

export interface DpwhRef {
  /** The DPWH programs (the projects' `program`), the first one the one the link filters to. */
  programs: readonly string[];
  /** The exact amounts our DPWH project pages list for them, in pesos, and how many projects the House bill lists. */
  nep: number;
  house: number;
  projects: number;
}

/** A page of a source PDF (data/hgab/2027/pdf/<doc>.pdf) that prints an amount: the PDF page and the page number shown on it. */
export interface PageRef {
  php: number;
  doc: string;
  pdfPage: number;
  page: number;
}

export interface RedFlagLine extends RedFlagFigures {
  key: string;
  group: RedFlagGroupKey;
  /** PBC's name for the line, as its table publishes it (its footnote marks dropped; the footnotes are in `note`). */
  name: string;
  /** A short name for the poster. */
  short: string;
  /** Why PBC watches the line and what its record shows, in at most two plain sentences. */
  why: string;
  bill: BillCheck;
  /** PBC's footnote for the line's figures, in plain words. */
  note?: string;
  /** Where the bill's special provisions set the line's exact amount (TUPAD), in the NEP and the House bill. */
  provision?: { nep: PageRef; house: PageRef };
}

export const RED_FLAG_GROUPS: readonly RedFlagGroup[] = [
  {
    key: 'patronage',
    name: 'Programs at high risk of political patronage',
    short: 'Patronage risk',
    plain: 'Aid programs, confidential and intelligence funds, and lump sums for local governments.',
    why: 'In 2026 Congress more than doubled this group, from ₱88.3 billion proposed to ₱219.4 billion enacted.',
    nep2026: b(88.3), gaa2026: b(219.4), nep: b(140.1), house: b(209.6), change: b(69.5),
  },
  {
    key: 'political',
    name: 'Political offices',
    short: 'Political offices',
    plain: 'The budgets of the Office of the President, the Office of the Vice President and Congress.',
    why: 'Congress sets these budgets, its own included, so PBC watches them at every stage.',
    nep2026: b(54.6), gaa2026: b(67.5), nep: b(37.9), house: b(42.9), change: b(5.0),
  },
  {
    key: 'infrastructure',
    name: 'Infrastructure requiring project-level disclosure',
    short: 'Infrastructure',
    plain: 'Public works chosen project by project, often district by district: DPWH, farm-to-market roads, irrigation, health facilities and school buildings.',
    why: 'PBC asks that none of it be released without its project documents posted for the public.',
    nep2026: b(885.0), gaa2026: b(692.1), nep: b(686.0), house: b(695.2), change: b(9.2),
  },
];

/** Unprogrammed appropriations: standby authority, released only if extra revenue or new loans come in. */
export const RED_FLAG_UNPROGRAMMED = {
  name: 'Unprogrammed appropriations',
  short: 'Unprogrammed',
  plain: 'Standby budget, released only if extra revenue or new loans come in. The House bill keeps the NEP’s amount.',
  why: 'In past budgets it has held programs moved out of the main budget.',
  nep2026: b(250.0), gaa2026: b(150.9), nep: b(112.0), house: b(112.0), change: 0,
  /** The exact amount, the same in the NEP and the House bill (the explorer's index.json `unprogrammed`). */
  exact: 111_984_494_000,
} as const;

/** PBC's totals: the three groups, then with unprogrammed appropriations. */
export const RED_FLAG_TOTALS = {
  programmed: { nep2026: b(1027.9), gaa2026: b(979.0), nep: b(864.0), house: b(947.7), change: b(83.7) },
  all: { nep2026: b(1277.8), gaa2026: b(1129.9), nep: b(976.0), house: b(1059.7), change: b(83.7) },
} as const;

/** The trillion the title rounds to: the House bill's basket is past it, the NEP's is not. */
export const TRILLION = 1_000_000_000_000;

/**
 * Every DPWH project line in the House bill and the NEP, our DPWH pages' totals (dpwh/summary.json `totals`): DPWH
 * without its administration and support. PBC's six DPWH lines add up to these, rounded.
 */
export const DPWH_PROJECTS = { nep: 572_924_074_000, house: 587_075_661_000 } as const;

/** DPWH's programs as our DPWH project pages list them (dpwh/projects.parquet `program`), with the House bill's projects. */
const DPWH_REF = {
  asset: { programs: ['Asset Preservation Program'], nep: 76_500_584_000, house: 82_552_591_000, projects: 1_555 },
  network: { programs: ['Network Development Program'], nep: 176_637_644_000, house: 122_008_853_000, projects: 1_066 },
  bridge: { programs: ['Bridge Program'], nep: 44_410_122_000, house: 40_897_752_000, projects: 842 },
  flood: { programs: ['Flood Management Program'], nep: 103_450_431_000, house: 96_109_265_000, projects: 1_464 },
  convergence: { programs: ['Convergence and Special Support Program'], nep: 157_308_648_000, house: 231_448_287_000, projects: 11_134 },
  // PBC's Local Program also counts the one National Building Program project.
  local: { programs: ['Local Program', 'National Building Program'], nep: 14_616_645_000, house: 14_058_913_000, projects: 211 },
} as const satisfies Record<string, DpwhRef>;

/** Why only TUPAD's change matches the explorer: it is a part of a line. */
const TUPAD_PART = 'TUPAD is part of DOLE’s Livelihood and Emergency Employment line; PBC applies that line’s change to its NEP figure.';
/**
 * DOLE's special provision no. 1 sets TUPAD's amount, with the Government Internship Program's stipends (a reviewer,
 * 2026-11-09: "the exact amounts can be found in the Special Provisions"). PBC's NEP figure is it to the peso; PBC's
 * House figure adds the whole line's change (₱4,749,570,000) instead of the provision's (₱4,636,570,000).
 */
const TUPAD_NOTE =
  'DOLE’s special provisions set TUPAD’s amount, with the Government Internship Program’s: ₱14,246,077,000 in the NEP and ₱18,882,647,000 in the House bill. PBC’s House figure adds the whole line’s change to the NEP amount, so it is ₱0.1 billion higher.';

export const RED_FLAG_LINES: readonly RedFlagLine[] = [
  // Programs at high risk of political patronage
  {
    key: 'aics', group: 'patronage', name: 'DSWD Protective Services (AICS)', short: 'AICS (DSWD)',
    why: 'Cash aid for people in crisis. Congress has raised it in each of the last seven budgets.',
    nep2026: b(27.0), gaa2026: b(63.9), nep: b(33.3), house: b(58.1), change: b(24.8),
    bill: { kind: 'line', ref: { dept: 'department-of-social-welfare-and-development', scope: { label: '^Protective Services for Individuals and Families in Difficult Circumstances$' }, q: 'Protective Services for Individuals', nep: 33_284_583_000, house: 58_090_583_000 } },
  },
  {
    key: 'tupad', group: 'patronage', name: 'DOLE TUPAD', short: 'TUPAD (DOLE)',
    why: 'Tulong Panghanapbuhay sa Ating Disadvantaged/Displaced Workers: short-term emergency jobs, inside DOLE’s larger Livelihood and Emergency Employment line. Congress has raised it in each of the last seven budgets.',
    nep2026: b(12.1), gaa2026: b(22.4), nep: b(14.2), house: b(19.0), change: b(4.7),
    bill: { kind: 'change', ref: { dept: 'department-of-labor-and-employment', scope: { label: '^Livelihood and Emergency Employment$' }, q: 'Livelihood and Emergency Employment', nep: 16_701_891_000, house: 21_451_461_000 }, why: TUPAD_PART },
    note: TUPAD_NOTE,
    provision: {
      nep: { php: 14_246_077_000, doc: 'nep2027-vol-iia', pdfPage: 561, page: 553 },
      house: { php: 18_882_647_000, doc: 'hb10858-3r-vol-ia', pdfPage: 1235, page: 1225 },
    },
  },
  {
    key: 'map', group: 'patronage', name: 'DOH Medical Assistance Program (MAP, formerly MAIFIP)', short: 'MAP, formerly MAIFIP (DOH)',
    why: 'Help with hospital bills, given through guarantee letters. Congress has raised it every year since it became a line.',
    nep2026: b(24.2), gaa2026: b(51.6), nep: b(24.2), house: b(48.2), change: b(24.0),
    bill: { kind: 'line', ref: { dept: 'department-of-health', scope: { label: '^Medical Assistance Program \\(MAP\\)$' }, q: 'Medical Assistance Program', nep: 24_238_078_000, house: 48_203_854_000 } },
  },
  {
    key: 'tulong-dunong', group: 'patronage', name: 'CHED Tulong Dunong', short: 'Tulong Dunong (CHED)',
    why: 'Grants for college students. The NEP gave it nothing; the House bill brings it back, as Congress funded it in 2026.',
    nep2026: 0, gaa2026: b(2.7), nep: 0, house: b(1.8), change: b(1.8),
    bill: { kind: 'line', ref: { dept: 'other-executive-offices', scope: { label: '^Tulong Dunong Program$' }, q: 'Tulong Dunong', nep: 0, house: 1_766_390_000 } },
  },
  {
    key: 'paff', group: 'patronage', name: 'DA Presidential Assistance to Farmers and Fisherfolk', short: 'Assistance to Farmers (DA)',
    why: 'Assistance to farmers and fisherfolk that Congress created in 2026 with ₱10 billion. The NEP gave it nothing; the House bill puts the ₱10 billion back.',
    nep2026: 0, gaa2026: b(10.0), nep: 0, house: b(10.0), change: b(10.0),
    bill: { kind: 'line', ref: { dept: 'department-of-agriculture', scope: { label: '^Presidential Assistance for Farmers and Fisherfolk Program$' }, q: 'Presidential Assistance for Farmers', nep: 0, house: 10_000_000_000 } },
  },
  {
    key: 'cif', group: 'patronage', name: 'Confidential and intelligence funds · all agencies', short: 'Confidential funds (CIF)',
    why: 'Confidential and intelligence funds, spread across many agencies’ budgets; PBC adds them up.',
    nep2026: b(10.8), gaa2026: b(11.8), nep: b(10.8), house: b(10.9), change: b(0.1),
    bill: { kind: 'pbc', why: 'PBC’s own tally of confidential and intelligence funds across agencies; the House change (₱140 million) is from the budget amendments subcommittee’s livestream.' },
    note: 'PBC’s own tally across agencies. The House change is from the budget amendments subcommittee’s livestream. The Office of the President’s share is also in its own budget, so the total counts it twice (historically about ₱4.5 billion).',
  },
  {
    key: 'fa-lgus', group: 'patronage', name: 'Financial Assistance to LGUs', short: 'Financial Assistance to LGUs',
    why: 'Assistance to local governments as a lump sum. Congress raised it in five straight budgets, and the NEP now starts from that level.',
    nep2026: b(5.0), gaa2026: b(37.5), nep: b(37.5), house: b(41.6), change: b(4.1),
    bill: { kind: 'line', ref: { dept: 'allocations-to-local-government-units', scope: { label: '^Financial Assistance to Local Government Units$' }, q: 'Financial Assistance to Local Government Units', nep: 37_492_578_000, house: 41_583_978_000 } },
  },
  {
    key: 'ntf-elcac', group: 'patronage', name: 'NTF-ELCAC support to barangays', short: 'NTF-ELCAC barangays',
    why: 'Support for barangays under the anti-insurgency task force, as one line for all barangays.',
    nep2026: b(8.1), gaa2026: b(8.1), nep: b(9.7), house: b(9.7), change: 0,
    bill: { kind: 'line', ref: { dept: 'allocations-to-local-government-units', scope: { label: '^Support to the Barangay Development Program' }, q: 'Barangay Development Program', nep: 9_740_000_000, house: 9_740_000_000 } },
  },
  {
    key: 'gef', group: 'patronage', name: 'Growth Equity Fund', short: 'Growth Equity Fund',
    why: 'A lump sum for local governments. Congress raised it from ₱1.0 billion proposed to ₱11.3 billion enacted in 2026, and the NEP keeps most of it.',
    nep2026: b(1.0), gaa2026: b(11.3), nep: b(10.3), house: b(10.3), change: 0,
    bill: { kind: 'line', ref: { dept: 'allocations-to-local-government-units', scope: { label: '^Growth Equity Fund$' }, q: 'Growth Equity Fund', nep: 10_300_000_000, house: 10_300_000_000 } },
  },
  // Political offices
  {
    key: 'op', group: 'political', name: 'Office of the President', short: 'Office of the President',
    why: 'The President’s own office. Congress has usually enacted it as proposed; it falls in 2027 because the one-time ₱17.55 billion ASEAN hosting item ends.',
    nep2026: b(27.3), gaa2026: b(28.0), nep: b(10.1), house: b(10.1), change: 0,
    bill: { kind: 'line', ref: { dept: 'office-of-the-president', scope: 'department', nep: 10_083_518_000, house: 10_083_518_000 } },
  },
  {
    key: 'ovp', group: 'political', name: 'Office of the Vice President', short: 'Office of the Vice President',
    why: 'Congress cut it from ₱2.4 billion to ₱1.9 billion in 2024, and from ₱2.0 billion to ₱0.7 billion in 2025.',
    nep2026: b(0.9), gaa2026: b(0.9), nep: b(0.8), house: b(0.8), change: 0,
    bill: { kind: 'line', ref: { dept: 'office-of-the-vice-president', scope: 'department', nep: 785_204_000, house: 785_204_000 } },
  },
  {
    key: 'congress', group: 'political', name: 'Congress', short: 'Congress',
    why: 'The budget Congress sets for itself. It has added to its own budget in each of the last seven years; the House bill adds ₱5.0 billion to the House of Representatives.',
    nep2026: b(26.4), gaa2026: b(38.6), nep: b(27.0), house: b(32.0), change: b(5.0),
    bill: { kind: 'line', ref: { dept: 'congress-of-the-philippines', scope: 'department', nep: 27_023_408_000, house: 32_023_408_000 } },
  },
  // Infrastructure requiring project-level disclosure
  {
    key: 'fmr', group: 'infrastructure', name: 'DA farm-to-market roads', short: 'Farm-to-market roads (DA)',
    why: 'Farm roads chosen district by district. Congress raised them in six of the last seven budgets.',
    nep2026: b(16.0), gaa2026: b(33.0), nep: b(16.0), house: b(19.6), change: b(3.6),
    bill: { kind: 'line', ref: { dept: 'department-of-agriculture', scope: { label: '^Repair/Rehabilitation and Construction of Farm-to-Market Roads' }, q: 'Farm-to-Market Roads', nep: 16_000_000_000, house: 19_628_100_000 } },
  },
  {
    key: 'da-equipment', group: 'infrastructure', name: 'DA and BFAR equipment, postharvest facilities, and cold storage', short: 'Farm equipment, cold storage',
    why: 'Machines and facilities for farmers and fishers. PBC asks that these, like all infrastructure, be released only with their documents posted for the public.',
    nep2026: b(4.3), gaa2026: b(4.8), nep: b(5.7), house: b(5.8), change: b(0.1),
    bill: {
      kind: 'change',
      ref: { dept: 'department-of-agriculture', scope: { label: '^(Provision of Agricultural Equipment and Facilities|Provision of Fishery On-farm/Postharvest Equipment|Cold Storage)' }, q: 'Equipment', nep: 1_872_707_000, house: 1_977_707_000 },
      why: 'PBC’s NEP figure (₱5.7 billion) is larger than the three lines the bill names this way (₱1.9 billion); the House change, ₱0.1 billion, matches.',
    },
  },
  {
    key: 'nia', group: 'infrastructure', name: 'National Irrigation Administration', short: 'Irrigation (NIA)',
    why: 'Irrigation. The budget amendments subcommittee announced ₱4.09 billion more for NIA, but the House bill ends ₱1.2 billion below the NEP.',
    nep2026: b(45.1), gaa2026: b(63.2), nep: b(46.4), house: b(45.2), change: b(-1.2),
    bill: { kind: 'line', ref: { dept: 'budgetary-support-to-government-corporations', scope: { agency: '^NATIONAL IRRIGATION ADMINISTRATION$' }, q: 'National Irrigation', nep: 46_355_900_000, house: 45_172_024_000 } },
    note: 'The House bill lists NIA’s restoration and development programs only as program totals, so which activities changed inside them is not known.',
  },
  {
    key: 'hfep', group: 'infrastructure', name: 'DOH Health Facilities Enhancement Program', short: 'Health facilities (DOH)',
    why: 'Health facilities, a line Congress raised in each of the last seven budgets. The House bill cuts it; PBC asks the Senate to restore it.',
    nep2026: b(14.5), gaa2026: b(22.3), nep: b(14.5), house: b(10.1), change: b(-4.5),
    bill: { kind: 'line', ref: { dept: 'department-of-health', scope: { label: '^Health Facilities Enhancement Program$' }, q: 'Health Facilities Enhancement', nep: 14_539_832_000, house: 10_088_832_000 } },
  },
  {
    key: 'bef', group: 'infrastructure', name: 'DepEd Basic Education Facilities', short: 'School buildings (DepEd)',
    why: 'School buildings. Congress raised them from ₱28.1 billion proposed to ₱85.4 billion enacted in 2026; the House bill cuts them, and PBC asks the Senate to restore them.',
    nep2026: b(28.1), gaa2026: b(85.4), nep: b(30.6), house: b(27.5), change: b(-3.1),
    bill: { kind: 'line', ref: { dept: 'department-of-education', scope: { label: '^Basic Education Facilities$' }, q: 'Basic Education Facilities', nep: 30_551_016_000, house: 27_453_016_000 } },
  },
  {
    key: 'dpwh-asset', group: 'infrastructure', name: 'DPWH Asset Preservation Program', short: 'DPWH asset preservation',
    why: `Upkeep and repair of national roads and bridges: ${n(DPWH_REF.asset.projects)} projects in the House bill.`,
    nep2026: b(108.3), gaa2026: b(99.4), nep: b(76.5), house: b(82.6), change: b(6.1),
    bill: { kind: 'dpwh', ref: DPWH_REF.asset },
  },
  {
    key: 'dpwh-network', group: 'infrastructure', name: 'DPWH Network Development Program', short: 'DPWH network development',
    why: 'New and wider national roads. The House took out ₱54.6 billion, almost all from foreign-loan projects such as the Laguna Lakeshore road and the Davao City bypass.',
    nep2026: b(182.5), gaa2026: b(96.8), nep: b(176.6), house: b(122.0), change: b(-54.6),
    bill: { kind: 'dpwh', ref: DPWH_REF.network },
  },
  {
    key: 'dpwh-bridge', group: 'infrastructure', name: 'DPWH Bridge Program', short: 'DPWH bridges',
    why: `Building and replacing bridges: ${n(DPWH_REF.bridge.projects)} projects in the House bill.`,
    nep2026: b(52.3), gaa2026: b(34.1), nep: b(44.4), house: b(40.9), change: b(-3.5),
    bill: { kind: 'dpwh', ref: DPWH_REF.bridge },
  },
  {
    key: 'dpwh-flood', group: 'infrastructure', name: 'DPWH Flood Management Program', short: 'DPWH flood management',
    why: 'Flood control. Congress cut it to ₱4.8 billion in 2026, after the 2025 flood control investigations; the NEP brings back ₱103.5 billion.',
    nep2026: b(250.8), gaa2026: b(4.8), nep: b(103.5), house: b(96.1), change: b(-7.3),
    bill: { kind: 'dpwh', ref: DPWH_REF.flood },
  },
  {
    key: 'dpwh-convergence', group: 'infrastructure',
    name: 'DPWH Convergence and Special Support Program (BIP, SIPAG, other convergence roads)', short: 'DPWH convergence: BIP, SIPAG',
    why: `Mostly local access roads and multi-purpose buildings under the Basic Infrastructure Program, chosen district by district: ${n(DPWH_REF.convergence.projects)} projects in the House bill. The ₱74.1 billion added brings it near the ₱240.5 billion enacted for 2026.`,
    nep2026: b(167.8), gaa2026: b(240.5), nep: b(157.3), house: b(231.4), change: b(74.1),
    bill: { kind: 'dpwh', ref: DPWH_REF.convergence },
  },
  {
    key: 'dpwh-local', group: 'infrastructure', name: 'DPWH Local Program', short: 'DPWH local program',
    why: `DPWH’s local program: ${n(DPWH_REF.local.projects - 1)} projects in the House bill, plus one national building project that PBC counts with them.`,
    nep2026: b(15.4), gaa2026: b(7.8), nep: b(14.6), house: b(14.1), change: b(-0.6),
    bill: { kind: 'dpwh', ref: DPWH_REF.local },
  },
];

export const linesOf = (g: RedFlagGroupKey) => RED_FLAG_LINES.filter((l) => l.group === g);
export const isDpwhLine = (l: RedFlagLine) => l.key.startsWith('dpwh-');

/** The page that shows a line's data: its line in the explorer, or its DPWH program's projects; null for PBC's own figures. */
export function billHref(l: RedFlagLine): string | null {
  const c = l.bill;
  if (c.kind === 'pbc') return null;
  if (c.kind === 'dpwh') return `${HGAB}/dpwh?view=projects&program=${encodeURIComponent(c.ref.programs[0])}`;
  return `${EXPLORER}/${c.ref.dept}${c.ref.q ? `?q=${encodeURIComponent(c.ref.q)}` : ''}`;
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
 * The page does not offer them for download (Jason, 2026-11-04: "Remove the poster download"); the 1200×630 is its
 * link preview. `v` is the first 8 hex digits of each file's MD5: the data host caches images for a day and link
 * previews keep them longer, so a rebuilt poster needs a new address. The poster script prints them; verify:hgab
 * compares them with the local files.
 */
export const RED_FLAG_POSTERS = [
  { key: 'portrait', file: '1t-red-flags-1080x1350.png', width: 1080, height: 1350, label: 'Feed, 4:5', v: '6b156d25' },
  { key: 'square', file: '1t-red-flags-1080x1080.png', width: 1080, height: 1080, label: 'Square', v: '20726bc8' },
  { key: 'og', file: '1t-red-flags-1200x630.png', width: 1200, height: 630, label: 'Link preview', v: '624cd811' },
] as const;
