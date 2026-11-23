/**
 * "Multi-purpose buildings or classrooms?": the campaign poster for /gaa/multi-purpose/documents. Jason
 * (2026-11-15): "I want a poster too", then "use our paper themed poster instead of the dark ones" and "Be clear of the
 * 2066. Are they MPBs? Also include the total number of insertions, documents.", "add a disclaimer with available
 * documents … include the total house insertions. Then add more building types in the poster", "Our other data says
 * 6000+ insertions though" and "Use the bar chart style we have similar to Hosting ASEAN".
 *
 * The paper style of the "We are not ignorant" and "Multi-purpose buildings" posters (build-hgab-poster-mpb.ts): the
 * background is the real list, every multi-purpose building insertion whose documents we read, largest first, each with
 * its amount as published and a tag for what its documents say it is (CLASSROOM in red). Over it, on paper: the
 * question, what we read and how many are classrooms, every kind of building in the "Hosting ASEAN" poster's bar chart
 * panel (build-poster-asean-hosting.ts), the starred note on the documents available (all DPWH House insertions, the
 * multi-purpose buildings among them, with and without documents, read), a red call to action, and the dark footer.
 *
 * Every figure comes from `mpb-documents/` (npm run build:mpb-documents), the files the page reads, so the poster cannot
 * disagree with the site. Nothing is generated; there is no artwork layer.
 *
 * Renders in headless Chromium (playwright-core) in the posters' type (Anton, Inter, JetBrains Mono) and writes to --out
 * (default data/hgab/2027/campaign/, gitignored):
 *   mpb-or-classrooms-1080x1350.png   feed post (4:5)
 *   mpb-or-classrooms-1080x1920.png   story (9:16)
 *   mpb-or-classrooms-1200x630.png    link preview (og:image) for the page
 *
 * Usage: npm run build:hgab-poster-mpb-classrooms -- [--out=dir] [--only=post,story,og]   (CHROMIUM_PATH for a local
 * headless shell). Needs network access for Google Fonts.
 */
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  MPB_DOCS_PROJECTS_PATH, MPB_DOCS_ROOT, MPB_DOCS_SUMMARY_PATH, MPB_DOCS_TITLE, decodeMpbDocProjects, type MpbDocCategory,
  type MpbDocsProjectsFile, type MpbDocsSummary,
} from "../src/lib/mpb-documents";

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`build-hgab-poster-mpb-classrooms: ${msg}`); process.exit(1); }
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const ROOT = resolve(import.meta.dirname, "..");
const DATA = join(ROOT, "data");
const OUT = resolve(args.out ?? join(DATA, "hgab/2027/campaign"));
const ONLY = (args.only as string | undefined)?.split(",");
const URL_TEXT = `budget.bettergov.ph${MPB_DOCS_ROOT}`;

// ---------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------

