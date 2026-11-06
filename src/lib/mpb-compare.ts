/**
 * Budgets side by side: the figures, and every line as a dot on maps drawn the same way. One page per topic
 * (`CompareTopic`):
 *   - multi-purpose buildings (`/hgab/2027/multi-purpose/nep-vs-house-bill`): the 2027 NEP and the House bill, two maps;
 *   - flood control (`/hgab/2027/flood-control`, "Flood control projects are back"): the 2025 and 2026 budgets and 2027,
 *     three maps; the 2027 map holds the NEP and the House bill together, told apart by colour.
 *
 * Jason (2026-11-05): "a different page side by side comparison of 2027's NEP vs HGAB for multi-purpose buildings …
 * more points visible in the philippines to demonstrate the density and intensity of the changes … numbers visible
 * … take a screenshot of the section for publishing. Poster can follow after." Then: "grab the flood control
 * projects. With our title 'Flood control projects are back'", and "the proper comparison is 2025, 2026, and 2027. For
 * 2027 combine both nep and gab but with just different colours".
 *
 * Data: lines in the multi-purpose map's format, and the province outlines (geo/provinces.json). Multi-purpose
 * buildings: the map's own lines (mpb-years/lines.json). Flood control: the chart's flood control lines, placed the same
 * way (flood-compare/lines.json, `npm run build:hgab-flood-compare`). Every figure here is computed from them; the
 * verifier checks the totals against each build's summary. Pure, apart from `drawCompareMap`, which only needs a 2D
 * canvas context, so the poster can draw the same maps.
 *
 * Dots: one per line, never grouped. A line sits at its first GPS point, else at the centre of the place its title
 * names (or its office's area). Lines at the same spot fan out in a sunflower so each stays visible; dot area follows
 * the line's amount. A budget's own map is all blue. The House bill map, and flood control's 2027 map (Jason,
 * 2026-11-05: "can the existing ones be blue while the added ones are red, the ones not existing as yellow"), shows the
 * House bill's lines the NEP has too in blue, the added ones in red, and the NEP's lines it does not have in yellow,
 * where they were (not part of its total).
 *
 * The figure compares totals only (Jason, 2026-11-05: "we don't need the in the nep only but let's just compare the
 * totals for both"): no breakdown into lines in both, in one document only.
 */
import type { CongressSeatsFile } from './hgab-congress-seats';
import { COMPARE_CARD_DISCLAIMER, PARTY_CARD_DISCLAIMER } from './hgab-disclaimers';
import { partyName } from './hgab-parties';
import type { MpbClass, MpbData, MpbLine, MpbSummary } from './hgab-mpb-years';
import type { HgabGeo, RegionKey } from './hgab';

export const MPB_COMPARE_ROOT = '/hgab/2027/multi-purpose/nep-vs-house-bill';
export const MPB_COMPARE_TITLE = 'Multi-purpose buildings: NEP vs House bill';
export const FLOOD_COMPARE_ROOT = '/hgab/2027/flood-control';
export const FLOOD_COMPARE_TITLE = 'Flood control, 2025 to 2027';

export type CompareClass = Exclude<MpbClass, null>;
export type BudgetKey = 'gaa-2025' | 'gaa-2026' | 'nep-2027' | 'house-2027';
export const BUDGET_KEYS: readonly BudgetKey[] = ['gaa-2025', 'gaa-2026', 'nep-2027', 'house-2027'];
export const BUDGET_LABELS: Record<BudgetKey, string> = {
  'gaa-2025': '2025', 'gaa-2026': '2026', 'nep-2027': '2027 NEP', 'house-2027': '2027 House bill',
};
/**
 * A map: one budget's lines (`nep`, `gaa-2025`, `gaa-2026`), or the House bill's with the NEP lines it lacks
 * (`house` on the multi-purpose page, `fy2027` on flood control's: the same dots, named for what the map shows).
 */
export type PanelKey = 'nep' | 'house' | 'gaa-2025' | 'gaa-2026' | 'fy2027';
export type CompareTopicKey = 'mpb' | 'flood';

/** One comparison page: its address, its maps and budgets, its words, and the legend's dot sizes. */
export interface CompareTopic {
  key: CompareTopicKey;
  root: string;
  title: string;
  /** The large title's first line: the subject (Jason, 2026-11-05: "we forgot to put 'Multi Purpose Buildings' … as part of the large title"). */
  subject: string;
  /** What a line is, plural: "multi-purpose building lines". */
  lineWords: string;
  /** The maps, left to right. */
  panels: PanelKey[];
  /** The budgets compared, oldest first (the region table's columns). */
  budgets: BudgetKey[];
  /** The source line. */
  source: string;
  /** One sentence on what the topic covers, for the notes; empty when the subject says it. */
  scope: string;
  /** The page's address, printed on the figure. */
  url: string;
  imageName: string;
  /** The legend's dot sizes (the radius scale is the same for every topic, so the pages compare). */
  sizes: number[];
  /** The region-by-year matrix's own title and downloadable image (Jason, 2026-11-06: "a shareable version"). */
  matrixTitle: string;
  matrixImageName: string;
  /** The party-by-year grid's (Jason, 2026-11-06: "map the charts based on their political party for that year"). */
  partyTitle: string;
  partyImageName: string;
}

export const COMPARE_TOPICS: Record<CompareTopicKey, CompareTopic> = {
  mpb: {
    key: 'mpb', root: MPB_COMPARE_ROOT, title: MPB_COMPARE_TITLE, subject: 'Multi-purpose buildings',
    lineWords: 'multi-purpose building lines', panels: ['nep', 'house'], budgets: ['nep-2027', 'house-2027'],
    source: 'Source: NEP 2027 (DBM) and House Bill 10858, third reading; DPWH multi-purpose building lines', scope: '',
    url: 'budget.bettergov.ph/hgab/2027/multi-purpose/nep-vs-house-bill',
    imageName: 'bettergov-multi-purpose-buildings-2027-nep-vs-house-bill.png', sizes: [5e6, 25e6, 100e6],
    matrixTitle: 'Multi-purpose buildings by region and year',
    matrixImageName: 'bettergov-multi-purpose-buildings-by-region-2015-2027.png',
    partyTitle: 'Multi-purpose buildings by party and year',
    partyImageName: 'bettergov-multi-purpose-buildings-by-party-2015-2027.png',
  },
  flood: {
    // Jason, 2026-11-05: "With our title 'Flood control projects are back'".
    key: 'flood', root: FLOOD_COMPARE_ROOT, title: FLOOD_COMPARE_TITLE, subject: 'Flood control projects are back',
    lineWords: 'flood control lines', panels: ['gaa-2025', 'gaa-2026', 'fy2027'], budgets: [...BUDGET_KEYS],
    source: 'Source: GAA 2025 and 2026, NEP 2027 (DBM), House Bill 10858, third reading; DPWH flood control lines',
    scope: 'Flood control here is the DPWH Flood Management Program, with BIP and SIPAG flood mitigation in 2025, as on our budget-by-year chart.',
    url: 'budget.bettergov.ph/hgab/2027/flood-control',
    imageName: 'bettergov-flood-control-2025-2027.png', sizes: [10e6, 50e6, 250e6],
    matrixTitle: 'Flood control by region and year',
    matrixImageName: 'bettergov-flood-control-by-region-2015-2027.png',
    partyTitle: 'Flood control by party and year',
    partyImageName: 'bettergov-flood-control-by-party-2015-2027.png',
  },
};

