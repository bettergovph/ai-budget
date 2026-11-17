/**
 * The review form in the project reviewer (`/hgab/2027/review`): first the final status, the one field the team
 * reports, with final remarks; then the volunteer team's questions (BW-01…BW-16, grouping their 44 red-flag checks).
 * Every answer is on one scale (RATINGS: satisfactory, needs attention, needs immediate attention), and each question
 * takes an optional remark. It edits a `CaseReview` (src/lib/hgab-redflags-team.ts), which the page sends to the team
 * when it is saved (src/worker/hgab-reviews.ts). Shown only to signed-in members.
 */
import { useMemo, useState } from 'react';
import { NAMED_TYPES, type DetailFile, type ReviewDetail, type ReviewIndexFlag } from '../lib/hgab-documents';
import { NAMED_SHORT, readerText } from '../lib/hgab-review';
import { memberLabel, useMember } from '../lib/hgab-review-member';
import { downloadReviews } from '../lib/hgab-review-export';
import {
  DOCUMENTS_QUESTION, QUESTION_GROUP_LABEL, RATINGS, RATING_HINT, RATING_LABEL, TEAM_FLAGS,
  emptyQuestionAnswer, questionTouched, questionsFor, vocabLabel,
  type CaseReview, type CategoryKey, type FlagCheck, type QuestionAnswer, type QuestionGroup, type QuestionItem, type Rating,
  type ValidationIssue,
} from '../lib/hgab-redflags-team';

/** What saving did: `review` is what to keep editing (the stored copy when it was sent). */
export interface SaveResult { ok: boolean; review: CaseReview; error?: string; issues?: ValidationIssue[] }

const now = () => new Date().toISOString();
const RATING_OPTIONS = RATINGS.map((code) => ({ code, label: RATING_LABEL[code] }));
const RATING_ICON: Record<Rating, string> = { satisfactory: '✓', needs_attention: '⚑', needs_immediate_attention: '⚠' };

/**
 * A choice as a row of buttons, one click each. Clicking the chosen one again clears it. Each button's tooltip says
 * what the answer means.
 */
