/**
 * `/gaa/roads/leaderboards`: every DPWH road and bridge line in the FY2015 to FY2026 enacted budgets, ranked four ways.
 * Jason (2026-11-23): "Create me leaderboard for our roads": by type, by region, by contractor, and by how many times a
 * project has been funded; "These are no longer hgab but rather should be in the GAA".
 *
 * Data: boards.json and repeats.json (npm run build:gaa-roads-boards; contract in src/lib/gaa-roads.ts). Every figure
 * in the copy is computed from them. The URL holds the year picked (`year`; none: all twelve budgets) and the funded-again
 * board's filters (`region`, `part`). Each row links to its lines on the roads page.
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { Caveats, DisclaimerNotice, HgabError, HgabLoading } from '../components/HgabBits';
import { GaaHeader, GaaPageHead } from '../components/GaaBits';
import { loadRoadsBoards, REGION_LABELS, REGION_ORDER, type RegionKey } from '../lib/hgab';
import { dataUrl } from '../lib/data-url';
import { bn as bnShort, count, fullPeso } from '../lib/hgab-history-view';
import { asOfText } from '../lib/hgab-leaderboard';
import { contractorPath, MATCH_NOTE } from '../lib/hgab-contractors';
import { lineSource } from '../lib/hgab-mpb-years';
import {
  PART_SHORT, ROADS_BOARDS_TITLE, ROADS_REPEATS_CSV_NAME, ROADS_ROOT, ROADS_TITLE, roadsRepeatsCsvPath,
  type ByYear, type RoadPart, type RoadsBoardsFile, type RoadsRepeatsFile,
} from '../lib/gaa-roads';
import '../nep2027.css';
import '../hgab-history.css';
import '../gaa-roads.css';

const STEP = 25;
const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);
const pct = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(part / whole < 0.1 ? 1 : 0)}%` : '—');
const regionName = (r: RegionKey | null) => (r ? REGION_LABELS[r].name : 'Region not named');
/** "₱1,915.0B" in tables (hgab-history-view's bn, with thousands separators). */
const bn = (v: number) => (v >= 1e9 ? `₱${(v / 1e9).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}B` : bnShort(v));
/** "₱4.55 trillion", "₱767.1 billion" in sentences. */
const billions = (v: number) => (v >= 1e12 ? `₱${(v / 1e12).toFixed(2)} trillion`
  : v >= 1e9 ? `₱${(v / 1e9).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} billion`
    : `₱${Math.round(v / 1e6).toLocaleString('en-US')} million`);

/** The roads page with these lines: the years (the GAA years, else all), and a part, region or search. */
function linesHref(years: readonly number[], f: { part?: RoadPart; region?: RegionKey; q?: string }): string {
  const p = new URLSearchParams({ years: years.join(',') });
  if (f.q) p.set('q', f.q);
  if (f.part) p.set('part', f.part);
  if (f.region) p.set('region', f.region);
  return `${ROADS_ROOT}?${p}`;
}

export default function GaaRoadsBoards() {
  const [state, setState] = useState<{ boards: RoadsBoardsFile; repeats: RoadsRepeatsFile } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadRoadsBoards().then((s) => { if (live) setState(s); }).catch((e) => { if (live) setError(String(e?.message ?? e)); });
    return () => { live = false; };
  }, []);
  if (error) return <HgabError message={error} />;
  if (!state) return <HgabLoading what="the road and bridge leaderboards" />;
  return <Boards boards={state.boards} repeats={state.repeats} />;
}

