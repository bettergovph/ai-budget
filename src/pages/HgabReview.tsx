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
  DOCS_FILTERS, DOCS_FILTER_LABEL, FAMILY_LABEL, FAMILY_ORDER, LINK_LABEL, LINK_WEAK, NAMED_MEANING, NAMED_SHORT,
  PRESETS, REVIEW_TITLE, SORT_LABEL, SOURCE_LABEL, checkedValues, countBy, decodeIndex, docCount,
  flagYields, foldText, hasDoc, pesoFull, pesoShort, projectsWithout, readerText, runFunnel, setSingle,
  setValues, sortProjects, stepLabel, stepTest, stepToParam, stepsFromSearch, toggleFlag,
  type MultiKind, type ReviewProject, type SortKey, type Step, type StepContext,
} from '../lib/hgab-review';
import {
  BUDGET_SOURCE_VERSION, MAPPING_STATUS, REGISTRY, STORE_CASES, STORE_PROFILE, STORE_V1, TEAM_FLAGS, caseTouched, classifyProject,
  detectorsFor, fromV1, newCaseReview, type CaseReview, type Reviewer, type ReviewV1,
} from '../lib/hgab-redflags-team';
import HgabReviewForm from '../components/HgabReviewForm';
import { downloadCases } from '../lib/hgab-review-export';
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

// --- My reviews (in this browser until reviews can be sent) ------------------------------------------------------

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
function readJsonStore<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function writeJsonStore(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage full or blocked: keep in memory */ }
}
/** The volunteer's random id, and the name and role they last gave; prefills each new review. */
function readProfile(): Reviewer {
  const p = readJsonStore<Partial<Reviewer>>(STORE_PROFILE, {});
  const out = { reviewer_id: p.reviewer_id || newId(), display_name: p.display_name ?? '', task_id: p.task_id ?? '' };
  if (!p.reviewer_id) writeJsonStore(STORE_PROFILE, out);
  return out;
}
/** A fresh review for a project, for this volunteer. */
function caseFor(p: ReviewProject, ix: ReviewIndex, reviewer: Reviewer, pap?: string | null): CaseReview {
  const n = new Date().toISOString();
  return newCaseReview({
    caseId: newId(), reviewer, dataBuiltAt: ix.built_at, now: n,
    project: {
      hgab_id: p.hgabId, project_id: p.projectId, budget_source_version: BUDGET_SOURCE_VERSION, title: p.title, office: p.office.name,
      region: p.region, amount_php: p.amount, categories: classifyProject({ title: p.title, pap, program: p.program }),
      detector_rule_ids: p.flags.map((i) => ix.flags[i].code),
    },
  });
}
function useCases() {
  const [cases, setCases] = useState<Record<string, CaseReview>>(() => readJsonStore(STORE_CASES, {}));
  const [profile, setProfile] = useState<Reviewer>(readProfile);
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === STORE_CASES) setCases(readJsonStore(STORE_CASES, {})); };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, []);
  /** First-version reviews become cases once the project list is here; the old store is then cleared. */
  const migrate = useCallback((index: ReviewIndex, all: ReviewProject[]) => {
    const v1 = readJsonStore<Record<string, ReviewV1>>(STORE_V1, {});
    if (!Object.keys(v1).length) return;
    const byId = new Map(all.map((p) => [p.hgabId, p]));
    const moved: Record<string, CaseReview> = {};
    for (const [id, r] of Object.entries(v1)) { const p = byId.get(id); if (p) moved[id] = fromV1(r, caseFor(p, index, profile)); }
    setCases((prev) => { const next = { ...moved, ...prev }; writeJsonStore(STORE_CASES, next); return next; });
    try { localStorage.removeItem(STORE_V1); } catch { /* ignore */ }
  }, [profile]);
  const save = useCallback((r: CaseReview) => {
    setCases((prev) => {
      const next = { ...prev };
      if (caseTouched(r)) next[r.project.hgab_id] = r; else delete next[r.project.hgab_id];
      writeJsonStore(STORE_CASES, next);
      return next;
    });
    if (r.reviewer.display_name !== profile.display_name || r.reviewer.task_id !== profile.task_id) {
      const p = { ...profile, display_name: r.reviewer.display_name, task_id: r.reviewer.task_id };
      setProfile(p);
      writeJsonStore(STORE_PROFILE, p);
    }
  }, [profile]);
  return { cases, save, profile, migrate };
}

