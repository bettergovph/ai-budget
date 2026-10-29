/**
 * Link-preview images (og:image) for the House bill section, 1200 × 630.
 *
 * `npm run build:hgab-og` (`scripts/build-hgab-og.ts`) draws them in headless
 * Chromium from the data files and writes:
 *
 *   data/hgab/2027/og/<page>.png             one per section page (OG_PAGES)
 *   data/hgab/2027/og/districts/<slug>.png   one per legislative district page
 *   data/hgab/2027/og/letters/<slug>.png     one per district's letter page
 *
 * `npm run upload:hgab` publishes them under the same keys on the data host.
 * Each leaderboard board keeps its own share image (hgab/2027/share/<board>.png)
 * and "We are not ignorant" and Multi-purpose buildings (/hgab/2027/multi-purpose) their posters
 * (hgab/2027/campaign/*-1200x630.png); this module covers the rest.
 *
 * Pure (no `import.meta.env`, no DOM): the Worker's page metadata, the builder
 * and the verifier all read it, so every path points at an image that exists.
 */
import { letterSlug } from './hgab-letter';

export const OG_DIR = 'hgab/2027/og';
export const OG_HOST = 'https://budget-assets.bettergov.ph';
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export type OgPageKey =
  | 'overview' | 'explainer' | 'dpwh' | 'fmr' | 'hfep' | 'nia'
  | 'districts' | 'leaderboard' | 'letter' | 'sources' | 'methodology';

/** Section pages and the paths that show each image (record pages show their program's). */
export const OG_PAGES: ReadonlyArray<{ key: OgPageKey; paths: readonly string[] }> = [
  { key: 'overview', paths: ['/hgab', '/hgab/2027', '/hgab/2027/overview'] },
  { key: 'explainer', paths: ['/hgab/2027/intro'] },
  { key: 'dpwh', paths: ['/hgab/2027/dpwh'] },
  { key: 'fmr', paths: ['/hgab/2027/fmr'] },
  { key: 'hfep', paths: ['/hgab/2027/hfep'] },
  { key: 'nia', paths: ['/hgab/2027/nia'] },
  { key: 'districts', paths: ['/hgab/2027/districts'] },
  { key: 'leaderboard', paths: ['/hgab/2027/leaderboard'] },
  { key: 'letter', paths: ['/hgab/2027/letter'] },
  { key: 'sources', paths: ['/hgab/2027/sources'] },
  { key: 'methodology', paths: ['/hgab/2027/methodology'] },
];

const PROGRAMS = ['dpwh', 'fmr', 'hfep', 'nia'] as const;

export function ogPageKey(key: OgPageKey): string {
  return `${OG_DIR}/${key}.png`;
}
export function ogDistrictKey(districtId: string): string {
  return `${OG_DIR}/districts/${letterSlug(districtId)}.png`;
}
export function ogLetterKey(slug: string): string {
  return `${OG_DIR}/letters/${slug}.png`;
}
export function ogUrl(key: string): string {
  return `${OG_HOST}/${key}`;
}

/**
 * A letter's slug back to its district id: "lapu-lapu-city-lone" →
 * "leg:lapu-lapu-city:lone" (the district part never has a hyphen; the
 * builder checks the round trip for every district). Null for anything that
 * is not slug-shaped.
 */
export function districtIdFromSlug(slug: string): string | null {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(slug)) return null;
  return `leg:${slug.replace(/-([^-]+)$/, ':$1')}`;
}

/** The district id in a `/hgab/2027/districts/:id` path segment, or null. */
function districtIdOfSegment(segment: string): string | null {
  let id: string;
  try {
    id = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return /^leg:[a-z0-9-]+:[a-z0-9]+$/.test(id) ? id : null;
}

/** The data-host key of a path's link-preview image, or null when the path has none of its own. */
export function ogImageKey(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  const page = OG_PAGES.find((x) => x.paths.includes(p));
  if (page) return ogPageKey(page.key);
  const record = /^\/hgab\/2027\/([a-z]+)\/p\/[^/]+$/.exec(p);
  if (record && (PROGRAMS as readonly string[]).includes(record[1])) return ogPageKey(record[1] as OgPageKey);
  const district = /^\/hgab\/2027\/districts\/([^/]+)$/.exec(p);
  if (district) {
    const id = districtIdOfSegment(district[1]);
    return id ? ogDistrictKey(id) : null;
  }
  const letter = /^\/hgab\/2027\/letter\/([a-z0-9-]+)$/.exec(p);
  if (letter && districtIdFromSlug(letter[1])) return ogLetterKey(letter[1]);
  return null;
}
