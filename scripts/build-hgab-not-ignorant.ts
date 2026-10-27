/**
 * /hgab/2027/we-are-not-ignorant as ONE static HTML file, regenerated with
 * the data: npm run build:hgab-not-ignorant → data/hgab/2027/we-are-not-ignorant.html.
 * `npm run upload:hgab` publishes it to the data host and the Worker serves
 * it at the page's path (src/worker/index.ts), so the page needs no
 * JavaScript, no data fetch and no rebuild of the site.
 *
 * The content is every row of data/hgab/2027/changes-list.json (which
 * reconciles to the overview's candidate changes): inserted, then increased,
 * then decreased, largest first, numbered 1…N across the rows. Styles are
 * src/hgab-not-ignorant.css inlined, so the file looks like the campaign
 * poster; the logo and the fist come from the site (/brand, /campaign).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  CHANGES_LIST_CSV_NAME, CHANGES_LIST_CSV_PATH, CHANGES_LIST_ROOT, CHANGES_LIST_SITE, CHANGES_LIST_TITLE,
  CHANGE_PROGRAM_LABELS, NO_DISTRICT_TEXT, seatHoldersText, shortOffice,
  type ChangesListData, type ChangesListRow,
} from "../src/lib/hgab-changes-list.ts";
import ts from "typescript";
import { DEO_RESTRICTIONS_LINK_TEXT, DEO_RESTRICTIONS_PATH, DISCLAIMERS_PATH } from "../src/lib/hgab-disclaimers.ts";
import { pageMeta } from "../src/lib/seo.ts";
import { DEO_MEANING } from "../src/lib/hgab-leaderboard.ts";

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`build-hgab-not-ignorant: ${msg}`); process.exit(1); }
}

const ROOT = resolve(import.meta.dirname, "..");
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)=(.*)$/.exec(a); return m ? [m[1], m[2]] : [a, ""]; }));
const DATA = resolve(args.out ?? join(ROOT, "data/hgab/2027"));
const OUT = join(DATA, "we-are-not-ignorant.html");
/** Marker the Worker looks for before serving the file. */
export const STATIC_MARKER = "hgab-we-are-not-ignorant";
const DATA_HOST = "https://budget-assets.bettergov.ph";
const CHUNK = 60;
const HEAD_WALL = 160;

const list = JSON.parse(readFileSync(join(DATA, "changes-list.json"), "utf8")) as ChangesListData;
ensure(list.rows?.length, "changes-list.json has no rows; run npm run build:hgab-changes-list");

/**
 * REGION_LABELS and regionKeyOf() from the contract itself (src/lib/hgab.ts
 * reads import.meta.env, so it can't be imported here): transpile just those
 * blocks and evaluate them, as build-hgab-d1.ts does.
 */
const { REGION_LABELS, regionKeyOf } = (() => {
  const path = join(ROOT, "src/lib/hgab.ts");
  const src = readFileSync(path, "utf8");
  const block = (re: RegExp, what: string) => {
    const m = re.exec(src);
    ensure(m, `${what} not found in ${path}`);
    return m[1].replace(/^export /gm, "");
  };
  const code = [
    block(/(export const REGION_LABELS[\s\S]*?\n\};)/, "REGION_LABELS"),
    block(/(const ROMAN[\s\S]*?\nexport function regionKeyOf[\s\S]*?\n\})/, "regionKeyOf"),
  ].join("\n");
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(`${js}\nreturn { REGION_LABELS, regionKeyOf };`)() as {
    REGION_LABELS: Record<string, { short: string; name: string }>;
    regionKeyOf: (l: string | null | undefined) => string | null;
  };
})();

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const peso = (n: number) => `₱${n.toLocaleString("en-US")}`;
const signedPeso = (n: number) => `${n < 0 ? "−" : "+"}${peso(Math.abs(n))}`;
function regionText(r: string | null | undefined): string | null {
  if (!r) return null;
  const k = regionKeyOf(r);
  return k ? REGION_LABELS[k].short : r;
}

/** program · detail · region · province · office · [shared …] · districts served — and the representatives (same rule as the page had). */
function metaText(r: ChangesListRow): { lead: string; reps: string } {
  const parts: string[] = [CHANGE_PROGRAM_LABELS[r.p]];
  if (r.pa) parts.push(r.pa);
  const region = regionText(r.r);
  if (region) parts.push(region);
  if (r.pv) parts.push(r.pv);
  // The DPWH office and the legislative district(s) it serves, named as such: a DEO's number
  // is its own (the Davao de Oro 1st DEO serves the 2nd legislative district).
  if (r.o && r.w !== "central") parts.push(`DPWH office: ${shortOffice(r.o)}`);
  if (r.w === "office" && r.ds) {
    const n = r.rp?.length ?? 1;
    if (r.tr === "B") parts.push(`shared by ${n} legislative districts, not split`);
    parts.push(`serves legislative district${n > 1 ? "s" : ""} ${r.ds}`);
  } else if (r.w && r.w !== "office") parts.push(NO_DISTRICT_TEXT[r.w]);
  return { lead: parts.join(" · "), reps: r.w === "office" ? seatHoldersText(r.rp) : "" };
}

