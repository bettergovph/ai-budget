/**
 * Chrome and small pieces for the Senate committee report section (`/senate/2027`): the masthead with the
 * section's sub-nav, the hero, the review banner, the status chip and the notice every page ends with.
 *
 * The section mirrors the House bill section's shape and styles (`src/hgab.css`), so a reader moving between
 * the two finds the same layout; only the documents compared differ (Senate committee report vs House bill,
 * with the NEP shown for reference).
 */
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SiteHeader from './SiteHeader';
import * as fmt from '../lib/format';
import { SectionMenu } from './HgabBits';
import { HGAB_ROOT, type DatasetKey } from '../lib/hgab';
import {
  PROGRAM_SHORT, SENATE_DOC, SENATE_EXPLORER_ROOT, SENATE_PROGRAMS, SENATE_PROVISIONS_ROOT, SENATE_ROOT, SENATE_STATUS,
  SENATE_UNDER_REVIEW, senateProgramPath, senateReportUrl, type SenateStatus,
} from '../lib/senate';
import '../hgab.css';
import '../senate.css';

const PROGRAM_VIEWS = [
  { key: 'overview', label: 'Overview' },
  { key: 'projects', label: 'Every project' },
  { key: 'changes', label: 'What changed' },
] as const;

const ABOUT = [
  { key: 'sources', label: 'Sources', to: `${SENATE_ROOT}/sources` },
  { key: 'methodology', label: 'Methodology', to: `${SENATE_ROOT}/methodology` },
  { key: 'house', label: 'The House bill pages', to: `${HGAB_ROOT}/overview` },
];

/** Masthead + the section's sub-nav: Overview, Line by line, the four programs, Provisions, About. */
export function SenateHeader({ crumb }: { crumb?: ReactNode }) {
  const { pathname, search } = useLocation();
  const path = pathname.replace(/\/+$/, '') || SENATE_ROOT;
  const view = new URLSearchParams(search).get('view') ?? 'overview';
  const lead = [
    { to: `${SENATE_ROOT}/overview`, label: 'Overview', on: path === SENATE_ROOT || path === `${SENATE_ROOT}/overview` },
    { to: SENATE_EXPLORER_ROOT, label: 'Line by line', on: path === SENATE_EXPLORER_ROOT || path.startsWith(`${SENATE_EXPLORER_ROOT}/`) },
  ];
  const programOn = (k: DatasetKey) => path === `${SENATE_ROOT}/${k}` || path.startsWith(`${SENATE_ROOT}/${k}/`);
  const aboutKey = ABOUT.find((a) => path === a.to)?.key ?? null;
  const link = (n: { to: string; label: string; on: boolean }) => (
    <Link key={n.to} to={n.to} className={n.on ? 'active' : ''} aria-current={n.on ? 'page' : undefined}>{n.label}</Link>
  );
  const provisions = { to: SENATE_PROVISIONS_ROOT, label: 'Provisions', on: path === SENATE_PROVISIONS_ROOT };
  return (
    <SiteHeader
      crumb={crumb}
      compiledMeta="Senate committee report on HB 10858"
      subNav={
        <nav className="view-tabs section-tabs hgab-subnav" aria-label="FY2027 Senate committee report sections">
          {lead.map(link)}
          {SENATE_PROGRAMS.map((k) => (
            <SectionMenu
              key={k}
              label={PROGRAM_SHORT[k]}
              items={PROGRAM_VIEWS.map((v) => ({ key: v.key, label: v.label, to: senateProgramPath(k, v.key) }))}
              active={programOn(k)}
              currentKey={programOn(k) && path === `${SENATE_ROOT}/${k}` ? view : null}
            />
          ))}
          {link(provisions)}
          <SectionMenu label="About" items={ABOUT} active={aboutKey != null} currentKey={aboutKey} />
        </nav>
      }
      drawerExtras={
        <nav className="nep-drawer-nav hgab-drawer-nav" aria-label="FY2027 Senate committee report sections">
          <p className="hgab-drawer-eyebrow">The Senate committee report for 2027</p>
          {lead.map(link)}
          {SENATE_PROGRAMS.map((k) => (
            <div className="hgab-drawer-group" key={k}>
              <Link to={senateProgramPath(k)} className={programOn(k) ? 'active' : ''}>{PROGRAM_SHORT[k]}</Link>
              <div className="hgab-drawer-sub">
                {PROGRAM_VIEWS.slice(1).map((v) => (
                  <Link key={v.key} to={senateProgramPath(k, v.key)} className={programOn(k) && view === v.key ? 'active' : ''}>{v.label}</Link>
                ))}
              </div>
            </div>
          ))}
          {link(provisions)}
          {ABOUT.map((a) => <Link key={a.key} to={a.to} className={aboutKey === a.key ? 'active' : ''}>{a.label}</Link>)}
        </nav>
      }
    />
  );
}

