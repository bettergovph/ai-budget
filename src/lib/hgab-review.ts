/**
 * The project reviewer (`/hgab/2027/review`): every DPWH project in the FY2027 House bill, narrowed by a red-flag
 * funnel, with each project's documents and flags. Pure: no fetches, no `import.meta`, so tests and scripts can use
 * it. Data: documents/review.json and documents/detail/<NN>.json (src/lib/hgab-documents.ts, build:hgab-documents).
 *
 * The funnel is an ordered list of steps; each keeps the projects of the step before that pass it, so every step
 * shows how many projects remain and how much budget they carry. Steps live in the URL (`s=` repeated) so a funnel
 * can be shared.
 */
import {
  FLAG_FAMILIES, NAMED_TYPES, parseHgabId, type FlagFamily, type LinkMethod, type ReviewIndex, type ReviewIndexFlag,
  type ReviewIndexOffice,
} from './hgab-documents';

export const REVIEW_ROOT = '/hgab/2027/review';
export const REVIEW_TITLE = 'Project reviewer';

/** A project, decoded from a review.json row. */
export interface ReviewProject {
  hgabId: string;
  seq: number;
  page: number;
  projectId: string;
  title: string;
  office: ReviewIndexOffice;
  region: string;
  program: string;
  amount: number;
  flags: number[];
  /** Bit i = NAMED_TYPES[i] present (Senate or Proposal files, or the research site's types). */
  docs: number;
  files: number;
  /** Automatic review (review.json `auto`): the rules it met and its provisional score; null when not auto-reviewed. */
  auto: { rules: string[]; score: number } | null;
}

export function decodeIndex(ix: ReviewIndex): ReviewProject[] {
  return ix.rows.map(([hgabId, projectId, title, oi, ri, pi, amount, flags, docs, files]) => {
    const { seq, page } = parseHgabId(hgabId) ?? { seq: 0, page: 0 };
    const a = ix.auto?.rows[hgabId];
    const auto = a ? { rules: a.r.map((i) => ix.auto!.rules[i]?.code).filter(Boolean), score: a.s } : null;
    return { hgabId, seq, page, projectId, title, office: ix.offices[oi], region: ix.regions[ri], program: ix.programs[pi], amount, flags, docs, files, auto };
  });
}

export const docCount = (mask: number) => NAMED_TYPES.reduce((n, _, i) => n + ((mask >> i) & 1), 0);
export const hasDoc = (mask: number, i: number) => ((mask >> i) & 1) === 1;

// --- Steps --------------------------------------------------------------------------------------------------------

export type DocsFilter = 'none' | 'incomplete' | 'complete';
/** Filters where checking several values keeps projects matching any of them (one funnel step each). */
export type MultiKind = 'region' | 'office' | 'program' | 'docs' | 'team' | 'status';
export type Step =
  | { kind: 'flag'; code: string; not?: boolean }
  | { kind: 'region'; values: string[] }
  | { kind: 'office'; values: string[] }
  | { kind: 'program'; values: string[] }
  | { kind: 'docs'; values: DocsFilter[] }
  /** Team checks (RF-001…): projects whose detector flags suggest any of them (src/lib/hgab-redflags-team.ts). */
  | { kind: 'team'; values: string[] }
  | { kind: 'min'; value: number }
  | { kind: 'q'; value: string }
  /** Review status (LIST_STATUSES): from every member's reviews, and the automatic review. */
  | { kind: 'status'; values: ListStatus[] };

export const DOCS_FILTERS: readonly DocsFilter[] = ['none', 'incomplete', 'complete'];

/**
 * Where a project's review stands, from every member's reviews (`ReviewStatusIndex`). Ordered as work goes: what still
 * needs a reviewer first.
 */
export const REVIEW_STATUSES = ['not_started', 'in_progress', 'on_hold', 'in_independent_review', 'completed'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  on_hold: 'On hold',
  in_independent_review: 'In independent review',
  completed: 'Completed',
};
/**
 * What the list shows and filters on: the members' review status, or "Auto-reviewed: red flag" when nobody has
 * reviewed a project the automatic review marked (review.json `auto`). Kept apart from ReviewStatus, which is what
 * members' reviews store in D1. Ordered for the review-status sort: work still to do first, reviewed last.
 */
