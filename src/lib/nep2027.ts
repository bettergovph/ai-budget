/**
 * Data layer for the FY2027 NEP microsite (`/2027`).
 *
 * Everything here reads the tree produced by `npm run import:nep2027`
 * (`data/2027/…`), which is served from `VITE_DATA_BASE_URL` in production and
 * from the `public/data` symlink in dev — same resolution as the GAA portal.
 *
 * Amounts in `national/index.json` and each `<dept>/summary.json` are already
 * in PESOS. The deeper entity JSONs (`objects.json` etc.) stay in the source
 * scale (thousands) and are only reached through DuckDB/parquet, so the UI
 * never has to reason about mixed scales.
 */
import { dataUrl } from './data-url';

export const NEP_YEAR = 2027;
export const BASE_YEAR = 2026;

/** A rollup row: FY2027 NEP against the FY2026 GAA baseline. */
export interface NepRollupRow {
  code: string;
  description: string;
  count: number;
  amount: number;
  base_amount: number;
  delta: number;
  pct?: number | null;
  /** `major_class` for programs; null for every other dimension. */
  extra?: string | null;
  major_class?: string | null;
  department_id?: string;
  department?: string;
}

export interface NepDeptRow {
  id: string;
  slug: string;
  description: string;
  source_description: string | null;
  section: string;
  source_department_code: string | null;
  line_items: number;
  amount: number;
  base_amount: number;
  delta: number;
  pct: number | null;
}

export interface NepNationalIndex {
  generated_at: string;
  fiscal_year: number;
  baseline_year: number;
  scale: 'pesos';
  source?: string;
  source_file: string;
  national: { line_items: number; amount: number; base_amount: number };
  departments: NepDeptRow[];
  expense_classes: NepRollupRow[];
  fund_subcategories: NepRollupRow[];
  regions: NepRollupRow[];
  sections: NepRollupRow[];
  top_programs: Array<NepRollupRow & { department_id: string; agency?: string }>;
  top_movers_up: NepDeptRow[];
  top_movers_down: NepDeptRow[];
}

export interface NepDeptSummary {
  generated_at: string | null;
  fiscal_year: number;
  baseline_year: number;
  scale: 'pesos';
  department: NepDeptRow | null;
  counts: {
    agencies: number;
    programs: number;
    activities: number;
    operating_units: number;
    objects: number;
    regions: number;
  } | null;
  agencies: NepRollupRow[];
  expense_classes: NepRollupRow[];
  fund_subcategories: NepRollupRow[];
  regions: NepRollupRow[];
  programs: NepRollupRow[];
  top_objects: NepRollupRow[];
  top_operating_units: NepRollupRow[];
  top_divisions: NepRollupRow[];
  top_movers_up: NepRollupRow[];
  top_movers_down: NepRollupRow[];
}

/**
 * The data host the browser is configured to read from, or null when assets
 * come from the local `public/data` tree.
 *
 * The FY2027 tree is generated locally and has to be published separately, so
 * a 404 here usually means "VITE_DATA_BASE_URL points at a host that has the
 * GAA data but not `2027/` yet" — not "the import never ran". `NepError` uses
 * this to tell those two cases apart instead of guessing.
 */
export const DATA_BASE_OVERRIDE =
  (import.meta.env.VITE_DATA_BASE_URL as string | undefined)?.trim() || null;

async function getJson<T>(url: string, hint: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) detail = ` — ${body.message}`;
    } catch { /* non-JSON error body */ }
    throw new Error(`${hint} — HTTP ${res.status} for ${url}${detail}`);
  }
  return (await res.json()) as T;
}

const indexCache = new Map<string, Promise<unknown>>();
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  let p = indexCache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = load();
    indexCache.set(key, p as Promise<unknown>);
    // Don't poison the cache with a rejected promise — let a retry re-fetch.
    p.catch(() => indexCache.delete(key));
  }
  return p;
}

/**
 * Aggregations come live from D1 via the Worker; line items stay in parquet.
 *
 * The rollups are small, need to be fast, and — critically — need to be
 * queryable *across* departments, which per-department parquet cannot do
 * without fetching 39 files. The line-item scans stay client-side because D1
 * bills rows read and a full-department GROUP BY scans 100k-330k rows per
 * query, versus roughly a second in the browser at no marginal cost.
 *
 * `data/2027/**.json` is still produced by the importer and remains the
 * offline/reproducible copy of the same numbers; the site just no longer
 * reads it.
 */
export function loadNepIndex(): Promise<NepNationalIndex> {
  return cached('index', () =>
    getJson<NepNationalIndex>('/api/nep2027/national', 'Failed to load the FY2027 NEP index'),
  );
}

export function loadNepDept(deptId: string): Promise<NepDeptSummary> {
  return cached(`dept:${deptId}`, () =>
    getJson<NepDeptSummary>(
      `/api/nep2027/dept/${encodeURIComponent(deptId)}`,
      `Failed to load FY2027 NEP department ${deptId}`,
    ),
  );
}

/**
 * One dimension rolled up across every department, or one code broken down by
 * department when `code` is given. Exact, because every dimension in
 * `nep_rollups` is complete rather than top-N.
 */
export function loadNepRollup(
  dimension: string,
  opts: { code?: string; limit?: number } = {},
): Promise<{ dimension: string; data: NepRollupRow[] }> {
  const p = new URLSearchParams();
  if (opts.code) { p.set('by', 'department'); p.set('code', opts.code); }
  if (opts.limit) p.set('limit', String(opts.limit));
  const qs = p.toString();
  return getJson(
    `/api/nep2027/rollup/${dimension}${qs ? `?${qs}` : ''}`,
    `Failed to load FY2027 ${dimension} rollup`,
  );
}

/** Absolute URL of a department's FY2027 line-item parquet (for DuckDB-Wasm). */
export function lineItemsUrl(deptId: string): string {
  const u = dataUrl(`2027/${deptId}/line_items.parquet`);
  return u.startsWith('http') ? u : `${window.location.origin}${u}`;
}

/** Percent change, or null when there is no FY2026 baseline to divide by. */
export function pctChange(amount: number, base: number): number | null {
  if (!base) return null;
  return ((amount - base) / base) * 100;
}

export function formatPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

/** Departments the importer synthesizes out of the SORDER=2 rows. */
export const SYNTHETIC_DEPTS: Record<string, string> = {
  SPF: 'Special Purpose Funds carved out of the rows the source files under department code 01.',
  AUTO: 'Automatic appropriations carved out of the rows the source files under department code 04.',
};

export function isSynthetic(deptId: string): boolean {
  return deptId in SYNTHETIC_DEPTS;
}
