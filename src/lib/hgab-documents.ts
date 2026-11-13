/**
 * Supporting documents and review flags for every DPWH project in the FY2027 House bill, keyed by the research
 * site's House bill row ID (`hgabId`). Contract shared by scripts/build-hgab-documents.ts, its verifier and the
 * Review screen. Docs: docs/hgab-documents.md.
 *
 * Sources (research.bettergov.ph "nep-preview" and the Senate file index on R2), snapshotted with their SHA-256:
 *   hgab-document-coverage.json             per row: Proposal document types, Senate files it could tie to the row
 *   flags.json                              per row: review flags with evidence, missing-document flags
 *   dpwh-in-depth-data.json + shards        Proposal records with their DPWH Transparency file links (projects-*),
 *                                           and the research site's first-page title scan of Senate POWs (hgabPowResults-*)
 *   supporting-documents-file-links.jsonl   every Senate-provided file, in folders named 2027DPWH-HGAB-<code>
 *   R4A_FY 2027 DPWH HGAB Tracker and List.xlsx   Region IV-A's own list of folder codes, titles and amounts
 */

export const DOCUMENTS_SCHEMA = 1;
export const DOCUMENTS_DIR = "documents";

/** `HB10858-3-0294-003421` → House Bill 10858, third reading, PDF page 294 of Volume I-C, row 3421 of the bill. */
export const HGAB_ID_RE = /^HB10858-3-(\d{4})-(\d{6})$/;
export function parseHgabId(id: string): { page: number; seq: number } | null {
  const m = HGAB_ID_RE.exec(id);
  return m ? { page: Number(m[1]), seq: Number(m[2]) } : null;
}

/** The five named document types the research site counts; a row is "complete" with at least four. */
export const NAMED_TYPES = ["POW", "BP 202", "Development Council", "Geotagged photos", "Certificate of Implementability"] as const;
export type NamedType = (typeof NAMED_TYPES)[number];
export const COMPLETE_AT = 4;

/**
 * Proposal document types (DPWH Transparency portal labels) that count as a named type, exactly as the research
 * site counts them (reproduced against flags.json for every row). Other labels (MDC, CDC, G.photos, …) don't count.
 */
export const PROPOSAL_TYPE_MAP: Readonly<Record<string, NamedType>> = {
  POW: "POW",
  "BP 202": "BP 202",
  "Certificate of Implementability": "Certificate of Implementability",
  "Geotagged Photos": "Geotagged photos",
  "G.photo": "Geotagged photos",
  PHOTO: "Geotagged photos",
  "Geotegged Photo": "Geotagged photos",
  "RDC Endorsement": "Development Council",
  "PDC Endorsement": "Development Council",
  "LDC Endorsement": "Development Council",
};

/** A Senate-provided file's type from its name, as the research site types them (agrees on 20,646 of 20,647). */
export function senateFileType(name: string): NamedType | "Other" {
  const n = name.replace(/\.[^.]+$/, "").toLowerCase();
  const word = (x: string) => new RegExp(`(?<![a-z0-9])(?:${x})(?![a-z0-9])`);
  if (n.includes("implementability")) return "Certificate of Implementability";
  if (/bp ?-?202/.test(n)) return "BP 202";
  if (/geo ?tag|photo/.test(n)) return "Geotagged photos";
  if (word("rdc|pdc|ldc").test(n) || n.includes("development council")) return "Development Council";
  if (word("pow").test(n) || n.includes("program of work")) return "POW";
  return "Other";
}

export const FOLDER_CODE_RE = /2027DPWH-HGAB-(\d+)/;