export const LIST_STATUSES = [...REVIEW_STATUSES, 'auto_red_flag'] as const;
export type ListStatus = (typeof LIST_STATUSES)[number];
export const LIST_STATUS_LABEL: Record<ListStatus, string> = { ...REVIEW_STATUS_LABEL, auto_red_flag: 'Auto-reviewed: red flag' };
/** Statuses that count as reviewed, for "Hide reviewed" and the faded rows in the list. */
export const REVIEWED_STATUSES: readonly ListStatus[] = ['auto_red_flag', 'in_independent_review', 'completed'];
export const NOT_REVIEWED_STATUSES: readonly ListStatus[] = LIST_STATUSES.filter((v) => !REVIEWED_STATUSES.includes(v));
export const isReviewed = (s: ListStatus) => REVIEWED_STATUSES.includes(s);
/** A project's list status: the members' status, unless nobody has started and the automatic review marked it. */
export const listStatus = (members: ReviewStatus, auto: boolean): ListStatus => (members === 'not_started' && auto ? 'auto_red_flag' : members);

/**
 * Every project's review status across members, from `GET /api/hgab/2027/reviews/status` (src/worker/hgab-reviews.ts):
 * the furthest status any member's review has reached, how many members have a review, and the last save. Projects
 * nobody has reviewed are left out. The page's `statusOf` reads it.
 */
export type ReviewStatusIndex = Record<string, { status: ReviewStatus; reviews: number; updated_at: string }>;

/**
 * How far a review has gone, so a project shows the furthest of its reviews: on hold counts below in progress, as
 * another member may still be working on it.
 */
const STATUS_RANK: Record<ReviewStatus, number> = { not_started: 0, on_hold: 1, in_progress: 2, in_independent_review: 3, completed: 4 };
export function furthestStatus(statuses: Iterable<ReviewStatus>): ReviewStatus {
  let out: ReviewStatus = 'not_started';
  for (const s of statuses) if (STATUS_RANK[s] > STATUS_RANK[out]) out = s;
  return out;
}

/** The status index from each review's project, status and last save (the API's query, and the tests'). */
export function buildStatusIndex(rows: Iterable<{ hgab_id: string; status: ReviewStatus; updated_at: string }>): ReviewStatusIndex {
  const out: ReviewStatusIndex = {};
  for (const r of rows) {
    const cur = out[r.hgab_id];
    out[r.hgab_id] = cur
      ? { status: furthestStatus([cur.status, r.status]), reviews: cur.reviews + 1, updated_at: r.updated_at > cur.updated_at ? r.updated_at : cur.updated_at }
      : { status: r.status, reviews: 1, updated_at: r.updated_at };
  }
  return out;
}

/**
 * A review's case stage (the team workbook's vocabulary) as a status. No review is "not started"; a saved draft is
 * "in progress" even while its case stage still reads "Not started".
 */
export function reviewStatusFromStage(stage: string | null | undefined): ReviewStatus {
  if (!stage) return 'not_started';
  if (stage === 'on_hold' || stage === 'in_independent_review' || stage === 'completed') return stage;
  return 'in_progress';
}
export const DOCS_FILTER_LABEL: Record<DocsFilter, string> = {
  none: 'No documents found',
  incomplete: 'Fewer than 4 of the 5 key documents',
  complete: 'At least 4 of the 5 key documents',
};

