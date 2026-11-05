/**
 * `/hgab/2027/multi-purpose/nep-vs-house-bill` (Multi-purpose buildings menu → NEP vs House bill): the 2027 NEP and
 * the House bill side by side for multi-purpose buildings. One figure, built to be screenshot and published: the
 * headline amounts, the change, and two maps with every line as a dot. Below it, the figures by region.
 *
 * `?shot=1` shows the figure alone on a plain page, at its full 1200-pixel width, for a clean screenshot.
 *
 * Data and drawing: src/lib/mpb-compare.ts (pure figures, dot layout, and a canvas drawing the poster can reuse).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { DisclaimerNotice, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import { REGION_LABELS, loadMpbCompare, type HgabGeo } from '../lib/hgab';
import { HISTORY_ROOT, HISTORY_TITLE } from '../lib/hgab-history';
import { MPB_MAP_ROOT, type MpbData, type MpbSummary } from '../lib/hgab-mpb-years';
import {
  COMPARE_COLORS, MPB_COMPARE_IMAGE_NAME, MPB_COMPARE_TITLE, compareByRegion, compareCopy, compareFigures,
  compareFrame, dotRadius, drawCompareMap, inView, mapDots, pct, phpWords, placeDots, provincePaths, sideDots, signed,
  type CompareCopy, type CompareFigures, type CompareSide,
} from '../lib/mpb-compare';
import { pageMeta } from '../lib/seo';
import '../nep2027.css';
import '../hgab-mpb-compare.css';

const n = (v: number) => v.toLocaleString('en-US');
const LOGO = '/brand/bettergov-horizontal-white.png';

export default function HgabMpbCompare() {
  const [params] = useSearchParams();
  const shot = params.has('shot');
  const [state, setState] = useState<{ data: MpbData; summary: MpbSummary; geo: HgabGeo } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadMpbCompare().then((x) => { if (live) setState(x); }).catch((e) => { if (live) setErr(String(e?.message || e)); });
    return () => { live = false; };
  }, []);
  useEffect(() => { document.title = pageMeta('/hgab/2027/multi-purpose/nep-vs-house-bill').title; }, []);
  if (err) return <HgabError message={err} />;
  if (!state) return shot ? <main className="mpbc-shot" aria-busy="true" /> : <HgabLoading what="the multi-purpose building lines" />;
  const figures = compareFigures(state.data);
  if (shot) {
    return (
      <main className="mpbc-shot">
        <CompareFigure data={state.data} summary={state.summary} geo={state.geo} f={figures} />
      </main>
    );
  }
  return (
    <>
      <HgabHeader crumb={MPB_COMPARE_TITLE} />
      <HgabHero
        compact
        crumb={<><Link to={HISTORY_ROOT}>{HISTORY_TITLE}</Link><span className="hgab-crumb-sep" aria-hidden="true">·</span><span className="hgab-crumb-here">NEP vs House bill</span></>}
        title={<>The 2027 House bill carries {n(figures.house.lines)} multi-purpose building lines; the NEP carried {n(figures.nep.lines)}</>}
        dek={<>The President’s budget and the House bill, side by side, with every line on the map. <Link to="?shot=1">Open the figure alone</Link> for a clean screenshot.</>}
      />
      <main className="nep-main mpbc-main">
        <DownloadBar data={state.data} summary={state.summary} geo={state.geo} f={figures} />
        <CompareFigure data={state.data} summary={state.summary} geo={state.geo} f={figures} />
        <RegionTable data={state.data} />
        <p className="mpbc-more">
          <Link to={`${MPB_MAP_ROOT}?years=2027`}>Every 2027 line on the interactive map →</Link>{' · '}
          <Link to={HISTORY_ROOT}>The multi-purpose building budget by year →</Link>
        </p>
        <DisclaimerNotice compact />
      </main>
      <SiteFooter />
    </>
  );
}

// ---------------------------------------------------------------------------
// The figure (screenshot this)
// ---------------------------------------------------------------------------

/** The figure's words for this data (the image uses the same). */
function useCopy(data: MpbData, summary: MpbSummary, f: CompareFigures): CompareCopy {
  const offMap = useMemo(() => sideDots(data, 'house').filter((d) => !inView(d)).length, [data]);
  return useMemo(() => compareCopy(f, summary.built_at, offMap), [f, summary.built_at, offMap]);
}

