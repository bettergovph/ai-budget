// Rank correlations and poverty-quintile tables over out/areas.json.
// node scripts/stats-psa/analyze.mjs [out dir, default data/stats-psa/out]
import { readFileSync, writeFileSync } from 'node:fs';
const OUT = process.argv[2] ?? 'data/stats-psa/out';
const { meta, rows } = JSON.parse(readFileSync(`${OUT}/areas.json`, 'utf8'));

function ranks(xs) {
  const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
function pearson(a, b) {
  const ma = mean(a), mb = mean(b);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
  return sab / Math.sqrt(saa * sbb);
}
// residuals of y after least squares on columns X (with intercept)
function residualize(y, X) {
  const n = y.length, k = X.length + 1;
  const A = Array.from({ length: k }, () => new Array(k).fill(0)), v = new Array(k).fill(0);
  const row = (i) => [1, ...X.map((c) => c[i])];
  for (let i = 0; i < n; i++) { const r = row(i); for (let p = 0; p < k; p++) { v[p] += r[p] * y[i]; for (let q = 0; q < k; q++) A[p][q] += r[p] * r[q]; } }
  // Gauss-Jordan
  for (let c = 0; c < k; c++) {
    let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [v[c], v[p]] = [v[p], v[c]];
    for (let r = 0; r < k; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let q = c; q < k; q++) A[r][q] -= f * A[c][q]; v[r] -= f * v[c]; }
  }
  const beta = v.map((x, i) => x / A[i][i]);
  return y.map((yi, i) => yi - row(i).reduce((s, x, p) => s + x * beta[p], 0));
}
let seed = 20261107;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
function permP(a, b, rho, n = 10000) {
  const bb = b.slice(); let hit = 0;
  for (let t = 0; t < n; t++) {
    for (let i = bb.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [bb[i], bb[j]] = [bb[j], bb[i]]; }
    if (Math.abs(pearson(a, bb)) >= Math.abs(rho)) hit++;
  }
  return (hit + 1) / (n + 1);
}
function spearman(sample, x, y, controls = []) {
  const s = sample.filter((r) => [x, y, ...controls].every((c) => Number.isFinite(get(r, c))));
  let rx = ranks(s.map((r) => get(r, x))), ry = ranks(s.map((r) => get(r, y)));
  if (controls.length) {
    const Z = controls.map((c) => ranks(s.map((r) => get(r, c))));
    rx = residualize(rx, Z); ry = residualize(ry, Z);
  }
  const rho = pearson(rx, ry);
  return { x, y, controls, n: s.length, rho: +rho.toFixed(3), p: +permP(rx, ry, rho).toFixed(4) };
}
const get = (r, c) => (c.startsWith('log:') ? Math.log(r[c.slice(4)]) : r[c]);

const withPoverty = rows.filter((r) => r.poverty_incidence_2023 != null);
const dpwhSample = withPoverty.filter((r) => !r.barmm_period);

const BUDGET = ['dpwh_contracts_pp', 'dpwh_gaa_2020_2026_pp', 'dpwh_nep_2027_pp', 'dpwh_house_2027_pp', 'dpwh_house_minus_nep_2027_pp'];
const STATS = ['poverty_incidence_2018', 'poverty_incidence_2023', 'poverty_change_2018_2023', 'gdp_per_person_2023', 'pct_under15', 'pct_60plus', 'dependency_ratio', 'population_2024', 'km2_per_1000_people'];
const CONTROLS = ['km2_per_1000_people', 'population_2024'];