for (const p of [MPB_DOCS_SUMMARY_PATH, MPB_DOCS_PROJECTS_PATH]) ensure(existsSync(join(DATA, p)), `${p} missing (npm run build:mpb-documents)`);
const S = JSON.parse(readFileSync(join(DATA, MPB_DOCS_SUMMARY_PATH), "utf8")) as MpbDocsSummary;
const P = decodeMpbDocProjects(JSON.parse(readFileSync(join(DATA, MPB_DOCS_PROJECTS_PATH), "utf8")) as MpbDocsProjectsFile);
ensure(S.checks.every((c) => c.ok), "summary.json carries a failed check");
ensure(P.length === S.coverage.read.lines, `${P.length} projects, but the summary read ${S.coverage.read.lines}`);
const C = S.coverage;
const CLS = S.classroom.yes;
/** Each kind of building the documents name, as the poster's rows say it (Jason: "add more building types"). */
const PLURAL: Record<MpbDocCategory, [string, string]> = {
  "multi-purpose hall": ["hall", "halls"], "covered court or gym": ["covered court or gym", "covered courts and gyms"],
  "barangay hall or government office": ["barangay hall or office", "barangay halls and offices"],
  "evacuation center": ["evacuation center", "evacuation centers"], "health facility": ["health facility", "health facilities"],
  "senior citizens or day care center": ["senior citizen or day care center", "senior citizen and day care centers"],
  "classroom or school building": ["classroom", "classrooms"], "other school facility": ["other school facility", "other school facilities"],
  "market or commercial": ["market", "markets and commercial buildings"], road: ["road", "roads"], bridge: ["bridge", "bridges"],
  "flood control or drainage": ["drainage work", "drainage works"], "water supply or sanitation": ["water system", "water systems"],
  "other building": ["other building", "other buildings"], other: ["other project", "other projects"], unclear: ["unclear", "unclear"],
};
const ROWS = S.categories.map((c) => {
  const label = PLURAL[c.key][c.lines === 1 ? 0 : 1];
  return { n: c.lines, php: c.php, label: label[0].toUpperCase() + label.slice(1), red: c.key === "classroom or school building" };
});
ensure(ROWS.some((r) => r.red), "no classroom row");
const MAX = Math.max(...ROWS.map((r) => r.n));
const count = (n: number) => n.toLocaleString("en-US");
const billion = (v: number) => `₱${(v / 1e9).toFixed(1)} billion`;
/** The star's note: what documents there are (Jason: "add a disclaimer with available documents … include the total house insertions"). */
const STAR = `*Documents available: the House inserted ${count(C.dpwh.insertions.lines)} DPWH projects; ${count(C.dpwh.with_documents.lines)} come with documents in the Senate’s copies. ${count(C.insertions.lines)} are multi-purpose buildings: ${count(C.with_documents.lines)} with documents, ${count(C.without_documents.lines)} with none. We have read ${count(C.read.lines)} so far.`;
/** A row's amount, as the ASEAN poster's panels print it. */
const short = (v: number) => (v >= 1e9 ? `₱${(v / 1e9).toFixed(2)}B` : `₱${Math.round(v / 1e6)}M`);
const million = (v: number) => (v >= 1e9 ? billion(v) : `₱${(v / 1e6).toFixed(1)} million`);
const AS_OF = `As of ${new Date(S.source.records_written).toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric" })}`;

/** The wall's tag for what a project's documents say it is. */
const TAG: Record<MpbDocCategory, string> = {
  "multi-purpose hall": "HALL", "covered court or gym": "COURT", "barangay hall or government office": "OFFICE",
  "evacuation center": "EVACUATION", "health facility": "HEALTH", "senior citizens or day care center": "DAY CARE",
  "classroom or school building": "CLASSROOM", "other school facility": "SCHOOL FACILITY", "market or commercial": "MARKET",
  road: "ROAD", bridge: "BRIDGE", "flood control or drainage": "DRAINAGE", "water supply or sanitation": "WATER",
  "other building": "OTHER", other: "OTHER", unclear: "UNCLEAR",
};
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const WALL = [...P].sort((a, b) => b.php - a.php || a.title.localeCompare(b.title)).map((p, i) => {
  const red = p.category === "classroom or school building";
  return `<span class="e${red ? " is-cls" : ""}"><s>${count(i + 1)}</s> <em class="k${red ? " k-cls" : ""}">${TAG[p.category]}</em> <b>₱${count(p.php)}</b> ${esc(p.title)}</span>`;
});

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const LOGO = `data:image/png;base64,${readFileSync(join(ROOT, "public/brand/bettergov-horizontal-white.png")).toString("base64")}`;
interface Format { key: string; file: string; w: number; h: number; wall: number }
const FORMATS: Format[] = [
  { key: "post", file: "mpb-or-classrooms-1080x1350", w: 1080, h: 1350, wall: 7.2 },
  { key: "story", file: "mpb-or-classrooms-1080x1920", w: 1080, h: 1920, wall: 7.2 },
  { key: "og", file: "mpb-or-classrooms-1200x630", w: 1200, h: 630, wall: 5.6 },
];

