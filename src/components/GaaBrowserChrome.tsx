import { Link } from 'react-router-dom';
import SiteHeader from './SiteHeader';
import { GaaYearSelect } from './GaaYears';
import { GAA_YEARS, useGaaManifest } from '../lib/gaa-history';

function nearbyYears(year: number) {
  const start = Math.max(
    0,
    Math.min(GAA_YEARS.indexOf(year) - 3, GAA_YEARS.length - 7),
  );
  return GAA_YEARS.slice(start, start + 7);
}
function yearUrl(year: number, suffix: string) {
  // Modern IDs have no historical crosswalk. Historical branches are year-specific.
  return `/gaa/${year}${year >= 2020 ? suffix : ''}`;
}
export function GaaBrowserHeader({
  year,
  suffix = '',
}: {
  year: number;
  suffix?: string;
}) {
  return (
    <SiteHeader
      crumb={<>Per-year browser</>}
      compiledMeta={`Compiled · FY ${year}`}
      subNav={
        <nav
          className="view-tabs section-tabs gaa-fiscal-tabs"
          aria-label="Fiscal years"
        >
          <Link to="/gaa">All years</Link>
          {nearbyYears(year).map((y) => (
            <Link
              key={y}
              to={yearUrl(y, suffix)}
              className={y === year ? 'active' : ''}
            >
              FY {y}
            </Link>
          ))}
        </nav>
      }
      drawerExtras={
        <>
          <Link className="drawer-link" to="/gaa">
            All years overview →
          </Link>
          {GAA_YEARS.map((y) => (
            <Link key={y} className="drawer-link" to={yearUrl(y, suffix)}>
              FY {y} browser →
            </Link>
          ))}
        </>
      }
    />
  );
}
export function GaaBrowserHeading({ year }: { year: number }) {
  return (
    <div className="page-headline">
      <p className="page-eyebrow">Budget browser · one fiscal year</p>
      <h1 className="page-title">FY {year} General Appropriations</h1>
      <p className="page-dek">
        Explore this year's appropriations from group to bureau and the
        available program, operating unit, fund, and expense detail. Follow the
        breadcrumbs to move between levels; each view has a link you can share.
      </p>
    </div>
  );
}
export function GaaBrowserYears({
  year,
  suffix = '',
}: {
  year: number;
  suffix?: string;
}) {
  const { manifest } = useGaaManifest();
  return (
    <div className="year-strip-wrap" style={{ marginBottom: 24 }}>
      <GaaYearSelect year={year} />
      <p>
        <Link to={`/gaa/${year}/records`}>
          Browse source records and download FY {year} Parquet →
        </Link>
      </p>
      <nav className="year-strip" aria-label="Nearby fiscal years">
        {nearbyYears(year).map((y) => {
          const c = manifest?.years.find((c) => c.year === y);
          return (
            <Link
              key={y}
              className={`year-cell ${y === year ? 'active' : ''}`}
              aria-current={y === year ? 'page' : undefined}
              to={yearUrl(y, suffix)}
            >
              <div className="year-cell-num">FY {y}</div>
              <div className="year-cell-meta">
                {c?.source_year
                  ? 'Reenacted budget'
                  : c
                    ? `${c.rows.toLocaleString()} records`
                    : 'Browse year'}
              </div>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
