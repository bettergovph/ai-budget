/**
 * The House bill explorer (`/hgab/2027/explorer`): every money line of HB 10858 (3rd reading)
 * outside the DPWH project detail, against the NEP, line by line.
 *
 * Built by `scripts/hgab-lines/build_explorer.py` from the line-by-line comparison
 * (`docs/hgab-non-infra-lines.md`) into `data/hgab/2027/explorer/`:
 *   index.json     totals, status counts, one row per department
 *   d/<id>.json    one department: agencies, each with the bill's own hierarchy down to lines
 *
 * Integer pesos. NEP amounts are the NEP's new appropriations (the same universe as the bill's
 * programmed total). Statuses are candidates, like everywhere else in the section.
 */
import { dataUrl } from './data-url';
import { HGAB_BASE, HGAB_ROOT, cached, getJson, pdfUrl } from './hgab';

export const EXPLORER_ROOT = `${HGAB_ROOT}/explorer`;
const BASE = `${HGAB_BASE}/explorer`;

/**
 * The whole-bill lines went live before a full review. While true, every line-by-line page, the
 * downloads and the whole-bill boards carry the "Under citizen review" banner. Set false once reviewed.
 */
export const LINES_UNDER_REVIEW = true;

/** Where readers report a wrong line: this repo's issues, with the page they were on filled in. */
export function reportLineUrl(page: string): string {
  const body = [
    `Page: ${page}`, '',
    'The line (agency, program or activity, region or office, expense class):', '',
    'What is wrong:', '',
    'What the House bill or the NEP shows, with its page:', '',
  ].join('\n');
  return `https://github.com/bettergovph/ai-budget/issues/new?${new URLSearchParams({ title: 'Line by line: ', body })}`;
}

export type LineStatus = 'same' | 'higher' | 'lower' | 'house_only' | 'nep_only' | 'unprogrammed';

/** One line: an expense class at the deepest level the bill lists. */
export interface ExLine {
  /** UACS expense class: 1 personnel, 2 maintenance and operating, 3 financial, 6 capital. */
  e: '1' | '2' | '3' | '6';
  n: number;
  h: number;
  s: LineStatus;
  /** Published page: [document key, PDF page, page number shown on the page, line]. */
  p?: [string, number, number, number];
  /** From the DepEd non-implementing-schools list (Vol I-B), not the main table. */
  a?: 1;
  /** Infrastructure covered in depth by the program pages. */
  z?: 'dpwh' | 'nia' | 'fmr' | 'hfep';
  /** How a near-but-not-exact name was paired. */
  m?: string;
}

export type NodeKind =
  | 'section' | 'kind' | 'class' | 'program' | 'subprogram' | 'activity'
  | 'region' | 'office' | 'unit' | 'fund' | 'group';

export interface ExNode {
  k: NodeKind;
  l: string;
  n: number;
  h: number;
  c?: ExNode[];
  x?: ExLine[];
}

export interface ExAgency {
  id: string;
  no: string | null;
  name: string;
  nep_name: string | null;
  nep_code: string | null;
  nep: number;
  house: number;
  lines: number;
  status: Partial<Record<LineStatus, number>>;
  tree: ExNode[];
}

export interface ExDept {
  id: string;
  roman: string;
  name: string;
  nep: number;
  house: number;
  lines: number;
  agencies: ExAgency[];
}

export interface ExIndexRow {
  id: string;
  roman: string;
  name: string;
  nep: number;
  house: number;
  lines: number;
  changed: number;
  agencies: number;
  bytes: number;
}

export interface ExIndex {
  built_at: string;
  house_total: number;
  nep_total: number;
  unprogrammed: number;
  lines: number;
  status: Partial<Record<LineStatus, number>>;
  departments: ExIndexRow[];
}

export function loadExplorerIndex(): Promise<ExIndex> {
  return cached('explorer:index', () =>
    getJson<ExIndex>(dataUrl(`${BASE}/index.json`), 'Failed to load the House bill explorer index'));
}

export function loadExplorerDept(id: string): Promise<ExDept> {
  return cached(`explorer:${id}`, () =>
    getJson<ExDept>(dataUrl(`${BASE}/d/${encodeURIComponent(id)}.json`), 'Failed to load this department'));
}

