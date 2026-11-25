/**
 * "Schools short of classrooms": a three-slide carousel for /schools, in the dark figure style of the multi-purpose
 * building and flood control images (scripts/build-hgab-poster-mpb-people.ts, src/lib/mpb-compare-image.ts): the navy
 * ground, a Figtree headline with red runs, a strip of figures, then a band of logos (the People’s Budget Coalition; the
 * data from DepEd and EDCOM 2, their logos on white tiles so their colours stay true), the notes, the disclaimer, the
 * source and the address.
 *
 *   1/3  the classroom shortage by region on a map (EDCOM 2's Classroom Shortage Rate), the regions with the most
 *        classrooms still unfunded and those with the least of their shortage covered by FY 2026 allocations
 *   2/3  every region ranked by classrooms still unfunded: each shortage split into covered and unfunded
 *   3/3  the budget: what the unfunded classrooms cost at EDCOM 2's ₱2.5 million each, and DepEd's school facilities
 *        beside multi-purpose buildings each year, FY 2020 to the 2027 House bill and Senate committee report
 *
 * Every figure comes from the schools API the pages read (`/api/schools/areas?level=region`, `--api`, production by
 * default) and from history.json (the budget-by-year chart's program lines), so the slides cannot disagree with the
 * site. The map is data/hgab/2027/geo/provinces.json, whose region keys are the schools' own.
 *
 * Renders in headless Chromium (playwright-core) in the site's type (Figtree, Inter, JetBrains Mono) and writes to
 * --out (default data/hgab/2027/campaign/, gitignored):
 *   schools-short-of-classrooms-{1..3}of3-1080x1350.png
 * and prints each file's MD5 prefix for `?v=` links.
 *
 * Usage: npx tsx scripts/build-poster-schools.ts [--api=https://budget.bettergov.ph] [--out=dir] [--only=1,2,3] [--draft]
 * Needs network access for the API and Google Fonts.
 */
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COMPARE_CARD_DISCLAIMER } from "../src/lib/hgab-disclaimers";
import { COMPARE_COLORS } from "../src/lib/mpb-compare";
import { EDCOM2_COST_PER_CLASSROOM, REGION_SHORT, SCHOOLS_API, SCHOOLS_API_VERSION, type AreaRow } from "../src/lib/schools";

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`build-poster-schools: ${msg}`); process.exit(1); }
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(args.out ?? join(ROOT, "data/hgab/2027/campaign"));
const API = (args.api as string | undefined) ?? "https://budget.bettergov.ph";
const URL_TEXT = "budget.bettergov.ph/schools";
const AS_OF = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
const STEM = "schools-short-of-classrooms";
const SLIDE_COUNT = 3;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const count = (v: number) => Math.round(v).toLocaleString("en-US");
const pctOf = (part: number, whole: number) => Math.round((100 * part) / whole);
const billions = (php: number) => `₱${(php / 1e9).toFixed(1)}B`;
const billionsWords = (php: number) => `₱${(php / 1e9).toFixed(1)} billion`;

// ---------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------

const read = <T>(rel: string): T => {
  const p = join(ROOT, "data", rel);
  ensure(existsSync(p), `${p} missing`);
  return JSON.parse(readFileSync(p, "utf8")) as T;
};
interface Geo {
  bbox: [number, number, number, number];
  regions: { key: string; label: string; plain: string }[];
  provinces: { psgc: number; region: string; polygons: number[][][][] }[];
}
interface History { columns: { key: string }[]; series: { key: string; php: (number | null)[] }[] }
const GEO = read<Geo>("hgab/2027/geo/provinces.json");
const HIST = read<History>("hgab/2027/history.json");
const PLAIN = new Map(GEO.regions.map((r) => [r.key, r.plain]));