// --- Filters and the funnel -------------------------------------------------------------------------------------

/** A filter button in the bar that opens a panel of checkboxes; closes on Escape or a click outside. */
function Dropdown({ label, count, active, wide, children }: { label: string; count?: number; active?: boolean; wide?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className={`rv-dd ${active ? 'is-active' : ''} ${open ? 'is-open' : ''}`} ref={ref}>
      <button type="button" className="rv-dd-btn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        {label}{count ? <b>{count}</b> : null}<span className="rv-dd-caret" aria-hidden="true">▾</span>
      </button>
      {open && <div className={`rv-dd-panel ${wide ? 'is-wide' : ''}`} role="group" aria-label={label}>{children}</div>}
    </div>
  );
}

/** One checkbox: its label, and how many projects it would keep beside a bar. */
function Check({ checked, onChange, label, note, k, max, disabled }: {
  checked: boolean; onChange: () => void; label: ReactNode; note?: ReactNode; k: number; max: number; disabled?: boolean;
}) {
  return (
    <label className={`rv-check ${checked ? 'is-on' : ''} ${!checked && (disabled ?? k === 0) ? 'is-off' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={!checked && (disabled ?? k === 0)} />
      <span className="rv-check-label">{label}{note && <small>{note}</small>}</span>
      <span className="rv-check-n">{n(k)}</span>
      <span className="rv-check-bar" aria-hidden="true"><span style={{ width: `${(k / Math.max(1, max)) * 100}%` }} /></span>
    </label>
  );
}

function PanelFilter({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <input className="rv-input rv-dd-filter" type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} autoFocus />;
}
function PanelFoot({ children }: { children: ReactNode }) { return <div className="rv-dd-foot">{children}</div>; }

/** The volunteer team's checks (RF-001…): projects whose red flags suggest each one. Rendered only while open. */
function TeamPanel({ all, steps, ctx, onSteps }: { all: ReviewProject[]; steps: Step[]; ctx: StepContext; onSteps: (fn: (cur: Step[]) => Step[]) => void }) {
  const [q, setQ] = useState('');
  const base = useMemo(() => projectsWithout(all, steps, 'team', ctx), [all, steps, ctx]);
  const checked = checkedValues(steps, 'team');
  const rows = useMemo(() => REGISTRY.flags.map((f) => {
    const idx = new Set(ctx.teamIndex?.get(f.id) ?? []);
    return { f, k: idx.size ? base.filter((p) => p.flags.some((i) => idx.has(i))).length : 0, detectors: idx.size };
  }), [base, ctx.teamIndex]);
  const toggle = (id: string) => onSteps((cur) => {
    const c = checkedValues(cur, 'team');
    return setValues(cur, 'team', c.includes(id) ? c.filter((x) => x !== id) : [...c, id]);
  });
  const shown = rows.filter(({ f }) => !q || foldText(`${f.id} ${f.title} ${f.category} ${f.lead_skill}`).includes(foldText(q)));
  return (
    <>
      <PanelFilter value={q} onChange={setQ} placeholder="Find a team check, category or specialist" />
      <p className="rv-dd-note">The volunteer team’s registry ({REGISTRY.source.version}). A project shows under a check when its red flags suggest it. {MAPPING_STATUS}.</p>
      <div className="rv-dd-cols">
        {[true, false].map((auto) => (
          <div key={String(auto)} className="rv-dd-group">
            <h3>{auto ? 'Suggested by red flags' : 'No red flag points here yet: check by hand'}</h3>
            {shown.filter((r) => (r.detectors > 0) === auto).map(({ f, k }) => (
              <Check key={f.id} checked={checked.includes(f.id)} onChange={() => toggle(f.id)} k={k} max={Math.max(1, base.length)} disabled={!auto}
                label={<><b className="rv-rf">{f.id}</b> {f.title}</>} note={`${f.category} · ${f.lead_skill}`} />
            ))}
          </div>
        ))}
      </div>
      <PanelFoot>
        <span>Projects suggested for any checked team check.</span>
        {checked.length > 0 && <button type="button" onClick={() => onSteps((cur) => setValues(cur, 'team', []))}>Clear</button>}
      </PanelFoot>
    </>
  );
}

function FilterBar({ ix, all, steps, current, ctx, reviewedCount, presets, onSteps }: {
  ix: ReviewIndex;
  all: ReviewProject[];
  steps: Step[];
  current: ReviewProject[];
  ctx: StepContext;
  reviewedCount: number;
  presets: typeof PRESETS;
  /** Gets the latest steps: the URL may not have caught up with a quick second click. */
  onSteps: (fn: (cur: Step[]) => Step[]) => void;
}) {
  const [exclude, setExclude] = useState(false);
  const [flagQ, setFlagQ] = useState('');
  const [officeQ, setOfficeQ] = useState('');
  const qStep = steps.find((s) => s.kind === 'q');
  const [q, setQ] = useState(qStep && qStep.kind === 'q' ? qStep.value : '');
  const yields = useMemo(() => flagYields(current, ix.flags.length), [current, ix.flags.length]);
  const flagStep = (code: string) => steps.find((s) => s.kind === 'flag' && s.code === code);
  const multi = (kind: MultiKind, key: (p: ReviewProject) => string) => {
    const base = projectsWithout(all, steps, kind, ctx);
    return { base: base.length, counts: countBy(base, key), checked: checkedValues(steps, kind) };
  };
  const toggleValue = (kind: MultiKind, v: string) => onSteps((cur) => {
    const c = checkedValues(cur, kind);
    return setValues(cur, kind, c.includes(v) ? c.filter((x) => x !== v) : [...c, v]);
  });
  const max = Math.max(1, current.length);

  const flagChecks = (fams: FlagFamily[], computed: boolean) => fams.map((fam) => {
    const items = ix.flags.map((f, i) => ({ f, i }))
      .filter(({ f }) => f.family === fam && !!f.computed === computed && readerText(f.label).toLowerCase().includes(flagQ.toLowerCase()))
      .sort((a, b) => yields[b.i] - yields[a.i]);
    if (!items.length) return null;
    return (
      <div key={fam} className="rv-dd-group">
        {!computed && <h3>{fam === 'documents' ? 'Documents, as research.bettergov.ph flags them' : FAMILY_LABEL[fam]}</h3>}
        {items.map(({ f, i }) => {
          const s = flagStep(f.code);
          const k = s && s.kind === 'flag' && s.not ? current.length : exclude && !s ? current.length - yields[i] : yields[i];
          return (
            <Check key={f.code} checked={!!s} onChange={() => onSteps((cur) => toggleFlag(cur, f.code, exclude))} k={k} max={max}
              label={<>{s && s.kind === 'flag' && s.not && <em className="rv-not">Leave out · </em>}{readerText(f.label)}</>}
              note={f.computed ? `With the documents we matched; research.bettergov.ph counts ${n(f.n_upstream ?? 0)}` : undefined} />
          );
        })}
      </div>
    );
  });
  const flagCount = steps.filter((s) => s.kind === 'flag' && !ix.flags[ctx.flagIndex.get(s.code) ?? -1]?.computed).length;
  const docsCount = steps.filter((s) => (s.kind === 'flag' && ix.flags[ctx.flagIndex.get(s.code) ?? -1]?.computed) || s.kind === 'docs' || s.kind === 'reviewed').length;

  const docs = multi('docs', () => '');
  const docsBase = projectsWithout(all, steps, 'docs', ctx);
  const region = multi('region', (p) => p.region);
  const office = multi('office', (p) => p.office.name);
  const program = multi('program', (p) => p.program);
  const minStep = steps.find((s) => s.kind === 'min');
  const minBase = projectsWithout(all, steps, 'min', ctx);
  const revStep = steps.find((s) => s.kind === 'reviewed');
  const revBase = projectsWithout(all, steps, 'reviewed', ctx);

  return (
    <div className="rv-filters" role="toolbar" aria-label="Filters">
      <Dropdown label="Start from" wide>
        <p className="rv-dd-note">A ready-made funnel. It replaces your filters.</p>
        {presets.map((p) => (
          <button key={p.key} type="button" className="rv-preset" onClick={() => onSteps(() => p.steps)}>
            <b>{p.label}</b><span>{p.note}</span>
          </button>
        ))}
      </Dropdown>

      <Dropdown label="Red flags" count={flagCount} active={flagCount > 0} wide>
        <PanelFilter value={flagQ} onChange={setFlagQ} placeholder="Find a flag" />
        <label className="rv-exclude"><input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} /> Leave out projects with the flags I check next</label>
        <div className="rv-dd-cols">{flagChecks(FAMILY_ORDER.filter((f) => f !== 'documents'), false)}{flagChecks(['documents'], false)}</div>
        <PanelFoot>
          <span>Every checked flag is a step: projects must pass them all.</span>
          {flagCount > 0 && <button type="button" onClick={() => onSteps((cur) => cur.filter((s) => !(s.kind === 'flag' && !ix.flags[ctx.flagIndex.get(s.code) ?? -1]?.computed)))}>Clear</button>}
        </PanelFoot>
      </Dropdown>

      <Dropdown label="Team checklist" count={checkedValues(steps, 'team').length} active={checkedValues(steps, 'team').length > 0} wide>
        <TeamPanel all={all} steps={steps} ctx={ctx} onSteps={onSteps} />
      </Dropdown>

      <Dropdown label="Documents" count={docsCount} active={docsCount > 0} wide>
        <div className="rv-dd-cols">
          <div className="rv-dd-group">
            <h3>How many of the 5 key documents</h3>
            {DOCS_FILTERS.map((v) => {
              const k = docsBase.filter(stepTest({ kind: 'docs', values: [v] }, ctx)).length;
              return <Check key={v} checked={docs.checked.includes(v)} onChange={() => toggleValue('docs', v)} label={DOCS_FILTER_LABEL[v]} k={k} max={Math.max(1, docsBase.length)} />;
            })}
            <h3>My reviews</h3>
            {(['no', 'yes'] as const).map((v) => {
              const k = revBase.filter(stepTest({ kind: 'reviewed', value: v }, ctx)).length;
              const on = !!revStep && revStep.kind === 'reviewed' && revStep.value === v;
              return <Check key={v} checked={on} disabled={v === 'yes' && !reviewedCount} k={k} max={Math.max(1, revBase.length)}
                label={v === 'yes' ? 'Reviewed by me' : 'Not yet reviewed by me'}
                onChange={() => onSteps((cur) => setSingle(cur, 'reviewed', on ? null : { kind: 'reviewed', value: v }))} />;
            })}
          </div>
          <div className="rv-dd-group">
            <h3>Missing, after our matching</h3>
            <label className="rv-exclude"><input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} /> Leave out projects missing it</label>
            {flagChecks(['documents'], true)}
          </div>
        </div>
      </Dropdown>

      <Dropdown label="Region" count={region.checked.length} active={region.checked.length > 0}>
        {ix.regions.map((v) => (
          <Check key={v} checked={region.checked.includes(v)} onChange={() => toggleValue('region', v)} label={v} k={region.counts.get(v) ?? 0} max={region.base} />
        ))}
        {region.checked.length > 0 && <PanelFoot><span>Projects in any checked region.</span><button type="button" onClick={() => onSteps((cur) => setValues(cur, 'region', []))}>Clear</button></PanelFoot>}
      </Dropdown>

      <Dropdown label="DPWH office" count={office.checked.length} active={office.checked.length > 0} wide>
        <PanelFilter value={officeQ} onChange={setOfficeQ} placeholder="Find an office, province or district" />
        <p className="rv-dd-note">Each office with the legislative districts it serves.</p>
        <div className="rv-dd-scroll">
          {ix.offices
            .filter((o) => office.checked.includes(o.name) || (office.counts.get(o.name) ?? 0) > 0)
            .filter((o) => !officeQ || foldText(`${o.name} ${o.districts.join(' ')}`).includes(foldText(officeQ)))
            .sort((a, b) => Number(office.checked.includes(b.name)) - Number(office.checked.includes(a.name)) || (office.counts.get(b.name) ?? 0) - (office.counts.get(a.name) ?? 0))
            .slice(0, officeQ ? 200 : 60)
            .map((o) => (
              <Check key={o.name} checked={office.checked.includes(o.name)} onChange={() => toggleValue('office', o.name)}
                label={o.name === 'Central Office' ? 'DPWH Central Office' : shortOffice(o.name)}
                note={o.districts.length ? `${o.districts.join(' · ')}${o.tier === 'B' ? ` · shared by ${o.districts.length}` : ''}` : 'No single legislative district'}
                k={office.counts.get(o.name) ?? 0} max={office.base} />
            ))}
        </div>
        <PanelFoot>
          <span>{officeQ ? 'Matching offices.' : 'The 60 offices with the most projects here; type to find others.'}</span>
          {office.checked.length > 0 && <button type="button" onClick={() => onSteps((cur) => setValues(cur, 'office', []))}>Clear</button>}
        </PanelFoot>
      </Dropdown>

      <Dropdown label="Budget" count={(minStep ? 1 : 0) + program.checked.length} active={!!minStep || program.checked.length > 0} wide>
        <div className="rv-dd-cols">
          <div className="rv-dd-group">
            <h3>Budget of at least</h3>
            {[10e6, 50e6, 100e6, 500e6, 1e9].map((v) => {
              const on = !!minStep && minStep.kind === 'min' && minStep.value === v;
              return <Check key={v} checked={on} onChange={() => onSteps((cur) => setSingle(cur, 'min', on ? null : { kind: 'min', value: v }))}
                label={pesoShort(v)} k={minBase.filter((p) => p.amount >= v).length} max={Math.max(1, minBase.length)} />;
            })}
          </div>
          <div className="rv-dd-group">
            <h3>Program</h3>
            {ix.programs.filter((v) => program.checked.includes(v) || (program.counts.get(v) ?? 0) > 0).map((v) => (
              <Check key={v} checked={program.checked.includes(v)} onChange={() => toggleValue('program', v)} label={v || 'No program listed'} k={program.counts.get(v) ?? 0} max={program.base} />
            ))}
          </div>
        </div>
      </Dropdown>

      <form className="rv-filter-search" onSubmit={(e) => { e.preventDefault(); onSteps((cur) => setSingle(cur, 'q', q.trim() ? { kind: 'q', value: q.trim() } : null)); }}>
        <input className="rv-input" type="search" placeholder="Search title, office, district" value={q}
          onChange={(e) => { setQ(e.target.value); if (!e.target.value && qStep) onSteps((cur) => setSingle(cur, 'q', null)); }} aria-label="Search projects (press Enter)" />
      </form>

      {steps.length > 0 && <button type="button" className="rv-clear" onClick={() => { setQ(''); onSteps(() => []); }}>Clear all</button>}
    </div>
  );
}

const TEAM_TITLES: ReadonlyMap<string, string> = new Map([...TEAM_FLAGS].map(([id, f]) => [id, f.title]));

/** The funnel, left to right: every project, then what each step keeps. */
function FunnelStrip({ levels, flags, offices, onRemove, onFlip }: {
  levels: ReturnType<typeof runFunnel>;
  flags: readonly ReviewIndexFlag[];
  offices: ReviewIndex['offices'];
  onRemove: (i: number) => void;
  onFlip: (i: number) => void;
}) {
  const total = levels[0].projects.length || 1;
  return (
    <ol className="rv-strip" aria-label="Red-flag funnel">
      {levels.map((L, i) => {
        const prev = i ? levels[i - 1].projects.length : null;
        const label = L.step ? stepLabel(L.step, flags, offices, TEAM_TITLES) : 'All DPWH projects';
        return (
          <li key={i} className={`rv-stage ${i === levels.length - 1 ? 'is-last' : ''}`}>
            <div className="rv-stage-head">
              <span className="rv-stage-label" title={label}>{label}</span>
              {L.step && <button type="button" className="rv-stage-x" onClick={() => onRemove(i - 1)} aria-label={`Remove: ${label}`}>×</button>}
            </div>
            <div className="rv-stage-figs">
              <b>{n(L.projects.length)}</b><span>{pesoShort(L.amount)}</span>
              {prev != null && prev !== L.projects.length && <em>−{n(prev - L.projects.length)}</em>}
            </div>
            <div className="rv-stage-bar" aria-hidden="true"><span style={{ width: `${Math.max((L.projects.length / total) * 100, L.projects.length ? 0.8 : 0)}%` }} /></div>
            {L.step?.kind === 'flag' && (
              <button type="button" className="rv-stage-flip" onClick={() => onFlip(i - 1)}>
                {L.step.not ? 'Keep these instead' : 'Leave these out instead'}
              </button>
            )}
          </li>
        );
      })}
    </ol>
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
  reviews: Record<string, CaseReview>;
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

/** The review form for one project, holding the draft until it is saved. */
function CasePanel({ project, detail, index, mine, profile, onSave }: {
  project: ReviewProject;
  detail: ReviewDetail;
  index: ReviewIndex;
  mine: CaseReview | undefined;
  profile: Reviewer;
  onSave: (r: CaseReview) => void;
}) {
  // ProjectPane is keyed by project, so the draft starts fresh for each one.
  const [draft, setDraft] = useState<CaseReview>(() => mine ?? caseFor(project, index, profile, detail.pap));
  const [saved, setSaved] = useState(!!mine);
  return (
    <HgabReviewForm
      review={draft}
      detail={detail}
      categories={draft.project.categories}
      detectorCodes={draft.project.detector_rule_ids}
      flags={index.flags}
      saved={saved}
      onChange={(r) => { setDraft(r); setSaved(false); }}
      onSave={(r) => { setDraft(r); onSave(r); setSaved(true); }}
    />
  );
}

function ProjectPane({ project, index, mine, profile, onSave, inlineViewer, onPrev, onNext }: {
  project: ReviewProject;
  index: ReviewIndex;
  mine: CaseReview | undefined;
  profile: Reviewer;
  onSave: (r: CaseReview) => void;
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
            <CasePanel project={project} detail={detail} index={index} mine={mine} profile={profile} onSave={onSave} />
            <DisclaimerNotice compact className="rv-disclaimer" />
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
        <h3>The review checklist</h3>
        <p>Each project has the volunteer team’s red-flag checks that fit it ({REGISTRY.flags.length} in all, {REGISTRY.source.version}).</p>
        <p>Red flags suggest which checks to start with. A suggested check is a candidate, not a finding.</p>
        <p>Each check says who should lead it, what evidence it needs, and what not to conclude.</p>
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

type Pane = 'list' | 'project';

export default function HgabReview() {
  const [index, setIndex] = useState<ReviewIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const { cases: reviews, save, profile, migrate } = useCases();
  const [about, setAbout] = useState(false);
  const [pane, setPane] = useState<Pane>('list');
  const [inlineViewer, setInlineViewer] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1600px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1600px)');
    const on = () => setInlineViewer(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    loadIndex().then((ix) => { setIndex(ix); migrate(ix, decodeIndex(ix)); }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [migrate]);

  const all = useMemo(() => (index ? decodeIndex(index) : []), [index]);
  const flagIndex = useMemo(() => new Map((index?.flags ?? []).map((f, i) => [f.code, i])), [index]);
  const steps = useMemo(() => stepsFromSearch(params, new Set(flagIndex.keys())), [params, flagIndex]);
  const reviewed = useMemo(() => new Set(Object.keys(reviews)), [reviews]);
  // Team check → the detector flags (as review.json indexes) that suggest it: the "Team checklist" filter.
  const teamIndex = useMemo(() => new Map(REGISTRY.flags.map((f) => [f.id, detectorsFor(f.id).map((c) => flagIndex.get(c)).filter((i): i is number => i != null)])), [flagIndex]);
  const ctx = useMemo(() => ({ flagIndex, reviewed, teamIndex }), [flagIndex, reviewed, teamIndex]);
  const levels = useMemo(() => runFunnel(all, steps, ctx), [all, steps, ctx]);
  const sort = (params.get('sort') as SortKey) in SORT_LABEL ? (params.get('sort') as SortKey) : 'flags';
  const current = levels[levels.length - 1].projects;
  const listed = useMemo(() => sortProjects(current, sort), [current, sort]);
  const selectedId = params.get('p');
  const selected = useMemo(() => all.find((p) => p.hgabId === selectedId) ?? null, [all, selectedId]);

  const update = useCallback((fn: (p: URLSearchParams) => void, replace = false) => {
    setParams((prev) => { const next = new URLSearchParams(prev); fn(next); return next; }, { replace });
  }, [setParams]);
  // The latest steps, ahead of the URL: react-router commits the URL asynchronously, so a quick second click would
  // otherwise start from the steps before the first.
  const stepsRef = useRef(steps);
  useEffect(() => { stepsRef.current = steps; }, [steps]);
  const applySteps = (fn: (cur: Step[]) => Step[]) => {
    const next = fn(stepsRef.current);
    stepsRef.current = next;
    update((p) => { p.delete('s'); next.forEach((s) => p.append('s', stepToParam(s))); });
  };
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
                  <button type="button" className="rv-btn" onClick={() => downloadCases(myList, 'json', 'bettergov-house-bill-reviews')}>Download all (JSON)</button>
                  <button type="button" className="rv-btn" onClick={() => downloadCases(myList, 'cases', 'bettergov-house-bill-reviews')}>Case rows for the team’s workbook</button>
                  <button type="button" className="rv-btn" onClick={() => downloadCases(myList, 'evidence', 'bettergov-house-bill-reviews')}>Evidence rows for the team’s workbook</button>
                  <button type="button" className="rv-btn" onClick={() => applySteps((cur) => setSingle(cur, 'reviewed', { kind: 'reviewed', value: 'yes' }))}>Show them</button>
                </>
              ) : <p>No reviews yet. Open a project and work through its review checklist.</p>}
            </div>
          </details>
          <Link to={`${HGAB_ROOT}/overview`}>House bill analysis</Link>
        </nav>
      </header>

      {error && <p className="rv-error rv-pad">{error}</p>}
      {!index && !error && <p className="rv-muted rv-pad" role="status">Loading the House bill’s DPWH projects…</p>}
      {index && (
        <>
        <div className="rv-filterbar">
          <FilterBar key={params.getAll('s').filter((x) => x.startsWith('q:')).join()} ix={index} all={all} steps={steps} current={current} ctx={ctx}
            reviewedCount={myList.length} presets={presets} onSteps={(fn) => { applySteps(fn); setPane('list'); }} />
          <FunnelStrip
            levels={levels}
            flags={index.flags}
            offices={index.offices}
            onRemove={(i) => applySteps((cur) => cur.filter((_, j) => j !== i))}
            onFlip={(i) => applySteps((cur) => cur.map((s, j) => (j === i && s.kind === 'flag' ? { ...s, not: !s.not } : s)))}
          />
        </div>
        <div className={`rv-cols show-${pane}`}>
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
              ? <ProjectPane key={selected.hgabId} project={selected} index={index} mine={reviews[selected.hgabId]} profile={profile} onSave={save}
                  inlineViewer={inlineViewer} onPrev={prev} onNext={next} />
              : (
                <div className="rv-welcome">
                  <h2>Pick a project to review</h2>
                  <p>Narrow the list with the filters above. Each one you add is a step in the funnel, with what it keeps.</p>
                  <p>Then open each document and fill in your review. Use <kbd>j</kbd> and <kbd>k</kbd> to move between projects.</p>
                  {listed.length > 0 && <button type="button" className="rv-btn is-primary" onClick={() => open(listed[0])}>Open the first project</button>}
                  <DisclaimerNotice compact className="rv-disclaimer" />
                </div>
              )}
          </section>

          <nav className="rv-panes" aria-label="Panels">
            <button type="button" className={pane === 'list' ? 'is-on' : ''} onClick={() => setPane('list')}>Projects · {n(current.length)}</button>
            <button type="button" className={pane === 'project' ? 'is-on' : ''} onClick={() => setPane('project')} disabled={!selected}>Project</button>
          </nav>
        </div>
        </>
      )}
      {about && index && <About index={index} onClose={() => setAbout(false)} />}
    </div>
  );
}
