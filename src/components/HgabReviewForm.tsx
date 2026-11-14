/**
 * The review form in the project reviewer (`/hgab/2027/review`): first the final status (satisfactory, or
 * unsatisfactory = red flag), the one field the team reports; then the team's red-flag checklist (RF-001…RF-044):
 * per check, an outcome, the documents picked as evidence (details optional) and what you found. It edits a `CaseReview` (src/lib/hgab-redflags-team.ts), which the page sends to the
 * team when it is saved (src/worker/hgab-reviews.ts). Shown only to signed-in members.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { type DetailFile, type ReviewDetail, type ReviewIndexFlag } from '../lib/hgab-documents';
import { readerText } from '../lib/hgab-review';
import { memberLabel, useDocLink, useMember } from '../lib/hgab-review-member';
import { downloadCases } from '../lib/hgab-review-export';
import {
  CHECKLIST_GROUP_LABEL, STAGE_GATED, VERDICT_LABEL, VOLUNTEER_OUTCOMES,
  checklistFor, emptyEvidence, emptyFlagCheck, flagCheckTouched, flagStatus, newId, vocab,
  type CaseReview, type CategoryKey, type ChecklistGroup, type ChecklistItem, type EvidenceItem, type FlagCheck,
  type ValidationIssue, type Verdict,
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

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="rf-field"><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>;
}

/** A file's short name for the evidence picker: its kind, an earlier copy, and where it came from. */
const fileChip = (f: DetailFile) => `${f[2] === 'Other' ? f[3] || 'Other' : f[2]}${f[7] ? ' (earlier)' : ''} · ${f[0] === 'senate' ? 'Senate' : 'DPWH'}`;

/**
 * The optional details of one piece of evidence (where in the document, what it says, the three workbook questions),
 * folded away: picking the document is enough. A link of the volunteer's own needs its title or address.
 */
function EvidenceRow({ e, onChange, onRemove, fromFile }: { e: EvidenceItem; onChange: (e: EvidenceItem) => void; onRemove: () => void; fromFile: boolean }) {
  const set = (patch: Partial<EvidenceItem>) => onChange({ ...e, ...patch });
  // The review keeps the document's address from the data; Senate copies open through the member's grant.
  const href = useDocLink()(e.url);
  return (
    <li className="rf-evidence">
      <div className="rf-evidence-doc">
        {fromFile
          ? (href ? <a href={href} target="_blank" rel="noopener noreferrer">{e.document_title}</a> : <span>{e.document_title}</span>)
          : (
            <>
              <input className="rf-input" placeholder="Document title" value={e.document_title} onChange={(x) => set({ document_title: x.target.value })} aria-label="Document title" />
              <input className="rf-input" placeholder="https://…" value={e.url} onChange={(x) => set({ url: x.target.value.trim() })} aria-label="Document link" />
            </>
          )}
        <button type="button" className="rf-x" onClick={onRemove} aria-label={`Remove ${e.document_title || 'this evidence'}`}>×</button>
      </div>
      <details className="rf-evidence-more">
        <summary>Details <small>optional</small></summary>
        <Field label="Page, table or cell"><input className="rf-input" value={e.locator} onChange={(x) => set({ locator: x.target.value })} placeholder="p. 3, item 2.1" /></Field>
        <Field label="What it says" hint="Verbatim text or amount"><textarea className="rf-input" rows={2} value={e.extracted_fact} onChange={(x) => set({ extracted_fact: x.target.value })} /></Field>
        <Field label="Your observation"><textarea className="rf-input" rows={2} value={e.reviewer_observation} onChange={(x) => set({ reviewer_observation: x.target.value })} /></Field>
        <div className="rf-q"><span>Available?</span><Seg className="is-small" label="Document availability" value={e.availability} onChange={(v) => set({ availability: v })} options={vocab('document_availability')} /></div>
        <div className="rf-q"><span>Applies at this stage?</span><Seg className="is-small" label="Applicable at current project stage" value={e.applicable_at_stage} onChange={(v) => set({ applicable_at_stage: v })} options={vocab('evidence_applicable_at_stage')} labels={{ not_assessed: 'Not sure' }} /></div>
        <div className="rf-q"><span>Your check of the extract</span><Seg className="is-small" label="Verification state" value={e.verification_state} onChange={(v) => set({ verification_state: v })} options={vocab('verification_state')} labels={{ not_reviewed: 'Not checked' }} /></div>
      </details>
    </li>
  );
}

/**
 * Evidence is picked, not filled in: a toggle per file of the project (pressed = it's evidence for this check), and
 * "Other link" for any other document. Each picked one can take optional details.
 */
