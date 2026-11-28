/**
 * "DPWH projects na tinanggal ng Senado": a three-slide Taglish carousel on the DPWH projects the Senate committee
 * report removes (cuts to zero), by the documents found for them (Jason, 2026-11-27: "The poster language needs to be
 * taglish. Let's not make it document focused but rather DPWH projects removed due to lack of documentation ... the
 * url should be the senate committee report"; copy reviewed and approved, "okay looks legit").
 *
 * The committee report gives no reason for any removal, and most removed projects had 4 or 5 of the key documents,
 * so the copy never says "dahil walang dokumento": it says which removed projects had none, and how much more often
 * the Senate removed those.
 *
 *   1 of 3  1,025 DPWH projects na walang dokumento, tinanggal ng Senado: none of the 5 key documents against 4 or 5,
 *           as two grids of 100.
 *   2 of 3  3,479 DPWH projects, tinanggal · ₱99.3B: the removed projects by documents found, by count and budget.
 *   3 of 3  Nasa budget pa rin: the projects with no documents that remain in the Senate's version.
 *
 * Every figure is read from senate/2027/report.json `dpwh_documents` (scripts/senate-cr/build_report.py: the House
 * bill reviewer's documents, either source, with the committee report's Annex A-4), and the script checks the
 * totals before drawing. Renders in headless Chromium (playwright-core) in the campaign's type (Anton, Inter,
 * JetBrains Mono), paper and black footer with both logos (BetterGov.PH wordmark, PBC's colour logo for dark
 * backgrounds), and writes to --out (default /tmp/senate-doc-posters; the campaign folder's gallery generator stops
 * on posters in no campaign):
 *   senado-dpwh-tinanggal-{1..3}of3-1080x1350.png
 *
 * Usage: npx tsx scripts/build-senate-poster-removed-dpwh.ts [--out=dir] [--only=1,3] [--draft]
 * Needs network access for Google Fonts.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`build-senate-poster-removed-dpwh: ${msg}`); process.exit(1); }
}
/** Layout checks; with --draft they warn and the PNG is still written, to see what does not fit. */
function fits(cond: unknown, msg: string): void {
  if (cond) return;
  if (process.argv.includes("--draft")) console.warn(`build-senate-poster-removed-dpwh: (draft) ${msg}`);
  else ensure(cond, msg);
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(args.out ?? "/tmp/senate-doc-posters");
const ONLY = args.only ? new Set(String(args.only).split(",").map(Number)) : null;
/** The Senate committee report section (Jason: "the url should be the senate committee report"). */
const URL = "budget.bettergov.ph/senate/2027";

// ---------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------

interface Cell { n: number; house: number; senate: number; removed_n: number; removed: number }
type Lvl = "complete" | "partial" | "none" | "unchecked";
interface Docs {
  projects: Cell; checked: number; reviewer_built_at: string | null;
  by: { either: { count: Cell[]; levels: Record<Lvl, Cell> } };
}
const report = JSON.parse(readFileSync(join(ROOT, "data/senate/2027/report.json"), "utf8")) as { dpwh_documents?: Docs };
const D = report.dpwh_documents;
ensure(D, "report.json has no dpwh_documents: run build_report.py (npm run build:senate-cr) first");
const E = D.by.either;
const all = D.projects;
ensure(E.count.length === 6, "unexpected shape of dpwh_documents");
// The committee report's DPWH totals (Annex A-4), so a rebuilt file can't quietly change the posters.
ensure(all.n === 16_275 && all.removed_n === 3_479 && all.house === 587_075_661_000 && all.senate === 520_876_384_250,
  `DPWH totals changed: ${JSON.stringify(all)}`);
/**
 * "Walang dokumento" means 0 documents (Jason, 2026-11-28: "when we say 'walang dokumento', it should mean 0
 * documents"): no key document and no other file, in the Senate copies or on DPWH Transparency. The projects with 0
 * of the 5 key documents are exactly those (the "no document found" level), so the two must stay the same set.
 */
const none = E.count[5];
ensure(none.n === E.levels.none.n && none.removed_n === E.levels.none.removed_n && none.house === E.levels.none.house,
  "some projects with 0 of the 5 key documents now have another file: “walang dokumento” would no longer mean 0 documents");
const some = E.levels.partial;
ensure(some.removed_n === E.count[2].removed_n + E.count[3].removed_n + E.count[4].removed_n, "1–3 of 5 is no longer the partial level");
const full = E.levels.complete;
ensure(none.removed_n + some.removed_n + full.removed_n + E.levels.unchecked.removed_n === all.removed_n, "the removed projects don't add up");
ensure(E.levels.unchecked.removed_n === 0, "a project whose documents weren't checked is now removed: the copy says every removed one was checked");
const asOf = D.reviewer_built_at ? new Date(D.reviewer_built_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }) : null;