const table = [];
for (const x of BUDGET) for (const y of STATS) {
  const plain = spearman(dpwhSample, x, y);
  const ctl = CONTROLS.includes(y) ? null : spearman(dpwhSample, x, y, CONTROLS);
  table.push({ budget: x, stat: y, n: plain.n, rho: plain.rho, p: plain.p, rho_controlled: ctl?.rho ?? null, p_controlled: ctl?.p ?? null });
}
// how much BARMM changes the headline (DPWH barely builds there)
const withBarmm = spearman(withPoverty, 'dpwh_contracts_pp', 'poverty_incidence_2023');
// stats among themselves (no budget), all areas with poverty
const statPairs = [['poverty_incidence_2023', 'pct_under15'], ['poverty_incidence_2023', 'pct_60plus'], ['poverty_incidence_2023', 'gdp_per_person_2023'], ['poverty_incidence_2023', 'km2_per_1000_people']]
  .map(([a, b]) => spearman(withPoverty, a, b));

// poverty quintiles (by number of areas) among the DPWH sample
function quintiles(sample, by, value) {
  const s = sample.slice().sort((a, b) => a[by] - b[by]);
  const q = [];
  for (let i = 0; i < 5; i++) q.push(s.slice(Math.round((i * s.length) / 5), Math.round(((i + 1) * s.length) / 5)));
  const totalPop = s.reduce((t, r) => t + r.population_2024, 0), totalPoor = s.reduce((t, r) => t + r.poor_people_2023, 0);
  const totalV = s.reduce((t, r) => t + r[value], 0);
  return q.map((g, i) => {
    const pop = g.reduce((t, r) => t + r.population_2024, 0), poor = g.reduce((t, r) => t + r.poor_people_2023, 0), v = g.reduce((t, r) => t + r[value], 0);
    return {
      quintile: i + 1, areas: g.length,
      poverty_range: `${g[0][by]}–${g[g.length - 1][by]}%`,
      population_share: +((100 * pop) / totalPop).toFixed(1), poor_share: +((100 * poor) / totalPoor).toFixed(1),
      budget_share: +((100 * v) / totalV).toFixed(1), php_per_person: Math.round(v / pop), php_per_poor_person: Math.round(v / poor),
      median_php_per_person: Math.round(g.map((r) => r[value] / r.population_2024).sort((a, b) => a - b)[Math.floor(g.length / 2)]),
    };
  });
}
const q = {
  dpwh_contracts_2018_2025: quintiles(dpwhSample, 'poverty_incidence_2023', 'dpwh_contracts_2018_2025'),
  dpwh_gaa_2020_2026: quintiles(dpwhSample, 'poverty_incidence_2023', 'dpwh_gaa_2020_2026'),
  dpwh_house_2027: quintiles(dpwhSample, 'poverty_incidence_2023', 'dpwh_house_2027'),
  dpwh_house_added_2027: quintiles(dpwhSample.map((r) => ({ ...r, added: r.dpwh_house_2027 - r.dpwh_nep_2027 })), 'poverty_incidence_2023', 'added'),
};

const result = { meta: { ...meta, sample: { dpwh: dpwhSample.length, excluded_barmm_period: withPoverty.filter((r) => r.barmm_period).map((r) => r.unit) } }, correlations: table, with_barmm: withBarmm, stat_pairs: statPairs, quintiles: q };
writeFileSync(`${OUT}/correlations.json`, JSON.stringify(result, null, 1));

const f = (x) => (x == null ? '' : x.toFixed(2));
console.log('DPWH sample', dpwhSample.length, 'areas; excluded', result.meta.sample.excluded_barmm_period.join(', '));
console.log('\nSpearman rho (p) | controlled for land per person and population');
for (const r of table) console.log(`${r.budget.padEnd(30)} ${r.stat.padEnd(26)} n=${r.n} rho=${f(r.rho).padStart(6)} p=${r.p.toFixed(4)}  | ctl rho=${f(r.rho_controlled).padStart(6)} p=${r.p_controlled?.toFixed(4) ?? ''}`);
console.log('\nwith BARMM-period areas:', withBarmm);
console.log('stat pairs:', statPairs);
for (const [k, v] of Object.entries(q)) { console.log('\n' + k); console.table(v); }