/** Several values of one filter in the URL: `region:Region V|Region IV-A`. Names never contain "|". */
const SEP = '|';
/** `flag:potential-nep-insertion`, `-flag:repeated-allocation-amount`, `region:Region V|NCR`, `min:100000000`, … */
export function stepToParam(s: Step): string {
  switch (s.kind) {
    case 'flag': return `${s.not ? '-' : ''}flag:${s.code}`;
    case 'region': case 'office': case 'program': case 'docs': case 'team': case 'status': return `${s.kind}:${s.values.join(SEP)}`;
    default: return `${s.kind}:${s.value}`;
  }
}
export function stepFromParam(p: string): Step | null {
  const m = /^(-?)([a-z]+):(.+)$/s.exec(p);
  if (!m) return null;
  const [, neg, kind, value] = m;
  const values = [...new Set(value.split(SEP).map((v) => v.trim()).filter(Boolean))];
  switch (kind) {
    case 'flag': return /^[a-z0-9-]+$/.test(value) ? { kind: 'flag', code: value, not: neg === '-' } : null;
    case 'region': case 'office': case 'program': return values.length ? { kind, values } : null;
    case 'docs': {
      const ok = values.filter((v): v is DocsFilter => (DOCS_FILTERS as readonly string[]).includes(v));
      return ok.length ? { kind, values: ok } : null;
    }
    case 'team': { const ok = values.filter((v) => /^RF-\d{3}$/.test(v)); return ok.length ? { kind, values: ok } : null; }
    case 'q': return value.trim() ? { kind, value } : null;
    case 'min': { const n = Number(value); return Number.isFinite(n) && n > 0 ? { kind, value: n } : null; }
    case 'status': {
      const ok = values.filter((v): v is ListStatus => (LIST_STATUSES as readonly string[]).includes(v));
      return ok.length ? { kind, values: ok } : null;
    }
    // Links from before review statuses: "reviewed by me" or not.
    case 'reviewed':
      return value === 'no' ? { kind: 'status', values: ['not_started'] }
        : value === 'yes' ? { kind: 'status', values: LIST_STATUSES.filter((v) => v !== 'not_started') } : null;
    default: return null;
  }
}
export function stepsFromSearch(search: URLSearchParams, flagCodes: ReadonlySet<string>): Step[] {
  return search.getAll('s').map(stepFromParam).filter((s): s is Step => !!s && (s.kind !== 'flag' || flagCodes.has(s.code)));
}
export const sameStep = (a: Step, b: Step) => stepToParam(a) === stepToParam(b);

/** The values checked for a multi-value filter (empty when it has no step). */
export function checkedValues(steps: readonly Step[], kind: MultiKind): string[] {
  const s = steps.find((x) => x.kind === kind);
  return s && 'values' in s ? s.values : [];
}
/** Sets a multi-value filter: its step keeps its place in the funnel, is added at the end, or goes when empty. */
export function setValues(steps: readonly Step[], kind: MultiKind, values: string[]): Step[] {
  const i = steps.findIndex((x) => x.kind === kind);
  const step = values.length ? ({ kind, values } as Step) : null;
  if (i < 0) return step ? [...steps, step] : [...steps];
  return step ? steps.map((x, j) => (j === i ? step : x)) : steps.filter((_, j) => j !== i);
}
/** Sets a single-value filter (min, q) the same way; null removes it. */
export function setSingle(steps: readonly Step[], kind: 'min' | 'q', step: Step | null): Step[] {
  const i = steps.findIndex((x) => x.kind === kind);
  if (i < 0) return step ? [...steps, step] : [...steps];
  return step ? steps.map((x, j) => (j === i ? step : x)) : steps.filter((_, j) => j !== i);
}
/** Checks or unchecks a flag: checking adds a step at the end, unchecking removes it wherever it is. */
export function toggleFlag(steps: readonly Step[], code: string, not = false): Step[] {
  const i = steps.findIndex((x) => x.kind === 'flag' && x.code === code);
  return i >= 0 ? steps.filter((_, j) => j !== i) : [...steps, { kind: 'flag', code, not }];
}

/** Folds case and accents, for search. */
export const foldText = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export interface StepContext {
  flagIndex: ReadonlyMap<string, number>;
  /** A project's list status (LIST_STATUSES). */
  statusOf: (hgabId: string) => ListStatus;
  /** Team check → the review.json flag indexes of the detector flags that suggest it. */
  teamIndex?: ReadonlyMap<string, readonly number[]>;
}
const docsTest = (v: DocsFilter) => (p: ReviewProject) =>
  v === 'none' ? p.files === 0 && p.docs === 0 : v === 'complete' ? docCount(p.docs) >= 4 : docCount(p.docs) < 4;
