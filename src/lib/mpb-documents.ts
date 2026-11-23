/**
 * "Multi-purpose buildings or classrooms?" (`/gaa/multi-purpose/documents`, Multi-purpose buildings menu): what the
 * House bill's multi-purpose building projects are, read from their own documents. Jason (2026-11-15): "From the
 * extracted Senate document data from the pdfs, I need a new tally for the MPBs and their projects. Create a new page
 * under multi-purpose buildings for their breakdown."
 *
 * The projects: the multi-purpose building lines the House inserted into the 2027 House bill, those with no matching NEP
 * line (the map's lines, mpb-years/lines.json, class house_only; Jason, 2026-11-15: "We read the documents of 2,066*
 * multi-purpose projects inserted by the house … we need to include the total house insertions"). The reading:
 * one record per project from the redacted Senate copies of its DPWH documents (BP 202 project profile, program of
 * work, plans, certifications, geotagged photos), filled by a language model that quotes the documents
 * (scripts/senate-extract/extract_projects.py on branch senate-redact; docs/hgab-mpb-documents.md). No personal names
 * are read. Data: `mpb-documents/` (npm run build:mpb-documents). Pure.
 */
export const MPB_DOCS_ROOT = '/gaa/multi-purpose/documents';
export const MPB_DOCS_TITLE = 'Multi-purpose buildings or classrooms?';
const BASE = 'hgab/2027/mpb-documents';
export const MPB_DOCS_SUMMARY_PATH = `${BASE}/summary.json`;
export const MPB_DOCS_PROJECTS_PATH = `${BASE}/projects.json`;
export const MPB_DOCS_CSV_PATH = `${BASE}/projects.csv`;
export const MPB_DOCS_CSV_NAME = 'bettergov-multi-purpose-buildings-2027-what-the-documents-say.csv';
export const mpbDocsCsvPath = (s: Pick<MpbDocsSummary, 'outputs'>) => `${MPB_DOCS_CSV_PATH}?v=${s.outputs['projects.csv'].sha256.slice(0, 12)}`;

/** What the documents say will be built: the reading's categories, in this order on the page. */
export const MPB_DOC_CATEGORIES = [
  'multi-purpose hall', 'covered court or gym', 'barangay hall or government office', 'evacuation center',
  'health facility', 'senior citizens or day care center', 'classroom or school building', 'other school facility',
  'market or commercial', 'road', 'bridge', 'flood control or drainage', 'water supply or sanitation', 'other building',
  'other', 'unclear',
] as const;
export type MpbDocCategory = (typeof MPB_DOC_CATEGORIES)[number];

/** Reader labels, capitalised; "classroom or school building" is the one the page asks about. */
export const CATEGORY_LABEL: Record<MpbDocCategory, string> = {
  'multi-purpose hall': 'Multi-purpose hall',
  'covered court or gym': 'Covered court or gym',
  'barangay hall or government office': 'Barangay hall or government office',
  'evacuation center': 'Evacuation center',
  'health facility': 'Health facility',
  'senior citizens or day care center': 'Senior citizens or day care center',
  'classroom or school building': 'Classroom or school building',
  'other school facility': 'Other school facility',
  'market or commercial': 'Market or commercial',
  road: 'Road',
  bridge: 'Bridge',
  'flood control or drainage': 'Flood control or drainage',
  'water supply or sanitation': 'Water supply or sanitation',
  'other building': 'Other building',
  other: 'Other',
  unclear: 'Unclear',
};

export type YesNo = 'yes' | 'no' | 'unclear';
export type MismatchKind = 'different facility' | 'location or office' | 'amount' | 'detail';
export const MISMATCH_LABEL: Record<MismatchKind, string> = {
  'different facility': 'A different facility from the title',
  'location or office': 'Another place or DPWH office',
  amount: 'Another amount',
  detail: 'A minor detail (wording, spelling)',
};

export interface Tally { lines: number; php: number }
/** A stage of the projects: its lines and amount, its House insertions, and its projects' Senate files. */
export interface Stage extends Tally { insertions: Tally; files: number }

