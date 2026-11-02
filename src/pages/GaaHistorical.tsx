import { Fragment, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  GaaBrowserHeader,
  GaaBrowserHeading,
  GaaBrowserYears,
} from '../components/GaaBrowserChrome';
import GaaHierarchyRow from '../components/GaaHierarchyRow';
import SiteFooter from '../components/SiteFooter';
import { Eyebrow } from '../components/shared';
import {
  coverageLabel,
  defaultScope,
  scopeLabels,
  useGaaManifest,
} from '../lib/gaa-history';
import type { GaaCoverage, GaaScope } from '../lib/gaa-history';
import {
  historicalStatsQuery,
  historicalChildrenQuery,
  HISTORICAL_LEVELS,
  parseHistoricalBranch,
} from '../lib/gaa-hierarchy-query';
import type { HistoricalBranch } from '../lib/gaa-hierarchy-query';
import { dataUrl } from '../lib/data-url';
import * as fmt from '../lib/format';
import { RecordTable } from './GaaRecords';

interface Child {
  code: string | null;
  name: string | null;
  amount: number;
  records: number;
}
interface Node {
  level: number | null;
  rows: Child[];
  amount: number;
  records: number;
}
const branchLabel = (part: { name: string | null; code: string | null }) =>
  part.name ?? part.code ?? 'Not specified in source';

