/**
 * Foreign-assisted projects (`/hgab/2027/foreign-assisted`): every loan- or grant-financed project in the FY2027
 * House bill against the NEP, and how Congress has treated these projects in every budget since FY2021.
 *
 * Data contract for `data/hgab/2027/fap.json` (`FapData`) and `fap.csv`, written by `npm run build:hgab-fap`
 * (`scripts/build-hgab-fap.ts`) and re-checked by `npm run verify:hgab` (`scripts/verify-hgab-fap.ts`).
 *
 * Where each figure comes from:
 *   - FY2027 NEP and House bill, by project: the line-by-line dataset (every House bill line against the NEP,
 *     `data/hgab/2027/explorer/downloads/house-bill-2027-lines-vs-nep.parquet`), the rows the bill lists under
 *     "Foreign-Assisted Project(s)", with their loan-proceeds and GOP-counterpart parts; a House line with no NEP
 *     match is looked up in the DBM NEP extract by its exact name (one line, DPWH's Accelerated Bridge project);
 *   - lenders: the fund each NEP line is charged to (`data/2027/<dept>/line_items.parquet`);
 *   - FY2020–FY2026 enacted budgets: the DBM GAA extracts (`data/gaa-history/parquet/gaa-<fy>.parquet`), every line
 *     whose seventh code digit is 3, the UACS mark for a foreign-assisted project;
 *   - FY2019–FY2027 as DBM reports them: Table B.13 of the Budget of Expenditures and Sources of Financing (BESF),
 *     "Foreign-Assisted Projects, by Department/Agency", one edition per year (`BESF_EDITIONS`, `FAP_SERIES`);
 *   - unprogrammed appropriations: the FY2027 NEP (Volume III) and House bill (Volume I-B), and the People's Budget
 *     Coalition's FY2026 tracker (`UNPROGRAMMED`).
 *
 * Rules: integer pesos; null is "no figure", never zero; stages are compared, never added; amounts are
 * appropriations (or, in the "actual" column, obligations), not spending; a project is one activity line of the bill,
 * whatever its number of loans.
 *
 * Pure (no runtime imports, no `import.meta.env`): the builder, the verifier, the page and the Worker's SEO read it.
 */

export const FAP_SCHEMA = 1 as const;
export const FAP_ROOT = '/hgab/2027/foreign-assisted';
export const FAP_TITLE = 'Foreign-assisted projects';
/** Paths under the data host (`dataUrl`), the same keys on R2. */
export const FAP_DATA_PATH = 'hgab/2027/fap.json';
export const FAP_CSV_PATH = 'hgab/2027/fap.csv';
export const FAP_CSV_NAME = 'bettergov-house-bill-2027-foreign-assisted-projects.csv';
/** Volume I-B of the House bill (third reading): DPWH onwards, and the unprogrammed appropriations (page 607). */
export const FAP_VOL_IB_PATH = 'hgab/2027/pdf/hb10858-3r-vol-ib.pdf';
/** Volume III of the NEP: the unprogrammed appropriations and the FY2025 releases from them (page 961). */
export const FAP_NEP_VOL_III_PATH = 'hgab/2027/pdf/nep2027-vol-iii.pdf';

export type FapStatus = 'cut' | 'raised' | 'same' | 'new';

export interface FapProject {
  /** `<dept code>:<n>`, stable within a build. */
  key: string;
  /** DBM department code ("18"); the NEP's, or the House bill's department matched to it. */
  dept_code: string;
  /** Department as the House bill names it. */
  department: string;
  /** Short name for tables ("DPWH"). */
  dept_short: string;
  /** The explorer page's department id (data/hgab/2027/explorer/d/<id>.json), for the link into the bill. */
  dept_slug: string | null;
  agency: string;
  /** The project, as the House bill names it. */
  title: string;
  /** The NEP's P/A/P code(s) for the line (the bill publishes none). */
  fpap_codes: string[];
  /** Lenders or donors, from the funds the NEP charges the line to, largest first; the bill's title for a new line. */
  lenders: string[];
  nep_php: number | null;
  house_php: number | null;
  /** House bill minus the NEP (null on both sides counts as 0). */
  change_php: number;
  status: FapStatus;
  /** The loan or grant proceeds part of each side (what the lender pays). */
  loan_nep_php: number;
  loan_house_php: number;
  /** The government counterpart part (what the Treasury pays). */
  gop_nep_php: number;
  gop_house_php: number;
  /** Where the bill lists the line: volume and PDF page of its first row. */
  volume: string;
  pdf_page: number;
  /** DPWH lines: the record in the DPWH project comparison (`/hgab/2027/dpwh/p/<id>`). */
  dpwh_id: string | null;
  /** 'name' when the NEP side came from the DBM extract by exact name rather than the line-by-line match. */
  nep_match: 'line' | 'name' | null;
}