/**
 * What a page draws from: the lines, when they were built, the province outlines, the budgets paid for wholly with
 * foreign loans or grants, the region-by-year matrix, and (flood control) how each budget's lines were grouped.
 */
export interface CompareInput {
  data: MpbData; builtAt: string; geo: HgabGeo; foreignOnly: BudgetKey[]; matrix: RegionYearMatrix; about: AboutData;
  /** The party-by-year matrix: each budget by the party of its district's representative in the Congress that passed it. */
  parties: PartyYearMatrix;
}

/**
 * "About this data" (Jason, 2026-11-06: for flood control, "a description how we grouped them, what fields and caveats";
 * then "Let's do the same for MPBs"): how each budget's lines were grouped, the CSV's fields and where to download it.
 */
export interface AboutData {
  scope: ScopeRow[];
  /** The last column's heading: what each budget leaves out (flood control: flood words under other codes). */
  leftOutLabel: string;
  fields: ReadonlyArray<{ name: string; about: string }>;
  csvUrl: string;
  csvBytes: number;
  csvName: string;
  /** Flood control: the words that mark a flood control work in a title. */
  floodWords: string | null;
}

/**
 * How one budget's lines were grouped: the source, each family of lines counted, what the total is checked against, and
 * what the budget leaves out. Flood control's come from its build (`flood_titled_elsewhere`, the lines with flood words in
 * their titles under other codes); multi-purpose buildings' from the map's summary (`mpbScope`, the items listed at ₱0).
 */
export interface ScopeRow {
  key: string; fy: number; stage: 'gaa' | 'nep' | 'house';
  source: string;
  parts: Array<{ label: string; lines: number; php: number }>;
  lines: number; php: number;
  /** The chart by year's figure (FY2020 on), or null. */
  chart_php: number | null;
  /** chart: the total is the chart's; chart_budget_lines: the budget-line part is (multi-purpose buildings). */
  check: 'chart' | 'chart_budget_lines' | 'printed_headings' | null;
  flood_titled_elsewhere?: Tally;
  left_out?: Tally;
}

/** Where a budget's lines come from, in plain words (the flood control build writes the same). */
export function budgetSource(fy: number, stage: 'gaa' | 'nep' | 'house'): string {
  if (stage === 'nep') return 'NEP 2027 (DBM), as the source workbench reads it';
  if (stage === 'house') return 'House Bill 10858, third reading, as the source workbench reads it';
  if (fy >= 2020) return 'DBM GAA extract on this site';
  if (fy === 2019) return 'DBM technical GAA for DPWH, read from the document’s text';
  return `DBM technical GAA ${fy === 2015 ? 'CSV' : 'spreadsheet'}, from the GAA history release`;
}

const MPB_TITLE_PART = 'Lines under other headings whose titles name a multi-purpose building';
/** A multi-purpose building budget line's heading, short. */
function mpbPart(pap: string): string {
  if (/\bBIP\b|Basic Infrastructure/i.test(pap)) return 'BIP multi-purpose buildings';
  if (/SIPAG|Sustainable Infrastructure/i.test(pap)) return 'SIPAG multi-purpose buildings';
  if (/MULTI-?PURPOSE/i.test(pap)) return 'Local Program multi-purpose buildings and facilities';
  return pap;
}

/** Multi-purpose buildings' grouping, from the map's lines and summary: budget lines by heading, then lines in by title. */
export function mpbScope(data: MpbData, s: MpbSummary): ScopeRow[] {
  return s.budgets.map((b) => {
    const parts = new Map<string, Tally>();
    for (const l of data.lines) {
      if (l.fy !== b.fy) continue;
      const v = b.stage === 'gaa' ? l.gaa : b.stage === 'nep' ? l.nep : l.house;
      if (v == null) continue;
      const label = l.rule === 'title' ? MPB_TITLE_PART : mpbPart(l.pap);
      const t = parts.get(label) ?? { lines: 0, php: 0 };
      t.lines++; t.php += v;
      parts.set(label, t);
    }
    const order = (label: string) => (label === MPB_TITLE_PART ? 1 : 0);
    return {
      key: b.key, fy: b.fy, stage: b.stage, source: budgetSource(b.fy, b.stage),
      parts: [...parts].sort((x, y) => order(x[0]) - order(y[0]) || y[1].php - x[1].php).map(([label, t]) => ({ label, ...t })),
      lines: b.lines, php: b.php, chart_php: b.history_php,
      check: b.history_php != null ? 'chart_budget_lines' : b.fy === 2019 ? 'printed_headings' : null,
      left_out: { lines: b.listed_at_zero, php: 0 },
    };
  });
}

export const FLOOD_CSV_PATH = 'hgab/2027/flood-compare/lines.csv';
export const FLOOD_CSV_NAME = 'bettergov-flood-control-2015-2027.csv';

/** lines.csv, column by column (the build's CSV_COLUMNS, in order; verify:hgab checks the header). */
export const FLOOD_CSV_FIELDS: ReadonlyArray<{ name: string; about: string }> = [
  { name: 'fiscal_year', about: 'The budget year.' },
  { name: 'document', about: 'GAA, the enacted budget; for 2027, the NEP and the House bill.' },
  { name: 'line_id', about: 'The line’s code: its UACS code in a GAA, the comparison row in 2027.' },
  { name: 'uacs_code', about: 'The UACS code the GAA prints (GAA lines only).' },
  { name: 'title', about: 'The line’s title, with spacing and garbled characters cleaned.' },
  { name: 'title_as_published', about: 'The title as printed, when cleaning changed it.' },
  { name: 'program', about: 'The heading the line sits under; for 2015 to 2017, the former flood code it carries.' },
  { name: 'dpwh_office', about: 'The DPWH office that carries the line, as the budget lists it.' },
  { name: 'gaa_php', about: 'The amount in the enacted budget, in pesos (2015 to 2026).' },
  { name: 'nep_php', about: 'The amount in the 2027 NEP, in pesos.' },
  { name: 'house_bill_php', about: 'The amount in the House bill, in pesos.' },
  { name: 'fy2027_comparison', about: 'in_both, house_bill_only or nep_only: a match between the two documents, a candidate, not a confirmed change.' },
  { name: 'region', about: 'The region its title or office places it in; blank when none.' },
  { name: 'placed_by', about: 'What placed it: GPS in the title, the barangay, town, city or province it names, the DPWH office, or the region.' },
  { name: 'place', about: 'The place it sits at.' },
  { name: 'place_psgc', about: 'The place’s PSGC code, when it is a named place.' },
  { name: 'longitude', about: 'Where it is drawn: the GPS point, else the place’s centre.' },
  { name: 'latitude', about: 'As longitude.' },
  { name: 'legislative_district', about: 'Today’s legislative district its place lies in, or its office serves alone.' },
  { name: 'legislative_district_id', about: 'The same district’s id on this site.' },
  { name: 'flags', about: 'Notes on the reading, such as text_repaired, gps_not_drawn or office_elsewhere.' },
  { name: 'nep_pdf_page', about: 'The page of the published NEP the line is printed on (2027).' },
  { name: 'house_bill_pdf_page', about: 'The page of the published House bill the line is printed on (2027).' },
];

