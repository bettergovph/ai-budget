/**
 * Publish the generated `data/hgab/2027/` tree to R2 under the `hgab/2027/` prefix.
 *
 * Modelled on upload-nep-2027-to-r2.ts. Everything under the tree is uploaded
 * — manifest.json, overview.json, each dataset's summary.json and
 * projects.parquet, the "We are not ignorant" list (changes-list.json and
 * changes-list.csv), and the source PDFs under pdf/ (about 140 MB) — because
 * the /hgab section fetches all of it from the data host.
 *
 * Objects already in the bucket are skipped when their size matches and, for
 * single-part uploads, their ETag equals the local MD5. Run the verifier
 * first; this script refuses to upload a tree whose verifier run failed
 * unless --force is given, and never uploads when --dry-run is set.
 *
 *   npm run verify:hgab && npm run upload:hgab -- --dry-run
 *   npm run upload:hgab
 *   npm run upload:hgab -- --force --concurrency=4
 */

import { S3Client, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

interface Args { dryRun: boolean; force: boolean; skipVerify: boolean; concurrency: number; root: string }
function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  return {
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
    skipVerify: args.includes("--skip-verify"),
    concurrency: Number(get("concurrency") || "4"),
    root: resolve(get("out") ?? "data/hgab/2027"),
  };
}

const PREFIX = "hgab/2027/";
const opts = parseArgs();

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const Bucket = process.env.R2_BUCKET || "budget";
const haveCreds = Boolean(accountId && accessKeyId && secretAccessKey);

if (!haveCreds && !opts.dryRun) {
  console.error(
    "Missing R2 credentials. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and\n" +
    "R2_SECRET_ACCESS_KEY (see .env.example) before uploading, or pass --dry-run.",
  );
  process.exit(1);
}

const endpoint = `https://${accountId ?? "<account>"}.r2.cloudflarestorage.com`;
const s3 = haveCreds
  ? new S3Client({ region: "auto", endpoint, credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! } })
  : null;

function contentTypeFor(path: string): string {
  if (path.endsWith(".parquet")) return "application/vnd.apache.parquet";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".pdf")) return "application/pdf";
  // share/<board>.png: link previews (npm run build:hgab-share), read by social crawlers.
  if (path.endsWith(".png")) return "image/png";
  // changes-list.csv (npm run build:hgab-changes-list): UTF-8 with BOM, linked as a download.
  if (path.endsWith(".csv")) return "text/csv; charset=utf-8";
  return "application/octet-stream";
}
/** JSON and CSV change with every rebuild; parquet and PDFs are pinned to the manifest commit. */
function cacheControlFor(path: string): string {
  return path.endsWith(".json") || path.endsWith(".csv") ? "public, max-age=300" : "public, max-age=86400";
}
/** A CSV is a download: the page links it cross-origin, where the `download` attribute is ignored. */
function contentDispositionFor(path: string): string | undefined {
  if (!path.endsWith(".csv")) return undefined;
  return `attachment; filename="bettergov-house-bill-2027-${path.split(sep).pop()}"`;
}
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(2)} MB`;
}
function md5(path: string): string {
  return createHash("md5").update(readFileSync(path)).digest("hex");
}
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    // The D1 export (npm run build:hgab-d1) is loaded with wrangler, never served from R2.
    if (/^d1-import(-\d+)?\.sql$/.test(name)) continue;
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/** Skip when the remote object has the same size and (single-part) ETag == local MD5. */
async function alreadyUploaded(key: string, localPath: string, size: number): Promise<boolean> {
  if (!s3) return false;
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
    if (head.ContentLength !== size) return false;
    const etag = head.ETag?.replace(/"/g, "");
    if (!etag || etag.includes("-")) return true; // multipart ETag: fall back to size match
    return etag === md5(localPath);
  } catch {
    return false;
  }
}

async function uploadOne(localPath: string, key: string): Promise<{ skipped: boolean; bytes: number }> {
  const size = statSync(localPath).size;
  if (!opts.force && (await alreadyUploaded(key, localPath, size))) return { skipped: true, bytes: size };
  if (opts.dryRun || !s3) return { skipped: false, bytes: size };
  await s3.send(new PutObjectCommand({
    Bucket, Key: key, Body: createReadStream(localPath), ContentLength: size,
    ContentType: contentTypeFor(localPath), CacheControl: cacheControlFor(localPath),
    ContentDisposition: contentDispositionFor(localPath),
  }));
  return { skipped: false, bytes: size };
}

async function main() {
  if (!existsSync(resolve(opts.root, "overview.json"))) {
    console.error(`${opts.root}/overview.json not found — run \`npm run import:hgab\` first.`);
    process.exit(1);
  }
  if (!opts.skipVerify) {
    const v = spawnSync("npx", ["tsx", "scripts/verify-hgab.ts", `--out=${opts.root}`], { stdio: "inherit" });
    if (v.status !== 0) {
      console.error("\nverify:hgab failed — nothing uploaded. Fix the tree or pass --skip-verify (not recommended).");
      process.exit(1);
    }
    console.log("");
  }
  const manifest = JSON.parse(readFileSync(resolve(opts.root, "manifest.json"), "utf8")) as { source_commit: string; built_at: string };
  const items = walk(opts.root).map((p) => ({ local: p, key: `${PREFIX}${relative(opts.root, p).split(sep).join("/")}` }));
  const totalBytes = items.reduce((a, i) => a + statSync(i.local).size, 0);

  console.log(`Endpoint: ${endpoint}`);
  console.log(`Bucket:   ${Bucket}`);
  console.log(`Prefix:   ${PREFIX}`);
  console.log(`Source:   ${opts.root} (commit ${manifest.source_commit.slice(0, 12)}, built ${manifest.built_at})`);
  console.log(`Files:    ${items.length} · ${fmtBytes(totalBytes)}`);
  console.log(`Mode:     ${opts.dryRun ? `DRY RUN${haveCreds ? "" : " (no credentials; skip checks disabled)"}` : opts.force ? "force-overwrite" : "skip identical (size + ETag/MD5)"}`);
  console.log("─".repeat(72));

  let uploaded = 0, skipped = 0, bytes = 0, next = 0;
  const t0 = performance.now();
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const { local, key } = items[i];
      try {
        const r = await uploadOne(local, key);
        if (r.skipped) skipped++; else { uploaded++; bytes += r.bytes; }
        process.stdout.write(`  [${String(i + 1).padStart(3)}/${items.length}] ${r.skipped ? "skip" : opts.dryRun ? "DRY " : "PUT "} ${fmtBytes(r.bytes).padStart(9)}  ${key}\n`);
      } catch (e) {
        process.stdout.write(`  ERROR ${key}: ${(e as Error).message}\n`);
        throw e;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, items.length) }, worker));
  console.log("─".repeat(72));
  console.log(`${opts.dryRun ? "would upload" : "uploaded"} ${uploaded} · skipped ${skipped} · ${fmtBytes(bytes)} in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