/**
 * How a file was tied to a row.
 *   research       Senate folder the research site tied to the row (hgab-document-coverage.json)
 *   pow_title      Senate folder whose program of work names the row on its first page, in the research site's own
 *                  POW scan (dpwh-in-depth hgabPowResults), where the coverage file left the folder untied and the
 *                  row had no Senate files
 *   tracker        Senate folder that Region IV-A's tracker lists with this row's exact title and amount, where no
 *                  POW scan names another row. The tracker swaps some codes (12235/12244), so this is the weakest.
 *   proposal       DPWH Transparency (Proposal) files of the Proposal record the row is paired with, accepted only
 *                  when its file types are exactly the ones the research site lists for the row
 *   reviewed       Senate folder where the coverage file and the tracker disagree, settled by reading the folder's
 *                  POW (FOLDER_REVIEWS)
 *
 * Not used: folder-code sequence. DPWH numbers folders in long runs that keep the bill's order, but a folder placed
 * between two tied folders lands on a neighbouring project in 11 of 59 cases the POW scan can check. Nor the POW
 * scan's relaxed title matches: 12254's says Milagrosa, its POW says Makiling.
 */
export const LINK_METHODS = ["research", "pow_title", "tracker", "reviewed", "proposal"] as const;
export type LinkMethod = (typeof LINK_METHODS)[number];

/**
 * Folders where the coverage file and Region IV-A's tracker name different rows, settled by the place named on the
 * first page of the folder's POW (pdftotext; 12184 is a scan, read with tesseract). Read 2026-11-12. The tracker was
 * right 8 times and the coverage file 7. The builder fails if a dispute appears that isn't settled here.
 */
export const FOLDER_REVIEWS: Readonly<Record<string, { hgabId: string; pow: string }>> = {
  "04113": { hgabId: "HB10858-3-0307-003661", pow: "Revetment along Carmona River, Barangay Cabilang Baybay, Carmona City" },
  "04257": { hgabId: "HB10858-3-0782-013244", pow: "Multi-Purpose Building, Barangay Gatasan, Municipality of Catanauan, Quezon" },
  "11373": { hgabId: "HB10858-3-0424-005936", pow: "Construction of Road, Barangay Caigdal - Barangay San Roque, Unisan, Quezon (₱100M; the bill text runs into the next row)" },
  "11374": { hgabId: "HB10858-3-0424-005937", pow: "Bridge along Barangay San Benito-San Isidro Road, Lipa City (₱160M; the bill text starts on the row before)" },
  "12184": { hgabId: "HB10858-3-0537-008270", pow: "Construction of Slope Protection Structure, Barangay Estrella, Mabini, Batangas (scan)" },
  "12235": { hgabId: "HB10858-3-0543-008425", pow: "Rehabilitation of Road, Barangay Mahabang Kahoy Lejos, Indang, Cavite" },
  "12244": { hgabId: "HB10858-3-0543-008416", pow: "Concreting of Roads at Barangay Mahabang Kahoy Lejos, Indang, Cavite" },
  "12253": { hgabId: "HB10858-3-0546-008478", pow: "Construction of Roads and Drainage at Barangay Banlic, Calamba City, Laguna" },
  "12254": { hgabId: "HB10858-3-0546-008479", pow: "Construction of Road and Drainage at Barangay Makiling, Calamba City, Laguna" },
  "14359": { hgabId: "HB10858-3-0760-012801", pow: "Multi-Purpose Building at Barangay Laiya Aplaya, San Juan, Batangas" },
  "14385": { hgabId: "HB10858-3-0763-012858", pow: "Multi Purpose Building at Gawad Kalinga, Barangay Alapan 2B, Imus, Cavite" },
  "14396": { hgabId: "HB10858-3-0762-012847", pow: "Multi Purpose Building at Country Mile Homes, Barangay Carsadang Bago 2, Imus, Cavite" },
  "14487": { hgabId: "HB10858-3-0772-013037", pow: "Multi-Purpose Building, Barangay 3, Calamba City (not Barangay 3, Malaybalay City)" },
  "14494": { hgabId: "HB10858-3-0772-013044", pow: "Multi-Purpose Building (Covered Court) at Barangay San Antonio, San Pedro City, Laguna" },
  "14506": { hgabId: "HB10858-3-0774-013085", pow: "Multi-Purpose Building, Barangay Banilad, Nagcarlan, Laguna; total estimated cost ₱7,000,000" },
};

