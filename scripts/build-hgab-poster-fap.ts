/**
 * "Cut Year After Year": a poster for /hgab/2027/foreign-assisted. Foreign-assisted projects in every budget since
 * FY 2021, one bar per year: what the NEP proposed (hatched), what the enacted budget carried (ink; the House bill in
 * red for FY 2027), and what agencies actually obligated (the blue line), with the cut on top. Under it, the House
 * bill's largest cuts and the standby the projects ran on instead (unprogrammed appropriations).
 *
 * Every figure comes from src/lib/hgab-fap.ts (DBM's BESF series, the unprogrammed figures) and data/hgab/2027/fap.json
 * (npm run build:hgab-fap), which the page reads too and verify:hgab checks, so the poster cannot disagree with the
 * site. The background is every foreign-assisted line itself: the FY 2027 House bill against the NEP, then every
 * enacted budget from FY 2026 back to FY 2020 (data/gaa-history/parquet). Nothing is generated.
 *
 * Renders in headless Chromium (playwright-core) in the campaign's type (Anton, Inter, JetBrains Mono), paper and
 * footer, and writes to --out (default data/hgab/2027/campaign/, gitignored):
 *   foreign-assisted-1080x1350.png   feed, portrait (4:5)
 *   foreign-assisted-1080x1080.png   feed, square: fewer rows, the address in the footer
 *   foreign-assisted-1200x630.png    link preview: the title and the years
 * and prints each file's MD5 prefix for FAP_POSTERS (the link preview's and the page's `?v=`).
 *
 * Usage: npx tsx scripts/build-hgab-poster-fap.ts [--out=dir] [--only=portrait,square,og] [--draft]
 * Needs network access for Google Fonts.
 */
import { DuckDBInstance } from "@duckdb/node-api";
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  FAP_POSTERS, FAP_ROOT, FAP_SERIES, UNPROGRAMMED, UNPROGRAMMED_RELEASES_2025_PHP, cutShare, type FapData, type FapProject,
} from "../src/lib/hgab-fap";

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`build-hgab-poster-fap: ${msg}`); process.exit(1); }
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const ROOT = resolve(import.meta.dirname, "..");
const DATA = resolve(args.data ?? join(ROOT, "data"));
const OUT = resolve(args.out ?? join(DATA, "hgab/2027/campaign"));
const FAP_JSON = join(DATA, "hgab/2027/fap.json");
const URL_TEXT = `budget.bettergov.ph${FAP_ROOT}`;

// ---------------------------------------------------------------------------
// The figures (the page's, checked by verify:hgab)
// ---------------------------------------------------------------------------

ensure(existsSync(FAP_JSON), `${FAP_JSON} missing (npm run build:hgab-fap)`);
const D = JSON.parse(readFileSync(FAP_JSON, "utf8")) as FapData;
const T = D.totals;
const CUT = T.all.nep_php - T.all.house_php;
const YEARS = FAP_SERIES.filter((y) => y.fy >= 2021);
const PAST = YEARS.filter((y) => y.fy <= 2026);
const SHARES = PAST.map((y) => cutShare(y)!);
ensure(SHARES.every((s) => s > 0), "an enacted budget since FY 2021 carried more than the NEP; the title says every year was cut");
const LO = Math.round(Math.min(...SHARES) * 100), HI = Math.round(Math.max(...SHARES) * 100);
const SHARE_2027 = Math.round((CUT / T.all.nep_php) * 100);
ensure(SHARE_2027 > 0 && SHARE_2027 < LO, `the House bill's ${SHARE_2027}% is no longer below every enacted cut (${LO}%); the subtitle says so`);
const SUPPORT_2026 = UNPROGRAMMED.support.find((s) => s.fy === 2026)!.php;
const SUPPORT_2027 = UNPROGRAMMED.support.find((s) => s.fy === 2027)!.php;

const b1 = (php: number) => `₱${(Math.abs(php) / 1e9).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}B`;
const words = (php: number) => `₱${(Math.abs(php) / 1e9).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}\u00A0billion`;
const signed = (php: number) => (php === 0 ? "same" : `${php > 0 ? "+" : "−"}${b1(php)}`);
const pct = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;

