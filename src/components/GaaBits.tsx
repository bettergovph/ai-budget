/**
 * The GAA section's chrome for its topic pages (`/gaa/roads`, `/gaa/roads/leaderboards`): the masthead with the GAA tabs,
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
import '../hgab.css';

/** The GAA section's topics, each a dropdown of its pages. */
const GAA_TOPICS: ReadonlyArray<{ key: string; label: string; items: ReadonlyArray<{ key: string; label: string; to: string }> }> = [
  {
    key: 'roads',
    label: 'Roads and bridges',
    items: [
      { key: 'overview', label: 'Overview', to: ROADS_ROOT },
      { key: 'leaderboards', label: 'Leaderboards', to: ROADS_BOARDS_ROOT },
    ],
  },
];

/** The topic dropdowns, for the GAA tabs (here and on /gaa). */
export function GaaTopicMenus() {
  const here = useLocation().pathname.replace(/\/+$/, '');
  return (
    <>
      {GAA_TOPICS.map((t) => {
        const current = t.items.find((x) => x.to === here)?.key ?? null;
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
            <Link key={x.to} className="drawer-link" to={x.to}>{t.label}: {x.label} →</Link>
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
