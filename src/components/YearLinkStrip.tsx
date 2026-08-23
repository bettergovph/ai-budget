import { Link } from 'react-router-dom';
import * as fmt from '../lib/format';
import type { YearlyTotalRow } from '../lib/types';

/**
 * Year cells that navigate (vs. Portal's YearStrip, which sets local state).
 * Each cell links to /gaa/:year — the per-year budget browser — and the bars
 * are proportional to the biggest year so the strip doubles as a mini
 * national-trend chart. Amounts are pesos (national/index.json scale).
 */
export default function YearLinkStrip({
  yearly,
  active,
  suffix = '',
}: {
  yearly: YearlyTotalRow[];
  active?: number;
  /** URL-encoded drill path appended after the year (e.g. "/07/07-001") so
      switching years keeps your place in the hierarchy. */
  suffix?: string;
}) {
  const peak = Math.max(...yearly.map((y) => y.amount), 0);
  return (
    <div className="year-strip" role="tablist" aria-label="Fiscal year">
      {yearly.map(({ year, amount }) => (
        <Link
          key={year}
          role="tab"
          aria-selected={year === active}
          aria-current={year === active ? 'page' : undefined}
          className={`year-cell ${year === active ? 'active' : ''}`}
          to={`/gaa/${year}${suffix}`}
        >
          <div className="year-cell-num">FY {year}</div>
          <div className="year-cell-meta">{fmt.shortPhp(amount, 'T')} GAA</div>
          <div className="year-cell-bar">
            <span style={{ width: `${peak ? (amount / peak) * 100 : 0}%` }} />
          </div>
        </Link>
      ))}
    </div>
  );
}
