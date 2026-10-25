/**
 * Query builders for `<dataset>/projects.parquet` (the `/hgab` project tables).
 *
 * Pure functions, no React: the same strings the browser hands to DuckDB-Wasm
 * can be executed by `@duckdb/node-api` against the file on disk, which is how
 * they are tested. Every list query SELECTs by the names in `PROJECT_COLUMNS`;
 * `record_json` and `search_text` are never selected in a list.
 *
 * Filter state lives in the URL (`?view=projects&q=…&group=…&deo=…`) so a finding is
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
  /** Exact recorded `office` label — the Districts lens deep link (`deo=`). */
  deo: string;
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

/** Plain names for the sort keys, as the Projects tab's Sort menu prints them. */
export const SORT_LABELS: Record<SortKey, string> = {
  title: 'Project name',
  nep: 'Amount in the NEP',
  hgab2: 'House amount, 2nd reading',
  hgab3: 'House amount, 3rd reading',
  delta: 'Change from the NEP',
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
    deo: params.get('deo') ?? '',
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
  set('deo', f.deo);
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
    || f.officeKind || f.deo || f.zone || f.reading || f.flag,
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
 * them (DPWH, then the FMR / NIA / HFEP vocabularies). Unknown flags are
 * humanised rather than hidden. The raw code stays visible beside the label
 * on the record page, so an analyst can still search for it.
 */
export const FLAG_LABELS: Record<string, string> = {
  // DPWH
  house_only: 'House bill only · no match in the NEP',
  nep_only: 'NEP only · no match in the House bill',
  region_difference: 'Region differs between the two documents',
  office_difference: 'Office differs between the two documents',
  no_office: 'No office recorded',
  repeated_key: 'Repeated line · House lines grouped together',
  uncertain_match: 'Matched by a looser rule (road markers, place, scope or a close name)',
  nep_evidence_review: 'NEP amount still being checked against the scan',
  length_review: 'Road length was fixed or looks wrong',
  twin_review: 'Same name appears under another program line',
  nep_twin: 'NEP side of a same-name pair',
  segment_scope: 'Same road, a different stretch',
  transparency_gap: 'NEP line missing from the DPWH transparency website',
  outside_api: 'Not covered by the DPWH transparency website',
  group_exhausted: 'Grouped road · House lines with no NEP match in the group',
  group_nep_leftover: 'Grouped road · NEP lines left unmatched in the group',
  // FMR
  'method:title_and_coordinates': 'Matched on name and map coordinates',
  'method:title': 'Matched on name only',
  'method:coordinates': 'Matched on map coordinates only',
  ambiguous_title: 'Name appears more than once',
  coordinate_review: 'Published map coordinates need checking',
  // NIA
  'method:ai_corrected': 'Matched after an AI-assisted spelling fix',
  'strict:split_pair': 'Match holds only after the spelling fix',
  'near_miss:spelling_variant': 'Near miss · spelling differs',
  'near_miss:repeated_title': 'Near miss · name repeated',
  'near_miss:location_variant': 'Near miss · place differs',
  'near_miss:exact_variant': 'Near miss · same name, details differ',
  unresolved: 'No match, near miss noted',
  // HFEP
  column_added: 'Amount in the NEP, blank in the House bill',
  column_dropped: 'Amount in the House bill, blank in the NEP',
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
  title_and_coordinates: 'Matched on name and map coordinates',
  title: 'Matched on name',
  coordinates: 'Matched on map coordinates',
  ai_corrected: 'Matched after a spelling fix',
  title_similarity: 'Matched on a similar name',
};

/** `house_match` → plain label, DPWH vocabulary first, then the annex methods. */
export function matchLabel(v: string | null | undefined): string | null {
  if (!v) return null;
  return MATCH_LABELS[v] ?? ANNEX_MATCH_LABELS[v] ?? v.replace(/[_:]/g, ' ');
}

/**
 * What the `pap` column means per dataset, in plain words; null when the
 * dataset has none. DPWH's PAP (program, activity or project) is a "program
 * line"; HFEP's funding column is what the money pays for.
 */
export function papLabel(key: DatasetKey): string | null {
  switch (key) {
    case 'dpwh': return 'Program line';
    case 'nia': return 'Sub-program';
    case 'hfep': return 'What it pays for';
    default: return null;
  }
}

/** `zone` → plain label. */
export function zoneLabel(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v === 'local') return 'Locally funded';
  if (v === 'fap') return 'Foreign-assisted project';
  return v;
}

export function splitFlags(flags: string | null | undefined): string[] {
  return (flags ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** `api_presence` on DPWH rows: Transparency-listing coverage of the NEP side. */
export const API_PRESENCE_LABELS: Record<string, { label: string; help: string }> = {
  paired: { label: 'On the DPWH website', help: "The NEP line also appears on the DPWH transparency website's list." },
  nep_not_in_transparency: { label: 'Not on the DPWH website', help: "The NEP line is missing from the DPWH transparency website's list. That is a gap in the list, not proof that anything was hidden." },
  outside_api_scope: { label: 'Not covered by the DPWH website', help: 'The DPWH transparency website does not list this kind of project (mostly foreign-assisted ones).' },
  no_nep_anchor: { label: 'Nothing to check on the DPWH website', help: 'This line is only in the House bill, so there is no NEP line to look up on the DPWH website.' },
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
  if (f.region) {
    // A region can be printed more than one way (the farm-to-market lists use
    // upper and title case); the map links pass every spelling, "|"-separated.
    const labels = regionLabels(f.region);
    where.push(labels.length > 1 ? `region IN (${labels.map(sqlStr).join(', ')})` : `region = ${sqlStr(labels[0])}`);
  }
  if (f.program) where.push(`program = ${sqlStr(f.program)}`);
  if (f.pap) where.push(`pap = ${sqlStr(f.pap)}`);
  if (f.officeKind) where.push(`office_kind = ${sqlStr(f.officeKind)}`);
  if (f.deo) where.push(`office = ${sqlStr(f.deo)}`);
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

/** The printed region labels a `region=` filter value stands for ("A|B" → ["A", "B"]). */
export function regionLabels(value: string): string[] {
  return value.split('|').map((x) => x.trim()).filter(Boolean);
}

/** How a `region=` value reads in the select: one label as printed, or the first with "(all spellings)". */
export function regionFilterName(value: string): string {
  const labels = regionLabels(value);
  return labels.length > 1 ? `${labels[0]} (all spellings)` : value;
}
