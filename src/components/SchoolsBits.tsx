/**
 * Shared chrome for the schools directory (`/schools`): the masthead with the section's sub-nav, the preview notice,
 * the shortage legend and stat tiles, and the loading/error status line.
 */
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import {
  NO_SHORTAGE_DATA, SCHOOLS_ABOUT, SCHOOLS_LIST, SCHOOLS_ROOT, SCHOOLS_SHORTAGE, SHORTAGE_CLASSES,
} from '../lib/schools';
import '../nep2027.css';
import '../schools.css';

const TABS: [string, string][] = [
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
      <main className={`nep-main sch-main${wide ? ' sch-main-wide' : ''}`}>{children}</main>
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
