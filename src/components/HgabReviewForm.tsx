/**
 * The review form in the project reviewer (`/hgab/2027/review`): the team's red-flag checklist (RF-001…RF-044) for one
 * project, with the documents on file, evidence per check and the case details. It edits a `CaseReview`
 * (src/lib/hgab-redflags-team.ts), the payload a future API will accept; for now the page keeps it in the browser.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { NAMED_TYPES, type DetailFile, type ReviewDetail, type ReviewIndexFlag } from '../lib/hgab-documents';
import { readerText } from '../lib/hgab-review';
import { downloadCases } from '../lib/hgab-review-export';
import {
  CHECKLIST_GROUP_LABEL, MAPPING_STATUS, READY_STAGE, REGISTRY, STAGE_GATED, VOLUNTEER_OUTCOMES, VOLUNTEER_STAGES,
  checklistFor, emptyEvidence, emptyFlagCheck, flagCheckTouched, flagStatus, validateCaseReview, vocab,
  vocabLabel, type CaseReview, type CategoryKey, type ChecklistGroup, type ChecklistItem, type EvidenceItem, type FlagCheck,
} from '../lib/hgab-redflags-team';

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const now = () => new Date().toISOString();
const STATUS_LABEL = { not_started: 'Not started', ai_candidate: 'AI candidate', under_human_review: 'In review', human_outcome: '' } as const;

function Select({ value, onChange, options, label, className = '' }: {
  value: string; onChange: (v: string) => void; options: { code: string; label: string }[]; label: string; className?: string;
}) {
  return (
    <select className={`rf-select ${className}`} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
    </select>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="rf-field"><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>;
}

/** One piece of evidence: a document (one of the project's files, or any link), where in it, and what it says. */
function EvidenceRow({ e, onChange, onRemove, fromFile }: { e: EvidenceItem; onChange: (e: EvidenceItem) => void; onRemove: () => void; fromFile: boolean }) {
  const set = (patch: Partial<EvidenceItem>) => onChange({ ...e, ...patch });
  return (
    <div className="rf-evidence">
      <div className="rf-evidence-doc">
        {fromFile
          ? <a href={e.url} target="_blank" rel="noopener noreferrer">{e.document_title}</a>
          : (
            <>
              <input className="rf-input" placeholder="Document title and version" value={e.document_title} onChange={(x) => set({ document_title: x.target.value })} aria-label="Document title and version" />
              <input className="rf-input" placeholder="https://…" value={e.url} onChange={(x) => set({ url: x.target.value.trim() })} aria-label="Document link" />
            </>
          )}
        <small>{e.source_institution}</small>
        <button type="button" className="rf-x" onClick={onRemove} aria-label="Remove this evidence">×</button>
      </div>
      <div className="rf-grid">
        <Field label="Page, table or cell"><input className="rf-input" value={e.locator} onChange={(x) => set({ locator: x.target.value })} placeholder="p. 3, item 2.1" /></Field>
        <Field label="Available?"><Select label="Document availability" value={e.availability} onChange={(v) => set({ availability: v })} options={vocab('document_availability')} /></Field>
        <Field label="Applies at this stage?"><Select label="Applicable at current project stage" value={e.applicable_at_stage} onChange={(v) => set({ applicable_at_stage: v })} options={vocab('evidence_applicable_at_stage')} /></Field>
        <Field label="Your check of the extract"><Select label="Verification state" value={e.verification_state} onChange={(v) => set({ verification_state: v })} options={vocab('verification_state')} /></Field>
      </div>
      <Field label="What it says" hint="Verbatim text or amount"><textarea className="rf-input" rows={2} value={e.extracted_fact} onChange={(x) => set({ extracted_fact: x.target.value })} /></Field>
      <Field label="Your observation"><textarea className="rf-input" rows={2} value={e.reviewer_observation} onChange={(x) => set({ reviewer_observation: x.target.value })} /></Field>
    </div>
  );
}

