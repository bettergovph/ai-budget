/**
 * `/hgab/2027/roads` (DPWH menu): every road and bridge line in every budget we hold, the FY2015 to FY2026 enacted
 * budgets and the 2027 NEP and House bill, one budget at a time, on a map and in a list. Jason (2026-11-07): "We need
 * a roads page to browse the road projects".
 *
 * Data: `roads/` (npm run build:hgab-roads, npm run draw:hgab-roads; contract in src/lib/hgab-roads.ts; docs/hgab-roads.md).
 * Every figure in the copy is computed from it. The URL holds the budget, the filters and the sort.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Feature, FeatureCollection } from 'geojson';
import SiteFooter from '../components/SiteFooter';
import { Caveats, DisclaimerNotice, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import DpwhContractLink from '../components/DpwhContractLink';
import type { RoadsMapFocus } from '../components/RoadsMap';
import { loadRoadsBudget, loadRoadsSummary, REGION_LABELS, REGION_ORDER, type RegionKey } from '../lib/hgab';
import { dataUrl } from '../lib/data-url';
import { billions, count, fullPeso } from '../lib/hgab-history-view';
import { asOfText } from '../lib/hgab-leaderboard';
import { DPWH_LINK_NOTE, MATCH_NOTE } from '../lib/hgab-contractors';
import {
  FLAG_TEXT, LEVEL_TEXT, PART_SHORT, ROADS_CSV_NAME, ROADS_TITLE, budgetLabel, filterRoads, lengthText, roadSource,
  roadsCsvPath, sortRoads, stationText, type RoadFilters, type RoadLine, type RoadPart, type RoadSort, type RoadsBudget,
  type RoadsDrawSummary, type RoadsSummary,
} from '../lib/hgab-roads';
import '../nep2027.css';
import '../hgab-mpb-years.css';
import '../hgab-roads.css';

const RoadsMap = lazy(() => import('../components/RoadsMap'));

/** Scroll a section to just below the sticky masthead (it is about 270 px tall on a wide screen). */
function scrollToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const masthead = document.querySelector('header.masthead');
  const sticky = masthead && ['sticky', 'fixed'].includes(getComputedStyle(masthead).position) ? masthead.getBoundingClientRect().height : 0;
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - sticky - 12, behavior: 'smooth' });
}
type Geom = Awaited<ReturnType<typeof loadRoadsBudget>>['geom'];

const PAGE = 100;
const DEFAULT_BUDGET = 'house-2027';
const PARTS: RoadPart[] = ['national', 'drainage', 'bridges', 'access', 'road_fund', 'bip', 'sipag', 'local', 'ppp', 'former'];

interface View { budget: string; f: RoadFilters; sort: RoadSort }

function readView(p: URLSearchParams, keys: readonly string[]): View {
  const part = p.get('part') as RoadPart | null;
  const region = p.get('region') as RegionKey | null;
  const sort = p.get('sort');
  const budget = p.get('budget') ?? DEFAULT_BUDGET;
  return {
    budget: keys.includes(budget) ? budget : DEFAULT_BUDGET,
    f: {
      q: p.get('q') ?? '',
      part: part && PARTS.includes(part) ? part : '',
      region: region && REGION_ORDER.includes(region) ? region : '',
      length: p.get('length') === '1',
      drawn: p.get('drawn') === '1',
    },
    sort: sort === 'length' || sort === 'title' ? sort : 'amount',
  };
}

function writeView(v: View): URLSearchParams {
  const p = new URLSearchParams();
  if (v.budget !== DEFAULT_BUDGET) p.set('budget', v.budget);
  if (v.f.q) p.set('q', v.f.q);
  if (v.f.part) p.set('part', v.f.part);
  if (v.f.region) p.set('region', v.f.region);
  if (v.f.length) p.set('length', '1');
  if (v.f.drawn) p.set('drawn', '1');
  if (v.sort !== 'amount') p.set('sort', v.sort);
  return p;
}

