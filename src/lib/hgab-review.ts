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
}

export function decodeIndex(ix: ReviewIndex): ReviewProject[] {
  return ix.rows.map(([hgabId, projectId, title, oi, ri, pi, amount, flags, docs, files]) => {
    const { seq, page } = parseHgabId(hgabId) ?? { seq: 0, page: 0 };
    return { hgabId, seq, page, projectId, title, office: ix.offices[oi], region: ix.regions[ri], program: ix.programs[pi], amount, flags, docs, files };
  });
}

export const docCount = (mask: number) => NAMED_TYPES.reduce((n, _, i) => n + ((mask >> i) & 1), 0);
export const hasDoc = (mask: number, i: number) => ((mask >> i) & 1) === 1;

// --- Steps --------------------------------------------------------------------------------------------------------

export type DocsFilter = 'none' | 'incomplete' | 'complete';
/** Filters where checking several values keeps projects matching any of them (one funnel step each). */
export type MultiKind = 'region' | 'office' | 'program' | 'docs' | 'team';
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
  | { kind: 'reviewed'; value: 'yes' | 'no' };

export const DOCS_FILTERS: readonly DocsFilter[] = ['none', 'incomplete', 'complete'];
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
    case 'region': case 'office': case 'program': case 'docs': case 'team': return `${s.kind}:${s.values.join(SEP)}`;
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
    case 'reviewed': return value === 'yes' || value === 'no' ? { kind, value } : null;
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
/** Sets a single-value filter (min, q, reviewed) the same way; null removes it. */
export function setSingle(steps: readonly Step[], kind: 'min' | 'q' | 'reviewed', step: Step | null): Step[] {
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
  reviewed: ReadonlySet<string>;
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
    case 'reviewed': return (p) => ctx.reviewed.has(p.hgabId) === (s.value === 'yes');
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

export type SortKey = 'flags' | 'amount' | 'bill';
export const SORT_LABEL: Record<SortKey, string> = { flags: 'Most flags', amount: 'Largest budget', bill: 'Bill order' };
export function sortProjects(xs: readonly ReviewProject[], key: SortKey): ReviewProject[] {
  const out = [...xs];
  if (key === 'flags') out.sort((a, b) => b.flags.length - a.flags.length || b.amount - a.amount || a.seq - b.seq);
  else if (key === 'amount') out.sort((a, b) => b.amount - a.amount || a.seq - b.seq);
  else out.sort((a, b) => a.seq - b.seq);
  return out;
}

/** Ready-made funnels for volunteers to start from. Every flag code must exist in review.json (the page drops any that don't). */
export const PRESETS: readonly { key: string; label: string; note: string; steps: Step[] }[] = [
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
    case 'reviewed': return s.value === 'yes' ? 'Reviewed by me' : 'Not yet reviewed by me';
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
