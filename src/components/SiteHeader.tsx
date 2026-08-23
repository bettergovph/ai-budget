import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

const LOGO_URL = 'https://assets.bettergov.ph/logos/png/horizontal-primary.png';

interface SiteHeaderProps {
  /** Extra class on the <header> for page-scoped variants (e.g. hero blend). */
  headerClassName?: string;
  /** Page-specific sub-nav rendered as a strip below the primary nav. */
  subNav?: ReactNode;
  /** Extra content placed inside the mobile drawer (e.g., per-page section nav, download links). */
  drawerExtras?: ReactNode;
  /** Right-side breadcrumb / meta string in the masthead-top utility row (e.g., "DEPARTMENT 07 · DEPED"). */
  crumb?: ReactNode;
  /** Compiled-meta string for the right side of the masthead-top row (e.g., "PHP 6.79T compiled"). */
  compiledMeta?: ReactNode;
}

const UTILITY_LINKS = [
  { href: 'https://bettergov.ph', label: 'BetterGov.ph' },
  { href: 'https://data.bettergov.ph', label: 'Open Data' },
  { href: 'https://about.bettergov.ph', label: 'About' },
];

// Worker-served (non-SPA) pages: the public API reference and the MCP
// section of the same document. Plain anchors, not <Link>s.
const DEV_LINKS = [
  { href: '/docs', label: 'API' },
  { href: '/docs#mcp', label: 'MCP' },
];

function isActivePath(pathname: string, href: string): boolean {
  const p = pathname.replace(/\/$/, '');
  const h = href.replace(/\/$/, '');
  if (h === '') return p === '';
  return p === h || p.startsWith(h + '/');
}

