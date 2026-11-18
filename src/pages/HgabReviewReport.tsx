/**
 * `/hgab/2027/review/report/*` — the team's report, the hand-over site: one page each (2026-11-18, until then one
 * long page) for the overview, the automatic red flags, the red flags and each one's projects, the documents, final
 * status by region, the questions, every project, and each project with its red flags, documents and reviews
 * (src/components/HgabReportPages.tsx). Downloads as CSV (one row per review, or per answer).
 *
 * Hidden: no menu or page links to it, it is not in the sitemap, and it is noindex. Open to anyone for now, with no
 * sign-in (Jason, 2026-11-17); the reviews come from the Worker (src/worker/hgab-reviews.ts), members by name, no
 * emails. Everything else is the public project list (documents/review.json). Logic: src/lib/hgab-review-report.ts.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { cached, getJson } from '../lib/hgab';
import { dataUrl } from '../lib/data-url';
import { REVIEW_INDEX_PATH, type ReviewIndex } from '../lib/hgab-documents';
import { REVIEW_ROOT, decodeIndex } from '../lib/hgab-review';
import { toCsv } from '../lib/hgab-redflags-team';
import {
  REPORT_ANSWER_COLUMNS, REPORT_API, REPORT_PAGES, REPORT_REVIEW_COLUMNS, REPORT_ROOT, REPORT_TITLE, answerRows, groupIndex, memberNames,
  reportPath, reportProjects, reviewRows, when,
} from '../lib/hgab-review-report';
import { ReportDataContext, type ReportData, type ReviewsLoad } from '../lib/hgab-report-data';
import { ReviewsApiError } from '../lib/hgab-review-api';
import { download } from '../lib/hgab-review-export';
import {
  AutomaticPage, ConditionPage, DocumentsPage, FlagsPage, NotFound, Overview, ProjectPage, ProjectsPage, QuestionsPage, RegionsPage,
} from '../components/HgabReportPages';
import '../hgab-review-report.css';

const loadIndex = () => cached('review-index', () => getJson<ReviewIndex>(dataUrl(`hgab/2027/${REVIEW_INDEX_PATH}`), 'Failed to load the project list'));

/** Keeps the page out of search results, beside the Worker's X-Robots-Tag. */
function useNoindex() {
  useEffect(() => {
    const m = Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex, nofollow' });
    document.head.appendChild(m);
    return () => { m.remove(); };
  }, []);
}

