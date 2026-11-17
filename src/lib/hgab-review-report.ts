/**
 * The team's report on members' reviews (`/hgab/2027/review/report`, hidden): every live review from D1 (the Worker's
 * GET /api/hgab/2027/reviews/report, src/worker/hgab-reviews.ts) joined to the project list (documents/review.json),
 * tallied by final status, region, DPWH office, House insertion and question, and downloadable as CSV. Pure: the
 * Worker and tests use it as is.
 *
 * Open to anyone for now, with no sign-in (Jason, 2026-11-17), but linked from no menu or page, not in the sitemap,
 * and noindex. Members show by the name they gave, never by email.
 */
import {
  QUESTIONS, RATINGS, TEAM_FLAGS, VERDICT_LABEL, answerText, flagCheckTouched, questionTouched, vocabLabel, worseRating,
  type CaseReview, type Rating, type Verdict,
} from './hgab-redflags-team';
import { REVIEW_ROOT, REVIEW_STATUS_LABEL, docCount, type ReviewProject, type ReviewStatus } from './hgab-review';

export const REPORT_ROOT = `${REVIEW_ROOT}/report`;
export const REPORT_TITLE = 'Project red-flag report';
export const REPORT_API = '/api/hgab/2027/reviews/report';

/** One member's live review, as the Worker sends it. Members show by the name they gave, never by email. */
export interface ReportCase {
  hgab_id: string;
  member_id: string;
  member_name: string | null;
  status: ReviewStatus;
  /** Saves so far (the case's revision number). */
  revisions: number;
  created_at: string;
  updated_at: string;
  review: CaseReview;
}
/** An automatic review (review_auto): no key documents and no files. */
export interface ReportAuto { hgab_id: string; score: number; method: string }
export interface ReportResponse {
  meta: { generated_at: string; reviews: number; members: number; auto: number };
  data: ReportCase[];
  auto: ReportAuto[];
}

// --- Grouping ------------------------------------------------------------------------------------------------------

/** A project's place in the report: the most serious final status of its reviews, or none yet. */
export type ReportGroup = Verdict | 'none';
export const REPORT_GROUPS: readonly ReportGroup[] = ['needs_immediate_attention', 'needs_attention', 'satisfactory', 'none'];
export const REPORT_GROUP_LABEL: Record<ReportGroup, string> = { ...VERDICT_LABEL, none: 'No final status yet' };
export const REPORT_GROUP_NOTE: Record<ReportGroup, string> = {
  needs_immediate_attention: 'At least one member found a serious problem: the team looks at these first.',
  needs_attention: 'Something is missing, unclear or doesn’t add up, and needs a follow-up.',
  satisfactory: 'Every member who gave a final status found the documents support the project.',
  none: 'Members have started these but not given a final status.',
};
const severity = (v: Verdict | null) => (v ? RATINGS.indexOf(v) : -1);

/** A reviewed project: the bill's line (from the project list when we have it, else the review's own copy) and its reviews. */
export interface ReportProject {
  hgabId: string;
  title: string;
  office: string;
  /** Legislative districts the DPWH office serves (empty for the Central Office, or when the project list isn't loaded). */
  districts: string[];
  region: string;
  program: string;
  amount: number;
  /** In the House bill only, by our comparison; null when the project list isn't loaded. */
  insertion: boolean | null;
  /** Detector flags on the line; key documents on file (of 5). Null without the project list. */
  flags: number | null;
  docs: number | null;
  verdict: Verdict | null;
  group: ReportGroup;
  /** Most serious first, then newest. */
  reviews: ReportCase[];
  lastSaved: string;
}

