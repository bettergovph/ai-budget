/**
 * Edge-side SEO for the SPA.
 *
 * Crawlers and social scrapers don't run JavaScript, so the static
 * index.html's metadata is all they would ever see. This module rewrites the
 * <title>, meta description, canonical link, and og:* tags per route as the
 * HTML streams out of the assets binding (HTMLRewriter), enhancing the shared
 * route table (src/lib/seo.ts) with real department names from D1 where the
 * URL identifies one. It also serves /robots.txt and /sitemap.xml — the
 * sitemap enumerates every department portal and per-year browser page from
 * the same D1 tables.
 */

import {
  deptTitle,
  hearingMeta,
  pageMeta,
  type HearingSeoRow,
  type PageMeta,
} from "../lib/seo";
import { BOARDS, LEADERBOARD_ROOT } from "../lib/hgab-leaderboard";
import { CHANGES_LIST_ROOT } from "../lib/hgab-changes-list";
import { LETTER_ROOT } from "../lib/hgab-letter";
import { districtIdFromSlug } from "../lib/hgab-og";
import { HISTORY_ROOT } from "../lib/hgab-history";

const CANONICAL_HOST = "https://budget.bettergov.ph";

async function one<T>(env: Env, sql: string, ...binds: unknown[]): Promise<T | null> {
  const { results } = await env.DB.prepare(sql).bind(...binds).all<T>();
  return results?.[0] ?? null;
}

/** Best-effort department-name lookups; a D1 hiccup must never break HTML. */
async function enhanceWithDeptName(env: Env, pathname: string, meta: PageMeta): Promise<PageMeta> {
  try {
    const gaaDept = /^\/d\/(\d{2})(?:\/|$)/.exec(pathname);
    if (gaaDept) {
      const row = await one<{ description: string }>(
        env, `SELECT description FROM departments WHERE id = ?`, gaaDept[1],
      );
      if (row) return { ...meta, title: deptTitle(row.description, "gaa") };
    }
    const yearDept = /^\/gaa\/(20\d{2})\/(\d{2})(?:\/|$)/.exec(pathname);
    if (yearDept) {
      const row = await one<{ description: string }>(
        env, `SELECT description FROM departments WHERE id = ?`, yearDept[2],
      );
      if (row) return { ...meta, title: deptTitle(row.description, { year: yearDept[1] }) };
    }
    const nepDept = /^\/2027\/d\/([A-Z0-9]{1,6})(?:\/|$)/.exec(pathname);
    if (nepDept) {
      const row = await one<{ description: string }>(
        env, `SELECT description FROM nep_departments WHERE id = ?`, nepDept[1],
      );
      if (row) return { ...meta, title: deptTitle(row.description, "nep") };
    }
    // House bill district and letter pages: the district's name in the title (its card is the image).
    const district = /^\/hgab\/2027\/districts\/([^/]+)\/?$/.exec(pathname);
    const letter = /^\/hgab\/2027\/letter\/([a-z0-9-]+)\/?$/.exec(pathname);
    if (district || letter) {
      let id: string | null = null;
      try {
        id = district ? decodeURIComponent(district[1]) : districtIdFromSlug(letter![1]);
      } catch {
        id = null;
      }
      const row = id ? await one<{ label: string }>(env, `SELECT label FROM hgab_districts WHERE id = ?`, id) : null;
      if (row) {
        return {
          ...meta,
          title: letter
            ? `Write to Your Representative: ${row.label} — the 2027 House Bill · BetterGov Budget`
            : `${row.label} — DPWH Budget by Congress and the 2027 House Bill · BetterGov Budget`,
          imageAlt: letter ? `A letter from ${row.label} to its representative, on the 2027 House bill` : `${row.label}: its DPWH office in the 2027 House bill`,
        };
      }
    }
    const hearing = /^\/hearings\/([A-Za-z0-9_-]{6,20})(?:\/|$)/.exec(pathname);
    if (hearing) {
      const row = await one<HearingSeoRow>(
        env,
        `SELECT video_id, title, agency, fiscal_year, published_at, length_text,
                has_sections
           FROM hearings WHERE video_id = ?`,
        hearing[1],
      );
      if (row) return hearingMeta(row);
    }
  } catch {
    /* fall through to the static meta */
  }
  return meta;
}

/** Canonical URL: production host + normalized path, redirect aliases folded
    into their targets so duplicate routes don't compete in search. */
function canonicalFor(pathname: string): string {
  let p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/" || p === "/2027") p = "/2027/overview";
  if (p === "/2027/explore") p = "/2027/search";
  if (p === "/hgab" || p === "/hgab/2027") p = "/hgab/2027/overview";
  return p === "/" ? CANONICAL_HOST + "/" : CANONICAL_HOST + p;
}