function item(r: ChangesListRow, n: number): string {
  const cls = r.k === "inserted" ? "is-in" : r.k === "increased" ? "is-up" : "is-down";
  const { lead, reps } = metaText(r);
  const amt = r.k === "inserted"
    ? `<b>${peso(r.h ?? 0)}</b>${r.m ? `<span class="hgab-wani-kind"> · listed as ${r.m} lines</span>` : ""}`
    : `<b><span class="hgab-wani-num">${r.n == null ? "none" : peso(r.n)}</span> <span aria-hidden="true">→</span><span class="hgab-wani-sr"> to </span> <span class="hgab-wani-num">${r.h == null ? "none" : peso(r.h)}</span></b> <span class="hgab-wani-chg">(${signedPeso(r.d ?? 0)})</span>`;
  return `<li class="hgab-wani-item ${cls}"><span class="hgab-wani-n" aria-hidden="true">${n.toLocaleString("en-US")}</span><span class="hgab-wani-tag ${cls}">${r.k}</span> `
    + `<span class="hgab-wani-amt">${amt}${r.u ? '<span class="hgab-wani-flag">unconfirmed match</span>' : ""}</span>`
    + `<a class="hgab-wani-ttl" href="${esc(r.x)}">${esc(r.t)}</a>`
    + `<span class="hgab-wani-meta">${esc(lead)}${reps ? ` · <span class="hgab-wani-reps">${esc(reps)}</span>` : ""}</span></li>`;
}

const chunks: string[] = [];
for (let i = 0; i < list.rows.length; i += CHUNK) {
  chunks.push(`<ol class="hgab-wani-chunk" start="${i + 1}">${list.rows.slice(i, i + CHUNK).map((r, j) => item(r, i + j + 1)).join("")}</ol>`);
}
const headWall = list.rows.slice(0, HEAD_WALL)
  .map((r, i) => `${i + 1} ${r.k.toUpperCase()} ${r.h == null ? "" : peso(r.h)} ${r.t}`).join(" ■ ");
const asOf = (() => {
  const d = new Date(list.built_at);
  return Number.isNaN(d.getTime()) ? "" : `As of ${d.toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric" })}.`;
})();

const meta = pageMeta(CHANGES_LIST_ROOT);
const canonical = `${CHANGES_LIST_SITE}${CHANGES_LIST_ROOT}`;
const css = readFileSync(join(ROOT, "src/hgab-not-ignorant.css"), "utf8");
const total = list.totals.records;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${STATIC_MARKER} (npm run build:hgab-not-ignorant, ${esc(list.built_at)})">
<title>${esc(meta.title)}</title>
<meta name="description" content="${esc(meta.description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="BetterGov Budget">
<meta property="og:title" content="${esc(meta.title)}">
<meta property="og:description" content="${esc(meta.description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${esc(meta.image ?? `${CHANGES_LIST_SITE}/og.png`)}">
<meta property="og:image:width" content="${esc(meta.imageWidth ?? "1200")}">
<meta property="og:image:height" content="${esc(meta.imageHeight ?? "630")}">
<meta property="og:image:alt" content="${esc(meta.imageAlt ?? meta.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(meta.title)}">
<meta name="twitter:description" content="${esc(meta.description)}">
<meta name="twitter:image" content="${esc(meta.image ?? `${CHANGES_LIST_SITE}/og.png`)}">
<meta name="twitter:image:alt" content="${esc(meta.imageAlt ?? meta.title)}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
:root { --font-body: Inter, system-ui, -apple-system, 'Segoe UI', sans-serif; --font-mono: 'JetBrains Mono', ui-monospace, monospace; }
html, body { margin: 0; padding: 0; }
*, *::before, *::after { box-sizing: border-box; }
${css}
</style>
</head>
<body>
<div class="hgab-wani">
<header class="hgab-wani-top">
<p class="hgab-wani-headwall" aria-hidden="true">${esc(headWall)}</p>
<img class="hgab-wani-art" src="/campaign/fist.webp" alt="" aria-hidden="true" width="720" height="1080">
<div class="hgab-wani-head">
<a href="/hgab/2027/overview" class="hgab-wani-logo" aria-label="BetterGov.ph House Budget Analysis"><img src="/brand/bettergov-horizontal-primary.png" alt="BetterGov.ph" width="800" height="206"></a>
<h1 class="hgab-wani-h1" aria-label="${esc(CHANGES_LIST_TITLE)}"><span aria-hidden="true">We are</span><span aria-hidden="true" class="is-red">not</span><span aria-hidden="true">ignorant</span></h1>
<p class="hgab-wani-sub">${total.toLocaleString("en-US")} inserted and adjusted projects in the 2027 House budget bill. We read every single one.</p>
<p class="hgab-wani-count">DPWH, farm-to-market roads, health facilities and irrigation. Inserted first, then increased, then decreased, largest first. ${esc(DEO_MEANING)}</p>
<p class="hgab-wani-dl"><a href="${DATA_HOST}/${CHANGES_LIST_CSV_PATH}" download="${CHANGES_LIST_CSV_NAME}">Download the full list (CSV)</a></p>
</div>
</header>
<main class="hgab-wani-list">
${chunks.join("\n")}
</main>
<footer class="hgab-wani-foot">
<img src="/brand/bettergov-horizontal-white.png" alt="BetterGov.ph" width="800" height="206">
<p class="hgab-wani-foot-url">budget.bettergov.ph${CHANGES_LIST_ROOT}</p>
<p>Amounts are as published in the NEP and House Bill 10858 (third reading). Projects are listed by the DPWH office that carries them out; the documents do not say who asked for any project. Matches are candidates, not findings. ${esc(asOf)} <a href="${DISCLAIMERS_PATH}">Full disclaimers</a> · <a href="${DEO_RESTRICTIONS_PATH}">${esc(DEO_RESTRICTIONS_LINK_TEXT)}</a> · <a href="/hgab/2027/sources">Sources</a></p>
</footer>
</div>
</body>
</html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
const items = (html.match(/<li class="hgab-wani-item /g) ?? []).length;
ensure(items === list.rows.length, `wrote ${items} items, expected ${list.rows.length}`);
console.log(`wrote ${OUT}: ${items.toLocaleString("en-US")} items (${total.toLocaleString("en-US")} listed), ${(html.length / 1024 / 1024).toFixed(2)} MB`);
