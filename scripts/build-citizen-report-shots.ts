/**
 * Screenshots for the Citizen Reports page (/citizen-reports): every site in src/lib/citizen-reports.ts, opened at
 * its card's link in a 1280×800 window, rendered at 1.5× and halved to SHOT_WIDTH×SHOT_HEIGHT, and written as WebP
 * to public/screenshots/<key>.webp. The app serves them, so a retake ships with the next deploy; bump SHOTS_TAKEN in
 * the same commit, since the page says when they were taken.
 *
 * Renders in headless Chromium (playwright-core), which also encodes the WebP (canvas.toDataURL), so there is no
 * image dependency. A site that fails to load keeps its old screenshot and the script exits non-zero.
 *
 * Usage: npx tsx scripts/build-citizen-report-shots.ts [--only=key,key] [--out=dir] [--wait=ms]
 * Needs network access.
 */
import { chromium, type Browser } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CITIZEN_REPORTS, SHOT_HEIGHT, SHOT_WIDTH, shotPath } from "../src/lib/citizen-reports";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(args.out ?? join(ROOT, "public"));
/** Settling time after the page goes quiet, for charts and maps that draw late. */
const WAIT = Number(args.wait ?? 4000);
const VIEWPORT = { width: 1280, height: 800 };
const SCALE = 1.5;

const only = args.only ? new Set(String(args.only).split(",")) : null;
const reports = CITIZEN_REPORTS.filter((r) => !only || only.has(r.key));
if (only && reports.length !== only.size) {
  console.error(`build-citizen-report-shots: --only names a key that is not in src/lib/citizen-reports.ts`);
  process.exit(1);
}

/** Halve the 1.5× PNG to the card's size and encode it as WebP, in the browser. */
async function toWebp(browser: Browser, png: Buffer): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    const dataUrl = await page.evaluate(async ({ src, w, h }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL("image/webp", 0.82);
    }, { src: `data:image/png;base64,${png.toString("base64")}`, w: SHOT_WIDTH, h: SHOT_HEIGHT });
    if (!dataUrl.startsWith("data:image/webp;")) throw new Error("Chromium did not encode a WebP");
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, locale: "en-PH" });
let failed = 0;
for (const r of reports) {
  const page = await context.newPage();
  try {
    const res = await page.goto(r.url, { waitUntil: "load", timeout: 60_000 });
    if (!res?.ok()) throw new Error(`HTTP ${res?.status() ?? "no response"}`);
    // Maps and video embeds can keep a connection open, so a page that never goes quiet is taken anyway.
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(WAIT);
    const webp = await toWebp(browser, await page.screenshot({ type: "png" }));
    const file = join(OUT, shotPath(r));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, webp);
    console.log(`${r.key}: ${Math.round(webp.length / 1024)} KB → ${file}`);
  } catch (e) {
    failed++;
    console.error(`${r.key}: ${(e as Error).message.split("\n")[0]}`);
  } finally {
    await page.close();
  }
}
await browser.close();
if (failed) {
  console.error(`build-citizen-report-shots: ${failed} of ${reports.length} failed; their old screenshots are kept`);
  process.exit(1);
}
