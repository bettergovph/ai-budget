import { parseHistoricalBranch } from '../lib/gaa-hierarchy-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader';
import SiteFooter from '../components/SiteFooter';
import { GaaYearSelect } from '../components/GaaYears';
import {
  coverageLabel,
  defaultScope,
  pesos,
  scopeLabels,
  useGaaManifest,
} from '../lib/gaa-history';
import type { GaaCoverage } from '../lib/gaa-history';
import { dataUrl } from '../lib/data-url';
import { gaaRecordQuery, GAA_PAGE_SIZE } from '../lib/gaa-history-query';
import '../components/GaaHistory.css';

type RecordRow = Record<string, string | number | bigint | null>;
const humanize = (v: string) => v.replaceAll('_', ' ');
const detailFields = [
  'record_id',
  'department_id',
  'agency_code',
  'fpap_code',
  'program_code',
  'program_dsc',
  'operunit_code',
  'operunit_dsc',
  'div_dsc',
  'region_dsc',
  'fund_code',
  'fund_dsc',
  'expense_code',
  'expense_dsc',
  'object_code',
  'object_dsc',
  'grain',
  'budget_scope',
  'budget_status',
  'quality_status',
  'source_year',
  'source_member',
  'source_document_id',
  'source_page',
  'source_line',
  'source_section_id',
  'source_object_code',
  'source_text',
  'source_sha256',
];

export default function GaaRecords({ year }: { year: number }) {
  const { manifest, error } = useGaaManifest();
  const [params] = useSearchParams();
  const coverage = manifest?.years.find((y) => y.year === year);
  return (
    <>
      <SiteHeader />
      <main className="gaa-records">
        <Link to="/gaa">← GAA overview · 2000–2026</Link>
        <div>
          <GaaYearSelect year={year} records />
        </div>
        <p className="page-eyebrow">GAA source records</p>
        <h1 className="page-title">FY {year} appropriations</h1>
        <p className="page-dek">
          Explore the published records and their source references. Amounts are
          in Philippine pesos; available detail varies by year.
        </p>
        {error && (
          <p role="alert">
            {error}{' '}
            <button onClick={() => window.location.reload()}>Retry</button>
          </p>
        )}
        {!coverage && !error && <p role="status">Loading coverage…</p>}
        {coverage && (
          <YearContents
            key={`${year}:${params.toString()}`}
            coverage={coverage}
          />
        )}
      </main>
      <SiteFooter source="SOURCE: DBM GAA ARCHIVE · FY 2000–2026 · COVERAGE VARIES BY YEAR" />
    </>
  );
}