// ---------------------------------------------------------------------------
// The region-by-year matrix (Jason, 2026-11-06: "I want a matrix of the MPBs per region and per year. I want the same
// for flood control as well")
// ---------------------------------------------------------------------------

/**
 * A budget column. `note`: `title_only`, the budget has no line for the topic, so its lines are in by title (multi-purpose
 * buildings, FY2015–FY2017); `former_codes`, the budget's older code set (flood control, FY2015–FY2017).
 */
export interface MatrixBudget { key: string; fy: number; stage: 'gaa' | 'nep' | 'house'; note?: 'title_only' | 'former_codes' }
/** Each region's lines and amount in every budget (a region null: no region), and each budget's total. */
export interface RegionYearMatrix {
  budgets: MatrixBudget[];
  rows: Array<{ region: RegionKey | null; cells: Tally[] }>;
  totals: Tally[];
}

/** "2024", "2027 NEP", "2027 House bill". */
export const matrixLabel = (b: MatrixBudget) => (b.stage === 'gaa' ? `${b.fy}` : `${b.fy} ${b.stage === 'nep' ? 'NEP' : 'House bill'}`);

/** The matrix of a set of lines (multi-purpose buildings: the map's lines, every budget it holds). */
export function linesMatrix(data: MpbData, budgets: readonly MatrixBudget[]): RegionYearMatrix {
  const t = (): Tally => ({ lines: 0, php: 0 });
  const by = new Map<RegionKey | null, Tally[]>();
  const totals = budgets.map(t);
  for (const l of data.lines) {
    budgets.forEach((b, i) => {
      if (l.fy !== b.fy) return;
      const v = b.stage === 'gaa' ? l.gaa : b.stage === 'nep' ? l.nep : l.house;
      if (v == null) return;
      const cells = by.get(l.region) ?? budgets.map(t);
      for (const c of [cells[i], totals[i]]) { c.lines++; c.php += v; }
      by.set(l.region, cells);
    });
  }
  return { budgets: [...budgets], rows: [...by].map(([region, cells]) => ({ region, cells })), totals };
}

/**
 * A cell's colour at `t` (0–1, the square root of its share of the largest cell): light green through soft amber to red
 * (Jason, 2026-11-06: "Let's use a light green to red tone for the grid colours"). Three stops, so the middle stays clear
 * rather than a muddy brown.
 */
export const HEAT_STOPS: ReadonlyArray<[number, [number, number, number]]> = [[0, [223, 243, 224]], [0.5, [252, 226, 154]], [1, [214, 40, 40]]];
export function heatColor(t: number): string {
  const x = Math.min(1, Math.max(0, t));
  const i = x <= HEAT_STOPS[1][0] ? 0 : 1;
  const [[t0, c0], [t1, c1]] = [HEAT_STOPS[i], HEAT_STOPS[i + 1]];
  const k = (x - t0) / (t1 - t0);
  return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(', ')})`;
}

/** "₱4.2B", "₱512M", "₱0.4M": short enough for a cell. */
export const phpCell = (v: number) => (v >= 1e9 ? `₱${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `₱${Math.round(v / 1e6)}M` : `₱${(v / 1e6).toFixed(1)}M`);

/** The matrix's words: one builder for the page's table and its downloadable image, so they never differ. */
export interface MatrixCopy {
  kicker: string;
  title: string;
  dek: string;
  /** The footnotes, in order: what the columns are, the starred columns, where lines sit, amounts. */
  notes: string[];
  disclaimer: string;
  source: [string, string];
}

/** The footnote for the starred columns ("* The 2015 to 2017 budgets …"), or none. */
function starNote(budgets: readonly MatrixBudget[]): string[] {
  const marked = budgets.filter((b) => b.note);
  if (!marked.length) return [];
  const span = `${marked[0].fy} to ${marked[marked.length - 1].fy}`;
  return [marked[0].note === 'former_codes'
    ? `* The ${span} budgets use an older code set; their flood control lines are its flood families.`
    : `* The ${span} budgets have no multi-purpose building line, so their lines are counted by title.`];
}

export function matrixCopy(topic: CompareTopic, m: RegionYearMatrix, builtAt: string): MatrixCopy {
  const first = m.budgets[0];
  const what = topic.key === 'flood' ? 'flood control' : 'multi-purpose building';
  return {
    kicker: `DPWH · ${matrixLabel(first)}${first.stage === 'gaa' ? ' GAA' : ''} to the 2027 House bill`,
    title: topic.matrixTitle,
    dek: `Every ${what} line, ${matrixLabel(first)}${first.stage === 'gaa' ? ' GAA' : ''} to the 2027 House bill, by the region its title or office places it in. Cells run from light green (less) to red (more).`,
    notes: [
      'The 2027 columns are the NEP and the House bill, not yet law; the rest are enacted budgets.',
      ...starNote(m.budgets),
      ...(topic.key === 'flood'
        ? ['Head-office lines that name no place count in the region the budget lists them under, mostly Metro Manila, or under No region where the file lists none.']
        : []),
      'Amounts are allocations, not spending.',
    ],
    disclaimer: COMPARE_CARD_DISCLAIMER,
    source: [
      `Source: GAA ${first.fy}–2026 (DBM), NEP 2027 (DBM), House Bill 10858, third reading; DPWH ${what} lines`,
      `${topic.url} · As of ${asOfDate(builtAt)}`,
    ],
  };
}

// ---------------------------------------------------------------------------
// A table either grid draws (page and image): rows with labels, cells, a total row, optional column groups
// ---------------------------------------------------------------------------

