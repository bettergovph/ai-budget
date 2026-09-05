import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader';
import SiteFooter from '../components/SiteFooter';
import {
  fetchHearing,
  fetchBrief,
  fetchSections,
  fetchTranscript,
  formatMs,
  formatDate,
  formatPeso,
  groupBlocks,
  transcriptSourceLabel,
  type Hearing,
  type HearingBrief,
  type HearingSection,
  type HearingSections,
  type HearingTopic,
  type TranscriptBlock,
} from '../lib/hearings';
import '../nep2027.css';
import '../hearings.css';

/* --- minimal YouTube IFrame Player API bridge --------------------------- */

interface YTPlayer {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  getCurrentTime(): number;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement | string,
    opts: {
      videoId: string;
      playerVars?: Record<string, string | number>;
      events?: { onReady?: () => void };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeApi(): Promise<YTNamespace> {
  ytApiPromise ??= new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

/* --- sections helpers ---------------------------------------------------- */

type PanelTab = 'topics' | 'timeline' | 'brief';

const TAB_LABELS: Record<PanelTab, string> = {
  topics: 'By topic',
  timeline: 'Timeline',
  brief: 'Analyst brief',
};

/**
 * Index of the section the playhead (`t` seconds) is in: the last section
 * that has started. Sections are ordered but not strictly contiguous (the
 * generator leaves ~20 s gaps at window boundaries), so a section stays
 * active until the next one begins; -1 before the first or after the last.
 */
function findSection(list: HearingSection[], t: number): number {
  let lo = 0;
  let hi = list.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].start_seconds <= t) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx === -1) return -1;
  if (idx === list.length - 1 && t > list[idx].end_seconds) return -1;
  // A short suspension or ruling can sit nested inside a longer section, so
  // the last-started section is not always the one actually running. If it has
  // already ended, fall back to an enclosing section that is still open.
  if (t > list[idx].end_seconds) {
    for (let i = idx - 1; i >= 0 && idx - i <= 4; i -= 1) {
      if (t <= list[i].end_seconds) return i;
    }
  }
  return idx;
}

/** Keep `el` visible inside `container` (like scrollIntoView "nearest") without
 *  moving the window — the transcript and record panel are their own scroll
 *  boxes, and on small screens the window must stay where the user put it. */
function revealWithin(container: HTMLElement, el: HTMLElement) {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top < c.top) container.scrollTop += r.top - c.top;
  else if (r.bottom > c.bottom) container.scrollTop += r.bottom - c.bottom;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface TopicsTabProps {
  topics: HearingTopic[];
  seek: (ms: number) => void;
  goToSection: (index: number) => void;
}

function TopicsTab({ topics, seek, goToSection }: TopicsTabProps) {
  return (
    <ol className="hearing-topic-list">
      {topics.map((t, i) => {
        const secs = t.seconds;
        return (
        <li key={i} className="hearing-topic">
          <div className="hearing-topic-head">
            <h3 className="hearing-topic-title">{t.topic}</h3>
            <span className={`hearing-pill status-${t.status}`}>{t.status}</span>
            {t.timestamp && secs != null && (
              <button
                type="button"
                className="hearing-cue"
                onClick={() => seek(secs * 1000)}
                title="Jump to where this first came up"
              >
                {t.timestamp}
              </button>
            )}
          </div>
          <p className="hearing-topic-summary">{t.summary}</p>
          {t.positions.length > 0 && (
            <ul className="hearing-positions">
              {t.positions.map((p, j) => (
                <li key={j}>
                  <strong>{p.who}:</strong> {p.position}
                </li>
              ))}
            </ul>
          )}
          {t.sections.length > 0 && (
            <p className="hearing-secrefs">
              <span className="hearing-secrefs-label">In timeline</span>
              {t.sections.map((idx) => (
                <button
                  key={idx}
                  type="button"
                  className="hearing-secref"
                  onClick={() => goToSection(idx)}
                  aria-label={`Go to section ${idx + 1} in the timeline`}
                >
                  §{idx + 1}
                </button>
              ))}
            </p>
          )}
        </li>
        );
      })}
    </ol>
  );
}

interface TimelineTabProps {
  sections: HearingSection[];
  activeSection: number;
  highlighted: number | null;
  seek: (ms: number) => void;
}

