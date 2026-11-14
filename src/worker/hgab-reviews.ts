/**
 * Reviews from the project reviewer (`/hgab/2027/review`), sent by members who signed in with Clerk (email code, no
 * password). Internal to the site, like /api/hearings: not part of the read-only, CORS-open /api/v1.
 *
 *   GET    /api/hgab/2027/reviews/status     every project with a review: its final status, the furthest stage, how many, last save;
 *                                            and the automatic review (review_auto) where there is one
 *   GET    /api/hgab/2027/reviews/mine       the signed-in member's reviews
 *   POST   /api/hgab/2027/reviews            send a review (a CaseReview); one per member per project, kept editable
 *   DELETE /api/hgab/2027/reviews/:case_id   withdraw one of your reviews (it is kept, and comes back if you send it again)
 *
 * The status list is public so anyone can see which projects are taken; it names no one. Sign-in: the page sends the
 * Clerk session token as `Authorization: Bearer …`, checked with CLERK_SECRET_KEY (a Worker secret; `.dev.vars`
 * locally) and, by default, issued to this site's own origin (CLERK_AUTHORIZED_PARTIES, comma-separated, overrides).
 * Without the secret every route answers 503 and the page has no reviewing.
 *
 * Ids are preserved (tables and triggers: scripts/hgab-review/reviews-schema.sql). A member is ours (`member_id`),
 * linked to each sign-in account they use; a new account with the same verified email joins the same member. A case
 * keeps its id for life, every save and withdrawal is a numbered revision, and nothing is deleted.
 *
 * A review is checked twice: `readCaseReview` (types, vocabularies, ids, lengths: refused if anything is off) and the
 * workbook's rules, `validateCaseReview`, which a draft may break but a case sent for independent review may not.
 * Docs: docs/hgab-review-form.md.
 */
import { createClerkClient, verifyToken } from "@clerk/backend";
import { READY_STAGE, newId, readCaseReview, validateCaseReview, type CaseReview } from "../lib/hgab-redflags-team";
import { buildStatusIndex, reviewStatusFromStage, withAutoReviews, type ReviewStatus } from "../lib/hgab-review";

export type ReviewEnv = Env & { CLERK_SECRET_KEY?: string; CLERK_AUTHORIZED_PARTIES?: string };
interface Login { issuer: string; subject: string }

export const REVIEWS_API = "/api/hgab/2027/reviews";
const MAX_BODY = 512 * 1024;
/** Stages only the team sets: the machine's, and after the independent verifier. */
const TEAM_STAGES = new Set(["ai_candidate", "completed"]);

export const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export const fail = (status: number, error: string, message: string, extra: Record<string, unknown> = {}) =>
  reply({ error, message, ...extra }, status);
export const closed = () => fail(503, "reviews_closed", "Reviewing is not open yet.");
export const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const missingTable = (e: unknown) => /no such table/i.test(message(e));
const conflict = (e: unknown) => /UNIQUE constraint|PRIMARY KEY/i.test(message(e));

/** The sign-in account behind the request, or the response to send instead. */
export async function login(request: Request, env: ReviewEnv, url: URL): Promise<Login | Response> {
  if (!env.CLERK_SECRET_KEY) return closed();
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("Authorization") ?? "")?.[1];
  if (!token) return fail(401, "sign_in", "Sign in first.");
  const parties = env.CLERK_AUTHORIZED_PARTIES?.split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const claims = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY, authorizedParties: parties?.length ? parties : [url.origin] });
    if (!claims.sub || !claims.iss) throw new Error("no subject");
    return { issuer: claims.iss, subject: claims.sub };
  } catch {
    return fail(401, "sign_in", "Your sign-in has expired. Sign in again.");
  }
}

/**
 * The member behind a sign-in account. A new account is linked by its verified email: to the member who already has
 * that email (they keep their member id and their reviews), else to a new member.
 */
export async function memberFor(env: ReviewEnv, who: Login, now: string): Promise<string | Response> {
  const known = await env.DB.prepare("SELECT member_id FROM review_member_logins WHERE issuer = ?1 AND subject = ?2")
    .bind(who.issuer, who.subject).first<{ member_id: string }>();
  if (known) {
    await env.DB.batch([
      env.DB.prepare("UPDATE review_member_logins SET last_seen_at = ?3 WHERE issuer = ?1 AND subject = ?2").bind(who.issuer, who.subject, now),
      env.DB.prepare("UPDATE review_members SET last_seen_at = ?2 WHERE member_id = ?1").bind(known.member_id, now),
    ]);
    return known.member_id;
  }
  let email: string | null = null;
  try {
    const primary = (await createClerkClient({ secretKey: env.CLERK_SECRET_KEY }).users.getUser(who.subject)).primaryEmailAddress;
    if (primary?.verification?.status === "verified") email = primary.emailAddress.trim().toLowerCase();
  } catch {
    return fail(503, "account_lookup", "We couldn’t look up your account just now. Try again in a moment.");
  }
  if (!email) return fail(403, "no_email", "Your account needs a verified email address.");
  // One transaction, safe if two first requests race: whoever writes first makes the member and the link.
  const [, , linked] = await env.DB.batch([
    env.DB.prepare("INSERT INTO review_members (member_id, email, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?3) ON CONFLICT DO NOTHING")
      .bind(newId(), email, now),
    env.DB.prepare(
      `INSERT INTO review_member_logins (issuer, subject, member_id, created_at, last_seen_at)
       SELECT ?1, ?2, member_id, ?3, ?3 FROM review_members WHERE email = ?4 ON CONFLICT DO NOTHING`,
    ).bind(who.issuer, who.subject, now, email),
    env.DB.prepare("SELECT member_id FROM review_member_logins WHERE issuer = ?1 AND subject = ?2").bind(who.issuer, who.subject),
  ]);
  const id = (linked.results?.[0] as { member_id?: string } | undefined)?.member_id;
  if (!id) throw new Error("member link failed");
  return id;
}

