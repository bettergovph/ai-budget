/**
 * Shared chrome for the schools directory (`/schools`): the GAA masthead with its Schools dropdown, the preview notice,
 * the shortage legend and stat tiles, and the loading/error status line.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { GaaHeader } from './GaaBits';
import SiteFooter from './SiteFooter';
import {
  ALLOCATION_STATUS, DATA_NOTE, DATA_SOURCES, NO_SHORTAGE_DATA, OFFICIAL_SOURCES, SCHOOLS_ABOUT, SHORTAGE_LEVELS, statusInfo,
  type AllocationStatus, type SchoolSource, type ShortageLevel,
} from '../lib/schools';
import '../nep2027.css';
import '../schools.css';

/** The schools pages sit in the GAA section for now (Jason, 2026-11-24): its header, with the Schools dropdown. */
export function SchoolsChrome({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="sch-page">
      <GaaHeader crumb="Schools" />
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
      <strong>Preview.</strong> Classroom shortage figures are DepEd’s for SY 2023–2024, while classroom allocations are
      from the FY 2026 School Building Program, joined by School ID. Field reports are subject to review and validation
      before any figure changes.
    </p>
  );
}

/** EDCOM 2's shortage levels (blue) and the hollow brown ring for no data. */
export function ShortageLegend({ withNoData = true }: { withNoData?: boolean }) {
  return (
    <ul className="sch-legend" aria-label="Classroom shortage level, SY 2023–2024">
      {SHORTAGE_LEVELS.map((c) => (
        <li key={c.key}><span className="sch-swatch" style={{ background: c.color }} />{c.key === 'none' ? 'None' : `${c.label} (${c.range})`}</li>
      ))}
      {withNoData && <li><span className="sch-swatch sch-swatch-ring" style={{ borderColor: NO_SHORTAGE_DATA }} />No shortage data</li>}
    </ul>
  );
}

/** EDCOM 2's allocation statuses. */
export function StatusLegend() {
  return (
    <ul className="sch-legend" aria-label="Allocation status">
      {ALLOCATION_STATUS.map((c) => (
        <li key={c.key} title={c.plain}>
          <span className={`sch-swatch${c.key === 'no_data' ? ' sch-swatch-ring' : ''}`} style={c.key === 'no_data' ? { borderColor: c.color } : { background: c.color }} />{c.label}
        </li>
      ))}
    </ul>
  );
}

export function StatusBadge({ status }: { status: AllocationStatus }) {
  const s = statusInfo(status);
  return <span className="sch-badge" title={s.plain}><span className={`sch-swatch${status === 'no_data' ? ' sch-swatch-ring' : ''}`} style={status === 'no_data' ? { borderColor: s.color } : { background: s.color }} />{s.label}</span>;
}

export function LevelBadge({ level }: { level: ShortageLevel | null }) {
  if (!level) return <span className="sch-badge"><span className="sch-swatch sch-swatch-ring" style={{ borderColor: NO_SHORTAGE_DATA }} />No data</span>;
  const l = SHORTAGE_LEVELS.find((x) => x.key === level)!;
  return <span className="sch-badge"><span className="sch-swatch" style={{ background: l.color }} />{l.key === 'none' ? 'None' : l.label}</span>;
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
      . Built from DepEd’s datasets as submitted to EDCOM 2 (FY 2026 SBP Masterlist; classroom shortage and LIS enrollment,
      SY 2023–2024; Project BUKAS facilities), with DPWH’s contracts, the GAA, the 2027 NEP and House bill, and PSA’s
      statistics. <Link to={SCHOOLS_ABOUT}>Every source →</Link>
      <span className="sch-datanote">{DATA_NOTE}</span>
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
