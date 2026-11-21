/**
 * The project reviewer's filter bar (`/hgab/2027/review`), shared with the Senate committee report's DPWH projects
 * (`/senate/2027/dpwh?view=projects`): "Start from" presets, red flags, the team's questions, documents, review status,
 * region, DPWH office, budget and a search, each a funnel step (src/lib/hgab-review.ts). Moved here unchanged from
 * HgabReview.tsx; `extra` adds a page's own filters before the search.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FlagFamily, ReviewIndex } from '../lib/hgab-documents';
import {
  DOCS_FILTERS, DOCS_FILTER_LABEL, FAMILY_LABEL, FAMILY_ORDER, LIST_STATUSES, LIST_STATUS_LABEL, NOT_REVIEWED_STATUSES, PRESETS,
  SOURCE_GROUPS, SOURCE_GROUP_LABEL, SOURCE_GROUP_NOTE, checkedValues, countBy, flagYields, foldText, isReviewed, pesoShort,
  projectsWithout, readerText, setSingle, setValues, stepTest, toggleFlag,
  type ListStatus, type MultiKind, type ReviewProject, type Step, type StepContext,
} from '../lib/hgab-review';
import { MAPPING_STATUS, QUESTIONS, REGISTRY } from '../lib/hgab-redflags-team';
import '../hgab-review.css';

const n = (v: number) => v.toLocaleString('en-US');
const shortOffice = (name: string) => name.replace(/\bDistrict Engineering Office\b/i, 'DEO');


/** A filter button in the bar that opens a panel of checkboxes; closes on Escape or a click outside. */
export function Dropdown({ label, count, active, wide, children }: { label: string; count?: number; active?: boolean; wide?: boolean; children: ReactNode }) {
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
export function Check({ checked, onChange, label, note, k, max, disabled }: {
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
export function PanelFoot({ children }: { children: ReactNode }) { return <div className="rv-dd-foot">{children}</div>; }

/** The volunteer team's questions (BW-01…): projects whose red flags suggest each one. Rendered only while open. */
function TeamPanel({ all, steps, ctx, onSteps }: { all: ReviewProject[]; steps: Step[]; ctx: StepContext; onSteps: (fn: (cur: Step[]) => Step[]) => void }) {
  const [q, setQ] = useState('');
  const base = useMemo(() => projectsWithout(all, steps, 'team', ctx), [all, steps, ctx]);
  const checked = checkedValues(steps, 'team');
  const rows = useMemo(() => QUESTIONS.map((f) => {
    const idx = new Set(ctx.teamIndex?.get(f.id) ?? []);
    return { f, k: idx.size ? base.filter((p) => p.flags.some((i) => idx.has(i))).length : 0, detectors: idx.size };
  }), [base, ctx.teamIndex]);
  const toggle = (id: string) => onSteps((cur) => {
    const c = checkedValues(cur, 'team');
    return setValues(cur, 'team', c.includes(id) ? c.filter((x) => x !== id) : [...c, id]);
  });
  const shown = rows.filter(({ f }) => !q || foldText(`${f.id} ${f.title} ${f.family} ${f.lead} ${f.flag_ids.join(' ')}`).includes(foldText(q)));
  return (
    <>
      <PanelFilter value={q} onChange={setQ} placeholder="Find a question, check (RF-…) or specialist" />
      <p className="rv-dd-note">The volunteer team’s {QUESTIONS.length} questions (their proposal, {REGISTRY.questions_source.status.toLowerCase()}). A project shows under a question when its red flags suggest it. {MAPPING_STATUS}.</p>
      <div className="rv-dd-cols">
        {[true, false].map((auto) => (
          <div key={String(auto)} className="rv-dd-group">
            <h3>{auto ? 'Suggested by red flags' : 'No red flag points here yet: check by hand'}</h3>
            {shown.filter((r) => (r.detectors > 0) === auto).map(({ f, k }) => (
              <Check key={f.id} checked={checked.includes(f.id)} onChange={() => toggle(f.id)} k={k} max={Math.max(1, base.length)} disabled={!auto}
                label={<><b className="rv-rf">{f.id}</b> {f.title}</>} note={`${f.lead} · ${f.flag_ids.join(', ')}`} />
            ))}
          </div>
        ))}
      </div>
      <PanelFoot>
        <span>Projects suggested for any checked question.</span>
        {checked.length > 0 && <button type="button" onClick={() => onSteps((cur) => setValues(cur, 'team', []))}>Clear</button>}
      </PanelFoot>
    </>
  );
}

export function FilterBar({ ix, all, steps, current, ctx, presets, shared, onSteps, extra }: {
  ix: ReviewIndex;
  /** A page's own filters, shown before the search (the Senate projects' Senate status). */
  extra?: ReactNode;
  /** Whether review status comes from every member's reviews, not just this browser's. */
  shared: boolean;
  all: ReviewProject[];
  steps: Step[];
  current: ReviewProject[];
  ctx: StepContext;
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
              note={f.computed ? `With the documents we matched; research.bettergov.ph counts ${n(f.n_upstream ?? 0)}` : f.source === 'bettergov' ? `Ours. ${f.note ?? ''}` : undefined} />
          );
        })}
      </div>
    );
  });
  const flagCount = steps.filter((s) => s.kind === 'flag' && !ix.flags[ctx.flagIndex.get(s.code) ?? -1]?.computed).length;
  const docsCount = steps.filter((s) => (s.kind === 'flag' && ix.flags[ctx.flagIndex.get(s.code) ?? -1]?.computed) || s.kind === 'docs' || s.kind === 'source').length;

  const docs = multi('docs', () => '');
  const source = multi('source', (p) => p.source);
  const docsBase = projectsWithout(all, steps, 'docs', ctx);
  const region = multi('region', (p) => p.region);
  const office = multi('office', (p) => p.office.name);
  const program = multi('program', (p) => p.program);
  const minStep = steps.find((s) => s.kind === 'min');
  const minBase = projectsWithout(all, steps, 'min', ctx);
  const status = multi('status', (p) => ctx.statusOf(p.hgabId));
  // "Hide reviewed" is the status step with exactly the not-yet-reviewed statuses.
  const hideOn = status.checked.length === NOT_REVIEWED_STATUSES.length && NOT_REVIEWED_STATUSES.every((v) => status.checked.includes(v));
  const hiddenCount = [...status.counts].filter(([k]) => isReviewed(k as ListStatus)).reduce((a, [, v]) => a + v, 0);

  return (
    <div className="rv-filters" role="toolbar" aria-label="Filters">
      <span className="rv-filters-label" aria-hidden="true">Filter</span>
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

      <Dropdown label="Questions" count={checkedValues(steps, 'team').length} active={checkedValues(steps, 'team').length > 0} wide>
        <TeamPanel all={all} steps={steps} ctx={ctx} onSteps={onSteps} />
      </Dropdown>

      <Dropdown label="Documents" count={docsCount} active={docsCount > 0} wide>
        <div className="rv-dd-cols">
          <div className="rv-dd-group">
            <h3>Where the documents come from</h3>
            {SOURCE_GROUPS.map((v) => (
              <Check key={v} checked={source.checked.includes(v)} onChange={() => toggleValue('source', v)} label={SOURCE_GROUP_LABEL[v]} note={SOURCE_GROUP_NOTE[v]}
                k={source.counts.get(v) ?? 0} max={source.base} />
            ))}
            <h3>How many of the 5 key documents</h3>
            {DOCS_FILTERS.map((v) => {
              const k = docsBase.filter(stepTest({ kind: 'docs', values: [v] }, ctx)).length;
              return <Check key={v} checked={docs.checked.includes(v)} onChange={() => toggleValue('docs', v)} label={DOCS_FILTER_LABEL[v]} k={k} max={Math.max(1, docsBase.length)} />;
            })}

          </div>
          <div className="rv-dd-group">
            <h3>Missing, after our matching</h3>
            <label className="rv-exclude"><input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} /> Leave out projects missing it</label>
            {flagChecks(['documents'], true)}
          </div>
        </div>
      </Dropdown>

      <button type="button" className={`rv-hide ${hideOn ? 'is-on' : ''}`} aria-pressed={hideOn}
        title="Leave out auto-reviewed red flags and reviews that are done or with a verifier"
        onClick={() => onSteps((cur) => setValues(cur, 'status', hideOn ? [] : [...NOT_REVIEWED_STATUSES]))}>
        <span aria-hidden="true">{hideOn ? '✓' : ''}</span> Hide reviewed{hiddenCount > 0 && <small>{n(hiddenCount)}</small>}
      </button>

      <Dropdown label="Review status" count={status.checked.length} active={status.checked.length > 0}>
        {LIST_STATUSES.map((v) => (
          <Check key={v} checked={status.checked.includes(v)} onChange={() => toggleValue('status', v)}
            label={<span className={`rv-status-dot is-${v}`}>{LIST_STATUS_LABEL[v]}</span>}
            note={v === 'auto_red_flag' ? 'No key document and no file: marked without a review' : isReviewed(v) ? 'Counts as reviewed' : undefined}
            k={status.counts.get(v) ?? 0} max={status.base} />
        ))}
        <PanelFoot>
          <span>{shared ? 'From every member’s reviews and the automatic review.' : 'Reviewing isn’t open yet; the automatic review shows.'}</span>
          {status.checked.length > 0 && <button type="button" onClick={() => onSteps((cur) => setValues(cur, 'status', []))}>Clear</button>}
        </PanelFoot>
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

      {extra}

      <form className="rv-filter-search" onSubmit={(e) => { e.preventDefault(); onSteps((cur) => setSingle(cur, 'q', q.trim() ? { kind: 'q', value: q.trim() } : null)); }}>
        <input className="rv-input" type="search" placeholder="Search title, office, district" value={q}
          onChange={(e) => { setQ(e.target.value); if (!e.target.value && qStep) onSteps((cur) => setSingle(cur, 'q', null)); }} aria-label="Search projects (press Enter)" />
      </form>

      {steps.length > 0 && <button type="button" className="rv-clear" onClick={() => { setQ(''); onSteps(() => []); }}>Clear all</button>}
    </div>
  );
}