function RatingButtons({ value, onChange, label }: { value: Rating | null; onChange: (v: Rating | null) => void; label: string }) {
  return (
    <div className="rf-seg is-small" role="radiogroup" aria-label={label}>
      {RATING_OPTIONS.map((o) => {
        const on = value === o.code;
        return (
          <button key={o.code} type="button" role="radio" aria-checked={on} className={`${on ? 'is-on' : ''} is-${o.code}`} title={RATING_HINT[o.code]}
            onClick={() => onChange(on ? null : o.code)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Plain words for the outcomes of the checks answered before the questions. */
const OUTCOME_WORDS: Readonly<Record<string, string>> = {
  pending_technical_review: 'Needs an expert',
  verified_concern: 'Concern confirmed',
  cleared_explained: 'Cleared',
  unresolved_evidence_gap: 'Evidence missing',
};

/** "Found: POW 2 · BP 202 · Not found: Dev. council": the key documents we have files for (BW-16's status). */
function documentLine(files: readonly DetailFile[]): string {
  const found = NAMED_TYPES.map((t) => ({ t, n: files.filter((f) => f[2] === t).length }));
  const yes = found.filter((x) => x.n).map((x) => `${NAMED_SHORT[x.t]}${x.n > 1 ? ` ${x.n}` : ''}`);
  const no = found.filter((x) => !x.n).map((x) => NAMED_SHORT[x.t]);
  return [yes.length ? `Found: ${yes.join(' · ')}` : 'No key document found', no.length && yes.length ? `Not found: ${no.join(' · ')}` : ''].filter(Boolean).join('. ');
}

function QuestionCard({ item, answer, earlier, onChange, detectorLabel, docLine }: {
  item: QuestionItem;
  answer: QuestionAnswer;
  /** Answers to its checks from before the questions, kept with the review. */
  earlier: readonly FlagCheck[];
  onChange: (a: QuestionAnswer) => void;
  detectorLabel: (code: string) => string;
  docLine: string | null;
}) {
  const q = item.question;
  const set = (patch: Partial<QuestionAnswer>) => onChange({ ...answer, ...patch, updated_at: now() });
  // Open at first when there is a remark already; the volunteer opens and closes it after that.
  const [openAtFirst] = useState(() => !!answer.remark.trim());
  return (
    <li className={`rf-card rf-qcard ${answer.rating ? `is-${answer.rating}` : ''}`}>
      <div className="rf-card-head">
        <span className="rf-id">{q.id}</span>
        <span className="rf-title">{q.title}</span>
      </div>
      {docLine && <p className="rf-why">{docLine}</p>}
      {item.detectors.length > 0 && <p className="rf-why">Flags: {item.detectors.map(detectorLabel).join(' · ')}</p>}
      <div className="rf-outcome">
        <RatingButtons label={`${q.id} ${q.title}`} value={answer.rating} onChange={(rating) => set({ rating })} />
      </div>
      {earlier.length > 0 && (
        <ul className="rf-earlier" aria-label="Your earlier answers to its checks">
          {earlier.map((f) => (
            <li key={f.flag_id}>
              Earlier: <b>{f.flag_id}</b> {TEAM_FLAGS.get(f.flag_id)?.title}: {OUTCOME_WORDS[f.human_outcome] ?? vocabLabel('human_outcome', f.human_outcome)}
              {f.observed_discrepancy.trim() && <> · “{f.observed_discrepancy.trim()}”</>}
            </li>
          ))}
        </ul>
      )}
      <details className="rf-remark" open={openAtFirst}>
        <summary>Remark{answer.remark.trim() ? '' : <small> optional</small>}</summary>
        <p className="rf-remark-hint">{q.checks}</p>
        <textarea className="rf-input" rows={2} value={answer.remark} onChange={(e) => set({ remark: e.target.value })} aria-label={`Remark on ${q.id} ${q.title}`} />
      </details>
    </li>
  );
}

/**
 * The final status: three buttons that each save the review at once, and a line saying what was saved (read out by
 * screen readers). Toggle buttons rather than radios, so moving between them with the keyboard never saves. Each is
 * named by its label; its hint is the description screen readers give, and the tooltip.
 */
function FinalStatus({ value, saved, busy, onPick }: { value: Rating | null; saved: boolean; busy: boolean; onPick: (v: Rating | null) => void }) {
  return (
    <div className="rf-final-top-wrap">
      <div className="rf-final-top">
        <h3 id="rf-final-h" className="rf-final-h">Final status</h3>
        <p className="rf-final-state" role="status" aria-live="polite">
          {busy ? 'Saving…' : !value ? 'Not set' : saved ? <>Saved</> : <>Not saved</>}
          {value && !busy && <> · <button type="button" className="rf-link" onClick={() => onPick(null)}>Clear</button></>}
        </p>
      </div>
      <div className="rf-final-opts" role="group" aria-labelledby="rf-final-h">
        {RATINGS.map((v) => {
          const on = value === v;
          return (
            <button key={v} type="button" className={`rf-final-btn is-${v} ${on ? 'is-on' : ''}`} aria-pressed={on} disabled={busy} title={RATING_HINT[v]}
              aria-labelledby={`rf-final-${v}-l`} aria-describedby={`rf-final-${v}-d`} onClick={() => { if (!on) onPick(v); }}>
              <span className="rf-final-icon" aria-hidden="true">{RATING_ICON[v]}</span>
              <span className="rf-final-label" id={`rf-final-${v}-l`}>{RATING_LABEL[v]}</span>
              <span className="visually-hidden" id={`rf-final-${v}-d`}>{RATING_HINT[v]}</span>
            </button>
          );
        })}
      </div>
    </div>
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
  const items = useMemo(() => questionsFor({
    categories,
    detectorCodes,
    documentTypes: [...new Set(files.flatMap((f) => [f[2], f[3]]).filter((t) => t && t !== 'Other'))],
  }), [categories, detectorCodes, files]);
  const [showAll, setShowAll] = useState<Record<QuestionGroup, boolean>>({ suggested: true, more: false, later: false });
  const detectorLabel = (code: string) => readerText(flags.find((f) => f.code === code)?.label ?? code);
  const answerFor = (it: QuestionItem): QuestionAnswer =>
    review.questions.find((a) => a.question_id === it.question.id) ?? emptyQuestionAnswer(it.question.id, it.detectors, review.updated_at);
  const setAnswer = (a: QuestionAnswer) => {
    const rest = review.questions.filter((x) => x.question_id !== a.question_id);
    onChange({ ...review, questions: questionTouched(a) ? [...rest, a] : rest, updated_at: now() });
  };
  // Checks answered before the questions: shown under their question, read only.
  const earlierFor = (it: QuestionItem) => review.flags.filter((f) => it.question.flag_ids.includes(f.flag_id) && (f.human_outcome !== 'not_reviewed' || f.observed_discrepancy.trim()));
  const groups = (['suggested', 'more', 'later'] as QuestionGroup[]).map((g) => ({ g, items: items.filter((x) => x.group === g) })).filter((x) => x.items.length);
  // The member's name comes from their sign-in, not a field; it goes with every save.
  const who = memberLabel(useMember());
  const save = (r: CaseReview) => onSave({ ...r, reviewer: { ...r.reviewer, display_name: who }, updated_at: now() });
  const docLine = documentLine(files);

  return (
    <form className="rf-form" onSubmit={(e) => { e.preventDefault(); save(review); }}>
      <section className="rf-final" aria-labelledby="rf-final-h">
        <FinalStatus value={review.verdict ?? null} saved={saved} busy={sending.busy} onPick={(v) => save({ ...review, verdict: v })} />
        <label className="rf-field rf-final-remarks">
          <span>Final remarks</span>
          <textarea className="rf-input" rows={3} value={review.notes} onChange={(e) => onChange({ ...review, notes: e.target.value, updated_at: now() })} />
        </label>
      </section>

      <div className="rf-head">
        <h3 className="rv-h">Questions</h3>
      </div>

      {groups.map(({ g, items: its }) => (
        <section key={g} className="rf-sec">
          {g !== 'suggested' && (
            <h4>
              {QUESTION_GROUP_LABEL[g]} <small>{its.length}</small>
              <button type="button" className="rf-toggle" aria-expanded={showAll[g]} onClick={() => setShowAll((s) => ({ ...s, [g]: !s[g] }))}>{showAll[g] ? 'Hide' : 'Show'}</button>
            </h4>
          )}
          {showAll[g] && (
            <ul className="rf-cards">
              {its.map((it) => (
                <QuestionCard key={it.question.id} item={it} answer={answerFor(it)} earlier={earlierFor(it)} onChange={setAnswer} detectorLabel={detectorLabel}
                  docLine={it.question.id === DOCUMENTS_QUESTION ? docLine : null} />
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
          <button type="button" onClick={() => downloadReviews([review], `bettergov-review-${review.project.hgab_id}`)}>Download (CSV)</button>
        </span>
      </div>
    </form>
  );
}