export interface FapDepartment {
  dept_code: string;
  department: string;
  dept_short: string;
  dept_slug: string | null;
  projects: number;
  cut: number;
  raised: number;
  nep_php: number;
  house_php: number;
  change_php: number;
  loan_nep_php: number;
  loan_house_php: number;
  gop_nep_php: number;
  gop_house_php: number;
}

export interface FapLender {
  name: string;
  nep_php: number;
  projects: number;
}

export interface FapGaaYear {
  fy: number;
  /** Every line with the foreign-assisted mark, new appropriations, as the GAA extract lists them. */
  php: number;
  lines: number;
  by_dept: { dept_code: string; dept_short: string; php: number }[];
}

export interface FapSide {
  nep_php: number;
  house_php: number;
}

export interface FapData {
  schema: typeof FAP_SCHEMA;
  built_at: string;
  totals: {
    projects: number;
    cut: number;
    raised: number;
    same: number;
    new: number;
    all: FapSide;
    loan: FapSide;
    gop: FapSide;
    /** The NEP extract's own total for the foreign-assisted mark (new appropriations), to compare with `all.nep_php`. */
    nep_extract_php: number;
    /** Everything the House took out of lines across the whole bill (sum of every activity's cut), for the share. */
    bill_cuts_php: number;
    /** The DPWH project comparison's own foreign-assisted totals (29 lines), which the DPWH rows here must equal. */
    dpwh_workbench: FapSide & { lines: number };
  };
  departments: FapDepartment[];
  projects: FapProject[];
  lenders: FapLender[];
  gaa: FapGaaYear[];
  checks: { key: string; label: string; ok: true; detail: string }[];
  sources: { key: string; label: string; path: string; sha256?: string }[];
}

// ---------------------------------------------------------------------------
// DBM's own series: BESF Table B.13, one edition per year
// ---------------------------------------------------------------------------

/**
 * Each BESF prints three years of the table: the year before last (actual obligations), last year (the program:
 * the enacted budget as adjusted) and the budget year (proposed, the NEP). The FY2023, FY2024 and FY2027 editions are
 * image-only PDFs, read by OCR and checked by their row sums; the others carry text.
 */
export const BESF_EDITIONS: readonly { fy: number; url: string; years: string; ocr: boolean }[] = [
  { fy: 2021, url: 'https://www.dbm.gov.ph/wp-content/uploads/BESF/BESF2021/B13.pdf', years: 'FY 2019–2021', ocr: false },
  { fy: 2022, url: 'https://www.dbm.gov.ph/wp-content/uploads/BESF/BESF2022/B13.pdf', years: 'FY 2020–2022', ocr: false },
  { fy: 2023, url: 'https://www.dbm.gov.ph/wp-content/uploads/BESF/BESF2023/B13.pdf', years: 'FY 2021–2023', ocr: true },
  { fy: 2024, url: 'https://www.dbm.gov.ph/wp-content/uploads/BESF/BESF2024/B13.pdf', years: 'FY 2022–2024', ocr: true },
  { fy: 2025, url: 'https://www.dbm.gov.ph/wp-content/uploads/BESF/BESF2025/B13.pdf', years: 'FY 2023–2025', ocr: false },
  { fy: 2026, url: 'https://www.dbm.gov.ph/wp-content/uploads/BESF/BESF2026/B13.pdf', years: 'FY 2024–2026', ocr: false },
  { fy: 2027, url: 'https://www.dbm.gov.ph/wp-content/uploads/BESF/BESF2027/B13.pdf', years: 'FY 2025–2027', ocr: true },
];

