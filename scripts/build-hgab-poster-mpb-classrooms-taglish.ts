/**
 * "Multi-purpose building o classroom?": the Taglish street-poster cut of the campaign poster for
 * /gaa/multi-purpose/documents. Jason (2026-11-15): "Can we try a different style? More taglish and more impact?
 * Revolutionary, grunge style". The paper poster (build-hgab-poster-mpb-classrooms.ts) stays; this one is added beside it.
 *
 * A protest print: newsprint in red, black and cream; screen-printed headline type worn by an SVG filter (rough edges, ink
 * specks, worn patches); "O CLASSROOM?" on a torn red strip; a giant red "21" printed out of register over halftone; the
 * breakdown as a typewritten sheet taped on, marker bars to scale, the classrooms circled in red marker; the projects read
 * as a faded photocopy behind; a torn black footer. All texture is CSS and SVG, drawn here; nothing is generated.
 *
 * Every figure comes from `mpb-documents/` (npm run build:mpb-documents), the files the page reads, so the poster cannot
 * disagree with the site. Same scope as the page: the multi-purpose building projects the House inserted, read from the
 * redacted Senate copies of their documents.
 *
 * Renders in headless Chromium (playwright-core) in Anton, Special Elite (typewriter), Permanent Marker and Inter, and
 * writes to --out (default data/hgab/2027/campaign/, gitignored):
 *   mpb-or-classrooms-taglish-1080x1350.png   feed post (4:5)
 *   mpb-or-classrooms-taglish-1080x1920.png   story (9:16)
 *   mpb-or-classrooms-taglish-1200x630.png    link preview
 *
 * Usage: npm run build:hgab-poster-mpb-classrooms-taglish -- [--out=dir] [--only=post,story,og]   (CHROMIUM_PATH for a
 * local headless shell). Needs network access for Google Fonts.
 */
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  MPB_DOCS_PROJECTS_PATH, MPB_DOCS_ROOT, MPB_DOCS_SUMMARY_PATH, decodeMpbDocProjects, type MpbDocCategory,
  type MpbDocsProjectsFile, type MpbDocsSummary,
} from "../src/lib/mpb-documents";

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`build-hgab-poster-mpb-classrooms-taglish: ${msg}`); process.exit(1); }
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
const count = (n: number) => n.toLocaleString("en-US");
const short = (v: number) => (v >= 1e9 ? `₱${(v / 1e9).toFixed(2)}B` : `₱${Math.round(v / 1e6)}M`);
const billion = (v: number) => `₱${(v / 1e9).toFixed(1)}B`;
const AS_OF = new Date(S.source.records_written).toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric" });

/** Each kind of building, in Taglish: the noun stays as people say it, no English plural after a number. */
const TL: Record<MpbDocCategory, string> = {
  "multi-purpose hall": "multi-purpose halls", "covered court or gym": "covered court at gym", "barangay hall or government office": "barangay hall at opisina",
  "evacuation center": "evacuation center", "health facility": "health facility", "senior citizens or day care center": "senior citizen at day care center",
  "classroom or school building": "classroom", "other school facility": "iba pang pasilidad ng paaralan", "market or commercial": "palengke at commercial building",
  road: "kalsada", bridge: "tulay", "flood control or drainage": "drainage", "water supply or sanitation": "water system",
  "other building": "iba pang gusali", other: "iba pa", unclear: "hindi malinaw",
};
const ROWS = S.categories.map((c) => ({ n: c.lines, php: c.php, label: TL[c.key], red: c.key === "classroom or school building" }));
ensure(ROWS.some((r) => r.red) && CLS.lines === ROWS.find((r) => r.red)!.n, "the classroom row and the classroom count differ");
const MAX = Math.max(...ROWS.map((r) => r.n));

