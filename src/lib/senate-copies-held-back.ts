/**
 * Senate copies we don't show yet: the regions whose signatures haven't been redacted (docs/senate-redaction.md).
 * The project reviewer shows their files as "not available yet", and the Worker refuses to serve them
 * (src/worker/hgab-senate-copies.ts). DPWH Transparency files and the other regions are unaffected.
 *
 * THE SWITCH: to show a region again once its redacted copies are uploaded (supporting-documents-file-links.jsonl
 * marks them `redacted: true`), delete its line and deploy. Names are the first folder of a Senate copy's path, as in
 * that file's `region`.
 */
export const SENATE_REGIONS_HELD_BACK: readonly string[] = [
  // 2026-11-14: no redacted copies uploaded yet for these six.
  'NCR',
  'Region III',
  'Region IV-A',
  'Region V',
  'Region X',
  'Region XII',
];

const HELD = new Set(SENATE_REGIONS_HELD_BACK);

/**
 * The held-back region of a Senate copy, from its path in the Senate folder (`Region XII/…`, percent-encoded or not),
 * or null when it can be shown.
 */
export function heldBackRegion(path: string): string | null {
  const first = path.split('/')[0] ?? '';
  let region = first;
  try { region = decodeURIComponent(first); } catch { /* not encoded */ }
  return HELD.has(region) ? region : null;
}
