/**
 * npm run build:hgab-documents — supporting documents and review flags for every DPWH project in the FY2027 House
 * bill, tied to our project rows, for the Review screen. Docs: docs/hgab-documents.md.
 *
 * Reads (snapshots in data/hgab/2027/documents/sources/; --fetch refreshes them)
 *   hgab-document-coverage.json             research.bettergov.ph: Proposal types, Senate files per House bill row
 *   flags.json                              research.bettergov.ph: review flags and missing-document flags per row
 *   dpwh-in-depth-data.json + shards        research.bettergov.ph: Proposal records with file links (projects-*),
 *                                           POW first-page title scan of Senate folders (hgabPowResults-*)
 *   supporting-documents-file-links.jsonl   R2: every Senate-provided file
 *   r4a-tracker.xlsx                        R2: Region IV-A's own folder-code list (inside the Senate files)
 *   data/hgab/2027/dpwh/projects.parquet    our DPWH rows (House bill third reading; api.id = Proposal code)
 * Writes data/hgab/2027/documents/
 *   projects.parquet   one row per House bill row (DocumentProject, src/lib/hgab-documents.ts), sorted by project_id
 *   files.parquet      one row per file tied to a row (DocumentFile), sorted by project_id
 *   manifest.json      sources with SHA-256, counts, and every reconciliation below
 *
 * Fails unless: every research row ties to exactly one of our rows (merged duplicates add up to the peso);
 * recomputing the missing-document flags from the research links alone reproduces flags.json on every row, and the
 * flag counts reproduce its summary; the file-type rule reproduces the research site's Senate types; every shard
 * matches its published SHA-256; and no folder or file is tied to two rows.
 *
 *   npm run build:hgab-documents -- --fetch
 */
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import ExcelJS from "exceljs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  AMOUNT_FLAG_RE, AUTO_REVIEW, FROM_PROPOSAL, FROM_SENATE, COMPLETE_AT, HOUSE_ONLY_TRACES, OUR_NEP_FLAGS, autoRules, autoScore, DETAIL_SHARD_ROWS, DOCUMENTS_DIR, DOCUMENTS_SCHEMA, FOLDER_CODE_RE, FOLDER_REVIEWS, NAMED_TYPES,
  PROPOSAL_TYPE_MAP, REVIEW_INDEX_PATH, detailShardPath, flagCode, flagFamily, missingCode, parseHgabId, senateFileType,
  type DetailFile, type DocumentFile, type DocumentProject, type JoinMethod, type LinkMethod, type NamedType, type ProposalLink,
  type ReviewDetailShard, type ReviewFlag, type ReviewIndex, type ReviewIndexOffice, type ReviewIndexRow,
} from "../src/lib/hgab-documents";

const RESEARCH = "https://research.bettergov.ph/static/nep-preview";
export const SOURCES = {
  coverage: { file: "hgab-document-coverage.json", url: `${RESEARCH}/hgab-document-coverage.json` },
  flags: { file: "flags.json", url: `${RESEARCH}/flags.json` },
  inDepth: { file: "dpwh-in-depth-data.json", url: `${RESEARCH}/dpwh-in-depth-data.json` },
  links: { file: "supporting-documents-file-links.jsonl", url: "https://budget-assets.bettergov.ph/hgab/2027/dpwh/supporting-documents-file-links.jsonl" },
  tracker: {
    file: "r4a-tracker.xlsx",
    url: "https://budget-assets.bettergov.ph/hgab/2027/dpwh/supporting-documents/Region%20IV-A/R4A_FY%202027%20DPWH%20HGAB%20Tracker%20and%20List.xlsx",
  },
} as const;
/** The in-depth file's shards we read. */
const SHARD_KEYS = ["projects", "hgabPowResults"] as const;

interface Args { out: string; fetch: boolean }
function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  return { out: resolve(get("out") ?? "data/hgab/2027"), fetch: argv.includes("--fetch") };
}

