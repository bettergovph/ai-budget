/**
 * "Be a citizen reviewer. Review House insertions.": the call for volunteers to review the documents of the House's DPWH insertions in
 * the project reviewer (/hgab/2027/review, short address budget.bettergov.ph/review). Jason (2026-11-17): "We need a
 * new 'Be a citizen budget reviewer' and call it 'Review House Insertions Documents' that points to our document
 * reviewer. Update the content as well that fits our goal", "shorter urls like budget.bettergov.ph/review", "Create a
 * new og:image"; then "poster sounds cliche. 'Be a citizen reviewer. Review house insertions'. Also 'insertions documents'
 * doesn't sound right", "'help us review them' instead of 'help us read them'", then "how about 'Help review house
 * insertions' and make it equally large": one headline, four lines at one size, the call in red. With the call in
 * the headline, the paragraph no longer repeats "Help us review them", and the generic closing band ("We can only be
 * effective if we work together") went to make room.
 *
 * The "Be a citizen budget reviewer" poster's layout (2 Nov): kicker, title, strap, the why, four steps, what to look
 * for, the closing bands and the dark footer. The words follow the reviewer as built: sign in with an email code, the
 * "House insertions" progress card lists the ones nobody has reviewed, the documents open beside the project, and every
 * answer is Satisfactory, Needs attention or Needs immediate attention, with a remark and a final status. What to look
 * for comes from the team's 16 questions. The copy rule for insertions (Jason, 2026-11-11): insertions aren't wrong,
 * but each needs its documents and a reason.
 *
 * The background is the House insertions themselves, in the bill's order, each with its amount as published: the
 * projects a reviewer would open. Every figure comes from documents/review.json (npm run build:hgab-documents), the
 * file the reviewer reads, so the poster cannot disagree with the site. Nothing is generated.
 *
 * Renders in headless Chromium (playwright-core) in the posters' type (Anton, Inter, JetBrains Mono), paper and footer,
 * and writes to --out (default data/hgab/2027/campaign/, gitignored):
 *   review-house-insertions-1080x1350.png   feed post (4:5)
 *   review-house-insertions-1200x630.png    link preview (og:image) for the reviewer
 *
 * Usage: npm run build:hgab-poster-review -- [--out=dir] [--only=post,og] [--draft]   (CHROMIUM_PATH for a local
 * headless shell). Needs network access for Google Fonts.
 */
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REVIEW_INDEX_PATH, type ReviewIndex } from "../src/lib/hgab-documents";
import { decodeIndex } from "../src/lib/hgab-review";
import { REVIEW_SHORT_PATH } from "../src/lib/short-links";
import { CONTACT_EMAIL, DISCORD_URL } from "../src/lib/site-legal";

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`build-hgab-poster-review: ${msg}`); process.exit(1); }
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(args.out ?? join(ROOT, "data/hgab/2027/campaign"));
const ONLY = args.only ? String(args.only).split(",") : null;

// ---------------------------------------------------------------------------
// The figures: the House insertions, as the reviewer counts them
// ---------------------------------------------------------------------------

const IX_PATH = join(ROOT, "data/hgab/2027", REVIEW_INDEX_PATH);
ensure(existsSync(IX_PATH), `${IX_PATH} not found (npm run build:hgab-documents)`);
const IX = JSON.parse(readFileSync(IX_PATH, "utf8")) as ReviewIndex;
const INS = decodeIndex(IX).filter((p) => p.insertion).sort((a, b) => a.seq - b.seq);
const PHP = INS.reduce((a, p) => a + p.amount, 0);
const WITH_DOCS = INS.filter((p) => p.files > 0).length;
ensure(INS.length > 6000 && WITH_DOCS > 4000, `unexpected counts: ${INS.length} insertions, ${WITH_DOCS} with documents`);
const count = (n: number) => n.toLocaleString("en-US");
const billions = (php: number) => `₱${(php / 1e9).toFixed(1)} billion`;

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

