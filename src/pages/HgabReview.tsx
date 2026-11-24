/**
 * `/hgab/2027/review` — the project reviewer: every DPWH project in the FY2027 House bill, narrowed by a red-flag
 * funnel, with each project's documents, its red flags and a review form. Its own full-height layout (a slim bar,
 * then funnel · projects · project) for volunteers working through many projects; not the section's article layout.
 *
 * Data: documents/review.json (every project, for the funnel) and documents/detail/<NN>.json (files and evidence,
 * loaded when a project opens), from `npm run build:hgab-documents`. Logic: src/lib/hgab-review.ts. State lives in
 * the URL (`s=` funnel steps, `p=` open project, `sort=`), so a funnel or a project can be shared.
 *
 * Anyone can browse the projects, their documents and red flags. Reviewing needs a sign-in (Clerk, email code;
 * HgabReviewMember.tsx): saving sends the review to the team (src/worker/hgab-reviews.ts, D1), and nothing of it is
 * kept in the browser. Every project shows the furthest status of all members' reviews, so members can split the work
 * without reviewing the same project twice. Reviews also download as JSON or as rows for the team's workbook.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DisclaimerNotice } from '../components/HgabBits';
import { cached, getJson, HGAB_ROOT, pdfUrl, recordPath } from '../lib/hgab';
import { dataUrl } from '../lib/data-url';
import {
  NAMED_TYPES, REVIEW_INDEX_PATH, REVIEW_SENATE_PATH, detailShardPath, type DetailFile, type ReviewDetail, type ReviewDetailShard,
  type ReviewIndex, type ReviewSenateIndex,
} from '../lib/hgab-documents';
import {
  DETAIL_NOTE_TEXT as NOTE_TEXT, FAMILY_LABEL, FAMILY_ORDER, LINK_LABEL, LINK_WEAK, NAMED_MEANING, NAMED_SHORT,
  DEFAULT_SORT, INSERTION_FLAG, PROGRESS_GROUP_LABEL, PROGRESS_GROUP_NOTE, reviewProgress, LIST_STATUS_LABEL, NOT_REVIEWED_STATUSES, PAGE_SIZE, PRESETS, REVIEW_TITLE, SORT_LABEL, SOURCE_LABEL, decodeIndex, docCount, isReviewed, listStatus, pageCount, pageOf, pageWindow, projectVerdict,
  hasDoc, pesoFull, pesoShort, readerText, runFunnel, sortProjects, stepToParam, stepsFromSearch, type ListStatus, type ProgressGroup, type ProgressRow, type ReviewProject, type ReviewStatusIndex, type SortKey, type Step, type VerdictCounts,
} from '../lib/hgab-review';
import {
  BUDGET_SOURCE_VERSION, QUESTIONS, REGISTRY, RETIRED_STORES, VERDICT_LABEL, caseTouched, classifyProject,
  detectorsForQuestion, newCaseReview, newId, type CaseReview, type Reviewer, type Verdict,
} from '../lib/hgab-redflags-team';
import HgabReviewForm, { type SaveResult } from '../components/HgabReviewForm';
import { FilterBar, FunnelStrip, SenateRemoved } from '../components/ReviewFilterBar';
import MemberProvider from '../components/HgabReviewMember';
import { downloadReviews } from '../lib/hgab-review-export';
import {
  ReviewsApiError, documentHref, fetchMine, fetchSenateStatus, pdfSource, senatePath, type SenateCopyStatus, fetchStatus, sendReview, withdrawReview, type ProjectStatus,
} from '../lib/hgab-review-api';
// Phones only: PDF.js, to draw a document's pages (phone browsers don't show a PDF inside a page).
const HgabPdfPages = lazy(() => import('../components/HgabPdfPages'));
/** Touch screens (phones and tablets) get those drawn pages too: their browsers show a PDF in a frame poorly or not at all. */
const TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
import {
  DocLinkContext, SenateBlockContext, senateRegion, useDocLink, useMember, useSenateBlock, type DocBlock, type Member,
} from '../lib/hgab-review-member';
import { heldBackRegion } from '../lib/senate-copies-held-back';
import { HOWTO_ROOT } from '../lib/hgab-review-howto';
import '../hgab-review.css';

const HGAB_BASE = 'hgab/2027';
const loadIndex = () => cached('review-index', () => getJson<ReviewIndex>(dataUrl(`${HGAB_BASE}/${REVIEW_INDEX_PATH}`), 'Failed to load the project list'));
/** The Senate committee report's removals (optional: without them, no SENATE:REMOVED label or Senate filter). */
const loadSenate = () => cached('review-senate', () => getJson<ReviewSenateIndex>(dataUrl(`${HGAB_BASE}/${REVIEW_SENATE_PATH}`), 'Failed to load the Senate removals'));

const loadShard = (seq: number) => {
  const path = detailShardPath(seq);
  return cached(`review-detail:${path}`, () => getJson<ReviewDetailShard>(dataUrl(`${HGAB_BASE}/${path}`), 'Failed to load the project’s documents'));
};
const n = (v: number) => v.toLocaleString('en-US');
/** A count for a tab badge: 15,979 → "16k". */
const tabCount = (v: number) => (v >= 10_000 ? `${Math.round(v / 1000)}k` : v.toLocaleString('en-US'));
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

// --- My reviews (on the server: reviewing needs a sign-in) ----------------------------------------------------

/** A fresh review of a project by this member. */
function caseFor(p: ReviewProject, ix: ReviewIndex, reviewer: Reviewer, pap?: string | null): CaseReview {
  const n = new Date().toISOString();
  const c = newCaseReview({
    caseId: newId(), reviewer, dataBuiltAt: ix.built_at, now: n,
    project: {
      hgab_id: p.hgabId, project_id: p.projectId, budget_source_version: BUDGET_SOURCE_VERSION, title: p.title, office: p.office.name,
      region: p.region, amount_php: p.amount, categories: classifyProject({ title: p.title, pap, program: p.program }),
      detector_rule_ids: p.flags.map((i) => ix.flags[i].code),
    },
  });
  // Whether each key document is on file is what we detected, not something a volunteer sets.
  return { ...c, documents: c.documents.map((d, i) => (hasDoc(p.docs, i) ? { ...d, availability: 'available' } : d)) };
}
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Whether reviewing is open: sign-in set up in this build, and the API taking reviews. */
type Opening = 'loading' | 'open' | 'closed' | 'unreachable';

/**
 * Everyone's review status (`ReviewStatusIndex`): loaded with the page, again when the tab comes back into view and
 * every two minutes while it is in view, so members see what others have taken.
 */
function useStatusIndex(enabled: boolean) {
  const [index, setIndex] = useState<ReviewStatusIndex | null>(null);
  const [opening, setOpening] = useState<Opening>(enabled ? 'loading' : 'closed');
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = () => fetchStatus()
      .then((r) => { if (live) { setIndex(r.data); setOpening('open'); } })
      .catch((e: unknown) => {
        if (!live) return;
        if (e instanceof ReviewsApiError && e.status === 503) { setIndex(null); setOpening('closed'); }
        else setOpening((o) => (o === 'open' ? o : 'unreachable'));
      });
    void load();
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 120_000);
    return () => { live = false; document.removeEventListener('visibilitychange', onVisible); window.clearInterval(timer); };
  }, [enabled]);
  const patch = useCallback((hgabId: string, entry: ProjectStatus | null) => setIndex((prev) => {
    if (!prev) return prev;
    const next = { ...prev };
    if (entry) next[hgabId] = entry; else delete next[hgabId];
    return next;
  }), []);
  return { index, opening, patch };
}