function AddEvidence({ files, onAdd }: { files: DetailFile[]; onAdd: (e: EvidenceItem) => void }) {
  const [pick, setPick] = useState('');
  return (
    <div className="rf-add-evidence">
      <select className="rf-select" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Pick a document">
        <option value="">Add evidence from…</option>
        {files.map((f) => <option key={f[5]} value={f[5]}>{f[2] === 'Other' ? f[3] || 'Other' : f[2]} · {f[4]}{f[7] ? ' (earlier copy)' : ''}</option>)}
        <option value="other">Another document or link</option>
      </select>
      <button type="button" className="rv-btn" disabled={!pick} onClick={() => {
        const f = files.find((x) => x[5] === pick);
        const base = emptyEvidence(newId());
        onAdd(f ? {
          ...base, document_title: f[4], url: f[5],
          source_institution: f[0] === 'senate' ? 'Senate copy of DPWH’s documents' : 'DPWH Transparency', availability: 'available',
        } : { ...base, source_institution: '' });
        setPick('');
      }}>Add</button>
    </div>
  );
}

function CheckCard({ item, check, onChange, files, detectorLabel, open, onToggle }: {
  item: ChecklistItem;
  check: FlagCheck;
  onChange: (c: FlagCheck) => void;
  files: DetailFile[];
  detectorLabel: (code: string) => string;
  open: boolean;
  onToggle: () => void;
}) {
  const f = item.flag;
  const status = flagStatus(check);
  const set = (patch: Partial<FlagCheck>) => onChange({ ...check, ...patch, updated_at: now() });
  return (
    <li className={`rf-card is-${status} ${open ? 'is-open' : ''}`}>
      <button type="button" className="rf-card-head" onClick={onToggle} aria-expanded={open}>
        <span className="rf-id">{f.id}</span>
        <span className="rf-title">{f.title}</span>
        <span className={`rf-status is-${status === 'human_outcome' ? check.human_outcome : status}`}>
          {status === 'human_outcome' ? vocabLabel('human_outcome', check.human_outcome) : STATUS_LABEL[status]}
        </span>
      </button>
      {(item.detectors.length > 0 || item.documents.length > 0) && (
        <p className="rf-why">
          {item.detectors.length > 0 && <>Red flags here: {item.detectors.map(detectorLabel).join(' · ')}</>}
          {item.detectors.length > 0 && item.documents.length > 0 && <br />}
          {item.documents.length > 0 && <>On file: {item.documents.join(' · ')}</>}
        </p>
      )}
      {open && (
        <div className="rf-body">
          <p className="rf-lead">Lead: <b>{f.lead_skill}</b>{f.support_skills.length > 0 && <> · with {f.support_skills.join(', ')}</>}</p>
          <h5>What to check</h5>
          <p>{f.instructions}</p>
          {(f.investigate || f.continuation) && (
            <details className="rf-more"><summary>The team’s notes</summary>
              {[f.investigate, f.continuation].filter(Boolean).map((t) => <p key={t}>{t}</p>)}
            </details>
          )}
          <h5>Minimum evidence</h5>
          <ul className="rf-chips">{f.minimum_evidence.map((m) => <li key={m}>{m}</li>)}</ul>
          <p className="rf-safeguard"><b>Safeguard.</b> {f.safeguard}{STAGE_GATED[f.id] && <> {STAGE_GATED[f.id]}</>}</p>

          <Field label="Does this check apply to the project now?">
            <div className="rf-seg" role="radiogroup">
              {vocab('evidence_applicability').map((o) => (
                <label key={o.code} className={check.applicability === o.code ? 'is-on' : ''}>
                  <input type="radio" name={`app-${f.id}`} checked={check.applicability === o.code} onChange={() => set({ applicability: o.code })} /> {o.label}
                </label>
              ))}
            </div>
          </Field>
          <Field label="What you found" hint="Facts only: what the documents say, not conclusions">
            <textarea className="rf-input" rows={3} value={check.observed_discrepancy} onChange={(e) => set({ observed_discrepancy: e.target.value })} />
          </Field>
          <div className="rf-evidence-list">
            <h5>Evidence <small>{check.evidence.length}</small></h5>
            {check.evidence.map((e, i) => (
              <EvidenceRow key={e.evidence_id} e={e} fromFile={files.some((x) => x[5] === e.url)}
                onChange={(x) => set({ evidence: check.evidence.map((y, j) => (j === i ? x : y)) })}
                onRemove={() => set({ evidence: check.evidence.filter((_, j) => j !== i) })} />
            ))}
            <AddEvidence files={files} onAdd={(e) => set({ evidence: [...check.evidence, e] })} />
          </div>
          <Field label="Outcome" hint="The review committee, not a volunteer, refers a case">
            <Select label={`Outcome for ${f.id}`} value={check.human_outcome} onChange={(v) => set({ human_outcome: v })} options={VOLUNTEER_OUTCOMES} />
          </Field>
        </div>
      )}
    </li>
  );
}

