/**
 * "Multi-purpose buildings for the people": a five-slide carousel for /hgab/2027/multi-purpose/per-person, the number
 * of multi-purpose building (MPB) projects for the people of each region. It wears the dark figure style of the NEP vs
 * House bill images (src/lib/mpb-compare-image.ts): the navy ground, a Figtree headline with red runs, a strip of
 * figures, then the notes, the disclaimer, the source and the address.
 *
 *   1/5  the 2027 House bill on a map of the regions, with the most and the fewest projects for their people
 *   2/5  every region ranked: 1 project for every N people, the country's figure as a dashed line
 *   3/5  the NEP beside the House bill, region by region
 *   4/5  all years: the FY 2015–2026 GAAs and the 2027 House bill as a yearly average, each year against its own
 *        population (popInYear: PSA's 2015, 2020 and 2024 censuses, filled in between)
 *   5/5  in context: the NEP and the House bill beside flood control, school and health facilities (the budget-by-year
 *        chart's program lines, history.json), the budget per person each year, and how often barangays get one
 *
 * Every figure comes from `mpb-years/population.json` (npm run build:mpb-population), the file the page reads, so the
 * slides cannot disagree with the site; slide 5 also reads history.json and lines.json. Nothing is generated.
 *
 * Renders in headless Chromium (playwright-core) in the site's type (Figtree, Inter, JetBrains Mono) and writes to
 * --out (default data/hgab/2027/campaign/, gitignored):
 *   mpbs-for-the-people-{1..5}of5-1080x1350.png
 * and prints each file's MD5 prefix for `?v=` links.
 *
 * Usage: npx tsx scripts/build-hgab-poster-mpb-people.ts [--out=dir] [--only=1,2,3,4,5] [--draft]
 * Needs network access for Google Fonts.
 */
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { COMPARE_CARD_DISCLAIMER } from "../src/lib/hgab-disclaimers";
import { COMPARE_COLORS } from "../src/lib/mpb-compare";
import {
  ALL_HOUSE_KEY, MPB_POPULATION_PATH, MPB_POPULATION_ROOT, peopleIn, popInYear, type Census, type MpbPopulationFile, type Tally,
} from "../src/lib/mpb-population";

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`build-hgab-poster-mpb-people: ${msg}`); process.exit(1); }
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(args.out ?? join(ROOT, "data/hgab/2027/campaign"));
const URL_TEXT = `budget.bettergov.ph${MPB_POPULATION_ROOT}`;
const AS_OF = "November 9, 2026";

// ---------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------

const read = <T>(rel: string): T => {
  const p = join(ROOT, "data", rel);
  ensure(existsSync(p), `${p} missing (npm run build:mpb-population)`);
  return JSON.parse(readFileSync(p, "utf8")) as T;
};
const F = read<MpbPopulationFile>(MPB_POPULATION_PATH);
const HOUSE = "house-2027", NEP = "nep-2027";
const budget = (key: string) => {
  const b = F.budgets.find((x) => x.key === key);
  ensure(b, `budget ${key} missing from population.json`);
  return b;
};
const B = { house: budget(HOUSE), nep: budget(NEP), all: budget(ALL_HOUSE_KEY) };
const POP = F.regions.reduce((a, r) => a + r.population, 0);
ensure(F.regions.length === 18, `${F.regions.length} regions, not 18`);
ensure(Math.abs(POP - 112_727_776) < 1, `the regions' population is ${POP}, not the census's 112,727,776`);

type Key = "house" | "nep" | "all";
/** `people`: the region's population in the budget's year (2027: the 2024 count), or the average over its years. */
interface Region { key: string; label: string; plain: string; people: Record<Key, number>; t: Record<Key, Tally> }
const REGIONS: Region[] = F.regions.map((r) => ({
  key: r.key, label: r.label, plain: r.plain,
  people: { house: peopleIn(r.census, B.house.years), nep: peopleIn(r.census, B.nep.years), all: peopleIn(r.census, B.all.years) },
  t: {
    house: F.by[HOUSE].region[r.key] ?? [0, 0],
    nep: F.by[NEP].region[r.key] ?? [0, 0],
    all: F.by[ALL_HOUSE_KEY].region[r.key] ?? [0, 0],
  },
}));
for (const k of ["house", "nep", "all"] as const) {
  const sum = REGIONS.reduce((a, r) => a + r.t[k][0], 0);
  ensure(sum === B[k].placed.region[0], `${k}: the regions' projects add up to ${sum}, not ${B[k].placed.region[0]}`);
  ensure(REGIONS.every((r) => r.t[k][0] > 0), `${k}: a region has no projects; "1 for every" would divide by zero`);
}
ensure(B.house.placed.region[0] === B.house.lines && B.nep.placed.region[0] === B.nep.lines, "some 2027 projects name no region; slides 1–3 count every one in a region");
ensure(REGIONS.every((r) => r.t.house[0] > r.t.nep[0]), "a region has no more projects in the House bill than in the NEP; slide 3 says every region has more");