/** How a row's Proposal record was found. */
export const PROPOSAL_LINKS = ["pairing", "title"] as const;
export type ProposalLink = (typeof PROPOSAL_LINKS)[number];

/** How a research-site row was tied to one of our DPWH project rows (dpwh/projects.parquet). */
export const JOIN_METHODS = ["exact", "title_cleanup", "merged_duplicate"] as const;
export type JoinMethod = (typeof JOIN_METHODS)[number];

/** Review flags whose label carries an amount ("Allocation decrease: 10,000,000 pesos"): one code, the amount as value. */
export const AMOUNT_FLAG_RE = /^(Allocation (?:increase|decrease)): ([\d,]+) pesos$/;
export function flagCode(label: string): { code: string; value: number | null } {
  const m = AMOUNT_FLAG_RE.exec(label);
  const base = m ? m[1] : label;
  const code = base.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return { code, value: m ? Number(m[2].replace(/,/g, "")) : null };
}

export interface ReviewFlag {
  code: string;
  label: string;
  /** Pesos, for allocation increase and decrease flags. */
  value: number | null;
  /** Deduplicated evidence sentences from the detailed line-item review queue; empty when only the flags overview lists it. */
  evidence: string[];
}

/** One row of documents/projects.parquet. Lists are JSON text in Parquet. */
export interface DocumentProject {
  hgab_id: string;
  project_id: string;
  join_method: JoinMethod;
  page: number;
  seq: number;
  title: string;
  office: string;
  region: string;
  amount_php: number;
  /** Our row's amount; differs only for merged_duplicate rows (the bill lists the same project twice). */
  project_amount_php: number;
  proposal_types: string[];
  proposal_sources: string[];
  proposal_file_records: number;
  /** The DPWH Transparency record whose files are in files.parquet, and how it was found; null when not linked. */
  proposal_code: string | null;
  proposal_link: ProposalLink | null;
  proposal_files: number;
  senate_types: string[];
  senate_folders: string[];
  senate_files: number;
  /** Senate-matched upstream but with no file list it could tie to the row. */
  senate_matched_without_files: boolean;
  /** Named types present after adding our links, Proposal or Senate. */
  named_present: NamedType[];
  named_present_upstream: NamedType[];
  complete: boolean;
  complete_upstream: boolean;
  missing_flags: string[];
  missing_flags_upstream: string[];
  review_flags: ReviewFlag[];
  flags_overview_match: boolean;
  detailed_queue_match: boolean;
  notes: string[];
}

/**
 * One row of documents/files.parquet: a file tied to a row. Senate files are on budget-assets.bettergov.ph with
 * size and SHA-256; Proposal files are DPWH Transparency links on s3.infrawatch.ph, with their portal type.
 */
export interface DocumentFile {
  hgab_id: string;
  project_id: string;
  source: "senate" | "proposal";
  /** Senate folder code (digits of 2027DPWH-HGAB-<code>) or the Proposal code (2027DPWH-Proposal-<n>). */
  folder_code: string;
  file_link_id: number | null;
  /** Named type, or "Other"; for Proposal files, a portal type outside the five named ones stays "Other". */
  doc_type: NamedType | "Other";
  /** The source's own type label (Senate: the research site's; Proposal: the portal's). */
  source_type: string;
  name: string;
  url: string;
  path: string | null;
  bytes: number | null;
  sha256: string | null;
  /** In the folder's archive/ subfolder: an earlier copy the office replaced. */
  archived: boolean;
  link_method: LinkMethod;
}

// ---------------------------------------------------------------------------------------------------------------------
// The reviewer's files: documents/review.json (every row, compact, for the funnel) and documents/detail/<NN>.json
// (each row's files and flag evidence, loaded when a project is opened). Built by build:hgab-documents.
// ---------------------------------------------------------------------------------------------------------------------

