import type {
  Agency,
  DeptData,
  Department,
  Expense,
  ExpenseClassBreakdown,
  ExpenseClassMeta,
  FPAP,
  FPAPFamily,
  Fund,
  MoverEntry,
  ObjectItem,
  OperatingUnit,
  RawDataset,
  YearData,
  YearMap,
  YearlyTotalRow,
} from './types';
import { dataDeptUrl } from './data-url';
import { loadManifest, parquetUrls, runQuery, type ParquetManifest } from './duckdb';

export const YEARS: number[] = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
const SCALE = 1000;

/**
 * Three-stage progressive load:
 *   A · core (always upfront)     — departments + yearly + agencies        (~10 KB, JSON)
 *   B · mid  (auto unless heavy)  — fpaps + op_units + fund_sub + expenses (parquet)
 *   C · objects (on demand)       — objects                                (parquet)
 *
 * Stage A is small enough to stay JSON. Stages B and C query Hive-partitioned
 * parquet via DuckDB-WASM and reshape the rows back into the existing
 * RawDataset<T> shape so the rest of this module (rescale, aggregations,
 * Portal components) is unchanged.
 *
 * Heavy departments still get a gate — DPWH (18) has ~80 MB of Stage B
 * parquet which is OK on broadband but worth confirming before firing.
 */
const HEAVY_MID_DEPTS = new Set<string>(['18']);
const SKIP_EXPENSES = new Set<string>([]);
/**
 * Depts whose objects parquet aggregates to so many rows (DepEd ~995k, DPWH
 * ~?) that materialising them as a JS array locks the main thread on
 * filter/sort even with pagination. Require explicit opt-in until the
 * Objects view is refactored to issue per-page SQL queries.
 */
const HEAVY_OBJECTS_DEPTS = new Set<string>(['07', '18']);

const MID_SIZE_HINT_MB: Record<string, number> = {
  '18': 80,
};
const OBJECT_SIZE_HINT_MB: Record<string, number> = {
  '07': 125,
  '18': 50,
};

export function isMidHeavy(deptId: string): boolean {
  return HEAVY_MID_DEPTS.has(deptId);
}
export function isObjectsHeavy(deptId: string): boolean {
  return HEAVY_OBJECTS_DEPTS.has(deptId);
}
export function midSizeHintMb(deptId: string): number | undefined {
  return MID_SIZE_HINT_MB[deptId];
}
export function objectsSizeHintMb(deptId: string): number | undefined {
  return OBJECT_SIZE_HINT_MB[deptId];
}

export const EXPENSE_CLASS: Record<string, ExpenseClassMeta> = {
  '1': { key: 'PS', label: 'Personnel Services', color: 'var(--ec-ps)' },
  '2': { key: 'MOOE', label: 'Maintenance & Operating', color: 'var(--ec-mooe)' },
  '3': { key: 'FE', label: 'Financial Expenses', color: 'var(--ec-fe)' },
  '4': { key: 'CO', label: 'Capital Outlays', color: 'var(--ec-co)' },
  '5': { key: 'CO', label: 'Capital Outlays', color: 'var(--ec-co)' },
};

export function normName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

async function loadJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error('Failed to load ' + path);
  return (await r.json()) as T;
}

/**
 * Selects between the D1-backed Worker API (default) and the legacy
 * parquet/DuckDB-WASM path (opt-in via `?source=parquet`). Read at every
 * loader call so a user can flip between sources without a full reload.
 *
 * Keeping the parquet path alive as a fallback (rather than ripping it out)
 * lets us compare load times on the same dept and gives us a known-good
 * escape hatch if D1 misbehaves for a specific department.
 */
function useD1Source(): boolean {
  if (typeof window === 'undefined') return true;
  return new URLSearchParams(window.location.search).get('source') !== 'parquet';
}

interface D1CoreResponse {
  departments: RawDataset<Department>;
  yearly_totals: RawDataset<{ year: number; count: number; amount: number }>;
  agencies: RawDataset<Agency>;
}

interface D1MidResponse {
  fpaps: RawDataset<FPAP>;
  operating_units: RawDataset<OperatingUnit>;
  fund_subcategories: RawDataset<Fund>;
  expenses: RawDataset<Expense>;
}

async function fetchD1<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`D1 API ${path} returned ${r.status}`);
  return (await r.json()) as T;
}

/**
 * Server-side filter+sort+paginate for the Objects view. See the Worker's
 * /api/dept/:id/objects/page route. The page payload is intentionally small
 * (~100-200 KB even for DepEd) so this is cheap to call on every filter/
 * sort/cursor change.
 */
