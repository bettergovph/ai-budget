/** Publish only the reviewed Explorer export, with the manifest uploaded last.
 * Credentials: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY; R2_BUCKET defaults to budget.
 * Dry-run is the default and needs no credentials. Explicit --publish performs writes.
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { GaaManifest } from '../../src/lib/gaa-history';

const root = resolve('data/gaa-explorer');
const manifest = JSON.parse(
  readFileSync(resolve(root, 'manifest.json'), 'utf8'),
) as GaaManifest;
if (manifest.schema_version !== 1 || manifest.years.length !== 27)
  throw new Error('Invalid manifest');
const files = [
  ...manifest.years.map((y) => ({ name: y.file, hash: y.sha256 })),
  { name: manifest.download, hash: manifest.sha256 },
  ...[
    'coverage.json',
    'coverage.md',
    'README.md',
    'unavailable-sources.csv',
    'manifest.json',
  ].map((name) => ({ name, hash: '' })),
];
let bytes = 0;
for (const f of files) {
  if (!/^[\w.-]+$/.test(f.name)) throw new Error('Invalid asset name');
  const path = resolve(root, f.name);
  bytes += statSync(path).size;
  if (f.hash) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    if (hash.digest('hex') !== f.hash)
      throw new Error(`Checksum mismatch: ${f.name}`);
  }
}
console.log(
  `Verified ${files.length} files, ${(bytes / 1024 ** 2).toFixed(1)} MiB, ${manifest.rows.toLocaleString()} records.`,
);
if (!process.argv.includes('--publish')) {
  console.log('Dry run. Pass --publish to upload to the configured R2 bucket.');
} else {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)
    throw new Error('Missing R2 credentials');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  for (const f of files) {
    const path = resolve(root, f.name);
    await client.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET ?? 'budget',
        Key: `gaa-explorer/${f.name}`,
        Body: createReadStream(path),
        ContentLength: statSync(path).size,
        ContentType: f.name.endsWith('.parquet')
          ? 'application/vnd.apache.parquet'
          : f.name.endsWith('.json')
            ? 'application/json'
            : f.name.endsWith('.csv')
              ? 'text/csv; charset=utf-8'
              : 'text/plain; charset=utf-8',
        CacheControl: 'public, max-age=300',
      }),
    );
    console.log(`Uploaded gaa-explorer/${f.name}`);
  }
}
