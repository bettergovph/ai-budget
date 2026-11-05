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
  COMPARE_COLORS, COMPARE_LABELS, HOUSE_ONLY_NOTE, MPB_COMPARE_TITLE, compareByRegion, compareFigures, compareFrame,
  dotRadius, drawCompareMap, inView, pct, phpWords, placeDots, provincePaths, sideDots, signed,
  type CompareFigures, type CompareSide,
} from '../lib/mpb-compare';
import { pageMeta } from '../lib/seo';
import '../nep2027.css';
import '../hgab-mpb-compare.css';

const SITE_URL = 'budget.bettergov.ph/hgab/2027/multi-purpose/nep-vs-house-bill';
const n = (v: number) => v.toLocaleString('en-US');
const bShort = (v: number) => `₱${(v / 1e9).toFixed(1)}B`;
const asOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });
};

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

function CompareFigure({ data, summary, geo, f }: { data: MpbData; summary: MpbSummary; geo: HgabGeo; f: CompareFigures }) {
  const change = f.house.php - f.nep.php;
  const offMap = useMemo(() => (['nep', 'house'] as CompareSide[]).map((s) => sideDots(data, s).filter((d) => !inView(d)).length), [data]);
  return (
    <section className="mpbc-figure" id="figure" aria-labelledby="mpbc-title">
      <header className="mpbc-head">
        <div>
          <p className="mpbc-kicker">Multi-purpose buildings · 2027 budget</p>
          <h2 id="mpbc-title" className="mpbc-title">
            {phpWords(f.nep.php)} in the NEP. <span className="is-house">{phpWords(f.house.php)}</span> in the House bill.
          </h2>
        </div>
        <img className="mpbc-logo" src="/brand/bettergov-horizontal-white.png" alt="BetterGov.ph" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      </header>

      <div className="mpbc-change" role="list" aria-label="What changed">
        <div role="listitem"><strong>{signed(change, phpWords)}</strong><span>{pct(f.house.php, f.nep.php)}% more than the NEP</span></div>
        <div role="listitem"><strong>{signed(f.house.lines - f.nep.lines, n)} lines</strong><span>{n(f.nep.lines)} → {n(f.house.lines)}</span></div>
        <div role="listitem" className="is-house"><strong>{n(f.houseOnly.lines)} lines · {bShort(f.houseOnly.php)}</strong><span>In the House bill only</span></div>
        <div role="listitem" className="is-nep"><strong>{n(f.nepOnly.lines)} lines · {bShort(f.nepOnly.php)}</strong><span>In the NEP only</span></div>
        <div role="listitem"><strong>{n(f.paired.lines)} lines</strong><span>In both · {n(f.paired.higher)} higher, {n(f.paired.lower)} lower</span></div>
      </div>

      <div className="mpbc-maps">
        <CompareMap data={data} geo={geo} side="nep" f={f} />
        <CompareMap data={data} geo={geo} side="house" f={f} />
      </div>

      <footer className="mpbc-foot">
        <ul className="mpbc-legend" aria-label="Legend">
          {(['paired', 'house_only', 'nep_only'] as const).map((c) => (
            <li key={c}><i style={{ background: COMPARE_COLORS.swatch[c] }} />{COMPARE_LABELS[c]}</li>
          ))}
          <li className="mpbc-sizes">
            {[5e6, 25e6, 100e6].map((v) => {
              const r = dotRadius(v, 600);
              return <span key={v}><i style={{ width: r * 2, height: r * 2 }} />{phpWords(v).replace(' million', 'M')}</span>;
            })}
          </li>
        </ul>
        <p className="mpbc-notes">
          One dot is one budget line, sized by its amount and placed by the place its title names (GPS where published).
          {' '}{HOUSE_ONLY_NOTE} Amounts are allocations, not spending.
          {offMap[1] > 0 && <> {n(offMap[1])} House bill lines in the Kalayaan islands are counted but off the map’s edge.</>}
        </p>
        <p className="mpbc-source">
          <span>Source: NEP 2027 (DBM) and House Bill 10858, third reading; DPWH multi-purpose building lines</span>
          <span>{SITE_URL} · As of {asOf(summary.built_at)}</span>
        </p>
      </footer>
    </section>
  );
}

/** One side's map: its amounts on the open sea (top left), its own lines (top right), every line as a dot. */
function CompareMap({ data, geo, side, f }: { data: MpbData; geo: HgabGeo; side: CompareSide; f: CompareFigures }) {
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
  const dots = useMemo(() => sideDots(data, side), [data, side]);
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
  const t = side === 'nep' ? f.nep : f.house;
  const own = side === 'nep' ? f.nepOnly : f.houseOnly;
  return (
    <figure className={`mpbc-map is-${side}`}>
      <div className="mpbc-canvas" ref={wrap}>
        <canvas ref={canvas} role="img"
          aria-label={`${side === 'nep' ? 'NEP' : 'House bill'}: ${n(t.lines)} multi-purpose building lines, ${phpWords(t.php)}, one dot each`} />
        <figcaption className="mpbc-side">
          <span className="mpbc-side-name">{side === 'nep' ? 'NEP' : 'House bill'}</span>
          <span className="mpbc-side-sub">{side === 'nep' ? 'The President’s budget' : 'House Bill 10858, third reading'}</span>
          <strong className="mpbc-side-php">{bShort(t.php)}</strong>
          <span className="mpbc-side-lines">{n(t.lines)} lines</span>
        </figcaption>
        <p className={`mpbc-own is-${side}`}>
          <strong>{n(own.lines)}</strong> lines, {bShort(own.php)}
          <span>{side === 'nep' ? 'in the NEP only' : 'in the House bill only'}</span>
        </p>
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
              <th scope="col" className="is-num">House bill only</th>
              <th scope="col" className="is-num">NEP only</th>
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
                  <td className="is-num is-house">{n(r.houseOnly.lines)}<span className="mpbc-sub">{phpWords(r.houseOnly.php)}</span></td>
                  <td className="is-num is-nep">{n(r.nepOnly.lines)}<span className="mpbc-sub">{phpWords(r.nepOnly.php)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mpbc-more">{HOUSE_ONLY_NOTE}</p>
    </section>
  );
}