function YearContents({ coverage: c }: { coverage: GaaCoverage }) {
  const [params, setParams] = useSearchParams();
  const requestedScope = params.get('scope');
  const scope = requestedScope
    ? c.scopes.find((s) => s.id === requestedScope)
    : defaultScope(c.scopes);
  const department = params.has('department')
    ? params.get('department')!
    : undefined;
  const missingDepartment = params.get('missingDepartment') === '1';
  const grain = params.get('grain') ?? '';
  const search = params.get('q') ?? '';
  const [draft, setDraft] = useState(search);
  const rawPage = Number(params.get('page') ?? 1);
  const page =
    Number.isSafeInteger(rawPage) && rawPage > 0
      ? Math.min(rawPage, 1_000_000)
      : 1;
  const showRecords = params.get('view') === 'records';
  const group = scope?.groups.find(
    (g) => g.name === (missingDepartment ? null : department),
  );
  function change(values: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    next.delete('page');
    for (const [k, v] of Object.entries(values)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next);
  }
  const recordsUrl = (name: string | null) => {
    const next = new URLSearchParams({ scope: scope!.id, view: 'records' });
    next.set(name === null ? 'missingDepartment' : 'department', name ?? '1');
    return `?${next}`;
  };
  return (
    <>
      <aside className="gaa-coverage" aria-label="Year coverage">
        <strong>{coverageLabel(c.status)}</strong>
        {c.source_year && (
          <p>
            The {c.source_year} budget was reenacted in {c.year}. No new GAA
            records are included for this year. This does not mean zero budget
            or zero spending.{' '}
            <Link to={`/gaa/${c.source_year}`}>
              View {c.source_year} source records →
            </Link>
          </p>
        )}
        {c.notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </aside>
      <div className="gaa-downloads">
        <a href={dataUrl(`gaa-explorer/${c.file}`)} download>
          Download FY {c.year} Parquet{c.source_year ? ' (empty facts)' : ''}
        </a>
        <a href={dataUrl('gaa-explorer/coverage.md')}>Coverage notes</a>
        {c.year >= 2020 && (
          <Link to={`/gaa/${c.year}`}>Open detailed hierarchy →</Link>
        )}
      </div>
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
                    {scopeLabels[s.id] ?? humanize(s.id)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!scope ? (
            <p role="alert">
              This scope is unavailable for FY {c.year}. Choose one of the
              published scopes above.
            </p>
          ) : (
            <>
              <div className="kpi-strip">
                <div className="kpi-cell">
                  <div className="kpi-label">
                    Recorded amount · selected scope
                  </div>
                  <div
                    className="kpi-value"
                    style={{ fontSize: 'clamp(22px, 4vw, 36px)' }}
                  >
                    {pesos(scope.amount)}
                  </div>
                  <div className="kpi-sub">{scopeLabels[scope.id]}</div>
                </div>
                <div className="kpi-cell">
                  <div className="kpi-label">Records in selected scope</div>
                  <div className="kpi-value">{scope.rows.toLocaleString()}</div>
                  <div className="kpi-sub">
                    {scope.groups.length} source groups
                  </div>
                </div>
              </div>
              <p className="note-block">
                This is the sum of the available records in this scope, not a
                comparable national total. Unprogrammed appropriations are
                conditional and shown separately. Historical classifications
                have not been mapped to modern codes.
              </p>
              {!showRecords ? (
                <>
                  <div className="gaa-toolbar">
                    <h2>Groups in this scope</h2>
                    <button onClick={() => change({ view: 'records' })}>
                      Browse all source records
                    </button>
                  </div>
                  <div className="gaa-table-wrap">
                    <table className="gaa-record-table gaa-group-table">
                      <thead>
                        <tr>
                          <th>Group as published</th>
                          <th className="gaa-amount">Recorded amount</th>
                          <th>Records</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scope.groups.map((g) => (
                          <tr key={g.name ?? '__missing'}>
                            <td>
                              <Link to={recordsUrl(g.name)}>
                                {g.name ?? 'Group not specified in source'} →
                              </Link>
                            </td>
                            <td className="gaa-amount">{pesos(g.amount)}</td>
                            <td>{g.rows.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <>
                  <p>
                    <Link to={`?scope=${encodeURIComponent(scope.id)}`}>
                      ← Groups in this scope
                    </Link>
                  </p>
                  <h2>
                    {group?.name ??
                      (missingDepartment
                        ? 'Group not specified in source'
                        : (department ?? 'All source records'))}
                  </h2>
                  <form
                    className="gaa-toolbar"
                    onSubmit={(e) => {
                      e.preventDefault();
                      change({ q: draft.trim() });
                    }}
                  >
                    <label>
                      Search descriptions
                      <input
                        type="search"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="Agency, program, object…"
                      />
                    </label>
                    <label>
                      Record detail
                      <select
                        value={grain}
                        onChange={(e) => change({ grain: e.target.value })}
                      >
                        <option value="">All available detail</option>
                        {Object.keys(c.grains).map((g) => (
                          <option key={g} value={g}>
                            {humanize(g)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit">Search</button>
                    {(search || grain) && (
                      <button
                        type="button"
                        onClick={() => change({ q: null, grain: null })}
                      >
                        Clear filters
                      </button>
                    )}
                  </form>
                  <RecordTable
                    file={c.file}
                    scope={scope.id}
                    department={missingDepartment ? null : department}
                    grain={grain}
                    search={search}
                    page={page}
                    onPage={(p) => change({ page: String(p) })}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

export function RecordTable({
  file,
  scope,
  branch,
  department,
  grain,
  search,
  page,
  onPage,
}: {
  file: string;
  scope: string;
  branch?: string;
  department?: string | null;
  grain: string;
  search: string;
  page: number;
  onPage: (page: number) => void;
}) {
  const [rows, setRows] = useState<RecordRow[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const load = async () => {
      const query = gaaRecordQuery(
        new URL(dataUrl(`gaa-explorer/${file}`), window.location.href).href,
        {
          scope,
          department,
          grain,
          search,
          page,
          branch: parseHistoricalBranch(branch ?? null),
        },
      );
      return import('../lib/duckdb')
        .then(({ runQuery }) => runQuery<RecordRow>(query.sql, query.params))
        .then((r) => {
          if (live) setRows(r.rows);
        });
    };
    load().catch((e) => {
      if (live) setError(String(e.message ?? e));
    });
    return () => {
      live = false;
    };
  }, [file, scope, department, grain, search, page, branch]);
  if (error)
    return (
      <p role="alert">
        Source records could not be loaded. {error}{' '}
        <button onClick={() => window.location.reload()}>Retry</button> You can
        also download this year's Parquet above.
      </p>
    );
  if (!rows)
    return (
      <p role="status">
        Loading source records… The first query loads the browser data engine.
      </p>
    );
  const count = Number(rows[0]?.matched_rows ?? 0);
  return (
    <>
      <p role="status">
        {count
          ? `${count.toLocaleString()} matching records · page ${page} of ${Math.ceil(count / GAA_PAGE_SIZE).toLocaleString()}`
          : 'No matching records on this page.'}
      </p>
      <div className="gaa-table-wrap">
        <table className="gaa-record-table">
          <thead>
            <tr>
              <th>Agency / available description</th>
              <th className="gaa-amount">Amount (PHP)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const url = String(r.source_url ?? '');
              const safeSource = /^https?:\/\//i.test(url);
              return (
                <tr key={`${r.record_id}:${i}`}>
                  <td>
                    <strong>
                      {String(
                        r.agency_dsc ??
                          r.department_dsc ??
                          'Not specified in source',
                      )}
                    </strong>
                    <div>
                      {String(
                        r.fpap_dsc ??
                          r.program_dsc ??
                          r.object_dsc ??
                          r.source_text ??
                          'Summary appropriation',
                      )}
                    </div>
                    <small>
                      {humanize(String(r.grain))} ·{' '}
                      {String(r.department_dsc ?? 'Group not specified')}
                    </small>
                    <details>
                      <summary>Source and record details</summary>
                      {safeSource && (
                        <p>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open DBM source ↗
                          </a>
                        </p>
                      )}
                      <dl>
                        {detailFields
                          .filter(
                            (k) =>
                              r[k] !== null &&
                              r[k] !== undefined &&
                              r[k] !== '',
                          )
                          .map((k) => (
                            <FragmentRow
                              key={k}
                              label={humanize(k)}
                              value={String(r[k])}
                            />
                          ))}
                      </dl>
                    </details>
                  </td>
                  <td className="gaa-amount">{pesos(Number(r.amount))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="gaa-pagination">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <span>Page {page}</span>
        <button
          disabled={!count || page * GAA_PAGE_SIZE >= count}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
        {page > 1 && !count && (
          <button onClick={() => onPage(1)}>First page</button>
        )}
      </div>
    </>
  );
}
function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
