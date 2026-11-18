/**
 * The team's report (`/hgab/2027/review/report`, hidden), the hand-over site: every live review from D1 (the Worker's
 * GET /api/hgab/2027/reviews/report, src/worker/hgab-reviews.ts) joined to the project list (documents/review.json),
 * with the automatic review and the red flags applied to every project, and the documents found for each. Tallied by
 * final status, region, DPWH office, House insertion, question, red flag and document, and downloadable as CSV. Pure:
 * the Worker and tests use it as is.
 *
 * Open to anyone for now, with no sign-in (Jason, 2026-11-17), but linked from no menu or page, not in the sitemap,
 * and noindex. Members show by the name they gave, never by email.
 */
import {
  QUESTIONS, RATINGS, TEAM_FLAGS, VERDICT_LABEL, answerText, flagCheckTouched, questionTouched, vocabLabel, worseRating,
  type CaseReview, type Rating, type Verdict,
} from './hgab-redflags-team';
import { COMPLETE_AT, NAMED_TYPES, type ReviewIndexFlag } from './hgab-documents';
import {
  LIST_STATUS_LABEL, REVIEW_ROOT, REVIEW_STATUS_LABEL, SOURCE_GROUPS, docCount, hasDoc,
  type ReviewProject, type ReviewStatus, type SourceGroup,
} from './hgab-review';

export const REPORT_ROOT = `${REVIEW_ROOT}/report`;
export const REPORT_TITLE = 'Project red-flag report';
export const REPORT_API = '/api/hgab/2027/reviews/report';

/** The report's pages, in the menu's order (2026-11-18: one page each, instead of one long page). */
export const REPORT_PAGES = [
  { slug: '', label: 'Overview', note: 'Every project’s final status, from members and the automatic review.' },
  { slug: 'automatic', label: 'Automatic red flags', note: 'The rule applied to every project before anyone read it, and the projects it marked.' },
  { slug: 'flags', label: 'Red flags', note: 'Each red flag on the projects, with its projects.' },
  { slug: 'documents', label: 'Documents', note: 'The documents found for each project: the five key ones, sources and regions.' },
  { slug: 'regions', label: 'By region', note: 'Final status by House insertion, region and DPWH office.' },
  { slug: 'questions', label: 'Questions', note: 'How members answered the team’s 16 questions.' },
  { slug: 'projects', label: 'Projects', note: 'Every project, with filters: final status, region, documents, search.' },
] as const;
export type ReportSlug = (typeof REPORT_PAGES)[number]['slug'];
export const reportPath = (slug: ReportSlug = '') => (slug ? `${REPORT_ROOT}/${slug}` : REPORT_ROOT);
export const projectPath = (hgabId: string) => `${REPORT_ROOT}/project/${hgabId}`;
export const flagPath = (code: string) => `${REPORT_ROOT}/flags/${code}`;
export const rulePath = (code: string) => `${REPORT_ROOT}/automatic/${code}`;

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

/**
 * A project's place in the report: the most serious final status of its members' reviews; else reviewed without one;
 * else, when the automatic review marked it (review.json `auto`), `auto`. A member's review takes over from the
 * automatic one, as in the reviewer (listStatus).
 */
export type ReportGroup = Verdict | 'auto' | 'none';
export const REPORT_GROUPS: readonly ReportGroup[] = ['needs_immediate_attention', 'needs_attention', 'auto', 'satisfactory', 'none'];
export const REPORT_GROUP_LABEL: Record<ReportGroup, string> = { ...VERDICT_LABEL, auto: LIST_STATUS_LABEL.auto_red_flag, none: 'No final status yet' };
export const REPORT_GROUP_NOTE: Record<ReportGroup, string> = {
  needs_immediate_attention: 'At least one member found a serious problem: the team looks at these first.',
  needs_attention: 'Something is missing, unclear or doesn’t add up, and needs a follow-up.',
  auto: 'Marked by the automatic rule (no key document and no file found). No member has reviewed them yet.',
  satisfactory: 'Every member who gave a final status found the documents support the project.',
  none: 'Members have started these but not given a final status.',
};
/** The groups that need attention, from members or the automatic review. */
export const ATTENTION_GROUPS: readonly ReportGroup[] = ['needs_immediate_attention', 'needs_attention', 'auto'];
/** Every project in the House bill: a report group, or not reviewed at all. */
export type ProjectGroup = ReportGroup | 'not_reviewed';
export const PROJECT_GROUPS: readonly ProjectGroup[] = [...REPORT_GROUPS, 'not_reviewed'];
export const PROJECT_GROUP_LABEL: Record<ProjectGroup, string> = { ...REPORT_GROUP_LABEL, not_reviewed: 'Not reviewed' };
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
  /** Most serious first, then newest; empty for a project only the automatic review marked. */
  reviews: ReportCase[];
  /** The automatic review, when it marked the project (whether or not a member has reviewed it since). */
  auto: { rules: string[]; score: number } | null;
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