/** One BESF cell: the three parts DBM prints, in pesos (the table is in thousands). */
export interface FapParts {
  gop: number;
  loan: number;
  grant: number;
  total: number;
  /** The BESF edition the figure is from. */
  besf: number;
}

export type FapStageKey = 'proposed' | 'program' | 'actual';

export const FAP_STAGE_LABELS: Record<FapStageKey, { label: string; plain: string }> = {
  proposed: { label: 'NEP', plain: 'what the NEP proposed for the year' },
  program: { label: 'Enacted', plain: 'what the enacted budget (GAA) carried for the year, as adjusted, in the programmed budget' },
  actual: { label: 'Actual', plain: 'what agencies actually obligated that year, including releases from unprogrammed appropriations' },
};

export interface FapYear {
  fy: number;
  proposed: FapParts | null;
  program: FapParts | null;
  actual: FapParts | null;
}

const k = (gop: number, loan: number, grant: number, besf: number): FapParts => ({
  gop: gop * 1000, loan: loan * 1000, grant: grant * 1000, total: (gop + loan + grant) * 1000, besf,
});

/**
 * Grand totals of Table B.13, all departments and special purpose funds, in pesos. `program` is DBM's "FY program"
 * column; it equals the foreign-assisted lines of the GAA extract to the peso for FY2020, FY2021 and FY2023–FY2026
 * (the verifier checks) and is ₱1.69 billion below the extract for FY2022, where the extract carries the budget as
 * enacted and the BESF the budget as adjusted.
 */
export const FAP_SERIES: readonly FapYear[] = [
  { fy: 2019, proposed: null, program: null, actual: k(12_807_650, 52_224_835, 728_527, 2021) },
  { fy: 2020, proposed: null, program: k(36_658_614, 47_965_950, 0, 2021), actual: k(28_083_296, 48_918_717, 1_168_346, 2022) },
  { fy: 2021, proposed: k(40_810_466, 151_720_234, 0, 2021), program: k(30_448_907, 44_701_702, 0, 2022), actual: k(22_869_447, 118_796_160, 363_782, 2023) },
  { fy: 2022, proposed: k(42_186_683, 145_271_622, 0, 2022), program: k(15_721_486, 24_322_782, 0, 2023), actual: k(18_885_881, 124_277_355, 807_685, 2024) },
  { fy: 2023, proposed: k(144_580_064, 65_438_864, 0, 2023), program: k(57_826_066, 746_897, 0, 2024), actual: k(55_061_250, 137_747_105, 888_815, 2025) },
  { fy: 2024, proposed: k(136_402_615, 109_659_781, 0, 2024), program: k(1_525_918, 2_464_059, 0, 2025), actual: k(32_630_711, 145_532_147, 469_152, 2026) },
  { fy: 2025, proposed: k(65_084_866, 150_564_917, 0, 2025), program: k(30_663_064, 35_346_131, 0, 2026), actual: k(45_125_765, 137_540_324, 300_320, 2027) },
  { fy: 2026, proposed: k(82_029_569, 201_291_442, 0, 2026), program: k(34_648_987, 97_379_377, 0, 2027), actual: null },
  { fy: 2027, proposed: k(145_373_756, 271_219_192, 0, 2027), program: null, actual: null },
];

export type FapDeptKey = 'dpwh' | 'dotr' | 'da' | 'deped' | 'doh' | 'dswd';

export const FAP_DEPT_NAMES: Record<FapDeptKey, { short: string; name: string; code: string }> = {
  dpwh: { short: 'DPWH', name: 'Department of Public Works and Highways', code: '18' },
  dotr: { short: 'DOTr', name: 'Department of Transportation', code: '38' },
  da: { short: 'DA', name: 'Department of Agriculture', code: '05' },
  deped: { short: 'DepEd', name: 'Department of Education', code: '07' },
  doh: { short: 'DOH', name: 'Department of Health', code: '13' },
  dswd: { short: 'DSWD', name: 'Department of Social Welfare and Development', code: '20' },
};