export interface MpbDocsSummary {
  schema: 1;
  built_at: string;
  /** The reading: its file, when it was written, the model and schema it used. */
  source: { file: string; sha256: string; records_written: string; model: string; schema_version: number; records: number };
  /**
   * Which projects (Jason, 2026-11-15: "Be clear of the 2066. Are they MPBs? Also include the total number of insertions,
   * documents"; then "add a disclaimer with available documents"). Each stage with its Senate files.
   */
  coverage: {
    /**
     * Every DPWH project line the House inserted, of any kind (the comparison's House-only, fuzzy and ambiguous traces;
     * overview.json's 6,193; Jason, 2026-11-15: "Our other data says 6000+ insertions though"), with and without documents.
     */
    dpwh: { insertions: Tally; with_documents: Tally & { files: number }; without_documents: Tally };
    /** The House bill's multi-purpose building lines (the map's), with the House insertions among them. */
    house: Stage;
    /** The House insertions: multi-purpose building lines with no matching NEP line. The tally's projects. */
    insertions: Stage;
    /** Insertions with Senate copies of their documents. */
    with_documents: Stage;
    /** Insertions with no documents in the Senate's copies. */
    without_documents: Tally;
    /** Insertions whose documents were read (a record): the tally. */
    read: Stage;
    /** Lines read that are in the NEP too (not insertions): left out of the tally. */
    read_not_inserted: Tally;
  };
  /** How the House bill lists the projects read as multi-purpose buildings (the map's rule). */
  listed: { line_and_title: number; line_only: number; title_only: number };
  /** The documents read for the projects read, by kind (BP 202, POW, …), and their total. */
  documents_read: { total: number; by_kind: Record<string, number> };
  categories: Array<{ key: MpbDocCategory } & Tally & { at_school: number }>;
  classroom: Record<YesNo, Tally>;
  at_school: Record<YesNo, Tally>;
  mismatch: Array<{ key: MismatchKind } & Tally>;
  confidence: Record<'high' | 'medium' | 'low', number>;
  checks: Array<{ key: string; ok: boolean; detail: string }>;
  outputs: Record<'projects.json' | 'projects.csv', { sha256: string; bytes: number }>;
  /**
   * The Senate committee report on the projects read (Jason, 2026-11-23: "we need to add the senate committee report
   * across pages"), from mpb-years/senate.json: those it keeps (at its amounts) and cuts to ₱0 (at their House bill
   * amounts), in all, by kind and for the classrooms.
   */
  senate: {
    source: { file: string; sha256: string; built_at: string };
    kept: Tally;
    cut: Tally;
    by_category: Array<{ key: MpbDocCategory; kept: Tally; cut: Tally }>;
    classroom: { kept: Tally; cut: Tally };
  };
}

/** projects.json: one row per project read, in `cols` order (trailing nulls dropped). */
export const MPB_DOCS_COLS = [
  'id', 'title', 'php', 'office', 'region', 'category', 'facility', 'at_school', 'classroom', 'mismatch', 'mismatch_note',
  'storeys', 'classrooms', 'floor_area_sqm', 'purpose', 'description', 'cost_php', 'documents', 'confidence',
  'quote_facility', 'quote_purpose', 'barangay', 'municipality', 'province', 'site_name', 'inserted', 'files',
  'senate_report_php', 'senate_report_status',
] as const;
export interface MpbDocsProjectsFile { schema: 1; built_at: string; cols: typeof MPB_DOCS_COLS; rows: unknown[][] }

export interface MpbDocProject {
  /** The comparison row id (`house-reading:N`): the record page and the reviewer key on it. */
  id: string;
  title: string;
  php: number;
  office: string | null;
  region: string | null;
  category: MpbDocCategory;
  facility: string | null;
  atSchool: YesNo;
  classroom: YesNo;
  mismatch: MismatchKind | null;
  mismatchNote: string | null;
  storeys: number | null;
  classrooms: number | null;
  floorAreaSqm: number | null;
  purpose: string | null;
  description: string | null;
  costPhp: number | null;
  documents: string[];
  confidence: 'high' | 'medium' | 'low' | null;
  quoteFacility: string | null;
  quotePurpose: string | null;
  place: string;
  siteName: string | null;
  /** A House insertion: no matching line in the NEP. */
  inserted: boolean;
  /** The project's Senate files. */
  files: number;
  /** The Senate committee report's amount (0 when it cuts the project) and status (unchanged, renamed, cut, reduced). */
  senateReportPhp: number | null;
  senateReportStatus: string | null;
  search: string;
}

export function decodeMpbDocProjects(f: MpbDocsProjectsFile): MpbDocProject[] {
  const c = Object.fromEntries(f.cols.map((k, i) => [k, i])) as Record<string, number>;
  const at = <T,>(r: unknown[], k: string) => ((r.length > c[k] ? r[c[k]] : null) ?? null) as T;
  return f.rows.map((r) => {
    const place = [at<string | null>(r, 'barangay'), at<string | null>(r, 'municipality'), at<string | null>(r, 'province')].filter(Boolean).join(', ');
    const p: MpbDocProject = {
      id: at(r, 'id'), title: at(r, 'title'), php: at(r, 'php'), office: at(r, 'office'), region: at(r, 'region'),
      category: at(r, 'category'), facility: at(r, 'facility'), atSchool: at(r, 'at_school'), classroom: at(r, 'classroom'),
      mismatch: at(r, 'mismatch'), mismatchNote: at(r, 'mismatch_note'), storeys: at(r, 'storeys'), classrooms: at(r, 'classrooms'),
      floorAreaSqm: at(r, 'floor_area_sqm'), purpose: at(r, 'purpose'), description: at(r, 'description'), costPhp: at(r, 'cost_php'),
      documents: at<string[] | null>(r, 'documents') ?? [], confidence: at(r, 'confidence'), quoteFacility: at(r, 'quote_facility'),
      quotePurpose: at(r, 'quote_purpose'), place, siteName: at(r, 'site_name'), inserted: at(r, 'inserted') === 1,
      files: at<number | null>(r, 'files') ?? 0, senateReportPhp: at(r, 'senate_report_php'), senateReportStatus: at(r, 'senate_report_status'), search: '',
    };
    p.search = [p.title, p.facility, p.office, p.region, place, p.siteName, CATEGORY_LABEL[p.category]].filter(Boolean).join(' ').toLowerCase();
    return p;
  });
}

/** The two figures every page and poster leads with: classrooms among the projects read. */
export function classroomShare(s: MpbDocsSummary): { lines: number; php: number; of: Tally } {
  return { ...s.classroom.yes, of: s.coverage.read };
}
