/**
 * Pieces the team's report pages share (src/components/HgabReportPages.tsx): cards, the final-status bar, tally
 * tables, a member's review, and the project list with its filters (kept in the URL).
 */
import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useReport } from '../lib/hgab-report-data';
import { PAGE_SIZE, SOURCE_GROUPS, docCount, foldText, pageCount, pageWindow, pesoFull, pesoShort, type ReviewProject, type SourceGroup } from '../lib/hgab-review';
import { VERDICT_LABEL } from '../lib/hgab-redflags-team';
import {
  DOC_LEVELS, DOC_LEVEL_LABEL, PROJECT_GROUPS, PROJECT_GROUP_LABEL, REPORT_GROUPS, REPORT_GROUP_LABEL, answerLines, docLevel, n,
  officeLine, projectPath, when, type DocLevel, type GroupCounts, type ProjectGroup, type ReportCase, type Tally,
} from '../lib/hgab-review-report';

export function PageHead({ title, crumbs = [], children }: { title: ReactNode; crumbs?: { to: string; label: string }[]; children?: ReactNode }) {
  return (
    <header className="rr-head">
      {crumbs.length > 0 && (
        <nav className="rr-crumbs" aria-label="Breadcrumb">
          {crumbs.map((c) => <span key={c.to}><Link to={c.to}>{c.label}</Link> ›</span>)}
        </nav>
      )}
      <h2>{title}</h2>
      {children && <div className="rr-lede">{children}</div>}
    </header>
  );
}