interface Region { key: string; plain: string; tag: string; a: AreaRow; rate: number; coveredPct: number }
async function regions(): Promise<{ rows: Region[]; ph: AreaRow }> {
  const url = `${API}${SCHOOLS_API}/areas?level=region&v=${SCHOOLS_API_VERSION}`;
  const res = await fetch(url);
  ensure(res.ok, `${url} answered ${res.status}`);
  const body = (await res.json()) as { rows: AreaRow[] };
  // A row without a region holds schools abroad, if any; they count in the country's figures only.
  const keyed = body.rows.filter((r) => r.region_key && r.schools > 0);
  ensure(keyed.length === 18, `expected 18 regions, got ${keyed.length}`);
  const sum = (k: keyof AreaRow) => body.rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const ph = Object.fromEntries(Object.keys(body.rows[0]).map((k) => [k, sum(k as keyof AreaRow)])) as unknown as AreaRow;
  const rows = keyed.map((a) => {
    const key = a.region_key as string;
    ensure(PLAIN.has(key), `no map region for ${key}`);
    const tag = REGION_SHORT[key] ?? key;
    // EDCOM 2's Classroom Shortage Rate, for the region: its shortage over its classrooms and shortage, among the
    // schools with DepEd's count (instructional_with_data), as on the overview page.
    const rate = a.shortage / (a.instructional_with_data + a.shortage);
    return { key, plain: PLAIN.get(key) as string, tag: tag === PLAIN.get(key) ? "" : tag, a, rate, coveredPct: a.covered / a.shortage };
  });
  ensure(rows.every((r) => Math.abs(r.a.covered + r.a.gap - r.a.shortage) < 0.5), "a region's covered + unfunded is not its shortage");
  return { rows, ph };
}

const hist = (series: string, column: string) => {
  const i = HIST.columns.findIndex((c) => c.key === column);
  const x = HIST.series.find((y) => y.key === series)?.php[i];
  ensure(i >= 0 && x != null, `history.json has no ${series} for ${column}`);
  return x;
};

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

/** Five classes of red on the navy ground, dim to bright: the multi-purpose building carousel's ramp (validated there
 *  as an ordinal ramp in dark mode on #0c1322). Brighter means a higher Classroom Shortage Rate. */
const RAMP = ["#7d3542", "#a63a42", "#cf4545", "#f25a4f", "#ff9a88"];