export default function GaaHistorical({ year }: { year: number }) {
  const { manifest, error } = useGaaManifest();
  const [params] = useSearchParams();
  const c = manifest?.years.find((c) => c.year === year);
  return (
    <>
      <GaaBrowserHeader year={year} />
      <main
        className="gaa-browser-main"
        style={{ maxWidth: 1440, margin: '0 auto', padding: '32px 32px 80px' }}
      >
        <GaaBrowserHeading year={year} />
        <GaaBrowserYears year={year} />
        {error && (
          <p role="alert">
            {error}{' '}
            <button onClick={() => window.location.reload()}>Retry</button>
          </p>
        )}
        {!c && !error && <p role="status">Loading year coverage…</p>}
        {c && <HistoricalYear key={`${year}:${params}`} coverage={c} />}
      </main>
      <SiteFooter source="SOURCE: DBM GAA ARCHIVE · FY 2000–2026 · COVERAGE VARIES BY YEAR" />
    </>
  );
}
function HistoricalYear({ coverage: c }: { coverage: GaaCoverage }) {
  const [params, setParams] = useSearchParams();
  const scope = params.has('scope')
    ? c.scopes.find((s) => s.id === params.get('scope'))
    : defaultScope(c.scopes);
  let path: HistoricalBranch[] = [];
  let pathError = '';
  try {
    path = parseHistoricalBranch(params.get('branch'));
  } catch {
    pathError =
      'This hierarchy link is invalid. Return to all groups to browse this year.';
  }
  return (
    <>
      {c.source_year ? (
        <aside className="gaa-coverage" aria-label="Year coverage">
          <strong>Reenacted budget</strong>
          <p>
            The {c.source_year} budget was reenacted in {c.year}. No new GAA
            records are included. This does not mean zero budget or spending.{' '}
            <Link to={`/gaa/${c.source_year}`}>
              Browse FY {c.source_year} →
            </Link>
          </p>
        </aside>
      ) : (
        <details className="gaa-coverage" aria-label="Year coverage">
          <summary>
            <strong>{coverageLabel(c.status)}</strong> · Available detail varies
            · Coverage notes
          </summary>
          {c.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
          <p>
            Unprogrammed appropriations are conditional and kept separate.
            Historical scope totals are not a comparable national budget series.
          </p>
        </details>
      )}
      {!c.source_year && (
        <>
          <div className="gaa-toolbar">
            <label>
              Appropriation scope
              <select
                aria-label="Appropriation scope"
                value={scope?.id ?? ''}
                onChange={(e) => setParams({ scope: e.target.value })}
              >
                {!scope && <option value="">Choose a valid scope</option>}
                {c.scopes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {scopeLabels[s.id] ?? s.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!scope ? (
            <p role="alert">
              This scope is unavailable for FY {c.year}. Choose a published
              scope above.
            </p>
          ) : (
            <>
              <div className="kpi-strip">
                <div className="kpi-cell">
                  <div className="kpi-label">
                    FY {c.year} recorded appropriation
                  </div>
                  <div className="kpi-value">
                    {fmt.shortPhp(scope.amount, 'T')}
                  </div>
                  <div className="kpi-sub">
                    {scopeLabels[scope.id]} · {scope.rows.toLocaleString()}{' '}
                    records
                  </div>
                </div>
                <div className="kpi-cell">
                  <div className="kpi-label">YoY change</div>
                  <div className="kpi-value">—</div>
                  <div className="kpi-sub">
                    historical coverage not directly comparable
                  </div>
                </div>
                <div className="kpi-cell">
                  <div className="kpi-label">Largest group share</div>
                  <div className="kpi-value">
                    {scope.amount
                      ? fmt.pct(scope.groups[0].amount / scope.amount)
                      : '—'}
                  </div>
                  <div className="kpi-sub">
                    {scope.groups[0]?.name ?? 'Not specified in source'}
                  </div>
                </div>
                <div className="kpi-cell">
                  <div className="kpi-label">Groups in selected scope</div>
                  <div className="kpi-value">{scope.groups.length}</div>
                  <div className="kpi-sub">as published · coverage varies</div>
                </div>
              </div>
              {pathError ? (
                <p role="alert">
                  {pathError}{' '}
                  <Link to={`?scope=${encodeURIComponent(scope.id)}`}>
                    All groups →
                  </Link>
                </p>
              ) : (
                <HistoricalNode coverage={c} scope={scope} path={path} />
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
function HistoricalNode({
  coverage: c,
  scope,
  path,
}: {
  coverage: GaaCoverage;
  scope: GaaScope;
  path: HistoricalBranch[];
}) {
  const [params, setParams] = useSearchParams();
  const [node, setNode] = useState<Node | undefined>(() =>
    path.length
      ? undefined
      : {
          level: 0,
          rows: scope.groups.map((g) => ({
            code: null,
            name: g.name,
            amount: g.amount,
            records: g.rows,
          })),
          amount: scope.amount,
          records: scope.rows,
        },
  );
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(200);
  const branch = JSON.stringify(path);
  const rawPage = Number(params.get('page') ?? 1);
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  useEffect(() => {
    if (branch === '[]') return;
    let live = true;
    const parts = parseHistoricalBranch(branch);
    const url = new URL(dataUrl(`gaa-explorer/${c.file}`), window.location.href)
      .href;
    (async () => {
      const { runQuery } = await import('../lib/duckdb');
      const stats = historicalStatsQuery(url, scope.id, parts);
      const result = (
        await runQuery<Record<string, number | bigint | null>>(
          stats.sql,
          stats.params,
        )
      ).rows[0];
      const next = HISTORICAL_LEVELS.findIndex(
        (_, i) => i > parts.at(-1)!.level && Number(result[`level_${i}`]) > 0,
      );
      let rows: Child[] = [];
      if (next >= 0) {
        const children = historicalChildrenQuery(url, scope.id, parts, next);
        rows = (await runQuery<Child>(children.sql, children.params)).rows.map(
          (r) => ({
            ...r,
            amount: Number(r.amount),
            records: Number(r.records),
          }),
        );
      }
      if (live)
        setNode({
          level: next < 0 ? null : next,
          rows,
          amount: Number(result.amount ?? 0),
          records: Number(result.records),
        });
    })().catch((e) => {
      if (live) setError(String(e.message ?? e));
    });
    return () => {
      live = false;
    };
  }, [branch, c.file, scope.id]);
  const title = node
    ? node.level === null
      ? 'Source records'
      : HISTORICAL_LEVELS[node.level].label
    : 'Loading hierarchy…';
  const href = (parts: HistoricalBranch[]) =>
    `?${new URLSearchParams({ scope: scope.id, ...(parts.length ? { branch: JSON.stringify(parts) } : {}) })}`;
  function jump(parts: HistoricalBranch[]) {
    setParams(new URLSearchParams(href(parts).slice(1)));
  }
  const peak = Math.max(...(node?.rows.map((r) => r.amount) ?? []), 0);
  return (
    <>
      <div style={{ marginBottom: 14, marginTop: 28 }}>
        <Eyebrow>
          Hierarchy · FY {c.year} only, drill through available levels
        </Eyebrow>
      </div>
      <div className="drill-mobile-bar" aria-label="Current drilldown level">
        <button onClick={() => jump(path.slice(0, -1))} disabled={!path.length}>
          ← Back
        </button>
        <div>
          <span>{title}</span>
          <strong>
            {path.length
              ? branchLabel(path.at(-1)!)
              : `All groups · FY ${c.year}`}
          </strong>
        </div>
        <em>{node?.rows.length ?? '…'}</em>
      </div>
      <div className="crumbs">
        <Link to={href([])}>All groups · FY {c.year}</Link>
        {path.map((part, i) => (
          <Fragment key={part.level}>
            <span className="sep">›</span>
            <Link to={href(path.slice(0, i + 1))}>{branchLabel(part)}</Link>
          </Fragment>
        ))}
        <span className="sep">›</span>
        <span className="current">{title}</span>
      </div>
      {error ? (
        <p role="alert">
          Could not load this branch: {error}{' '}
          <button onClick={() => window.location.reload()}>Retry</button>
        </p>
      ) : !node ? (
        <p role="status">Loading hierarchy…</p>
      ) : !node.records ? (
        <p role="status">
          No published records match this branch.{' '}
          <Link to={href([])}>Return to all groups</Link>
        </p>
      ) : node.level === null ? (
        <>
          <p className="note-block">
            This is the finest detail available for this branch. Each record
            retains its published detail and source reference.
          </p>
          <RecordTable
            file={c.file}
            scope={scope.id}
            grain=""
            search=""
            page={page}
            branch={branch}
            onPage={(p) => {
              const next = new URLSearchParams(params);
              next.set('page', String(p));
              setParams(next);
            }}
          />
        </>
      ) : (
        <>
          <table className="hier-table drill-table">
            <thead>
              <tr>
                <th>{title}</th>
                <th style={{ width: 160 }}>Share of max</th>
                <th className="right">FY {c.year}</th>
                <th className="right">% of level</th>
                <th className="right">YoY</th>
                <th style={{ width: 24 }} />
              </tr>
            </thead>
            <tbody>
              {node.rows.slice(0, limit).map((r, i) => (
                <GaaHierarchyRow
                  key={JSON.stringify([r.code, r.name])}
                  rec={{
                    id: String(i),
                    slug: '',
                    description: branchLabel(r),
                    years: { [c.year]: { amount: r.amount, count: r.records } },
                  }}
                  year={c.year}
                  max={peak}
                  total={node.amount}
                  prevYear={null}
                  comparable={false}
                  drillable
                  onClick={() =>
                    jump([
                      ...path,
                      { level: node.level!, code: r.code, name: r.name },
                    ])
                  }
                  code={r.code ?? undefined}
                />
              ))}
            </tbody>
          </table>
          {node.rows.length > limit && (
            <button
              className="csv-btn"
              onClick={() => setLimit((n) => n + 200)}
            >
              Show more · {limit.toLocaleString()} of{' '}
              {node.rows.length.toLocaleString()}
            </button>
          )}
          <p className="note-block" style={{ marginTop: 24 }}>
            Amounts are in pesos. Shares refer to the selected branch and
            appropriation scope. Missing hierarchy levels are skipped; records
            without a label remain under “Not specified in source”.
          </p>
        </>
      )}
    </>
  );
}