function EvidencePicker({ id, files, evidence, onChange }: { id: string; files: DetailFile[]; evidence: EvidenceItem[]; onChange: (ev: EvidenceItem[]) => void }) {
  const picked = new Set(evidence.map((e) => e.url));
  const toggle = (f: DetailFile) => onChange(picked.has(f[5])
    ? evidence.filter((e) => e.url !== f[5])
    : [...evidence, {
      ...emptyEvidence(newId()), document_title: f[4], url: f[5], availability: 'available',
      source_institution: f[0] === 'senate' ? 'Senate copy of DPWH’s documents' : 'DPWH Transparency',
    }]);
  return (
    <div className="rf-evidence-list">
      <h5 id={`rf-ev-${id}`}>Evidence <small>{evidence.length ? `${evidence.length} picked` : 'pick the documents that show it'}</small></h5>
      <div className="rf-ev-chips" role="group" aria-labelledby={`rf-ev-${id}`}>
        {files.map((f) => (
          <button key={f[5]} type="button" className={`rf-ev-chip ${picked.has(f[5]) ? 'is-on' : ''}`} aria-pressed={picked.has(f[5])} title={f[4]} onClick={() => toggle(f)}>
            {picked.has(f[5]) && <span aria-hidden="true">✓ </span>}{fileChip(f)}
          </button>
        ))}
        <button type="button" className="rf-ev-chip is-add" onClick={() => onChange([...evidence, { ...emptyEvidence(newId()), source_institution: '' }])}>+ Other link</button>
      </div>
      {evidence.length > 0 && (
        <ul className="rf-ev-picked" aria-label="Picked evidence">
          {evidence.map((e, i) => (
            <EvidenceRow key={e.evidence_id} e={e} fromFile={files.some((x) => x[5] === e.url)}
              onChange={(x) => onChange(evidence.map((y, j) => (j === i ? x : y)))}
              onRemove={() => onChange(evidence.filter((_, j) => j !== i))} />
          ))}
        </ul>
      )}
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
          <EvidencePicker id={f.id} files={files} evidence={check.evidence} onChange={(evidence) => set({ evidence })} />
          <Field label="What you found" hint="For this check, from the evidence: facts only, not conclusions">
            <textarea className="rf-input" rows={3} value={check.observed_discrepancy} onChange={(e) => set({ observed_discrepancy: e.target.value })} />
          </Field>
        </div>
      )}
    </li>
  );
}

const FINAL: readonly { v: Verdict; icon: string; hint: string }[] = [
  { v: 'satisfactory', icon: '✓', hint: 'The documents support the project.' },
  { v: 'unsatisfactory', icon: '⚑', hint: 'Red flag: something is missing, wrong or doesn’t add up.' },
];

/**
 * The final status: two buttons that each save the review at once, and a line saying what was saved (read out by
 * screen readers). Toggle buttons rather than radios, so moving between them with the keyboard never saves. Each is
 * named by its label; its hint is the description screen readers give, and the tooltip.
 */
function FinalStatus({ value, saved, busy, onPick }: { value: Verdict | null; saved: boolean; busy: boolean; onPick: (v: Verdict | null) => void }) {
  return (
    <section className="rf-final" aria-labelledby="rf-final-h">
      <div className="rf-final-top">
        <h3 id="rf-final-h" className="rf-final-h">Final status</h3>
        <p className="rf-final-state" role="status" aria-live="polite">
          {busy ? 'Saving…' : !value ? 'Not given yet' : saved ? <>Saved</> : <>Not saved yet</>}
          {value && !busy && <> · <button type="button" className="rf-link" onClick={() => onPick(null)}>Clear</button></>}
        </p>
      </div>
      <div className="rf-final-opts" role="group" aria-labelledby="rf-final-h">
        {FINAL.map((o) => {
          const on = value === o.v;
          return (
            <button key={o.v} type="button" className={`rf-final-btn is-${o.v} ${on ? 'is-on' : ''}`} aria-pressed={on} disabled={busy} title={o.hint}
              aria-labelledby={`rf-final-${o.v}-l`} aria-describedby={`rf-final-${o.v}-d`} onClick={() => { if (!on) onPick(o.v); }}>
              <span className="rf-final-icon" aria-hidden="true">{o.icon}</span>
              <span className="rf-final-label" id={`rf-final-${o.v}-l`}>{VERDICT_LABEL[o.v]}</span>
              <span className="visually-hidden" id={`rf-final-${o.v}-d`}>{o.hint}</span>
            </button>
          );
        })}
      </div>
    </section>
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
  const groups = (['suggested', 'documents', 'category', 'later'] as ChecklistGroup[]).map((g) => ({ g, items: items.filter((x) => x.group === g) })).filter((x) => x.items.length);
  // The member's name comes from their sign-in, not a field; it goes with every save.
  const who = memberLabel(useMember());
  const save = (r: CaseReview) => onSave({ ...r, reviewer: { ...r.reviewer, display_name: who }, updated_at: now() });

  return (
    <form className="rf-form" onSubmit={(e) => { e.preventDefault(); save(review); }}>
      <FinalStatus value={review.verdict ?? null} saved={saved} busy={sending.busy} onPick={(v) => save({ ...review, verdict: v })} />

      <div className="rf-head">
        <h3 className="rv-h">Review checklist</h3>
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

      {sending.result && !sending.result.ok && (
        <div className="rf-issues is-send" role="alert">
          <p>Couldn’t save it: {sending.result.error} Your changes are still here; save again to retry.</p>
          {!!sending.result.issues?.length && <ul>{sending.result.issues.map((i) => <li key={i.path + i.message}>{i.path}: {i.message}</li>)}</ul>}
        </div>
      )}
      <div className="rf-actions">
        <button type="submit" className="rv-btn is-primary rf-save" disabled={saved || sending.busy}>{sending.busy ? 'Saving…' : saved ? 'Saved' : 'Save'}</button>
        <span className="rf-export">
          Download:{' '}
          <button type="button" onClick={() => downloadCases([review], 'verdicts', `review-${review.project.hgab_id}`)}>final status</button>
          {' · '}
          <button type="button" onClick={() => downloadCases([review], 'json', `review-${review.project.hgab_id}`)}>JSON</button>
          {' · '}<button type="button" onClick={() => downloadCases([review], 'cases', `review-${review.project.hgab_id}`)}>case rows</button>
          {' · '}<button type="button" onClick={() => downloadCases([review], 'evidence', `review-${review.project.hgab_id}`)}>evidence rows</button>
        </span>
      </div>
      <p className="rv-hint">Saving sends your review to the team and shows the project as taken. You can keep editing it; clear it to withdraw it.</p>
    </form>
  );
}
