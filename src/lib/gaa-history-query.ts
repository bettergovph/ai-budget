import { historicalWhere } from './gaa-hierarchy-query';
import type { HistoricalBranch } from './gaa-hierarchy-query';
export const GAA_PAGE_SIZE = 50;
export interface GaaRecordFilter {
  scope: string;
  branch?: HistoricalBranch[];
  department?: string | null;
  grain?: string;
  search?: string;
  page: number;
}
/** All user-controlled filters are bound values; only our escaped asset URL is SQL syntax. */
export function gaaRecordQuery(url: string, filter: GaaRecordFilter) {
  const base = historicalWhere(filter.scope, filter.branch ?? []);
  const clauses = [base.where];
  const params = base.params;
  if (filter.department !== undefined) {
    clauses.push('department_dsc IS NOT DISTINCT FROM ?');
    params.push(filter.department);
  }
  if (filter.grain) {
    clauses.push('grain = ?');
    params.push(filter.grain);
  }
  if (filter.search) {
    clauses.push(
      "contains(lower(concat_ws(' ', department_dsc, agency_dsc, fpap_dsc, program_dsc, operunit_dsc, fund_dsc, expense_dsc, object_dsc, source_text)), lower(?))",
    );
    params.push(filter.search);
  }
  const page =
    Number.isSafeInteger(filter.page) && filter.page > 0
      ? Math.min(filter.page, 1_000_000)
      : 1;
  params.push(GAA_PAGE_SIZE, (page - 1) * GAA_PAGE_SIZE);
  return {
    sql: `SELECT *, count(*) OVER () AS matched_rows FROM read_parquet('${url.replaceAll("'", "''")}') WHERE ${clauses.join(' AND ')} ORDER BY amount DESC, record_id LIMIT ? OFFSET ?`,
    params,
  };
}
