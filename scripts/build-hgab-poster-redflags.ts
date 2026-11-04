/**
 * "₱1 Trillion in Red Flags": a poster for /hgab/2027/1T-redflags, the People's Budget Coalition's red-flag basket
 * through the FY 2027 House bill. Two bars to one scale, the House bill over the NEP, cross or stop short of a line at
 * ₱1 trillion; under them, every line of the basket in its group, with its House bill amount and its change from the
 * NEP. PBC's names its groups; the poster's short names are the page's.
 *
 * Every figure comes from src/lib/hgab-redflags.ts, which the page reads too and verify:hgab checks against our own
 * reading of the bill, so the poster cannot disagree with the site. The background is the House bill's own lines
 * inside the basket, from the line-by-line explorer (data/hgab/2027/explorer/d/), office by office, the changed ones
 * in colour. Nothing is generated.
 *
 * Renders in headless Chromium (playwright-core) in the campaign's type (Anton, Inter, JetBrains Mono), paper and
 * footer, with both coalition logos, and writes to --out (default data/hgab/2027/campaign/, gitignored):
 *   1t-red-flags-1080x1350.png   feed, portrait (4:5)
 *   1t-red-flags-1080x1080.png   feed, square: the same lines, the address in the footer
 *   1t-red-flags-1200x630.png    link preview: the title and the two bars
 * and prints each file's MD5 prefix for RED_FLAG_POSTERS (the page's and the link preview's `?v=`).
 *
 * Usage: npx tsx scripts/build-hgab-poster-redflags.ts [--out=dir] [--only=portrait,square,og] [--draft]
 * Needs network access for Google Fonts.
 */
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  PBC_REPORT, RED_FLAGS_ROOT, RED_FLAG_GROUPS, RED_FLAG_LINES, RED_FLAG_TOTALS, RED_FLAG_UNPROGRAMMED, TRILLION,
  linesOf, pbcBillions, pbcBillionsWords, pbcChange, type RedFlagGroupKey, type RedFlagLine,
} from "../src/lib/hgab-redflags";

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`build-hgab-poster-redflags: ${msg}`); process.exit(1); }
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const ROOT = resolve(import.meta.dirname, "..");
const EXPLORER = join(ROOT, "data/hgab/2027/explorer/d");
const OUT = resolve(args.out ?? join(ROOT, "data/hgab/2027/campaign"));
const URL_TEXT = `budget.bettergov.ph${RED_FLAGS_ROOT}`;

// ---------------------------------------------------------------------------
// The figures (PBC's, checked by verify:hgab)
// ---------------------------------------------------------------------------

const T = RED_FLAG_TOTALS, U = RED_FLAG_UNPROGRAMMED;
ensure(T.all.house > TRILLION && T.all.nep < TRILLION, "the House bill's basket is no longer past ₱1 trillion, or the NEP's is; the title says otherwise");
const PATRONAGE = RED_FLAG_GROUPS.find((g) => g.key === "patronage")!;
const patronageRise = Math.round((PATRONAGE.change / PATRONAGE.nep) * 100);
ensure(patronageRise === 50, `the patronage group rose ${patronageRise}%, not the 50% the subtitle says`);
/** The bars' scale: zero to a little past the House bill, so ₱1 trillion falls between the two. */
const SCALE = 1_100_000_000_000;
ensure(T.all.house < SCALE, "the House bill's basket no longer fits the bars' scale");

/** Each group's colour: shades of the campaign red, the political offices in ink, unprogrammed hatched. */
const TONE: Record<RedFlagGroupKey | "unprogrammed", string> = {
  patronage: "#d62828", political: "#141414", infrastructure: "#7a1414", unprogrammed: "hatch",
};
/** Within a group, largest House bill amount first. */
const byHouse = (a: RedFlagLine, b: RedFlagLine) => b.house - a.house || a.short.localeCompare(b.short);
const COLUMNS: { group: RedFlagGroupKey | "unprogrammed" }[][] = [
  [{ group: "patronage" }, { group: "political" }],
  [{ group: "infrastructure" }, { group: "unprogrammed" }],
];
/** Every row's bar on one scale: the largest line. */
const MAX_LINE = Math.max(...RED_FLAG_LINES.map((l) => l.house), U.house);

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

