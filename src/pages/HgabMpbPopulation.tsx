/**
 * `/hgab/2027/multi-purpose/per-person`: multi-purpose buildings against the population in each budget's year, by
 * region, province (with its HUCs; Metro Manila as four districts) or city and municipality, for any budget FY2015 to
 * the 2027 House bill, the FY2020–2026 GAA combined, or all years (with the 2027 NEP or the House bill). Budgets of
 * several years are shown as a yearly average ("per person a year").
 * State in the URL: `?budget=&level=&measure=&q=`.
 *
 * Data: hgab/2027/mpb-years/population.json (scripts/build-mpb-population.ts; contract src/lib/mpb-population.ts).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SiteFooter from '../components/SiteFooter';
import { DisclaimerNotice, HgabError, HgabHeader, HgabHero, HgabLoading } from '../components/HgabBits';
import { cached, getJson, loadHgabGeo, type HgabGeo } from '../lib/hgab';
import MpbPopulationMap from '../components/MpbPopulationMap';
import { dataUrl } from '../lib/data-url';
import { HISTORY_ROOT, HISTORY_TITLE } from '../lib/hgab-history';
import { MPB_MAP_ROOT } from '../lib/hgab-mpb-years';
import { MPB_CARD_DISCLAIMER } from '../lib/hgab-disclaimers';
import {
  ALL_HOUSE_KEY, ALL_NEP_KEY, COMBINED_KEY, MPB_POPULATION_CSV_NAME, MPB_POPULATION_PATH, MPB_POPULATION_ROOT,
  peopleIn, populationBasis, type MpbPopBudget, type MpbPopulationFile, type PopLevel, type Tally,
} from '../lib/mpb-population';
import { INDICATORS_ROOT, areaPath } from '../lib/indicators';
import { REGION_NAMES } from '../lib/budget-regions';
import { pageMeta } from '../lib/seo';
import '../nep2027.css';
import '../indicators.css';

/** 'php': budget per person. 'count': MPB projects, shown as "1 project for every N people". */
type Measure = 'php' | 'count';
/** `population`: the people in the budget's year, or the average over its years. */
interface Unit { id: string; name: string; sub: string; population: number; t: Tally; link?: string }

const LEVELS: { key: PopLevel; label: string }[] = [
  { key: 'region', label: 'Regions' }, { key: 'area', label: 'Provinces' }, { key: 'town', label: 'Cities and municipalities' },
];
const peso = (v: number) => `₱${Math.round(v).toLocaleString('en-PH')}`;
const big = (v: number) => (v >= 1e9 ? `₱${(v / 1e9).toFixed(1)}B` : `₱${(v / 1e6).toFixed(1)}M`);
const n = (v: number) => v.toLocaleString('en-PH');
// Rates over `yrs` budget years are per year: a budget of several years reads as its yearly average.
const per100k = (t: Tally, p: number, yrs: number) => (p ? (1e5 * t[0]) / yrs / p : 0);
const perPerson = (t: Tally, p: number, yrs: number) => (p ? t[1] / yrs / p : 0);
const aYear = (yrs: number) => (yrs > 1 ? ' a year' : '');
/** "1 project for every 990 people": the plainest way to say how many there are for the people living there. */
const onePer = (t: Tally, p: number, yrs: number) => (t[0] ? `1 project for every ${n(Math.round((p * yrs) / t[0]))} people${aYear(yrs)}` : 'no projects');
const projects = (k: number) => `${n(k)} MPB project${k === 1 ? '' : 's'}`;

function loadPopulation(): Promise<MpbPopulationFile> {
  return cached('mpb-population', () => getJson<MpbPopulationFile>(dataUrl(MPB_POPULATION_PATH), 'Failed to load multi-purpose buildings per person'));
}

