/**
 * "INSERTIONS RANKED" — campaign poster: the photos of the district
 * representatives as a ranked grid, in the style of "We are not ignorant".
 *
 * The ranking is the leaderboard's "Largest budget in projects the House
 * added" (added-budget): insertion candidates — House bill projects with no
 * matching NEP line — summed per DPWH office group (leaderboard.json). Every
 * face is the representative of a legislative district that office serves;
 * a shared office's amount is shown whole on each of its districts, marked
 * shared, never split. Districts whose office has no insertion candidates
 * follow, unranked. The footer says what the ranking is and is not: amounts
 * belong to DPWH offices; the documents do not say who asked for any project.
 *
 *   npm run build:hgab-poster-ranked -- [--title="…|…"] [--variants=block,overlay] [--out=dir] [--only=print,post,story,og,cover]
 *
 * Writes to data/hgab/2027/campaign/ (published with upload:hgab):
 *   insertions-ranked-24x36.pdf / .png, -1080x1350.png, -1080x1920.png,
 *   -1200x630.png (link preview), -fb-cover-1640x624.png; the overlay variant
 *   (faces fill the poster, the headline sits on top) as insertions-ranked-overlay-*.
 */
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  BOARDS, asOfText, deoBadge, displayName, formatValue, rankEntries,
  type LeaderboardData,
} from "../src/lib/hgab-leaderboard.ts";

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`build-hgab-poster-ranked: ${msg}`); process.exit(1); }
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const ROOT = resolve(import.meta.dirname, "..");
const DATA = join(ROOT, "data/hgab/2027");
const OUT = resolve(args.out ?? join(DATA, "campaign"));
const ONLY = (args.only as string | undefined)?.split(",");
/** Two headline lines; the second prints red. */
const TITLE: [string, string] = (() => {
  const t = (args.title as string | undefined)?.split("|").map((s) => s.trim()).filter(Boolean);
  return t && t.length >= 2 ? [t[0], t[1]] : ["Insertions", "ranked"];
})();
/** "block": the headline takes its own cells in the grid; "overlay": the faces fill the whole poster and the headline sits on top in paper boxes. */
type Variant = "block" | "overlay";
const VARIANTS: Variant[] = ((args.variants as string | undefined)?.split(",") ?? ["block", "overlay"])
  .filter((v): v is Variant => v === "block" || v === "overlay");
const URL_PATH = "/hgab/2027/leaderboard/added-budget";
const SITE = "budget.bettergov.ph";

const data = JSON.parse(readFileSync(join(DATA, "leaderboard.json"), "utf8")) as LeaderboardData;
const board = BOARDS.find((b) => b.id === "added-budget");
ensure(board, "the added-budget board is missing from the contract");
const ranked = rankEntries(data, board).rows;
ensure(ranked.length > 0, "no ranked rows");

