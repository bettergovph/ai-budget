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
/** The data as downloads, for developers (scripts/dpwh-contracts/build_downloads.py). */
export const CONTRACTORS_DOWNLOADS_DIR = `${BASE}/downloads`;
export const CONTRACTORS_MANIFEST_PATH = `${BASE}/downloads/manifest.json`;

export interface ContractorDownloadFile { file: string; bytes: number; sha256: string; url: string }
export interface ContractorDownloadEntry {
  key: string; title: string; about: string; rows: number;
  csv: ContractorDownloadFile; parquet: ContractorDownloadFile; columns: Record<string, string>;
}
/** downloads/manifest.json: every file with its rows, size, SHA-256, URL and columns (the line-by-line manifest's shape, and more). */
export interface ContractorDownloads {
  schema: 1; built_at: string; title: string; base_url: string; pipeline_commit: string; notice: string;
  readme: ContractorDownloadFile; zip: ContractorDownloadFile; accuracy_sample: ContractorDownloadFile;
  files: ContractorDownloadEntry[];
}
/** A download's path under the data root, versioned by its SHA-256 (the data host caches files under fixed names). */
export const contractorDownloadPath = (f: Pick<ContractorDownloadFile, 'file' | 'sha256'>) =>
  `${CONTRACTORS_DOWNLOADS_DIR}/${f.file}?v=${f.sha256.slice(0, 12)}`;
/** Each contractor's contracts sit in one of this many files, by a hash of its key (build_site.py `shard_of`). */
export const CONTRACTOR_SHARDS = 64;
/** The enacted budgets whose lines are matched to contracts. */
export const LINKED_YEARS = [2020, 2026] as const;

export const contractorPath = (key: string) => `${CONTRACTORS_ROOT}/${encodeURIComponent(key)}`;

/** DPWH's own page for a contract on its transparency portal, the source of our list (Jason, 2026-11-03). */
export const DPWH_PORTAL = 'https://transparency.dpwh.gov.ph';
export const dpwhContractUrl = (contractId: string) => `${DPWH_PORTAL}/?project=${encodeURIComponent(contractId)}`;
/** Said where contract IDs are listed. */
export const DPWH_LINK_NOTE = 'Each contract ID opens DPWH’s own record of it on DPWH’s transparency portal.';

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
  /** The offices that awarded the contracts (the `office` column); absent in files built before it. */
  offices?: string[];
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
  /** The DPWH office that awarded the contract, or null. */
  office: string | null;
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
      office: c.office != null && f.offices ? f.offices[Number(r[c.office])] || null : null,
    });
  }
  return out;
}

/** The contractors of a set of map lines, ranked (the map's "Top contractors"). */
export interface LineContractorRow {
  key: string;
  name: string;
  /** Lines whose contract names this contractor (a joint venture's line counts for each partner). */
  lines: number;
  /** Of those, lines on a joint-venture contract. */
  jvLines: number;
  contracts: number;
  /** The lines' budget amount. */
  gaaPhp: number;
  /** The contracts' amount, each contract once (a cluster carries several lines). */
  contractPhp: number;
  firstYear: number;
  lastYear: number;
  /** The DPWH offices that awarded the contracts (the line's own office when the file has none), and the busiest. */
  offices: number;
  topOffice: string | null;
}

export type LineContractorSort = 'lines' | 'budget' | 'contract';
export const LINE_CONTRACTOR_SORTS: Record<LineContractorSort, string> = {
  lines: 'Most lines',
  budget: 'Largest budget amount',
  contract: 'Largest contract amount',
};

/**
 * Rank the contractors of `lines` (those in the matched years with a contract). `eligible` counts the lines in the
 * matched years; `withContract` those with a contract.
 */
