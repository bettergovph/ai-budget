/**
 * `/hgab/2027/leaderboard` and `/hgab/2027/leaderboard/:board` — rankings of
 * DPWH district offices (and, on one board, district representatives), each
 * with an image formatted for social sharing.
 *
 *   Gallery: a compact page head, then the boards in `BOARD_SECTIONS` order
 *   as light HTML tiles (kicker, title, the top three with round portraits).
 *   `?region=` narrows every board that ranks district offices.
 *
 *   Board (`?region=&format=`): the share image (`HgabShareCard`, a canvas
 *   drawn at native size and scaled to fit the viewport) beside the format
 *   picker, the region filter, Download / Share / Copy link and the board's
 *   notes; under it the full ranking as an accessible table, the photo
 *   credit, and links to the previous and next boards.
 *
 * Every board, its ranking rule and its wording live in
 * `lib/hgab-leaderboard.ts`, shared with the image renderer, the builder and
 * the Worker's link previews, so the page, the image and the preview always
 * agree. Amounts belong to DPWH district offices; the representative shown
 * holds the district's seat in the 20th Congress; the documents do not say
 * who asked for any project.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { DisclaimerNotice, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import {
  BoardLinks, BoardPager, BoardTile, CardBoundary, CongressTables, MembersTable, RankingTable, RegionsTable, ShiftTable,
} from '../components/HgabLeaderboardBits';
import type { ShareCardApi } from '../components/HgabShareCard';
import { copyText, downloadBlob, shareImage } from '../lib/hgab-share';
import { pageMeta } from '../lib/seo';
import { HGAB_ROOT, REGION_LABELS, REGION_ORDER, loadHgabLeaderboard, type RegionKey } from '../lib/hgab';
import {
  BOARDS, BOARD_SECTIONS, LEADERBOARD_ROOT, SHARE_FORMATS, SHARE_FORMAT_ORDER, boardById, isShareFormat,
  leaderboardPath, rankEntries, rankMembers, rankRegions, residualLine,
  type BoardDef, type LeaderboardData, type ShareFormat,
} from '../lib/hgab-leaderboard';
import '../nep2027.css';
import '../hgab-leaderboard.css';

/** The canvas renderer and its portraits load only on a board page. */
const HgabShareCard = lazy(() => import('../components/HgabShareCard'));

const SITE_ORIGIN = 'https://budget.bettergov.ph';
const SOURCE_LINE =
  'SOURCE: NEP 2027 · HOUSE BILL 10858, THIRD READING · ENACTED BUDGETS (GAA) 2020–2026 · DEO2LEG OFFICE-TO-DISTRICT MAP · BILLS.JURIS.PH';
const NEP_MEANS = 'The NEP is the budget the President submits to Congress each August.';
const NEP_GLOSS = `${NEP_MEANS} The House bill is House Bill 10858, third reading.`;
const SEAT_NOW = 'The representative shown holds the seat now, in the 20th Congress.';
const SEAT_NOTE = `${SEAT_NOW} The 2020 to 2025 budgets were passed by the 18th and 19th Congresses.`;

function isRegionKey(v: string | null): v is RegionKey {
  return v != null && (REGION_ORDER as readonly string[]).includes(v);
}

/** A data string as a sentence: trimmed, with a closing full stop. */
function sentence(s: string | null | undefined): string {
  const t = (s ?? '').trim();
  return !t ? '' : /[.!?]$/.test(t) ? t : `${t}.`;
}

/** The board's money in no district, or null; an older data file without the residual fields gives null, not an error. */
function residualText(data: LeaderboardData, board: BoardDef): string | null {
  try {
    return residualLine(data, board);
  } catch {
    return null;
  }
}

/** Boards that show representatives (and so their photos and the roster credit). */
function showsPeople(board: BoardDef): boolean {
  return board.kind === 'ranking' || board.kind === 'members' || board.kind === 'congress';
}

function regionName(k: string | null): string {
  return k ? REGION_LABELS[k as RegionKey]?.name ?? k : '';
}