export interface GridRow {
  key: string;
  /** "NCR", "Lakas–CMD", "Not in one district". */
  short: string;
  /** Shown after the short label, quieter: "Metro Manila", "Nationalist People’s Coalition". */
  name: string | null;
  cells: Tally[];
  /** Shaded green to red (false: rows that carry no region or party, shown plain). */
  heat: boolean;
  /** Each cell's hover text. */
  titles: string[];
}
export interface GridSpec {
  budgets: MatrixBudget[];
  /** Column groups over the years (the party grid: each Congress). */
  groups: Array<{ label: string; span: number }> | null;
  headLabel: string;
  rows: GridRow[];
  totals: Tally[];
  totalLabel: string;
}

const lineCount = (c: Tally) => `${c.lines.toLocaleString('en-US')} ${c.lines === 1 ? 'line' : 'lines'}`;

// ---------------------------------------------------------------------------
// The party-by-year matrix (Jason, 2026-11-06: "map the charts based on their political party for that year"; a budget
// carries the party of the district's representative in the Congress that passed it; a district whose towns changed
// since that election is kept apart)
// ---------------------------------------------------------------------------

/** Each legislative district's lines and amount in every budget (district null: the line sits in no single district). */
export interface DistrictYearMatrix { budgets: MatrixBudget[]; rows: Array<{ district: string | null; cells: Tally[] }>; totals: Tally[] }

/** The district matrix of a set of lines (multi-purpose buildings: the map's lines). */
export function linesDistrictMatrix(data: MpbData, budgets: readonly MatrixBudget[]): DistrictYearMatrix {
  const t = (): Tally => ({ lines: 0, php: 0 });
  const by = new Map<string | null, Tally[]>();
  const totals = budgets.map(t);
  for (const l of data.lines) {
    budgets.forEach((b, i) => {
      if (l.fy !== b.fy) return;
      const v = b.stage === 'gaa' ? l.gaa : b.stage === 'nep' ? l.nep : l.house;
      if (v == null) return;
      const d = l.district >= 0 ? data.districts[l.district].id : null;
      const cells = by.get(d) ?? budgets.map(t);
      for (const c of [cells[i], totals[i]]) { c.lines++; c.php += v; }
      by.set(d, cells);
    });
  }
  return { budgets: [...budgets], rows: [...by].map(([district, cells]) => ({ district, cells })), totals };
}

/** Flood control's district matrix, as its build writes it (the same budgets as its region matrix). */
export function floodDistrictMatrix(s: FloodCompareSummary): DistrictYearMatrix {
  const tally = ([lines, php]: [number, number]): Tally => ({ lines, php });
  return {
    budgets: s.matrix.budgets,
    rows: s.district_matrix.rows.map((r) => ({ district: r.district, cells: r.cells.map(tally) })),
    totals: s.matrix.totals.map(tally),
  };
}

/** Where a line's budget goes: a party, or one of the rows that carry none. */
export type PartyRowKind = 'party' | 'changed' | 'absent' | 'no_party' | 'no_district';
export interface PartyRow {
  key: string; kind: PartyRowKind; party: string | null; cells: Tally[];
  /** Party rows: the districts its members held in that Congress (towns unchanged), per budget. */
  held: number[];
}
export interface PartyYearMatrix {
  budgets: MatrixBudget[];
  /** Each budget's Congress, in column order. */
  terms: Array<{ label: string; congress: number; year: number }>;
  rows: PartyRow[];
  totals: Tally[];
}

export function partyMatrix(dm: DistrictYearMatrix, seats: CongressSeatsFile): PartyYearMatrix {
  const termOf = dm.budgets.map((b) => seats.terms.find((t) => t.budget_years.includes(b.fy)) ?? null);
  const rows = new Map<string, PartyRow>();
  const row = (kind: PartyRowKind, party: string | null) => {
    const key = kind === 'party' ? party! : `·${kind}`;
    if (!rows.has(key)) rows.set(key, { key, kind, party, cells: dm.budgets.map(() => ({ lines: 0, php: 0 })), held: dm.budgets.map(() => 0) });
    return rows.get(key)!;
  };
  for (const r of dm.rows) {
    r.cells.forEach((c, i) => {
      if (!c.lines) return;
      const s = r.district != null ? termOf[i]?.seats[r.district] : undefined;
      const kind: PartyRowKind = r.district == null ? 'no_district' : !s ? 'absent' : s[2] === 'changed' ? 'changed' : !s[0] ? 'no_party' : 'party';
      const target = row(kind, kind === 'party' ? s![0] : null).cells[i];
      target.lines += c.lines; target.php += c.php;
    });
  }
  for (const r of rows.values()) {
    if (r.kind !== 'party') continue;
    r.held = termOf.map((t) => (t ? Object.values(t.seats).filter((s) => s[2] === 'same' && s[0] === r.party).length : 0));
  }
  return {
    budgets: [...dm.budgets],
    terms: termOf.map((t) => ({ label: t?.label ?? '', congress: t?.congress ?? 0, year: t?.year ?? 0 })),
    rows: [...rows.values()],
    totals: dm.totals,
  };
}

const PARTY_SPECIAL: Record<Exclude<PartyRowKind, 'party'>, { short: string; name: string | null }> = {
  changed: { short: 'District’s towns changed', name: 'since that election' },
  absent: { short: 'No race on record', name: 'a district created since, or not in the results' },
  no_party: { short: 'No party on record', name: null },
  no_district: { short: 'Not in one district', name: 'shared offices, head office, no place named' },
};

/** A party's label: its name when short ("Lakas–CMD", "Liberal Party"), else its code with the name after it. */
export function partyLabel(code: string): { short: string; name: string | null } {
  const name = partyName(code);
  return name.length <= 18 || name === code ? { short: name, name: null } : { short: code, name };
}

/**
 * The party grid as drawn: parties by their total over every budget, largest first; those under `foldBelow` of the
 * party total folded into "Other parties"; then the rows that carry no party; the Congress over each run of years.
 */