// Each live review's case status and final status (the payload's `verdict`, the one the team reports).
const LIVE_REVIEWS = "SELECT hgab_id, status, updated_at, json_extract(payload, '$.verdict') AS verdict FROM review_cases WHERE kind = 'review' AND withdrawn_at IS NULL";
type StatusRow = { hgab_id: string; status: ReviewStatus; updated_at: string; verdict: string | null };

/** One project's entry in the status list, after a change. */
const LIVE_AUTO = "SELECT hgab_id, score, method, updated_at FROM review_auto WHERE withdrawn_at IS NULL";
type AutoRow = { hgab_id: string; score: number; method: string; updated_at: string };
/**
 * The automatic reviews (review_auto, from sync:hgab-auto-reviews). None when the table isn't there yet (the schema
 * not applied to this D1), so the status list keeps working without them.
 */
async function autoReviews(env: ReviewEnv, hgabId?: string): Promise<AutoRow[]> {
  try {
    const q = hgabId ? env.DB.prepare(`${LIVE_AUTO} AND hgab_id = ?1`).bind(hgabId) : env.DB.prepare(LIVE_AUTO);
    return (await q.all<AutoRow>()).results ?? [];
  } catch {
    return [];
  }
}

async function projectStatus(env: ReviewEnv, hgabId: string) {
  const [{ results }, auto] = await Promise.all([env.DB.prepare(`${LIVE_REVIEWS} AND hgab_id = ?1`).bind(hgabId).all<StatusRow>(), autoReviews(env, hgabId)]);
  return withAutoReviews(buildStatusIndex(results ?? []), auto)[hgabId] ?? null;
}

async function statusList(env: ReviewEnv) {
  const [{ results }, auto] = await Promise.all([env.DB.prepare(LIVE_REVIEWS).all<StatusRow>(), autoReviews(env)]);
  const data = withAutoReviews(buildStatusIndex(results ?? []), auto);
  return reply({ meta: { generated_at: new Date().toISOString(), reviews: results?.length ?? 0, auto: auto.length, projects: Object.keys(data).length }, data });
}

/** The member (their id and the name they last gave) and their reviews, newest first. */
async function mine(env: ReviewEnv, memberId: string) {
  const [member, cases] = await env.DB.batch([
    env.DB.prepare("SELECT member_id, display_name FROM review_members WHERE member_id = ?1").bind(memberId),
    env.DB.prepare("SELECT payload FROM review_cases WHERE member_id = ?1 AND withdrawn_at IS NULL ORDER BY updated_at DESC").bind(memberId),
  ]);
  const rows = (cases.results ?? []) as { payload: string }[];
  return reply({ meta: { reviews: rows.length }, member: member.results?.[0], data: rows.map((r) => JSON.parse(r.payload) as CaseReview) });
}

interface CaseRow { case_id: string; hgab_id: string; member_id: string; kind: string; rev: number; withdrawn_at: string | null }