/** Department totals of Table B.13 (the department's own rows, not its corporations under BSGC), in pesos; null = no row or a dash. */
export const FAP_DEPT_SERIES: Record<FapDeptKey, readonly { fy: number; proposed: number | null; program: number | null; actual: number | null }[]> = {
  dpwh: [
    { fy: 2019, proposed: null, program: null, actual: 13_230_035_000 },
    { fy: 2020, proposed: null, program: 21_036_687_000, actual: 18_909_616_000 },
    { fy: 2021, proposed: 80_504_387_000, program: 20_724_603_000, actual: 18_489_487_000 },
    { fy: 2022, proposed: 52_769_891_000, program: 7_448_794_000, actual: 23_505_795_000 },
    { fy: 2023, proposed: 70_700_851_000, program: 7_937_951_000, actual: 25_026_050_000 },
    { fy: 2024, proposed: 70_700_851_000, program: 0, actual: 44_825_762_000 },
    { fy: 2025, proposed: 70_700_851_000, program: 23_000_000_000, actual: 69_291_622_000 },
    { fy: 2026, proposed: 100_000_000_000, program: 17_696_626_000, actual: null },
    { fy: 2027, proposed: 117_749_011_000, program: null, actual: null },
  ],
  dotr: [
    { fy: 2019, proposed: null, program: null, actual: 43_327_451_000 },
    { fy: 2020, proposed: null, program: 55_032_689_000, actual: 47_309_847_000 },
    { fy: 2021, proposed: 100_738_685_000, program: 43_122_685_000, actual: 46_922_845_000 },
    { fy: 2022, proposed: 105_207_667_000, program: 15_856_603_000, actual: 98_207_929_000 },
    { fy: 2023, proposed: 108_094_967_000, program: 42_894_967_000, actual: 144_310_236_000 },
    { fy: 2024, proposed: 161_340_128_000, program: 3_501_299_000, actual: 103_097_371_000 },
    { fy: 2025, proposed: 122_602_631_000, program: 20_662_894_000, actual: 84_835_276_000 },
    { fy: 2026, proposed: 135_854_812_000, program: 64_074_535_000, actual: null },
    { fy: 2027, proposed: 232_230_725_000, program: null, actual: null },
  ],
  da: [
    { fy: 2019, proposed: null, program: null, actual: 3_613_270_000 },
    { fy: 2020, proposed: null, program: 2_500_402_000, actual: 2_481_807_000 },
    { fy: 2021, proposed: 697_585_000, program: 697_585_000, actual: 1_679_140_000 },
    { fy: 2022, proposed: 9_395_484_000, program: 3_935_268_000, actual: 8_134_669_000 },
    { fy: 2023, proposed: 6_208_462_000, program: 939_529_000, actual: 6_804_940_000 },
    { fy: 2024, proposed: 6_285_945_000, program: 0, actual: 9_492_401_000 },
    { fy: 2025, proposed: 14_721_578_000, program: 14_721_578_000, actual: 13_151_167_000 },
    { fy: 2026, proposed: 13_830_058_000, program: 13_830_058_000, actual: null },
    { fy: 2027, proposed: 13_176_612_000, program: null, actual: null },
  ],
  deped: [
    { fy: 2021, proposed: 0, program: 0, actual: 0 },
    { fy: 2022, proposed: 0, program: 0, actual: 0 },
    { fy: 2023, proposed: 602_639_000, program: 0, actual: 0 },
    { fy: 2024, proposed: 604_382_000, program: 0, actual: 205_000 },
    { fy: 2025, proposed: 505_024_000, program: 505_024_000, actual: 550_453_000 },
    { fy: 2026, proposed: 9_848_279_000, program: 9_848_279_000, actual: null },
    { fy: 2027, proposed: 13_694_399_000, program: null, actual: null },
  ],
  doh: [
    { fy: 2019, proposed: null, program: null, actual: 0 },
    { fy: 2020, proposed: null, program: 0, actual: 2_597_924_000 },
    { fy: 2021, proposed: 5_256_498_000, program: 5_256_498_000, actual: 65_566_689_000 },
    { fy: 2022, proposed: 1_289_532_000, program: 1_584_012_000, actual: 1_806_480_000 },
    { fy: 2023, proposed: 2_748_384_000, program: 0, actual: 1_798_109_000 },
    { fy: 2024, proposed: 2_474_076_000, program: 0, actual: 1_887_806_000 },
    { fy: 2025, proposed: 1_437_863_000, program: 1_437_863_000, actual: 2_275_794_000 },
    { fy: 2026, proposed: 8_669_531_000, program: 8_669_531_000, actual: null },
    { fy: 2027, proposed: 8_403_057_000, program: null, actual: null },
  ],
  dswd: [
    { fy: 2019, proposed: null, program: null, actual: 2_659_925_000 },
    { fy: 2020, proposed: null, program: 1_000_000_000, actual: 2_147_029_000 },
    { fy: 2021, proposed: 0, program: 0, actual: 3_271_689_000 },
    { fy: 2022, proposed: 8_812_149_000, program: 5_108_152_000, actual: 7_271_869_000 },
    { fy: 2023, proposed: 11_890_023_000, program: 3_776_539_000, actual: 10_673_345_000 },
    { fy: 2024, proposed: 682_872_000, program: 0, actual: 4_644_916_000 },
    { fy: 2025, proposed: 1_023_488_000, program: 1_023_488_000, actual: 2_210_027_000 },
    { fy: 2026, proposed: 0, program: 0, actual: null },
    { fy: 2027, proposed: 21_535_966_000, program: null, actual: null },
  ],
};

