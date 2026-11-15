/**
 * The House bill's Senate copies (the documents DPWH gave the Senate, R2 `hgab/2027/dpwh/supporting-documents/`):
 * which of them can open in the project reviewer.
 *
 *   POST /api/hgab/2027/senate-copies/status    { paths } → which of a project's Senate copies can open (public)
 *
 * Since 2026-11-15 every region's copies are redacted and public: the reviewer opens a copy straight from its public
 * address (budget-assets.bettergov.ph), signed in or not. It opens only once the redaction has been applied to it
 * (R2 custom metadata `redacted`, set by the redaction uploader, docs/senate-redaction.md) and its region isn't held
 * back by hand (SENATE_REGIONS_HELD_BACK in src/lib/senate-copies-held-back.ts). Copies the redaction skipped (20+
 * pages, damaged files, non-PDFs) have no `redacted` and stay closed in the reviewer, so it never shows personal
 * information. (From 2026-11-13 to 15 the Worker also served the copies itself, to signed-in members, with an hour-long
 * grant; that went when they became public.)
 */
import { closed, fail, missingTable, message } from "./hgab-reviews";
import { heldBackRegion } from "../lib/senate-copies-held-back";

type FilesEnv = Env & { DATA_BUCKET?: R2Bucket };

export const SENATE_COPIES_API = "/api/hgab/2027/senate-copies";
const PREFIX = "hgab/2027/dpwh/supporting-documents/";

/** Whether the redaction has been applied to a Senate copy: the uploader's R2 custom metadata `redacted`. */
const isRedacted = (o: R2Object) => !!o.customMetadata?.redacted;
/** A path in the Senate folder, decoded, or null if it isn't one (empty parts, "." or ".."). */
function cleanPath(rest: string): string | null {
  let path: string;
  try { path = decodeURIComponent(rest); } catch { return null; }
  return !path || path.split("/").some((part) => part === "" || part === "." || part === "..") ? null : path;
}

/**
 * Which of a project's Senate copies can open, for the page to tag them before anyone asks: `available`, `held`
 * (region held back by hand), `not_redacted` (skipped by the redaction, or not done yet) or `missing`. Public: it says
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

export async function handleSenateCopies(request: Request, env: FilesEnv, url: URL): Promise<Response> {
  const rest = url.pathname.slice(SENATE_COPIES_API.length + 1);
  try {
    if (rest === "status" && request.method === "POST") return await status(request, env);
    return fail(404, "not_found", "No such route.");
  } catch (e) {
    if (missingTable(e)) return closed();
    return fail(500, "failed", message(e));
  }
}
