/**
 * The House bill's Senate copies (the documents DPWH gave the Senate, R2 `hgab/2027/dpwh/supporting-documents/`) for
 * signed-in members of the project reviewer. DPWH Transparency files are on s3.infrawatch.ph and stay open to all.
 *
 *   POST /api/hgab/2027/senate-copies/grant     a signed-in member gets a grant: good for an hour, for any Senate copy
 *   POST /api/hgab/2027/senate-copies/status    which of a project's Senate copies can open, { paths } (public)
 *   GET  /api/hgab/2027/senate-copies/<path>?grant=…   the file at R2 `hgab/2027/dpwh/supporting-documents/<path>`
 *
 * A grant goes in the address, not a header, so the document viewer's frame, a new tab and a download all work. It is
 * `<member_id>.<expiry>.<HMAC>`, signed with a key derived from CLERK_SECRET_KEY (no other secret to keep). The file
 * is read through the R2 binding, with Range requests for the PDF viewer.
 *
 * Only redacted copies open, so no personal information leaks: a file opens when the redaction has been applied to it
 * (R2 custom metadata `redacted`, set by the redaction uploader, docs/senate-redaction.md) and its region isn't held
 * back by hand (SENATE_REGIONS_HELD_BACK in src/lib/senate-copies-held-back.ts). Copies the redaction skipped (20+
 * pages, damaged files, non-PDFs) have no `redacted` and never open; a region's copies open by themselves as its
 * redacted files are uploaded.
 *
 * This gates our page only. The same files are public at budget-assets.bettergov.ph until that path is blocked there;
 * research.bettergov.ph links to them (docs/hgab-review-form.md, "Senate copies").
 */
import { closed, fail, login, memberFor, missingTable, message, reply, type ReviewEnv } from "./hgab-reviews";
import { heldBackRegion } from "../lib/senate-copies-held-back";

type FilesEnv = ReviewEnv & { DATA_BUCKET?: R2Bucket };

export const SENATE_COPIES_API = "/api/hgab/2027/senate-copies";
const PREFIX = "hgab/2027/dpwh/supporting-documents/";
const GRANT_SECONDS = 60 * 60;
const TYPES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip: "application/zip",
};

const enc = new TextEncoder();
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

let keyCache: { secret: string; key: CryptoKey } | null = null;
/** The grant key: HMAC of a fixed label under CLERK_SECRET_KEY, so it changes when that secret is rotated. */
async function grantKey(secret: string): Promise<CryptoKey> {
  if (keyCache?.secret === secret) return keyCache.key;
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const raw = await crypto.subtle.sign("HMAC", base, enc.encode("hgab-senate-copies/1"));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  keyCache = { secret, key };
  return key;
}

async function makeGrant(secret: string, memberId: string, expires: number): Promise<string> {
  const body = `${memberId}.${expires}`;
  return `${body}.${b64url(await crypto.subtle.sign("HMAC", await grantKey(secret), enc.encode(body)))}`;
}

