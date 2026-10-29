/**
 * "₱83.7 billion for multi-purpose buildings. ₱27.5 billion for school facilities.
 * ₱10.1 billion for health facilities." — the campaign poster for /hgab/2027/multi-purpose.
 * Always "facilities": these are DepEd's and DOH's facility lines, not all of education or healthcare.
 *
 * The figures are the 2027 House bill's, read from data/hgab/2027/history.json
 * (npm run build:hgab-history): multi-purpose buildings (DPWH, BIP line), DepEd's
 * Basic Education Facilities and DOH's Health Facilities Enhancement Program, the
 * NEP beside them, and the FY2026 NEP and GAA for the line under the headline. Each
 * figure has a bar drawn to scale. The school-facilities bar has a grey extension for
 * DepEd's other lines for school facilities in the House bill (Quick Response Fund, the
 * World Bank school project, school sites; history.json "extras"), labelled beside it
 * and listed under it on the tall formats.
 *
 * The background is the real list, as on the "We are not ignorant" poster: every
 * multi-purpose building project the House bill lists (dpwh/projects.parquet, the
 * same filter the page's card opens), largest first, each with its amount as
 * published and a red INSERTED tag when it has no matching NEP line. Nothing is
 * generated; there is no artwork layer.
 *
 * Renders in headless Chromium (playwright-core), the "We are not ignorant" poster's
 * type (Anton, Inter, JetBrains Mono), paper and footer, and writes to --out
 * (default data/hgab/2027/campaign/, gitignored):
 *   multi-purpose-24x36.pdf / .png         print master (vector text) and a 150 dpi preview; every project in the wall
 *   multi-purpose-1080x1350.png            feed post (4:5)
 *   multi-purpose-1080x1920.png            story (9:16)
 *   multi-purpose-1200x630.png             link preview (og:image) for the page
 *   multi-purpose-fb-cover-1640x624.png    Facebook cover (centre band safe for phones)
 *
 * Usage: npm run build:hgab-poster-mpb -- [--out=dir] [--only=print,post,story,og,cover]
 * Needs network access for Google Fonts.
 */
import { DuckDBInstance } from "@duckdb/node-api";
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { columnIndex, type HistoryData, type HistorySeries } from "../src/lib/hgab-history.ts";

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`build-hgab-poster-mpb: ${msg}`); process.exit(1); }
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const ROOT = resolve(import.meta.dirname, "..");
const DATA = join(ROOT, "data/hgab/2027");
const OUT = resolve(args.out ?? join(DATA, "campaign"));
const ONLY = (args.only as string | undefined)?.split(",");
const URL_TEXT = "budget.bettergov.ph/hgab/2027/multi-purpose";

// ---------------------------------------------------------------------------
// The figures, from history.json
// ---------------------------------------------------------------------------

const H = JSON.parse(readFileSync(join(DATA, "history.json"), "utf8")) as HistoryData;
const S = (key: string): HistorySeries => {
  const s = H.series.find((x) => x.key === key);
  ensure(s, `series ${key} missing from history.json; run npm run build:hgab-history`);
  return s;
};
const at = (s: HistorySeries, col: string): number => {
  const v = s.php[columnIndex(col)];
  ensure(v != null && v > 0, `${s.key} has no amount for ${col}`);
  return v;
};
const mpb = S("mpb"), deped = S("deped"), hfep = S("hfep");
const F = {
  mpb: at(mpb, "house-2027"), mpbNep: at(mpb, "nep-2027"),
  deped: at(deped, "house-2027"), depedNep: at(deped, "nep-2027"),
  hfep: at(hfep, "house-2027"), hfepNep: at(hfep, "nep-2027"),
  mpbNep26: at(mpb, "nep-2026"), mpbGaa26: at(mpb, "gaa-2026"),
};
const list = mpb.list2027;
ensure(list && list.dataset === "dpwh", "history.json has no 2027 list for multi-purpose buildings");
/** DepEd's other lines for school facilities (Volume I-A), drawn as the school bar's grey extension. */
const more = (H.extras ?? []).filter((x) => x.series === "deped");
ensure(more.length > 0 && more.every((x) => x.house_php != null && x.house_php > 0 && x.nep_php != null),
  "history.json has no House-bill amounts for DepEd's other lines; run npm run build:hgab-history");
