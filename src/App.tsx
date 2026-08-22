import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

const National = lazy(() => import('./pages/National'));
const Portal = lazy(() => import('./pages/Portal'));
const Methodology = lazy(() => import('./pages/Methodology'));
const Explore = lazy(() => import('./pages/Explore'));
const Nep2027National = lazy(() => import('./pages/Nep2027National'));
const Nep2027Department = lazy(() => import('./pages/Nep2027Department'));
const Nep2027Browse = lazy(() => import('./pages/Nep2027Browse'));
const Nep2027Explore = lazy(() => import('./pages/Nep2027Explore'));
const Nep2027Methodology = lazy(() => import('./pages/Nep2027Methodology'));

function PageFallback() {
  return (
    <div
      style={{
        padding: 80,
        textAlign: 'center',
        fontFamily: 'var(--font-mono)',
        color: 'var(--ink-3)',
        fontSize: 13,
      }}
    >
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<National />} />
          <Route path="/methodology" element={<Methodology />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/d/:deptId" element={<Portal />} />
          <Route path="/d/:deptId/overview" element={<Portal />} />
          <Route path="/d/:deptId/by-year" element={<Portal />} />
          <Route path="/d/:deptId/programs" element={<Portal />} />
          <Route path="/d/:deptId/objects" element={<Portal />} />
          <Route path="/d/:deptId/data" element={<Portal />} />
          <Route path="/d/:deptId/report" element={<Portal />} />
          <Route path="/d/:deptId/methodology" element={<Portal />} />
          {/* FY2027 National Expenditure Program microsite */}
          <Route path="/2027" element={<Nep2027National />} />
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
