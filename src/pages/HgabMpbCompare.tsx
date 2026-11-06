/**
 * Budgets side by side on maps, one page per topic:
 *   - `/hgab/2027/multi-purpose/nep-vs-house-bill` (Multi-purpose buildings menu → NEP vs House bill): the 2027 NEP and
 *     the House bill, two maps;
 *   - `/hgab/2027/flood-control` ("Flood control projects are back"; linked from no menu yet): 2025, 2026 and 2027, three
 *     maps, the 2027 one holding the NEP and the House bill in different colours.
 * One figure, built to be screenshot and published: the headline amounts, the changes, and the maps with every line as
 * a dot. Below it, the figures by region.
 *
 * `?shot=1` shows the figure alone on a plain page, at its full 1200-pixel width, for a clean screenshot.
 *
 * Data and drawing: src/lib/mpb-compare.ts (pure figures, dot layout, and a canvas drawing the poster can reuse).
 */
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { DisclaimerNotice, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import { HGAB_ROOT, REGION_LABELS, REGION_ORDER, loadFloodCompare, loadMpbCompare, type HgabGeo } from '../lib/hgab';
import { HISTORY_ROOT, HISTORY_TITLE, listHref } from '../lib/hgab-history';
import { MPB_MAP_ROOT, type MpbData } from '../lib/hgab-mpb-years';
import {
  COMPARE_COLORS, COMPARE_TOPICS, compareByRegion, compareCopy, compareFigures, compareFrame, dotRadius,
  drawCompareMap, heatColor, inView, legendWidth, matrixCopy, matrixLabel, panelDots, partyCopy, partyGrid, phpCell, pct, phpWords, placeDots, provincePaths, signed,
  type AboutData, type ComparePanelCopy, type CompareCopy, type GridSpec, type MatrixCopy, type PartyYearMatrix, type RegionRow,
  type RegionYearMatrix, type ScopeRow, type CompareFigures, type CompareInput, type CompareTopic, type CompareTopicKey,
} from '../lib/mpb-compare';
import { PARTIES_ROOT } from '../lib/hgab-parties';
import { pageMeta } from '../lib/seo';
import '../nep2027.css';
import '../hgab-mpb-compare.css';

const n = (v: number) => v.toLocaleString('en-US');
const LOGO = '/brand/bettergov-horizontal-white.png';
const LOGO_ON_WHITE = '/brand/bettergov-horizontal-primary.png';

const LOADERS: Record<CompareTopicKey, () => Promise<CompareInput>> = { mpb: loadMpbCompare, flood: loadFloodCompare };
/** The DPWH project list, filtered to the Flood Management Program (as the chart by year links it). */
const FLOOD_LIST = listHref({ dataset: 'dpwh', params: { program: 'Flood Management Program' } });

export default function HgabMpbCompare({ topic: key = 'mpb' }: { topic?: CompareTopicKey }) {
  const topic = COMPARE_TOPICS[key];
  const [params] = useSearchParams();
  const shot = params.has('shot');
  const [state, setState] = useState<CompareInput | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    LOADERS[key]().then((x) => { if (live) setState(x); }).catch((e) => { if (live) setErr(String(e?.message || e)); });
    return () => { live = false; };
  }, [key]);
  useEffect(() => { document.title = pageMeta(topic.root).title; }, [topic.root]);
  if (err) return <HgabError message={err} />;
  if (!state) return shot ? <main className="mpbc-shot" aria-busy="true" /> : <HgabLoading what={`the ${topic.lineWords}`} />;
  const figures = compareFigures(state.data);
  if (shot) {
    return (
      <main className="mpbc-shot">
        <CompareFigure topic={topic} input={state} f={figures} />
      </main>
    );
  }
  const crumbHome = key === 'flood'
    ? <Link to={`${HGAB_ROOT}/dpwh`}>DPWH</Link>
    : <Link to={HISTORY_ROOT}>{HISTORY_TITLE}</Link>;
  return (
    <>
      <HgabHeader crumb={topic.title} />
      <HgabHero
        compact
        crumb={<>{crumbHome}<span className="hgab-crumb-sep" aria-hidden="true">·</span><span className="hgab-crumb-here">{key === 'flood' ? topic.title : 'NEP vs House bill'}</span></>}
        title={key === 'flood'
          ? <>Flood control: {n(figures.budgets['gaa-2025'].lines)} lines in 2025, {n(figures.budgets['gaa-2026'].lines)} in 2026, {n(figures.house.lines)} in the 2027 House bill</>
          : <>The 2027 House bill carries {n(figures.house.lines)} {topic.lineWords}; the NEP carried {n(figures.nep.lines)}</>}
        dek={key === 'flood'
          ? <>The 2025 and 2026 budgets and 2027’s NEP and House bill, side by side, with every line on the map. <Link to="?shot=1">Open the figure alone</Link> for a clean screenshot.</>
          : <>The President’s budget and the House bill, side by side, with every line on the map. <Link to="?shot=1">Open the figure alone</Link> for a clean screenshot.</>}
      />
      <main className="nep-main mpbc-main">
        <DownloadBar topic={topic} input={state} f={figures} />
        <CompareFigure topic={topic} input={state} f={figures} />
        {key === 'mpb' && <RegionTable topic={topic} data={state.data} />}
        <RegionYearTable topic={topic} matrix={state.matrix} builtAt={state.builtAt} />
        <PartyYearTable topic={topic} parties={state.parties} builtAt={state.builtAt} />
        <AboutThisData topic={topic} about={state.about} />
        {key === 'flood' ? (
          <p className="mpbc-more">
            <Link to={FLOOD_LIST}>Every 2027 flood control line in the DPWH project list →</Link>{' · '}
            <Link to={HISTORY_ROOT}>The flood control budget by year →</Link>
          </p>
        ) : (
          <p className="mpbc-more">
            <Link to={`${MPB_MAP_ROOT}?years=2027`}>Every 2027 line on the interactive map →</Link>{' · '}
            <Link to={HISTORY_ROOT}>The multi-purpose building budget by year →</Link>
          </p>
        )}
        <DisclaimerNotice compact flood={key === 'flood'} />
      </main>
      <SiteFooter />
    </>
  );
}

