/**
 * Publish the generated `data/2027/` tree to R2 under the `2027/` key prefix.
 *
 * `upload-to-r2.ts` walks `data/<NN>/` for the FY2020–2026 GAA tree and knows
 * about its parquet-manifest layout; the FY2027 tree has a different shape
 * (one parquet per department), so it gets its own uploader rather than more
 * branches in that one.
 *
 * By default only what the /2027 microsite actually fetches is uploaded:
 *
 *   2027/manifest.json
 *   2027/national/index.json
 *   2027/<dept>/line_items.parquet
 *
 * That is ~5.5 MB. The aggregation layer does NOT go here — it goes to D1:
 *
 *   npx wrangler d1 execute budget --remote --file=data/2027/d1-import.sql
 *
 * `--all-levels` additionally pushes the deep entity JSONs (`objects.json` and
 * friends, ~500 MB) for anyone consuming the aggregation outside the browser.
 *
 * Credentials come from the same env vars the GAA uploader uses.
 *
 *   npm run upload:nep2027 -- --dry-run
 *   npm run upload:nep2027
 *   npm run upload:nep2027 -- --all-levels --force
 */

import { S3Client, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const Bucket = process.env.R2_BUCKET || "budget";

if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error(
    "Missing R2 credentials. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and\n" +
    "R2_SECRET_ACCESS_KEY (see .env.example) before uploading.",
  );
  process.exit(1);
}

const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
const s3 = new S3Client({
  region: "auto",
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

/**
 * Files the microsite fetches from the data host. Since the aggregation layer
 * moved to D1 (`data/2027/d1-import.sql`, loaded with wrangler), the only
 * thing R2 still has to serve is the line-item parquet the browser scans with
 * DuckDB. `summary.json` and the entity JSONs remain the offline copy of the
 * same numbers and are opt-in via --all-levels.
 */
const SITE_FILES = new Set(["line_items.parquet"]);

interface Args { dryRun: boolean; force: boolean; allLevels: boolean; dept?: string; concurrency: number }

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
  return {
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
    allLevels: args.includes("--all-levels"),
    dept: get("dept"),
    concurrency: Number(get("concurrency") || "6"),
  };
}

function contentTypeFor(path: string): string {
  if (path.endsWith(".parquet")) return "application/vnd.apache.parquet";
  if (path.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}

/** Same-size objects are treated as already uploaded (matches the GAA uploader). */
async function alreadyUploaded(key: string, size: number): Promise<boolean> {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
    return head.ContentLength === size;
  } catch {
    return false;
  }
}

async function uploadOne(
  localPath: string,
  key: string,
  opts: Args,
): Promise<{ skipped: boolean; bytes: number }> {
  const size = statSync(localPath).size;
  if (!opts.force && (await alreadyUploaded(key, size))) return { skipped: true, bytes: size };
  if (opts.dryRun) return { skipped: false, bytes: size };
  await s3.send(new PutObjectCommand({
    Bucket,
    Key: key,
    Body: createReadStream(localPath),
    ContentLength: size,
    ContentType: contentTypeFor(localPath),
    CacheControl: "public, max-age=3600",
  }));
  return { skipped: false, bytes: size };
}

async function main() {
  const opts = parseArgs();
  const root = resolve(process.cwd(), "data", "2027");
  if (!existsSync(root)) {
    console.error(`${root} not found — run \`npm run import:nep2027\` first.`);
    process.exit(1);
  }

  const depts = readdirSync(root)
    .filter((n) => n !== "national" && statSync(resolve(root, n)).isDirectory())
    .filter((n) => !opts.dept || n === opts.dept)
    .sort();

  const items: Array<{ local: string; key: string }> = [];
  const push = (p: string) => items.push({ local: p, key: `2027/${relative(root, p).split(sep).join("/")}` });

  for (const f of ["manifest.json"]) {
    const p = resolve(root, f);
    if (existsSync(p)) push(p);
  }
  const idx = resolve(root, "national", "index.json");
  if (existsSync(idx)) push(idx);

  for (const dept of depts) {
    const dir = resolve(root, dept);
    for (const name of readdirSync(dir)) {
      const p = resolve(dir, name);
      if (!statSync(p).isFile()) continue;
      if (!opts.allLevels && !SITE_FILES.has(name)) continue;
      push(p);
    }
  }

  const totalBytes = items.reduce((a, i) => a + statSync(i.local).size, 0);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Bucket:   ${Bucket}`);
  console.log(`Prefix:   2027/`);
  console.log(`Depts:    ${depts.length}${opts.dept ? ` (${opts.dept})` : ""}`);
  console.log(`Files:    ${items.length} · ${fmtBytes(totalBytes)}${opts.allLevels ? " (all levels)" : " (site files only)"}`);
  console.log(`Mode:     ${opts.dryRun ? "DRY RUN" : opts.force ? "force-overwrite" : "skip identical"}`);
  console.log("─".repeat(72));

  let uploaded = 0;
  let skipped = 0;
  let bytes = 0;
  let next = 0;
  const t0 = performance.now();

  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const { local, key } = items[i];
      try {
        const r = await uploadOne(local, key, opts);
        if (r.skipped) {
          skipped++;
        } else {
          uploaded++;
          bytes += r.bytes;
        }
        process.stdout.write(
          `  [${String(i + 1).padStart(3)}/${items.length}] ` +
          `${r.skipped ? "skip" : opts.dryRun ? "DRY " : "PUT "} ${fmtBytes(r.bytes).padStart(9)}  ${key}\n`,
        );
      } catch (e) {
        process.stdout.write(`  ERROR ${key}: ${(e as Error).message}\n`);
        throw e;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(opts.concurrency, items.length) }, worker));

  console.log("─".repeat(72));
  console.log(
    `${opts.dryRun ? "would upload" : "uploaded"} ${uploaded} · skipped ${skipped} · ` +
    `${fmtBytes(bytes)} in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