/** Sizes per format, in units of 1% of the poster width. */
function sizes(f: Format) {
  const u = f.w / 100;
  if (f.w > f.h) return { u, foot: 10 * u, kicker: 1.2 * u, a1: 4.4 * u, rs: 1.25 * u, rsMin: 10, sub: 1.4 * u, cta: 1.25 * u, gap: 0.5 * u, top: 1.6 * u, left: 3 * u, width: 94 * u };
  if (f.h / f.w > 1.6) return { u, foot: 21 * u, kicker: 2.6 * u, a1: 9.6 * u, rs: 2.2 * u, rsMin: 16, sub: 3.1 * u, cta: 2.7 * u, gap: 1.6 * u, top: 7 * u, left: 4 * u, width: 92 * u };
  return { u, foot: 17.5 * u, kicker: 2.3 * u, a1: 9.6 * u, rs: 1.7 * u, rsMin: 14, sub: 2.6 * u, cta: 2.3 * u, gap: 1.1 * u, top: 4 * u, left: 4 * u, width: 92 * u };
}

function html(f: Format): string {
  const z = sizes(f);
  const wide = f.w > f.h;
  // The bar chart, in the "Hosting ASEAN" poster's panel (Jason: "Use the bar chart style we have similar to Hosting
  // ASEAN"): every kind of building, its projects and amount, a bar to scale; beside the headline in the link preview.
  const cols = 1;
  const perCol = ROWS.length;
  const rows = ROWS.map((r) => `<div class="row${r.red ? " is-red" : ""}"><i class="bar" style="width:${Math.max(0.8, (100 * r.n) / MAX).toFixed(2)}%"></i>` +
    `<span class="nm">${esc(r.label)}<small>${short(r.php)}</small></span><span class="am">${count(r.n)}</span></div>`).join("");
  const panel = `<div class="panel" id="panel"><p class="tab">What their documents say they are</p><div class="rws">${rows}</div>
      <div class="sum"><span>${count(C.read.lines)} projects read</span><span>${short(C.read.php)}</span></div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@500;700&display=block" rel="stylesheet">
<style>
  @page { size: ${f.w}px ${f.h}px; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${f.w}px; height: ${f.h}px; background: #f3eee4; overflow: hidden; }
  .poster { position: relative; width: ${f.w}px; height: ${f.h}px; overflow: hidden; background: #f3eee4; color: #141414; --paper: #f3eee4; --red: #d62828; }
  /* The wall: the projects read, run in, justified, edge to edge above the footer. */
  .wall {
    position: absolute; left: ${1.6 * z.u}px; right: ${1.6 * z.u}px; top: ${1.4 * z.u}px; bottom: ${z.foot}px;
    font-family: Inter, sans-serif; text-align: justify; hyphens: none; overflow: hidden;
    color: rgba(20, 20, 20, 0.6); line-height: 1.22; word-spacing: 0.02em;
  }
  .wall .e b { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #141414; letter-spacing: -0.02em; }
  .wall .e s { text-decoration: none; font-family: 'JetBrains Mono', monospace; color: rgba(20, 20, 20, 0.4); }
  .wall .e .k { font-style: normal; font-family: 'JetBrains Mono', monospace; font-weight: 700; letter-spacing: 0.04em; color: #fff; background: #6f695f; padding: 0 0.25em; }
  .wall .e .k-cls { background: #c8102e; }
  .wall .e.is-cls b { color: #b3121f; }
  .wall .e::after { content: " ■ "; color: #b3121f; }
  /* The headline, on paper over the wall. */
  .head { position: absolute; left: ${z.left}px; width: ${z.width}px; top: ${z.top}px; }
  .pap { display: inline-block; width: fit-content; background: var(--paper); box-shadow: 0 0 0 ${0.35 * z.u}px var(--paper); }
  .kicker { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${z.kicker}px; letter-spacing: 0.12em; text-transform: uppercase; color: #141414; padding: 0 ${0.3 * z.u}px; }
  .fig { font-family: Anton, Impact, sans-serif; font-weight: 400; text-transform: uppercase; line-height: 0.9; letter-spacing: 0.005em; color: #111; white-space: nowrap; }
  .fig span { display: block; width: fit-content; padding: 0 ${0.5 * z.u}px; background: var(--paper); box-shadow: 0 0 0 ${0.3 * z.u}px var(--paper); }
  .q { margin-top: ${z.gap * 0.9}px; }
  .q span { font-size: ${z.a1}px; }
  .q span + span { margin-top: ${0.3 * z.u}px; color: var(--red); }
  /* The panel (the "Hosting ASEAN" poster's): one size (--rs), shrunk by the build until the headline clears the footer. */
  .panel { position: relative; margin-top: calc(var(--rs) * 1.9); border: ${0.25 * z.u}px solid #141414; background: var(--paper); box-shadow: 0 0 0 ${0.4 * z.u}px var(--paper); padding: calc(var(--rs) * 1.15) calc(var(--rs) * 0.85) calc(var(--rs) * 0.6); --rs: ${z.rs}px; }
  .panel .tab { position: absolute; left: calc(var(--rs) * 0.85); top: 0; transform: translateY(-50%); font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: calc(var(--rs) * 0.8); letter-spacing: 0.14em; text-transform: uppercase; color: #fff; background: #141414; padding: 0.25em 0.6em; white-space: nowrap; }
  .rws { display: grid; grid-template-columns: repeat(${cols}, minmax(0, 1fr)); grid-template-rows: repeat(${perCol}, auto); grid-auto-flow: column; column-gap: calc(var(--rs) * 1.5); }
  .row { position: relative; display: grid; grid-template-columns: 1fr auto; column-gap: calc(var(--rs) * 0.6); align-items: center; padding: calc(var(--rs) * 0.32) 0; border-top: 1px solid rgba(20, 20, 20, 0.16); }
  .row:nth-child(${perCol}n + 1) { border-top: 0; }
  .row .bar { position: absolute; left: 0; top: calc(var(--rs) * 0.2); bottom: calc(var(--rs) * 0.2); background: rgba(214, 40, 40, 0.14); }
  .row.is-red .bar { background: rgba(214, 40, 40, 0.5); }
  .row > span { position: relative; z-index: 1; }
  .row .nm { font-family: Inter, sans-serif; font-weight: 700; font-size: var(--rs); line-height: 1.15; color: #111; white-space: nowrap; overflow: hidden; }
  .row .nm small { display: block; font-weight: 600; font-size: calc(var(--rs) * 0.7); color: rgba(20, 20, 20, 0.66); margin-top: 0.1em; }
  .row .am { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: calc(var(--rs) * 1.05); letter-spacing: -0.02em; color: #111; text-align: right; white-space: nowrap; }
  .row.is-red .nm, .row.is-red .nm small, .row.is-red .am { color: #c8102e; }
  .panel .sum { margin-top: calc(var(--rs) * 0.4); padding-top: calc(var(--rs) * 0.45); border-top: ${0.2 * z.u}px solid #141414; display: flex; justify-content: space-between; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: calc(var(--rs) * 0.78); letter-spacing: 0.08em; text-transform: uppercase; }
  .sub { margin-top: ${z.gap * 0.9}px; font-family: Inter, sans-serif; font-weight: 700; font-size: ${z.sub}px; line-height: 1.22; color: #111; padding: ${0.35 * z.u}px ${0.6 * z.u}px; max-width: 100%; }
  .sub.s2 { display: block; margin-top: ${1.1 * z.gap}px; font-weight: 600; font-size: ${z.sub * 0.8}px; }
  .sub b { color: var(--red); }
  .cta { display: inline-block; margin-top: ${z.gap}px; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${z.cta}px; color: #fff; background: #c8102e; padding: ${0.35 * z.u}px ${0.8 * z.u}px; }
  .foot {
    position: absolute; left: 0; right: 0; bottom: 0; height: ${z.foot}px;
    background: #111; color: #f3eee4; padding: ${1.6 * z.u}px ${4 * z.u}px; display: grid; grid-template-columns: auto 1fr; gap: ${0.6 * z.u}px ${3 * z.u}px; align-items: center;
    font-family: Inter, sans-serif;
  }
  .foot img { height: ${3.6 * z.u}px; grid-row: span 2; }
  .foot .url { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${2.15 * z.u}px; color: #fff; }
  .foot .fine { font-size: ${1.12 * z.u}px; line-height: 1.35; color: rgba(243, 238, 228, 0.82); }
  .foot .fine strong { color: #fff; font-weight: 600; }
${wide ? `  .head { display: grid; grid-template-columns: 1fr ${40 * z.u}px; column-gap: ${2.4 * z.u}px; align-items: start; }
  .head .panel { margin-top: calc(var(--rs) * 0.9); }
  .foot { padding: ${1.1 * z.u}px ${2.6 * z.u}px; gap: ${0.3 * z.u}px ${2 * z.u}px; }
  .foot img { height: ${2.6 * z.u}px; }
  .foot .url { font-size: ${1.7 * z.u}px; }
  .foot .fine { font-size: ${0.95 * z.u}px; }
` : ""}</style></head><body><div class="poster">
  <div class="wall" id="wall"></div>
  <div class="head" id="head">
    ${wide ? "<div>" : ""}<p class="kicker pap">The 2027 House budget bill</p>
    <div class="fig q"><span>Multi-purpose buildings</span><span>or classrooms?</span></div>
    <p class="sub pap">We read the documents of ${count(C.read.lines)}* multi-purpose building projects inserted by the House. <b>${count(CLS.lines)} are classrooms.</b></p>
    ${wide ? "" : panel}
    <p class="sub s2 pap">${esc(STAR)}</p>
    <br><p class="cta">See all ${count(C.read.lines)} and their documents.</p>${wide ? `</div>${panel}` : ""}
  </div>
  <div class="foot">
    <img src="${LOGO}" alt="BetterGov.PH">
    <div class="url">${URL_TEXT}</div>
    <div class="fine" id="fine"></div>
  </div>
</div></body></html>`;
}