function Boards({ boards, repeats }: { boards: RoadsBoardsFile; repeats: RoadsRepeatsFile }) {
  const [params, setParams] = useSearchParams();
  const yearParam = Number(params.get('year'));
  const year = boards.years.includes(yearParam) ? yearParam : null;
  const setYear = (y: number | null) => {
    const p = new URLSearchParams(params);
    if (y == null) p.delete('year'); else p.set('year', String(y));
    setParams(p, { replace: true });
  };
  const first = boards.years[0];
  const last = boards.years[boards.years.length - 1];
  const yi = year == null ? -1 : boards.years.indexOf(year);
  /** A figure for the year picked, or all years. */
  const at = (v: ByYear) => (yi < 0 ? sum(v) : v[yi]);
  const scope = year == null ? `FY ${first}–${last}` : `FY ${year}`;
  const years = year == null ? boards.years : [year];
  const total = at(boards.totals.php);

  return (
    <>
      <GaaHeader crumb={ROADS_TITLE} />
      <GaaPageHead
        trail={[{ label: ROADS_TITLE, to: ROADS_ROOT }, { label: 'Leaderboards' }]}
        title={<>{ROADS_BOARDS_TITLE}, FY {first}–{last}</>}
        dek={
          <>
            Every DPWH road and bridge line in the {boards.years.length} enacted budgets, {billions(sum(boards.totals.php))} in{' '}
            {count(sum(boards.totals.lines))} lines, ranked four ways: by type, by region, by contractor, and by how many
            budgets funded the same project.
          </>
        }
        note={
          <>
            Amounts are what each General Appropriations Act set aside, not what was spent. The 2027 budget is still a bill,
            so it is left out. {asOfText({ built_at: boards.built_at })}.
          </>
        }
      />
      <main className="nep-main gaa-rb-main">
        <div className="gaa-rb-controls">
          <div className="hgab-ds-dims gaa-rb-years" role="group" aria-label="Budget year">
            <button type="button" aria-pressed={year == null} onClick={() => setYear(null)}>All {boards.years.length} budgets</button>
            {boards.years.map((y) => (
              <button key={y} type="button" aria-pressed={year === y} onClick={() => setYear(y)}>{y}</button>
            ))}
          </div>
          <nav className="gaa-rb-jump" aria-label="Boards on this page">
            <a href="#by-type">By type</a>
            <a href="#by-region">By region</a>
            <a href="#by-contractor">By contractor</a>
            <a href="#funded-again">Funded most often</a>
          </nav>
        </div>

        <p className="gaa-rb-scope" aria-live="polite">
          <strong>{scope}</strong>: {billions(total)} in {count(at(boards.totals.lines))} road and bridge lines.
        </p>

        <TypeBoard boards={boards} at={at} total={total} years={years} scope={scope} />
        <RegionBoard boards={boards} at={at} total={total} years={years} scope={scope} />
        <ContractorBoard boards={boards} year={year} />
        <RepeatsBoard boards={boards} repeats={repeats} />
        <AboutBoards boards={boards} />
        <DisclaimerNotice compact contractors />
      </main>
      <SiteFooter />
    </>
  );
}

// ---------------------------------------------------------------------------
// The ranked table every board uses
// ---------------------------------------------------------------------------

interface BoardRow {
  key: string;
  /** null: listed after the ranks, unranked (no region). */
  rank: number | null;
  name: ReactNode;
  sub?: ReactNode;
  php: number;
  lines: number;
  share: string;
  link?: ReactNode;
  /** Rows shown below this one when it is opened. */
  detail?: ReactNode;
  detailLabel?: string;
}

