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

import { deptTitle, NOT_FOUND_META, isKnownRoute, pageMeta, type PageMeta } from "../lib/seo";

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

  // A path that matches no route still gets the SPA shell as its body — the
  // client router redirects it home — but it must not answer 200, or crawlers
  // index every typo as a duplicate of the home page.
  const known = isKnownRoute(url.pathname);

  const meta = known
    ? await enhanceWithDeptName(env, url.pathname, pageMeta(url.pathname))
    : NOT_FOUND_META;
  const canonical = canonicalFor(url.pathname);

  const rewritten = new HTMLRewriter()
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

  if (known) return rewritten;

  return new Response(rewritten.body, {
    status: 404,
    headers: rewritten.headers,
  });
}

// ---------------------------------------------------------------------------
// robots.txt + llms.txt + sitemap.xml
// ---------------------------------------------------------------------------

/**
 * llms.txt — an orientation page for AI agents and the people wiring them up.
 *
 * The site already ships a machine-readable OpenAPI document and an MCP server;
 * this is the human-readable index that points at them, plus the four caveats
 * an agent has to know before it quotes a figure at anyone.
 */
export function llmsTxt(): Response {
  const body = `# BetterGov Budget

> Philippine national budget data: the enacted General Appropriations Act (GAA)
> for FY2020-2026, and the FY2027 National Expenditure Program (NEP) - the
> Executive's PHP 7.20T proposal, every figure paired with its FY2026 GAA
> baseline. Read-only, no authentication, CORS open.

## Machine interfaces

- [OpenAPI 3.1 specification](${CANONICAL_HOST}/api/v1/openapi.json): the full contract. Start here.
- [REST API index](${CANONICAL_HOST}/api/v1): names every endpoint.
- [API documentation](${CANONICAL_HOST}/docs): the same endpoints, annotated.
- MCP server at ${CANONICAL_HOST}/mcp: stateless streamable HTTP, POST only, protocol 2025-06-18. Nine tools over the same data layer as the REST API, so the two cannot disagree.

## Source data

- [bettergovph/gaa on Hugging Face](https://huggingface.co/datasets/bettergovph/gaa): 4.5M rows, CC0-1.0.
- [Methodology and data quality](${CANONICAL_HOST}/methodology): field mapping, corrections, coverage caveats.
- [Glossary](${CANONICAL_HOST}/glossary): 200+ Philippine budget terms in plain language.

## Before you quote a figure

- **Appropriations are not spending.** A GAA figure is legal authority to spend. It is not an obligation, and not a disbursement. Saying an agency "spent" its appropriation is wrong.
- **The FY2027 NEP is a proposal, not law.** Congress moves these numbers before enacting them as the GAA. Compare NEP to NEP, or GAA to GAA - not across the two.
- **Amounts are exact pesos.** Every response carries \`currency\` and \`scale\` in its \`meta\`. The upstream source publishes thousands of pesos; the conversion is already applied.
- **UACS object codes were recoded between 2025 and 2026.** Object-level year-over-year comparisons spanning that boundary are unsafe without checking the methodology page first.

## Identifiers

GAA department ids are two digits (\`07\` is DepEd, \`18\` is DPWH). The FY2027 NEP adds two synthetic groups: \`SPF\` (special purpose funds) and \`AUTO\` (automatic appropriations). \`AUTO\` is not department \`04\`. List them from /api/v1/gaa/departments rather than hardcoding.

List endpoints paginate with opaque keyset cursors: pass \`next_cursor\` back as \`cursor\`. Cursors are bound to the query's filters, so changing a filter invalidates them.

## Attribution

A community project of [BetterGov.PH](https://bettergov.ph). AI-assisted aggregation and editorial material should be verified against the official DBM source documents before citation.
`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

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
