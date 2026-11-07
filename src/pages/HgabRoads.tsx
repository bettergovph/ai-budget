/**
 * `/hgab/2027/roads` (DPWH menu): every road and bridge line in every budget we hold, the FY2015 to FY2026 enacted
 * budgets and the 2027 NEP and House bill, on a map and in a list. Jason (2026-11-07): "We need a roads page to browse
 * the road projects", then "We need to support multi year".
 *
 * Any set of years, as the multi-purpose map picks them (its year bars): 2027 at one stage, the NEP or the House bill,
 * never both added. Each year's file loads when it is picked.
 *
 * Data: `roads/` (npm run build:hgab-roads, npm run draw:hgab-roads; contract in src/lib/hgab-roads.ts; docs/hgab-roads.md).
 * Every figure in the copy is computed from it. The URL holds the years, the 2027 stage, the filters and the sort.
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
import { billions, bn, count, fullPeso } from '../lib/hgab-history-view';
import { asOfText } from '../lib/hgab-leaderboard';
import { DPWH_LINK_NOTE, MATCH_NOTE } from '../lib/hgab-contractors';
import {
  FLAG_TEXT, LEVEL_TEXT, PART_SHORT, ROADS_CSV_NAME, ROADS_TITLE, ROADS_YEARS, budgetLabel, filterRoads, lengthText,
  roadSource, roadsBudgetKey, roadsCsvPath, sortRoads, stationText, type RoadFilters, type RoadLine, type RoadPart,
  type RoadSort, type RoadsBudget, type RoadsDrawSummary, type RoadsSummary, type Stage2027,
} from '../lib/hgab-roads';
import '../nep2027.css';
import '../hgab-history.css';
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
type Loaded = { lines: RoadLine[]; geom: Geom };

const PAGE = 100;
const DRAWN_HOW = {
  anchored: 'at its stations, placed by DPWH contracts on the same road used as kilometre posts',
  stations: 'at its stations, from kilometre posts on OpenStreetMap',
  centred: 'at its length, centred on its point (where along the road is approximate)',
} as const;
const GAA_YEARS = ROADS_YEARS.filter((y) => y < 2027);
const PARTS: RoadPart[] = ['national', 'drainage', 'bridges', 'access', 'road_fund', 'bip', 'sipag', 'local', 'ppp', 'former'];
const yearLabel = (fy: number, stage: Stage2027) => (fy < 2027 ? String(fy) : stage === 'house' ? '2027 House bill' : '2027 NEP');

interface View { years: Set<number>; stage: Stage2027; f: RoadFilters; sort: RoadSort }
type ViewPatch = Partial<Omit<View, 'f'>> & { f?: Partial<RoadFilters> };

function readView(p: URLSearchParams): View {
  const part = p.get('part') as RoadPart | null;
  const region = p.get('region') as RegionKey | null;
  const sort = p.get('sort');
  const ys = (p.get('years') ?? '').split(',').map(Number).filter((y) => ROADS_YEARS.includes(y));
  return {
    years: new Set(ys.length ? ys : ROADS_YEARS),
    stage: p.get('stage') === 'nep' ? 'nep' : 'house',
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
  if (v.years.size !== ROADS_YEARS.length) p.set('years', [...v.years].sort().join(','));
  if (v.stage === 'nep') p.set('stage', 'nep');
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
  const [params, setParams] = useSearchParams();
  // The view lives in state and is mirrored to the URL (rapid clicks outrun the router's own updates).
  const [view, setViewState] = useState<View>(() => readView(params));
  const setView = useCallback((patch: ViewPatch) => {
    setViewState((v) => ({ ...v, ...patch, f: { ...v.f, ...(patch.f ?? {}) } }));
  }, []);
  useEffect(() => {
    setParams(writeView(view), { replace: true });
  }, [view, setParams]);

  const keys = useMemo(() => [...view.years].sort().map((y) => roadsBudgetKey(y, view.stage)), [view.years, view.stage]);
  const budgets = useMemo(() => keys.map((k) => summary.budgets.find((b) => b.key === k)!), [keys, summary]);
  // Each picked year's file, loaded once and kept.
  const [loaded, setLoaded] = useState<ReadonlyMap<string, Loaded>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    for (const k of keys) {
      if (loaded.has(k)) continue;
      loadRoadsBudget(k)
        .then(({ data, geom }) => { if (live) setLoaded((m) => new Map(m).set(k, { lines: data.lines, geom })); })
        .catch((e) => { if (live) setLoadError(String(e?.message ?? e)); });
    }
    return () => { live = false; };
  }, [keys, loaded]);
  const pending = keys.filter((k) => !loaded.has(k)).length;
  const all = useMemo(() => keys.flatMap((k) => loaded.get(k)?.lines ?? []), [keys, loaded]);
  const geomOf = useCallback((l: RoadLine) => loaded.get(l.budget)?.geom.get(l.id) ?? null, [loaded]);
  const drawnUids = useMemo(() => new Set(all.filter((l) => geomOf(l)).map((l) => l.uid)), [all, geomOf]);
  const lines = useMemo(() => filterRoads(all, view.f, drawnUids), [all, view.f, drawnUids]);
  const sorted = useMemo(() => sortRoads(lines, view.sort), [lines, view.sort]);
  const byUid = useMemo(() => new Map(all.map((l) => [l.uid, l])), [all]);
  const [picked, setPicked] = useState<string | null>(null);
  const [focus, setFocus] = useState<RoadsMapFocus | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const pickedLine = picked ? byUid.get(picked) ?? null : null;

  const marks = useMemo<FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: lines.filter((l) => l.at).map((l): Feature => ({
      type: 'Feature',
      properties: { uid: l.uid, kind: l.level === 'contract' || l.level === 'gps' || l.level === 'stations' ? 'site' : l.level === 'deo' || l.level === 'region' ? 'area' : 'place' },
      geometry: { type: 'Point', coordinates: l.at! },
    })),
  }), [lines]);
  const drawn = useMemo<FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: lines.flatMap((l) => {
      const g = geomOf(l);
      return g ? g.coords.map((c): Feature => ({ type: 'Feature', properties: { uid: l.uid, conf: g.conf }, geometry: { type: 'LineString', coordinates: c } })) : [];
    }),
  }), [lines, geomOf]);
  const pickedFc = useMemo<FeatureCollection>(() => {
    if (!pickedLine) return { type: 'FeatureCollection', features: [] };
    const g = geomOf(pickedLine);
    return {
      type: 'FeatureCollection',
      features: [
        ...(pickedLine.at ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pickedLine.at } } as Feature] : []),
        ...(g ? g.coords.map((c): Feature => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } })) : []),
      ],
    };
  }, [pickedLine, geomOf]);

  const show = (l: RoadLine) => {
    setPicked(l.uid);
    const g = geomOf(l);
    const pts = [...(g ? g.coords.flat() : []), ...(l.at ? [l.at] : [])];
    const box = pts.length > 1
      ? [[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]] as [[number, number], [number, number]]
      : undefined;
    if (l.at) setFocus({ lng: l.at[0], lat: l.at[1], zoom: l.level === 'contract' || l.level === 'gps' ? 14 : 11, seq: Date.now(), bounds: box });
    scrollToSection('roads-map');
  };

  const first = GAA_YEARS[0];
  const drawRow = (key: string) => draw?.budgets.find((b) => b.key === key) ?? null;
  const totalPhp = lines.reduce((a, l) => a + l.amount, 0);
  const totalM = lines.reduce((a, l) => a + (l.lengthM ?? 0), 0);
  const filtered = lines.length !== all.length;
  const partsHere = PARTS.filter((p) => budgets.some((b) => b.parts.some((x) => x.key === p)));
  const partLines = (p: RoadPart) => budgets.reduce((a, b) => a + (b.parts.find((x) => x.key === p)?.lines ?? 0), 0);

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
            the Local Program. Pick the years to see their lines on the map and in the list.
          </>
        }
        note={
          <>
            A line is one project as a budget lists it, so a road funded over several years has a line in each. A blue dot is the
            point of the DPWH contract matched to the line, or GPS in its title; a ring is the place the title names, at its
            centre. Red lines follow the road on OpenStreetMap, placed at their stations by DPWH’s own contracts on the same
            road. Amounts are allocations, not spending.{' '}
            {asOfText({ built_at: summary.built_at })}.
          </>
        }
      />
      <main className="nep-main hgab-mpbm-main hgab-roads-main">
        <div className="hgab-mpbm-controls" role="group" aria-label="Choose what the map and the list show">
          <YearBars summary={summary} view={view} setView={(v) => { setPicked(null); setView(v); }} />
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
                {partsHere.map((p) => <option key={p} value={p}>{PART_SHORT[p]} ({count(partLines(p))})</option>)}
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
        </div>

        <BudgetStrip budgets={budgets} lines={lines.length} php={totalPhp} lengthM={totalM}
          drawn={new Set(drawn.features.map((f) => f.properties!.uid)).size} filtered={filtered} pending={pending} />

        <section className="nep-section hgab-mpbm-section" id="roads-map" aria-label="Map">
          {loadError && <p role="alert">{loadError}</p>}
          {mapError && <p role="alert">The map could not load: {mapError}. The list below has every line.</p>}
          <div className="hgab-roads-map">
            <Suspense fallback={<div className="hgab-roads-mapbox" aria-busy="true" />}>
              <RoadsMap marks={marks} lines={drawn} picked={pickedFc} focus={focus}
                fitKey={`${keys.join(',')}|${pending ? 'loading' : 'ready'}|${view.f.region}|${view.f.q}|${view.f.part}`}
                onPick={setPicked} onError={setMapError} />
            </Suspense>
          </div>
          <MapKey />
          {pickedLine && <PickedCard l={pickedLine} geom={geomOf(pickedLine)} stage={view.stage} onClose={() => setPicked(null)} />}
        </section>

        <LinesList lines={sorted} view={view} setView={setView} onShow={show} key={`${keys.join(',')}|${JSON.stringify(view.f)}|${view.sort}`} ready={!pending} />

        <PartsTable budgets={budgets} />
        <BudgetsTable summary={summary} draw={drawRow} current={new Set(keys)} onPick={(key) => {
          const b = summary.budgets.find((x) => x.key === key)!;
          setPicked(null);
          setView({ years: new Set([b.fy]), ...(b.fy === 2027 ? { stage: b.stage as Stage2027 } : {}) });
        }} />
        <AboutRoads summary={summary} draw={draw} />
        <DisclaimerNotice compact contractors />
      </main>
      <SiteFooter />
    </>
  );
}

function YearBars({ summary, view, setView }: { summary: RoadsSummary; view: View; setView: (v: ViewPatch) => void }) {
  const stat = (fy: number) => summary.budgets.find((x) => x.key === roadsBudgetKey(fy, view.stage))!;
  const max = Math.max(...summary.budgets.map((x) => x.php));
  const toggle = (fy: number) => {
    const next = new Set(view.years);
    if (next.has(fy)) next.delete(fy); else next.add(fy);
    if (next.size) setView({ years: next });
  };
  const only = (ys: readonly number[]) => setView({ years: new Set(ys) });
  return (
    <div className="hgab-mpbm-years">
      <div className="hgab-mpbm-years-head">
        <p className="hgab-mpbm-label">Years <span>(click a bar to add or remove it)</span></p>
        <div className="hgab-ds-dims hgab-mpbm-quick" role="group" aria-label="Quick picks">
          <button type="button" aria-pressed={view.years.size === ROADS_YEARS.length} onClick={() => only(ROADS_YEARS)}>All</button>
          <button type="button" aria-pressed={view.years.size === GAA_YEARS.length && !view.years.has(2027)} onClick={() => only(GAA_YEARS)}>Enacted, {GAA_YEARS[0]}–{GAA_YEARS[GAA_YEARS.length - 1]}</button>
          <button type="button" aria-pressed={view.years.size === 1 && view.years.has(2027)} onClick={() => only([2027])}>2027 only</button>
        </div>
        <div className="hgab-ds-dims hgab-mpbm-stage" role="group" aria-label="2027 stage">
          <span>2027:</span>
          <button type="button" aria-pressed={view.stage === 'house'} onClick={() => setView({ stage: 'house' })}>House bill</button>
          <button type="button" aria-pressed={view.stage === 'nep'} onClick={() => setView({ stage: 'nep' })}>NEP</button>
        </div>
      </div>
      <ol className="hgab-mpbm-bars">
        {ROADS_YEARS.map((fy) => {
          const s = stat(fy);
          const on = view.years.has(fy);
          const h = Math.max(2, Math.round((s.php / max) * 64));
          const stageCls = fy < 2027 ? 'is-gaa' : view.stage === 'house' ? 'is-house' : 'is-nep';
          return (
            <li key={fy}>
              <button type="button" className={`${stageCls} ${on ? 'is-on' : 'is-off'}`} aria-pressed={on}
                title={`${yearLabel(fy, view.stage)}: ${count(s.lines)} lines, ${fullPeso(s.php)}`} onClick={() => toggle(fy)}>
                <span className="hgab-mpbm-bar" style={{ height: h }} aria-hidden="true" />
                <strong>{fy < 2027 ? fy : view.stage === 'house' ? '2027 House' : '2027 NEP'}</strong>
                <span>{bn(s.php)}</span>
                <span>{count(s.lines)} lines</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function BudgetStrip({ budgets, lines, php, lengthM, drawn, filtered, pending }: {
  budgets: RoadsBudget[]; lines: number; php: number; lengthM: number; drawn: number; filtered: boolean; pending: number;
}) {
  const which = budgets.length === 1 ? budgetLabel(budgets[0]) : `${budgets.length} budgets`;
  return (
    <div className="hgab-roads-strip" aria-live="polite">
      <div><strong>{count(lines)}</strong><span>{filtered ? 'lines shown' : 'lines'} · {which}{pending ? ` (loading ${pending})` : ''}</span></div>
      <div><strong>{fullPeso(php)}</strong><span>{filtered ? 'their amount' : budgets.length === 1 ? 'the budget’s amount' : 'their amount, added over the years'}</span></div>
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
      <li><i className="is-dash" aria-hidden="true" /> Drawn along the national road there (less sure of the road)</li>
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

function PickedCard({ l, geom, stage, onClose }: { l: RoadLine; geom: { how: string; conf: string } | null; stage: Stage2027; onClose: () => void }) {
  return (
    <article className="hgab-roads-picked" aria-label="The line picked on the map">
      <button type="button" className="hgab-mpbm-linkbtn hgab-roads-close" onClick={onClose}>Close</button>
      <p className="hgab-mpbm-title"><SourceTitle l={l} /></p>
      <p className="hgab-mpbm-meta">
        <strong>{fullPeso(l.amount)}</strong> · {yearLabel(l.fy, stage)} · {l.office ?? 'No office listed'}
        {l.lengthM != null && <> · {lengthText(l.lengthM)}</>}
      </p>
      <p className="hgab-mpbm-meta">
        Placed by: {LEVEL_TEXT[l.level]}{l.place && l.level !== 'contract' && l.level !== 'gps' ? ` (${l.place.label})` : ''}
        {l.district && <> · {l.district.label}</>}
        {geom && <> · Drawn {DRAWN_HOW[geom.how as keyof typeof DRAWN_HOW]}{geom.conf === 'class' ? ', on the national road there' : ''}</>}
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
              <th scope="col">Budget</th>
              <th scope="col">Project</th>
              <th scope="col">Where</th>
              <th scope="col">DPWH office</th>
              <th scope="col" className="is-num">Length</th>
              <th scope="col" className="is-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.slice(0, shown).map((l) => (
              <tr key={l.uid}>
                <td className="hgab-mpbm-yr">{yearLabel(l.fy, view.stage)}{l.cls === 'house_only' && view.stage === 'house' && <span className="hgab-mpbm-tag">House bill only</span>}</td>
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

function PartsTable({ budgets }: { budgets: RoadsBudget[] }) {
  const parts = PARTS.map((key) => {
    const rows = budgets.map((b) => b.parts.find((p) => p.key === key)).filter(Boolean) as RoadsBudget['parts'];
    return { key, label: rows[0]?.label ?? PART_SHORT[key], lines: rows.reduce((a, p) => a + p.lines, 0), php: rows.reduce((a, p) => a + p.php, 0) };
  }).filter((p) => p.lines);
  const lines = budgets.reduce((a, b) => a + b.lines, 0);
  const php = budgets.reduce((a, b) => a + b.php, 0);
  return (
    <section className="nep-section hgab-mpbm-section" aria-labelledby="roads-parts-h">
      <h2 id="roads-parts-h" className="hgab-mpbm-h2">{budgets.length === 1 ? `The ${budgetLabel(budgets[0])} by part` : `The ${budgets.length} budgets picked, by part`}</h2>
      <div className="hgab-mpbm-tablewrap">
        <table className="hgab-mpbm-table">
          <thead><tr><th scope="col">Part</th><th scope="col" className="is-num">Lines</th><th scope="col" className="is-num">Amount</th></tr></thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.key}><td>{p.label}</td><td className="is-num">{count(p.lines)}</td><td className="is-num">{fullPeso(p.php)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><th scope="row">All road and bridge lines</th><td className="is-num">{count(lines)}</td><td className="is-num">{fullPeso(php)}</td></tr></tfoot>
        </table>
      </div>
      {budgets.length > 1 && <p className="hgab-mpbm-more">Amounts add up over the years picked; a road funded in several years counts in each.</p>}
    </section>
  );
}

function BudgetsTable({ summary, draw, current, onPick }: {
  summary: RoadsSummary;
  draw: (key: string) => { drawn?: number } | null;
  current: ReadonlySet<string>;
  onPick: (key: string) => void;
}) {
  return (
    <section className="nep-section hgab-mpbm-section" aria-labelledby="roads-budgets-h">
      <h2 id="roads-budgets-h" className="hgab-mpbm-h2">Every budget</h2>
      <p className="hgab-mpbm-dek">The budgets picked above are shaded. Click a budget to see it alone.</p>
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
              <tr key={b.key} className={current.has(b.key) ? 'is-current' : undefined}>
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
        'Where a line sits, first that works: the point of the DPWH contract we matched to it (2020 to 2026); its stations, placed by DPWH contracts on the same road; GPS in its title; the place its title names; its DPWH office’s area; its region.',
        'Contracts are matched by title, office and amount, so check the contract. Their points come from DPWH’s own list.',
        'Length comes from the stations a title prints, such as K0029+690 to K0031+087. A title without stations has no length.',
        'Red lines follow the road on OpenStreetMap. Most are placed at their own stations: DPWH contracts on the same road, each printing its stations and carrying a point, serve as kilometre posts. The rest are their length centred on the line’s own point, so where along the road is approximate.',
        'Every check the build runs passed: the BIP, SIPAG and Local Program parts equal the multi-purpose page’s chart, and 2020 to 2026 each part equals DPWH’s budget extract to the peso.',
      ]} />
      <p className="hgab-mpbm-more">
        <a href={dataUrl(roadsCsvPath(summary))} download={ROADS_CSV_NAME}>Download every line, every budget (CSV)</a>.{' '}
        {draw && <>Roads drawn along © OpenStreetMap contributors, under the Open Database License (extract of {draw.osm.downloaded.slice(0, 10)}).</>}
      </p>
    </section>
  );
}