export interface ObjectsPageQuery {
  year?: number;
  /** agency_id; null/undefined = all */
  bureau?: string | null;
  /** expense code suffix; null/undefined = all */
  expense?: string | null;
  /** free-text search across description / object_code / slug */
  q?: string;
  sort?: 'amount' | 'description' | 'code' | 'total';
  dir?: 'asc' | 'desc';
  cursor?: string | null;
  limit?: number;
}

export interface ObjectsPageResult {
  data: ObjectItem[];
  /** Opaque base64 cursor; null when there are no more pages. */
  nextCursor: string | null;
  /** Only populated on the first page (no input cursor); null on subsequent pages. */
  summary: { count: number; sum: number } | null;
  /** Echo of metadata so the caller can correlate (e.g. validate matching year). */
  meta: { year: number; sort: 'amount' | 'description' | 'code' | 'total'; dir: 'asc' | 'desc'; limit: number };
}

interface RawObjectsPageResponse {
  metadata: { department_id: string; year: number; sort: 'amount' | 'description' | 'code' | 'total'; dir: 'asc' | 'desc'; limit: number };
  data: ObjectItem[];
  next_cursor: string | null;
  summary: { count: number; sum: number } | null;
}

export async function fetchObjectsPage(deptId: string, q: ObjectsPageQuery = {}): Promise<ObjectsPageResult> {
  const sp = new URLSearchParams();
  if (q.year != null) sp.set('year', String(q.year));
  if (q.bureau) sp.set('bureau', q.bureau);
  if (q.expense) sp.set('expense', q.expense);
  if (q.q) sp.set('q', q.q);
  if (q.sort) sp.set('sort', q.sort);
  if (q.dir) sp.set('dir', q.dir);
  if (q.cursor) sp.set('cursor', q.cursor);
  if (q.limit != null) sp.set('limit', String(q.limit));
  const qs = sp.toString();
  const path = `/api/dept/${deptId}/objects/page${qs ? '?' + qs : ''}`;

  const resp = await fetchD1<RawObjectsPageResponse>(path);
  // Apply the same SCALE multiplier (×1000) and NaN-row drop the legacy
  // parquet loader applies, so caller-side code (sorts, totals) sees pesos
  // not "thousands" and never hits the source's sentinel rows.
  const rescaled = resp.data.filter((o) => !isNan(o)).map(rescale);
  return {
    data: rescaled,
    nextCursor: resp.next_cursor,
    summary: resp.summary
      ? { count: resp.summary.count, sum: resp.summary.sum * SCALE }
      : null,
    meta: { year: resp.metadata.year, sort: resp.metadata.sort, dir: resp.metadata.dir, limit: resp.metadata.limit },
  };
}

/**
 * Per-table parquet metadata: which `*_code` column the table has and which
 * foreign-key columns to project. Used to rebuild RawDataset<T> from the
 * year-unpivoted parquet rows.
 */
interface TableSpec {
  codeCol: string;
  fkCols: ReadonlyArray<string>;
}
const TABLE_SPECS: Record<string, TableSpec> = {
  fpaps: { codeCol: 'fpap_code', fkCols: ['agency_id'] },
  operating_units: { codeCol: 'operunit_code', fkCols: ['fpap_id', 'agency_id'] },
  fund_subcategories: {
    codeCol: 'fund_code',
    fkCols: ['operating_unit_id', 'fpap_id', 'agency_id'],
  },
  expenses: {
    codeCol: 'expense_code',
    fkCols: ['fund_id', 'operating_unit_id', 'fpap_id', 'agency_id'],
  },
  objects: {
    codeCol: 'object_code',
    fkCols: ['expense_id', 'fund_id', 'operating_unit_id', 'fpap_id', 'agency_id'],
  },
};

interface AggregatedRow {
  id: string;
  slug: string;
  code: string;
  description: string;
  department_id: string;
  [yearOrFk: string]: unknown;
}

/**
 * Query the year-partitioned parquet tree for a single table and reshape
 * the rows back into the JSON `RawDataset<T>` envelope that the rest of
 * this module already knows how to consume. One row per `id` with each
 * canonical year projected as flat `amount_YYYY` / `count_YYYY` columns —
 * conditional aggregates instead of LIST<STRUCT>, which avoids Apache
 * Arrow's nested-type serialization in the wasm bridge.
 */
