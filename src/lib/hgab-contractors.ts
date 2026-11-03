/**
 * DPWH contractors (`/hgab/2027/contractors`): every contractor in DPWH's contract list, FY2016 to FY2026, with its
 * figures, and each contract's enacted-budget (GAA) line where we found one, FY2020 to FY2026.
 *
 * Data: `contractors/` (scripts/dpwh-contracts/build_site.py; docs/dpwh-contracts.md). The figures are DPWH's own
 * list, counted as listed. Only the link from a contract to a budget line is ours: matched by title, office and
 * amount. Pure: the page, the map, the Worker's SEO code and the verifier import it.
 */

const BASE = 'hgab/2027/contractors';
export const CONTRACTORS_ROOT = '/hgab/2027/contractors';
export const CONTRACTORS_TITLE = 'DPWH contractors';
export const CONTRACTORS_INDEX_PATH = `${BASE}/index.json`;
export const CONTRACTORS_SUMMARY_PATH = `${BASE}/summary.json`;
export const CONTRACTORS_MPB_PATH = `${BASE}/mpb-links.json`;
export const CONTRACTORS_CSV_PATH = `${BASE}/contractors.csv`;
export const CONTRACTORS_CSV_NAME = 'bettergov-dpwh-contractors-2016-2026.csv';
/** Each contractor's contracts sit in one of this many files, by a hash of its key (build_site.py `shard_of`). */
export const CONTRACTOR_SHARDS = 64;
/** The enacted budgets whose lines are matched to contracts. */
export const LINKED_YEARS = [2020, 2026] as const;

export const contractorPath = (key: string) => `${CONTRACTORS_ROOT}/${encodeURIComponent(key)}`;

/** 32-bit FNV-1a over UTF-8: the same hash as build_site.py `fnv1a`. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h >>> 0;
}
export const shardOf = (key: string) => fnv1a(key) % CONTRACTOR_SHARDS;
export const contractorShardPath = (key: string) => `${BASE}/c/${String(shardOf(key)).padStart(2, '0')}.json`;

/** CSV links carry the first 12 characters of the file's SHA-256: the data host caches CSV for a day. */
export function contractorsCsvPath(summary: Pick<ContractorSummary, 'outputs'>): string {
  const sha = summary.outputs['contractors.csv'];
  return sha ? `${CONTRACTORS_CSV_PATH}?v=${sha.slice(0, 12)}` : CONTRACTORS_CSV_PATH;
}

export type ContractStatus = 'Completed' | 'On-Going' | 'Not Yet Started' | 'Terminated' | 'For Procurement';
export const STATUS_LABELS: Record<ContractStatus, string> = {
  Completed: 'Completed',
  'On-Going': 'Ongoing',
  'Not Yet Started': 'Not yet started',
  Terminated: 'Terminated',
  'For Procurement': 'For procurement',
};
export type MatchMethod = 'one_to_one' | 'bundle';
export const METHOD_LABELS: Record<MatchMethod, string> = {
  one_to_one: 'Matched by title, office and amount',
  bundle: 'One contract for several budget lines, matched by title, office and amount',
};
/** Said wherever a budget line and a contract are shown together. */
export const MATCH_NOTE =
  'DPWH does not publish which budget line a contract carries. We matched them by title, office and amount, so check the contract.';
export const AMOUNT_NOTE = 'Amounts are the contract amounts in DPWH’s list, not payments.';
export const JV_NOTE = 'A joint-venture contract counts in full for each partner.';
export const REVOKED_NOTE = 'DPWH’s list marks this contractor’s license “revoked”.';

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export interface ContractorIndexFile {
  schema: 1;
  built_at: string;
  years: number[];
  statuses: ContractStatus[];
  offices: string[];
  regions: string[];
  contracts_downloaded: string;
  cols: string[];
  rows: unknown[][];
}

export interface ContractorShardFile {
  schema: 1;
  built_at: string;
  shard: number;
  cols: string[];
  line_cols: string[];
  methods: MatchMethod[];
  contractors: Record<string, unknown[][]>;
}

export interface MpbContractsFile {
  schema: 1;
  built_at: string;
  statuses: ContractStatus[];
  methods: MatchMethod[];
  contractors: Array<[string, string]>;
  cols: string[];
  rows: unknown[][];
}

