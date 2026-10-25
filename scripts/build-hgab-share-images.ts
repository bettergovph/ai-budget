/**
 * Pre-render the FY2027 House bill leaderboard link previews.
 *
 * Renders every board, national, in the 'landscape' format (1200×630) to
 * `data/hgab/2027/share/<board-id>.png`. `npm run upload:hgab` publishes the
 * tree, so they land at `hgab/2027/share/<board-id>.png` on the data host and
 * the pages point og:image there.
 *
 * There is one renderer: this script opens the running dev server in headless
 * Chromium and calls `renderShareCard` from src/lib/hgab-share-render.ts in the
 * page (same fonts, same portraits, same code as the Download button). Start
 * the dev server first (`npm run dev`, port 5130).
 *
 *   npm run build:hgab-share
 *   npm run build:hgab-share -- --base=http://127.0.0.1:5130 --data=data/hgab/2027/leaderboard.json
 *   # Review sheet: every format, national plus some regions, to another folder
 *   npm run build:hgab-share -- --formats=portrait,square,story,landscape --regions=,VII,NCR --out=/tmp/hgab-share-review
 *
 * Output names: `<board>.png` for the default run; `<board>[-<region>]-<format>.png`
 * once --formats or --regions is given. Exits non-zero when a PNG is the wrong
 * size or looks blank.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { BOARDS, SHARE_FORMATS, isShareFormat, type ShareFormat } from "../src/lib/hgab-leaderboard.ts";

interface Args {
  base: string;
  data: string;
  out: string;
  formats: ShareFormat[];
  regions: (string | null)[];
  boards: string[];
  named: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const formatsArg = get("formats");
  const regionsArg = get("regions");
  const formats = (formatsArg ?? "landscape").split(",").map((f) => f.trim()).filter(Boolean);
  for (const f of formats) if (!isShareFormat(f)) throw new Error(`Unknown format "${f}" (portrait, square, story, landscape)`);
  const boards = (get("boards") ?? BOARDS.map((b) => b.id).join(",")).split(",").map((b) => b.trim()).filter(Boolean);
  for (const b of boards) if (!BOARDS.some((d) => d.id === b)) throw new Error(`Unknown board "${b}"`);
  return {
    base: (get("base") ?? "http://127.0.0.1:5130").replace(/\/$/, ""),
    data: resolve(get("data") ?? "data/hgab/2027/leaderboard.json"),
    out: resolve(get("out") ?? "data/hgab/2027/share"),
    formats: formats as ShareFormat[],
    regions: regionsArg == null ? [null] : regionsArg.split(",").map((r) => r.trim() || null),
    boards,
    named: formatsArg != null || regionsArg != null,
  };
}

interface Job { id: string; format: ShareFormat; region: string | null; file: string }

interface RenderResult {
  png: string;
  width: number;
  height: number;
  /** Share of pixels that differ from the most common colour. */
  inked: number;
  colours: number;
  images: number;
  imagesLoaded: number;
  /** The renderer's own check: false when a layout fell back (text cut, rows squeezed). */
  fits: boolean;
}