const sum = (xs: Array<number | null>) => xs.reduce<number>((a, v) => a + (v ?? 0), 0);
const MORE = { house: sum(more.map((x) => x.house_php)), nep: sum(more.map((x) => x.nep_php)) };

/** "₱83.7 billion" (one decimal; the page's rounding). */
const billion = (v: number) => `₱${(v / 1e9).toFixed(1)} billion`;
/** "₱3.0B" for the list under the school bar. */
const bShort = (v: number) => `₱${(v / 1e9).toFixed(1)}B`;
const ratio = F.mpb / F.mpbNep;
const twice = Math.abs(ratio - 2) < 0.05 ? "Twice" : `${ratio.toFixed(1)} times`;
// "Less than in the NEP" must hold for the line and for all of DepEd's lines for school facilities.
const bothLess = F.deped < F.depedNep && F.deped + MORE.house < F.depedNep + MORE.nep && F.hfep < F.hfepNep;
const MORE_LABEL = `+ ${billion(MORE.house)} in DepEd’s other lines`;
/** Under the school bar on the tall formats: the other lines, then the total on its own line. */
const MORE_LIST = [
  more.map((x, i) => `${i === 0 ? x.plain[0].toUpperCase() + x.plain.slice(1) : x.plain} ${bShort(x.house_php!)}`).join(" · ") + ".",
  `All ${more.length === 3 ? "four" : more.length + 1} lines: ${billion(F.deped + MORE.house)}.`,
];
const asOf = (() => {
  const d = new Date(H.built_at);
  return Number.isNaN(d.getTime()) ? "" : `As of ${d.toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric" })}`;
})();

// ---------------------------------------------------------------------------
// The wall: every multi-purpose building project the House bill lists
// ---------------------------------------------------------------------------