const KICKER = ["People’s Budget Coalition × BetterGov.PH", "FY 2027 Budget"];
const TITLE = ["₱1 Trillion", "in Red Flags"];
const STRAP = `${pbcBillionsWords(T.all.house)} in the House bill.`;
// Non-breaking spaces keep each figure with its unit.
const SUB = (
  `Up ${pbcBillionsWords(T.all.change)} from the NEP’s ${pbcBillionsWords(T.all.nep)}. Patronage-risk programs rose ${patronageRise}%, ` +
  `from ${pbcBillionsWords(PATRONAGE.nep)} to ${pbcBillionsWords(PATRONAGE.house)}.`
).replace(/ billion/g, "\u00A0billion");
const COLS = { name: "Line", house: "House bill", change: "vs NEP" };
const CTA = ["See every red flag:", URL_TEXT];
const FINE =
  `<strong>The People’s Budget Coalition’s red-flag basket: House Bill 10858 (third reading) against the FY 2027 NEP.</strong> ` +
  `PBC’s figures, in billions of pesos, from its ${PBC_REPORT.date} assessment of the House bill. Unprogrammed appropriations, ` +
  `${pbcBillionsWords(U.house)} in both, are released only if extra revenue comes in; without them the basket is ` +
  `${pbcBillionsWords(T.programmed.house)}. A red flag is a reason to ask for documents, not proof of wrongdoing. Amounts are allocations, not spending.`;
const FINE_SHORT =
  `<strong>The People’s Budget Coalition’s red-flag basket, House Bill 10858 against the FY 2027 NEP.</strong> PBC’s figures, ` +
  `${PBC_REPORT.date}. Includes ${pbcBillionsWords(U.house)} in unprogrammed appropriations, the same in both. A red flag is a reason to ask, not proof of wrongdoing.`;
const FINE_OG = `PBC’s figures. Includes ${pbcBillionsWords(U.house)} in unprogrammed appropriations, the same in both. A red flag is a reason to ask, not proof of wrongdoing.`;

// ---------------------------------------------------------------------------
// The wall: the House bill's lines inside the basket, office by office
// ---------------------------------------------------------------------------

