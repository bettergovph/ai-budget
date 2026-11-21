/**
 * `/senate/2027/:program` (dpwh, fmr, hfep, nia): one infrastructure program in the Senate committee report,
 * project by project. Views (`?view=`):
 *   overview   totals, what happened to the House bill's projects, by region and by program line
 *   projects   every project, queried in the browser with DuckDB-Wasm over `<program>/projects.parquet`;
 *              filters and paging in the URL so a view can be shared; CSV of what is filtered
 * NEP is shown for reference; "Change" is the committee report minus the House bill.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { SectionHead } from '../components/shared';
import { KpiStrip, SkeletonRows } from '../components/Nep2027Bits';
import {
  SenateError, SenateHeader, SenateHero, SenateLoading, SenateNotice, SenatePages, SenateReviewBanner, SenateStatusChip, SignedChange,
} from '../components/SenateBits';
import SenateDpwhProjects from '../components/SenateDpwhProjects';
import { Check, Dropdown, PanelFoot } from '../components/ReviewFilterBar';
import { runQuery } from '../lib/duckdb';
import { downloadCsv } from '../lib/csv';
import * as fmt from '../lib/format';
import { pageMeta } from '../lib/seo';
import { datasetPath, type DatasetKey } from '../lib/hgab';
import { sqlStr } from '../lib/hgab-query';
import {
  PROGRAM_SHORT, SENATE_PROGRAM_VIEWS, SENATE_STATUS, SENATE_STATUS_ORDER, changeKpi, coerceSenateProject as coerce, loadSenateProgram, programKey, senateListPath, senatePdfUrl, senateProgramPath, senateProjectsUrl,
  senateRecordPath, type SenateDimRow, type SenateProgramSummary, type SenateProject, type SenateStatus,
} from '../lib/senate';
import '../nep2027.css';
import '../hgab-explorer.css';
import '../hgab-dataset.css';

const VIEWS = ['overview', 'projects'] as const;
/** The House bill section's names for the four programs (its overview.json labels). */
const PROGRAM_TITLE: Record<DatasetKey, string> = {
  dpwh: 'DPWH national infrastructure', fmr: 'DA farm-to-market roads', hfep: 'DOH Health Facilities Enhancement Program', nia: 'NIA irrigation',
};
type View = (typeof VIEWS)[number];

