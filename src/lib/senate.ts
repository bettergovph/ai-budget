/**
 * The FY2027 Senate committee report section (`/senate/2027`): the Senate Committee on Finance's report on
 * House Bill 10858, against the House bill it amends, with the NEP alongside for reference.
 *
 * Data: `npm run build:senate-cr` parses the report's PDFs and builds `data/senate/2027/` (R2 `senate/2027/`):
 *   overview.json          whole-bill totals, the four programs, counts, the report's documents
 *   departments.json       the General Summary by department and agency (pesos)
 *   lines/<dept id>.json   Annex A: what the Senate changed in one department, line by line
 *   explorer/<dept id>.json  the Senate amount of every House bill explorer line that changed
 *   <program>/projects.parquet, summary.json  every House project with its Senate amount, plus insertions
 *   provisions.json        Annex B: amendments to the special and general provisions
 *   pdf/<key>.pdf          the report itself, for page links
 * Docs: docs/senate-cr-2027.md. Integer pesos throughout; "Senate" means the committee report, not a
 * passed Senate bill.
 */
import { dataUrl } from './data-url';
import { shortPhp } from './format';
import { cached, getJson, type DatasetKey } from './hgab';
import { HUB_VIEWS } from './hgab-ui';

export const SENATE_YEAR = 2027;
export const SENATE_BASE = `senate/${SENATE_YEAR}`;
export const SENATE_ROOT = `/senate/${SENATE_YEAR}`;
export const SENATE_EXPLORER_ROOT = `${SENATE_ROOT}/explorer`;
export const SENATE_PROVISIONS_ROOT = `${SENATE_ROOT}/provisions`;
/** The downloadable dataset: files, checksums, the source PDFs and the build's checks (build_downloads.py). */
export const SENATE_DATA_ROOT = `${SENATE_ROOT}/data`;

/**
 * Nothing here has been reviewed by a person yet. While true, every Senate page and the Senate column on the
 * House bill pages carry the "Under citizen review" banner. Set false once the maintainer says it is reviewed.
 */
export const SENATE_UNDER_REVIEW = true;

/** What the section calls the document, in reader copy. */
export const SENATE_DOC = {
  short: 'Senate',
  label: 'Senate committee report',
  long: "Senate Finance Committee's report on House Bill 10858",
  plain:
    "The Senate Committee on Finance's amendments to the House bill. The Senate still votes on it, and both chambers then settle one text in the bicameral conference.",
};

export function senatePdfUrl(docKey: string, page?: number | null): string {
  const base = dataUrl(`${SENATE_BASE}/pdf/${docKey}.pdf`);
  return page ? `${base}#page=${page}` : base;
}

export const SENATE_PROGRAMS: readonly DatasetKey[] = ['dpwh', 'fmr', 'hfep', 'nia'];

/** A program's views, named as the House bill section's (HUB_VIEWS); the Senate pages have no map or readings. */
// No "Changes" view: the project lists filter by change (2026-11-21).
export const SENATE_PROGRAM_VIEWS = HUB_VIEWS.filter((v) => v.key === 'overview' || v.key === 'projects');

export function senateProgramPath(key: DatasetKey, view?: string): string {
  return view && view !== 'overview' ? `${SENATE_ROOT}/${key}?view=${view}` : `${SENATE_ROOT}/${key}`;
}

/**
 * The program's project list filtered to one value. The DPWH list is the reviewer's, so it reads the reviewer's
 * steps (`s=region:Region I`) and `sv=` for the Senate status; the other three read `status=`, `region=`, ….
 */
export function senateListPath(key: DatasetKey, param: 'status' | 'region' | 'office' | 'program' | 'pap', value: string): string {
  const base = senateProgramPath(key, 'projects');
  if (key !== 'dpwh') return `${base}&${param}=${encodeURIComponent(value)}`;
  if (param === 'status') return `${base}&sv=${encodeURIComponent(value)}`;
  return `${base}&s=${encodeURIComponent(`${param === 'pap' ? 'program' : param}:${value}`)}`;
}