/** Everything the poster says. Sentences of 25 words or fewer. */
const T = {
  kick: ["2027 House budget bill", "Binasa namin ang mga dokumento"],
  h1: "Multi-purpose building",
  strip: "o classroom?",
  /** Jason: the title is "Multi-purpose building o classroom? Ano ba talaga?" */
  ano: ["Ano ba", "talaga?"],
  lang: ["lang ang", "classroom"],
  line: `sa sample na ${count(C.read.lines)}* multi-purpose building na isiningit ng House, ayon sa sarili nilang mga dokumento.`,
  sheet: ["Ano laman ng mga dokumento", `Sample: ${count(C.read.lines)} proyekto`],
  total: ["Kabuuan ng sample", `${count(C.read.lines)} · ${short(C.read.php)}`],
  note: `${count(CLS.lines)} lang?!`,
  star: `*Mga dokumentong available: ${count(C.dpwh.insertions.lines)} DPWH project ang isiningit ng House; ${count(C.dpwh.with_documents.lines)} ang may dokumento sa kopya ng Senado. ` +
    `${count(C.insertions.lines)} dito ay multi-purpose building: ${count(C.with_documents.lines)} ang may dokumento, ${count(C.without_documents.lines)} ang wala. ${count(C.read.lines)} na ang nabasa namin: ito ang sample.`,
  cta: "Ikaw, ano sa tingin mo?",
  fine: (shown: number) =>
    `<strong>Ang sample na ${count(C.read.lines)}: mga multi-purpose building project na isiningit ng House, walang katapat na line sa NEP, at nabasa na namin ang mga dokumento.</strong> ` +
    `Hindi random ang sample: ito ang mga nabasa na sa ${count(C.with_documents.lines)} na may dokumento. ` +
    `May ${count(C.house.lines)} multi-purpose building project sa House bill (${billion(C.house.php)}); ${count(C.insertions.lines)} ang isiningit ng House (${billion(C.insertions.php)}). ` +
    `Binasa ng isang model ang dokumento ng bawat proyekto at sinipi ito; tingnan ang bawat isa sa link. Sa likod: ang ${count(shown)} na pinakamalaki. ` +
    `Classroom: ${short(CLS.php)}. Halagang nakalaan sa House Bill 10858 (third reading), hindi aktwal na nagastos. ` +
    `Hindi ito patunay ng anumang mali; hindi sinasabi ng dokumento kung sino ang humiling ng proyekto. People’s Budget Coalition × BetterGov.PH. As of ${AS_OF}.`,
};

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
/** The photocopied list behind: the projects read, largest first. */
const WALL = [...P].sort((a, b) => b.php - a.php || a.title.localeCompare(b.title)).map((p) =>
  `<span${p.category === "classroom or school building" ? ' class="c"' : ""}>₱${count(p.php)} ${esc(p.title)} ${p.category === "classroom or school building" ? "[CLASSROOM]" : ""}/ </span>`);

/** A seeded random, so every render tears the same way. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** A clip-path with torn top and bottom edges, `amp` px deep. */
function torn(seed: number, amp: number, n = 48, sides: "both" | "top" = "both"): string {
  const r = rng(seed);
  const top: string[] = [], bot: string[] = [];
  for (let i = 0; i <= n; i++) {
    const x = ((100 * i) / n).toFixed(2);
    top.push(`${x}% ${(r() * amp).toFixed(1)}px`);
    bot.push(`${(100 - Number(x)).toFixed(2)}% calc(100% - ${(sides === "both" ? r() * amp : 0).toFixed(1)}px)`);
  }
  return `polygon(${[...top, ...bot].join(", ")})`;
}

// ---------------------------------------------------------------------------
// The poster
// ---------------------------------------------------------------------------

const LOGO = `data:image/png;base64,${readFileSync(join(ROOT, "public/brand/bettergov-horizontal-white.png")).toString("base64")}`;
interface Format { key: string; file: string; w: number; h: number }
const FORMATS: Format[] = [
  { key: "post", file: "mpb-or-classrooms-taglish-1080x1350", w: 1080, h: 1350 },
  { key: "story", file: "mpb-or-classrooms-taglish-1080x1920", w: 1080, h: 1920 },
  { key: "og", file: "mpb-or-classrooms-taglish-1200x630", w: 1200, h: 630 },
];