async function send(request: Request, env: ReviewEnv, memberId: string, now: string) {
  const text = await request.text();
  if (text.length > MAX_BODY) return fail(413, "too_large", "This review is too large to send.");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail(400, "invalid_json", "The review is not valid JSON."); }
  const { review, problems } = readCaseReview(raw);
  if (!review) return fail(400, "invalid_review", "The review could not be read.", { problems });
  if (review.kind !== "review") return fail(403, "verification_closed", "Verifying other members’ reviews is not open yet.");
  if (TEAM_STAGES.has(review.case_stage)) return fail(403, "team_stage", "Only the team sets this case stage.");
  const errors = validateCaseReview(review).filter((i) => i.level === "error");
  if (review.case_stage === READY_STAGE && errors.length) {
    return fail(422, "not_ready", "Fix these before sending the case for independent review.", { issues: errors });
  }

  const hgabId = review.project.hgab_id;
  const byId = await env.DB.prepare("SELECT case_id, hgab_id, member_id, kind, rev, withdrawn_at FROM review_cases WHERE case_id = ?1")
    .bind(review.case_id).first<CaseRow>();
  if (byId && byId.member_id !== memberId) return fail(403, "not_yours", "This review belongs to another member.");
  if (byId && (byId.hgab_id !== hgabId || byId.kind !== review.kind)) return fail(409, "other_project", "This review is for another project.");
  // The member's case for this project, from whichever window or device started it: it keeps its first case id.
  const current = byId ?? await env.DB.prepare(
    "SELECT case_id, hgab_id, member_id, kind, rev, withdrawn_at FROM review_cases WHERE hgab_id = ?1 AND member_id = ?2 AND kind = ?3",
  ).bind(hgabId, memberId, review.kind).first<CaseRow>();

  const caseId = current?.case_id ?? review.case_id;
  const rev = (current?.rev ?? 0) + 1;
  const action = !current ? "create" : current.withdrawn_at ? "restore" : "update";
  const stored: CaseReview = {
    ...review, case_id: caseId, revision: rev, reviewer: { ...review.reviewer, reviewer_id: memberId }, submitted_at: now,
  };
  const status = reviewStatusFromStage(review.case_stage);
  const outcomes = review.flags.filter((f) => f.human_outcome !== "not_reviewed").length;
  const payload = JSON.stringify(stored);
  const write = current
    // Only from the revision we read: if another window saved in between, the revision insert below collides and
    // the whole batch rolls back.
    ? env.DB.prepare(
      `UPDATE review_cases SET status = ?3, case_stage = ?4, risk_priority = ?5, outcomes = ?6, registry_sha256 = ?7,
         rev = ?8, payload = ?9, updated_at = ?10, withdrawn_at = NULL
       WHERE case_id = ?1 AND rev = ?2`,
    ).bind(caseId, current.rev, status, review.case_stage, review.risk_priority, outcomes, review.registry.sha256, rev, payload, now)
    : env.DB.prepare(
      `INSERT INTO review_cases (case_id, hgab_id, member_id, kind, verifies_case_id, status, case_stage, risk_priority, outcomes,
         registry_sha256, rev, payload, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, ?12, ?12)`,
    ).bind(caseId, hgabId, memberId, review.kind, review.verifies_case_id, status, review.case_stage, review.risk_priority, outcomes,
      review.registry.sha256, payload, now);
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE review_members SET display_name = ?2 WHERE member_id = ?1").bind(memberId, review.reviewer.display_name),
      write,
      env.DB.prepare(
        `INSERT INTO review_case_revisions (case_id, rev, member_id, action, status, case_stage, payload, saved_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ).bind(caseId, rev, memberId, action, status, review.case_stage, payload, now),
    ]);
  } catch (e) {
    if (conflict(e)) return fail(409, "changed", "Your review was saved from another window at the same moment. Reload it and try again.");
    throw e;
  }
  return reply({ data: stored, project: await projectStatus(env, hgabId), warnings: errors.length });
}

async function withdraw(env: ReviewEnv, memberId: string, caseId: string, now: string) {
  const row = await env.DB.prepare(
    "SELECT hgab_id, rev, status, case_stage, payload FROM review_cases WHERE case_id = ?1 AND member_id = ?2 AND withdrawn_at IS NULL",
  ).bind(caseId, memberId).first<{ hgab_id: string; rev: number; status: string; case_stage: string; payload: string }>();
  if (!row) return fail(404, "not_found", "You have no review with this id.");
  try {
    await env.DB.batch([
      env.DB.prepare("UPDATE review_cases SET withdrawn_at = ?3, updated_at = ?3, rev = ?2 + 1 WHERE case_id = ?1 AND rev = ?2")
        .bind(caseId, row.rev, now),
      env.DB.prepare(
        `INSERT INTO review_case_revisions (case_id, rev, member_id, action, status, case_stage, payload, saved_at)
         VALUES (?1, ?2, ?3, 'withdraw', ?4, ?5, ?6, ?7)`,
      ).bind(caseId, row.rev + 1, memberId, row.status, row.case_stage, row.payload, now),
    ]);
  } catch (e) {
    if (conflict(e)) return fail(409, "changed", "Your review changed in another window. Reload it and try again.");
    throw e;
  }
  return reply({ data: { case_id: caseId, hgab_id: row.hgab_id }, project: await projectStatus(env, row.hgab_id) });
}

export async function handleReviews(request: Request, env: ReviewEnv, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  try {
    if (path === `${REVIEWS_API}/status` && method === "GET") return env.CLERK_SECRET_KEY ? await statusList(env) : closed();
    const caseMatch = new RegExp(`^${REVIEWS_API}/([A-Za-z0-9_-]{8,64})$`).exec(path);
    const route = path === `${REVIEWS_API}/mine` && method === "GET" ? "mine"
      : path === REVIEWS_API && method === "POST" ? "send"
        : caseMatch && method === "DELETE" ? "withdraw" : null;
    if (!route) return fail(404, "not_found", "No such reviews route.");
    const who = await login(request, env, url);
    if (who instanceof Response) return who;
    const now = new Date().toISOString();
    const memberId = await memberFor(env, who, now);
    if (memberId instanceof Response) return memberId;
    if (route === "mine") return await mine(env, memberId);
    if (route === "send") return await send(request, env, memberId, now);
    return await withdraw(env, memberId, caseMatch![1], now);
  } catch (e) {
    if (missingTable(e)) return closed();
    return fail(500, "failed", message(e));
  }
}