function mapSvg(classOf: Map<string, number>): string {
  // The site's projection (src/lib/hgab-map.ts): equirectangular, longitude scaled by cos(12°), fitted to the bbox.
  const [x0, y0, x1, y1] = GEO.bbox, LON = Math.cos((12 * Math.PI) / 180), W = 600, pad = W * 0.02;
  const k = (W - 2 * pad) / ((x1 - x0) * LON), H = 2 * pad + (y1 - y0) * k;
  const xy = (lon: number, lat: number) => `${(pad + (lon - x0) * LON * k).toFixed(1)} ${(pad + (y1 - lat) * k).toFixed(1)}`;
  const paths = GEO.provinces.map((p) => {
    const c = classOf.get(p.region);
    ensure(c != null, `province ${p.psgc} has no region class`);
    const d = p.polygons.flatMap((poly) => poly.filter((ring) => ring.length >= 3).map((ring) => `M${ring.map(([lon, lat]) => xy(lon, lat)).join("L")}Z`)).join("");
    return `<path d="${d}" fill="${RAMP[c]}" fill-rule="evenodd"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H.toFixed(1)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${paths.join("")}</svg>`;
}

// ---------------------------------------------------------------------------
// The slides
// ---------------------------------------------------------------------------

type Run = string | { red: string };
interface Cell { strong: string; span: string; red?: boolean }
interface Slide { n: number; kicker: string; title: Run[][]; strip?: Cell[]; body: string; notes: string; source: string }

const DISCLAIMER =
  `${COMPARE_CARD_DISCLAIMER} DepEd’s counts are self-reported by schools; field reports on each school’s page help check them. ` +
  "The DepEd and EDCOM 2 logos mark where the data comes from: the reading is ours, and neither made nor endorsed these slides.";
const SOURCE = "Data: DepEd SY 2023–2024 classroom shortage, school registry and FY 2026 School Building Program; EDCOM 2 shortage list";
const COVERED_IS =
  "Covered: FY 2026 School Building Program classrooms allocated to a school, up to its shortage; classrooms beyond a school’s own shortage do not cover another’s. Unfunded: the rest of the shortage. Shortages are DepEd’s SY 2023–2024 counts, rounded to whole classrooms per school, as EDCOM 2 does.";

const nameCell = (r: Region) => `<span class="nm"><b>${esc(r.plain)}</b>${r.tag ? `<i>${esc(r.tag)}</i>` : ""}</span>`;

function slideCover(rows: Region[], ph: AreaRow): Slide {
  const byRate = [...rows].sort((a, b) => b.rate - a.rate);
  const classOf = new Map(byRate.map((r, i) => [r.key, 4 - Math.floor((i * 5) / byRate.length)]));
  const classes = [4, 3, 2, 1, 0].map((c) => {
    const m = byRate.filter((r) => classOf.get(r.key) === c).map((r) => Math.round(100 * r.rate));
    return { c, lo: Math.min(...m), hi: Math.max(...m) };
  });
  const byGap = [...rows].sort((a, b) => b.a.gap - a.a.gap);
  const byCover = [...rows].sort((a, b) => a.coveredPct - b.coveredPct);
  const item = (r: Region, line: string) => `<li><b>${esc(r.plain)}</b><span>${esc(line)}</span></li>`;
  const legend = classes.map((x) => `<li><i style="background:${RAMP[x.c]}"></i><span>${x.lo === x.hi ? `${x.lo}%` : `${x.lo}% to ${x.hi}%`}</span></li>`).join("");
  const covered = pctOf(ph.covered, ph.shortage);
  ensure(covered === 10, `the title says 10% is covered; it is now ${covered}%`);
  return {
    n: 1,
    kicker: "Basic education · classrooms · FY 2026",
    title: [[`Schools are short of ${count(ph.shortage)} classrooms.`], ["FY 2026 allocations cover ", { red: `${covered}%` }, " of the shortage."]],
    strip: [
      { strong: `${count(ph.gap)} classrooms`, span: "of the shortage have no FY 2026 allocation", red: true },
      { strong: `${count(ph.schools_short)} schools`, span: `short of classrooms, of ${count(ph.with_shortage_data)} with DepEd’s count` },
      { strong: `${count(ph.schools_extreme)} schools`, span: "Extreme: short of more than half the classrooms they need" },
    ],
    body: `<div class="cover">
        <div class="map">${mapSvg(classOf)}</div>
        <div class="side">
          <p class="h">Most classrooms unfunded</p>
          <ul class="list">${byGap.slice(0, 3).map((r) => item(r, `${count(r.a.gap)} of ${count(r.a.shortage)}`)).join("")}</ul>
          <p class="h">Least of the shortage covered</p>
          <ul class="list">${byCover.slice(0, 3).map((r) => item(r, `${Math.round(100 * r.coveredPct)}% of ${count(r.a.shortage)} covered`)).join("")}</ul>
          <p class="h">Map: classroom shortage rate</p>
          <ul class="legend">${legend}</ul>
          <p class="swipe">Every region on the next slide →</p>
        </div>
      </div>`,
    notes:
      `Brighter means a higher classroom shortage rate (EDCOM 2’s): the shortage over the classrooms a region’s schools have plus the shortage; each shade holds about a fifth of the regions. ${COVERED_IS}`,
    source: SOURCE,
  };
}

function slideRanked(rows: Region[], ph: AreaRow): Slide {
  const rank = [...rows].sort((a, b) => b.a.gap - a.a.gap);
  const max = Math.max(...rank.map((r) => r.a.shortage));
  const BAR = 70; // the longest bar's share of its track, leaving room for its label
  const row = (r: Region) => {
    const wc = (r.a.covered / max) * BAR, wg = (r.a.gap / max) * BAR;
    return `<div class="row">${nameCell(r)}
        <span class="track"><i class="bar is-cov" style="width:${wc.toFixed(2)}%"></i><i class="bar is-gap" style="left:${wc.toFixed(2)}%;width:${wg.toFixed(2)}%"></i><em style="left:${(wc + wg).toFixed(2)}%">${count(r.a.gap)}</em></span>
        <span class="rt"><b>${Math.round(100 * r.coveredPct)}%</b><small>of ${count(r.a.shortage)}</small></span></div>`;
  };
  const head = `<div class="row is-head"><span>Region</span><span>Classroom shortage: <u class="k-cov">covered</u><u class="k-gap">unfunded</u></span><span class="rt">Covered</span></div>`;
  const top = rank[0], last = rank[rank.length - 1];
  return {
    n: 2,
    kicker: "Basic education · classrooms · every region",
    title: [["Every region, ranked by classrooms unfunded"], ["From ", { red: count(top.a.gap) }, ` in ${top.plain} to ${count(last.a.gap)} in ${last.plain}.`]],
    strip: [
      { strong: `${count(ph.covered)} covered`, span: `of ${count(ph.shortage)} classrooms short, by FY 2026 allocations` },
      { strong: `${count(ph.excess)} more`, span: `allocated to schools beyond their own shortage, of ${count(ph.allocated)}` },
      { strong: `${count(ph.schools_under)} schools`, span: "allocated fewer classrooms than they are short, or none", red: true },
    ],
    body: `<div class="table">${head}${rank.map(row).join("")}</div>`,
    notes: `Regions ranked by classrooms still unfunded (the number beside each bar); the percentage is how much of the region’s shortage FY 2026 allocations cover. ${COVERED_IS}`,
    source: SOURCE,
  };
}

function slideBudget(ph: AreaRow): Slide {
  const COLS = [
    ...[2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) => ({ key: `gaa-${y}`, label: `’${String(y).slice(2)}`, sub: "" })),
    { key: "nep-2027", label: "NEP", sub: "2027" }, { key: "house-2027", label: "House", sub: "2027" }, { key: "senate-2027", label: "Senate", sub: "CR 2027" },
  ].map((c) => ({ ...c, deped: hist("deped", c.key), mpb: hist("mpb", c.key) }));
  const max = Math.max(...COLS.flatMap((c) => [c.deped, c.mpb]));
  const cost = ph.gap * EDCOM2_COST_PER_CLASSROOM;
  const [nep, house, senate] = COLS.slice(-3);
  ensure(house.mpb > 3 * house.deped, "the strip compares the House bill's MPBs with school facilities as more than 3×");
  const x = (house.mpb / house.deped).toFixed(1);
  const col = (c: (typeof COLS)[number]) => {
    const bar = (v: number, cls: string) => `<span class="cb ${cls}"><em>${billions(v).replace("₱", "")}</em><i style="height:${((v / max) * 100).toFixed(2)}%"></i></span>`;
    return `<div class="c${c.sub ? " is-27" : ""}"><div class="pair">${bar(c.deped, "is-dep")}${bar(c.mpb, "is-mpb")}</div><b>${esc(c.label)}</b><small>${esc(c.sub)}</small></div>`;
  };
  return {
    n: 3,
    kicker: "Basic education · classrooms · the budget",
    title: [["What the unfunded classrooms cost"], [`${count(ph.gap)} classrooms × ₱2.5 million = `, { red: billions(cost) }]],
    strip: [
      { strong: billionsWords(cost), span: "to build them at EDCOM 2’s ₱2.5 million a classroom", red: true },
      { strong: `${billions(nep.deped)} → ${billions(house.deped)}`, span: `DepEd school facilities, 2027: NEP → House bill (Senate committee: ${billions(senate.deped)})` },
      { strong: billions(house.mpb), span: `multi-purpose buildings in the 2027 House bill, ${x}× school facilities` },
    ],
    body: `<div class="pb">
        <p class="h"><span>Each budget, billion pesos</span><span class="key"><u class="k-dep">School facilities</u><u class="k-mpb">Multi-purpose buildings</u></span></p>
        <div class="colchart">${COLS.map(col).join("")}</div>
        <p class="pb-note">FY 2020–2026: the General Appropriations Acts. 2027: the President’s NEP, the House bill (third reading) and the Senate Finance Committee’s report; none is law yet.</p>
      </div>`,
    notes:
      `School facilities: DepEd’s Basic Education Facilities lines, which pay for new classrooms and also repairs, furniture, electrification and more, so not all of it builds classrooms. Multi-purpose buildings: DPWH lines for multi-purpose buildings and facilities, as on the budget-by-year chart. ` +
      `The ₱2.5 million a classroom is EDCOM 2’s assumed cost; real costs vary by storeys, site and region. Pesos are not adjusted for inflation; amounts are allocations, not spending.`,
    source: "Data: DepEd SY 2023–2024 classroom shortage; EDCOM 2; GAA 2020–2026, NEP 2027 (DBM), House Bill 10858, Senate Committee Report",
  };
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const W = 1080, H = 1350, PAD = 48;
const C = { ground: COMPARE_COLORS.ground, land: COMPARE_COLORS.land, ink: "#f3f6fb", ink2: "#c3cddd", ink3: "#8592a8", red: "#ff5a5a", cell: "#121b2e", rule: "#24304a", blue: COMPARE_COLORS.swatch.blue, cov: "#8f9bb0" };
const dataUri = (path: string, type: string) => `data:${type};base64,${readFileSync(path).toString("base64")}`;
const LOGO = dataUri(join(ROOT, "public/brand/bettergov-horizontal-white.png"), "image/png");
const PBC_LOGO = dataUri(join(ROOT, "public/brand/pbc-logo-color-dark.png"), "image/png");
// DepEd: Wikimedia Commons "Department of Education (DepEd).svg" (public domain). EDCOM 2: Commons "EDCOM 2 Logo.png",
// trimmed and scaled to 1600 px. Both are drawn on white, as their own colours are made for it.
const DEPED_LOGO = dataUri(join(ROOT, "public/brand/deped-logo.svg"), "image/svg+xml");
const EDCOM_LOGO = dataUri(join(ROOT, "public/brand/edcom2-logo.png"), "image/png");

const CSS = `
  @page { size: ${W}px ${H}px; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${W}px; height: ${H}px; background: ${C.ground}; overflow: hidden; }
  .poster { width: ${W}px; height: ${H}px; padding: 40px ${PAD}px 34px; display: flex; flex-direction: column; background: ${C.ground}; color: ${C.ink}; font-family: Inter, sans-serif; }
  .top { position: relative; }
  .kick { font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 14px; letter-spacing: 0.16em; text-transform: uppercase; color: ${C.ink3}; white-space: nowrap; }
  .logo { position: absolute; right: 0; top: -2px; width: 168px; }
  .title { margin-top: 12px; font-family: Figtree, sans-serif; font-weight: 700; line-height: 1.12; letter-spacing: -0.01em; }
  .title div { white-space: nowrap; width: fit-content; }
  .title .r { color: ${C.red}; }
  .strip { margin-top: 22px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: ${C.rule}; border: 1px solid ${C.rule}; }
  .cell { background: ${C.cell}; padding: 13px 16px 12px; min-width: 0; }
  .cell b { display: block; font-family: Figtree, sans-serif; font-weight: 700; font-size: 25px; line-height: 1.15; white-space: nowrap; }
  .cell b.r { color: ${C.red}; }
  .cell span { display: block; margin-top: 4px; font-size: 13.5px; line-height: 1.35; color: ${C.ink2}; }
  .body { flex: 1; min-height: 0; margin-top: 22px; display: flex; flex-direction: column; }
  .h { margin-top: 22px; padding-bottom: 7px; border-bottom: 1px solid ${C.rule}; font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 12.5px; letter-spacing: 0.12em; text-transform: uppercase; color: ${C.ink3}; white-space: nowrap; }
  .h:first-child { margin-top: 0; }
  /* Slide 1 */
  .cover { flex: 1; min-height: 0; display: flex; gap: 28px; }
  .cover .map { flex: 1.55; min-width: 0; position: relative; }
  .cover .map svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .cover .map path { stroke: ${C.ground}; stroke-width: 0.45; stroke-linejoin: round; }
  .cover .side { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .list { list-style: none; }
  .list li { display: flex; flex-direction: column; gap: 1px; padding: 8px 0 7px; border-bottom: 1px solid #1a2438; }
  .list li b { font-weight: 600; font-size: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .list li span { font-family: 'JetBrains Mono', monospace; font-size: 14.5px; color: ${C.ink2}; white-space: nowrap; }
  .legend { list-style: none; margin-top: 10px; display: flex; flex-direction: column; gap: 7px; }
  .legend li { display: flex; align-items: center; gap: 10px; font-family: 'JetBrains Mono', monospace; font-size: 14px; color: ${C.ink2}; white-space: nowrap; }
  .legend i { width: 22px; height: 15px; flex-shrink: 0; border-radius: 2px; }
  .swipe { margin-top: auto; align-self: flex-start; padding: 9px 14px; background: ${C.red}; color: #fff; font-family: Figtree, sans-serif; font-weight: 700; font-size: 19px; white-space: nowrap; border-radius: 3px; }
  /* Slide 2 */
  .table { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .row { display: grid; grid-template-columns: 300px 1fr 96px; column-gap: 14px; align-items: center; height: var(--row, 42px); border-top: 1px solid #1a2438; }
  .row.is-head { height: 30px; border-top: 0; border-bottom: 1px solid ${C.rule}; font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: ${C.ink3}; white-space: nowrap; }
  .row.is-head + .row { border-top: 0; }
  .row.is-head .rt { display: block; }
  u { text-decoration: none; display: inline-flex; align-items: center; gap: 6px; margin-left: 14px; }
  u::before { content: ""; width: 16px; height: 8px; border-radius: 1px; }
  u.k-cov::before { background: ${C.cov}; } u.k-gap::before { background: ${C.red}; }
  u.k-dep::before { background: ${C.blue}; } u.k-mpb::before { background: ${C.red}; }
  .nm { display: flex; align-items: baseline; gap: 9px; white-space: nowrap; overflow: hidden; }
  .nm b { font-weight: 600; font-size: 18px; color: ${C.ink}; overflow: hidden; text-overflow: ellipsis; }
  .nm i { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; letter-spacing: 0.06em; color: ${C.ink3}; text-transform: uppercase; flex-shrink: 0; }
  .track { position: relative; align-self: stretch; }
  .track .bar { position: absolute; left: 0; top: 27%; bottom: 27%; }
  .track .bar.is-cov { background: ${C.cov}; border-radius: 0; }
  /* A 2px gap of ground between the covered and unfunded parts. */
  .track .bar.is-gap { background: ${C.red}; border-radius: 0 2px 2px 0; border-left: 2px solid ${C.ground}; }
  .track em { position: absolute; top: 50%; transform: translate(6px, -50%); padding: 0 4px; font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 15px; line-height: 1.25; white-space: nowrap; color: ${C.ink2}; }
  .rt { text-align: right; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; white-space: nowrap; }
  .rt b { font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 16.5px; color: ${C.ink}; }
  .rt small { font-size: 12px; color: ${C.ink3}; }
  /* Slide 3 */
  .pb { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .pb .h { display: flex; justify-content: space-between; gap: 12px; }
  .pb .h > span:first-child { flex-shrink: 0; }
  .colchart { flex: 1; min-height: 0; display: flex; gap: 14px; margin-top: 16px; }
  .colchart .c { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; }
  .colchart .c.is-27 { background: ${C.cell}; border-radius: 4px 4px 0 0; padding: 0 4px; }
  .colchart .c:first-of-type.is-27, .colchart .c:not(.is-27) + .c.is-27 { margin-left: 10px; }
  .pair { flex: 1; min-height: 0; width: 100%; display: flex; gap: 3px; align-items: flex-end; border-bottom: 1px solid ${C.rule}; }
  .cb { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; }
  .cb em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 12px; letter-spacing: -0.04em; color: ${C.ink2}; white-space: nowrap; margin-bottom: 4px; }
  .cb i { width: 100%; border-radius: 3px 3px 0 0; }
  .cb.is-dep i { background: ${C.blue}; } .cb.is-mpb i { background: ${C.red}; }
  .colchart .c > b { font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 13.5px; color: ${C.ink2}; margin-top: 7px; white-space: nowrap; }
  .colchart .c > small { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: ${C.ink3}; white-space: nowrap; height: 14px; }
  .pb-note { margin-top: 12px; font-size: 13.5px; line-height: 1.4; color: ${C.ink2}; }
  /* The logos */
  .brands { margin-top: 18px; padding-top: 14px; border-top: 1px solid ${C.rule}; display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .brands > div { display: flex; align-items: center; gap: 12px; }
  .brands .lbl { font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: ${C.ink3}; white-space: nowrap; }
  .brands .pbc { height: 58px; }
  .brands .tile { height: 50px; padding: 6px 12px; background: #fff; border-radius: 4px; display: flex; align-items: center; }
  .brands .tile img { height: 100%; }
  .brands .tile.is-edcom img { height: 82%; }
  /* The foot */
  .foot { margin-top: 14px; }
  .notes { font-size: 13px; line-height: 1.45; color: ${C.ink3}; }
  .disc { margin-top: 7px; font-size: 13px; line-height: 1.45; color: ${C.ink2}; }
  .disc b { color: ${C.ink}; font-weight: 600; }
  .src, .url { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: ${C.ink3}; white-space: nowrap; }
  .src { margin-top: 10px; }
  .url { margin-top: 5px; display: flex; justify-content: space-between; }
  .url b { font-weight: 500; color: ${C.ink2}; }`;

function html(s: Slide): string {
  const runs = (line: Run[]) => line.map((r) => (typeof r === "string" ? esc(r) : `<span class="r">${esc(r.red)}</span>`)).join("");
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=block" rel="stylesheet">
<style>${CSS}</style></head><body><div class="poster">
  <div class="top">
    <p class="kick">${esc(s.kicker)}</p>
    <img class="logo" src="${LOGO}" alt="BetterGov.PH">
    <div class="title">${s.title.map((l) => `<div>${runs(l)}</div>`).join("")}</div>
  </div>${s.strip ? `
  <div class="strip">${s.strip.map((c) => `<div class="cell"><b${c.red ? ' class="r"' : ""}>${esc(c.strong)}</b><span>${esc(c.span)}</span></div>`).join("")}</div>` : ""}
  <div class="body">${s.body}</div>
  <div class="brands">
    <div><span class="lbl">With</span><img class="pbc" src="${PBC_LOGO}" alt="People’s Budget Coalition"></div>
    <div><span class="lbl">Data from</span><span class="tile"><img src="${DEPED_LOGO}" alt="Department of Education"></span><span class="tile is-edcom"><img src="${EDCOM_LOGO}" alt="EDCOM 2"></span></div>
  </div>
  <div class="foot">
    <p class="notes">${esc(s.notes)}</p>
    <p class="disc"><b>Disclaimer.</b> ${esc(DISCLAIMER)}</p>
    <p class="src">${esc(s.source)}</p>
    <p class="url"><span>${URL_TEXT} · As of ${AS_OF}</span><b>${s.n} / ${SLIDE_COUNT}</b></p>
  </div>
</div></body></html>`;
}

async function main(): Promise<void> {
  const { rows, ph } = await regions();
  const SLIDES = [slideCover(rows, ph), slideRanked(rows, ph), slideBudget(ph)];
  ensure(SLIDES.length === SLIDE_COUNT, "the slide count is out of date");
  const ONLY = (args.only as string | undefined)?.split(",").map(Number);
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const s of SLIDES) {
      if (ONLY && !ONLY.includes(s.n)) continue;
      const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await p.setContent(html(s), { waitUntil: "networkidle" });
      await p.evaluate(() => document.fonts.ready);
      await p.evaluate("globalThis.__name = (f) => f");
      const fit = await p.evaluate(({ width, logoGap }) => {
        // The title: the largest size (to 44px) at which every line fits; the first line also clears the logo.
        const title = document.querySelector<HTMLElement>(".title")!;
        const lines = [...title.querySelectorAll<HTMLElement>(":scope > div")];
        const logo = document.querySelector(".logo")!.getBoundingClientRect();
        const fits = () => lines.every((l, i) => {
          const r = l.getBoundingClientRect();
          const room = i === 0 && r.top < logo.bottom ? logo.left - logoGap - r.left : width;
          return r.width <= room;
        });
        let small = 24, big = 44;
        while (big - small > 0.1) { const m = (small + big) / 2; title.style.fontSize = `${m}px`; if (fits()) small = m; else big = m; }
        title.style.fontSize = `${small}px`;
        for (const b of document.querySelectorAll<HTMLElement>(".cell b")) {
          let fs = 25;
          while (fs > 16 && b.scrollWidth > b.clientWidth) b.style.fontSize = `${--fs}px`;
        }
        const table = document.querySelector<HTMLElement>(".table");
        let row = 0;
        if (table) {
          const rows = table.querySelectorAll(".row:not(.is-head)").length;
          const head = table.querySelector(".row.is-head")!.getBoundingClientRect().height;
          row = Math.floor((table.clientHeight - head) / rows);
          document.documentElement.style.setProperty("--row", `${row}px`);
        }
        return { title: Math.round(small * 10) / 10, row };
      }, { width: W - 2 * PAD, logoGap: 24 });
      const lay = await p.evaluate(({ height }) => {
        const poster = document.querySelector(".poster")!;
        const body = document.querySelector<HTMLElement>(".body")!;
        const url = document.querySelector(".url")!.getBoundingClientRect();
        const clipped = [...document.querySelectorAll(".h, .nm b, .rt b, .rt small, .row.is-head > span, .list li b, .list li span, .legend li, .cell b, .swipe, .kick, .src, .colchart .c > b, .colchart .c > small")]
          .filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent);
        const spill = [...document.querySelectorAll(".track em")]
          .filter((el) => el.getBoundingClientRect().right > el.parentElement!.getBoundingClientRect().right + 1).map((el) => el.textContent);
        const labels = [...document.querySelectorAll(".cb")].filter((cb) => cb.querySelector("em")!.getBoundingClientRect().width > cb.getBoundingClientRect().width + 8).map((cb) => cb.textContent);
        const side = document.querySelector(".side");
        const table = document.querySelector(".table");
        return {
          fitsPage: poster.scrollHeight <= height + 1 && url.bottom <= height - 20,
          bodyFits: body.scrollHeight <= body.clientHeight + 1 && (!table || table.scrollHeight <= table.clientHeight + 1) && (!side || side.scrollHeight <= side.clientHeight + 1),
          bodyHeight: Math.round(body.clientHeight), clipped, spill, labels,
        };
      }, { height: H });
      const png = join(OUT, `${STEM}-${s.n}of${SLIDE_COUNT}-${W}x${H}.png`);
      if (args.draft) await p.screenshot({ path: png });
      if (fit.row) ensure(fit.row >= 36, `slide ${s.n}: rows of ${fit.row}px are too tight`);
      ensure(fit.title >= 34, `slide ${s.n}: the title had to shrink to ${fit.title}px`);
      ensure(lay.fitsPage, `slide ${s.n}: the page overflows`);
      ensure(lay.bodyFits, `slide ${s.n}: the body's content overflows it`);
      ensure(lay.clipped.length === 0, `slide ${s.n}: cut short: ${lay.clipped.join(" | ")}`);
      ensure(lay.spill.length === 0, `slide ${s.n}: a bar label runs past its track: ${lay.spill.join(" | ")}`);
      ensure(lay.labels.length === 0, `slide ${s.n}: a column label is wider than its column: ${lay.labels.join(" | ")}`);
      if (!args.draft) await p.screenshot({ path: png });
      const md5 = createHash("md5").update(readFileSync(png)).digest("hex").slice(0, 8);
      console.log(`${s.n}/${SLIDE_COUNT} · title ${fit.title}px · rows ${fit.row}px · body ${lay.bodyHeight}px → ${png} · v=${md5}`);
      await p.close();
    }
  } finally {
    await browser.close();
  }
}

void main();