/** Sizes per format, in units of 1% of the poster width; --s (the sheet) and --big (the 21) shrink to fit. */
function sizes(f: Format) {
  const u = f.w / 100;
  if (f.w > f.h) return { u, foot: 11 * u, top: 2 * u, left: 3 * u, kick: 1.15 * u, big: 15 * u, s: 1.2 * u, sMin: 9, star: 1.05 * u, cta: 1.7 * u, wall: 6.4, gap: 0.7 * u };
  if (f.h / f.w > 1.6) return { u, foot: 19 * u, top: 6 * u, left: 4.5 * u, kick: 2.3 * u, big: 40 * u, s: 2.55 * u, sMin: 18, star: 2.35 * u, cta: 4.2 * u, wall: 8, gap: 2.2 * u };
  return { u, foot: 16 * u, top: 3.6 * u, left: 4.5 * u, kick: 2 * u, big: 27 * u, s: 2 * u, sMin: 15, star: 1.95 * u, cta: 3.3 * u, wall: 7.4, gap: 1.3 * u };
}

function html(f: Format): string {
  const z = sizes(f);
  const wide = f.w > f.h;
  const rows = ROWS.map((r) => `<div class="row${r.red ? " is-red" : ""}">
      <span class="n">${count(r.n)}</span>
      <span class="lb"><i class="b" style="width:${Math.max(0.9, (100 * r.n) / MAX).toFixed(2)}%"></i><span class="l">${esc(r.label)}</span></span>
      ${r.red ? `<svg class="circ" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true"><path d="M14 23 C10 8 70 3 120 4 C170 5 196 11 194 22 C192 34 130 38 80 37 C36 36 6 31 9 19 C11 12 30 8 52 7"/></svg><span class="note">${esc(T.note)}</span>` : ""}
    </div>`).join("");
  const sheet = `<div class="sheet" id="sheet"><i class="tape t1"></i><i class="tape t2"></i>
      <p class="sh-h"><span>${esc(T.sheet[0])}</span><span>${esc(T.sheet[1])}</span></p>
      <div class="rows">${rows}</div>
      <p class="sh-f"><span>${esc(T.total[0])}</span><span>${esc(T.total[1])}</span></p></div>`;
  const left = `
    <p class="kick"><span>${esc(T.kick[0])}</span><span class="dot">✶</span><span>${esc(T.kick[1])}</span></p>
    <h1 class="h1"><span class="g" id="h1">${esc(T.h1)}</span></h1>
    <div class="t2"><div class="strip" id="strip"><span class="g">${esc(T.strip)}</span></div><p class="ano g" id="ano">${esc(T.ano[0])}<br>${esc(T.ano[1])}</p></div>
    <div class="big">
      <div class="num"><i class="ht"></i><b class="shadow g">${count(CLS.lines)}</b><b class="red g">${count(CLS.lines)}</b></div>
      <div class="side"><p class="lang g">${esc(T.lang[0])}<br>${esc(T.lang[1])}</p><p class="tw">${esc(T.line).replace("multi-purpose", '<span class="nw">multi-purpose</span>')}</p></div>
    </div>`;
  const after = `
    <p class="star">${esc(T.star)}</p>
    <p class="cta"><b>${esc(T.cta)}</b><span>→</span></p>`;
  const PAPER = "#e6dcc3", INK = "#17130f", RED = "#c8102e", CREAM = "#f3ead3";
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Special+Elite&family=Permanent+Marker&family=Inter:wght@400;600;700&display=block" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${f.w}px; height: ${f.h}px; overflow: hidden; background: ${PAPER}; }
  .poster { position: relative; width: ${f.w}px; height: ${f.h}px; overflow: hidden; color: ${INK};
    background:
      radial-gradient(ellipse 38% 26% at 86% 14%, rgba(140, 100, 40, 0.20), transparent 70%),
      radial-gradient(ellipse 30% 22% at 8% 62%, rgba(120, 85, 35, 0.16), transparent 70%),
      radial-gradient(ellipse 45% 30% at 70% 92%, rgba(110, 80, 30, 0.14), transparent 70%),
      linear-gradient(176deg, transparent 49.6%, rgba(255, 255, 255, 0.35) 49.8%, rgba(0, 0, 0, 0.06) 50.1%, transparent 50.4%),
      ${PAPER}; }
  /* The photocopied list behind everything. */
  .wall { position: absolute; inset: ${-1 * z.u}px ${-1 * z.u}px ${z.foot}px; transform: rotate(-1.2deg); font-family: 'Special Elite', monospace;
    text-align: justify; line-height: 1.25; color: rgba(23, 19, 15, 0.32); overflow: hidden; filter: blur(0.25px); }
  .wall .c { color: rgba(200, 16, 46, 0.55); }
  .grain { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: multiply; z-index: 4; }
  .head { position: absolute; z-index: 2; left: ${z.left}px; right: ${z.left}px; top: ${z.top}px; --s: ${z.s}px; --big: ${z.big}px; }
  ${wide ? `.head { display: grid; grid-template-columns: 1fr ${43 * z.u}px; column-gap: ${3 * z.u}px; align-items: start; }` : ""}
  .g { filter: url(#grunge); }
  .kick { display: flex; gap: 0.6em; align-items: baseline; font-family: 'Special Elite', monospace; font-size: ${z.kick}px; letter-spacing: 0.08em; text-transform: uppercase; }
  .kick .dot { color: ${RED}; }
  .h1 { margin-top: ${0.4 * z.gap}px; font-family: Anton, Impact, sans-serif; font-weight: 400; text-transform: uppercase; line-height: 0.92; white-space: nowrap; }
  .h1 span { display: inline-block; }
  .strip { display: inline-block; margin-top: ${0.35 * z.gap}px; margin-left: ${-z.left - 0.5 * z.u}px; padding: ${0.5 * z.u}px ${1.8 * z.u}px ${0.3 * z.u}px ${z.left + 0.5 * z.u}px;
    background: ${RED}; clip-path: ${torn(7, 0.9 * z.u)}; transform: rotate(-1.6deg); transform-origin: left center; }
  .t2 { display: flex; align-items: center; gap: ${2.2 * z.u}px; }
  .ano { font-family: Anton, Impact, sans-serif; text-transform: uppercase; line-height: 0.95; white-space: nowrap; transform: rotate(2.5deg); margin-top: ${0.35 * z.gap}px; }
  .strip span { display: inline-block; font-family: Anton, Impact, sans-serif; text-transform: uppercase; line-height: 1; color: ${CREAM}; white-space: nowrap; }
  .big { display: flex; align-items: center; gap: ${2.2 * z.u}px; margin-top: ${0.6 * z.gap}px; }
  .num { position: relative; flex: none; font-family: Anton, Impact, sans-serif; font-size: var(--big); line-height: 0.86; }
  .num b { display: block; font-weight: 400; }
  .num .shadow { position: absolute; left: ${0.9 * z.u}px; top: ${0.7 * z.u}px; color: ${INK}; }
  .num .red { position: relative; color: ${RED}; }
  .num .ht { position: absolute; left: -12%; right: -18%; top: 4%; bottom: -6%; background-image: radial-gradient(circle, ${INK} 0 36%, transparent 39%);
    background-size: ${0.9 * z.u}px ${0.9 * z.u}px; -webkit-mask-image: linear-gradient(125deg, transparent 25%, #000 55%, transparent 92%); mask-image: linear-gradient(125deg, transparent 25%, #000 55%, transparent 92%); opacity: 0.55; }
  .side { min-width: 0; }
  .nw { white-space: nowrap; }
  .lang { font-family: Anton, Impact, sans-serif; text-transform: uppercase; font-size: calc(var(--big) * 0.3); line-height: 0.95; }
  .tw { margin-top: ${0.6 * z.u}px; font-family: 'Special Elite', monospace; font-size: calc(var(--big) * 0.085); line-height: 1.3; max-width: 37ch; }
  ${wide ? `.lang { font-size: calc(var(--big) * 0.36); } .tw { font-size: calc(var(--big) * 0.105); }` : ""}
  /* The typed sheet, taped on. */
  .sheet { position: relative; margin-top: ${z.gap}px; padding: calc(var(--s) * 1) calc(var(--s) * 1.1) calc(var(--s) * 0.7); background: #f5efe0;
    box-shadow: 0 ${0.3 * z.u}px ${1.1 * z.u}px rgba(30, 20, 5, 0.35); transform: rotate(0.7deg); font-family: 'Special Elite', monospace; font-size: var(--s); }
  ${wide ? `.sheet { margin-top: ${0.6 * z.u}px; transform: rotate(1deg); }` : ""}
  .tape { position: absolute; top: calc(var(--s) * -0.7); width: calc(var(--s) * 6); height: calc(var(--s) * 1.5); background: rgba(222, 208, 170, 0.82); clip-path: ${torn(3, 3, 10)}; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15); }
  .tape.t1 { left: calc(var(--s) * 1.2); transform: rotate(-5deg); }
  .tape.t2 { right: calc(var(--s) * 1.2); transform: rotate(4deg); }
  .sh-h, .sh-f { display: flex; justify-content: space-between; text-transform: uppercase; letter-spacing: 0.06em; }
  .sh-h { padding-bottom: calc(var(--s) * 0.35); border-bottom: 2px solid ${INK}; font-size: calc(var(--s) * 1.05); }
  .sh-f { margin-top: calc(var(--s) * 0.35); padding-top: calc(var(--s) * 0.35); border-top: 2px solid ${INK}; font-size: calc(var(--s) * 0.95); }
  .row { position: relative; display: grid; grid-template-columns: 5.4ch minmax(0, 1fr); column-gap: 0.8ch; align-items: center; padding: calc(var(--s) * 0.16) 0; border-bottom: 1px dashed rgba(23, 19, 15, 0.3); }
  .row:last-child { border-bottom: 0; }
  .row .n { text-align: right; }
  /* The bar is the label's shade: red marker behind the words, to scale across the row (Jason: "merge the label and the bar"). */
  .row .lb { position: relative; display: block; min-width: 0; padding: calc(var(--s) * 0.08) 0.4ch; }
  .row .b { position: absolute; left: 0; top: 47%; bottom: 9%; background: rgba(200, 16, 46, 0.62); mix-blend-mode: multiply; filter: url(#marker); }
  .row .l { position: relative; display: block; white-space: nowrap; overflow: hidden; color: #000; -webkit-text-stroke: calc(var(--s) * 0.035) #000; }
  .row.is-red .l { color: ${RED}; -webkit-text-stroke-color: ${RED}; }
  .row.is-red { color: ${RED}; }
  .row.is-red .b { background: rgba(200, 16, 46, 0.85); }
  .circ { position: absolute; left: -5.5%; top: -38%; width: 66%; height: 176%; overflow: visible; }
  .circ path { fill: none; stroke: ${RED}; stroke-width: ${0.42 * z.u}px; stroke-linecap: round; vector-effect: non-scaling-stroke; filter: url(#marker); }
  .note { position: absolute; right: 2%; top: 50%; transform: translateY(-58%) rotate(-7deg); font-family: 'Permanent Marker', cursive; font-size: calc(var(--s) * 1.75); color: ${RED}; white-space: nowrap; }
  .star { margin-top: ${z.gap}px; font-family: 'Special Elite', monospace; font-size: ${z.star}px; line-height: 1.3; background: rgba(230, 220, 195, 0.88); box-shadow: 0 0 0 ${0.4 * z.u}px rgba(230, 220, 195, 0.88); }
  .cta { display: inline-flex; gap: 0.5em; align-items: baseline; margin-top: ${z.gap}px; padding: ${0.45 * z.u}px ${1.3 * z.u}px ${0.3 * z.u}px; background: ${INK}; color: ${CREAM};
    font-family: Anton, Impact, sans-serif; font-size: ${z.cta}px; line-height: 1; text-transform: uppercase; letter-spacing: 0.02em; transform: rotate(-1deg); }
  .cta span { color: ${RED}; }
  .foot { position: absolute; left: 0; right: 0; bottom: 0; height: ${z.foot + 1.2 * z.u}px; z-index: 5; background: ${INK}; color: ${CREAM}; clip-path: ${torn(11, 1.2 * z.u, 70, "top")};
    padding: ${2.6 * z.u}px ${4 * z.u}px ${1.4 * z.u}px; display: grid; grid-template-columns: auto 1fr; gap: ${0.5 * z.u}px ${3 * z.u}px; align-items: center; font-family: Inter, sans-serif; }
  .foot img { height: ${3.4 * z.u}px; grid-row: span 2; }
  .foot .url { font-family: 'Special Elite', monospace; font-size: ${2.15 * z.u}px; color: #fff; }
  .foot .fine { font-size: ${1.08 * z.u}px; line-height: 1.35; color: rgba(243, 234, 211, 0.82); }
  .foot .fine strong { color: #fff; font-weight: 600; }
  ${wide ? `.foot { padding: ${1.9 * z.u}px ${2.6 * z.u}px ${1 * z.u}px; gap: ${0.3 * z.u}px ${2 * z.u}px; } .foot img { height: ${2.6 * z.u}px; } .foot .url { font-size: ${1.7 * z.u}px; } .foot .fine { font-size: ${0.92 * z.u}px; }` : ""}
</style></head><body><div class="poster">
  <svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <!-- Screen-print wear: rough edges, ink specks and worn patches knocked out of the type. -->
    <filter id="grunge" x="-4%" y="-8%" width="108%" height="116%">
      <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="4" result="warp"/>
      <feDisplacementMap in="SourceGraphic" in2="warp" scale="${(0.45 * z.u).toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="rough"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="2" seed="9" result="fine"/>
      <feColorMatrix in="fine" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  10 0 0 0 -6.7" result="specks"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.014 0.06" numOctaves="3" seed="21" result="wear"/>
      <feColorMatrix in="wear" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  8 0 0 0 -5.45" result="worn"/>
      <feComposite in="specks" in2="worn" operator="over" result="holes"/>
      <feComposite in="rough" in2="holes" operator="out"/>
    </filter>
    <!-- Marker strokes: rough edges only. -->
    <filter id="marker" x="-5%" y="-30%" width="110%" height="160%">
      <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="13" result="w"/>
      <feDisplacementMap in="SourceGraphic" in2="w" scale="${(0.35 * z.u).toFixed(1)}" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </svg>
  <div class="wall" id="wall"></div>
  <div class="head" id="head">${wide ? `<div class="lc">${left}${after}</div>${sheet}` : `${left}${sheet}${after}`}</div>
  <svg class="grain" width="${f.w}" height="${f.h}" aria-hidden="true">
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="2"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.32  0 0 0 0 0.25  0 0 0 0 0.14  1.1 0 0 0 -0.42"/></filter>
    <rect width="100%" height="100%" filter="url(#grain)"/>
  </svg>
  <div class="foot">
    <img src="${LOGO}" alt="BetterGov.PH">
    <div class="url">${URL_TEXT}</div>
    <div class="fine" id="fine"></div>
  </div>
</div></body></html>`;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const exe = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(exe ? { executablePath: exe, args: ["--no-sandbox"] } : {});
  try {
    for (const f of FORMATS) {
      if (ONLY && !ONLY.includes(f.key)) continue;
      const z = sizes(f);
      const page = await browser.newPage({ viewport: { width: f.w, height: f.h }, deviceScaleFactor: 1 });
      await page.setContent(html(f), { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate("globalThis.__name = (f) => f"); // tsx names inner functions with a helper the page lacks
      const fit = await page.evaluate(({ entries, font }) => {
        const wall = document.getElementById("wall")!;
        const fits = () => wall.scrollHeight <= wall.clientHeight + 0.5;
        const set = (n: number) => { wall.style.fontSize = `${font}px`; wall.innerHTML = entries.slice(0, n).join(""); };
        let lo = 0, hi = entries.length;
        while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); set(mid); if (fits()) lo = mid; else hi = mid - 1; }
        set(lo);
        return { shown: lo };
      }, { entries: WALL, font: z.wall });
      await page.evaluate((h) => { document.getElementById("fine")!.innerHTML = h; }, T.fine(fit.shown));
      // The headline fills its column; the strip's words take the same size. Then the sheet and the 21 shrink together
      // until the headline clears the footer and no label is cut.
      const lay = await page.evaluate(() => {
        const head = document.getElementById("head")!;
        const h1 = document.getElementById("h1")!;
        const col = h1.parentElement!.parentElement!.getBoundingClientRect().width;
        let fs = 40;
        h1.style.fontSize = `${fs}px`;
        while (h1.getBoundingClientRect().width < col - 2 && fs < 400) h1.style.fontSize = `${++fs}px`;
        while (h1.getBoundingClientRect().width > col && fs > 20) h1.style.fontSize = `${--fs}px`;
        (document.querySelector("#strip span") as HTMLElement).style.fontSize = `${fs * 1.08}px`;
        // "Ano ba talaga?" beside the strip, two lines as tall as it, shrunk only if it would leave the column.
        const ano = document.getElementById("ano")!;
        const colRight = h1.parentElement!.parentElement!.getBoundingClientRect().right;
        let afs = fs * 0.56;
        ano.style.fontSize = `${afs}px`;
        while (ano.getBoundingClientRect().right > colRight && afs > 10) ano.style.fontSize = `${--afs}px`;
        const footTop = document.querySelector(".foot")!.getBoundingClientRect().top + 12;
        const labels = [...document.querySelectorAll<HTMLElement>(".row .l")];
        const cut = () => labels.some((x) => x.scrollWidth > x.clientWidth + 1);
        const bottom = () => Math.max(...[...head.children].map((c) => c.getBoundingClientRect().bottom));
        const css = getComputedStyle(head);
        let s = parseFloat(css.getPropertyValue("--s")), big = parseFloat(css.getPropertyValue("--big"));
        const s0 = s, big0 = big;
        while (s > 6 && (cut() || bottom() > footTop - 10)) {
          s -= 0.25; big = (big0 * s) / s0;
          head.style.setProperty("--s", `${s}px`); head.style.setProperty("--big", `${big}px`);
        }
        const fine = document.getElementById("fine")!, foot = document.querySelector(".foot") as HTMLElement;
        return { s, cut: cut(), bottom: bottom(), footTop, fineFits: fine.getBoundingClientRect().bottom <= foot.getBoundingClientRect().bottom - 2, right: Math.max(...[...document.querySelectorAll(".head *")].map((e) => e.getBoundingClientRect().right)), w: window.innerWidth };
      });
      ensure(lay.s >= z.sMin && !lay.cut, `${f.key}: the sheet had to shrink to ${lay.s}px${lay.cut ? ", and a label is cut" : ""}`);
      ensure(lay.bottom <= lay.footTop - 10, `${f.key}: the poster runs into the footer`);
      ensure(lay.fineFits, `${f.key}: the footer's fine print overflows`);
      ensure(lay.right <= lay.w + 1, `${f.key}: something runs off the right edge (${Math.round(lay.right)})`);
      const png = join(OUT, `${f.file}.png`);
      await page.screenshot({ path: png, fullPage: false });
      const md5 = createHash("md5").update(readFileSync(png)).digest("hex").slice(0, 8);
      console.log(`${f.key.padEnd(5)} ${f.w}×${f.h} · sheet ${lay.s}px · wall ${count(fit.shown)} → ${png} · v=${md5}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
