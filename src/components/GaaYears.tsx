import { Link, useNavigate } from 'react-router-dom';
import { GAA_YEARS, coverageLabel, useGaaManifest } from '../lib/gaa-history';
import { dataUrl } from '../lib/data-url';
import './GaaHistory.css';

export function GaaYearSelect({
  year,
  records = false,
}: {
  year: number;
  records?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <label className="gaa-year-select">
      Fiscal year{' '}
      <select
        value={year}
        onChange={(e) =>
          navigate(`/gaa/${e.target.value}${records ? '/records' : ''}`)
        }
      >
        {GAA_YEARS.map((y) => (
          <option key={y} value={y}>
            {y}
            {[2001, 2004, 2006].includes(y) ? ' · reenacted' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function GaaYears() {
  const { manifest, error } = useGaaManifest();
  return (
    <section className="gaa-archive" aria-labelledby="gaa-archive-heading">
      <p className="page-eyebrow">27 fiscal years · 2000–2026</p>
      <h2 id="gaa-archive-heading">Explore the GAA archive</h2>
      <p>
        Browse appropriations by year, from historical agency summaries to
        detailed line items. Coverage and classifications change over time; the
        earlier amounts do not form a comparable national budget series.
      </p>
      {error && (
        <p role="alert">
          {error}{' '}
          <button onClick={() => window.location.reload()}>Retry</button>
        </p>
      )}
      {!manifest && !error && <p role="status">Loading year coverage…</p>}
      <div className="gaa-year-grid">
        {manifest?.years.toSorted((a, b) => b.year - a.year).map((y) => (
          <Link
            key={y.year}
            to={`/gaa/${y.year}`}
            className={`gaa-year-card ${y.status === 'reenacted_no_new_gaa' ? 'reenacted' : ''}`}
          >
            <strong>{y.year}</strong>
            <span>{coverageLabel(y.status)}</span>
            <small>
              {y.source_year
                ? `Reenacts ${y.source_year}`
                : `${y.rows.toLocaleString()} records`}
            </small>
          </Link>
        ))}
      </div>
      {manifest && (
        <div className="gaa-downloads">
          <a href={dataUrl(`gaa-explorer/${manifest.download}`)} download>
            Download 2000–2026 Parquet · {manifest.rows.toLocaleString()}{' '}
            records
          </a>
          <a href={dataUrl('gaa-explorer/coverage.md')}>
            Year-by-year coverage
          </a>
          <Link to="/methodology">How to use these figures</Link>
        </div>
      )}
    </section>
  );
}