export function stepTest(s: Step, ctx: StepContext): (p: ReviewProject) => boolean {
  switch (s.kind) {
    case 'flag': {
      const i = ctx.flagIndex.get(s.code);
      return i == null ? () => !!s.not : (p) => p.flags.includes(i) !== !!s.not;
    }
    case 'region': { const v = new Set(s.values); return (p) => v.has(p.region); }
    case 'office': { const v = new Set(s.values); return (p) => v.has(p.office.name); }
    case 'program': { const v = new Set(s.values); return (p) => v.has(p.program); }
    case 'docs': { const tests = s.values.map(docsTest); return (p) => tests.some((t) => t(p)); }
    case 'team': {
      const idx = new Set(s.values.flatMap((v) => ctx.teamIndex?.get(v) ?? []));
      return (p) => p.flags.some((i) => idx.has(i));
    }
    case 'min': return (p) => p.amount >= s.value;
    case 'q': {
      const words = foldText(s.value).split(/\s+/).filter(Boolean);
      return (p) => { const t = foldText(`${p.title} ${p.office.name} ${p.office.districts.join(' ')} ${p.hgabId}`); return words.every((w) => t.includes(w)); };
    }
    case 'status': { const v = new Set<string>(s.values); return (p) => v.has(ctx.statusOf(p.hgabId)); }
  }
}

export interface FunnelLevel { step: Step | null; projects: ReviewProject[]; amount: number }
/** Level 0 is every project; level i keeps level i−1's projects that pass step i. */
export function runFunnel(all: ReviewProject[], steps: readonly Step[], ctx: StepContext): FunnelLevel[] {
  const sum = (xs: ReviewProject[]) => xs.reduce((a, p) => a + p.amount, 0);
  const levels: FunnelLevel[] = [{ step: null, projects: all, amount: sum(all) }];
  for (const s of steps) {
    const prev = levels[levels.length - 1].projects;
    const test = stepTest(s, ctx);
    const next = prev.filter(test);
    levels.push({ step: s, projects: next, amount: sum(next) });
  }
  return levels;
}
/** The projects every step but `kind`'s keeps: what a multi-value filter's options are counted against. */
export function projectsWithout(all: ReviewProject[], steps: readonly Step[], kind: Step['kind'], ctx: StepContext): ReviewProject[] {
  const tests = steps.filter((s) => s.kind !== kind).map((s) => stepTest(s, ctx));
  return all.filter((p) => tests.every((t) => t(p)));
}
/** How many of `projects` have each value of a field. */
export function countBy(projects: readonly ReviewProject[], key: (p: ReviewProject) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of projects) { const k = key(p); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
}

/** How many of `projects` carry each flag: what the next step would keep. */
export function flagYields(projects: readonly ReviewProject[], nFlags: number): number[] {
  const n = new Array<number>(nFlags).fill(0);
  for (const p of projects) for (const i of p.flags) n[i]++;
  return n;
}

/**
 * Bill order is the default: most red flags first would put the projects most likely to be ruled out at the top.
 * Review status puts what still needs a reviewer first, then bill order.
 */
export type SortKey = 'bill' | 'status' | 'score' | 'amount' | 'flags';
export const SORT_LABEL: Record<SortKey, string> = { bill: 'Bill order', status: 'Review status', score: 'Red flag score', amount: 'Largest budget', flags: 'Most flags' };
export const DEFAULT_SORT: SortKey = 'bill';
export function sortProjects(xs: readonly ReviewProject[], key: SortKey, statusOf?: (hgabId: string) => ListStatus): ReviewProject[] {
  const out = [...xs];
  if (key === 'status') {
    const rank = (p: ReviewProject) => LIST_STATUSES.indexOf(statusOf ? statusOf(p.hgabId) : 'not_started');
    out.sort((a, b) => rank(a) - rank(b) || a.seq - b.seq);
  } else if (key === 'score') out.sort((a, b) => (b.auto?.score ?? 0) - (a.auto?.score ?? 0) || a.seq - b.seq);
  else if (key === 'flags') out.sort((a, b) => b.flags.length - a.flags.length || b.amount - a.amount || a.seq - b.seq);
  else if (key === 'amount') out.sort((a, b) => b.amount - a.amount || a.seq - b.seq);
  else out.sort((a, b) => a.seq - b.seq);
  return out;
}