async function loadParquetTable<T>(
  deptId: string,
  table: keyof typeof TABLE_SPECS,
  manifest: ParquetManifest,
): Promise<RawDataset<T>> {
  const spec = TABLE_SPECS[table];
  const urls = parquetUrls(deptId, table, manifest);
  const fkSelect = spec.fkCols
    .map((c) => `ANY_VALUE(${c}) AS ${c}`)
    .join(',\n      ');
  const yearAggs = YEARS.flatMap((y) => [
    `SUM(amount) FILTER (WHERE year = ${y}) AS amount_${y}`,
    `SUM(count)  FILTER (WHERE year = ${y}) AS count_${y}`,
  ]).join(',\n      ');
  const sql = `
    SELECT
      id,
      ANY_VALUE(slug) AS slug,
      ANY_VALUE(code) AS code,
      ANY_VALUE(description) AS description,
      ${fkSelect}${spec.fkCols.length ? ',' : ''}
      ANY_VALUE(department_id) AS department_id,
      ${yearAggs}
    FROM read_parquet(${urls}, hive_partitioning = true)
    GROUP BY id
  `;
  const t0 = performance.now();
  console.log(`[parquet] dept ${deptId} / ${table}: query begin`);
  const { rows, ms } = await Promise.race([
    runQuery<AggregatedRow>(sql),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Query timeout (90s) for ${deptId}/${table}`)),
        90_000,
      ),
    ),
  ]);
  console.log(
    `[parquet] dept ${deptId} / ${table}: ${rows.length} rows in ${ms.toFixed(0)} ms (wall ${(performance.now() - t0).toFixed(0)} ms)`,
  );
  const data = rows.map((r) => {
    const years: YearMap = {};
    for (const y of YEARS) {
      const a = r[`amount_${y}`];
      const c = r[`count_${y}`];
      if (a == null && c == null) continue;
      years[y] = {
        count: c == null ? 0 : typeof c === 'bigint' ? Number(c) : (c as number),
        amount: a == null ? 0 : (a as number),
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: any = {
      id: r.id,
      slug: r.slug,
      [spec.codeCol]: r.code,
      description: r.description,
      department_id: r.department_id,
      years,
    };
    for (const c of spec.fkCols) row[c] = r[c];
    return row as T;
  });
  console.log(
    `[parquet] dept ${deptId} / ${table}: reshaped ${data.length} rows in ${(performance.now() - t0).toFixed(0)} ms total`,
  );
  return { data };
}

function emptyYearMap(): YearMap {
  const m: YearMap = {};
  YEARS.forEach((y) => (m[y] = { count: 0, amount: 0 }));
  return m;
}

function rescale<T extends { years: YearMap }>(rec: T): T {
  const out: T = { ...rec, years: emptyYearMap() };
  YEARS.forEach((y) => {
    const src = rec.years as Record<string | number, YearData | undefined>;
    const s = src[y] || src[String(y)];
    if (s) {
      out.years[y].count = s.count || 0;
      out.years[y].amount = (s.amount || 0) * SCALE;
    }
  });
  return out;
}

function isNan(rec: { description?: string; slug?: string }): boolean {
  return (rec.description || '').toLowerCase() === 'nan' || (rec.slug || '') === 'nan';
}

export function totalOver(rec: { years: YearMap }, years: number[] = YEARS): number {
  return years.reduce((s, y) => s + (rec.years[y]?.amount || 0), 0);
}

export function maxOver(rec: { years: YearMap }, years: number[] = YEARS): number {
  return Math.max(...years.map((y) => rec.years[y]?.amount || 0));
}

function deptUrl(deptId: string, file: string): string {
  return `${dataDeptUrl(deptId)}/${file}`;
}

function emptyExpenseClassByYear(): Record<number, ExpenseClassBreakdown> {
  const out: Record<number, ExpenseClassBreakdown> = {};
  YEARS.forEach((y) => (out[y] = { PS: 0, MOOE: 0, CO: 0, FE: 0 }));
  return out;
}

/**
 * Stage A. Loads just enough to render the masthead, KPI strip, trend chart,
 * ByYear view, and the top level of the Hierarchy view. The remaining
 * arrays/maps come back empty and are populated by `loadDeptMidInto` and
 * `loadDeptObjectsInto`.
 */
export async function loadDeptData(deptId: string): Promise<DeptData> {
  let departments: RawDataset<Department>;
  let yearly: RawDataset<{ year: number; count: number; amount: number }>;
  let agencies: RawDataset<Agency>;

  if (useD1Source()) {
    const r = await fetchD1<D1CoreResponse>(`/api/dept/${deptId}/core`);
    departments = r.departments;
    yearly = r.yearly_totals;
    agencies = r.agencies;
  } else {
    const url = (p: string) => deptUrl(deptId, p);
    [departments, yearly, agencies] = await Promise.all([
      loadJson<RawDataset<Department>>(url('departments.json')),
      loadJson<RawDataset<{ year: number; count: number; amount: number }>>(url('yearly_totals.json')),
      loadJson<RawDataset<Agency>>(url('agencies.json')),
    ]);
  }

  const dept = departments.data[0];
  const deptTotal: Record<number, YearData> = {};
  yearly.data.forEach((r) => {
    deptTotal[r.year] = { count: r.count, amount: r.amount * SCALE };
  });

  const agencyArr: Agency[] = agencies.data.filter((a) => !isNan(a)).map(rescale);
  const agencyById: Record<string, Agency> = Object.fromEntries(agencyArr.map((a) => [a.id, a]));

  const yearlyOut: YearlyTotalRow[] = yearly.data.map((r) => ({
    year: r.year,
    count: r.count,
    amount: r.amount * SCALE,
  }));

  return {
    YEARS,
    EXPENSE_CLASS,

    department: {
      id: dept?.id ?? deptId,
      description: dept?.description ?? `Department ${deptId}`,
      years: deptTotal,
    },
    yearly: yearlyOut,

    agencies: agencyArr,
    agencyById,

    fpaps: [],
    fpapById: {},
    fpapsByAgency: {},
    fpapFamilies: [],

    opUnits: [],
    opUnitById: {},
    funds: [],
    fundById: {},
    objects: [],
    expenses: [],

    expenseClassByYear: emptyExpenseClassByYear(),
    expenseClassByAgencyYear: {},

    midLoaded: false,
    objectsLoaded: false,
    expensesSkipped: false,

    total: (y: number) => deptTotal[y]?.amount || 0,
    totalOver,
    maxOver,
    normName,
    topMovers: () => [],
  };
}

/**
 * Stage B. Queries fpaps/operating_units/fund_subcategories/expenses from
 * the dept's Hive-partitioned parquet tree, reshapes back into the
 * RawDataset<T> envelope, then computes the mid-level derivatives
 * (fpapFamilies, fpapsByAgency, expense-class breakdowns, topMovers).
 */
export async function loadDeptMidInto(data: DeptData, deptId: string): Promise<DeptData> {
  const skipExpenses = SKIP_EXPENSES.has(deptId);

  let fpapsRaw: RawDataset<FPAP>;
  let opUnitsRaw: RawDataset<OperatingUnit>;
  let fundsRaw: RawDataset<Fund>;
  let expensesRaw: RawDataset<Expense>;

  const loadViaParquet = async () => {
    const manifest = await loadManifest(deptId);
    return Promise.all([
      loadParquetTable<FPAP>(deptId, 'fpaps', manifest),
      loadParquetTable<OperatingUnit>(deptId, 'operating_units', manifest),
      loadParquetTable<Fund>(deptId, 'fund_subcategories', manifest),
      skipExpenses
        ? Promise.resolve<RawDataset<Expense>>({ data: [] })
        : loadParquetTable<Expense>(deptId, 'expenses', manifest),
    ]);
  };

  if (useD1Source()) {
    try {
      const r = await fetchD1<D1MidResponse>(`/api/dept/${deptId}/mid`);
      fpapsRaw = r.fpaps;
      opUnitsRaw = r.operating_units;
      fundsRaw = r.fund_subcategories;
      expensesRaw = skipExpenses ? { data: [] } : r.expenses;
    } catch (e) {
      // The largest departments (DPWH's Stage B is hundreds of thousands of
      // rows) can push the Worker past its CPU/memory limits — Cloudflare
      // error 1102 — before the response finishes. The browser has no such
      // limit, and the same tables live as year-partitioned parquet on the
      // data host, so fall through to the DuckDB path instead of surfacing
      // an error the user cannot act on.
      console.warn(
        `[dept-data] D1 mid failed for dept ${deptId}; falling back to parquet`,
        e,
      );
      [fpapsRaw, opUnitsRaw, fundsRaw, expensesRaw] = await loadViaParquet();
    }
  } else {
    [fpapsRaw, opUnitsRaw, fundsRaw, expensesRaw] = await loadViaParquet();
  }

  const fpapArr: FPAP[] = fpapsRaw.data
    .filter((f) => !isNan(f))
    .map(rescale)
    .filter((f) => totalOver(f) > 0);
  const fpapById: Record<string, FPAP> = Object.fromEntries(fpapArr.map((f) => [f.id, f]));

  const fpapsByAgency: Record<string, FPAP[]> = {};
  fpapArr.forEach((f) => {
    (fpapsByAgency[f.agency_id] ||= []).push(f);
  });

  const fpapFamiliesArr: FPAPFamily[] = [];
  {
    const byKey: Record<string, FPAPFamily> = {};
    fpapsRaw.data
      .filter((f) => !isNan(f))
      .forEach((f) => {
        const key = f.agency_id + '|' + normName(f.description);
        if (!byKey[key]) {
          byKey[key] = {
            key,
            agency_id: f.agency_id,
            name: f.description,
            ids: [],
            years: emptyYearMap(),
          };
        }
        byKey[key].ids.push(f.id);
        YEARS.forEach((y) => {
          const src = f.years as Record<string | number, YearData | undefined>;
          const s = src[y] || src[String(y)];
          if (s) {
            byKey[key].years[y].count += s.count || 0;
            byKey[key].years[y].amount += (s.amount || 0) * SCALE;
          }
        });
      });
    Object.values(byKey).forEach((fam) => {
      if (totalOver(fam) > 0) fpapFamiliesArr.push(fam);
    });
  }

  const expenseArr: Expense[] = expensesRaw.data.filter((e) => !isNan(e)).map(rescale);

  const expenseClassByAgencyYear: Record<string, Record<number, ExpenseClassBreakdown>> = {};
  const expenseClassByYear = emptyExpenseClassByYear();

  expenseArr.forEach((e) => {
    const cls = EXPENSE_CLASS[e.expense_code]?.key;
    if (!cls) return;
    const a = e.agency_id;
    if (!expenseClassByAgencyYear[a]) {
      expenseClassByAgencyYear[a] = {};
      YEARS.forEach((y) => (expenseClassByAgencyYear[a][y] = { PS: 0, MOOE: 0, CO: 0, FE: 0 }));
    }
    YEARS.forEach((y) => {
      const v = e.years[y]?.amount || 0;
      expenseClassByAgencyYear[a][y][cls] += v;
      expenseClassByYear[y][cls] += v;
    });
  });

  const opUnitArr: OperatingUnit[] = opUnitsRaw.data.filter((o) => !isNan(o)).map(rescale);
  const opUnitById: Record<string, OperatingUnit> = Object.fromEntries(opUnitArr.map((o) => [o.id, o]));

  const fundArr: Fund[] = fundsRaw.data.filter((o) => !isNan(o)).map(rescale);
  const fundById: Record<string, Fund> = Object.fromEntries(fundArr.map((o) => [o.id, o]));

  function topMovers(
    direction: 'up' | 'down' = 'up',
    year = 2026,
    prev = 2025,
    n = 6,
  ): MoverEntry[] {
    const moves: MoverEntry[] = fpapFamiliesArr.map((fam) => ({
      fam,
      delta: (fam.years[year]?.amount || 0) - (fam.years[prev]?.amount || 0),
    }));
    moves.sort((a, b) => (direction === 'up' ? b.delta - a.delta : a.delta - b.delta));
    return moves.slice(0, n);
  }

  return {
    ...data,
    fpaps: fpapArr,
    fpapById,
    fpapsByAgency,
    fpapFamilies: fpapFamiliesArr,
    opUnits: opUnitArr,
    opUnitById,
    funds: fundArr,
    fundById,
    expenses: expenseArr,
    expenseClassByYear,
    expenseClassByAgencyYear,
    midLoaded: true,
    expensesSkipped: skipExpenses,
    topMovers,
  };
}

/**
 * Stage C. Queries the objects parquet (the largest table — ~125 MB
 * partitioned for DepEd vs. 650 MB JSON) and returns a new DeptData with
 * `objects` populated. Called on-demand the first time the user enters the
 * Objects or Data view.
 */
export async function loadDeptObjectsInto(data: DeptData, deptId: string): Promise<DeptData> {
  let raw: RawDataset<ObjectItem>;
  if (useD1Source()) {
    raw = await fetchD1<RawDataset<ObjectItem>>(`/api/dept/${deptId}/objects`);
  } else {
    const manifest = await loadManifest(deptId);
    raw = await loadParquetTable<ObjectItem>(deptId, 'objects', manifest);
  }
  const objects: ObjectItem[] = raw.data.filter((o) => !isNan(o)).map(rescale);
  return { ...data, objects, objectsLoaded: true };
}