export function partyGrid(m: PartyYearMatrix, foldBelow = 0.01): { spec: GridSpec; folded: string[] } {
  const total = (r: PartyRow) => r.cells.reduce((a, c) => a + c.php, 0);
  const parties = m.rows.filter((r) => r.kind === 'party').sort((a, b) => total(b) - total(a) || a.key.localeCompare(b.key));
  const all = parties.reduce((a, r) => a + total(r), 0);
  const kept = parties.filter((r) => total(r) >= all * foldBelow);
  const small = parties.filter((r) => total(r) < all * foldBelow);
  const titles = (r: PartyRow) => r.cells.map((c, i) => (c.lines
    ? `${lineCount(c)}, ${phpWords(c.php)}${r.kind === 'party' ? `; ${r.held[i]} ${r.held[i] === 1 ? 'district' : 'districts'} held` : ''}`
    : r.kind === 'party' && r.held[i] ? `No line; ${r.held[i]} ${r.held[i] === 1 ? 'district' : 'districts'} held` : 'No line'));
  const rows: GridRow[] = kept.map((r) => ({ key: r.key, ...partyLabel(r.key), cells: r.cells, heat: true, titles: titles(r) }));
  if (small.length) {
    const cells = m.budgets.map((_, i) => small.reduce((a, r) => ({ lines: a.lines + r.cells[i].lines, php: a.php + r.cells[i].php }), { lines: 0, php: 0 }));
    rows.push({ key: '·other', short: 'Other parties', name: `${small.length} smaller parties`, cells, heat: true,
      titles: cells.map((c) => (c.lines ? `${lineCount(c)}, ${phpWords(c.php)}` : 'No line')) });
  }
  for (const kind of ['changed', 'absent', 'no_party', 'no_district'] as const) {
    const r = m.rows.find((x) => x.kind === kind);
    if (r && total(r) > 0) rows.push({ key: r.key, short: PARTY_SPECIAL[kind].short, name: PARTY_SPECIAL[kind].name, cells: r.cells, heat: false, titles: titles(r) });
  }
  const groups: Array<{ label: string; span: number }> = [];
  for (const t of m.terms) {
    const last = groups[groups.length - 1];
    if (last && last.label === t.label) last.span++;
    else groups.push({ label: t.label, span: 1 });
  }
  return {
    spec: { budgets: m.budgets, groups, headLabel: 'Party', rows, totals: m.totals, totalLabel: 'All' },
    folded: small.map((r) => r.key),
  };
}

/** The party grid's words (page and image). */
export function partyCopy(topic: CompareTopic, m: PartyYearMatrix, builtAt: string, folded: readonly string[]): MatrixCopy {
  const first = m.budgets[0];
  const what = topic.key === 'flood' ? 'flood control' : 'multi-purpose building';
  // "2013 (2015–2016), 2016 (2017–2019), …": each Congress's election and the budget years it passed.
  const runs: Array<{ year: number; from: number; to: number }> = [];
  m.budgets.forEach((b, i) => {
    const last = runs[runs.length - 1];
    if (last && last.year === m.terms[i].year) last.to = b.fy;
    else runs.push({ year: m.terms[i].year, from: b.fy, to: b.fy });
  });
  const elected = runs.map((r) => `${r.year} (${r.from === r.to ? r.from : `${r.from}–${r.to}`})`).join(', ');
  return {
    kicker: `DPWH · ${matrixLabel(first)}${first.stage === 'gaa' ? ' GAA' : ''} to the 2027 House bill`,
    title: topic.partyTitle,
    dek: `Every ${what} line, ${matrixLabel(first)}${first.stage === 'gaa' ? ' GAA' : ''} to the 2027 House bill, by the party of its district’s representative in the Congress that passed the budget. Cells run from light green (less) to red (more).`,
    notes: [
      `Each budget carries the Congress that passed it, elected in ${elected}.`,
      'The party is the one the district’s representative ran under; switches during a term are not captured.',
      'A party’s total grows with the number of districts it held.',
      'Lines not placed in one district, and districts whose towns changed since that election, carry no party.',
      'The 2013 results list some races only as a total, so those districts show as No race on record.',
      ...(folded.length ? [`Other parties: ${folded.length} smaller parties, each under 1% of the total.`] : []),
      'The 2027 columns are the NEP and the House bill, not yet law; the rest are enacted budgets.',
      ...starNote(m.budgets),
      'Amounts are allocations, not spending.',
    ],
    disclaimer: PARTY_CARD_DISCLAIMER,
    source: [
      `Source: GAA ${first.fy}–2026, NEP 2027 (DBM), House Bill 10858; election results: Open Halalan, via BetterGov Dynasties`,
      `${topic.url} · As of ${asOfDate(builtAt)}`,
    ],
  };
}

/** Flood control's matrix, as its build writes it (every GAA year from FY2015, more than the maps draw). */
export function floodMatrix(s: FloodCompareSummary): RegionYearMatrix {
  const tally = ([lines, php]: [number, number]): Tally => ({ lines, php });
  return {
    budgets: s.matrix.budgets,
    rows: s.matrix.rows.map((r) => ({ region: r.region, cells: r.cells.map(tally) })),
    totals: s.matrix.totals.map(tally),
  };
}

export const FLOOD_LINES_PATH = 'hgab/2027/flood-compare/lines.json';
export const FLOOD_SUMMARY_PATH = 'hgab/2027/flood-compare/summary.json';

/** flood-compare/summary.json (scripts/hgab-flood-compare/build.py). */
export interface FloodCompareSummary {
  schema: 1;
  built_at: string;
  program: string;
  budgets: Array<{
    key: BudgetKey; fy: number; stage: 'gaa' | 'nep' | 'house'; lines: number; php: number;
    /** The flood control series on the chart by year (history.json); equals `php`. */
    history_php: number;
    /** The chart's foreign-assisted part (paid with foreign loans or grants). */
    foreign_php: number | null;
    levels: Record<string, number>;
    /** Lines with no place on the map: counted, not drawn. */
    not_drawn: Tally;
    classes: Record<string, number>;
  }>;
  /** How each budget's lines were grouped, FY2015 GAA to the House bill. */
  scope: ScopeRow[];
  /** The words that mark a flood control work in a title (the lines left out, under other codes). */
  flood_words: string;
  outputs: Record<'lines.json' | 'lines.csv', { sha256: string; bytes: number }>;
  /** Each region's [lines, pesos] in every budget, FY2015 GAA to the House bill, and each budget's total (= the chart from FY2020). */
  matrix: {
    budgets: MatrixBudget[];
    rows: Array<{ region: RegionKey | null; cells: Array<[number, number]> }>;
    totals: Array<[number, number]>;
  };
  /** Each legislative district's [lines, pesos] in the matrix's budgets (district null: no single district). */
  district_matrix: { rows: Array<{ district: string | null; cells: Array<[number, number]> }> };
  /** GAA head-office lines the title matcher cannot read: placed by the one province named, or at the listed region. */
  head_office: Record<string, { province_named: number; listed_region: number }>;
  /** FY2027 lines budgeted nationwide: counted, not on the map. */
  nationwide: { lines: number; nep_php: number; house_php: number };
  checks: Array<{ key: string; ok: boolean; detail: string }>;
}