/**
 * The signed-in member's reviews and profile (their id, and the name and role they last gave, to prefill a new
 * review), from the API; saving sends. Nothing is kept in the browser: the keys earlier versions kept reviews under
 * (RETIRED_STORES) are removed.
 */
function useCases(member: Member, onStatus: (hgabId: string, entry: ProjectStatus | null) => void) {
  const [state, setState] = useState<{ userId: string; cases: Record<string, CaseReview>; profile: Reviewer } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    try { for (const k of RETIRED_STORES) localStorage.removeItem(k); } catch { /* storage blocked: nothing was kept */ }
  }, []);
  const { userId, getToken } = member;
  // Tagged with whose they are, so signing out (or in as someone else) drops them.
  const mine = state && state.userId === userId ? state : null;
  useEffect(() => {
    if (!userId) return;
    let live = true;
    getToken().then(fetchMine).then((r) => {
      if (!live) return;
      // Newest first: the role comes from the member's last review.
      const profile = { reviewer_id: r.member.member_id, display_name: r.member.display_name, task_id: r.data[0]?.reviewer.task_id ?? '' };
      setState({ userId, cases: Object.fromEntries(r.data.map((c) => [c.project.hgab_id, c])), profile });
      setLoadError(null);
    }).catch((e: unknown) => { if (live) setLoadError(errorText(e)); });
    return () => { live = false; };
  }, [userId, getToken]);

  /** Sends a review, or withdraws it once emptied, so the project no longer shows as taken. */
  const save = useCallback(async (r: CaseReview): Promise<SaveResult> => {
    const h = r.project.hgab_id;
    if (!userId || !mine) return { ok: false, review: r, error: 'Sign in to save your review.' };
    try {
      const token = await getToken();
      if (caseTouched(r)) {
        const res = await sendReview(r, token);
        setState((s) => s && {
          ...s, cases: { ...s.cases, [h]: res.data }, profile: { ...s.profile, display_name: r.reviewer.display_name, task_id: r.reviewer.task_id },
        });
        onStatus(h, res.project);
        return { ok: true, review: res.data };
      }
      const sent = mine.cases[h];
      if (sent) {
        const res = await withdrawReview(sent.case_id, token);
        setState((s) => { if (!s) return s; const cases = { ...s.cases }; delete cases[h]; return { ...s, cases }; });
        onStatus(h, res.project);
      }
      return { ok: true, review: r };
    } catch (e) {
      return { ok: false, review: r, error: errorText(e), issues: e instanceof ReviewsApiError ? e.issues : [] };
    }
  }, [userId, mine, getToken, onStatus]);

  return { cases: mine?.cases ?? {}, profile: mine?.profile ?? null, save, loadError };
}


// --- Filters and the funnel: the filter bar is src/components/ReviewFilterBar.tsx, shared with the Senate projects.

/**
 * How far the review has gone: House insertions (our comparison), NEP only, and all projects. Counted over every
 * project, whatever the funnel, auto-reviewed ones included. A card opens its pending projects in the funnel.
 */
function ReviewProgress({ all, statusOf, onPick }: { all: ReviewProject[]; statusOf: (h: string) => ListStatus; onPick: (g: ProgressGroup | null) => void }) {
  const { groups, total } = useMemo(() => reviewProgress(all, statusOf), [all, statusOf]);
  const pct = (r: ProgressRow) => (r.projects ? Math.round((r.reviewed / r.projects) * 100) : 0);
  const card = (g: ProgressGroup | null, r: ProgressRow, main: boolean) => {
    const name = g ? PROGRESS_GROUP_LABEL[g] : 'All projects';
    const detail = [
      g ? PROGRESS_GROUP_NOTE[g] : 'Every DPWH project in the House bill',
      `${n(r.pending)} pending of ${n(r.projects)} (${pesoShort(r.pending_php)})`,
      r.needs_immediate_attention ? `${n(r.needs_immediate_attention)} need immediate attention (members)` : '',
      r.needs_attention ? `${n(r.needs_attention)} need attention (members)` : '',
      r.auto ? `${n(r.auto)} need attention, auto-reviewed` : '',
      r.satisfactory ? `${n(r.satisfactory)} satisfactory` : '',
      r.no_final_status ? `${n(r.no_final_status)} reviewed, no final status` : '',
      'Click to list the pending ones.',
    ].filter(Boolean).join('\n');
    return (
      <li key={g ?? 'all'} className={`rv-prog ${main ? 'is-main' : ''}`}>
        <button type="button" onClick={() => onPick(g)} disabled={!r.pending} title={detail} aria-label={detail.replace(/\n/g, '. ')}>
          <span className="rv-prog-head"><b>{name}</b></span>
          <span className="rv-prog-bar" aria-hidden="true">
            <span className="is-auto" style={{ width: `${(r.auto / Math.max(1, r.projects)) * 100}%` }} />
            <span className="is-needs_immediate_attention" style={{ width: `${(r.needs_immediate_attention / Math.max(1, r.projects)) * 100}%` }} />
            <span className="is-needs_attention" style={{ width: `${(r.needs_attention / Math.max(1, r.projects)) * 100}%` }} />
            <span className="is-satisfactory" style={{ width: `${(r.satisfactory / Math.max(1, r.projects)) * 100}%` }} />
            <span className="is-reviewed" style={{ width: `${(r.no_final_status / Math.max(1, r.projects)) * 100}%` }} />
          </span>
          <span className="rv-prog-foot"><span><b>{n(r.pending)}</b>/{n(r.projects)} · {pct(r)}%</span><span>{pesoShort(r.pending_php)}</span></span>
        </button>
      </li>
    );
  };
  return (
    <section className="rv-progress" aria-label="Review progress">
      <h2 className="rv-h">Review progress</h2>
      <ul>
        {card('insertion', groups.insertion, true)}
        {card('nep', groups.nep, true)}
        {card(null, total, false)}
      </ul>
    </section>
  );
}


/** The funnel, left to right: every project, then what each step keeps. */
// --- Project list -----------------------------------------------------------------------------------------------

function DocDots({ mask, unchecked = false }: { mask: number; unchecked?: boolean }) {
  // Nobody looked for these documents: say so, rather than five empty dots.
  if (unchecked) return <span className="rv-unchecked" title="Outside research.bettergov.ph’s document check: nobody has looked for its documents yet">docs not checked</span>;
  return (
    <span className="rv-dots" role="img" aria-label={`${docCount(mask)} of 5 key documents: ${NAMED_TYPES.filter((_, i) => hasDoc(mask, i)).join(', ') || 'none'}`}>
      {NAMED_TYPES.map((t, i) => <i key={t} className={hasDoc(mask, i) ? 'is-on' : ''} title={`${t}: ${hasDoc(mask, i) ? 'found' : 'not found'}`} />)}
    </span>
  );
}