export default function HgabRoads() {
  const [state, setState] = useState<{ summary: RoadsSummary; draw: RoadsDrawSummary | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadRoadsSummary().then((s) => { if (live) setState(s); }).catch((e) => { if (live) setError(String(e?.message ?? e)); });
    return () => { live = false; };
  }, []);
  if (error) return <HgabError message={error} />;
  if (!state) return <HgabLoading what="the road and bridge lines" />;
  return <Roads summary={state.summary} draw={state.draw} />;
}

function Roads({ summary, draw }: { summary: RoadsSummary; draw: RoadsDrawSummary | null }) {
  const keys = useMemo(() => summary.budgets.map((b) => b.key), [summary]);
  const [params, setParams] = useSearchParams();
  // The view lives in state and is mirrored to the URL (rapid clicks outrun the router's own updates).
  const [view, setViewState] = useState<View>(() => readView(params, keys));
  const setView = useCallback((patch: Partial<Omit<View, 'f'>> & { f?: Partial<RoadFilters> }) => {
    setViewState((v) => {
      const next = { ...v, ...patch, f: { ...v.f, ...(patch.f ?? {}) } };
      setParams(writeView(next), { replace: true });
      return next;
    });
  }, [setParams]);

  const [loaded, setLoaded] = useState<{ key: string; lines: RoadLine[]; geom: Geom } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadRoadsBudget(view.budget)
      .then(({ data, geom }) => { if (live) { setLoaded({ key: view.budget, lines: data.lines, geom }); setLoadError(null); } })
      .catch((e) => { if (live) setLoadError(String(e?.message ?? e)); });
    return () => { live = false; };
  }, [view.budget]);

  const budget = summary.budgets.find((b) => b.key === view.budget)!;
  const ready = loaded?.key === view.budget ? loaded : null;
  const drawnIds = useMemo(() => (ready ? new Set(ready.geom.keys()) : null), [ready]);
  const lines = useMemo(() => (ready ? filterRoads(ready.lines, view.f, drawnIds) : []), [ready, view.f, drawnIds]);
  const sorted = useMemo(() => sortRoads(lines, view.sort), [lines, view.sort]);
  const [picked, setPicked] = useState<number | null>(null);
  const [focus, setFocus] = useState<RoadsMapFocus | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const pickedLine = ready && picked != null ? ready.lines[picked] ?? null : null;

  const marks = useMemo<FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: lines.filter((l) => l.at).map((l): Feature => ({
      type: 'Feature',
      properties: { i: l.i, kind: l.level === 'contract' || l.level === 'gps' ? 'site' : l.level === 'deo' || l.level === 'region' ? 'area' : 'place' },
      geometry: { type: 'Point', coordinates: l.at! },
    })),
  }), [lines]);
  const drawn = useMemo<FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: ready ? lines.flatMap((l) => {
      const g = ready.geom.get(l.id);
      return g ? g.coords.map((c): Feature => ({ type: 'Feature', properties: { i: l.i, conf: g.conf }, geometry: { type: 'LineString', coordinates: c } })) : [];
    }) : [],
  }), [ready, lines]);
  const pickedFc = useMemo<FeatureCollection>(() => {
    if (!pickedLine || !ready) return { type: 'FeatureCollection', features: [] };
    const g = ready.geom.get(pickedLine.id);
    return {
      type: 'FeatureCollection',
      features: [
        ...(pickedLine.at ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pickedLine.at } } as Feature] : []),
        ...(g ? g.coords.map((c): Feature => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } })) : []),
      ],
    };
  }, [pickedLine, ready]);

  const show = (l: RoadLine) => {
    setPicked(l.i);
    const g = ready?.geom.get(l.id);
    const pts = [...(g ? g.coords.flat() : []), ...(l.at ? [l.at] : [])];
    const box = pts.length > 1
      ? [[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]] as [[number, number], [number, number]]
      : undefined;
    if (l.at) setFocus({ lng: l.at[0], lat: l.at[1], zoom: l.level === 'contract' || l.level === 'gps' ? 14 : 11, seq: Date.now(), bounds: box });
    scrollToSection('roads-map');
  };

  const gaa = summary.budgets.filter((b) => b.stage === 'gaa');
  const first = gaa[0].fy;
  const drawRow = (key: string) => draw?.budgets.find((b) => b.key === key) ?? null;
  const totalPhp = lines.reduce((a, l) => a + l.amount, 0);
  const totalM = lines.reduce((a, l) => a + (l.lengthM ?? 0), 0);

  return (
    <>
      <HgabHeader crumb={ROADS_TITLE} />
      <HgabHero
        compact
        crumb={ROADS_TITLE}
        title={<>Roads and bridges in every budget, {first} to the 2027 House bill</>}
        dek={
          <>
            Every DPWH road and bridge line: national roads, bridges, access roads, and the district roads under BIP, SIPAG and
            the Local Program. Pick a budget to see its lines on the map and in the list.
          </>
        }
        note={
          <>
            A line is one project as a budget lists it. A blue dot is the point of the DPWH contract matched to the line, or GPS in
            its title; a ring is the place the title names, at its centre. Red lines follow the road on OpenStreetMap and are
            approximate. Amounts are allocations, not spending. {asOfText({ built_at: summary.built_at })}.
          </>
        }
      />
      <main className="nep-main hgab-mpbm-main hgab-roads-main">
        <nav className="hgab-roads-budgets" aria-label="Budgets">
          {summary.budgets.map((b) => (
            <button key={b.key} type="button" aria-pressed={b.key === view.budget} onClick={() => { setPicked(null); setView({ budget: b.key }); }}>
              <span>{b.stage === 'gaa' ? b.fy : b.stage === 'nep' ? '2027 NEP' : '2027 House'}</span>
              <small>{billions(b.php)}</small>
            </button>
          ))}
        </nav>

        <div className="hgab-mpbm-filters hgab-roads-filters" role="group" aria-label="Filter the lines">
          <label className="hgab-mpbm-search">
            <span className="visually-hidden">Search</span>
            <input type="search" placeholder="Search a road, place, office, contract or contractor" value={view.f.q}
              onChange={(e) => setView({ f: { q: e.target.value } })} />
          </label>
          <label>
            <span>Part</span>
            <select value={view.f.part} onChange={(e) => setView({ f: { part: e.target.value as RoadPart | '' } })}>
              <option value="">All parts</option>
              {budget.parts.map((p) => <option key={p.key} value={p.key}>{PART_SHORT[p.key]} ({count(p.lines)})</option>)}
            </select>
          </label>
          <label>
            <span>Region</span>
            <select value={view.f.region} onChange={(e) => setView({ f: { region: e.target.value as RegionKey | '' } })}>
              <option value="">All regions</option>
              {REGION_ORDER.map((r) => <option key={r} value={r}>{REGION_LABELS[r].short} · {REGION_LABELS[r].name}</option>)}
            </select>
          </label>
          <label className="hgab-roads-check">
            <input type="checkbox" checked={view.f.length} onChange={(e) => setView({ f: { length: e.target.checked } })} />
            With a length
          </label>
          <label className="hgab-roads-check">
            <input type="checkbox" checked={view.f.drawn} onChange={(e) => setView({ f: { drawn: e.target.checked } })} />
            Drawn on the map
          </label>
        </div>

        <BudgetStrip budget={budget} lines={lines.length} php={totalPhp} lengthM={totalM} drawn={drawn.features.length ? new Set(drawn.features.map((f) => f.properties!.i)).size : 0}
          filtered={lines.length !== (ready?.lines.length ?? 0)} />

        <section className="nep-section hgab-mpbm-section" id="roads-map" aria-label="Map">
          {loadError && <p role="alert">{loadError}</p>}
          {mapError && <p role="alert">The map could not load: {mapError}. The list below has every line.</p>}
          <div className="hgab-roads-map">
            <Suspense fallback={<div className="hgab-roads-mapbox" aria-busy="true" />}>
              <RoadsMap marks={marks} lines={drawn} picked={pickedFc} focus={focus}
                fitKey={`${view.budget}|${view.f.region}|${view.f.q}|${view.f.part}`}
                onPick={(i) => setPicked(i)} onError={setMapError} />
            </Suspense>
          </div>
          <MapKey />
          {pickedLine && <PickedCard l={pickedLine} geom={ready?.geom.get(pickedLine.id) ?? null} onClose={() => setPicked(null)} />}
        </section>

        <LinesList lines={sorted} view={view} setView={setView} onShow={show} key={`${view.budget}|${JSON.stringify(view.f)}|${view.sort}`} ready={!!ready} />

        <PartsTable budget={budget} />
        <BudgetsTable summary={summary} draw={drawRow} current={view.budget} onPick={(key) => { setPicked(null); setView({ budget: key }); }} />
        <AboutRoads summary={summary} draw={draw} />
        <DisclaimerNotice compact contractors />
      </main>
      <SiteFooter />
    </>
  );
}