/** The budgets the chart says were paid for wholly with foreign loans or grants (FY2026's flood control). */
export function foreignOnlyBudgets(s: FloodCompareSummary): BudgetKey[] {
  return s.budgets.filter((b) => b.php > 0 && b.foreign_php === b.php).map((b) => b.key);
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

export interface Tally { lines: number; php: number }

export interface CompareFigures {
  /** Every budget's lines and amount (a budget the data does not hold is zero). */
  budgets: Record<BudgetKey, Tally>;
  /** The lines of each budget with no place on the map: counted, not drawn. */
  undrawn: Record<BudgetKey, Tally>;
  nep: Tally;
  house: Tally;
  houseOnly: Tally;
  nepOnly: Tally;
  /** Lines in both: their NEP and House bill amounts, and how many are higher, lower or the same in the House bill. */
  paired: { lines: number; nep_php: number; house_php: number; higher: number; lower: number; same: number };
  /** FY2027 lines with no place on the map: budgeted nationwide (flood control has a few; multi-purpose buildings none). */
  unmapped: { lines: number; nep_php: number; house_php: number };
}

/** A line's amount in a budget, or null when the budget does not hold it. */
export function budgetAmount(l: MpbLine, key: BudgetKey): number | null {
  switch (key) {
    case 'gaa-2025': return l.fy === 2025 ? l.gaa : null;
    case 'gaa-2026': return l.fy === 2026 ? l.gaa : null;
    case 'nep-2027': return l.fy === 2027 ? l.nep : null;
    case 'house-2027': return l.fy === 2027 ? l.house : null;
  }
}

const lines2027 = (data: MpbData) => data.lines.filter((l) => l.fy === 2027 && l.cls != null);
const tallies = () => Object.fromEntries(BUDGET_KEYS.map((k) => [k, { lines: 0, php: 0 }])) as Record<BudgetKey, Tally>;

export function compareFigures(data: MpbData): CompareFigures {
  const t = (): Tally => ({ lines: 0, php: 0 });
  const f: CompareFigures = {
    budgets: tallies(), undrawn: tallies(), nep: t(), house: t(), houseOnly: t(), nepOnly: t(),
    paired: { lines: 0, nep_php: 0, house_php: 0, higher: 0, lower: 0, same: 0 },
    unmapped: { lines: 0, nep_php: 0, house_php: 0 },
  };
  for (const l of data.lines) {
    if (l.fy !== 2025 && l.fy !== 2026 && l.fy !== 2027) continue;
    const drawn = linePoint(data, l) != null;
    for (const k of BUDGET_KEYS) {
      const v = budgetAmount(l, k);
      if (v == null) continue;
      f.budgets[k].lines++; f.budgets[k].php += v;
      if (!drawn) { f.undrawn[k].lines++; f.undrawn[k].php += v; }
    }
  }
  for (const l of lines2027(data)) {
    if (l.nep != null) { f.nep.lines++; f.nep.php += l.nep; }
    if (l.house != null) { f.house.lines++; f.house.php += l.house; }
    if (l.cls === 'house_only') { f.houseOnly.lines++; f.houseOnly.php += l.house ?? 0; }
    if (l.cls === 'nep_only') { f.nepOnly.lines++; f.nepOnly.php += l.nep ?? 0; }
    if (l.cls === 'paired') {
      const p = f.paired;
      p.lines++; p.nep_php += l.nep ?? 0; p.house_php += l.house ?? 0;
      if ((l.house ?? 0) > (l.nep ?? 0)) p.higher++; else if ((l.house ?? 0) < (l.nep ?? 0)) p.lower++; else p.same++;
    }
    if (!linePoint(data, l)) {
      f.unmapped.lines++; f.unmapped.nep_php += l.nep ?? 0; f.unmapped.house_php += l.house ?? 0;
    }
  }
  return f;
}

export interface RegionRow {
  region: RegionKey | null;
  by: Record<BudgetKey, Tally>;
}

/** The totals by region (a line's region; null where none) for the budgets given, largest in the last budget first. */
export function compareByRegion(data: MpbData, budgets: readonly BudgetKey[]): RegionRow[] {
  const by = new Map<RegionKey | null, RegionRow>();
  for (const l of data.lines) {
    for (const k of budgets) {
      const v = budgetAmount(l, k);
      if (v == null) continue;
      const r = by.get(l.region) ?? { region: l.region, by: tallies() };
      r.by[k].lines++; r.by[k].php += v;
      by.set(l.region, r);
    }
  }
  const last = budgets[budgets.length - 1];
  const first = budgets[0];
  return [...by.values()].sort((a, b) => b.by[last].php - a.by[last].php || a.by[first].php - b.by[first].php);
}

// ---------------------------------------------------------------------------
// Dots
// ---------------------------------------------------------------------------

/** A line's spot: its first GPS point, else the centre of its place; null when it has neither. */
export function linePoint(data: MpbData, l: MpbLine): [number, number] | null {
  if (l.pts?.length) return l.pts[0];
  if (l.level !== 'none' && l.place >= 0) {
    const p = data.places[l.place];
    return [p.lng, p.lat];
  }
  return null;
}

export type DotColor = 'blue' | 'red' | 'yellow';
export interface CompareDot { lon: number; lat: number; php: number; color: DotColor }

/** A GAA year's map is one colour: 2025 red (Jason, 2026-11-05: "Make 2025 red themed"), 2026 blue. */
export const GAA_PANEL_COLOR: Record<'gaa-2025' | 'gaa-2026', DotColor> = { 'gaa-2025': 'red', 'gaa-2026': 'blue' };

/**
 * The dots a map draws. A budget's own map: its lines, in one colour (the NEP blue; GAA_PANEL_COLOR). The House bill map (and flood control's 2027 map): the
 * House bill's lines, blue when the NEP has them too and red when added, then the NEP lines it does not have, yellow,
 * at their NEP amount (outside its total).
 */
export function panelDots(data: MpbData, panel: PanelKey): CompareDot[] {
  const out: CompareDot[] = [];
  const push = (l: MpbLine, php: number, color: DotColor) => {
    const at = linePoint(data, l);
    if (at) out.push({ lon: at[0], lat: at[1], php, color });
  };
  if (panel === 'gaa-2025' || panel === 'gaa-2026') {
    for (const l of data.lines) {
      const v = budgetAmount(l, panel);
      if (v != null) push(l, v, GAA_PANEL_COLOR[panel]);
    }
    return out;
  }
  const fy27 = lines2027(data);
  if (panel === 'nep') {
    for (const l of fy27) if (l.nep != null) push(l, l.nep, 'blue');
    return out;
  }
  for (const l of fy27) if (l.house != null) push(l, l.house, l.cls === 'house_only' ? 'red' : 'blue');
  for (const l of fy27) if (l.cls === 'nep_only' && l.nep != null) push(l, l.nep, 'yellow');
  return out;
}

/** The view: the archipelago, Batanes to Tawi-Tawi (the Kalayaan islands, far west, are counted, not drawn). */
export const COMPARE_VIEW: [number, number, number, number] = [116.75, 4.45, 126.75, 21.2];
const LON_SCALE = Math.cos((12 * Math.PI) / 180);

export interface MapFrame { width: number; height: number; project(lon: number, lat: number): [number, number] }

/** An equirectangular frame `width` pixels wide over COMPARE_VIEW (the site's map projection). */
export function compareFrame(width: number): MapFrame {
  const [x0, y0, x1, y1] = COMPARE_VIEW;
  const k = width / ((x1 - x0) * LON_SCALE);
  return { width, height: Math.round((y1 - y0) * k), project: (lon, lat) => [(lon - x0) * LON_SCALE * k, (y1 - lat) * k] };
}

export const inView = (d: Pick<CompareDot, 'lon' | 'lat'>) =>
  d.lon >= COMPARE_VIEW[0] && d.lon <= COMPARE_VIEW[2] && d.lat >= COMPARE_VIEW[1] && d.lat <= COMPARE_VIEW[3];

/** Dot radius in pixels for an amount, at a frame width (area follows the amount; 600 px wide is the reference). */
export function dotRadius(php: number, width: number): number {
  const s = width / 600;
  return Math.min(9, Math.max(1.4, 1.1 + 0.42 * Math.sqrt(php / 1e6))) * s;
}

/** The frame width the legend's dot sizes are drawn at: the figure's 1200 units shared by its maps. */
export const legendWidth = (panels: number) => 1200 / panels;

export interface PlacedDot extends CompareDot { x: number; y: number; r: number }

/**
 * Pixel positions: dots at the same spot (to half a pixel) fan out in a sunflower, largest at the centre, so a
 * barangay with 30 lines shows 30 dots.
 */
export function placeDots(dots: readonly CompareDot[], frame: MapFrame): PlacedDot[] {
  const spots = new Map<string, CompareDot[]>();
  for (const d of dots) {
    if (!inView(d)) continue;
    const [x, y] = frame.project(d.lon, d.lat);
    const key = `${Math.round(x * 2)}:${Math.round(y * 2)}`;
    spots.set(key, [...(spots.get(key) ?? []), d]);
  }
  const step = (frame.width / 600) * 1.7;
  const out: PlacedDot[] = [];
  for (const group of spots.values()) {
    const sorted = [...group].sort((a, b) => b.php - a.php);
    const [cx, cy] = frame.project(sorted[0].lon, sorted[0].lat);
    sorted.forEach((d, k) => {
      const rr = k === 0 ? 0 : step * Math.sqrt(k);
      const a = k * 2.399963;
      out.push({ ...d, x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a), r: dotRadius(d.php, frame.width) });
    });
  }
  // Largest first, so the small dots stay visible on top.
  return out.sort((a, b) => b.r - a.r);
}