/** "Member 3": members without a name, numbered by their first review, so the same member reads the same throughout. */
export function memberNames(cases: readonly ReportCase[]): Map<string, string> {
  const first = new Map<string, string>();
  for (const c of cases) if (!first.has(c.member_id) || c.created_at < first.get(c.member_id)!) first.set(c.member_id, c.created_at);
  // The name the member last gave (review_members), else the one on a review.
  const named = new Map<string, string>();
  for (const c of cases) {
    const name = c.member_name?.trim() || c.review.reviewer.display_name.trim();
    if (name && (!named.has(c.member_id) || c.member_name)) named.set(c.member_id, name);
  }
  const order = [...first.entries()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  let unnamed = 0;
  return new Map(order.map(([id]) => [id, named.get(id) ?? `Member ${++unnamed}`]));
}

export function reportProjects(cases: readonly ReportCase[], projects: readonly ReviewProject[] | null): ReportProject[] {
  const byId = new Map((projects ?? []).map((p) => [p.hgabId, p]));
  const groups = new Map<string, ReportCase[]>();
  for (const c of cases) groups.set(c.hgab_id, [...(groups.get(c.hgab_id) ?? []), c]);
  return [...groups.entries()].map(([hgabId, rs]): ReportProject => {
    const reviews = [...rs].sort((a, b) => severity(b.review.verdict) - severity(a.review.verdict) || b.updated_at.localeCompare(a.updated_at));
    const verdict = reviews.reduce<Verdict | null>((v, r) => worseRating(v, r.review.verdict), null);
    const p = byId.get(hgabId);
    const own = reviews[0].review.project;
    return {
      hgabId,
      title: p?.title ?? own.title,
      office: p?.office.name ?? own.office,
      districts: p?.office.districts ?? [],
      region: p?.region ?? own.region,
      program: p?.program ?? '',
      amount: p?.amount ?? own.amount_php,
      insertion: p ? p.insertion : null,
      flags: p ? p.flags.length : null,
      docs: p ? docCount(p.docs) : null,
      verdict,
      group: verdict ?? 'none',
      reviews,
      lastSaved: reviews.reduce((t, r) => (r.updated_at > t ? r.updated_at : t), ''),
    };
  }).sort((a, b) => REPORT_GROUPS.indexOf(a.group) - REPORT_GROUPS.indexOf(b.group) || b.amount - a.amount || a.hgabId.localeCompare(b.hgabId));
}

// --- Tallies -------------------------------------------------------------------------------------------------------

export interface Tally {
  key: string;
  label: string;
  projects: number;
  amount: number;
  reviews: number;
  /** Projects and their budget by final status. */
  groups: Record<ReportGroup, { projects: number; amount: number }>;
  /** Projects of this kind in the House bill (for "reviewed of"), when the project list is loaded. */
  of: number | null;
}
const emptyGroups = () => Object.fromEntries(REPORT_GROUPS.map((g) => [g, { projects: 0, amount: 0 }])) as Tally['groups'];
const emptyTally = (key: string, label: string, of: number | null = null): Tally => ({ key, label, projects: 0, amount: 0, reviews: 0, groups: emptyGroups(), of });
function add(t: Tally, p: ReportProject) {
  t.projects++; t.amount += p.amount; t.reviews += p.reviews.length;
  t.groups[p.group].projects++; t.groups[p.group].amount += p.amount;
}

export function totalTally(rows: readonly ReportProject[], billProjects: number | null): Tally {
  const t = emptyTally('all', 'All reviewed projects', billProjects);
  rows.forEach((p) => add(t, p));
  return t;
}

/** Tallies by a key, most projects needing attention first (immediate, then any), then most reviewed. */
export function tallyBy(
  rows: readonly ReportProject[], key: (p: ReportProject) => [string, string], of?: (key: string) => number | null,
): Tally[] {
  const out = new Map<string, Tally>();
  for (const p of rows) {
    const [k, label] = key(p);
    if (!out.has(k)) out.set(k, emptyTally(k, label, of?.(k) ?? null));
    add(out.get(k)!, p);
  }
  return [...out.values()].sort((a, b) =>
    b.groups.needs_immediate_attention.projects - a.groups.needs_immediate_attention.projects
    || (b.groups.needs_immediate_attention.projects + b.groups.needs_attention.projects) - (a.groups.needs_immediate_attention.projects + a.groups.needs_attention.projects)
    || b.projects - a.projects || a.label.localeCompare(b.label));
}

/** House insertion or NEP only (our comparison), as the reviewer's progress cards split them. */
export const insertionKey = (p: ReportProject): [string, string] =>
  p.insertion == null ? ['unknown', 'Not in the project list'] : p.insertion ? ['insertion', 'House insertions'] : ['nep', 'NEP only'];

/** How members answered one of the 16 questions, over all reviews. */
export interface QuestionTally {
  id: string;
  title: string;
  family: string;
  answered: number;
  ratings: Record<Rating, number>;
  remarks: number;
  /** Projects where some member answered "needs immediate attention". */
  urgentProjects: string[];
}
export function questionTallies(cases: readonly ReportCase[]): QuestionTally[] {
  const by = new Map(QUESTIONS.map((q) => [q.id, {
    id: q.id, title: q.title, family: q.family, answered: 0, remarks: 0, urgentProjects: [] as string[],
    ratings: Object.fromEntries(RATINGS.map((r) => [r, 0])) as Record<Rating, number>,
  }]));
  for (const c of cases) {
    for (const a of c.review.questions) {
      const t = by.get(a.question_id);
      if (!t || !questionTouched(a)) continue;
      if (a.rating) { t.answered++; t.ratings[a.rating]++; }
      if (a.remark.trim()) t.remarks++;
      if (a.rating === 'needs_immediate_attention' && !t.urgentProjects.includes(c.hgab_id)) t.urgentProjects.push(c.hgab_id);
    }
  }
  return [...by.values()];
}

/** The checks members answered before the 16 questions (kept on older reviews), by outcome. */
export interface CheckTally { id: string; title: string; answered: number; outcomes: { label: string; count: number }[]; projects: string[] }
export function checkTallies(cases: readonly ReportCase[]): CheckTally[] {
  const by = new Map<string, { answered: number; outcomes: Map<string, number>; projects: Set<string> }>();
  for (const c of cases) {
    for (const f of c.review.flags) {
      if (!flagCheckTouched(f)) continue;
      const t = by.get(f.flag_id) ?? { answered: 0, outcomes: new Map(), projects: new Set() };
      t.answered++;
      const label = vocabLabel('human_outcome', f.human_outcome);
      t.outcomes.set(label, (t.outcomes.get(label) ?? 0) + 1);
      t.projects.add(c.hgab_id);
      by.set(f.flag_id, t);
    }
  }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, t]) => ({
    id, title: TEAM_FLAGS.get(id)?.title ?? '', answered: t.answered, projects: [...t.projects],
    outcomes: [...t.outcomes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label, count]) => ({ label, count })),
  }));
}