export function senateRecordPath(key: DatasetKey, id: string): string {
  return `${SENATE_ROOT}/${key}/p/${encodeURIComponent(id)}`;
}

export function senateExplorerPath(deptId?: string): string {
  return deptId ? `${SENATE_EXPLORER_ROOT}/${deptId}` : SENATE_EXPLORER_ROOT;
}

/** Absolute URL of a program's Senate project parquet (for DuckDB-Wasm). */
export function senateProjectsUrl(key: DatasetKey): string {
  const u = dataUrl(`${SENATE_BASE}/${key}/projects.parquet`);
  return u.startsWith('http') ? u : `${window.location.origin}${u}`;
}

// ---------------------------------------------------------------------------
// Status of a project in the committee report
// ---------------------------------------------------------------------------

export type SenateStatus = 'cut' | 'reduced' | 'raised' | 'added' | 'renamed' | 'unchanged' | 'nep_only';
export const SENATE_STATUS_ORDER: readonly SenateStatus[] = ['cut', 'reduced', 'raised', 'added', 'renamed', 'unchanged', 'nep_only'];

export const SENATE_STATUS: Record<SenateStatus, { label: string; plural: string; help: string; tone: string }> = {
  cut: {
    label: 'Removed', plural: 'removed', tone: 'var(--negative)',
    help: 'In the House bill; the Senate committee report removes it (no budget).',
  },
  reduced: {
    label: 'Reduced', plural: 'reduced', tone: '#b06a12',
    help: 'In both, with a smaller budget in the Senate committee report.',
  },
  raised: {
    label: 'Raised', plural: 'raised', tone: 'var(--positive)',
    help: 'In both, with a bigger budget in the Senate committee report.',
  },
  added: {
    label: 'Inserted', plural: 'inserted by the Senate', tone: '#2f6fb3',
    help: 'Not in the House bill; the Senate committee report inserts it. Some revise a House project it removes (a corrected name or new coordinates).',
  },
  renamed: {
    label: 'Renamed', plural: 'renamed', tone: '#6b5bb3',
    help: 'Same amount; the Senate committee report gives it a revised name, usually with stations, coordinates or corrected place names.',
  },
  unchanged: {
    label: 'Unchanged', plural: 'unchanged', tone: 'var(--ink-3)',
    help: 'Not listed in the Senate committee report, so the same as in the House bill.',
  },
  nep_only: {
    label: 'NEP only', plural: 'in the NEP only', tone: '#8a8a8a',
    help: 'In the NEP, with no matching line in the House bill (a deletion candidate on the House bill pages), so not in the Senate committee report either.',
  },
};

// ---------------------------------------------------------------------------
// Data files
// ---------------------------------------------------------------------------

export interface SenateAmounts {
  house: number | null;
  increase: number | null;
  decrease: number | null;
  net: number | null;
  senate: number | null;
}

export interface SenateDocument { key: string; title: string; file: string; sha256: string }

export interface SenateProgramRow {
  key: DatasetKey;
  label: string;
  agency: string;
  house_php: number;
  senate_php: number;
  change_php: number;
  nep_php: number;
  status: Partial<Record<SenateStatus, { count: number; nep_php: number; house_php: number; senate_php: number }>>;
}

export interface SenateOverview {
  fiscal_year: number;
  built_at: string;
  report: { title: string; committee: string; prepared: string };
  totals: Record<string, SenateAmounts>;
  programs: SenateProgramRow[];
  departments_changed: number;
  departments: number;
  annex_a: Record<string, number>;
  provisions: number;
  documents: SenateDocument[];
  biggest: Array<{ id: string; name: string; net: number; nep: number | null; house: number; senate: number }>;
}

export interface SenateAgency extends SenateAmounts { no: string; name: string }
export interface SenateDept extends SenateAmounts {
  /** The NEP's new appropriations for the department (from the House bill explorer's matching). */
  nep: number | null;
  roman: string | null;
  name: string;
  id: string | null;
  agencies: SenateAgency[];
  changed_rows: number;
}
export interface SenateDepartments { built_at: string; totals: Record<string, SenateAmounts>; departments: SenateDept[] }