// ---------------------------------------------------------------------------
// Drawing (a 2D canvas: the page, and later the poster)
// ---------------------------------------------------------------------------

export const COMPARE_COLORS = {
  ground: '#0c1322',
  land: '#1a2436',
  border: '#2a3750',
  /** Dots: blue = in the budget (on the House bill map: and in the NEP), red = added in the House bill, yellow = in the NEP, not the House bill. */
  dot: { blue: 'rgba(150, 182, 232, 0.66)', red: 'rgba(255, 64, 64, 0.72)', yellow: 'rgba(255, 204, 64, 0.92)' } as Record<DotColor, string>,
  /** Solid swatches for legends and halos. */
  swatch: { blue: '#96b6e8', red: '#ff4848', yellow: '#ffcc40' } as Record<DotColor, string>,
} as const;

/** Province outlines as Path2D-ready strings in a frame (computed once per width). */
export function provincePaths(geo: HgabGeo, frame: MapFrame): string[] {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return geo.provinces.map((p) => {
    let d = '';
    for (const poly of p.polygons) for (const ring of poly) {
      if (ring.length < 3) continue;
      ring.forEach((pt, i) => {
        const [x, y] = frame.project(pt[0], pt[1]);
        d += `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`;
      });
      d += 'Z';
    }
    return d;
  });
}

/**
 * Draw one map: ground, provinces, then every dot with a small halo, in passes: blue, then red, then yellow on top (the
 * few yellow dots stay visible). Every map is drawn the same way, so their density compares; crowded places build up
 * into solid colour rather than washing out to white.
 */
export function drawCompareMap(
  ctx: CanvasRenderingContext2D, frame: MapFrame, provinces: readonly string[], dots: readonly PlacedDot[],
): void {
  ctx.save();
  ctx.fillStyle = COMPARE_COLORS.ground;
  ctx.fillRect(0, 0, frame.width, frame.height);
  ctx.fillStyle = COMPARE_COLORS.land;
  ctx.strokeStyle = COMPARE_COLORS.border;
  ctx.lineWidth = Math.max(0.5, frame.width / 1200);
  for (const d of provinces) {
    const p = new Path2D(d);
    ctx.fill(p, 'evenodd');
    ctx.stroke(p);
  }
  ctx.shadowBlur = Math.max(2, frame.width / 160);
  for (const color of ['blue', 'red', 'yellow'] as const) {
    ctx.shadowColor = COMPARE_COLORS.swatch[color];
    ctx.fillStyle = COMPARE_COLORS.dot[color];
    for (const d of dots) {
      if (d.color !== color) continue;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Words and numbers
// ---------------------------------------------------------------------------

/** "₱43.2 billion", "₱512 million". */
export function phpWords(v: number): string {
  if (Math.abs(v) >= 1e9) return `₱${(v / 1e9).toFixed(1)} billion`;
  return `₱${Math.round(v / 1e6).toLocaleString('en-US')} million`;
}
export const signed = (v: number, f: (x: number) => string) => (v > 0 ? `+${f(v)}` : v < 0 ? `−${f(-v)}` : f(0));
export const pct = (to: number, from: number) => (from ? Math.round(((to - from) / from) * 100) : null);

// ---------------------------------------------------------------------------
// The figure's words: one builder for the page and the downloadable image, so they never differ
// ---------------------------------------------------------------------------

const n = (v: number) => v.toLocaleString('en-US');
/** "₱43.2B". */
export const phpShort = (v: number) => `₱${(v / 1e9).toFixed(1)}B`;

/** "November 2, 2026", in Manila. */
export function asOfDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });
}

/** `tone: 'red'`: drawn in red, the House bill's colour (and flood control's 2025: Jason, 2026-11-05, "Make 2025 red themed"). */
export interface CompareCell { strong: string; span: string; tone: 'red' | null }
/** An amount on a map's label; `label` names it when the map shows two (flood control's 2027: NEP, House bill). */
export interface CompareAmount { php: string; label: string | null; tone: 'red' | null }
export interface ComparePanelCopy { key: PanelKey; name: string; sub: string; amounts: CompareAmount[]; lines: string }
/** A row of the legend: what each colour means, on the maps its title names (no title: every map). */
export interface LegendGroup { title: string | null; items: Array<{ color: DotColor; label: string }> }
export interface CompareCopy {
  kicker: string;
  /** The headline, line by line, each in runs; `red` runs are drawn in red. It names the subject first. */
  title: Array<Array<{ text: string; red?: boolean }>>;
  /** The changes between the totals. */
  cells: CompareCell[];
  /** One per map, left to right. */
  panels: ComparePanelCopy[];
  /**
   * One row per group. Flood control's red means two things (Jason, 2026-11-05: "the legend with red made it confusing
   * for 2025 as 2025 is red"): its first row names the 2025 and 2026 maps' colours, the second the 2027 map's.
   */
  legend: LegendGroup[];
  sizes: Array<{ php: number; label: string }>;
  notes: string;
  /** The figure's own disclaimer (Jason, 2026-11-05: "I need a disclaimer"): it travels without the page. */
  disclaimer: string;
  source: [string, string];
}

