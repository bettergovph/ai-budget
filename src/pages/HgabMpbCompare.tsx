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
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { DisclaimerNotice, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import { HGAB_ROOT, REGION_LABELS, REGION_ORDER, loadFloodCompare, loadMpbCompare, type HgabGeo } from '../lib/hgab';
import { HISTORY_ROOT, HISTORY_TITLE, listHref } from '../lib/hgab-history';
import { MPB_MAP_ROOT, type MpbData } from '../lib/hgab-mpb-years';
import {
  COMPARE_COLORS, COMPARE_TOPICS, compareByRegion, compareCopy, compareFigures, compareFrame, dotRadius,
  drawCompareMap, heatColor, inView, legendWidth, matrixCopy, matrixLabel, panelDots, phpCell, pct, phpWords, placeDots, provincePaths, signed,
  type ComparePanelCopy, type CompareCopy, type RegionRow, type RegionYearMatrix, type CompareFigures, type CompareInput, type CompareTopic, type CompareTopicKey,
} from '../lib/mpb-compare';
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

/**
 * Every region in every budget (Jason, 2026-11-06: "I want a matrix of the MPBs per region and per year. I want the same
 * for flood control as well"). Regions north to south, budgets oldest first; a cell goes from light green to red with
 * its amount (heatColor), and each column adds up to the budget's total in the last row.
 */
function RegionYearTable({ topic, matrix, builtAt }: { topic: CompareTopic; matrix: RegionYearMatrix; builtAt: string }) {
  const rows = useMemo(() => [...matrix.rows].sort((a, b) =>
    (a.region ? REGION_ORDER.indexOf(a.region) : 99) - (b.region ? REGION_ORDER.indexOf(b.region) : 99)), [matrix.rows]);
  const max = Math.max(...matrix.rows.flatMap((r) => r.cells.map((c) => c.php)));
  const copy = useMemo(() => matrixCopy(topic, matrix, builtAt), [topic, matrix, builtAt]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // The shareable image (Jason, 2026-11-06: "a shareable version of that with our BetterGov logo, our disclaimer").
  const download = async () => {
    setBusy(true); setFailed(null);
    try {
      const { renderMatrixImage } = await import('../lib/mpb-matrix-image');
      const canvas = await renderMatrixImage({ matrix, copy, logoUrl: LOGO_ON_WHITE, scale: 2 });
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/png'));
      if (!blob) throw new Error('the browser could not make the image');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = topic.matrixImageName;
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
  const cell = (c: { lines: number; php: number }, b: number, style?: CSSProperties) => (
    <td key={b} className="is-num" style={style} title={c.lines ? `${n(c.lines)} ${c.lines === 1 ? 'line' : 'lines'}, ${phpWords(c.php)}` : 'No line'}>
      {c.lines ? phpCell(c.php) : '—'}
    </td>
  );
  return (
    <section className="nep-section mpbc-section" id="by-region-and-year" aria-labelledby="mpbc-matrix-h">
      <div className="mpbc-matrix-head">
        <div>
          <h2 id="mpbc-matrix-h" className="mpbc-h2">By region and year</h2>
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
            <tr>
              <th scope="col">Region</th>
              {matrix.budgets.map((b) => <th key={b.key} scope="col" className="is-num">{matrixLabel(b)}{b.note ? '*' : ''}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.region ?? 'none'}>
                <th scope="row">
                  {r.region ? <>{REGION_LABELS[r.region].short}<span className="mpbc-matrix-name"> · {REGION_LABELS[r.region].name}</span></> : 'No region'}
                </th>
                {r.cells.map((c, i) => cell(c, i, heat(c.php)))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">All regions</th>
              {matrix.totals.map((c, i) => cell(c, i))}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mpbc-more">
        {copy.notes.join(' ')}
      </p>
    </section>
  );
}
