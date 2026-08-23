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

import { deptTitle, pageMeta, type PageMeta } from "../lib/seo";

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

  return new HTMLRewriter()
    .on("title", {
      element(el) {
        el.setInnerContent(meta.title);
      },
    })
    .on('meta[name="description"]', setAttr("content", meta.description))
    .on('link[rel="canonical"]', setAttr("href", canonical))
    .on('meta[property="og:title"]', setAttr("content", meta.title))
    .on('meta[property="og:description"]', setAttr("content", meta.description))
    .on('meta[property="og:url"]', setAttr("content", canonical))
    .transform(res);
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
];

export async function sitemapXml(env: Env): Promise<Response> {
  let deptPaths: string[] = [];
  try {
    const [gaa, nep] = await Promise.all([
      env.DB.prepare(`SELECT id FROM departments ORDER BY id`).all<{ id: string }>(),
      env.DB.prepare(`SELECT id FROM nep_departments ORDER BY id`).all<{ id: string }>(),
    ]);
    deptPaths = [
      ...(gaa.results ?? []).map((d) => `/d/${d.id}`),
      ...(nep.results ?? []).map((d) => `/2027/d/${d.id}`),
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
