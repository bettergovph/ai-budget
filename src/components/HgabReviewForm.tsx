/**
 * The review form in the project reviewer (`/hgab/2027/review`): the team's red-flag checklist (RF-001…RF-044) for one
 * project, with evidence per check and the case details. It edits a `CaseReview` (src/lib/hgab-redflags-team.ts),
 * which the page sends to the team when it is saved (src/worker/hgab-reviews.ts). Shown only to signed-in members.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { type DetailFile, type ReviewDetail, type ReviewIndexFlag } from '../lib/hgab-documents';
import { readerText } from '../lib/hgab-review';
import { memberLabel, useDocLink, useMember } from '../lib/hgab-review-member';
import { downloadCases } from '../lib/hgab-review-export';
import {
  CHECKLIST_GROUP_LABEL, READY_STAGE, REGISTRY, STAGE_GATED, VOLUNTEER_OUTCOMES,
  checklistFor, emptyEvidence, emptyFlagCheck, flagCheckTouched, flagStatus, newId, validateCaseReview, vocab,
  type CaseReview, type CategoryKey, type ChecklistGroup, type ChecklistItem, type EvidenceItem, type FlagCheck,
  type ValidationIssue,
} from '../lib/hgab-redflags-team';

/** What saving did: `review` is what to keep editing (the stored copy when it was sent). */
export interface SaveResult { ok: boolean; review: CaseReview; error?: string; issues?: ValidationIssue[] }

const now = () => new Date().toISOString();
const STATUS_LABEL = { not_started: 'Not started', ai_candidate: '', under_human_review: 'In review', human_outcome: '' } as const;

/**
 * A choice as a row of buttons, one click each, instead of a dropdown. `labels` gives plain words for the workbook's
 * codes (the workbook's own label stays the tooltip and is what exports use). Clicking the chosen one again goes back
 * to `clearTo`, when given.
 */
