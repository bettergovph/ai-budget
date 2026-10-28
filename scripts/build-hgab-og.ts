/**
 * Link-preview images (og:image, 1200 × 630) for the House bill section.
 *
 * Writes what `src/lib/hgab-og.ts` describes, under data/hgab/2027/og/:
 *
 *   <page>.png            the section pages: overview, explainer, the four programs, districts,
 *                         leaderboards, the letters, sources, methodology
 *   districts/<slug>.png  one per legislative district page
 *   letters/<slug>.png    one per district's letter page
 *
 * Every figure is read from files the other builders wrote (overview.json,
 * districts.json, leaderboard.json, letters/), nothing re-derived. The cards
 * follow the leaderboard share images: the section's blue band with the logo
 * and the link, then the figures, then a footer with the disclaimer. Cards
 * that show representatives beside amounts carry CARD_DISCLAIMER; districts
 * are paired with their DPWH office badge (docs/hgab-copy.md).
 *
 *   npm run build:hgab-og
 *   npm run build:hgab-og -- --only=pages            # or districts, letters (comma list)
 *   npm run build:hgab-og -- --slugs=cebu-6th,abra-lone --only=districts,letters
 *
 * Renders in headless Chromium (playwright-core); needs network access for
 * Google Fonts and the representatives' portraits. Exits non-zero when a card
 * overflows its frame.
 */
import { chromium, type Page } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CARD_DISCLAIMER } from "../src/lib/hgab-disclaimers";
import { CHANGE_PROGRAM_LABELS } from "../src/lib/hgab-changes-list";
import {
  BOARDS, asOfText, deoBadge, displayName, entryTitle, formatValue, rankEntries, seatHolders, tierText,
  type LeaderboardData, type LeaderEntry,
} from "../src/lib/hgab-leaderboard";
import { LETTER_CREDIT, letterSlug, type LetterData, type LetterIndex } from "../src/lib/hgab-letter";
import {
  OG_HEIGHT, OG_PAGES, OG_WIDTH, districtIdFromSlug, ogDistrictKey, ogLetterKey, ogPageKey, type OgPageKey,
} from "../src/lib/hgab-og";

// ---------------------------------------------------------------------------
// Inputs (shapes mirror src/lib/hgab.ts; that module reads import.meta.env, so it is not imported)
// ---------------------------------------------------------------------------

type Program = "dpwh" | "fmr" | "hfep" | "nia";
interface CcProgram {
  key: Program; house_stage: "hgab2" | "hgab3";
  sources: { nep: { count: number; amount_php: number }; house: { count: number; amount_php: number } };
  insertions: { count: number; amount_php: number };
  deletions: { count: number; amount_php: number };
  adjustments: { increased_count: number; reduced_count: number };
}
interface Overview {
  source_commit: string; built_at: string;
  datasets: Array<{ key: Program; totals: { nep_php: number; hgab2_php: number | null; hgab3_php: number | null }; bridge: Record<string, { rows: number }> }>;
  documents: Array<{ key: string; reading: number | null }>;
  candidate_changes: { programs: CcProgram[] };
}
interface Rep { name: string; status: "resolved" | "ambiguous"; portrait_url: string | null; candidates?: Rep[] }
interface DistrictCard { id: string; label: string; jurisdiction: string; representative: Rep | null; office_ids: string[]; attribution: string }
interface DistrictIndex { source_commit: string; districts: DistrictCard[]; offices: Record<string, { kind: string; district_ids: string[] }> }

