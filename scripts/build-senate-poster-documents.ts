/**
 * "Removed by the Senate, by documents found": a four-slide carousel from the Senate executive report's Documents
 * page (Jason, 2026-11-27: "Generate me infographic posters for these highlights. Put PBC and BetterGov logos").
 *
 *   1 of 4  No key documents? Nearly half removed: 0 of 5 against 4 or 5, as two grids of 100.
 *   2 of 4  5 of 5 to 0 of 5: each count's projects, removed and remaining, House bill and Senate budget.
 *   3 of 4  Still in the budget: what remains after the Senate's removals, and where to check it.
 *   4 of 4  The five key documents: projects removed without each one, and with it.
 *
 * Every figure is read from senate/2027/report.json `dpwh_documents` (scripts/senate-cr/build_report.py: the House
 * bill reviewer's document counts, either source, with the Senate committee report's Annex A-4), and the script
 * checks the totals before drawing. The executive report itself is unlinked, so the posters point to the public
 * project reviewer, which shows each project's documents and its SENATE:REMOVED label.
 *
 * Renders in headless Chromium (playwright-core) in the campaign's type (Anton, Inter, JetBrains Mono), paper and
 * black footer with both logos (BetterGov.PH wordmark, PBC's colour logo for dark backgrounds), and writes to --out
 * (default /tmp/senate-doc-posters; the campaign folder's gallery generator stops on posters in no campaign):
 *   senate-removed-by-documents-{1..4}of4-1080x1350.png
 *
 * Usage: npx tsx scripts/build-senate-poster-documents.ts [--out=dir] [--only=1,3] [--draft]
 * Needs network access for Google Fonts.
 */
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`build-senate-poster-documents: ${msg}`); process.exit(1); }
}
/** Layout checks; with --draft they warn and the PNG is still written, to see what does not fit. */
function fits(cond: unknown, msg: string): void {
  if (cond) return;
  if (process.argv.includes("--draft")) console.warn(`build-senate-poster-documents: (draft) ${msg}`);
  else ensure(cond, msg);
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(args.out ?? "/tmp/senate-doc-posters");
const ONLY = args.only ? new Set(String(args.only).split(",").map(Number)) : null;
const URL = "budget.bettergov.ph/hgab/2027/review";

// ---------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------

interface Cell { n: number; house: number; senate: number; removed_n: number; removed: number }
type Lvl = "complete" | "partial" | "none" | "unchecked";
interface Docs {
  projects: Cell; checked: number; reviewer_built_at: string | null;
  by: { either: { count: Cell[]; levels: Record<Lvl, Cell>; types: { with: Cell; without: Cell }[] } };
}
const report = JSON.parse(readFileSync(join(ROOT, "data/senate/2027/report.json"), "utf8")) as { dpwh_documents?: Docs };
const D = report.dpwh_documents;
ensure(D, "report.json has no dpwh_documents: run build_report.py (npm run build:senate-cr) first");
const E = D.by.either;
const all = D.projects;
const add = (cs: Cell[]) => cs.reduce((a, c) => ({ n: a.n + c.n, house: a.house + c.house, senate: a.senate + c.senate, removed_n: a.removed_n + c.removed_n, removed: a.removed + c.removed }),
  { n: 0, house: 0, senate: 0, removed_n: 0, removed: 0 });
// The counts, with the projects whose documents weren't checked, are every House bill DPWH project.
const sum = add([...E.count, E.levels.unchecked]);
ensure(sum.n === all.n && sum.removed_n === all.removed_n && sum.house === all.house && Math.abs(sum.senate - all.senate) < 10,
  `the counts don't add up to all projects: ${JSON.stringify(sum)} vs ${JSON.stringify(all)}`);
// The Senate committee report's DPWH totals (Annex A-4), so a rebuilt file can't quietly change the posters.
ensure(all.n === 16_275 && all.removed_n === 3_479 && all.house === 587_075_661_000 && all.senate === 520_876_384_250,
  `DPWH totals changed: ${JSON.stringify(all)}`);
ensure(E.count.length === 6 && E.types.length === 5, "unexpected shape of dpwh_documents");
const zero = E.count[5];
const complete = E.levels.complete;
const asOf = D.reviewer_built_at ? new Date(D.reviewer_built_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }) : null;

