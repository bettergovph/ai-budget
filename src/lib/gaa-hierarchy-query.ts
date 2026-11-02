// Names and codes stay within their published year; no cross-year ID mapping.
export const HISTORICAL_LEVELS = [
  { label: 'Groups', code: 'NULL::VARCHAR', name: 'department_dsc' },
  { label: 'Bureaus', code: 'agency_code', name: 'agency_dsc' },
  {
    label: 'Programs (FPAPs)',
    code: 'coalesce(fpap_code, program_code)',
    name: 'coalesce(fpap_dsc, program_dsc)',
  },
  { label: 'Operating Units', code: 'operunit_code', name: 'operunit_dsc' },
  { label: 'Funds', code: 'fund_code', name: 'fund_dsc' },
  { label: 'Expense Classes', code: 'expense_code', name: 'expense_dsc' },
  { label: 'Objects', code: 'object_code', name: 'object_dsc' },
] as const;
export interface HistoricalBranch {
  level: number;
  code: string | null;
  name: string | null;
}
export function parseHistoricalBranch(raw: string | null): HistoricalBranch[] {
  if (!raw) return [];
  const path: unknown = JSON.parse(raw);
  if (!Array.isArray(path) || path.length > HISTORICAL_LEVELS.length)
    throw new Error('Invalid hierarchy path.');
  let previous = -1;
  for (const part of path) {
    if (
      !part ||
      !Number.isInteger(part.level) ||
      part.level <= previous ||
      part.level >= HISTORICAL_LEVELS.length ||
      (part.code !== null && typeof part.code !== 'string') ||
      (part.name !== null && typeof part.name !== 'string')
    )
      throw new Error('Invalid hierarchy path.');
    previous = part.level;
  }
  return path;
}
export function historicalWhere(scope: string, path: HistoricalBranch[]) {
  const clauses = ['budget_scope = ?'];
  const params: (string | number | null)[] = [scope];
  for (const part of path) {
    const level = HISTORICAL_LEVELS[part.level];
    if (!level) throw new Error('Invalid hierarchy level.');
    clauses.push(
      `${level.code} IS NOT DISTINCT FROM ?`,
      `${level.name} IS NOT DISTINCT FROM ?`,
    );
    params.push(part.code, part.name);
  }
  return { where: clauses.join(' AND '), params };
}
export function historicalStatsQuery(
  url: string,
  scope: string,
  path: HistoricalBranch[],
) {
  const { where, params } = historicalWhere(scope, path);
  const available = HISTORICAL_LEVELS.map(
    (l, i) =>
      `count(*) FILTER (WHERE ${l.code} IS NOT NULL OR ${l.name} IS NOT NULL) AS level_${i}`,
  );
  return {
    sql: `SELECT count(*) AS records, sum(amount) AS amount, ${available.join(', ')} FROM read_parquet('${url.replaceAll("'", "''")}') WHERE ${where}`,
    params,
  };
}
export function historicalChildrenQuery(
  url: string,
  scope: string,
  path: HistoricalBranch[],
  child: number,
) {
  const { where, params } = historicalWhere(scope, path);
  const level = HISTORICAL_LEVELS[child];
  if (!level) throw new Error('Invalid hierarchy level.');
  return {
    sql: `SELECT ${level.code} AS code, ${level.name} AS name, sum(amount) AS amount, count(*) AS records FROM read_parquet('${url.replaceAll("'", "''")}') WHERE ${where} GROUP BY 1, 2 ORDER BY amount DESC, name NULLS LAST, code NULLS LAST`,
    params,
  };
}
