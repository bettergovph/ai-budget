/**
 * The Senate committee report's DPWH projects (`/senate/2027/dpwh?view=projects`): every DPWH project of the
 * House bill from the reviewer's index (documents/review.json: red flags, documents, the office and the districts
 * it serves), joined by its comparison row id to its Senate amount and status (senate/2027/dpwh/projects.parquet).
 * Five of the reviewer's filters (ReviewFilterBar.tsx: region, DPWH office, budget, documents) and our own
 * Changes: what the committee report does to a project, and whether the House inserted it (no NEP line). Each
 * project opens in the reviewer to be reviewed, and on its Senate and House bill pages. This list is also the
 * program's "changes" view (Jason, 2026-11-21), which redirects here.
 *
 * State lives in the URL as the reviewer's: `s=` filter steps, plus `sv=` Senate statuses, `ins=` (yes|no),
 * `sort=` and `pg=`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Dropdown, FilterBar, PanelFoot } from './ReviewFilterBar';
import { SenatePages, SenateStatusChip, SignedChange } from './SenateBits';
import { runQuery } from '../lib/duckdb';
import { dataUrl } from '../lib/data-url';
import { downloadCsv } from '../lib/csv';
import * as fmt from '../lib/format';
import { cached, getJson, recordPath } from '../lib/hgab';
import { REVIEW_INDEX_PATH, type ReviewIndex } from '../lib/hgab-documents';
import {
  LIST_STATUS_LABEL, PAGE_SIZE, REVIEW_ROOT, countBy, decodeIndex, listStatus, pageCount, pageWindow, projectVerdict,
  runFunnel, stepToParam, stepsFromSearch,
  type ListStatus, type ReviewProject, type ReviewStatusIndex, type Step,
} from '../lib/hgab-review';
import { fetchStatus } from '../lib/hgab-review-api';
import {
  SENATE_STATUS, SENATE_STATUS_ORDER, senateProjectsUrl, senateRecordPath, type SenateStatus,
} from '../lib/senate';
import '../hgab-review.css';

/** What the list shows of a project's Senate version. */
interface SenateRow {
  id: string;
  house_id: string | null;
  status: SenateStatus;
  title: string;
  hb_title: string | null;
  renamed: boolean;
  nep_php: number | null;
  house_php: number | null;
  senate_php: number;
  change_php: number;
  office: string | null;
  region: string | null;
  program: string | null;
  nep_doc: string | null;
  nep_page: number | null;
  house_doc: string | null;
  house_page: number | null;
  senate_doc: string;
  senate_page: number | null;
}

const loadIndex = () => cached('review-index', () => getJson<ReviewIndex>(dataUrl(`hgab/2027/${REVIEW_INDEX_PATH}`), 'Failed to load the project list'));
const loadSenate = () => cached('senate:dpwh-rows', async () => {
  const r = await runQuery<Record<string, unknown>>(
    `SELECT id, house_id, status, title, hb_title, renamed, nep_php, house_php, senate_php, change_php, office, region, program, nep_doc, nep_page, house_doc, house_page, senate_doc, senate_page FROM read_parquet('${senateProjectsUrl('dpwh')}')`);
  const num = (v: unknown) => (v == null ? null : Number(v));
  return r.rows.map((x) => ({
    id: String(x.id), house_id: x.house_id == null ? null : String(x.house_id), status: x.status as SenateStatus, title: String(x.title),
    hb_title: x.hb_title == null ? null : String(x.hb_title), renamed: !!x.renamed, nep_php: num(x.nep_php), house_php: num(x.house_php),
    senate_php: Number(x.senate_php ?? 0), change_php: Number(x.change_php ?? 0),
    office: x.office == null ? null : String(x.office), region: x.region == null ? null : String(x.region), program: x.program == null ? null : String(x.program),
    nep_doc: x.nep_doc == null ? null : String(x.nep_doc), nep_page: num(x.nep_page), house_doc: x.house_doc == null ? null : String(x.house_doc),
    house_page: num(x.house_page), senate_doc: String(x.senate_doc ?? 'senate-cr-annex-a4'), senate_page: num(x.senate_page),
  } as SenateRow));
});

type Ins = 'yes' | 'no';
/** The reviewer's filter steps this list shows: region, office, budget (program, at least), documents, search. */
const STEP_KINDS = ['region', 'office', 'program', 'min', 'docs', 'source', 'flag', 'q'] as const;

