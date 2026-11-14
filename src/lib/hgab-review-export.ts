/**
 * Downloads from the project reviewer: reviews as the API payload (JSON), as the final status per review (the report),
 * or as rows of the volunteer team's workbook (CASE INTAKE & TRACKER, CASE EVIDENCE TEMPLATE). Browser only.
 */
import { REGISTRY, VERDICT_COLUMNS, caseEvidenceRows, caseIntakeRows, toCsv, verdictRows, type CaseReview } from './hgab-redflags-team';

export function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function downloadCases(cases: CaseReview[], kind: 'json' | 'verdicts' | 'cases' | 'evidence', stem: string) {
  if (kind === 'json') download(`${stem}.json`, JSON.stringify(cases, null, 2), 'application/json');
  else if (kind === 'verdicts') download(`${stem}-final-status.csv`, toCsv(VERDICT_COLUMNS, cases.flatMap(verdictRows)), 'text/csv;charset=utf-8');
  else if (kind === 'cases') download(`${stem}-case-intake.csv`, toCsv(REGISTRY.case_columns, cases.flatMap(caseIntakeRows)), 'text/csv;charset=utf-8');
  else download(`${stem}-case-evidence.csv`, toCsv(REGISTRY.evidence_columns, cases.flatMap(caseEvidenceRows)), 'text/csv;charset=utf-8');
}