export interface ReviewFormProps {
  review: CaseReview;
  detail: ReviewDetail;
  categories: CategoryKey[];
  detectorCodes: string[];
  flags: readonly ReviewIndexFlag[];
  onChange: (r: CaseReview) => void;
  onSave: (r: CaseReview) => void;
  saved: boolean;
}

export default function HgabReviewForm({ review, detail, categories, detectorCodes, flags, onChange, onSave, saved }: ReviewFormProps) {
  const files = detail.files;
  const items = useMemo(() => checklistFor({
    categories,
    detectorCodes,
    documentTypes: [...new Set(files.flatMap((f) => [f[2], f[3]]).filter((t) => t && t !== 'Other'))],
  }), [categories, detectorCodes, files]);
  const [open, setOpen] = useState<string | null>(() => items[0]?.flag.id ?? null);
  const [showAll, setShowAll] = useState<Record<ChecklistGroup, boolean>>({ suggested: true, documents: true, category: false, later: false });
  const detectorLabel = (code: string) => readerText(flags.find((f) => f.code === code)?.label ?? code);
  const checkFor = (it: ChecklistItem): FlagCheck =>
    review.flags.find((c) => c.flag_id === it.flag.id) ?? emptyFlagCheck(it.flag.id, it.detectors, review.updated_at);
  const setCheck = (c: FlagCheck) => {
    const rest = review.flags.filter((x) => x.flag_id !== c.flag_id);
    onChange({ ...review, flags: flagCheckTouched(c) ? [...rest, c] : rest, updated_at: now() });
  };
  const set = (patch: Partial<CaseReview>) => onChange({ ...review, ...patch, updated_at: now() });
  const issues = validateCaseReview(review);
  const errors = issues.filter((i) => i.level === 'error');
  const [tried, setTried] = useState(false);
  const groups = (['suggested', 'documents', 'category', 'later'] as ChecklistGroup[]).map((g) => ({ g, items: items.filter((x) => x.group === g) })).filter((x) => x.items.length);
  const filesOf = (t: string) => files.filter((f) => f[2] === t);
  const done = review.flags.filter((f) => f.human_outcome !== 'not_reviewed').length;

  return (
    <form className="rf-form" onSubmit={(e) => { e.preventDefault(); onSave({ ...review, updated_at: now() }); }}>
      <div className="rf-head">
        <h3 className="rv-h">Review checklist</h3>
        <p className="rv-muted">
          The volunteer team’s red-flag registry ({REGISTRY.source.version}, proposed, pending group review). {done} of {items.length} checks have an outcome.
        </p>
      </div>

      <section className="rf-sec">
        <h4>Documents on file <small>RF-033 Incomplete documents</small></h4>
        <table className="rf-docs">
          <thead><tr><th scope="col">Document</th><th scope="col">Available?</th><th scope="col">For this project?</th></tr></thead>
          <tbody>
            {NAMED_TYPES.map((t) => {
              const d = review.documents.find((x) => x.named_type === t)!;
              const setDoc = (patch: Partial<typeof d>) => set({ documents: review.documents.map((x) => (x.named_type === t ? { ...x, ...patch } : x)) });
              const n = filesOf(t).length;
              return (
                <tr key={t}>
                  <th scope="row">{t}<small>{n ? `${n} ${n === 1 ? 'file' : 'files'}` : 'no file found'}</small></th>
                  <td><Select label={`${t}: availability`} value={d.availability} onChange={(v) => setDoc({ availability: v })} options={vocab('document_availability')} /></td>
                  <td>
                    <Select label={`${t}: is it for this project?`} value={d.matches_project} onChange={(v) => setDoc({ matches_project: v as typeof d.matches_project })}
                      options={[{ code: 'unknown', label: 'Not checked' }, { code: 'yes', label: 'Yes' }, { code: 'no', label: 'No, another project' }]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="rv-hint">“Not yet due” and “Not required” are not defects: some documents come later in the budget cycle.</p>
      </section>

      {groups.map(({ g, items: its }) => (
        <section key={g} className="rf-sec">
          <h4>
            {CHECKLIST_GROUP_LABEL[g]} <small>{its.length}</small>
            {(g === 'category' || g === 'later') && (
              <button type="button" className="rf-toggle" onClick={() => setShowAll((s) => ({ ...s, [g]: !s[g] }))}>{showAll[g] ? 'Hide' : 'Show'}</button>
            )}
          </h4>
          {g === 'suggested' && <p className="rv-hint">A red flag makes these AI candidates, not findings. {MAPPING_STATUS}.</p>}
          {showAll[g] && (
            <ul className="rf-cards">
              {its.map((it) => (
                <CheckCard key={it.flag.id} item={it} check={checkFor(it)} onChange={setCheck} files={files} detectorLabel={detectorLabel}
                  open={open === it.flag.id} onToggle={() => setOpen((o) => (o === it.flag.id ? null : it.flag.id))} />
              ))}
            </ul>
          )}
        </section>
      ))}

      <section className="rf-sec">
        <h4>The case</h4>
        <div className="rf-grid">
          <Field label="Your name or handle" hint="Optional; shown to the team">
            <input className="rf-input" value={review.reviewer.display_name} onChange={(e) => set({ reviewer: { ...review.reviewer, display_name: e.target.value } })} />
          </Field>
          <Field label="Your role">
            <Select label="Your role" value={review.reviewer.task_id} onChange={(v) => set({ reviewer: { ...review.reviewer, task_id: v } })}
              options={[{ code: '', label: 'Volunteer (no role)' }, ...REGISTRY.tasks.filter((t) => t.step === 4 || t.step === 3).map((t) => ({ code: t.id, label: `${t.role} (${t.id})` }))]} />
          </Field>
          <Field label="Case stage">
            <Select label="Case stage" value={review.case_stage} onChange={(v) => set({ case_stage: v })}
              options={review.case_stage === READY_STAGE ? [...VOLUNTEER_STAGES, { code: READY_STAGE, label: vocabLabel('case_stage', READY_STAGE) }] : VOLUNTEER_STAGES} />
          </Field>
          <Field label="Suggested priority" hint="A suggestion; the team prioritises verified cases">
            <Select label="Suggested priority" value={review.risk_priority} onChange={(v) => set({ risk_priority: v })} options={vocab('risk_priority')} />
          </Field>
        </div>
        <Field label="Next action"><input className="rf-input" value={review.next_action} onChange={(e) => set({ next_action: e.target.value })} placeholder="Request the POW’s DUPA; check 2024 GAA for the same site" /></Field>
        <Field label="Notes"><textarea className="rf-input" rows={3} value={review.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </section>

      {(tried || review.case_stage === READY_STAGE) && issues.length > 0 && (
        <ul className="rf-issues" aria-live="polite">
          {issues.map((i) => <li key={i.path + i.message} className={`is-${i.level}`}>{i.path}: {i.message}</li>)}
        </ul>
      )}
      <div className="rf-actions">
        <button type="submit" className="rv-btn" disabled={saved}>{saved ? 'Saved' : 'Save draft'}</button>
        <button type="button" className="rv-btn is-primary" onClick={() => {
          setTried(true);
          if (!errors.length) onSave({ ...review, case_stage: READY_STAGE, updated_at: now() });
        }} title="Checks the review, then marks it ready for a second reviewer">Ready for independent review</button>
        <span className="rf-export">
          Download:{' '}
          <button type="button" onClick={() => downloadCases([review], 'json', `review-${review.project.hgab_id}`)}>JSON</button>
          {' · '}<button type="button" onClick={() => downloadCases([review], 'cases', `review-${review.project.hgab_id}`)}>case rows</button>
          {' · '}<button type="button" onClick={() => downloadCases([review], 'evidence', `review-${review.project.hgab_id}`)}>evidence rows</button>
        </span>
      </div>
      <p className="rv-hint">Saved in this browser until reviews can be sent. The case and evidence rows paste into the team’s workbook.</p>
    </form>
  );
}