function BudgetStrip({ budget, lines, php, lengthM, drawn, filtered }: {
  budget: RoadsBudget; lines: number; php: number; lengthM: number; drawn: number; filtered: boolean;
}) {
  return (
    <div className="hgab-roads-strip" aria-live="polite">
      <div><strong>{count(lines)}</strong><span>{filtered ? 'lines shown' : 'lines'} · {budgetLabel(budget)}</span></div>
      <div><strong>{fullPeso(php)}</strong><span>{filtered ? 'their amount' : 'the budget’s amount'}</span></div>
      <div><strong>{lengthText(lengthM)}</strong><span>of road with stations in the title</span></div>
      <div><strong>{count(drawn)}</strong><span>drawn along the road</span></div>
    </div>
  );
}

function MapKey() {
  return (
    <ul className="hgab-roads-key" aria-label="Map key">
      <li><i className="is-site" aria-hidden="true" /> DPWH contract’s point or GPS in the title</li>
      <li><i className="is-place" aria-hidden="true" /> Place the title names (its centre)</li>
      <li><i className="is-area" aria-hidden="true" /> DPWH office’s area or the region</li>
      <li><i className="is-line" aria-hidden="true" /> Drawn along the road the title names</li>
      <li><i className="is-dash" aria-hidden="true" /> Drawn along the national road at the point (less sure)</li>
    </ul>
  );
}

