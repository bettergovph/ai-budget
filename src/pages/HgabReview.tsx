/**
 * `/hgab/2027/review` — the project reviewer: every DPWH project in the FY2027 House bill, narrowed by a red-flag
 * funnel, with each project's documents, its red flags and a review form. Its own full-height layout (a slim bar,
 * then funnel · projects · project) for volunteers working through many projects; not the section's article layout.
 *
 * Data: documents/review.json (every project, for the funnel) and documents/detail/<NN>.json (files and evidence,
 * loaded when a project opens), from `npm run build:hgab-documents`. Logic: src/lib/hgab-review.ts. State lives in
 * the URL (`s=` funnel steps, `p=` open project, `sort=`), so a funnel or a project can be shared.
 *
 * Reviews stay in this browser (localStorage) until submissions open; volunteers can download them as CSV.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DisclaimerNotice } from '../components/HgabBits';
import { cached, getJson, HGAB_ROOT, pdfUrl, recordPath } from '../lib/hgab';
import { dataUrl } from '../lib/data-url';
import {
  NAMED_TYPES, REVIEW_INDEX_PATH, detailShardPath, type DetailFile, type FlagFamily, type ReviewDetail, type ReviewDetailShard,
  type ReviewIndex, type ReviewIndexFlag,
} from '../lib/hgab-documents';
import {
  DOC_VERDICT_LABEL, DOCS_FILTER_LABEL, FAMILY_LABEL, FAMILY_ORDER, LINK_LABEL, LINK_WEAK, NAMED_MEANING, NAMED_SHORT, OVERALL_LABEL,
  PRESETS, REVIEW_STORE_KEY, REVIEW_TITLE, SORT_LABEL, SOURCE_LABEL, decodeIndex, docCount, flagYields, hasDoc, pesoFull, pesoShort,
  readerText, reviewIsEmpty, reviewsCsv, runFunnel, sameStep, sortProjects, stepLabel, stepTest, stepToParam, stepsFromSearch,
  type DocVerdict, type DocsFilter, type MyReview, type Overall, type ReviewProject, type SortKey, type Step,
} from '../lib/hgab-review';
import '../hgab-review.css';

const HGAB_BASE = 'hgab/2027';
const loadIndex = () => cached('review-index', () => getJson<ReviewIndex>(dataUrl(`${HGAB_BASE}/${REVIEW_INDEX_PATH}`), 'Failed to load the project list'));
const loadShard = (seq: number) => {
  const path = detailShardPath(seq);
  return cached(`review-detail:${path}`, () => getJson<ReviewDetailShard>(dataUrl(`${HGAB_BASE}/${path}`), 'Failed to load the project’s documents'));
};
const PAGE_ROWS = 80;
const n = (v: number) => v.toLocaleString('en-US');
const asOf = (iso: string | undefined) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' }) : '';
};
const shortOffice = (name: string) => name.replace(/\bDistrict Engineering Office\b/i, 'DEO');
/**
 * A DPWH office beside the legislative districts it serves, as the copy rules ask: "Isabela, 4th District
 * +1 [Isabela 4th DEO]"; `max` districts are named, the rest counted.
 */
function officeLine(o: ReviewProject['office'], max: number): string {
  if (!o.districts.length) return o.name === 'Central Office' ? 'DPWH Central Office' : `DPWH ${shortOffice(o.name)}`;
  const more = o.districts.length - max;
  return `${o.districts.slice(0, max).join(' · ')}${more > 0 ? ` +${more}` : ''} [${shortOffice(o.name)}]`;
}
const isPdf = (f: DetailFile) => /\.pdf$/i.test(f[4]) || /\.pdf(\?|$)/i.test(f[5]);
const fileSize = (b: number | null) => (b == null ? '' : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

// --- My reviews -------------------------------------------------------------------------------------------------

function readReviews(): Record<string, MyReview> {
  try { return JSON.parse(localStorage.getItem(REVIEW_STORE_KEY) ?? '{}') as Record<string, MyReview>; } catch { return {}; }
}
function useMyReviews() {
  const [reviews, setReviews] = useState<Record<string, MyReview>>(readReviews);
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === REVIEW_STORE_KEY) setReviews(readReviews()); };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  const save = useCallback((r: MyReview | null, hgabId: string) => {
    setReviews((prev) => {
      const next = { ...prev };
      if (r && !reviewIsEmpty(r)) next[hgabId] = r; else delete next[hgabId];
      try { localStorage.setItem(REVIEW_STORE_KEY, JSON.stringify(next)); } catch { /* storage full or blocked: keep in memory */ }
      return next;
    });
  }, []);
  return { reviews, save };
}
function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Funnel -----------------------------------------------------------------------------------------------------

