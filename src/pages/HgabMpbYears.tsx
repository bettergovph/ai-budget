/**
 * `/hgab/2027/multi-purpose/map` (DPWH menu): every multi-purpose building line in every budget we hold, the
 * FY2020 to FY2026 enacted budgets and the FY2027 NEP and House bill, on one map and in one list.
 *
 * Data: `mpb-years/` (npm run build:hgab-mpb-years; contract in src/lib/hgab-mpb-years.ts). Every figure in the
 * copy is computed from it. FY2027 is shown at one stage at a time; the NEP and the House bill are never added.
 *
 * One row of controls scopes everything under it: the years (the bars), the FY2027 stage, the search box, the
 * region, how a line was placed and which budget line it is on. A district or place picked on the map narrows the
 * list only; the map keeps showing the rest around it.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { Caveats, DisclaimerNotice, HgabDetails, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import type { MapFit, MapFocus, MapPick } from '../components/MpbMap';
import { SHADE_COLORS, MARK_COLORS } from '../components/mpb-map-style';
import { loadMpbYears, REGION_LABELS, REGION_ORDER, type RegionKey } from '../lib/hgab';
import { dataUrl } from '../lib/data-url';
import { HISTORY_ROOT, HISTORY_TITLE } from '../lib/hgab-history';
import { billions, bn, count, fullPeso } from '../lib/hgab-history-view';
import { DEO_MEANING, asOfText } from '../lib/hgab-leaderboard';
import {
  CLASS_LABELS, FLAG_TEXT, LEVEL_LABELS, LEVEL_SHORT, MPB_CSV_NAME, MPB_CSV_PATH, MPB_MAP_TITLE, MPB_YEARS, NO_FILTERS, PAP_RULE_FROM,
  PLACED_LABELS, REPEAT_LABELS, budgetKey, districtTotals, filterLines, lineAmount, lineFlags, linesCsv, mapMarks,
  onlyRepeats, repeatGroups,
  officeShort, recordHref, shadeBreaks, shadeClass, sortLines,
  type MpbData, type MpbFilters, type MpbGroup, type MpbLevel, type MpbLine, type MpbSelection, type MpbSort, type MpbSummary,
  type RepeatMode, type Stage2027,
} from '../lib/hgab-mpb-years';
import type { FeatureCollection } from 'geojson';
import '../nep2027.css';
import '../hgab-history.css';
import '../hgab-mpb-years.css';

const MpbMap = lazy(() => import('../components/MpbMap'));

const PAGE = 100;
const GAA_YEARS = MPB_YEARS.filter((y) => y < 2027);
const FIRST = GAA_YEARS[0];
const LAST_GAA = GAA_YEARS[GAA_YEARS.length - 1];
const yearLabel = (fy: number, stage: Stage2027) => (fy < 2027 ? String(fy) : stage === 'house' ? '2027 House bill' : '2027 NEP');

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

interface View {
  years: Set<number>;
  stage: Stage2027;
  f: MpbFilters;
  sort: MpbSort;
}
type ViewPatch = Omit<Partial<View>, 'f'> & { f?: Partial<MpbFilters> };

function readView(p: URLSearchParams, data: MpbData | null): View {
  const ys = (p.get('years') ?? '').split(',').map(Number).filter((y) => (MPB_YEARS as readonly number[]).includes(y));
  const district = data && p.get('district') ? data.districtIndex.get(p.get('district')!) ?? -1 : -1;
  const placeKey = p.get('place');
  const place = data && placeKey ? data.places.findIndex((x) => x.key === placeKey) : -1;
  const region = p.get('region') as RegionKey | null;
  const placed = p.get('placed') as MpbFilters['placed'] | null;
  const rule = p.get('rule') as MpbFilters['rule'] | null;
  const repeat = p.get('repeat');
  const sort = p.get('sort') as MpbSort | null;
  return {
    years: new Set(ys.length ? ys : MPB_YEARS),
    stage: p.get('stage') === 'nep' ? 'nep' : 'house',
    f: {
      q: p.get('q') ?? '',
      region: region && REGION_ORDER.includes(region) ? region : '',
      placed: placed && ['exact', 'place', 'office', 'none'].includes(placed) ? placed : '',
      rule: rule === 'pap' || rule === 'title' ? rule : '',
      district,
      place,
      repeat: repeat === 'title' || repeat === 'barangay' ? repeat : '',
    },
    sort: sort === 'amount' || sort === 'title' ? sort : 'year',
  };
}

function writeView(v: View, data: MpbData): URLSearchParams {
  const p = new URLSearchParams();
  if (v.years.size !== MPB_YEARS.length) p.set('years', [...v.years].sort().join(','));
  if (v.stage === 'nep') p.set('stage', 'nep');
  if (v.f.q) p.set('q', v.f.q);
  if (v.f.region) p.set('region', v.f.region);
  if (v.f.placed) p.set('placed', v.f.placed);
  if (v.f.rule) p.set('rule', v.f.rule);
  if (v.f.repeat) p.set('repeat', v.f.repeat);
  if (v.f.district >= 0) p.set('district', data.districts[v.f.district].id);
  if (v.f.place >= 0) p.set('place', data.places[v.f.place].key);
  if (v.sort !== 'year') p.set('sort', v.sort);
  return p;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HgabMpbYears() {
  const [loaded, setLoaded] = useState<{ data: MpbData; summary: MpbSummary; districts: FeatureCollection } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadMpbYears().then((x) => live && setLoaded(x), (e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, []);
  if (error) return <HgabError message={error} />;
  if (!loaded) return <HgabLoading what="every multi-purpose building line" />;
  return <Loaded {...loaded} />;
}

function Loaded({ data, summary, districts }: { data: MpbData; summary: MpbSummary; districts: FeatureCollection }) {
  // The view lives in state (so quick clicks build on each other) and is mirrored into the URL for sharing.
  const [params, setParams] = useSearchParams();
  const [view, setViewState] = useState<View>(() => readView(params, data));
  const setView = useCallback((next: ViewPatch) => {
    setViewState((cur) => ({ ...cur, ...next, f: { ...cur.f, ...(next.f ?? {}) } }));
  }, []);
  useEffect(() => {
    const next = writeView(view, data);
    if (next.toString() !== new URLSearchParams(window.location.search).toString()) setParams(next, { replace: true });
  }, [view, data, setParams]);

  // The search box commits after a pause. What is typed belongs to the committed search it started from, so
  // "Clear filters" empties the box instead of the box putting its old text back.
  const [typed, setTyped] = useState({ base: view.f.q, text: view.f.q });
  const qInput = typed.base === view.f.q ? typed.text : view.f.q;
  useEffect(() => {
    const t = setTimeout(() => {
      if (qInput === view.f.q) return;
      setView({ f: { q: qInput } });
      setTyped({ base: qInput, text: qInput });
    }, 300);
    return () => clearTimeout(t);
  }, [qInput, view.f.q, setView]);

  const sel: MpbSelection = useMemo(() => ({ years: view.years, stage: view.stage }), [view.years, view.stage]);
  // The map shows everything the control row selects; a picked district or place narrows the list only.
  // What the control row selects; the repeats filter then keeps only lines in a group, among those.
  const baseLines = useMemo(() => filterLines(data, sel, { ...view.f, district: -1, place: -1 }), [data, sel, view.f]);
  const mapLines = useMemo(
    () => (view.f.repeat ? onlyRepeats(data, baseLines, view.stage, view.f.repeat) : baseLines),
    [data, baseLines, view.stage, view.f.repeat],
  );
  const listLines = useMemo(
    () => mapLines.filter((l) => (view.f.district < 0 || l.district === view.f.district) && (view.f.place < 0 || l.place === view.f.place)),
    [mapLines, view.f.district, view.f.place],
  );
  const marks = useMemo(() => mapMarks(data, mapLines, view.stage), [data, mapLines, view.stage]);
  const totals = useMemo(() => districtTotals(data, mapLines, view.stage), [data, mapLines, view.stage]);
  const breaks = useMemo(() => shadeBreaks(totals), [totals]);
  const shade = useMemo(() => new Map(data.districts.map((d) => [d.id, shadeClass(totals[d.i], breaks)])), [data, totals, breaks]);

  // A region or a search moves the map to what it found; picking years does not.
  const fitKey = `${view.f.region}|${view.f.q}`;
  const fit: MapFit | null = useMemo(() => {
    if (!view.f.region && !view.f.q) return null;
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    for (const m of marks) {
      const [x, y] = m.geometry.coordinates;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return x0 <= x1 ? { bounds: [[x0, y0], [x1, y1]] } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only when the region or the search changes
  }, [fitKey]);
  const [pick, setPick] = useState<MapPick>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const selectedDistrict = pick?.kind === 'district' ? pick.id : view.f.district >= 0 ? data.districts[view.f.district].id : null;

  const b = (key: string) => summary.budgets.find((x) => x.key === key)!;
  const gaa = GAA_YEARS.map((y) => b(`gaa-${y}`));
  const gaaLines = gaa.reduce((a, x) => a + x.lines, 0);
  const house = b('house-2027');
  const placedByName = summary.budgets.reduce((a, x) => a + x.levels.barangay + x.levels.municipality + x.levels.city + x.levels.province, 0);
  const allLines = summary.budgets.reduce((a, x) => a + x.lines, 0);

  const showOnMap = (l: MpbLine) => {
    const at = l.pts?.[0] ?? (l.place >= 0 ? [data.places[l.place].lng, data.places[l.place].lat] : null);
    if (!at) return;
    setFocus({ lng: at[0], lat: at[1], zoom: l.level === 'gps' || l.level === 'barangay' ? 12 : 10, seq: Date.now() });
    setPick(l.level === 'gps' ? { kind: 'gps', line: l.i, place: l.place } : l.place >= 0 ? { kind: 'place', place: l.place } : null);
    document.getElementById('hgab-mpbm-map')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <HgabHeader crumb={MPB_MAP_TITLE} />
      <HgabHero
        compact
        crumb={<><Link to={HISTORY_ROOT}>{HISTORY_TITLE}</Link><span className="hgab-crumb-sep" aria-hidden="true">·</span><span className="hgab-crumb-here">Map</span></>}
        title={<>{count(gaaLines)} multi-purpose building lines in the {FIRST} to {LAST_GAA} enacted budgets, and {count(house.lines)} in the 2027 House bill</>}
        dek={<>Every line from {FIRST} to 2027 on one map. A blue dot is GPS published in the title; a ring is the barangay, town or province the title names.</>}
        note={
          <>
            A line is one project as a budget lists it, so a building funded over several years has a line in each. Rings sit at the
            centre of the place, not at the building. Amounts are allocations, not spending. {asOfText({ built_at: summary.built_at })}.
          </>
        }
      />
      <main className="nep-main hgab-mpbm-main">
        <div className="hgab-mpbm-controls" role="group" aria-label="Choose what the map and the list show">
          <YearBars summary={summary} view={view} setView={setView} />
          <div className="hgab-mpbm-filters">
            <label className="hgab-mpbm-search">
              <span className="visually-hidden">Search titles, places and offices</span>
              <input type="search" value={qInput} onChange={(e) => setTyped({ base: view.f.q, text: e.target.value })} placeholder="Search a title, place or office" />
            </label>
            <label>
              <span>Region</span>
              <select value={view.f.region} onChange={(e) => setView({ f: { region: e.target.value as RegionKey | '' } })}>
                <option value="">All regions</option>
                {REGION_ORDER.map((r) => <option key={r} value={r}>{REGION_LABELS[r].short} · {REGION_LABELS[r].name}</option>)}
              </select>
            </label>
            <label>
              <span>Placed by</span>
              <select value={view.f.placed} onChange={(e) => setView({ f: { placed: e.target.value as MpbFilters['placed'] } })}>
                <option value="">Any</option>
                {(Object.keys(PLACED_LABELS) as Array<keyof typeof PLACED_LABELS>).map((k) => <option key={k} value={k}>{PLACED_LABELS[k]}</option>)}
              </select>
            </label>
            <label>
              <span>Budget line</span>
              <select value={view.f.rule} onChange={(e) => setView({ f: { rule: e.target.value as MpbFilters['rule'] } })}>
                <option value="">Both</option>
                <option value="pap">Multi-purpose building lines</option>
                <option value="title">Named in the title, other lines</option>
              </select>
            </label>
            <label>
              <span>Repeats</span>
              <select value={view.f.repeat} onChange={(e) => setView({ f: { repeat: e.target.value as RepeatMode } })}>
                <option value="">Every line</option>
                {(Object.keys(REPEAT_LABELS) as Array<keyof typeof REPEAT_LABELS>).map((k) => <option key={k} value={k}>{REPEAT_LABELS[k]}</option>)}
              </select>
            </label>
          </div>
        </div>

        <section className="hgab-mpbm-mapwrap" id="hgab-mpbm-map" aria-label="Map">
          <div className="hgab-mpbm-map">
            <Suspense fallback={<div className="hgab-mpbm-canvas is-loading" />}>
              <MpbMap
                districts={districts}
                marks={marks}
                shade={shade}
                selectedDistrict={selectedDistrict}
                focus={focus}
                fit={fit}
                onPick={(p) => { setPick(p); if (!p) setFocus(null); }}
                onError={(m) => setMapError(m)}
              />
            </Suspense>
            <MapKey breaks={breaks} lines={mapLines.length} marks={marks.length} />
            {mapError && <p className="hgab-mpbm-maperr" role="status">The base map did not load ({mapError}). The list below has every line.</p>}
          </div>
          <PickPanel
            data={data}
            pick={pick}
            sel={sel}
            mapLines={mapLines}
            onClose={() => { setPick(null); setFocus(null); }}
            onList={(f) => { setView({ f }); document.getElementById('hgab-mpbm-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
            onShow={showOnMap}
          />
        </section>

        <RepeatsSection data={data} lines={baseLines} view={view} setView={setView} onShow={showOnMap} />

        <LinesList data={data} lines={listLines} view={view} setView={setView} onShow={showOnMap} />

        <section className="nep-section hgab-mpbm-section" aria-labelledby="hgab-mpbm-placed">
          <h2 id="hgab-mpbm-placed" className="hgab-mpbm-h2">
            {Math.round((placedByName / allLines) * 100)}% of lines are placed by the place their title names
          </h2>
          <p className="hgab-mpbm-dek">How each line got its spot on the map, by budget. GPS appears in titles from 2026.</p>
          <PlacementTable summary={summary} />
          <Caveats
            items={[
              `Budgets before ${FIRST} do not list multi-purpose buildings by name, so the map starts there.`,
              `${FIRST} to ${PAP_RULE_FROM - 1} have no budget line for multi-purpose buildings; their lines are those whose titles name one.`,
              ...summary.budgets.filter((x) => x.listed_at_zero > 0).map((x) =>
                `In ${x.fy}, the budget file lists ${count(x.listed_at_zero)} more items named for multi-purpose buildings at ₱0; they are left out.`),
              'The 2019 lines are read line by line from DBM’s detailed GAA for DPWH. They add up to the total it publishes.',
              'A ring is the centre of the barangay, town, city or province a title names, not the building. GPS points are as published, and some are wrong.',
              'A line placed by its DPWH office shows the office’s area, not the building. Lines with no place in the title and no office area are listed, not mapped.',
              'The 2027 NEP and House bill are two stages of one budget: pick one, never both added together.',
              'District shading counts lines with a legislative district only. A district is where a title places a building; the documents do not say who asked for it.',
              'From 2020, the multi-purpose building lines alone equal the multi-purpose page’s chart. Buildings named “multi-purpose” on other lines make the totals here larger.',
            ]}
          />
          <MethodDetails summary={summary} data={data} />
        </section>

        <DisclaimerNotice compact offices />
      </main>
      <SiteFooter />
    </>
  );
}

// ---------------------------------------------------------------------------
// Year bars: the year filter, drawn to scale
// ---------------------------------------------------------------------------

function YearBars({ summary, view, setView }: { summary: MpbSummary; view: View; setView: (v: ViewPatch) => void }) {
  const stat = (fy: number) => summary.budgets.find((x) => x.key === budgetKey(fy, view.stage))!;
  const max = Math.max(...summary.budgets.map((x) => x.php));
  const toggle = (fy: number) => {
    const next = new Set(view.years);
    if (next.has(fy)) next.delete(fy); else next.add(fy);
    if (next.size) setView({ years: next });
  };
  const only = (ys: readonly number[]) => setView({ years: new Set(ys) });
  const all = view.years.size === MPB_YEARS.length;
  return (
    <div className="hgab-mpbm-years">
      <div className="hgab-mpbm-years-head">
        <p className="hgab-mpbm-label">Years <span>(click a bar to add or remove it)</span></p>
        <div className="hgab-ds-dims hgab-mpbm-quick" role="group" aria-label="Quick picks">
          <button type="button" aria-pressed={all} onClick={() => only(MPB_YEARS)}>All</button>
          <button type="button" aria-pressed={view.years.size === GAA_YEARS.length && !view.years.has(2027)} onClick={() => only(GAA_YEARS)}>Enacted, {FIRST}–{LAST_GAA}</button>
          <button type="button" aria-pressed={view.years.size === 1 && view.years.has(2027)} onClick={() => only([2027])}>2027 only</button>
        </div>
        <div className="hgab-ds-dims hgab-mpbm-stage" role="group" aria-label="2027 stage">
          <span>2027:</span>
          <button type="button" aria-pressed={view.stage === 'house'} onClick={() => setView({ stage: 'house' })}>House bill</button>
          <button type="button" aria-pressed={view.stage === 'nep'} onClick={() => setView({ stage: 'nep' })}>NEP</button>
        </div>
      </div>
      <ol className="hgab-mpbm-bars">
        {MPB_YEARS.map((fy) => {
          const s = stat(fy);
          const on = view.years.has(fy);
          const h = Math.max(2, Math.round((s.php / max) * 64));
          const stageCls = fy < 2027 ? 'is-gaa' : view.stage === 'house' ? 'is-house' : 'is-nep';
          return (
            <li key={fy}>
              <button
                type="button"
                className={`${stageCls} ${on ? 'is-on' : 'is-off'}`}
                aria-pressed={on}
                title={`${yearLabel(fy, view.stage)}: ${count(s.lines)} lines, ${fullPeso(s.php)}`}
                onClick={() => toggle(fy)}
              >
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

// ---------------------------------------------------------------------------
// Map key
// ---------------------------------------------------------------------------

function MapKey({ breaks, lines, marks }: { breaks: number[]; lines: number; marks: number }) {
  const edges = [0, ...breaks];
  return (
    <div className="hgab-mpbm-key" aria-label="Map key">
      <ul>
        <li><i className="is-gps" style={{ background: MARK_COLORS.gps }} /> GPS in the title</li>
        <li><i className="is-ring" /> Place named in the title (centre)</li>
        <li><i className="is-area" style={{ background: MARK_COLORS.area }} /> Office area or region only</li>
        <li><i className="is-cluster" style={{ background: MARK_COLORS.cluster }} /> Group: zoom in</li>
      </ul>
      {breaks.length > 0 && (
        <div className="hgab-mpbm-shade">
          <span>Legislative districts, by amount</span>
          <ol>
            {SHADE_COLORS.slice(0, edges.length).map((c, i) => (
              <li key={c}>
                <i style={{ background: c }} />
                {i === 0 ? `under ${bn(edges[1] ?? 0)}` : `${bn(edges[i])}+`}
              </li>
            ))}
          </ol>
        </div>
      )}
      <p>{count(lines)} lines · {count(marks)} marks</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// What was clicked
// ---------------------------------------------------------------------------

function PickPanel({ data, pick, sel, mapLines, onClose, onList, onShow }: {
  data: MpbData;
  pick: MapPick;
  sel: MpbSelection;
  mapLines: MpbLine[];
  onClose: () => void;
  onList: (f: Partial<MpbFilters>) => void;
  onShow: (l: MpbLine) => void;
}) {
  if (!pick) {
    return (
      <aside className="hgab-mpbm-panel is-empty" aria-label="Selection">
        <p>Click a dot, a ring or a district to see its lines. Click a dark group to zoom in.</p>
      </aside>
    );
  }
  let head: ReactNode;
  let lines: MpbLine[];
  let listFilter: Partial<MpbFilters> | null = null;
  if (pick.kind === 'district') {
    const di = data.districtIndex.get(pick.id) ?? -1;
    const d = data.districts[di];
    lines = mapLines.filter((l) => l.district === di);
    listFilter = { district: di, place: -1 };
    head = (
      <>
        <p className="hgab-mpbm-panel-kicker">Legislative district</p>
        <h3>{d?.label ?? pick.id}</h3>
        <p className="hgab-mpbm-panel-note">
          Lines whose title places them here, or whose DPWH office serves only this district. The documents do not say who asked for them.{' '}
          <Link to={`/hgab/2027/districts/${encodeURIComponent(pick.id)}`}>District page →</Link>
        </p>
      </>
    );
  } else {
    const p = pick.place >= 0 ? data.places[pick.place] : null;
    if (pick.kind === 'gps') {
      const l = data.lines[pick.line];
      lines = [l, ...(p ? mapLines.filter((x) => x.place === pick.place && x.i !== l.i) : [])];
    } else {
      lines = mapLines.filter((l) => l.place === pick.place && l.level !== 'gps');
    }
    listFilter = p ? { place: p.i, district: -1 } : null;
    head = (
      <>
        <p className="hgab-mpbm-panel-kicker">{pick.kind === 'gps' ? LEVEL_LABELS.gps : p ? LEVEL_LABELS[p.level] : ''}</p>
        <h3>{p?.label ?? data.lines[(pick as { line: number }).line]?.title}</h3>
        {p && (p.level === 'deo' || p.level === 'region') && (
          <p className="hgab-mpbm-panel-note">These titles name no place we could find; the mark stands for the office’s area or the region.</p>
        )}
      </>
    );
  }
  const byYear = new Map<number, MpbLine[]>();
  for (const l of lines) byYear.set(l.fy, [...(byYear.get(l.fy) ?? []), l]);
  const total = lines.reduce((a, l) => a + (lineAmount(l, sel.stage) ?? 0), 0);
  const years = [...byYear.keys()].sort((a, b) => b - a);
  return (
    <aside className="hgab-mpbm-panel" aria-label="Selection">
      <button type="button" className="hgab-mpbm-panel-close" onClick={onClose} aria-label="Close">×</button>
      {head}
      <p className="hgab-mpbm-panel-fig">
        {lines.length ? (
          <><strong>{count(lines.length)} {lines.length === 1 ? 'line' : 'lines'}</strong>, {billions(total)}{years.length > 1 && <> · {years.length} budgets</>}</>
        ) : 'No lines here in the years and filters chosen.'}
      </p>
      {listFilter && lines.length > 0 && (
        <button type="button" className="hgab-mpbm-linkbtn" onClick={() => onList(listFilter!)}>Show them in the list ↓</button>
      )}
      <div className="hgab-mpbm-panel-body">
        {years.map((fy) => (
          <section key={fy}>
            <h4>{yearLabel(fy, sel.stage)} <span>{count(byYear.get(fy)!.length)}</span></h4>
            <ul>
              {byYear.get(fy)!.slice(0, 40).map((l) => <PanelLine key={l.i} data={data} l={l} stage={sel.stage} onShow={onShow} />)}
            </ul>
            {byYear.get(fy)!.length > 40 && <p className="hgab-mpbm-more">And {count(byYear.get(fy)!.length - 40)} more in the list.</p>}
          </section>
        ))}
      </div>
    </aside>
  );
}

function PanelLine({ data, l, stage, onShow }: { data: MpbData; l: MpbLine; stage: Stage2027; onShow: (l: MpbLine) => void }) {
  const href = recordHref(l);
  const flags = lineFlags(l, data.flagBits);
  return (
    <li>
      <p className="hgab-mpbm-title">{href ? <Link to={href}>{l.title}</Link> : l.title}</p>
      <p className="hgab-mpbm-meta">
        <strong>{fullPeso(lineAmount(l, stage))}</strong>
        {l.office && <> · {officeShort(l.office)}</>}
        {l.cls && l.cls !== 'paired' && <> · {CLASS_LABELS[l.cls]}</>}
        {l.pts && <> · <button type="button" className="hgab-mpbm-linkbtn" onClick={() => onShow(l)}>{l.pts[0][1].toFixed(5)}, {l.pts[0][0].toFixed(5)}</button></>}
      </p>
      {flags.length > 0 && <p className="hgab-mpbm-flag">{flags.map((f) => FLAG_TEXT[f]).join(' ')}</p>}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Repeats: the same title at the same place, and barangays with more than one line
// ---------------------------------------------------------------------------

const GROUPS_PAGE = 20;
/** Lines an opened group shows before "Show all". */
const GROUP_ROWS = 30;