/** Whether a grant is ours and still good (constant-time check). */
async function grantOk(secret: string, grant: string | null): Promise<boolean> {
  const m = /^([0-9a-f-]{36})\.(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(grant ?? "");
  if (!m || Number(m[2]) < Date.now() / 1000) return false;
  try {
    const sig = unb64url(m[3]);
    // One spelling per signature: the last character's padding bits must be zero.
    if (b64url(sig.buffer) !== m[3]) return false;
    return await crypto.subtle.verify("HMAC", await grantKey(secret), sig, enc.encode(`${m[1]}.${m[2]}`));
  } catch {
    return false;
  }
}

/** Whether the redaction has been applied to a Senate copy: the uploader's R2 custom metadata `redacted`. */
const isRedacted = (o: R2Object) => !!o.customMetadata?.redacted;
const NOT_YET = (region: string | null) =>
  `This Senate copy isn’t available yet: we’re redacting signatures${region ? ` in ${region}’s documents` : ""} first, for privacy.`;
/** A Senate copy's region (its first folder), for messages. */
const regionOf = (path: string) => path.split("/")[0] || null;
/** A path in the Senate folder, decoded, or null if it isn't one (empty parts, "." or ".."). */
function cleanPath(rest: string): string | null {
  let path: string;
  try { path = decodeURIComponent(rest); } catch { return null; }
  return !path || path.split("/").some((part) => part === "" || part === "." || part === "..") ? null : path;
}

/**
 * Which of a project's Senate copies can open, for the page to tag them before anyone asks: `available`, `held`
 * (region held back by hand), `not_redacted` (not yet, or skipped by the redaction) or `missing`. Public: it says
 * nothing about the files' contents. Body `{ "paths": [...] }`: up to 200 paths as the data lists them (percent-encoded,
 * after the folder; a project has at most 80).
 */
export type SenateCopyStatus = "available" | "held" | "not_redacted" | "missing";
async function status(request: Request, env: FilesEnv): Promise<Response> {
  if (!env.DATA_BUCKET) return closed();
  const text = await request.text();
  if (text.length > 64 * 1024) return fail(413, "too_large", "Too many paths.");
  let body: unknown;
  try { body = JSON.parse(text); } catch { return fail(400, "invalid_json", "Send { \"paths\": [...] }."); }
  const raw = (body as { paths?: unknown })?.paths;
  if (!Array.isArray(raw)) return fail(400, "invalid_paths", "Send { \"paths\": [...] }.");
  const asked = [...new Set(raw.filter((p): p is string => typeof p === "string" && p.length <= 1000))].slice(0, 200);
  const data: Record<string, SenateCopyStatus> = {};
  await Promise.all(asked.map(async (p) => {
    const path = cleanPath(p);
    if (!path) return;
    if (heldBackRegion(path)) { data[p] = "held"; return; }
    const head = await env.DATA_BUCKET!.head(PREFIX + path);
    data[p] = !head ? "missing" : isRedacted(head) ? "available" : "not_redacted";
  }));
  return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
}

/** A small page for a frame or tab that has no good grant. */
const signInPage = (status: number, text: string, title = "Sign in to read the Senate copies") => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>${title}</title>
<body style="font:15px/1.5 system-ui,sans-serif;margin:15vh auto;max-width:28em;padding:0 1em;color:#333">
<p>${text}</p><p><a href="/hgab/2027/review">Open the project reviewer</a></p></body>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
);

async function serveFile(request: Request, env: FilesEnv, url: URL, rest: string): Promise<Response> {
  if (!env.CLERK_SECRET_KEY || !env.DATA_BUCKET) return signInPage(503, "Reading the Senate copies is not open yet.");
  if (!(await grantOk(env.CLERK_SECRET_KEY, url.searchParams.get("grant")))) {
    return signInPage(401, "The Senate copies are for signed-in members. Sign in on the project reviewer, then open the document again.");
  }
  const path = cleanPath(rest);
  if (!path) return signInPage(400, "That is not a document address.");
  // Regions held back by hand stay unavailable, grant or not (src/lib/senate-copies-held-back.ts).
  const held = heldBackRegion(path);
  if (held) return signInPage(403, NOT_YET(held), "Not available yet");

  const object = await env.DATA_BUCKET.get(PREFIX + path, { range: request.headers, onlyIf: request.headers });
  if (!object) return signInPage(404, "We have no Senate copy at this address.");
  // Only copies the redaction has been applied to: anything else may show signatures and other personal information.
  if (!isRedacted(object)) {
    if ("body" in object) await object.body.cancel();
    return signInPage(403, NOT_YET(regionOf(path)), "Not available yet");
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream");
  const name = path.split("/").pop()!;
  headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  // The grant is in the address: keep the file out of shared caches, search engines and referrers.
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("X-Robots-Tag", "noindex");
  headers.set("Referrer-Policy", "no-referrer");
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  const range = object.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && request.headers.has("Range")) {
    const offset = range.suffix != null ? object.size - range.suffix : range.offset ?? 0;
    const length = range.suffix ?? range.length ?? object.size - offset;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(request.method === "HEAD" ? null : object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
}

async function grant(request: Request, env: FilesEnv, url: URL): Promise<Response> {
  if (!env.DATA_BUCKET) return closed();
  const who = await login(request, env, url);
  if (who instanceof Response) return who;
  const memberId = await memberFor(env, who, new Date().toISOString());
  if (memberId instanceof Response) return memberId;
  const expires = Math.floor(Date.now() / 1000) + GRANT_SECONDS;
  return reply({ grant: await makeGrant(env.CLERK_SECRET_KEY!, memberId, expires), expires_at: new Date(expires * 1000).toISOString() });
}

export async function handleSenateCopies(request: Request, env: FilesEnv, url: URL): Promise<Response> {
  const rest = url.pathname.slice(SENATE_COPIES_API.length + 1);
  try {
    if (rest === "grant" && request.method === "POST") return await grant(request, env, url);
    if (rest === "status" && request.method === "POST") return await status(request, env);
    if (rest && rest !== "grant" && rest !== "status" && (request.method === "GET" || request.method === "HEAD")) return await serveFile(request, env, url, rest);
    return fail(404, "not_found", "No such route.");
  } catch (e) {
    if (missingTable(e)) return closed();
    return fail(500, "failed", message(e));
  }
}
