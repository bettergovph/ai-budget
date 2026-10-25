/**
 * Query builders for `<dataset>/projects.parquet` (the `/hgab` project tables).
 *
 * Pure functions, no React: the same strings the browser hands to DuckDB-Wasm
 * can be executed by `@duckdb/node-api` against the file on disk, which is how
 * they are tested. Every list query SELECTs by the names in `PROJECT_COLUMNS`;
 * `record_json` and `search_text` are never selected in a list.
 *
 * Filter state lives in the URL (`?view=projects&q=…&group=…`) so a finding is
 * shareable. `filtersFromParams` / `paramsFromFilters` are the two ends of that
 * round-trip; only non-default values are written so links stay short.
 *
 * Data-integrity rules enforced here:
 *   - stage amounts are summed per stage over the SAME filtered rows, never
 *     across stages (`summarySql`);
 *   - the group filter maps bridge groups to `trace` values through
 *     `TRACE_LABELS`, so the vocabulary is the workbench's, verbatim;
 *   - held rows (fuzzy / ambiguous) are a separate toggle, because the
 *     headline bridge counts exclude them.
 */
import {
  BRIDGE_ORDER, MATCH_LABELS, PROJECT_COLUMNS, TRACE_LABELS, traceInfo,
  type BridgeGroup, type DatasetKey, type HgabDatasetMeta, type HgabDocument, type ProjectRow,
} from './hgab';

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

export type SortKey = 'title' | 'nep' | 'hgab2' | 'hgab3' | 'delta';
export type SortDir = 'asc' | 'desc';
/** `all` shows every row; `hide` drops fuzzy/ambiguous rows; `only` keeps just those. */
export type HeldMode = 'all' | 'hide' | 'only';

export const PAGE_SIZES: readonly number[] = [50, 200, 1000];
export const DEFAULT_PAGE_SIZE = 50;

export interface ProjectFilters {
  /** Free text, matched against `search_text` (lower-cased, every word must appear). */
  q: string;
  /** Bridge groups to keep; empty = all. */
  groups: BridgeGroup[];
  held: HeldMode;
  region: string;
  program: string;
  pap: string;
  officeKind: string;
  /** `local` | `fap` | ''. */
  zone: string;
  /** DPWH `reading_status`. */
  reading: string;
  /** One review flag that must be present in the comma-separated `flags`. */
  flag: string;
  sort: SortKey;
  dir: SortDir;
  /** One-based. */
  page: number;
  size: number;
}

export const SORT_LABELS: Record<SortKey, string> = {
  title: 'Title',
  nep: 'NEP amount',
  hgab2: 'HGAB 2R amount',
  hgab3: 'HGAB 3R amount',
  delta: 'Δ House − NEP',
};

const SORT_COLUMN: Record<SortKey, string> = {
  title: 'title',
  nep: 'nep_php',
  hgab2: 'hgab2_php',
  hgab3: 'hgab3_php',
  delta: 'delta_php',
};

/** The sort a dataset opens on: its latest House reading, largest first. */
export function defaultSort(dataset: Pick<HgabDatasetMeta, 'totals'>): SortKey {
  return dataset.totals.hgab3_php != null ? 'hgab3' : dataset.totals.hgab2_php != null ? 'hgab2' : 'nep';
}

function isBridgeGroup(v: string): v is BridgeGroup {
  return (BRIDGE_ORDER as readonly string[]).includes(v);
}
function isSortKey(v: string | null): v is SortKey {
  return v != null && v in SORT_LABELS;
}
function isHeld(v: string | null): v is HeldMode {
  return v === 'all' || v === 'hide' || v === 'only';
}

/**
 * URL → filters. Unknown values fall back to defaults rather than throwing, so
 * a stale link still opens something sensible.
 */