const ROOT = resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT_DATA = resolve(get("out") ?? join(ROOT, "data/hgab/2027"));
const ONLY = new Set((get("only") ?? "pages,districts,letters").split(","));
const SLUGS = get("slugs") ? new Set(get("slugs")!.split(",")) : null;

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`build-hgab-og: ${msg}`);
}
const readJson = <T,>(p: string): T => {
  ensure(existsSync(p), `${p} not found`);
  return JSON.parse(readFileSync(p, "utf8")) as T;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const php = (v: number | null | undefined) => formatValue(v ?? null, "php");
const n = (v: number) => v.toLocaleString("en-US");
const plural = (k: number, one: string, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

const FONTS = "https://fonts.googleapis.com/css2?family=Figtree:wght@700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&display=block";
const LOGO = `data:image/png;base64,${readFileSync(join(ROOT, "public/brand/bettergov-horizontal-white.png")).toString("base64")}`;

/** The logo's sun, faint, in the band's corner (drawSun in src/lib/hgab-share-render.ts). */
function sunSvg(): string {
  const R = 100;
  const pt = (a: number, r: number) => `${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`;
  const rays: string[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + Math.PI / 8;
    for (const [off, len, wid] of [[0, 1, 0.075], [-0.16, 0.78, 0.035], [0.16, 0.78, 0.035]] as const) {
      const aa = a + off;
      rays.push(`<polygon points="${pt(aa - wid, R * 0.33)} ${pt(aa, R * len)} ${pt(aa + wid, R * 0.33)}"/>`);
    }
  }
  return `<svg class="sun" viewBox="-100 -100 200 200" aria-hidden="true"><g fill="#fff"><circle r="${R * 0.26}"/>${rays.join("")}</g></svg>`;
}

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${OG_WIDTH}px; height: ${OG_HEIGHT}px; overflow: hidden; background: #fff; }
  body { font-family: Inter, sans-serif; color: #11151c; -webkit-font-smoothing: antialiased; }
  .card { width: ${OG_WIDTH}px; height: ${OG_HEIGHT}px; display: flex; flex-direction: column; }
  .band { position: relative; flex: none; padding: 30px 48px 22px; color: #fff; overflow: hidden;
    background: linear-gradient(135deg, #0a44bd 0%, #083796 100%); }
  .sun { position: absolute; right: -70px; top: -120px; width: 460px; height: 460px; opacity: 0.07; }
  .logo { position: absolute; right: 48px; top: 26px; height: 34px; }
  .eyebrow { font: 600 17px/1 'JetBrains Mono', monospace; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.86); margin-bottom: 16px; padding-right: 260px; }
  h1 { font-family: Figtree, sans-serif; font-weight: 800; font-size: 50px; line-height: 1.08; letter-spacing: -0.01em; max-width: 1080px; }
  .badge { display: inline-block; vertical-align: 0.18em; margin-left: 10px; padding: 3px 8px 4px; border: 1.5px solid rgba(255,255,255,0.7);
    border-radius: 6px; background: rgba(255,255,255,0.12); font: 600 0.4em/1 'JetBrains Mono', monospace; letter-spacing: 0; white-space: nowrap; }
  .sub { font-size: 22px; line-height: 1.3; color: rgba(255,255,255,0.92); margin-top: 12px; max-width: 1090px; }
  .url { font: 600 18px/1 'JetBrains Mono', monospace; margin-top: 16px; color: #fff; }
  .body { flex: 1; min-height: 0; padding: 22px 48px 20px; display: flex; gap: 32px; align-items: stretch; }
  .col { display: flex; flex-direction: column; justify-content: center; gap: 16px; min-width: 0; }
  .grow { flex: 1; }
  .foot { flex: none; padding: 11px 48px 12px; background: #f4f7fc; border-top: 1px solid #d4d8e0; font-size: 15px; line-height: 1.35; color: #5b6373; }
  .foot b { color: #2b3340; font-weight: 600; }
  /* figures */
  .tiles { display: grid; gap: 14px 22px; align-content: center; }
  .tile { border-top: 4px solid #0b4fd9; padding-top: 9px; min-width: 0; }
  .tile .k { font: 600 14px/1.2 'JetBrains Mono', monospace; letter-spacing: 0.08em; text-transform: uppercase; color: #5b6373; }
  .tile .v { font-family: Figtree, sans-serif; font-weight: 800; font-size: 44px; line-height: 1.05; margin: 5px 0 4px; white-space: nowrap; color: #0a44bd; }
  .tile .d { font-size: 17px; line-height: 1.3; color: #2b3340; }
  .tile.gold { border-color: #b07d3a; } .tile.gold .v { color: #8a5c25; }
  .tile.red { border-color: #95463f; } .tile.red .v { color: #95463f; }
  .tile.ink { border-color: #11151c; } .tile.ink .v { color: #11151c; }
  .tile.green { border-color: #3a6b3a; } .tile.green .v { color: #3a6b3a; }
  .cta { align-self: flex-start; padding: 9px 16px; border-radius: 6px; background: #0b4fd9; color: #fff; font: 700 18px/1 Inter, sans-serif; }
  /* people */
  .av { position: relative; flex: none; border-radius: 50%; overflow: hidden; background: #dfe5f1; color: #5b6373;
    display: inline-flex; align-items: center; justify-content: center; font: 700 22px/1 Inter, sans-serif; }
  .av img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center 18%; }
  .person { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .person .who { min-width: 0; }
  .person .nm { font-weight: 700; font-size: 21px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .person .dt { font-size: 16px; line-height: 1.25; color: #5b6373; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .person.big .nm { font-size: 26px; }
  .person .nm.wrap { white-space: normal; font-size: 17px; }
  .more { font-size: 16px; color: #5b6373; padding-left: 2px; }
  .mosaic { display: flex; flex-wrap: wrap; gap: 8px; flex: none; }
  /* leaderboard rows */
  .rows { display: flex; flex-direction: column; justify-content: center; gap: 12px; flex: 1; min-width: 0; }
  .row { display: flex; align-items: center; gap: 16px; padding-bottom: 10px; border-bottom: 1px solid #e7eaef; }
  .row .faces { display: flex; }
  .row .faces .av + .av { margin-left: -14px; border: 2px solid #fff; }
  .row .mid { flex: 1; min-width: 0; }
  .row .bt { font: 600 13px/1.2 'JetBrains Mono', monospace; letter-spacing: 0.08em; text-transform: uppercase; color: #5b6373; }
  .row .et { font-weight: 700; font-size: 22px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .et .badge { border-color: #b9c7e6; background: #e8efff; color: #0a44bd; font-size: 14px; vertical-align: 0.1em; }
  .row .sh { font-size: 15px; color: #5b6373; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .val { font-family: Figtree, sans-serif; font-weight: 800; font-size: 34px; color: #8a5c25; white-space: nowrap; }
  .row .val.down { color: #95463f; }
  .row .val.ink { color: #11151c; }
`;

interface Card {
  eyebrow: string;
  /** Plain text; `badges` follow it inside the headline. */
  title: string;
  badges?: string[];
  /** Text after the badges ("Cebu, 6th District [6th DEO]: letter to 3 representatives"). */
  titleTail?: string;
  sub?: string;
  url: string;
  body: string;
  foot: string;
}

/** The badges, and the tail's leading colon kept on the badges' line so no line starts with ":". */
function headlineTail(badges: string, tail?: string): string {
  if (!tail) return badges;
  const m = /^([:,])\s*(.*)$/.exec(tail);
  return m ? `<span style="white-space: nowrap">${badges}${esc(m[1])}</span> ${esc(m[2])}` : `${badges}${esc(tail)}`;
}

function cardHtml(c: Card): string {
  const badges = (c.badges ?? []).map((b) => `<span class="badge">${esc(b)}</span>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS}" rel="stylesheet"><style>${CSS}</style></head><body><div class="card">
<header class="band">${sunSvg()}<img class="logo" src="${LOGO}" alt="">
<p class="eyebrow">${esc(c.eyebrow)}</p>
<h1>${esc(c.title)}${headlineTail(badges, c.titleTail)}</h1>
${c.sub ? `<p class="sub">${esc(c.sub)}</p>` : ""}
<p class="url">${esc(c.url)}</p></header>
<main class="body">${c.body}</main>
<footer class="foot">${c.foot}</footer></div></body></html>`;
}

interface Tile { k: string; v: string; d: string; tone?: "gold" | "red" | "ink" | "green" }
function tiles(list: Tile[], cols = list.length): string {
  return `<div class="tiles grow" style="grid-template-columns: repeat(${cols}, minmax(0, 1fr))">${list
    .map((t) => `<div class="tile ${t.tone ?? ""}"><p class="k">${esc(t.k)}</p><p class="v">${esc(t.v)}</p><p class="d">${esc(t.d)}</p></div>`)
    .join("")}</div>`;
}

const initials = (name: string) => name.replace(/[“”"][^“”"]*[“”"]/g, "").split(/\s+/).filter((w) => /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join("") || "?";
function avatar(portrait: string | null, name: string, size: number): string {
  const img = portrait ? `<img src="${esc(portrait)}" alt="" onerror="this.remove()">` : "";
  return `<span class="av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.34)}px">${esc(initials(name))}${img}</span>`;
}

const SOURCE = "Source: the 2027 NEP and House Bill 10858, as published";
const COMPARISON = "A candidate is a document comparison, not evidence of wrongdoing.";

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

interface Job { file: string; html: string }

/** Shrinks what does not fit, then reports anything still overflowing. */
async function render(page: Page, job: Job): Promise<void> {
  await page.setContent(job.html, { waitUntil: "networkidle" });
  // tsx keeps function names with an injected __name helper; give the page one too (as build-hgab-poster does).
  await page.evaluate("globalThis.__name = (f) => f");
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))));
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const px = (el: HTMLElement) => parseFloat(getComputedStyle(el).fontSize);
    const h1 = document.querySelector("h1") as HTMLElement;
    // The headline: at most two lines, 34px at the smallest.
    while (h1.getBoundingClientRect().height > px(h1) * 1.08 * 2 + 2 && px(h1) > 34) h1.style.fontSize = `${px(h1) - 1}px`;
    if (h1.getBoundingClientRect().height > px(h1) * 1.08 * 2 + 2) out.push(`headline takes more than two lines: ${h1.textContent}`);
    // Big numbers and names on one line.
    for (const el of document.querySelectorAll<HTMLElement>(".tile .v, .row .val, .person .nm")) {
      while (el.scrollWidth > el.clientWidth + 1 && px(el) > 15) el.style.fontSize = `${px(el) - 1}px`;
    }
    const body = document.querySelector(".body") as HTMLElement;
    for (const el of [body, ...document.querySelectorAll<HTMLElement>(".tiles")]) {
      if (el.scrollHeight > el.clientHeight + 2) out.push(`${el.className} overflows by ${el.scrollHeight - el.clientHeight}px`);
    }
    const card = document.querySelector(".card") as HTMLElement;
    if (card.scrollHeight > card.clientHeight + 1) out.push(`card overflows by ${card.scrollHeight - card.clientHeight}px`);
    return out;
  });
  ensure(problems.length === 0, `${job.file}: ${problems.join("; ")}`);
  mkdirSync(dirname(job.file), { recursive: true });
  await page.screenshot({ path: job.file, clip: { x: 0, y: 0, width: OG_WIDTH, height: OG_HEIGHT } });
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const overview = readJson<Overview>(join(OUT_DATA, "overview.json"));
  const D = readJson<DistrictIndex>(join(OUT_DATA, "districts.json"));
  const L = readJson<LeaderboardData>(join(OUT_DATA, "leaderboard.json"));
  const LI = readJson<LetterIndex>(join(OUT_DATA, "letters/index.json"));
  for (const [name, commit] of [["districts.json", D.source_commit], ["leaderboard.json", L.source_commit], ["letters/index.json", LI.source_commit]] as const) {
    ensure(commit === overview.source_commit, `${name} source_commit ${commit} ≠ overview.json ${overview.source_commit} — rebuild it`);
  }
  const asOf = asOfText(L);
  const cards = new Map(D.districts.map((d) => [d.id, d] as const));
  const portraitOf = (id: string): string | null => {
    const r = cards.get(id)?.representative;
    return r?.status === "resolved" ? r.portrait_url : null;
  };
  const program = (k: Program) => {
    const p = overview.candidate_changes.programs.find((x) => x.key === k);
    ensure(p, `overview.json has no candidate_changes for ${k}`);
    return p;
  };
  const PROGRAMS: Program[] = ["dpwh", "fmr", "hfep", "nia"];
  const ogFile = (key: string) => join(OUT_DATA, key.replace(/^hgab\/2027\//, ""));
  const jobs: Job[] = [];
  const foot = (lead: string) => `${lead} ${esc(asOf)}.`;

  // Every district's slug must map back to its id (the Worker reads letter paths that way).
  for (const d of D.districts) ensure(districtIdFromSlug(letterSlug(d.id)) === d.id, `slug of ${d.id} does not map back`);

  // A sample of seat holders with portraits, spread across the list, for the mosaics.
  const faces = D.districts.filter((d) => d.representative?.status === "resolved" && d.representative.portrait_url);
  const mosaic = (k: number) => {
    const step = faces.length / k;
    return `<div class="mosaic">${Array.from({ length: k }, (_, i) => faces[Math.floor(i * step)])
      .map((d) => avatar(d.representative!.portrait_url, displayName(d.representative!.name), 52)).join("")}</div>`;
  };

  if (ONLY.has("pages")) {
    const page = (key: OgPageKey, c: Card) => {
      ensure(OG_PAGES.some((p) => p.key === key), `unknown page ${key}`);
      jobs.push({ file: ogFile(ogPageKey(key)), html: cardHtml(c) });
    };
    const offices = Object.values(D.offices).filter((o) => o.kind !== "regional_group" && o.district_ids.length).length;
    const tierA = D.districts.filter((d) => d.attribution === "A").length;
    const tierB = D.districts.filter((d) => d.attribution === "B").length;
    const residual = L.totals.by_office_kind.central.hgab3_php + L.totals.by_office_kind.regional.hgab3_php;

    page("overview", {
      eyebrow: "House Budget Analysis · 2027",
      title: "House Bill 10858 against the 2027 NEP, project by project",
      sub: "Four programs, as published: what the House bill lists that the NEP does not, and what it cut or changed.",
      url: "budget.bettergov.ph/hgab/2027/overview",
      body: tiles(PROGRAMS.map((k) => {
        const p = program(k);
        return { k: CHANGE_PROGRAM_LABELS[k], v: php(p.insertions.amount_php), d: `in ${plural(p.insertions.count, "project")} with no match in the NEP`, tone: "gold" };
      })),
      foot: foot(`${SOURCE}. ${COMPARISON}`),
    });

    page("explainer", {
      eyebrow: "Explainer · 2027 House bill",
      title: "The 2027 House bill against the NEP, in short chapters",
      sub: "Program totals, what the House added and dropped, and where the money sits.",
      url: "budget.bettergov.ph/hgab/2027/intro",
      body: tiles(PROGRAMS.map((k) => {
        const t = overview.datasets.find((d) => d.key === k)!.totals;
        const house = program(k).house_stage === "hgab3" ? t.hgab3_php! : t.hgab2_php!;
        const delta = house - t.nep_php;
        return { k: CHANGE_PROGRAM_LABELS[k], v: formatValue(delta, "signed_php"), d: `NEP ${php(t.nep_php)} → House bill ${php(house)}`, tone: delta < 0 ? "red" : "ink" };
      })),
      foot: foot(`${SOURCE}. The NEP is the budget the President submits to Congress.`),
    });

    for (const k of PROGRAMS) {
      const p = program(k);
      const t = overview.datasets.find((d) => d.key === k)!.totals;
      const house = p.house_stage === "hgab3" ? t.hgab3_php! : t.hgab2_php!;
      const changed = p.adjustments.increased_count + p.adjustments.reduced_count;
      page(k, {
        eyebrow: `2027 House bill · ${CHANGE_PROGRAM_LABELS[k]}`,
        title: `${CHANGE_PROGRAM_LABELS[k]}: ${php(t.nep_php)} in the NEP, ${php(house)} in the House bill`,
        sub: "Every project in House Bill 10858 against the NEP, with the page each amount is published on.",
        url: `budget.bettergov.ph/hgab/2027/${k}`,
        body: tiles([
          { k: "In the House bill only", v: php(p.insertions.amount_php), d: `${plural(p.insertions.count, "project")} with no match in the NEP`, tone: "gold" },
          { k: "In the NEP only", v: php(p.deletions.amount_php), d: `${plural(p.deletions.count, "NEP project")} the House bill does not list`, tone: "red" },
          { k: "Amount changed", v: n(changed), d: `${plural(changed, "project")}: ${n(p.adjustments.increased_count)} up, ${n(p.adjustments.reduced_count)} down`, tone: "ink" },
        ]),
        foot: foot(`${SOURCE}. ${COMPARISON}`),
      });
    }

    page("districts", {
      eyebrow: "2027 House bill · Districts",
      title: `${n(D.districts.length)} legislative districts and the ${n(offices)} DPWH offices that serve them`,
      sub: "Each district's DPWH office: enacted budgets from 2020 to 2026, and the 2027 NEP against the House bill.",
      url: "budget.bettergov.ph/hgab/2027/districts",
      body: `<div class="col grow">${mosaic(18)}${tiles([
        { k: "Tier A", v: n(tierA), d: "districts served by an office of their own", tone: "ink" },
        { k: "Tier B", v: n(tierB), d: "districts sharing an office; its totals are not split", tone: "ink" },
        { k: "In no district", v: php(residual), d: "of House bill DPWH projects, under the Central Office and regional offices", tone: "gold" },
      ])}</div>`,
      foot: foot(`<b>Representatives hold the seats in the 20th Congress.</b> ${CARD_DISCLAIMER}`),
    });

    const boardRow = (id: string) => {
      const b = BOARDS.find((x) => x.id === id)!;
      const top = rankEntries(L, b, { limit: 1 }).rows[0];
      ensure(top, `board ${id} has no rows`);
      const e: LeaderEntry = top.entry;
      const people = e.people.slice(0, 3);
      const badges = e.people.length === 1 ? e.offices.map((o) => `<span class="badge">${esc(deoBadge(o.name, e.people[0].jurisdiction))}</span>`).join("") : "";
      return `<div class="row"><span class="faces">${people.map((p) => avatar(p.portrait_url, displayName(p.name), 58)).join("")}</span>` +
        `<div class="mid"><p class="bt">#1 · ${esc(b.title)}</p><p class="et">${esc(entryTitle(e))}${badges}</p><p class="sh">${esc(seatHolders(e, 3))} · ${esc(tierText(e, true))}</p></div>` +
        `<span class="val${top.value < 0 ? " down" : b.section === "history" ? " ink" : ""}">${esc(formatValue(top.value, b.value))}</span></div>`;
    };
    page("leaderboard", {
      eyebrow: "2027 House bill · Leaderboards",
      title: `${BOARDS.length} leaderboards: DPWH offices ranked by their budgets`,
      sub: "The House bill against the NEP, enacted budgets from 2020 to 2026, and the members' bills.",
      url: "budget.bettergov.ph/hgab/2027/leaderboard",
      body: `<div class="rows">${["added-budget", "cuts", "enacted-total"].map(boardRow).join("")}</div>`,
      foot: foot(CARD_DISCLAIMER),
    });

    page("letter", {
      eyebrow: "Write to your representative",
      title: `A letter for each of the ${n(LI.letters.length)} legislative districts`,
      sub: "Ask your representative to explain the DPWH projects the House bill added, and to share the documents behind them.",
      url: "budget.bettergov.ph/hgab/2027/letter",
      body: `<div class="col grow">${mosaic(36)}${tiles([
        { k: "Every district", v: n(LI.letters.length), d: "letters, each with its own list of DPWH projects", tone: "ink" },
        { k: "Shared offices", v: n(LI.letters.filter((l) => l.recipients.length > 1).length), d: "letters go to every representative the office serves", tone: "ink" },
        { k: "Ready to send", v: "PDF + text", d: "print and sign, or edit first", tone: "ink" },
      ])}</div>`,
      foot: foot(`<b>Prepared with the ${esc(LETTER_CREDIT)}.</b> ${CARD_DISCLAIMER}`),
    });

    const houseDocs = overview.documents.filter((d) => d.reading != null).length;
    page("sources", {
      eyebrow: "2027 House bill · Sources",
      title: `${n(overview.documents.length)} published documents behind every figure`,
      sub: "House Bill 10858 at second and third reading, and the NEP volumes, with checksums, page ranges and downloads.",
      url: "budget.bettergov.ph/hgab/2027/sources",
      body: tiles([
        { k: "House Bill 10858", v: n(houseDocs), d: "volumes, at second and third reading", tone: "ink" },
        { k: "NEP 2027", v: n(overview.documents.length - houseDocs), d: "volumes and project lists", tone: "ink" },
        { k: "Every file", v: "SHA-256", d: "checksum, page ranges and a download", tone: "ink" },
      ]),
      foot: foot(`Third-reading volumes as published on the Senate Budget Transparency Portal.`),
    });

    const sumRows = (g: string) => overview.datasets.reduce((t, d) => t + (d.bridge[g]?.rows ?? 0), 0);
    page("methodology", {
      eyebrow: "2027 House bill · Methodology",
      title: "How each House bill project was matched to the NEP",
      sub: "Every line lands in one group: House bill only, NEP only, unchanged, increased, decreased or scope review.",
      url: "budget.bettergov.ph/hgab/2027/methodology",
      body: tiles([
        { k: "House bill only", v: n(sumRows("house_only")), d: "lines with no match in the NEP", tone: "gold" },
        { k: "NEP only", v: n(sumRows("nep_only")), d: "NEP lines the House bill does not list", tone: "red" },
        { k: "Unchanged", v: n(sumRows("unchanged")), d: "lines with the same amount", tone: "ink" },
        { k: "Amount changed", v: n(sumRows("increased") + sumRows("decreased")), d: "lines increased or decreased", tone: "ink" },
      ]),
      foot: foot(`Four programs: DPWH, farm-to-market roads, health facilities and irrigation. ${COMPARISON}`),
    });
  }

  // One card per district and per letter, from the letter data (the office group's figures).
  const letters = LI.letters.filter((l) => !SLUGS || SLUGS.has(l.slug));
  for (const l of letters) {
    const data = readJson<LetterData>(join(OUT_DATA, "letters", `${l.slug}.json`));
    const f = data.figures;
    const own = data.recipients[0];
    const badges = data.offices.map((o) => deoBadge(o, data.district.jurisdiction));
    const officeText = `DPWH ${data.offices.join(" and ")}`;
    const figureTiles = (): Tile[] => (f ? [
      { k: "2027 NEP", v: php(f.nep_php), d: plural(f.nep_rows, "project"), tone: "ink" },
      { k: "2027 House bill", v: php(f.house_php), d: plural(f.house_rows, "project"), tone: "ink" },
      { k: "No match in the NEP", v: php(f.inserted_php), d: `${plural(f.inserted_rows, "House bill project")}`, tone: "gold" },
      { k: "Not in the House bill", v: php(f.dropped_php), d: plural(f.dropped_rows, "NEP project"), tone: "red" },
    ] : []);
    const nameOf = (r: LetterData["recipients"][number]) =>
      r.status === "resolved" ? displayName(r.names[0]) : r.names.length ? r.names.map((x) => displayName(x)).join(" or ") : "Seat not found";
    const person = (r: LetterData["recipients"][number], size: number, big = false, prefix = "") =>
      `<div class="person${big ? " big" : ""}">${avatar(portraitOf(r.district_id), nameOf(r), size)}<div class="who">` +
      `<p class="nm${r.status === "ambiguous" ? " wrap" : ""}">${esc(prefix + nameOf(r))}</p><p class="dt">${esc(r.district)}${r.status === "ambiguous" ? " · seat listed twice" : ""}</p></div></div>`;
    const peopleCol = (list: LetterData["recipients"], max: number, size: number, prefix: string) =>
      `<div class="col" style="width: 430px; flex: none">${list.slice(0, max).map((r) => person(r, size, list.length === 1, prefix)).join("")}` +
      `${list.length > max ? `<p class="more">and ${plural(list.length - max, "more representative")}</p>` : ""}</div>`;

    if (ONLY.has("districts")) {
      const shared = data.recipients.length - 1;
      jobs.push({
        file: ogFile(ogDistrictKey(data.district.id)),
        html: cardHtml({
          eyebrow: "2027 House bill · Legislative district",
          title: data.district.label,
          badges,
          sub: !f ? "No DPWH district engineering office is listed for this district."
            : shared ? `${officeText}: shared by ${n(shared + 1)} legislative districts, so its figures are the office's and not split.`
            : `${officeText}: it serves only this district.`,
          url: `budget.bettergov.ph/hgab/2027/districts/${data.district.id}`,
          body: f
            ? `${peopleCol(data.recipients, 3, data.recipients.length === 1 ? 96 : 64, "Rep. ")}${tiles(figureTiles(), 2)}`
            : `${peopleCol([own], 1, 96, "Rep. ")}<div class="col grow"><p class="sub" style="color:#2b3340;margin:0">The DPWH project lists name no district engineering office for this district, so its projects cannot be told apart.</p></div>`,
          foot: foot(`<b>Representatives hold the seats in the 20th Congress.</b> ${CARD_DISCLAIMER}`),
        }),
      });
    }
    if (ONLY.has("letters")) {
      const k = data.recipients.length;
      const ins = data.inserted.length;
      jobs.push({
        file: ogFile(ogLetterKey(l.slug)),
        html: cardHtml({
          eyebrow: "Write to your representative · 2027 House bill",
          title: data.district.label,
          badges,
          titleTail: `: letter to ${k === 1 ? "your representative" : `${k} representatives`}`,
          sub: ins
            ? `Ask about the ${plural(ins, "DPWH project")} the House bill lists for the ${officeText} with no match in the NEP, and demand the documents.`
            : f ? `Ask about the DPWH projects for the ${officeText}, and demand the documents behind them.`
            : "Ask about the 2027 projects for the district, and demand the documents behind them.",
          url: `budget.bettergov.ph/hgab/2027/letter/${l.slug}`,
          body: `${peopleCol(data.recipients, 3, k === 1 ? 96 : 64, "Hon. ")}<div class="col grow">${f ? tiles([
            { k: "No match in the NEP", v: n(ins), d: ins ? `projects, ${php(f.inserted_php)}` : "projects", tone: "gold" },
            { k: "Amount changed", v: n(data.adjusted.length), d: data.adjusted.length === 1 ? "project" : "projects", tone: "ink" },
            { k: "Not in the House bill", v: n(data.dropped.length), d: data.dropped.length ? `NEP projects, ${php(f.dropped_php)}` : "NEP projects", tone: "red" },
          ]) : ""}<p class="cta">Download the letter: PDF to sign, or text to edit</p></div>`,
          foot: foot(`<b>Prepared with the ${esc(LETTER_CREDIT)}.</b> ${CARD_DISCLAIMER}`),
        }),
      });
    }
  }

  // A full run replaces the per-district and per-letter folders, so no card outlives its district.
  if (!SLUGS) {
    const keep = new Set(LI.letters.map((l) => `${l.slug}.png`));
    for (const sub of ["districts", "letters"]) {
      const dir = join(OUT_DATA, "og", sub);
      if (!ONLY.has(sub) || !existsSync(dir)) continue;
      for (const f of readdirSync(dir)) if (!keep.has(f)) rmSync(join(dir, f));
    }
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: OG_WIDTH, height: OG_HEIGHT }, deviceScaleFactor: 1 });
    let done = 0;
    for (const job of jobs) {
      await render(page, job);
      if (++done % 50 === 0) process.stdout.write(`  ${done}/${jobs.length}\n`);
    }
  } finally {
    await browser.close();
  }
  process.stdout.write(`wrote ${jobs.length} link-preview image${jobs.length === 1 ? "" : "s"} (${OG_WIDTH}×${OG_HEIGHT}) under ${join(OUT_DATA, "og")}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