// ---------------------------------------------------------------------------
// Unprogrammed appropriations: the standby cover for these projects
// ---------------------------------------------------------------------------

/**
 * "Support to Foreign-Assisted Projects" is a purpose of the unprogrammed appropriations, released only against
 * approved loans. Figures in pesos. The FY2025 releases are the "Budgetary Adjustments" the FY2027 NEP lists under
 * the unprogrammed appropriations (Volume III, pages 961–963); the FY2026 figures are the People's Budget Coalition's
 * tracker of the unprogrammed annex (NEP, House bill and Senate bill all carry the same amount); FY2027 is the NEP
 * and the House bill, which are identical (Volume III page 965; Volume I-B page 608).
 */
export const UNPROGRAMMED = {
  /** Total unprogrammed appropriations, as the FY2027 NEP reports them (FY2025 and FY2026 as enacted). */
  totals: [
    { fy: 2025, php: 218_194_869_000, stage: 'Enacted (after the veto)' },
    { fy: 2026, php: 150_905_671_000, stage: 'Enacted' },
    { fy: 2027, php: 111_984_494_000, stage: 'NEP and House bill' },
  ],
  /** The purpose "Support to Foreign-Assisted Projects". */
  support: [
    { fy: 2026, php: 97_305_671_000, stage: 'NEP, House bill and Senate bill', source: 'pbc' },
    { fy: 2027, php: 42_553_494_000, stage: 'NEP and House bill', source: 'nep' },
  ],
  /** FY2026: the House added a purpose for the government counterpart of these projects (taken from the SAGISP lump). */
  counterpart_2026_house_php: 35_769_481_000,
  /** FY2027: the two parts of the support purpose. */
  support_2027: { mooe_php: 4_721_846_000, co_php: 37_831_648_000 },
  /** FY2025: what was actually released from the support purpose, by agency, as the FY2027 NEP lists it. */
  releases_2025: [
    { agency: 'DPWH, Office of the Secretary', dept_short: 'DPWH', php: 58_845_397_000 },
    { agency: 'DOTr, Office of the Secretary', dept_short: 'DOTr', php: 30_710_980_000 },
    { agency: 'DSWD, Office of the Secretary', dept_short: 'DSWD', php: 6_936_112_000 },
    { agency: 'DAR, Office of the Secretary', dept_short: 'DAR', php: 4_823_663_000 },
    { agency: 'DOH, Office of the Secretary', dept_short: 'DOH', php: 3_724_518_000 },
    { agency: 'DICT, Office of the Secretary', dept_short: 'DICT', php: 1_619_297_000 },
    { agency: 'Metropolitan Manila Development Authority', dept_short: 'MMDA', php: 1_095_489_000 },
    { agency: 'DOF, Bureau of Local Government Finance', dept_short: 'DOF', php: 777_681_000 },
    { agency: 'Civil Service Commission', dept_short: 'CSC', php: 676_667_000 },
    { agency: 'DEPDev, Public-Private Partnership Center', dept_short: 'DEPDev', php: 509_460_000 },
    { agency: 'DepEd, Office of the Secretary', dept_short: 'DepEd', php: 475_139_000 },
    { agency: 'Philippine Competition Commission', dept_short: 'OEO', php: 165_092_000 },
  ],
  /** FY2025: releases from the purpose "For Government Counterpart of Foreign-Assisted Projects". */
  counterpart_releases_2025_php: 10_453_558_000,
  /** The FY2027 bill's own ranking of the purposes (Special Provision No. 1, Volume I-B page 607). */
  priority_quote:
    'Nevertheless, prioritization of funding of the purposes under the Unprogrammed Appropriations may be as follows, ' +
    'presented from top priority: (a) Not requiring excess/new revenue collections: (i) Support to Foreign-Assisted Projects; ' +
    'and (ii) Conversion of National Government Advances into Subsidy for GOCCs; (b) Requiring excess/new revenue collections: ' +
    '(i) Program on Risk Management; and (ii) Restoration of the Fund Balances of the Philippine Deposit Insurance Corporation.',
  vol_ib_page: 607,
  nep_vol_iii_page: 961,
} as const;