export default function HgabLeaderboard() {
  const { board: boardId } = useParams();
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadHgabLeaderboard()
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setErr(String(e?.message || e)); });
    return () => { live = false; };
  }, []);

  const board = boardId ? boardById(boardId) : undefined;
  const rawRegion = params.get('region');
  const region = isRegionKey(rawRegion) && (!board || board.regionFilter) ? rawRegion : null;
  const rawFormat = params.get('format');
  const format: ShareFormat = isShareFormat(rawFormat) ? rawFormat : 'portrait';

  const unknown = Boolean(boardId && !board);
  useEffect(() => {
    const base = pageMeta(pathname).title;
    document.title = unknown ? `Board not found · ${base}` : region ? `${regionName(region)} · ${base}` : base;
  }, [pathname, region, unknown]);

  // Moving between boards keeps this page mounted; start each at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [boardId]);

  // Regions that have at least one ranked office, in REGION_ORDER.
  const regions = useMemo(
    () => (data ? REGION_ORDER.filter((k) => data.entries.some((e) => e.region === k)) : []),
    [data],
  );

  const update = useCallback(
    (patch: { region?: string | null; format?: ShareFormat }) => {
      const next = new URLSearchParams(window.location.search);
      if ('region' in patch) {
        if (patch.region) next.set('region', patch.region);
        else next.delete('region');
      }
      if (patch.format) {
        if (patch.format === 'portrait') next.delete('format');
        else next.set('format', patch.format);
      }
      setParams(next, { replace: true });
    },
    [setParams],
  );

  if (unknown) return <BoardNotFound id={boardId ?? ''} />;
  if (err) return <HgabError message={err} />;
  if (!data) return <HgabLoading what="the leaderboards" />;
  if (!board) return <Gallery data={data} region={region} regions={regions} onRegion={(r) => update({ region: r })} />;
  return (
    <BoardPage
      data={data}
      board={board}
      region={region}
      regions={regions}
      format={format}
      onRegion={(r) => update({ region: r })}
      onFormat={(f) => update({ format: f })}
    />
  );
}

// ---------------------------------------------------------------------------
// Shared controls
// ---------------------------------------------------------------------------

function RegionSelect({
  value,
  regions,
  onChange,
  className = '',
}: {
  value: string | null;
  regions: readonly RegionKey[];
  onChange: (r: string | null) => void;
  className?: string;
}) {
  return (
    <label className={`hgab-lb-select ${className}`.trim()}>
      <span>Region</span>
      <select className="select-input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">All regions</option>
        {regions.map((k) => (
          <option key={k} value={k}>{REGION_LABELS[k].name} ({REGION_LABELS[k].short})</option>
        ))}
      </select>
    </label>
  );
}