export function rankLineContractors(
  lines: ReadonlyArray<{ id: string; fy: number; gaa: number | null; office: string | null }>,
  contracts: ReadonlyMap<string, LineContract>,
  sort: LineContractorSort = 'lines',
): { rows: LineContractorRow[]; eligible: number; withContract: number } {
  const acc = new Map<string, LineContractorRow & { ids: Set<string>; byOffice: Map<string, number> }>();
  let eligible = 0;
  let withContract = 0;
  for (const l of lines) {
    if (l.fy < LINKED_YEARS[0] || l.fy > LINKED_YEARS[1]) continue;
    eligible++;
    const c = contracts.get(l.id);
    if (!c) continue;
    withContract++;
    for (const x of c.contractors) {
      let r = acc.get(x.key);
      if (!r) {
        r = { key: x.key, name: x.name, lines: 0, jvLines: 0, contracts: 0, gaaPhp: 0, contractPhp: 0, firstYear: l.fy,
          lastYear: l.fy, offices: 0, topOffice: null, ids: new Set(), byOffice: new Map() };
        acc.set(x.key, r);
      }
      r.lines++;
      if (c.contractors.length > 1) r.jvLines++;
      r.gaaPhp += l.gaa ?? 0;
      if (!r.ids.has(c.contractId)) { r.ids.add(c.contractId); r.contractPhp += c.php; }
      r.firstYear = Math.min(r.firstYear, l.fy);
      r.lastYear = Math.max(r.lastYear, l.fy);
      const office = c.office ?? l.office;
      if (office) r.byOffice.set(office, (r.byOffice.get(office) ?? 0) + 1);
    }
  }
  const by: Record<LineContractorSort, (a: LineContractorRow, b: LineContractorRow) => number> = {
    lines: (a, b) => b.lines - a.lines || b.gaaPhp - a.gaaPhp,
    budget: (a, b) => b.gaaPhp - a.gaaPhp || b.lines - a.lines,
    contract: (a, b) => b.contractPhp - a.contractPhp || b.lines - a.lines,
  };
  const rows = [...acc.values()].map(({ ids, byOffice, ...r }) => ({
    ...r,
    contracts: ids.size,
    offices: byOffice.size,
    topOffice: [...byOffice].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null,
  }));
  rows.sort((a, b) => by[sort](a, b) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  return { rows, eligible, withContract };
}

/** A contractor's name from the map's contracts, or null. */
export function lineContractorName(contracts: ReadonlyMap<string, LineContract> | null, key: string): string | null {
  if (!contracts || !key) return null;
  for (const c of contracts.values()) for (const x of c.contractors) if (x.key === key) return x.name;
  return null;
}

/** Does this line's contract name the contractor? */
export function lineBuiltBy(contracts: ReadonlyMap<string, LineContract>, lineId: string, key: string): boolean {
  return contracts.get(lineId)?.contractors.some((x) => x.key === key) ?? false;
}

export const LINE_CONTRACTORS_CSV_COLUMNS = [
  'rank', 'contractor', 'license_id', 'lines', 'joint_venture_lines', 'contracts', 'budget_php', 'contract_php',
  'first_year', 'last_year', 'dpwh_offices', 'main_dpwh_office', 'page',
] as const;

export function lineContractorsCsv(rows: readonly LineContractorRow[]): string {
  const out = rows.map((r, i) => [
    i + 1, r.name, r.key.startsWith('n-') ? null : r.key, r.lines, r.jvLines, r.contracts, r.gaaPhp,
    Math.round(r.contractPhp * 100) / 100, r.firstYear, r.lastYear, r.offices, r.topOffice,
    `https://budget.bettergov.ph${contractorPath(r.key)}`,
  ].map(cell).join(','));
  return [LINE_CONTRACTORS_CSV_COLUMNS.join(','), ...out].join('\n') + '\n';
}

/** Extra CSV columns for a line with a contract (the map's "Download these"). */
export const LINE_CONTRACT_COLUMNS = [
  'contract_id', 'contract_dpwh_url', 'contractors', 'contract_php', 'contract_status', 'contract_match',
] as const;
export function lineContractCells(c: LineContract | undefined): Array<string | number | null> {
  if (!c) return LINE_CONTRACT_COLUMNS.map(() => null);
  return [c.contractId, dpwhContractUrl(c.contractId), c.contractors.map((x) => x.name).join('; '), c.php, c.status, c.method];
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
  'contract_id', 'dpwh_url', 'year', 'description', 'dpwh_office', 'contract_php', 'status', 'progress_percent', 'start_date',
  'completion_date', 'joint_venture_partners', 'gaa_line_id', 'gaa_line_title', 'gaa_line_php', 'gaa_match',
] as const;

/** One row per contract and budget line (a contract with no line has one row with the line columns empty). */
export function contractsCsv(rows: readonly ContractRow[], ix: Pick<ContractorIndex, 'byKey'>): string {
  const out = rows.flatMap((r) => {
    const base = [r.id, dpwhContractUrl(r.id), r.year, r.description, r.office, r.php, r.status, r.progress, r.start, r.completion,
      r.partners.map((k) => ix.byKey.get(k)?.name ?? k).join('; ')];
    const lines = r.lines.length ? r.lines : [null];
    return lines.map((l) => [...base, l?.id, l?.title, l?.gaaPhp, l?.method].map(cell).join(','));
  });
  return [CONTRACTS_CSV_COLUMNS.join(','), ...out].join('\n') + '\n';
}