interface Tile {
  rank: number | null;
  shared: number;
  name: string;
  district: string;
  badge: string;
  amount: string;
  photo: string | null;
  initials: string;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const initialsOf = (n: string) => n.replace(/[“"][^”"]*[”"]/g, " ").split(/\s+/).filter((w) => /^[A-Za-zÀ-ž]/.test(w)).map((w) => w[0]).filter(Boolean).slice(0, 1).concat(n.split(/\s+/).filter((w) => /^[A-Za-zÀ-ž]/.test(w)).slice(-1).map((w) => w[0])).join("").toUpperCase() || "?";
const districtShort = (j: string, label: string) => `${j} ${label.replace(/\s*District$/i, "").replace(/^Lone$/i, "(lone)")}`;

const tiles: Tile[] = [];
const inRanking = new Set<string>();
for (const r of ranked) {
  inRanking.add(r.entry.key);
  const officeNames = r.entry.offices.map((o) => o.name);
  for (const p of [...r.entry.people].sort((a, b) => a.district.localeCompare(b.district))) {
    const name = displayName(p.name);
    tiles.push({
      rank: r.rank,
      shared: r.entry.people.length > 1 ? r.entry.people.length : 0,
      name,
      district: districtShort(p.jurisdiction, p.district_label),
      badge: officeNames.map((o) => deoBadge(o, p.jurisdiction)).join(" + "),
      amount: formatValue(r.value, "php"),
      photo: p.portrait_url,
      initials: initialsOf(name),
    });
  }
}
const unrankedPeople = data.entries.filter((e) => !inRanking.has(e.key))
  .flatMap((e) => e.people.map((p) => ({ e, p })))
  .sort((a, b) => a.p.district.localeCompare(b.p.district));
for (const { e, p } of unrankedPeople) {
  const name = displayName(p.name);
  tiles.push({
    rank: null,
    shared: e.people.length > 1 ? e.people.length : 0,
    name,
    district: districtShort(p.jurisdiction, p.district_label),
    badge: e.offices.map((o) => deoBadge(o.name, p.jurisdiction)).join(" + "),
    amount: "none",
    photo: p.portrait_url,
    initials: initialsOf(name),
  });
}
const RANKED_PEOPLE = tiles.filter((t) => t.rank != null).length;
const DISTRICT_TOTAL = ranked.reduce((a, r) => a + r.value, 0);
const OUTSIDE = (["central", "regional", "no_office", "office_change"] as const)
  .reduce((a, k) => a + (data.totals.by_office_kind[k]?.added_php ?? 0), 0);
const AS_OF = asOfText(data);
const billions = (n: number) => `₱${(n / 1e9).toFixed(2)}B`;

function tileHtml(t: Tile): string {
  const face = t.photo
    ? `<img src="${esc(t.photo)}" alt="" loading="eager" referrerpolicy="no-referrer">`
    : `<span class="ini">${esc(t.initials)}</span>`;
  return `<div class="t${t.rank == null ? " none" : ""}">`
    + `<div class="ph">${face}${t.rank != null ? `<b class="rk">#${t.rank}</b>` : ""}${t.shared ? `<i class="sh">shared ×${t.shared}</i>` : ""}</div>`
    + `<div class="lb"><div class="am">${esc(t.amount)}</div><div class="nm">${esc(t.name)}</div>`
    + `<div class="ds">${esc(t.district)} <span class="dg">${esc(t.badge)}</span></div></div></div>`;
}

interface Format {
  key: string;
  file: string;
  w: number;
  h: number;
  /** Grid columns; "auto" solves for the fewest columns that fit every tile. */
  cols: number | "auto";
  /** Headline block, in grid cells: columns as a share of the grid, rows as a share of the grid height; `fromX` starts it at the first column at or after that x (CSS px). */
  block: { colShare: number; rowShare: number; fromX?: number };
  /** Footer side padding override (CSS px), e.g. to keep the cover's text inside the phone-safe band. */
  footPad?: [number, number];
  pdf?: { width: string; height: string };
  scale: number;
  foot: number;
}
const FORMATS: Format[] = [
  { key: "print", file: "insertions-ranked-24x36", w: 2304, h: 3456, cols: "auto", block: { colShare: 0.56, rowShare: 0.27 }, pdf: { width: "24in", height: "36in" }, scale: 3600 / 2304, foot: 300 },
  // Social sizes: dense on purpose, as many faces as fit; small tiles keep the rank and amount only.
  { key: "post", file: "insertions-ranked-1080x1350", w: 1080, h: 1350, cols: 11, block: { colShare: 0.73, rowShare: 0.3 }, scale: 1, foot: 160 },
  { key: "story", file: "insertions-ranked-1080x1920", w: 1080, h: 1920, cols: 11, block: { colShare: 1, rowShare: 0.2 }, scale: 1, foot: 200 },
  { key: "og", file: "insertions-ranked-1200x630", w: 1200, h: 630, cols: 17, block: { colShare: 0.42, rowShare: 1 }, scale: 1, foot: 92 },
  // Facebook cover: phones keep only the centre (x 265–1375), so the headline and the footer text sit there; faces fill both sides.
  { key: "cover", file: "insertions-ranked-fb-cover-1640x624", w: 1640, h: 624, cols: 24, block: { colShare: 0.3, rowShare: 1, fromX: 275 }, scale: 1, foot: 74, footPad: [290, 275] },
];

function html(f: Format, variant: Variant): string {
  const headHtml = `<div class="head${variant === "overlay" ? " overlay" : ""}" id="head">
      <div class="kick">2027 House bill · DPWH projects</div>
      <h1 id="h1"><span>${esc(TITLE[0])}</span><span class="red">${esc(TITLE[1])}</span></h1>
      <p class="sub">${billions(DISTRICT_TOTAL)} in House bill projects with no matching NEP line, under the DPWH offices that serve these ${RANKED_PEOPLE} districts.</p>
      <p class="call">Find your district. Ask your representative.</p>
    </div>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@500;700&display=block" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${f.w}px; height: ${f.h}px; overflow: hidden; background: #f3eee4; }
  .poster { position: relative; width: ${f.w}px; height: ${f.h}px; overflow: hidden; background: #f3eee4; color: #141414; font-family: Inter, sans-serif; }
  .grid { position: absolute; left: var(--pad); right: var(--pad); top: var(--pad); height: var(--gh); display: grid; grid-template-columns: repeat(var(--cols), 1fr); grid-auto-rows: var(--th); gap: var(--gap); align-content: start; }
  .head { grid-column: var(--bs) / span var(--bc); grid-row: 1 / span var(--br); display: flex; flex-direction: column; justify-content: flex-start; overflow: hidden; padding-right: var(--gap); }
  .kick { font-family: 'JetBrains Mono', monospace; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #141414; font-size: var(--kick); }
  h1 { font-family: Anton, Impact, sans-serif; font-weight: 400; text-transform: uppercase; line-height: 0.86; margin-top: 0.08em; }
  h1 span { display: block; white-space: nowrap; }
  h1 .red { color: #d62828; }
  .sub { font-weight: 700; line-height: 1.2; margin-top: 0.5em; font-size: var(--sub); }
  .call { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #fff; background: #d62828; align-self: flex-start; padding: 0.25em 0.5em; margin-top: 0.6em; font-size: var(--call); letter-spacing: 0.04em; }
  .t { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
  .t .ph { position: relative; width: 100%; aspect-ratio: 1 / 1; background: #ddd5c6; overflow: hidden; }
  .t .ph img { width: 100%; height: 100%; object-fit: cover; object-position: 50% 18%; filter: grayscale(1) contrast(1.08); mix-blend-mode: multiply; display: block; }
  .t .ph::after { content: ""; position: absolute; inset: 0; background: rgba(214, 40, 40, var(--tint)); mix-blend-mode: multiply; pointer-events: none; }
  .t.none .ph::after { background: rgba(243, 238, 228, 0.45); mix-blend-mode: normal; }
  .t .ini { position: absolute; inset: 0; display: grid; place-items: center; font-family: Anton, sans-serif; font-size: calc(var(--tw) * 0.34); color: #8a8070; }
  .t .rk { position: absolute; left: 0; top: 0; background: #d62828; color: #fff; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: calc(var(--tw) * 0.11); padding: 0.1em 0.3em; z-index: 1; }
  .t .sh { position: absolute; right: 0; bottom: 0; background: #141414; color: #f3eee4; font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: calc(var(--tw) * 0.07); padding: 0.1em 0.3em; z-index: 1; }
  .t .lb { padding-top: calc(var(--tw) * 0.03); line-height: 1.12; }
  .t .am { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #b3121f; font-size: calc(var(--tw) * 0.105); }
  .t.none .am { color: #8a8070; font-weight: 500; }
  .t .nm { font-weight: 600; font-size: calc(var(--tw) * 0.074); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .t .ds { color: rgba(20, 20, 20, 0.7); font-size: calc(var(--tw) * 0.064); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* Small tiles: the face, the rank and the amount; names and districts are at the link. */
  .grid.compact .t .nm, .grid.compact .t .ds { display: none; }
  .grid.compact .t .am { font-size: calc(var(--tw) * 0.15); }
  .grid.compact .t .rk { font-size: calc(var(--tw) * 0.15); }
  .grid.compact .t .sh { font-size: calc(var(--tw) * 0.11); }
  .t .dg { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 0.92em; box-shadow: inset 0 0 0 1px rgba(20, 20, 20, 0.4); padding: 0 0.25em; color: #141414; }
  /* Overlay: the headline over the faces, each line on its own paper box (as on "We are not ignorant"). */
  .head.overlay { position: absolute; left: var(--ox); top: var(--pad); width: var(--ow); z-index: 5; align-items: flex-start; padding: 0; overflow: visible; }
  .head.overlay .kick, .head.overlay .sub { width: fit-content; background: #f3eee4; padding: 0.15em 0.4em; box-shadow: 0 0 0 0.12em #f3eee4; }
  .head.overlay h1 span { width: fit-content; background: #f3eee4; padding: 0 0.06em; box-shadow: 0 0 0 0.04em #f3eee4; }
  .head.overlay h1 span + span { margin-top: 0.05em; }
  .head.overlay .sub { max-width: 100%; }
  .foot { position: absolute; left: 0; right: 0; bottom: 0; height: ${f.foot}px; background: #111; color: rgba(243, 238, 228, 0.85); display: flex; flex-direction: ${f.w / f.h > 1.6 ? "row" : "column"}; justify-content: center; align-items: ${f.w / f.h > 1.6 ? "center" : "flex-start"}; gap: calc(var(--pad) * 0.35) var(--pad); padding: 0 var(--pad); }
  .foot .url { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #fff; font-size: var(--url); white-space: nowrap; }
  .foot .fine { font-size: var(--fine); line-height: 1.32; }
  .foot .fine strong { color: #fff; font-weight: 600; }
</style></head><body><div class="poster" id="poster">
  <div class="grid" id="grid">${variant === "block" ? headHtml : ""}</div>
  ${variant === "overlay" ? headHtml : ""}
  <div class="foot">
    <div class="url">${SITE}${URL_PATH}</div>
    <div class="fine" id="fine"></div>
  </div>
</div></body></html>`;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const f of FORMATS) for (const variant of VARIANTS) {
      if (ONLY && !ONLY.includes(f.key)) continue;
      const file = variant === "overlay" ? f.file.replace("insertions-ranked", "insertions-ranked-overlay") : f.file;
      const page = await browser.newPage({ viewport: { width: f.w, height: f.h }, deviceScaleFactor: f.scale });
      await page.setContent(html(f, variant), { waitUntil: "networkidle", timeout: 120000 });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate("globalThis.__name = (f) => f");
      const res = await page.evaluate(({ f, variant, tiles, ranked, outside, asOf, district }) => {
        const overlay = variant === "overlay";
        const pad = Math.round(f.w * 0.018);
        const gap = Math.max(4, Math.round(f.w * 0.005));
        const grid = document.getElementById("grid")!;
        const head = document.getElementById("head")!;
        const poster = document.getElementById("poster")!;
        const gh = f.h - f.foot - pad * 2;
        const gw = f.w - pad * 2;
        const compactAt = 96; // tiles narrower than this keep only the rank and the amount
        const labelFor = (tw: number) => (tw < compactAt ? 0.2 : 0.36); // label height as a share of tile width
        const solve = (cols: number) => {
          const tw = (gw - gap * (cols - 1)) / cols;
          const th = tw * (1 + labelFor(tw));
          const rows = Math.floor((gh + gap) / (th + gap));
          const bc = overlay ? 0 : Math.max(1, Math.round(cols * f.block.colShare));
          const br = overlay ? 0 : Math.max(1, Math.min(rows, Math.round(rows * f.block.rowShare)));
          return { cols, tw, th, rows, bc, br, cap: cols * rows - bc * br };
        };
        let s = solve(typeof f.cols === "number" ? f.cols : 8);
        if (f.cols === "auto") for (let c = 8; c <= 40; c++) { s = solve(c); if (s.cap >= tiles.length) break; }
        const shown = Math.min(tiles.length, s.cap);
        // Stretch the rows to fill the height exactly (the spare space goes under each label).
        s.th = (gh + gap) / s.rows - gap;
        poster.style.setProperty("--pad", `${pad}px`);
        poster.style.setProperty("--gap", `${gap}px`);
        grid.style.setProperty("--cols", String(s.cols));
        grid.style.setProperty("--th", `${s.th}px`);
        grid.style.setProperty("--gh", `${gh}px`);
        grid.style.setProperty("--tw", `${s.tw}px`);
        poster.style.setProperty("--tw", `${s.tw}px`);
        grid.style.setProperty("--bc", String(s.bc));
        const pitch = s.tw + gap;
        const bs = !overlay && f.block.fromX ? Math.min(s.cols - s.bc + 1, Math.ceil((f.block.fromX - pad) / pitch) + 1) : 1;
        grid.style.setProperty("--bs", String(bs));
        grid.style.setProperty("--br", String(s.br));
        grid.style.setProperty("--tint", "0.18");
        if (s.tw < compactAt) grid.classList.add("compact");
        if (f.footPad) (document.querySelector(".foot") as HTMLElement).style.padding = `0 ${f.footPad[1]}px 0 ${f.footPad[0]}px`;
        grid.insertAdjacentHTML("beforeend", tiles.slice(0, shown).join(""));

        // Headline: fit the title, then the sub and call lines, to the block (or the overlay box).
        const bw = overlay ? gw * f.block.colShare : s.bc * s.tw + (s.bc - 1) * gap - gap;
        const bh = overlay ? gh * f.block.rowShare : s.br * s.th + (s.br - 1) * gap;
        if (overlay) {
          poster.style.setProperty("--ox", `${f.block.fromX ?? pad}px`);
          poster.style.setProperty("--ow", `${bw}px`);
        }
        const h1 = document.getElementById("h1")!;
        let lo = 8, hi = 600;
        const set = (px: number) => {
          head.style.setProperty("--kick", `${Math.max(9, px * 0.085)}px`);
          h1.style.fontSize = `${px}px`;
          head.style.setProperty("--sub", `${Math.max(10, px * 0.13)}px`);
          head.style.setProperty("--call", `${Math.max(9, px * 0.1)}px`);
        };
        const fits = () => [...h1.children].every((c) => (c as HTMLElement).scrollWidth <= bw + 0.5) && head.scrollHeight <= bh + 0.5;
        for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; set(mid); if (fits()) lo = mid; else hi = mid; }
        set(Math.floor(lo));

        // Place every tile explicitly: block cells are skipped; in the overlay, cells under the
        // headline's boxes come last; on the cover, the phone-safe centre band comes first.
        const gridRect = grid.getBoundingClientRect();
        const boxes = overlay ? [...head.querySelectorAll(".kick, h1 span, .sub, .call")].map((e) => e.getBoundingClientRect()) : [];
        const cellRect = (r: number, c: number) => ({ x: gridRect.left + (c - 1) * pitch, y: gridRect.top + (r - 1) * (s.th + gap), w: s.tw, h: s.tw });
        const under = (r: number, c: number) => {
          const cr = cellRect(r, c);
          return boxes.some((b) => cr.x < b.right && cr.x + cr.w > b.left && cr.y < b.bottom && cr.y + cr.h > b.top);
        };
        const safe = (c: number) => {
          if (!f.block.fromX) return true;
          const x0 = pad + (c - 1) * pitch;
          return x0 >= f.block.fromX - 10 && x0 + s.tw <= f.w - (f.footPad?.[1] ?? 0) + 10;
        };
        const cells: { r: number; c: number; key: number }[] = [];
        let covered = 0;
        for (let r = 1; r <= s.rows; r++) for (let c = 1; c <= s.cols; c++) {
          if (!overlay && r <= s.br && c >= bs && c < bs + s.bc) continue;
          const u = overlay && under(r, c);
          if (u) covered++;
          cells.push({ r, c, key: (u ? 2 : 0) + (safe(c) ? 0 : 1) });
        }
        cells.sort((x, y) => x.key - y.key || x.r - y.r || x.c - y.c);
        [...grid.querySelectorAll(".t")].forEach((el, i) => {
          const cell = cells[i];
          if (cell) (el as HTMLElement).style.gridArea = `${cell.r} / ${cell.c}`;
        });

        const foot = document.querySelector(".foot") as HTMLElement;
        const wide = f.w / f.h > 1.6;
        foot.style.setProperty("--url", `${Math.max(11, wide ? f.foot * 0.2 : f.w * 0.024)}px`);
        foot.style.setProperty("--fine", `${Math.max(9.5, wide ? f.foot * 0.13 : f.w * 0.0105)}px`);
        const all = shown >= tiles.length;
        const behind = overlay && covered > 0 ? "; some sit partly behind the title" : "";
        document.getElementById("fine")!.innerHTML =
          `<strong>${all ? `All ${tiles.length} district representatives with a DPWH office${behind}` : `The top ${shown} of ${tiles.length} district representatives${behind} (names, districts and every face at the link)`}</strong>, ranked by insertion candidates (House bill projects with no matching NEP line) under the DPWH office that serves their district: ${district} in all; ${outside} more sits under Central Office and regional offices, in no district. `
          + `Amounts belong to DPWH offices, not to representatives; the documents do not say who asked for any project. A shared office's amount appears whole on each district it serves, not split. Candidates are a document comparison, not evidence of wrongdoing. Party-list members and districts with no DPWH office are not shown. Photos: House of Representatives, public domain. ${asOf}.`;
        const fineEl = document.getElementById("fine")!;
        let fs = parseFloat(getComputedStyle(fineEl).fontSize);
        while (fineEl.scrollHeight > f.foot - 8 && fs > 7) { fs -= 0.25; fineEl.style.fontSize = `${fs}px`; }
        const imgs = [...document.querySelectorAll(".t img")] as HTMLImageElement[];
        return { cols: s.cols, tw: Math.round(s.tw), shown, total: tiles.length, ranked, covered, title: Math.floor(lo), images: imgs.length, headFits: fits(), fineFits: fineEl.scrollHeight <= f.foot - 8 };
      }, { f, variant, tiles: tiles.map(tileHtml), ranked: RANKED_PEOPLE, outside: billions(OUTSIDE), asOf: AS_OF, district: billions(DISTRICT_TOTAL) });
      // Wait for every portrait (they load from the portrait host).
      await page.waitForFunction(() => [...document.querySelectorAll(".t img")].every((i) => (i as HTMLImageElement).complete), null, { timeout: 180000 });
      const broken = await page.evaluate(() => [...document.querySelectorAll(".t img")].filter((i) => !(i as HTMLImageElement).naturalWidth).length);
      ensure(res.headFits, `${f.key} ${variant}: the headline does not fit its block`);
      ensure(res.fineFits, `${f.key}: the footer text does not fit`);
      ensure(broken === 0, `${f.key}: ${broken} portraits failed to load`);
      if (f.key === "print") ensure(res.shown === res.total, `print: only ${res.shown} of ${res.total} tiles fit`);
      const png = join(OUT, `${file}.png`);
      await page.screenshot({ path: png });
      if (f.pdf) await page.pdf({ path: join(OUT, `${file}.pdf`), width: f.pdf.width, height: f.pdf.height, printBackground: true, pageRanges: "1" });
      console.log(`${f.key.padEnd(5)} ${variant.padEnd(7)} ${f.w}×${f.h} · ${res.cols} cols, tiles ${res.tw}px · ${res.shown} of ${res.total} faces (${res.ranked} ranked${res.covered ? `, ${res.covered} cells under the title` : ""}) · title ${res.title}px → ${png}${f.pdf ? " + .pdf" : ""}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(OUT, "README-insertions-ranked.txt"), [
    "INSERTIONS RANKED — campaign poster (npm run build:hgab-poster-ranked)",
    `From data/hgab/2027/leaderboard.json (${data.built_at}), board added-budget: ${RANKED_PEOPLE} ranked faces, ${tiles.length} in all.`,
    `Title: ${TITLE.join(" / ")}. Link: https://${SITE}${URL_PATH}`,
    "",
  ].join("\n"));
}

void main();