export const REVIEW_INDEX_PATH = `${DOCUMENTS_DIR}/review.json`;
/** Rows per detail shard, by bill row (`seq`): shard NN holds seq NN*500 … NN*500+499. */
export const DETAIL_SHARD_ROWS = 500;
export const detailShardPath = (seq: number) => `${DOCUMENTS_DIR}/detail/${String(Math.floor(seq / DETAIL_SHARD_ROWS)).padStart(2, "0")}.json`;

/** How the funnel groups flags. Every flag code must fall in one family (the build fails otherwise). */
export const FLAG_FAMILIES = [
  { key: "documents", label: "Documents", re: /^(missing-|no-listed-|dpwh-transparency-match)/ },
  { key: "nep", label: "NEP comparison", re: /^(potential-nep-insertion|house-bill-only-our-comparison|nep-match-sources-disagree|no-selected-nep-counterpart|nep-counterpart-|within-nep-|implementing-office-changed|allocation-(increase|decrease))/ },
  { key: "cost", label: "Amount and cost", re: /^(repeated-allocation-amount|high-|extreme-|cost-per-meter|uniform-rcs|very-short-)/ },
  { key: "location", label: "Location and map", re: /(map-review|doppelganger|coordinate|mpb-location|mpb-same-|conflicting-deo)/ },
  { key: "history", label: "Repeats and history", re: /^(historical-|mpb-historical|within-hgab-repeat|explicit-historical|rehabilitation-on|road-rehabilitation|bridge-rated)/ },
] as const;
export type FlagFamily = (typeof FLAG_FAMILIES)[number]["key"];
export function flagFamily(code: string): FlagFamily | null {
  return FLAG_FAMILIES.find((f) => f.re.test(code))?.key ?? null;
}
/** Codes of the five missing-document flags we compute (with our links), in NAMED_TYPES order. */
export const missingCode = (t: NamedType) => flagCode(`Missing ${t}`).code;

export interface ReviewIndexFlag {
  code: string;
  /** The research site's label; for allocation increase/decrease, without the amount. */
  label: string;
  family: FlagFamily;
  /** Rows carrying it. */
  n: number;
  /** Ours: a missing-document flag computed with our links (the research site's own count is in `n_upstream`). */
  computed?: boolean;
  n_upstream?: number;
  /** Whose flag: research.bettergov.ph's (absent) or ours ("bettergov": our matching or our NEP comparison). */
  source?: "bettergov";
  /** What our flag means, in a sentence, for the page. */
  note?: string;
}
export interface ReviewIndexOffice {
  name: string;
  /** Legislative districts the office serves (districts.json); empty for the Central and regional offices. */
  districts: string[];
  /** "A" lone, "B" shared, null when no district. */
  tier: "A" | "B" | null;
}
/**
 * Our own NEP comparison beside research.bettergov.ph's flags. Our House bill pages count "in the House bill only"
 * from the analysis workbench (the bridge's House-only group: no NEP pair, a fuzzy match, or an ambiguous one); the
 * research site's "Potential NEP insertion" leaves out rows where its newer matching sees a possible NEP counterpart
 * it can't confirm. Both are candidates; where they disagree, a person should look.
 */
export const HOUSE_ONLY_TRACES: readonly string[] = ["house_only_candidate", "fuzzy_candidate", "ambiguous"];
export const OUR_NEP_FLAGS = {
  houseOnly: {
    code: "house-bill-only-our-comparison",
    label: "In the House bill only (our comparison)",
    note: "Our comparison found no NEP line for this project, or only an uncertain one. Our House bill pages count it as in the House bill only.",
  },
  disagree: {
    code: "nep-match-sources-disagree",
    label: "Sources disagree on the NEP match",
    note: "Our comparison and research.bettergov.ph’s “Potential NEP insertion” disagree on whether this project has an NEP line. Check the NEP by hand.",
  },
} as const;

/**
 * Automatic review: projects so plainly red-flagged that a person need not open them first. The builder applies the
 * rules to every row and writes the result to review.json `auto`; the reviewer shows those projects as
 * "Auto-reviewed: red flag" until a member reviews them, and lets volunteers skip them.
 *
 * The score is provisional. The team has not approved a scoring rubric (workflow step 6 says "no unapproved thresholds
 * or weights"), so there is one rule, at full weight, and the scale is ours to change: score = the sum of the matched
 * rules' weights, capped at 100. Answers in members' reviews will add to it once the team settles the method.
 */