ensure(B.all.years.length === 13 && B.house.years.join() === "2027", "the budgets' years are not FY2015–2027 and 2027");
/** Budget years in each: rates over several years are per year (the page's yearly average). */
const NY: Record<Key, number> = { house: B.house.years.length, nep: B.nep.years.length, all: B.all.years.length };
/** The country's people for each budget: the regions' sum. */
const PEOPLE: Record<Key, number> = { house: 0, nep: 0, all: 0 };
for (const k of ["house", "nep", "all"] as const) PEOPLE[k] = REGIONS.reduce((a, r) => a + r.people[k], 0);
ensure(PEOPLE.house === POP, "the House bill is not measured against the 2024 census");

/** People for each project a year (the page's "1 project for every N people"), and projects per 100,000 people a year (the bars). */
const every = (people: number, projects: number, k: Key) => Math.round((people * NY[k]) / projects);
const per = (people: number, projects: number, k: Key) => (1e5 * projects) / NY[k] / people;
const everyOf = (r: Region, k: Key) => every(r.people[k], r.t[k][0], k);
const perOf = (r: Region, k: Key) => per(r.people[k], r.t[k][0], k);
const ranked = (k: Key) => [...REGIONS].sort((a, b) => perOf(b, k) - perOf(a, k));
const COUNTRY = { house: every(PEOPLE.house, B.house.lines, "house"), nep: every(PEOPLE.nep, B.nep.lines, "nep"), all: every(PEOPLE.all, B.all.lines, "all") };
const PER_YEAR = { lines: Math.round(B.all.lines / NY.all), php: B.all.php / NY.all };
const UNPLACED_ALL = B.all.lines - B.all.placed.region[0];

const count = (n: number) => n.toLocaleString("en-US");
const millions = (n: number) => `${(n / 1e6).toFixed(1)}\u00A0million`;
const billions = (php: number) => `₱${(php / 1e9).toFixed(1)}B`;
const peso = (php: number) => `₱${Math.round(php).toLocaleString("en-US")}`;
const billionsWords = (php: number) => `₱${(php / 1e9).toFixed(1)}\u00A0billion`;
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const regionTag = (r: Region) => (r.label.toUpperCase() === r.plain.toUpperCase() ? "" : r.label);

const H_RANK = ranked("house"), A_RANK = ranked("all");
const TOP = H_RANK[0], BOTTOM = H_RANK[H_RANK.length - 1];
/** The region whose count grew the most, times over, from the NEP to the House bill. */
const GREW = [...REGIONS].sort((a, b) => b.t.house[0] / b.t.nep[0] - a.t.house[0] / a.t.nep[0])[0];
const GREW_X = (GREW.t.house[0] / GREW.t.nep[0]).toFixed(1);
const MORE_PCT = Math.round((100 * (B.house.lines - B.nep.lines)) / B.nep.lines);

// ---------------------------------------------------------------------------
// The map (slide 1): provinces shaded by their region's class
// ---------------------------------------------------------------------------

/** Five classes of red on the navy ground, dim to bright; brighter means more projects for each person. Passed the
 *  dataviz validator as an ordinal ramp in dark mode on #0c1322: monotone, one hue, dim end 2.17:1. */
const RAMP = ["#7d3542", "#a63a42", "#cf4545", "#f25a4f", "#ff9a88"];
/** Each region's class by rank, about a fifth of the regions each (4 = most for their people). */
const CLASS = new Map<string, number>(H_RANK.map((r, i) => [r.key, 4 - Math.floor((i * 5) / H_RANK.length)]));
const CLASSES = [4, 3, 2, 1, 0].map((c) => {
  const members = H_RANK.filter((r) => CLASS.get(r.key) === c).map((r) => everyOf(r, "house"));
  return { c, lo: Math.min(...members), hi: Math.max(...members) };
});

interface Geo { bbox: [number, number, number, number]; provinces: { psgc: number; polygons: number[][][][] }[] }
function mapSvg(): string {
  const geo = read<Geo>("hgab/2027/geo/provinces.json");
  const regionOf = new Map<number, string>();
  for (const a of F.areas) for (const p of a.psgc) regionOf.set(p, a.region.replace(/^Region /, ""));
  // The site's projection (src/lib/hgab-map.ts): equirectangular, longitude scaled by cos(12°), fitted to the bbox.
  const [x0, y0, x1, y1] = geo.bbox, LON = Math.cos((12 * Math.PI) / 180), W = 600, pad = W * 0.02;
  const k = (W - 2 * pad) / ((x1 - x0) * LON), H = 2 * pad + (y1 - y0) * k;
  const xy = (lon: number, lat: number) => `${(pad + (lon - x0) * LON * k).toFixed(1)} ${(pad + (y1 - lat) * k).toFixed(1)}`;
  let missing = 0;
  const paths = geo.provinces.map((p) => {
    const key = regionOf.get(p.psgc);
    const c = key == null ? undefined : CLASS.get(key);
    if (c == null) missing++;
    const d = p.polygons.flatMap((poly) => poly.filter((ring) => ring.length >= 3).map((ring) => `M${ring.map(([lon, lat]) => xy(lon, lat)).join("L")}Z`)).join("");
    return `<path d="${d}" fill="${c == null ? COMPARE_COLORS.land : RAMP[c]}" fill-rule="evenodd"/>`;
  });
  ensure(missing === 0, `${missing} province outlines have no region`);
  return `<svg viewBox="0 0 ${W} ${H.toFixed(1)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${paths.join("")}</svg>`;
}