function FunnelSteps({ levels, flags, offices, onRemove, onFlip, onClear }: {
  levels: ReturnType<typeof runFunnel>;
  flags: readonly ReviewIndexFlag[];
  offices: ReviewIndex['offices'];
  onRemove: (i: number) => void;
  onFlip: (i: number) => void;
  onClear: () => void;
}) {
  const total = levels[0].projects.length || 1;
  return (
    <ol className="rv-steps" aria-label="Red-flag funnel">
      {levels.map((L, i) => {
        const prev = i ? levels[i - 1].projects.length : null;
        const share = L.projects.length / total;
        return (
          <li key={i} className={`rv-step ${i === levels.length - 1 ? 'is-last' : ''}`}>
            <div className="rv-step-head">
              <span className="rv-step-label">{L.step ? stepLabel(L.step, flags, offices) : 'All DPWH projects in the House bill'}</span>
              {L.step && (
                <span className="rv-step-actions">
                  {L.step.kind === 'flag' && (
                    <button type="button" onClick={() => onFlip(i - 1)} title={L.step.not ? 'Keep projects with this flag instead' : 'Leave out projects with this flag instead'}>
                      {L.step.not ? 'keep' : 'leave out'}
                    </button>
                  )}
                  <button type="button" onClick={() => onRemove(i - 1)} aria-label={`Remove step: ${stepLabel(L.step, flags, offices)}`}>×</button>
                </span>
              )}
            </div>
            <div className="rv-step-bar" aria-hidden="true"><span style={{ width: `${Math.max(share * 100, L.projects.length ? 0.6 : 0)}%` }} /></div>
            <div className="rv-step-figs">
              <b>{n(L.projects.length)}</b> {L.projects.length === 1 ? 'project' : 'projects'}
              <span>{pesoShort(L.amount)}</span>
              {prev != null && prev !== L.projects.length && <em>−{n(prev - L.projects.length)}</em>}
            </div>
          </li>
        );
      })}
      {levels.length > 1 && (
        <li className="rv-step-clear"><button type="button" onClick={onClear}>Start over</button></li>
      )}
    </ol>
  );
}

type AddTab = 'flags' | 'documents' | 'place' | 'budget' | 'search';
const ADD_TABS: { key: AddTab; label: string }[] = [
  { key: 'flags', label: 'Red flags' }, { key: 'documents', label: 'Documents' }, { key: 'place', label: 'Place' },
  { key: 'budget', label: 'Budget' }, { key: 'search', label: 'Search' },
];

