import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader';
import SiteFooter from '../components/SiteFooter';
import {
  fetchHearing,
  fetchBrief,
  fetchTranscript,
  formatMs,
  formatDate,
  formatPeso,
  groupBlocks,
  type Hearing,
  type HearingBrief,
  type TranscriptBlock,
} from '../lib/hearings';
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

/* --- page ---------------------------------------------------------------- */

export default function HearingDetail() {
  const { videoId = '' } = useParams();
  const [hearing, setHearing] = useState<Hearing | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [brief, setBrief] = useState<HearingBrief | null>(null);
  const [blocks, setBlocks] = useState<TranscriptBlock[]>([]);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  // player + active-cue state
  const playerRef = useRef<YTPlayer | null>(null);
  // React owns the wrapper; the YT iframe (created imperatively inside it) is
  // never in React's tree, so re-renders can't disturb it.
  const playerMountRef = useRef<HTMLDivElement | null>(null);
  const blocksRef = useRef<TranscriptBlock[]>([]);
  const [activeBlock, setActiveBlock] = useState<number>(-1);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    setHearing(null);
    setBrief(null);
    setBlocks([]);
    setNotFound(false);
    setTranscriptError(null);
    setActiveBlock(-1);

    fetchHearing(videoId)
      .then((h) => {
        if (!h) {
          setNotFound(true);
          return;
        }
        setHearing(h);
        document.title = `${h.title} · BetterGov Budget`;
        fetchBrief(videoId).then(setBrief);
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

  // poll playback time → highlight + follow the active block
  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || !blocksRef.current.length) return;
      let t: number;
      try {
        t = player.getCurrentTime();
      } catch {
        return; // player not ready yet
      }
      const ms = t * 1000;
      const list = blocksRef.current;
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
          document
            .querySelector(`[data-block="${found}"]`)
            ?.scrollIntoView({ block: 'nearest' });
        }
      }
    }, 300);
    return () => window.clearInterval(timer);
  }, [follow]);

  blocksRef.current = blocks;

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

  const secondsToDate = useMemo(
    () => (ms: number) => formatMs(ms),
    [],
  );

  if (notFound) {
    return (
      <div className="hearings-page">
        <SiteHeader crumb="Budget Briefing/Hearings" />
        <main className="hearings-main">
          <p className="hearings-loading">
            Hearing not found. <Link to="/hearings">Back to all hearings</Link>
          </p>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="hearings-page">
      <SiteHeader crumb="Budget Briefing/Hearings" />
      <main className="hearings-main hearing-detail">
        {!hearing && <p className="hearings-loading">Loading…</p>}
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
                {brief && (
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
                        <span className="hearing-block-text">{b.text}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