export default function SiteHeader({ headerClassName, subNav, drawerExtras, crumb, compiledMeta }: SiteHeaderProps) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  // Auto-close drawer when the user clicks any link or button inside it (e.g.
  // a Portal section tab in drawerExtras). Avoids prop-drilling a callback.
  const handleDrawerClick: React.MouseEventHandler<HTMLElement> = (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('a, button')) setMenuOpen(false);
  };

  // The masthead coverage label follows the section you're in: the GAA portal
  // covers FY2020-2026 (a single year on the /gaa/:year browser), the /2027
  // microsite covers the FY2027 NEP alone.
  const gaaYear = /^\/gaa\/(\d{4})(?:\/|$)/.exec(location.pathname)?.[1];
  const coverage = gaaYear
    ? `FY ${gaaYear}`
    : location.pathname.startsWith('/gaa')
    || location.pathname.startsWith('/d/')
    || location.pathname.startsWith('/methodology')
    || location.pathname.startsWith('/explore')
    ? 'FY 2020 \u2013 2026'
    : 'FY 2027 NEP';

  const today = useMemo(
    () =>
      new Date().toLocaleDateString('en-PH', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
    [],
  );

  return (
    <>
      <header className={`masthead ${headerClassName ?? ''}`.trim()}>
        {/* Full-bleed wrapper: carries the masthead's single horizontal rule
            so it runs edge to edge, while the content inside stays within the
            centred container. */}
        <div className="masthead-chrome">
        <div className="masthead-inner">
          <div className="masthead-top">
            <span className="masthead-meta-l">
              <span className="masthead-date">{today}</span>
              <span className="masthead-meta-sep">·</span>
              <span className="masthead-loc">Manila</span>
            </span>
            <span className="masthead-meta-r">
              {compiledMeta && (
                <>
                  <span className="masthead-compiled">{compiledMeta}</span>
                  <span className="masthead-meta-sep masthead-util-sep">·</span>
                </>
              )}
              {DEV_LINKS.map((l) => (
                <span key={l.label} className="masthead-util-item">
                  <a href={l.href} className="masthead-util-link">
                    {l.label}
                  </a>
                  <span className="masthead-meta-sep">·</span>
                </span>
              ))}
              {UTILITY_LINKS.map((l, i) => (
                <span key={l.label} className="masthead-util-item">
                  <a href={l.href} target="_blank" rel="noopener noreferrer" className="masthead-util-link">
                    {l.label} <span className="util-arrow">↗</span>
                  </a>
                  {i < UTILITY_LINKS.length - 1 && <span className="masthead-meta-sep">·</span>}
                </span>
              ))}
            </span>
          </div>

          <div className="logo-row">
            <Link to="/" aria-label="BetterGov · Philippines GAA" className="logo-link">
              <img src={LOGO_URL} alt="BetterGov.ph" className="logo-img" />
            </Link>
            <div className="logo-tag">
              <span className="logo-tag-divider" aria-hidden="true" />
              <span className="logo-tag-text">
                {crumb ? (
                  <>
                    {crumb}
                    <span className="logo-tag-em">— {coverage}</span>
                  </>
                ) : (
                  <>
                    Reports <span className="logo-tag-em">— Philippines GAA, {coverage}</span>
                  </>
                )}
              </span>
            </div>
            <button
              type="button"
              className={`hamburger ${menuOpen ? 'open' : ''}`}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="mobile-drawer"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span />
              <span />
              <span />
            </button>
          </div>

          <nav className="primary-nav" aria-label="Primary">
            <Link
              to="/2027"
              className={`primary-nav-link ${location.pathname.startsWith('/2027') ? 'active' : ''}`}
            >
              National Expenditures 2027
            </Link>
            <Link
              to="/gaa"
              className={`primary-nav-link ${isActivePath(location.pathname, '/gaa') || location.pathname.startsWith('/d/') ? 'active' : ''}`}
            >
              General Appropriations 2020–2026
            </Link>
            <a
              href="https://2026-budget.bettergov.ph"
              target="_blank"
              rel="noopener noreferrer"
              className="primary-nav-link primary-nav-external"
            >
              2026 Budget Tracker <span className="util-arrow">↗</span>
            </a>
          </nav>

        </div>
        </div>
        {subNav && (
          <div className="primary-subnav">
            <div className="primary-subnav-inner">{subNav}</div>
          </div>
        )}
      </header>

      {menuOpen && (
        <div className="drawer-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
      )}
      <aside
        id="mobile-drawer"
        className={`drawer ${menuOpen ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Site navigation"
        onClick={handleDrawerClick}
      >
        <div className="drawer-head">
          <span className="drawer-eyebrow">BetterGov · Reports</span>
          <button
            type="button"
            className="drawer-close"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          >
            ×
          </button>
        </div>
        <nav className="drawer-nav" aria-label="Site sections">
          <Link className="drawer-link" to="/2027" onClick={() => setMenuOpen(false)}>
            NEP 2027 <span className="drawer-link-arrow">→</span>
          </Link>
          <Link className="drawer-link" to="/gaa" onClick={() => setMenuOpen(false)}>
            GAA 2020–2026 <span className="drawer-link-arrow">→</span>
          </Link>
          <a
            className="drawer-link"
            href="https://2026-budget.bettergov.ph"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenuOpen(false)}
          >
            2026 Budget Tracker <span className="drawer-link-arrow">↗</span>
          </a>
        </nav>

        {drawerExtras && <div className="drawer-extras">{drawerExtras}</div>}

        <div className="drawer-section">
          <span className="drawer-eyebrow">For developers</span>
          <a
            className="drawer-link drawer-link-cross"
            href="/docs"
            onClick={() => setMenuOpen(false)}
          >
            Public API docs <span className="drawer-link-arrow">→</span>
          </a>
          <a
            className="drawer-link drawer-link-cross"
            href="/docs#mcp"
            onClick={() => setMenuOpen(false)}
          >
            MCP server for AI agents <span className="drawer-link-arrow">→</span>
          </a>
        </div>

        <div className="drawer-section">
          <span className="drawer-eyebrow">Elsewhere on BetterGov</span>
          {UTILITY_LINKS.map((l) => (
            <a
              key={l.label}
              className="drawer-link drawer-link-cross"
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
            >
              {l.label} <span className="drawer-link-arrow">↗</span>
            </a>
          ))}
        </div>
      </aside>
    </>
  );
}
