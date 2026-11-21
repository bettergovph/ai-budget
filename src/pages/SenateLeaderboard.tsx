/**
 * `/senate/2027/leaderboard` and `/senate/2027/leaderboard/:board`: the Senate committee report's leaderboards, in the
 * House bill leaderboards' design (their tiles, place cells and styles, src/components/HgabLeaderboardBits.tsx), with
 * the Senate's boards (src/lib/senate-leaderboard.ts) and tables that show the House bill beside the Senate.
 * Share images are the House leaderboards' alone for now.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import {
  BoardLinks, BoardPager, BoardTile, EmptyRow, PlaceCell, ResidualNote, TableFoot, ValueCell,
} from '../components/HgabLeaderboardBits';
import { SenateError, SenateHeader, SenateHero, SenateLoading, SenateNotice, SenateReviewBanner } from '../components/SenateBits';
import { pageMeta } from '../lib/seo';
import { REGION_LABELS, REGION_ORDER, type RegionKey } from '../lib/hgab';
import {
  DEO_MEANING, formatPesoFull, formatValue, rankEntries, rankLines, rankRegions, type BoardDef, type LeaderboardData,
} from '../lib/hgab-leaderboard';
import { LeaderboardSiteContext } from '../lib/leaderboard-site';
import {
  SENATE_BOARDS, SENATE_BOARD_SECTIONS, SENATE_LEADERBOARD_ROOT, loadSenateLeaderboard, senateBoardById, senateLeaderboardPath,
  type SenateLeaderEntry, type SenateLeaderRegion, type SenateLeaderboardData,
} from '../lib/senate-leaderboard';
import { SENATE_ROOT, senatePdfUrl } from '../lib/senate';
import '../nep2027.css';
import '../hgab-leaderboard.css';

const SITE = { boards: SENATE_BOARDS, path: senateLeaderboardPath };
const FIRST = 20;
const regionName = (k: string | null) => (k ? REGION_LABELS[k as RegionKey]?.name ?? k : 'All regions');
const isRegionKey = (v: string | null): v is RegionKey => !!v && (REGION_ORDER as readonly string[]).includes(v);

export default function SenateLeaderboard() {
  const { board: boardId } = useParams();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<SenateLeaderboardData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    loadSenateLeaderboard().then(setData).catch((e) => setErr(String(e?.message || e)));
  }, []);
  const board = senateBoardById(boardId);
  const raw = params.get('region');
  const region = isRegionKey(raw) && (!board || board.regionFilter) ? raw : null;
  useEffect(() => {
    const base = pageMeta(SENATE_LEADERBOARD_ROOT).title;
    document.title = board ? `${board.title} · ${base}` : base;
    window.scrollTo(0, 0);
  }, [board]);
  const regions = useMemo(() => (data ? REGION_ORDER.filter((k) => data.entries.some((e) => e.region === k)) : []), [data]);
  const onRegion = (r: string | null) => {
    const n = new URLSearchParams(params);
    if (r) n.set('region', r); else n.delete('region');
    setParams(n, { replace: true });
  };

  if (boardId && !board) {
    return (
      <LeaderboardSiteContext.Provider value={SITE}>
        <SenateHeader crumb="Leaderboards" />
        <SenateHero compact crumb="Leaderboards" title="Board not found" dek={`No Senate leaderboard is called “${boardId}”. These are the ${SENATE_BOARDS.length} boards.`} />
        <main className="nep-main hgab-lb-main"><BoardLinks /></main>
        <SiteFooter />
      </LeaderboardSiteContext.Provider>
    );
  }
  if (err) return <SenateError message={err} />;
  if (!data) return <SenateLoading what="the Senate leaderboards" />;
  return (
    <LeaderboardSiteContext.Provider value={SITE}>
      {board
        ? <BoardPage data={data} board={board} region={region} regions={regions} onRegion={onRegion} />
        : <Gallery data={data} region={region} regions={regions} onRegion={onRegion} />}
    </LeaderboardSiteContext.Provider>
  );
}

function RegionSelect({ value, regions, onChange }: { value: string | null; regions: readonly RegionKey[]; onChange: (r: string | null) => void }) {
  return (
    <label className="hgab-lb-select">
      <span>Region</span>
      <select className="select-input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">All regions</option>
        {regions.map((k) => <option key={k} value={k}>{regionName(k)}</option>)}
      </select>
    </label>
  );
}

function Gallery({ data, region, regions, onRegion }: { data: SenateLeaderboardData; region: string | null; regions: readonly RegionKey[]; onRegion: (r: string | null) => void }) {
  const t = data.totals.senate.all;
  return (
    <>
      <SenateHeader crumb="Leaderboards" compiledMeta={`${SENATE_BOARDS.length} boards · ${data.entries.length.toLocaleString()} DPWH offices`} />
      <SenateHero
        compact
        crumb="Leaderboards"
        title="Senate leaderboards"
        dek={<>
          What the Senate committee report changes, ranked: DPWH district engineering offices (DEOs) by the House bill budget the Senate
          removes or keeps, then departments, agencies and budget lines across the whole bill. The Senate removes {t.removed_rows.toLocaleString()} DPWH
          projects worth {formatValue(t.removed_php, 'php')} from the House bill.
        </>}
        note={`Amounts belong to DPWH offices, not to people. The representative shown holds the legislative district’s seat in the 20th Congress. The Senate committee report does not say why it removes or raises a project, or who asked for it. ${DEO_MEANING}`}
      />
      <main className="nep-main hgab-lb-main">
        <SenateReviewBanner compact />
        <div className="hgab-lb-toolbar">
          <RegionSelect value={region} regions={regions} onChange={onRegion} />
          <p>{region ? `Boards that rank DPWH offices show ${regionName(region)} only.` : 'Pick a region to rank only its DPWH offices.'}</p>
        </div>
        {SENATE_BOARD_SECTIONS.map((sec) => {
          const boards = SENATE_BOARDS.filter((b) => b.section === sec.key);
          return (
            <section key={sec.key} className="hgab-lb-section" aria-labelledby={`slb-${sec.key}`}>
              <header className="hgab-lb-section-head">
                <h2 id={`slb-${sec.key}`}>{sec.label} <small>{boards.length} {boards.length === 1 ? 'board' : 'boards'}</small></h2>
                <p>{sec.blurb}</p>
              </header>
              <div className="hgab-lb-grid">
                {boards.map((b) => <BoardTile key={b.id} data={data as LeaderboardData} board={b} region={region} />)}
              </div>
            </section>
          );
        })}
        <aside className="hgab-lb-notes" aria-labelledby="slb-notes">
          <h2 id="slb-notes">Before you share a board</h2>
          <ul>{data.notes.map((x) => <li key={x}>{x}</li>)}</ul>
        </aside>
        <p className="hgab-lb-credit">
          {data.credits.portraits} {data.credits.representatives}{' '}
          <Link to={`${SENATE_ROOT}/methodology`}>How the figures are built</Link> · <Link to={`${SENATE_ROOT}/data`}>The Senate dataset</Link>
        </p>
        <SenateNotice />
      </main>
      <SiteFooter />
    </>
  );
}

function BoardPage({ data, board, region, regions, onRegion }: {
  data: SenateLeaderboardData; board: BoardDef; region: string | null; regions: readonly RegionKey[]; onRegion: (r: string | null) => void;
}) {
  const crumb = <><Link to={senateLeaderboardPath(undefined, { region })}>Leaderboards</Link> › {board.title}</>;
  return (
    <>
      <SenateHeader crumb="Leaderboards" />
      <SenateHero compact crumb={crumb} title={board.title} dek={board.subtitle} />
      <main className="nep-main hgab-lb-main">
        <SenateReviewBanner compact />
        {board.regionFilter && (
          <div className="hgab-lb-toolbar">
            <RegionSelect value={region} regions={regions} onChange={onRegion} />
            <p>{region ? `${regionName(region)} only.` : 'All regions.'}</p>
          </div>
        )}
        {board.kind === 'ranking' && <RankingTable data={data} board={board} region={region} />}
        {board.kind === 'lines' && <LinesTable data={data} board={board} />}
        {board.kind === 'regions' && <RegionsTable data={data} board={board} />}
        <ResidualNote data={data as LeaderboardData} board={board} />
        <section className="hgab-lb-about" aria-labelledby="slb-about-h">
          <h2 id="slb-about-h">About this board</h2>
          <ul>{board.notes.map((x) => <li key={x}>{x}</li>)}</ul>
        </section>
        <BoardPager board={board} region={region} format="portrait" />
        <SenateNotice />
      </main>
      <SiteFooter />
    </>
  );
}

function valueHeading(board: BoardDef): string {
  return board.value === 'count' ? 'Projects' : board.value === 'share' || board.value === 'pct' ? 'Percent' : board.value === 'signed_php' ? 'Change' : 'Amount';
}

function RankingTable({ data, board, region }: { data: SenateLeaderboardData; board: BoardDef; region: string | null }) {
  const [open, setOpen] = useState(false);
  const { rows, eligible } = rankEntries(data as LeaderboardData, board, { region });
  const shown = open ? rows : rows.slice(0, FIRST);
  const cols = region ? 6 : 7;
  return (
    <>
      <div className="nep-table-wrap">
        <table className="nep-table hgab-lb-table">
          <caption className="visually-hidden">{board.title}: {eligible.toLocaleString()} ranked</caption>
          <thead>
            <tr>
              <th className="num hgab-lb-rank">Rank</th>
              <th className="is-wrap">Legislative district or DPWH office · representative</th>
              {!region && <th className="hgab-lb-col-wide">Region</th>}
              <th className="num">{valueHeading(board)}</th>
              <th className="num hgab-lb-col-wide">House bill</th>
              <th className="num hgab-lb-col-wide">Senate</th>
              <th className="hgab-lb-col-wide">Detail</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <EmptyRow cols={cols}>No DPWH office {region ? `in ${regionName(region)} ` : ''}is on this board.</EmptyRow>}
            {shown.map((r) => {
              const s = (r.entry as SenateLeaderEntry).senate;
              return (
                <tr key={r.entry.key} className={r.entry.tier === 'B' ? 'is-shared' : undefined}>
                  <td className="num hgab-lb-rank">{r.rank}</td>
                  <PlaceCell entry={r.entry} />
                  {!region && <td className="hgab-lb-region hgab-lb-col-wide">{regionName(r.entry.region)}</td>}
                  <ValueCell value={r.value} kind={board.value} sub={board.detail?.(r.entry)} />
                  <td className="num hgab-lb-col-wide" title={formatPesoFull(s.house_php)}>{formatValue(s.house_php, 'php')}</td>
                  <td className="num hgab-lb-col-wide" title={formatPesoFull(s.senate_php)}>{formatValue(s.senate_php, 'php')}</td>
                  <td className="hgab-lb-detail hgab-lb-col-wide">{board.detail?.(r.entry) ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <TableFoot shown={shown.length} total={eligible} open={open} onOpen={() => setOpen(true)} />
    </>
  );
}

function LinesTable({ data, board }: { data: SenateLeaderboardData; board: BoardDef }) {
  const [open, setOpen] = useState(false);
  const { rows, eligible } = rankLines(data as LeaderboardData, board);
  const shown = open ? rows : rows.slice(0, FIRST);
  const what = board.rowSet === 'departments' ? 'Department or fund' : board.rowSet === 'agencies' ? 'Agency' : 'Budget line';
  return (
    <>
      <div className="nep-table-wrap">
        <table className="nep-table hgab-lb-table">
          <caption className="visually-hidden">{board.title}: {eligible.toLocaleString()} ranked</caption>
          <thead>
            <tr>
              <th className="num hgab-lb-rank">Rank</th>
              <th className="is-wrap">{what}</th>
              <th className="num">{valueHeading(board)}</th>
              <th className="num hgab-lb-col-wide">House bill</th>
              <th className="num hgab-lb-col-wide">Senate</th>
              <th><span className="visually-hidden">Where to read it</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <EmptyRow cols={6}>Nothing is on this board.</EmptyRow>}
            {shown.map((r) => (
              <tr key={`${r.row.label}|${r.row.sub}|${r.row.page ?? ''}`}>
                <td className="num hgab-lb-rank">{r.rank}</td>
                <td className="nep-td-name">
                  <strong>{r.row.label}</strong>
                  <span className="hgab-lb-line-sub">{r.row.sub}</span>
                </td>
                <ValueCell value={r.value} kind={board.value} sub={board.rowDetail?.(r.row) ?? null} />
                <td className="num hgab-lb-col-wide" title={formatPesoFull(r.row.hgab3_php)}>{r.row.hgab3_php ? formatValue(r.row.hgab3_php, 'php') : '—'}</td>
                <td className="num hgab-lb-col-wide" title={formatPesoFull(r.row.senate_php ?? 0)}>{formatValue(r.row.senate_php ?? 0, 'php')}</td>
                <td className="hgab-lb-go">
                  {r.row.page
                    ? <a href={senatePdfUrl('senate-cr-annex-a', r.row.page)} target="_blank" rel="noreferrer" title="The page of Annex A that prints it">Annex A p.{r.row.page}</a>
                    : <Link to={r.row.href}>Lines →</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TableFoot shown={shown.length} total={eligible} open={open} onOpen={() => setOpen(true)} />
    </>
  );
}

function RegionsTable({ data, board }: { data: SenateLeaderboardData; board: BoardDef }) {
  const rows = rankRegions(data as LeaderboardData, board);
  return (
    <div className="nep-table-wrap">
      <table className="nep-table hgab-lb-table">
        <caption className="visually-hidden">{board.title}</caption>
        <thead>
          <tr>
            <th className="num hgab-lb-rank">Rank</th>
            <th>Region</th>
            <th className="num">{valueHeading(board)}</th>
            <th className="num hgab-lb-col-wide">House bill</th>
            <th className="num hgab-lb-col-wide">Senate</th>
            <th className="num hgab-lb-col-wide">Projects removed</th>
            <th><span className="visually-hidden">DPWH offices in the region</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = (r.region as SenateLeaderRegion).senate;
            return (
              <tr key={r.region.region}>
                <td className="num hgab-lb-rank">{r.rank}</td>
                <td className="nep-td-name"><strong>{regionName(r.region.region)}</strong></td>
                <ValueCell value={r.value} kind={board.value} />
                <td className="num hgab-lb-col-wide">{formatValue(s?.house_php ?? null, 'php')}</td>
                <td className="num hgab-lb-col-wide">{formatValue(s?.senate_php ?? null, 'php')}</td>
                <td className="num hgab-lb-col-wide">{s?.removed_rows.toLocaleString() ?? '—'}</td>
                <td className="hgab-lb-go"><Link to={senateLeaderboardPath('removed', { region: r.region.region })}>Offices →</Link></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
