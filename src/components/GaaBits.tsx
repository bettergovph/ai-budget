/**
 * The GAA section's chrome for its topic pages (roads and bridges, multi-purpose buildings, flood control): the masthead
 * with the GAA tabs,
 * "All years" then a dropdown per topic, and a compact page heading whose breadcrumb leads back to the GAA explorer.
 * Jason (2026-11-23): "These are no longer hgab but rather should be in the GAA", then "Make the roads and bridges a
 * dropdown with an overview + leaderboard links". The dropdown is the House bill nav's (HgabBits SectionMenu); the
 * heading reuses hgab.css's compact page head.
 */
import { Fragment, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SiteHeader from './SiteHeader';
import { SectionMenu } from './HgabBits';
import { ROADS_BOARDS_ROOT, ROADS_ROOT } from '../lib/gaa-roads';
import { HISTORY_ROOT, HISTORY_TITLE } from '../lib/hgab-history';
import { MPB_MAP_ROOT } from '../lib/hgab-mpb-years';
import { FLOOD_COMPARE_ROOT, MPB_COMPARE_ROOT } from '../lib/mpb-compare';
import { MPB_POPULATION_ROOT } from '../lib/mpb-population';
import { MPB_DOCS_ROOT } from '../lib/mpb-documents';
import '../hgab.css';

/**
 * The GAA section's topics: a dropdown of its pages, or a plain tab when it has one. Multi-purpose buildings and flood
 * control came from the House bill nav on 2026-11-23 (Jason: "Next is we move the MPBs as well, Flood Control there as
 * well"), with the House menu's labels; their old addresses redirect (lib/moved-pages.ts).
 */
const GAA_TOPICS: ReadonlyArray<{ key: string; label: string; items: ReadonlyArray<{ key: string; label: string; to: string }> }> = [
  {
    key: 'roads',
    label: 'Roads and bridges',
    items: [
      { key: 'overview', label: 'Overview', to: ROADS_ROOT },
      { key: 'leaderboards', label: 'Leaderboards', to: ROADS_BOARDS_ROOT },
    ],
  },
  {
    key: 'multi-purpose',
    label: HISTORY_TITLE,
    items: [
      { key: 'history', label: 'Budget by year', to: HISTORY_ROOT },
      { key: 'map', label: 'Map of every line', to: MPB_MAP_ROOT },
      { key: 'compare', label: 'NEP, House bill and Senate', to: MPB_COMPARE_ROOT },
      { key: 'per-person', label: 'Per person', to: MPB_POPULATION_ROOT },
      { key: 'documents', label: 'What the documents say', to: MPB_DOCS_ROOT },
    ],
  },
  { key: 'flood-control', label: 'Flood control', items: [{ key: 'flood-control', label: 'Flood control', to: FLOOD_COMPARE_ROOT }] },
];

/** The topic dropdowns, for the GAA tabs (here and on /gaa). */
export function GaaTopicMenus() {
  const here = useLocation().pathname.replace(/\/+$/, '');
  return (
    <>
      {GAA_TOPICS.map((t) => {
        const current = t.items.find((x) => x.to === here)?.key ?? null;
        if (t.items.length === 1) {
          return (
            <Link key={t.key} to={t.items[0].to} className={current ? 'active' : ''} aria-current={current ? 'page' : undefined}>
              {t.label}
            </Link>
          );
        }
        return <SectionMenu key={t.key} label={t.label} items={t.items} active={current != null} currentKey={current} />;
      })}
    </>
  );
}

export function GaaHeader({ crumb }: { crumb?: ReactNode }) {
  return (
    <SiteHeader
      crumb={crumb}
      subNav={
        <nav className="view-tabs section-tabs gaa-subnav" aria-label="GAA sections">
          <Link to="/gaa">All years</Link>
          <GaaTopicMenus />
        </nav>
      }
      drawerExtras={
        <>
          {GAA_TOPICS.flatMap((t) => t.items.map((x) => (
            <Link key={x.to} className="drawer-link" to={x.to}>{t.items.length > 1 ? `${t.label}: ${x.label}` : t.label} →</Link>
          )))}
        </>
      }
    />
  );
}

/** `trail`: the crumbs after "GAA"; the last is the page itself. */
export function GaaPageHead({ trail, title, dek, note }: {
  trail: Array<{ label: string; to?: string }>;
  title: ReactNode;
  dek?: ReactNode;
  note?: ReactNode;
}) {
  return (
    <header className="hgab-pagehead">
      <div className="hgab-pagehead-inner">
        <p className="page-eyebrow">
          <span className="hgab-crumb" aria-label="Breadcrumb">
            <Link to="/gaa">GAA 2000–2026</Link>
            {trail.map((c) => (
              <Fragment key={c.label}>
                <span className="hgab-crumb-sep" aria-hidden="true">·</span>
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span className="hgab-crumb-here">{c.label}</span>}
              </Fragment>
            ))}
          </span>
        </p>
        <h1 className="page-title">{title}</h1>
        {dek && <p className="page-dek">{dek}</p>}
        {note && <p className="hgab-pagehead-note">{note}</p>}
      </div>
    </header>
  );
}