// ---------------------------------------------------------------------------
// The slides
// ---------------------------------------------------------------------------

/** A title line is runs of text; `red` runs are in the figure's red. */
type Run = string | { red: string };
interface Cell { strong: string; span: string; red?: boolean }
interface Slide { n: number; kicker: string; title: Run[][]; strip?: Cell[]; body: string; notes: string; source: string }

const PLACED =
  "A project is one budget line for a multi-purpose building, or a phase of one, of any size, placed in a region by the place its title names, else by its office: our reading of the titles.";
const PROJECT_IS = `${PLACED} People: PSA’s 2024 Census of Population, ${millions(POP)}, the latest count. Amounts are allocations, not spending.`;
const DISCLAIMER = `${COMPARE_CARD_DISCLAIMER} The documents do not say who asked for any project.`;
const SOURCE_2027 = "Source: NEP 2027 (DBM) and House Bill 10858, third reading; PSA 2024 Census of Population";
const SOURCE_ALL = "Source: GAA 2015–2026, House Bill 10858, third reading; PSA 2015, 2020 and 2024 Censuses of Population";

function nameCell(r: Region | null): string {
  if (!r) return `<span class="nm is-ph"><b>Philippines</b></span>`;
  const tag = regionTag(r);
  return `<span class="nm"><b>${esc(r.plain)}</b>${tag ? `<i>${esc(tag)}</i>` : ""}</span>`;
}

/** Slide 1: the map, and the most and the fewest projects for their people. */
function slideCover(): Slide {
  const item = (r: Region) => `<li><b>${esc(r.plain)}</b><span>1 for every ${count(everyOf(r, "house"))} people</span></li>`;
  const legend = CLASSES.map((x) => `<li><i style="background:${RAMP[x.c]}"></i><span>${count(x.lo)}${x.hi > x.lo ? ` to ${count(x.hi)}` : ""}</span></li>`).join("");
  return {
    n: 1,
    kicker: "2027 budget · House bill · multi-purpose buildings",
    title: [["Multi-purpose buildings for the people"], ["1 project for every ", { red: `${count(COUNTRY.house)} people` }, " in the House bill."]],
    strip: [
      { strong: `1 for every ${count(everyOf(TOP, "house"))}`, span: `${TOP.plain}, the most for its people`, red: true },
      { strong: `1 for every ${count(everyOf(BOTTOM, "house"))}`, span: `${BOTTOM.plain}, the fewest for its people` },
      { strong: `${count(B.house.lines)} projects`, span: `${count(B.nep.lines)} in the NEP → ${count(B.house.lines)} in the House bill` },
    ],
    body: `<div class="cover">
        <div class="map">${mapSvg()}</div>
        <div class="side">
          <p class="h">Most for their people</p>
          <ul class="list">${H_RANK.slice(0, 4).map(item).join("")}</ul>
          <p class="h">Fewest for their people</p>
          <ul class="list">${H_RANK.slice(-4).reverse().map(item).join("")}</ul>
          <p class="h">Map: 1 for every … people</p>
          <ul class="legend">${legend}</ul>
          <p class="swipe">Every region on the next slide →</p>
        </div>
      </div>`,
    notes: `Brighter means more projects for each person; each shade holds about a fifth of the regions. ${PROJECT_IS}`,
    source: SOURCE_2027,
  };
}