export default function SenateProgram() {
  const { dataset } = useParams();
  const key = programKey(dataset);
  const [params] = useSearchParams();
  const view = (VIEWS as readonly string[]).includes(params.get('view') ?? '') ? (params.get('view') as View) : 'overview';
  const [s, setS] = useState<{ key: DatasetKey; sum: SenateProgramSummary | null; err: string | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    loadSenateProgram(key)
      .then((sum) => { if (live) setS({ key, sum, err: null }); })
      .catch((e) => { if (live) setS({ key, sum: null, err: String(e?.message || e) }); });
    return () => { live = false; };
  }, [key]);
  useEffect(() => {
    if (key) document.title = pageMeta(senateProgramPath(key, view)).title;
  }, [key, view]);
  if (!key) return <Navigate to="/senate/2027/overview" replace />;
  // "Changes" was a page of its own until the project lists filtered by change (2026-11-21): its links open the list.
  if (params.get('view') === 'changes') {
    const st = params.get('status');
    return <Navigate to={st ? senateListPath(key, 'status', st) : senateProgramPath(key, 'projects')} replace />;
  }
  const cur = s?.key === key ? s : null;
  if (cur?.err) return <SenateError message={cur.err} />;
  if (!cur?.sum) return <SenateLoading what={`${PROGRAM_SHORT[key]} in the Senate committee report`} />;
  const sum = cur.sum;
  // The trail as the House bill section's program pages: the agency, then the view.
  const viewLabel = SENATE_PROGRAM_VIEWS.find((v) => v.key === view)?.label ?? 'Overview';
  const crumb = view === 'overview' ? sum.agency : (
    <>
      <Link to={senateProgramPath(key)}>{sum.agency}</Link>
      <span className="hgab-crumb-sep" aria-hidden="true">·</span>
      <span className="hgab-crumb-here">{viewLabel}</span>
    </>
  );
  const st = sum.status;
  const changedCount = (['cut', 'reduced', 'raised', 'added', 'restored'] as SenateStatus[]).reduce((a, k) => a + (st[k]?.count ?? 0), 0);
  return (
    <>
      <SenateHeader
        crumb={PROGRAM_SHORT[key]}
        compiledMeta={`${fmt.shortPhp(sum.senate_php)} · Senate · ${fmt.shortPhp(sum.house_php)} House bill`}
        heroBlend={view === 'overview'}
      />
      <SenateHero
        compact={view !== 'overview'}
        crumb={crumb}
        title={`${PROGRAM_TITLE[key]} in the Senate`}
        dek={
          <>
            {fmt.shortPhp(sum.house_php)} in the House bill, {fmt.shortPhp(sum.senate_php)} in the Senate committee report.
            {' '}{changedCount.toLocaleString()} projects change in amount
            {' '}({(['cut', 'reduced', 'raised', 'added', 'restored'] as SenateStatus[]).filter((x) => st[x]?.count)
              .map((x) => `${st[x]!.count.toLocaleString()} ${SENATE_STATUS[x].plural}`).join(', ')})
            {st.renamed?.count ? <>; {st.renamed.count.toLocaleString()} keep their amount under a revised name</> : null}.
          </>
        }
      />
      <main className="nep-main hgab-ex-main">
        <SenateReviewBanner compact />
        {view === 'overview' && <OverviewView k={key} sum={sum} />}
        {view === 'projects' && (key === 'dpwh' ? <SenateDpwhProjects /> : <ProjectsView k={key} />)}
        <p className="nep-provenance">
          From the Senate committee report's <a href={senatePdfUrl(sum.senate_doc)} target="_blank" rel="noreferrer">annex for this program</a>,
          {' '}matched to the House bill's projects (<Link to={datasetPath(key)}>{PROGRAM_SHORT[key]} in the House bill</Link>). Built {sum.built_at.slice(0, 10)}.
        </p>
        <SenateNotice />
      </main>
      <SiteFooter />
    </>
  );
}