function unitsOf(f: MpbPopulationFile, b: MpbPopBudget, level: PopLevel): Unit[] {
  const by = f.by[b.key][level];
  if (level === 'region') return f.regions.map((r) => ({ id: r.key, name: r.label, sub: r.plain, population: peopleIn(r.census, b.years), t: by[r.key] ?? [0, 0] }));
  if (level === 'area') return f.areas.map((a) => ({ id: a.id, name: a.name, sub: a.region, population: peopleIn(a.census, b.years), t: by[a.id] ?? [0, 0], link: areaPath(a.id) }));
  const areaName = new Map(f.areas.map((a) => [a.id, a.name]));
  return f.towns.map((t) => ({ id: t.code, name: t.name, sub: `${areaName.get(t.area)} · ${REGION_NAMES[t.region]?.label ?? t.region}`, population: peopleIn(t.census, b.years), t: by[t.code] ?? [0, 0] }));
}

function Bars({ units, measure, avg, yrs }: { units: Unit[]; measure: Measure; avg: number; yrs: number }) {
  const val = (u: Unit) => (measure === 'php' ? perPerson(u.t, u.population, yrs) : per100k(u.t, u.population, yrs));
  const sorted = [...units].sort((a, b) => val(b) - val(a));
  const max = Math.max(...sorted.map(val), 1e-9);
  return (
    <figure className="bpr-fig mpbp-bars">
      <ol className="bpr-rows">
        {sorted.map((u) => (
          <li key={u.id} className="bpr-row mpbp-row">
            <span className="bpr-name">{u.link ? <Link to={u.link}><strong>{u.name}</strong></Link> : <strong>{u.name}</strong>} <span>{u.sub}</span></span>
            <span className="bpr-line"><span className={`bpr-bar ${val(u) >= avg ? 'is-budget' : 'is-poor'}`} style={{ width: `${(val(u) / max) * 100}%` }} /><span className="bpr-val mpbp-say">{measure === 'php' ? `${peso(val(u))} per person${aYear(yrs)}` : onePer(u.t, u.population, yrs)}</span></span>
            <span className="mpbp-meta">{measure === 'php' ? `${big(u.t[1])} · ` : ''}{projects(u.t[0])}{yrs > 1 ? ` in ${yrs} years` : ''}{measure === 'count' ? ` · ${val(u).toFixed(1)} per 100,000 people${aYear(yrs)}` : ''} · {n(Math.round(u.population))} people{yrs > 1 ? ' on average' : ''}</span>
          </li>
        ))}
      </ol>
      <figcaption className="ind-map-note">
        {measure === 'php'
          ? <>Multi-purpose building budget for every person who lives there{yrs > 1 ? ', each year on average' : ''}. Blue bars are above the country’s {peso(avg)} per person{aYear(yrs)}; grey bars below it.</>
          : <>How many people there are for each MPB project{yrs > 1 ? ' each year, on average' : ''}: the fewer people per project, the longer the bar. Blue bars have more projects for their population than the country’s 1 for every {n(Math.round(1e5 / avg))} people{aYear(yrs)}; grey bars fewer.</>}
      </figcaption>
    </figure>
  );
}