export function Card({ label, value, note, tone, to }: { label: string; value: string; note?: ReactNode; tone?: ProjectGroup; to?: string }) {
  const body = <><span className="rr-card-l">{tone && <i className={`rr-dot is-${tone}`} />}{label}</span><b className="rr-card-v">{value}</b>{note && <span className="rr-card-n">{note}</span>}</>;
  const cls = `rr-card${tone ? ` is-${tone}` : ''}`;
  return to ? <Link className={cls} to={to}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Projects by final status, as one bar. */
export function GroupBar({ counts, groups = PROJECT_GROUPS, big }: { counts: Partial<GroupCounts>; groups?: readonly ProjectGroup[]; big?: boolean }) {
  const shown = groups.filter((g) => (counts[g]?.projects ?? 0) > 0);
  if (!shown.length) return null;
  // A number only where it fits: segments of at least 4% of the bar.
  const sum = shown.reduce((s, g) => s + counts[g]!.projects, 0);
  return (
    <div className={`rr-bar-stack${big ? ' is-big' : ''}`} role="img"
      aria-label={shown.map((g) => `${PROJECT_GROUP_LABEL[g]}: ${n(counts[g]!.projects)}`).join(', ')}>
      {shown.map((g) => (
        <span key={g} className={`is-${g}`} style={{ flexGrow: counts[g]!.projects }} title={`${PROJECT_GROUP_LABEL[g]}: ${n(counts[g]!.projects)}`}>
          {big && counts[g]!.projects / sum >= 0.04 ? n(counts[g]!.projects) : ''}
        </span>
      ))}
    </div>
  );
}

export function Pill({ group }: { group: ProjectGroup }) {
  return <span className={`rr-pill is-${group}`}>{PROJECT_GROUP_LABEL[group]}</span>;
}

/** Projects by final status for each row of a tally (region, office, House insertion). */
export function TallyTable({ rows, head }: { rows: Tally[]; head: string }) {
  if (!rows.length) return <p className="rr-muted">No reviews yet.</p>;
  return (
    <div className="rr-table-wrap">
      <table className="rr-table">
        <thead>
          <tr>
            <th scope="col">{head}</th>
            <th scope="col" className="num">Reviewed</th>
            {REPORT_GROUPS.map((g) => <th key={g} scope="col" className="num"><i className={`rr-dot is-${g}`} />{REPORT_GROUP_LABEL[g]}</th>)}
            <th scope="col" className="num">Budget</th>
            <th scope="col" className="rr-col-bar"><span className="rr-sr">Final status</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.key}>
              <th scope="row">{t.label}</th>
              <td className="num">{n(t.projects)}{t.of != null && <small> of {n(t.of)}</small>}</td>
              {REPORT_GROUPS.map((g) => <td key={g} className={`num${t.groups[g].projects ? ` is-${g}` : ' is-zero'}`}>{n(t.groups[g].projects)}</td>)}
              <td className="num" title={pesoFull(t.amount)}>{pesoShort(t.amount)}</td>
              <td className="rr-col-bar"><GroupBar counts={t.groups} groups={REPORT_GROUPS} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Links to project pages, by bill page and row. */
export function ProjectLinks({ ids, max = 6 }: { ids: string[]; max?: number }) {
  const { byId } = useReport();
  if (!ids.length) return null;
  return (
    <div className="rr-qlinks">
      {ids.slice(0, max).map((h) => <Link key={h} to={projectPath(h)} title={byId.get(h)?.title}>{h.slice(10)}</Link>)}
      {ids.length > max && <span>+{n(ids.length - max)}</span>}
    </div>
  );
}

/** One member's review: final status, remarks, and the answers that weren't satisfactory, then the rest in a line. */
export function ReviewEntry({ c }: { c: ReportCase }) {
  const { names } = useReport();
  const lines = answerLines(c.review);
  const fine = lines.filter((a) => a.rating === 'satisfactory');
  const rest = lines.filter((a) => a.rating !== 'satisfactory');
  return (
    <div className="rr-rev">
      <p className="rr-rev-h">
        <span className={`rr-pill is-${c.review.verdict ?? 'none'}`}>{c.review.verdict ? VERDICT_LABEL[c.review.verdict] : 'No final status'}</span>
        <b>{names.get(c.member_id)}</b>
        <span className="rr-muted">{when(c.updated_at)} · {n(c.revisions)} save{c.revisions === 1 ? '' : 's'}</span>
      </p>
      {c.review.notes.trim() && <blockquote className="rr-remarks">{c.review.notes.trim()}</blockquote>}
      {rest.length > 0 && (
        <ul className="rr-answers">
          {rest.map((a) => (
            <li key={a.id} className={a.rating ? `is-${a.rating}` : ''}>
              <b className="rr-qid">{a.id}</b> {a.title}: <em>{a.label}</em>{a.older && <small> (earlier check)</small>}
              {a.remark && <span className="rr-remark">{a.remark}</span>}
            </li>
          ))}
        </ul>
      )}
      {fine.length > 0 && (
        <p className="rr-fine"><i className="rr-dot is-satisfactory" />Satisfactory: {fine.map((a) => (a.remark ? `${a.id} (${a.remark})` : a.id)).join(', ')}</p>
      )}
      {!lines.length && !c.review.notes.trim() && <p className="rr-muted">No answers yet.</p>}
    </div>
  );
}

// --- The project list ------------------------------------------------------------------------------------------------

const SORTS = { status: 'Final status', amount: 'Largest budget', bill: 'Bill order' } as const;
type Sort = keyof typeof SORTS;

/** Where a project's files come from (SOURCE_GROUPS), as the report keeps the House bill's and the NEP's apart. */
const FILES_FROM: Record<SourceGroup, string> = {
  senate: 'Files: House bill only (Senate copies)', nep: 'Files: NEP only (DPWH Transparency)', both: 'Files: both', none: 'No file found',
};
/** "3/5" key documents from one source, with its file count in the tooltip; blank where review.json predates the split. */
function SourceDocs({ p, from }: { p: ReviewProject; from: 'senate' | 'nep' }) {
  const d = p.bySource?.[from];
  if (!d) return <span className="rr-muted">—</span>;
  const label = from === 'senate' ? 'House bill' : 'NEP';
  return (
    <span className={d.docs || d.files ? '' : 'rr-muted'} title={`${label}: ${docCount(d.docs)} of 5 key documents, ${n(d.files)} file${d.files === 1 ? '' : 's'}`}>
      <span className="rr-narrow-only">{label} </span>{docCount(d.docs)}/5
    </span>
  );
}

/**
 * A list of projects with filters (final status, region, House insertion, documents, where the files come from,
 * search), a sort and pages, all in the URL (`st=`, `region=`, `src=`, `docs=`, `from=`, `q=`, `sort=`, `pg=`), so a
 * filtered list can be shared.
 */
export function ProjectTable({ projects, label = 'projects' }: { projects: readonly ReviewProject[]; label?: string }) {
  const { groupOf, rowById, names } = useReport();
  const [params, setParams] = useSearchParams();
  const st = params.get('st') ?? '';
  const groups = useMemo(() => st.split(',').filter((g): g is ProjectGroup => (PROJECT_GROUPS as readonly string[]).includes(g)), [st]);
  const region = params.get('region') ?? '';
  const source = params.get('src') ?? '';
  const docs = (DOC_LEVELS as readonly string[]).includes(params.get('docs') ?? '') ? params.get('docs') as DocLevel : '';
  const filesFrom = (SOURCE_GROUPS as readonly string[]).includes(params.get('from') ?? '') ? params.get('from') as SourceGroup : '';
  const q = params.get('q') ?? '';
  const sort: Sort = (params.get('sort') ?? '') in SORTS ? params.get('sort') as Sort : 'status';
  const set = (changes: Record<string, string>) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
    if (!('pg' in changes)) next.delete('pg');
    return next;
  }, { replace: true });
  const toggleGroup = (g: ProjectGroup) => set({ st: (groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g]).join(',') });

  const regions = useMemo(() => [...new Set(projects.map((p) => p.region))].sort(), [projects]);
  const counts = useMemo(() => {
    const m = new Map<ProjectGroup, number>();
    for (const p of projects) m.set(groupOf(p.hgabId), (m.get(groupOf(p.hgabId)) ?? 0) + 1);
    return m;
  }, [projects, groupOf]);
  const shown = useMemo(() => {
    const words = foldText(q.trim()).split(/\s+/).filter(Boolean);
    const out = projects.filter((p) => (!groups.length || groups.includes(groupOf(p.hgabId))) && (!region || p.region === region)
      && (!source || (source === 'insertion') === p.insertion) && (!docs || docLevel(p) === docs) && (!filesFrom || p.source === filesFrom)
      && (!words.length || (() => {
        const r = rowById.get(p.hgabId);
        const t = foldText(`${p.hgabId} ${p.title} ${p.office.name} ${p.office.districts.join(' ')} ${p.program} ${r?.reviews.map((c) => `${names.get(c.member_id)} ${c.review.notes}`).join(' ') ?? ''}`);
        return words.every((w) => t.includes(w));
      })()));
    const rank = (p: ReviewProject) => PROJECT_GROUPS.indexOf(groupOf(p.hgabId));
    return out.sort((a, b) => (sort === 'bill' ? a.hgabId.localeCompare(b.hgabId)
      : sort === 'amount' ? b.amount - a.amount || a.hgabId.localeCompare(b.hgabId)
        : rank(a) - rank(b) || b.amount - a.amount || a.hgabId.localeCompare(b.hgabId)));
  }, [projects, groups, region, source, docs, filesFrom, q, sort, groupOf, rowById, names]);
  const pages = pageCount(shown.length);
  const page = Math.min(Math.max(1, Number(params.get('pg')) || 1), pages);
  const slice = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filtered = groups.length > 0 || !!region || !!source || !!docs || !!filesFrom || !!q;
  const amount = shown.reduce((s, p) => s + p.amount, 0);

  return (
    <div className="rr-list">
      <div className="rr-filters" role="search">
        <span className="rr-filters-l">Final status</span>
        {PROJECT_GROUPS.filter((g) => counts.get(g)).map((g) => (
          <button key={g} type="button" className={`rr-chip is-${g}${groups.includes(g) ? ' is-on' : ''}`} aria-pressed={groups.includes(g)} onClick={() => toggleGroup(g)}>
            <i className={`rr-dot is-${g}`} />{PROJECT_GROUP_LABEL[g]} <b>{n(counts.get(g) ?? 0)}</b>
          </button>
        ))}
      </div>
      <div className="rr-filters">
        <select className="rr-select" value={region} onChange={(e) => set({ region: e.target.value })} aria-label="Region">
          <option value="">All regions</option>
          {regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select className="rr-select" value={source} onChange={(e) => set({ src: e.target.value })} aria-label="House insertions or NEP only">
          <option value="">Insertions and NEP only</option>
          <option value="insertion">House insertions</option>
          <option value="nep">NEP only</option>
        </select>
        <select className="rr-select" value={docs} onChange={(e) => set({ docs: e.target.value })} aria-label="Key documents, either source">
          <option value="">Any key documents</option>
          {DOC_LEVELS.map((d) => <option key={d} value={d}>{DOC_LEVEL_LABEL[d]}</option>)}
        </select>
        <select className="rr-select" value={filesFrom} onChange={(e) => set({ from: e.target.value })} aria-label="Where the files come from">
          <option value="">Files from either source</option>
          {SOURCE_GROUPS.map((g) => <option key={g} value={g}>{FILES_FROM[g]}</option>)}
        </select>
        <input className="rr-input" type="search" placeholder="Search project, office, district, program, reviewer, remarks" value={q} onChange={(e) => set({ q: e.target.value })} />
        <label className="rr-sort">Sort <select className="rr-select" value={sort} onChange={(e) => set({ sort: e.target.value === 'status' ? '' : e.target.value })}>
          {(Object.keys(SORTS) as Sort[]).map((k) => <option key={k} value={k}>{SORTS[k]}</option>)}
        </select></label>
        {filtered && <button type="button" className="rr-link" onClick={() => set({ st: '', region: '', src: '', docs: '', from: '', q: '' })}>Clear</button>}
      </div>
      <p className="rr-count" role="status">
        {n(shown.length)} {filtered ? `of ${n(projects.length)} ` : ''}{label} · {pesoShort(amount)}
        {pages > 1 && <> · page {n(page)} of {n(pages)}</>}
      </p>
      {slice.length > 0 ? (
        <div className="rr-table-wrap">
          <table className="rr-table rr-projects">
            <thead>
              <tr>
                <th scope="col">Final status</th>
                <th scope="col">Project</th>
                <th scope="col">Region</th>
                <th scope="col" className="num">Budget</th>
                <th scope="col" className="num" title="Key documents (of 5) in the Senate copies">House bill docs</th>
                <th scope="col" className="num" title="Key documents (of 5) on DPWH Transparency">NEP docs</th>
                <th scope="col" className="num">Red flags</th>
                <th scope="col">Reviewed by</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((p) => {
                const r = rowById.get(p.hgabId);
                return (
                  <tr key={p.hgabId}>
                    <td className="rr-c-status"><Pill group={groupOf(p.hgabId)} /></td>
                    <th scope="row">
                      <Link to={projectPath(p.hgabId)} className="rr-clamp" title={p.title}>{p.title}</Link>
                      <small className="rr-sub">{p.hgabId} · {officeLine(p.office.name, p.office.districts)}{p.insertion ? ' · House insertion' : ''}</small>
                    </th>
                    <td className="rr-c-region">{p.region}</td>
                    <td className="num rr-c-budget" title={pesoFull(p.amount)}>{pesoShort(p.amount)}</td>
                    <td className="num rr-c-docs"><SourceDocs p={p} from="senate" /></td>
                    <td className="num rr-c-docs is-nep"><SourceDocs p={p} from="nep" /></td>
                    <td className="num rr-c-flags">{n(p.flags.length)}<span className="rr-narrow-only"> red flags</span></td>
                    <td className="rr-who">{r?.reviews.map((c) => names.get(c.member_id)).join(', ') || <span className="rr-muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="rr-muted">No project matches these filters.</p>}
      {pages > 1 && (
        <nav className="rr-pager" aria-label="Pages">
          <button type="button" disabled={page <= 1} onClick={() => set({ pg: String(page - 1) })} aria-label="Previous page">‹</button>
          {pageWindow(page, pages).map((x, i) => (x == null
            ? <span key={`gap${i}`}>…</span>
            : <button key={x} type="button" className={x === page ? 'is-on' : ''} aria-current={x === page ? 'page' : undefined} onClick={() => set({ pg: x === 1 ? '' : String(x) })}>{x}</button>))}
          <button type="button" disabled={page >= pages} onClick={() => set({ pg: String(page + 1) })} aria-label="Next page">›</button>
        </nav>
      )}
    </div>
  );
}
