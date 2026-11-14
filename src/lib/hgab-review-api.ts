/**
 * The reviewer page's side of the reviews API (src/worker/hgab-reviews.ts): everyone's review status, the signed-in
 * member's reviews, sending one and withdrawing one; and the grant to read the Senate copies
 * (src/worker/hgab-senate-copies.ts). `token` is the member's Clerk session token.
 */
import type { CaseReview, ValidationIssue } from './hgab-redflags-team';
import type { ReviewStatusIndex } from './hgab-review';
import { heldBackRegion } from './senate-copies-held-back';

export const REVIEWS_API = '/api/hgab/2027/reviews';
export type ProjectStatus = ReviewStatusIndex[string];

type ErrorBody = { error?: string; message?: string; issues?: ValidationIssue[]; problems?: string[] } | null;
export class ReviewsApiError extends Error {
  status: number;
  code: string;
  issues: ValidationIssue[];
  problems: string[];
  constructor(status: number, body: ErrorBody) {
    super(body?.message ?? `The server answered ${status}.`);
    this.status = status;
    this.code = body?.error ?? 'failed';
    this.issues = body?.issues ?? [];
    this.problems = body?.problems ?? [];
  }
}

async function call<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...init, headers, cache: 'no-store' });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ReviewsApiError(res.status, body as ErrorBody);
  return body as T;
}

export const fetchStatus = () =>
  call<{ meta: { generated_at: string; reviews: number; auto?: number; projects: number }; data: ReviewStatusIndex }>(`${REVIEWS_API}/status`);
export const fetchMine = (token: string | null) =>
  call<{ member: { member_id: string; display_name: string }; data: CaseReview[] }>(`${REVIEWS_API}/mine`, {}, token);
export const sendReview = (review: CaseReview, token: string | null) =>
  call<{ data: CaseReview; project: ProjectStatus | null; warnings: number }>(REVIEWS_API, { method: 'POST', body: JSON.stringify(review) }, token);
export const withdrawReview = (caseId: string, token: string | null) =>
  call<{ data: { case_id: string; hgab_id: string }; project: ProjectStatus | null }>(`${REVIEWS_API}/${encodeURIComponent(caseId)}`, { method: 'DELETE' }, token);

export const SENATE_COPIES_API = '/api/hgab/2027/senate-copies';
const SENATE_FOLDER = '/hgab/2027/dpwh/supporting-documents/';
/** A Senate copy's path in its folder, from its public address (as the data lists it); null for any other file. */
export function senatePath(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    return path.startsWith(SENATE_FOLDER) ? path.slice(SENATE_FOLDER.length) : null;
  } catch {
    return null;
  }
}
/** The region a Senate copy is held back for (not yet redacted: src/lib/senate-copies-held-back.ts), else null. */
export function senateHeldBack(url: string): string | null {
  const path = senatePath(url);
  return path == null ? null : heldBackRegion(path);
}
/**
 * Where to open a document: a Senate copy through the Worker with the member's grant (null without one, or while its
 * region is held back); others as they are.
 */
export function documentHref(url: string, grant: string | null): string | null {
  const path = senatePath(url);
  if (path == null) return url;
  if (heldBackRegion(path)) return null;
  return grant ? `${SENATE_COPIES_API}/${path}?grant=${encodeURIComponent(grant)}` : null;
}
export const fetchSenateGrant = (token: string | null) =>
  call<{ grant: string; expires_at: string }>(`${SENATE_COPIES_API}/grant`, { method: 'POST' }, token);

/**
 * Which of a project's Senate copies can open (src/worker/hgab-senate-copies.ts): `available` only when the redaction
 * has been applied to the file and its region isn't held back. `paths` as `senatePath` gives them.
 */
export type SenateCopyStatus = 'available' | 'held' | 'not_redacted' | 'missing';
export const fetchSenateStatus = (paths: string[]) =>
  call<{ data: Record<string, SenateCopyStatus> }>(`${SENATE_COPIES_API}/status`, { method: 'POST', body: JSON.stringify({ paths }) });