/** One page of the list. The parent keys it by funnel, sort and page, so each page starts at the top. */
function ProjectList({ projects, selected, statusOf, reviewsOf, verdictsOf, mine, onOpen }: {
  projects: ReviewProject[];
  selected: string | null;
  statusOf: (hgabId: string) => ListStatus;
  /** How many members have a review of a project (0 when only this browser's reviews are known). */
  reviewsOf: (hgabId: string) => number;
  /** How many reviews gave each final status. */
  verdictsOf: (hgabId: string) => VerdictCounts | undefined;
  mine: Readonly<Record<string, CaseReview>>;
  onOpen: (p: ReviewProject) => void;
}) {
  // Keep the open project in view when it moves (keyboard).
  useEffect(() => { document.getElementById(`rv-item-${selected}`)?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  if (!projects.length) return <p className="rv-empty">No project passes every step. Remove a step to see more.</p>;
  return (
    <ul className="rv-items">
      {projects.map((p) => {
        const st = statusOf(p.hgabId);
        return (
          <li key={p.hgabId} id={`rv-item-${p.hgabId}`}>
            <button type="button" className={`rv-item ${p.hgabId === selected ? 'is-on' : ''} ${isReviewed(st) ? `is-reviewed is-${st}` : ''}`} onClick={() => onOpen(p)} aria-current={p.hgabId === selected ? 'true' : undefined}>
              {isReviewed(st) && (
                <span className={`rv-item-badge is-${st}`} title={verdictNote(verdictsOf(p.hgabId))}>
                  {st === 'auto_red_flag'
                    ? <>{LIST_STATUS_LABEL.auto_red_flag}{p.auto && <b> · score {p.auto.score}</b>}</>
                    : <>{LIST_STATUS_LABEL[st]}{reviewsOf(p.hgabId) > 1 && <> · {n(reviewsOf(p.hgabId))} reviews</>}</>}
                </span>
              )}
              <span className="rv-item-title">{p.title}</span>
              <span className="rv-item-meta" title={officeLine(p.office, 99)}>{officeLine(p.office, 1)} · {p.region}</span>
              <span className="rv-item-foot">
                <b>{pesoShort(p.amount)}</b>
                <span className={`rv-flagcount ${p.flags.length >= 5 ? 'is-many' : ''}`}>{p.flags.length} {p.flags.length === 1 ? 'flag' : 'flags'}</span>
                <DocDots mask={p.docs} unchecked={p.unchecked} />
                {p.senate === 'removed' && <SenateRemoved page={p.senatePage} />}
                {mine[p.hgabId] && <span className="rv-yours">Yours</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Page numbers under the list: first, last and two either side of this one, with previous and next. */
function Pager({ page, total, items, onPage }: { page: number; total: number; items: number; onPage: (p: number) => void }) {
  if (items <= PAGE_SIZE) return null;
  const from = (page - 1) * PAGE_SIZE + 1, to = Math.min(items, page * PAGE_SIZE);
  return (
    <nav className="rv-pager" aria-label="Pages">
      <span className="rv-pager-range">{n(from)}–{n(to)} of {n(items)}</span>
      <div className="rv-pager-pages">
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">‹</button>
        {pageWindow(page, total).map((x, i) => (x == null
          ? <span key={`gap${i}`} className="rv-pager-gap" aria-hidden="true">…</span>
          : <button key={x} type="button" className={x === page ? 'is-on' : ''} aria-current={x === page ? 'page' : undefined} onClick={() => onPage(x)}>{n(x)}</button>))}
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= total} aria-label="Next page">›</button>
      </div>
    </nav>
  );
}

// --- One project ------------------------------------------------------------------------------------------------

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

/** The project's files in viewing order: the five key types, then the rest; current copies before earlier ones. */
function viewOrder(files: readonly DetailFile[]): DetailFile[] {
  const rank = (t: string) => { const i = (NAMED_TYPES as readonly string[]).indexOf(t); return i < 0 ? 99 : i; };
  return [...files].sort((a, b) => rank(a[2]) - rank(b[2]) || Number(a[7]) - Number(b[7]) || a[0].localeCompare(b[0]) || a[4].localeCompare(b[4]));
}

/**
 * Above the document: a tab per kind of document (with its count), the files of the open kind when it has several,
 * and previous / next through every file ([ and ] on the keyboard).
 */
function DocSwitcher({ files, file, onPick }: { files: readonly DetailFile[]; file: DetailFile | null; onPick: (f: DetailFile) => void }) {
  const block = useSenateBlock();
  const ordered = viewOrder(files);
  const groups = [...NAMED_TYPES, 'Other'].map((t) => ({ t, fs: ordered.filter((f) => f[2] === t) })).filter((g) => g.fs.length);
  const at = file ? ordered.findIndex((f) => f[5] === file[5]) : -1;
  const kind = file?.[2] ?? null;
  const siblings = groups.find((g) => g.t === kind)?.fs ?? [];
  if (!ordered.length) return null;
  return (
    <div className="rv-docbar">
      <div className="rv-docbar-row">
        <div className="rv-doctabs" role="tablist" aria-label="Documents">
          {groups.map((g) => {
            const on = kind === g.t;
            return (
              <button key={g.t} type="button" role="tab" aria-selected={on} className={on ? 'is-on' : ''}
                title={NAMED_MEANING[g.t as (typeof NAMED_TYPES)[number]] ?? 'Other files'}
                onClick={() => onPick(on && file ? file : g.fs[0])}>
                {g.t === 'Other' ? 'Other' : NAMED_SHORT[g.t as (typeof NAMED_TYPES)[number]]}
                {g.fs.length > 1 && <small>{g.fs.length}</small>}
              </button>
            );
          })}
        </div>
        <div className="rv-docnav">
          <button type="button" onClick={() => onPick(ordered[at - 1])} disabled={at <= 0} aria-label="Previous document ([)" title="Previous document ([)">‹</button>
          <span>{at >= 0 ? `${at + 1} of ${ordered.length}` : `${ordered.length} files`}</span>
          <button type="button" onClick={() => onPick(ordered[at + 1] ?? ordered[0])} disabled={at >= ordered.length - 1} aria-label="Next document (])" title="Next document (])">›</button>
        </div>
      </div>
      {siblings.length > 1 && (
        <ul className="rv-docfiles" aria-label={`${kind} files`}>
          {siblings.map((f) => (
            <li key={f[5]}>
              <button type="button" className={f[5] === file?.[5] ? 'is-on' : ''} onClick={() => onPick(f)} title={f[4]}>
                <span className={`rv-src is-${f[0]}`}>{SOURCE_LABEL[f[0]]}</span>
                <span className="rv-docfiles-name">{f[2] === 'Other' && f[3] ? f[3] : f[4]}</span>
                {f[7] && <span className="rv-tag">earlier copy</span>}
                {block(f[5]) && <span className="rv-tag is-locked">{block(f[5])!.checking ? 'checking…' : 'not yet available'}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A Senate copy that can't open: not redacted yet, skipped by the redaction (20+ pages, damaged, not a PDF), or in a
 * region held back by hand. It may show signatures and other personal information, so it stays closed.
 */
function HeldBackDoc({ block }: { block: DocBlock }) {
  if (block.checking) return <div className="rv-viewer-empty rv-locked"><p role="status">Checking whether this Senate copy can open…</p></div>;
  return (
    <div className="rv-viewer-empty rv-locked">
      <p><b>This Senate copy isn’t available yet.</b></p>
      <p>We’re redacting the signatures in this copy first, for privacy.</p>
      <p className="rv-muted">DPWH Transparency files, and Senate copies already redacted, open as usual.</p>
    </div>
  );
}

/** The document in a frame. */
function DocFrame({ src, title }: { src: string; title: string }) {
  const [opened] = useState(src);
  return <iframe src={`${opened}#view=FitH`} title={title} />;
}

/** A PDF on a phone: drawn by PDF.js where the page can read the file, else a button to open it. */
function PhonePdf({ href, title }: { href: string; title: string }) {
  const src = pdfSource(href);
  const open = <a className="rv-btn" href={href} target="_blank" rel="noopener noreferrer">Open in a new tab</a>;
  if (!src) return <div className="rv-viewer-empty"><p>This document opens in a new tab.</p>{open}</div>;
  return (
    <Suspense fallback={<div className="rv-viewer-empty"><p role="status">Loading the document…</p></div>}>
      <HgabPdfPages src={src} openHref={href} title={title} />
    </Suspense>
  );
}

function Viewer({ files, keyTypes, file, onPick, onClose, inline, phone = false, unchecked = false }: {
  files: readonly DetailFile[];
  /** Its documents haven't been looked for (ReviewProject.unchecked). */
  unchecked?: boolean;
  keyTypes: number;
  file: DetailFile | null;
  onPick: (f: DetailFile) => void;
  onClose: () => void;
  inline: boolean;
  /** The Documents tab on a phone: pages drawn by PDF.js, no close button. */
  phone?: boolean;
}) {
  const href = useDocLink()(file?.[5] ?? '');
  const held = useSenateBlock()(file?.[5] ?? '');
  const body = (
    <div className="rv-viewer">
      <p className="rv-viewer-count">{unchecked ? 'Documents not checked yet' : <>{files.length} {files.length === 1 ? 'file' : 'files'} · {keyTypes} of 5 key types found</>}</p>
      <DocSwitcher files={files} file={file} onPick={onPick} />
      {file && (
        <div className="rv-viewer-bar">
          <span className={`rv-src is-${file[0]}`}>{SOURCE_LABEL[file[0]]}</span>
          <span className="rv-viewer-name" title={file[4]}>{file[4]}</span>
          <span className={`rv-file-how ${LINK_WEAK.has(file[1]) ? 'is-weak' : ''}`}>{LINK_LABEL[file[1]]}</span>
          {href && <a href={href} target="_blank" rel="noopener noreferrer">{phone ? 'Open ↗' : 'Open in a new tab'}</a>}
          {!phone && <button type="button" onClick={onClose} aria-label="Close the document">×</button>}
        </div>
      )}
      {!file
        ? <div className="rv-viewer-empty"><p>{files.length ? 'Pick a document above to read it here.' : unchecked ? 'Nobody has looked for this project’s documents yet: it is outside research.bettergov.ph’s document check.' : 'We found no files for this project.'}</p></div>
        : held || !href
          ? <HeldBackDoc block={held ?? { region: null, checking: false }} />
          : isPdf(file) && (phone || TOUCH)
            ? <PhonePdf key={file[5]} href={href} title={file[4]} />
          : isPdf(file)
            ? <DocFrame key={file[5]} src={href} title={file[4]} />
            : <p className="rv-empty">This file can’t be shown here. <a href={href} target="_blank" rel="noopener noreferrer">Open it</a>.</p>}
    </div>
  );
  return inline ? body : <div className="rv-viewer-modal" role="dialog" aria-label={file?.[4] ?? 'Documents'}>{body}</div>;
}

/**
 * The review form for one project, for a signed-in member, holding the draft until it is saved. Edits made while a
 * save is on its way are kept. Nothing is kept in the browser, so leaving the page with unsaved edits asks first.
 */
function CasePanel({ project, detail, index, mine, profile, onSave }: {
  project: ReviewProject;
  detail: ReviewDetail;
  index: ReviewIndex;
  mine: CaseReview | undefined;
  profile: Reviewer;
  onSave: (r: CaseReview) => Promise<SaveResult>;
}) {
  const [draft, setDraft] = useState<CaseReview>(() => mine ?? caseFor(project, index, profile, detail.pap));
  const latest = useRef(draft);
  const [saved, setSaved] = useState(!!mine);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const dirty = !saved && caseTouched(draft);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const change = (r: CaseReview) => { latest.current = r; setDraft(r); setSaved(false); };
  return (
    <HgabReviewForm
      review={draft}
      detail={detail}
      categories={draft.project.categories}
      detectorCodes={draft.project.detector_rule_ids}
      flags={index.flags}
      saved={saved}
      sending={{ busy, result }}
      onChange={change}
      onSave={async (r) => {
        change(r);
        setBusy(true);
        const res = await onSave(r);
        setBusy(false);
        setResult(res);
        if (latest.current === r) { latest.current = res.review; setDraft(res.review); setSaved(res.ok); }
        else if (res.ok) change({ ...latest.current, case_id: res.review.case_id });
      }}
    />
  );
}

/** The Review tab until the member has signed in and their reviews have loaded. */
function ReviewGate({ opening, loadError }: { opening: Opening; loadError: string | null }) {
  const member = useMember();
  if (opening === 'closed') return <p className="rv-muted">Reviewing isn’t open yet. You can still read each project’s documents and red flags.</p>;
  if (opening === 'unreachable') return <p className="rv-error">We couldn’t reach the reviews service. Try again in a moment.</p>;
  if (opening === 'loading' || !member.loaded) return <p className="rv-muted" role="status">Loading…</p>;
  if (member.userId) {
    return loadError ? <p className="rv-error">Couldn’t load your reviews: {loadError}</p> : <p className="rv-muted" role="status">Loading your reviews…</p>;
  }
  return (
    <div className="rv-signin">
      <h3 className="rv-h">Sign in to review</h3>
      <p>Enter your email and we send you a code. There is no password.</p>
      <p>Your review goes to the team, and the project shows as taken so others can pick another.</p>
      <button type="button" className="rv-btn is-primary" onClick={member.signIn}>Sign in</button>
      <p className="rv-howto-link">New here? <Link to={HOWTO_ROOT}>How to review a project</Link>, step by step.</p>
    </div>
  );
}

/** Whether other members have a review of this project, so two people don't do the same one. */
function TakenNote({ entry, mineSent }: { entry: ProjectStatus | undefined; mineSent: boolean }) {
  const others = (entry?.reviews ?? 0) - (mineSent ? 1 : 0);
  if (!entry || others <= 0) return null;
  const verdict = projectVerdict(entry.verdicts);
  return (
    <p className="rv-note rv-taken">
      {others === 1 ? 'Another member has' : `${n(others)} other members have`} a review of this project
      {verdict ? <> (final status: {VERDICT_LABEL[verdict].toLowerCase()}{entry.reviews > 1 ? `; ${verdictNote(entry.verdicts)}` : ''})</> : ' (no final status yet)'}.
      {' '}You can add yours, or pick a project nobody has started.
    </p>
  );
}

/** "1 needs attention, 1 satisfactory": how a project's reviews split, most serious first, for hover text. */
function verdictNote(c: VerdictCounts | undefined): string | undefined {
  if (!c) return undefined;
  const order: Verdict[] = ['needs_immediate_attention', 'needs_attention', 'satisfactory'];
  const parts = order.filter((v) => c[v] > 0).map((v) => `${n(c[v])} ${VERDICT_LABEL[v].toLowerCase()}`);
  return parts.length ? parts.join(', ') : undefined;
}

/** Width of the project beside the document viewer, kept in this browser; the divider between them sets it. */
const SPLIT_KEY = 'hgab-review:split';
const SPLIT_DEFAULT = 460, SPLIT_MIN = 420, VIEWER_MIN = 320;
function useSplit(): [number, (w: number) => void] {
  const [w, setW] = useState(() => { const v = Number(typeof localStorage !== 'undefined' ? localStorage.getItem(SPLIT_KEY) : NaN); return Number.isFinite(v) && v >= SPLIT_MIN ? v : SPLIT_DEFAULT; });
  const set = useCallback((x: number) => { setW(x); try { localStorage.setItem(SPLIT_KEY, String(Math.round(x))); } catch { /* ignore */ } }, []);
  return [w, set];
}

/**
 * The divider between the project and the document viewer: drag it, or focus it and use the arrow keys (Home and
 * End for the limits); a double click resets it. The viewer's frame ignores the pointer while dragging, or it would
 * swallow the moves.
 */
function SplitHandle({ width, onWidth, container }: { width: number; onWidth: (w: number) => void; container: React.RefObject<HTMLDivElement | null> }) {
  const max = () => Math.max(SPLIT_MIN, (container.current?.getBoundingClientRect().width ?? 1200) - VIEWER_MIN);
  const clamp = (x: number) => Math.min(max(), Math.max(SPLIT_MIN, x));
  return (
    <div
      className="rv-split"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the project and the document"
      aria-valuemin={SPLIT_MIN}
      aria-valuemax={Math.round(max())}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onDoubleClick={() => onWidth(SPLIT_DEFAULT)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 96 : 32;
        if (e.key === 'ArrowLeft') { e.preventDefault(); onWidth(clamp(width - step)); }
        if (e.key === 'ArrowRight') { e.preventDefault(); onWidth(clamp(width + step)); }
        if (e.key === 'Home') { e.preventDefault(); onWidth(SPLIT_MIN); }
        if (e.key === 'End') { e.preventDefault(); onWidth(max()); }
      }}
      onPointerDown={(e) => {
        const box = container.current;
        if (!box || e.button !== 0) return;
        e.preventDefault();
        const left = box.getBoundingClientRect().left;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        box.classList.add('is-resizing');
        const move = (ev: PointerEvent) => onWidth(clamp(ev.clientX - left));
        const up = () => {
          box.classList.remove('is-resizing');
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
    />
  );
}

/** On a phone, what the project pane shows: the bottom tabs other than Projects. */
type PhoneSection = 'project' | 'docs' | 'review';

function ProjectPane({ project, index, mine, entry, opening, profile, loadError, onSave, inlineViewer, onPrev, onNext, split, onSplit, phone, section, onSection }: {
  project: ReviewProject;
  index: ReviewIndex;
  /** The signed-in member's review of this project. */
  mine: CaseReview | undefined;
  /** Every member's reviews of this project. */
  entry: ProjectStatus | undefined;
  opening: Opening;
  /** The signed-in member, once their reviews have loaded; null until then (or signed out). */
  profile: Reviewer | null;
  loadError: string | null;
  onSave: (r: CaseReview) => Promise<SaveResult>;
  inlineViewer: boolean;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  split: number;
  onSplit: (w: number) => void;
  /** A phone: one section at a time, picked from the bottom tabs. */
  phone: boolean;
  section: PhoneSection;
  onSection: (s: PhoneSection) => void;
}) {
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<DetailFile | null>(null);
  // Which of the project's Senate copies can open (the Worker reads each file's redaction mark); null while asking.
  const [senate, setSenate] = useState<Record<string, SenateCopyStatus> | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Keyed by project in the parent, so state starts empty for each project.
    let live = true;
    loadShard(project.seq).then(async (s) => {
      if (!live) return;
      const d = s[project.hgabId] ?? null;
      setDetail(d);
      if (!d) return;
      const paths = [...new Set(d.files.map((f) => senatePath(f[5])).filter((p): p is string => p != null))];
      // If the Worker can't say, no Senate copy opens.
      const none: Record<string, SenateCopyStatus> = {};
      const st = paths.length ? await fetchSenateStatus(paths).then((r) => r.data).catch(() => none) : none;
      if (!live) return;
      setSenate(st);
      // Open the POW first, from a file that can be shown (one that can't only when there is nothing else).
      const ok = d.files.filter((f) => { const p = senatePath(f[5]); return p == null || (st[p] === 'available' && !heldBackRegion(p)); });
      if (inlineViewer || phone) setOpen(ok.find((f) => f[2] === 'POW' && isPdf(f) && !f[7]) ?? ok.find(isPdf) ?? d.files.find(isPdf) ?? null);
    }).catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [project.hgabId, project.seq, inlineViewer, phone]);
  const [titleOpen, setTitleOpen] = useState(false);
  // On a phone the documents load only once their tab is opened, and stay loaded.
  const [docsSeen, setDocsSeen] = useState(section === 'docs');
  if (phone && section === 'docs' && !docsSeen) setDocsSeen(true);
  // Why a document can't open (null when it can), and its link only when it can: for the viewer, the file list and evidence.
  const blockOf = useCallback((url: string): DocBlock | null => {
    const p = senatePath(url);
    if (p == null) return null;
    if (heldBackRegion(p)) return { region: senateRegion(p), checking: false };
    if (!senate) return { region: senateRegion(p), checking: true };
    return senate[p] === 'available' ? null : { region: senateRegion(p), checking: false };
  }, [senate]);
  const parentLink = useDocLink();
  const linkOf = useCallback((url: string) => (blockOf(url) ? null : parentLink(url)), [blockOf, parentLink]);
  // [ and ] step through the documents, as the arrows above the document do; not while typing.
  useEffect(() => {
    if (!detail?.files.length) return;
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
      if (e.key !== '[' && e.key !== ']') return;
      e.preventDefault();
      const ordered = viewOrder(detail.files);
      setOpen((cur) => {
        const i = cur ? ordered.findIndex((f) => f[5] === cur[5]) : -1;
        return ordered[Math.min(ordered.length - 1, Math.max(0, e.key === ']' ? i + 1 : i < 0 ? 0 : i - 1))];
      });
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [detail]);
  const o = project.office;
  // Our own NEP comparison on this project (review.json), beside the research site's flags in the detail shard.
  const ourFlags = project.flags.map((i) => index.flags[i]).filter((f) => f.source === 'bettergov' && !f.computed);
  const officeName = o.name === 'Central Office' ? 'DPWH Central Office' : `DPWH ${shortOffice(o.name)}`;
  const nFlags = (detail?.flags.length ?? 0) + ourFlags.length;
  return (
    <SenateBlockContext.Provider value={blockOf}>
    <DocLinkContext.Provider value={linkOf}>
    <div ref={box} className={`rv-project ${inlineViewer ? 'has-viewer' : ''} ${phone ? `is-phone show-${section}` : ''}`} style={inlineViewer ? { gridTemplateColumns: `${split}px 8px minmax(${VIEWER_MIN}px, 1fr)` } : undefined}>
      <div className="rv-project-info">
        <div className="rv-project-top">
          <div className="rv-project-nav">
            <button type="button" onClick={onPrev ?? undefined} disabled={!onPrev} aria-label="Previous project (k)">‹ Prev</button>
            <span className="rv-muted">{project.hgabId}</span>
            <button type="button" onClick={onNext ?? undefined} disabled={!onNext} aria-label="Next project (j)">Next ›</button>
          </div>
          {phone ? (
            // On a phone a long title is cut to a line or two, so the project's documents and review keep the screen;
            // tapping it shows it whole.
            <h2 className={`rv-project-title ${titleOpen ? 'is-open' : ''}`}>
              <button type="button" className="rv-title-toggle" aria-expanded={titleOpen} onClick={() => setTitleOpen((o) => !o)}>{project.title}</button>
            </h2>
          ) : <h2 className="rv-project-title">{project.title}</h2>}
          <p className="rv-project-sub"><b>{pesoFull(project.amount)}</b> · {officeName} · {project.region}</p>
          {project.senate === 'removed' && (
            <p className="rv-project-senate"><SenateRemoved page={project.senatePage} /> Cut to zero in the Senate committee report{project.senatePage ? ` (Annex A-4, page ${project.senatePage})` : ''}.</p>
          )}
        </div>

        <div className="rv-project-body">
          {error && <p className="rv-error">{error}</p>}
          <TakenNote entry={entry} mineSent={!!mine} />
          {/* The project, compact; the review follows on the same page. */}
          <section className="rv-overview" aria-label="About the project">
            {project.auto && index.auto && (
              <p className="rv-autobanner is-compact" title={index.auto.note}>
                <b>Red flag · auto-reviewed</b> · score {project.auto.score}
                {project.auto.rules.map((code) => index.auto!.rules.find((x) => x.code === code)).filter(Boolean).map((r) => <span key={r!.code} title={r!.note}> · {r!.label}</span>)}
              </p>
            )}
            <dl className="rv-facts is-compact">
              <div><dt>Districts</dt><dd>{o.districts.length ? <>{o.districts.join(' · ')} <small>{o.tier === 'A' ? 'lone' : `shared by ${o.districts.length}`}</small></> : 'None (Central Office)'}</dd></div>
              <div><dt>Program</dt><dd>{project.program}{detail?.pap ? <small>{detail.pap}</small> : null}</dd></div>
              <div><dt>Bill</dt><dd>
                {detail?.bill_doc ? <a href={pdfUrl(detail.bill_doc, detail.bill_page)} target="_blank" rel="noopener noreferrer">Vol. I-C p. {detail.bill_page}</a> : <>Vol. I-C p. {project.page}</>}
                {' · '}<Link to={recordPath('dpwh', project.projectId)}>NEP and House bill</Link>
              </dd></div>
            </dl>
            {project.unchecked ? <p className="rv-unchecked-note"><b>Documents not checked yet.</b></p> : (
              <ul className="rv-checklist" aria-label="The 5 key documents">
                {NAMED_TYPES.map((t, i) => (
                  <li key={t} className={hasDoc(project.docs, i) ? 'is-on' : ''} title={NAMED_MEANING[t]}>
                    <span aria-hidden="true">{hasDoc(project.docs, i) ? '✓' : '✗'}</span> {NAMED_SHORT[t]}
                    <span className="visually-hidden">{hasDoc(project.docs, i) ? ' found' : ' not found'}</span>
                  </li>
                ))}
              </ul>
            )}
            {detail && detail.notes.map((k) => NOTE_TEXT[k]?.(detail, detail.files)).filter(Boolean).map((t) => <p key={t} className="rv-note">{t}</p>)}
            {detail && nFlags > 0 && (
              <details className="rv-flags">
                <summary>{nFlags} red {nFlags === 1 ? 'flag' : 'flags'}</summary>
                <FlagList detail={detail} index={index} />
                {ourFlags.length > 0 && (
                  <div className="rv-flaggroup rv-ourflags">
                    <h4>From our comparison</h4>
                    <ul>{ourFlags.map((f) => <li key={f.code}><details><summary>{f.label}</summary><p>{f.note}</p></details></li>)}</ul>
                  </div>
                )}
              </details>
            )}
            {!inlineViewer && !phone && detail && detail.files.length > 0 && (
              <div className="rv-next"><button type="button" className="rv-btn" onClick={() => setOpen(viewOrder(detail.files)[0])}>Read the documents</button></div>
            )}
            {phone && (
              <div className="rv-phone-next">
                {detail && detail.files.length > 0 && <button type="button" className="rv-btn" onClick={() => onSection('docs')}>Read the documents ({detail.files.length})</button>}
                <button type="button" className="rv-btn is-primary" onClick={() => onSection('review')}>Review this project</button>
              </div>
            )}
          </section>
          {phone && docsSeen && detail && (
            <section className="rv-phone-docs" aria-label="Documents">
              <Viewer files={detail.files} keyTypes={docCount(project.docs)} unchecked={project.unchecked} file={open} inline phone onPick={setOpen} onClose={() => setOpen(null)} />
            </section>
          )}
          <section className="rv-review" aria-label="Review">
            {!profile
              ? <ReviewGate opening={opening} loadError={loadError} />
              : detail
                ? <CasePanel project={project} detail={detail} index={index} mine={mine} profile={profile} onSave={onSave} />
                : !error && <p className="rv-muted" role="status">Loading the documents…</p>}
          </section>
        </div>
      </div>
      {inlineViewer && <SplitHandle width={split} onWidth={onSplit} container={box} />}
      {detail && !phone && (inlineViewer || open) && <Viewer files={detail.files} keyTypes={docCount(project.docs)} unchecked={project.unchecked} file={open} inline={inlineViewer} onPick={setOpen} onClose={() => setOpen(null)} />}
    </div>
    </DocLinkContext.Provider>
    </SenateBlockContext.Provider>
  );
}

// --- Bar icons ----------------------------------------------------------------------------------------------------

/** Line icons for the bar (24×24, drawn with the text colour); each button that uses one names itself for screen readers. */
const ICON_PATHS = {
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-5', 'M12 8h.01'],
  download: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'],
  signIn: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21c0-3.9 3.6-6 8-6s8 2.1 8 6'],
  reviews: ['M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1z', 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', 'm9 14 2 2 4-4'],
  analysis: ['M3 3v18h18', 'M8 17v-5', 'M13 17V8', 'M18 17v-8'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  project: ['M4 4h16v16H4z', 'M8 9h8', 'M8 13h8', 'M8 17h5'],
  docs: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6', 'M9 13h6', 'M9 17h4'],
} as const;
function Icon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {ICON_PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

// --- The dataset ------------------------------------------------------------------------------------------------

/** The download (npm run build:hgab-review-dataset): projects, documents and red flags; never reviews. */
const DATASET_DIR = `${HGAB_BASE}/documents/downloads`;
const DATASET_STEM = 'house-bill-2027-dpwh';
const DATASET_TABLES: readonly { key: string; label: string }[] = [
  { key: 'projects', label: 'Projects' },
  { key: 'documents', label: 'Documents' },
  { key: 'red-flags', label: 'Red flags' },
];
interface DatasetManifest { as_of: string; files: { key: string; rows?: number; bytes?: number }[] }
const mbText = (b: number | undefined) => (b ? `${(b / 1e6).toFixed(1)} MB` : '');

/**
 * "Download data" in the bar: every DPWH project in the House bill with its documents and red flags, as CSV (and
 * Parquet) for anyone's own analysis. Reads the manifest when opened, for the date and sizes.
 */
function DataDownloads() {
  const [manifest, setManifest] = useState<DatasetManifest | null>(null);
  const load = () => {
    if (manifest) return;
    getJson<DatasetManifest>(dataUrl(`${DATASET_DIR}/manifest.json`), 'Failed to load the dataset list').then(setManifest).catch(() => {});
  };
  const zip = manifest?.files.find((f) => f.key === 'zip');
  const rows = (key: string) => manifest?.files.find((f) => f.key === `${DATASET_STEM}-${key}`)?.rows;
  return (
    <details className="rv-mine rv-data" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) load(); }}>
      <summary className="rv-icon" aria-label="Download data" title="Download data"><Icon name="download" /></summary>
      <div className="rv-mine-menu">
        <p>Every DPWH project in the House bill, with its documents and red flags, for your own analysis.{manifest && <> As of {asOf(manifest.as_of)}.</>}</p>
        <a className="rv-btn is-primary" href={dataUrl(`${DATASET_DIR}/${DATASET_STEM}-dataset.zip`)} download>Everything (CSV, zip{zip ? `, ${mbText(zip.bytes)}` : ''})</a>
        <ul className="rv-data-list">
          {DATASET_TABLES.map((t) => (
            <li key={t.key}>
              <span>{t.label}{rows(t.key) != null && <small> {n(rows(t.key)!)} rows</small>}</span>
              <a href={dataUrl(`${DATASET_DIR}/${DATASET_STEM}-${t.key}.csv`)} download>CSV</a>
              <a href={dataUrl(`${DATASET_DIR}/${DATASET_STEM}-${t.key}.parquet`)} download>Parquet</a>
            </li>
          ))}
        </ul>
        <a href={dataUrl(`${DATASET_DIR}/README.md`)} target="_blank" rel="noopener noreferrer">What each column means (README)</a>
        <p className="rv-muted">Volunteers’ reviews are not included. Senate copies have a link once their signatures are redacted.</p>
      </div>
    </details>
  );
}

// --- About ------------------------------------------------------------------------------------------------------

function About({ index, onClose }: { index: ReviewIndex; onClose: () => void }) {
  return (
    <div className="rv-about" role="dialog" aria-modal="true" aria-label="How the reviewer works">
      <div className="rv-about-card">
        <button type="button" className="rv-about-close" onClick={onClose} aria-label="Close">×</button>
        <h2>How the reviewer works</h2>
        <p><b>New here?</b> <Link to={HOWTO_ROOT}>How to review a project</Link> walks you through it, step by step with screenshots.</p>
        <p>Every DPWH project in the House bill (HB 10858, third reading) is here: {n(index.rows.length)} projects.</p>
        <p>Each comes with the documents found for it and the red flags research.bettergov.ph raised.</p>
        <h3>The funnel</h3>
        <p>Add steps to narrow the list. Each step keeps only the projects that pass it.</p>
        <p>Beside every option is how many projects it would keep. Share the page address to share your funnel.</p>
        <h3>Where the documents come from</h3>
        <ul>
          <li><b>Senate copies:</b> documents DPWH gave the Senate for the House bill’s projects, with signatures redacted. A copy the redaction skipped stays closed.</li>
          <li><b>DPWH Transparency:</b> documents DPWH published for its proposals, paired with the project.</li>
        </ul>
        <p>research.bettergov.ph matched most of them; we added more. Each file says how it was matched.</p>
        <p>Matches can be wrong, and a file being here doesn’t confirm what it says. That is what reviews are for.</p>
        <h3>The questions</h3>
        <p>Each project has the volunteer team’s questions that fit it ({QUESTIONS.length} in all, grouping their {REGISTRY.flags.length} red-flag checks; a proposal, {REGISTRY.questions_source.status.toLowerCase()}).</p>
        <p>Red flags suggest which questions to start with. A suggested question is a candidate, not a finding.</p>
        <p>Each question takes the same answer as the review, and an optional remark.</p>
        <h3>Sending reviews</h3>
        <p>Sign in with your email (we send a code; there is no password). Saving sends your review to the team, and you can keep editing it.</p>
        <p>Each review ends with a final status, <b>Satisfactory</b>, <b>Needs attention</b> or <b>Needs immediate attention</b>, and final remarks. It is what the team reports.</p>
        <p>Each project shows the most serious final status its reviews gave. Projects with no key document and no file show as needing attention automatically until a member reviews them.</p>
        <p>A project a member has reviewed without a final status shows <b>Reviewed</b>. Pick projects nobody has reviewed (“Not yet reviewed”). More than one member can review a project.</p>
        <p>Anyone can browse the projects. Reviewing needs a sign-in, and nothing of your review is kept in your browser.</p>
        <h3>The data</h3>
        <p>Every project here, with its documents and red flags, downloads as CSV or Parquet from <b>Download data</b> in the bar. Volunteers’ reviews are not included.</p>
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

/** The bottom tabs on a phone (up to 900px): the projects, then the open project's sections. */
type Pane = 'list' | PhoneSection;
const PHONE = '(max-width: 900px)';

export default function HgabReview() {
  return <MemberProvider><Reviewer /></MemberProvider>;
}

function Reviewer() {
  const [index, setIndex] = useState<ReviewIndex | null>(null);
  const [senateCuts, setSenateCuts] = useState<ReviewSenateIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const member = useMember();
  // Everyone's review status, and whether reviewing is open (sign-in set up and the API taking reviews).
  const { index: shared, opening, patch: patchStatus } = useStatusIndex(member.enabled);
  const { cases: reviews, profile, save, loadError } = useCases(member, patchStatus);
  const [about, setAbout] = useState(false);
  // A link to a project opens on the project, not the list, on a phone too.
  const [pane, setPane] = useState<Pane>(() => (params.get('p') && typeof window !== 'undefined' && window.matchMedia(PHONE).matches ? 'project' : 'list'));
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const [inlineViewer, setInlineViewer] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)');
    const on = () => setInlineViewer(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    loadIndex().then(setIndex).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    // Optional: the list works without it.
    loadSenate().then(setSenateCuts).catch(() => setSenateCuts(null));
  }, []);

  const all = useMemo(() => (index ? decodeIndex(index, senateCuts) : []), [index, senateCuts]);
  const flagIndex = useMemo(() => new Map((index?.flags ?? []).map((f, i) => [f.code, i])), [index]);
  const steps = useMemo(() => stepsFromSearch(params, new Set(flagIndex.keys())), [params, flagIndex]);
  // A project's status is its final status from every member's review (the status API, patched after each save; this
  // member's own review until the list has it). Without one: in progress if a member has a review, else the automatic
  // review's red flag (D1's review_auto through the status API, or review.json's where D1 hasn't been synced).
  const autoRows = index?.auto?.rows;
  const statusOf = useCallback((h: string): ListStatus => {
    const entry = shared?.[h], own = reviews[h];
    const verdict = entry ? projectVerdict(entry.verdicts) : own?.verdict ?? null;
    return listStatus(verdict, (entry?.reviews ?? 0) > 0 || !!own, !!entry?.auto || !!autoRows?.[h]);
  }, [reviews, shared, autoRows]);
  const verdictsOf = useCallback((h: string) => shared?.[h]?.verdicts, [shared]);
  const reviewsOf = useCallback((h: string) => shared?.[h]?.reviews ?? 0, [shared]);
  // Team question → the detector flags (as review.json indexes) that suggest it: the "Questions" filter.
  const teamIndex = useMemo(() => new Map(QUESTIONS.map((q) => [q.id, detectorsForQuestion(q.id).map((c) => flagIndex.get(c)).filter((i): i is number => i != null)])), [flagIndex]);
  // "Show my reviews": the projects the signed-in member has a review of.
  const isMine = useCallback((h: string) => !!reviews[h], [reviews]);
  const ctx = useMemo(() => ({ flagIndex, statusOf, teamIndex, isMine }), [flagIndex, statusOf, teamIndex, isMine]);
  const levels = useMemo(() => runFunnel(all, steps, ctx), [all, steps, ctx]);
  const sort = (params.get('sort') as SortKey) in SORT_LABEL ? (params.get('sort') as SortKey) : DEFAULT_SORT;
  const current = levels[levels.length - 1].projects;
  const listed = useMemo(() => sortProjects(current, sort, statusOf), [current, sort, statusOf]);
  // A project opens by its House bill row id or by its comparison row id (`house-reading:N`), as the multi-purpose
  // buildings documents page and its CSV link it; the address then settles on the House bill row id.
  const askedId = params.get('p');
  const selected = useMemo(() => (askedId ? all.find((p) => p.hgabId === askedId) ?? all.find((p) => p.projectId === askedId) ?? null : null), [all, askedId]);
  const selectedId = selected?.hgabId ?? askedId;
  const [split, setSplit] = useSplit();
  // Pages of PAGE_SIZE: `pg=` in the URL, else the page holding the open project.
  const pages = pageCount(listed.length);
  const selectedAt = listed.findIndex((p) => p.hgabId === selectedId);
  const pgParam = Number(params.get('pg'));
  const page = Math.min(pages, Math.max(1, Number.isInteger(pgParam) && pgParam > 0 ? pgParam : selectedAt >= 0 ? pageOf(selectedAt) : 1));
  const pageItems = useMemo(() => listed.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [listed, page]);

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
    update((p) => { p.delete('s'); p.delete('pg'); next.forEach((s) => p.append('s', stepToParam(s))); });
  };
  // Opening a project (j / k included) turns to the page it is on.
  const open = useCallback((p: ReviewProject) => {
    const i = listed.findIndex((x) => x.hgabId === p.hgabId);
    update((q) => { q.set('p', p.hgabId); q.delete('tab'); if (i >= 0) q.set('pg', String(pageOf(i))); }, true);
    setPane('project');
  }, [update, listed]);
  useEffect(() => {
    if (selected && askedId !== selected.hgabId) update((q) => q.set('p', selected.hgabId), true);
  }, [selected, askedId, update]);
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
    <DocLinkContext.Provider value={documentHref}>
    <div className={`rv-app on-${pane}`}>
      <header className="rv-bar">
        <Link to="/" className="rv-brand"><img src="https://assets.bettergov.ph/logos/png/horizontal-primary.png" alt="BetterGov.ph" /></Link>
        <div className="rv-bar-title">
          <h1>{REVIEW_TITLE}</h1>
          <span>DPWH projects in the FY2027 House bill · HB 10858</span>
        </div>
        <nav className="rv-bar-links" aria-label="Reviewer">
          {/* The guide, in words, so newcomers see it first (the maintainer, 2026-11-18; it replaced the "How it works" icon). */}
          <Link to={HOWTO_ROOT} className="rv-bar-howto" title="How to review a project, step by step with screenshots">
            <Icon name="info" /><span className="rv-howto-long">How to review a project</span><span className="rv-howto-short">How to review</span>
          </Link>
          <DataDownloads />
          {opening === 'open' && member.loaded && !member.userId && (
            <button type="button" className="rv-icon" onClick={member.signIn} aria-label="Sign in to review" title="Sign in to review"><Icon name="signIn" /></button>
          )}
          {member.userId && (
            <details className="rv-mine">
              <summary className="rv-icon" aria-label={`My reviews: ${n(myList.length)}`} title="My reviews">
                <Icon name="reviews" />{myList.length > 0 && <b className="rv-badge" aria-hidden="true">{myList.length > 99 ? '99+' : myList.length}</b>}
              </summary>
              <div className="rv-mine-menu">
                <p className="rv-mine-who">Signed in as <b>{member.email ?? 'a member'}</b></p>
                {loadError && <p className="rv-error">Couldn’t load your reviews: {loadError}</p>}
                {myList.length ? (
                  <>
                    <p>{n(myList.length)} {myList.length === 1 ? 'review' : 'reviews'} sent to the team.</p>
                    <button type="button" className="rv-btn" onClick={() => { applySteps((cur) => (cur.some((x) => x.kind === 'mine') ? cur : [...cur, { kind: 'mine' }])); setPane('list'); }}>Show my reviews</button>
                    <button type="button" className="rv-btn" onClick={() => downloadReviews(myList, 'bettergov-my-house-bill-reviews')}>Download my reviews (CSV)</button>
                  </>
                ) : <p>No reviews yet. Open a project and work through its review checklist.</p>}
                <button type="button" className="rv-btn" onClick={member.signOut}>Sign out</button>
              </div>
            </details>
          )}
          <Link to={`${HGAB_ROOT}/overview`} className="rv-icon" aria-label="House bill analysis" title="House bill analysis"><Icon name="analysis" /></Link>
        </nav>
      </header>

      {error && <p className="rv-error rv-pad">{error}</p>}
      {!index && !error && <p className="rv-muted rv-pad" role="status">Loading the House bill’s DPWH projects…</p>}
      {index && (
        <>
        <div className="rv-filterbar">
          <FilterBar key={params.getAll('s').filter((x) => x.startsWith('q:')).join()} ix={index} all={all} steps={steps} current={current} ctx={ctx}
            presets={presets} shared={!!shared} onSteps={(fn) => { applySteps(fn); setPane('list'); }} />
          <FunnelStrip
            levels={levels}
            flags={index.flags}
            offices={index.offices}
            onRemove={(i) => applySteps((cur) => cur.filter((_, j) => j !== i))}
            onFlip={(i) => applySteps((cur) => cur.map((s, j) => (j === i && s.kind === 'flag' ? { ...s, not: !s.not } : s)))}
          />
          <ReviewProgress all={all} statusOf={statusOf}
            onPick={(g) => applySteps(() => [
              ...(g ? [{ kind: 'flag', code: INSERTION_FLAG, not: g === 'nep' } as Step] : []),
              { kind: 'status', values: [...NOT_REVIEWED_STATUSES] },
            ])} />
        </div>
        <div className={`rv-cols show-${pane}`}>
          <section className="rv-list" aria-label="Projects">
            <div className="rv-list-head">
              <p><b>{n(current.length)}</b> {current.length === 1 ? 'project' : 'projects'} · {pesoShort(levels[levels.length - 1].amount)}</p>
              <label>
                <span className="visually-hidden">Sort</span>
                <select value={sort} onChange={(e) => update((p) => { if (e.target.value === DEFAULT_SORT) p.delete('sort'); else p.set('sort', e.target.value); p.delete('pg'); }, true)}>
                  {Object.entries(SORT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
            </div>
            <ProjectList key={`${steps.map(stepToParam).join('|')}|${sort}|${page}`} projects={pageItems} selected={selectedId} statusOf={statusOf} reviewsOf={reviewsOf} verdictsOf={verdictsOf} mine={reviews} onOpen={open} />
            <Pager page={page} total={pages} items={listed.length} onPage={(x) => update((q) => q.set('pg', String(x)))} />
          </section>

          <section className="rv-detail" aria-label="Project">
            {selected
              ? <ProjectPane key={selected.hgabId} project={selected} index={index} mine={reviews[selected.hgabId]} profile={profile} onSave={save}
                  entry={shared?.[selected.hgabId]} opening={opening} loadError={loadError}
                  inlineViewer={inlineViewer} onPrev={prev} onNext={next} split={split} onSplit={setSplit}
                  phone={phone} section={pane === 'list' ? 'project' : pane} onSection={setPane} />
              : (
                <div className="rv-welcome">
                  <h2>Pick a project to review</h2>
                  <p>Narrow the list with the filters above. Each one you add is a step in the funnel, with what it keeps.</p>
                  <p>Then open each document and fill in your review. Use <kbd>j</kbd> and <kbd>k</kbd> to move between projects.</p>
                  {listed.length > 0 && <button type="button" className="rv-btn is-primary" onClick={() => open(listed[0])}>Open the first project</button>}
                  <p className="rv-howto-link">New here? <Link to={HOWTO_ROOT}>How to review a project</Link>, step by step. Or read <button type="button" className="rv-linkbtn" onClick={() => setAbout(true)}>how the reviewer works</button>: the data and where it comes from.</p>
                  <DisclaimerNotice compact className="rv-disclaimer" />
                </div>
              )}
          </section>

          <nav className="rv-panes" aria-label="Panels">
            {([
              ['list', 'Projects', 'list', tabCount(current.length)],
              ['project', 'Project', 'project', null],
              ['docs', 'Documents', 'docs', selected?.files ? String(selected.files) : null],
              ['review', 'Review', 'reviews', selected && reviews[selected.hgabId] ? '✓' : null],
            ] as const).map(([key, label, icon, badge]) => (
              <button key={key} type="button" className={pane === key ? 'is-on' : ''} aria-current={pane === key ? 'page' : undefined}
                onClick={() => setPane(key)} disabled={key !== 'list' && !selected}>
                <Icon name={icon} />
                <span>{label}{badge && <b>{badge}</b>}</span>
              </button>
            ))}
          </nav>
        </div>
        </>
      )}
      {about && index && <About index={index} onClose={() => setAbout(false)} />}
    </div>
    </DocLinkContext.Provider>
  );
}