/** Slides 2 and 4: every region ranked by projects for each person, the country's figure as a dashed line. */
function slideRanked(n: number, k: "house" | "all"): Slide {
  const rank = k === "house" ? H_RANK : A_RANK;
  const max = perOf(rank[0], k);
  const BAR = 56; // the longest bar's share of its track, leaving room for its label
  const ph = per(PEOPLE[k], B[k].lines, k);
  const avg = `<i class="avg" style="left:${((ph / max) * BAR).toFixed(2)}%"></i>`;
  const row = (r: Region | null) => {
    const people = r ? r.people[k] : PEOPLE[k], projects = r ? r.t[k][0] : B[k].lines, php = r ? r.t[k][1] : B[k].php;
    const w = (per(people, projects, k) / max) * BAR;
    return `<div class="row${r ? "" : " is-ph"}">${nameCell(r)}
        <span class="track">${avg}<i class="bar" style="width:${w.toFixed(2)}%"></i><em style="left:${w.toFixed(2)}%">1 for every ${count(every(people, projects, k))}</em></span>
        <span class="rt"><b>${count(projects)}</b><small>${k === "house" ? `${millions(people)} people` : billions(php)}</small></span></div>`;
  };
  const rows = rank.filter((r) => perOf(r, k) >= ph).map(row)
    .concat(row(null), rank.filter((r) => perOf(r, k) < ph).map(row));
  const head = `<div class="row is-head"><span>Region</span><span>1 project for every … people${k === "all" ? ", each year" : ""}</span><span class="rt">${k === "house" ? "Projects · people" : "13-year total"}</span></div>`;
  const table = `<div class="table">${head}${rows.join("")}</div>`;
  if (k === "house") {
    return {
      n, kicker: "2027 budget · House bill · every region",
      title: [["Every region, ranked"], ["From ", { red: `1 for every ${count(everyOf(TOP, "house"))}` }, ` to 1 for every ${count(everyOf(BOTTOM, "house"))} people.`]],
      body: table,
      notes: `Multi-purpose building projects in the 2027 House bill for each region’s people. A longer bar means more projects for each person; the dashed line is the whole country, 1 for every ${count(COUNTRY.house)}. ${PROJECT_IS}`,
      source: SOURCE_2027,
    };
  }
  const fewest = A_RANK[A_RANK.length - 1];
  return {
    n, kicker: "FY 2015–2027 · all years · every region",
    title: [["Multi-purpose buildings since 2015"], ["About ", { red: `${count(Math.round(PER_YEAR.lines / 10) * 10)} projects a year` }, `: 1 for every ${count(COUNTRY.all)} people.`]],
    strip: [
      { strong: `${billionsWords(PER_YEAR.php)} a year`, span: `${billionsWords(B.all.php)} over 13 budgets`, red: true },
      { strong: `1 for every ${count(everyOf(A_RANK[0], "all"))}`, span: `${A_RANK[0].plain}, the most for its people` },
      { strong: `1 for every ${count(everyOf(fewest, "all"))}`, span: `${fewest.plain}, the fewest for its people` },
    ],
    body: table,
    notes:
      `The FY 2015–2026 General Appropriations Acts and the 2027 House bill, a proposal not yet law, as a yearly average: each region’s projects over the 13 budgets, divided by 13 and by its average population over those years. ` +
      `Each year’s population is from PSA’s 2015, 2020 and 2024 censuses, filled in between them; years after 2024 use the 2024 count. A building funded over several years counts once each year. ` +
      `${count(UNPLACED_ALL)} lines name no region and count only in the country’s figure (the dashed line). ${PLACED} Amounts are allocations, not spending.`,
    source: SOURCE_ALL,
  };
}

/** Slide 3: the NEP beside the House bill. */
function slideCompare(): Slide {
  const max = perOf(TOP, "house");
  const BAR = 50;
  const row = (r: Region | null) => {
    // The NEP and the House bill are both 2027: the same people.
    const people = r ? r.people.house : PEOPLE.house;
    const nep = r ? r.t.nep[0] : B.nep.lines, house = r ? r.t.house[0] : B.house.lines;
    const wn = (per(people, nep, "nep") / max) * BAR, wh = (per(people, house, "house") / max) * BAR;
    return `<div class="row${r ? "" : " is-ph"}">${nameCell(r)}
        <span class="track two">
          <i class="bar is-nep" style="width:${wn.toFixed(2)}%"></i><em class="is-nep" style="left:${wn.toFixed(2)}%">1 for every ${count(every(people, nep, "nep"))}</em>
          <i class="bar is-house" style="width:${wh.toFixed(2)}%"></i><em class="is-house" style="left:${wh.toFixed(2)}%">1 for every ${count(every(people, house, "house"))}</em>
        </span>
        <span class="rt"><b>${count(nep)} → ${count(house)}</b><small class="up">+${count(house - nep)}</small></span></div>`;
  };
  const ph = per(PEOPLE.house, B.house.lines, "house");
  const rows = H_RANK.filter((r) => perOf(r, "house") >= ph).map(row)
    .concat(row(null), H_RANK.filter((r) => perOf(r, "house") < ph).map(row));
  const head = `<div class="row is-head"><span>Region</span><span>1 project for every … people: <u class="k-nep">NEP</u><u class="k-house">House bill</u></span><span class="rt">Projects</span></div>`;
  return {
    n: 3, kicker: "2027 budget · NEP vs House bill · every region",
    title: [["Multi-purpose buildings, NEP vs House bill"], [`${count(B.nep.lines)} projects in the NEP. `, { red: count(B.house.lines) }, " in the House bill."]],
    strip: [
      { strong: `+${count(B.house.lines - B.nep.lines)} projects`, span: `${MORE_PCT}% more than the NEP (${count(B.nep.lines)} → ${count(B.house.lines)})`, red: true },
      { strong: `${count(COUNTRY.nep)} → ${count(COUNTRY.house)}`, span: "People for each project, the whole country" },
      { strong: `${count(GREW.t.nep[0])} → ${count(GREW.t.house[0])}`, span: `${GREW.plain}: ${GREW_X}× as many, the biggest rise` },
    ],
    body: `<div class="table">${head}${rows.join("")}</div>`,
    notes:
      `Every region has more multi-purpose building projects in the House bill than in the NEP, the President’s budget. The bars compare totals; they do not say which lines the House added. ${PROJECT_IS}`,
    source: SOURCE_2027,
  };
}

// ---------------------------------------------------------------------------
// Slide 5: in context
// ---------------------------------------------------------------------------

const SLIDE_COUNT = 5;
/** Barangays in PSA's Philippine Standard Geographic Code, 3rd quarter 2026 (PSGC2LEG's list, which matches PSA's totals). */
const BARANGAYS = 42_010;
interface History { columns: { key: string }[]; series: { key: string; php: (number | null)[] }[] }
interface LinesFile { cols: string[]; levels: string[]; places: [string, number, ...unknown[]][]; rows: unknown[][] }