// ---------------------------------------------------------------------------
// The extracted dataset as downloads (explorer/downloads/, scripts/hgab-lines/build_downloads.py)
// ---------------------------------------------------------------------------

export interface DownloadFile { file: string; bytes: number; sha256: string }

export interface DownloadEntry {
  key: string;
  title: string;
  about: string;
  rows: number;
  csv: DownloadFile;
  parquet?: DownloadFile;
  /** Column → what it means (also in README.md). */
  columns: Record<string, string>;
}

export interface DownloadsManifest {
  schema: 1;
  built_at: string;
  pipeline_commit: string;
  notice: string;
  totals: { house_bill_php: number; house_bill_unprogrammed_php: number; nep_php: number; lines: number; lines_vs_nep: number };
  readme: DownloadFile;
  zip: DownloadFile;
  files: DownloadEntry[];
}

export function loadExplorerDownloads(): Promise<DownloadsManifest> {
  return cached('explorer:downloads', () =>
    getJson<DownloadsManifest>(dataUrl(`${BASE}/downloads/manifest.json`), 'Failed to load the list of downloads'));
}

/**
 * Address of one download (R2 in production, public/data in development). Given its manifest entry,
 * `?v=` carries the start of its SHA-256: the CDN caches .csv and .zip under fixed names and keeps
 * their old headers on revalidation, and we cannot purge it, so each rebuild gets its own address.
 */
export function downloadUrl(file: DownloadFile | string): string {
  if (typeof file === 'string') return dataUrl(`${BASE}/downloads/${file}`);
  return `${dataUrl(`${BASE}/downloads/${file.file}`)}?v=${file.sha256.slice(0, 12)}`;
}

/** Every file the manifest lists (zip, README, each CSV and Parquet), by name. */
export function downloadFiles(m: DownloadsManifest): Map<string, DownloadFile> {
  const all = [m.zip, m.readme, ...m.files.flatMap((f) => (f.parquet ? [f.csv, f.parquet] : [f.csv]))];
  return new Map(all.map((f) => [f.file, f]));
}

/** "9.0 MB", "245 KB". */
export function fileSize(bytes: number): string {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

export function explorerPath(deptId?: string): string {
  return deptId ? `${EXPLORER_ROOT}/${deptId}` : EXPLORER_ROOT;
}

export const STATUS_LABEL: Record<LineStatus, { label: string; help: string }> = {
  same: { label: 'Same', help: 'Found in both documents with the same amount.' },
  higher: { label: 'Higher', help: 'Found in both; the House bill carries more than the NEP.' },
  lower: { label: 'Lower', help: 'Found in both; the House bill carries less than the NEP.' },
  house_only: {
    label: 'House bill only',
    help: 'We found no matching line in the NEP. It may be new, or renamed or moved. A candidate, not a finding.',
  },
  nep_only: {
    label: 'NEP only',
    help: 'We found no matching line in the House bill. It may have been dropped, renamed or moved. A candidate.',
  },
  unprogrammed: {
    label: 'Unprogrammed',
    help: 'Unprogrammed appropriations are released only if extra revenue comes in. The NEP data we compare with has no such lines.',
  },
};

export const STATUS_ORDER: readonly LineStatus[] = ['higher', 'lower', 'house_only', 'nep_only', 'same', 'unprogrammed'];

export const EXPENSE_LABEL: Record<ExLine['e'], string> = {
  '1': 'Personnel services',
  '2': 'Maintenance and operating',
  '3': 'Financial expenses',
  '6': 'Capital outlays',
};

export const KIND_LABEL: Partial<Record<NodeKind, string>> = {
  program: 'Program',
  subprogram: 'Sub-program',
  activity: 'Activity or project',
  region: 'Region',
  office: 'Office',
  unit: 'Unit or school',
  fund: 'Fund source',
};

export const SCOPE_NOTE: Record<NonNullable<ExLine['z']>, { label: string; to: string }> = {
  dpwh: { label: 'DPWH projects', to: `${HGAB_ROOT}/dpwh` },
  nia: { label: 'NIA irrigation', to: `${HGAB_ROOT}/nia` },
  fmr: { label: 'Farm-to-market roads', to: `${HGAB_ROOT}/fmr` },
  hfep: { label: 'Health facilities', to: `${HGAB_ROOT}/hfep` },
};

/** Every peso, as published: "₱48,193,049,000". */
export function fullPhp(n: number): string {
  return `${n < 0 ? '−' : ''}₱${Math.abs(n).toLocaleString('en-US')}`;
}

export function linePdf(p: NonNullable<ExLine['p']>): string {
  return pdfUrl(p[0], p[1]);
}

export function volumeName(doc: string): string {
  return doc.endsWith('-ia') ? 'Vol. I-A' : doc.endsWith('-ib') ? 'Vol. I-B' : doc;
}

/** Bill-style capitals ("DEPARTMENT OF HEALTH") read better in title case on screen. */
export function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  const small = new Set(['of', 'the', 'and', 'for', 'in', 'on', 'to', 'a', 'an', 'at', 'by', 'or']);
  return s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.replace(/^([^\p{L}]*)(\p{L})/u, (_, pre, c) => pre + c.toUpperCase())))
    .join('')
    .replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi|Xii|Xiii|Xiv|Afp|Bsgc|Lgus?|Ncr|Barmm|Mmda|Sucs?|Gocc|Nep)\b/g, (m) => m.toUpperCase())
    .replace(/\bLgus\b/gi, 'LGUs');
}

