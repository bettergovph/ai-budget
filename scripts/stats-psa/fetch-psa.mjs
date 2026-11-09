// Download the PSA tables the budget comparison uses from statistics.bettergov.ph (PSA OpenSTAT mirror).
// node scripts/stats-psa/fetch-psa.mjs [out dir, default data/stats-psa/raw]
import { writeFileSync, mkdirSync } from 'node:fs';
const B = 'https://statistics.bettergov.ph/api/v1';
const OUT = process.argv[2] ?? 'data/stats-psa/raw';
mkdirSync(OUT, { recursive: true });
const H = { 'user-agent': 'bettergov-budget-stats/0.1', 'content-type': 'application/json' };
async function get(p, opt = {}) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(B + p, { headers: H, ...opt });
    if (r.status === 503) { await new Promise((s) => setTimeout(s, 1000 * (Number(r.headers.get('retry-after')) || 2))); continue; }
    const j = await r.json();
    if (!r.ok) throw new Error(p + ' ' + JSON.stringify(j));
    return j;
  }
  throw new Error('busy ' + p);
}
// id -> optional fixed selections (others = all codes)
const TABLES = {
  b4a71a27b4e4189c79a8: { name: 'poverty_pop', fix: {} },
  '04026757fab016161553': { name: 'census2024_age', fix: { Sex: ['0'] } },
  a37b2e8af4d42c3d0fbc: { name: 'census2024_pop', fix: {} },
  // Province, HUC and region rows only (PSGC codes ending 00000); municipalities are not needed.
  '05c931eaecec498f9756': { name: 'census2024_density', fix: { Parameter: ['0', '1', '2', '3'] }, pick: { 'Geographic Location': (x) => /00000$/.test(x.code) } },
  '85c06b8cbf6e6cdee6f6': { name: 'gdp_level', fix: { 'Type of Valuation': ['0'] } },
  ac785073d7e6bc1755ae: { name: 'gdp_pc', fix: { 'Type of Valuation': ['0'] } },
  // Indicators section (docs/indicators.md)
  '4879ea33985e005d7fa3': { name: 'census2024_urban', fix: { Parameter: ['0', '1'] }, pick: { 'Geographic Location': (x) => /00000$/.test(x.code) } },
  '77a4ff24e6268c085b93': { name: 'poverty_gap', fix: {} },
  d10aa08e70c9bcded2e1: { name: 'fies2023', fix: { Indicators: ['0', '1', '2'] } },
  fabaea8f7623a6f4c3f3: { name: 'gva_construction', fix: {} },
  '03d9c56cef9097f704c9': { name: 'agri_value', fix: { 'Type of Valuation': ['0'] } },
  c22ae91fc7712bbf0d5f: { name: 'palay_area', fix: { 'Ecosystem/Croptype': ['0', '1', '2'], Period: ['6'] }, pick: { Year: (x) => +x.label >= 2018 && +x.label <= 2025 } },
  '9b78cb1fa95ae59f78d4': { name: 'palay_production', fix: { 'Ecosystem/Croptype': ['0', '1', '2'], Period: ['6'] }, pick: { Year: (x) => +x.label >= 2018 && +x.label <= 2025 } },
  // Province and HUC rows end in 00000; Isabela City is listed at town level (0990101000).
  '74997dc368c9d0077414': { name: 'deaths2024', fix: { Place: ['0'] }, pick: { Geolocation: (x) => /00000$/.test(x.code) || x.code === '0990101000' } },
  '46e61ae5c727a748eff9': { name: 'births2024', fix: {} },
  '3a2606e3166dc9715615': { name: 'nta', fix: {} },
  // Not used: BIR collections (0a58945026dd4156fb1b) are by revenue district, which merges provinces
  // ("Apayao and Kalinga") and books big companies to the Large Taxpayers Service, not a place.
};
for (const [id, t] of Object.entries(TABLES)) {
  const { data: meta } = await get('/datasets/' + id);
  const release = typeof meta.release === 'string' ? meta.release : meta.release.id;
  const selection = {};
  const values = {};
  for (const dim of meta.dimensions) {
    const v = [];
    for (let offset = 0; offset !== null; ) {
      const page = await get(`/datasets/${id}/values?dimension=${encodeURIComponent(dim.code)}&release=${release}&limit=200&offset=${offset}`);
      v.push(...page.data);
      offset = page.pagination?.nextOffset ?? null;
    }
    values[dim.code] = v;
    const pick = t.pick?.[dim.code];
    selection[dim.code] = t.fix[dim.code] ?? v.filter((x) => !pick || pick(x)).map((x) => x.code);
  }
  const n = Object.values(selection).reduce((a, s) => a * s.length, 1);
  if (n > 5000) throw new Error(`${id} selects ${n} points`);
  const res = (await get(`/datasets/${id}/query`, { method: 'POST', body: JSON.stringify({ release, selection }) })).data;
  writeFileSync(`${OUT}/${t.name}.json`, JSON.stringify({ id, title: meta.title, source: meta.source, sourceUpdated: meta.sourceUpdated, retrieved: meta.retrieved, release, values, rows: res.rows }, null, 0));
  console.log(t.name, id, 'points', res.count, '|', meta.title.slice(0, 90));
}