interface Line { title: string; house: number; inserted: boolean; unconfirmed: boolean; region: string | null }
async function wallLines(): Promise<Line[]> {
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  const where = Object.entries(list!.params).map(([k, v]) => `${k} = '${v.replace(/'/g, "''")}'`).join(" AND ");
  const rows = (await c.runAndReadAll(`
    SELECT title, hgab3_php, trace, region FROM read_parquet('${join(DATA, "dpwh", "projects.parquet")}')
    WHERE ${where} AND hgab3_php IS NOT NULL ORDER BY hgab3_php DESC, title`)).getRows();
  c.closeSync(); db.closeSync();
  // Inserted = no matching NEP line (house_only), unconfirmed matches included, as on the changes list.
  return rows.map((r) => ({
    title: String(r[0] ?? "").replace(/\s+/g, " ").trim(),
    house: Number(r[1]),
    inserted: /house_only|fuzzy_candidate|ambiguous/.test(String(r[2] ?? "")),
    unconfirmed: /fuzzy_candidate|ambiguous/.test(String(r[2] ?? "")),
    region: r[3] == null ? null : String(r[3]),
  }));
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
function entry(l: Line, i: number): string {
  const tag = l.inserted ? `<em class="k k-in">INSERTED</em> ` : "";
  return `<span class="e${l.inserted ? " is-in" : ""}"><s>${(i + 1).toLocaleString("en-US")}</s> ${tag}<b>₱${l.house.toLocaleString("en-US")}</b> ${esc(l.title)}${l.region ? ` <i>${esc(l.region)}</i>` : ""}</span>`;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const dataUri = (path: string, type: string) => `data:${type};base64,${readFileSync(path).toString("base64")}`;
const LOGO = dataUri(join(ROOT, "public/brand/bettergov-horizontal-white.png"), "image/png");

interface Format {
  key: string;
  file: string;
  w: number;
  h: number;
  wall: "all" | number;
  pdf?: { width: string; height: string };
  scale: number;
}
const FORMATS: Format[] = [
  { key: "print", file: "multi-purpose-24x36", w: 2304, h: 3456, wall: "all", pdf: { width: "24in", height: "36in" }, scale: 3600 / 2304 },
  { key: "post", file: "multi-purpose-1080x1350", w: 1080, h: 1350, wall: 7.2, scale: 1 },
  { key: "story", file: "multi-purpose-1080x1920", w: 1080, h: 1920, wall: 7.2, scale: 1 },
  { key: "og", file: "multi-purpose-1200x630", w: 1200, h: 630, wall: 5.6, scale: 1 },
  { key: "cover", file: "multi-purpose-fb-cover-1640x624", w: 1640, h: 624, wall: 5.2, scale: 1 },
];
/** The centre band a Facebook cover keeps on phones (x from, x to), in CSS px of the 1640-wide cover. */
const COVER_SAFE: [number, number] = [265, 1375];

/** Sizes per format, in units of 1% of the poster width (the cover in px). */
function sizes(f: Format) {
  const u = f.w / 100;
  if (f.key === "cover") return { u, foot: 74, kicker: 15, a1: 90, f1: 43, a2: 33, bar1: 17, bar2: 13, more: 13, sub: 19, cta: 15, gap: 8, top: 24, left: COVER_SAFE[0] + 10, width: 700 };
  if (f.w > f.h) return { u, foot: 10 * u, kicker: 1.35 * u, a1: 8.2 * u, f1: 3.95 * u, a2: 3.35 * u, bar1: 1.9 * u, bar2: 1.4 * u, more: 1.3 * u, sub: 1.8 * u, cta: 1.45 * u, gap: 0.8 * u, top: 2.4 * u, left: 3 * u, width: 62 * u };
  if (f.key === "print") return { u, foot: 13 * u, kicker: 2.4 * u, a1: 15.2 * u, f1: 7.3 * u, a2: 5.6 * u, bar1: 3.8 * u, bar2: 2.9 * u, more: 2.2 * u, sub: 3.25 * u, cta: 2.6 * u, gap: 2.1 * u, top: 5.5 * u, left: 4 * u, width: 92 * u };
  if (f.h / f.w > 1.6) return { u, foot: 17 * u, kicker: 2.6 * u, a1: 15.4 * u, f1: 7.4 * u, a2: 5.6 * u, bar1: 3.8 * u, bar2: 2.9 * u, more: 2.3 * u, sub: 3.6 * u, cta: 2.7 * u, gap: 1.8 * u, top: 9 * u, left: 4 * u, width: 92 * u };
  return { u, foot: 14.5 * u, kicker: 2.3 * u, a1: 14 * u, f1: 6.8 * u, a2: 5.4 * u, bar1: 3.4 * u, bar2: 2.6 * u, more: 2.1 * u, sub: 3.25 * u, cta: 2.4 * u, gap: 1.5 * u, top: 4.5 * u, left: 4 * u, width: 92 * u };
}

function html(f: Format): string {
  const z = sizes(f);
  const pct = (v: number) => `${((v / F.mpb) * 100).toFixed(2)}%`;
  /** The same scale in px, for the school bar's two segments (its row sizes to fit them and the label). */
  const px = (v: number) => `${((v / F.mpb) * z.width).toFixed(2)}px`;
  const wide = f.w > f.h; // og and cover: no 2026 line
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@500;700&display=block" rel="stylesheet">
<style>
  @page { size: ${f.pdf ? `${f.pdf.width} ${f.pdf.height}` : `${f.w}px ${f.h}px`}; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${f.w}px; height: ${f.h}px; background: #f3eee4; overflow: hidden; }
  .poster { position: relative; width: ${f.w}px; height: ${f.h}px; overflow: hidden; background: #f3eee4; color: #141414; --paper: #f3eee4; --red: #d62828; }
  /* The wall: every project, run in, justified, edge to edge above the footer. */
  .wall {
    position: absolute; left: ${1.6 * z.u}px; right: ${1.6 * z.u}px; top: ${1.4 * z.u}px; bottom: ${z.foot}px;
    font-family: Inter, sans-serif; text-align: justify; hyphens: none; overflow: hidden;
    color: rgba(20, 20, 20, 0.6); line-height: 1.22; word-spacing: 0.02em;
  }
  .wall .e b { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #141414; letter-spacing: -0.02em; }
  .wall .e.is-in b { color: #b3121f; }
  .wall .e i { font-style: normal; color: rgba(20, 20, 20, 0.45); }
  .wall .e s { text-decoration: none; font-family: 'JetBrains Mono', monospace; color: rgba(20, 20, 20, 0.4); }
  .wall .e .k { font-style: normal; font-family: 'JetBrains Mono', monospace; font-weight: 700; letter-spacing: 0.04em; }
  .wall .e .k-in { color: #fff; background: #c8102e; padding: 0 0.25em; }
  .wall .e::after { content: " ■ "; color: #b3121f; }
  /* The headline: three figures, each with its bar to scale, on paper over the wall. */
  .head { position: absolute; left: ${z.left}px; width: ${z.width}px; top: ${z.top}px; }
  .pap { display: inline-block; width: fit-content; background: var(--paper); box-shadow: 0 0 0 ${0.35 * z.u}px var(--paper); }
  .kicker { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${z.kicker}px; letter-spacing: 0.12em; text-transform: uppercase; color: #141414; padding: 0 ${0.3 * z.u}px; }
  .fig { font-family: Anton, Impact, sans-serif; font-weight: 400; text-transform: uppercase; line-height: 0.9; letter-spacing: 0.005em; color: #111; white-space: nowrap; }
  .fig span { display: block; width: fit-content; padding: 0 ${0.5 * z.u}px; background: var(--paper); box-shadow: 0 0 0 ${0.3 * z.u}px var(--paper); }
  .row { margin-top: ${z.gap}px; }
  .row.r1 { margin-top: ${z.gap * 0.9}px; }
  .r1 .amt { font-size: ${z.a1}px; color: var(--red); }
  .r1 .for { font-size: ${z.f1}px; margin-top: ${0.25 * z.u}px; }
  .r2 .fig span { font-size: ${z.a2}px; }
  .bar { display: block; height: ${z.bar2}px; margin-top: ${0.6 * z.gap}px; background: #111; box-shadow: 0 0 0 ${0.35 * z.u}px var(--paper); border-radius: 0 4px 4px 0; }
  .r1 .bar { height: ${z.bar1}px; background: var(--red); }
  /* The school bar: the line, a paper gap, DepEd's other lines in grey, then their label. */
  .bars { display: flex; align-items: center; width: fit-content; max-width: 100%; margin-top: ${0.6 * z.gap}px; background: var(--paper); box-shadow: 0 0 0 ${0.35 * z.u}px var(--paper); }
  .bars .bar { flex: none; margin: 0; box-shadow: none; border-radius: 0; }
  .bars .bar.more { margin-left: ${Math.max(2, 0.15 * z.u)}px; background: #7d776c; border-radius: 0 4px 4px 0; }
  .more-lab { margin-left: ${0.8 * z.u}px; font-family: Inter, sans-serif; font-weight: 700; font-size: ${z.more}px; line-height: 1.1; white-space: nowrap; color: #111; }
  .more-list { margin-top: ${0.5 * z.gap}px; font-family: Inter, sans-serif; font-weight: 600; font-size: ${z.more * 0.92}px; line-height: 1.25; color: #111; padding: 0 ${0.3 * z.u}px; max-width: 100%; }
  .sub { margin-top: ${z.gap * 1.2}px; font-family: Inter, sans-serif; font-weight: 700; font-size: ${z.sub}px; line-height: 1.2; color: #111; padding: ${0.35 * z.u}px ${0.6 * z.u}px; max-width: 100%; }
  .sub.s2 { margin-top: ${0.4 * z.gap}px; font-weight: 600; font-size: ${z.sub * 0.74}px; }
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
${f.key === "cover" ? `  .foot { grid-template-columns: auto 1fr auto; grid-template-rows: 1fr; padding: 0 ${1640 - COVER_SAFE[1] + 10}px 0 330px; gap: 0 22px; }
  .foot .url { order: 1; grid-row: auto; white-space: nowrap; font-size: 18px; }
  .foot .fine { order: 2; grid-row: auto; font-size: 12px; line-height: 1.3; }
  .foot img { order: 3; grid-row: auto; height: 26px; }
  .sub { padding: 2px 6px; }
` : wide ? `  .foot { padding: ${1.1 * z.u}px ${2.6 * z.u}px; gap: ${0.3 * z.u}px ${2 * z.u}px; }
  .foot img { height: ${2.6 * z.u}px; }
  .foot .url { font-size: ${1.7 * z.u}px; }
  .foot .fine { font-size: ${0.95 * z.u}px; }
` : ""}</style></head><body><div class="poster">
  <div class="wall" id="wall"></div>
  <div class="head" id="head">
    <p class="kicker pap">The 2027 House budget bill</p>
    <div class="row r1">
      <div class="fig"><span class="amt">${billion(F.mpb)}</span><span class="for">for multi-purpose buildings</span></div>
      <i class="bar" style="width: 100%"></i>
    </div>
    <div class="row r2">
      <div class="fig"><span>${billion(F.deped)} for school facilities</span></div>
      <div class="bars"><i class="bar" style="width: ${px(F.deped)}"></i><i class="bar more" style="width: ${px(MORE.house)}"></i><span class="more-lab" id="more-lab">${esc(MORE_LABEL)}</span></div>
      ${wide ? "" : `<p class="more-list pap">${MORE_LIST.map(esc).join("<br>")}</p>`}
    </div>
    <div class="row r2">
      <div class="fig"><span>${billion(F.hfep)} for health facilities</span></div>
      <i class="bar" style="width: ${pct(F.hfep)}"></i>
    </div>
    <p class="sub pap">${twice} the NEP’s ${billion(F.mpbNep)}.${bothLess ? " School and health facilities get less than in the NEP." : ""}</p>
    ${wide ? "" : `<br><p class="sub s2 pap">In the 2026 budget, Congress raised them from ${billion(F.mpbNep26)} to ${billion(F.mpbGaa26)}.</p>`}
    <br><p class="cta">See the ${list!.house_rows.toLocaleString("en-US")} projects. Ask your representative.</p>
  </div>
  <div class="foot">
    <img src="${LOGO}" alt="BetterGov.PH">
    <div class="url">${URL_TEXT}</div>
    <div class="fine" id="fine"></div>
  </div>
</div></body></html>`;
}

async function main(): Promise<void> {
  const lines = await wallLines();
  ensure(lines.length === list!.house_rows, `${lines.length} wall lines, but the page's list has ${list!.house_rows}`);
  ensure(lines.reduce((a, l) => a + l.house, 0) === list!.house_php, "the wall's amounts do not add up to the House-bill figure");
  const ENTRIES = lines.map(entry);
  const inserted = lines.filter((l) => l.inserted).length;
  const unconfirmed = lines.filter((l) => l.unconfirmed).length;
  const fineAll = (shown: number) =>
    `<strong>${shown === lines.length ? `Background: all ${lines.length.toLocaleString("en-US")}` : `Background: the largest ${shown.toLocaleString("en-US")} of the ${lines.length.toLocaleString("en-US")}`} multi-purpose building projects in the House bill</strong>` +
    `${shown === lines.length ? "" : " (all of them at the link)"}, largest first; ${inserted.toLocaleString("en-US")} are INSERTED: no matching line in the NEP (${unconfirmed.toLocaleString("en-US")} of them unconfirmed matches), a candidate from comparing the two documents, not a finding of wrongdoing. ` +
    `Amounts as published in House Bill 10858 (third reading) and the 2027 NEP; allocations, not spending. School facilities: DepEd’s Basic Education Facilities; grey adds its ${more.map((x) => x.label).join(", ").replace(/, ([^,]*)$/, " and $1")} lines. Health facilities: DOH’s Health Facilities Enhancement Program. ` +
    `The documents do not say who asked for any project. People’s Budget Coalition × BetterGov.PH. ${asOf}.`;

  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const f of FORMATS) {
      if (ONLY && !ONLY.includes(f.key)) continue;
      const page = await browser.newPage({ viewport: { width: f.w, height: f.h }, deviceScaleFactor: f.scale });
      await page.setContent(html(f), { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate("globalThis.__name = (f) => f");
      const fit = await page.evaluate(({ entries, mode }) => {
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
        return { font, shown, fits: fits() };
      }, { entries: ENTRIES, mode: f.wall });
      await page.evaluate((html) => { document.getElementById("fine")!.innerHTML = html; },
        f.key === "cover"
          ? `Amounts as published in House Bill 10858 against the 2027 NEP; allocations, not spending. Insertions are candidates, not findings of wrongdoing. ${asOf}.`
          : fineAll(fit.shown));
      // The headline must sit above the footer, every figure on one line and inside the poster.
      const lay = await page.evaluate(() => {
        const head = document.getElementById("head")!.getBoundingClientRect();
        const foot = document.querySelector(".foot")!.getBoundingClientRect();
        const figs = [...document.querySelectorAll(".fig span, #more-lab")].map((s) => { const r = s.getBoundingClientRect(); return { right: r.right, h: r.height, fs: parseFloat(getComputedStyle(s).fontSize) }; });
        return { headBottom: head.bottom, footTop: foot.top, width: window.innerWidth, headRight: head.right, figs };
      });
      ensure(lay.headBottom <= lay.footTop - 4, `${f.key}: the headline runs into the footer (${lay.headBottom} > ${lay.footTop})`);
      ensure(lay.figs.every((x) => x.right <= lay.width - 4 && x.h < x.fs * 1.4), `${f.key}: a figure or the school bar's label wraps or leaves the poster`);
      ensure(lay.figs.every((x) => x.right <= lay.headRight + 1), `${f.key}: a figure or the school bar's label runs past the headline column`);
      ensure(fit.fits, `${f.key}: the wall overflows`);
      if (f.wall === "all") ensure(fit.shown === ENTRIES.length, `${f.key}: not every project fits`);
      const png = join(OUT, `${f.file}.png`);
      await page.screenshot({ path: png, fullPage: false });
      if (f.pdf) await page.pdf({ path: join(OUT, `${f.file}.pdf`), width: f.pdf.width, height: f.pdf.height, printBackground: true, pageRanges: "1" });
      console.log(`${f.key.padEnd(5)} ${f.w}×${f.h} css px · wall ${fit.font}px · ${fit.shown.toLocaleString("en-US")} of ${ENTRIES.length.toLocaleString("en-US")} projects → ${png}${f.pdf ? " + .pdf" : ""}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(OUT, "README-multi-purpose.txt"), [
    "MULTI-PURPOSE BUILDINGS — campaign poster (npm run build:hgab-poster-mpb)",
    `From data/hgab/2027/history.json (${H.built_at}): ${billion(F.mpb)} multi-purpose buildings, ${billion(F.deped)} school facilities (${MORE_LABEL}: ${more.map((x) => `${x.label} ${bShort(x.house_php!)}`).join(", ")}), ${billion(F.hfep)} health facilities (2027 House bill).`,
    `Wall: ${lines.length} multi-purpose building projects in the House bill (${inserted} inserted). Link: https://${URL_TEXT}`,
    "",
  ].join("\n"));
}

void main();