/** Short names for the poster's rows; the page and the CSV keep the bill's own. */
const SHORT: [RegExp, string][] = [
  [/^Laguna Lakeshore Road Network/i, "Laguna Lakeshore Road Network"],
  [/^Metro Manila Subway/i, "Metro Manila Subway"],
  [/^North-South Commuter Railway/i, "North–South Commuter Railway"],
  [/^Bataan-Cavite Interlink Bridge/i, "Bataan–Cavite Interlink Bridge"],
  [/^Cebu-Mactan Bridge/i, "Cebu–Mactan 4th Bridge"],
  [/^Panahon ng Pagkilos/i, "Community Resilience Project"],
  [/^Pasig - Marikina River Channel/i, "Pasig–Marikina River, Phase IV"],
  [/^Davao Public Transport Modernization/i, "Davao Public Transport"],
  [/^Cavite Industrial Area Flood/i, "Cavite Industrial Area Flood Control"],
  [/^Mindanao Transport Connectivity/i, "Mindanao Transport Connectivity"],
  [/^Davao City Bypass Construction Project \(III\)/i, "Davao City Bypass, Phase III"],
  [/^Davao City Bypass Construction Project \(II\)/i, "Davao City Bypass, Phase II"],
  [/^New Cebu International Container Port/i, "New Cebu Container Port"],
  [/^Metro Manila Priority Bridges Seismic/i, "Metro Manila Bridges, Seismic"],
  [/^Philippine Digital Infrastructure/i, "Digital Infrastructure Project"],
];
function shortName(p: FapProject): string {
  const hit = SHORT.find(([re]) => re.test(p.title));
  ensure(hit, `no short name for "${p.title}" (add it to SHORT)`);
  return hit[1];
}
const CUTS = [...D.projects].filter((p) => p.change_php < 0).sort((a, b) => a.change_php - b.change_php);
const DEPTS = D.departments.filter((d) => d.change_php < 0).sort((a, b) => a.change_php - b.change_php);
const DEPT_NAME: Record<string, string> = {
  "18": "Public Works (DPWH)", "38": "Transportation (DOTr)", "20": "Social Welfare (DSWD)", "05": "Agriculture (DA)",
  "07": "Education (DepEd)", "37": "ICT (DICT)", "30": "Civil Service (CSC)", "13": "Health (DOH)", "04": "Agrarian Reform (DAR)",
};

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

const KICKER = ["Foreign-assisted projects", "FY 2027 Budget"];
const TITLE = ["Cut", "Year After Year"];
const STRAP = `${words(CUT)} cut in the 2027 House bill.`.replace("\u00A0", " ");
const SUB =
  `Projects paid for with foreign loans. Every enacted budget since 2021 gave them ${LO}% to ${HI}% less than the NEP ` +
  `proposed, and they ran on unprogrammed appropriations instead. This year the House cut ${SHARE_2027}%.`;
const CTA = ["Every project:", URL_TEXT];
const FINE =
  `<strong>Foreign-assisted projects: House Bill 10858 (third reading) against the FY 2027 NEP, and every budget since FY 2021.</strong> ` +
  `FY 2021–2026 are DBM’s own figures (Budget of Expenditures and Sources of Financing, Table B.13): NEP, enacted budget as adjusted, ` +
  `and actual obligations, which include releases from unprogrammed appropriations. A smaller appropriation does not cancel a signed loan; ` +
  `it delays the drawdown. Amounts are allocations, not spending.`;
const FINE_SHORT =
  `<strong>Foreign-assisted projects, House Bill 10858 against the FY 2027 NEP, and every budget since FY 2021.</strong> ` +
  `FY 2021–2026 from DBM’s Budget of Expenditures and Sources of Financing, Table B.13. Amounts are allocations, not spending.`;
const FINE_OG = `FY 2021–2026 from DBM’s Budget of Expenditures and Sources of Financing, Table B.13. Amounts are allocations, not spending.`;