const n = (v: number) => v.toLocaleString("en-US");
const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
const p1 = (part: number, whole: number) => `${pct(part, whole).toFixed(1)}%`;
const p0 = (part: number, whole: number) => `${Math.round(pct(part, whole))}%`;
const php = (v: number) => {
  const a = Math.abs(v);
  return a >= 1e9 ? `₱${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `₱${Math.round(a / 1e6)}M` : `₱${n(a)}`;
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const dataUri = (path: string, type: string) => `data:${type};base64,${readFileSync(path).toString("base64")}`;
const LOGO = dataUri(join(ROOT, "public/brand/bettergov-horizontal-white.png"), "image/png");
/** PBC's colour logo with its navy lettering turned white for the black footer (pbc-logo-color-dark.png). */
const PBC_LOGO = dataUri(join(ROOT, "public/brand/pbc-logo-color-dark.png"), "image/png");

const W = 1080, H = 1350, u = W / 100, FOOT = 19.5 * u, LEGEND = 4.2 * u;
/** Both footer logos' width: the BetterGov.PH wordmark at 2.3 units tall (800 × 189). */
const BRAND_W = 2.3 * u * (800 / 189);

const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${W}px; height: ${H}px; background: #f3eee4; overflow: hidden; }
  .poster { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: #f3eee4; color: #141414; --paper: #f3eee4; --red: #d62828; --ink: #141414; --mute: rgba(20, 20, 20, 0.62); --keep: #3d4a5c; --some: #e3a33b; }
  .head { position: absolute; left: ${5 * u}px; right: ${5 * u}px; top: ${4.2 * u}px; }
  .kick { display: flex; justify-content: space-between; align-items: baseline; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.5 * u}px; letter-spacing: 0.12em; text-transform: uppercase; }
  .kick .pg { color: var(--red); }
  .title { margin-top: ${1.2 * u}px; font-family: Anton, Impact, sans-serif; font-weight: 400; line-height: 0.93; text-transform: uppercase; color: #111; }
  .title span { display: block; white-space: nowrap; width: max-content; }
  .title .red { color: var(--red); }
  .strap { margin-top: ${1.5 * u}px; }
  .strap span { display: inline; font-family: Inter, sans-serif; font-weight: 700; font-size: ${2.1 * u}px; line-height: 1.5; color: #f3eee4; background: var(--ink); padding: ${0.35 * u}px ${1 * u}px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
  .body { margin-top: ${2.8 * u}px; }
  .note { margin-top: ${1.6 * u}px; font-family: Inter, sans-serif; font-weight: 600; font-size: ${1.6 * u}px; line-height: 1.42; color: #333; }
  .note b { color: var(--red); font-weight: 800; }
  .note strong { color: #111; font-weight: 800; }

  /* 1: two grids of 100 */
  .duo { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: ${3 * u}px; }
  .card { border: ${0.25 * u}px solid var(--ink); padding: ${2 * u}px ${2 * u}px ${1.6 * u}px; background: var(--paper); position: relative; }
  .card .tab, .box .tab { position: absolute; left: ${1.6 * u}px; top: 0; transform: translateY(-50%); font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.25 * u}px; letter-spacing: 0.1em; text-transform: uppercase; color: #fff; background: var(--ink); padding: ${0.3 * u}px ${0.8 * u}px; white-space: nowrap; }
  .card.is-red .tab { background: var(--red); }
  .card .row { display: grid; grid-template-columns: ${18 * u}px 1fr; column-gap: ${1.8 * u}px; align-items: end; margin-top: ${0.6 * u}px; }
  .waffle { display: grid; grid-template-columns: repeat(10, 1fr); gap: ${0.32 * u}px; }
  .waffle i { display: block; aspect-ratio: 1; background: #d9d2c4; }
  .waffle i.on { background: var(--red); }
  .card .big { font-family: Anton, Impact, sans-serif; font-size: ${6.6 * u}px; line-height: 0.95; color: #111; }
  .card.is-red .big { color: var(--red); }
  .card .lbl { font-family: Inter, sans-serif; font-weight: 800; font-size: ${1.7 * u}px; text-transform: uppercase; letter-spacing: 0.02em; color: #111; margin-top: ${0.3 * u}px; }
  .card .sub { font-family: Inter, sans-serif; font-weight: 600; font-size: ${1.5 * u}px; line-height: 1.4; color: #333; margin-top: ${1.2 * u}px; }
  .card .sub b { font-weight: 800; color: #111; }
  .card .cap { margin-top: ${0.8 * u}px; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.05 * u}px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--mute); }

  /* 2: the removed projects as bars */
  .bars { display: grid; row-gap: ${2.2 * u}px; }
  .bars .cap { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.3 * u}px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: ${0.6 * u}px; }
  .stack { display: flex; height: ${7 * u}px; }
  .stack > div { display: flex; align-items: center; justify-content: center; font-family: Anton, Impact, sans-serif; font-size: ${3.2 * u}px; color: #fff; white-space: nowrap; overflow: hidden; }
  .stack .none { background: var(--red); }
  .stack .some { background: var(--some); color: #2b1a00; }
  .stack .full { background: var(--keep); }
  .key { margin-top: ${2.6 * u}px; display: grid; row-gap: ${0.2 * u}px; }
  .key .k { display: grid; grid-template-columns: ${2.4 * u}px 1fr auto ${13 * u}px; column-gap: ${1.4 * u}px; align-items: center; padding: ${0.9 * u}px 0; border-top: 1px solid rgba(20, 20, 20, 0.16); font-family: Inter, sans-serif; font-weight: 700; font-size: ${2 * u}px; }
  .key .k:first-child { border-top: 0; }
  .key .sw { width: ${2.4 * u}px; height: ${2.4 * u}px; }
  .key .num { font-family: 'JetBrains Mono', monospace; font-weight: 700; text-align: right; white-space: nowrap; }
  .key .num small { font-size: ${1.4 * u}px; color: var(--mute); margin-left: ${0.6 * u}px; }
  .key .k.is-none { color: var(--red); }

  /* 3: what remains */
  .hero3 { display: grid; grid-template-columns: auto 1fr; column-gap: ${2.6 * u}px; align-items: end; }
  .hero3 .big { font-family: Anton, Impact, sans-serif; font-size: ${19 * u}px; line-height: 0.82; color: var(--red); }
  .hero3 .side { font-family: Inter, sans-serif; font-weight: 700; font-size: ${2.15 * u}px; line-height: 1.3; color: #111; padding-bottom: ${0.4 * u}px; }
  .hero3 .side b { display: block; font-family: Anton, Impact, sans-serif; font-weight: 400; font-size: ${6.4 * u}px; line-height: 1; color: #111; }
  .box { margin-top: ${3.6 * u}px; border: ${0.25 * u}px solid var(--ink); padding: ${2.4 * u}px ${2 * u}px ${1.8 * u}px; position: relative; }
  .split { display: flex; height: ${6.4 * u}px; }
  .split > div { display: flex; flex-direction: column; justify-content: center; padding: 0 ${1.4 * u}px; color: #fff; font-family: Inter, sans-serif; font-weight: 800; font-size: ${1.7 * u}px; white-space: nowrap; overflow: hidden; }
  .split > div b { font-family: Anton, Impact, sans-serif; font-weight: 400; font-size: ${3.1 * u}px; line-height: 1; }
  .split .rm { background: var(--red); }
  .split .kp { background: var(--keep); align-items: flex-end; }
  .box .tot { margin-top: ${1.2 * u}px; display: flex; justify-content: space-between; font-family: Inter, sans-serif; font-weight: 700; font-size: ${1.7 * u}px; color: #222; }

  .legend { position: absolute; left: ${5 * u}px; right: ${5 * u}px; bottom: ${FOOT + 1.4 * u}px; height: ${LEGEND - 1.4 * u}px; display: flex; align-items: center; border-top: ${0.2 * u}px solid var(--ink); font-family: Inter, sans-serif; font-weight: 600; font-size: ${1.22 * u}px; color: #333; white-space: nowrap; overflow: hidden; }
  .legend b { font-family: 'JetBrains Mono', monospace; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #111; margin-right: ${0.7 * u}px; }
  .cta { position: absolute; left: ${5 * u}px; right: ${5 * u}px; bottom: ${FOOT + LEGEND + 1.4 * u}px; display: flex; align-items: baseline; justify-content: center; gap: ${1.4 * u}px; background: var(--red); color: #fff; padding: ${1.1 * u}px ${1.5 * u}px ${1 * u}px; white-space: nowrap; }
  .cta b { font-family: Anton, Impact, sans-serif; font-weight: 400; font-size: ${3.2 * u}px; line-height: 1; text-transform: uppercase; letter-spacing: 0.01em; }
  .cta span { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${2.5 * u}px; line-height: 1; letter-spacing: -0.01em; }
  .foot { position: absolute; left: 0; right: 0; bottom: 0; height: ${FOOT}px; background: #111; color: #f3eee4; padding: ${1.9 * u}px ${4.6 * u}px; display: grid; grid-template-columns: ${BRAND_W}px 1fr; column-gap: ${3.4 * u}px; align-items: start; font-family: Inter, sans-serif; }
  .foot .brands { display: grid; row-gap: ${1.5 * u}px; padding-top: ${0.3 * u}px; }
  .foot .brands img { width: ${BRAND_W}px; display: block; }
  .foot .url { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${2.1 * u}px; color: #fff; margin-bottom: ${0.6 * u}px; }
  .foot .fine { font-size: ${1.12 * u}px; line-height: 1.42; color: rgba(243, 238, 228, 0.86); }
  .foot .fine strong { color: #fff; font-weight: 700; }`;

const FINE = `<strong>Source:</strong> Committee Report ng Senate Committee on Finance sa House Bill 10858 (2027 budget), Annex A-4, at ang key
  documents na nakita para sa bawat DPWH project (research.bettergov.ph at BetterGov.PH)${asOf ? `, as of ${asOf}` : ""}.
  <strong>Walang dokumento</strong> = 0 dokumento: walang kahit isang file na nakita, sa kopya ng DPWH para sa Senado at sa DPWH Transparency.
  <strong>Tinanggal</strong> = ginawang zero ang budget. Hindi sinabi ng Senado ang dahilan ng bawat pagtanggal: pattern ito sa data, hindi
  paliwanag ng Senado. Hindi patunay ang dokumento na tama ang laman nito. Hindi pa final ang report: boboto pa ang Senado, at
  pagkakasunduin pa ng Senado at Kamara ang iisang bersyon.`;
const LEGEND_TEXT = `<b>5 key documents:</b> program of work · BP 202 · endorsement ng development council · geotagged photos · certificate of implementability`;

const kicker = (i: number) => `<div class="kick"><span>Committee report ng Senado · 2027 budget · DPWH</span><span class="pg">${i} / 3</span></div>`;

function slide1(): string {
  const sq = (k: number) => `<div class="waffle">${Array.from({ length: 100 }, (_, i) => `<i${i < k ? ' class="on"' : ""}></i>`).join("")}</div>`;
  const card = (c: Cell, tab: string, red: boolean) => `
    <div class="card${red ? " is-red" : ""}"><p class="tab">${esc(tab)}</p>
      <div class="row">${sq(Math.round(pct(c.removed_n, c.n)))}<div><div class="big">${p1(c.removed_n, c.n)}</div><div class="lbl">tinanggal</div></div></div>
      <p class="sub"><b>${n(c.removed_n)}</b> sa ${n(c.n)} projects<br><b>${php(c.removed)}</b> sa ${php(c.house)} ng House bill</p>
      <p class="cap">Bawat kahon: 1% ng mga project</p>
    </div>`;
  return `${kicker(1)}
    <div class="title" id="title"><span>${n(none.removed_n)} DPWH projects</span><span>na walang dokumento,</span><span class="red">tinanggal ng Senado</span></div>
    <p class="strap"><span>0 dokumento: walang kahit isang file na nakita para sa mga project na ito. ${php(none.removed)} ang budget nila sa House bill.</span></p>
    <div class="body">
      <div class="duo">
        ${card(none, "0 dokumento", true)}
        ${card(full, "May 4 o 5 key documents", false)}
      </div>
      <p class="note">Sa <strong>${n(none.n)}</strong> DPWH projects na walang kahit isang dokumento, <b>${n(none.removed_n)}</b> ang tinanggal: halos kalahati (${p0(none.removed_n, none.n)}).
        Sa mga may 4 o 5 key documents, ${p0(full.removed_n, full.n)} lang ang tinanggal.</p>
    </div>`;
}

function slide2(): string {
  const parts: [string, Cell, string][] = [["none", none, "Walang dokumento (0)"], ["some", some, "Kulang (1–3 sa 5)"], ["full", full, "May 4 o 5 key documents"]];
  const bar = (by: "removed_n" | "removed", show: (c: Cell) => string) => `<div class="stack">${parts.map(([cls, c]) => {
    const w = pct(c[by], all[by]);
    return `<div class="${cls}" style="width:${w.toFixed(2)}%">${w >= 9 ? show(c) : ""}</div>`;
  }).join("")}</div>`;
  return `${kicker(2)}
    <div class="title" id="title"><span>${n(all.removed_n)} DPWH projects,</span><span class="red">tinanggal · ${php(all.removed)}</span></div>
    <p class="strap"><span>Ito ang mga project na ginawang zero ng Senado ang budget, ayon sa dokumentong nakita.</span></p>
    <div class="body">
      <div class="bars">
        <div><p class="cap">Ayon sa bilang ng projects</p>${bar("removed_n", (c) => n(c.removed_n))}</div>
        <div><p class="cap">Ayon sa budget sa House bill</p>${bar("removed", (c) => php(c.removed))}</div>
      </div>
      <div class="key">${parts.map(([cls, c, label]) => `
        <div class="k${cls === "none" ? " is-none" : ""}"><i class="sw" style="background:var(--${cls === "none" ? "red" : cls === "some" ? "some" : "keep"})"></i><span>${esc(label)}</span>
          <span class="num">${n(c.removed_n)}<small>${p1(c.removed_n, all.removed_n)}</small></span><span class="num">${php(c.removed)}</span></div>`).join("")}
      </div>
      <p class="note">Mas madalas tanggalin ang walang dokumento: <b>${p0(none.removed_n, none.n)}</b> ng mga walang dokumento, kumpara sa ${p0(full.removed_n, full.n)} ng may 4 o 5.
        Pero mahigit kalahati ng tinanggal ay may 4 o 5 key documents.</p>
    </div>`;
}

function slide3(): string {
  const left = none.n - none.removed_n;
  return `${kicker(3)}
    <div class="title" id="title"><span>Nasa budget</span><span class="red">pa rin</span></div>
    <div class="body">
      <div class="hero3">
        <div class="big">${n(left)}</div>
        <div class="side">DPWH projects na walang dokumento, may<b>${php(none.senate)}</b>pa rin sa bersyon ng Senado</div>
      </div>
      <div class="box"><p class="tab">Ang ${n(none.n)} DPWH projects na walang dokumento</p>
        <div class="split">
          <div class="rm" style="width:${pct(none.removed_n, none.n).toFixed(2)}%"><b>${n(none.removed_n)}</b>tinanggal</div>
          <div class="kp" style="width:${pct(left, none.n).toFixed(2)}%"><b>${n(left)}</b>natira</div>
        </div>
        <div class="tot"><span>${php(none.removed)} tinanggal</span><span>${php(none.senate)} natira</span></div>
      </div>
    </div>`;
}

/** `titleMax`: a ceiling on the title's size where its lines are short (px). */
const SLIDES: Record<number, { body: () => string; cta: [string, string] | null; titleMax?: number }> = {
  1: { body: slide1, cta: null },
  2: { body: slide2, cta: null },
  3: { body: slide3, cta: ["Tingnan ang report", URL], titleMax: 190 },
};

function html(i: number): string {
  const s = SLIDES[i];
  return `<!doctype html><html lang="fil"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=block" rel="stylesheet">
<style>${css}</style></head><body><div class="poster">
  <div class="head" id="head">${s.body()}</div>
  ${s.cta ? `<p class="cta" id="cta"><b>${esc(s.cta[0])}</b><span>${esc(s.cta[1])}</span></p>` : ""}
  <p class="legend" id="legend">${LEGEND_TEXT}</p>
  <div class="foot"><div class="brands"><img src="${LOGO}" alt="BetterGov.PH"><img src="${PBC_LOGO}" alt="People’s Budget Coalition"></div>
    <div><p class="url">${esc(URL)}</p><div class="fine" id="fine">${FINE}</div></div></div>
</div></body></html>`;
}

/** The headless shell this host runs (1193 crashes on our pages; see the MPB notes), else playwright's default. */
function browserPath(): string | undefined {
  const p = join(homedir(), ".cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell");
  return process.env.CHROME_PATH ?? (existsSync(p) ? p : undefined);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: browserPath() });
  try {
    for (const i of [1, 2, 3]) {
      if (ONLY && !ONLY.has(i)) continue;
      const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await p.setContent(html(i), { waitUntil: "networkidle" });
      await p.evaluate(() => document.fonts.ready);
      await p.evaluate("globalThis.__name = (f) => f"); // tsx names inner functions with a helper the page lacks
      // Each title line at the size that makes the widest one fill the column.
      await p.evaluate((max) => {
        const t = document.getElementById("title")!, head = document.getElementById("head")!;
        const lines = [...t.children] as HTMLElement[];
        let size = 60;
        t.style.fontSize = `${size}px`;
        const widest = () => Math.max(...lines.map((l) => l.getBoundingClientRect().width));
        while (widest() < head.clientWidth - 2 && size < max) t.style.fontSize = `${++size}px`;
        while (widest() > head.clientWidth && size > 30) t.style.fontSize = `${--size}px`;
      }, SLIDES[i].titleMax ?? 260);
      // The body sits in the middle of the room left between the title and the call to action or the legend.
      await p.evaluate(() => {
        const body = document.querySelector(".body") as HTMLElement;
        const limit = (document.getElementById("cta") ?? document.getElementById("legend"))!.getBoundingClientRect().top - 14;
        const free = limit - document.getElementById("head")!.getBoundingClientRect().bottom;
        if (free > 0) body.style.marginTop = `${parseFloat(getComputedStyle(body).marginTop) + free / 2}px`;
      });
      const lay = await p.evaluate(() => {
        const head = document.getElementById("head")!.getBoundingClientRect();
        const cta = document.getElementById("cta")?.getBoundingClientRect();
        const legend = document.getElementById("legend")!;
        const fine = document.getElementById("fine")!.getBoundingClientRect();
        const foot = document.querySelector(".foot")!.getBoundingClientRect();
        const clipped = [...document.querySelectorAll(".stack > div, .split > div, .key .k span, .card .sub")].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent);
        return {
          headBottom: head.bottom, limit: cta ? cta.top : legend.getBoundingClientRect().top, fineBottom: fine.bottom, footBottom: foot.bottom,
          legendClipped: legend.scrollWidth > legend.clientWidth + 1, clipped,
        };
      });
      fits(lay.headBottom <= lay.limit - 14, `slide ${i}: the content runs into the ${i === 3 ? "call to action" : "legend"} (${Math.round(lay.headBottom)} > ${Math.round(lay.limit)})`);
      fits(lay.fineBottom <= lay.footBottom - 8, `slide ${i}: the fine print runs out of the footer (${Math.round(lay.fineBottom)} > ${Math.round(lay.footBottom)})`);
      fits(!lay.legendClipped, `slide ${i}: the 5 key documents line is cut`);
      fits(lay.clipped.length === 0, `slide ${i}: clipped text: ${lay.clipped.join(" | ")}`);
      const png = join(OUT, `senado-dpwh-tinanggal-${i}of3-${W}x${H}.png`);
      await p.screenshot({ path: png });
      console.log(`slide ${i} · content ends ${Math.round(lay.headBottom)} / ${Math.round(lay.limit)} → ${png}`);
      await p.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