export default function HgabReviewReport() {
  useNoindex();
  const [reviews, setReviews] = useState<ReviewsLoad>({ state: 'loading' });
  const [index, setIndex] = useState<ReviewIndex | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  // Bumped to load the reviews again (Refresh, Try again).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(REPORT_API, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new ReviewsApiError(res.status, body as ConstructorParameters<typeof ReviewsApiError>[1]);
        if (live) setReviews({ state: 'ready', res: body as Extract<ReviewsLoad, { state: 'ready' }>['res'] });
      })
      .catch((e: unknown) => { if (live) setReviews({ state: 'error', message: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [tick]);
  // The project list (public data): every project's office, districts, red flags, documents and automatic review.
  const [indexTick, setIndexTick] = useState(0);
  useEffect(() => {
    loadIndex().then(setIndex).catch((e: unknown) => setIndexError(e instanceof Error ? e.message : String(e)));
  }, [indexTick]);
  const reload = useCallback(() => { setReviews({ state: 'loading' }); setTick((t) => t + 1); }, []);

  const all = useMemo(() => (index ? decodeIndex(index) : null), [index]);
  const res = reviews.state === 'ready' ? reviews.res : null;
  const rows = useMemo(() => reportProjects(res?.data ?? [], all, true), [res, all]);
  const groups = useMemo(() => groupIndex(all ?? [], rows), [all, rows]);
  const data = useMemo((): ReportData | null => (index && all ? {
    index, all, byId: new Map(all.map((p) => [p.hgabId, p])), reviews, reload, rows, rowById: new Map(rows.map((r) => [r.hgabId, r])),
    names: memberNames(res?.data ?? []), groupOf: (h) => groups.get(h) ?? 'not_reviewed',
  } : null), [index, all, reviews, reload, rows, res, groups]);

  // A new page starts at the top, and the tab says which page it is.
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    const page = REPORT_PAGES.find((pg) => pg.slug && pathname.startsWith(reportPath(pg.slug)));
    document.title = `${page ? `${page.label} · ` : ''}${REPORT_TITLE} · BetterGov.ph`;
  }, [pathname]);

  return (
    <div className="rr-app">
      <header className="rr-bar">
        <Link to="/" className="rr-brand"><img src="https://assets.bettergov.ph/logos/png/horizontal-primary.png" alt="BetterGov.ph" /></Link>
        <div className="rr-bar-title">
          <h1><Link to={REPORT_ROOT}>{REPORT_TITLE}</Link></h1>
          <span>DPWH projects in the FY2027 House bill · HB 10858</span>
        </div>
        <nav className="rr-bar-links" aria-label="Report">
          <Link to={REVIEW_ROOT} className="rr-btn">Project reviewer</Link>
        </nav>
      </header>
      <div className="rr-layout">
        <ReportNav data={data} reviews={reviews} reload={reload} />
        <main className="rr-main">
          <div className="rr-notice">
            <b>For the team. This report isn’t linked from the site; please don’t share it.</b> A red flag, automatic or from a member’s review, is a
            candidate for follow-up, not a finding, and not evidence that anyone did anything wrong.
            {reviews.state === 'error' && (
              <span className="rr-warn"> Members’ reviews didn’t load ({reviews.message}): final statuses show the automatic review only. <button type="button" className="rr-link" onClick={reload}>Try again</button></span>
            )}
          </div>
          {!data ? (
            indexError ? (
              <Gate>
                <h2>We couldn’t load the project list</h2>
                <p>{indexError}</p>
                <button type="button" className="rr-btn" onClick={() => { setIndexError(null); setIndexTick((t) => t + 1); }}>Try again</button>
              </Gate>
            ) : <Gate><span role="status">Loading the projects…</span></Gate>
          ) : (
            <ReportDataContext.Provider value={data}>
              <Routes>
                <Route index element={<Overview />} />
                <Route path="automatic" element={<AutomaticPage />} />
                <Route path="automatic/:code" element={<ConditionPage kind="rule" />} />
                <Route path="flags" element={<FlagsPage />} />
                <Route path="flags/:code" element={<ConditionPage kind="flag" />} />
                <Route path="documents" element={<DocumentsPage />} />
                <Route path="regions" element={<RegionsPage />} />
                <Route path="questions" element={<QuestionsPage />} />
                <Route path="projects" element={<ProjectsPage />} />
                <Route path="project/:hgabId" element={<ProjectPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </ReportDataContext.Provider>
          )}
        </main>
      </div>
    </div>
  );
}

function Gate({ children }: { children: ReactNode }) {
  return <div className="rr-gate">{children}</div>;
}

/** The report's pages, then the team's downloads and when the reviews were read. */
function ReportNav({ data, reviews, reload }: { data: ReportData | null; reviews: ReviewsLoad; reload: () => void }) {
  const res = reviews.state === 'ready' ? reviews.res : null;
  const stem = `bettergov-house-bill-2027-review-report-${res?.meta.generated_at.slice(0, 10) ?? ''}`;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://budget.bettergov.ph';
  const members = data ? data.rows.filter((r) => r.reviews.length) : [];
  const csvReviews = () => data && download(`${stem}-reviews.csv`, toCsv(REPORT_REVIEW_COLUMNS, reviewRows(members, data.names, origin)), 'text/csv;charset=utf-8');
  const csvAnswers = () => data && download(`${stem}-answers.csv`, toCsv(REPORT_ANSWER_COLUMNS, answerRows(members, data.names)), 'text/csv;charset=utf-8');
  return (
    <nav className="rr-toc" aria-label="Report pages">
      <p className="rr-toc-h">Pages</p>
      <ol>
        {REPORT_PAGES.map((pg) => (
          <li key={pg.slug}>
            <NavLink to={reportPath(pg.slug)} end={!pg.slug} className={({ isActive }) => (isActive ? 'is-on' : undefined)}>{pg.label}</NavLink>
          </li>
        ))}
      </ol>
      <div className="rr-toc-dl">
        <p className="rr-toc-h">Members’ reviews</p>
        <button type="button" className="rr-btn" onClick={csvReviews} disabled={!res || !data}>Reviews (CSV)</button>
        <button type="button" className="rr-btn" onClick={csvAnswers} disabled={!res || !data}>Answers (CSV)</button>
        <p className="rr-asof">
          {res ? <>As of {when(res.meta.generated_at, true)} · </> : reviews.state === 'loading' ? 'Loading… ' : 'Not loaded · '}
          {reviews.state !== 'loading' && <button type="button" className="rr-link" onClick={reload}>Refresh</button>}
        </p>
      </div>
    </nav>
  );
}