const setAttr = (name: string, value: string) => ({
  element(el: Element) {
    el.setAttribute(name, value);
  },
});

/**
 * Fetch the SPA HTML from the assets binding and stream route-specific
 * metadata into it. Non-HTML assets pass through untouched.
 */
export async function serveSpaHtml(request: Request, env: Env, url: URL): Promise<Response> {
  const res = await env.ASSETS.fetch(request);
  const contentType = res.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/html")) return res;

  const meta = await enhanceWithDeptName(env, url.pathname, pageMeta(url.pathname));
  const canonical = canonicalFor(url.pathname);

  let rewriter = new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(meta.title);
      },
    })
    .on('meta[name="description"]', setAttr("content", meta.description))
    .on('link[rel="canonical"]', setAttr("href", canonical))
    .on('meta[property="og:title"]', setAttr("content", meta.title))
    .on('meta[property="og:description"]', setAttr("content", meta.description))
    .on('meta[property="og:url"]', setAttr("content", canonical));

  // Only routes that name their own image override the site card, so every
  // other page keeps the default og.png already in index.html.
  if (meta.image) {
    rewriter = rewriter
      .on('meta[property="og:image"]', setAttr("content", meta.image))
      .on('meta[property="og:image:width"]', setAttr("content", meta.imageWidth ?? "1200"))
      .on('meta[property="og:image:height"]', setAttr("content", meta.imageHeight ?? "630"))
      .on('meta[property="og:image:alt"]', setAttr("content", meta.imageAlt ?? meta.title));
  }

  return rewriter.transform(res);
}

// ---------------------------------------------------------------------------
// robots.txt + sitemap.xml
// ---------------------------------------------------------------------------

export function robotsTxt(): Response {
  return new Response(
    `User-agent: *\nAllow: /\n\nSitemap: ${CANONICAL_HOST}/sitemap.xml\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" } },
  );
}

const STATIC_SITEMAP_PATHS = [
  "/2027/overview",
  "/2027/browse",
  "/2027/search",
  "/2027/methodology",
  "/gaa",
  "/gaa/2020", "/gaa/2021", "/gaa/2022", "/gaa/2023", "/gaa/2024", "/gaa/2025", "/gaa/2026",
  "/explore",
  "/methodology",
  "/docs",
  "/glossary",
  "/hearings",
  // FY2027 House bill section: the overview (its landing page), the
  // Explainer, the two static pages and the four dataset hubs. Record pages
  // are too many (≈19k) to list; the hubs link to them.
  "/hgab/2027/overview",
  "/hgab/2027/intro",
  "/hgab/2027/sources",
  "/hgab/2027/methodology",
  "/hgab/2027/dpwh",
  "/hgab/2027/fmr",
  "/hgab/2027/hfep",
  "/hgab/2027/nia",
  // The Districts lens grid; the ~250 district pages are linked from it.
  "/hgab/2027/districts",
  // The leaderboards gallery and every board (national; `?region=` views are not listed).
  LEADERBOARD_ROOT,
  ...BOARDS.map((b) => `${LEADERBOARD_ROOT}/${b.id}`),
  // Every inserted and adjusted project, one page.
  CHANGES_LIST_ROOT,
  // Write to your representative: the picker; the 254 letters are linked from it.
  LETTER_ROOT,
  // Budget history, FY2020 to the 2027 House bill.
  HISTORY_ROOT,
];

export async function sitemapXml(env: Env): Promise<Response> {
  let deptPaths: string[] = [];
  try {
    const [gaa, nep, hearings] = await Promise.all([
      env.DB.prepare(`SELECT id FROM departments ORDER BY id`).all<{ id: string }>(),
      env.DB.prepare(`SELECT id FROM nep_departments ORDER BY id`).all<{ id: string }>(),
      // Only hearings with a transcript: a page that says "no transcript" is
      // not worth a crawler's time.
      env.DB.prepare(
        `SELECT video_id FROM hearings WHERE has_transcript = 1
          ORDER BY published_at DESC`,
      ).all<{ video_id: string }>(),
    ]);
    deptPaths = [
      ...(gaa.results ?? []).map((d) => `/d/${d.id}`),
      ...(nep.results ?? []).map((d) => `/2027/d/${d.id}`),
      ...(hearings.results ?? []).map((h) => `/hearings/${h.video_id}`),
    ];
  } catch {
    /* static pages alone still make a valid sitemap */
  }

  const urls = [...STATIC_SITEMAP_PATHS, ...deptPaths]
    .map((p) => `  <url><loc>${CANONICAL_HOST}${p}</loc></url>`)
    .join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}
