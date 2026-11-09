/**
 * Shared pieces of the Indicators pages: the data hook, the review notice, the source list and the
 * loading/error states.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  INDICATORS_ROOT, INDICATORS_UNDER_REVIEW, STATISTICS_SITE, indicatorPath,
  type IndicatorDef, type IndicatorsFile,
} from '../lib/indicators';
import { csvHref } from '../lib/indicators-view';

export function IndicatorsStatus({ error }: { error: string | null }) {
  return error
    ? <div className="nep-status nep-status-error"><p>The indicators did not load.</p><p className="nep-status-hint">{error}</p></div>
    : <div className="nep-status">Loading the indicators…</div>;
}

export function IndicatorsReviewNotice() {
  if (!INDICATORS_UNDER_REVIEW) return null;
  return (
    <aside className="ind-review" aria-label="New section">
      <p className="ind-review-tag">New · under review</p>
      <p>
        We built this section in November 2026 and have not finished checking it. The statistics are PSA’s,
        as published; how we combine provinces with their cities, and the budget figures, are ours. Check a
        figure against its source, linked under each indicator, before you cite it.
      </p>
    </aside>
  );
}

export function SourceList({ data, def }: { data: IndicatorsFile; def: IndicatorDef }) {
  const list = def.sources.map((k) => data.sources.find((s) => s.key === k)).filter((s) => s != null);
  return (
    <ul className="ind-sources">
      {list.map((s) => {
        const internal = s.url.startsWith('/');
        return (
          <li key={s.key}>
            {internal ? <Link to={s.url}>{s.title}</Link> : <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title} ↗</a>}
            <span className="ind-sources-meta">
              {s.publisher}{s.as_of ? ` · ${s.as_of}` : ''}
              {s.publisher_url && <> · <a href={s.publisher_url} target="_blank" rel="noopener noreferrer">publisher’s page ↗</a></>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function IndicatorsFooterNote({ data, children }: { data: IndicatorsFile; children?: ReactNode }) {
  return (
    <div className="nep-provenance ind-provenance">
      {children}
      <p>
        PSA tables are read through the <a href={STATISTICS_SITE} target="_blank" rel="noopener noreferrer">Philippine
        Statistics Explorer ↗</a>, BetterGov’s mirror of PSA OpenSTAT. PSA is the authoritative source.
        {' '}{data.notes.join(' ')} Built {data.built_at.slice(0, 10)}.
        {' '}<Link to={INDICATORS_ROOT}>All indicators</Link> · <a href={csvHref(data)} download>Download every figure (CSV)</a>
      </p>
    </div>
  );
}

export function IndicatorLink({ def }: { def: IndicatorDef }) {
  return <Link to={indicatorPath(def.id)}>{def.title}</Link>;
}