function slideContext(): Slide {
  // 1. The NEP and the House bill beside flood control, school and health facilities: the budget-by-year chart's
  //    program lines (history.json), so the four compare like with like.
  const hist = read<History>("hgab/2027/history.json");
  const val = (series: string, column: string) => {
    const i = hist.columns.findIndex((c) => c.key === column);
    const x = hist.series.find((y) => y.key === series)?.php[i];
    ensure(i >= 0 && x != null, `history.json has no ${series} for ${column}`);
    return x;
  };
  const SERIES = [
    { key: "mpb", name: "Multi-purpose buildings" }, { key: "flood", name: "Flood control" },
    { key: "deped", name: "DepEd school facilities" }, { key: "hfep", name: "DOH health facilities" },
  ].map((x) => ({ ...x, nep: val(x.key, "nep-2027"), house: val(x.key, "house-2027") }));
  const [mpb, , deped, hfep] = SERIES;
  const careHouse = deped.house + hfep.house;
  ensure(mpb.house > careHouse, "MPBs no longer get more than school and health facilities together in the House bill");
  ensure(mpb.house > mpb.nep && SERIES.slice(1).every((x) => x.house < x.nep), "the slide says only multi-purpose buildings went up from the NEP");
  const GAA = ["gaa-2020", "gaa-2021", "gaa-2022", "gaa-2023", "gaa-2024", "gaa-2025", "gaa-2026"];
  const enacted = (k: string) => GAA.reduce((a, c) => a + val(k, c), 0);
  const ENACTED = { mpb: enacted("mpb"), care: enacted("deped") + enacted("hfep") };
  ensure(ENACTED.mpb > ENACTED.care, "in FY2020–2026 MPBs no longer exceed school and health facilities together");
  const max = Math.max(...SERIES.flatMap((x) => [x.nep, x.house]));
  const BAR = 62;
  const pct = (a: number, b: number) => Math.round((100 * (b - a)) / a);
  const crow = (x: (typeof SERIES)[number]) => {
    const wn = (x.nep / max) * BAR, wh = (x.house / max) * BAR, d = pct(x.nep, x.house);
    return `<div class="crow${x.key === "mpb" ? " is-mpb" : ""}"><span class="nm"><b>${esc(x.name)}</b></span>
        <span class="track two">
          <i class="bar is-nep" style="width:${wn.toFixed(2)}%"></i><em class="is-nep" style="left:${wn.toFixed(2)}%">${billions(x.nep)}</em>
          <i class="bar is-house" style="width:${wh.toFixed(2)}%"></i><em class="is-house" style="left:${wh.toFixed(2)}%">${billions(x.house)}</em>
        </span>
        <span class="chg${d > 0 ? " up" : ""}">${d > 0 ? "+" : "−"}${Math.abs(d)}%</span></div>`;
  };

  // 2. The MPB budget per person in each budget year, against that year's population (as on the page).
  const PH = [0, 1, 2].map((i) => F.regions.reduce((a, r) => a + r.census[i], 0)) as Census;
  ensure(PH.join() === "100979303,109033245,112727776", "the regions do not add up to the country in each census");
  const YEARLY = [...Array.from({ length: 12 }, (_, i) => `gaa-${2015 + i}`), HOUSE].map((k) => {
    const b = budget(k), fy = b.years[0];
    return { fy, house: k === HOUSE, v: b.php / popInYear(PH, fy) };
  });
  const v15 = YEARLY[0].v, v25 = YEARLY.find((y) => y.fy === 2025)!.v;
  const RISE = (v25 / v15).toFixed(1), POP_RISE = Math.round(100 * (popInYear(PH, 2025) / popInYear(PH, 2015) - 1));
  const vmax = Math.max(...YEARLY.map((y) => y.v));
  const cols = YEARLY.map((y) => `<div class="c${y.house ? " is-house" : ""}"><em>${peso(y.v)}</em><i style="height:calc((100% - 44px) * ${(y.v / vmax).toFixed(4)})"></i><b>${y.house ? "HB" : ""}’${String(y.fy).slice(2)}</b></div>`).join("");

  // 3. Barangays: the projects whose place is a barangay, FY2015–2026 GAA and the 2027 House bill.
  const L = read<LinesFile>("hgab/2027/mpb-years/lines.json");
  const c = Object.fromEntries(L.cols.map((k, i) => [k, i]));
  const BRGY = L.levels.indexOf("barangay");
  const yearsAt = new Map<string, Set<number>>(), inBudget = new Map<string, number>();
  let all = 0, named = 0;
  for (const r of L.rows) {
    const fy = r[c.fy] as number;
    if ((fy <= 2026 ? r[c.gaa_php] : r[c.house_php]) == null) continue;
    all++;
    const p = r[c.place] == null ? null : L.places[r[c.place] as number];
    if (!p || p[1] !== BRGY) continue;
    named++;
    (yearsAt.get(p[0]) ?? yearsAt.set(p[0], new Set()).get(p[0])!).add(fy);
    inBudget.set(`${p[0]}|${fy}`, (inBudget.get(`${p[0]}|${fy}`) ?? 0) + 1);
  }
  ensure(all === B.all.lines, `lines.json has ${all} lines for all years, not ${B.all.lines}`);
  const funded = yearsAt.size, years = (n: number) => [...yearsAt.values()].filter((x) => x.size >= n).length;
  const twice = [...inBudget.values()].filter((v) => v > 1).length;
  const NAMED_PCT = Math.round((100 * named) / all);
  ensure(funded <= BARANGAYS, "more barangays funded than exist");
  const perBarangay = (B.all.lines / BARANGAYS).toFixed(1);

  return {
    n: 5, kicker: "2027 budget · multi-purpose buildings · in context",
    title: [["Too many multi-purpose buildings?"], [{ red: billions(mpb.house) }, ` for MPBs. ${billions(careHouse)} for school and health facilities.`]],
    strip: [
      { strong: `${count(B.nep.lines)} → ${count(B.house.lines)}`, span: "MPB projects: NEP → House bill", red: true },
      { strong: `${peso(v15)} → ${peso(v25)}`, span: `Per person, FY2015 → FY2025: ${RISE}×` },
      { strong: `${perBarangay} per barangay`, span: `${count(B.all.lines)} projects, ${count(BARANGAYS)} barangays` },
    ],
    body: `<div class="ctx">
        <section class="pa">
          <p class="h">2027: the President’s NEP → the House bill <span class="key"><u class="k-nep">NEP</u><u class="k-house">House bill</u></span></p>
          ${SERIES.map(crow).join("")}
          <p class="pa-note">Only multi-purpose buildings went up. In the seven enacted budgets FY2020–2026: <b>${billionsWords(ENACTED.mpb)} for MPBs</b>, ${billionsWords(ENACTED.care)} for school and health facilities together.</p>
        </section>
        <div class="pbc">
          <section class="pb">
            <p class="h">MPB budget per person, each year</p>
            <div class="colchart">${cols}</div>
            <p class="pb-note">${RISE}× from FY2015 to FY2025, while the population grew ${POP_RISE}%. HB’27: the House bill.</p>
          </section>
          <section class="pc">
            <p class="h">Across the ${count(BARANGAYS)} barangays</p>
            <ul class="bign">
              <li><b>${Math.round((100 * funded) / BARANGAYS)}%</b><span>have an MPB project, FY2015–2027 (${count(funded)} barangays)</span></li>
              <li><b>${count(years(2))}</b><span>were funded in 2 or more different years</span></li>
              <li><b>${count(years(5))}</b><span>were funded in 5 or more years</span></li>
              <li><b>${count(twice)}</b><span>times one barangay got 2 or more in the same budget</span></li>
            </ul>
          </section>
        </div>
      </div>`,
    notes:
      `The first panel uses the budget-by-year chart’s program lines (DPWH multi-purpose buildings and flood control, DepEd’s Basic Education Facilities, DOH’s Health Facilities Enhancement Program), so the four compare like with like; ` +
      `counting every MPB line by title, as on the other slides, the House bill has ${billionsWords(B.house.php)}. Pesos are not adjusted for inflation. A project is one budget line, not a building: phases and multi-year buildings count each year. ` +
      `Barangays: PSA’s PSGC; only the ${NAMED_PCT}% of projects whose title names a barangay are counted, so these are minimums.`,
    source: "Source: GAA 2015–2026, NEP 2027 (DBM), House Bill 10858, third reading; PSA censuses and PSGC",
  };
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const W = 1080, H = 1350, PAD = 48;
const C = { ground: COMPARE_COLORS.ground, land: COMPARE_COLORS.land, ink: "#f3f6fb", ink2: "#c3cddd", ink3: "#8592a8", red: "#ff5a5a", cell: "#121b2e", rule: "#24304a", blue: COMPARE_COLORS.swatch.blue };
const dataUri = (path: string, type: string) => `data:${type};base64,${readFileSync(path).toString("base64")}`;
const LOGO = dataUri(join(ROOT, "public/brand/bettergov-horizontal-white.png"), "image/png");

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
  /* Slide 1 */
  .cover { flex: 1; min-height: 0; display: flex; gap: 28px; }
  .cover .map { flex: 1.55; min-width: 0; position: relative; }
  .cover .map svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .cover .map path { stroke: ${C.ground}; stroke-width: 0.45; stroke-linejoin: round; }
  .cover .side { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .h { margin-top: 22px; padding-bottom: 7px; border-bottom: 1px solid ${C.rule}; font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 12.5px; letter-spacing: 0.12em; text-transform: uppercase; color: ${C.ink3}; white-space: nowrap; }
  .h:first-child { margin-top: 0; }
  .list { list-style: none; }
  .list li { display: flex; flex-direction: column; gap: 1px; padding: 8px 0 7px; border-bottom: 1px solid #1a2438; }
  .list li b { font-weight: 600; font-size: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .list li span { font-family: 'JetBrains Mono', monospace; font-size: 14.5px; color: ${C.ink2}; white-space: nowrap; }
  .legend { list-style: none; margin-top: 10px; display: flex; flex-direction: column; gap: 7px; }
  .legend li { display: flex; align-items: center; gap: 10px; font-family: 'JetBrains Mono', monospace; font-size: 14px; color: ${C.ink2}; white-space: nowrap; }
  .legend i { width: 22px; height: 15px; flex-shrink: 0; border-radius: 2px; }
  .swipe { margin-top: auto; align-self: flex-start; padding: 9px 14px; background: ${C.red}; color: #fff; font-family: Figtree, sans-serif; font-weight: 700; font-size: 19px; white-space: nowrap; border-radius: 3px; }
  /* Slides 2–4 */
  .table { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .row { display: grid; grid-template-columns: 284px 1fr 150px; column-gap: 14px; align-items: center; height: var(--row, 42px); border-top: 1px solid #1a2438; }
  .row.is-head { height: 30px; border-top: 0; border-bottom: 1px solid ${C.rule}; font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: ${C.ink3}; white-space: nowrap; }
  .row.is-head + .row { border-top: 0; }
  .row.is-head u { text-decoration: none; display: inline-flex; align-items: center; gap: 6px; margin-left: 14px; }
  .row.is-head u::before { content: ""; width: 16px; height: 8px; border-radius: 1px; }
  .row.is-head u.k-nep::before { background: ${C.blue}; } .row.is-head u.k-house::before { background: ${C.red}; }
  .row.is-head .rt { display: block; }
  .nm { display: flex; align-items: baseline; gap: 9px; white-space: nowrap; overflow: hidden; }
  .nm b { font-weight: 600; font-size: 18px; color: ${C.ink}; overflow: hidden; text-overflow: ellipsis; }
  .nm i { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; letter-spacing: 0.06em; color: ${C.ink3}; text-transform: uppercase; flex-shrink: 0; }
  .track { position: relative; align-self: stretch; }
  .track .bar { position: absolute; left: 0; top: 27%; bottom: 27%; background: ${C.red}; border-radius: 0 2px 2px 0; }
  .track em { position: absolute; top: 50%; transform: translate(6px, -50%); padding: 0 4px; background: ${C.ground}; font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 15px; line-height: 1.25; white-space: nowrap; color: ${C.ink2}; }
  .row.is-ph .track em { background: ${C.cell}; }
  .track .avg { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1.5px dashed rgba(243, 246, 251, 0.5); }
  .track.two .bar.is-nep { top: 14%; bottom: auto; height: 26%; background: ${C.blue}; }
  .track.two .bar.is-house { top: auto; bottom: 14%; height: 36%; }
  .track.two em { font-size: 13px; }
  .track.two em.is-nep { top: 27%; color: ${C.ink3}; }
  .track.two em.is-house { top: 68%; color: ${C.ink2}; }
  .rt { text-align: right; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; white-space: nowrap; }
  .rt b { font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 16.5px; color: ${C.ink}; }
  .rt small { font-size: 12px; color: ${C.ink3}; }
  .rt small.up { font-family: 'JetBrains Mono', monospace; color: ${C.red}; font-size: 13px; }
  .row.is-ph { background: ${C.cell}; }
  .row.is-ph .nm b { text-transform: uppercase; letter-spacing: 0.04em; padding-left: 8px; }
  .row.is-ph .track .bar { background: ${C.ink}; }
  .row.is-ph .track.two .bar.is-nep { background: ${C.blue}; }
  /* Slide 5 */
  .ctx { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 22px; }
  .pa .h { display: flex; justify-content: space-between; }
  .pa .key u { text-decoration: none; display: inline-flex; align-items: center; gap: 6px; margin-left: 14px; }
  .pa .key u::before { content: ""; width: 16px; height: 8px; border-radius: 1px; }
  .pa .key u.k-nep::before { background: ${C.blue}; } .pa .key u.k-house::before { background: ${C.red}; }
  .crow { display: grid; grid-template-columns: 250px 1fr 80px; column-gap: 14px; align-items: center; height: 50px; border-top: 1px solid #1a2438; }
  .pa .h + .crow { border-top: 0; }
  .crow.is-mpb { background: ${C.cell}; }
  .crow.is-mpb .nm b { padding-left: 8px; }
  .crow .track.two em { font-size: 14px; }
  .chg { text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 17px; color: ${C.ink3}; white-space: nowrap; padding-right: 8px; }
  .chg.up { color: ${C.red}; }
  .pa-note { margin-top: 10px; font-size: 14.5px; line-height: 1.4; color: ${C.ink2}; }
  .pa-note b { color: ${C.ink}; font-weight: 600; }
  .pbc { flex: 1; min-height: 0; display: flex; gap: 30px; }
  .pb { flex: 1.4; min-width: 0; display: flex; flex-direction: column; }
  .colchart { flex: 1; min-height: 0; display: flex; gap: 5px; margin-top: 12px; border-bottom: 1px solid ${C.rule}; }
  .colchart .c { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; }
  .colchart .c em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 11.5px; letter-spacing: -0.03em; color: ${C.ink2}; white-space: nowrap; margin-bottom: 4px; }
  .colchart .c i { width: 100%; background: ${C.red}; border-radius: 2px 2px 0 0; }
  .colchart .c.is-house i { background: repeating-linear-gradient(135deg, ${C.red} 0 4px, #c2403f 4px 8px); }
  .colchart .c b { font-family: 'JetBrains Mono', monospace; font-weight: 400; font-size: 11.5px; color: ${C.ink3}; margin-top: 6px; white-space: nowrap; height: 14px; }
  .pb-note { margin-top: 10px; font-size: 13.5px; line-height: 1.4; color: ${C.ink2}; }
  .pc { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .bign { list-style: none; flex: 1; display: flex; flex-direction: column; justify-content: space-between; margin-top: 4px; }
  .bign li { padding: 10px 0 9px; border-bottom: 1px solid #1a2438; }
  .bign li:last-child { border-bottom: 0; }
  .bign b { display: block; font-family: Figtree, sans-serif; font-weight: 700; font-size: 32px; line-height: 1.05; color: ${C.ink}; white-space: nowrap; }
  .bign li:first-child b { color: ${C.red}; }
  .bign span { display: block; margin-top: 3px; font-size: 13.5px; line-height: 1.35; color: ${C.ink2}; }
  /* The foot */
  .foot { margin-top: 18px; }
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
  <div class="foot">
    <p class="notes">${esc(s.notes)}</p>
    <p class="disc"><b>Disclaimer.</b> ${esc(DISCLAIMER)}</p>
    <p class="src">${esc(s.source)}</p>
    <p class="url"><span>${URL_TEXT} · As of ${AS_OF}</span><b>${s.n} / ${SLIDE_COUNT}</b></p>
  </div>
</div></body></html>`;
}

async function main(): Promise<void> {
  const SLIDES = [slideCover(), slideRanked(2, "house"), slideCompare(), slideRanked(4, "all"), slideContext()];
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
        // The title: the largest size (to 44px, the same on every slide) at which every line fits; the first line also clears the logo.
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
        // The strip: each figure shrinks until it fits its cell.
        for (const b of document.querySelectorAll<HTMLElement>(".cell b")) {
          let fs = 25;
          while (fs > 16 && b.scrollWidth > b.clientWidth) b.style.fontSize = `${--fs}px`;
        }
        // The rows: the height at which they fill the table.
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
        // No name, figure or label may be cut short, run past its track or wrap where it should not.
        const clipped = [...document.querySelectorAll(".nm b, .rt b, .rt small, .row.is-head > span, .list li b, .list li span, .legend li, .h, .cell b, .swipe, .kick, .src, .chg, .bign b")]
          .filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent);
        const spill = [...document.querySelectorAll(".track em")]
          .filter((el) => el.getBoundingClientRect().right > el.parentElement!.getBoundingClientRect().right + 1).map((el) => el.textContent);
        const overlap = [...document.querySelectorAll(".track.two")].filter((t) => {
          const [a, b] = [...t.querySelectorAll("em")].map((e) => e.getBoundingClientRect());
          return a.bottom > b.top + 1 && a.right > b.left && b.right > a.left;
        }).length;
        const table = document.querySelector(".table");
        const side = document.querySelector(".side");
        // Slide 5: each column's label fits over its column, and the panels hold their content.
        const colsFit = [...document.querySelectorAll(".colchart .c")].every((col) => col.querySelector("em")!.getBoundingClientRect().width <= col.getBoundingClientRect().width + 5);
        const ctxFits = [...document.querySelectorAll(".ctx, .pbc, .pb, .pc")].every((el) => el.scrollHeight <= el.clientHeight + 1);
        return {
          fitsPage: poster.scrollHeight <= height + 1 && url.bottom <= height - 20,
          bodyFits: body.scrollHeight <= body.clientHeight + 1 && (!table || table.scrollHeight <= table.clientHeight + 1) && (!side || side.scrollHeight <= side.clientHeight + 1),
          bodyHeight: Math.round(body.clientHeight), clipped, spill, overlap, colsFit, ctxFits,
        };
      }, { height: H });
      const png = join(OUT, `mpbs-for-the-people-${s.n}of${SLIDE_COUNT}-${W}x${H}.png`);
      if (args.draft) await p.screenshot({ path: png });
      if (fit.row) ensure(fit.row >= 36, `slide ${s.n}: rows of ${fit.row}px are too tight`);
      ensure(fit.title >= 34, `slide ${s.n}: the title had to shrink to ${fit.title}px`);
      ensure(lay.fitsPage, `slide ${s.n}: the page overflows`);
      ensure(lay.bodyFits, `slide ${s.n}: the body's content overflows it`);
      ensure(lay.clipped.length === 0, `slide ${s.n}: cut short: ${lay.clipped.join(" | ")}`);
      ensure(lay.spill.length === 0, `slide ${s.n}: a bar label runs past its track: ${lay.spill.join(" | ")}`);
      ensure(lay.overlap === 0, `slide ${s.n}: ${lay.overlap} NEP/House label pairs overlap`);
      ensure(lay.colsFit, `slide ${s.n}: a column label is wider than its column`);
      ensure(lay.ctxFits, `slide ${s.n}: a panel's content overflows it`);
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
