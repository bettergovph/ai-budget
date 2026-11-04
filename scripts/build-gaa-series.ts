/**
 * Build `gaa-explorer/series.json`: the FY2000–2026 national and
 * per-department series, from the GAA Explorer manifest and the national index.
 *
 *   npm run build:gaa-series                       # read the published files, write data/gaa-explorer/series.json
 *   npm run build:gaa-series -- --manifest data/gaa-explorer/manifest.json --index public/data/national/index.json
 *   npm run build:gaa-series -- --upload           # also put it on R2 as gaa-explorer/series.json (R2_* env)
 *
 * The crosswalk lives in src/lib/gaa-series.ts; this script only reads,
 * writes, reports and uploads.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildGaaSeries, type IndexDept } from '../src/lib/gaa-series';
import type { GaaManifest } from '../src/lib/gaa-history';

const PUBLIC = 'https://budget-assets.bettergov.ph';
const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const manifestSrc = opt('manifest', `${PUBLIC}/gaa-explorer/manifest.json`);
const indexSrc = opt('index', `${PUBLIC}/national/index.json`);
const out = resolve(opt('out', 'data/gaa-explorer/series.json'));
const upload = args.includes('--upload');

async function readJson<T>(src: string): Promise<T> {
  if (/^https?:/.test(src)) {
    const r = await fetch(src);
    if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
    return (await r.json()) as T;
  }
  return JSON.parse(await readFile(src, 'utf8')) as T;
}

async function main() {
  const manifest = await readJson<GaaManifest>(manifestSrc);
  const index = await readJson<{ departments: IndexDept[] }>(indexSrc);
  const series = buildGaaSeries(manifest, index.departments);
  const body = JSON.stringify(series, null, 1);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, body);

  const bn = (v: number | null) => (v == null ? '—' : `${(v / 1e9).toFixed(1)}B`);
  console.log(`wrote ${out} (${(body.length / 1024).toFixed(0)} KB, manifest ${manifest.sha256.slice(0, 12)})`);
  console.log('year  status                         new        automatic  total      depts  unmatched');
  for (const p of series.national) {
    const matched = Object.values(series.departments).filter((d) => d.years[p.year] != null).length;
    const un = series.unmatched[p.year] ?? [];
    console.log(`${p.year}  ${p.status.padEnd(30)} ${bn(p.new_php).padEnd(10)} ${bn(p.automatic_php).padEnd(10)} ${bn(p.total_php).padEnd(10)} ${String(matched).padStart(2)}     ${un.length}`);
  }
  const names = new Map<string, number[]>();
  for (const [y, list] of Object.entries(series.unmatched)) for (const g of list) {
    const k = g.name ?? '(blank)';
    names.set(k, [...(names.get(k) ?? []), Number(y)]);
  }
  console.log(`\nunmatched group names (${names.size}):`);
  for (const [k, ys] of [...names.entries()].sort()) console.log(`  ${k}  ${ys[0]}–${ys[ys.length - 1]} (${ys.length})`);

  if (!upload) return;
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const accountId = process.env.R2_ACCOUNT_ID, accessKeyId = process.env.R2_ACCESS_KEY_ID, secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) throw new Error('Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY to upload.');
  const s3 = new S3Client({ region: 'auto', endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } });
  const Key = 'gaa-explorer/series.json';
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET || 'budget', Key, Body: body,
    ContentType: 'application/json; charset=utf-8', CacheControl: 'public, max-age=3600',
  }));
  const sha = createHash('sha256').update(body).digest('hex');
  const r = await fetch(`${PUBLIC}/${Key}`, { cache: 'no-store' });
  const back = createHash('sha256').update(await r.text()).digest('hex');
  console.log(`\nuploaded ${Key}: HTTP ${r.status}, sha256 ${back === sha ? 'matches' : 'DIFFERS (edge cache may still hold the old file)'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