function TimelineTab({ sections, activeSection, highlighted, seek }: TimelineTabProps) {
  return (
    <ol className="hearing-section-list">
      {sections.map((s) => {
        const active = s.index === activeSection;
        const counts = [
          s.exchanges.length && plural(s.exchanges.length, 'exchange'),
          s.figures.length && plural(s.figures.length, 'figure'),
          s.actions.length && plural(s.actions.length, 'action'),
        ].filter(Boolean);
        return (
          <li
            key={s.index}
            data-section={s.index}
            className={`hearing-section${active ? ' active' : ''}${
              s.index === highlighted ? ' flash' : ''
            }`}
            aria-current={active ? 'true' : undefined}
          >
            <div className="hearing-section-head">
              <span className="hearing-section-no">§{s.index + 1}</span>
              <button
                type="button"
                className="hearing-cue"
                onClick={() => seek(s.start_seconds * 1000)}
                title="Jump to the start of this section"
              >
                {s.start}–{s.end}
              </button>
              <span className={`hearing-pill kind-${s.kind}`}>{s.kind}</span>
            </div>
            <h3 className="hearing-section-title">{s.title}</h3>
            <p className="hearing-section-summary">{s.summary}</p>
            {counts.length > 0 && (
              <details className="hearing-section-detail">
                <summary>{counts.join(' · ')}</summary>
                {s.exchanges.length > 0 && (
                  <>
                    <h4>Exchanges</h4>
                    <ul className="hearing-detail-list">
                      {s.exchanges.map((e, i) => (
                        <li key={i}>
                          <button
                            type="button"
                            className="hearing-cue"
                            onClick={() => seek(e.seconds * 1000)}
                          >
                            {e.timestamp}
                          </button>
                          <div className="hearing-detail-body">
                            <p>
                              <strong>{e.asked_by || 'Member'}</strong> asked: {e.question}
                            </p>
                            {e.answer && (
                              <p>
                                <strong>{e.answered_by || 'Agency'}</strong>: {e.answer}
                              </p>
                            )}
                            {e.outcome && (
                              <p className="hearing-outcome">{e.outcome}</p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {s.figures.length > 0 && (
                  <>
                    <h4>Figures</h4>
                    <ul className="hearing-detail-list">
                      {s.figures.map((f, i) => (
                        <li key={i}>
                          <button
                            type="button"
                            className="hearing-cue"
                            onClick={() => seek(f.seconds * 1000)}
                          >
                            {f.timestamp}
                          </button>
                          <div className="hearing-detail-body">
                            <p>
                              <strong className="hearing-figure-amount">{f.amount_text}</strong>
                              {' — '}
                              {f.what}
                              {f.speaker && <span className="fig-context"> — {f.speaker}</span>}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {s.actions.length > 0 && (
                  <>
                    <h4>Actions</h4>
                    <ul className="hearing-detail-list">
                      {s.actions.map((a, i) => (
                        <li key={i}>
                          <button
                            type="button"
                            className="hearing-cue"
                            onClick={() => seek(a.seconds * 1000)}
                          >
                            {a.timestamp}
                          </button>
                          <div className="hearing-detail-body">
                            <p>
                              <span className={`hearing-pill act-${a.kind}`}>
                                {a.kind.replaceAll('_', ' ')}
                              </span>{' '}
                              {a.action}
                              {a.who && <span className="fig-context"> — {a.who}</span>}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* --- page ---------------------------------------------------------------- */

export default function HearingDetail() {
  const { videoId = '' } = useParams();
  const [hearing, setHearing] = useState<Hearing | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [brief, setBrief] = useState<HearingBrief | null>(null);
  const [sections, setSections] = useState<HearingSections | null>(null);
  // sections.json runs to a few hundred KB on the long hearings, so the panel
  // can be several seconds behind the rest of the page. Without this the panel
  // renders nothing while it downloads, which reads as "this hearing has no
  // topics" rather than "still loading".
  const [recordPending, setRecordPending] = useState(true);
  const [blocks, setBlocks] = useState<TranscriptBlock[]>([]);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  // player + active-cue state
  const playerRef = useRef<YTPlayer | null>(null);
  // React owns the wrapper; the YT iframe (created imperatively inside it) is
  // never in React's tree, so re-renders can't disturb it.
  const playerMountRef = useRef<HTMLDivElement | null>(null);
  const blocksRef = useRef<TranscriptBlock[]>([]);
  const sectionsRef = useRef<HearingSection[]>([]);
  const [activeBlock, setActiveBlock] = useState<number>(-1);
  const [activeSection, setActiveSection] = useState<number>(-1);
  const [follow, setFollow] = useState(true);

  // panel below the player: null = "default for what's available"
  const [tabChoice, setTabChoice] = useState<PanelTab | null>(null);
  // a "§n" link was clicked: scroll to + flash that timeline section
  const [highlight, setHighlight] = useState<{ index: number; nonce: number } | null>(null);

  useEffect(() => {
    // Router pushes keep the window's scroll offset, so opening a hearing from
    // a grid the reader has scrolled a long way down lands them mid-page — on
    // mobile, well past the player. Start every hearing at the top.
    window.scrollTo(0, 0);
    setHearing(null);
    setBrief(null);
    setSections(null);
    setRecordPending(true);
    setBlocks([]);
    setNotFound(false);
    setTranscriptError(null);
    setActiveBlock(-1);
    setActiveSection(-1);
    setTabChoice(null);
    setHighlight(null);

    fetchHearing(videoId)
      .then((h) => {
        if (!h) {
          setNotFound(true);
          setRecordPending(false);
          return;
        }
        setHearing(h);
        document.title = `${h.title} · BetterGov Budget`;
        // one update for both so the panel doesn't flip tabs as they arrive
        Promise.all([fetchBrief(videoId), fetchSections(videoId)]).then(
          ([b, s]) => {
            setBrief(b);
            setSections(s);
            setRecordPending(false);
          },
        ).catch(() => setRecordPending(false));
        if (!h.has_transcript) return;
        fetchTranscript(videoId)
          .then((doc) => {
            if (!doc?.segments?.length) {
              setTranscriptError('Transcript unavailable.');
              return;
            }
            const b = groupBlocks(doc.segments);
            setBlocks(b);
          })
          .catch(() => setTranscriptError('Transcript unavailable.'));
      })
      .catch(() => setNotFound(true));
  }, [videoId]);

  // Mount the YouTube player once the hearing data is in (the mount node only
  // exists after that) and the IFrame API has loaded. The player section is
  // rendered conditionally, so this must re-run when `!!hearing` flips.
  const playerReady = !!hearing;
  useEffect(() => {
    if (!playerReady || !videoId) return;
    let cancelled = false;
    let player: YTPlayer | null = null;
    loadYouTubeApi().then((YT) => {
      const wrapper = playerMountRef.current;
      if (cancelled || !wrapper) return;
      const inner = document.createElement('div');
      wrapper.replaceChildren(inner);
      player = new YT.Player(inner, {
        videoId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          // required for the widget's postMessage channel (seek/highlight)
          origin: window.location.origin,
        },
      });
      playerRef.current = player;
    });
    return () => {
      cancelled = true;
      playerRef.current = null;
      try {
        player?.destroy();
      } catch {
        // player was never created or already gone
      }
    };
  }, [playerReady, videoId]);

  // poll playback time → highlight + follow the active block, and highlight
  // the timeline section that contains the playhead
  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const list = blocksRef.current;
      const secs = sectionsRef.current;
      if (!list.length && !secs.length) return;
      let t: number;
      try {
        t = player.getCurrentTime();
      } catch {
        return; // player not ready yet
      }
      if (list.length) {
        const ms = t * 1000;
        let lo = 0;
        let hi = list.length - 1;
        let found = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (ms < list[mid].startMs) hi = mid - 1;
          else if (ms >= list[mid].endMs) lo = mid + 1;
          else {
            found = mid;
            break;
          }
        }
        if (found !== -1) {
          setActiveBlock(found);
          if (follow) {
            const el = document.querySelector<HTMLElement>(
              `[data-block="${found}"]`,
            );
            const box = el?.closest<HTMLElement>('.hearing-transcript');
            if (el && box) revealWithin(box, el);
          }
        }
      }
      if (secs.length) setActiveSection(findSection(secs, t));
    }, 300);
    return () => window.clearInterval(timer);
  }, [follow]);

  // keep the polling loop's refs in sync without touching them during render
  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);
  useEffect(() => {
    sectionsRef.current = sections?.sections ?? [];
  }, [sections]);

  // "§n" from the topic tab: scroll the timeline section into view once the
  // Timeline tab has rendered, and drop the flash after a moment. On desktop
  // the panel is its own scroll box, so scroll just that (scrollIntoView
  // would also move the window and tuck the panel under the site header);
  // on small screens the panel flows in the page, so centre it in the viewport.
  useEffect(() => {
    if (!highlight) return;
    const el = document.querySelector<HTMLElement>(
      `[data-section="${highlight.index}"]`,
    );
    const panel = el?.closest<HTMLElement>('.hearing-panel');
    if (el && panel) {
      const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
      if (getComputedStyle(panel).overflowY === 'auto') {
        const bar = panel.querySelector<HTMLElement>('.hearing-tabs-wrap');
        const offset = (bar?.offsetHeight ?? 0) + 8;
        panel.scrollTo({
          top:
            panel.scrollTop +
            el.getBoundingClientRect().top -
            panel.getBoundingClientRect().top -
            offset,
          behavior,
        });
      } else {
        el.scrollIntoView({ block: 'center', behavior });
      }
    }
    const timer = window.setTimeout(() => setHighlight(null), 2500);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  const seek = useCallback((startMs: number) => {
    const player = playerRef.current;
    if (!player) return;
    try {
      player.seekTo(startMs / 1000, true);
      player.playVideo();
    } catch {
      // player mid-reload — the click can be retried
    }
  }, []);

  const goToSection = useCallback((index: number) => {
    setTabChoice('timeline');
    setHighlight({ index, nonce: Date.now() });
  }, []);

  const secondsToDate = useMemo(
    () => (ms: number) => formatMs(ms),
    [],
  );

  // which tabs can be shown, in display order
  const tabs: PanelTab[] = [];
  if (sections?.topics.length) tabs.push('topics');
  if (sections?.sections.length) tabs.push('timeline');
  if (brief) tabs.push('brief');
  const tab: PanelTab | undefined =
    tabChoice && tabs.includes(tabChoice) ? tabChoice : tabs[0];
  const showTabbedPanel = !!sections && tabs.length > 0;

  const onTabKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!tab) return;
    const i = tabs.indexOf(tab);
    let next: PanelTab | undefined;
    if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
    else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === 'Home') next = tabs[0];
    else if (e.key === 'End') next = tabs[tabs.length - 1];
    if (!next) return;
    e.preventDefault();
    setTabChoice(next);
    document.getElementById(`hearing-tab-${next}`)?.focus();
  };

  const metaNote = useMemo(() => {
    if (!sections) return null;
    const parts = [
      `Built from ${transcriptSourceLabel(
        sections.transcript_source ?? hearing?.transcript_source,
      )}`,
    ];
    if (sections.diarized) parts.push('speaker-labelled');
    if (sections.model) parts.push(sections.model);
    const line = parts.join(' · ');
    const note = sections.extraction?.confidence_note;
    return note ? `${line} — ${note}` : line;
  }, [sections, hearing?.transcript_source]);

  if (notFound) {
    return (
      <div className="hearings-page">
        <SiteHeader crumb="Budget Briefing/Hearings" />
        <main className="nep-main hearings-main">
          <p className="nep-empty">
            Hearing not found. <Link to="/hearings">Back to all hearings</Link>
          </p>
        </main>
        <SiteFooter />
      </div>
    );
  }

  // The analyst brief: rendered on its own when there are no sections, or as
  // the "Analyst brief" tab of the panel when there are.
  const briefPanel = brief && (
    <section className="hearing-brief" aria-label="Analyst brief">
      <h2>Analyst brief — {brief.phase || 'hearing'} figures</h2>
      {brief.headline && (
        <p className="hearing-brief-headline">{brief.headline}</p>
      )}
      {brief.topline?.proposed_fy != null && (
        <div className="hearing-topline">
          <div>
            <span className="hearing-topline-label">
              Proposed FY{brief.fiscal_year}
            </span>
            <span className="hearing-topline-amount">
              {formatPeso(brief.topline.proposed_fy)}
            </span>
          </div>
          {brief.topline.prior_gaa != null && (
            <div>
              <span className="hearing-topline-label">
                Prior year enacted
              </span>
              <span className="hearing-topline-amount">
                {formatPeso(brief.topline.prior_gaa)}
              </span>
            </div>
          )}
          {brief.topline.change_amount != null && (
            <div>
              <span className="hearing-topline-label">Change</span>
              <span
                className={`hearing-topline-amount ${
                  (brief.topline.change_amount ?? 0) < 0
                    ? 'hearing-down'
                    : 'hearing-up'
                }`}
              >
                {formatPeso(brief.topline.change_amount)}
                {brief.topline.change_pct != null &&
                  ` (${brief.topline.change_pct > 0 ? '+' : ''}${brief.topline.change_pct}%)`}
              </span>
            </div>
          )}
        </div>
      )}

      {brief.budget_figures.length > 0 && (
        <div className="hearing-table-scroll">
          <table className="hearing-figures">
          <thead>
            <tr>
              <th>Entity</th>
              <th>Metric</th>
              <th className="num">Amount</th>
              <th className="num">vs prior</th>
              <th>At</th>
            </tr>
          </thead>
          <tbody>
            {brief.budget_figures.map((f, i) => (
              <tr key={i}>
                <td className="fig-entity">{f.entity}</td>
                <td className="fig-metric">
                  {f.metric}
                  {f.context && (
                    <span className="fig-context"> — {f.context}</span>
                  )}
                </td>
                <td className="num">
                  {f.amount != null ? formatPeso(f.amount) : f.amount_text}
                </td>
                <td className="num">
                  {f.change_pct != null &&
                    `${f.change_pct > 0 ? '+' : ''}${f.change_pct}%`}
                </td>
                <td>
                  <button
                    type="button"
                    className="hearing-cue"
                    onClick={() => seek(f.seconds * 1000)}
                    title="Jump to this moment"
                  >
                    {f.timestamp}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      )}

      {brief.issues.length > 0 && (
        <>
          <h3>Issues raised</h3>
          <ul className="hearing-issue-list">
            {brief.issues.map((is, i) => (
              <li key={i}>
                <span className={`hearing-issue-cat cat-${is.category}`}>
                  {is.category.replaceAll('_', ' ')}
                </span>
                {is.description}
                {is.raised_by && (
                  <span className="fig-context"> — {is.raised_by}</span>
                )}
                <button
                  type="button"
                  className="hearing-cue"
                  onClick={() => seek(is.seconds * 1000)}
                >
                  {is.timestamp}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {brief.committee_actions.length > 0 && (
        <>
          <h3>Committee actions &amp; commitments</h3>
          <ul className="hearing-issue-list">
            {brief.committee_actions.map((a, i) => (
              <li key={i}>
                {a.action}
                {a.who && <span className="fig-context"> — {a.who}</span>}
                <button
                  type="button"
                  className="hearing-cue"
                  onClick={() => seek(a.seconds * 1000)}
                >
                  {a.timestamp}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );

  return (
    <div className="hearings-page">
      <SiteHeader crumb="Budget Briefing/Hearings" />
      <main className="nep-main hearings-main hearing-detail" aria-busy={!hearing}>
        {!hearing && (
          <span className="visually-hidden" role="status">Loading the hearing…</span>
        )}
        {hearing && (
          <>
            <nav className="hearing-back">
              <Link to="/hearings">← All hearings</Link>
            </nav>
            <header className="hearing-head">
              <div className="hearing-card-meta">
                {hearing.agency && (
                  <span className="hearing-agency">{hearing.agency}</span>
                )}
                <span className="hearing-date">
                  {formatDate(hearing.published_at)}
                </span>
                {hearing.length_text && (
                  <span className="hearing-date">{hearing.length_text}</span>
                )}
                {hearing.has_summary === 0 && hearing.has_transcript === 1 && (
                  <span className="hearing-pending-inline">Summary pending</span>
                )}
              </div>
              <h1 className="hearing-heading">{hearing.title}</h1>
              {hearing.url && (
                <a
                  className="hearing-yt-link"
                  href={hearing.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Watch on YouTube ↗
                </a>
              )}
            </header>

            <div className="hearing-layout">
              <section className="hearing-player-col" aria-label="Video">
                <div className="hearing-player-frame">
                  <div ref={playerMountRef} />
                </div>

                {recordPending && !sections && !brief && (
                  <section
                    className="hearing-panel hearing-panel-pending"
                    aria-label="Hearing record"
                  >
                    <p className="hearing-transcript-note" role="status">
                      Loading the topics and timeline for this hearing…
                    </p>
                  </section>
                )}

                {showTabbedPanel && sections && tab ? (
                  <section className="hearing-panel" aria-label="Hearing record">
                    <h2 className="hearing-sr-only">Hearing record</h2>
                    {(sections.overview || metaNote) && (
                      <div className="hearing-panel-head">
                        {sections.overview && (
                          <p className="hearing-overview">{sections.overview}</p>
                        )}
                        {metaNote && (
                          <p className="hearing-panel-meta">{metaNote}</p>
                        )}
                      </div>
                    )}
                    <div className="hearing-tabs-wrap">
                      <div
                        className="hearing-tabs"
                        role="tablist"
                        aria-label="Hearing record views"
                        onKeyDown={onTabKeyDown}
                      >
                        {tabs.map((t) => (
                          <button
                            key={t}
                            type="button"
                            role="tab"
                            id={`hearing-tab-${t}`}
                            className="hearing-tab"
                            aria-selected={t === tab}
                            aria-controls={`hearing-tabpanel-${t}`}
                            tabIndex={t === tab ? 0 : -1}
                            onClick={() => setTabChoice(t)}
                          >
                            {TAB_LABELS[t]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div
                      className="hearing-panel-body"
                      role="tabpanel"
                      id={`hearing-tabpanel-${tab}`}
                      aria-labelledby={`hearing-tab-${tab}`}
                    >
                      {tab === 'topics' && (
                        <TopicsTab
                          topics={sections.topics}
                          seek={seek}
                          goToSection={goToSection}
                        />
                      )}
                      {tab === 'timeline' && (
                        <TimelineTab
                          sections={sections.sections}
                          activeSection={activeSection}
                          highlighted={highlight?.index ?? null}
                          seek={seek}
                        />
                      )}
                      {tab === 'brief' && briefPanel}
                    </div>
                  </section>
                ) : (
                  briefPanel
                )}
              </section>

              <section className="hearing-transcript" aria-label="Interactive transcript">
                <div className="hearing-transcript-head">
                  <h2>Transcript</h2>
                  <label className="hearing-follow">
                    <input
                      type="checkbox"
                      checked={follow}
                      onChange={(e) => setFollow(e.target.checked)}
                    />
                    Follow playback
                  </label>
                </div>
                {hearing?.status === 'no_captions' && (
                  <p className="hearing-transcript-note">
                    YouTube hasn&apos;t published captions for this stream yet —
                    the transcript will appear here after the next daily sync.
                  </p>
                )}
                {transcriptError && (
                  <p className="hearing-transcript-note">{transcriptError}</p>
                )}
                {!transcriptError && blocks.length === 0 && (
                  <p className="hearing-transcript-note">Loading transcript…</p>
                )}
                <ol className="hearing-blocks">
                  {blocks.map((b) => (
                    <li key={b.index}>
                      <button
                        type="button"
                        data-block={b.index}
                        className={`hearing-block ${b.index === activeBlock ? 'active' : ''}`}
                        onClick={() => seek(b.startMs)}
                        title="Jump to this moment"
                      >
                        <span className="hearing-block-ts">
                          {secondsToDate(b.startMs)}
                        </span>
                        <span className="hearing-block-text">
                          {b.speaker && (
                            <strong
                              className={`hearing-block-speaker${
                                /^S\d+$/.test(b.speaker) ? ' is-label' : ''
                              }`}
                            >
                              {b.speaker}
                            </strong>
                          )}
                          {b.text}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            </div>

            <p className="nep-provenance hearing-provenance">
              Video and captions from the House of Representatives' YouTube
              channel · <Link to="/hearings">all hearings</Link> ·{' '}
              <Link to="/2027">FY2027 NEP overview</Link>
            </p>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