/** One Annex A row: an amount the Senate changes, or inserts, in the House bill. */
export interface SenateLineRow extends SenateAmounts {
  /** The NEP amount of the House bill line the row cites, when the line is matched and the NEP has it. */
  nep: number | null;
  agency: string | null;
  agency_no: string | null;
  kind: 'class' | 'object';
  context: string;
  label: string;
  deleted: boolean;
  instruction: string | null;
  /** exact | exact_nearby | new_class | new | unmatched | ref_only | no_hb_table */
  status: string;
  /** House bill: [document key, PDF page, printed page, cited line(s)]. */
  hb: [string | null, number | null, number | null, string | null];
  hb_label: string | null;
  hb_path: string | null;
  senate_page: number;
}
export interface SenateLines { id: string; roman: string; name: string; rows: SenateLineRow[] }

/** The Senate amount of the House bill explorer's lines, for one department. */
export interface SenateExplorerDept {
  id: string;
  roman: string;
  house: number;
  senate: number | null;
  agencies: Record<string, { house: number; senate: number | null; lines_delta: number; above: number; new_lines: number | null }>;
  /** "<doc>:<pdf page>:<line>:<class>" -> Senate pesos, for lines whose amount changes. */
  lines: Record<string, number>;
  /** Lines under a heading the Senate changes, whose own amount the report does not give. */
  above: string[];
}

export interface SenateProject {
  id: string;
  house_id: string | null;
  status: SenateStatus;
  title: string;
  hb_title: string | null;
  renamed: boolean;
  region: string | null;
  office: string | null;
  program: string | null;
  pap: string | null;
  nep_php: number | null;
  house_php: number | null;
  senate_php: number;
  change_php: number;
  replaces_id: string | null;
  house_doc: string | null;
  house_page: number | null;
  nep_doc: string | null;
  nep_page: number | null;
  senate_doc: string;
  senate_page: number | null;
}

export interface SenateDimRow { label: string; nep_php: number; house_php: number; senate_php: number; count: number; changed: number }

export interface SenateProgramSummary {
  key: DatasetKey;
  label: string;
  agency: string;
  built_at: string;
  house_php: number;
  senate_php: number;
  change_php: number;
  nep_php: number;
  status: SenateProgramRow['status'];
  regions: SenateDimRow[];
  programs: SenateDimRow[];
  offices: SenateDimRow[] | null;
  top: Partial<Record<SenateStatus, Array<Pick<SenateProject, 'id' | 'house_id' | 'title' | 'hb_title' | 'region' | 'office' | 'nep_php' | 'house_php' | 'senate_php' | 'change_php' | 'status' | 'senate_page'>>>>;
  senate_doc: string;
}

export interface SenateProvision {
  part: 'special' | 'general';
  dept: string | null;
  agency: string | null;
  volume: string | null;
  hb_page: number | null;
  line_ref: string;
  instruction: string;
  amended_text: string;
  senate_pdf_page: number;
  dept_id: string | null;
  hb_doc: string | null;
  /** The House bill PDF page of `hb_page`. */
  hb_pdf_page: number | null;
}

const get = <T,>(p: string, what: string) => getJson<T>(dataUrl(`${SENATE_BASE}/${p}`), `Could not load ${what}`);

export interface SenateDownloadFile { file: string; bytes: number; sha256: string; url: string }
export interface SenateDownloadCheck { check: string; ours: number | string; printed: number | string; difference: number | null; ok: boolean; source: string; note: string }
export interface SenateDownloads {
  title: string;
  built_at: string;
  source_commit: string | null;
  sources: Array<{ key: string; title: string; original_file: string; sha256: string; bytes: number; url: string }>;
  tables: Array<{ name: string; about: string; rows: number; columns: string[] }>;
  checks: { run: number; passed: number; file: string };
  under_citizen_review: boolean;
  files: SenateDownloadFile[];
  check_rows: SenateDownloadCheck[];
}
export const loadSenateDownloads = () => cached('senate:downloads', () => get<SenateDownloads>('downloads/index.json', 'the Senate dataset'));

