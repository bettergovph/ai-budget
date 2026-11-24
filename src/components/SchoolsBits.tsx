/**
 * Shared chrome for the schools directory (`/schools`): the masthead with the section's sub-nav, the preview notice,
 * the shortage legend and stat tiles, and the loading/error status line.
 */
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import {
  DATA_SOURCES, NO_SHORTAGE_DATA, OFFICIAL_SOURCES, SCHOOLS_ABOUT, SCHOOLS_LIST, SCHOOLS_OVERVIEW, SCHOOLS_ROOT, SCHOOLS_SHORTAGE, SHORTAGE_CLASSES,
  type SchoolSource,
} from '../lib/schools';
import '../nep2027.css';
import '../schools.css';

const TABS: [string, string][] = [
  [SCHOOLS_OVERVIEW, 'Overview'],
  [SCHOOLS_ROOT, 'Map'],
  [SCHOOLS_LIST, 'List'],
  [SCHOOLS_SHORTAGE, 'Shortages vs classrooms'],
  [SCHOOLS_ABOUT, 'About the data'],
];

export function SchoolsChrome({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const nav = (
    <nav className="view-tabs section-tabs" aria-label="Schools">
      {TABS.map(([to, text]) => (
        <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'active' : '')}>{text}</NavLink>
      ))}
    </nav>
  );
  return (
    <div className="sch-page">
      <SiteHeader crumb="Schools" subNav={nav} />
      <main className={`nep-main sch-main${wide ? ' sch-main-wide' : ''}`}>
        {children}
        <SourcesNote />
      </main>
      <SiteFooter />
    </div>
  );
}

/** Until the data is reviewed with EDCOM2 and DepEd. */
export function PreviewNotice() {
  return (
    <p className="sch-notice" role="note">
      <strong>Preview.</strong> Shortages are DepEd’s 2023 figures and the projects are the 2026 School Building Program
      list, joined by School ID. None of it has been confirmed in the field yet: that is what the reports are for.
    </p>
  );
}

export function ShortageLegend({ withNoData = true }: { withNoData?: boolean }) {
  return (
    <ul className="sch-legend" aria-label="Classrooms short in 2023">
      {SHORTAGE_CLASSES.map((c) => (
        <li key={c.label}><span className="sch-swatch" style={{ background: c.color }} />{c.label}</li>
      ))}
      {withNoData && <li><span className="sch-swatch sch-swatch-ring" style={{ borderColor: NO_SHORTAGE_DATA }} />No 2023 shortage data</li>}
    </ul>
  );
}

export function Stat({ value, label, note }: { value: ReactNode; label: ReactNode; note?: ReactNode }) {
  return (
    <div className="sch-stat">
      <span className="sch-stat-value">{value}</span>
      <span className="sch-stat-label">{label}</span>
      {note && <span className="sch-stat-note">{note}</span>}
    </div>
  );
}

export function Status({ error, loading, children }: { error: string | null; loading: boolean; children?: ReactNode }) {
  if (error) return <p className="nep-status nep-status-error">{error}</p>;
  if (loading) return <p className="nep-status">Loading…</p>;
  return <>{children}</>;
}

function SourceLink({ s }: { s: SchoolSource }) {
  if (!s.url) return <>{s.title}</>;
  if (s.url.startsWith('/')) return <Link to={s.url}>{s.title}</Link>;
  return <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}<span aria-hidden="true"> ↗</span></a>;
}

/** The short source line under every schools page. */
function SourcesNote() {
  return (
    <aside className="sch-sources-note" aria-label="Sources">
      <strong>Sources.</strong>{' '}
      {OFFICIAL_SOURCES.map((s, i) => (
        <span key={s.key}>{i > 0 && ' · '}{s.who}, <SourceLink s={s} /></span>
      ))}
      . Built from DepEd’s school data (the Classroom Shortages &amp; Projects Data Pack), with DPWH’s contracts, the GAA,
      the 2027 NEP and House bill, and PSA’s statistics. <Link to={SCHOOLS_ABOUT}>Every source →</Link>
    </aside>
  );
}

/** The full list, for the About page. */
export function SourcesList() {
  return (
    <>
      <h3 className="sch-h3">Official sources to check against</h3>
      <ul className="sch-sources">
        {OFFICIAL_SOURCES.map((s) => <li key={s.key}><span className="sch-sources-who">{s.who}</span> <SourceLink s={s} /><span className="sch-sub">{s.note}</span></li>)}
      </ul>
      <h3 className="sch-h3">What the figures here are built from</h3>
      <ul className="sch-sources">
        {DATA_SOURCES.map((s) => <li key={s.key}><span className="sch-sources-who">{s.who}</span> <SourceLink s={s} /><span className="sch-sub">{s.note}</span></li>)}
      </ul>
    </>
  );
}