const n = (v: number) => v.toLocaleString("en-US");
const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
const p1 = (part: number, whole: number) => `${pct(part, whole).toFixed(1)}%`;
const php = (v: number) => {
  const a = Math.abs(v);
  return a >= 1e9 ? `₱${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `₱${Math.round(a / 1e6)}M` : `₱${n(a)}`;
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const DOC_NAMES: [string, string][] = [
  ["Program of work", "the work items, quantities and cost"],
  ["BP 202", "the budget proposal form for a capital project"],
  ["Development council endorsement", "from the regional, provincial or local council"],
  ["Geotagged photos", "of the site, with their location"],
  ["Certificate of implementability", "the office certifies the project can be done"],
];

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const dataUri = (path: string, type: string) => `data:${type};base64,${readFileSync(path).toString("base64")}`;
const LOGO = dataUri(join(ROOT, "public/brand/bettergov-horizontal-white.png"), "image/png");
/** PBC's colour logo with its navy lettering turned white for the black footer (pbc-logo-color-dark.png). */
const PBC_LOGO = dataUri(join(ROOT, "public/brand/pbc-logo-color-dark.png"), "image/png");

const W = 1080, H = 1350, u = W / 100, FOOT = 19 * u;
/** Both footer logos' width: the BetterGov.PH wordmark at 2.3 units tall (800 × 189). */
const BRAND_W = 2.3 * u * (800 / 189);

const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${W}px; height: ${H}px; background: #f3eee4; overflow: hidden; }
  .poster { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: #f3eee4; color: #141414; --paper: #f3eee4; --red: #d62828; --ink: #141414; --mute: rgba(20, 20, 20, 0.62); --keep: #3d4a5c; }
  .head { position: absolute; left: ${5 * u}px; right: ${5 * u}px; top: ${4.2 * u}px; }
  .kick { display: flex; justify-content: space-between; align-items: baseline; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.55 * u}px; letter-spacing: 0.12em; text-transform: uppercase; }
  .kick .pg { color: var(--red); }
  .title { margin-top: ${1.2 * u}px; font-family: Anton, Impact, sans-serif; font-weight: 400; line-height: 0.92; text-transform: uppercase; color: #111; }
  .title span { display: block; white-space: nowrap; width: max-content; }
  .title .red { color: var(--red); }
  .strap { margin-top: ${1.5 * u}px; }
  .strap span { display: inline; font-family: Inter, sans-serif; font-weight: 700; font-size: ${2.15 * u}px; line-height: 1.5; color: #f3eee4; background: var(--ink); padding: ${0.35 * u}px ${1 * u}px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
  .body { margin-top: ${3 * u}px; }
  .lede { font-family: Inter, sans-serif; font-weight: 600; font-size: ${1.9 * u}px; line-height: 1.38; color: #222; }
  .lede b { color: var(--red); }
  .note { margin-top: ${1.6 * u}px; font-family: Inter, sans-serif; font-weight: 600; font-size: ${1.5 * u}px; line-height: 1.42; color: #333; }

  /* 1: two grids of 100 */
  .duo { display: grid; grid-template-columns: 1fr 1fr; column-gap: ${3 * u}px; }
  .card { border: ${0.25 * u}px solid var(--ink); padding: ${2 * u}px ${2 * u}px ${1.8 * u}px; background: var(--paper); position: relative; }
  .card .tab { position: absolute; left: ${1.6 * u}px; top: 0; transform: translateY(-50%); font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.3 * u}px; letter-spacing: 0.12em; text-transform: uppercase; color: #fff; background: var(--ink); padding: ${0.3 * u}px ${0.8 * u}px; white-space: nowrap; }
  .card.is-red .tab { background: var(--red); }
  .waffle { display: grid; grid-template-columns: repeat(10, 1fr); gap: ${0.42 * u}px; width: ${27 * u}px; margin: ${0.8 * u}px 0 ${1.4 * u}px; }
  .waffle i { display: block; aspect-ratio: 1; background: #d9d2c4; }
  .waffle i.on { background: var(--red); }
  .card .big { font-family: Anton, Impact, sans-serif; font-size: ${8.6 * u}px; line-height: 0.95; color: #111; }
  .card.is-red .big { color: var(--red); }
  .card .lbl { font-family: Inter, sans-serif; font-weight: 800; font-size: ${1.9 * u}px; text-transform: uppercase; letter-spacing: 0.02em; color: #111; margin-top: ${0.3 * u}px; }
  .card .sub { font-family: Inter, sans-serif; font-weight: 600; font-size: ${1.55 * u}px; line-height: 1.4; color: #333; margin-top: ${0.8 * u}px; }
  .card .sub b { font-weight: 800; color: #111; }
  .allbar { margin-top: ${2.2 * u}px; display: flex; align-items: baseline; justify-content: space-between; gap: ${1.4 * u}px; border-top: ${0.25 * u}px solid var(--ink); padding-top: ${1.2 * u}px; font-family: Inter, sans-serif; font-weight: 700; font-size: ${1.8 * u}px; color: #111; }
  .allbar b { font-family: Anton, Impact, sans-serif; font-weight: 400; font-size: ${3.6 * u}px; color: var(--red); }

  /* 2: the tally */
  .legend { display: flex; gap: ${2.4 * u}px; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.3 * u}px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: ${1.4 * u}px; }
  .legend i { display: inline-block; width: ${1.4 * u}px; height: ${1.4 * u}px; margin-right: ${0.6 * u}px; vertical-align: -0.15em; }
  .tally { display: grid; grid-template-columns: ${11 * u}px 1fr; column-gap: ${1.8 * u}px; row-gap: ${1.55 * u}px; align-items: center; }
  .tally .k { font-family: Anton, Impact, sans-serif; font-size: ${4.4 * u}px; line-height: 0.9; white-space: nowrap; }
  .tally .k small { display: block; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.05 * u}px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--mute); margin-top: ${0.4 * u}px; }
  .tally .k.hot { color: var(--red); }
  .stack { display: flex; height: ${4.6 * u}px; }
  .stack .rm { background: var(--red); color: #fff; }
  .stack .kp { background: var(--keep); color: #fff; }
  .stack > div { display: flex; align-items: center; padding: 0 ${0.9 * u}px; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.6 * u}px; white-space: nowrap; overflow: hidden; }
  .stack .kp { justify-content: flex-end; }
  .tally .meta { display: flex; justify-content: space-between; font-family: Inter, sans-serif; font-weight: 600; font-size: ${1.42 * u}px; color: #333; margin-top: ${0.45 * u}px; }
  .tally .meta b { color: #111; font-weight: 800; }
  .tally .meta .r b { color: var(--red); }
  .totals { margin-top: ${2.2 * u}px; border-top: ${0.25 * u}px solid var(--ink); padding-top: ${1.1 * u}px; display: flex; justify-content: space-between; font-family: Inter, sans-serif; font-weight: 700; font-size: ${1.7 * u}px; }
  .totals b { font-weight: 800; }
  .totals .r { color: var(--red); }

  /* 3: what remains */
  .hero3 { display: grid; grid-template-columns: auto 1fr; column-gap: ${2.6 * u}px; align-items: end; }
  .hero3 .big { font-family: Anton, Impact, sans-serif; font-size: ${19 * u}px; line-height: 0.82; color: var(--red); }
  .hero3 .side { font-family: Inter, sans-serif; font-weight: 700; font-size: ${2.15 * u}px; line-height: 1.3; color: #111; padding-bottom: ${0.6 * u}px; }
  .hero3 .side b { display: block; font-family: Anton, Impact, sans-serif; font-weight: 400; font-size: ${6.2 * u}px; line-height: 1; color: #111; }
  .remain { margin-top: ${3.4 * u}px; border: ${0.25 * u}px solid var(--ink); padding: ${2.2 * u}px ${2 * u}px ${1.6 * u}px; position: relative; }
  .remain .tab { position: absolute; left: ${1.6 * u}px; top: 0; transform: translateY(-50%); font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.3 * u}px; letter-spacing: 0.12em; text-transform: uppercase; color: #fff; background: var(--ink); padding: ${0.3 * u}px ${0.8 * u}px; white-space: nowrap; }
  .rrow { display: grid; grid-template-columns: ${7.6 * u}px 1fr ${11 * u}px ${10 * u}px; column-gap: ${1.2 * u}px; align-items: center; padding: ${0.55 * u}px 0; border-top: 1px solid rgba(20, 20, 20, 0.16); font-family: Inter, sans-serif; font-weight: 700; font-size: ${1.6 * u}px; }
  .rrow:first-of-type { border-top: 0; }
  .rrow .bar { height: ${1.6 * u}px; background: var(--keep); }
  .rrow.hot .bar { background: var(--red); }
  .rrow.hot { color: var(--red); }
  .rrow .num { text-align: right; font-family: 'JetBrains Mono', monospace; white-space: nowrap; }
  .rrow.rhead { font-family: 'JetBrains Mono', monospace; font-size: ${1.1 * u}px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--mute); }

  /* 4: the five documents */
  .docs { display: grid; row-gap: ${1.5 * u}px; }
  .doc { display: grid; grid-template-columns: 1fr ${33 * u}px; column-gap: ${2 * u}px; align-items: center; border-top: 1px solid rgba(20, 20, 20, 0.18); padding-top: ${1.3 * u}px; }
  .doc:first-child { border-top: 0; padding-top: 0; }
  .doc .nm { font-family: Inter, sans-serif; font-weight: 800; font-size: ${2.1 * u}px; line-height: 1.15; color: #111; }
  .doc .nm small { display: block; font-weight: 600; font-size: ${1.38 * u}px; color: #444; margin-top: ${0.3 * u}px; line-height: 1.3; }
  .pair { display: grid; row-gap: ${0.5 * u}px; }
  .pr { display: grid; grid-template-columns: ${8.8 * u}px 1fr ${7 * u}px; column-gap: ${0.8 * u}px; align-items: center; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.25 * u}px; letter-spacing: 0.04em; text-transform: uppercase; }
  .pr .tr { height: ${1.9 * u}px; background: #d9d2c4; }
  .pr .tr i { display: block; height: 100%; }
  .pr.wo .tr i { background: var(--red); }
  .pr.wi .tr i { background: var(--keep); }
  .pr .v { text-align: right; font-size: ${1.75 * u}px; letter-spacing: -0.01em; }
  .pr.wo .v { color: var(--red); }

  .cta { position: absolute; left: ${5 * u}px; right: ${5 * u}px; bottom: ${FOOT + 2.6 * u}px; display: flex; align-items: baseline; justify-content: center; gap: ${1.4 * u}px; background: var(--red); color: #fff; padding: ${1.1 * u}px ${1.5 * u}px ${1 * u}px; white-space: nowrap; }
  .cta b { font-family: Anton, Impact, sans-serif; font-weight: 400; font-size: ${3.2 * u}px; line-height: 1; text-transform: uppercase; letter-spacing: 0.01em; }
  .cta span { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${2.3 * u}px; line-height: 1; letter-spacing: -0.01em; }
  .foot { position: absolute; left: 0; right: 0; bottom: 0; height: ${FOOT}px; background: #111; color: #f3eee4; padding: ${2 * u}px ${4.6 * u}px; display: grid; grid-template-columns: ${BRAND_W}px 1fr; column-gap: ${3.4 * u}px; align-items: start; font-family: Inter, sans-serif; }
  .foot .brands { display: grid; row-gap: ${1.5 * u}px; padding-top: ${0.3 * u}px; }
  .foot .brands img { width: ${BRAND_W}px; display: block; }
  .foot .url { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.95 * u}px; color: #fff; margin-bottom: ${0.7 * u}px; }
  .foot .fine { font-size: ${1.14 * u}px; line-height: 1.42; color: rgba(243, 238, 228, 0.86); }
  .foot .fine strong { color: #fff; font-weight: 700; }`;

const FINE = `<strong>Source:</strong> Senate Committee on Finance, Committee Report on House Bill 10858 (FY 2027 budget), Annex A-4, and the five key
  documents found for each House bill DPWH project by research.bettergov.ph and BetterGov.PH (DPWH’s copies for the Senate, and DPWH Transparency)${asOf ? `, as of ${asOf}` : ""}.
  <strong>Removed</strong> = cut to zero. The Senate gives no reason for each project it removes: this is a pattern in the data, not its stated reason.
  Having a document doesn’t prove what’s in it. ${n(all.n - D.checked)} lines whose documents weren’t checked are left out of the counts by document.
  The committee report isn’t final: the Senate votes on it, then both chambers agree on one text.`;

const kicker = (i: number) => `<div class="kick"><span>Senate committee report · 2027 budget · DPWH</span><span class="pg">${i} / 4</span></div>`;

function slide1(): string {
  const sq = (k: number) => `<div class="waffle">${Array.from({ length: 100 }, (_, i) => `<i${i < k ? ' class="on"' : ""}></i>`).join("")}</div>`;
  const card = (c: Cell, label: string, tab: string, red: boolean) => `
    <div class="card${red ? " is-red" : ""}"><p class="tab">${esc(tab)}</p>
      ${sq(Math.round(pct(c.removed_n, c.n)))}
      <div class="big">${p1(c.removed_n, c.n)}</div>
      <div class="lbl">removed</div>
      <p class="sub"><b>${n(c.removed_n)}</b> of ${n(c.n)} projects ${esc(label)}<br><b>${php(c.removed)}</b> of ${php(c.house)} in the House bill</p>
    </div>`;
  return `${kicker(1)}
    <div class="title" id="title"><span>No key documents?</span><span class="red">Nearly half removed</span></div>
    <p class="strap"><span>What the Senate did to the House bill’s DPWH projects, by documents found</span></p>
    <div class="body">
      <div class="duo">
        ${card(zero, "with none of the 5 key documents", "None of the 5 key documents", true)}
        ${card(complete, "with 4 or 5 of them", "4 or 5 key documents", false)}
      </div>
      <div class="allbar"><span>All ${n(all.n)} DPWH projects</span><span><b>${p1(all.removed_n, all.n)}</b> removed · ${n(all.removed_n)} projects · ${php(all.removed)}</span></div>
      <p class="note">The 5 key documents: program of work, BP 202, development council endorsement, geotagged photos and certificate of implementability. Each square is 1% of the projects.</p>
    </div>`;
}

function slide2(): string {
  const rows = E.count.map((c, i) => {
    const k = 5 - i;
    const rm = pct(c.removed_n, c.n);
    const left = c.n - c.removed_n;
    return `
      <div class="k${k === 0 ? " hot" : ""}">${k} of 5<small>${n(c.n)} projects</small></div>
      <div>
        <div class="stack"><div class="rm" style="width:${rm.toFixed(2)}%">${rm >= 14 ? p1(c.removed_n, c.n) : ""}</div><div class="kp" style="width:${(100 - rm).toFixed(2)}%">${rm < 14 ? `${p1(c.removed_n, c.n)} removed` : ""}</div></div>
        <div class="meta"><span class="r"><b>${n(c.removed_n)}</b> removed · ${php(c.removed)}</span><span><b>${n(left)}</b> remain · ${php(c.house)} → <b>${php(c.senate)}</b></span></div>
      </div>`;
  }).join("");
  return `${kicker(2)}
    <div class="title" id="title"><span>5 of 5 to <span class="red" style="display:inline">0 of 5</span></span></div>
    <p class="strap"><span>Projects removed and kept by the Senate, by how many of the 5 key documents each one has</span></p>
    <div class="body">
      <div class="legend"><span><i style="background:var(--red)"></i>Removed by the Senate</span><span><i style="background:var(--keep)"></i>Remains</span><span>House bill → Senate budget</span></div>
      <div class="tally">${rows}</div>
      <div class="totals"><span>All ${n(all.n)} projects</span><span><b class="r">${n(all.removed_n)} removed</b> · <b>${n(all.n - all.removed_n)} remain</b> · ${php(all.house)} → <b>${php(all.senate)}</b></span></div>
      <p class="note">Not counted by document: ${n(E.levels.unchecked.n)} lines whose documents weren’t checked (foreign-assisted projects, small facility lines). None of them was removed.</p>
    </div>`;
}

function slide3(): string {
  const left = (c: Cell) => c.n - c.removed_n;
  const maxLeft = Math.max(...E.count.map(left));
  const rows = E.count.map((c, i) => {
    const k = 5 - i;
    return `<div class="rrow${k === 0 ? " hot" : ""}"><span>${k} of 5</span><span><i class="bar" style="display:block;width:${((left(c) / maxLeft) * 100).toFixed(2)}%"></i></span><span class="num">${n(left(c))}</span><span class="num">${php(c.senate)}</span></div>`;
  }).join("");
  return `${kicker(3)}
    <div class="title" id="title"><span>Still in</span><span class="red">the budget</span></div>
    <p class="strap"><span>After the Senate’s removals, these House bill DPWH projects remain</span></p>
    <div class="body">
      <div class="hero3">
        <div class="big">${n(left(zero))}</div>
        <div class="side">projects with none of the 5 key documents remain, with<b>${php(zero.senate)}</b>in the Senate’s version</div>
      </div>
      <div class="remain"><p class="tab">What remains, by key documents found</p>
        <div class="rrow rhead"><span>Documents</span><span></span><span class="num">Projects</span><span class="num">Budget</span></div>
        ${rows}
        <div class="rrow" style="border-top:${0.25 * u}px solid var(--ink)"><span>All</span><span></span><span class="num">${n(all.n - all.removed_n)}</span><span class="num">${php(all.senate)}</span></div>
      </div>
      <p class="note">Every project, its documents and what the Senate did to it, one by one, in the project reviewer.</p>
    </div>`;
}

function slide4(): string {
  const docs = E.types.map((t, i) => {
    const wo = pct(t.without.removed_n, t.without.n), wi = pct(t.with.removed_n, t.with.n);
    return `<div class="doc">
      <div class="nm">${esc(DOC_NAMES[i][0])}<small>${esc(DOC_NAMES[i][1])}</small></div>
      <div class="pair">
        <div class="pr wo"><span>Without it</span><span class="tr"><i style="width:${wo.toFixed(2)}%"></i></span><span class="v">${wo.toFixed(1)}%</span></div>
        <div class="pr wi"><span>With it</span><span class="tr"><i style="width:${wi.toFixed(2)}%"></i></span><span class="v">${wi.toFixed(1)}%</span></div>
      </div>
    </div>`;
  }).join("");
  return `${kicker(4)}
    <div class="title" id="title"><span>The 5 key</span><span class="red">documents</span></div>
    <p class="strap"><span>Share of projects the Senate removed, without each document and with it</span></p>
    <div class="body">
      <div class="docs">${docs}</div>
      <p class="note">Of the ${n(D.checked)} House bill DPWH projects whose documents were checked. A development council endorsement made little difference; the program of work and BP 202 the most.</p>
    </div>`;
}

/** `titleMax`: a ceiling on the title's size where its lines are short (px). */
const SLIDES: Record<number, { body: () => string; cta: [string, string] | null; titleMax?: number }> = {
  1: { body: slide1, cta: null },
  2: { body: slide2, cta: null },
  3: { body: slide3, cta: ["Check them", URL], titleMax: 150 },
  4: { body: slide4, cta: null },
};

function html(i: number): string {
  const s = SLIDES[i];
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=block" rel="stylesheet">
<style>${css}</style></head><body><div class="poster">
  <div class="head" id="head">${s.body()}</div>
  ${s.cta ? `<p class="cta" id="cta"><b>${esc(s.cta[0])}</b><span>${esc(s.cta[1])}</span></p>` : ""}
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
    for (const i of [1, 2, 3, 4]) {
      if (ONLY && !ONLY.has(i)) continue;
      const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await p.setContent(html(i), { waitUntil: "networkidle" });
      await p.evaluate(() => document.fonts.ready);
      await p.evaluate("globalThis.__name = (f) => f"); // tsx names inner functions with a helper the page lacks
      // Each title line fills the column's width, all lines at the size of the widest.
      await p.evaluate((max) => {
        const t = document.getElementById("title")!, head = document.getElementById("head")!;
        const lines = [...t.children] as HTMLElement[];
        let size = 60;
        t.style.fontSize = `${size}px`;
        const widest = () => Math.max(...lines.map((l) => l.getBoundingClientRect().width));
        while (widest() < head.clientWidth - 2 && size < max) t.style.fontSize = `${++size}px`;
        while (widest() > head.clientWidth && size > 30) t.style.fontSize = `${--size}px`;
      }, SLIDES[i].titleMax ?? 260);
      const lay = await p.evaluate(() => {
        const head = document.getElementById("head")!.getBoundingClientRect();
        const cta = document.getElementById("cta")?.getBoundingClientRect();
        const fine = document.getElementById("fine")!.getBoundingClientRect();
        const foot = document.querySelector(".foot")!.getBoundingClientRect();
        const clipped = [...document.querySelectorAll(".stack > div, .rrow span, .meta span")].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent);
        const metaOverlap = [...document.querySelectorAll(".meta")].some((m) => {
          const [a, b] = [...m.children].map((c) => c.getBoundingClientRect());
          return a && b && a.right > b.left - 8;
        });
        return { headBottom: head.bottom, limit: cta ? cta.top : foot.top, fineBottom: fine.bottom, footBottom: foot.bottom, clipped, metaOverlap };
      });
      fits(lay.headBottom <= lay.limit - 14, `slide ${i}: the content runs into the ${i === 3 ? "call to action" : "footer"} (${Math.round(lay.headBottom)} > ${Math.round(lay.limit)})`);
      fits(lay.fineBottom <= lay.footBottom - 8, `slide ${i}: the fine print runs out of the footer (${Math.round(lay.fineBottom)} > ${Math.round(lay.footBottom)})`);
      fits(lay.clipped.length === 0, `slide ${i}: clipped text: ${lay.clipped.join(" | ")}`);
      fits(!lay.metaOverlap, `slide ${i}: a row's removed and remaining figures touch`);
      const png = join(OUT, `senate-removed-by-documents-${i}of4-${W}x${H}.png`);
      await p.screenshot({ path: png });
      console.log(`slide ${i} · content ends ${Math.round(lay.headBottom)} / ${Math.round(lay.limit)} → ${png}`);
      await p.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