export const loadSenateOverview = () => cached('senate:overview', () => get<SenateOverview>('overview.json', 'the Senate committee report overview'));
export const loadSenateDepartments = () =>
  cached('senate:departments', () => get<SenateDepartments>('departments.json', 'the Senate committee report by department'));
export const loadSenateLines = (id: string) =>
  cached(`senate:lines:${id}`, () => get<SenateLines>(`lines/${id}.json`, "this department's Senate changes"));
export const loadSenateExplorer = (id: string) =>
  cached(`senate:explorer:${id}`, () => get<SenateExplorerDept>(`explorer/${id}.json`, "this department's Senate amounts"));
export const loadSenateProgram = (key: DatasetKey) =>
  cached(`senate:program:${key}`, () => get<SenateProgramSummary>(`${key}/summary.json`, "this program's Senate summary"));
export const loadSenateProvisions = () =>
  cached('senate:provisions', () => get<{ built_at: string; amendments: SenateProvision[] }>('provisions.json', 'the Senate amendments to provisions'));

/** The explorer's key for a House bill line: document, PDF page, line, expense class. */
export function lineKey(p: [string, number, number, number] | undefined, e: string): string | null {
  return p ? `${p[0]}:${p[1]}:${p[3]}:${e}` : null;
}

/** A Senate lookup for the explorer tree: the Senate amount of a line, or null when the report doesn't give it. */
export interface SenateLookup {
  value: (p: [string, number, number, number] | undefined, e: string, house: number) => number | null;
}

export function senateLookup(d: SenateExplorerDept): SenateLookup {
  const above = new Set(d.above);
  return {
    value(p, e, house) {
      const k = lineKey(p, e);
      if (!k) return house;
      if (k in d.lines) return d.lines[k];
      return above.has(k) ? null : house;
    },
  };
}

/** "Committee report" figures by program, in the order the section lists them. */
export const PROGRAM_SHORT: Record<DatasetKey, string> = {
  dpwh: 'DPWH', fmr: 'Farm-to-market roads', hfep: 'Health facilities', nia: 'Irrigation',
};

/** Where readers report a wrong Senate figure: this repo's issues, with the page filled in. */
export function senateReportUrl(page: string): string {
  const body = [`Page: ${page}`, '', 'The line or project:', '', 'What is wrong:', '',
    'What the Senate committee report shows, with its annex and page:', ''].join('\n');
  return `https://github.com/bettergovph/ai-budget/issues/new?${new URLSearchParams({ title: 'Senate report: ', body })}`;
}

/** Program key from a route parameter, or null. */
export function programKey(v: string | undefined): DatasetKey | null {
  return SENATE_PROGRAMS.includes(v as DatasetKey) ? (v as DatasetKey) : null;
}

/** A project row from DuckDB (BIGINT arrives as bigint) as plain numbers. */
export function coerceSenateProject(r: Record<string, unknown>): SenateProject {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    ...(r as unknown as SenateProject),
    nep_php: num(r.nep_php), house_php: num(r.house_php), senate_php: Number(r.senate_php ?? 0), change_php: Number(r.change_php ?? 0),
    house_page: num(r.house_page), nep_page: num(r.nep_page), senate_page: num(r.senate_page),
  };
}

/** "+1.2B", "−340.5M", "0"; null when either side is missing. */
export function signedShort(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v === 0) return '0';
  return `${v > 0 ? '+' : '−'}${shortPhp(Math.abs(v))}`;
}

/** "+12.3%" of a base; empty when there is no base to divide by. */
export function signedPctText(v: number | null | undefined, base: number | null | undefined): string {
  if (v == null || !base) return '';
  const p = (v / base) * 100;
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(1)}%`;
}

/** A KPI cell for the Senate committee report minus a base (the House bill or the NEP): amount, percent. */
export function changeKpi(label: string, senate: number | null | undefined, base: number | null | undefined, what: string) {
  const v = senate != null && base != null ? senate - base : null;
  const pct = signedPctText(v, base);
  return {
    label,
    value: signedShort(v),
    tone: v ? (v > 0 ? ('up' as const) : ('down' as const)) : undefined,
    sub: `${pct ? `${pct} · ` : ''}Senate minus ${what}`,
  };
}