const log = (s: string) => process.stdout.write(`${s}\n`);
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const md5 = (path: string) => createHash("md5").update(readFileSync(path)).digest("hex");
const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`build-hgab-documents: ${msg}`);
}
/** Letters and digits only: drops the stray characters the PDF text left in some titles. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
const tokens = (s: string) => new Set(s.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
function jaccard(a: string, b: string): number {
  const x = tokens(a), y = tokens(b);
  let n = 0;
  for (const t of x) if (y.has(t)) n++;
  return n / (x.size + y.size - n || 1);
}
const uniq = <T,>(xs: Iterable<T>) => [...new Set(xs)];
const byNamedOrder = (xs: Iterable<string>) => { const s = new Set(xs); return NAMED_TYPES.filter((t) => s.has(t)); };
const sameSet = (a: Iterable<string>, b: Iterable<string>) => uniq(a).sort().join("|") === uniq(b).sort().join("|");
const folderOf = (path: string) => FOLDER_CODE_RE.exec(path)?.[1] ?? null;

// --- Source shapes ------------------------------------------------------------------------------------------------

interface CovDoc { fileLinkId: number; documentName: string; documentType: string; url: string; path: string }
interface CovRow {
  hgabId: string; title: string; office: string; region: string; amountPesos: number;
  proposalDocumentsMatched: boolean; proposalDocumentSources: string[]; proposalDocumentTypes: string[]; proposalMatchedFileRecords: number;
  senateHgabDocumentsMatched: boolean; senateDocumentTypes: string[]; senateDocuments: CovDoc[];
}
interface Coverage { generatedAtUtc: string; denominatorProjectRows: number; projects: CovRow[] }
interface FlagRow {
  hgabId: string; existingReviewFlags: string[]; missingDocumentFlags: string[];
  detailedFlagEvidence: { label: string; evidence: string; source: string }[];
  flagsOverviewMatch: boolean; detailedQueueMatch: boolean;
}
interface Flags { generatedAtUtc: string; summary: { existingReviewFlagOccurrences: number; combinedFlagCounts: Record<string, number> }; projects: FlagRow[] }
interface Shard { path: string; itemCount: number; sha256: string }
interface InDepth { generatedAtUtc: string; arrayShards: Record<string, Shard[]> }
interface ProposalRec { code: string; name: string; office: string; region: string; allocationPesos: number; documentLinks: { type: string; url: string }[] }
interface PowResult { code: string; matchStatus: string; hgabId: string | null }
interface LinkRow { id: number; region: string; path: string; url: string; bytes: number; sha256: string }
interface TrackerRow { code: string; title: string; amount_php: number; office: string }
interface OurRow { id: string; title: string; amount: number; page: number; office: string; apiId: string | null; doc: string | null; program: string; pap: string | null; trace: string }

function curl(url: string, out: string): void {
  log(`  fetching ${url}`);
  execFileSync("curl", ["-sSfL", "-A", "bettergov-ai-reports/1.0", "-o", out, url], { stdio: "inherit" });
}
function fetchSources(dir: string): void {
  mkdirSync(resolve(dir, "shards"), { recursive: true });
  for (const s of Object.values(SOURCES)) curl(s.url, resolve(dir, s.file));
  const inDepth = readJson<InDepth>(resolve(dir, SOURCES.inDepth.file));
  for (const k of SHARD_KEYS) for (const s of inDepth.arrayShards[k]) curl(`${RESEARCH}/${s.path}`, resolve(dir, "shards", basename(s.path)));
}
function readShards<T>(dir: string, inDepth: InDepth, key: (typeof SHARD_KEYS)[number]): T[] {
  return inDepth.arrayShards[key].flatMap((s) => {
    const p = resolve(dir, "shards", basename(s.path));
    ensure(existsSync(p), `${basename(s.path)} not in ${dir}/shards; run with --fetch`);
    ensure(sha256(p) === s.sha256, `${basename(s.path)} doesn't match the SHA-256 the in-depth file publishes`);
    const items = readJson<T[]>(p);
    ensure(items.length === s.itemCount, `${basename(s.path)}: ${items.length} items, the in-depth file says ${s.itemCount}`);
    return items;
  });
}

async function readTracker(path: string): Promise<TrackerRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet("List");
  ensure(ws, "tracker has no List sheet");
  const out: TrackerRow[] = [];
  const text = (v: ExcelJS.CellValue): string => (v == null ? "" : typeof v === "object" && "result" in v ? String(v.result ?? "") : String(v));
  ws.eachRow((row) => {
    const m = FOLDER_CODE_RE.exec(text(row.getCell(1).value).trim());
    if (!m) return;
    // Columns: A code, I title, J amount in thousand pesos, L implementing office.
    out.push({ code: m[1], title: text(row.getCell(9).value).trim(), amount_php: Math.round(Number(text(row.getCell(10).value)) * 1000), office: text(row.getCell(12).value).trim() });
  });
  return out;
}

async function readOurs(c: DuckDBConnection, path: string): Promise<OurRow[]> {
  const r = await c.runAndReadAll(`SELECT id, title, hgab3_php, hgab3_page, coalesce(office, ''), json_extract_string(record_json, '$.api.id'),
    hgab3_doc, coalesce(program, ''), pap, coalesce(trace, '') FROM read_parquet('${path}') WHERE hgab3_php IS NOT NULL`);
  return (r.getRows() as unknown[][]).map(([id, title, amt, page, office, api, doc, program, pap, trace]) => ({
    id: String(id), title: String(title), amount: Number(amt), page: Number(page), office: String(office), apiId: api == null ? null : String(api),
    doc: doc == null ? null : String(doc), program: String(program), pap: pap == null ? null : String(pap), trace: String(trace),
  }));
}

// --- 1. Research rows → our rows ----------------------------------------------------------------------------------

function joinRows(cov: CovRow[], ours: OurRow[]): Map<string, { row: OurRow; method: JoinMethod }> {
  const out = new Map<string, { row: OurRow; method: JoinMethod }>();
  const used = new Set<string>();
  const key = (page: number, amt: number, t: string) => `${page}|${amt}|${t}`;
  const exact = new Map<string, OurRow[]>(), folded = new Map<string, OurRow[]>();
  for (const o of ours) {
    for (const [m, k] of [[exact, key(o.page, o.amount, o.title.trim().toLowerCase())], [folded, key(o.page, o.amount, fold(o.title))]] as const) {
      m.set(k, [...(m.get(k) ?? []), o]);
    }
  }
  const page = (h: string) => parseHgabId(h)!.page;
  // Exact: same page, amount and title.
  for (const r of cov) {
    const hit = exact.get(key(page(r.hgabId), r.amountPesos, r.title.trim().toLowerCase())) ?? [];
    if (hit.length === 1 && !used.has(hit[0].id)) { out.set(r.hgabId, { row: hit[0], method: "exact" }); used.add(hit[0].id); }
  }
  // Title clean-up: stray characters from the PDF text, or the title repeated with coordinates; same page and amount.
  for (const r of cov) {
    if (out.has(r.hgabId)) continue;
    const p = page(r.hgabId), f = fold(r.title);
    let hit = (folded.get(key(p, r.amountPesos, f)) ?? []).filter((o) => !used.has(o.id));
    if (hit.length !== 1) {
      hit = ours.filter((o) => !used.has(o.id) && o.page === p && o.amount === r.amountPesos && f.length > 20 && (f.includes(fold(o.title)) || fold(o.title).includes(f)));
    }
    if (hit.length === 1) { out.set(r.hgabId, { row: hit[0], method: "title_cleanup" }); used.add(hit[0].id); }
  }
  // Merged duplicates: the bill lists one project on two lines; our import keeps one row with their sum. Accept
  // only when every research row on that row adds up to it to the peso.
  const groups = new Map<string, CovRow[]>();
  for (const r of cov.filter((x) => !out.has(x.hgabId))) {
    const p = page(r.hgabId);
    const cands = ours.filter((o) => !used.has(o.id) && Math.abs(o.page - p) <= 2 && o.office === r.office && o.amount > r.amountPesos && jaccard(o.title, r.title) >= 0.8)
      .sort((a, b) => jaccard(b.title, r.title) - jaccard(a.title, r.title));
    if (cands[0]) groups.set(cands[0].id, [...(groups.get(cands[0].id) ?? []), r]);
  }
  for (const [id, rs] of groups) {
    const o = ours.find((x) => x.id === id)!;
    ensure(rs.length >= 2 && rs.reduce((s, r) => s + r.amountPesos, 0) === o.amount,
      `merged duplicate ${id} (₱${o.amount}) doesn't add up: ${rs.map((r) => `${r.hgabId} ₱${r.amountPesos}`).join(", ")}`);
    for (const r of rs) out.set(r.hgabId, { row: o, method: "merged_duplicate" });
    used.add(id);
  }
  const missing = cov.filter((r) => !out.has(r.hgabId));
  ensure(missing.length === 0, `${missing.length} research rows tie to none of our rows: ${missing.slice(0, 5).map((r) => r.hgabId).join(", ")}`);
  return out;
}

// --- 2. Senate folders → rows -------------------------------------------------------------------------------------

interface FolderLink { code: string; hgabId: string; method: Exclude<LinkMethod, "proposal"> }

function linkFolders(cov: CovRow[], links: LinkRow[], pow: PowResult[], tracker: TrackerRow[]) {
  const folders = new Map<string, LinkRow[]>();
  let noCode = 0;
  for (const l of links) {
    const c = folderOf(l.path);
    if (!c) { noCode++; continue; }
    folders.set(c, [...(folders.get(c) ?? []), l]);
  }
  const rowIds = new Set(cov.map((r) => r.hgabId));
  const out = new Map<string, FolderLink>();
  for (const r of cov) {
    for (const d of r.senateDocuments) {
      const c = folderOf(d.path);
      ensure(c, `research file ${d.fileLinkId} has no folder code`);
      const prev = out.get(c);
      ensure(!prev || prev.hgabId === r.hgabId, `folder ${c} tied to ${prev?.hgabId} and ${r.hgabId}`);
      out.set(c, { code: c, hgabId: r.hgabId, method: "research" });
    }
  }
  const hasFiles = new Set([...out.values()].map((l) => l.hgabId));

  // POW title scan: a folder the coverage file left untied, whose POW names a row that has no Senate files.
  const powByCode = new Map<string, PowResult>();
  for (const p of pow) { const c = folderOf(p.code); if (c) powByCode.set(c, p); }
  let powAgrees = 0, powRowHasFiles = 0, powConflicts = 0;
  const powClaims = new Map<string, string[]>();
  for (const [c, p] of powByCode) {
    // Exact title matches only: a relaxed match tied 12254 (Makiling) to Milagrosa.
    if (!p.hgabId || p.matchStatus !== "exact_title_match") continue;
    ensure(rowIds.has(p.hgabId), `POW scan of ${c} names unknown row ${p.hgabId}`);
    const linked = out.get(c);
    if (linked) { if (linked.hgabId === p.hgabId) powAgrees++; else powConflicts++; continue; }
    if (!folders.has(c)) continue;
    if (hasFiles.has(p.hgabId)) { powRowHasFiles++; continue; }
    powClaims.set(p.hgabId, [...(powClaims.get(p.hgabId) ?? []), c]);
  }
  for (const [hgabId, codes] of powClaims) for (const c of codes) out.set(c, { code: c, hgabId, method: "pow_title" });
  ensure(powConflicts === 0, `the POW scan and the coverage file tie ${powConflicts} folders to different rows`);
  for (const l of out.values()) hasFiles.add(l.hgabId);

  // Region IV-A's tracker: a folder code with a title and amount that name exactly one row, unless the POW scan
  // names another row. Where the coverage file already tied the folder, its link stands (it comes from the POW).
  const byTitleAmount = new Map<string, CovRow[]>();
  for (const r of cov) {
    const k = `${fold(r.title)}|${r.amountPesos}`;
    byTitleAmount.set(k, [...(byTitleAmount.get(k) ?? []), r]);
  }
  const trackerDisagrees: { code: string; tracker: string; linked: string }[] = [];
  let trackerAmbiguous = 0, trackerRowHasFiles = 0, trackerPowDisagrees = 0, trackerPowAgrees = 0;
  const trackerClaims = new Map<string, string>();
  for (const t of tracker) {
    const hits = (byTitleAmount.get(`${fold(t.title)}|${t.amount_php}`) ?? []).filter((r) => r.region === "Region IV-A");
    const linked = out.get(t.code);
    if (linked) {
      if (!hits.some((r) => r.hgabId === linked.hgabId)) trackerDisagrees.push({ code: t.code, tracker: hits[0]?.hgabId ?? `${t.title} ₱${t.amount_php}`, linked: linked.hgabId });
      continue;
    }
    if (!folders.has(t.code)) continue;
    if (hits.length !== 1) { trackerAmbiguous++; continue; }
    const p = powByCode.get(t.code);
    if (p?.hgabId && p.hgabId !== hits[0].hgabId) { trackerPowDisagrees++; continue; }
    if (p?.hgabId) trackerPowAgrees++;
    if (hasFiles.has(hits[0].hgabId) || trackerClaims.has(hits[0].hgabId)) { trackerRowHasFiles++; continue; }
    trackerClaims.set(hits[0].hgabId, t.code);
    out.set(t.code, { code: t.code, hgabId: hits[0].hgabId, method: "tracker" });
  }

  // Disputes between a tied folder and the tracker are settled by reading the POW (FOLDER_REVIEWS); a new one
  // fails the build until someone reads it.
  const unsettled = trackerDisagrees.filter((d) => !FOLDER_REVIEWS[d.code]);
  ensure(unsettled.length === 0, `tracker disagrees on folders nobody has read: ${unsettled.map((d) => `${d.code} (tracker ${d.tracker}, tied ${d.linked})`).join("; ")}`);
  const unused = Object.keys(FOLDER_REVIEWS).filter((c) => !trackerDisagrees.some((d) => d.code === c));
  ensure(unused.length === 0, `FOLDER_REVIEWS lists folders that are no longer disputed: ${unused.join(", ")}`);
  const moved: { code: string; from: string; to: string }[] = [];
  for (const d of trackerDisagrees) {
    const r = FOLDER_REVIEWS[d.code];
    ensure(rowIds.has(r.hgabId) && (r.hgabId === d.linked || r.hgabId === d.tracker), `FOLDER_REVIEWS ${d.code} names neither disputed row`);
    if (r.hgabId !== d.linked) moved.push({ code: d.code, from: d.linked, to: r.hgabId });
    out.set(d.code, { code: d.code, hgabId: r.hgabId, method: "reviewed" });
  }
  return {
    folders, links: out, noCode,
    pow: { agrees_with_coverage: powAgrees, row_already_has_files: powRowHasFiles, tied: [...out.values()].filter((l) => l.method === "pow_title").length },
    tracker: {
      codes: tracker.length, ambiguous: trackerAmbiguous, pow_names_another_row: trackerPowDisagrees, pow_agrees: trackerPowAgrees,
      row_already_has_files: trackerRowHasFiles, disputes_reviewed: trackerDisagrees.length, reviewed_moved: moved,
    },
  };
}

// --- 3. Proposal records → rows -----------------------------------------------------------------------------------

/**
 * The row's Proposal record: our pairing (api.id), else a record with the row's exact title. Accepted only when the
 * research site lists Proposal documents for the row and the record's file types are exactly those.
 */