/**
 * The reviewed projects: members' reviews by project, and, with `withAuto`, the projects only the automatic review
 * marked (from the project list), so the report counts them too.
 */
export function reportProjects(cases: readonly ReportCase[], projects: readonly ReviewProject[] | null, withAuto = false): ReportProject[] {
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
      auto: p?.auto ?? null,
      lastSaved: reviews.reduce((t, r) => (r.updated_at > t ? r.updated_at : t), ''),
    };
  }).concat(withAuto ? (projects ?? []).filter((p) => p.auto && !groups.has(p.hgabId)).map((p): ReportProject => ({
    hgabId: p.hgabId, title: p.title, office: p.office.name, districts: p.office.districts, region: p.region, program: p.program,
    amount: p.amount, insertion: p.insertion, flags: p.flags.length, docs: docCount(p.docs), verdict: null, group: 'auto', reviews: [],
    auto: p.auto, lastSaved: '',
  })) : []).sort((a, b) => REPORT_GROUPS.indexOf(a.group) - REPORT_GROUPS.indexOf(b.group) || b.amount - a.amount || a.hgabId.localeCompare(b.hgabId));
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

/** Tallies by a key, most projects needing attention first (immediate, then any, the automatic review's included), then most reviewed. */
const attention = (t: Tally) => ATTENTION_GROUPS.reduce((n, g) => n + t.groups[g].projects, 0);
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
    || attention(b) - attention(a)
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

// --- Every project: final status, red flags, documents ---------------------------------------------------------------

/** Each project's group: its report group (members, then the automatic review), else not reviewed. */
export function groupIndex(all: readonly ReviewProject[], rows: readonly ReportProject[]): Map<string, ProjectGroup> {
  const m = new Map<string, ProjectGroup>(all.map((p) => [p.hgabId, p.auto ? 'auto' : 'not_reviewed']));
  for (const r of rows) m.set(r.hgabId, r.group);
  return m;
}

export type GroupCounts = Record<ProjectGroup, { projects: number; amount: number }>;
export function groupCounts(projects: readonly ReviewProject[], groupOf: (hgabId: string) => ProjectGroup): GroupCounts {
  const out = Object.fromEntries(PROJECT_GROUPS.map((g) => [g, { projects: 0, amount: 0 }])) as GroupCounts;
  for (const p of projects) { const g = out[groupOf(p.hgabId)]; g.projects++; g.amount += p.amount; }
  return out;
}
export const sumAmount = (projects: readonly ReviewProject[]) => projects.reduce((s, p) => s + p.amount, 0);

/** Who computes a red flag: research.bettergov.ph's detectors, or ours (our NEP comparison, our document matching). */
export const flagSource = (f: Pick<ReviewIndexFlag, 'source'>) => (f.source === 'bettergov' ? 'BetterGov' : 'research.bettergov.ph');

