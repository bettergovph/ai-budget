/**
 * Downloads from the project reviewer: the signed-in member's reviews, one row each with its final status (the report).
 * Browser only.
 */
import { VERDICT_COLUMNS, toCsv, verdictRows, type CaseReview } from './hgab-redflags-team';

export function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Reviews as CSV (UTF-8 with BOM): project, office, region, amount, final status, reviewer, checks with an outcome, notes, date. */
export function downloadReviews(cases: CaseReview[], stem: string) {
  download(`${stem}.csv`, toCsv(VERDICT_COLUMNS, cases.flatMap(verdictRows)), 'text/csv;charset=utf-8');
}
