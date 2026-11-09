import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { pageMeta } from './lib/seo';
import { RED_FLAGS_ROOT } from './lib/hgab-redflags';
import { FAP_ROOT } from './lib/hgab-fap';
import { PARTY_DATA_ROOT } from './lib/hgab-congress-seats';

const National = lazy(() => import('./pages/National'));
const GaaYear = lazy(() => import('./pages/GaaYear'));
const Portal = lazy(() => import('./pages/Portal'));
const Methodology = lazy(() => import('./pages/Methodology'));
const Learn = lazy(() => import('./pages/Learn'));
const Glossary = lazy(() => import('./pages/Glossary'));
const CitizenReports = lazy(() => import('./pages/CitizenReports'));
const Indicators = lazy(() => import('./pages/Indicators'));
const IndicatorDetail = lazy(() => import('./pages/IndicatorDetail'));
const IndicatorPlace = lazy(() => import('./pages/IndicatorPlace'));
const BudgetByRegion = lazy(() => import('./pages/BudgetByRegion'));
const Explore = lazy(() => import('./pages/Explore'));
const Nep2027Story = lazy(() => import('./pages/Nep2027Story'));
const Nep2027Department = lazy(() => import('./pages/Nep2027Department'));
const Nep2027Browse = lazy(() => import('./pages/Nep2027Browse'));
const Nep2027Explore = lazy(() => import('./pages/Nep2027Explore'));
const Nep2027Methodology = lazy(() => import('./pages/Nep2027Methodology'));
const Hearings = lazy(() => import('./pages/Hearings'));
const HearingDetail = lazy(() => import('./pages/HearingDetail'));
const HgabOverview = lazy(() => import('./pages/HgabOverview'));
const HgabSources = lazy(() => import('./pages/HgabSources'));
const HgabExplorer = lazy(() => import('./pages/HgabExplorer'));
const HgabExplorerDept = lazy(() => import('./pages/HgabExplorerDept'));
const HgabMethodology = lazy(() => import('./pages/HgabMethodology'));
const HgabDataset = lazy(() => import('./pages/HgabDataset'));
const HgabRecord = lazy(() => import('./pages/HgabRecord'));
const HgabDistricts = lazy(() => import('./pages/HgabDistricts'));
const HgabDistrict = lazy(() => import('./pages/HgabDistrict'));
const HgabLeaderboard = lazy(() => import('./pages/HgabLeaderboard'));
const HgabLetters = lazy(() => import('./pages/HgabLetters'));
const HgabLetter = lazy(() => import('./pages/HgabLetter'));
const HgabHistory = lazy(() => import('./pages/HgabHistory'));
const HgabMpbYears = lazy(() => import('./pages/HgabMpbYears'));
const HgabMpbCompare = lazy(() => import('./pages/HgabMpbCompare'));
const HgabContractors = lazy(() => import('./pages/HgabContractors'));
const HgabParties = lazy(() => import('./pages/HgabParties'));
const HgabParty = lazy(() => import('./pages/HgabParty'));
const HgabRedFlags = lazy(() => import('./pages/HgabRedFlags'));
const HgabFap = lazy(() => import('./pages/HgabFap'));
const HgabPartyData = lazy(() => import('./pages/HgabPartyData'));

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

/**
 * Routes the Worker serves as static files (they are not part of this app).
 * A client-side navigation to one reloads the page from the server; the
 * Worker always answers these paths itself, so this cannot loop.
 */