function AddStep({ ix, current, steps, reviewedCount, ctx, onAdd }: {
  ix: ReviewIndex;
  current: ReviewProject[];
  steps: Step[];
  reviewedCount: number;
  ctx: Parameters<typeof stepTest>[1];
  onAdd: (s: Step) => void;
}) {
  const [tab, setTab] = useState<AddTab>('flags');
  const [exclude, setExclude] = useState(false);
  const [q, setQ] = useState('');
  const yields = useMemo(() => flagYields(current, ix.flags.length), [current, ix.flags.length]);
  const max = Math.max(1, current.length);
  const has = (s: Step) => steps.some((x) => sameStep(x, s));
  const count = (s: Step) => current.filter(stepTest(s, ctx)).length;
  const option = (s: Step, label: ReactNode, k: number, title?: string) => (
    <button key={stepToParam(s)} type="button" className="rv-add-opt" disabled={has(s) || (!exclude && k === 0) || (exclude && k === current.length)}
      onClick={() => onAdd(s)} title={title}>
      <span className="rv-add-opt-label">{label}</span>
      <span className="rv-add-opt-n">{n(exclude && s.kind === 'flag' ? current.length - k : k)}</span>
      <span className="rv-add-opt-bar" aria-hidden="true"><span style={{ width: `${(k / max) * 100}%` }} /></span>
    </button>
  );
  const flagList = (family: FlagFamily, opts: { computed?: boolean } = {}) => ix.flags
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.family === family && !!f.computed === !!opts.computed)
    .sort((a, b) => yields[b.i] - yields[a.i])
    .map(({ f, i }) => option({ kind: 'flag', code: f.code, not: exclude }, readerText(f.label), yields[i],
      f.computed ? `With the documents we matched. The research site counts ${n(f.n_upstream ?? 0)} projects.` : undefined));
  const byCount = (values: string[], kind: 'region' | 'office' | 'program') => {
    const m = new Map<string, number>();
    for (const p of current) { const v = kind === 'office' ? p.office.name : p[kind]; m.set(v, (m.get(v) ?? 0) + 1); }
    return values.filter((v) => m.get(v)).sort((a, b) => (m.get(b) ?? 0) - (m.get(a) ?? 0)).map((v) => ({ v, k: m.get(v)! }));
  };
  const [placeQ, setPlaceQ] = useState('');
  return (
    <section className="rv-add" aria-label="Add a step">
      <h2 className="rv-h">Add a step</h2>
      <div className="rv-tabs" role="tablist">
        {ADD_TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'is-on' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      {tab === 'flags' && (
        <>
          <label className="rv-exclude"><input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} /> Leave out projects with the flag</label>
          {FAMILY_ORDER.filter((f) => f !== 'documents').map((fam) => (
            <div key={fam} className="rv-add-group"><h3>{FAMILY_LABEL[fam]}</h3>{flagList(fam)}</div>
          ))}
          <div className="rv-add-group"><h3>Documents the research site flags</h3>{flagList('documents')}</div>
        </>
      )}
      {tab === 'documents' && (
        <>
          <div className="rv-add-group">
            <h3>How many of the 5 key documents</h3>
            {(['none', 'incomplete', 'complete'] as DocsFilter[]).map((v) => { const s: Step = { kind: 'docs', value: v }; return option(s, DOCS_FILTER_LABEL[v], count(s)); })}
          </div>
          <div className="rv-add-group">
            <h3>Missing, after our matching</h3>
            <label className="rv-exclude"><input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} /> Leave out projects missing it</label>
            {flagList('documents', { computed: true })}
          </div>
          <div className="rv-add-group">
            <h3>My reviews</h3>
            {option({ kind: 'reviewed', value: 'no' }, 'Not yet reviewed by me', count({ kind: 'reviewed', value: 'no' }))}
            {reviewedCount > 0 && option({ kind: 'reviewed', value: 'yes' }, 'Reviewed by me', count({ kind: 'reviewed', value: 'yes' }))}
          </div>
        </>
      )}
      {tab === 'place' && (
        <>
          <input className="rv-input" type="search" placeholder="Filter regions, offices, districts" value={placeQ} onChange={(e) => setPlaceQ(e.target.value)} aria-label="Filter places" />
          <div className="rv-add-group">
            <h3>Region</h3>
            {byCount(ix.regions, 'region').filter(({ v }) => v.toLowerCase().includes(placeQ.toLowerCase())).map(({ v, k }) => option({ kind: 'region', value: v }, v, k))}
          </div>
          <div className="rv-add-group">
            <h3>DPWH office and the legislative districts it serves</h3>
            {byCount(ix.offices.map((o) => o.name), 'office')
              .filter(({ v }) => { const o = ix.offices.find((x) => x.name === v)!; return `${v} ${o.districts.join(' ')}`.toLowerCase().includes(placeQ.toLowerCase()); })
              .slice(0, placeQ ? 60 : 25)
              .map(({ v, k }) => { const o = ix.offices.find((x) => x.name === v)!; return option({ kind: 'office', value: v }, <>{shortOffice(v)}<small>{o.districts.length ? o.districts.join(' · ') : 'No single legislative district'}</small></>, k); })}
          </div>
        </>
      )}
      {tab === 'budget' && (
        <>
          <div className="rv-add-group">
            <h3>Budget of at least</h3>
            {[10e6, 50e6, 100e6, 500e6, 1e9].map((v) => { const s: Step = { kind: 'min', value: v }; return option(s, pesoShort(v), count(s)); })}
          </div>
          <div className="rv-add-group">
            <h3>Program</h3>
            {byCount(ix.programs, 'program').map(({ v, k }) => option({ kind: 'program', value: v }, v || 'No program listed', k))}
          </div>
        </>
      )}
      {tab === 'search' && (
        <form className="rv-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { onAdd({ kind: 'q', value: q.trim() }); setQ(''); } }}>
          <input className="rv-input" type="search" placeholder="Words in the title, office or district" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
          <button type="submit" className="rv-btn" disabled={!q.trim()}>Add</button>
          {q.trim() && <p className="rv-hint">{n(count({ kind: 'q', value: q.trim() }))} of these projects match.</p>}
        </form>
      )}
    </section>
  );
}

// --- Project list -----------------------------------------------------------------------------------------------

function DocDots({ mask }: { mask: number }) {
  return (
    <span className="rv-dots" role="img" aria-label={`${docCount(mask)} of 5 key documents: ${NAMED_TYPES.filter((_, i) => hasDoc(mask, i)).join(', ') || 'none'}`}>
      {NAMED_TYPES.map((t, i) => <i key={t} className={hasDoc(mask, i) ? 'is-on' : ''} title={`${t}: ${hasDoc(mask, i) ? 'found' : 'not found'}`} />)}
    </span>
  );
}

