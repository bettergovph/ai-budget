/**
 * Masthead + the Learn section's own sub-nav, mirroring NepHeader: the guide
 * and the glossary are sibling pages, and the subnav is their tab row. Always
 * hero-blended — both pages open on the navy compact hero.
 */
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SiteHeader from './SiteHeader';

const LEARN_NAV: Array<{ to: string; label: string }> = [
  { to: '/learn', label: 'Guide' },
  { to: '/glossary', label: 'Glossary' },
];

export default function LearnHeader({ crumb }: { crumb?: ReactNode }) {
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, '');

  const links = (className: string) =>
    LEARN_NAV.map((n) => (
      <Link
        key={n.to}
        to={n.to}
        className={path === n.to ? `${className} active`.trim() : className}
        aria-current={path === n.to ? 'page' : undefined}
      >
        {n.label}
      </Link>
    ));

  return (
    <SiteHeader
      headerClassName="masthead-hero-blend"
      crumb={crumb}
      subNav={
        <nav className="view-tabs section-tabs" aria-label="Learn sections">
          {links('')}
        </nav>
      }
      drawerExtras={
        <nav className="nep-drawer-nav" aria-label="Learn sections">
          {links('')}
        </nav>
      }
    />
  );
}