/** Every town: population against its multi-purpose building budget, both on log scales. */
function TownScatter({ units, measure, avg, yrs, highlight }: { units: Unit[]; measure: Measure; avg: number; yrs: number; highlight: Set<string> }) {
  const W = 760, H = 460, M = { l: 76, r: 20, t: 14, b: 50 };
  // Several budgets: the budget (or projects) a year against the average population.
  const yOf = (u: Unit) => (measure === 'php' ? u.t[1] : u.t[0]) / yrs;
  const pts = units.filter((u) => u.population > 0 && yOf(u) > 0);
  const [hover, setHover] = useState<Unit | null>(null);
  if (pts.length < 3) return null;
  const xs = pts.map((u) => u.population), ys = pts.map(yOf);
  const x0 = Math.min(...xs) / 1.3, x1 = Math.max(...xs) * 1.3, y0 = Math.min(...ys) / 1.5, y1 = Math.max(...ys) * 1.5;
  const lx = (v: number) => M.l + ((Math.log(v) - Math.log(x0)) / (Math.log(x1) - Math.log(x0))) * (W - M.l - M.r);
  const ly = (v: number) => H - M.b - ((Math.log(v) - Math.log(y0)) / (Math.log(y1) - Math.log(y0))) * (H - M.t - M.b);
  const decades = (lo: number, hi: number) => { const o: number[] = []; for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) for (const m of [1, 3]) { const t = m * 10 ** e; if (t >= lo && t <= hi) o.push(t); } return o; };
  const yLabel = (v: number) => (measure === 'php' ? (v >= 1e9 ? `₱${v / 1e9}B` : v >= 1e6 ? `₱${v / 1e6}M` : `₱${v / 1e3}K`) : v < 1 ? String(v) : n(v));
  // The country's average as a line: budget = average × population.
  const k = measure === 'php' ? avg : avg / 1e5;
  const a0 = Math.max(x0, y0 / k), a1 = Math.min(x1, y1 / k);
  return (
    <figure className="ind-scatter mpbp-scatter">
      <div className="ind-scatter-frame">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${pts.length} cities and municipalities: population against multi-purpose building ${measure === 'php' ? 'budget' : 'projects'}, both on log scales.`}>
          {decades(y0, y1).map((t) => <g key={`y${t}`} className="ind-scatter-grid"><line x1={M.l} x2={W - M.r} y1={ly(t)} y2={ly(t)} /><text x={M.l - 8} y={ly(t)} dy="0.32em" textAnchor="end">{yLabel(t)}</text></g>)}
          {decades(x0, x1).map((t) => <g key={`x${t}`} className="ind-scatter-grid"><line y1={M.t} y2={H - M.b} x1={lx(t)} x2={lx(t)} /><text y={H - M.b + 18} x={lx(t)} textAnchor="middle">{n(t)}</text></g>)}
          {a1 > a0 && <line className="ind-scatter-zero" x1={lx(a0)} y1={ly(a0 * k)} x2={lx(a1)} y2={ly(a1 * k)} />}
          {a1 > a0 && <text className="mpbp-avg" x={lx(a1) - 4} y={ly(a1 * k) - 6} textAnchor="end">The country’s average</text>}
          <text className="ind-scatter-axis" x={(M.l + W - M.r) / 2} y={H - 8} textAnchor="middle">People{yrs > 1 ? ', average over the years' : ''} (log scale)</text>
          <text className="ind-scatter-axis" transform={`translate(15 ${(M.t + H - M.b) / 2}) rotate(-90)`} textAnchor="middle">{measure === 'php' ? 'Multi-purpose building budget' : 'MPB projects'}{aYear(yrs)} (log scale)</text>
          {pts.map((u) => (
            <circle key={u.id} className={`mpbp-dot${highlight.has(u.id) ? ' is-top' : ''}${hover?.id === u.id ? ' is-on' : ''}`} cx={lx(u.population)} cy={ly(yOf(u))} r={highlight.has(u.id) ? 4.5 : 3}
              onPointerEnter={() => setHover(u)} onPointerLeave={() => setHover(null)} />
          ))}
          {pts.filter((u) => highlight.has(u.id)).map((u) => (
            <text key={`l${u.id}`} className="bpr-dotlabel" x={lx(u.population) + 6} y={ly(yOf(u))} dy="0.32em">{u.name}</text>
          ))}
        </svg>
        {hover && (
          <div className="ind-map-tip" style={{ left: `${(lx(hover.population) / W) * 100}%`, top: `${(ly(yOf(hover)) / H) * 100}%` }} role="status">
            <strong>{hover.name}</strong>
            <span>{hover.sub}</span>
            <span>{n(Math.round(hover.population))} people{yrs > 1 ? ' on average' : ''} · {projects(hover.t[0])} · {big(hover.t[1])}{yrs > 1 ? ` in ${yrs} years` : ''}</span>
            <span>{peso(perPerson(hover.t, hover.population, yrs))} per person{aYear(yrs)} · {onePer(hover.t, hover.population, yrs)}</span>
          </div>
        )}
      </div>
      <figcaption className="ind-scatter-cap">
        One dot per city or municipality with at least one MPB project. Dots above the dashed line get more than the
        country’s average for their population; the ten highest per person are labelled. Hover a dot for its figures.
      </figcaption>
    </figure>
  );
}

function TownTable({ units, measure, yrs, peopleHead, q, onQ }: { units: Unit[]; measure: Measure; yrs: number; peopleHead: string; q: string; onQ: (v: string) => void }) {
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => {
    const val = (u: Unit) => (measure === 'php' ? perPerson(u.t, u.population, 1) : per100k(u.t, u.population, 1));
    return [...units].filter((u) => u.t[0] > 0).sort((a, b) => val(b) - val(a));
  }, [units, measure]);
  const rank = new Map(sorted.map((u, i) => [u.id, i + 1]));
  const needle = q.trim().toLowerCase();
  const shown = needle ? sorted.filter((u) => `${u.name} ${u.sub}`.toLowerCase().includes(needle)) : all ? sorted : sorted.slice(0, 100);
  return (
    <section className="ind-section" aria-labelledby="mpbp-towns-h">
      <div className="ind-section-head">
        <h2 id="mpbp-towns-h">Every city and municipality with an MPB project, highest {measure === 'php' ? 'budget per person' : 'number of projects for its people'} first</h2>
        <label className="ind-select"><span>Find</span><input type="search" value={q} placeholder="Town or province" onChange={(e) => onQ(e.target.value)} /></label>
      </div>
      <div className="ind-table-scroll mpbp-table">
        <table className="ind-table">
          <thead><tr>
            <th scope="col" className="is-num">#</th><th scope="col">City or municipality</th>
            <th scope="col" className="is-num">{peopleHead}</th><th scope="col" className="is-num">MPB projects</th><th scope="col" className="is-num">Budget</th>
            <th scope="col" className="is-num">Budget per person{aYear(yrs)}</th><th scope="col">One project for every</th><th scope="col" className="is-num">Projects per 100,000 people{aYear(yrs)}</th>
          </tr></thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id}>
                <td className="is-num ind-muted">{rank.get(u.id)}</td>
                <th scope="row">{u.name} <span className="ind-region">{u.sub}</span></th>
                <td className="is-num">{n(Math.round(u.population))}</td>
                <td className="is-num">{n(u.t[0])}</td>
                <td className="is-num">{big(u.t[1])}</td>
                <td className={`is-num${measure === 'php' ? ' ind-strong' : ''}`}>{peso(perPerson(u.t, u.population, yrs))}</td>
                <td className={measure === 'count' ? 'ind-strong' : undefined}>{n(Math.round((u.population * yrs) / u.t[0]))} people{aYear(yrs)}</td>
                <td className="is-num">{per100k(u.t, u.population, yrs).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ind-footnote">
        {sorted.length} of {units.length} cities and municipalities have at least one MPB project.
        {!needle && !all && sorted.length > 100 && <> <button type="button" className="mpbp-more" onClick={() => setAll(true)}>Show all {sorted.length}</button></>}
      </p>
    </section>
  );
}

export default function HgabMpbPopulation() {
  const [f, setF] = useState<MpbPopulationFile | null>(null);
  const [geo, setGeo] = useState<HgabGeo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    let live = true;
    Promise.all([loadPopulation(), loadHgabGeo()])
      .then(([d, g]) => { if (live) { setF(d); setGeo(g); } })
      .catch((e: unknown) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, []);
  useEffect(() => { document.title = pageMeta(MPB_POPULATION_ROOT).title; }, []);
  if (err) return <HgabError message={err} />;
  if (!f || !geo) return <HgabLoading what="multi-purpose buildings per person" />;

  const budget = f.budgets.find((b) => b.key === params.get('budget'))?.key ?? 'house-2027';
  const level = (LEVELS.find((l) => l.key === params.get('level'))?.key ?? 'region') as PopLevel;
  const measure: Measure = params.get('measure') === 'count' || params.get('measure') === 'lines' ? 'count' : 'php';
  const q = params.get('q') ?? '';
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const b = f.budgets.find((x) => x.key === budget)!;
  const allYears = budget === ALL_NEP_KEY || budget === ALL_HOUSE_KEY;
  const yrs = b.years.length;
  const units = unitsOf(f, b, level);
  const popAll = f.regions.reduce((s, r) => s + peopleIn(r.census, b.years), 0);
  const avg = measure === 'php' ? b.php / yrs / popAll : (1e5 * b.lines) / yrs / popAll; // per person, or projects per 100,000 (a year)
  const placed = b.placed[level];
  const top = new Set([...units].filter((u) => u.t[0] > 0 && u.population > 0).sort((x, y) => perPerson(y.t, y.population, 1) - perPerson(x.t, x.population, 1)).slice(0, 10).map((u) => u.id));
  const basis = populationBasis(b.years);
  const millionPeople = `${(popAll / 1e6).toFixed(1)} million people${yrs > 1 ? ' on average' : ''}`;
  const peopleHead = yrs > 1 ? 'People, average' : `People, ${Math.min(b.years[0], 2024)}`;
  const csv = `${dataUrl(f.csv.path)}?v=${f.csv.sha256.slice(0, 12)}`;
  const singles = f.budgets.filter((x) => !x.key.startsWith('all-') && x.key !== 'gaa-2020-2026');
  const combos = f.budgets.filter((x) => x.key.startsWith('all-') || x.key === 'gaa-2020-2026');

  return (
    <>
      <HgabHeader crumb="Multi-purpose buildings per person" />
      <HgabHero
        compact
        crumb={<><Link to={HISTORY_ROOT}>{HISTORY_TITLE}</Link><span className="hgab-crumb-sep" aria-hidden="true">·</span><span className="hgab-crumb-here">Per person</span></>}
        title={<>Multi-purpose buildings per person: {b.label}, {big(b.php)} in {projects(b.lines)}</>}
        dek={<>Every multi-purpose building line set against the population of its region, province, or city and municipality in the budget’s year ({basis}). The country’s average is {peso(b.php / yrs / popAll)} per person{aYear(yrs)}.</>}
      />
      <main className="nep-main mpbp-main">
        <div className="bpr-controls">
          <label className="ind-select">
            <span>Budget</span>
            <select value={budget} onChange={(e) => set('budget', e.target.value)}>
              <optgroup label="All years and combined">
                {combos.map((x) => <option key={x.key} value={x.key}>{x.label} ({big(x.php)})</option>)}
              </optgroup>
              <optgroup label="One budget">
                {singles.map((x) => <option key={x.key} value={x.key}>{x.label} ({big(x.php)})</option>)}
              </optgroup>
            </select>
          </label>
          <div className="ind-themes" role="group" aria-label="Level">
            {LEVELS.map((l) => <button key={l.key} type="button" aria-pressed={l.key === level} className={l.key === level ? 'is-on' : undefined} onClick={() => set('level', l.key === 'region' ? '' : l.key)}>{l.label}</button>)}
          </div>
          <div className="ind-themes" role="group" aria-label="Measure">
            <button type="button" aria-pressed={measure === 'php'} className={measure === 'php' ? 'is-on' : undefined} onClick={() => set('measure', '')}>Budget per person</button>
            <button type="button" aria-pressed={measure === 'count'} className={measure === 'count' ? 'is-on' : undefined} onClick={() => set('measure', 'count')}>Number of MPBs for the people</button>
          </div>
        </div>
        {allYears && (
          <p className="bpr-warn">
            All years adds the twelve enacted budgets (FY2015–2026) and the {budget === ALL_NEP_KEY ? '2027 NEP' : '2027 House bill'}, a proposal that is
            not yet law, and shows them as a yearly average: the projects and budget of the thirteen years, divided by thirteen
            and by the average population over those years. A building funded over several years is a project in each of
            those years.
          </p>
        )}
        {budget === COMBINED_KEY && (
          <p className="bpr-warn">
            The seven enacted budgets FY2020–2026, shown as a yearly average: their projects and budget divided by seven and
            by the average population over those years.
          </p>
        )}

        <dl className="ind-kpis">
          <div><dt>{b.label}</dt><dd>{big(b.php)}</dd><dd className="ind-kpi-sub">{projects(b.lines)}</dd></div>
          <div><dt>The whole country</dt><dd>{measure === 'php' ? `${peso(avg)} per person${aYear(yrs)}` : `1 for every ${n(Math.round(1e5 / avg))} people${aYear(yrs)}`}</dd><dd className="ind-kpi-sub">{measure === 'php'
            ? `${big(b.php / yrs)}${yrs > 1 ? ' a year' : ''} for ${millionPeople}`
            : `${yrs > 1 ? `${n(Math.round(b.lines / yrs))} projects a year` : projects(b.lines)} for ${millionPeople}; ${avg.toFixed(1)} per 100,000`}</dd></div>
          <div><dt>Placed at this level</dt><dd>{((100 * placed[1]) / b.php).toFixed(1)}%</dd><dd className="ind-kpi-sub">{big(placed[1])} in {projects(placed[0])}; the rest name no {level === 'town' ? 'town' : level === 'area' ? 'province' : 'region'}</dd></div>
          <div><dt>Population</dt><dd>{(popAll / 1e6).toFixed(1)} million</dd><dd className="ind-kpi-sub">{basis[0].toUpperCase() + basis.slice(1)}; <a href={f.population_source.url} target="_blank" rel="noopener noreferrer">PSA, via the Statistics Explorer ↗</a></dd></div>
        </dl>

        <section className="ind-section mpbp-map-section" aria-labelledby="mpbp-map-h">
          <div className="ind-section-head">
            <h2 id="mpbp-map-h">{level === 'town' ? 'Every city and municipality on the map' : level === 'area' ? 'Every province on the map' : 'Every region on the map'}</h2>
            <p>{b.label} · {measure === 'php' ? `budget per person${aYear(yrs)}` : `MPB projects for the people${aYear(yrs)}`}</p>
          </div>
          <MpbPopulationMap geo={geo} f={f} budget={b} level={level} measure={measure}
            onPickTown={(name) => { set('q', name); setTimeout(() => document.getElementById('mpbp-towns-h')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }} />
        </section>

        <section className="ind-section" aria-labelledby="mpbp-chart-h">
          <div className="ind-section-head">
            <h2 id="mpbp-chart-h">{level === 'town' ? 'Population and multi-purpose buildings, every city and municipality' : `${LEVELS.find((l) => l.key === level)!.label}, ${measure === 'php' ? 'highest MPB budget per person first' : 'most MPB projects for their people first'}`}</h2>
            <a className="ind-download" href={csv} download={MPB_POPULATION_CSV_NAME}>Download every region, province and town (CSV, {Math.round(f.csv.bytes / 1024 / 1024)} MB)</a>
          </div>
          {level === 'town'
            ? <TownScatter units={units} measure={measure} avg={avg} yrs={yrs} highlight={top} />
            : <Bars units={units} measure={measure} avg={avg} yrs={yrs} />}
        </section>

        {level === 'town' && <TownTable units={units} measure={measure} yrs={yrs} peopleHead={peopleHead} q={q} onQ={(v) => set('q', v)} />}

        <section className="ind-section ind-about" aria-labelledby="mpbp-about-h">
          <h2 id="mpbp-about-h">How these are counted</h2>
          <ul>
            <li>An MPB project is one line for a multi-purpose building in a budget: a building, or a phase of one. A building funded over several years counts once in each year.</li>
            <li>“1 project for every 990 people” is the population divided by the number of projects. The smaller that number, the more projects for the people living there. For the combined and all-years budgets it is per year: the average population divided by the projects a year.</li>
            {f.notes.map((x) => <li key={x}>{x}</li>)}
          </ul>
          <p>{MPB_CARD_DISCLAIMER} Each line and its place are on the <Link to={MPB_MAP_ROOT}>map of every line</Link>; poverty, age and more for every province are in <Link to={INDICATORS_ROOT}>Indicators</Link>.</p>
        </section>
        <DisclaimerNotice mpb />
      </main>
      <SiteFooter source="SOURCES: GAA FY2015–2026, FY2027 NEP AND HOUSE BILL 10858 (MULTI-PURPOSE BUILDING LINES); PSA 2015, 2020 AND 2024 CENSUSES OF POPULATION" />
    </>
  );
}