function RepeatsSection({ data, lines, view, setView, onShow }: {
  data: MpbData;
  lines: MpbLine[];
  view: View;
  setView: (v: ViewPatch) => void;
  onShow: (l: MpbLine) => void;
}) {
  const [tab, setTab] = useState<Exclude<RepeatMode, ''>>(view.f.repeat || 'title');
  const titles = useMemo(() => repeatGroups(data, lines, view.stage, 'title'), [data, lines, view.stage]);
  const barangays = useMemo(() => repeatGroups(data, lines, view.stage, 'barangay'), [data, lines, view.stage]);
  const groups = tab === 'title' ? titles : barangays;
  const [more, setMore] = useState<{ of: MpbGroup[]; n: number }>({ of: groups, n: GROUPS_PAGE });
  const shown = more.of === groups ? more.n : GROUPS_PAGE;
  const multiYear = (gs: MpbGroup[]) => gs.filter((g) => g.years.length > 1).length;
  const head = tab === 'title'
    ? `${count(titles.length)} titles appear more than once at the same place, ${count(multiYear(titles))} of them in more than one budget`
    : `${count(barangays.length)} barangays have more than one line, ${count(multiYear(barangays))} of them in more than one budget`;
  return (
    <section className="nep-section hgab-mpbm-section" id="hgab-mpbm-repeats" aria-labelledby="hgab-mpbm-repeats-h">
      <div className="hgab-mpbm-listhead">
        <div>
          <h2 id="hgab-mpbm-repeats-h" className="hgab-mpbm-h2">{head}</h2>
          <p className="hgab-mpbm-dek">
            A title repeated over the years can be phases of one building, or repairs. Read the lines before drawing a
            conclusion.
          </p>
        </div>
        <div className="hgab-ds-dims hgab-mpbm-tabs" role="tablist" aria-label="Group repeats by">
          <button type="button" role="tab" aria-selected={tab === 'title'} aria-pressed={tab === 'title'} onClick={() => setTab('title')}>
            Same title ({count(titles.length)})
          </button>
          <button type="button" role="tab" aria-selected={tab === 'barangay'} aria-pressed={tab === 'barangay'} onClick={() => setTab('barangay')}>
            Same barangay ({count(barangays.length)})
          </button>
        </div>
      </div>
      <ol className="hgab-mpbm-groups">
        {groups.slice(0, shown).map((g) => (
          <GroupRow key={`${g.kind}:${g.key}`} data={data} g={g} stage={view.stage} onShow={onShow}
            onList={g.kind === 'barangay' ? () => {
              setView({ f: { place: g.place, district: -1 } });
              document.getElementById('hgab-mpbm-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } : undefined} />
        ))}
      </ol>
      {groups.length > shown && (
        <p className="hgab-mpbm-more">
          Showing {count(shown)} of {count(groups.length)}.{' '}
          <button type="button" className="hgab-mpbm-linkbtn" onClick={() => setMore({ of: groups, n: shown + GROUPS_PAGE * 5 })}>
            Show {count(Math.min(GROUPS_PAGE * 5, groups.length - shown))} more
          </button>
        </p>
      )}
      {!groups.length && <p className="hgab-mpbm-more">No repeats among the lines chosen.</p>}
      <p className="hgab-mpbm-more">
        Same title: the words of the title, setting aside spelling, “MPB”, “Bldg.”, “Brgy.”, phase numbers and GPS, at the same
        place. Same barangay: lines whose title names that barangay. Amounts add up across years, never the NEP and the House bill.
      </p>
    </section>
  );
}

function GroupRow({ data, g, stage, onShow, onList }: {
  data: MpbData;
  g: MpbGroup;
  stage: Stage2027;
  onShow: (l: MpbLine) => void;
  onList?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const p = g.place >= 0 ? data.places[g.place] : null;
  const latest = g.lines[g.lines.length - 1];
  const newestFirst = [...g.lines].reverse();
  const rows = all ? newestFirst : newestFirst.slice(0, GROUP_ROWS);
  const perYear = g.years.map((fy) => [fy, g.lines.filter((l) => l.fy === fy).length] as const);
  const district = latest.district >= 0 ? data.districts[latest.district] : null;
  return (
    <li className="hgab-mpbm-group">
      <button type="button" className="hgab-mpbm-group-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="hgab-mpbm-group-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="hgab-mpbm-group-main">
          <strong>{g.kind === 'title' ? latest.title : p?.label}</strong>
          <span className="hgab-mpbm-sub">
            {g.kind === 'title' && p ? `${p.label} · ` : ''}
            {district ? `${district.label} · ` : ''}
            {g.years.length} {g.years.length === 1 ? 'budget' : 'budgets'} · {count(g.lines.length)} lines · {billions(g.php)}
          </span>
        </span>
        <span className="hgab-mpbm-chips" aria-label="Budgets">
          {perYear.map(([fy, n]) => (
            <i key={fy}>{fy < 2027 ? fy : stage === 'house' ? '2027 House' : '2027 NEP'}{n > 1 ? ` ×${n}` : ''}</i>
          ))}
        </span>
      </button>
      {open && (
        <div className="hgab-mpbm-group-body">
          <table className="hgab-mpbm-table">
            <tbody>
              {rows.map((l) => {
                const href = recordHref(l);
                return (
                  <tr key={l.i}>
                    <td className="hgab-mpbm-yr">{yearLabel(l.fy, stage)}</td>
                    <td>{href ? <Link to={href}>{l.title}</Link> : l.title}</td>
                    <td>{officeShort(l.office) ?? '—'}</td>
                    <td className="is-num">{fullPeso(lineAmount(l, stage))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="hgab-mpbm-group-actions">
            {rows.length < g.lines.length && (
              <button type="button" className="hgab-mpbm-linkbtn" onClick={() => setAll(true)}>Show all {count(g.lines.length)} lines</button>
            )}
            <button type="button" className="hgab-mpbm-linkbtn" onClick={() => onShow(latest)}>On the map</button>
            {onList && <button type="button" className="hgab-mpbm-linkbtn" onClick={onList}>Show in the list</button>}
          </p>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

function LinesList({ data, lines, view, setView, onShow }: {
  data: MpbData;
  lines: MpbLine[];
  view: View;
  setView: (v: ViewPatch) => void;
  onShow: (l: MpbLine) => void;
}) {
  // How many rows to show; back to one page whenever the lines change.
  const [more, setMore] = useState<{ of: MpbLine[]; n: number }>({ of: lines, n: PAGE });
  const shown = more.of === lines ? more.n : PAGE;
  const sorted = useMemo(() => sortLines(lines, view.sort, view.stage), [lines, view.sort, view.stage]);
  const total = lines.reduce((a, l) => a + (lineAmount(l, view.stage) ?? 0), 0);
  const yearsText = view.years.size === MPB_YEARS.length ? `${FIRST} to 2027` : [...view.years].sort().map((y) => yearLabel(y, view.stage)).join(', ');
  const download = () => {
    const blob = new Blob(['﻿', linesCsv(data, sorted)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bettergov-multi-purpose-buildings-selection.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const chips: ReactNode[] = [];
  if (view.f.district >= 0) chips.push(
    <button key="d" type="button" className="hgab-mpbm-chip" onClick={() => setView({ f: { district: -1 } })}>
      {data.districts[view.f.district].label} (legislative district) ×
    </button>,
  );
  if (view.f.place >= 0) chips.push(
    <button key="p" type="button" className="hgab-mpbm-chip" onClick={() => setView({ f: { place: -1 } })}>
      {data.places[view.f.place].label} ×
    </button>,
  );
  const anyFilter = view.f.q || view.f.region || view.f.placed || view.f.rule || view.f.repeat || chips.length;
  return (
    <section className="nep-section hgab-mpbm-section" id="hgab-mpbm-list" aria-labelledby="hgab-mpbm-list-h">
      <div className="hgab-mpbm-listhead">
        <div>
          <h2 id="hgab-mpbm-list-h" className="hgab-mpbm-h2">{count(lines.length)} lines, {billions(total)}, {yearsText}</h2>
          <p className="hgab-mpbm-dek">
            {chips.length ? chips : 'Every line the controls above select.'}
            {anyFilter ? <> <button type="button" className="hgab-mpbm-linkbtn" onClick={() => setView({ f: NO_FILTERS })}>Clear filters</button></> : null}
          </p>
        </div>
        <div className="hgab-mpbm-listactions">
          <label>
            <span>Sort</span>
            <select value={view.sort} onChange={(e) => setView({ sort: e.target.value as MpbSort })}>
              <option value="year">Newest first</option>
              <option value="amount">Largest first</option>
              <option value="title">Title, A to Z</option>
            </select>
          </label>
          <button type="button" className="hgab-cta" onClick={download} disabled={!lines.length}>Download these (CSV)</button>
          <a className="hgab-mpbm-linkbtn" href={dataUrl(MPB_CSV_PATH)} download={MPB_CSV_NAME}>Every line, every year (CSV)</a>
        </div>
      </div>
      <div className="hgab-mpbm-tablewrap">
        <table className="hgab-mpbm-table hgab-mpbm-lines">
          <thead>
            <tr>
              <th scope="col">Budget</th>
              <th scope="col">Project</th>
              <th scope="col">Where</th>
              <th scope="col">DPWH office</th>
              <th scope="col" className="is-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, shown).map((l) => <ListRow key={l.i} data={data} l={l} stage={view.stage} onShow={onShow} />)}
          </tbody>
        </table>
      </div>
      {sorted.length > shown && (
        <p className="hgab-mpbm-more">
          Showing {count(shown)} of {count(sorted.length)}.{' '}
          <button type="button" className="hgab-mpbm-linkbtn" onClick={() => setMore({ of: lines, n: shown + PAGE * 5 })}>Show {count(Math.min(PAGE * 5, sorted.length - shown))} more</button>
        </p>
      )}
      {!sorted.length && <p className="hgab-mpbm-more">No line matches. Try fewer filters or more years.</p>}
      <p className="hgab-mpbm-more">{DEO_MEANING} The legislative district under a place is where the title puts the building.</p>
    </section>
  );
}

function ListRow({ data, l, stage, onShow }: { data: MpbData; l: MpbLine; stage: Stage2027; onShow: (l: MpbLine) => void }) {
  const p = l.place >= 0 ? data.places[l.place] : null;
  const d = l.district >= 0 ? data.districts[l.district] : null;
  const href = recordHref(l);
  const mapped = l.level !== 'none' && (l.pts || p);
  const flags = lineFlags(l, data.flagBits);
  return (
    <tr>
      <td className="hgab-mpbm-yr">{yearLabel(l.fy, stage)}{l.cls === 'house_only' && stage === 'house' && <span className="hgab-mpbm-tag">House bill only</span>}</td>
      <td>
        <span className="hgab-mpbm-title">{href ? <Link to={href}>{l.title}</Link> : l.title}</span>
        {(l.rule === 'title' || flags.length > 0) && (
          <span className="hgab-mpbm-sub">
            {l.rule === 'title' && l.fy >= PAP_RULE_FROM && l.pap && <>Under “{l.pap}”. </>}
            {flags.map((f) => FLAG_TEXT[f]).join(' ')}
          </span>
        )}
      </td>
      <td>
        <span className={`hgab-mpbm-lvl is-${l.level}`}>{LEVEL_SHORT[l.level as MpbLevel]}</span>{' '}
        {p && l.level !== 'deo' && l.level !== 'region' ? p.label : null}
        {d && <span className="hgab-mpbm-sub">{d.label}</span>}
        {mapped && <button type="button" className="hgab-mpbm-linkbtn" onClick={() => onShow(l)}>On the map</button>}
      </td>
      <td>{officeShort(l.office) ?? '—'}</td>
      <td className="is-num">{fullPeso(lineAmount(l, stage))}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// How lines were placed, and the method
// ---------------------------------------------------------------------------

const CENSUS_COLS: Array<{ key: string; label: string; levels: MpbLevel[] }> = [
  { key: 'gps', label: 'GPS', levels: ['gps'] },
  { key: 'barangay', label: 'Barangay', levels: ['barangay'] },
  { key: 'town', label: 'Town or city', levels: ['municipality', 'city'] },
  { key: 'province', label: 'Province', levels: ['province'] },
  { key: 'office', label: 'Office area', levels: ['deo'] },
  { key: 'region', label: 'Region', levels: ['region'] },
  { key: 'none', label: 'Not mapped', levels: ['none'] },
];

function PlacementTable({ summary }: { summary: MpbSummary }) {
  return (
    <div className="hgab-mpbm-tablewrap">
      <table className="hgab-mpbm-table hgab-mpbm-census">
        <thead>
          <tr>
            <th scope="col">Budget</th>
            <th scope="col" className="is-num">Lines</th>
            {CENSUS_COLS.map((c) => <th key={c.key} scope="col" className="is-num">{c.label}</th>)}
            <th scope="col" className="is-num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {summary.budgets.map((b) => (
            <tr key={b.key}>
              <th scope="row">{b.fy < 2027 ? `${b.fy} enacted` : b.stage === 'house' ? '2027 House bill' : '2027 NEP'}</th>
              <td className="is-num">{count(b.lines)}</td>
              {CENSUS_COLS.map((c) => {
                const n = c.levels.reduce((a, k) => a + b.levels[k], 0);
                return <td key={c.key} className={`is-num ${n ? '' : 'is-zero'}`} title={`${Math.round((n / b.lines) * 1000) / 10}%`}>{n ? count(n) : '—'}</td>;
              })}
              <td className="is-num">{bn(b.php)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MethodDetails({ summary, data }: { summary: MpbSummary; data: MpbData }) {
  const short = summary.source.commit.slice(0, 7);
  return (
    <HgabDetails>
      <p>
        <strong>Which lines.</strong> The source workbench’s rule for multi-purpose buildings, applied to every budget: a line is in when
        it sits on a multi-purpose building budget line (BIP 300226 and SIPAG 300220 from FY2022; the Local Program’s MULTIPURPOSE /
        FACILITIES lines 300103 and 300104 in FY2018–FY2021; in 2027, “BIP - Multi-Purpose Buildings/ Facilities to support Social
        Services”), or when its title names a multi-purpose building or hall. FY2015–FY2017 have no such budget line, so only titles count.
        From FY2020 the first group adds up to the multi-purpose page’s chart. A line is a code with an amount: items listed at ₱0 are out.
      </p>
      <p>
        <strong>Sources.</strong> {GAA_YEARS.length} enacted
        budgets: FY2015–FY2018 from DBM’s technical files in the GAA history release; FY2019 read from the text of DBM’s detailed GAA for
        DPWH, every line adding up to its published total and to each of its headings; FY2020–FY2026 from the GAA extracts the rest of this
        site uses.
      </p>
      <p>
        <strong>Where.</strong> First that works: GPS published in the title (pairs outside the country or out at sea are dropped); the barangay, town,
        city or province the title names, at the centre of its 2023 PSA outline; the area of the DPWH office (the legislative districts it
        serves); the region; nowhere. The legislative district comes from the title’s place, else the GPS point, else an office that serves
        one district. Titles from FY2015–FY2017 often end with the district of the time (“Pampanga 4th LD”); it is set aside to read the place,
        and the map uses today’s districts. FY2027 is the source’s own MPB lens, as it is. The enacted budgets are read with the source’s own code: its
        title matcher ({summary.source.methods.title_place}), GPS reader and centroids.
      </p>
      <p>
        <strong>Repairs.</strong> The enacted-budget text has garbled characters (“Las Pi±as”); exact character repairs fixed{' '}
        {count(Object.values(summary.text_repairs).reduce((a, n) => a + n, 0))} of them, never a place name. Titles from before 2023 that
        say “Maguindanao” are read as the province that holds the named town today ({count(summary.budgets.reduce((a, b) => a + b.flags.maguindanao_successor, 0))} lines).
      </p>
      <p>
        Source: <a href={`${summary.source.repo}/tree/${summary.source.commit}`} target="_blank" rel="noopener noreferrer">{summary.source.repo.replace('https://github.com/', '')} at {short}</a>.
        {' '}{count(data.places.length)} places, {count(summary.totals.gps_points)} GPS points. Built {new Date(summary.built_at).toLocaleString('en-US', { timeZone: 'Asia/Manila' })}.
      </p>
      <p>Checks run when the file was built:</p>
      <ul className="hgab-hy-codes">
        {summary.checks.map((c) => <li key={c.key}>{c.ok ? '✓' : '✗'} {c.detail}</li>)}
      </ul>
    </HgabDetails>
  );
}