// --- Pages ------------------------------------------------------------------------------------------------------

export const PAGE_SIZE = 50;
export const pageCount = (n: number) => Math.max(1, Math.ceil(n / PAGE_SIZE));
/** The page (from 1) holding the item at `index` (from 0). */
export const pageOf = (index: number) => Math.floor(Math.max(0, index) / PAGE_SIZE) + 1;
/** Page numbers to show around `page`: the first, the last, and two either side, with null for a gap. */
export function pageWindow(page: number, total: number): (number | null)[] {
  const keep = new Set([1, total, page - 2, page - 1, page, page + 1, page + 2].filter((x) => x >= 1 && x <= total));
  const nums = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  nums.forEach((x, i) => { if (i && x - nums[i - 1] > 1) out.push(null); out.push(x); });
  return out;
}

/** Ready-made funnels for volunteers to start from. Every flag code must exist in review.json (the page drops any that don't). */
export const PRESETS: readonly { key: string; label: string; note: string; steps: Step[] }[] = [
  {
    key: 'not-reviewed',
    label: 'Not yet reviewed',
    note: 'Leaves out auto-reviewed red flags and reviews that are done or with a verifier.',
    steps: [{ kind: 'status', values: [...NOT_REVIEWED_STATUSES] }],
  },
  {
    key: 'auto-red-flags',
    label: 'Auto-reviewed red flags',
    note: 'No key document and no file found: marked red flag without a review.',
    steps: [{ kind: 'status', values: ['auto_red_flag'] }],
  },
  {
    key: 'not-taken',
    label: 'Nobody has started',
    note: 'Projects no member has a review for yet, so two people don’t review the same one.',
    steps: [{ kind: 'status', values: ['not_started'] }],
  },
  {
    key: 'inserted-no-docs',
    label: 'House additions without documents',
    note: 'In the House bill, not matched to the NEP, and no documents found.',
    steps: [{ kind: 'flag', code: 'potential-nep-insertion' }, { kind: 'docs', values: ['none'] }],
  },
  {
    key: 'inserted-incomplete',
    label: 'House additions with gaps',
    note: 'House bill only, and fewer than 4 of the 5 key documents.',
    steps: [{ kind: 'flag', code: 'potential-nep-insertion' }, { kind: 'docs', values: ['incomplete'] }],
  },
  {
    key: 'sources-disagree',
    label: 'Sources disagree on the NEP match',
    note: 'Our comparison and research.bettergov.ph disagree on whether the project has an NEP line.',
    steps: [{ kind: 'flag', code: 'nep-match-sources-disagree' }],
  },
  {
    key: 'no-pow',
    label: 'No program of work',
    note: 'No program of work (POW) found, the document that prices the work.',
    steps: [{ kind: 'flag', code: 'missing-pow' }],
  },
  {
    key: 'same-site',
    label: 'Possible same site twice',
    note: 'Projects whose coordinates sit under 50 m from another project.',
    steps: [{ kind: 'flag', code: 'possible-project-doppelganger-coordinates-under-50-m-apart' }],
  },
  {
    key: 'cost-per-meter',
    label: 'High cost per meter',
    note: 'Cost per stated meter far above similar projects.',
    steps: [{ kind: 'flag', code: 'extreme-cost-per-stated-meter-vs-peers' }],
  },
  {
    key: 'repeats',
    label: 'Repeated in past budgets',
    note: 'A project that looks like one funded in an earlier budget.',
    steps: [{ kind: 'flag', code: 'historical-project-repeat-candidate' }],
  },
];

// --- Words ------------------------------------------------------------------------------------------------------

/** The research site's flag labels and evidence, in our words for the bill ("House bill", not "HGAB"). */
export const readerText = (s: string) => s.replace(/\bHGAB\b/g, 'House bill').replace(/\bmoney\b/gi, 'budget');