const DOTS_NOTE = 'One dot is one budget line, sized by its amount and placed by the place its title names (GPS where published). ';
const CANDIDATES_NOTE = 'Both are candidates, not confirmed changes; yellow lines are not in the House bill’s total. ';

export function compareCopy(
  topic: CompareTopic, f: CompareFigures, builtAt: string, opts: { offMap?: number; foreignOnly?: readonly BudgetKey[] } = {},
): CompareCopy {
  const { offMap = 0, foreignOnly = [] } = opts;
  const B = f.budgets;
  const nepVsHouse: CompareCell = (() => {
    const p = pct(f.house.php, f.nep.php) ?? 0;
    return {
      strong: `${signed(f.house.php - f.nep.php, phpWords)} in the House bill`,
      span: `${Math.abs(p)}% ${p >= 0 ? 'more' : 'less'} than the NEP (${phpShort(f.nep.php)} → ${phpShort(f.house.php)})`,
      tone: 'red',
    };
  })();
  const tail = 'Amounts are allocations, not spending.'
    + (offMap > 0 ? ` ${n(offMap)} House bill lines in the Kalayaan islands are counted but off the map’s edge.` : '')
    + (f.unmapped.lines > 0
      ? ` ${n(f.unmapped.lines)} lines budgeted nationwide (${phpWords(f.unmapped.house_php)} in the House bill) are counted but not on the map.`
      : '');
  const shared = {
    sizes: topic.sizes.map((v) => ({ php: v, label: phpWords(v).replace(' million', 'M') })),
    disclaimer: COMPARE_CARD_DISCLAIMER,
    source: [topic.source, `${topic.url} · As of ${asOfDate(builtAt)}`] as [string, string],
  };
  const one = (php: number, tone: 'red' | null = null): CompareAmount[] => [{ php: phpShort(php), label: null, tone }];

  if (topic.key === 'flood') {
    const [g25, g26] = [B['gaa-2025'], B['gaa-2026']];
    const drop = pct(g26.php, g25.php) ?? 0;
    return {
      kicker: 'DPWH flood control · 2025, 2026 and 2027 budgets',
      title: [
        [{ text: topic.subject }],
        [{ text: `${phpWords(g25.php)} in 2025.`, red: true }, { text: ` ${phpWords(g26.php)} in 2026.` }],
        [{ text: phpWords(f.house.php), red: true }, { text: ' in the 2027 House bill.' }],
      ],
      cells: [
        { strong: `${signed(g26.php - g25.php, phpWords)} in 2026`, span: `${Math.abs(drop)}% less than 2025 (${phpShort(g25.php)} → ${phpShort(g26.php)})`, tone: null },
        { strong: `${signed(f.nep.php - g26.php, phpWords)} in the 2027 NEP`, span: `${phpShort(g26.php)} in 2026 → ${phpShort(f.nep.php)} in the President’s budget`, tone: null },
        nepVsHouse,
      ],
      panels: [
        { key: 'gaa-2025', name: '2025', sub: 'The 2025 budget (GAA)', amounts: one(g25.php, 'red'), lines: `${n(g25.lines)} lines` },
        {
          key: 'gaa-2026', name: '2026',
          sub: `The 2026 budget (GAA)${foreignOnly.includes('gaa-2026') ? ', all foreign-assisted' : ''}`,
          amounts: one(g26.php), lines: `${n(g26.lines)} lines`,
        },
        {
          key: 'fy2027', name: '2027', sub: 'The NEP and House Bill 10858',
          amounts: [{ php: phpShort(f.nep.php), label: 'NEP', tone: null }, { php: phpShort(f.house.php), label: 'House bill', tone: 'red' }],
          lines: `${n(f.nep.lines)} → ${n(f.house.lines)} lines`,
        },
      ],
      legend: [
        {
          title: null,
          items: [
            { color: GAA_PANEL_COLOR['gaa-2025'], label: '2025 budget lines' },
            { color: GAA_PANEL_COLOR['gaa-2026'], label: '2026 budget lines' },
          ],
        },
        {
          title: 'On the 2027 map:',
          items: [
            { color: 'blue', label: 'In the NEP and the House bill' },
            { color: 'red', label: 'Added in the House bill' },
            { color: 'yellow', label: 'In the NEP, not in the House bill' },
          ],
        },
      ],
      notes: `${topic.scope} ${DOTS_NOTE}`
        + 'Head-office lines that name no place sit at the region the budget lists them under. '
        + 'On the 2027 map, red marks House bill lines with no matching NEP line, and yellow marks NEP lines with no '
        + `matching House bill line. ${CANDIDATES_NOTE}${tail}`,
      ...shared,
    };
  }

  return {
    kicker: '2027 budget · NEP vs House bill',
    title: [
      [{ text: topic.subject }],
      [{ text: `${phpWords(f.nep.php)} in the NEP. ` }, { text: phpWords(f.house.php), red: true }, { text: ' in the House bill.' }],
    ],
    cells: [
      nepVsHouse,
      { strong: `${signed(f.house.lines - f.nep.lines, n)} lines`, span: `${n(f.nep.lines)} in the NEP → ${n(f.house.lines)} in the House bill`, tone: null },
    ],
    panels: [
      { key: 'nep', name: 'NEP', sub: 'The President’s budget', amounts: one(f.nep.php), lines: `${n(f.nep.lines)} lines` },
      { key: 'house', name: 'House bill', sub: 'House Bill 10858, third reading', amounts: one(f.house.php, 'red'), lines: `${n(f.house.lines)} lines` },
    ],
    legend: [{
      title: null,
      items: [
        { color: 'blue', label: 'In the NEP' },
        { color: 'red', label: 'Added in the House bill' },
        { color: 'yellow', label: 'In the NEP, not in the House bill' },
      ],
    }],
    notes: `${topic.scope ? `${topic.scope} ` : ''}${DOTS_NOTE}`
      + 'On the House bill map, red marks lines with no matching NEP line, and yellow marks NEP lines with no matching '
      + `House bill line. ${CANDIDATES_NOTE}${tail}`,
    ...shared,
  };
}
