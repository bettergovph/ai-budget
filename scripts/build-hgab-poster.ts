/**
 * "WE ARE NOT IGNORANT" — the campaign poster.
 *
 * The background is the real list: every inserted and adjusted project from
 * data/hgab/2027/changes-list.json (the file behind /hgab/2027/we-are-not-ignorant,
 * which reconciles to the overview's candidate changes), set as one continuous
 * wall of text, largest first. Nothing in the wall is generated: amounts and
 * titles are the published ones. The artwork layer (a red screen-print
 * illustration, made with the Codex imagegen skill) is optional and carries no
 * text; the headline and footer are typeset here so their wording is exact.
 *
 * Renders in headless Chromium (playwright-core) and writes to --out
 * (default data/hgab/2027/campaign/, gitignored):
 *   we-are-not-ignorant-24x36.pdf    print master, vector text, 24 × 36 in
 *   we-are-not-ignorant-24x36.png    preview at 150 dpi (3600 × 5400)
 *   we-are-not-ignorant-1080x1350.png  feed post (4:5)
 *   we-are-not-ignorant-1080x1920.png  story (9:16)
 *   we-are-not-ignorant-1200x630.png   link preview (og:image) for the page
 * The print poster fits all 7,465 projects (the font size is solved so the
 * list exactly fills the page). The social sizes keep the wall readable when
 * zoomed and say how many of the projects they show.
 *
 * Usage: npm run build:hgab-poster -- [--art=art.png] [--art-story=art.png] [--out=dir] [--only=print,post,story,og]
 * Needs network access for Google Fonts (Anton, Inter, JetBrains Mono).
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ChangesListData, ChangesListRow } from "../src/lib/hgab-changes-list.ts";

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`build-hgab-poster: ${msg}`); process.exit(1); }
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const ROOT = resolve(import.meta.dirname, "..");
const DATA = join(ROOT, "data/hgab/2027");
const OUT = resolve(args.out ?? join(DATA, "campaign"));
const ART = args.art ? resolve(args.art) : null;
const ONLY = (args.only as string | undefined)?.split(",");

const list = JSON.parse(readFileSync(join(DATA, "changes-list.json"), "utf8")) as ChangesListData;
ensure(Array.isArray(list.rows) && list.rows.length > 0, "changes-list.json has no rows; run npm run build:hgab-changes-list");
const TOTAL = list.totals.records;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const peso = (n: number | null | undefined) => (n == null ? "none" : `₱${n.toLocaleString("en-US")}`);
const PROGRAM: Record<string, string> = { dpwh: "DPWH", fmr: "Farm-to-market road", hfep: "Health facility", nia: "Irrigation" };

/**
 * One entry of the wall: its running number, the kind (INSERTED in red, or
 * INCREASED / DECREASED), the amount (NEP → House for adjusted rows), the
 * title as published, program and region.
 */
function entry(r: ChangesListRow, i: number): string {
  const amount = r.k === "inserted" ? peso(r.h) : `${peso(r.n)} → ${peso(r.h)}`;
  const where = [PROGRAM[r.p] ?? r.p, r.r].filter(Boolean).join(" · ");
  const kind = `<em class="k ${r.k === "inserted" ? "k-in" : ""}">${r.k.toUpperCase()}</em>`;
  return `<span class="e"><s>${(i + 1).toLocaleString("en-US")}</s> ${kind} <b>${esc(amount)}</b> ${esc(r.t.replace(/\s+/g, " ").trim())} <i>${esc(where)}</i></span>`;
}
const ENTRIES = list.rows.map(entry);

const asOf = (() => {
  const d = new Date(list.built_at);
  return Number.isNaN(d.getTime()) ? "" : `As of ${d.toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric" })}`;
})();

const dataUri = (path: string, type: string) => `data:${type};base64,${readFileSync(path).toString("base64")}`;
const LOGO = dataUri(join(ROOT, "public/brand/bettergov-horizontal-white.png"), "image/png");
const ARTURI = ART ? (ensure(existsSync(ART), `art not found: ${ART}`), dataUri(ART, "image/png")) : null;
/** The story (9:16) may use its own artwork (--art-story), else the main one. */
const ART_STORY = args["art-story"] ? resolve(args["art-story"]) : null;
const ARTURI_STORY = ART_STORY ? (ensure(existsSync(ART_STORY), `art not found: ${ART_STORY}`), dataUri(ART_STORY, "image/png")) : ARTURI;