export interface FlagTally {
  index: number;
  flag: ReviewIndexFlag;
  projects: number;
  amount: number;
  groups: GroupCounts;
}
/** Every red flag with its projects, budget and their final statuses, most projects first. */
export function flagTallies(flags: readonly ReviewIndexFlag[], all: readonly ReviewProject[], groupOf: (hgabId: string) => ProjectGroup): FlagTally[] {
  const by = flags.map((): ReviewProject[] => []);
  for (const p of all) for (const i of p.flags) by[i]?.push(p);
  return flags.map((flag, index) => ({ index, flag, projects: by[index].length, amount: sumAmount(by[index]), groups: groupCounts(by[index], groupOf) }))
    .sort((a, b) => b.projects - a.projects || a.flag.label.localeCompare(b.flag.label));
}

/**
 * How complete a project's documents are: at least COMPLETE_AT of the five key documents, fewer, or nothing at all
 * (no key document and no other file: what the automatic rule marks).
 */
export const DOC_LEVELS = ['complete', 'partial', 'none'] as const;
export type DocLevel = (typeof DOC_LEVELS)[number];
export const DOC_LEVEL_LABEL: Record<DocLevel, string> = {
  complete: `${COMPLETE_AT} or 5 key documents`,
  partial: `Fewer than ${COMPLETE_AT} key documents`,
  none: 'No document found',
};
export const docLevel = (p: Pick<ReviewProject, 'docs' | 'files'>): DocLevel =>
  docCount(p.docs) >= COMPLETE_AT ? 'complete' : p.docs === 0 && p.files === 0 ? 'none' : 'partial';

export interface DocTally {
  key: string;
  label: string;
  projects: number;
  amount: number;
  /** Projects with each of the five key documents (NAMED_TYPES order). */
  byType: number[];
  /** Projects with 0, 1, … 5 of the key documents. */
  byCount: number[];
  levels: Record<DocLevel, number>;
  /** Projects by where their files come from. */
  sources: Record<SourceGroup, number>;
  /** Files tied to the projects (Senate copies and DPWH Transparency). */
  files: number;
}
export function docTally(projects: readonly ReviewProject[], key = 'all', label = 'All projects'): DocTally {
  const t: DocTally = {
    key, label, projects: projects.length, amount: sumAmount(projects), byType: NAMED_TYPES.map(() => 0), byCount: [0, 0, 0, 0, 0, 0],
    levels: { complete: 0, partial: 0, none: 0 }, sources: Object.fromEntries(SOURCE_GROUPS.map((g) => [g, 0])) as Record<SourceGroup, number>, files: 0,
  };
  for (const p of projects) {
    NAMED_TYPES.forEach((_, i) => { if (hasDoc(p.docs, i)) t.byType[i]++; });
    t.byCount[docCount(p.docs)]++;
    t.levels[docLevel(p)]++;
    t.sources[p.source]++;
    t.files += p.files;
  }
  return t;
}
/** Document tallies by a key (region, House insertion), fewest complete first. */
export function docTallies(all: readonly ReviewProject[], key: (p: ReviewProject) => [string, string]): DocTally[] {
  const groups = new Map<string, { label: string; ps: ReviewProject[] }>();
  for (const p of all) {
    const [k, label] = key(p);
    if (!groups.has(k)) groups.set(k, { label, ps: [] });
    groups.get(k)!.ps.push(p);
  }
  return [...groups.entries()].map(([k, g]) => docTally(g.ps, k, g.label))
    .sort((a, b) => a.levels.complete / a.projects - b.levels.complete / b.projects || a.label.localeCompare(b.label));
}

// --- Words and numbers -----------------------------------------------------------------------------------------------

export const n = (v: number) => v.toLocaleString('en-US');
export const pct = (part: number, whole: number) => (whole ? `${((100 * part) / whole).toFixed(part && part < whole / 1000 ? 2 : 1)}%` : '—');
/** A date (and time) in Manila. */
export function when(iso: string, time = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', ...(time ? { hour: 'numeric', minute: '2-digit' } : {}) });
}
export const shortOffice = (name: string) => name.replace(/\bDistrict Engineering Office\b/i, 'DEO');
/** A DPWH office beside the legislative districts it serves, as the copy rules ask. */
export const officeLine = (office: string, districts: readonly string[]) =>
  districts.length ? `${districts.join(' · ')} [${shortOffice(office)}]` : office === 'Central Office' ? 'DPWH Central Office' : `DPWH ${shortOffice(office)}`;