export const FAMILY_LABEL: Record<FlagFamily, string> = Object.fromEntries(FLAG_FAMILIES.map((f) => [f.key, f.label])) as Record<FlagFamily, string>;
export const FAMILY_ORDER: readonly FlagFamily[] = FLAG_FAMILIES.map((f) => f.key);

export function stepLabel(s: Step, flags: readonly ReviewIndexFlag[], offices: readonly ReviewIndexOffice[] = [], teamTitles: ReadonlyMap<string, string> = new Map()): string {
  switch (s.kind) {
    case 'flag': {
      const f = flags.find((x) => x.code === s.code);
      const l = f ? readerText(f.label) : s.code;
      return s.not ? `Not: ${l}` : l;
    }
    case 'region': return s.values.length === 1 ? s.values[0] : `${s.values.length} regions: ${s.values.join(', ')}`;
    case 'office': {
      const one = (name: string) => {
        const deo = name.replace(/\bDistrict Engineering Office\b/i, 'DEO');
        const ds = offices.find((o) => o.name === name)?.districts ?? [];
        return ds.length ? `${ds.join(' · ')} [${deo}]` : `DPWH ${deo}`;
      };
      return s.values.length === 1 ? one(s.values[0]) : `${s.values.length} DPWH offices: ${s.values.map((v) => v.replace(/\bDistrict Engineering Office\b/i, 'DEO')).join(', ')}`;
    }
    case 'program': return s.values.length === 1 ? s.values[0] : `${s.values.length} programs`;
    case 'docs': return s.values.map((v) => DOCS_FILTER_LABEL[v]).join(' or ');
    case 'team': return s.values.length === 1 ? `Team check ${s.values[0]}: ${teamTitles.get(s.values[0]) ?? ''}`.replace(/: $/, '') : `Team checks ${s.values.join(', ')}`;
    case 'min': return `Budget of at least ${pesoShort(s.value)}`;
    case 'q': return `Search: “${s.value}”`;
    case 'status':
      if (s.values.length === NOT_REVIEWED_STATUSES.length && NOT_REVIEWED_STATUSES.every((v) => s.values.includes(v))) return 'Not yet reviewed';
      return `Review: ${s.values.map((v) => LIST_STATUS_LABEL[v]).join(' or ')}`;
  }
}

/** ₱1.2B, ₱340M, ₱25M, ₱900K. */
export function pesoShort(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `₱${(v / 1e9).toFixed(a >= 1e11 ? 0 : 1)}B`;
  if (a >= 1e6) return `₱${(v / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (a >= 1e3) return `₱${Math.round(v / 1e3)}K`;
  return `₱${v}`;
}
export const pesoFull = (v: number) => `₱${v.toLocaleString('en-US')}`;

export const SOURCE_LABEL = { senate: 'Senate copy', proposal: 'DPWH Transparency' } as const;
/** How a file was tied to the project, in plain words, for the file list. */
export const LINK_LABEL: Record<LinkMethod, string> = {
  research: 'Matched by research.bettergov.ph',
  pow_title: 'Its program of work names this project',
  tracker: 'Listed for this project by DPWH Region IV-A',
  reviewed: 'Checked by reading its program of work',
  proposal: 'DPWH Transparency record paired with this project',
};
/** Tracker links are the weakest; say so. */
export const LINK_WEAK: ReadonlySet<LinkMethod> = new Set(['tracker']);

export const NAMED_SHORT: Record<(typeof NAMED_TYPES)[number], string> = {
  POW: 'POW',
  'BP 202': 'BP 202',
  'Development Council': 'Dev. council',
  'Geotagged photos': 'Photos',
  'Certificate of Implementability': 'Implementability',
};
/** What each named document is, in one plain line. */
export const NAMED_MEANING: Record<(typeof NAMED_TYPES)[number], string> = {
  POW: 'Program of work: the work items, quantities and cost.',
  'BP 202': 'Budget proposal form for a capital project.',
  'Development Council': 'Endorsement by the regional, provincial or local development council.',
  'Geotagged photos': 'Photos of the site with their location.',
  'Certificate of Implementability': 'The office certifies the project can be carried out.',
};
