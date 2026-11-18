/**
 * DPWH Transparency's files (s3.infrawatch.ph), passed through for the reviewer's phone view. Phones can't show a
 * PDF inside a page, so the reviewer draws the pages itself (PDF.js, src/components/HgabPdfPages.tsx), which needs to
 * read the file from the page. That host sends no CORS headers; our own files (budget-assets) do.
 *
 *   GET /api/hgab/2027/document?u=<https://s3.infrawatch.ph/nep/fy2027/….pdf>
 *
 * Only PDFs under that one folder; byte ranges passed on (PDF.js reads in pieces); cached at the edge for a day.
 * Senate copies never come through here: they are ours, and open only once redacted (hgab-senate-copies.ts).
 */
import { DOCUMENT_PROXY_API, proxiedDocument } from "../lib/hgab-review-api";

const PASS = ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"];

export async function handleDocumentProxy(request: Request, url: URL): Promise<Response> {
  if (url.pathname !== DOCUMENT_PROXY_API) return Response.json({ error: "not_found" }, { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") return Response.json({ error: "method" }, { status: 405 });
  const target = url.searchParams.get("u") ?? "";
  if (!proxiedDocument(target)) return Response.json({ error: "not_allowed", message: "Only DPWH Transparency PDFs." }, { status: 400 });
  const range = request.headers.get("Range");
  const res = await fetch(target, {
    method: request.method,
    headers: range ? { Range: range } : {},
    cf: { cacheEverything: true, cacheTtl: 86400 },
  });
  if (!res.ok && res.status !== 206) return Response.json({ error: "upstream", status: res.status }, { status: 502 });
  const headers = new Headers({ "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" });
  for (const h of PASS) { const v = res.headers.get(h); if (v) headers.set(h, v); }
  headers.set("Content-Type", "application/pdf");
  return new Response(res.body, { status: res.status, headers });
}
