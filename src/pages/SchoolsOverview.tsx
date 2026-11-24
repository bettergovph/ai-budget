/**
 * `/schools/overview` — the schools data read against the budget and PSA's indicators: the 2023 classroom shortage,
 * DepEd's school-building line (GAA 2020-2026, the 2027 NEP and House bill), the 2026 School Building Program list,
 * DPWH's school contracts 2016-2026, and the shortage beside poverty and the share of children in PSA's 87 areas.
 * Data: GET /api/schools/analysis (src/worker/schools-api.ts) and indicators/indicators.json (the Indicators section).
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Columns, Scatter, Stacked } from '../components/SchoolsCharts';
import { PreviewNotice, SchoolsChrome, Stat, Status } from '../components/SchoolsBits';
import { php } from '../lib/format';
import { INDICATORS_ROOT, type IndicatorsFile } from '../lib/indicators';
import { loadIndicators } from '../lib/indicators-view';
import {
  BEFF_2027, DPWH_KINDS, SCHOOLS_API, SCHOOLS_API_VERSION, SCHOOLS_LIST, SCHOOLS_SHORTAGE, areaOfProvince, num, pct, regionName, rooms,
  type AnalysisFile, type AnalysisProvince,
} from '../lib/schools';
import { useSchoolsApi } from '../lib/use-schools-api';

type Sums = Omit<AnalysisProvince, 'province' | 'region_key'>;
const KEYS: (keyof Sums)[] = [
  'schools', 'public_schools', 'with_shortage_data', 'schools_short', 'shortage', 'learners_with_shortage', 'learners', 'classrooms',
  'makeshift_tls', 'sbp_funded', 'sbp_bidding', 'sbp_budget_php', 'covered', 'listed_not_short', 'dpwh_contracts', 'dpwh_budget_php',
  'dpwh_buildings_php', 'dpwh_mpb_php',
];
function sum(rows: AnalysisProvince[]): Sums {
  const out = Object.fromEntries(KEYS.map((k) => [k, 0])) as Sums;
  for (const r of rows) for (const k of KEYS) out[k] += r[k] ?? 0;
  return out;
}
const perThousand = (s: Sums) => (s.learners_with_shortage > 0 ? (s.shortage / s.learners_with_shortage) * 1000 : null);
const share = (a: number, b: number) => (b > 0 ? a / b : null);

/** Spearman's rank correlation (ties share the mean rank). */
function spearman(pairs: [number, number][]): number | null {
  if (pairs.length < 5) return null;
  const rank = (vals: number[]) => {
    const idx = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const r = new Array<number>(vals.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(pairs.map((p) => p[0])), ry = rank(pairs.map((p) => p[1]));
  const n = pairs.length, mx = (n + 1) / 2;
  let num_ = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num_ += (rx[i] - mx) * (ry[i] - mx); dx += (rx[i] - mx) ** 2; dy += (ry[i] - mx) ** 2; }
  return num_ / Math.sqrt(dx * dy);
}
function strength(r: number | null) {
  if (r == null) return 'not enough areas to say';
  const a = Math.abs(r);
  const how = a < 0.2 ? 'little or no' : a < 0.4 ? 'a weak' : a < 0.6 ? 'a moderate' : 'a strong';
  return a < 0.2 ? `${how} link (ρ = ${r.toFixed(2)})` : `${how} ${r > 0 ? 'positive' : 'negative'} link (ρ = ${r.toFixed(2)})`;
}
const one = (v: number | null, d = 1) => (v == null ? '—' : v.toFixed(d));
const pctOf = (v: number | null) => (v == null ? '—' : v > 0 && v < 0.005 ? 'under 1%' : `${Math.round(v * 100)}%`);
const billions = (v: number) => (v === 0 ? '₱0' : `₱${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B`);

interface AreaRow {
  id: string; name: string; region: string; sums: Sums; per1000: number | null; poverty: number | null; under15: number | null;
  coverage: number | null; dpwhPerLearner: number | null;
}
type AreaSort = 'per1000' | 'shortage' | 'poverty' | 'coverage' | 'dpwhPerLearner';

export default function SchoolsOverview() {
  const api = useSchoolsApi<AnalysisFile>(`${SCHOOLS_API}/analysis?v=${SCHOOLS_API_VERSION}`);
  const [ind, setInd] = useState<IndicatorsFile | null>(null);
  const [indError, setIndError] = useState<string | null>(null);
  const [sort, setSort] = useState<AreaSort>('per1000');
  useEffect(() => { loadIndicators().then(setInd, (e: Error) => setIndError(e.message)); }, []);

  const d = api.data;
  const all = useMemo(() => (d ? sum(d.provinces) : null), [d]);
  const regions = useMemo(() => {
    if (!d) return [];
    const by = new Map<string, AnalysisProvince[]>();
    for (const p of d.provinces) if (p.region_key) by.set(p.region_key, [...(by.get(p.region_key) ?? []), p]);
    return [...by.entries()].map(([key, rows]) => ({ key, s: sum(rows) })).sort((a, b) => b.s.shortage - a.s.shortage);
  }, [d]);
  const areas = useMemo((): AreaRow[] => {
    if (!d || !ind) return [];
    const by = new Map<string, AnalysisProvince[]>();
    for (const p of d.provinces) { const a = areaOfProvince(p.province); if (a) by.set(a, [...(by.get(a) ?? []), p]); }
    const val = (id: string, area: string) => {
      const v = ind.indicators.find((i) => i.id === id)?.values[area];
      return typeof v === 'number' ? v : null;
    };
    return ind.areas.filter((a) => by.has(a.id)).map((a) => {
      const s = sum(by.get(a.id) ?? []);
      return {
        id: a.id, name: a.name, region: a.region, sums: s, per1000: perThousand(s), poverty: val('poverty', a.id), under15: val('under-15', a.id),
        coverage: share(s.covered, s.shortage), dpwhPerLearner: s.learners > 0 ? s.dpwh_budget_php / s.learners : null,
      };
    });
  }, [d, ind]);

  const costPerRoom = useMemo(() => {
    if (!d) return null;
    const b = d.sbp_modality.reduce((a, m) => a + m.budget_php, 0), c = d.sbp_modality.reduce((a, m) => a + m.classrooms_with_budget, 0);
    return c > 0 ? b / c : null;
  }, [d]);
  const beff2026 = d?.beff_gaa.find((b) => b.year === 2026)?.amount_php ?? null;
  const dpwhKinds = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of d?.dpwh_years ?? []) m.set(r.kind, (m.get(r.kind) ?? 0) + r.budget_php);
    return m;
  }, [d]);
  const dpwhTotal = [...dpwhKinds.values()].reduce((a, b) => a + b, 0);
  const fv = (fund: 'beff' | 'dpwh', kind?: string) =>
    (d?.dpwh_funds ?? []).filter((r) => r.fund === fund && (!kind || r.kind === kind)).reduce((a, r) => a + r.budget_php, 0);
  const years = useMemo(() => [...new Set((d?.dpwh_years ?? []).map((r) => r.infra_year))].sort(), [d]);
  const yv = (y: string | number, k: string) => d?.dpwh_years.find((r) => r.infra_year === y && r.kind === k)?.budget_php ?? 0;

  const withPov = areas.filter((a) => a.poverty != null);
  const rhoShort = spearman(withPov.filter((a) => a.per1000 != null).map((a) => [a.poverty as number, a.per1000 as number]));
  const rhoCover = spearman(withPov.filter((a) => a.coverage != null).map((a) => [a.poverty as number, a.coverage as number]));
  const rhoDpwh = spearman(withPov.filter((a) => a.dpwhPerLearner != null).map((a) => [a.poverty as number, a.dpwhPerLearner as number]));
  const top = (key: 'per1000' | 'coverage', n = 3) => [...areas].filter((a) => a[key] != null).sort((a, b) => (b[key] as number) - (a[key] as number)).slice(0, n).map((a) => a.id);
  const sortedAreas = [...areas].sort((a, b) => {
    const v = (r: AreaRow) => (sort === 'shortage' ? r.sums.shortage : r[sort]) ?? -Infinity;
    return sort === 'coverage' ? v(a) - v(b) : v(b) - v(a);
  });

  return (
    <SchoolsChrome>
      <div className="page-headline">
        <p className="page-eyebrow">Basic education · overview</p>
        <h1 className="page-title">Classrooms: the shortage, the budget and where it goes</h1>
        <p className="page-dek">
          DepEd’s 2023 count of classrooms short, read against its school-building budget from 2020 to the 2027 proposal,
          the classrooms the 2026 School Building Program lists, what DPWH built at schools from 2016 to 2026, and PSA’s
          figures on poverty and children in each province.
        </p>
      </div>
      <PreviewNotice />

      <Status error={api.error} loading={api.loading && !d}>
        {d && all && (
          <>
            <section className="sch-findings">
              <h2 className="sch-h2">What the data says</h2>
              <ol>
                <li>DepEd counted <strong>{rooms(all.shortage)} classrooms short</strong> in 2023, at {num(all.schools_short)} of the {num(all.with_shortage_data)} schools it measured: {one(perThousand(all))} classrooms for every 1,000 learners.</li>
                {costPerRoom != null && beff2026 != null && (
                  <li>At the 2026 list’s own average of <strong>{php(costPerRoom)} a classroom</strong>, building them all would cost about <strong>{billions(all.shortage * costPerRoom)}</strong>: {(all.shortage * costPerRoom / beff2026).toFixed(1)} times the {billions(beff2026)} in DepEd’s whole school-building line for 2026, and {(all.shortage * costPerRoom / BEFF_2027.nep).toFixed(1)} times the {billions(BEFF_2027.nep)} proposed for 2027.</li>
                )}
                {beff2026 != null && (
                  <li>That line <strong>falls by {Math.round((1 - BEFF_2027.nep / beff2026) * 100)}%</strong> in the 2027 proposal, from {billions(beff2026)} to {billions(BEFF_2027.nep)}, and the House bill cuts it to {billions(BEFF_2027.house)}.</li>
                )}
                <li>The 2026 list would fill <strong>{pctOf(share(all.covered, all.shortage))} of the shortage</strong>, school by school. {rooms(all.listed_not_short)} of its classrooms are at schools DepEd counted as not short, and {rooms(all.sbp_bidding)} are “for bidding”, with no amount yet.</li>
                <li>DPWH contracts that name a school added up to <strong>{billions(dpwhTotal)}</strong> from 2016 to 2026. {billions(fv('beff'))} of it was DepEd’s own school-building budget carried out by DPWH. Of the {billions(fv('dpwh'))} from DPWH’s own budget, <strong>{pctOf(share(fv('dpwh', 'mpb'), fv('dpwh')))} went to multi-purpose buildings and covered courts</strong>, against {pctOf(share(fv('beff', 'mpb'), fv('beff')))} of DepEd’s.</li>
                {ind && (
                  <li>Across PSA’s {areas.length} areas, poverty and the shortage per learner show {strength(rhoShort)}; poverty and the share of the shortage the 2026 list covers show {strength(rhoCover)}.</li>
                )}
              </ol>
            </section>

            <h2 className="sch-h2">The need, 2023</h2>
            <div className="sch-stats">
              <Stat value={rooms(all.shortage)} label="classrooms short" note={`${num(all.schools_short)} schools`} />
              <Stat value={one(perThousand(all))} label="classrooms short per 1,000 learners" note="at schools with shortage data" />
              <Stat value={one(share(all.learners, all.classrooms), 0)} label="learners per instructional classroom" note={`${num(all.learners)} learners, ${num(all.classrooms)} rooms`} />
              <Stat value={num(all.makeshift_tls)} label="makeshift rooms and temporary learning spaces" />
            </div>
            <div className="sch-tablewrap">
              <table className="sch-table">
                <thead><tr><th>Region</th><th className="num">Short</th><th className="num">Per 1,000 learners</th><th className="num">Schools short</th><th className="num">Learners per room</th><th className="num">2026 list covers</th><th className="num">DPWH at schools, 2016–2026</th></tr></thead>
                <tbody>
                  {regions.map(({ key, s }) => (
                    <tr key={key}>
                      <td><Link to={`${SCHOOLS_LIST}?region=${key}&shortage=short`}>{regionName(key)}</Link></td>
                      <td className="num">{rooms(s.shortage)}</td>
                      <td className="num">{one(perThousand(s))}</td>
                      <td className="num">{pct(s.schools_short, s.with_shortage_data)}</td>
                      <td className="num">{one(share(s.learners, s.classrooms), 0)}</td>
                      <td className="num">{pctOf(share(s.covered, s.shortage))}</td>
                      <td className="num">{billions(s.dpwh_budget_php)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h2 className="sch-h2">DepEd’s school-building budget</h2>
            <p className="sch-muted sch-lede">“Basic Education Facilities” in DepEd’s budget, the line that pays for new classrooms, repairs and furniture: the GAA as enacted for 2020 to 2026, then the 2027 proposal (NEP) and the House bill.</p>
            <Columns title="DepEd's Basic Education Facilities budget by year" color="#2a78d6" format={billions}
              data={[
                ...d.beff_gaa.map((b) => ({ key: String(b.year), label: String(b.year), sub: 'GAA', value: b.amount_php })),
                { key: 'nep', label: '2027', sub: 'NEP', value: BEFF_2027.nep, muted: true },
                { key: 'house', label: '2027', sub: 'House bill', value: BEFF_2027.house, muted: true },
              ]} />
            <p className="sch-footnote">GAA amounts from our GAA data (DepEd, activity 310200100006000); 2027 from the NEP (Vol. I p. 413) and HB 10858 on third reading (Vol. IA p. 312). The 2027 columns are lighter: proposals, not yet law.</p>

            <h2 className="sch-h2">The 2026 School Building Program list</h2>
            <div className="sch-tablewrap">
              <table className="sch-table">
                <thead><tr><th>Who builds</th><th className="num">Projects</th><th className="num">Classrooms</th><th className="num">Budget</th><th className="num">Per classroom</th></tr></thead>
                <tbody>
                  {d.sbp_modality.map((m) => (
                    <tr key={m.modality}>
                      <td>{m.modality}</td><td className="num">{num(m.projects)}</td><td className="num">{num(m.classrooms)}</td>
                      <td className="num">{m.budget_php ? php(m.budget_php) : 'For bidding'}</td>
                      <td className="num">{m.classrooms_with_budget ? php(m.budget_php / m.classrooms_with_budget) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="sch-footnote">The list’s figures, not proof of release or construction. Classrooms by “DEPED – LCS” are learning continuity spaces. <Link to={SCHOOLS_SHORTAGE}>Where the list puts them, by division →</Link></p>

            <h2 className="sch-h2">What DPWH built at schools, 2016 to 2026</h2>
            <p className="sch-muted sch-lede">Contracts in DPWH’s list that name a school, by infra year and kind of work, grouped by the contract’s description. {num(Math.round(all.dpwh_contracts))} contracts, {billions(dpwhTotal)}. 2026 is only what DPWH had listed by 3 November 2026, when we downloaded the list.</p>
            <Stacked title="DPWH school contracts by year and kind" xs={years} series={DPWH_KINDS} value={yv} format={billions} />
            <div className="sch-tablewrap">
              <table className="sch-table">
                <thead><tr><th>Year</th>{DPWH_KINDS.map((k) => <th key={k.key} className="num">{k.label}</th>)}<th className="num">All</th></tr></thead>
                <tbody>
                  {years.map((y) => (
                    <tr key={y}><td>{y}</td>{DPWH_KINDS.map((k) => <td key={k.key} className="num">{billions(yv(y, k.key))}</td>)}<td className="num">{billions(DPWH_KINDS.reduce((a, k) => a + yv(y, k.key), 0))}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="sch-h3">Whose budget</h3>
            <div className="sch-tablewrap">
              <table className="sch-table">
                <thead><tr><th>Kind of work</th><th className="num">DepEd’s school-building budget, carried out by DPWH</th><th className="num">DPWH’s own budget</th></tr></thead>
                <tbody>
                  {DPWH_KINDS.map((k) => (
                    <tr key={k.key}><td>{k.label}</td><td className="num">{billions(fv('beff', k.key))} <span className="sch-sub">{pctOf(share(fv('beff', k.key), fv('beff')))}</span></td><td className="num">{billions(fv('dpwh', k.key))} <span className="sch-sub">{pctOf(share(fv('dpwh', k.key), fv('dpwh')))}</span></td></tr>
                  ))}
                  <tr><td><strong>All</strong></td><td className="num"><strong>{billions(fv('beff'))}</strong></td><td className="num"><strong>{billions(fv('dpwh'))}</strong></td></tr>
                </tbody>
              </table>
            </div>
            <p className="sch-footnote">Only contracts linked to a school by its School ID or its name (possible matches left out). Budgets are the contracts’. The kind is read from the description (“repair” first, then multi-purpose and covered courts, then buildings), and whose budget from DPWH’s “source of funds” (“DepEd BEFF” or not). Classrooms DepEd, local governments or PSIP build themselves are not in DPWH’s list.</p>

            <h2 className="sch-h2">The shortage beside poverty</h2>
            <Status error={indError} loading={!ind}>
              {ind && (
                <>
                  <p className="sch-muted sch-lede">One dot per PSA area (provinces with their highly urbanized cities, Metro Manila’s four districts). Poverty incidence is PSA’s for 2023; see the <Link to={INDICATORS_ROOT}>Indicators</Link> section for how each figure is built.</p>
                  <div className="sch-twocharts">
                    <figure>
                      <figcaption>Classrooms short per 1,000 learners</figcaption>
                      <Scatter title="Shortage per 1,000 learners against poverty incidence, by area" color="#2a78d6" labelled={top('per1000')}
                        dots={areas.filter((a) => a.poverty != null && a.per1000 != null).map((a) => ({ key: a.id, label: a.name, x: a.poverty as number, y: a.per1000 as number, note: `${rooms(a.sums.shortage)} classrooms short` }))}
                        xLabel="Poverty incidence, 2023" yLabel="Short per 1,000 learners" fx={(v) => `${v}%`} fy={(v) => one(v, 0)} />
                      <p className="sch-footnote">{strength(rhoShort)[0].toUpperCase() + strength(rhoShort).slice(1)}.</p>
                    </figure>
                    <figure>
                      <figcaption>Share of the shortage the 2026 list covers</figcaption>
                      <Scatter title="Share of the shortage the 2026 list covers against poverty incidence, by area" color="#eb6834" labelled={top('coverage')}
                        dots={areas.filter((a) => a.poverty != null && a.coverage != null).map((a) => ({ key: a.id, label: a.name, x: a.poverty as number, y: (a.coverage as number) * 100, note: `${rooms(a.sums.covered)} of ${rooms(a.sums.shortage)} short` }))}
                        xLabel="Poverty incidence, 2023" yLabel="Covered by the 2026 list" fx={(v) => `${v}%`} fy={(v) => `${Math.round(v)}%`} />
                      <p className="sch-footnote">{strength(rhoCover)[0].toUpperCase() + strength(rhoCover).slice(1)}. DPWH’s school budget per learner, 2016–2026, against poverty: {strength(rhoDpwh)}.</p>
                    </figure>
                  </div>
                  <div className="sch-tablehead">
                    <p className="sch-count">{areas.length} areas</p>
                    <label className="sch-field sch-field-inline"><span>Sort</span>
                      <select value={sort} onChange={(e) => setSort(e.target.value as AreaSort)}>
                        <option value="per1000">Most short per learner</option>
                        <option value="shortage">Most classrooms short</option>
                        <option value="poverty">Highest poverty</option>
                        <option value="coverage">Least covered by the 2026 list</option>
                        <option value="dpwhPerLearner">Most DPWH school budget per learner</option>
                      </select>
                    </label>
                  </div>
                  <div className="sch-tablewrap">
                    <table className="sch-table">
                      <thead><tr><th>Area</th><th className="num">Short</th><th className="num">Per 1,000 learners</th><th className="num">Poverty, 2023</th><th className="num">Under 15, 2024</th><th className="num">2026 list covers</th><th className="num">DPWH per learner, 2016–2026</th></tr></thead>
                      <tbody>
                        {sortedAreas.map((a) => (
                          <tr key={a.id}>
                            <td><Link to={`${INDICATORS_ROOT}/places/${a.id}`}>{a.name}</Link><span className="sch-sub">{a.region}</span></td>
                            <td className="num">{rooms(a.sums.shortage)}</td>
                            <td className="num">{one(a.per1000)}</td>
                            <td className="num">{a.poverty == null ? '—' : `${a.poverty}%`}</td>
                            <td className="num">{a.under15 == null ? '—' : `${a.under15.toFixed(1)}%`}</td>
                            <td className="num">{pctOf(a.coverage)}</td>
                            <td className="num">{a.dpwhPerLearner == null ? '—' : php(a.dpwhPerLearner, { unit: 'full' })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Status>

            <h2 className="sch-h2">Reading these figures</h2>
            <ul className="sch-prose sch-notes">
              <li>The shortage is DepEd’s 2023 count for the {num(all.with_shortage_data)} schools it measured. Schools without a shortage row have no data, not zero. We round DepEd’s fractional counts to whole classrooms.</li>
              <li>The cost of the whole shortage is an estimate: the shortage times the 2026 list’s average cost of a classroom with a budget. Real costs vary with storeys, site and region.</li>
              <li>DepEd’s school-building line is not only classrooms: it also pays for repairs, furniture and other facilities. Much of it is carried out by DPWH, so DPWH’s “DepEd BEFF” contracts and the GAA line are the same budget seen from two sides: don’t add them.</li>
              <li>Cotabato City has no PSA area of its own, so its schools are counted with Maguindanao. A rank correlation (ρ) measures whether areas that rank high on one figure rank high on the other. It does not show cause.</li>
            </ul>
          </>
        )}
      </Status>
    </SchoolsChrome>
  );
}
