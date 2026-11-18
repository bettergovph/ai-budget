/**
 * Screenshots for "How to review a project" (/hgab/2027/review/how-to; steps in src/lib/hgab-review-howto.ts), also
 * the explainer video's frames. Opens the project reviewer on HOWTO_DEMO_PROJECT in a 1440×810 window at 4/3 scale
 * (1920×1080), marks what each step is about (the rest dimmed), and writes public/screenshots/how-to-review/<key>.webp
 * at HOWTO_SHOT_WIDTH×HOWTO_SHOT_HEIGHT. With --png=<dir>, also the full 1920×1080 PNGs, for the video, and
 * marks.json: each step's marked areas as fractions of the frame ({x, y, w, h}), where the video zooms in.
 *
 * How it stays honest and harmless:
 *   - It runs its own dev server, where a Vite alias swaps the Clerk sign-in for a demo member
 *     (scripts/hgab-review-howto/demo-member.tsx). The app is untouched.
 *   - Reviews never leave the browser: the reviews API is answered here. Saving the example review stores it in this
 *     script's memory only. Everyone's review status comes from production (public, names no one).
 *   - Which Senate copies can open is asked of production, so only copies production serves as redacted appear.
 *   - The answers on screen are labelled as an example.
 *
 * Usage: npm run build:hgab-review-howto [-- --only=key,key] [--png=dir] [--wait=ms]
 * Needs network access (budget-assets.bettergov.ph for the data and documents, budget.bettergov.ph for the statuses).
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import {
  HOWTO_DEMO_PROJECT, HOWTO_SHOT_DIR, HOWTO_SHOT_HEIGHT, HOWTO_SHOT_WIDTH, HOWTO_STEPS,
} from "../src/lib/hgab-review-howto";
import { REVIEW_ROOT, buildStatusIndex, reviewStatusFromStage, type ReviewStatusIndex } from "../src/lib/hgab-review";
import type { CaseReview } from "../src/lib/hgab-redflags-team";
import { TERMS_STORAGE_KEY, TERMS_VERSION } from "../src/lib/site-legal";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "public", HOWTO_SHOT_DIR);
const PNG = args.png ? resolve(String(args.png)) : null;
/** Settling time for the document viewer's PDF. */
const WAIT = Number(args.wait ?? 5000);
const PROD = "https://budget.bettergov.ph";
const VIEWPORT = { width: 1440, height: 810 };
const SCALE = 4 / 3;
const only = args.only ? new Set(String(args.only).split(",")) : null;
if (only) for (const k of only) if (!HOWTO_STEPS.some((s) => s.key === k)) throw new Error(`--only: no step "${k}"`);

// --- The dev server, with the demo member --------------------------------------------------------------------------

process.env.VITE_DATA_BASE_URL ??= "https://budget-assets.bettergov.ph";
const server = await createServer({
  root: ROOT,
  configFile: join(ROOT, "vite.config.ts"),
  logLevel: "warn",
  server: { host: "127.0.0.1", port: 5190, strictPort: false },
  resolve: { alias: [{ find: /^\.\.\/components\/HgabReviewMember$/, replacement: join(ROOT, "scripts/hgab-review-howto/demo-member.tsx") }] },
});
await server.listen();
const BASE = (server.resolvedUrls?.local[0] ?? "http://127.0.0.1:5190/").replace(/\/$/, "");

// --- The reviews API, answered here --------------------------------------------------------------------------------

const saved = new Map<string, CaseReview>();
async function statusList(): Promise<{ meta: Record<string, unknown>; data: ReviewStatusIndex }> {
  const prod = await (await fetch(`${PROD}/api/hgab/2027/reviews/status`)).json() as { meta: Record<string, unknown>; data: ReviewStatusIndex };
  const ours = buildStatusIndex([...saved.values()].map((r) => ({ hgab_id: r.project.hgab_id, status: reviewStatusFromStage(r.case_stage), updated_at: r.updated_at, verdict: r.verdict })));
  return { meta: prod.meta, data: { ...prod.data, ...ours } };
}

