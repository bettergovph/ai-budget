/**
 * What every page of the team's report shares (src/pages/HgabReviewReport.tsx): the project list (review.json), the
 * members' reviews from the Worker, and each project's place in the report. The shell loads them once; the pages read
 * them with useReport().
 */
import { createContext, useContext } from 'react';
import type { ReviewIndex } from './hgab-documents';
import type { ReviewProject } from './hgab-review';
import type { ProjectGroup, ReportProject, ReportResponse } from './hgab-review-report';

export type ReviewsLoad = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; res: ReportResponse };

export interface ReportData {
  index: ReviewIndex;
  all: ReviewProject[];
  byId: ReadonlyMap<string, ReviewProject>;
  /** The members' reviews; while they load or if they fail, the report shows the automatic review only. */
  reviews: ReviewsLoad;
  reload: () => void;
  /** Projects members reviewed, and those only the automatic review marked (reportProjects with the automatic ones). */
  rows: ReportProject[];
  rowById: ReadonlyMap<string, ReportProject>;
  names: ReadonlyMap<string, string>;
  groupOf: (hgabId: string) => ProjectGroup;
}

export const ReportDataContext = createContext<ReportData | null>(null);
export function useReport(): ReportData {
  const v = useContext(ReportDataContext);
  if (!v) throw new Error('useReport outside the report');
  return v;
}