// ---------------------------------------------------------------------------
// The wall: every foreign-assisted line, FY 2027 then every enacted budget back to FY 2020
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const count = (n: number) => n.toLocaleString("en-US");
const peso = (v: number) => `₱${count(v)}`;
async function wall(): Promise<string[]> {
  const out: string[] = [];
  for (const p of D.projects) {
    const name = `<i>FY2027 ${esc(p.dept_short)}</i> ${esc(p.title)}`;
    const n = p.nep_php ?? 0, h = p.house_php ?? 0;
    out.push(n === h ? `<span class="e">${name} <b>${peso(h)}</b></span>` : `<span class="e is-${h > n ? "up" : "dn"}">${name} <b>${peso(n)} → ${peso(h)}</b></span>`);
  }
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  for (let fy = 2026; fy >= 2020; fy--) {
    const p = join(DATA, `gaa-history/parquet/gaa-${fy}.parquet`);
    ensure(existsSync(p), `${p} missing`);
    const rows = (await c.runAndReadAll(`
      SELECT department_id, max(fpap_dsc), SUM(amount) FROM read_parquet('${p}')
      WHERE fy = ${fy} AND substr(fpap_code, 7, 1) = '3' AND amount > 0 GROUP BY department_id, fpap_code ORDER BY 3 DESC`)).getRows();
    for (const r of rows) out.push(`<span class="e is-old"><i>FY${fy}</i> ${esc(String(r[1]).replace(/\s+/g, " ").trim())} <b>${peso(Number(r[2]))}</b></span>`);
  }
  c.closeSync();
  db.closeSync();
  return out;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const dataUri = (path: string, type: string) => `data:${type};base64,${readFileSync(path).toString("base64")}`;
const LOGO = dataUri(join(ROOT, "public/brand/bettergov-horizontal-white.png"), "image/png");

/** rows: how many of the House bill's cuts and of the departments each feed size lists; the link preview lists none. */
interface Format { key: string; W: number; H: number; foot: number; cta: boolean; table: boolean; sub: boolean; t: number; chart: number; cuts: number; depts: number; titleMax: number; fine: string }
const FORMATS: Format[] = [
  { key: "portrait", W: 1080, H: 1350, foot: 140, cta: true, table: true, sub: true, t: 1, chart: 31, cuts: 8, depts: 4, titleMax: 260, fine: FINE },
  { key: "square", W: 1080, H: 1080, foot: 112, cta: false, table: true, sub: false, t: 0.86, chart: 24, cuts: 7, depts: 3, titleMax: 260, fine: FINE_SHORT },
  { key: "og", W: 1200, H: 630, foot: 84, cta: false, table: false, sub: false, t: 0.92, chart: 15, cuts: 0, depts: 0, titleMax: 92, fine: FINE_OG },
];
const ONLY = (args.only as string | undefined)?.split(",");

function css(f: Format): string {
  const { W, H, t } = f, u = W / 100;
  const left = 4.6 * u, width = W - 2 * left;
  const ring = `box-shadow: 0 0 0 ${0.5 * u}px var(--paper)`;
  const hatch = (c: string, w: number) => `repeating-linear-gradient(135deg, ${c} 0 ${w}px, transparent ${w}px ${2 * w}px)`;
  return `
  @page { size: ${W}px ${H}px; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${W}px; height: ${H}px; background: #f3eee4; overflow: hidden; }
  .poster { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: #f3eee4; color: #141414; --paper: #f3eee4; --red: #d62828; --blue: #0b4fd9; --ink: #141414; --maroon: #7a1414; }
  .wall {
    position: absolute; left: ${1.6 * u}px; right: ${1.6 * u}px; top: ${1.4 * u}px; bottom: ${f.foot}px;
    font-family: Inter, sans-serif; text-align: justify; hyphens: none; overflow: hidden;
    color: rgba(20, 20, 20, 0.22); line-height: 1.22; word-spacing: 0.02em;
  }
  .wall .e i { font-style: normal; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: rgba(20, 20, 20, 0.32); }
  .wall .e b { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: rgba(20, 20, 20, 0.3); letter-spacing: -0.02em; }
  .wall .e.is-up b { color: rgba(214, 40, 40, 0.6); }
  .wall .e.is-dn b { color: rgba(11, 79, 217, 0.55); }
  .wall .e::after { content: " ■ "; color: rgba(20, 20, 20, 0.2); }
  .head { position: absolute; left: ${left}px; width: ${width}px; top: ${4.3 * u}px; height: ${H - f.foot - 4.3 * u - (f.cta ? 2.4 : 2) * u}px; display: flex; flex-direction: column; }
  .pap { background: var(--paper); ${ring}; }
  .kick { display: flex; justify-content: space-between; align-items: baseline; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${2 * t * u}px; letter-spacing: 0.12em; text-transform: uppercase; }
  .kick span { background: var(--paper); ${ring}; }
  .title { margin-top: ${0.9 * u}px; display: flex; align-items: flex-end; column-gap: ${2.2 * u}px; font-family: Anton, Impact, sans-serif; font-weight: 400; line-height: 0.9; text-transform: uppercase; letter-spacing: 0.005em; color: #111; }
  .title span { display: block; flex-shrink: 0; width: fit-content; white-space: nowrap; background: var(--paper); ${ring}; }
  .title .red { color: var(--red); }
  .strap { margin-top: ${1 * u}px; }
  .strap span { display: inline-block; white-space: nowrap; font-family: Anton, Impact, sans-serif; font-size: ${4.3 * t * u}px; line-height: 1; text-transform: uppercase; letter-spacing: 0.01em; color: #f3eee4; background: var(--ink); padding: ${0.7 * u}px ${1.5 * u}px ${0.6 * u}px; }
  .sub { margin-top: ${1.3 * t * u}px; font-family: Inter, sans-serif; font-weight: 700; font-size: ${2.05 * t * u}px; line-height: 1.3; color: #111; text-wrap: pretty; }
  /* The years: one column each, the NEP hatched behind, the enacted budget (or the House bill) in front, the obligations as a line. */
  .years { margin-top: ${2 * t * u}px; background: var(--paper); ${ring}; padding: ${0.4 * u}px 0 0; }
  .ycols { display: grid; grid-template-columns: repeat(${YEARS.length}, 1fr); column-gap: ${1.6 * u}px; height: ${f.chart * u}px; border-bottom: ${0.25 * u}px solid var(--ink); }
  .ycol { position: relative; display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch; min-width: 0; }
  .ycol .stack { position: relative; width: 100%; }
  .ycol .nep { position: absolute; left: 0; right: 0; bottom: 0; background: ${hatch("rgba(20, 20, 20, 0.55)", 0.32 * u)}, var(--paper); outline: ${0.18 * u}px solid rgba(20, 20, 20, 0.7); outline-offset: ${-0.18 * u}px; }
  .ycol .gaa { position: absolute; left: 0; right: 0; bottom: 0; background: var(--ink); display: flex; justify-content: center; align-items: flex-start; }
  .ycol .gaa.is-house { background: var(--red); }
  .ycol .gaa em, .ycol .gaa-lab { font-style: normal; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.35 * t * u}px; white-space: nowrap; letter-spacing: -0.03em; }
  .ycol .gaa em { color: #fff; padding-top: ${0.4 * u}px; }
  .ycol .gaa-lab { position: absolute; left: 50%; transform: translateX(-50%); color: #111; background: var(--paper); padding: 0 ${0.3 * u}px; }
  .ycol .gaa-lab { z-index: 2; }
  .ycol .act { position: absolute; z-index: 1; left: ${-0.5 * u}px; right: ${-0.5 * u}px; height: 0; border-top: ${0.45 * u}px solid var(--blue); }
  .ycol .top { position: absolute; left: ${-0.8 * u}px; right: ${-0.8 * u}px; display: flex; flex-direction: column; align-items: center; gap: ${0.15 * u}px; }
  .ycol .cut { font-family: Anton, Impact, sans-serif; font-size: ${3.4 * t * u}px; line-height: 1; color: var(--red); background: var(--paper); padding: 0 ${0.3 * u}px; white-space: nowrap; }
  .ycol .nepv { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.3 * t * u}px; color: #444; background: var(--paper); padding: 0 ${0.2 * u}px; white-space: nowrap; letter-spacing: -0.03em; }
  .ylabs { display: grid; grid-template-columns: repeat(${YEARS.length}, 1fr); column-gap: ${1.6 * u}px; margin-top: ${0.5 * u}px; font-family: Anton, Impact, sans-serif; font-size: ${2.3 * t * u}px; line-height: 1; text-align: center; }
  .ylabs span.is-now { color: var(--red); }
  .key { display: flex; flex-wrap: wrap; column-gap: ${1.8 * u}px; row-gap: ${0.3 * u}px; margin-top: ${0.9 * t * u}px; font-family: Inter, sans-serif; font-weight: 700; font-size: ${1.35 * t * u}px; color: #222; }
  .key span { display: inline-flex; align-items: center; gap: ${0.5 * u}px; white-space: nowrap; }
  .key i { display: inline-block; width: ${1.3 * t * u}px; height: ${1.3 * t * u}px; }
  .key i.is-nep { background: ${hatch("rgba(20, 20, 20, 0.55)", 0.22 * u)}, var(--paper); outline: ${0.15 * u}px solid rgba(20, 20, 20, 0.7); outline-offset: ${-0.15 * u}px; }
  .key i.is-gaa { background: var(--ink); } .key i.is-house { background: var(--red); }
  .key i.is-act { height: 0; border-top: ${0.45 * u}px solid var(--blue); }
  /* Two panels, one row per line, as on the red-flags poster. */
  .cols { flex: 1; min-height: 0; margin-top: ${2.2 * t * u}px; display: grid; grid-template-columns: 1.08fr 0.92fr; column-gap: ${2 * u}px; align-items: stretch; }
  .panel { position: relative; background: var(--paper); border: ${0.25 * u}px solid var(--ink); padding: ${0.6 * t * u}px ${1.4 * u}px ${0.6 * t * u}px; display: flex; flex-direction: column; }
  .grp { display: flex; align-items: baseline; justify-content: space-between; gap: ${u}px; margin-top: ${0.9 * t * u}px; padding: ${0.35 * u}px ${0.75 * u}px; color: #fff; background: var(--ink); font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.35 * t * u}px; letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; }
  .grp:first-child { margin-top: 0; }
  .grp b { letter-spacing: -0.01em; }
  .grp.is-red { background: var(--red); }
  .grp.is-ua { background: ${hatch("rgba(122, 20, 20, 0.8)", 0.45 * u)}, #f3eee4; color: var(--maroon); }
  .grp.is-ua span, .grp.is-ua b { background: var(--paper); padding: 0 ${0.3 * u}px; }
  .row { position: relative; display: grid; grid-template-columns: 1fr ${7.4 * t * u}px ${7.6 * t * u}px; column-gap: ${0.6 * u}px; align-items: center; height: var(--row, ${2.8 * t * u}px); border-top: ${0.1 * u}px solid rgba(20, 20, 20, 0.18); }
  .grp + .row, .is-head + .row { border-top: 0; }
  .row > * { position: relative; }
  .row .bar { position: absolute; left: 0; top: ${0.35 * t * u}px; bottom: ${0.35 * t * u}px; background: rgba(11, 79, 217, 0.12); }
  .row .nm { font-family: Inter, sans-serif; font-weight: 700; font-size: ${1.5 * t * u}px; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .nm u { text-decoration: none; font-family: 'JetBrains Mono', monospace; font-size: ${1.05 * t * u}px; letter-spacing: 0.04em; color: #fff; background: var(--blue); padding: ${0.1 * u}px ${0.35 * u}px; margin-left: ${0.5 * u}px; vertical-align: ${0.15 * u}px; }
  .row .nm s { text-decoration: none; font-family: 'JetBrains Mono', monospace; font-size: ${1.05 * t * u}px; letter-spacing: 0.06em; color: rgba(20, 20, 20, 0.55); margin-right: ${0.5 * u}px; }
  .row .hs, .row .ch { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.5 * t * u}px; text-align: right; white-space: nowrap; letter-spacing: -0.02em; }
  .row .hs { color: #111; }
  .row .ch.is-dn { color: var(--blue); } .row .ch.is-same { color: rgba(20, 20, 20, 0.45); } .row .ch.is-note { color: var(--maroon); font-size: ${1.15 * t * u}px; letter-spacing: 0.04em; text-transform: uppercase; }
  .row.is-head { height: ${2 * t * u}px; border-top: 0; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.05 * t * u}px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(20, 20, 20, 0.6); }
  .row.is-head .hs, .row.is-head .ch { font-size: ${1.05 * t * u}px; color: rgba(20, 20, 20, 0.6); letter-spacing: 0.04em; }
  .cta { margin-top: ${2 * u}px; display: flex; align-items: baseline; justify-content: center; gap: ${1.2 * u}px; background: var(--red); color: #fff; padding: ${1 * u}px ${1.5 * u}px ${0.9 * u}px; white-space: nowrap; }
  .cta b { font-family: Anton, Impact, sans-serif; font-weight: 400; font-size: ${3.1 * u}px; line-height: 1; text-transform: uppercase; letter-spacing: 0.01em; }
  .cta span { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${2.3 * u}px; line-height: 1; letter-spacing: -0.02em; }
  .foot {
    position: absolute; left: 0; right: 0; bottom: 0; height: ${f.foot}px; background: #111; color: #f3eee4;
    padding: ${(f.cta ? 2 : 1.6) * u}px ${4.6 * u}px; display: grid; grid-template-columns: ${17 * u}px 1fr; column-gap: ${3.4 * u}px; align-items: start;
    font-family: Inter, sans-serif;
  }
  .foot .brands { padding-top: ${0.6 * u}px; }
  .foot .brands img { display: block; width: ${2.3 * u * (800 / 189)}px; }
  .foot .url { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${2 * u}px; color: #fff; margin-bottom: ${0.5 * u}px; white-space: nowrap; }
  .foot .fine { font-size: ${1.25 * u}px; line-height: 1.42; color: rgba(243, 238, 228, 0.85); }
  .foot .fine strong { color: #fff; font-weight: 700; }
  ${f.key === "og" ? `
  .foot { grid-template-columns: ${17 * u}px 1fr; align-items: center; padding-top: ${1.1 * u}px; padding-bottom: ${1.1 * u}px; }
  .foot .brands { padding-top: 0; }
  .foot .brands img { width: ${2 * u * (800 / 189)}px; }
  .foot .url { font-size: ${1.7 * u}px; margin-bottom: ${0.3 * u}px; }
  .foot .fine { font-size: ${1.1 * u}px; }` : ""}`;
}

/** The chart's scale: the largest bar, with room above it for the cut and the NEP's figure. */
function years(f: Format): string {
  const house = T.all.house_php;
  const max = Math.max(...YEARS.map((y) => y.proposed!.total));
  // The tallest bar takes what the chart leaves after the cut and the NEP figure above it (at most 80%).
  const room = Math.min(0.8, 1 - (6 * f.t) / f.chart);
  const h = (v: number) => `${((v / max) * room * 100).toFixed(3)}%`;
  const cols = YEARS.map((y) => {
    const nep = y.proposed!.total;
    const now = y.fy === 2027;
    const gaa = now ? house : y.program!.total;
    const cut = nep - gaa;
    const gaaH = (gaa / max) * room * f.chart; // in u, to decide whether the figure fits inside the bar
    const inside = gaaH >= 4;
    const act = y.actual ? `<i class="act" style="bottom:${h(y.actual.total)}" title="Actually obligated ${b1(y.actual.total)}"></i>` : "";
    return `<div class="ycol">
        <i class="nep" style="height:${h(nep)}"></i>
        <i class="gaa ${now ? "is-house" : ""}" style="height:${h(gaa)}">${inside ? `<em>${b1(gaa)}</em>` : ""}</i>
        ${inside ? "" : `<span class="gaa-lab" style="bottom:calc(${h(gaa)} + 2px)">${b1(gaa)}</span>`}
        ${act}
        <div class="top" style="bottom:calc(${h(nep)} + 4px)"><span class="cut">−${pct(cut, nep)}</span><span class="nepv">${b1(nep)}</span></div>
      </div>`;
  }).join("");
  const labs = YEARS.map((y) => `<span class="${y.fy === 2027 ? "is-now" : ""}">${y.fy}</span>`).join("");
  return `<div class="years">
      <div class="ycols">${cols}</div>
      <div class="ylabs">${labs}</div>
      <p class="key"><span><i class="is-nep"></i>NEP (proposed)</span><span><i class="is-gaa"></i>Enacted budget</span><span><i class="is-house"></i>2027 House bill</span><span><i class="is-act"></i>Actually obligated</span></p>
    </div>`;
}

const head = (a: string, b: string, c: string) => `<div class="row is-head"><span>${a}</span><span class="hs">${b}</span><span class="ch">${c}</span></div>`;
function cutRow(p: FapProject, max: number): string {
  const w = ((-p.change_php / max) * 100).toFixed(2);
  return `<div class="row"><i class="bar" style="width:${w}%"></i><span class="nm"><s>${esc(p.dept_short)}</s>${esc(shortName(p))}</span><span class="hs">${b1(p.house_php ?? 0)}</span><span class="ch is-dn">${signed(p.change_php)}</span></div>`;
}
function deptRow(d: FapData["departments"][number], max: number): string {
  const w = ((-d.change_php / max) * 100).toFixed(2);
  return `<div class="row"><i class="bar" style="width:${w}%"></i><span class="nm">${esc(DEPT_NAME[d.dept_code] ?? d.dept_short)}<u>−${pct(-d.change_php, d.nep_php)}</u></span><span class="hs">${b1(d.house_php)}</span><span class="ch is-dn">${signed(d.change_php)}</span></div>`;
}
function panels(f: Format): string {
  const cuts = CUTS.slice(0, f.cuts);
  const maxCut = -CUTS[0].change_php;
  const left = `<div class="panel">
      <p class="grp is-red"><span>House bill cuts</span><b>${T.cut} of ${T.projects}</b></p>
      ${head("Project", "House bill", "vs NEP")}${cuts.map((p) => cutRow(p, maxCut)).join("")}
    </div>`;
  const depts = DEPTS.slice(0, f.depts);
  const ua = [
    { nm: "2025: actually released", v: UNPROGRAMMED_RELEASES_2025_PHP, note: "actual" },
    // The FY2026 figure is the bills' (NEP, House, Senate); the enacted split by purpose is not published in the NEP.
    { nm: "2026: in the bills", v: SUPPORT_2026, note: "standby" },
    { nm: "2027: NEP and House", v: SUPPORT_2027, note: "standby" },
  ];
  const right = `<div class="panel">
      <p class="grp"><span>By department</span><b>${signed(-CUT)}</b></p>
      ${depts.map((d) => deptRow(d, -DEPTS[0].change_php)).join("")}
      <p class="grp is-ua"><span>Unprogrammed standby</span><b>loans only</b></p>
      ${ua.map((x) => `<div class="row"><span class="nm">${esc(x.nm)}</span><span class="hs">${b1(x.v)}</span><span class="ch is-note">${esc(x.note)}</span></div>`).join("")}
    </div>`;
  return `<div class="cols">${left}${right}</div>`;
}

function body(f: Format): string {
  return `
    <div class="kick"><span>${esc(KICKER[0])}</span><span>${esc(KICKER[1])}</span></div>
    <div class="title"><span>${esc(TITLE[0])}</span><span class="red">${esc(TITLE[1])}</span></div>
    <p class="strap"><span>${esc(STRAP)}</span></p>${f.sub ? `
    <p class="sub"><span class="pap">${esc(SUB)}</span></p>` : ""}
    ${years(f)}${f.table ? panels(f) : ""}${f.cta ? `
    <p class="cta"><b>${esc(CTA[0])}</b><span>${esc(CTA[1])}</span></p>` : ""}`;
}

function html(f: Format): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=block" rel="stylesheet">
<style>${css(f)}</style></head><body><div class="poster">
  <div class="wall" id="wall"></div>
  <div class="head" id="head">${body(f)}</div>
  <div class="foot">
    <div class="brands"><img src="${LOGO}" alt="BetterGov.PH"></div>
    <div>${f.cta ? "" : `<div class="url">${URL_TEXT}</div>`}<div class="fine" id="fine">${f.fine}</div></div>
  </div>
</div></body></html>`;
}

async function main(): Promise<void> {
  const ENTRIES = await wall();
  ensure(ENTRIES.length > 400, `only ${ENTRIES.length} lines for the wall`);
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const f of FORMATS) {
      if (ONLY && !ONLY.includes(f.key)) continue;
      const { W, H } = f, u = W / 100;
      const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
      await p.setContent(html(f), { waitUntil: "networkidle" });
      await p.evaluate(() => document.fonts.ready);
      await p.evaluate("globalThis.__name = (f) => f");
      const shown = await p.evaluate(({ entries, font, titleMax }) => {
        // The title: one line, the largest size at which it fits the head (Anton's widths step, so search).
        const title = document.querySelector<HTMLElement>(".title")!;
        const spans = [...title.querySelectorAll<HTMLElement>("span")];
        const edge = title.getBoundingClientRect().right;
        let small = 40, big = titleMax;
        while (big - small > 0.1) {
          const m = (small + big) / 2;
          for (const el of spans) el.style.fontSize = `${m}px`;
          if (spans[spans.length - 1].getBoundingClientRect().right <= edge) small = m; else big = m;
        }
        for (const el of spans) el.style.fontSize = `${small}px`;
        // The wall: as many lines as fit, FY 2027 first.
        const wall = document.getElementById("wall")!;
        wall.style.fontSize = `${font}px`;
        const fits = (n: number) => { wall.innerHTML = entries.slice(0, n).join(""); return wall.scrollHeight <= wall.clientHeight + 0.5; };
        let lo = 0, hi = entries.length;
        while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid - 1; }
        fits(lo);
        // The rows: the height at which the fuller panel fills; the other uses the same.
        const panels = [...document.querySelectorAll<HTMLElement>(".panel")];
        const room = (el: HTMLElement) => { const cs = getComputedStyle(el); return el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom); };
        const fill = panels.length ? Math.min(...panels.map((el) => {
          const rows = el.querySelectorAll(".row:not(.is-head)").length;
          const fixed = [...el.children].filter((c) => !c.matches(".row:not(.is-head)")).reduce((a, c) => {
            const cs = getComputedStyle(c);
            return a + c.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
          }, 0);
          return (room(el) - fixed) / rows;
        })) : 0;
        if (panels.length) document.documentElement.style.setProperty("--row", `${Math.floor(fill)}px`);
        return { shown: lo, row: Math.floor(fill), title: Math.round(small) };
      }, { entries: ENTRIES, font: f.key === "og" ? 6.6 : 7.2, titleMax: f.titleMax });
      const lay = await p.evaluate(() => {
        const head = document.getElementById("head")!.getBoundingClientRect();
        const last = document.querySelector(".cta") ?? document.querySelector(".cols") ?? document.querySelector(".years")!;
        const foot = document.querySelector(".foot")!.getBoundingClientRect();
        const fine = document.getElementById("fine")!.getBoundingClientRect();
        const lines = [...document.querySelectorAll(".title span, .strap span, .cta b, .cta span, .foot .url")].map((s) => {
          const r = s.getBoundingClientRect();
          return { text: s.textContent, right: r.right, h: r.height, fs: parseFloat(getComputedStyle(s).fontSize) };
        });
        const panels = [...document.querySelectorAll(".panel")].map((el) => ({ fits: el.scrollHeight <= el.clientHeight + 1 }));
        const clipped = [...document.querySelectorAll(".row .nm, .row .hs, .row .ch, .grp, .key")]
          .filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent);
        // Each year's labels must stay inside the chart, above the axis, and clear of the next column's.
        const chart = document.querySelector(".ycols")!.getBoundingClientRect();
        const tops = [...document.querySelectorAll(".ycol .top")].map((el) => el.getBoundingClientRect());
        const topsOut = tops.filter((r) => r.top < chart.top - 2).length;
        const overlap = tops.slice(1).filter((r, i) => r.left < tops[i].right - 2).length;
        const ems = [...document.querySelectorAll(".ycol .gaa em")].filter((el) => el.getBoundingClientRect().width > el.parentElement!.getBoundingClientRect().width + 1).length;
        const urlEl = document.querySelector(".foot .url");
        return {
          urlRight: urlEl ? urlEl.getBoundingClientRect().right : 0, footRight: foot.right, headRight: head.right,
          lastBottom: last.getBoundingClientRect().bottom, ctaFits: !document.querySelector(".cta") || document.querySelector(".cta")!.scrollWidth <= document.querySelector(".cta")!.clientWidth + 1,
          footTop: foot.top, footBottom: foot.bottom, fineBottom: fine.bottom, lines, panels, clipped, topsOut, overlap, ems,
        };
      });
      const png = join(OUT, `foreign-assisted-${W}x${H}.png`);
      // --draft writes the picture even when a check fails, to see why.
      if (args.draft) await p.screenshot({ path: png, fullPage: false });
      if (f.table) ensure(shown.row >= 2.3 * f.t * u, `${f.key}: rows of ${shown.row}px are too tight`);
      ensure(lay.lastBottom <= lay.footTop - 4, `${f.key}: the head runs into the footer (${Math.round(lay.lastBottom)} > ${Math.round(lay.footTop)})`);
      ensure(lay.panels.every((x) => x.fits), `${f.key}: a panel's rows overflow it`);
      ensure(lay.clipped.length === 0, `${f.key}: cut short: ${lay.clipped.join(" | ")}`);
      ensure(lay.topsOut === 0, `${f.key}: ${lay.topsOut} year labels leave the chart`);
      ensure(lay.overlap === 0, `${f.key}: ${lay.overlap} year labels overlap`);
      ensure(lay.ems === 0, `${f.key}: a bar's figure is wider than the bar`);
      const bad = lay.lines.filter((x) => x.right > Math.max(lay.headRight, lay.footRight - 4.6 * u) + 1 || x.h > x.fs * 1.6);
      ensure(bad.length === 0, `${f.key}: a one-line text wraps or leaves the poster: ${bad.map((x) => `${x.text} (right ${Math.round(x.right)} / ${Math.round(lay.headRight)}, ${Math.round(x.h)}px at ${Math.round(x.fs)}px)`).join(" | ")}`);
      ensure(lay.ctaFits, `${f.key}: the address does not fit its band`);
      ensure(lay.fineBottom <= lay.footBottom - 2, `${f.key}: the footer text runs out of the footer`);
      if (!args.draft) await p.screenshot({ path: png, fullPage: false });
      const md5 = createHash("md5").update(readFileSync(png)).digest("hex").slice(0, 8);
      const known = FAP_POSTERS.find((x) => x.key === f.key)?.v;
      console.log(`${f.key} ${W}×${H} · title ${shown.title}px · rows ${shown.row}px · wall ${count(shown.shown)} of ${count(ENTRIES.length)} lines · ends ${Math.round(lay.lastBottom)} / footer ${Math.round(lay.footTop)} → ${png} · v=${md5}${known && known !== md5 ? ` (FAP_POSTERS has ${known})` : ""}`);
      await p.close();
    }
  } finally {
    await browser.close();
  }
}

void main();