interface Format {
  key: string;
  file: string;
  w: number;  // CSS px
  h: number;
  /** "all": solve the font so every project fits; a number: fixed wall font size (px), as many projects as fit. */
  wall: "all" | number;
  pdf?: { width: string; height: string };
  scale: number; // PNG device scale
}
const FORMATS: Format[] = [
  { key: "print", file: "we-are-not-ignorant-24x36", w: 2304, h: 3456, wall: "all", pdf: { width: "24in", height: "36in" }, scale: 3600 / 2304 },
  { key: "post", file: "we-are-not-ignorant-1080x1350", w: 1080, h: 1350, wall: 7.2, scale: 1 },
  { key: "story", file: "we-are-not-ignorant-1080x1920", w: 1080, h: 1920, wall: 7.2, scale: 1 },
  // Link preview (og:image) for /hgab/2027/we-are-not-ignorant: landscape, headline left, fist right.
  { key: "og", file: "we-are-not-ignorant-1200x630", w: 1200, h: 630, wall: 5.6, scale: 1 },
];

function html(f: Format): string {
  const u = f.w / 100; // 1 unit = 1% of the poster width
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@500;700&display=block" rel="stylesheet">
<style>
  @page { size: ${f.pdf ? `${f.pdf.width} ${f.pdf.height}` : `${f.w}px ${f.h}px`}; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${f.w}px; height: ${f.h}px; background: #f3eee4; overflow: hidden; }
  .poster { position: relative; width: ${f.w}px; height: ${f.h}px; overflow: hidden; background: #f3eee4; color: #141414; }
  /* The wall: every project, run in, justified, edge to edge above the footer. */
  .wall {
    position: absolute; left: ${1.6 * u}px; right: ${1.6 * u}px; top: ${1.4 * u}px; bottom: var(--foot);
    font-family: Inter, sans-serif; text-align: justify; hyphens: none; overflow: hidden;
    color: rgba(20, 20, 20, 0.62); line-height: 1.22; word-spacing: 0.02em;
  }
  .wall .e b { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #b3121f; letter-spacing: -0.02em; }
  .wall .e i { font-style: normal; color: rgba(20, 20, 20, 0.45); }
  .wall .e s { text-decoration: none; font-family: 'JetBrains Mono', monospace; color: rgba(20, 20, 20, 0.4); }
  .wall .e .k { font-style: normal; font-family: 'JetBrains Mono', monospace; font-weight: 700; letter-spacing: 0.04em; color: rgba(20, 20, 20, 0.7); }
  .wall .e .k-in { color: #fff; background: #c8102e; padding: 0 0.25em; }
  .wall .e:not(:has(.k-in)) b { color: #141414; }
  .wall .e::after { content: " ■ "; color: #b3121f; }
  /* Artwork: red ink printed over the wall (multiply), like a second screen-print pass. */
  .art { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(var(--foot) - ${2 * u}px); width: ${f.h / f.w > 1.6 ? 92 : 78}%; mix-blend-mode: multiply; opacity: 0.94; pointer-events: none; }
  .head { position: absolute; left: ${4 * u}px; right: ${4 * u}px; top: ${f.h / f.w > 1.6 ? 9 * u : 4.5 * u}px; }
  h1 { font-family: Anton, Impact, sans-serif; font-weight: 400; text-transform: uppercase; line-height: 0.86; letter-spacing: 0.005em; color: #111; }
  h1 span { display: block; width: fit-content; font-size: var(--hs); padding: 0 ${0.6 * u}px; background: #f3eee4; box-shadow: 0 0 0 ${0.35 * u}px #f3eee4; }
  h1 span + span { margin-top: ${0.9 * u}px; }
  h1 .red { color: #d62828; }
  .sub { margin-top: ${2.2 * u}px; display: inline-block; max-width: 86%; font-family: Inter, sans-serif; font-weight: 700; font-size: ${3.4 * u}px; line-height: 1.18; color: #111; background: #f3eee4; padding: ${0.5 * u}px ${0.8 * u}px; box-shadow: 0 0 0 ${0.25 * u}px #f3eee4; }
  .foot {
    position: absolute; left: 0; right: 0; bottom: 0; height: var(--foot);
    background: #111; color: #f3eee4; padding: ${1.6 * u}px ${4 * u}px; display: grid; grid-template-columns: auto 1fr; gap: ${0.6 * u}px ${3 * u}px; align-items: center;
    font-family: Inter, sans-serif;
  }
  .foot img { height: ${3.6 * u}px; grid-row: span 2; }
  .foot .url { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${2.15 * u}px; color: #fff; }
  .foot .fine { font-size: ${1.12 * u}px; line-height: 1.35; color: rgba(243, 238, 228, 0.82); }
  .foot .fine strong { color: #fff; font-weight: 600; }
${f.w > f.h ? `  /* Landscape (link preview): headline on the left half, the fist on the right. */
  .head { right: auto; width: 60%; top: ${2.6 * u}px; }
  h1 span + span { margin-top: ${0.5 * u}px; }
  .sub { margin-top: ${1.4 * u}px; max-width: 100%; font-size: ${2.35 * u}px; }
  .art { left: auto; right: ${1 * u}px; transform: none; width: auto; height: calc(100% - var(--foot) + ${3 * u}px); bottom: calc(var(--foot) - ${3 * u}px); }
  .foot { padding: ${1.1 * u}px ${2.6 * u}px; gap: ${0.3 * u}px ${2 * u}px; }
  .foot img { height: ${2.6 * u}px; }
  .foot .url { font-size: ${1.7 * u}px; }
  .foot .fine { font-size: ${0.95 * u}px; }
` : ""}</style></head><body><div class="poster" style="--foot: ${f.w > f.h ? 10 * u : f.h / f.w > 1.6 ? 17 * u : 14.5 * u}px; --hs: ${f.w > f.h ? 8.6 * u : f.h / f.w > 1.6 ? 17.5 * u : 15.5 * u}px">
  <div class="wall" id="wall"></div>
  ${(f.key === "story" ? ARTURI_STORY : ARTURI) ? `<img class="art" src="${f.key === "story" ? ARTURI_STORY : ARTURI}" alt="">` : ""}
  <div class="head">
    <h1><span>We are</span><span class="red">not</span><span>ignorant</span></h1>
    <p class="sub">${TOTAL.toLocaleString("en-US")} inserted and adjusted projects in the 2027 House budget bill. We read every single one.</p>
  </div>
  <div class="foot">
    <img src="${LOGO}" alt="BetterGov.PH">
    <div class="url">budget.bettergov.ph/hgab/2027/we-are-not-ignorant</div>
    <div class="fine" id="fine"></div>
  </div>
</div></body></html>`;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const f of FORMATS) {
      if (ONLY && !ONLY.includes(f.key)) continue;
      const page = await browser.newPage({ viewport: { width: f.w, height: f.h }, deviceScaleFactor: f.scale });
      await page.setContent(html(f), { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      // tsx keeps function names with an injected __name helper; give the page one too.
      await page.evaluate("globalThis.__name = (f) => f");
      const fit = await page.evaluate(({ entries, mode, total, asOf }) => {
        const wall = document.getElementById("wall")!;
        const fits = () => wall.scrollHeight <= wall.clientHeight + 0.5;
        const set = (n: number, px: number) => { wall.style.fontSize = `${px}px`; wall.innerHTML = entries.slice(0, n).join(""); };
        let shown = entries.length;
        let font: number;
        if (mode === "all") {
          let lo = 1, hi = 40;
          for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; set(entries.length, mid); if (fits()) lo = mid; else hi = mid; }
          font = Math.floor(lo * 100) / 100;
          set(entries.length, font);
        } else {
          font = mode;
          let lo = 0, hi = entries.length;
          while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); set(mid, font); if (fits()) lo = mid; else hi = mid - 1; }
          shown = lo;
          set(shown, font);
        }
        const what = shown === entries.length
          ? `Background: all ${total.toLocaleString("en-US")} inserted and adjusted projects`
          : `Background: the largest ${shown.toLocaleString("en-US")} of the ${total.toLocaleString("en-US")} inserted and adjusted projects (all of them on the poster and at the link)`;
        document.getElementById("fine")!.innerHTML =
          `<strong>${what}</strong>, as published in House Bill 10858 (third reading) and the 2027 NEP: DPWH, farm-to-market roads, health facilities and irrigation; inserted first, then increased, then decreased, largest first. ` +
          `Insertions and adjustments are candidates found by comparing the two documents, not findings of wrongdoing. The documents do not say who asked for any project. ${asOf}.`;
        return { font, shown, fits: fits() };
      }, { entries: ENTRIES, mode: f.wall, total: TOTAL, asOf });
      ensure(fit.fits, `${f.key}: the wall overflows`);
      if (f.wall === "all") ensure(fit.shown === ENTRIES.length, `${f.key}: not every project fits`);
      const png = join(OUT, `${f.file}.png`);
      await page.screenshot({ path: png, fullPage: false });
      if (f.pdf) await page.pdf({ path: join(OUT, `${f.file}.pdf`), width: f.pdf.width, height: f.pdf.height, printBackground: true, pageRanges: "1" });
      console.log(`${f.key.padEnd(5)} ${f.w}×${f.h} css px · wall ${fit.font}px · ${fit.shown.toLocaleString("en-US")} of ${ENTRIES.length.toLocaleString("en-US")} entries → ${png}${f.pdf ? " + .pdf" : ""}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(OUT, "README.txt"), [
    "WE ARE NOT IGNORANT — campaign poster (npm run build:hgab-poster)",
    `Built from data/hgab/2027/changes-list.json (${list.built_at}); ${TOTAL} inserted and adjusted projects, ${ENTRIES.length} entries.`,
    ART ? `Artwork layer: ${ART}${ART_STORY ? `; story: ${ART_STORY}` : ""} (Codex imagegen, no text).` : "No artwork layer.",
    "",
  ].join("\n"));
}

void main();