export interface ContractorSummary {
  schema: 1;
  built_at: string;
  source: { api: string; downloaded_from: string; downloaded_to: string; contracts: number; api_summary: Record<string, number> };
  totals: {
    contractors: number; contracts_with_contractor: number; contracts_without_contractor: number; amount_php: number;
    joint_venture_contracts: number; revoked_contractors: number; map_lines_with_contract: number; map_lines_fy2020_2026: number;
    years: [number, number];
  };
  gaa_links: {
    years: Array<{
      fy: number; lines: number; gaa_php: number; contracts_funded: number; contracts_linked: number;
      one_to_one: { lines: number; gaa_php: number }; bundle: { lines: number; gaa_php: number }; none: { lines: number; gaa_php: number };
    }>;
    rules: { title_min: number; region_title_min: number; amount_ratio: [number, number] };
    built_at: string;
  };
  shards: number;
  checks: Record<string, boolean>;
  outputs: Record<string, string>;
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

export interface Contractor {
  i: number;
  key: string;
  name: string;
  /** PCAB license number as DPWH lists it (or OECO_… for a foreign contractor); null when the list gives none. */
  id: string | null;
  revoked: boolean;
  contracts: number;
  php: number;
  jvContracts: number;
  jvPhp: number;
  completed: number;
  ongoing: number;
  notStarted: number;
  terminated: number;
  firstYear: number | null;
  lastYear: number | null;
  yearsPhp: number[];
  yearsN: number[];
  offices: number;
  topOffice: string;
  topOfficePhp: number;
  regions: number;
  linkedContracts: number;
  linkedLines: number;
  linkedGaaPhp: number;
  aliases: string[];
  /** Lower-case name, other names and license number, for the search box. */
  search: string;
}

export interface ContractorIndex {
  builtAt: string;
  downloadedAt: string;
  years: number[];
  statuses: ContractStatus[];
  offices: string[];
  list: Contractor[];
  byKey: Map<string, Contractor>;
}

export function decodeContractorIndex(f: ContractorIndexFile): ContractorIndex {
  const col = (name: string) => {
    const k = f.cols.indexOf(name);
    if (k < 0) throw new Error(`contractors/index.json has no column ${name}`);
    return k;
  };
  const c = Object.fromEntries(f.cols.map((n) => [n, col(n)])) as Record<string, number>;
  const list = f.rows.map((r, i): Contractor => {
    const v = <T,>(name: string) => r[c[name]] as T;
    const aliases = v<string[]>('aliases') ?? [];
    const name = v<string>('name');
    const id = v<string | null>('id');
    return {
      i, key: v('key'), name, id, revoked: Boolean(v('revoked')),
      contracts: v('contracts'), php: v('php'), jvContracts: v('jv_contracts'), jvPhp: v('jv_php'),
      completed: v('completed'), ongoing: v('ongoing'), notStarted: v('not_started'), terminated: v('terminated'),
      firstYear: v('first_year'), lastYear: v('last_year'), yearsPhp: v('years_php'), yearsN: v('years_n'),
      offices: v('offices'), topOffice: f.offices[v<number>('top_office')] ?? '', topOfficePhp: v('top_office_php'),
      regions: v('regions'), linkedContracts: v('linked_contracts'), linkedLines: v('linked_lines'),
      linkedGaaPhp: v('linked_gaa_php'), aliases,
      search: [name, ...aliases, id ?? ''].join(' ').toLowerCase(),
    };
  });
  return {
    builtAt: f.built_at, downloadedAt: f.contracts_downloaded, years: f.years, statuses: f.statuses, offices: f.offices,
    list, byKey: new Map(list.map((x) => [x.key, x])),
  };
}

export type ContractorSort = 'amount' | 'contracts' | 'lines' | 'name';
export const SORT_LABELS: Record<ContractorSort, string> = {
  amount: 'Largest amount',
  contracts: 'Most contracts',
  lines: 'Most budget lines matched',
  name: 'Name, A to Z',
};

/** The amount and contracts in one year (0 = every year). */
export function amountIn(c: Contractor, years: readonly number[], year: number): number {
  return year ? c.yearsPhp[year - years[0]] ?? 0 : c.php;
}
export function contractsIn(c: Contractor, years: readonly number[], year: number): number {
  return year ? c.yearsN[year - years[0]] ?? 0 : c.contracts;
}

export function filterContractors(ix: ContractorIndex, q: string, year: number): Contractor[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return ix.list.filter((c) => (!year || contractsIn(c, ix.years, year) > 0) && words.every((w) => c.search.includes(w)));
}

export function sortContractors(list: readonly Contractor[], years: readonly number[], sort: ContractorSort, year: number): Contractor[] {
  const by: Record<ContractorSort, (a: Contractor, b: Contractor) => number> = {
    amount: (a, b) => amountIn(b, years, year) - amountIn(a, years, year),
    contracts: (a, b) => contractsIn(b, years, year) - contractsIn(a, years, year),
    lines: (a, b) => b.linkedLines - a.linkedLines,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return [...list].sort((a, b) => by[sort](a, b) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// One contractor's contracts
// ---------------------------------------------------------------------------

export interface ContractLine {
  id: string;
  fy: number;
  title: string;
  gaaPhp: number;
  method: MatchMethod;
}

export interface ContractRow {
  id: string;
  year: number | null;
  description: string;
  office: string;
  php: number;
  status: ContractStatus | null;
  progress: number | null;
  start: string | null;
  completion: string | null;
  /** The other contractors on a joint-venture contract, by key. */
  partners: string[];
  lines: ContractLine[];
  search: string;
}

export function decodeContracts(f: ContractorShardFile, key: string, ix: Pick<ContractorIndex, 'offices' | 'statuses'>): ContractRow[] | null {
  const rows = f.contractors[key];
  if (!rows) return null;
  const c = Object.fromEntries(f.cols.map((n, k) => [n, k])) as Record<string, number>;
  const lc = Object.fromEntries(f.line_cols.map((n, k) => [n, k])) as Record<string, number>;
  return rows.map((r) => {
    const lines = (r[c.lines] as unknown[][]).map((l): ContractLine => {
      const id = String(l[lc.line_id]);
      return { id, fy: Number(id.split(':')[1]), title: String(l[lc.title]), gaaPhp: Number(l[lc.gaa_php]), method: f.methods[Number(l[lc.method])] };
    });
    const status = Number(r[c.status]);
    const description = String(r[c.description] ?? '');
    const office = ix.offices[Number(r[c.office])] ?? '';
    return {
      id: String(r[c.contract_id]),
      year: (r[c.year] as number | null) ?? null,
      description,
      office,
      php: Number(r[c.php]),
      status: status >= 0 ? ix.statuses[status] : null,
      progress: (r[c.progress] as number | null) ?? null,
      start: (r[c.start] as string | null) ?? null,
      completion: (r[c.completion] as string | null) ?? null,
      partners: r[c.partners] as string[],
      lines,
      search: [r[c.contract_id], description, office, ...lines.map((l) => l.title)].join(' ').toLowerCase(),
    };
  });
}

/** Amount and contracts per DPWH office, largest first. */
export function officeTotals(rows: readonly ContractRow[]): Array<{ office: string; contracts: number; php: number }> {
  const m = new Map<string, { office: string; contracts: number; php: number }>();
  for (const r of rows) {
    const o = m.get(r.office) ?? { office: r.office, contracts: 0, php: 0 };
    o.contracts++; o.php += r.php;
    m.set(r.office, o);
  }
  return [...m.values()].sort((a, b) => b.php - a.php || a.office.localeCompare(b.office));
}

/** Joint-venture partners, most contracts together first. */
export function partnerTotals(rows: readonly ContractRow[]): Array<{ key: string; contracts: number; php: number }> {
  const m = new Map<string, { key: string; contracts: number; php: number }>();
  for (const r of rows) for (const k of r.partners) {
    const o = m.get(k) ?? { key: k, contracts: 0, php: 0 };
    o.contracts++; o.php += r.php;
    m.set(k, o);
  }
  return [...m.values()].sort((a, b) => b.contracts - a.contracts || b.php - a.php || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// The map's lines
// ---------------------------------------------------------------------------

export interface LineContract {
  contractId: string;
  contractors: Array<{ key: string; name: string }>;
  php: number;
  status: ContractStatus | null;
  method: MatchMethod;
}

export function decodeMpbContracts(f: MpbContractsFile): Map<string, LineContract> {
  const c = Object.fromEntries(f.cols.map((n, k) => [n, k])) as Record<string, number>;
  const who = f.contractors.map(([key, name]) => ({ key, name }));
  const out = new Map<string, LineContract>();
  for (const r of f.rows) {
    const status = Number(r[c.status]);
    out.set(String(r[c.line_id]), {
      contractId: String(r[c.contract_id]),
      contractors: (r[c.contractors] as number[]).map((k) => who[k]),
      php: Number(r[c.php]),
      status: status >= 0 ? f.statuses[status] : null,
      method: f.methods[Number(r[c.method])],
    });
  }
  return out;
}

/** Extra CSV columns for a line with a contract (the map's "Download these"). */
export const LINE_CONTRACT_COLUMNS = ['contract_id', 'contractors', 'contract_php', 'contract_status', 'contract_match'] as const;
export function lineContractCells(c: LineContract | undefined): Array<string | number | null> {
  if (!c) return [null, null, null, null, null];
  return [c.contractId, c.contractors.map((x) => x.name).join('; '), c.php, c.status, c.method];
}

// ---------------------------------------------------------------------------
// CSV of one contractor's contracts
// ---------------------------------------------------------------------------

const cell = (v: unknown): string => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CONTRACTS_CSV_COLUMNS = [
  'contract_id', 'year', 'description', 'dpwh_office', 'contract_php', 'status', 'progress_percent', 'start_date',
  'completion_date', 'joint_venture_partners', 'gaa_line_id', 'gaa_line_title', 'gaa_line_php', 'gaa_match',
] as const;

/** One row per contract and budget line (a contract with no line has one row with the line columns empty). */
export function contractsCsv(rows: readonly ContractRow[], ix: Pick<ContractorIndex, 'byKey'>): string {
  const out = rows.flatMap((r) => {
    const base = [r.id, r.year, r.description, r.office, r.php, r.status, r.progress, r.start, r.completion,
      r.partners.map((k) => ix.byKey.get(k)?.name ?? k).join('; ')];
    const lines = r.lines.length ? r.lines : [null];
    return lines.map((l) => [...base, l?.id, l?.title, l?.gaaPhp, l?.method].map(cell).join(','));
  });
  return [CONTRACTS_CSV_COLUMNS.join(','), ...out].join('\n') + '\n';
}