async function main(): Promise<void> {
  ensure(MPB_DOCS_TITLE === "Multi-purpose buildings or classrooms?", "the page title changed; check the poster's question");
  const fineFor = (shown: number, wide: boolean) => wide
    ? `<strong>The ${count(C.read.lines)}:</strong> multi-purpose building projects the House inserted into House Bill 10858 (no matching NEP line) whose documents we read. A model read and quoted them; a reading, not a site visit. Allocations, not spending. ${AS_OF}.`
    : `<strong>The ${count(C.read.lines)}: multi-purpose building projects the House inserted, whose documents we read.</strong> The House inserted ${count(C.dpwh.insertions.lines)} DPWH projects with no matching NEP line (${billion(C.dpwh.insertions.php)}), ${count(C.insertions.lines)} of them multi-purpose buildings (${billion(C.insertions.php)}); the House bill lists ${count(C.house.lines)} multi-purpose building projects in all. ` +
      `${count(C.with_documents.lines)} come with documents in the Senate’s copies (${count(C.with_documents.files)} files), ${count(C.without_documents.lines)} with none; we have read ${count(C.read.lines)} (${billion(C.read.php)}), ${count(S.documents_read.total)} documents. ` +
      `The bars: projects of each kind. Background: the largest ${count(shown)} of the ${count(C.read.lines)}, each tagged with what its documents say it is (all at the link). A model read each project’s documents and quoted them; check any project at the link. ` +
      `Classrooms: ${million(CLS.php)}. Amounts as published in House Bill 10858 (third reading); allocations, not spending. Not evidence of wrongdoing; the documents do not say who asked for any project. People’s Budget Coalition × BetterGov.PH. ${AS_OF}.`;

  mkdirSync(OUT, { recursive: true });
  const exe = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(exe ? { executablePath: exe, args: ["--no-sandbox"] } : {});
  try {
    for (const f of FORMATS) {
      if (ONLY && !ONLY.includes(f.key)) continue;
      const page = await browser.newPage({ viewport: { width: f.w, height: f.h }, deviceScaleFactor: 1 });
      await page.setContent(html(f), { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate("globalThis.__name = (f) => f");
      const z = sizes(f);
      const fit = await page.evaluate(({ entries, font }) => {
        const wall = document.getElementById("wall")!;
        const fits = () => wall.scrollHeight <= wall.clientHeight + 0.5;
        const set = (n: number) => { wall.style.fontSize = `${font}px`; wall.innerHTML = entries.slice(0, n).join(""); };
        let lo = 0, hi = entries.length;
        while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); set(mid); if (fits()) lo = mid; else hi = mid - 1; }
        set(lo);
        return { shown: lo, fits: fits() };
      }, { entries: WALL, font: f.wall });
      await page.evaluate((h) => { document.getElementById("fine")!.innerHTML = h; }, fineFor(fit.shown, f.w > f.h));
      // The question: at its size, shrunk only until its widest line fits the headline column. The panel: shrunk until
      // no name is cut and the headline clears the footer.
      const rowsFit = await page.evaluate(() => {
        const head = document.getElementById("head")!;
        const width = document.querySelector(".q")!.parentElement!.getBoundingClientRect().width;
        const footTop = document.querySelector(".foot")!.getBoundingClientRect().top;
        const q = [...document.querySelectorAll<HTMLElement>(".q span")];
        let fs = parseFloat(getComputedStyle(q[0]).fontSize);
        const widest = (xs: HTMLElement[]) => Math.max(...xs.map((x) => x.getBoundingClientRect().width));
        while (fs > 10 && widest(q) > width) { fs -= 0.5; for (const x of q) x.style.fontSize = `${fs}px`; }
        const panel = document.getElementById("panel")!;
        const names = [...panel.querySelectorAll<HTMLElement>(".nm")];
        let rs = parseFloat(getComputedStyle(panel).getPropertyValue("--rs"));
        const cut = () => names.some((x) => x.scrollWidth > x.clientWidth + 1);
        while (rs > 8 && (cut() || head.getBoundingClientRect().bottom > footTop - 8)) { rs -= 0.25; panel.style.setProperty("--rs", `${rs}px`); }
        return { rs, cut: cut() };
      });
      ensure(rowsFit.rs >= z.rsMin && !rowsFit.cut, `${f.key}: the panel had to shrink to ${rowsFit.rs}px${rowsFit.cut ? ", and a name is cut" : ""}`);
      const lay = await page.evaluate(() => {
        const head = document.getElementById("head")!.getBoundingClientRect();
        const foot = document.querySelector(".foot")!.getBoundingClientRect();
        const fine = document.getElementById("fine")!;
        const figs = [...document.querySelectorAll(".fig span")].map((s) => { const r = s.getBoundingClientRect(); return { right: r.right, h: r.height, fs: parseFloat(getComputedStyle(s).fontSize) }; });
        return { headBottom: head.bottom, footTop: foot.top, width: window.innerWidth, headRight: head.right, figs,
          fineFits: fine.scrollHeight <= (document.querySelector(".foot") as HTMLElement).clientHeight };
      });
      ensure(lay.headBottom <= lay.footTop - 4, `${f.key}: the headline runs into the footer (${Math.round(lay.headBottom)} > ${Math.round(lay.footTop)})`);
      ensure(lay.figs.every((x) => x.right <= lay.width - 4 && x.h < x.fs * 1.4), `${f.key}: a figure wraps or leaves the poster`);
      ensure(lay.figs.every((x) => x.right <= lay.headRight + 1), `${f.key}: a figure runs past the headline column`);
      ensure(lay.fineFits, `${f.key}: the footer's fine print overflows`);
      ensure(fit.fits, `${f.key}: the wall overflows`);
      const png = join(OUT, `${f.file}.png`);
      await page.screenshot({ path: png, fullPage: false });
      const md5 = createHash("md5").update(readFileSync(png)).digest("hex").slice(0, 8);
      console.log(`${f.key.padEnd(5)} ${f.w}×${f.h} · wall ${count(fit.shown)} of ${count(WALL.length)} projects → ${png} · v=${md5}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

void main();