function linkProposals(cov: CovRow[], joined: Map<string, { row: OurRow }>, recs: ProposalRec[]) {
  const byCode = new Map(recs.map((r) => [r.code, r]));
  const byTitle = new Map<string, ProposalRec[]>();
  for (const r of recs) byTitle.set(fold(r.name), [...(byTitle.get(fold(r.name)) ?? []), r]);
  const out = new Map<string, { rec: ProposalRec; how: ProposalLink }>();
  let unlinked = 0, typesDiffer = 0, pairedButNotListed = 0;
  for (const r of cov) {
    const paired = joined.get(r.hgabId)!.row.apiId;
    const viaPair = paired ? byCode.get(paired) : undefined;
    if (!r.proposalDocumentsMatched) {
      if (viaPair?.documentLinks.length) pairedButNotListed++;
      continue;
    }
    const types = (x: ProposalRec) => x.documentLinks.map((d) => d.type);
    if (viaPair && sameSet(types(viaPair), r.proposalDocumentTypes)) { out.set(r.hgabId, { rec: viaPair, how: "pairing" }); continue; }
    if (viaPair) typesDiffer++;
    const t = (byTitle.get(fold(r.title)) ?? []).filter((x) => sameSet(types(x), r.proposalDocumentTypes));
    if (t.length === 1) { out.set(r.hgabId, { rec: t[0], how: "title" }); continue; }
    unlinked++;
  }
  return { links: out, unlinked, typesDiffer, pairedButNotListed };
}