function SourceTitle({ l }: { l: RoadLine }) {
  const s = roadSource(l);
  if (!s) return <>{l.title}</>;
  return s.external
    ? <a href={s.href} target="_blank" rel="noopener noreferrer" title={`${s.label} (opens a new tab)`}>{l.title}</a>
    : <Link to={s.href} title={s.label}>{l.title}</Link>;
}

function LineMeta({ l }: { l: RoadLine }) {
  return (
    <>
      <span className="hgab-mpbm-sub">
        {PART_SHORT[l.part]}
        {l.stations && <> · {l.stations.slice(0, 3).map(stationText).join(', ')}{l.stations.length > 3 ? ` and ${l.stations.length - 3} more` : ''}</>}
        {l.sections && <> · DPWH section {l.sections.join(', ')}</>}
        {l.cls === 'house_only' && <> · House bill only</>}
        {l.cls === 'nep_only' && <> · NEP only</>}
      </span>
      {l.contract && (
        <span className="hgab-mpbm-sub">
          Contract <DpwhContractLink id={l.contract} />{l.contractor ? <> · {l.contractor}</> : null}
        </span>
      )}
      {l.flags.some((f) => FLAG_TEXT[f]) && (
        <span className="hgab-mpbm-sub hgab-roads-flag">{l.flags.map((f) => FLAG_TEXT[f]).filter(Boolean).join(' ')}</span>
      )}
    </>
  );
}