function headerMeta(data: LeaderboardData): string {
  return `${BOARDS.length} boards · ${data.totals.units.toLocaleString()} district offices`;
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

function Gallery({
  data,
  region,
  regions,
  onRegion,
}: {
  data: LeaderboardData;
  region: string | null;
  regions: readonly RegionKey[];
  onRegion: (r: string | null) => void;
}) {
  return (
    <>
      <HgabHeader crumb="Leaderboards" compiledMeta={headerMeta(data)} />
      <HgabHero
        compact
        crumb="Leaderboards"
        title="Leaderboards"
        dek={
          <>
            DPWH district offices ranked by their budgets in the 2027 House bill and the NEP, and by enacted
            budgets since 2020. {NEP_MEANS} Each board opens as an image to download and share.
          </>
        }
        note="Amounts belong to DPWH district offices, not to people. The representative shown holds the district’s seat in the 20th Congress. The documents do not say who asked for any project."
      />

      <main className="nep-main hgab-lb-main">
        <div className="hgab-lb-toolbar">
          <RegionSelect value={region} regions={regions} onChange={onRegion} />
          <p>
            {region
              ? `Boards that rank district offices show ${regionName(region)} only. The big picture covers the whole country.`
              : 'Pick a region to rank only its district offices.'}
          </p>
        </div>

        {BOARD_SECTIONS.map((sec) => {
          const boards = BOARDS.filter((b) => b.section === sec.key);
          if (!boards.length) return null;
          return (
            <section key={sec.key} className="hgab-lb-section" aria-labelledby={`hgab-lb-sec-${sec.key}`}>
              <header className="hgab-lb-section-head">
                <h2 id={`hgab-lb-sec-${sec.key}`}>
                  {sec.label} <small>{boards.length} {boards.length === 1 ? 'board' : 'boards'}</small>
                </h2>
                <p>{sec.blurb}</p>
              </header>
              <div className="hgab-lb-grid">
                {boards.map((b) => <BoardTile key={b.id} data={data} board={b} region={region} />)}
              </div>
            </section>
          );
        })}

        {data.notes.length > 0 && (
          <aside className="hgab-lb-notes" aria-labelledby="hgab-lb-notes-h">
            <h2 id="hgab-lb-notes-h">Before you share a board</h2>
            <ul>
              {data.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </aside>
        )}
        <p className="hgab-lb-credit">
          {sentence(data.credits.portraits)} {sentence(data.credits.representatives)}{' '}
          <Link to={`${HGAB_ROOT}/methodology`}>How the figures are built</Link>
        </p>
        <DisclaimerNotice compact offices />
      </main>
      <SiteFooter source={SOURCE_LINE} />
    </>
  );
}

// ---------------------------------------------------------------------------
// One board
// ---------------------------------------------------------------------------

/** Whether this browser can hand an image file to the system share sheet. */
function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([new Blob([''], { type: 'image/png' })], 'board.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

function BoardPage({
  data,
  board,
  region,
  regions,
  format,
  onRegion,
  onFormat,
}: {
  data: LeaderboardData;
  board: BoardDef;
  region: string | null;
  regions: readonly RegionKey[];
  format: ShareFormat;
  onRegion: (r: string | null) => void;
  onFormat: (f: ShareFormat) => void;
}) {
  const fmtDef = SHARE_FORMATS[format];
  const cardKey = `${board.id}|${format}|${region ?? ''}`;
  // The renderer reports when the image is drawn; an api from an earlier
  // format or region never downloads the wrong picture.
  const [ready, setReady] = useState<{ key: string; api: ShareCardApi } | null>(null);
  const api = ready && ready.key === cardKey ? ready.api : null;
  const onReady = useCallback((a: ShareCardApi) => setReady({ key: cardKey, api: a }), [cardKey]);

  const [busy, setBusy] = useState<'download' | 'share' | null>(null);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const [shareable, setShareable] = useState(canShareFiles);
  const [problem, setProblem] = useState<string | null>(null);

  // The masthead is sticky and its height changes with the viewport; the
  // image's height limit subtracts it so the whole image fits on screen.
  const boardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const head = document.querySelector<HTMLElement>('.masthead');
    const root = boardRef.current;
    if (!head || !root || typeof ResizeObserver === 'undefined') return;
    const set = () => root.style.setProperty('--hgab-lb-top', `${Math.round(head.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(head);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const where = region ? regionName(region) : null;
  const titled = where ? `${board.title}: ${where}` : board.title;
  const link = SITE_ORIGIN + leaderboardPath(board.id, { region, format });

  const download = async () => {
    if (!api) return;
    setBusy('download');
    setProblem(null);
    try {
      await downloadBlob(await api.toBlob(), api.fileName);
    } catch {
      setProblem('The image could not be saved. Try again.');
    } finally {
      setBusy(null);
    }
  };
  const share = async () => {
    if (!api) return;
    setBusy('share');
    setProblem(null);
    try {
      const res = await shareImage({ blob: await api.toBlob(), fileName: api.fileName, title: titled, text: board.subtitle, url: link });
      if (res === 'unsupported') {
        setShareable(false);
        setProblem('This browser cannot share images. Download the image instead.');
      }
    } catch {
      setProblem('The image could not be shared. Download it instead.');
    } finally {
      setBusy(null);
    }
  };
  const copy = async () => setCopied((await copyText(link)) ? 'ok' : 'fail');

  const stageStyle = { '--hgab-lb-ratio': `${fmtDef.width} / ${fmtDef.height}`, '--hgab-lb-aspect': fmtDef.width / fmtDef.height } as CSSProperties;
  const crumb = (
    <>
      <Link to={leaderboardPath(undefined, { region })}>Leaderboards</Link>
      <span className="hgab-crumb-sep" aria-hidden="true">·</span>
      <span className="hgab-crumb-here">{board.kicker}</span>
    </>
  );
  const built = data.built_at ? new Date(data.built_at) : null;

  return (
    <>
      <HgabHeader
        crumb={<><Link to={leaderboardPath(undefined, { region })}>Leaderboards</Link> › {board.title}</>}
        compiledMeta={headerMeta(data)}
      />
      <HgabHero compact crumb={crumb} title={titled} dek={board.subtitle} note={residualText(data, board) ?? undefined} />

      <main className="nep-main hgab-lb-main">
        <div className="hgab-lb-board" ref={boardRef}>
          <figure className={`hgab-lb-stage is-${format}`} style={stageStyle}>
            {/* The frame is as wide as the image may be at the viewport's height; the canvas fills it. */}
            <div className="hgab-lb-frame">
              <CardBoundary resetKey={cardKey}>
                <Suspense fallback={<div className="hgab-lb-card-wait" aria-hidden="true" />}>
                  <HgabShareCard data={data} board={board} format={format} region={region} className="hgab-lb-card" onReady={onReady} />
                </Suspense>
              </CardBoundary>
            </div>
            <figcaption className="visually-hidden">
              Image preview of this board, {fmtDef.label}. The table below lists the same figures.
            </figcaption>
          </figure>

          <aside className="hgab-lb-panel" aria-label="Image and sharing">
            <fieldset className="hgab-lb-formats">
              <legend>Image shape</legend>
              <div className="hgab-lb-format-grid">
                {SHARE_FORMAT_ORDER.map((f) => (
                  <label key={f} className={`hgab-lb-format is-${f}`}>
                    <input type="radio" name="hgab-lb-format" value={f} checked={f === format} onChange={() => onFormat(f)} />
                    <span>
                      <i aria-hidden="true" style={{ aspectRatio: `${SHARE_FORMATS[f].width} / ${SHARE_FORMATS[f].height}` }} />
                      <strong>{SHARE_FORMATS[f].label}</strong>
                      <small>{SHARE_FORMATS[f].use}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {board.regionFilter && <RegionSelect value={region} regions={regions} onChange={onRegion} className="is-panel" />}

            <div className="hgab-lb-actions">
              <button type="button" className="hgab-lb-btn is-primary" onClick={download} disabled={!api || busy != null}>
                {busy === 'download' ? 'Preparing…' : 'Download image'}
              </button>
              {shareable && (
                <button type="button" className="hgab-lb-btn" onClick={share} disabled={!api || busy != null}>
                  {busy === 'share' ? 'Preparing…' : 'Share…'}
                </button>
              )}
              <button type="button" className={`hgab-lb-btn ${copied === 'ok' ? 'is-done' : ''}`.trim()} onClick={copy}>
                {copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Could not copy' : 'Copy link'}
              </button>
            </div>
            <p className="hgab-lb-status" role="status">
              {problem ?? (api ? `PNG, ${api.width.toLocaleString()} × ${api.height.toLocaleString()} pixels` : 'Drawing the image…')}
            </p>

            {/* Right beside the actions: what a shared image must not be read as saying. */}
            <DisclaimerNotice compact offices heading="Before you share" className="hgab-lb-share-note" />

            <section className="hgab-lb-about" aria-labelledby="hgab-lb-about-h">
              <h2 id="hgab-lb-about-h">About this board</h2>
              <ul>
                {board.notes.map((n) => <li key={n}>{n}</li>)}
                {(board.section === 'fy2027' || board.section === 'picture') && <li>{NEP_GLOSS}</li>}
                {board.section === 'history' && <li>{SEAT_NOTE}</li>}
              </ul>
              <p className="hgab-lb-about-credits">
                {showsPeople(board) && <>{sentence(data.credits.portraits)} {sentence(data.credits.representatives)} </>}
                Documents: {sentence(data.credits.documents)}
                {built && <> Built {built.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}.</>}{' '}
                <Link to={`${HGAB_ROOT}/methodology`}>Methodology</Link>
              </p>
            </section>
          </aside>
        </div>

        <BoardTable key={`${board.id}|${region ?? ''}`} data={data} board={board} region={region} />

        <BoardPager board={board} region={region} format={format} />
      </main>
      <SiteFooter source={SOURCE_LINE} />
    </>
  );
}

/** The figures behind the image, as a table, with a heading that says how many. */
function BoardTable({ data, board, region }: { data: LeaderboardData; board: BoardDef; region: string | null }) {
  const where = region ? ` in ${regionName(region)}` : '';
  let heading: string;
  let line: string;
  let table: ReactNode;
  switch (board.kind) {
    case 'ranking': {
      const n = rankEntries(data, board, { region }).eligible;
      heading = 'The full ranking';
      line = `${n.toLocaleString()} district ${n === 1 ? 'office' : 'offices'}${where}. An office that serves several districts is listed once, with all of them.`;
      table = <RankingTable data={data} board={board} region={region} />;
      break;
    }
    case 'members': {
      const n = rankMembers(data, { region }).eligible;
      heading = 'The full ranking';
      line = `${n.toLocaleString()} district ${n === 1 ? 'representative' : 'representatives'}${where} with a count on bills.juris.ph.`;
      table = <MembersTable data={data} board={board} region={region} />;
      break;
    }
    case 'congress':
      heading = 'Each top five, with every district served';
      line = `District offices${where}, by enacted DPWH budgets added up per Congress. ${SEAT_NOW}`;
      table = <CongressTables data={data} board={board} region={region} />;
      break;
    case 'shift':
      heading = 'By type of office';
      line = 'The same DPWH project lists in both documents, by the type of office that carries out the work.';
      table = <ShiftTable data={data} />;
      break;
    case 'regions': {
      const n = rankRegions(data, board).length;
      heading = `All ${n} regions`;
      line = 'Each region adds up its district offices. Central Office and regional office projects are in no region.';
      table = <RegionsTable data={data} board={board} />;
      break;
    }
  }
  return (
    <section className="hgab-lb-ranking" aria-labelledby="hgab-lb-table-h">
      <header className="hgab-lb-section-head">
        <h2 id="hgab-lb-table-h">{heading}</h2>
        <p>{line}</p>
      </header>
      {table}
      <p className="hgab-lb-credit">
        {showsPeople(board) && <>{sentence(data.credits.portraits)} </>}Hover an amount for the exact pesos.{' '}
        <Link to={`${HGAB_ROOT}/methodology`}>How the figures are built</Link>
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Unknown board
// ---------------------------------------------------------------------------

function BoardNotFound({ id }: { id: string }) {
  const crumb = (
    <>
      <Link to={LEADERBOARD_ROOT}>Leaderboards</Link>
      <span className="hgab-crumb-sep" aria-hidden="true">·</span>
      <span className="hgab-crumb-here">Not found</span>
    </>
  );
  return (
    <>
      <HgabHeader crumb={<><Link to={LEADERBOARD_ROOT}>Leaderboards</Link> › Not found</>} />
      <HgabHero
        compact
        crumb={crumb}
        title="There is no board with this name"
        dek={`No leaderboard is called “${id}”. A saved link may be older than the current boards. These are the ${BOARDS.length} boards.`}
      />
      <main className="nep-main hgab-lb-main">
        <BoardLinks />
        <p className="hgab-lb-credit">
          <Link to={LEADERBOARD_ROOT}>All leaderboards, with the top three of each →</Link>
        </p>
      </main>
      <SiteFooter source={SOURCE_LINE} />
    </>
  );
}