// --- 4. Flags -----------------------------------------------------------------------------------------------------

function reviewFlags(f: FlagRow): ReviewFlag[] {
  return f.existingReviewFlags.map((label) => ({
    ...flagCode(label),
    label,
    evidence: uniq(f.detailedFlagEvidence.filter((e) => e.label === label).map((e) => e.evidence)),
  }));
}
const missingOf = (present: readonly string[]) => NAMED_TYPES.filter((t) => !present.includes(t)).map((t) => `Missing ${t}`);

// --- Main ---------------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  const dir = resolve(args.out, DOCUMENTS_DIR), src = resolve(dir, "sources");
  if (args.fetch) fetchSources(src);
  for (const s of Object.values(SOURCES)) ensure(existsSync(resolve(src, s.file)), `${s.file} not in ${src}; run with --fetch`);
  const projectsPath = resolve(args.out, "dpwh/projects.parquet");
  ensure(existsSync(projectsPath), `${projectsPath} not found`);

  const cov = readJson<Coverage>(resolve(src, SOURCES.coverage.file));
  const flags = readJson<Flags>(resolve(src, SOURCES.flags.file));
  const inDepth = readJson<InDepth>(resolve(src, SOURCES.inDepth.file));
  const proposals = readShards<ProposalRec>(src, inDepth, "projects");
  const pow = readShards<PowResult>(src, inDepth, "hgabPowResults");
  const links = readFileSync(resolve(src, SOURCES.links.file), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LinkRow);
  const tracker = await readTracker(resolve(src, SOURCES.tracker.file));
  const db = await DuckDBInstance.create();
  const c = await db.connect();
  const ours = await readOurs(c, projectsPath);
  log(`coverage ${cov.projects.length} rows (${cov.generatedAtUtc}); flags ${flags.projects.length} (${flags.generatedAtUtc}); `
    + `Proposal records ${proposals.length}, POW scans ${pow.length} (${inDepth.generatedAtUtc}); ${links.length} Senate files; tracker ${tracker.length} codes; our DPWH rows ${ours.length}`);

  // The two research files describe the same rows.
  const flagById = new Map(flags.projects.map((f) => [f.hgabId, f]));
  ensure(cov.projects.length === cov.denominatorProjectRows && flags.projects.length === cov.projects.length
    && cov.projects.every((r) => flagById.has(r.hgabId)) && new Set(cov.projects.map((r) => r.hgabId)).size === cov.projects.length,
  "coverage and flags don't list the same House bill rows");
  ensure(cov.projects.every((r) => parseHgabId(r.hgabId)), "an hgabId doesn't read as HB10858-3-<page>-<row>");

  // The file-type rule reproduces the research site's Senate types (one known exception: "POW_…_PDC.pdf").
  const typeMisses = cov.projects.flatMap((r) => r.senateDocuments).filter((d) => senateFileType(d.documentName) !== d.documentType);
  ensure(typeMisses.length <= 1, `file-type rule differs from the research site on ${typeMisses.length} files: ${typeMisses.slice(0, 5).map((d) => d.documentName).join(", ")}`);

  const joined = joinRows(cov.projects, ours);
  const F = linkFolders(cov.projects, links, pow, tracker);
  const P = linkProposals(cov.projects, joined, proposals);
  const linkById = new Map(links.map((l) => [l.id, l]));

  // Files per row: the research site's own list for its folders, every file in the folder for the others, and the
  // Proposal record's links.
  const files: DocumentFile[] = [];
  const fileOwner = new Map<number, string>();
  const projectId = (h: string) => joined.get(h)!.row.id;
  const addSenate = (hgabId: string, code: string, l: LinkRow, type: string, method: LinkMethod) => {
    const prev = fileOwner.get(l.id);
    ensure(!prev || prev === hgabId, `file ${l.id} tied to ${prev} and ${hgabId}`);
    if (prev) return;
    fileOwner.set(l.id, hgabId);
    files.push({
      hgab_id: hgabId, project_id: projectId(hgabId), source: "senate", folder_code: code, file_link_id: l.id,
      doc_type: (NAMED_TYPES as readonly string[]).includes(type) ? (type as NamedType) : "Other", source_type: type,
      name: l.path.split("/").pop()!, url: l.url, path: l.path, bytes: l.bytes, sha256: l.sha256,
      archived: /\/archive\//i.test(l.path), link_method: method,
    });
  };
  // A folder the coverage file tied keeps its file list and types, on the row FOLDER_REVIEWS gives it if disputed.
  const researchFolders = new Set<string>();
  for (const r of cov.projects) {
    for (const d of r.senateDocuments) {
      const l = linkById.get(d.fileLinkId);
      ensure(l && l.url === d.url, `research file ${d.fileLinkId} isn't in the file index as published`);
      const fl = F.links.get(folderOf(d.path)!)!;
      researchFolders.add(fl.code);
      addSenate(fl.hgabId, fl.code, l, d.documentType, fl.method);
    }
  }
  for (const fl of F.links.values()) {
    if (researchFolders.has(fl.code)) continue;
    for (const l of F.folders.get(fl.code)!) addSenate(fl.hgabId, fl.code, l, senateFileType(l.path.split("/").pop()!), fl.method);
  }
  for (const [hgabId, { rec }] of P.links) {
    for (const d of rec.documentLinks) {
      files.push({
        hgab_id: hgabId, project_id: projectId(hgabId), source: "proposal", folder_code: rec.code, file_link_id: null,
        doc_type: PROPOSAL_TYPE_MAP[d.type] ?? "Other", source_type: d.type, name: decodeURIComponent(d.url.split("/").pop()!),
        url: d.url, path: null, bytes: null, sha256: null, archived: false, link_method: "proposal",
      });
    }
  }

  // Per row.
  const filesByRow = new Map<string, DocumentFile[]>();
  for (const f of files) filesByRow.set(f.hgab_id, [...(filesByRow.get(f.hgab_id) ?? []), f]);
  const parityMisses: string[] = [];
  const projects: DocumentProject[] = cov.projects.map((r) => {
    const f = flagById.get(r.hgabId)!;
    const j = joined.get(r.hgabId)!;
    const { page, seq } = parseHgabId(r.hgabId)!;
    const proposalNamed = r.proposalDocumentTypes.map((t) => PROPOSAL_TYPE_MAP[t]).filter(Boolean);
    const upstreamNamed = byNamedOrder([...proposalNamed, ...r.senateDocumentTypes]);
    const rowFiles = filesByRow.get(r.hgabId) ?? [];
    const senate = rowFiles.filter((x) => x.source === "senate");
    // A row that lost a folder on review counts only the Senate files it still has; otherwise the research site's
    // Senate types stand (170 rows have types but no file list).
    const lostFolder = F.tracker.reviewed_moved.some((d) => d.from === r.hgabId);
    const named = byNamedOrder([...proposalNamed, ...(lostFolder ? [] : r.senateDocumentTypes), ...senate.map((x) => x.doc_type)]);
    const missingUpstream = missingOf(upstreamNamed);
    if (missingUpstream.join("|") !== f.missingDocumentFlags.join("|")) parityMisses.push(r.hgabId);
    const prop = P.links.get(r.hgabId);
    const notes: string[] = [];
    if (r.senateHgabDocumentsMatched && r.senateDocuments.length === 0) notes.push("senate_matched_without_files");
    if (r.proposalDocumentsMatched && !prop) notes.push("proposal_types_without_files");
    if (r.proposalDocumentsMatched && f.existingReviewFlags.includes("No listed DPWH Transparency documents")) notes.push("proposal_documents_via_nep_counterpart");
    if (F.tracker.reviewed_moved.some((d) => d.from === r.hgabId)) notes.push("senate_folder_moved_to_another_row");
    if (F.tracker.reviewed_moved.some((d) => d.to === r.hgabId)) notes.push("senate_folder_moved_from_another_row");
    if (new Set(rowFiles.filter((x) => x.source === "senate").map((x) => x.folder_code)).size > 1) notes.push("several_senate_folders");
    return {
      hgab_id: r.hgabId, project_id: j.row.id, join_method: j.method, page, seq, title: r.title, office: r.office, region: r.region,
      amount_php: r.amountPesos, project_amount_php: j.row.amount,
      proposal_types: r.proposalDocumentTypes, proposal_sources: r.proposalDocumentSources, proposal_file_records: r.proposalMatchedFileRecords,
      proposal_code: prop?.rec.code ?? null, proposal_link: prop?.how ?? null, proposal_files: rowFiles.length - senate.length,
      senate_types: uniq(senate.map((x) => x.doc_type)).sort(), senate_folders: uniq(senate.map((x) => x.folder_code)).sort(),
      senate_files: senate.length, senate_matched_without_files: r.senateHgabDocumentsMatched && r.senateDocuments.length === 0,
      named_present: named, named_present_upstream: upstreamNamed,
      complete: named.length >= COMPLETE_AT, complete_upstream: upstreamNamed.length >= COMPLETE_AT,
      missing_flags: missingOf(named), missing_flags_upstream: missingUpstream,
      review_flags: reviewFlags(f), flags_overview_match: f.flagsOverviewMatch, detailed_queue_match: f.detailedQueueMatch, notes,
    };
  });
  ensure(parityMisses.length === 0, `missing-document flags from the research links differ from flags.json on ${parityMisses.length} rows: ${parityMisses.slice(0, 5).join(", ")}`);

  // Flag occurrences and counts reproduce flags.json's own summary.
  const occ = projects.reduce((s, p) => s + p.review_flags.length, 0);
  ensure(occ === flags.summary.existingReviewFlagOccurrences, `review flag occurrences ${occ} vs flags.json ${flags.summary.existingReviewFlagOccurrences}`);
  const combined = new Map<string, number>();
  for (const p of projects) for (const l of [...p.review_flags.map((x) => x.label), ...p.missing_flags_upstream]) combined.set(l, (combined.get(l) ?? 0) + 1);
  const combinedMiss = Object.entries(flags.summary.combinedFlagCounts).filter(([k, v]) => combined.get(k) !== v);
  ensure(combinedMiss.length === 0 && combined.size === Object.keys(flags.summary.combinedFlagCounts).length,
    `flag counts differ from flags.json: ${combinedMiss.slice(0, 5).map(([k, v]) => `${k} ${combined.get(k)} vs ${v}`).join("; ")}`);

  // Write.
  const order = (a: { project_id: string; hgab_id: string }, b: { project_id: string; hgab_id: string }) =>
    a.project_id.localeCompare(b.project_id, "en", { numeric: true }) || a.hgab_id.localeCompare(b.hgab_id);
  projects.sort(order);
  files.sort((a, b) => order(a, b) || a.source.localeCompare(b.source) || a.folder_code.localeCompare(b.folder_code)
    || Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
  await writeParquet(c, resolve(dir, "projects.parquet"), projects, {
    hgab_id: "VARCHAR", project_id: "VARCHAR", join_method: "VARCHAR", page: "INTEGER", seq: "INTEGER", title: "VARCHAR", office: "VARCHAR",
    region: "VARCHAR", amount_php: "BIGINT", project_amount_php: "BIGINT", proposal_types: "VARCHAR[]", proposal_sources: "VARCHAR[]",
    proposal_file_records: "INTEGER", proposal_code: "VARCHAR", proposal_link: "VARCHAR", proposal_files: "INTEGER",
    senate_types: "VARCHAR[]", senate_folders: "VARCHAR[]", senate_files: "INTEGER",
    senate_matched_without_files: "BOOLEAN", named_present: "VARCHAR[]", named_present_upstream: "VARCHAR[]", complete: "BOOLEAN",
    complete_upstream: "BOOLEAN", missing_flags: "VARCHAR[]", missing_flags_upstream: "VARCHAR[]",
    review_flags: "STRUCT(code VARCHAR, label VARCHAR, value BIGINT, evidence VARCHAR[])[]", flags_overview_match: "BOOLEAN",
    detailed_queue_match: "BOOLEAN", notes: "VARCHAR[]",
  });
  await writeParquet(c, resolve(dir, "files.parquet"), files, {
    hgab_id: "VARCHAR", project_id: "VARCHAR", source: "VARCHAR", folder_code: "VARCHAR", file_link_id: "INTEGER", doc_type: "VARCHAR",
    source_type: "VARCHAR", name: "VARCHAR", url: "VARCHAR", path: "VARCHAR", bytes: "BIGINT", sha256: "VARCHAR", archived: "BOOLEAN",
    link_method: "VARCHAR",
  });

  const reviewer = writeReviewer(args.out, projects, files, joined, {
    coverage: cov.generatedAtUtc, flags: flags.generatedAtUtc, in_depth: inDepth.generatedAtUtc,
  });

  const count = <T,>(xs: T[], k: (x: T) => string) => { const m: Record<string, number> = {}; for (const x of xs) m[k(x)] = (m[k(x)] ?? 0) + 1; return m; };
  const folderLinks = [...F.links.values()];
  const senateFiles = files.filter((f) => f.source === "senate");
  const rowsWith = (pred: (f: DocumentFile) => boolean) => new Set(files.filter(pred).map((f) => f.hgab_id)).size;
  const manifest = {
    schema: DOCUMENTS_SCHEMA,
    built_at: new Date().toISOString(),
    sources: {
      ...Object.fromEntries(Object.entries(SOURCES).map(([k, s]) => [k, { url: s.url, file: `sources/${s.file}`, sha256: sha256(resolve(src, s.file)) }])),
      shards: SHARD_KEYS.flatMap((k) => inDepth.arrayShards[k].map((s) => ({ url: `${RESEARCH}/${s.path}`, file: `sources/shards/${basename(s.path)}`, sha256: s.sha256 }))),
    },
    source_generated_at: { coverage: cov.generatedAtUtc, flags: flags.generatedAtUtc, in_depth: inDepth.generatedAtUtc },
    /** MD5 of each output, for `?v=` links: R2 caches Parquet for a day and isn't purged. */
    outputs: Object.fromEntries(["projects.parquet", "files.parquet"].map((f) => [f, { md5: md5(resolve(dir, f)), bytes: statSync(resolve(dir, f)).size }])),
    rows: projects.length,
    our_rows: new Set(projects.map((p) => p.project_id)).size,
    join_methods: count(projects, (p) => p.join_method),
    files: { total: files.length, by_method: count(files, (f) => f.link_method), rows_with_any: filesByRow.size },
    senate: {
      files_in_index: links.length,
      files_without_folder_code: F.noCode,
      folders: F.folders.size,
      folders_tied: count(folderLinks, (l) => l.method),
      folders_untied: F.folders.size - folderLinks.length,
      files_tied: senateFiles.length,
      rows_with_files: { research: rowsWith((f) => f.link_method === "research"), all: rowsWith((f) => f.source === "senate") },
      rows_matched_without_files: projects.filter((p) => p.senate_matched_without_files).length,
      pow_scan: F.pow,
      tracker: F.tracker,
    },
    proposal: {
      rows_with_documents: cov.projects.filter((r) => r.proposalDocumentsMatched).length,
      rows_with_files: P.links.size,
      by_link: count([...P.links.values()], (x) => x.how),
      rows_types_without_files: P.unlinked,
      paired_record_types_differ: P.typesDiffer,
      paired_but_research_lists_none: P.pairedButNotListed,
      files: files.length - senateFiles.length,
    },
    documents: {
      complete_upstream: projects.filter((p) => p.complete_upstream).length,
      complete: projects.filter((p) => p.complete).length,
      missing_upstream: count(projects.flatMap((p) => p.missing_flags_upstream), (x) => x),
      missing: count(projects.flatMap((p) => p.missing_flags), (x) => x),
    },
    review_flags: {
      occurrences: occ,
      rows_with_flags: projects.filter((p) => p.review_flags.length > 0).length,
      rows_without_exact_record: projects.filter((p) => !p.flags_overview_match && !p.detailed_queue_match).length,
      flags_without_evidence: projects.reduce((s, p) => s + p.review_flags.filter((x) => x.evidence.length === 0).length, 0),
      by_code: Object.fromEntries(Object.entries(count(projects.flatMap((p) => p.review_flags), (x) => x.code)).sort((a, b) => b[1] - a[1])),
    },
    notes: count(projects.flatMap((p) => p.notes), (x) => x),
    reviewer,
  };
  writeFileSync(resolve(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  log(JSON.stringify({ join: manifest.join_methods, files: manifest.files, senate: manifest.senate, proposal: manifest.proposal, documents: { complete_upstream: manifest.documents.complete_upstream, complete: manifest.documents.complete } }, null, 2));
  log(`wrote ${dir}/projects.parquet (${projects.length}), files.parquet (${files.length}), manifest.json`);
}

// --- 5. The reviewer's files ---------------------------------------------------------------------------------------

/** review.json (every row, compact) and detail/<NN>.json (files and flag evidence per row), for the Review screen. */
function writeReviewer(out: string, projects: DocumentProject[], files: DocumentFile[], joined: Map<string, { row: OurRow }>, generated: Record<string, string>) {
  const districts = readJson<{ districts: { id: string; label: string }[]; offices: Record<string, { name: string; district_ids: string[]; tier: string | null }> }>(resolve(out, "districts.json"));
  const label = new Map(districts.districts.map((d) => [d.id, d.label]));
  // districts.json names offices "Abra DEO"; our rows "Abra District Engineering Office".
  const short = (name: string) => name.replace(/\bDistrict Engineering Office\b/i, "DEO").replace(/\bSub-District Engineering Office\b/i, "SDEO").trim();
  // The bill's typos, fixed as build-hgab-districts.ts fixes them; names compared on letters and digits only.
  const typos = (n: string) => n.replace(/Marindugue/gi, "Marinduque").replace(/Siguijor/gi, "Siquijor").replace(/Occidenatal/gi, "Occidental")
    .replace(/Batagas/gi, "Batangas").replace(/Ilolilo/gi, "Iloilo");
  const officeKey = (n: string) => fold(short(typos(n)));
  const officeByName = new Map(Object.values(districts.offices).map((o) => [officeKey(o.name), o]));
  const idx = <T,>(list: T[], key: (x: T) => string) => { const m = new Map(list.map((x, i) => [key(x), i])); return (k: string) => m.get(k)!; };

  const officeNames = uniq(projects.map((p) => p.office)).sort();
  const offices: ReviewIndexOffice[] = officeNames.map((name) => {
    const o = officeByName.get(officeKey(name));
    const ds = (o?.district_ids ?? []).map((id) => label.get(id)).filter((x): x is string => !!x);
    return { name, districts: ds, tier: ds.length === 0 ? null : ds.length === 1 ? "A" : "B" };
  });
  const deoWithout = offices.filter((o) => /Engineering Office/i.test(o.name) && o.districts.length === 0).map((o) => o.name);
  ensure(deoWithout.length === 0, `DPWH offices with no legislative district in districts.json: ${deoWithout.join(", ")}`);
  const regions = uniq(projects.map((p) => p.region)).sort();
  const programs = uniq(projects.map((p) => joined.get(p.hgab_id)!.row.program)).sort();

  // Flags: the research site's review flags, then our missing-document flags (with our links).
  const flagLabel = (l: string) => AMOUNT_FLAG_RE.exec(l)?.[1] ?? l;
  const seen = new Map<string, { label: string; n: number }>();
  for (const p of projects) for (const f of p.review_flags) {
    const x = seen.get(f.code) ?? { label: flagLabel(f.label), n: 0 };
    x.n++;
    seen.set(f.code, x);
  }
  const flagsIdx: ReviewIndex["flags"] = [...seen].sort((a, b) => b[1].n - a[1].n).map(([code, x]) => {
    const family = flagFamily(code);
    ensure(family, `flag ${code} ("${x.label}") is in no FLAG_FAMILIES family`);
    return { code, label: x.label, family, n: x.n };
  });
  // Our NEP comparison beside the research site's insertion flag (OUR_NEP_FLAGS).
  const ourHouseOnly = (p: DocumentProject) => HOUSE_ONLY_TRACES.includes(joined.get(p.hgab_id)!.row.trace);
  const researchInsertion = (p: DocumentProject) => p.review_flags.some((f) => f.code === "potential-nep-insertion");
  const ourNep = (p: DocumentProject) => [
    ...(ourHouseOnly(p) ? [OUR_NEP_FLAGS.houseOnly.code] : []),
    ...(ourHouseOnly(p) !== researchInsertion(p) ? [OUR_NEP_FLAGS.disagree.code] : []),
  ];
  for (const f of [OUR_NEP_FLAGS.houseOnly, OUR_NEP_FLAGS.disagree]) {
    flagsIdx.push({ code: f.code, label: f.label, family: "nep", n: projects.filter((p) => ourNep(p).includes(f.code)).length, source: "bettergov", note: f.note });
  }
  for (const t of NAMED_TYPES) {
    const code = missingCode(t), lab = `Missing ${t}`;
    flagsIdx.push({ code, label: lab, family: "documents", n: projects.filter((p) => p.missing_flags.includes(lab)).length,
      computed: true, n_upstream: projects.filter((p) => p.missing_flags_upstream.includes(lab)).length, source: "bettergov" });
  }
  const flagAt = idx(flagsIdx, (f) => f.code), officeAt = idx(offices, (o) => o.name), regionAt = idx(regions, (r) => r), programAt = idx(programs, (r) => r);

  const filesBy = new Map<string, DocumentFile[]>();
  for (const f of files) filesBy.set(f.hgab_id, [...(filesBy.get(f.hgab_id) ?? []), f]);
  const ordered = [...projects].sort((a, b) => a.seq - b.seq);
  const rows: ReviewIndexRow[] = ordered.map((p) => [
    p.hgab_id, p.project_id, p.title, officeAt(p.office), regionAt(p.region), programAt(joined.get(p.hgab_id)!.row.program), p.amount_php,
    uniq([...p.review_flags.map((f) => flagAt(f.code)), ...ourNep(p).map(flagAt), ...p.missing_flags.map((l) => flagAt(flagCode(l).code))]),
    NAMED_TYPES.reduce((m, t, i) => (p.named_present.includes(t) ? m | (1 << i) : m), 0),
    filesBy.get(p.hgab_id)?.length ?? 0,
    (p.senate_files > 0 ? FROM_SENATE : 0) | (p.proposal_files > 0 ? FROM_PROPOSAL : 0),
  ]);
  // Automatic review (AUTO_REVIEW): every rule each row meets, and its score.
  const autoRows: Record<string, { r: number[]; s: number }> = {};
  for (const r of rows) {
    const codes = autoRules({ docs: r[8], files: r[9] });
    if (codes.length) autoRows[r[0]] = { r: codes.map((c) => AUTO_REVIEW.rules.findIndex((x) => x.code === c)), s: autoScore(codes) };
  }
  const index: ReviewIndex = {
    schema: DOCUMENTS_SCHEMA, built_at: new Date().toISOString(), source_generated_at: generated, named_types: NAMED_TYPES,
    flags: flagsIdx, offices, regions, programs, rows,
    auto: {
      method: AUTO_REVIEW.method, status: AUTO_REVIEW.status, note: AUTO_REVIEW.note,
      rules: AUTO_REVIEW.rules.map((x) => ({ ...x, team_flags: [...x.team_flags] })), bands: AUTO_REVIEW.bands.map((b) => ({ ...b })), rows: autoRows,
    },
  };
  writeFileSync(resolve(out, REVIEW_INDEX_PATH), JSON.stringify(index));

  const shards = new Map<string, ReviewDetailShard>();
  for (const p of ordered) {
    const our = joined.get(p.hgab_id)!.row;
    const path = detailShardPath(p.seq);
    const shard = shards.get(path) ?? {};
    shard[p.hgab_id] = {
      page: p.page, bill_doc: our.doc, bill_page: our.page, pap: our.pap, join_method: p.join_method, proposal_code: p.proposal_code,
      proposal_types_without_files: p.notes.includes("proposal_types_without_files"),
      flags: p.review_flags, missing_upstream: p.missing_flags_upstream, notes: p.notes,
      files: (filesBy.get(p.hgab_id) ?? []).map((f): DetailFile => [f.source, f.link_method, f.doc_type, f.source_type, f.name, f.url, f.bytes, f.archived, f.folder_code]),
    };
    shards.set(path, shard);
  }
  rmSync(resolve(out, DOCUMENTS_DIR, "detail"), { recursive: true, force: true });
  mkdirSync(resolve(out, DOCUMENTS_DIR, "detail"), { recursive: true });
  for (const [path, shard] of shards) writeFileSync(resolve(out, path), JSON.stringify(shard));
  return {
    auto_review: {
      method: AUTO_REVIEW.method,
      projects: Object.keys(index.auto!.rows).length,
      php: rows.filter((r) => index.auto!.rows[r[0]]).reduce((s, r) => s + r[6], 0),
      by_rule: Object.fromEntries(AUTO_REVIEW.rules.map((x, i) => [x.code, Object.values(index.auto!.rows).filter((a) => a.r.includes(i)).length])),
    },
    nep_comparison: {
      ours_house_only: projects.filter(ourHouseOnly).length,
      research_potential_insertion: projects.filter(researchInsertion).length,
      both: projects.filter((p) => ourHouseOnly(p) && researchInsertion(p)).length,
      ours_only: projects.filter((p) => ourHouseOnly(p) && !researchInsertion(p)).length,
      research_only: projects.filter((p) => !ourHouseOnly(p) && researchInsertion(p)).length,
    },
    index: { file: REVIEW_INDEX_PATH.replace(`${DOCUMENTS_DIR}/`, ""), rows: rows.length, bytes: statSync(resolve(out, REVIEW_INDEX_PATH)).size },
    detail: { shards: shards.size, rows_per_shard: DETAIL_SHARD_ROWS, bytes: [...shards.keys()].reduce((s, k) => s + statSync(resolve(out, k)).size, 0) },
  };
}

async function writeParquet<T extends object>(c: DuckDBConnection, out: string, rows: T[], columns: Record<keyof T & string, string>): Promise<void> {
  const tmp = `${out}.ndjson`;
  writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join("\n"));
  const cols = Object.entries(columns).map(([k, t]) => `'${k}': '${t}'`).join(", ");
  await c.run(`COPY (SELECT * FROM read_json('${tmp}', format = 'newline_delimited', columns = {${cols}})) TO '${out}' (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 2048)`);
  rmSync(tmp);
}

main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exit(1); });