function OverviewView({ k, sum }: { k: DatasetKey; sum: SenateProgramSummary }) {
  return (
    <>
      <div className="senate-kpi5"><KpiStrip
        items={[
          { label: 'NEP', value: fmt.shortPhp(sum.nep_php), sub: 'every NEP project, with those the House bill doesn’t have' },
          { label: 'House bill', value: fmt.shortPhp(sum.house_php) },
          { label: 'Senate', value: fmt.shortPhp(sum.senate_php) },
          changeKpi('vs House bill', sum.senate_php, sum.house_php, 'the House bill'),
          changeKpi('vs NEP', sum.senate_php, sum.nep_php, 'the NEP'),
        ]}
      /></div>
      <section className="nep-section">
        <SectionHead eyebrow="What the Senate did to each project" headline="Every project: NEP, House bill and Senate committee report" />
        <div className="nep-table-wrap">
          <table className="nep-table">
            <thead><tr><th>Status</th><th className="num">Projects</th><th className="num">NEP</th><th className="num">House bill</th><th className="num">Senate</th><th className="num">vs House bill</th><th className="num">vs NEP</th><th>What it means</th></tr></thead>
            <tbody>
              {SENATE_STATUS_ORDER.filter((x) => sum.status[x]).map((x) => (
                <tr key={x}>
                  <td><Link to={senateListPath(k, 'status', x)}><SenateStatusChip status={x} /></Link></td>
                  <td className="num">{sum.status[x]!.count.toLocaleString()}</td>
                  <td className="num nep-td-base">{fmt.shortPhp(sum.status[x]!.nep_php)}</td>
                  <td className="num nep-td-base">{fmt.shortPhp(sum.status[x]!.house_php)}</td>
                  <td className="num nep-td-amt">{fmt.shortPhp(sum.status[x]!.senate_php)}</td>
                  <td className="num"><SignedChange v={sum.status[x]!.senate_php - sum.status[x]!.house_php} base={sum.status[x]!.house_php} /></td>
                  <td className="num"><SignedChange v={sum.status[x]!.senate_php - sum.status[x]!.nep_php} base={sum.status[x]!.nep_php} /></td>
                  <td className="hgab-ex-sub">{SENATE_STATUS[x].help}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <DimTable title="By region" rows={sum.regions} k={k} param="region" />
      <DimTable title={k === 'hfep' ? 'By kind of budget' : 'By program line'} rows={sum.programs} k={k} param={k === 'hfep' ? 'pap' : 'program'} />
      {sum.offices && <DimTable title="By office" rows={sum.offices.slice(0, 40)} k={k} param="office" note="The 40 offices with the biggest House bill budgets; filter Projects for the rest." />}
    </>
  );
}

function DimTable({ title, rows, k, param, note }: { title: string; rows: SenateDimRow[]; k: DatasetKey; param: 'region' | 'office' | 'program' | 'pap'; note?: string }) {
  return (
    <section className="nep-section">
      <SectionHead eyebrow="Senate changes, breakdown" headline={title} dek={note} />
      <div className="nep-table-wrap">
        <table className="nep-table">
          <thead><tr><th className="nep-th-name">{title.replace(/^By /, '')}</th><th className="num">NEP</th><th className="num">House bill</th><th className="num">Senate</th><th className="num">vs House bill</th><th className="num">vs NEP</th><th className="num">Projects changed</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="nep-td-name"><Link to={senateListPath(k, param, r.label)}>{r.label}</Link></td>
                <td className="num nep-td-base">{fmt.shortPhp(r.nep_php)}</td>
                <td className="num nep-td-base">{fmt.shortPhp(r.house_php)}</td>
                <td className="num nep-td-amt">{fmt.shortPhp(r.senate_php)}</td>
                <td className="num"><SignedChange v={r.senate_php - r.house_php} base={r.house_php} /></td>
                <td className="num"><SignedChange v={r.senate_php - r.nep_php} base={r.nep_php} /></td>
                <td className="num">{r.changed.toLocaleString()} of {r.count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A House bill line with no NEP line: inserted by the House. */
const INSERTED_SQL = 'nep_php IS NULL AND house_php IS NOT NULL';
const PAGE = 50;
type SortKey = 'house' | 'senate' | 'change' | 'vsnep' | 'title';
const SORT_SQL: Record<SortKey, string> = {
  house: 'house_php', senate: 'senate_php', change: 'change_php', vsnep: '(senate_php - nep_php)', title: 'title',
};

function ProjectsView({ k }: { k: DatasetKey }) {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  // Several values each, as the reviewer's filters: `status=cut|added`, `region=Region I|Region II`.
  const statuses = useMemo(() => (params.get('status') ?? '').split('|').filter(Boolean), [params]);
  const regionsOn = useMemo(() => (params.get('region') ?? '').split('|').filter(Boolean), [params]);
  // Inserted by the House: a House bill line with no NEP line (`ins=yes|no`).
  const ins = useMemo(() => (params.get('ins') ?? '').split('|').filter((v) => v === 'yes' || v === 'no'), [params]);
  const program = params.get('program') ?? '';
  const pap = params.get('pap') ?? '';
  const office = params.get('office') ?? '';
  const sort = ((params.get('sort') ?? 'change') in SORT_SQL ? params.get('sort') ?? 'change' : 'change') as SortKey;
  const dir = params.get('dir') === 'desc' ? 'desc' : params.get('dir') === 'asc' ? 'asc' : (sort === 'change' || sort === 'title' ? 'asc' : 'desc');
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);
  const set = (kv: Record<string, string | null>) => {
    const n = new URLSearchParams(params);
    for (const [a, b] of Object.entries(kv)) { if (b == null || b === '') n.delete(a); else n.set(a, b); }
    if (!('page' in kv)) n.delete('page');
    setParams(n, { replace: true });
  };
  const url = senateProjectsUrl(k);
  // Every filter but `skip`: a filter's options are counted against the others, as in the reviewer.
  const whereOf = useCallback((skip?: 'status' | 'region' | 'ins') => {
    const w: string[] = [];
    for (const word of q.toLowerCase().split(/\s+/).filter(Boolean)) w.push(`search_text LIKE ${sqlStr(`%${word.replace(/[%_]/g, '')}%`)}`);
    if (statuses.length && skip !== 'status') w.push(`status IN (${statuses.map(sqlStr).join(', ')})`);
    if (ins.length === 1 && skip !== 'ins') w.push(`(${INSERTED_SQL}) = ${ins[0] === 'yes'}`);
    if (regionsOn.length && skip !== 'region') w.push(`coalesce(region, 'Not recorded') IN (${regionsOn.map(sqlStr).join(', ')})`);
    if (program) w.push(`coalesce(program, 'Not recorded') = ${sqlStr(program)}`);
    if (pap) w.push(`coalesce(pap, 'Not recorded') = ${sqlStr(pap)}`);
    if (office) w.push(`coalesce(office, 'Not recorded') = ${sqlStr(office)}`);
    return w.length ? `WHERE ${w.join(' AND ')}` : '';
  }, [q, statuses, regionsOn, ins, program, pap, office]);
  const where = useMemo(() => whereOf(), [whereOf]);
  const [res, setRes] = useState<{ sig: string; rows: SenateProject[]; total: { n: number; house: number; senate: number; nep: number } } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [facets, setFacets] = useState<{ sig: string; status: Map<string, number>; statusBase: number; region: Map<string, number>; regionBase: number; ins: Map<string, number>; insBase: number } | null>(null);
  const sig = `${where}|${sort}|${dir}|${page}`;
  useEffect(() => {
    let live = true;
    const src = `read_parquet(${sqlStr(url)})`;
    const order = `${SORT_SQL[sort]} ${dir.toUpperCase()} NULLS LAST, id`;
    Promise.all([
      runQuery<Record<string, unknown>>(`SELECT * EXCLUDE (search_text) FROM ${src} ${where} ORDER BY ${order} LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`),
      runQuery<Record<string, unknown>>(`SELECT count(*) n, sum(house_php) house, sum(senate_php) senate, sum(nep_php) nep FROM ${src} ${where}`),
    ])
      .then(([r, t]) => {
        if (!live) return;
        const tt = t.rows[0] ?? {};
        setRes({ sig, rows: r.rows.map(coerce), total: { n: Number(tt.n ?? 0), house: Number(tt.house ?? 0), senate: Number(tt.senate ?? 0), nep: Number(tt.nep ?? 0) } });
      })
      .catch((e) => { if (live) setErr(String(e?.message || e)); });
    return () => { live = false; };
  }, [url, where, sort, dir, page, sig]);
  useEffect(() => {
    let live = true;
    const src = `read_parquet(${sqlStr(url)})`;
    Promise.all([
      runQuery<{ k: string; n: unknown }>(`SELECT status k, count(*) n FROM ${src} ${whereOf('status')} GROUP BY 1`),
      runQuery<{ k: string; n: unknown }>(`SELECT coalesce(region, 'Not recorded') k, count(*) n FROM ${src} ${whereOf('region')} GROUP BY 1 ORDER BY 1`),
      runQuery<{ k: string; n: unknown }>(`SELECT CASE WHEN ${INSERTED_SQL} THEN 'yes' ELSE 'no' END k, count(*) n FROM ${src} ${whereOf('ins')} GROUP BY 1`),
    ]).then(([a, b, c]) => {
      if (!live) return;
      const m = (rows: Array<{ k: string; n: unknown }>) => new Map(rows.map((x) => [x.k, Number(x.n)]));
      const sum = (rows: Array<{ n: unknown }>) => rows.reduce((t, x) => t + Number(x.n), 0);
      setFacets({ sig: where, status: m(a.rows), statusBase: sum(a.rows), region: m(b.rows), regionBase: sum(b.rows), ins: m(c.rows), insBase: sum(c.rows) });
    }).catch(() => {});
    return () => { live = false; };
  }, [url, whereOf, where]);
  const toggle = (key: 'status' | 'region' | 'ins', cur: string[], v: string) => {
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    set({ [key]: next.join('|') || null });
  };

  const exportCsv = async () => {
    const r = await runQuery<Record<string, unknown>>(`SELECT * EXCLUDE (search_text) FROM read_parquet(${sqlStr(url)}) ${where} ORDER BY ${SORT_SQL[sort]} ${dir.toUpperCase()} NULLS LAST, id`);
    const cols = ['id', 'house_id', 'status', 'title', 'hb_title', 'region', 'office', 'program', 'pap', 'nep_php', 'house_php', 'senate_php', 'change_php',
      'nep_doc', 'nep_page', 'house_doc', 'house_page', 'senate_doc', 'senate_page', 'matched_by', 'check_note'];
    const esc = (v: unknown) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const text = [cols.join(','), ...r.rows.map((x) => cols.map((c) => esc(typeof x[c] === 'bigint' ? Number(x[c]) : x[c])).join(','))].join('\n');
    downloadCsv(`senate-committee-report-2027-${k}.csv`, text, { excelBom: true });
  };

  const head = (key: SortKey, text: string, cls = '') => {
    const on = sort === key;
    return (
      <th className={`${cls} ${on ? 'nep-th-active' : ''}`.trim()}>
        <button type="button" onClick={() => set({ sort: key, dir: on ? (dir === 'asc' ? 'desc' : 'asc') : null })}>
          {text}<span className="nep-sort-caret">{on ? (dir === 'asc' ? '▲' : '▼') : ''}</span>
        </button>
      </th>
    );
  };
  const cur = res?.sig === sig ? res : null;
  const pages = cur ? Math.max(1, Math.ceil(cur.total.n / PAGE)) : 1;
  return (
    <section className="nep-section">
      {/* The reviewer's filter style (ReviewFilterBar.tsx); these programs have no red flags or reviewer yet. */}
      <div className="senate-rv-bar">
        <div className="rv-filters" role="toolbar" aria-label="Filters">
          <span className="rv-filters-label" aria-hidden="true">Filter</span>
          <Dropdown label="Region" count={regionsOn.length} active={regionsOn.length > 0}>
            {[...(facets?.region.keys() ?? [])].map((x) => (
              <Check key={x} checked={regionsOn.includes(x)} onChange={() => toggle('region', regionsOn, x)} label={x}
                k={facets?.region.get(x) ?? 0} max={Math.max(1, facets?.regionBase ?? 1)} />
            ))}
            {regionsOn.length > 0 && <PanelFoot><span>Projects in any checked region.</span><button type="button" onClick={() => set({ region: null })}>Clear</button></PanelFoot>}
          </Dropdown>
          <Dropdown label="Changes" count={statuses.length + ins.length} active={statuses.length + ins.length > 0} wide>
            <div className="rv-dd-cols">
              <div className="rv-dd-group">
                <h3>In the Senate committee report</h3>
                {SENATE_STATUS_ORDER.filter((x) => x !== 'nep_only' || facets?.status.get(x) || statuses.includes(x)).map((x) => (
                  <Check key={x} checked={statuses.includes(x)} onChange={() => toggle('status', statuses, x)} label={SENATE_STATUS[x].label}
                    note={SENATE_STATUS[x].help} k={facets?.status.get(x) ?? 0} max={Math.max(1, facets?.statusBase ?? 1)} />
                ))}
              </div>
              <div className="rv-dd-group">
                <h3>In the House bill</h3>
                <Check checked={ins.includes('yes')} onChange={() => toggle('ins', ins, 'yes')} label="Inserted by the House"
                  note="No matching line in the NEP." k={facets?.ins.get('yes') ?? 0} max={Math.max(1, facets?.insBase ?? 1)} />
                <Check checked={ins.includes('no')} onChange={() => toggle('ins', ins, 'no')} label="Not inserted by the House"
                  note="In the NEP too, or a documented addition by the Senate." k={facets?.ins.get('no') ?? 0} max={Math.max(1, facets?.insBase ?? 1)} />
              </div>
            </div>
            <PanelFoot>
              <span>Projects with any checked change; with both columns checked, projects must match each.</span>
              {statuses.length + ins.length > 0 && <button type="button" onClick={() => set({ status: null, ins: null })}>Clear</button>}
            </PanelFoot>
          </Dropdown>
          {(program || pap || office) && (
            <button type="button" className="rv-clear" onClick={() => set({ program: null, pap: null, office: null })}>
              {program || pap || office} ✕
            </button>
          )}
          <form className="rv-filter-search" onSubmit={(e) => { e.preventDefault(); set({ q: (new FormData(e.currentTarget).get('q') as string) ?? '' }); }}>
            <input className="rv-input" type="search" name="q" placeholder="Search title, place, office" defaultValue={q} aria-label="Search projects (press Enter)" />
          </form>
          {(statuses.length || regionsOn.length || ins.length || q || program || pap || office) ? (
            <button type="button" className="rv-clear" onClick={() => set({ status: null, region: null, ins: null, q: null, program: null, pap: null, office: null })}>Clear all</button>
          ) : null}
        </div>
      </div>
      {err && <p className="nep-status-error">{err}</p>}
      <div className="senate-list-head">
        {cur ? (
          <p className="nep-table-count">
            <b>{cur.total.n.toLocaleString()}</b> projects · NEP {fmt.shortPhp(cur.total.nep)} · House bill {fmt.shortPhp(cur.total.house)} · Senate {fmt.shortPhp(cur.total.senate)}
            {' '}(<SignedChange v={cur.total.senate - cur.total.house} base={cur.total.house} /> vs the House bill, <SignedChange v={cur.total.senate - cur.total.nep} base={cur.total.nep} /> vs the NEP)
          </p>
        ) : <p className="nep-table-count">Counting…</p>}
        <button type="button" className="hgab-ex-csv" onClick={exportCsv}>CSV of these projects</button>
      </div>
      <div className="nep-table-wrap">
        <table className="nep-table hgab-ex-tree senate-proj-table">
          <thead>
            <tr>
              {head('title', 'Project', 'nep-th-name')}
              <th className="num">NEP</th>
              {head('house', 'House bill', 'num')}
              {head('senate', 'Senate', 'num senate-col-senate')}
              {head('change', 'vs House bill', 'num')}
              {head('vsnep', 'vs NEP', 'num')}
              <th>Status</th>
              <th>Pages</th>
            </tr>
          </thead>
          <tbody>
            {!cur ? <SkeletonRows cols={7} rows={8} /> : cur.rows.map((r) => (
              <tr key={r.id}>
                <td className="hgab-ex-name">
                  <Link to={senateRecordPath(k, r.id)}>{r.title}</Link>
                  {r.hb_title && r.renamed && <span className="senate-rename">{r.hb_title}</span>}
                  <span className="hgab-ex-sub">{[k === 'hfep' ? r.pap : null, r.office, r.region].filter(Boolean).join(' · ')}</span>
                  {r.check_note && <span className="senate-check" title="Paired or flagged by our matching: check it against the annex page">{r.check_note}</span>}
                </td>
                <td className="num nep-td-base">{r.nep_php != null ? fmt.shortPhp(r.nep_php) : <span className="hgab-ds-null">—</span>}</td>
                <td className="num">{r.house_php != null ? fmt.shortPhp(r.house_php) : <span className="hgab-ds-null">—</span>}</td>
                <td className="num senate-col-senate"><strong>{fmt.shortPhp(r.senate_php)}</strong></td>
                <td className="num"><SignedChange v={r.change_php} base={r.house_php} /></td>
              <td className="num"><SignedChange v={r.nep_php != null ? r.senate_php - r.nep_php : null} base={r.nep_php} /></td>
                <td><SenateStatusChip status={r.status} /></td>
                <td><SenatePages r={r} program={k} /></td>
              </tr>
            ))}
            {cur && !cur.rows.length && <tr><td colSpan={8} className="nep-empty">No project matches.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="senate-pager">
        <button type="button" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>← Previous</button>
        <span>Page {page} of {pages}</span>
        <button type="button" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>Next →</button>
      </div>
    </section>
  );
}