function ProjectList({ projects, selected, reviews, onOpen }: {
  projects: ReviewProject[];
  selected: string | null;
  reviews: Record<string, MyReview>;
  onOpen: (p: ReviewProject) => void;
}) {
  // The parent keys this list by its funnel and sort, so a new list starts again at the first page.
  const [more, setMore] = useState(0);
  const sentinel = useRef<HTMLLIElement>(null);
  const at = projects.findIndex((p) => p.hgabId === selected);
  const shown = Math.max(PAGE_ROWS + more, at >= 0 ? at + PAGE_ROWS : 0);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setMore(shown); }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [projects, shown]);
  // Keep the open project in view when it moves (keyboard).
  useEffect(() => { document.getElementById(`rv-item-${selected}`)?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  if (!projects.length) return <p className="rv-empty">No project passes every step. Remove a step to see more.</p>;
  return (
    <ul className="rv-items">
      {projects.slice(0, shown).map((p) => (
        <li key={p.hgabId} id={`rv-item-${p.hgabId}`}>
          <button type="button" className={`rv-item ${p.hgabId === selected ? 'is-on' : ''}`} onClick={() => onOpen(p)} aria-current={p.hgabId === selected ? 'true' : undefined}>
            <span className="rv-item-title">{p.title}</span>
            <span className="rv-item-meta" title={officeLine(p.office, 99)}>{officeLine(p.office, 1)} · {p.region}</span>
            <span className="rv-item-foot">
              <b>{pesoShort(p.amount)}</b>
              <span className={`rv-flagcount ${p.flags.length >= 5 ? 'is-many' : ''}`}>{p.flags.length} {p.flags.length === 1 ? 'flag' : 'flags'}</span>
              <DocDots mask={p.docs} />
              {reviews[p.hgabId] && <span className="rv-done" title="You reviewed this project">✓ reviewed</span>}
            </span>
          </button>
        </li>
      ))}
      {shown < projects.length && <li ref={sentinel} className="rv-more">Loading more…</li>}
    </ul>
  );
}

// --- One project ------------------------------------------------------------------------------------------------

const NOTE_TEXT: Record<string, (d: ReviewDetail, files: DetailFile[]) => string | null> = {
  proposal_documents_via_nep_counterpart: () =>
    'DPWH Transparency lists no documents under this project’s own name. The DPWH Transparency files here come from its NEP counterpart.',
  proposal_types_without_files: () =>
    'research.bettergov.ph lists DPWH Transparency documents for this project, but we have not found their files yet.',
  senate_matched_without_files: () => 'research.bettergov.ph counts Senate documents for this project, but lists no files for it.',
  senate_folder_moved_from_another_row: () => 'We moved a Senate folder to this project after reading its program of work.',
  senate_folder_moved_to_another_row: () => 'A Senate folder once matched here belongs to another project, by its program of work.',
  several_senate_folders: (_, files) => `These files come from ${new Set(files.filter((f) => f[0] === 'senate').map((f) => f[8])).size} Senate folders. Check each is for this project.`,
};

function FlagList({ detail, index }: { detail: ReviewDetail; index: ReviewIndex }) {
  const family = (code: string) => index.flags.find((f) => f.code === code)?.family ?? 'nep';
  const groups = FAMILY_ORDER.map((fam) => ({ fam, flags: detail.flags.filter((f) => family(f.code) === fam) })).filter((g) => g.flags.length);
  if (!groups.length) return <p className="rv-muted">research.bettergov.ph lists no red flags for this project.</p>;
  return (
    <>
      {groups.map((g) => (
        <div key={g.fam} className="rv-flaggroup">
          <h4>{FAMILY_LABEL[g.fam]}</h4>
          <ul>
            {g.flags.map((f) => (
              <li key={f.code + f.label}>
                {f.evidence.length ? (
                  <details>
                    <summary>{readerText(f.value != null ? f.label.replace(/: [\d,]+ pesos$/, `: ${pesoFull(f.value)}`) : f.label)}</summary>
                    {f.evidence.map((e) => <p key={e}>{readerText(e)}</p>)}
                  </details>
                ) : <span>{readerText(f.label)}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function FileButton({ f, on, onOpen }: { f: DetailFile; on: boolean; onOpen: () => void }) {
  const [source, method, , sourceType, name, url, bytes, archived] = f;
  return (
    <li className={`rv-file ${on ? 'is-on' : ''}`}>
      <button type="button" onClick={onOpen} title={isPdf(f) ? 'Show it here' : 'Open it'}>
        <span className="rv-file-name">{name}</span>
        <span className="rv-file-meta">
          <span className={`rv-src is-${source}`}>{SOURCE_LABEL[source]}</span>
          {sourceType && sourceType !== f[2] && <span>{sourceType}</span>}
          {archived && <span className="rv-tag">earlier copy</span>}
          {bytes != null && <span>{fileSize(bytes)}</span>}
        </span>
        <span className={`rv-file-how ${LINK_WEAK.has(method) ? 'is-weak' : ''}`}>{LINK_LABEL[method]}</span>
      </button>
      <a href={url} target="_blank" rel="noopener noreferrer" className="rv-file-open" aria-label={`Open ${name} in a new tab`}>↗</a>
    </li>
  );
}

function Viewer({ file, onClose, inline }: { file: DetailFile; onClose: () => void; inline: boolean }) {
  const body = (
    <div className="rv-viewer">
      <div className="rv-viewer-bar">
        <span className="rv-viewer-name">{file[4]}</span>
        <a href={file[5]} target="_blank" rel="noopener noreferrer">Open in a new tab</a>
        <button type="button" onClick={onClose} aria-label="Close the document">×</button>
      </div>
      {isPdf(file)
        ? <iframe key={file[5]} src={`${file[5]}#view=FitH`} title={file[4]} />
        : <p className="rv-empty">This file can’t be shown here. <a href={file[5]} target="_blank" rel="noopener noreferrer">Open it</a>.</p>}
    </div>
  );
  return inline ? body : <div className="rv-viewer-modal" role="dialog" aria-label={file[4]}>{body}</div>;
}

function ReviewForm({ project, detail, mine, onSave }: {
  project: ReviewProject;
  detail: ReviewDetail;
  mine: MyReview | undefined;
  onSave: (r: MyReview | null) => void;
}) {
  const blank = useCallback((): MyReview => ({ hgabId: project.hgabId, projectId: project.projectId, title: project.title, docs: {}, overall: '', notes: '', savedAt: '' }), [project]);
  // ProjectPane is keyed by project, so this form starts fresh for each one.
  const [r, setR] = useState<MyReview>(() => mine ?? blank());
  const [saved, setSaved] = useState(!!mine);
  const set = (patch: Partial<MyReview>) => { setR((x) => ({ ...x, ...patch })); setSaved(false); };
  const typesHere = new Set(detail.files.map((f) => f[2]));
  return (
    <form className="rv-form" onSubmit={(e) => { e.preventDefault(); onSave({ ...r, savedAt: new Date().toISOString() }); setSaved(true); }}>
      <h3 className="rv-h">Your review</h3>
      <p className="rv-muted">Open each document, then say what you found.</p>
      <table className="rv-form-docs">
        <tbody>
          {NAMED_TYPES.map((t) => (
            <tr key={t}>
              <th scope="row" title={NAMED_MEANING[t]}>{t}{!typesHere.has(t) && <small>no file found</small>}</th>
              <td>
                <select value={r.docs[t] ?? ''} onChange={(e) => set({ docs: { ...r.docs, [t]: e.target.value as DocVerdict } })} aria-label={`${t}: what you found`}>
                  <option value="">Not checked</option>
                  {Object.entries(DOC_VERDICT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <fieldset className="rv-overall">
        <legend>Do the documents support this project as the House bill lists it?</legend>
        {Object.entries(OVERALL_LABEL).map(([k, l]) => (
          <label key={k}><input type="radio" name="overall" value={k} checked={r.overall === k} onChange={() => set({ overall: k as Overall })} /> {l}</label>
        ))}
      </fieldset>
      <label className="rv-notes">
        Notes
        <textarea rows={4} value={r.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="What doesn’t match: title, location, amount, dates, signatures…" />
      </label>
      <div className="rv-form-actions">
        <button type="submit" className="rv-btn is-primary" disabled={saved}>{saved ? 'Saved' : 'Save review'}</button>
        {mine && <button type="button" className="rv-btn" onClick={() => { onSave(null); setR(blank()); setSaved(false); }}>Clear</button>}
      </div>
      <p className="rv-hint">Reviews stay in this browser for now. Download them from “My reviews”.</p>
    </form>
  );
}

function ProjectPane({ project, index, mine, onSave, inlineViewer, onPrev, onNext }: {
  project: ReviewProject;
  index: ReviewIndex;
  mine: MyReview | undefined;
  onSave: (r: MyReview | null) => void;
  inlineViewer: boolean;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}) {
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<DetailFile | null>(null);
  useEffect(() => {
    // Keyed by project in the parent, so state starts empty for each project.
    let live = true;
    loadShard(project.seq).then((s) => {
      if (!live) return;
      const d = s[project.hgabId] ?? null;
      setDetail(d);
      if (d && inlineViewer) setOpen(d.files.find((f) => f[2] === 'POW' && isPdf(f) && !f[7]) ?? d.files.find(isPdf) ?? null);
    }).catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [project.hgabId, project.seq, inlineViewer]);
  const o = project.office;
  const filesByType = (t: string) => (detail?.files ?? []).filter((f) => f[2] === t);
  return (
    <div className={`rv-project ${inlineViewer ? 'has-viewer' : ''}`}>
      <div className="rv-project-info">
        <div className="rv-project-nav">
          <button type="button" onClick={onPrev ?? undefined} disabled={!onPrev} aria-label="Previous project (k)">‹ Prev</button>
          <span className="rv-muted">{project.hgabId}</span>
          <button type="button" onClick={onNext ?? undefined} disabled={!onNext} aria-label="Next project (j)">Next ›</button>
        </div>
        <h2 className="rv-project-title">{project.title}</h2>
        <dl className="rv-facts">
          <div><dt>House bill</dt><dd><b>{pesoFull(project.amount)}</b></dd></div>
          <div><dt>Office</dt><dd>{o.name === 'Central Office' ? 'DPWH Central Office' : `DPWH ${shortOffice(o.name)}`}</dd></div>
          <div><dt>Legislative {o.districts.length === 1 ? 'district' : 'districts'}</dt><dd>{o.districts.length ? <>{o.districts.join(' · ')} <small>{o.tier === 'A' ? 'Lone · only this district' : `Shared by ${o.districts.length} districts`}</small></> : 'No single district (Central Office)'}</dd></div>
          <div><dt>Region</dt><dd>{project.region}</dd></div>
          <div><dt>Program</dt><dd>{project.program}{detail?.pap ? <small>{detail.pap}</small> : null}</dd></div>
        </dl>
        <p className="rv-links">
          {detail?.bill_doc && <a href={pdfUrl(detail.bill_doc, detail.bill_page)} target="_blank" rel="noopener noreferrer">See it in the House bill, page {detail.bill_page}</a>}
          <Link to={recordPath('dpwh', project.projectId)}>Project page: NEP and House bill</Link>
        </p>

        {error && <p className="rv-error">{error}</p>}
        {!detail && !error && <p className="rv-muted" role="status">Loading the documents…</p>}
        {detail && (
          <>
            <section className="rv-sec">
              <h3 className="rv-h">Documents · {docCount(project.docs)} of 5 key types found</h3>
              <ul className="rv-checklist">
                {NAMED_TYPES.map((t, i) => (
                  <li key={t} className={hasDoc(project.docs, i) ? 'is-on' : ''} title={NAMED_MEANING[t]}>
                    <span aria-hidden="true">{hasDoc(project.docs, i) ? '✓' : '✗'}</span> {NAMED_SHORT[t]}
                    <span className="visually-hidden">{hasDoc(project.docs, i) ? ' found' : ' not found'}</span>
                  </li>
                ))}
              </ul>
              {detail.notes.map((k) => NOTE_TEXT[k]?.(detail, detail.files)).filter(Boolean).map((t) => <p key={t} className="rv-note">{t}</p>)}
              {!detail.files.length && <p className="rv-muted">We found no files for this project.</p>}
              {[...NAMED_TYPES, 'Other'].map((t) => {
                const fs = filesByType(t);
                if (!fs.length) return null;
                return (
                  <div key={t} className="rv-filegroup">
                    <h4>{t === 'Other' ? 'Other files' : t} <small>{fs.length}</small></h4>
                    <ul>{fs.map((f) => <FileButton key={f[5]} f={f} on={open?.[5] === f[5]} onOpen={() => (isPdf(f) ? setOpen(f) : window.open(f[5], '_blank', 'noopener'))} />)}</ul>
                  </div>
                );
              })}
              <p className="rv-hint">A file being here doesn’t confirm what it says. Our matches can be wrong; say so in your review.</p>
            </section>
            <section className="rv-sec">
              <h3 className="rv-h">{detail.flags.length} red {detail.flags.length === 1 ? 'flag' : 'flags'} from research.bettergov.ph</h3>
              <p className="rv-muted">A red flag is a reason to look, not a finding.</p>
              <FlagList detail={detail} index={index} />
            </section>
            <ReviewForm project={project} detail={detail} mine={mine} onSave={onSave} />
          </>
        )}
      </div>
      {open && <Viewer file={open} inline={inlineViewer} onClose={() => setOpen(null)} />}
      {inlineViewer && !open && detail && <div className="rv-viewer rv-viewer-empty"><p>Pick a document to read it here.</p></div>}
    </div>
  );
}

// --- About ------------------------------------------------------------------------------------------------------

function About({ index, onClose }: { index: ReviewIndex; onClose: () => void }) {
  return (
    <div className="rv-about" role="dialog" aria-modal="true" aria-label="How the reviewer works">
      <div className="rv-about-card">
        <button type="button" className="rv-about-close" onClick={onClose} aria-label="Close">×</button>
        <h2>How the reviewer works</h2>
        <p>Every DPWH project in the House bill (HB 10858, third reading) is here: {n(index.rows.length)} projects.</p>
        <p>Each comes with the documents found for it and the red flags research.bettergov.ph raised.</p>
        <h3>The funnel</h3>
        <p>Add steps to narrow the list. Each step keeps only the projects that pass it.</p>
        <p>Beside every option is how many projects it would keep. Share the page address to share your funnel.</p>
        <h3>Where the documents come from</h3>
        <ul>
          <li><b>Senate copies:</b> documents DPWH gave the Senate for the House bill’s projects.</li>
          <li><b>DPWH Transparency:</b> documents DPWH published for its proposals, paired with the project.</li>
        </ul>
        <p>research.bettergov.ph matched most of them; we added more. Each file says how it was matched.</p>
        <p>Matches can be wrong, and a file being here doesn’t confirm what it says. That is what reviews are for.</p>
        <h3>The 5 key documents</h3>
        <ul>{NAMED_TYPES.map((t) => <li key={t}><b>{t}:</b> {NAMED_MEANING[t]}</li>)}</ul>
        <p className="rv-muted">
          Document matches as of {asOf(index.source_generated_at.coverage)}; red flags as of {asOf(index.source_generated_at.flags)}.{' '}
          <Link to={`${HGAB_ROOT}/methodology`}>Methodology</Link> · <a href="https://research.bettergov.ph/static/nep-preview/dpwh.html" target="_blank" rel="noopener noreferrer">research.bettergov.ph</a>
        </p>
        <DisclaimerNotice compact />
      </div>
    </div>
  );
}

// --- Page -------------------------------------------------------------------------------------------------------

type Pane = 'funnel' | 'list' | 'project';

export default function HgabReview() {
  const [index, setIndex] = useState<ReviewIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const { reviews, save } = useMyReviews();
  const [about, setAbout] = useState(false);
  const [pane, setPane] = useState<Pane>('list');
  const [inlineViewer, setInlineViewer] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1600px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1600px)');
    const on = () => setInlineViewer(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => { loadIndex().then(setIndex).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e))); }, []);

  const all = useMemo(() => (index ? decodeIndex(index) : []), [index]);
  const flagIndex = useMemo(() => new Map((index?.flags ?? []).map((f, i) => [f.code, i])), [index]);
  const steps = useMemo(() => stepsFromSearch(params, new Set(flagIndex.keys())), [params, flagIndex]);
  const reviewed = useMemo(() => new Set(Object.keys(reviews)), [reviews]);
  const ctx = useMemo(() => ({ flagIndex, reviewed }), [flagIndex, reviewed]);
  const levels = useMemo(() => runFunnel(all, steps, ctx), [all, steps, ctx]);
  const sort = (params.get('sort') as SortKey) in SORT_LABEL ? (params.get('sort') as SortKey) : 'flags';
  const current = levels[levels.length - 1].projects;
  const listed = useMemo(() => sortProjects(current, sort), [current, sort]);
  const selectedId = params.get('p');
  const selected = useMemo(() => all.find((p) => p.hgabId === selectedId) ?? null, [all, selectedId]);

  const update = useCallback((fn: (p: URLSearchParams) => void, replace = false) => {
    setParams((prev) => { const next = new URLSearchParams(prev); fn(next); return next; }, { replace });
  }, [setParams]);
  const setSteps = (next: Step[]) => update((p) => { p.delete('s'); next.forEach((s) => p.append('s', stepToParam(s))); });
  const open = useCallback((p: ReviewProject) => { update((q) => q.set('p', p.hgabId), true); setPane('project'); }, [update]);
  const at = listed.findIndex((p) => p.hgabId === selectedId);
  const prev = useMemo(() => (at > 0 ? () => open(listed[at - 1]) : null), [at, listed, open]);
  const next = useMemo(() => (at >= 0 && at < listed.length - 1 ? () => open(listed[at + 1]) : at < 0 && listed.length ? () => open(listed[0]) : null), [at, listed, open]);

  // j / k move through the list, as in a mail client; not while typing.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
      if (e.key === 'j' && next) { e.preventDefault(); next(); }
      if (e.key === 'k' && prev) { e.preventDefault(); prev(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [next, prev]);

  const myList = Object.values(reviews);
  const presets = PRESETS.filter((p) => p.steps.every((s) => s.kind !== 'flag' || flagIndex.has(s.code)));

  return (
    <div className="rv-app">
      <header className="rv-bar">
        <Link to="/" className="rv-brand"><img src="https://assets.bettergov.ph/logos/png/horizontal-primary.png" alt="BetterGov.ph" /></Link>
        <div className="rv-bar-title">
          <h1>{REVIEW_TITLE}</h1>
          <span>DPWH projects in the FY2027 House bill · HB 10858</span>
        </div>
        <nav className="rv-bar-links" aria-label="Reviewer">
          <button type="button" onClick={() => setAbout(true)}>How it works</button>
          <details className="rv-mine">
            <summary>My reviews <b>{myList.length}</b></summary>
            <div className="rv-mine-menu">
              {myList.length ? (
                <>
                  <p>{myList.length} {myList.length === 1 ? 'review' : 'reviews'} saved in this browser.</p>
                  <button type="button" className="rv-btn" onClick={() => download('bettergov-house-bill-reviews.csv', reviewsCsv(myList), 'text/csv;charset=utf-8')}>Download CSV</button>
                  <button type="button" className="rv-btn" onClick={() => download('bettergov-house-bill-reviews.json', JSON.stringify(myList, null, 2), 'application/json')}>Download JSON</button>
                  <button type="button" className="rv-btn" onClick={() => setSteps([...steps.filter((s) => s.kind !== 'reviewed'), { kind: 'reviewed', value: 'yes' }])}>Show them</button>
                </>
              ) : <p>No reviews yet. Open a project and fill in “Your review”.</p>}
            </div>
          </details>
          <Link to={`${HGAB_ROOT}/overview`}>House bill analysis</Link>
        </nav>
      </header>

      {error && <p className="rv-error rv-pad">{error}</p>}
      {!index && !error && <p className="rv-muted rv-pad" role="status">Loading the House bill’s DPWH projects…</p>}
      {index && (
        <div className={`rv-cols show-${pane}`}>
          <aside className="rv-funnel" aria-label="Funnel">
            <h2 className="rv-h">Red-flag funnel</h2>
            <FunnelSteps
              levels={levels}
              flags={index.flags}
              offices={index.offices}
              onRemove={(i) => setSteps(steps.filter((_, j) => j !== i))}
              onFlip={(i) => setSteps(steps.map((s, j) => (j === i && s.kind === 'flag' ? { ...s, not: !s.not } : s)))}
              onClear={() => setSteps([])}
            />
            <AddStep ix={index} current={current} steps={steps} reviewedCount={myList.length} ctx={ctx} onAdd={(s) => setSteps([...steps, s])} />
            <section className="rv-presets" aria-label="Start from">
              <h2 className="rv-h">Start from</h2>
              {presets.map((p) => (
                <button key={p.key} type="button" className="rv-preset" onClick={() => { setSteps(p.steps); setPane('list'); }}>
                  <b>{p.label}</b><span>{p.note}</span>
                </button>
              ))}
            </section>
            <DisclaimerNotice compact className="rv-disclaimer" />
          </aside>

          <section className="rv-list" aria-label="Projects">
            <div className="rv-list-head">
              <p><b>{n(current.length)}</b> {current.length === 1 ? 'project' : 'projects'} · {pesoShort(levels[levels.length - 1].amount)}</p>
              <label>
                <span className="visually-hidden">Sort</span>
                <select value={sort} onChange={(e) => update((p) => p.set('sort', e.target.value), true)}>
                  {Object.entries(SORT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
            </div>
            <ProjectList key={`${steps.map(stepToParam).join('|')}|${sort}`} projects={listed} selected={selectedId} reviews={reviews} onOpen={open} />
          </section>

          <section className="rv-detail" aria-label="Project">
            {selected
              ? <ProjectPane key={selected.hgabId} project={selected} index={index} mine={reviews[selected.hgabId]} onSave={(r) => save(r, selected.hgabId)}
                  inlineViewer={inlineViewer} onPrev={prev} onNext={next} />
              : (
                <div className="rv-welcome">
                  <h2>Pick a project to review</h2>
                  <p>Narrow the list with the funnel, or start from a ready-made one on the left.</p>
                  <p>Then open each document and fill in your review. Use <kbd>j</kbd> and <kbd>k</kbd> to move between projects.</p>
                  {listed.length > 0 && <button type="button" className="rv-btn is-primary" onClick={() => open(listed[0])}>Open the first project</button>}
                </div>
              )}
          </section>

          <nav className="rv-panes" aria-label="Panels">
            <button type="button" className={pane === 'funnel' ? 'is-on' : ''} onClick={() => setPane('funnel')}>Funnel{steps.length ? ` · ${steps.length}` : ''}</button>
            <button type="button" className={pane === 'list' ? 'is-on' : ''} onClick={() => setPane('list')}>Projects · {n(current.length)}</button>
            <button type="button" className={pane === 'project' ? 'is-on' : ''} onClick={() => setPane('project')} disabled={!selected}>Project</button>
          </nav>
        </div>
      )}
      {about && index && <About index={index} onClose={() => setAbout(false)} />}
    </div>
  );
}
