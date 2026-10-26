/**
 * Which House document, and which page of it, a figure links to. One rule for
 * the pages, the public API, the MCP tools and the verifier.
 *
 * Pure on purpose (type-only imports, no `import.meta.env`) so scripts can
 * import it: `scripts/verify-hgab.ts` checks every House amount against the
 * page this module says the site opens.
 *
 * The importer records two facts per dataset in `documents` (see
 * `HgabDatasetDocuments`):
 *   - `controls`: the House document each reading's program totals are
 *     published in. DPWH's program totals sit with its project list in
 *     Volume I-C; the farm-to-market road, health facility and irrigation
 *     lists, with their totals, are in Volume I-B.
 *   - `same_pages`: the three one-list programs were read from the
 *     second-reading copy of Volume I-B, which the source checked page by page
 *     against the third-reading copy (every list page identical). Their rows
 *     and totals link to the third-reading copy, the one published on the
 *     Senate Budget Transparency Portal, at the same page; the second-reading
 *     copy stays cited as the copy the lines were read from.
 *
 * Files built before those fields fall back to the first House document of
 * the reading in the dataset's list, which lists the volume with the project
 * list first, so program totals still open the volume they are published in.
 */
import type { ControlRow, HgabDatasetMeta, HgabDocument, ProjectRow } from './hgab';

export type Reading = 2 | 3;
/** The document catalogue; only `key` and `reading` are read. */
type Docs = readonly Pick<HgabDocument, 'key' | 'reading'>[] | null | undefined;
type DatasetDocs = Pick<HgabDatasetMeta, 'documents'>;
type DatasetShown = Pick<HgabDatasetMeta, 'documents' | 'has_readings'>;

/** Where the third-reading volumes of House Bill 10858 are published. */
export const SENATE_BUDGET_PORTAL = {
  name: 'Senate Budget Transparency Portal',
  short: 'Senate portal',
  host: 'budget-transparency-portal.senate.gov.ph',
  /** Its General Appropriations Bill documents for 2027. */
  url: 'https://budget-transparency-portal.senate.gov.ph/public/Documents?gaa_year=2027',
} as const;

/**
 * The third-reading volumes as downloaded from the Senate Budget Transparency
 * Portal (topic "General Appropriations Bill", 2027). Our copies must hash to
 * these; the verifier pins them.
 */
export const SENATE_COPIES: Readonly<Record<string, { volume: string; bytes: number; sha256: string }>> = {
  'hb10858-3r-vol-ib': { volume: 'I-B', bytes: 15_663_076, sha256: '4cc0f17e472d1af380ea6d3972561f6bb241137826fd85ed7e7e70bcd92986b9' },
  'hb10858-3r-vol-ic': { volume: 'I-C', bytes: 9_600_816, sha256: '48cb7a11e391bd4da89d4f47cf39a2eba8fe9bfe636dba101c8284b224ac1b1b' },
};

/** True when a document's `source_url` is the Senate Budget Transparency Portal. */
export function isSenatePortal(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname === SENATE_BUDGET_PORTAL.host;
  } catch {
    return false;
  }
}

/** The reading a House document belongs to: the catalogue's, else the key convention (`-2r-` / `-3r-`). */
export function readingOf(key: string, docs: Docs): Reading | null {
  const d = docs?.find((x) => x.key === key);
  if (d?.reading === 2 || d?.reading === 3) return d.reading;
  const m = /-(2|3)r-/.exec(key);
  return m ? (Number(m[1]) as Reading) : null;
}

/**
 * The first House document of `reading` in the dataset's list. The importer
 * lists the volume with the project list first, so this is where a row of
 * that reading is published; it is the fallback for rows without a `*_doc`.
 */
export function pickHouseDoc(docs: Docs, dataset: DatasetDocs, reading: Reading): string | null {
  return dataset.documents.house.find((k) => readingOf(k, docs) === reading) ?? null;
}

/** The House document a dataset's program totals are published in at `reading`. */
export function controlDoc(docs: Docs, dataset: DatasetDocs, reading: Reading): string | null {
  const recorded = dataset.documents.controls;
  if (recorded) return recorded[reading === 3 ? 'hgab3' : 'hgab2'] ?? null;
  return pickHouseDoc(docs, dataset, reading);
}

