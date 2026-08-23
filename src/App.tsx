import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { pageMeta } from './lib/seo';

const National = lazy(() => import('./pages/National'));
const GaaYear = lazy(() => import('./pages/GaaYear'));
const Portal = lazy(() => import('./pages/Portal'));
const Methodology = lazy(() => import('./pages/Methodology'));
const Explore = lazy(() => import('./pages/Explore'));
const Nep2027Story = lazy(() => import('./pages/Nep2027Story'));
const Nep2027Department = lazy(() => import('./pages/Nep2027Department'));
const Nep2027Browse = lazy(() => import('./pages/Nep2027Browse'));
const Nep2027Explore = lazy(() => import('./pages/Nep2027Explore'));
const Nep2027Methodology = lazy(() => import('./pages/Nep2027Methodology'));

/**
 * Lazy-chunk fallback. Chunks are a few KB and cached after first load, so a
 * painted "Loading…" only flickers between routes; blank is calmer.
 */
function PageFallback() {
  return null;
}

/**
 * Keeps document.title in sync during SPA navigation. Cold loads get their
 * title from the Worker's edge rewrite (src/worker/seo.ts); data-rich pages
 * (Portal, GaaYear, Nep2027Department) refine it further once their data
 * lands — their effects run after this one, so the specific title wins.
 */
function RouteMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = pageMeta(pathname).title;
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteMeta />
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/2027/overview" replace />} />
          <Route path="/gaa" element={<National />} />
          {/* Per-year exclusive browser: same hierarchy, one fiscal year.
              The splat carries the drill path as entity ids, so every level
              is a shareable URL: /gaa/:year/:group/:bureau/:program/… */}
          <Route path="/gaa/:year/*" element={<GaaYear />} />
          <Route path="/methodology" element={<Methodology />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/d/:deptId" element={<Portal />} />
          <Route path="/d/:deptId/overview" element={<Portal />} />
          <Route path="/d/:deptId/by-year" element={<Portal />} />
          <Route path="/d/:deptId/programs" element={<Portal />} />
          <Route path="/d/:deptId/budget-cycle" element={<Portal />} />
          <Route path="/d/:deptId/objects" element={<Portal />} />
          <Route path="/d/:deptId/data" element={<Portal />} />
          <Route path="/d/:deptId/report" element={<Portal />} />
          <Route path="/d/:deptId/methodology" element={<Portal />} />
          {/* FY2027 National Expenditure Program microsite */}
          <Route path="/2027/overview" element={<Nep2027Story />} />
          <Route path="/2027" element={<Navigate to="/2027/overview" replace />} />
          <Route path="/2027/browse" element={<Nep2027Browse />} />
          <Route path="/2027/search" element={<Nep2027Explore />} />
          {/* Former name of the search page; keep links working. */}
          <Route path="/2027/explore" element={<Navigate to="/2027/search" replace />} />
          <Route path="/2027/methodology" element={<Nep2027Methodology />} />
          <Route path="/2027/d/:deptId" element={<Nep2027Department />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