export const AUTO_REVIEW = {
  method: "auto-1",
  status: "red_flag",
  note: "Provisional score: one automatic rule so far; the team has not yet approved a scoring method.",
  rules: [
    {
      code: "no-key-documents",
      label: "No key document found",
      weight: 100,
      team_flags: ["RF-033", "RF-021"],
      note: "None of the five key documents (program of work, BP 202, development council endorsement, geotagged photos, certificate of implementability), and no other file, in the Senate copies or on DPWH Transparency.",
    },
  ],
  /** Score bands for labels; the red-flag status starts at "High". */
  bands: [
    { min: 70, label: "High" },
    { min: 40, label: "Medium" },
    { min: 1, label: "Low" },
  ],
} as const;
export type AutoRuleCode = (typeof AUTO_REVIEW.rules)[number]["code"];
export const autoScore = (rules: readonly AutoRuleCode[]) =>
  Math.min(100, rules.reduce((s, c) => s + (AUTO_REVIEW.rules.find((r) => r.code === c)?.weight ?? 0), 0));
export const scoreBand = (score: number) => AUTO_REVIEW.bands.find((b) => score >= b.min)?.label ?? null;
/** The rules a project meets, from its review.json row: none of the five key documents and no file at all. */
export function autoRules(row: { docs: number; files: number }): AutoRuleCode[] {
  return row.docs === 0 && row.files === 0 ? ["no-key-documents"] : [];
}
/** review.json `auto`: the method, its rules, and each auto-reviewed project's rule indexes and score. */
export interface ReviewIndexAuto {
  method: string;
  status: string;
  note: string;
  rules: { code: string; label: string; weight: number; team_flags: readonly string[]; note: string }[];
  bands: { min: number; label: string }[];
  rows: Record<string, { r: number[]; s: number }>;
}

/** Where a project's files come from (review.json row element 10): Senate copies, DPWH Transparency (the NEP proposal). */
export const FROM_SENATE = 1, FROM_PROPOSAL = 2;

/**
 * One row of review.json `rows`, positional to keep the file small:
 * [hgab_id, project_id, title, office index, region index, program index, amount_php, flag indexes, named-type
 *  bitmask (bit i = NAMED_TYPES[i] present, with our links), files (Senate + Proposal), sources bitmask
 *  (FROM_SENATE | FROM_PROPOSAL; absent in files built before it)]
 */
export type ReviewIndexRow = [string, string, string, number, number, number, number, number[], number, number, number?];
export interface ReviewIndex {
  schema: number;
  built_at: string;
  source_generated_at: Record<string, string>;
  named_types: readonly string[];
  flags: ReviewIndexFlag[];
  offices: ReviewIndexOffice[];
  regions: string[];
  programs: string[];
  rows: ReviewIndexRow[];
  /** Automatic review (AUTO_REVIEW); absent in files built before it. */
  auto?: ReviewIndexAuto;
}

/** One file in a detail shard: [source, link_method, doc_type, source_type, name, url, bytes | null, archived, folder code]. */
export type DetailFile = ["senate" | "proposal", LinkMethod, NamedType | "Other", string, string, string, number | null, boolean, string];
export interface ReviewDetail {
  page: number;
  /** The House bill PDF and page of our row (dpwh/projects.parquet hgab3_doc / hgab3_page), for "see it in the bill". */
  bill_doc: string | null;
  bill_page: number | null;
  pap: string | null;
  join_method: JoinMethod;
  proposal_code: string | null;
  proposal_types_without_files: boolean;
  flags: ReviewFlag[];
  missing_upstream: string[];
  notes: string[];
  files: DetailFile[];
}
/** A detail shard: hgab_id → detail. */
export type ReviewDetailShard = Record<string, ReviewDetail>;