/** The latest reading's program-totals document: what a single "House" page link opens. */
export function controlHouseDoc(docs: Docs, dataset: DatasetDocs): { key: string; reading: Reading } | null {
  for (const reading of [3, 2] as const) {
    const key = controlDoc(docs, dataset, reading);
    if (key) return { key, reading };
  }
  return null;
}

export interface HouseCitation {
  reading: Reading;
  /** Null only when no House document is known for the reading. */
  doc: string | null;
  page: number;
  /**
   * `read`: the copy the figure was read from. `same_page`: the third-reading
   * copy of a one-list program, which publishes the same page word for word.
   */
  basis: 'read' | 'same_page';
}

/** The `same_page` citation a second-reading page carries, when the dataset records an identical third-reading copy. */
function samePage(dataset: DatasetDocs, read: HouseCitation | undefined): HouseCitation | null {
  const same = dataset.documents.same_pages;
  if (!same || !read || read.reading !== 2 || read.doc !== same.extracted) return null;
  return { reading: 3, doc: same.third, page: read.page, basis: 'same_page' };
}

/**
 * Every House page a project row can be checked on, second reading first.
 * DPWH rows carry both readings' own pages. One-list rows carry the
 * second-reading page they were read from, plus the third-reading copy at the
 * same page when the dataset records it (`same_pages`). A page can come
 * without an amount (a health-facility column left blank in the House list).
 */
export function houseCitations(
  row: Pick<ProjectRow, 'hgab2_page' | 'hgab3_page' | 'hgab2_doc' | 'hgab3_doc'>,
  dataset: DatasetDocs,
  docs: Docs,
): HouseCitation[] {
  const out: HouseCitation[] = [];
  if (row.hgab2_page) out.push({ reading: 2, doc: row.hgab2_doc ?? pickHouseDoc(docs, dataset, 2), page: row.hgab2_page, basis: 'read' });
  if (row.hgab3_page) {
    out.push({ reading: 3, doc: row.hgab3_doc ?? pickHouseDoc(docs, dataset, 3), page: row.hgab3_page, basis: 'read' });
  } else {
    const same = samePage(dataset, out[0]);
    if (same) out.push(same);
  }
  return out;
}

/**
 * Every House page a program total can be checked on: one per reading with an
 * amount, at each of its `house_pages`, in the document `controlDoc` names.
 */
export function controlCitations(
  c: Pick<ControlRow, 'hgab2_php' | 'hgab3_php' | 'house_pages'>,
  dataset: DatasetDocs,
  docs: Docs,
): HouseCitation[] {
  const same = dataset.documents.same_pages;
  const withAmount = ([2, 3] as const).filter((r) => (r === 2 ? c.hgab2_php : c.hgab3_php) != null);
  // A page with no House amount beside it still opens the latest reading's copy.
  const latest = controlHouseDoc(docs, dataset)?.reading;
  const readings: Reading[] = withAmount.length ? withAmount : latest ? [latest] : [];
  const out: HouseCitation[] = [];
  for (const reading of readings) {
    const doc = controlDoc(docs, dataset, reading);
    const basis = same && reading === 3 && doc === same.third ? 'same_page' : 'read';
    for (const page of c.house_pages ?? []) out.push({ reading, doc, page, basis });
  }
  return out;
}

/**
 * The citations a table cell shows. DPWH publishes two readings that can
 * differ, so both show. The one-list programs publish one list, identical at
 * both readings, so the cell shows the latest reading only; the record page
 * shows both copies.
 */
export function shownCitations(cites: readonly HouseCitation[], dataset: Pick<HgabDatasetMeta, 'has_readings'>): HouseCitation[] {
  if (dataset.has_readings || cites.length < 2) return [...cites];
  const latest = Math.max(...cites.map((c) => c.reading));
  return cites.filter((c) => c.reading === latest);
}

/** `shownCitations` over a project row. */
export function shownHouseCitations(
  row: Pick<ProjectRow, 'hgab2_page' | 'hgab3_page' | 'hgab2_doc' | 'hgab3_doc'>,
  dataset: DatasetShown,
  docs: Docs,
): HouseCitation[] {
  return shownCitations(houseCitations(row, dataset, docs), dataset);
}
