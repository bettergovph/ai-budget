/**
 * Pages that moved, old address → new. Jason (2026-11-23): roads, then "Next is we move the MPBs as well, Flood Control
 * there as well": the multi-purpose buildings and flood control pages left the House bill section for the GAA. Posters
 * and shared links carry the old addresses, so they keep working: the Worker answers each with a 301
 * (src/worker/index.ts), and the app has the same routes for links inside the site (App.tsx). The query string comes
 * along; the browser keeps a #fragment across the redirect. Pure: safe in the Worker.
 */
import { HISTORY_ROOT } from './hgab-history';
import { MPB_MAP_ROOT } from './hgab-mpb-years';
import { MPB_POPULATION_ROOT } from './mpb-population';
import { MPB_DOCS_ROOT } from './mpb-documents';
import { FLOOD_COMPARE_ROOT, MPB_COMPARE_ROOT } from './mpb-compare';

export const MOVED_PAGES: Readonly<Record<string, string>> = {
  '/hgab/2027/multi-purpose': HISTORY_ROOT,
  '/hgab/2027/multi-purpose/map': MPB_MAP_ROOT,
  '/hgab/2027/multi-purpose/per-person': MPB_POPULATION_ROOT,
  '/hgab/2027/multi-purpose/documents': MPB_DOCS_ROOT,
  '/hgab/2027/multi-purpose/nep-vs-house-bill': MPB_COMPARE_ROOT,
  '/hgab/2027/flood-control': FLOOD_COMPARE_ROOT,
};

/** Where a moved page lives now, with its query (`search`, "" or "?…"); null when the path didn't move. */
export function movedTarget(pathname: string, search = ''): string | null {
  const to = MOVED_PAGES[pathname.replace(/\/+$/, '')];
  return to ? `${to}${search}` : null;
}