export const UNPROGRAMMED_RELEASES_2025_PHP = UNPROGRAMMED.releases_2025.reduce((a, r) => a + r.php, 0);

/** The reference reading this page follows and checks against. */
export const PBC_FAP_SECTION = {
  by: 'People’s Budget Coalition',
  title: 'The FY 2027 House General Appropriations Bill: An Assessment',
  section: '2.3.1 Foreign-assisted projects',
  url: 'https://ajamontesa.github.io/ph-budget-analysis/hgab-2027-assessment.html#231_Foreign-assisted_projects',
} as const;

// ---------------------------------------------------------------------------
// Helpers shared by the page, the builder and the verifier
// ---------------------------------------------------------------------------

export const FAP_CSV_COLUMNS = [
  'department', 'dept_code', 'agency', 'project', 'lenders', 'status', 'nep_php', 'house_bill_php', 'change_php',
  'loan_nep_php', 'loan_house_bill_php', 'gop_nep_php', 'gop_house_bill_php', 'nep_pap_codes', 'house_bill_volume', 'house_bill_pdf_page',
] as const;

/** Short department names for the tables, by DBM code. */
export const DEPT_SHORT: Record<string, string> = {
  '04': 'DAR', '05': 'DA', '07': 'DepEd', '13': 'DOH', '16': 'DOLE', '18': 'DPWH', '20': 'DSWD', '22': 'DTI', '24': 'DEPDev',
  '26': 'OEOs', '30': 'CSC', '35': 'BSGC', '37': 'DICT', '38': 'DOTr',
};

/** Lender names as the page shows them, from the NEP's fund names. */
export const LENDER_SHORT: Record<string, string> = {
  'Asian Development Bank': 'ADB',
  'Japan': 'Japan (JICA)',
  'International Bank for Reconstruction and Development (IBRD)': 'World Bank (IBRD)',
  'Korea': 'Korea (EDCF)',
  'International Fund for Agricultural Development (IFAD)': 'IFAD',
  'Asian Infrastructure Investment Bank (AIIB)': 'AIIB',
  'China': 'China',
  'France': 'France',
  'United States': 'United States',
};

export function fapStatus(nep: number | null, house: number | null): FapStatus {
  const n = nep ?? 0;
  const h = house ?? 0;
  if (n === 0 && h > 0) return 'new';
  if (h < n) return 'cut';
  if (h > n) return 'raised';
  return 'same';
}

/** "/hgab/2027/explorer/<dept>?q=<title>": the project in the line-by-line explorer. */
export function fapExplorerHref(p: Pick<FapProject, 'dept_slug' | 'title'>): string | null {
  if (!p.dept_slug) return null;
  return `/hgab/2027/explorer/${p.dept_slug}?q=${encodeURIComponent(p.title.slice(0, 60))}`;
}

/** The year's cut from NEP to enacted budget, as a share of the NEP (null without both figures). */
export function cutShare(y: Pick<FapYear, 'proposed' | 'program'>): number | null {
  if (!y.proposed || !y.program || y.proposed.total === 0) return null;
  return (y.proposed.total - y.program.total) / y.proposed.total;
}

export function sumParts(p: FapParts): number {
  return p.gop + p.loan + p.grant;
}