// ---------------------------------------------------------------------------
// The figure (screenshot this)
// ---------------------------------------------------------------------------

/** The figure's words for this data (the image uses the same). */
function useCopy(topic: CompareTopic, input: CompareInput, f: CompareFigures): CompareCopy {
  const { data, builtAt, foreignOnly } = input;
  const last = topic.panels[topic.panels.length - 1];
  const offMap = useMemo(() => panelDots(data, last).filter((d) => d.color !== 'yellow' && !inView(d)).length, [data, last]);
  return useMemo(() => compareCopy(topic, f, builtAt, { offMap, foreignOnly }), [topic, f, builtAt, offMap, foreignOnly]);
}

interface FigureProps { topic: CompareTopic; input: CompareInput; f: CompareFigures }

/** The longest title line, in characters: past 58 (₱103.5 billion in the NEP…) it is set a size smaller, so it stays one line. */
const longest = (copy: CompareCopy) => Math.max(...copy.title.map((line) => line.reduce((a, r) => a + r.text.length, 0)));

/** Download the figure as a PNG, drawn on a canvas at twice its size (outside the figure, so screenshots stay clean). */
function DownloadBar({ topic, input, f }: FigureProps) {
  const { data, geo } = input;
  const copy = useCopy(topic, input, f);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const download = async () => {
    setBusy(true); setFailed(null);
    try {
      const { renderCompareImage } = await import('../lib/mpb-compare-image');
      const canvas = await renderCompareImage({ data, geo, copy, logoUrl: LOGO, scale: 2 });
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
      if (!blob) throw new Error('the browser could not make the image');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = topic.imageName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      setFailed(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mpbc-tools">
      <button type="button" className="hgab-cta hgab-cta-primary" onClick={download} disabled={busy}>
        {busy ? 'Drawing the image…' : 'Download image (PNG)'}
      </button>
      <span>The figure below as one picture, 2,400 pixels wide, ready to post.</span>
      {failed && <span role="status">The image did not draw ({failed}).</span>}
    </div>
  );
}

function CompareFigure({ topic, input, f }: FigureProps) {
  const { data, geo } = input;
  const copy = useCopy(topic, input, f);
  // Three maps leave no open sea for the labels: they sit above each map instead.
  const stacked = copy.panels.length > 2;
  return (
    <section className="mpbc-figure" id="figure" aria-labelledby="mpbc-title">
      <header className="mpbc-head">
        <div>
          <p className="mpbc-kicker">{copy.kicker}</p>
          <h2 id="mpbc-title" className={`mpbc-title${longest(copy) > 58 ? ' is-long' : ''}`}>
            {copy.title.map((line, i) => (
              <span key={i} className="mpbc-title-line">
                {line.map((r, j) => (r.red ? <span key={j} className="is-red">{r.text}</span> : <span key={j}>{r.text}</span>))}
              </span>
            ))}
          </h2>
        </div>
        <img className="mpbc-logo" src={LOGO} alt="BetterGov.ph" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      </header>

      <div className="mpbc-change" role="list" aria-label="What changed">
        {copy.cells.map((c) => (
          <div role="listitem" key={c.span} className={c.tone === 'red' ? 'is-red' : undefined}>
            <strong>{c.strong}</strong><span>{c.span}</span>
          </div>
        ))}
      </div>

      <div className={`mpbc-maps${stacked ? ' is-stacked' : ''}`} style={{ '--mpbc-cols': copy.panels.length } as CSSProperties}>
        {copy.panels.map((p) => <CompareMap key={p.key} data={data} geo={geo} panel={p} stacked={stacked} />)}
      </div>

      <footer className="mpbc-foot">
        <ul className="mpbc-legend" aria-label="Legend">
          {copy.legend.map((g, gi) => (
            <Fragment key={gi}>
              {gi > 0 && <li className="mpbc-legend-break" aria-hidden="true" />}
              {g.title && <li className="mpbc-legend-title">{g.title}</li>}
              {g.items.map((l) => (
                <li key={l.color}><i style={{ background: COMPARE_COLORS.swatch[l.color] }} />{l.label}</li>
              ))}
            </Fragment>
          ))}
          <li className="mpbc-sizes">
            {copy.sizes.map((sz) => {
              const r = dotRadius(sz.php, legendWidth(copy.panels.length));
              return <span key={sz.php}><i style={{ width: r * 2, height: r * 2 }} />{sz.label}</span>;
            })}
          </li>
        </ul>
        <p className="mpbc-notes">{copy.notes}</p>
        <p className="mpbc-disclaimer"><strong>Disclaimer.</strong> {copy.disclaimer}</p>
        <p className="mpbc-source"><span>{copy.source[0]}</span><span>{copy.source[1]}</span></p>
      </footer>
    </section>
  );
}

/**
 * One map, every line as a dot, with its label: the year or document, its amount(s) and lines. Two maps: the label sits
 * on the open sea west of Luzon; three: above the map.
 */
function CompareMap({ data, geo, panel, stacked }: { data: MpbData; geo: HgabGeo; panel: ComparePanelCopy; stacked: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dots = useMemo(() => panelDots(data, panel.key), [data, panel.key]);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !width) return;
    const frame = compareFrame(width);
    const dpr = Math.max(2, window.devicePixelRatio || 1);
    c.width = Math.round(frame.width * dpr);
    c.height = Math.round(frame.height * dpr);
    c.style.height = `${frame.height}px`;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCompareMap(ctx, frame, provincePaths(geo, frame), placeDots(dots, frame));
  }, [width, dots, geo]);
  const label = (
    <figcaption className="mpbc-side">
      <span className="mpbc-side-name">{panel.name}</span>
      <span className="mpbc-side-sub">{panel.sub}</span>
      <span className="mpbc-side-amounts">
        {panel.amounts.map((a) => (
          <span key={a.php} className="mpbc-side-amount">
            <strong className={`mpbc-side-php${a.tone === 'red' ? ' is-red' : ''}`}>{a.php}</strong>
            {a.label && <span className="mpbc-side-label">{a.label}</span>}
          </span>
        ))}
      </span>
      <span className="mpbc-side-lines">{panel.lines}</span>
    </figcaption>
  );
  const aria = `${panel.name}: ${panel.amounts.map((a) => `${a.label ? `${a.label} ` : ''}${a.php}`).join(', ')}, ${panel.lines}, one dot each`;
  return (
    <figure className="mpbc-map">
      {stacked && label}
      <div className="mpbc-canvas" ref={wrap}>
        <canvas ref={canvas} role="img" aria-label={aria} />
        {!stacked && label}
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// By region
// ---------------------------------------------------------------------------

const regionLabel = (region: RegionRow['region']) => (region ? `${REGION_LABELS[region].short} · ${REGION_LABELS[region].name}` : 'No region');

/** The NEP vs House bill totals by region, with the change (multi-purpose buildings). */
function RegionTable({ topic, data }: { topic: CompareTopic; data: MpbData }) {
  const rows = useMemo(() => compareByRegion(data, topic.budgets), [data, topic.budgets]);
  const label = regionLabel;
  const [nepKey, houseKey] = topic.budgets;
  return (
    <section className="nep-section mpbc-section" aria-labelledby="mpbc-regions-h">
      <h2 id="mpbc-regions-h" className="mpbc-h2">By region</h2>
      <p className="mpbc-dek">A line’s region is the one its title or office places it in. Largest House bill amount first.</p>
      <div className="mpbc-tablewrap">
        <table className="mpbc-table">
          <thead>
            <tr>
              <th scope="col">Region</th>
              <th scope="col" className="is-num">NEP lines</th>
              <th scope="col" className="is-num">NEP</th>
              <th scope="col" className="is-num">House bill lines</th>
              <th scope="col" className="is-num">House bill</th>
              <th scope="col" className="is-num">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const [nep, house] = [r.by[nepKey], r.by[houseKey]];
              const p = pct(house.php, nep.php);
              return (
                <tr key={r.region ?? 'none'}>
                  <td>{label(r.region)}</td>
                  <td className="is-num">{n(nep.lines)}</td>
                  <td className="is-num">{phpWords(nep.php)}</td>
                  <td className="is-num">{n(house.lines)}</td>
                  <td className="is-num">{phpWords(house.php)}</td>
                  <td className="is-num">{signed(house.php - nep.php, phpWords)}{p != null && <span className="mpbc-sub">{p > 0 ? '+' : ''}{p}%</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The region grid's rows (north to south, then No region), for the page and its image. */
function regionSpec(matrix: RegionYearMatrix): GridSpec {
  const rows = [...matrix.rows].sort((a, b) =>
    (a.region ? REGION_ORDER.indexOf(a.region) : 99) - (b.region ? REGION_ORDER.indexOf(b.region) : 99));
  return {
    budgets: matrix.budgets, groups: null, headLabel: 'Region', totals: matrix.totals, totalLabel: 'All regions',
    rows: rows.map((r) => ({
      key: r.region ?? 'none',
      short: r.region ? REGION_LABELS[r.region].short : 'No region',
      name: r.region ? REGION_LABELS[r.region].name : null,
      cells: r.cells, heat: true,
      titles: r.cells.map((c) => (c.lines ? `${n(c.lines)} ${c.lines === 1 ? 'line' : 'lines'}, ${phpWords(c.php)}` : 'No line')),
    })),
  };
}

/**
 * Every region in every budget (Jason, 2026-11-06: "I want a matrix of the MPBs per region and per year. I want the same
 * for flood control as well").
 */
function RegionYearTable({ topic, matrix, builtAt }: { topic: CompareTopic; matrix: RegionYearMatrix; builtAt: string }) {
  const spec = useMemo(() => regionSpec(matrix), [matrix]);
  const copy = useMemo(() => matrixCopy(topic, matrix, builtAt), [topic, matrix, builtAt]);
  return (
    <YearGrid id="by-region-and-year" heading="By region and year" spec={spec} copy={copy} imageName={topic.matrixImageName}
      after={<> See <a href="#about-data">how we grouped them</a>.</>} />
  );
}

/**
 * Every party in every budget (Jason, 2026-11-06: "map the charts based on their political party for that year"): the
 * party of the district's representative in the Congress that passed the budget, the Congress over its years.
 */
function PartyYearTable({ topic, parties, builtAt }: { topic: CompareTopic; parties: PartyYearMatrix; builtAt: string }) {
  const grid = useMemo(() => partyGrid(parties), [parties]);
  const copy = useMemo(() => partyCopy(topic, parties, builtAt, grid.folded), [topic, parties, builtAt, grid.folded]);
  return (
    <YearGrid id="by-party-and-year" heading="By party and year" spec={grid.spec} copy={copy} imageName={topic.partyImageName}
      after={<> Each district’s representative today is on <Link to={PARTIES_ROOT}>the 2027 House bill by party</Link>.</>} />
  );
}

/**
 * A year grid (regions or parties): rows, budgets oldest first, an All row; a cell goes from light green to red with its
 * amount (heatColor) against the largest shaded cell; rows that carry no region or party are plain. "Download image
 * (PNG)" draws the same table (Jason, 2026-11-06: "a shareable version of that with our BetterGov logo, our disclaimer").
 */
function YearGrid({ id, heading, spec, copy, imageName, after }: {
  id: string; heading: string; spec: GridSpec; copy: MatrixCopy; imageName: string; after?: ReactNode;
}) {
  const max = Math.max(...spec.rows.filter((r) => r.heat).flatMap((r) => r.cells.map((c) => c.php)));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const download = async () => {
    setBusy(true); setFailed(null);
    try {
      const { renderMatrixImage } = await import('../lib/mpb-matrix-image');
      const canvas = await renderMatrixImage({ spec, copy, logoUrl: LOGO_ON_WHITE, scale: 2 });
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
      if (!blob) throw new Error('the browser could not make the image');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = imageName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      setFailed(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };
  const heat = (php: number): CSSProperties | undefined => {
    if (!php) return undefined;
    const t = Math.sqrt(php / max);
    return { background: heatColor(t), color: t > 0.72 ? '#fff' : undefined };
  };
  const hId = `${id}-h`;
  return (
    <section className="nep-section mpbc-section" id={id} aria-labelledby={hId}>
      <div className="mpbc-matrix-head">
        <div>
          <h2 id={hId} className="mpbc-h2">{heading}</h2>
          <p className="mpbc-dek">{copy.dek} Hover a cell for its lines.</p>
        </div>
        <div className="mpbc-tools is-inline">
          <button type="button" className="hgab-cta hgab-cta-primary" onClick={download} disabled={busy}>
            {busy ? 'Drawing the image…' : 'Download image (PNG)'}
          </button>
          {failed && <span role="status">The image did not draw ({failed}).</span>}
        </div>
      </div>
      <div className="mpbc-tablewrap">
        <table className="mpbc-table mpbc-matrix">
          <thead>
            {spec.groups && (
              <tr className="mpbc-groups">
                <th aria-hidden="true" />
                {spec.groups.map((g) => <th key={g.label} scope="colgroup" colSpan={g.span}>{g.label}</th>)}
              </tr>
            )}
            <tr>
              <th scope="col">{spec.headLabel}</th>
              {spec.budgets.map((b) => <th key={b.key} scope="col" className="is-num">{matrixLabel(b)}{b.note ? '*' : ''}</th>)}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((r) => (
              <tr key={r.key} className={r.heat ? undefined : 'is-plain'}>
                <th scope="row">{r.short}{r.name && <span className="mpbc-matrix-name"> · {r.name}</span>}</th>
                {r.cells.map((c, i) => (
                  <td key={i} className="is-num" style={r.heat ? heat(c.php) : undefined} title={r.titles[i]}>
                    {c.lines ? phpCell(c.php) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{spec.totalLabel}</th>
              {spec.totals.map((c, i) => (
                <td key={i} className="is-num" title={c.lines ? `${n(c.lines)} lines, ${phpWords(c.php)}` : 'No line'}>{c.lines ? phpCell(c.php) : '—'}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mpbc-more">{copy.notes.join(' ')}{after}</p>
    </section>
  );
}

/**
 * Each page's data, described (Jason, 2026-11-06: "For flood control, we need a description how we grouped them, what
 * fields and caveats as well"; then "Let's do the same for MPBs"): each budget's grouping, the CSV's fields, the caveats.
 */
function AboutThisData({ topic, about }: { topic: CompareTopic; about: AboutData }) {
  const flood = topic.key === 'flood';
  const label = (r: ScopeRow) => (r.stage === 'gaa' ? `${r.fy} GAA` : `${r.fy} ${r.stage === 'nep' ? 'NEP' : 'House bill'}`);
  const checked = (r: ScopeRow) => (r.check === 'chart' ? 'Our budget-by-year chart'
    : r.check === 'chart_budget_lines' ? `Our budget-by-year chart, for the budget lines (${phpWords(r.chart_php ?? 0)})`
      : r.check === 'printed_headings' ? 'The headings the document prints' : 'No published total');
  const leftOut = about.scope.some((r) => r.left_out?.lines);
  return (
    <section className="nep-section mpbc-section mpbc-about" id="about-data" aria-labelledby="mpbc-about-h">
      <h2 id="mpbc-about-h" className="mpbc-h2">About this data</h2>

      <h3 className="mpbc-h3">How we grouped them</h3>
      <p className="mpbc-dek">
        {flood
          ? <>Each budget is counted by its own flood control codes, as printed. The codes changed over the years, so each row says what we counted and what checks the total.</>
          : <>A line counts when it is a multi-purpose building budget line, or when its title names a multi-purpose building or hall under another heading. Each row says what we counted and what checks the total.</>}
      </p>
      <div className="mpbc-tablewrap">
        <table className="mpbc-table mpbc-scope">
          <thead>
            <tr>
              <th scope="col">Budget</th>
              <th scope="col">What we count</th>
              <th scope="col" className="is-num">Lines</th>
              <th scope="col" className="is-num">Amount</th>
              <th scope="col">Total checked against</th>
              {leftOut && <th scope="col" className="is-num">{about.leftOutLabel}</th>}
            </tr>
          </thead>
          <tbody>
            {about.scope.map((r) => (
              <tr key={r.key}>
                <th scope="row">{label(r)}<span className="mpbc-sub">{r.source}</span></th>
                <td>
                  {r.parts.map((p) => (
                    <span key={p.label} className="mpbc-part">{p.label}: {phpWords(p.php)}{r.parts.length > 1 && <> ({n(p.lines)} lines)</>}</span>
                  ))}
                </td>
                <td className="is-num">{n(r.lines)}</td>
                <td className="is-num">{phpWords(r.php)}</td>
                <td>{checked(r)}</td>
                {leftOut && (
                  <td className="is-num">
                    {r.left_out?.lines ? (r.left_out.php ? phpWords(r.left_out.php) : `${n(r.left_out.lines)} items`) : '—'}
                    {r.left_out?.lines && r.left_out.php ? <span className="mpbc-sub">{n(r.left_out.lines)} lines</span> : null}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mpbc-h3">Fields</h3>
      <p className="mpbc-dek">
        <a href={about.csvUrl} download={about.csvName}>Download every line (CSV, {(about.csvBytes / 1e6).toFixed(1)} MB)</a>.
        One row per line and year, 2015 to the 2027 House bill; a 2027 line carries both its NEP and House bill amounts.
      </p>
      <dl className="mpbc-fields">
        {about.fields.map((f) => (
          <div key={f.name}><dt><code>{f.name}</code></dt><dd>{f.about}</dd></div>
        ))}
      </dl>

      <h3 className="mpbc-h3">Caveats</h3>
      {flood ? (
        <ul className="mpbc-caveats">
          <li>2020 to 2026 equal our budget-by-year chart. 2018 and 2019 use the same codes; 2019’s lines add up to the headings its document prints.</li>
          <li>2015 to 2017 use an older code set. We count its flood families (162… and 292…), named from their lines; no published total checks them.</li>
          <li>What counts changes over time: BIP and SIPAG flood mitigation from 2022 to 2025, the Local Program’s flood lines from 2018 to 2021.</li>
          <li>2026 holds only foreign-assisted projects. 2027 is the President’s proposal and the House bill, not yet law.</li>
          <li>Lines with flood words in their titles under other codes are not counted (last column of the table). The words: {(about.floodWords ?? '').split('|').join(', ')}.</li>
          <li>2019 is read from the technical GAA’s text. Its DPWH total differs from the summary volume’s (₱454.0 billion against ₱549.4 billion); we use the technical edition.</li>
          <li>A line’s region is where its title or office places it. Head-office lines that name no place sit at the region the budget lists them under.</li>
          <li>The 2016, 2017 and 2019 files list no region for head-office lines, so those naming no place are under No region.</li>
          <li>Offices before 2020 are matched to today’s DPWH offices by name, and legislative districts are today’s.</li>
          <li>2027’s matches between the NEP and the House bill are candidates from comparing documents, not confirmed changes.</li>
          <li>Amounts are allocations in the budgets, not spending. A project funded over several years has a line in each year.</li>
        </ul>
      ) : (
        <ul className="mpbc-caveats">
          <li>The budget lines for multi-purpose buildings change with the budget’s structure: the Local Program’s from 2018 to 2021, then BIP and SIPAG’s.</li>
          <li>2015 to 2017 have no multi-purpose building line, so every line there is in by its title.</li>
          <li>Lines in by title add to the totals, so this page and the map run higher than our budget-by-year chart, which counts the budget lines only.</li>
          <li>A title counts when it names a multi-purpose building or hall, the source workbench’s rule. A title that names neither is not counted.</li>
          {about.scope.filter((r) => r.left_out?.lines).map((r) => (
            <li key={r.key}>The {r.fy} budget lists {n(r.left_out!.lines)} items named for multi-purpose buildings at ₱0; they are left out.</li>
          ))}
          <li>2019 is read from the technical GAA’s text. Its DPWH total differs from the summary volume’s (₱454.0 billion against ₱549.4 billion); we use the technical edition.</li>
          <li>A line’s region is where its title or office places it. Head-office lines that name no place are under No region.</li>
          <li>Offices before 2020 are matched to today’s DPWH offices by name, and legislative districts are today’s.</li>
          <li>2027’s matches between the NEP and the House bill are candidates from comparing documents, not confirmed changes.</li>
          <li>Amounts are allocations in the budgets, not spending. A building funded over several years has a line in each year.</li>
        </ul>
      )}
    </section>
  );
}
