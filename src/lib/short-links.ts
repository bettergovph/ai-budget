/**
 * Short addresses for posters and messages (Jason, 2026-11-17: "shorter urls like budget.bettergov.ph/review that
 * redirects to the proper url"). The Worker answers each with a redirect (src/worker/index.ts), a 302 so a target can
 * move (next year's reviewer, say) without browsers holding on to the old one; the app has the same routes for links
 * inside the site (App.tsx). The query string comes along. Pure: safe in the Worker.
 *
 *   /review, /reviewer           → the project reviewer
 *   /review/<id>                 → the reviewer, open on one project (House bill row id or comparison row id)
 */
import { REVIEW_ROOT } from './hgab-review';

/** The reviewer's short address, as the posters print it. */
export const REVIEW_SHORT_PATH = '/review';
/** The short paths, for the app's routes. */
export const SHORT_PATHS = [REVIEW_SHORT_PATH, '/reviewer'] as const;
/** A project id in a short address: `HB10858-3-0294-003421` or `house-reading:8501`. */
const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$/;

/** Where a short address goes, with its query (`search`, "" or "?…"); null when the path isn't one. */
export function shortLinkTarget(pathname: string, search = ''): string | null {
  const p = pathname.replace(/\/+$/, '').toLowerCase() || '/';
  if ((SHORT_PATHS as readonly string[]).includes(p)) return `${REVIEW_ROOT}${search}`;
  const m = /^\/review\/([^/]+)$/i.exec(pathname.replace(/\/+$/, ''));
  if (m) {
    let id: string;
    try { id = decodeURIComponent(m[1]); } catch { return null; }
    if (!PROJECT_ID_RE.test(id)) return null;
    const q = new URLSearchParams(search);
    q.set('p', id);
    return `${REVIEW_ROOT}?${q.toString().replace(/%3A/gi, ':')}`;
  }
  return null;
}