function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") throw new Error("not a PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function main() {
  const opts = parseArgs();
  if (!existsSync(opts.data)) {
    console.error(`${opts.data} not found — run \`npm run build:hgab-leaderboard\` first.`);
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(opts.data, "utf8")) as unknown;
  mkdirSync(opts.out, { recursive: true });

  const jobs: Job[] = [];
  for (const id of opts.boards) {
    const board = BOARDS.find((b) => b.id === id)!;
    for (const region of opts.regions) {
      if (region && !board.regionFilter) continue;
      for (const format of opts.formats) {
        const file = opts.named
          ? `${id}${region ? `-${region.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : ""}-${format}.png`
          : `${id}.png`;
        jobs.push({ id, format, region, file });
      }
    }
  }

  // Reach the dev server before launching a browser.
  try {
    const r = await fetch(`${opts.base}/src/lib/hgab-share-render.ts`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error(`Cannot load the renderer from ${opts.base} (${(e as Error).message}). Start the dev server (npm run dev) or pass --base=.`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.warn(`  page error: ${e.message}`));
  // The SPA shell carries the site fonts (Google Fonts link in index.html).
  await page.goto(`${opts.base}/hgab/2027/leaderboard`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    async ({ data, render, contract }) => {
      const m = await import(/* @vite-ignore */ render);
      const lb = await import(/* @vite-ignore */ contract);
      (window as unknown as { __hgabShare: unknown }).__hgabShare = { m, lb, data };
    },
    { data, render: "/src/lib/hgab-share-render.ts", contract: "/src/lib/hgab-leaderboard.ts" },
  );

  console.log(`Base:    ${opts.base}`);
  console.log(`Data:    ${opts.data}`);
  console.log(`Out:     ${opts.out}`);
  console.log(`Images:  ${jobs.length}`);
  console.log("─".repeat(72));

  const failures: string[] = [];
  let missingImages = 0;
  for (const job of jobs) {
    const res: RenderResult = await page.evaluate(async ({ id, format, region }) => {
      type Mod = {
        renderShareCard: (c: HTMLCanvasElement, o: object) => Promise<{ fits: boolean } | null>;
        shareCardImageUrls: (d: unknown, b: unknown, f: string, r: string | null) => string[];
        loadShareImages: (u: string[]) => Promise<Map<string, unknown>>;
      };
      const g = (window as unknown as { __hgabShare: { m: Mod; lb: { boardById: (i: string) => unknown }; data: unknown } }).__hgabShare;
      const board = g.lb.boardById(id);
      const canvas = document.createElement("canvas");
      const report = await g.m.renderShareCard(canvas, { data: g.data, board, format, region });
      if (!report) throw new Error("render did not complete");
      const urls = g.m.shareCardImageUrls(g.data, board, format, region);
      const loaded = await g.m.loadShareImages(urls);
      const ctx = canvas.getContext("2d")!;
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const counts = new Map<number, number>();
      for (let i = 0; i < px.length; i += 4 * 7) {
        const key = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const total = px.length / (4 * 7);
      const top = Math.max(...counts.values());
      return {
        png: canvas.toDataURL("image/png"),
        width: canvas.width,
        height: canvas.height,
        inked: 1 - top / total,
        colours: counts.size,
        images: urls.length,
        imagesLoaded: loaded.size,
        fits: report.fits,
      };
    }, job);
    const buf = Buffer.from(res.png.slice(res.png.indexOf(",") + 1), "base64");
    const size = pngSize(buf);
    const want = SHARE_FORMATS[job.format];
    const problems: string[] = [];
    if (size.width !== want.width || size.height !== want.height) problems.push(`size ${size.width}×${size.height}, want ${want.width}×${want.height}`);
    if (res.inked < 0.05 || res.colours < 24) problems.push(`looks blank (inked ${(res.inked * 100).toFixed(1)}%, ${res.colours} colours)`);
    if (!res.fits) problems.push("layout did not fit (text cut or rows squeezed)");
    const miss = res.images - res.imagesLoaded;
    missingImages += miss;
    writeFileSync(resolve(opts.out, job.file), buf);
    const tag = problems.length ? "FAIL" : "ok  ";
    console.log(`  ${tag} ${job.file.padEnd(44)} ${size.width}×${size.height} ${(buf.length / 1024).toFixed(0).padStart(5)} KB  images ${res.imagesLoaded}/${res.images}${problems.length ? `  ${problems.join("; ")}` : ""}`);
    if (problems.length) failures.push(`${job.file}: ${problems.join("; ")}`);
  }
  await browser.close();
  console.log("─".repeat(72));
  if (missingImages) console.warn(`${missingImages} image(s) did not load; those cards show initials instead of portraits.`);
  if (failures.length) {
    console.error(`${failures.length} image(s) failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`Wrote ${jobs.length} PNG(s) to ${opts.out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