function ServerPage() {
  useEffect(() => {
    window.location.replace(window.location.pathname + window.location.search + window.location.hash);
  }, []);
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
          <Route path="/learn" element={<Learn />} />
          <Route path="/glossary" element={<Glossary />} />
          <Route path="/citizen-reports" element={<CitizenReports />} />
          <Route path="/indicators" element={<Indicators />} />
          <Route path="/indicators/places/:area" element={<IndicatorPlace />} />
          <Route path="/indicators/budget-by-region" element={<BudgetByRegion />} />
          <Route path="/indicators/:id" element={<IndicatorDetail />} />
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
          {/* Budget Briefing/Hearings (Committee on Appropriations) */}
          <Route path="/hearings" element={<Hearings />} />
          <Route path="/hearings/:videoId" element={<HearingDetail />} />
          {/* FY2027 House General Appropriations Bill (HB 10858) vs the NEP.
              The static pages and the Districts lens are declared before
              `:dataset` so they can never be mistaken for a dataset key. */}
          <Route path="/hgab" element={<Navigate to="/hgab/2027" replace />} />
          {/* The section lands on the overview. The story-style Explainer
              (pages/HgabIntro.tsx) is hidden for now; /intro goes to the overview. */}
          <Route path="/hgab/2027" element={<Navigate to="/hgab/2027/overview" replace />} />
          <Route path="/hgab/2027/intro" element={<Navigate to="/hgab/2027/overview" replace />} />
          <Route path="/hgab/2027/overview" element={<HgabOverview />} />
          <Route path="/hgab/2027/sources" element={<HgabSources />} />
          <Route path="/hgab/2027/methodology" element={<HgabMethodology />} />
          <Route path="/hgab/2027/districts" element={<HgabDistricts />} />
          <Route path="/hgab/2027/districts/:id" element={<HgabDistrict />} />
          {/* Each district's representative and party (May 2025), and the DPWH budget by party; under the Districts menu. */}
          <Route path="/hgab/2027/parties" element={<HgabParties />} />
          {/* How we read each district's party, 16th to 20th Congress: every seat and its source. */}
          <Route path={PARTY_DATA_ROOT} element={<HgabPartyData />} />
          <Route path="/hgab/2027/parties/:party" element={<HgabParty />} />
          {/* Leaderboards: the gallery, and one board with its share image. */}
          <Route path="/hgab/2027/leaderboard" element={<HgabLeaderboard />} />
          <Route path="/hgab/2027/leaderboard/:board" element={<HgabLeaderboard />} />
          {/* Write to your representative: the district picker, and one district's letter. */}
          <Route path="/hgab/2027/letter" element={<HgabLetters />} />
          <Route path="/hgab/2027/letter/:slug" element={<HgabLetter />} />
          {/* Multi-purpose buildings (its own menu): the budget by year, with flood control, BIP, SIPAG, school and health facilities; and every line on a map. */}
          <Route path="/hgab/2027/multi-purpose" element={<HgabHistory />} />
          <Route path="/hgab/2027/multi-purpose/map" element={<HgabMpbYears />} />
          <Route path="/hgab/2027/multi-purpose/nep-vs-house-bill" element={<HgabMpbCompare key="mpb" />} />
          {/* Flood control in 2025, 2026 and 2027, side by side ("Flood control projects are back"); no menu entry yet. */}
          <Route path="/hgab/2027/flood-control" element={<HgabMpbCompare key="flood" topic="flood" />} />
          <Route path="/hgab/2027/contractors" element={<HgabContractors />} />
          <Route path="/hgab/2027/contractors/:key" element={<HgabContractors />} />
          {/* ₱1 trillion in red flags: the People's Budget Coalition's red-flag basket, the campaign poster's page. */}
          <Route path={RED_FLAGS_ROOT} element={<HgabRedFlags />} />
          <Route path={FAP_ROOT} element={<HgabFap />} />
          {/* Every inserted and adjusted project as one list, no site chrome. */}
          {/* A static page published with the data and served by the Worker: load it from the server. */}
          <Route path="/hgab/2027/we-are-not-ignorant" element={<ServerPage />} />
          <Route path="/hgab/2027/explorer" element={<HgabExplorer />} />
          <Route path="/hgab/2027/explorer/:deptId" element={<HgabExplorerDept />} />
          <Route path="/hgab/2027/:dataset" element={<HgabDataset />} />
          <Route path="/hgab/2027/:dataset/p/:id" element={<HgabRecord />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
