/**
 * The map on `/hgab/2027/multi-purpose/per-person`, shown first.
 *
 * - Regions and provinces: the province outlines shaded by budget per person (or by how many MPB projects there are
 *   for the people), in five classes of about equal size. Regions shade all their provinces the same. People are those
 *   in the budget's year; a budget of several years is read per year, against the average population (peopleIn).
 * - Cities and municipalities: we have no town outlines, so each town is a circle at its place in the MPB data:
 *   its size is the budget (or the number of projects), its shade the same per-person classes.
 * Metro Manila repeats in an inset. Every value is in the bars or the table below, so nothing rests on colour alone.
 */
import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { HgabGeo } from '../lib/hgab';
import { makeProjection, polygonsToPath, type Box } from '../lib/hgab-map';
import { NO_DATA, SEQUENTIAL } from '../lib/indicators-view';
import { peopleIn, type Census, type MpbPopBudget, type MpbPopulationFile, type PopLevel, type Tally } from '../lib/mpb-population';

type Measure = 'php' | 'count';
interface Shape { psgc: number; d: string; box: Box; region: string }
interface Tip { x: number; y: number; title: string; lines: string[] }
interface Klass { color: string; lo: number; hi: number }

const peso = (v: number) => `₱${Math.round(v).toLocaleString('en-PH')}`;
const money = (v: number) => (v >= 1e9 ? `₱${(v / 1e9).toFixed(1)}B` : `₱${(v / 1e6).toFixed(1)}M`);
const n = (v: number) => Math.round(v).toLocaleString('en-PH');

function quantile(sorted: number[], q: number) {
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
function classesOf(values: number[]): Klass[] {
  const vs = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!vs.length) return [];
  const edges = [vs[0], ...[0.2, 0.4, 0.6, 0.8].map((q) => quantile(vs, q)), vs[vs.length - 1]];
  const out: Klass[] = [];
  for (let i = 0; i < 5; i++) if (i === 0 || edges[i + 1] > edges[i]) out.push({ color: SEQUENTIAL[i], lo: edges[i], hi: edges[i + 1] });
  return out;
}
const colorFor = (ks: Klass[], v: number | null) => (v == null || v <= 0 ? NO_DATA : (ks.find((k, i) => v <= k.hi || i === ks.length - 1)?.color ?? NO_DATA));