const SITE = "budget.bettergov.ph";
const URL = `${SITE}${REVIEW_SHORT_PATH}`;
const DISCORD = DISCORD_URL.replace(/^https?:\/\//, "");
const KICKER = ["BetterGov.PH · Volunteers wanted", "FY 2027 Budget"];
/** One headline at one size: who you'd be, then what to do (in red). */
const TITLE = ["Be a citizen", "reviewer.", "Help review", "House insertions."];
const TITLE_RED_FROM = 2;
const SUB = `${count(INS.length)} DPWH projects worth ${billions(PHP)} are in the House bill but not in the NEP, by our comparison. Insertions aren’t wrong, but each needs its documents and a reason.`;
const SUB_OG = `${count(INS.length)} DPWH projects worth ${billions(PHP)} are in the House bill but not in the NEP. Each needs its documents and a reason.`;
/** The steps, as the reviewer works. `{URL}` is the address; `{INS}` and `{RATE}` are the reviewer's own labels. */
const STEPS = [
  { head: "Open the reviewer.", text: "Go to {URL} and sign in with your email. No password: we send a code." },
  { head: "Pick a House insertion.", text: "Tap {INS} to list the ones nobody has reviewed yet." },
  { head: "Read its documents.", text: "Its program of work, BP 202, endorsement, site photos and certificate open beside it." },
  { head: "Answer, then save.", text: "Rate each question {RATE}, add a remark if you like, then give the project a final status." },
];
const LOOK_HEAD = "What to look for";
const LOOK = [
  "A key document missing, or for another project",
  "Costs that differ between POW and BP 202",
  "Quantities or unit costs that don’t add up",
  "Site photos that don’t match the place",
  "The same work already funded in an earlier year",
];
const CTA = ["Start here:", URL];
const FINE =
  `<strong>House insertions are candidates, not findings.</strong> They are DPWH lines in House Bill 10858 (third reading) with no matching line in the FY 2027 NEP, by our comparison. An insertion is not evidence of wrongdoing. The documents are DPWH’s, given to the Senate, with signatures redacted. Reviews go to the BetterGov team; each project shows its status, never who reviewed it. Questions: ${DISCORD} · ${CONTACT_EMAIL}.`;
const FINE_OG = `<strong>Candidates, not findings.</strong> DPWH lines in House Bill 10858 with no matching FY 2027 NEP line, by our comparison. An insertion is not evidence of wrongdoing.`;

// ---------------------------------------------------------------------------
// The wall: the House insertions, in the bill's order
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const WALL = INS.map((p) => `<span class="e">${esc(p.title.replace(/\s+/g, " ").trim())} <b>₱${count(p.amount)}</b></span>`);

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const LOGO = `data:image/png;base64,${readFileSync(join(ROOT, "public/brand/bettergov-horizontal-white.png")).toString("base64")}`;
interface Format { key: string; file: string; w: number; h: number; wall: number }
const FORMATS: Format[] = [
  { key: "post", file: "review-house-insertions-1080x1350", w: 1080, h: 1350, wall: 7.2 },
  { key: "og", file: "review-house-insertions-1200x630", w: 1200, h: 630, wall: 6 },
];

/** Sizes per format, in units of 1% of the poster width. */
function sizes(f: Format) {
  const u = f.w / 100;
  if (f.w > f.h) return { u, foot: 9.4 * u, top: 3 * u, left: 3.6 * u, width: 66 * u, kick: 1.35 * u, titleMax: 6.3 * u, strap: 2.7 * u, sub: 1.75 * u, cta: 2.9 * u, url: 1.7 * u, fine: 1.02 * u };
  return { u, foot: 14 * u, top: 4.3 * u, left: 4.6 * u, width: 90.8 * u, kick: 2 * u, titleMax: 10.6 * u, strap: 4.4 * u, sub: 2.05 * u, cta: 3.6 * u, url: 2.15 * u, fine: 1.2 * u };
}

function css(f: Format): string {
  const z = sizes(f), u = z.u;
  const wide = f.w > f.h;
  const ring = `box-shadow: 0 0 0 ${0.5 * u}px var(--paper)`;
  return `
  @page { size: ${f.w}px ${f.h}px; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${f.w}px; height: ${f.h}px; background: #f3eee4; overflow: hidden; }
  .poster { position: relative; width: ${f.w}px; height: ${f.h}px; overflow: hidden; background: #f3eee4; color: #141414; --paper: #f3eee4; --red: #d62828; --ink: #141414; }
  .wall {
    position: absolute; left: ${1.6 * u}px; right: ${1.6 * u}px; top: ${1.4 * u}px; bottom: ${z.foot}px;
    font-family: Inter, sans-serif; text-align: justify; hyphens: none; overflow: hidden;
    color: rgba(20, 20, 20, 0.22); line-height: 1.22; word-spacing: 0.02em;
  }
  .wall .e b { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: rgba(214, 40, 40, 0.55); letter-spacing: -0.02em; }
  .wall .e::after { content: " ■ "; color: rgba(20, 20, 20, 0.2); }
  .head { position: absolute; left: ${z.left}px; width: ${z.width}px; top: ${z.top}px; height: ${f.h - z.foot - z.top - (wide ? 2.2 : 1.8) * u}px; display: flex; flex-direction: column; }
  .pap { background: var(--paper); ${ring}; }
  .kick { display: flex; justify-content: space-between; align-items: baseline; gap: ${2 * u}px; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${z.kick}px; letter-spacing: 0.12em; text-transform: uppercase; }
  .kick span { background: var(--paper); ${ring}; white-space: nowrap; }
  .title { margin-top: ${(wide ? 0.7 : 0.9) * u}px; font-family: Anton, Impact, sans-serif; font-weight: 400; line-height: 0.9; text-transform: uppercase; letter-spacing: 0.005em; color: #111; }
  .title span { display: block; width: fit-content; white-space: nowrap; background: var(--paper); ${ring}; }
  .title .red { color: var(--red); }
  .strap { margin-top: ${(wide ? 0.9 : 1.1) * u}px; }
  .strap span { display: inline-block; white-space: nowrap; font-family: Anton, Impact, sans-serif; font-size: ${z.strap}px; line-height: 1; text-transform: uppercase; letter-spacing: 0.01em; color: #f3eee4; background: var(--ink); padding: ${0.7 * u}px ${1.5 * u}px ${0.6 * u}px; }
  .sub { margin-top: ${(wide ? 1.2 : 1.6) * u}px; font-family: Inter, sans-serif; font-weight: 700; font-size: ${z.sub}px; line-height: 1.3; color: #111; text-wrap: pretty; }
  .panel { position: relative; width: 100%; margin-top: ${2.4 * u}px; background: var(--paper); border: ${0.25 * u}px solid var(--ink); padding: ${1.9 * u}px ${2.2 * u}px ${1.4 * u}px; }
  .panel .tab { position: absolute; left: ${2 * u}px; top: 0; transform: translateY(-50%); font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${1.35 * u}px; letter-spacing: 0.16em; text-transform: uppercase; color: #fff; background: #c8102e; padding: ${0.3 * u}px ${0.75 * u}px; white-space: nowrap; }
  .steps { list-style: none; display: grid; row-gap: ${1 * u}px; }
  .steps li { display: grid; grid-template-columns: ${3.4 * u}px 1fr; column-gap: ${1.4 * u}px; align-items: start; }
  .steps li > b { display: flex; align-items: center; justify-content: center; width: ${3.4 * u}px; height: ${3.4 * u}px; font-family: Anton, Impact, sans-serif; font-weight: 400; font-size: ${2.4 * u}px; color: #fff; background: var(--ink); }
  .steps h3 { font-family: Anton, Impact, sans-serif; font-weight: 400; font-size: ${2.6 * u}px; line-height: 1.1; text-transform: uppercase; letter-spacing: 0.01em; color: #111; }
  .steps p { margin-top: ${0.2 * u}px; font-family: Inter, sans-serif; font-weight: 500; font-size: ${1.74 * u}px; line-height: 1.45; color: #111; text-wrap: pretty; }
  .steps p .link { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 0.92em; letter-spacing: -0.01em; color: #c8102e; white-space: nowrap; }
  /* The reviewer's own labels, drawn as they look on the page. */
  .ui { display: inline-block; white-space: nowrap; font-family: Inter, sans-serif; font-weight: 700; font-size: 0.86em; line-height: 1; padding: ${0.32 * u}px ${0.7 * u}px; border: ${0.15 * u}px solid var(--ink); border-radius: ${0.4 * u}px; background: #fff; vertical-align: 0.06em; }
  .ui.is-sat { background: #2f7a3e; border-color: #2f7a3e; color: #fff; }
  .ui.is-na { background: #b45309; border-color: #b45309; color: #fff; }
  .ui.is-nia { background: #c8102e; border-color: #c8102e; color: #fff; }
  .checks { list-style: none; display: grid; grid-template-columns: 1fr 1fr; column-gap: ${2.6 * u}px; row-gap: ${0.6 * u}px; }
  .checks li { position: relative; padding-left: ${2.3 * u}px; font-family: Inter, sans-serif; font-weight: 500; font-size: ${1.62 * u}px; line-height: 1.35; color: #111; text-wrap: pretty; }
  .checks li::before { content: ""; position: absolute; left: 0; top: ${0.42 * u}px; width: ${1.25 * u}px; height: ${1.25 * u}px; box-shadow: inset 0 0 0 ${0.2 * u}px #c8102e; }
  .checks li:last-child { grid-column: 1 / -1; }
  /* At the foot of the head, at least its padding below what is above. */
  .close { margin-top: auto; padding-top: ${1.2 * u}px; display: grid; row-gap: ${0.7 * u}px; }
  .close span { display: block; width: fit-content; white-space: nowrap; font-family: Anton, Impact, sans-serif; line-height: 1; text-transform: uppercase; letter-spacing: 0.01em; }
  .close .payoff { font-size: ${3.6 * u}px; color: #f3eee4; background: var(--ink); padding: ${0.65 * u}px ${1.4 * u}px ${0.55 * u}px; }
  .close .cta { display: flex; align-items: baseline; gap: ${1.4 * u}px; width: 100%; background: var(--red); color: #fff; padding: ${1 * u}px ${1.5 * u}px ${0.9 * u}px; }
  .close .cta b { font-family: Anton, Impact, sans-serif; font-weight: 400; font-size: ${z.cta * 1.1}px; line-height: 1; text-transform: uppercase; }
  .close .cta i { font-style: normal; font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${z.cta}px; line-height: 1; letter-spacing: -0.01em; text-transform: none; }
  .foot {
    position: absolute; left: 0; right: 0; bottom: 0; height: ${z.foot}px; background: #111; color: #f3eee4;
    padding: ${(wide ? 1.5 : 2.2) * u}px ${z.left}px; display: grid; grid-template-columns: ${(wide ? 13 : 17) * u}px 1fr; column-gap: ${(wide ? 2.6 : 3.4) * u}px; align-items: start;
    font-family: Inter, sans-serif;
  }
  .foot .brands { padding-top: ${0.4 * u}px; }
  .foot .brands img { width: ${(wide ? 1.8 : 2.3) * u * (800 / 189)}px; }
  .foot .url { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: ${z.url}px; color: #fff; margin-bottom: ${0.5 * u}px; }
  .foot .fine { font-size: ${z.fine}px; line-height: 1.42; color: rgba(243, 238, 228, 0.85); }
  .foot .fine strong { color: #fff; font-weight: 700; }`;
}

/** A step's text: the address in mono, the reviewer's labels drawn as chips. */
function stepText(s: string): string {
  return esc(s)
    .replace("{URL}", `<span class="link">${esc(URL)}</span>`)
    .replace("{INS}", `<span class="ui">House insertions</span>`)
    .replace("{RATE}", `<span class="ui is-sat">Satisfactory</span> <span class="ui is-na">Needs attention</span> or <span class="ui is-nia">Needs immediate attention</span>`);
}

function body(f: Format): string {
  const wide = f.w > f.h;
  const top = `
    <div class="kick"><span>${esc(KICKER[0])}</span><span>${esc(KICKER[1])}</span></div>
    <div class="title">${TITLE.map((t, i) => `<span${i >= TITLE_RED_FROM ? ' class="red"' : ""}>${esc(t)}</span>`).join("")}</div>
    <p class="sub"><span class="pap">${esc(wide ? SUB_OG : SUB)}</span></p>`;
  const close = `<div class="close"><span class="cta"><b>${esc(CTA[0])}</b><i>${esc(CTA[1])}</i></span></div>`;
  if (wide) return top + close;
  return `${top}
    <div class="panel"><p class="tab">How to review</p>
      <ol class="steps">${STEPS.map((s, i) => `<li><b>${i + 1}</b><div><h3>${esc(s.head)}</h3><p>${stepText(s.text)}</p></div></li>`).join("")}</ol></div>
    <div class="panel"><p class="tab">${esc(LOOK_HEAD)}</p>
      <ul class="checks">${LOOK.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>
    ${close}`;
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
    <div><div class="url">${esc(URL)}</div><div class="fine" id="fine">${f.w > f.h ? FINE_OG : FINE}</div></div>
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
      const p = await browser.newPage({ viewport: { width: f.w, height: f.h }, deviceScaleFactor: 1 });
      await p.setContent(html(f), { waitUntil: "networkidle" });
      await p.evaluate(() => document.fonts.ready);
      await p.evaluate("globalThis.__name = (f) => f");
      const fit = await p.evaluate(({ entries, font, max }) => {
        // The title: every line at one size, the largest at which the widest fits the head (Anton's widths step, so search).
        const title = document.querySelector<HTMLElement>(".title")!;
        const spans = [...title.querySelectorAll<HTMLElement>("span")];
        const edge = title.getBoundingClientRect().right;
        let small = 20, big = max;
        while (big - small > 0.1) {
          const m = (small + big) / 2;
          for (const el of spans) el.style.fontSize = `${m}px`;
          if (Math.max(...spans.map((el) => el.getBoundingClientRect().right)) <= edge) small = m; else big = m;
        }
        for (const el of spans) el.style.fontSize = `${small}px`;
        // The wall: as many insertions as fit, in the bill's order.
        const wall = document.getElementById("wall")!;
        wall.style.fontSize = `${font}px`;
        const fits = (n: number) => { wall.innerHTML = entries.slice(0, n).join(""); return wall.scrollHeight <= wall.clientHeight + 0.5; };
        let lo = 0, hi = entries.length;
        while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (fits(mid)) lo = mid; else hi = mid - 1; }
        fits(lo);
        return { shown: lo, title: small };
      }, { entries: WALL, font: f.wall, max: z.titleMax });
      const lay = await p.evaluate(() => {
        const head = document.getElementById("head")!.getBoundingClientRect();
        const kids = [...document.getElementById("head")!.children];
        const close = document.querySelector(".close")!.getBoundingClientRect();
        const above = kids[kids.length - 2].getBoundingClientRect();
        const foot = document.querySelector(".foot")!.getBoundingClientRect();
        const fine = document.getElementById("fine")!.getBoundingClientRect();
        const lines = [...document.querySelectorAll(".title span, .strap span, .kick span, .close .payoff, .close .cta b, .close .cta i, .foot .url")].map((s) => {
          const r = s.getBoundingClientRect();
          return { text: s.textContent, right: r.right, h: r.height, fs: parseFloat(getComputedStyle(s).fontSize) };
        });
        // A chip or an address split across two lines reads as two things.
        const split = [...document.querySelectorAll(".ui, .steps .link")].filter((el) => el.getClientRects().length > 1).map((el) => el.textContent);
        return { headRight: head.right, headBottom: head.bottom, closeBottom: close.bottom, slack: close.top - above.bottom, footTop: foot.top, footBottom: foot.bottom, fineBottom: fine.bottom, lines, split, width: window.innerWidth };
      });
      const png = join(OUT, `${f.file}.png`);
      // --draft writes the picture even when a check fails, to see why.
      if (args.draft) await p.screenshot({ path: png, fullPage: false });
      ensure(lay.closeBottom <= lay.footTop - 4, `${f.key}: the head runs into the footer (${Math.round(lay.closeBottom)} > ${Math.round(lay.footTop)})`);
      ensure(lay.closeBottom <= lay.headBottom + 1, `${f.key}: the closing bands overflow the head by ${Math.round(lay.closeBottom - lay.headBottom)}px`);
      ensure(lay.slack >= 0, `${f.key}: the closing bands overlap what is above them by ${Math.round(-lay.slack)}px`);
      const bad = lay.lines.filter((x) => x.right > lay.width - z.left + 1 || x.h > x.fs * 1.6);
      ensure(bad.length === 0, `${f.key}: a one-line text wraps or leaves the poster: ${bad.map((x) => `${x.text} (right ${Math.round(x.right)}, ${Math.round(x.h)}px at ${Math.round(x.fs)}px)`).join(" | ")}`);
      ensure(lay.split.length === 0, `${f.key}: split across lines: ${lay.split.join(" | ")}`);
      ensure(lay.fineBottom <= lay.footBottom - 2, `${f.key}: the footer text runs out of the footer`);
      if (!args.draft) await p.screenshot({ path: png, fullPage: false });
      const md5 = createHash("md5").update(readFileSync(png)).digest("hex").slice(0, 8);
      console.log(`${f.key.padEnd(4)} ${f.w}×${f.h} · title ${fit.title.toFixed(1)}px · slack ${Math.round(lay.slack)}px · wall ${count(fit.shown)} of ${count(WALL.length)} insertions → ${png} · v=${md5}`);
      await p.close();
    }
  } finally {
    await browser.close();
  }
}

void main();