/** Lines under a node, its own and its descendants'. */
export function allLines(node: ExNode): ExLine[] {
  const out: ExLine[] = [];
  const walk = (n: ExNode) => {
    if (n.x) out.push(...n.x);
    n.c?.forEach(walk);
  };
  walk(node);
  return out;
}

/** True if anything under the node is not the same in both documents. */
export function hasChange(node: ExNode): boolean {
  if (node.x?.some((x) => x.s !== 'same')) return true;
  return node.c?.some(hasChange) ?? false;
}

export function statusCounts(node: ExNode): Partial<Record<LineStatus, number>> {
  const c: Partial<Record<LineStatus, number>> = {};
  for (const x of allLines(node)) c[x.s] = (c[x.s] ?? 0) + 1;
  return c;
}

/** Same total in both documents, but the lines under it moved between places. */
export function movedWithin(node: ExNode): boolean {
  return node.n === node.h && node.n > 0 && hasChange(node);
}

export function matchesQuery(node: ExNode, q: string): boolean {
  if (node.l.toLowerCase().includes(q)) return true;
  return node.c?.some((c) => matchesQuery(c, q)) ?? false;
}

/** Flat rows for the CSV download of one agency (or a whole department). */
export function agencyCsvRows(dept: ExDept, agency: ExAgency): Array<Record<string, string | number>> {
  const rows: Array<Record<string, string | number>> = [];
  const walk = (n: ExNode, path: ExNode[]) => {
    const here = [...path, n];
    for (const x of n.x ?? []) {
      const at = (k: NodeKind) => here.find((h) => h.k === k)?.l ?? '';
      rows.push({
        department: dept.name,
        agency: agency.name,
        program: at('program'),
        subprogram: at('subprogram'),
        activity: at('activity') || at('group'),
        region: at('region'),
        office: at('office'),
        unit: at('unit'),
        fund_source: at('fund'),
        expense_class: EXPENSE_LABEL[x.e],
        nep_php: x.n,
        house_bill_php: x.h,
        change_php: x.h - x.n,
        status: STATUS_LABEL[x.s].label,
        house_bill_volume: x.p ? volumeName(x.p[0]) : '',
        house_bill_page: x.p ? x.p[2] : '',
        house_bill_pdf_page: x.p ? x.p[1] : '',
        house_bill_line: x.p ? x.p[3] : '',
        note: [x.a ? 'from the non-implementing schools list' : '', x.m ?? ''].filter(Boolean).join('; '),
      });
    }
    n.c?.forEach((c) => walk(c, here));
  };
  agency.tree.forEach((n) => walk(n, []));
  return rows;
}

export function toCsv(rows: Array<Record<string, string | number>>): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