export default function MpbPopulationMap({ geo, f, budget, level, measure, onPickTown }: {
  geo: HgabGeo; f: MpbPopulationFile; budget: MpbPopBudget; level: PopLevel; measure: Measure;
  onPickTown?: (name: string) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  // Keep the tip inside the map: right of the pointer, else left of it, else centred above it (phones).
  useLayoutEffect(() => {
    const el = tipRef.current, fr = frame.current;
    if (!tip || !el || !fr) return;
    const W = fr.clientWidth, w = el.offsetWidth;
    let left = tip.x + 12, transform = 'translateY(-50%)';
    if (left + w > W) left = tip.x - 12 - w;
    if (left < 0) { left = Math.max(0, Math.min(W - w, tip.x - w / 2)); transform = 'translateY(calc(-100% - 14px))'; }
    el.style.left = `${left}px`;
    el.style.transform = transform;
  }, [tip]);
  const proj = useMemo(() => makeProjection(geo.bbox), [geo]);
  const shapes: Shape[] = useMemo(() => geo.provinces.map((p) => ({ psgc: p.psgc, region: p.region, ...polygonsToPath(p.polygons, proj) })), [geo, proj]);
  const areaOfPsgc = useMemo(() => { const m = new Map<number, string>(); for (const a of f.areas) for (const p of a.psgc) m.set(p, a.id); return m; }, [f]);
  const regionKey = (label: string) => label.replace(/^Region /, '');
  // Several budget years: per year, against the average population over them.
  const yrs = budget.years.length, aYear = yrs > 1 ? ' a year' : '';
  const rate = (t: Tally | undefined, pop: number) => (!t || !pop ? 0 : measure === 'php' ? t[1] / yrs / pop : (1e5 * t[0]) / yrs / pop);
  const say = (t: Tally | undefined, pop: number) => (!t || !t[0] ? 'No MPB projects'
    : measure === 'php' ? `${peso(t[1] / yrs / pop)} per person${aYear}` : `1 project for every ${n((pop * yrs) / t[0])} people${aYear}`);
  const people = (u: { census: Census }) => peopleIn(u.census, budget.years);
  const total = (t: Tally | undefined) => `${n(t?.[0] ?? 0)} MPB projects · ${money(t?.[1] ?? 0)}${yrs > 1 ? ` in ${yrs} years` : ''}`;
  const folk = (pop: number) => `${n(pop)} people${yrs > 1 ? ' on average' : ''}`;

  const by = f.by[budget.key];
  const regionPop = new Map(f.regions.map((r) => [r.key, people(r)]));
  const areaById = new Map(f.areas.map((a) => [a.id, { ...a, population: people(a) }]));
  const townPop = new Map(f.towns.map((t) => [t.code, people(t)]));
  const values = level === 'region' ? f.regions.map((r) => rate(by.region[r.key], regionPop.get(r.key)!))
    : level === 'area' ? [...areaById.values()].map((a) => rate(by.area[a.id], a.population))
    : f.towns.map((t) => rate(by.town[t.code], townPop.get(t.code)!));
  const ks = classesOf(values);

  // Province fill and its tip.
  const fillOf = (s: Shape) => {
    if (level === 'town') return NO_DATA;
    const a = areaById.get(areaOfPsgc.get(s.psgc) ?? '');
    if (!a) return NO_DATA;
    if (level === 'region') { const k = regionKey(a.region); return colorFor(ks, rate(by.region[k], regionPop.get(k) ?? 0)); }
    return colorFor(ks, rate(by.area[a.id], a.population));
  };
  const tipOf = (s: Shape): Omit<Tip, 'x' | 'y'> | null => {
    const a = areaById.get(areaOfPsgc.get(s.psgc) ?? '');
    if (!a) return null;
    if (level === 'region') {
      const k = regionKey(a.region), r = f.regions.find((x) => x.key === k);
      if (!r) return null;
      const t = by.region[k], pop = regionPop.get(k)!;
      return { title: `${r.label} ${r.plain}`, lines: [say(t, pop), `${total(t)} · ${folk(pop)}`] };
    }
    const t = by.area[a.id];
    return { title: a.name, lines: [say(t, a.population), `${total(t)} · ${folk(a.population)}`] };
  };

  // Town circles: area ∝ budget (or projects); the largest is about 16 map units across.
  const towns = level === 'town'
    ? f.towns.filter((t) => t.lng != null && by.town[t.code]?.[0])
      .map((t) => ({ t, tally: by.town[t.code]!, xy: proj.project(t.lng!, t.lat!) }))
      .sort((a, b) => b.tally[measure === 'php' ? 1 : 0] - a.tally[measure === 'php' ? 1 : 0])
    : [];
  const sizeMax = towns.length ? towns[0].tally[measure === 'php' ? 1 : 0] : 1;
  const radius = (tally: Tally) => Math.max(0.9, 8 * Math.sqrt(tally[measure === 'php' ? 1 : 0] / sizeMax));

  const move = (e: ReactPointerEvent, t: Omit<Tip, 'x' | 'y'> | null) => {
    if (!t || !frame.current) return;
    const r = frame.current.getBoundingClientRect();
    setTip({ ...t, x: e.clientX - r.left, y: e.clientY - r.top });
  };

  // Metro Manila inset, top right over the sea.
  const ncr = shapes.filter((s) => s.region === 'NCR');
  const nb = ncr.reduce((b, s) => ({ x0: Math.min(b.x0, s.box.x), y0: Math.min(b.y0, s.box.y), x1: Math.max(b.x1, s.box.x + s.box.w), y1: Math.max(b.y1, s.box.y + s.box.h) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const inset = { x: proj.width * 0.7, y: proj.height * 0.03, w: proj.width * 0.22 };
  const sc = inset.w / Math.max(1e-6, nb.x1 - nb.x0);
  const insetH = (nb.y1 - nb.y0) * sc;
  const inNcr = (xy: [number, number]) => xy[0] >= nb.x0 && xy[0] <= nb.x1 && xy[1] >= nb.y0 && xy[1] <= nb.y1;

  const layer = (list: Shape[], k: number, townsToo: boolean) => (
    <>
      {list.map((s) => (
        <path key={s.psgc} d={s.d} fill={fillOf(s)} className="ind-map-shape" strokeWidth={0.5 / k} fillRule="evenodd"
          onPointerMove={level === 'town' ? undefined : (e) => move(e, tipOf(s))}
          onPointerDown={level === 'town' ? undefined : (e) => move(e, tipOf(s))}
          onPointerLeave={(e) => { if (e.pointerType !== 'touch') setTip(null); }} />
      ))}
      {townsToo && towns.filter((c) => k === 1 || inNcr(c.xy)).map((c) => (
        <circle key={c.t.code} cx={c.xy[0]} cy={c.xy[1]} r={radius(c.tally) / (k === 1 ? 1 : Math.sqrt(k))}
          fill={colorFor(ks, rate(c.tally, townPop.get(c.t.code)!))} className="mpbp-bubble" strokeWidth={0.4 / k}
          onPointerMove={(e) => move(e, { title: c.t.name, lines: [say(c.tally, townPop.get(c.t.code)!), `${total(c.tally)} · ${folk(townPop.get(c.t.code)!)}`] })}
          onPointerLeave={() => setTip(null)}
          onClick={() => onPickTown?.(c.t.name)} />
      ))}
    </>
  );

  const label = (k: Klass) => (measure === 'php'
    ? `${peso(k.lo)} to ${peso(k.hi)} per person${aYear}`
    : `1 project for every ${n(1e5 / k.hi)} to ${n(1e5 / k.lo)} people${aYear}`);

  return (
    <figure className="ind-map mpbp-map">
      <div className="ind-map-frame" ref={frame}>
        <svg viewBox={`0 0 ${proj.width} ${proj.height}`} role="img"
          aria-label={`Map of the Philippines: multi-purpose buildings ${measure === 'php' ? 'budget per person' : 'projects for the people'} by ${level === 'town' ? 'city and municipality' : level === 'area' ? 'province' : 'region'}. The figures are listed below the map.`}>
          <g>{layer(shapes, 1, true)}</g>
          {ncr.length > 0 && (
            <g className="ind-map-inset">
              <rect x={inset.x - 6} y={inset.y - 6} width={inset.w + 12} height={insetH + 26} rx={4} />
              <g transform={`translate(${inset.x} ${inset.y}) scale(${sc}) translate(${-nb.x0} ${-nb.y0})`}>{layer(ncr, sc, true)}</g>
              <text x={inset.x} y={inset.y + insetH + 15}>Metro Manila</text>
            </g>
          )}
        </svg>
        {tip && (
          <div className="ind-map-tip mpbp-tip" ref={tipRef} style={{ left: tip.x, top: tip.y }} role="status">
            <strong>{tip.title}</strong>
            <span className="ind-map-tip-v">{tip.lines[0]}</span>
            {tip.lines.slice(1).map((l) => <span key={l} className="ind-map-tip-r">{l}</span>)}
          </div>
        )}
      </div>
      <figcaption className="ind-map-legend">
        <ul>
          {ks.map((k) => <li key={k.color}><span className="ind-map-sw" style={{ background: k.color }} aria-hidden="true" /><span>{label(k)}</span></li>)}
          <li><span className="ind-map-sw is-none" style={{ background: NO_DATA }} aria-hidden="true" /><span>No MPB projects</span></li>
        </ul>
        <p className="ind-map-note">
          {level === 'town'
            ? <>Each circle is a city or municipality: its size is the {measure === 'php' ? 'MPB budget' : 'number of MPB projects'}, its shade {measure === 'php' ? `the budget per person${aYear}` : `how many projects there are for its people${aYear}`}. Hover over a circle for its figures; click or tap it to find it in the table.</>
            : <>Darker means {measure === 'php' ? 'more budget per person' : 'more MPB projects for the people'}; each shade holds about a fifth of the {level === 'region' ? 'regions' : 'provinces'}. Hover over or tap a place for its figures.</>}
        </p>
      </figcaption>
    </figure>
  );
}