/** The answers a review gives, most serious first; then the checks it answered before the 16 questions existed. */
export interface AnswerLine { id: string; title: string; rating: Rating | null; label: string; remark: string; older: boolean }
export function answerLines(r: CaseReview): AnswerLine[] {
  const qs = r.questions.filter(questionTouched).map((a): AnswerLine => ({
    id: a.question_id, title: QUESTIONS.find((q) => q.id === a.question_id)?.title ?? '', rating: a.rating,
    label: a.rating ? VERDICT_LABEL[a.rating] : 'No answer', remark: a.remark.trim(), older: false,
  })).sort((a, b) => severity(b.rating) - severity(a.rating) || a.id.localeCompare(b.id));
  const older = r.flags.filter(flagCheckTouched).map((f): AnswerLine => ({
    id: f.flag_id, title: TEAM_FLAGS.get(f.flag_id)?.title ?? '', rating: null,
    label: vocabLabel('human_outcome', f.human_outcome), remark: f.observed_discrepancy.trim(), older: true,
  }));
  return [...qs, ...older];
}

// --- Downloads -----------------------------------------------------------------------------------------------------

const day = (iso: string) => iso.slice(0, 10);
const reviewerLink = (origin: string, hgabId: string) => `${origin}${REVIEW_ROOT}?p=${hgabId}`;

/** One row per review. */
export const REPORT_REVIEW_COLUMNS = [
  'House bill row', 'Project', 'DPWH office', 'Legislative districts', 'Region', 'Program', 'House bill amount (PHP)', 'House insertion',
  'Project final status', 'Reviewer', 'Final status', 'Final remarks', 'Answers', 'Review status', 'Saves', 'First saved', 'Last saved', 'Open in the reviewer',
] as const;
export function reviewRows(rows: readonly ReportProject[], names: ReadonlyMap<string, string>, origin: string): string[][] {
  return rows.flatMap((p) => p.reviews.map((c) => [
    p.hgabId, p.title, p.office, p.districts.join('; '), p.region, p.program, String(p.amount),
    p.insertion == null ? '' : p.insertion ? 'Yes' : 'No', REPORT_GROUP_LABEL[p.group],
    names.get(c.member_id) ?? '', c.review.verdict ? VERDICT_LABEL[c.review.verdict] : 'Not given', c.review.notes.trim(), answerText(c.review),
    REVIEW_STATUS_LABEL[c.status] ?? c.status, String(c.revisions), day(c.created_at), day(c.updated_at), reviewerLink(origin, p.hgabId),
  ]));
}

/** One row per answer (and per older check answer), for counting in a spreadsheet. */
export const REPORT_ANSWER_COLUMNS = [
  'House bill row', 'Project', 'Region', 'House insertion', 'Reviewer', 'Question or check', 'Title', 'Answer', 'Remark', 'Review final status',
] as const;
export function answerRows(rows: readonly ReportProject[], names: ReadonlyMap<string, string>): string[][] {
  return rows.flatMap((p) => p.reviews.flatMap((c) => answerLines(c.review).map((a) => [
    p.hgabId, p.title, p.region, p.insertion == null ? '' : p.insertion ? 'Yes' : 'No', names.get(c.member_id) ?? '',
    a.id, a.title, a.label, a.remark, c.review.verdict ? VERDICT_LABEL[c.review.verdict] : 'Not given',
  ])));
}