type Sort = 'change' | 'house' | 'senate' | 'vsnep' | 'title' | 'review';
const SORT_LABEL: Record<Sort, string> = {
  change: 'Largest cut first', house: 'Largest House bill amount', senate: 'Largest Senate amount', vsnep: 'Largest cut against the NEP',
  title: 'Name', review: 'Review status',
};
const n = (v: number) => v.toLocaleString('en-US');

export default function SenateDpwhProjects() {
  const [params, setParams] = useSearchParams();
  const [index, setIndex] = useState<ReviewIndex | null>(null);
  const [senateRows, setSenateRows] = useState<SenateRow[] | null>(null);
  const [shared, setShared] = useState<ReviewStatusIndex | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    loadIndex().then(setIndex).catch((e: unknown) => setErr(String((e as Error)?.message || e)));
    loadSenate().then(setSenateRows).catch((e: unknown) => setErr(String((e as Error)?.message || e)));
    // Everyone's review status (public, no names); the automatic review shows without it.
    fetchStatus().then((r) => setShared(r.data)).catch(() => {});
  }, []);

  // Every House project: the reviewer's (with its flags and documents), joined to its Senate row by comparison id.
  const bySenate = useMemo(() => new Map((senateRows ?? []).filter((r) => r.house_id).map((r) => [r.house_id!, r])), [senateRows]);
  // The reviewer lists most House projects; the rest (rainwater collectors, foreign-assisted projects, ...) join the
  // list without red flags or documents, and can't be opened in the reviewer.
  const reviewed = useMemo(() => (index ? decodeIndex(index) : []), [index]);
  const all = useMemo(() => {
    const have = new Set(reviewed.map((p) => p.projectId));
    const extra: ReviewProject[] = (senateRows ?? []).filter((r) => r.house_id && !have.has(r.house_id)).map((r) => ({
      hgabId: r.house_id!, seq: 0, page: 0, projectId: r.house_id!, title: r.hb_title ?? r.title,
      office: { name: r.office ?? 'No recorded office', districts: [], tier: null }, region: r.region ?? '', program: r.program ?? '',
      amount: r.house_php ?? 0, flags: [], docs: 0, files: 0, source: 'none', insertion: false, auto: null, bySource: null,
    }));
    return [...reviewed, ...extra];
  }, [reviewed, senateRows]);
  const inReviewer = useMemo(() => new Set(reviewed.map((p) => p.hgabId)), [reviewed]);
  const flagIndex = useMemo(() => new Map((index?.flags ?? []).map((f, i) => [f.code, i])), [index]);
  // Only the filters this list shows: a reviewer link's red flags, questions or review status don't apply here.
  const steps = useMemo(() => stepsFromSearch(params, new Set(flagIndex.keys())).filter((x) => (STEP_KINDS as readonly string[]).includes(x.kind)
    && (x.kind !== 'flag' || !!index?.flags[flagIndex.get(x.code) ?? -1]?.computed)), [params, flagIndex, index]);
  const autoRows = index?.auto?.rows;
  const statusOf = useCallback((h: string): ListStatus => {
    const entry = shared?.[h];
    return listStatus(entry ? projectVerdict(entry.verdicts) : null, (entry?.reviews ?? 0) > 0, !!entry?.auto || !!autoRows?.[h]);
  }, [shared, autoRows]);
  const ctx = useMemo(() => ({ flagIndex, statusOf }), [flagIndex, statusOf]);
  const levels = useMemo(() => runFunnel(all, steps, ctx), [all, steps, ctx]);
  const afterSteps = levels[levels.length - 1].projects;

  // Changes, after the reviewer's steps: what the Senate does (`sv=`) and whether the House inserted it (`ins=`).
  const sv = useMemo(() => (params.get('sv') ?? '').split('|').filter((v): v is SenateStatus => (SENATE_STATUS_ORDER as readonly string[]).includes(v)), [params]);
  const ins = useMemo(() => (params.get('ins') ?? '').split('|').filter((v): v is Ins => v === 'yes' || v === 'no'), [params]);
  const senateOf = useCallback((p: ReviewProject) => bySenate.get(p.projectId) ?? null, [bySenate]);
  const statusIn = useCallback((p: ReviewProject) => senateOf(p)?.status ?? 'unchanged', [senateOf]);
  // Inserted by the House: no NEP line (the Senate row's NEP amount; the reviewer's mark for the few it lacks).
  const insOf = useCallback((p: ReviewProject): Ins => { const s = senateOf(p); return (s ? s.nep_php == null : p.insertion) ? 'yes' : 'no'; }, [senateOf]);
  const bySv = useMemo(() => (sv.length ? afterSteps.filter((p) => sv.includes(statusIn(p))) : afterSteps), [afterSteps, sv, statusIn]);
  const byIns = useMemo(() => (ins.length ? afterSteps.filter((p) => ins.includes(insOf(p))) : afterSteps), [afterSteps, ins, insOf]);
  const current = useMemo(() => (ins.length ? bySv.filter((p) => ins.includes(insOf(p))) : bySv), [bySv, ins, insOf]);
  const sort: Sort = (params.get('sort') as Sort) in SORT_LABEL ? (params.get('sort') as Sort) : 'change';
  const listed = useMemo(() => {
    const val = (p: ReviewProject): number | string => {
      const s = senateOf(p);
      switch (sort) {
        case 'house': return -(s?.house_php ?? p.amount);
        case 'senate': return -(s?.senate_php ?? p.amount);
        case 'vsnep': return s && s.nep_php != null ? s.senate_php - s.nep_php : Number.MAX_SAFE_INTEGER;
        case 'title': return p.title.toLowerCase();
        case 'review': return LIST_STATUS_ORDER.indexOf(statusOf(p.hgabId));
        default: return s ? s.change_php : 0;
      }
    };
    return [...current].sort((a, b) => {
      const x = val(a), y = val(b);
      return x < y ? -1 : x > y ? 1 : b.amount - a.amount;
    });
  }, [current, sort, senateOf, statusOf]);
  const pages = pageCount(listed.length);
  const page = Math.min(pages, Math.max(1, Number(params.get('pg')) || 1));
  const rows = listed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const update = useCallback((fn: (p: URLSearchParams) => void) => {
    setParams((prev) => { const next = new URLSearchParams(prev); fn(next); return next; }, { replace: true });
  }, [setParams]);
  // The latest steps, ahead of the URL (a quick second click would otherwise start from the steps before the first).
  const stepsRef = useRef(steps);
  useEffect(() => { stepsRef.current = steps; }, [steps]);
  const applySteps = (fn: (cur: Step[]) => Step[]) => {
    const next = fn(stepsRef.current);
    stepsRef.current = next;
    update((p) => { p.delete('s'); p.delete('pg'); next.forEach((s) => p.append('s', stepToParam(s))); });
  };
  const setList = (key: 'sv' | 'ins', v: string[]) => update((p) => { if (v.length) p.set(key, v.join('|')); else p.delete(key); p.delete('pg'); });
  const toggle = <T extends string>(key: 'sv' | 'ins', cur: T[], v: T) => setList(key, cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);

  // A House bill row printed as two lines is two projects in the reviewer and one Senate row: count it once.
  const lines = useMemo(() => countBy(all, (p) => p.projectId), [all]);
  const totals = useMemo(() => {
    const seen = new Set<string>();
    return current.reduce((t, p) => {
      const s = senateOf(p);
      if (!s) { t.house += p.amount; return t; }
      if (seen.has(s.id)) return t;
      seen.add(s.id);
      t.house += s.house_php ?? 0; t.senate += s.senate_php; t.nep += s.nep_php ?? 0;
      return t;
    }, { nep: 0, house: 0, senate: 0 });
  }, [current, senateOf]);
  // Each group counted against the other's checks, as the reviewer's filters.
  const svCounts = useMemo(() => countBy(byIns, statusIn), [byIns, statusIn]);
  const insCounts = useMemo(() => countBy(bySv, insOf), [bySv, insOf]);

  const exportCsv = () => {
    const cols = ['house_id', 'reviewer_id', 'title', 'senate_title', 'office', 'districts', 'region', 'program', 'nep_php', 'house_php', 'senate_php',
      'vs_house_php', 'vs_nep_php', 'senate_status', 'review_status', 'red_flags', 'nep_doc', 'nep_page', 'house_doc', 'house_page', 'senate_doc', 'senate_page'];
    const esc = (v: unknown) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = listed.map((p) => {
      const s = senateOf(p);
      return [p.projectId, p.hgabId, p.title, s?.renamed ? s.title : '', p.office.name, p.office.districts.join('; '), p.region, p.program,
        s?.nep_php, s?.house_php ?? p.amount, s?.senate_php, s?.change_php, s && s.nep_php != null ? s.senate_php - s.nep_php : '',
        s ? SENATE_STATUS[s.status].label : '', LIST_STATUS_LABEL[statusOf(p.hgabId)], p.flags.map((i) => index!.flags[i].code).join('; '),
        s?.nep_doc, s?.nep_page, s?.house_doc, s?.house_page, s?.senate_doc, s?.senate_page].map(esc).join(',');
    });
    downloadCsv('senate-committee-report-2027-dpwh-projects.csv', [cols.join(','), ...lines].join('\n'), { excelBom: true });
  };

  if (err) return <p className="nep-status-error">{err}</p>;
  if (!index || !senateRows) return <p className="hgab-ex-none" role="status">Loading the projects and their red flags…</p>;

  return (
    <section className="nep-section senate-dpwh-projects">
      <div className="senate-rv-bar">
        <FilterBar key={params.getAll('s').filter((x) => x.startsWith('q:')).join()} ix={index} all={all} steps={steps} current={current}
          ctx={ctx} presets={[]} shared={!!shared} onSteps={applySteps} only={['region', 'office', 'budget', 'extra', 'documents']}
          extra={
            <Dropdown label="Changes" count={sv.length + ins.length} active={sv.length + ins.length > 0} wide>
              <div className="rv-dd-cols">
                <div className="rv-dd-group">
                  <h3>In the Senate committee report</h3>
                  {SENATE_STATUS_ORDER.filter((v) => v !== 'nep_only').map((v) => (
                    <Check key={v} checked={sv.includes(v)} onChange={() => toggle('sv', sv, v)}
                      label={SENATE_STATUS[v].label} note={SENATE_STATUS[v].help} k={svCounts.get(v) ?? 0} max={Math.max(1, byIns.length)} />
                  ))}
                </div>
                <div className="rv-dd-group">
                  <h3>In the House bill</h3>
                  <Check checked={ins.includes('yes')} onChange={() => toggle('ins', ins, 'yes')} label="Inserted by the House"
                    note="No matching line in the NEP." k={insCounts.get('yes') ?? 0} max={Math.max(1, bySv.length)} />
                  <Check checked={ins.includes('no')} onChange={() => toggle('ins', ins, 'no')} label="Not inserted by the House"
                    note="A line the NEP proposed too." k={insCounts.get('no') ?? 0} max={Math.max(1, bySv.length)} />
                </div>
              </div>
              <PanelFoot>
                <span>Projects with any checked change; with both columns checked, projects must match each.</span>
                {sv.length + ins.length > 0 && <button type="button" onClick={() => update((p) => { p.delete('sv'); p.delete('ins'); p.delete('pg'); })}>Clear</button>}
              </PanelFoot>
            </Dropdown>
          } />
      </div>

      <div className="senate-list-head">
        <p className="nep-table-count">
          <b>{n(current.length)}</b> projects · NEP {fmt.shortPhp(totals.nep)} (for those in the NEP) · House bill {fmt.shortPhp(totals.house)} · Senate {fmt.shortPhp(totals.senate)}
          {' '}(<SignedChange v={totals.senate - totals.house} base={totals.house} /> vs the House bill)
        </p>
        <label className="senate-sort">
          Sort{' '}
          <select className="text-input" value={sort} onChange={(e) => update((p) => { p.set('sort', e.target.value); p.delete('pg'); })}>
            {(Object.keys(SORT_LABEL) as Sort[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
          </select>
        </label>
        <button type="button" className="hgab-ex-csv" onClick={exportCsv}>CSV of these projects</button>
      </div>

      <div className="nep-table-wrap">
        <table className="nep-table hgab-ex-tree senate-proj-table">
          <thead>
            <tr>
              <th className="nep-th-name">Project</th>
              <th className="num">NEP</th>
              <th className="num">House bill</th>
              <th className="num senate-col-senate">Senate</th>
              <th className="num">vs House bill</th>
              <th className="num">vs NEP</th>
              <th>Senate</th>
              <th>Pages</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const s = senateOf(p);
              const st = statusOf(p.hgabId);
              return (
                <tr key={p.hgabId}>
                  <td className="hgab-ex-name">
                    {s ? <Link to={senateRecordPath('dpwh', s.id)}>{p.title}</Link> : p.title}
                    {s?.renamed && <span className="senate-rename-to">Senate: {s.title}</span>}
                    <span className="hgab-ex-sub">
                      {p.office.districts.length ? `${p.office.districts.slice(0, 2).join(' · ')}${p.office.districts.length > 2 ? ` +${p.office.districts.length - 2}` : ''} · ` : ''}
                      {p.office.name === 'Central Office' ? 'DPWH Central Office' : p.office.name.replace(/\bDistrict Engineering Office\b/, 'DEO')} · {p.region}
                    </span>
                    {p.flags.length > 0 && <span className="senate-flags" title={p.flags.map((i) => index.flags[i].label).join('\n')}>{p.flags.length} red flag{p.flags.length === 1 ? '' : 's'}</span>}
                  </td>
                  <td className="num nep-td-base">{s?.nep_php != null ? fmt.shortPhp(s.nep_php) : <span className="hgab-ds-null">—</span>}</td>
                  <td className="num">{fmt.shortPhp(s?.house_php ?? p.amount)}</td>
                  <td className="num senate-col-senate">
                    <strong>{s ? fmt.shortPhp(s.senate_php) : '—'}</strong>
                    {(lines.get(p.projectId) ?? 0) > 1 && (
                      <span className="senate-shared" title={`Our House bill data holds this project and ${(lines.get(p.projectId) ?? 2) - 1} more printed line as one row; the Senate amount and changes are for all of them (House bill ${fmt.shortPhp(s?.house_php ?? 0)}).`}>*</span>
                    )}
                  </td>
                  <td className="num"><SignedChange v={s ? s.change_php : null} base={s?.house_php} /></td>
                  <td className="num"><SignedChange v={s && s.nep_php != null ? s.senate_php - s.nep_php : null} base={s?.nep_php} /></td>
                  <td>{s && <SenateStatusChip status={s.status} />}</td>
                  <td>{s ? <SenatePages r={s} program="dpwh" /> : <span className="hgab-ds-null">—</span>}</td>
                  <td className="senate-review-cell">
                    {inReviewer.has(p.hgabId) ? (
                      <>
                        <span className={`rv-status-dot is-${st}`}>{LIST_STATUS_LABEL[st]}</span>
                        <Link className="senate-review-btn" to={`${REVIEW_ROOT}?p=${encodeURIComponent(p.hgabId)}`}>Review →</Link>
                      </>
                    ) : <span className="hgab-ex-none" title="The reviewer lists the projects with documents to check; this one isn't among them yet">Not in the reviewer</span>}
                    <Link className="senate-house-link" to={recordPath('dpwh', p.projectId)}>House bill project</Link>
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={9} className="nep-empty">No project passes these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <nav className="senate-pager" aria-label="Pages">
        <button type="button" disabled={page <= 1} onClick={() => update((p) => p.set('pg', String(page - 1)))}>← Previous</button>
        {pageWindow(page, pages).map((x, i) => (x == null
          ? <span key={`gap${i}`}>…</span>
          : <button key={x} type="button" className={x === page ? 'is-on' : ''} aria-current={x === page ? 'page' : undefined} onClick={() => update((p) => p.set('pg', String(x)))}>{x}</button>))}
        <button type="button" disabled={page >= pages} onClick={() => update((p) => p.set('pg', String(page + 1)))}>Next →</button>
      </nav>
      <p className="nep-provenance">
        All {n(all.length)} DPWH projects of the House bill: {n(reviewed.length)} as the <Link to={REVIEW_ROOT}>project reviewer</Link> lists them,
        with their red flags and documents, and {n(all.length - reviewed.length)} it doesn't list. A review is done in the reviewer: anyone can read
        it; reviewing needs a volunteer sign-in.
      </p>
    </section>
  );
}

const LIST_STATUS_ORDER: readonly ListStatus[] = ['needs_immediate_attention', 'needs_attention', 'auto_red_flag', 'not_started', 'reviewed', 'satisfactory'];