async function wire(context: BrowserContext, member: "in" | "out") {
  await context.addInitScript(([key, version, who]) => {
    // Not in the document's frame (no storage there).
    try { localStorage.setItem(key, JSON.stringify({ version, acceptedAt: new Date().toISOString() })); } catch { /* ignore */ }
    (window as unknown as { __HOWTO_MEMBER: string }).__HOWTO_MEMBER = who;
  }, [TERMS_STORAGE_KEY, TERMS_VERSION, member] as const);
  await context.route("**/api/hgab/2027/reviews**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.endsWith("/status")) return route.fulfill({ json: await statusList() });
    if (path.endsWith("/mine")) return route.fulfill({ json: { member: { member_id: "demo-member", display_name: "Juan dela Cruz" }, data: [...saved.values()] } });
    if (req.method() === "POST") {
      const r = JSON.parse(req.postData() ?? "{}") as CaseReview;
      const prev = saved.get(r.project.hgab_id);
      const now = new Date().toISOString();
      const stored: CaseReview = { ...r, case_id: prev?.case_id ?? r.case_id, revision: (prev?.revision ?? 0) + 1, submitted_at: now, reviewer: { ...r.reviewer, reviewer_id: "demo-member" } };
      saved.set(r.project.hgab_id, stored);
      return route.fulfill({ json: { data: stored, project: (await statusList()).data[r.project.hgab_id] ?? null, warnings: 0 } });
    }
    return route.fulfill({ status: 404, json: { error: "not_found", message: "Not in the screenshot run." } });
  });
  // Production says which Senate copies are redacted; nothing else opens.
  await context.route("**/api/hgab/2027/senate-copies/status", async (route) => {
    const res = await fetch(`${PROD}/api/hgab/2027/senate-copies/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: route.request().postData() ?? "{}" });
    return route.fulfill({ status: res.status, json: await res.json() });
  });
}

// --- Marking what a step is about ----------------------------------------------------------------------------------

/** Dims the page except the elements each selector matches (all of them), each ringed; an optional note at the bottom left. */
let marked: { x: number; y: number; w: number; h: number }[] = [];
async function mark(page: Page, selectors: string[], note?: string) {
  const rects = [];
  for (const sel of selectors) {
    const boxes = (await Promise.all((await page.locator(sel).all()).map((l) => l.boundingBox()))).filter((b) => b != null);
    if (!boxes.length) throw new Error(`mark: nothing at ${sel}`);
    rects.push(...boxes);
  }
  marked = rects.map((r) => ({ x: r.x / VIEWPORT.width, y: r.y / VIEWPORT.height, w: r.width / VIEWPORT.width, h: r.height / VIEWPORT.height }));
  await page.evaluate(({ rects, note }) => {
    document.getElementById("howto-mark")?.remove();
    const pad = 6;
    const ns = "http://www.w3.org/2000/svg";
    const root = document.createElement("div");
    root.id = "howto-mark";
    root.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    const holes = rects.map((r) => `<rect x="${r.x - pad}" y="${r.y - pad}" width="${r.width + pad * 2}" height="${r.height + pad * 2}" rx="10" fill="black"/>`).join("");
    svg.innerHTML = `<defs><mask id="howto-holes"><rect width="100%" height="100%" fill="white"/>${holes}</mask></defs>`
      + `<rect width="100%" height="100%" fill="rgba(15,23,42,0.45)" mask="url(#howto-holes)"/>`
      + rects.map((r) => `<rect x="${r.x - pad}" y="${r.y - pad}" width="${r.width + pad * 2}" height="${r.height + pad * 2}" rx="10" fill="none" stroke="#f59e0b" stroke-width="4"/>`).join("");
    root.appendChild(svg);
    if (note) {
      const tag = document.createElement("div");
      tag.textContent = note;
      tag.style.cssText = "position:absolute;left:16px;bottom:16px;padding:8px 14px;border-radius:999px;background:#f59e0b;color:#111;font:700 15px/1.2 Inter,system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25)";
      root.appendChild(tag);
    }
    document.body.appendChild(root);
  }, { rects, note });
}
const unmark = async (page: Page) => { marked = []; await page.evaluate(() => document.getElementById("howto-mark")?.remove()); };
const EXAMPLE = "Example answers for this guide, not a real review";

// --- Writing --------------------------------------------------------------------------------------------------------

/** Scale the 1920×1080 PNG to the page's size and encode it as WebP, in the browser. */
async function toWebp(browser: Browser, png: Buffer): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    const dataUrl = await page.evaluate(async ({ src, w, h }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL("image/webp", 0.85);
    }, { src: `data:image/png;base64,${png.toString("base64")}`, w: HOWTO_SHOT_WIDTH, h: HOWTO_SHOT_HEIGHT });
    if (!dataUrl.startsWith("data:image/webp;")) throw new Error("Chromium did not encode a WebP");
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({ channel: "chromium" });
mkdirSync(OUT, { recursive: true });
if (PNG) mkdirSync(PNG, { recursive: true });
const written: string[] = [];
const marks: Record<string, typeof marked> = {};
async function shot(page: Page, key: string) {
  if (only && !only.has(key)) return;
  // Each marked shot is marked just before it; a shot without a mark gets none.
  marks[key] = marked;
  marked = [];
  const png = await page.screenshot({ type: "png" });
  if (PNG) writeFileSync(join(PNG, `${key}.png`), png);
  const webp = await toWebp(browser, png);
  writeFileSync(join(OUT, `${key}.webp`), webp);
  written.push(`${key}.webp ${Math.round(webp.length / 1024)} KB`);
}

const projectUrl = `${BASE}${REVIEW_ROOT}?p=${HOWTO_DEMO_PROJECT}`;
/** The open project with its first document drawn. */
async function openProject(page: Page, url = projectUrl) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.locator(".rv-project-title").waitFor();
  await page.locator(".rv-viewer iframe").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(WAIT);
}
async function newPage(member: "in" | "out") {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, locale: "en-PH", timezoneId: "Asia/Manila" });
  await wire(context, member);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.warn(`page error: ${e.message}`));
  return { context, page };
}

try {
  // Signed out: the sign-in box.
  {
    const { context, page } = await newPage("out");
    await openProject(page);
    await page.locator(".rv-signin").scrollIntoViewIfNeeded();
    await mark(page, [".rv-signin"]);
    await shot(page, "sign-in");
    await context.close();
  }

  const { context, page } = await newPage("in");
  // The whole reviewer, a project open.
  await openProject(page);
  await shot(page, "open");

  // Review progress → House insertions nobody has reviewed; then the Region filter.
  await page.goto(`${BASE}${REVIEW_ROOT}`, { waitUntil: "networkidle" });
  await page.locator(".rv-progress li").first().locator("button").click();
  await page.locator(".rv-strip").waitFor();
  await page.waitForTimeout(800);
  await mark(page, [".rv-progress li:first-child", ".rv-strip > li:not(:first-child)"]);
  await shot(page, "pick");
  await unmark(page);
  await page.locator(".rv-dd-btn", { hasText: "Region" }).click();
  await page.locator(".rv-dd.is-open .rv-dd-panel").waitFor();
  await mark(page, [".rv-dd.is-open .rv-dd-btn", ".rv-dd.is-open .rv-dd-panel"]);
  await shot(page, "filter");
  await page.keyboard.press("Escape");
  await unmark(page);

  // The project, its documents and red flags.
  await openProject(page);
  await mark(page, [".rv-project-top", ".rv-facts", ".rv-checklist"]);
  await shot(page, "project");
  await unmark(page);
  await mark(page, [".rv-viewer"]);
  await shot(page, "documents");
  await unmark(page);
  await page.locator(".rv-flags > summary").click();
  await page.locator(".rv-flags").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(300);
  await mark(page, [".rv-flags"]);
  await shot(page, "flags");
  await unmark(page);
  await page.locator(".rv-flags > summary").click();

  // The questions: the first one answered, with a remark (an example).
  const card = page.locator(".rf-qcard").first();
  await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await card.locator(".rf-seg button.is-satisfactory").click();
  const remark = card.locator(".rf-remark");
  if (!(await remark.evaluate((el) => (el as HTMLDetailsElement).open))) await remark.locator("summary").click();
  await remark.locator("textarea").fill("Example: what you saw, and on which page (POW p. 2).");
  await card.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  await mark(page, [".rf-qcard:first-child"], EXAMPLE);
  await shot(page, "questions");
  await unmark(page);

  // The final status and remarks: picking it saves the review.
  await page.locator(".rf-final").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.locator(".rf-final-remarks textarea").fill("Example: the documents match the project. One question needs a second look.");
  await page.locator(".rf-final-btn.is-satisfactory").click();
  await page.locator(".rf-final-state", { hasText: "Saved" }).waitFor();
  await page.locator(".rf-final").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(500);
  await mark(page, [".rf-final"], EXAMPLE);
  await shot(page, "final");
  await unmark(page);

  // The list shows the project as reviewed; Prev and Next.
  await page.locator(".rv-item.is-on").evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.locator(".rv-project-body").evaluate((el) => el.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await mark(page, [".rv-item.is-on", ".rv-project-nav"], EXAMPLE);
  await shot(page, "next");
  await unmark(page);

  // My reviews.
  const mine = 'details.rv-mine:has(> summary[title="My reviews"])';
  await page.locator(`${mine} > summary`).click();
  await page.locator(`${mine} .rv-mine-menu`).waitFor();
  await mark(page, [`${mine} > summary`, `${mine} .rv-mine-menu`], EXAMPLE);
  await shot(page, "mine");
  await context.close();
} finally {
  await browser.close();
  await server.close();
}
if (PNG) writeFileSync(join(PNG, "marks.json"), `${JSON.stringify(marks, null, 1)}\n`);
console.log(`build-hgab-review-howto: ${written.length} screenshots in ${OUT}\n  ${written.join("\n  ")}`);
if (PNG) console.log(`  PNGs (1920×1080) in ${PNG}`);