function Seg({ value, onChange, options, label, labels = {}, clearTo, className = '' }: {
  value: string;
  onChange: (v: string) => void;
  options: readonly { code: string; label: string }[];
  label: string;
  labels?: Readonly<Record<string, string>>;
  clearTo?: string;
  className?: string;
}) {
  return (
    <div className={`rf-seg ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = value === o.code;
        return (
          <button key={o.code} type="button" role="radio" aria-checked={on} className={`${on ? 'is-on' : ''} is-${o.code}`}
            title={labels[o.code] && labels[o.code] !== o.label ? o.label : undefined}
            onClick={() => onChange(on && clearTo != null ? clearTo : o.code)}>
            {labels[o.code] ?? o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Plain words for the outcomes a volunteer gives (the workbook's labels are the tooltips and the export). */
const OUTCOME_WORDS: Readonly<Record<string, string>> = {
  pending_technical_review: 'Needs an expert',
  verified_concern: 'Concern confirmed',
  cleared_explained: 'Cleared',
  unresolved_evidence_gap: 'Evidence missing',
};
const OUTCOME_BUTTONS = VOLUNTEER_OUTCOMES.filter((o) => o.code !== 'not_reviewed');
/** Stages a volunteer sets with one click; "Ready for independent review" is its own button, after validation. */
const STAGE_BUTTONS = vocab('case_stage').filter((o) => ['assigned_for_review', 'evidence_requested', 'on_hold'].includes(o.code));
const STAGE_WORDS: Readonly<Record<string, string>> = { assigned_for_review: 'Working on it', evidence_requested: 'Waiting for evidence', on_hold: 'On hold' };
const PRIORITY_WORDS: Readonly<Record<string, string>> = { not_prioritized: 'None' };

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="rf-field"><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>;
}

/** One piece of evidence: a document (one of the project's files, or any link), where in it, and what it says. */
function EvidenceRow({ e, onChange, onRemove, fromFile }: { e: EvidenceItem; onChange: (e: EvidenceItem) => void; onRemove: () => void; fromFile: boolean }) {
  const set = (patch: Partial<EvidenceItem>) => onChange({ ...e, ...patch });
  // The review keeps the document's address from the data; Senate copies open through the member's grant.
  const href = useDocLink()(e.url);
  return (
    <div className="rf-evidence">
      <div className="rf-evidence-doc">
        {fromFile
          ? (href ? <a href={href} target="_blank" rel="noopener noreferrer">{e.document_title}</a> : <span>{e.document_title}</span>)
          : (
            <>
              <input className="rf-input" placeholder="Document title and version" value={e.document_title} onChange={(x) => set({ document_title: x.target.value })} aria-label="Document title and version" />
              <input className="rf-input" placeholder="https://…" value={e.url} onChange={(x) => set({ url: x.target.value.trim() })} aria-label="Document link" />
            </>
          )}
        <small>{e.source_institution}</small>
        <button type="button" className="rf-x" onClick={onRemove} aria-label="Remove this evidence">×</button>
      </div>
      <Field label="Page, table or cell"><input className="rf-input" value={e.locator} onChange={(x) => set({ locator: x.target.value })} placeholder="p. 3, item 2.1" /></Field>
      <div className="rf-q"><span>Available?</span><Seg className="is-small" label="Document availability" value={e.availability} onChange={(v) => set({ availability: v })} options={vocab('document_availability')} /></div>
      <div className="rf-q"><span>Applies at this stage?</span><Seg className="is-small" label="Applicable at current project stage" value={e.applicable_at_stage} onChange={(v) => set({ applicable_at_stage: v })} options={vocab('evidence_applicable_at_stage')} labels={{ not_assessed: 'Not sure' }} /></div>
      <div className="rf-q"><span>Your check of the extract</span><Seg className="is-small" label="Verification state" value={e.verification_state} onChange={(v) => set({ verification_state: v })} options={vocab('verification_state')} labels={{ not_reviewed: 'Not checked' }} /></div>
      <Field label="What it says" hint="Verbatim text or amount"><textarea className="rf-input" rows={2} value={e.extracted_fact} onChange={(x) => set({ extracted_fact: x.target.value })} /></Field>
      <Field label="Your observation"><textarea className="rf-input" rows={2} value={e.reviewer_observation} onChange={(x) => set({ reviewer_observation: x.target.value })} /></Field>
    </div>
  );
}

/** Add evidence in one click: a button per file of the project, and one for any other document or link. */
function AddEvidence({ files, used, onAdd }: { files: DetailFile[]; used: ReadonlySet<string>; onAdd: (e: EvidenceItem) => void }) {
  const add = (f: DetailFile | null) => {
    const base = emptyEvidence(newId());
    onAdd(f ? {
      ...base, document_title: f[4], url: f[5],
      source_institution: f[0] === 'senate' ? 'Senate copy of DPWH’s documents' : 'DPWH Transparency', availability: 'available',
    } : { ...base, source_institution: '' });
  };
  return (
    <div className="rf-add-evidence" role="group" aria-label="Add evidence">
      <span>Add evidence:</span>
      {files.filter((f) => !used.has(f[5])).map((f) => (
        <button key={f[5]} type="button" onClick={() => add(f)} title={f[4]}>
          + {f[2] === 'Other' ? f[3] || 'Other' : f[2]}{f[7] ? ' (earlier)' : ''}
        </button>
      ))}
      <button type="button" onClick={() => add(null)}>+ Other document or link</button>
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
  // What the chosen outcome still needs (the same rules the API applies).
  const needs = [
    ...(['verified_concern', 'unresolved_evidence_gap'].includes(check.human_outcome) && !check.observed_discrepancy.trim() ? ['say what you found'] : []),
    ...(['verified_concern', 'cleared_explained'].includes(check.human_outcome) && !check.evidence.length ? ['add the evidence'] : []),
    ...(check.human_outcome === 'verified_concern' && ['not_yet_due', 'not_applicable'].includes(check.applicability) ? ['a check that doesn’t apply now can’t be a confirmed concern'] : []),
  ];
  return (
    <li className={`rf-card is-${status} ${open ? 'is-open' : ''}`}>
      <button type="button" className="rf-card-head" onClick={onToggle} aria-expanded={open}>
        <span className="rf-id">{f.id}</span>
        <span className="rf-title">{f.title}</span>
        {status !== 'human_outcome' && STATUS_LABEL[status] && <span className={`rf-status is-${status}`}>{STATUS_LABEL[status]}</span>}
        <span className="rf-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      <div className="rf-outcome">
        <Seg label={`Outcome for ${f.id}`} value={check.human_outcome} options={OUTCOME_BUTTONS} labels={OUTCOME_WORDS} clearTo="not_reviewed"
          onChange={(v) => {
            set({ human_outcome: v });
            // These outcomes need the facts or the evidence behind them: open the check so they can be added.
            if (!open && ['verified_concern', 'cleared_explained', 'unresolved_evidence_gap'].includes(v)) onToggle();
          }} />
      </div>
      {needs.length > 0 && <p className="rf-needs">To keep this outcome: {needs.join('; ')}.</p>}
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
          <h5>Minimum evidence</h5>
          <ul className="rf-chips">{f.minimum_evidence.map((m) => <li key={m}>{m}</li>)}</ul>
          <p className="rf-safeguard"><b>Safeguard.</b> {f.safeguard}{STAGE_GATED[f.id] && <> {STAGE_GATED[f.id]}</>}</p>

          <div className="rf-q">
            <span>Does this check apply to the project now?</span>
            <Seg label="Does this check apply now?" value={check.applicability} onChange={(v) => set({ applicability: v })} options={vocab('evidence_applicability')}
              labels={{ not_assessed: 'Not sure' }} clearTo="not_assessed" />
          </div>
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
            <AddEvidence files={files} used={new Set(check.evidence.map((e) => e.url))} onAdd={(e) => set({ evidence: [...check.evidence, e] })} />
          </div>
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
  /** Whether a save is on its way, and how the last one went. */
  sending: { busy: boolean; result: SaveResult | null };
}

export default function HgabReviewForm({ review, detail, categories, detectorCodes, flags, onChange, onSave, saved, sending }: ReviewFormProps) {
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
  const done = review.flags.filter((f) => f.human_outcome !== 'not_reviewed').length;
  // The member's name comes from their sign-in, not a field; it goes with every save.
  const who = memberLabel(useMember());
  const save = (r: CaseReview) => onSave({ ...r, reviewer: { ...r.reviewer, display_name: who }, updated_at: now() });

  return (
    <form className="rf-form" onSubmit={(e) => { e.preventDefault(); save(review); }}>
      <div className="rf-head">
        <h3 className="rv-h">Review checklist</h3>
        <p className="rv-muted">
          The volunteer team’s red-flag registry ({REGISTRY.source.version}, proposed, pending group review). {done} of {items.length} checks have an outcome.
        </p>
      </div>

      {groups.map(({ g, items: its }) => (
        <section key={g} className="rf-sec">
          {g !== 'suggested' && (
            <h4>
              {CHECKLIST_GROUP_LABEL[g]} <small>{its.length}</small>
              {(g === 'category' || g === 'later') && (
                <button type="button" className="rf-toggle" onClick={() => setShowAll((s) => ({ ...s, [g]: !s[g] }))}>{showAll[g] ? 'Hide' : 'Show'}</button>
              )}
            </h4>
          )}
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
        <p className="rf-who">Reviewing as <b>{who || 'you'}</b>, from your sign-in.</p>
        <div className="rf-q">
          <span>Where is it?</span>
          {review.case_stage === READY_STAGE
            ? <p className="rf-ready">Ready for independent review. <button type="button" className="rf-link" onClick={() => set({ case_stage: 'assigned_for_review' })}>Keep working on it</button></p>
            : <Seg label="Case stage" value={review.case_stage} onChange={(v) => set({ case_stage: v })} options={STAGE_BUTTONS} labels={STAGE_WORDS} clearTo="not_started" />}
        </div>
        <div className="rf-q">
          <span>Suggested priority <small>The team prioritises verified cases.</small></span>
          <Seg label="Suggested priority" value={review.risk_priority} onChange={(v) => set({ risk_priority: v })} options={vocab('risk_priority')} labels={PRIORITY_WORDS} />
        </div>
        <Field label="Notes for the team"><textarea className="rf-input" rows={3} value={review.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="What doesn’t match, what to request next…" /></Field>
      </section>

      {(tried || review.case_stage === READY_STAGE) && issues.length > 0 && (
        <ul className="rf-issues" aria-live="polite">
          {issues.map((i) => <li key={i.path + i.message} className={`is-${i.level}`}>{i.path}: {i.message}</li>)}
        </ul>
      )}
      {sending.result && !sending.result.ok && (
        <div className="rf-issues is-send" role="alert">
          <p>Couldn’t save it: {sending.result.error} Your changes are still here; save again to retry.</p>
          {!!sending.result.issues?.length && <ul>{sending.result.issues.map((i) => <li key={i.path + i.message}>{i.path}: {i.message}</li>)}</ul>}
        </div>
      )}
      <div className="rf-actions">
        <button type="submit" className="rv-btn" disabled={saved || sending.busy}>{sending.busy ? 'Saving…' : saved ? 'Saved' : 'Save draft'}</button>
        <button type="button" className="rv-btn is-primary" disabled={sending.busy} onClick={() => {
          setTried(true);
          if (!errors.length) save({ ...review, case_stage: READY_STAGE });
        }} title="Checks the review, then marks it ready for a second reviewer">Ready for independent review</button>
        <span className="rf-export">
          Download:{' '}
          <button type="button" onClick={() => downloadCases([review], 'json', `review-${review.project.hgab_id}`)}>JSON</button>
          {' · '}<button type="button" onClick={() => downloadCases([review], 'cases', `review-${review.project.hgab_id}`)}>case rows</button>
          {' · '}<button type="button" onClick={() => downloadCases([review], 'evidence', `review-${review.project.hgab_id}`)}>evidence rows</button>
        </span>
      </div>
      <p className="rv-hint">Saving sends your review to the team and shows the project as taken. You can keep editing it; clear it to withdraw it.</p>
    </form>
  );
}