function RankTable({ rows, max, nameHead, amountHead = 'Amount', shareHead = 'Share' }: {
  rows: BoardRow[];
  max: number;
  nameHead: string;
  amountHead?: string;
  shareHead?: string;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  return (
    <div className="gaa-rb-tablewrap">
      <table className="gaa-rb-table">
        <thead>
          <tr>
            <th scope="col" className="gaa-rb-rank">#</th>
            <th scope="col">{nameHead}</th>
            <th scope="col" className="gaa-rb-barcol">{amountHead}</th>
            <th scope="col" className="is-num">Lines</th>
            <th scope="col" className="is-num">{shareHead}</th>
            <th scope="col" className="gaa-rb-linkcol"><span className="visually-hidden">Lines on the roads page</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.key}>
              <tr className={r.rank == null ? 'is-unranked' : undefined}>
                <td className="gaa-rb-rank">{r.rank ?? '—'}</td>
                <th scope="row" className="gaa-rb-name">
                  <span className="gaa-rb-title">{r.name}</span>
                  {r.sub && <span className="gaa-rb-sub">{r.sub}</span>}
                  {r.detail && (
                    <button type="button" className="gaa-rb-open" aria-expanded={open.has(r.key)} onClick={() => toggle(r.key)}>
                      {open.has(r.key) ? 'Hide' : 'Show'} {r.detailLabel}
                    </button>
                  )}
                </th>
                <td className="gaa-rb-barcol">
                  <span className="gaa-rb-bar" aria-hidden="true"><i style={{ width: `${max > 0 ? Math.max(0.4, (r.php / max) * 100) : 0}%` }} /></span>
                  <span className="gaa-rb-amt" title={fullPeso(r.php)}>{bn(r.php)}</span>
                </td>
                <td className="is-num">{count(r.lines)}</td>
                <td className="is-num">{r.share}</td>
                <td className="gaa-rb-linkcol">{r.link}</td>
              </tr>
              {r.detail && open.has(r.key) && (
                <tr className="gaa-rb-detail">
                  <td />
                  <td colSpan={5}>{r.detail}</td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function More({ shown, total, cap, onMore, what }: { shown: number; total: number; cap: number; onMore: () => void; what: string }) {
  const limit = Math.min(total, cap);
  if (shown >= limit) return total > cap ? <p className="gaa-rb-more">The top {count(cap)} {what} are listed here.</p> : null;
  return (
    <p className="gaa-rb-more">
      Showing {count(shown)} of {count(limit)}.{' '}
      <button type="button" className="hgab-mpbm-linkbtn" onClick={onMore}>Show {count(Math.min(STEP, limit - shown))} more</button>
    </p>
  );
}

function BoardHead({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <>
      <h2 id={`${id}-h`} className="hgab-mpbm-h2">{title}</h2>
      {children && <p className="hgab-mpbm-dek">{children}</p>}
    </>
  );
}

// ---------------------------------------------------------------------------
// By type: the budget's own parts, each with its programs
// ---------------------------------------------------------------------------

function TypeBoard({ boards, at, total, years, scope }: {
  boards: RoadsBoardsFile; at: (v: ByYear) => number; total: number; years: readonly number[]; scope: string;
}) {
  const types = boards.types.filter((t) => at(t.php) > 0).sort((a, b) => at(b.php) - at(a.php));
  const max = Math.max(0, ...types.map((t) => at(t.php)));
  const rows: BoardRow[] = types.map((t, k) => {
    const programs = t.programs.filter((g) => at(g.php) > 0).sort((a, b) => at(b.php) - at(a.php));
    const php = at(t.php);
    return {
      key: t.part,
      rank: k + 1,
      name: PART_SHORT[t.part],
      sub: t.part === 'former' ? 'FY 2015–2017 list national roads and bridges as one program, under older codes.' : undefined,
      php,
      lines: at(t.lines),
      share: pct(php, total),
      link: <Link to={linesHref(years, { part: t.part })}>Lines</Link>,
      detailLabel: programs.length > 1 ? `its ${programs.length} programs` : undefined,
      detail: programs.length > 1 ? (
        <ol className="gaa-rb-programs">
          {programs.map((g) => (
            <li key={g.label}>
              <span>{g.label}</span>
              <span className="gaa-rb-bar is-thin" aria-hidden="true"><i style={{ width: `${Math.max(0.4, (at(g.php) / php) * 100)}%` }} /></span>
              <span className="gaa-rb-amt" title={fullPeso(at(g.php))}>{bn(at(g.php))}</span>
              <span className="gaa-rb-n">{count(at(g.lines))} lines · {pct(at(g.php), php)}</span>
            </li>
          ))}
        </ol>
      ) : undefined,
    };
  });
  return (
    <section className="nep-section gaa-rb-section" id="by-type" aria-labelledby="by-type-h">
      <BoardHead id="by-type" title={`By type, ${scope}`}>
        The parts of the budget roads and bridges sit in, largest first. Open a part to rank the programs the budget lists
        under it, such as road widening, preventive maintenance or new bridges.
      </BoardHead>
      <RankTable rows={rows} max={max} nameHead="Type" shareHead="Share of roads" />
    </section>
  );
}

// ---------------------------------------------------------------------------
// By region
// ---------------------------------------------------------------------------

function RegionBoard({ boards, at, total, years, scope }: {
  boards: RoadsBoardsFile; at: (v: ByYear) => number; total: number; years: readonly number[]; scope: string;
}) {
  const ranked = boards.regions.filter((r) => r.region && at(r.php) > 0).sort((a, b) => at(b.php) - at(a.php));
  const none = boards.regions.find((r) => r.region == null);
  const max = Math.max(0, ...ranked.map((r) => at(r.php)));
  const rows: BoardRow[] = ranked.map((r, k) => ({
    key: r.region!,
    rank: k + 1,
    name: <>{regionName(r.region)} <span className="gaa-rb-short">{REGION_LABELS[r.region!].short}</span></>,
    sub: at(r.road_php) > 0 ? <>{bn(at(r.road_php))} of it from head-office lines, by the region of the same road</> : undefined,
    php: at(r.php),
    lines: at(r.lines),
    share: pct(at(r.php), total),
    link: <Link to={linesHref(years, { region: r.region! })}>Lines</Link>,
  }));
  if (none && at(none.php) > 0) {
    rows.push({
      key: 'none',
      rank: null,
      name: 'Region not named',
      sub: 'Nationwide programs, and head-office lines whose title names no place and whose road no other line places.',
      php: at(none.php),
      lines: at(none.lines),
      share: pct(at(none.php), total),
    });
  }
  const fix = boards.region_fix;
  return (
    <section className="nep-section gaa-rb-section" id="by-region" aria-labelledby="by-region-h">
      <BoardHead id="by-region" title={`By region, ${scope}`}>
        Where each line sits: the point of its DPWH contract, the place its title names, or its district office’s area.
        Today’s regions are used for every year, so the Negros Island Region has the Negros provinces’ earlier lines too.
      </BoardHead>
      <RankTable rows={rows} max={max} nameHead="Region" shareHead="Share of roads" />
      <p className="gaa-rb-note">
        DBM’s budget extract tags every DPWH Central Office line with the head office’s own region, Metro Manila. Here,{' '}
        {count(fix.lines)} head-office lines ({billions(fix.php)}) whose titles name no place take the region of the same
        road’s other lines instead: {count(fix.road_lines)} ({billions(fix.road_php)}) could be placed that way. The rest
        have no region.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// By contractor (FY2020–2026: the lines linked to a DPWH contract)
// ---------------------------------------------------------------------------

function ContractorBoard({ boards, year }: { boards: RoadsBoardsFile; year: number | null }) {
  const c = boards.contractors;
  const cy = boards.contract_years;
  const inYears = year != null && cy.includes(year);
  const ci = inYears ? cy.indexOf(year!) : -1;
  const at = (v: ByYear) => (ci < 0 ? sum(v) : v[ci]);
  const scope = inYears ? `FY ${year}` : `FY ${cy[0]}–${cy[cy.length - 1]}`;
  const years = inYears ? [year!] : cy;
  const linkedPhp = at(c.linked.php);
  const all = c.rows.filter((r) => at(r.php) > 0).sort((a, b) => at(b.php) - at(a.php) || a.name.localeCompare(b.name));
  const cap = inYears ? c.kept.year : c.kept.all;
  const [shown, setShown] = useState(STEP);
  const rows: BoardRow[] = all.slice(0, Math.min(shown, cap)).map((r, k) => ({
    key: r.name,
    rank: k + 1,
    name: r.key ? <Link to={contractorPath(r.key)}>{r.name}</Link> : r.name,
    sub: at(r.jv_php) > 0 ? <>{bn(at(r.jv_php))} of it in joint ventures ({count(at(r.jv_lines))} lines)</> : undefined,
    php: at(r.php),
    lines: at(r.lines),
    share: pct(at(r.php), linkedPhp),
    link: <Link to={linesHref(years, { q: r.name })}>Lines</Link>,
  }));
  const max = all.length ? at(all[0].php) : 0;
  return (
    <section className="nep-section gaa-rb-section" id="by-contractor" aria-labelledby="by-contractor-h">
      <BoardHead id="by-contractor" title={`By contractor, ${scope}`}>
        The budget of the road and bridge lines whose DPWH contract each contractor holds. {billions(linkedPhp)} in{' '}
        {count(at(c.linked.lines))} lines is linked to a contract,{' '}
        {pct(linkedPhp, ci < 0 ? sum(cy.map((y) => boards.totals.php[boards.years.indexOf(y)])) : boards.totals.php[boards.years.indexOf(year!)])}{' '}
        of the roads budget in {scope}, among {count(ci < 0 ? c.count_all : c.count[ci])} contractors.
        {year != null && !inYears && <> No contract is linked before FY {cy[0]}, so this board shows FY {cy[0]}–{cy[cy.length - 1]}.</>}
      </BoardHead>
      <RankTable rows={rows} max={max} nameHead="Contractor" amountHead="Budget of their lines" shareHead="Share of linked" />
      <More shown={rows.length} total={all.length} cap={cap} onMore={() => setShown((n) => n + STEP)} what="contractors" />
      <p className="gaa-rb-note">
        {MATCH_NOTE} A joint venture’s line counts in full for each partner, as on the contractor pages, so the shares add
        to more than 100%. Amounts are the budget lines’, not the contracts’.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Funded most often: the same title in the same region, budget after budget
// ---------------------------------------------------------------------------

function RepeatsBoard({ boards, repeats }: { boards: RoadsBoardsFile; repeats: RoadsRepeatsFile }) {
  const [params, setParams] = useSearchParams();
  const regionParam = params.get('region') as RegionKey | 'none' | null;
  const region = regionParam === 'none' || (regionParam && REGION_ORDER.includes(regionParam)) ? regionParam : '';
  const partParam = params.get('part') as RoadPart | null;
  const part = partParam && partParam in PART_SHORT ? partParam : '';
  const setFilter = (k: 'region' | 'part', v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };
  const groups = useMemo(() => repeats.groups.filter((g) => (!region || (region === 'none' ? g.region == null : g.region === region))
    && (!part || g.part === part)), [repeats.groups, region, part]);
  const [shown, setShown] = useState(STEP);
  const r = boards.repeats;
  const most = r.by_budgets[0];
  const kept = r.by_budgets.filter((b) => b.budgets >= repeats.min_budgets);
  const maxGroups = Math.max(...r.by_budgets.map((b) => b.groups));
  const years = boards.years;
  return (
    <section className="nep-section gaa-rb-section" id="funded-again" aria-labelledby="funded-again-h">
      <BoardHead id="funded-again" title={`Funded most often, FY ${years[0]}–${years[years.length - 1]}`}>
        The same project title in the same region, in budget after budget. {count(r.groups)} road and bridge projects were
        funded in two budgets or more, {billions(r.php)} in {count(r.lines)} lines; the most, {most.budgets} budgets. This
        board counts every year; the year picked above does not apply.
      </BoardHead>
      <ol className="gaa-rb-dist" aria-label="Projects by how many budgets funded them">
        {r.by_budgets.map((b) => (
          <li key={b.budgets}>
            <span className="gaa-rb-dist-k">{b.budgets} budgets</span>
            <span className="gaa-rb-bar" aria-hidden="true"><i style={{ width: `${Math.max(0.6, (b.groups / maxGroups) * 100)}%` }} /></span>
            <span className="gaa-rb-dist-v">{count(b.groups)} projects · {bn(b.php)}</span>
          </li>
        ))}
      </ol>
      <div className="gaa-rb-filters" role="group" aria-label="Filter the projects">
        <label>
          <span>Region</span>
          <select value={region} onChange={(e) => { setShown(STEP); setFilter('region', e.target.value); }}>
            <option value="">All regions</option>
            {REGION_ORDER.map((k) => <option key={k} value={k}>{REGION_LABELS[k].short} · {REGION_LABELS[k].name}</option>)}
            <option value="none">Region not named</option>
          </select>
        </label>
        <label>
          <span>Type</span>
          <select value={part} onChange={(e) => { setShown(STEP); setFilter('part', e.target.value); }}>
            <option value="">All types</option>
            {(Object.keys(PART_SHORT) as RoadPart[]).map((k) => <option key={k} value={k}>{PART_SHORT[k]}</option>)}
          </select>
        </label>
        <span className="gaa-rb-count">{count(groups.length)} projects funded in {repeats.min_budgets} budgets or more</span>
      </div>
      <ol className="gaa-rb-repeats">
        {groups.slice(0, shown).map((g, k) => <RepeatRow key={`${g.title}|${g.region}`} rank={k + 1} g={g} years={years} offices={repeats.offices} />)}
        {!groups.length && <li className="gaa-rb-empty">No project matches these filters.</li>}
      </ol>
      <More shown={Math.min(shown, groups.length)} total={groups.length} cap={groups.length} onMore={() => setShown((n) => n + STEP)} what="projects" />
      <p className="gaa-rb-note">
        Listed here: the {count(sum(kept.map((b) => b.groups)))} projects funded in {repeats.min_budgets} budgets or more.{' '}
        <a href={dataUrl(roadsRepeatsCsvPath(boards))} download={ROADS_REPEATS_CSV_NAME}>Download all {count(r.groups)}, a row per line (CSV)</a>.
        A title funded again can be the phases of one project, a contract split over the years, or repairs; read the lines
        before drawing a conclusion. Another phase or another stretch of road (other stations) counts as another project.
      </p>
    </section>
  );
}

function RepeatRow({ rank, g, years, offices }: {
  rank: number; g: RoadsRepeatsFile['groups'][number]; years: readonly number[]; offices: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const funded = new Map<number, number>();
  for (const [fy, , php] of g.lines) funded.set(fy, (funded.get(fy) ?? 0) + php);
  return (
    <li className="gaa-rb-rep">
      <span className="gaa-rb-rank">{rank}</span>
      <div className="gaa-rb-rep-main">
        <span className="gaa-rb-title">{g.title}</span>
        <span className="gaa-rb-sub">{regionName(g.region)} · {PART_SHORT[g.part]}</span>
        <button type="button" className="gaa-rb-open" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Show'} its {g.lines.length} lines
        </button>
        {open && (
          <table className="gaa-rb-sublines">
            <thead>
              <tr><th scope="col">Budget</th><th scope="col" className="is-num">Amount</th><th scope="col">DPWH office</th><th scope="col">Source</th></tr>
            </thead>
            <tbody>
              {g.lines.map(([fy, code, php, office, page]) => {
                const src = lineSource({ fy, id: `gaa:${fy}:${code}`, code, gaaPage: page });
                return (
                  <tr key={`${fy}:${code}`}>
                    <td>FY {fy}</td>
                    <td className="is-num" title={fullPeso(php)}>{bn(php)}</td>
                    <td>{office >= 0 ? offices[office] : '—'}</td>
                    <td>
                      {src ? (src.external
                        ? <a href={src.href} target="_blank" rel="noopener noreferrer">{src.label}</a>
                        : <Link to={src.href}>{src.label}</Link>) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <ol className="gaa-rb-dots" aria-label={`Funded in ${funded.size} budgets: ${[...funded.keys()].join(', ')}`}>
        {years.map((y) => (
          <li key={y} className={funded.has(y) ? 'is-on' : undefined} title={funded.has(y) ? `FY ${y}: ${fullPeso(funded.get(y)!)}` : `FY ${y}: not funded`}>
            <span className="visually-hidden">{y}</span>
          </li>
        ))}
      </ol>
      <span className="gaa-rb-rep-n"><strong>{funded.size}</strong> budgets</span>
      <span className="gaa-rb-amt" title={fullPeso(g.php)}>{bn(g.php)}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------

function AboutBoards({ boards }: { boards: RoadsBoardsFile }) {
  const cy = boards.contract_years;
  return (
    <section className="nep-section gaa-rb-section" id="about" aria-labelledby="gaa-rb-about-h">
      <h2 id="gaa-rb-about-h" className="hgab-mpbm-h2">About these boards</h2>
      <Caveats items={[
        `Which lines: every DPWH road and bridge line in the FY ${boards.years[0]} to FY ${boards.years[boards.years.length - 1]} General Appropriations Acts, the same lines as the roads page. The 2027 NEP and House bill are proposals, so they are not counted.`,
        'Types are the budget’s own parts and the programs it lists under them. FY 2015 to 2017 use older codes that list national roads and bridges as one program.',
        'Regions: where the line’s DPWH contract point, the place its title names, or its district office puts it. Head-office lines whose titles name no place take the region of the same road’s other lines; the rest have no region.',
        `Contractors: FY ${cy[0]} to ${cy[cy.length - 1]} only, the years DPWH’s contract list can be matched to budget lines. Each amount is the budget line’s, counted for every contractor on the contract.`,
        'Funded again: titles are compared with case, punctuation, GPS and common abbreviations (Rd, Br, Sta, Jct, Brgy) set aside. Phases and stations stay, so another phase or stretch is another project.',
        'A ranking is a question to ask, not evidence of wrongdoing. Check each line against the budget document it links to.',
      ]} />
    </section>
  );
}