/** Download the figure as a PNG, drawn on a canvas at twice its size (outside the figure, so screenshots stay clean). */
function DownloadBar({ data, summary, geo, f }: { data: MpbData; summary: MpbSummary; geo: HgabGeo; f: CompareFigures }) {
  const copy = useCopy(data, summary, f);
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
      a.download = MPB_COMPARE_IMAGE_NAME;
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

function CompareFigure({ data, summary, geo, f }: { data: MpbData; summary: MpbSummary; geo: HgabGeo; f: CompareFigures }) {
  const copy = useCopy(data, summary, f);
  return (
    <section className="mpbc-figure" id="figure" aria-labelledby="mpbc-title">
      <header className="mpbc-head">
        <div>
          <p className="mpbc-kicker">{copy.kicker}</p>
          <h2 id="mpbc-title" className="mpbc-title">
            {copy.title.map((r, i) => (r.house ? <span key={i} className="is-house">{r.text}</span> : <span key={i}>{r.text}</span>))}
          </h2>
        </div>
        <img className="mpbc-logo" src={LOGO} alt="BetterGov.ph" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      </header>

      <div className="mpbc-change" role="list" aria-label="What changed">
        {copy.cells.map((c) => (
          <div role="listitem" key={c.span} className={c.tone === 'house' ? 'is-house' : undefined}>
            <strong>{c.strong}</strong><span>{c.span}</span>
          </div>
        ))}
      </div>

      <div className="mpbc-maps">
        <CompareMap data={data} geo={geo} side="nep" copy={copy} f={f} />
        <CompareMap data={data} geo={geo} side="house" copy={copy} f={f} />
      </div>

      <footer className="mpbc-foot">
        <ul className="mpbc-legend" aria-label="Legend">
          {copy.legend.map((l) => (
            <li key={l.color}><i style={{ background: COMPARE_COLORS.swatch[l.color] }} />{l.label}</li>
          ))}
          <li className="mpbc-sizes">
            {copy.sizes.map((sz) => {
              const r = dotRadius(sz.php, 600);
              return <span key={sz.php}><i style={{ width: r * 2, height: r * 2 }} />{sz.label}</span>;
            })}
          </li>
        </ul>
        <p className="mpbc-notes">{copy.notes}</p>
        <p className="mpbc-source"><span>{copy.source[0]}</span><span>{copy.source[1]}</span></p>
      </footer>
    </section>
  );
}

/** One side's map: its amounts on the open sea (top left), its own lines (top right), every line as a dot. */
function CompareMap({ data, geo, side, copy, f }: { data: MpbData; geo: HgabGeo; side: CompareSide; copy: CompareCopy; f: CompareFigures }) {
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
  const dots = useMemo(() => mapDots(data, side), [data, side]);
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
    drawCompareMap(ctx, frame, provincePaths(geo, frame), placeDots(dots, frame), side);
  }, [width, dots, geo, side]);
  const t = side === 'nep' ? f.nep : f.house;
  const s = copy.sides[side];
  return (
    <figure className={`mpbc-map is-${side}`}>
      <div className="mpbc-canvas" ref={wrap}>
        <canvas ref={canvas} role="img"
          aria-label={`${side === 'nep' ? 'NEP' : 'House bill'}: ${n(t.lines)} multi-purpose building lines, ${phpWords(t.php)}, one dot each`} />
        <figcaption className="mpbc-side">
          <span className="mpbc-side-name">{s.name}</span>
          <span className="mpbc-side-sub">{s.sub}</span>
          <strong className="mpbc-side-php">{s.php}</strong>
          <span className="mpbc-side-lines">{s.lines}</span>
        </figcaption>
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// By region
// ---------------------------------------------------------------------------

function RegionTable({ data }: { data: MpbData }) {
  const rows = useMemo(() => compareByRegion(data), [data]);
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
              const label = r.region ? `${REGION_LABELS[r.region].short} · ${REGION_LABELS[r.region].name}` : 'No region';
              const p = pct(r.house.php, r.nep.php);
              return (
                <tr key={r.region ?? 'none'}>
                  <td>{label}</td>
                  <td className="is-num">{n(r.nep.lines)}</td>
                  <td className="is-num">{phpWords(r.nep.php)}</td>
                  <td className="is-num">{n(r.house.lines)}</td>
                  <td className="is-num">{phpWords(r.house.php)}</td>
                  <td className="is-num">{signed(r.house.php - r.nep.php, phpWords)}{p != null && <span className="mpbc-sub">{p > 0 ? '+' : ''}{p}%</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