interface ExNode { k: string; l: string; n: number; h: number; c?: ExNode[]; x?: unknown[] }
interface ExDept { name: string; agencies: { name: string; tree: ExNode[] }[] }
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const count = (n: number) => n.toLocaleString("en-US");
const peso = (v: number) => (v === 0 ? "—" : `₱${count(v)}`);
const deptCache = new Map<string, ExDept>();
function dept(id: string): ExDept {
  if (!deptCache.has(id)) {
    const p = join(EXPLORER, `${id}.json`);
    ensure(existsSync(p), `${p} missing (npm run build:hgab-lines)`);
    deptCache.set(id, JSON.parse(readFileSync(p, "utf8")) as ExDept);
  }
  return deptCache.get(id)!;
}
/** The lines under a node: every node that holds amounts, named by its last two levels under the matched one. */
function leaves(n: ExNode, path: string[] = []): { label: string; nep: number; house: number }[] {
  if (n.x?.length) return [{ label: path.slice(-2).join(" · ") || n.l, nep: n.n, house: n.h }];
  return (n.c ?? []).flatMap((c) => leaves(c, [...path, c.l]));
}
function entry(tag: string, x: { label: string; nep: number; house: number }): string {
  const name = `<i>${esc(tag)}</i> ${esc(x.label.replace(/\s+/g, " ").trim())}`;
  if (x.nep === x.house) return `<span class="e">${name} <b>${peso(x.house)}</b></span>`;
  return `<span class="e is-${x.house > x.nep ? "up" : "dn"}">${name} <b>${peso(x.nep)} → ${peso(x.house)}</b></span>`;
}
function wall(): string[] {
  const out: string[] = [];
  for (const l of RED_FLAG_LINES) {
    if (l.bill.kind !== "line" && l.bill.kind !== "change") continue;
    const ref = l.bill.ref, d = dept(ref.dept);
    let nodes: ExNode[];
    if (ref.scope === "department") nodes = d.agencies.flatMap((a) => a.tree);
    else if ("agency" in ref.scope) { const re = new RegExp(ref.scope.agency); nodes = d.agencies.filter((a) => re.test(a.name)).flatMap((a) => a.tree); }
    else {
      const re = new RegExp(ref.scope.label);
      nodes = [];
      const walk = (n: ExNode) => { if (re.test(n.l)) nodes.push(n); else (n.c ?? []).forEach(walk); };
      d.agencies.forEach((a) => a.tree.forEach(walk));
    }
    for (const n of nodes) out.push(...leaves(n).map((x) => entry(l.short, x)));
  }
  // DPWH's projects: everything but its administration and support, the six DPWH lines together.
  const d = dept("department-of-public-works-and-highways");
  const skip = /^(General Administration and Support|Support to Operations)$/i;
  const walk = (n: ExNode, path: string[]): void => {
    if (skip.test(n.l)) return;
    if (n.x?.length) { out.push(entry("DPWH", { label: path.slice(-2).join(" · "), nep: n.n, house: n.h })); return; }
    (n.c ?? []).forEach((c) => walk(c, [...path, c.l]));
  };
  d.agencies.forEach((a) => a.tree.forEach((t) => walk(t, [t.l])));
  return out;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const dataUri = (path: string, type: string) => `data:${type};base64,${readFileSync(path).toString("base64")}`;
const LOGO = dataUri(join(ROOT, "public/brand/bettergov-horizontal-white.png"), "image/png");
const PBC_LOGO = dataUri(join(ROOT, "public/brand/pbc-logo-color-dark.png"), "image/png");

/** The feed sizes keep every line; the square trades the address band for a line in the footer and sets the text a
 *  little smaller (t). The link preview has the title and the bars only. */
interface Format { key: string; W: number; H: number; foot: number; cta: boolean; table: boolean; t: number; fine: string }
const FORMATS: Format[] = [
  { key: "portrait", W: 1080, H: 1350, foot: 151, cta: true, table: true, t: 1, fine: FINE },
  { key: "square", W: 1080, H: 1080, foot: 120, cta: false, table: true, t: 0.84, fine: FINE_SHORT },
  { key: "og", W: 1200, H: 630, foot: 96, cta: false, table: false, t: 1.05, fine: FINE_OG },
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
  .wall .e i { font-style: normal; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: rgba(20, 20, 20, 0.3); }
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
  .sub { margin-top: ${1.3 * t * u}px; font-family: Inter, sans-serif; font-weight: 700; font-size: ${2.15 * t * u}px; line-height: 1.3; color: #111; text-wrap: pretty; }
  /* The two bars, to one scale from zero, and the line at ₱1 trillion across both. */
  .bars { margin-top: ${2.2 * t * u}px; background: var(--paper); ${ring}; display: grid; grid-template-columns: auto 1fr auto; column-gap: ${1.2 * u}px; row-gap: ${0.8 * t * u}px; align-items: center; padding-top: ${3.1 * t * u}px; position: relative; }
  .bars .lab { grid-column: 1; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.45 * t * u}px; letter-spacing: 0.1em; text-transform: uppercase; color: #333; white-space: nowrap; }
  .bars .tot { grid-column: 3; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${2.2 * t * u}px; letter-spacing: -0.02em; white-space: nowrap; text-align: right; }
  .bars .tot.is-house { color: var(--red); font-size: ${2.7 * t * u}px; }
  .bars .tot.is-nep { color: #555; }
  .tracks { grid-column: 2; grid-row: 1 / span 2; position: relative; align-self: stretch; }
  .track { position: absolute; left: 0; right: 0; display: flex; }
  .track.is-house { top: 0; height: ${4.6 * t * u}px; }
  .track.is-nep { bottom: 0; height: ${3 * t * u}px; opacity: 0.55; }
  .seg { position: relative; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; border-right: ${0.2 * u}px solid var(--paper); }
  .seg:last-child { border-right: 0; }
  .seg em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.5 * t * u}px; color: #fff; white-space: nowrap; letter-spacing: -0.01em; }
  .seg.is-patronage { background: ${TONE.patronage}; }
  .seg.is-political { background: ${TONE.political}; }
  .seg.is-infrastructure { background: ${TONE.infrastructure}; }
  .seg.is-unprogrammed { background: ${hatch("rgba(122, 20, 20, 0.75)", 0.55 * u)}, #f3eee4; outline: ${0.2 * u}px solid rgba(122, 20, 20, 0.75); outline-offset: ${-0.2 * u}px; }
  .seg.is-unprogrammed em { color: var(--maroon); background: var(--paper); padding: 0 ${0.3 * u}px; }
  .row-house { grid-row: 1; height: ${4.6 * t * u}px; display: flex; align-items: center; }
  .row-nep { grid-row: 2; height: ${3 * t * u}px; display: flex; align-items: center; }
  .tline { position: absolute; top: ${-3.1 * t * u}px; bottom: ${-0.8 * t * u}px; width: 0; border-left: ${0.3 * u}px dashed var(--ink); }
  .tline span { position: absolute; top: 0; right: ${0.7 * u}px; white-space: nowrap; font-family: Anton, Impact, sans-serif; font-size: ${2.1 * t * u}px; line-height: 1; text-transform: uppercase; letter-spacing: 0.02em; color: var(--ink); }
  .key { grid-column: 1 / -1; display: flex; flex-wrap: wrap; column-gap: ${1.8 * u}px; row-gap: ${0.3 * u}px; margin-top: ${0.2 * u}px; font-family: Inter, sans-serif; font-weight: 700; font-size: ${1.35 * t * u}px; color: #222; }
  .key span { display: inline-flex; align-items: center; gap: ${0.5 * u}px; white-space: nowrap; }
  .key i { display: inline-block; width: ${1.3 * t * u}px; height: ${1.3 * t * u}px; }
  .key i.is-patronage { background: ${TONE.patronage}; } .key i.is-political { background: ${TONE.political}; } .key i.is-infrastructure { background: ${TONE.infrastructure}; }
  .key i.is-unprogrammed { background: ${hatch("rgba(122, 20, 20, 0.75)", 0.3 * u)}, #f3eee4; outline: ${0.15 * u}px solid rgba(122, 20, 20, 0.75); outline-offset: ${-0.15 * u}px; }
  /* Every line, in its group: two panels, one row per line, every bar to one scale. */
  .cols { flex: 1; min-height: 0; margin-top: ${2.6 * t * u}px; display: grid; grid-template-columns: 1fr 1fr; column-gap: ${2 * u}px; align-items: stretch; }
  .panel { position: relative; background: var(--paper); border: ${0.25 * u}px solid var(--ink); padding: ${0.6 * t * u}px ${1.4 * u}px ${0.6 * t * u}px; display: flex; flex-direction: column; }
  .grp { display: flex; align-items: baseline; justify-content: space-between; gap: ${u}px; margin-top: ${0.9 * t * u}px; padding: ${0.35 * u}px ${0.75 * u}px; color: #fff; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.35 * t * u}px; letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; }
  .grp:first-child { margin-top: 0; }
  .grp b { letter-spacing: -0.01em; }
  .grp.is-patronage { background: ${TONE.patronage}; } .grp.is-political { background: ${TONE.political}; } .grp.is-infrastructure { background: ${TONE.infrastructure}; }
  .grp.is-unprogrammed { background: ${hatch("rgba(122, 20, 20, 0.8)", 0.45 * u)}, #f3eee4; color: var(--maroon); }
  .grp.is-unprogrammed span, .grp.is-unprogrammed b { background: var(--paper); padding: 0 ${0.3 * u}px; }
  .row { position: relative; display: grid; grid-template-columns: 1fr ${7.6 * t * u}px ${7.6 * t * u}px; column-gap: ${0.6 * u}px; align-items: center; height: var(--row, ${2.8 * t * u}px); border-top: ${0.1 * u}px solid rgba(20, 20, 20, 0.18); }
  .grp + .row { border-top: 0; }
  .row > * { position: relative; }
  .row .bar { position: absolute; left: 0; top: ${0.35 * t * u}px; bottom: ${0.35 * t * u}px; background: rgba(214, 40, 40, 0.13); }
  .row .nm { font-family: Inter, sans-serif; font-weight: 700; font-size: ${1.55 * t * u}px; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .nm u { text-decoration: none; font-family: 'JetBrains Mono', monospace; font-size: ${1.05 * t * u}px; letter-spacing: 0.08em; color: #fff; background: var(--red); padding: ${0.1 * u}px ${0.35 * u}px; margin-left: ${0.5 * u}px; vertical-align: ${0.15 * u}px; }
  .row .hs, .row .ch { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.55 * t * u}px; text-align: right; white-space: nowrap; letter-spacing: -0.02em; }
  .row .hs { color: #111; }
  .row .ch.is-up { color: #c8102e; } .row .ch.is-dn { color: var(--blue); } .row .ch.is-same { color: rgba(20, 20, 20, 0.45); }
  .row.is-head { height: ${2 * t * u}px; border-top: 0; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.05 * t * u}px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(20, 20, 20, 0.6); }
  .row.is-head .hs, .row.is-head .ch { font-size: ${1.05 * t * u}px; color: rgba(20, 20, 20, 0.6); letter-spacing: 0.04em; }
  .cta { margin-top: ${2 * u}px; display: flex; align-items: baseline; justify-content: center; gap: ${1.2 * u}px; background: var(--red); color: #fff; padding: ${1 * u}px ${1.5 * u}px ${0.9 * u}px; white-space: nowrap; }
  .cta b { font-family: Anton, Impact, sans-serif; font-weight: 400; font-size: ${3.1 * u}px; line-height: 1; text-transform: uppercase; letter-spacing: 0.01em; }
  .cta span { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${2.5 * u}px; line-height: 1; letter-spacing: -0.01em; }
  .foot {
    position: absolute; left: 0; right: 0; bottom: 0; height: ${f.foot}px; background: #111; color: #f3eee4;
    padding: ${(f.cta ? 2 : 1.6) * u}px ${4.6 * u}px; display: grid; grid-template-columns: ${17 * u}px 1fr; column-gap: ${3.4 * u}px; align-items: start;
    font-family: Inter, sans-serif;
  }
  .foot .brands { display: flex; flex-direction: column; gap: ${0.9 * u}px; padding-top: ${0.4 * u}px; }
  .foot .brands img { display: block; width: ${2.3 * u * (800 / 189)}px; }
  .foot .brands img.pbc { width: ${f.key === "og" ? 7 * u : 9.2 * u}px; }
  .foot .url { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${2.1 * u}px; color: #fff; margin-bottom: ${0.5 * u}px; }
  .foot .fine { font-size: ${1.25 * u}px; line-height: 1.42; color: rgba(243, 238, 228, 0.85); }
  .foot .fine strong { color: #fff; font-weight: 700; }
  ${f.key === "og" ? `
  .foot { grid-template-columns: ${30 * u}px 1fr; align-items: center; padding-top: ${1.2 * u}px; padding-bottom: ${1.2 * u}px; }
  .foot .brands { flex-direction: row; align-items: center; gap: ${2 * u}px; padding-top: 0; }
  .foot .brands img { width: ${2 * u * (800 / 189)}px; }
  .foot .fine { font-size: ${1.15 * u}px; }` : ""}`;
}

const segs = (side: "nep" | "house") => {
  const parts: { key: RedFlagGroupKey | "unprogrammed"; php: number; short: string }[] = [
    ...RED_FLAG_GROUPS.map((g) => ({ key: g.key, php: g[side], short: g.short })),
    { key: "unprogrammed" as const, php: U[side], short: U.short },
  ];
  return parts.map((p) => {
    const w = (p.php / SCALE) * 100;
    // A label only on the House bar's two wide groups, clear of the ₱1 trillion line: the amount, with the name where it fits.
    const label = side === "house" && w > 15 && p.key !== "unprogrammed" ? `<em>${w > 30 ? `${esc(p.short)} ` : ""}${pbcBillions(p.php)}</em>` : "";
    return `<i class="seg is-${p.key}" style="width:${w.toFixed(3)}%">${label}</i>`;
  }).join("");
};
function bars(): string {
  const left = ((TRILLION / SCALE) * 100).toFixed(3);
  return `<div class="bars">
      <span class="lab row-house">House bill</span>
      <div class="tracks"><div class="track is-house">${segs("house")}</div><div class="track is-nep">${segs("nep")}</div>
        <div class="tline" style="left:${left}%"><span>₱1 trillion</span></div></div>
      <b class="tot is-house row-house">${pbcBillions(T.all.house)}</b>
      <span class="lab row-nep">NEP</span>
      <b class="tot is-nep row-nep">${pbcBillions(T.all.nep)}</b>
      <p class="key">${[...RED_FLAG_GROUPS.map((g) => [g.key, g.short]), ["unprogrammed", U.short]].map(([k, s]) => `<span><i class="is-${k}"></i>${esc(s)}</span>`).join("")}</p>
    </div>`;
}

const head = `<div class="row is-head"><span>${COLS.name}</span><span class="hs">${COLS.house}</span><span class="ch">${COLS.change}</span></div>`;
function change(php: number): string {
  const tone = php > 0 ? "is-up" : php < 0 ? "is-dn" : "is-same";
  return `<span class="ch ${tone}">${php === 0 ? "same" : pbcChange(php)}</span>`;
}
function row(x: { short: string; nep: number; house: number; change: number }): string {
  const w = ((x.house / MAX_LINE) * 100).toFixed(2);
  const fresh = x.nep === 0 && x.house > 0 ? "<u>NEW</u>" : "";
  return `<div class="row"><i class="bar" style="width:${w}%"></i><span class="nm">${esc(x.short)}${fresh}</span><span class="hs">${pbcBillions(x.house)}</span>${change(x.change)}</div>`;
}
function group(key: RedFlagGroupKey | "unprogrammed"): string {
  if (key === "unprogrammed") {
    return `<p class="grp is-unprogrammed"><span>${esc(U.short)}</span><b>${pbcBillions(U.house)} · same</b></p>`;
  }
  const g = RED_FLAG_GROUPS.find((x) => x.key === key)!;
  return `<p class="grp is-${key}"><span>${esc(g.short)}</span><b>${pbcBillions(g.house)} · ${pbcChange(g.change)}</b></p>${[...linesOf(key)].sort(byHouse).map(row).join("")}`;
}

function body(f: Format): string {
  return `
    <div class="kick"><span>${esc(KICKER[0])}</span><span>${esc(KICKER[1])}</span></div>
    <div class="title"><span>${esc(TITLE[0])}</span><span class="red">${esc(TITLE[1])}</span></div>
    <p class="strap"><span>${esc(STRAP)}</span></p>${f.key === "og" ? "" : `
    <p class="sub"><span class="pap">${esc(SUB)}</span></p>`}
    ${bars()}${f.table ? `
    <div class="cols">${COLUMNS.map((col) => `<div class="panel">${head}${col.map((c) => group(c.group)).join("")}</div>`).join("")}</div>` : ""}${f.cta ? `
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
    <div class="brands"><img src="${LOGO}" alt="BetterGov.PH"><img class="pbc" src="${PBC_LOGO}" alt="People’s Budget Coalition"></div>
    <div>${f.cta ? "" : `<div class="url">${URL_TEXT}</div>`}<div class="fine" id="fine">${f.fine}</div></div>
  </div>
</div></body></html>`;
}

async function main(): Promise<void> {
  const ENTRIES = wall();
  ensure(ENTRIES.length > 1500, `only ${ENTRIES.length} lines for the wall`);
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
      const shown = await p.evaluate(({ entries, font }) => {
        // The title: one line, the largest size at which it fits the head (Anton's widths step, so search).
        const title = document.querySelector<HTMLElement>(".title")!;
        const spans = [...title.querySelectorAll<HTMLElement>("span")];
        const edge = title.getBoundingClientRect().right;
        let small = 40, big = 260;
        while (big - small > 0.1) {
          const m = (small + big) / 2;
          for (const el of spans) el.style.fontSize = `${m}px`;
          if (spans[spans.length - 1].getBoundingClientRect().right <= edge) small = m; else big = m;
        }
        for (const el of spans) el.style.fontSize = `${small}px`;
        // The wall: as many lines as fit, the basket's groups in order.
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
      }, { entries: ENTRIES, font: f.key === "og" ? 6.6 : 7.2 });
      const lay = await p.evaluate(() => {
        const head = document.getElementById("head")!.getBoundingClientRect();
        const last = document.querySelector(".cta") ?? document.querySelector(".cols") ?? document.querySelector(".bars")!;
        const foot = document.querySelector(".foot")!.getBoundingClientRect();
        const fine = document.getElementById("fine")!.getBoundingClientRect();
        const lines = [...document.querySelectorAll(".title span, .strap span, .cta b, .cta span, .foot .url, .tline span")].map((s) => {
          const r = s.getBoundingClientRect();
          return { text: s.textContent, right: r.right, h: r.height, fs: parseFloat(getComputedStyle(s).fontSize) };
        });
        // Every panel's content must fit inside it, and no name, amount or bar label may be cut short.
        const panels = [...document.querySelectorAll(".panel")].map((el) => ({ fits: el.scrollHeight <= el.clientHeight + 1 }));
        const clipped = [...document.querySelectorAll(".row .nm, .row .hs, .row .ch, .seg em, .bars .tot, .bars .lab, .grp, .key")]
          .filter((el) => el.scrollWidth > el.clientWidth + 1 || (el.matches(".seg em") && el.getBoundingClientRect().width > el.parentElement!.getBoundingClientRect().width))
          .map((el) => el.textContent);
        // The ₱1 trillion label sits left of its line and must clear the House bar's label at the line.
        const tl = document.querySelector(".tline span")!.getBoundingClientRect();
        const key = document.querySelector(".key")!.getBoundingClientRect();
        const urlEl = document.querySelector(".foot .url");
        return {
          urlRight: urlEl ? urlEl.getBoundingClientRect().right : 0, footRight: foot.right, headRight: head.right, headLeft: head.left,
          lastBottom: last.getBoundingClientRect().bottom, ctaFits: !document.querySelector(".cta") || document.querySelector(".cta")!.scrollWidth <= document.querySelector(".cta")!.clientWidth + 1,
          footTop: foot.top, footBottom: foot.bottom, fineBottom: fine.bottom, lines, panels, clipped, tlLeft: tl.left, keyBottom: key.bottom,
        };
      });
      const png = join(OUT, `1t-red-flags-${W}x${H}.png`);
      // --draft writes the picture even when a check fails, to see why.
      if (args.draft) await p.screenshot({ path: png, fullPage: false });
      if (f.table) ensure(shown.row >= 2.3 * f.t * u, `${f.key}: rows of ${shown.row}px are too tight`);
      ensure(lay.lastBottom <= lay.footTop - 4, `${f.key}: the head runs into the footer (${Math.round(lay.lastBottom)} > ${Math.round(lay.footTop)})`);
      ensure(lay.panels.every((x) => x.fits), `${f.key}: a panel's rows overflow it`);
      ensure(lay.clipped.length === 0, `${f.key}: cut short: ${lay.clipped.join(" | ")}`);
      ensure(lay.tlLeft >= lay.headLeft, `${f.key}: the ₱1 trillion label leaves the poster`);
      const bad = lay.lines.filter((x) => x.right > Math.max(lay.headRight, lay.footRight - 4.6 * u) + 1 || x.h > x.fs * 1.6);
      ensure(bad.length === 0, `${f.key}: a one-line text wraps or leaves the poster: ${bad.map((x) => `${x.text} (right ${Math.round(x.right)} / ${Math.round(lay.headRight)}, ${Math.round(x.h)}px at ${Math.round(x.fs)}px)`).join(" | ")}`);
      ensure(lay.ctaFits, `${f.key}: the address does not fit its band`);
      ensure(lay.fineBottom <= lay.footBottom - 2, `${f.key}: the footer text runs out of the footer`);
      if (!args.draft) await p.screenshot({ path: png, fullPage: false });
      const md5 = createHash("md5").update(readFileSync(png)).digest("hex").slice(0, 8);
      console.log(`${f.key} ${W}×${H} · title ${shown.title}px · rows ${shown.row}px · wall ${count(shown.shown)} of ${count(ENTRIES.length)} lines · ends ${Math.round(lay.lastBottom)} / footer ${Math.round(lay.footTop)} → ${png} · v=${md5}`);
      await p.close();
    }
  } finally {
    await browser.close();
  }
}

void main();