function PickedCard({ l, geom, onClose }: { l: RoadLine; geom: { how: string; conf: string } | null; onClose: () => void }) {
  return (
    <article className="hgab-roads-picked" aria-label="The line picked on the map">
      <button type="button" className="hgab-mpbm-linkbtn hgab-roads-close" onClick={onClose}>Close</button>
      <p className="hgab-mpbm-title"><SourceTitle l={l} /></p>
      <p className="hgab-mpbm-meta">
        <strong>{fullPeso(l.amount)}</strong> · {l.office ?? 'No office listed'}
        {l.lengthM != null && <> · {lengthText(l.lengthM)}</>}
      </p>
      <p className="hgab-mpbm-meta">
        Placed by: {LEVEL_TEXT[l.level]}{l.place && l.level !== 'contract' && l.level !== 'gps' ? ` (${l.place.label})` : ''}
        {l.district && <> · {l.district.label}</>}
        {geom && <> · Drawn {geom.how === 'stations' ? 'at its stations, from kilometre posts on the map' : 'at its length, centred on the point'}{geom.conf === 'class' ? ', on the national road at the point' : ''}</>}
      </p>
      <p className="hgab-mpbm-meta"><LineMeta l={l} /></p>
    </article>
  );
}

function LinesList({ lines, view, setView, onShow, ready }: {
  lines: RoadLine[];
  view: View;
  setView: (v: Partial<Omit<View, 'f'>>) => void;
  onShow: (l: RoadLine) => void;
  ready: boolean;
}) {
  const [shown, setShown] = useState(PAGE);
  return (
    <section className="nep-section hgab-mpbm-section" id="roads-list" aria-labelledby="roads-list-h">
      <div className="hgab-mpbm-listhead">
        <div>
          <h2 id="roads-list-h" className="hgab-mpbm-h2">{ready ? `${count(lines.length)} lines` : 'Loading the lines…'}</h2>
          <p className="hgab-mpbm-dek">Each title opens where the budget prints it. {DPWH_LINK_NOTE}</p>
        </div>
        <label className="hgab-roads-sort">
          <span>Sort</span>
          <select value={view.sort} onChange={(e) => setView({ sort: e.target.value as RoadSort })}>
            <option value="amount">Largest amount</option>
            <option value="length">Longest</option>
            <option value="title">Title</option>
          </select>
        </label>
      </div>
      <div className="hgab-mpbm-tablewrap">
        <table className="hgab-mpbm-table">
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col">Where</th>
              <th scope="col">DPWH office</th>
              <th scope="col" className="is-num">Length</th>
              <th scope="col" className="is-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.slice(0, shown).map((l) => (
              <tr key={l.i}>
                <td>
                  <span className="hgab-mpbm-title"><SourceTitle l={l} /></span>
                  <LineMeta l={l} />
                </td>
                <td>
                  <span className={`hgab-roads-lvl is-${l.level}`}>{LEVEL_TEXT[l.level]}</span>
                  {l.place && l.level !== 'contract' && l.level !== 'gps' && <span className="hgab-mpbm-sub">{l.place.label}</span>}
                  {l.district && <span className="hgab-mpbm-sub">{l.district.label}</span>}
                  {l.at && <button type="button" className="hgab-mpbm-linkbtn" onClick={() => onShow(l)}>On the map</button>}
                </td>
                <td>{l.office ?? '—'}</td>
                <td className="is-num">{lengthText(l.lengthM)}</td>
                <td className="is-num">{fullPeso(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lines.length > shown && (
        <p className="hgab-mpbm-more">
          Showing {count(shown)} of {count(lines.length)}.{' '}
          <button type="button" className="hgab-mpbm-linkbtn" onClick={() => setShown(shown + PAGE * 5)}>
            Show {count(Math.min(PAGE * 5, lines.length - shown))} more
          </button>
        </p>
      )}
      <p className="hgab-mpbm-more">{MATCH_NOTE}</p>
    </section>
  );
}

function PartsTable({ budget }: { budget: RoadsBudget }) {
  return (
    <section className="nep-section hgab-mpbm-section" aria-labelledby="roads-parts-h">
      <h2 id="roads-parts-h" className="hgab-mpbm-h2">The {budgetLabel(budget)} by part</h2>
      <div className="hgab-mpbm-tablewrap">
        <table className="hgab-mpbm-table">
          <thead><tr><th scope="col">Part</th><th scope="col" className="is-num">Lines</th><th scope="col" className="is-num">Amount</th></tr></thead>
          <tbody>
            {budget.parts.map((p) => (
              <tr key={p.key}><td>{p.label}</td><td className="is-num">{count(p.lines)}</td><td className="is-num">{fullPeso(p.php)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><th scope="row">All road and bridge lines</th><td className="is-num">{count(budget.lines)}</td><td className="is-num">{fullPeso(budget.php)}</td></tr></tfoot>
        </table>
      </div>
    </section>
  );
}

function BudgetsTable({ summary, draw, current, onPick }: {
  summary: RoadsSummary;
  draw: (key: string) => { drawn?: number } | null;
  current: string;
  onPick: (key: string) => void;
}) {
  return (
    <section className="nep-section hgab-mpbm-section" aria-labelledby="roads-budgets-h">
      <h2 id="roads-budgets-h" className="hgab-mpbm-h2">Every budget</h2>
      <div className="hgab-mpbm-tablewrap">
        <table className="hgab-mpbm-table">
          <thead>
            <tr>
              <th scope="col">Budget</th>
              <th scope="col" className="is-num">Lines</th>
              <th scope="col" className="is-num">Amount</th>
              <th scope="col" className="is-num">At the contract’s point</th>
              <th scope="col" className="is-num">With a length</th>
              <th scope="col" className="is-num">Drawn</th>
            </tr>
          </thead>
          <tbody>
            {summary.budgets.map((b) => (
              <tr key={b.key} className={b.key === current ? 'is-current' : undefined}>
                <td><button type="button" className="hgab-mpbm-linkbtn" onClick={() => onPick(b.key)}>{budgetLabel(b)}</button>{b.note && <span className="hgab-mpbm-sub">Older code set</span>}</td>
                <td className="is-num">{count(b.lines)}</td>
                <td className="is-num">{billions(b.php)}</td>
                <td className="is-num">{count(b.levels.contract)}</td>
                <td className="is-num">{count(b.stations.lines)} · {lengthText(b.stations.length_m)}</td>
                <td className="is-num">{count(draw(b.key)?.drawn ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AboutRoads({ summary, draw }: { summary: RoadsSummary; draw: RoadsDrawSummary | null }) {
  return (
    <section className="nep-section hgab-mpbm-section" id="about" aria-labelledby="roads-about-h">
      <h2 id="roads-about-h" className="hgab-mpbm-h2">About this data</h2>
      <Caveats items={[
        'Which lines: DPWH capital outlays under each budget’s road and bridge codes, in the parts above. 2015 to 2017 use an older set of codes, read as one program. 2027 counts the Asset Preservation, Network Development and Bridge programs, and BIP access and coastal roads.',
        'Where a line sits, first that works: the point of the DPWH contract we matched to it (2020 to 2026), GPS in its title, the place its title names, its DPWH office’s area, its region.',
        'Contracts are matched by title, office and amount, so check the contract. Their points come from DPWH’s own list.',
        'Length comes from the stations a title prints, such as K0029+690 to K0031+087. A title without stations has no length.',
        'Red lines follow the road on OpenStreetMap from the contract’s point. Where along the road is approximate, except where kilometre posts on the map agree with the point.',
        'Every check the build runs passed: the BIP, SIPAG and Local Program parts equal the multi-purpose page’s chart, and 2020 to 2026 each part equals DPWH’s budget extract to the peso.',
      ]} />
      <p className="hgab-mpbm-more">
        <a href={dataUrl(roadsCsvPath(summary))} download={ROADS_CSV_NAME}>Download every line, every budget (CSV)</a>.{' '}
        {draw && <>Roads drawn along © OpenStreetMap contributors, under the Open Database License (extract of {draw.osm.downloaded.slice(0, 10)}).</>}
      </p>
    </section>
  );
}