export function filtersFromParams(params: URLSearchParams, sortDefault: SortKey): ProjectFilters {
  const size = Number(params.get('size'));
  const page = Number(params.get('page'));
  const sortParam = params.get('sort');
  const dirParam = params.get('dir');
  return {
    q: params.get('q') ?? '',
    groups: (params.get('group') ?? '').split(',').map((s) => s.trim()).filter(isBridgeGroup),
    held: isHeld(params.get('held')) ? (params.get('held') as HeldMode) : 'all',
    region: params.get('region') ?? '',
    program: params.get('program') ?? '',
    pap: params.get('pap') ?? '',
    officeKind: params.get('office') ?? '',
    zone: params.get('zone') === 'local' || params.get('zone') === 'fap' ? (params.get('zone') as string) : '',
    reading: params.get('reading') ?? '',
    flag: params.get('flag') ?? '',
    sort: isSortKey(sortParam) ? sortParam : sortDefault,
    dir: dirParam === 'asc' || dirParam === 'desc' ? dirParam : 'desc',
    page: Number.isInteger(page) && page > 0 ? page : 1,
    size: PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

/**
 * Filters → URL. Starts from `base` so unrelated params (`view`) survive;
 * writes only values that differ from the defaults.
 */
export function paramsFromFilters(f: ProjectFilters, base: URLSearchParams, sortDefault: SortKey): URLSearchParams {
  const p = new URLSearchParams(base);
  const set = (k: string, v: string, def = '') => { if (v && v !== def) p.set(k, v); else p.delete(k); };
  set('q', f.q.trim());
  set('group', f.groups.join(','));
  set('held', f.held, 'all');
  set('region', f.region);
  set('program', f.program);
  set('pap', f.pap);
  set('office', f.officeKind);
  set('zone', f.zone);
  set('reading', f.reading);
  set('flag', f.flag);
  set('sort', f.sort, sortDefault);
  set('dir', f.dir, 'desc');
  set('page', f.page > 1 ? String(f.page) : '');
  set('size', f.size !== DEFAULT_PAGE_SIZE ? String(f.size) : '');
  return p;
}

/** True when any filter narrows the table (sort/paging don't count). */
export function hasActiveFilters(f: ProjectFilters): boolean {
  return Boolean(
    f.q.trim() || f.groups.length || f.held !== 'all' || f.region || f.program || f.pap
    || f.officeKind || f.zone || f.reading || f.flag,
  );
}

// ---------------------------------------------------------------------------
// Vocabulary helpers
// ---------------------------------------------------------------------------

/** Traces the workbench holds out of headline counts (fuzzy, ambiguous). */
export function heldTraces(): string[] {
  return Object.keys(TRACE_LABELS).filter((k) => TRACE_LABELS[k].held);
}

/** Every `trace` value that belongs to one of `groups`, respecting the held mode. */
export function tracesFor(groups: readonly BridgeGroup[], held: HeldMode): string[] {
  return Object.keys(TRACE_LABELS).filter((k) => {
    const t = TRACE_LABELS[k];
    if (!groups.includes(t.group)) return false;
    if (held === 'hide' && t.held) return false;
    if (held === 'only' && !t.held) return false;
    return true;
  });
}

/**
 * Plain labels for the comma-separated review `flags`, as the importer writes
 * them (DPWH, then the FMR / NIA / HFEP annex vocabularies). Unknown flags are
 * humanised rather than hidden.
 */
export const FLAG_LABELS: Record<string, string> = {
  // DPWH
  house_only: 'House only · no NEP record attached',
  nep_only: 'NEP only · no House record attached',
  region_difference: 'Region differs between sources',
  office_difference: 'Office differs between sources',
  no_office: 'No recorded office',
  repeated_key: 'Repeated key · grouped House rows',
  uncertain_match: 'Paired by a non-exact rule (chainage, location, scope, soft or segment-scope)',
  nep_evidence_review: 'NEP amount evidence under review',
  length_review: 'Chainage length repaired or implausible',
  twin_review: 'Identical-title twin under another PAP',
  nep_twin: 'NEP side of an identical-title twin',
  segment_scope: 'Same road, non-overlapping segment',
  transparency_gap: 'NEP row absent from the Transparency listing',
  outside_api: 'Outside the Transparency listing scope',
  group_exhausted: 'Grouping · House rows with no NEP counterpart in their shell',
  group_nep_leftover: 'Grouping · NEP rows never funded in their shell',
  // FMR
  'method:title_and_coordinates': 'Paired on title and coordinates',
  'method:title': 'Paired on title only',
  'method:coordinates': 'Paired on coordinates only',
  ambiguous_title: 'Title appears more than once',
  coordinate_review: 'Printed coordinates need review',
  // NIA
  'method:ai_corrected': 'Paired after AI-assisted spelling correction',
  'strict:split_pair': 'Pair exists only under the corrected method',
  'near_miss:spelling_variant': 'Near miss · spelling variant',
  'near_miss:repeated_title': 'Near miss · repeated title',
  'near_miss:location_variant': 'Near miss · location variant',
  'near_miss:exact_variant': 'Near miss · exact variant',
  unresolved: 'Unmatched, with a near-miss mark',
  // HFEP
  column_added: 'NEP prints a cell the House leaves blank',
  column_dropped: 'House prints a cell the NEP leaves blank',
};

export function flagLabel(flag: string): string {
  const k = flag.trim();
  if (!k) return '';
  return FLAG_LABELS[k] ?? k.replace(/[_:]/g, ' ');
}

/**
 * `house_match` values on annex rows are the pairing method rather than the
 * DPWH vocabulary in `MATCH_LABELS`; these fill the gap. Unknown values are
 * shown humanised.
 */
export const ANNEX_MATCH_LABELS: Record<string, string> = {
  title_and_coordinates: 'Paired on title and coordinates',
  title: 'Paired on title',
  coordinates: 'Paired on coordinates',
  ai_corrected: 'Paired after spelling correction',
  title_similarity: 'Paired on title similarity',
};

/** `house_match` → plain label, DPWH vocabulary first, then the annex methods. */
export function matchLabel(v: string | null | undefined): string | null {
  if (!v) return null;
  return MATCH_LABELS[v] ?? ANNEX_MATCH_LABELS[v] ?? v.replace(/[_:]/g, ' ');
}

/** What the `pap` column means per dataset; null when the dataset has none. */
export function papLabel(key: DatasetKey): string | null {
  switch (key) {
    case 'dpwh': return 'PAP';
    case 'nia': return 'Sub-program';
    case 'hfep': return 'Funding column';
    default: return null;
  }
}

/** `zone` → plain label. */
export function zoneLabel(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v === 'local') return 'Locally funded';
  if (v === 'fap') return 'Foreign-assisted (FAP)';
  return v;
}

export function splitFlags(flags: string | null | undefined): string[] {
  return (flags ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** `api_presence` on DPWH rows: Transparency-listing coverage of the NEP side. */
export const API_PRESENCE_LABELS: Record<string, { label: string; help: string }> = {
  paired: { label: 'In Transparency listing', help: 'The NEP row has a counterpart in the DPWH Transparency NEP listing.' },
  nep_not_in_transparency: { label: 'Not in Transparency listing', help: 'The printed NEP row has no counterpart in the Transparency listing. A listing-gap observation, not a finding of concealment.' },
  outside_api_scope: { label: 'Outside Transparency scope', help: 'The Transparency listing does not cover this row (mostly foreign-assisted projects).' },
  no_nep_anchor: { label: 'No NEP side to check', help: 'House-only rows have no NEP record to look up in the Transparency listing.' },
};

export function apiPresenceInfo(v: string | null | undefined): { label: string; help: string } | null {
  if (!v) return null;
  return API_PRESENCE_LABELS[v] ?? { label: v.replace(/_/g, ' '), help: '' };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * The House document a page number belongs to. Project rows carry their own
 * `*_doc`; this is the fallback for them and the rule for controls, whose
 * `house_pages` are bare numbers. Controls print in Volume I-B, projects in
 * I-C; `prefer` picks between them when both are in the dataset's list.
 */
export function pickHouseDoc(
  docs: readonly HgabDocument[] | null | undefined,
  dataset: Pick<HgabDatasetMeta, 'documents'>,
  reading: 2 | 3,
  prefer: 'controls' | 'projects',
): string | null {
  const keys = dataset.documents.house;
  const wantVol = prefer === 'controls' ? /\bi-?b\b|vol-?ib/i : /\bi-?c\b|vol-?ic/i;
  const candidates = (docs ?? [])
    .filter((d) => keys.includes(d.key) && d.stage === 'house' && d.reading === reading);
  const preferred = candidates.find((d) => wantVol.test(d.volume ?? '') || wantVol.test(d.key));
  if (preferred) return preferred.key;
  if (candidates[0]) return candidates[0].key;
  // No document catalogue yet: fall back to the key convention.
  const byKey = keys.find((k) => k.includes(`${reading}r`) && wantVol.test(k)) ?? keys.find((k) => k.includes(`${reading}r`));
  return byKey ?? keys[0] ?? null;
}

/**
 * The one Volume I-B document a dataset's control pages cite. The importer
 * cites the latest reading's I-B that is in the dataset's list: the 3rd
 * reading for DPWH, the 2nd for the annexes (whose text is identical across
 * readings and is cited once).
 */
export function controlHouseDoc(
  docs: readonly HgabDocument[] | null | undefined,
  dataset: Pick<HgabDatasetMeta, 'documents'>,
): { key: string; reading: 2 | 3 } | null {
  for (const reading of [3, 2] as const) {
    const listed = dataset.documents.house.some((k) => k.includes(`${reading}r`));
    const inCatalogue = (docs ?? []).some(
      (d) => dataset.documents.house.includes(d.key) && d.stage === 'house' && d.reading === reading,
    );
    if (listed || inCatalogue) {
      const key = pickHouseDoc(docs, dataset, reading, 'controls');
      if (key) return { key, reading };
    }
  }
  const key = dataset.documents.house[0];
  return key ? { key, reading: 3 } : null;
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

export const sqlStr = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** Lower-cased LIKE needle with `\`, `%` and `_` escaped (pair with `ESCAPE '\'`). */
export function likeNeedle(v: string): string {
  return v.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Columns a list query selects — everything but the two payload columns and the constant `dataset`. */
export const LIST_COLUMNS = PROJECT_COLUMNS.filter(
  (c) => c !== 'record_json' && c !== 'search_text' && c !== 'dataset',
);

export function parquetSource(url: string): string {
  return `read_parquet(${sqlStr(url)})`;
}

export function whereClauses(f: ProjectFilters): string[] {
  const where: string[] = [];
  const words = f.q.trim().split(/\s+/).filter(Boolean);
  for (const w of words) {
    where.push(`search_text LIKE ${sqlStr(`%${likeNeedle(w)}%`)} ESCAPE '\\'`);
  }
  if (f.groups.length) {
    const traces = tracesFor(f.groups, f.held);
    // An empty IN list is a syntax error; a group with no traces matches nothing.
    where.push(traces.length ? `trace IN (${traces.map(sqlStr).join(', ')})` : 'FALSE');
  } else if (f.held === 'hide') {
    where.push(`trace NOT IN (${heldTraces().map(sqlStr).join(', ')})`);
  } else if (f.held === 'only') {
    where.push(`trace IN (${heldTraces().map(sqlStr).join(', ')})`);
  }
  if (f.region) where.push(`region = ${sqlStr(f.region)}`);
  if (f.program) where.push(`program = ${sqlStr(f.program)}`);
  if (f.pap) where.push(`pap = ${sqlStr(f.pap)}`);
  if (f.officeKind) where.push(`office_kind = ${sqlStr(f.officeKind)}`);
  if (f.zone) where.push(`zone = ${sqlStr(f.zone)}`);
  if (f.reading) where.push(`reading_status = ${sqlStr(f.reading)}`);
  if (f.flag) where.push(`(',' || flags || ',') LIKE ${sqlStr(`%,${likeNeedle(f.flag)},%`)} ESCAPE '\\'`);
  return where;
}

function whereSql(f: ProjectFilters): string {
  const w = whereClauses(f);
  return w.length ? `\nWHERE ${w.join('\n  AND ')}` : '';
}

function orderSql(f: ProjectFilters): string {
  const col = SORT_COLUMN[f.sort];
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  // Nulls always sink: a row with no amount on the sorted stage is not "smallest".
  return col === 'title'
    ? `\nORDER BY title ${dir}, id ASC`
    : `\nORDER BY ${col} ${dir} NULLS LAST, title ASC, id ASC`;
}

/** One page of rows. */
export function projectsSql(url: string, f: ProjectFilters): string {
  const offset = (f.page - 1) * f.size;
  return `SELECT ${LIST_COLUMNS.join(', ')}
FROM ${parquetSource(url)}${whereSql(f)}${orderSql(f)}
LIMIT ${f.size}${offset ? ` OFFSET ${offset}` : ''}`;
}

/**
 * Rows matched and per-stage sums over the SAME filter. The three sums are
 * reported side by side and must never be added together.
 */
export function summarySql(url: string, f: ProjectFilters): string {
  return `SELECT count(*) AS n,
       count(nep_php)   AS nep_rows,   sum(nep_php)   AS nep_php,
       count(hgab2_php) AS hgab2_rows, sum(hgab2_php) AS hgab2_php,
       count(hgab3_php) AS hgab3_rows, sum(hgab3_php) AS hgab3_php
FROM ${parquetSource(url)}${whereSql(f)}`;
}

/** Every filtered row in the current order — the CSV export. */
export function exportSql(url: string, f: ProjectFilters): string {
  return `SELECT ${LIST_COLUMNS.join(', ')}
FROM ${parquetSource(url)}${whereSql(f)}${orderSql(f)}`;
}

export interface FacetRow {
  dim: 'region' | 'program' | 'pap' | 'office_kind' | 'zone' | 'reading_status' | 'flag' | 'trace';
  value: string;
  n: number;
}

/** Distinct values with counts for every filter dimension, in one round trip. */
export function facetsSql(url: string): string {
  const src = parquetSource(url);
  const dim = (col: string) =>
    `SELECT '${col}' AS dim, ${col} AS value, count(*) AS n FROM ${src} WHERE ${col} IS NOT NULL AND ${col} <> '' GROUP BY 1, 2`;
  return [
    dim('region'),
    dim('program'),
    dim('pap'),
    dim('office_kind'),
    dim('zone'),
    dim('reading_status'),
    dim('trace'),
    `SELECT 'flag' AS dim, trim(f) AS value, count(*) AS n
FROM (SELECT unnest(string_split(flags, ',')) AS f FROM ${src} WHERE flags IS NOT NULL AND flags <> '')
WHERE trim(f) <> '' GROUP BY 1, 2`,
  ].join('\nUNION ALL\n') + '\nORDER BY dim, n DESC, value';
}

/** One record, by id, as a prepared statement (`?` is bound by the caller). */
export function recordSql(url: string): string {
  return `SELECT * FROM ${parquetSource(url)} WHERE id = ?`;
}

/** Same query with the id inlined — the fallback when parameter binding is unavailable. */
export function recordSqlLiteral(url: string, id: string): string {
  return `SELECT * FROM ${parquetSource(url)} WHERE id = ${sqlStr(id)}`;
}

// ---------------------------------------------------------------------------
// Result coercion
// ---------------------------------------------------------------------------

const NUMERIC: ReadonlyArray<keyof ProjectRow> = [
  'confidence', 'nep_php', 'hgab2_php', 'hgab3_php', 'api_php', 'delta_php',
  'nep_page', 'hgab2_page', 'hgab3_page', 'length_m', 'suggestions',
];

function num(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Arrow row → ProjectRow. BIGINT arrives as `bigint`; pages/amounts become plain numbers. */
export function coerceRow(r: Record<string, unknown>): ProjectRow {
  const out = { ...r } as Record<string, unknown>;
  for (const k of NUMERIC) out[k] = num(r[k]);
  out.suggestions = out.suggestions ?? 0;
  out.flags = typeof r.flags === 'string' ? r.flags : '';
  out.search_text = typeof r.search_text === 'string' ? r.search_text : '';
  return out as unknown as ProjectRow;
}

export interface FilterSummary {
  n: number;
  nep_rows: number;
  nep_php: number | null;
  hgab2_rows: number;
  hgab2_php: number | null;
  hgab3_rows: number;
  hgab3_php: number | null;
}

export function coerceSummary(r: Record<string, unknown> | undefined): FilterSummary {
  return {
    n: num(r?.n) ?? 0,
    nep_rows: num(r?.nep_rows) ?? 0,
    nep_php: num(r?.nep_php),
    hgab2_rows: num(r?.hgab2_rows) ?? 0,
    hgab2_php: num(r?.hgab2_php),
    hgab3_rows: num(r?.hgab3_rows) ?? 0,
    hgab3_php: num(r?.hgab3_php),
  };
}

export function coerceFacets(rows: Record<string, unknown>[]): FacetRow[] {
  return rows
    .map((r) => ({ dim: String(r.dim) as FacetRow['dim'], value: String(r.value ?? ''), n: num(r.n) ?? 0 }))
    .filter((r) => r.value !== '');
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const CSV_COLUMNS: ReadonlyArray<{ key: string; pick: (r: ProjectRow, dataset: DatasetKey) => unknown }> = [
  { key: 'id', pick: (r) => r.id },
  { key: 'dataset', pick: (_r, d) => d },
  { key: 'title', pick: (r) => r.title },
  { key: 'program', pick: (r) => r.program },
  { key: 'pap', pick: (r) => r.pap },
  { key: 'region', pick: (r) => r.region },
  { key: 'office', pick: (r) => r.office },
  { key: 'office_kind', pick: (r) => r.office_kind },
  { key: 'zone', pick: (r) => r.zone },
  { key: 'trace', pick: (r) => r.trace },
  { key: 'status_label', pick: (r) => traceInfo(r.trace).label },
  { key: 'bridge_group', pick: (r) => traceInfo(r.trace).group },
  { key: 'held', pick: (r) => (traceInfo(r.trace).held ? 'yes' : '') },
  { key: 'house_match', pick: (r) => r.house_match },
  { key: 'reading_status', pick: (r) => r.reading_status },
  { key: 'api_presence', pick: (r) => r.api_presence },
  { key: 'confidence', pick: (r) => r.confidence },
  { key: 'nep_php', pick: (r) => r.nep_php },
  { key: 'hgab2_php', pick: (r) => r.hgab2_php },
  { key: 'hgab3_php', pick: (r) => r.hgab3_php },
  { key: 'api_php', pick: (r) => r.api_php },
  { key: 'delta_house_minus_nep_php', pick: (r) => r.delta_php },
  { key: 'nep_page', pick: (r) => r.nep_page },
  { key: 'hgab2_page', pick: (r) => r.hgab2_page },
  { key: 'hgab3_page', pick: (r) => r.hgab3_page },
  { key: 'nep_doc', pick: (r) => r.nep_doc },
  { key: 'hgab2_doc', pick: (r) => r.hgab2_doc },
  { key: 'hgab3_doc', pick: (r) => r.hgab3_doc },
  { key: 'length_m', pick: (r) => r.length_m },
  { key: 'flags', pick: (r) => r.flags },
  { key: 'suggestions', pick: (r) => r.suggestions },
];

function csvCell(v: unknown): string {
  // Null is blank, never 0: an absent stage is not a zero allocation.
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'bigint') return v.toString();
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Exact pesos, one column per stage, blank for null. */
export function projectsCsv(rows: readonly ProjectRow[], dataset: DatasetKey): string {
  const head = CSV_COLUMNS.map((c) => c.key).join(',');
  const body = rows.map((r) => CSV_COLUMNS.map((c) => csvCell(c.pick(r, dataset))).join(','));
  return [head, ...body].join('\n');
}