/** The section's hero: the House section's band, with "FY2027 · Senate committee report" in the trail. */
export function SenateHero({ crumb, title, dek, note, children, compact = false }: {
  crumb: ReactNode;
  title: ReactNode;
  dek?: ReactNode;
  note?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
}) {
  const trail = (
    <span className="hgab-crumb" aria-label="Breadcrumb">
      <span>FY2027</span>
      <span className="hgab-crumb-sep" aria-hidden="true">·</span>
      <Link to={SENATE_ROOT}>{SENATE_DOC.label}</Link>
      <span className="hgab-crumb-sep" aria-hidden="true">·</span>
      {typeof crumb === 'string' ? <span className="hgab-crumb-here">{crumb}</span> : crumb}
    </span>
  );
  if (compact) {
    return (
      <header className="hgab-pagehead">
        <div className="hgab-pagehead-inner">
          <p className="page-eyebrow">{trail}</p>
          <h1 className="page-title">{title}</h1>
          {dek && <p className="page-dek">{dek}</p>}
          {note && <p className="hgab-pagehead-note">{note}</p>}
          {children}
        </div>
      </header>
    );
  }
  return (
    <section className="nep-dept-hero hgab-hero senate-hero">
      <div className="nep-dept-hero-inner">
        <p className="nep-dept-hero-eyebrow">{trail}</p>
        <h1 className="nep-dept-hero-title">{title}</h1>
        {dek && <p className="nep-dept-hero-dek">{dek}</p>}
        {note && <p className="nep-dept-hero-note">{note}</p>}
        {children}
      </div>
    </section>
  );
}

/** "Under citizen review": nothing in the section has been checked by a person yet. */
export function SenateReviewBanner({ compact = false }: { compact?: boolean }) {
  const { pathname, search } = useLocation();
  if (!SENATE_UNDER_REVIEW) return null;
  const report = (
    <a className="hgab-review-report" href={senateReportUrl(`${window.location.origin}${pathname}${search}`)} target="_blank" rel="noopener noreferrer">
      Report a wrong figure ↗
    </a>
  );
  if (compact) {
    return (
      <aside className="hgab-review is-compact" aria-label="Under citizen review">
        <p>
          <strong className="hgab-review-tag">Under citizen review</strong> We have not finished checking the Senate
          figures. Confirm one on its page of the committee report before you cite it. {report}
        </p>
      </aside>
    );
  }
  return (
    <aside className="hgab-review" aria-label="Under citizen review">
      <p className="hgab-review-tag">Under citizen review</p>
      <p className="hgab-review-head">We have not finished checking the Senate figures.</p>
      <p>
        Every figure was read from the Senate committee report by computer and matched to the House bill by the page,
        line, name and amount the report cites. Every total adds up to the report's own, but a single line may still be
        paired wrongly. Before you cite a figure, open its page of the committee report and confirm it.
      </p>
      <p className="hgab-review-actions">
        {report}
        <span>Tell us the page and the line. Fixes go into the next build.</span>
      </p>
    </aside>
  );
}

export function SenateStatusChip({ status }: { status: SenateStatus }) {
  const s = SENATE_STATUS[status];
  return (
    <span className="hgab-chip senate-chip" style={{ ['--hgab-group' as string]: s.tone }} title={s.help}>{s.label}</span>
  );
}

/** What the reader should know before using any Senate figure. */
export function SenateNotice() {
  return (
    <aside className="hgab-disclaimer senate-notice" aria-label="Disclaimer">
      <p className="hgab-disclaimer-eyebrow">Disclaimer</p>
      <p className="hgab-disclaimer-item">
        <strong>A committee report, not the final budget.</strong> {SENATE_DOC.plain} The House bill and the Senate
        committee report are two versions of the same budget: compare them, never add them.
      </p>
      <p className="hgab-disclaimer-item">
        <strong>No allegations.</strong> A cut, a raise or a new line is a change between two documents, nothing more.
        The report does not say who asked for a change or why.
      </p>
    </aside>
  );
}

export function SenateLoading({ what }: { what: string }) {
  return (
    <>
      <SenateHeader />
      <main className="nep-main" aria-busy="true">
        <span className="visually-hidden" role="status">Loading {what}…</span>
      </main>
    </>
  );
}

export function SenateError({ message }: { message: string }) {
  return (
    <>
      <SenateHeader />
      <main className="nep-status nep-status-error">
        <p>{message}</p>
        <p><Link to={`${SENATE_ROOT}/overview`}>Back to the Senate committee report overview</Link></p>
      </main>
    </>
  );
}

/** A signed peso change, coloured: "+1.2B", "−340.5M", "0". */
export function SignedChange({ v, base }: { v: number | null | undefined; base?: number | null }) {
  if (v == null) return <span className="hgab-ds-null">—</span>;
  if (v === 0) return <span className="hgab-ex-zero">0</span>;
  const color = v > 0 ? 'var(--positive)' : 'var(--negative)';
  const pct = base ? v / base : null;
  return (
    <span className="nep-delta" style={{ color }} title={`${v > 0 ? '+' : '−'}₱${Math.abs(v).toLocaleString()}`}>
      <span className="nep-delta-abs">{v > 0 ? '+' : '−'}{fmt.shortPhp(Math.abs(v))}</span>
      {pct != null && <span className="nep-delta-pct">{v > 0 ? '+' : '−'}{(Math.abs(pct) * 100).toFixed(1)}%</span>}
    </span>
  );
}
