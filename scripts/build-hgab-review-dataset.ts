/**
 * npm run build:hgab-review-dataset — the House bill's DPWH projects, their documents and their red flags as a
 * download, for anyone to run their own analysis. Docs: docs/hgab-documents.md ("Downloads").
 *
 * Reads what build:hgab-documents wrote (data/hgab/2027/documents/: review.json, detail/NN.json, files.parquet)
 * and the live Senate file list (supporting-documents-file-links.jsonl on budget-assets, or --links=<path>) for
 * which Senate copies are redacted today.
 *
 * Writes data/hgab/2027/documents/downloads/:
 *   house-bill-2027-dpwh-projects.csv / .parquet     one row per DPWH project in the House bill
 *   house-bill-2027-dpwh-documents.csv / .parquet    one row per document tied to a project
 *   house-bill-2027-dpwh-red-flags.csv / .parquet    one row per project and red flag
 *   README.md                                        the data dictionary and caveats
 *   manifest.json                                    sources, counts and checksums
 *   house-bill-2027-dpwh-dataset.zip                 the CSVs and the README in one file
 * Publish: npm run upload:hgab -- --only=documents/downloads
 *
 * What it never holds: members' reviews or anything from them (final statuses, check outcomes, notes, names), the
 * automatic review's status or score, and links to Senate copies that aren't redacted yet (they are listed, with
 * `redacted` false and no link, as the reviewer shows them). The build fails if a column looks like review data.
 * CSVs are UTF-8 with a byte-order mark (so Excel reads ñ and ₱); Parquet keeps the types.
 */
import { DuckDBInstance } from "@duckdb/node-api";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FLAG_FAMILIES, NAMED_TYPES, parseHgabId, type ReviewIndex } from "../src/lib/hgab-documents";
import { INSERTION_FLAG, LINK_LABEL } from "../src/lib/hgab-review";
import { SENATE_REGIONS_HELD_BACK, heldBackRegion } from "../src/lib/senate-copies-held-back";

const ROOT = resolve("data/hgab/2027/documents");
const OUT = resolve(ROOT, "downloads");
const SITE = "https://budget.bettergov.ph";
const ASSETS = "https://budget-assets.bettergov.ph";
const LINKS_URL = `${ASSETS}/hgab/2027/dpwh/supporting-documents-file-links.jsonl`;
const SENATE_PREFIX = "hgab/2027/dpwh/supporting-documents/";
const STEM = "house-bill-2027-dpwh";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");
const fail = (msg: string): never => { console.error(`\n✗ ${msg}\nNothing written.`); process.exit(1); };
const ensure = (ok: boolean, msg: string) => { if (!ok) fail(msg); };
/** Reader words, as on the site: "House bill", not HGAB; "budget", not money. */
const readerText = (s: string) => s.replace(/\bHGAB\b/g, "House bill").replace(/\bmoney\b/gi, "budget");

type Cell = string | number | boolean | null;
interface Column { name: string; type: "VARCHAR" | "BIGINT" | "INTEGER" | "BOOLEAN"; about: string }
interface Table { key: string; title: string; about: string; columns: Column[]; rows: Record<string, Cell>[] }

// --- Inputs ---------------------------------------------------------------------------------------------------------

const ix = JSON.parse(readFileSync(resolve(ROOT, "review.json"), "utf8")) as ReviewIndex;
const detail: Record<string, { page: number; bill_doc: string; bill_page: number; pap: string | null; join_method: string; proposal_code: string | null; flags: { code: string; label: string; value: number | null; evidence: string[] }[] }> = {};
for (const f of readdirSync(resolve(ROOT, "detail")).filter((x) => x.endsWith(".json")).sort()) {
  Object.assign(detail, JSON.parse(readFileSync(resolve(ROOT, "detail", f), "utf8")));
}

/** The live Senate file list: which copies are redacted today, and the size and checksum of the file served. */
async function senateList(): Promise<{ text: string; source: string }> {
  const path = arg("links");
  if (path) return { text: readFileSync(path, "utf8"), source: path };
  const res = await fetch(LINKS_URL, { headers: { "User-Agent": "Mozilla/5.0 (budget.bettergov.ph dataset build)" } });
  ensure(res.ok, `Couldn't fetch ${LINKS_URL}: ${res.status}`);
  return { text: await res.text(), source: LINKS_URL };
}
const links = await senateList();
const senate = new Map<string, { redacted: boolean; bytes: number | null; sha256: string | null }>();
for (const line of links.text.split("\n")) {
  if (!line.trim()) continue;
  const r = JSON.parse(line) as { object_key: string; redacted?: boolean; bytes?: number; sha256?: string };
  senate.set(r.object_key, { redacted: !!r.redacted, bytes: r.bytes ?? null, sha256: r.sha256 ?? null });
}
ensure(senate.size > 30_000, `The Senate file list has only ${senate.size} files.`);

const db = await DuckDBInstance.create(":memory:");
const con = await db.connect();
type FileRow = { hgab_id: string; source: string; folder_code: string | null; file_link_id: number | null; doc_type: string; source_type: string | null; name: string; url: string; archived: boolean; link_method: string };
const files = (await (await con.run(`SELECT hgab_id, source, folder_code, file_link_id, doc_type, source_type, name, url, archived, link_method FROM '${resolve(ROOT, "files.parquet")}' ORDER BY hgab_id, source DESC, doc_type, name`)).getRowObjectsJS()) as unknown as FileRow[];

// --- Documents ------------------------------------------------------------------------------------------------------

/** A Senate copy's R2 key from its public address. */
const senateKey = (url: string) => decodeURIComponent(new URL(url).pathname.slice(1));
const docs: Record<string, Cell>[] = files.map((f) => {
  const isSenate = f.source === "senate";
  const s = isSenate ? senate.get(senateKey(f.url)) : undefined;
  if (isSenate && !s) console.warn(`  not in the Senate file list: ${f.url}`);
  const redacted = isSenate ? !!s?.redacted : null;
  // A region held back by hand (src/lib/senate-copies-held-back.ts) gets no links yet, redacted or not, as in the reviewer.
  const held = isSenate && !!heldBackRegion(senateKey(f.url).slice(SENATE_PREFIX.length));
  return {
    hgab_id: f.hgab_id,
    source: isSenate ? "senate_copy" : "dpwh_transparency",
    folder_code: f.folder_code,
    document_type: f.doc_type,
    label_in_source: f.source_type,
    file_name: f.name,
    earlier_copy: !!f.archived,
    matched_by: f.link_method,
    redacted,
    // Senate copies link only once redacted, as the reviewer opens them; DPWH Transparency files are public on its site.
    url: isSenate ? (redacted && !held ? f.url : null) : f.url,
    bytes: s?.bytes ?? null,
    sha256: s?.sha256 ?? null,
    senate_file_id: isSenate ? f.file_link_id : null,
  };
});

// --- Red flags ------------------------------------------------------------------------------------------------------

const flagMeta = ix.flags;
const familyOf = (code: string) => FLAG_FAMILIES.find((f) => f.re.test(code))?.key ?? null;
const flags: Record<string, Cell>[] = [];
for (const [hgabId, , , , , , , flagIdx] of ix.rows) {
  // research.bettergov.ph's flags, with the value and evidence it publishes; then ours (missing documents with our
  // matching, and our NEP comparison).
  for (const f of detail[hgabId]?.flags ?? []) {
    flags.push({ hgab_id: hgabId, flag_code: f.code, flag: readerText(f.label), family: familyOf(f.code), source: "research.bettergov.ph", value_php: f.value, evidence: f.evidence.map(readerText).join(" | ") || null });
  }
  for (const i of flagIdx) {
    const m = flagMeta[i];
    if (m.source !== "bettergov") continue;
    flags.push({ hgab_id: hgabId, flag_code: m.code, flag: readerText(m.label), family: m.family ?? familyOf(m.code), source: "budget.bettergov.ph", value_php: null, evidence: m.note ? readerText(m.note) : null });
  }
}

// --- Projects -------------------------------------------------------------------------------------------------------

const byProject = new Map<string, { senate: number; redacted: number; dpwh: number }>();
for (const d of docs) {
  const c = byProject.get(d.hgab_id as string) ?? { senate: 0, redacted: 0, dpwh: 0 };
  if (d.source === "senate_copy") { c.senate++; if (d.redacted) c.redacted++; } else c.dpwh++;
  byProject.set(d.hgab_id as string, c);
}
const flagsByProject = new Map<string, Set<string>>();
const flagRowsByProject = new Map<string, number>();
for (const f of flags) {
  const h = f.hgab_id as string;
  (flagsByProject.get(h) ?? flagsByProject.set(h, new Set()).get(h)!).add(f.flag_code as string);
  flagRowsByProject.set(h, (flagRowsByProject.get(h) ?? 0) + 1);
}
const has = (mask: number, i: number) => ((mask >> i) & 1) === 1;
const insertionIdx = flagMeta.findIndex((f) => f.code === INSERTION_FLAG);
ensure(insertionIdx >= 0, `review.json has no ${INSERTION_FLAG} flag.`);
const projects: Record<string, Cell>[] = ix.rows.map(([hgabId, projectId, title, oi, ri, pi, amount, flagIdx, mask]) => {
  const d = detail[hgabId];
  const office = ix.offices[oi];
  const id = parseHgabId(hgabId);
  const c = byProject.get(hgabId) ?? { senate: 0, redacted: 0, dpwh: 0 };
  return {
    hgab_id: hgabId,
    bill_pdf_page: id?.page ?? null,
    bill_row: id?.seq ?? null,
    title,
    amount_php: amount,
    region: ix.regions[ri],
    dpwh_office: office.name,
    office_scope: !office.districts.length ? "no_district" : office.tier === "A" ? "lone_district" : "shared_districts",
    legislative_districts: office.districts.join("; ") || null,
    program: ix.programs[pi] || null,
    pap: d?.pap ?? null,
    house_insertion: flagIdx.includes(insertionIdx),
    red_flags: flagRowsByProject.get(hgabId) ?? 0,
    red_flag_codes: [...(flagsByProject.get(hgabId) ?? [])].sort().join("; ") || null,
    key_documents_found: NAMED_TYPES.reduce((n, _, i) => n + (has(mask, i) ? 1 : 0), 0),
    has_pow: has(mask, 0),
    has_bp202: has(mask, 1),
    has_development_council: has(mask, 2),
    has_geotagged_photos: has(mask, 3),
    has_certificate_of_implementability: has(mask, 4),
    senate_files: c.senate,
    senate_files_redacted: c.redacted,
    dpwh_transparency_files: c.dpwh,
    dpwh_proposal_code: d?.proposal_code ?? null,
    house_bill_pdf: d ? `${ASSETS}/hgab/2027/pdf/${d.bill_doc}.pdf#page=${d.bill_page}` : null,
    project_page: `${SITE}/hgab/2027/dpwh/p/${encodeURIComponent(projectId)}`,
    reviewer_page: `${SITE}/hgab/2027/review?p=${encodeURIComponent(hgabId)}`,
  };
});

// --- Tables ---------------------------------------------------------------------------------------------------------

const tables: Table[] = [
  {
    key: `${STEM}-projects`,
    title: "DPWH projects in the House bill",
    about: "Every DPWH project in the FY2027 House bill (HB 10858, third reading, Vol. I-C), one row each, with the documents found for it and its red flags. No review data.",
    rows: projects,
    columns: [
      { name: "hgab_id", type: "VARCHAR", about: "The project's row in the House bill: HB10858-3-<PDF page>-<row>. Stable; join the other files on it." },
      { name: "bill_pdf_page", type: "INTEGER", about: "PDF page of Vol. I-C that prints the project." },
      { name: "bill_row", type: "INTEGER", about: "Row number in the bill's DPWH list." },
      { name: "title", type: "VARCHAR", about: "Project title, as published." },
      { name: "amount_php", type: "BIGINT", about: "Amount in the House bill, in pesos." },
      { name: "region", type: "VARCHAR", about: "Region, as the bill groups the project." },
      { name: "dpwh_office", type: "VARCHAR", about: "DPWH implementing office (district engineering office, regional office or Central Office)." },
      { name: "office_scope", type: "VARCHAR", about: "lone_district: the office serves one legislative district; shared_districts: several; no_district: Central Office or a regional office." },
      { name: "legislative_districts", type: "VARCHAR", about: "Legislative districts the office serves, separated by \"; \". Where the office serves several, the project is not split among them." },
      { name: "program", type: "VARCHAR", about: "DPWH program." },
      { name: "pap", type: "VARCHAR", about: "Program, activity or project line it sits under." },
      { name: "house_insertion", type: "BOOLEAN", about: "true when our comparison finds the project in the House bill only, not in the NEP: a candidate insertion, not a finding." },
      { name: "red_flags", type: "INTEGER", about: "How many red flags the project has (rows in the red-flags file)." },
      { name: "red_flag_codes", type: "VARCHAR", about: "Its red-flag codes, separated by \"; \"." },
      { name: "key_documents_found", type: "INTEGER", about: "How many of the five key documents were found: program of work, BP 202, development council endorsement, geotagged photos, certificate of implementability." },
      { name: "has_pow", type: "BOOLEAN", about: "Program of work found." },
      { name: "has_bp202", type: "BOOLEAN", about: "BP 202 (project profile) found." },
      { name: "has_development_council", type: "BOOLEAN", about: "Regional or local development council endorsement found." },
      { name: "has_geotagged_photos", type: "BOOLEAN", about: "Geotagged photos found." },
      { name: "has_certificate_of_implementability", type: "BOOLEAN", about: "Certificate of implementability found." },
      { name: "senate_files", type: "INTEGER", about: "Documents DPWH gave the Senate for this project (Senate copies)." },
      { name: "senate_files_redacted", type: "INTEGER", about: "Of those, how many have had signatures redacted (the ones with a link in the documents file)." },
      { name: "dpwh_transparency_files", type: "INTEGER", about: "Documents DPWH published for its NEP proposal, on DPWH Transparency." },
      { name: "dpwh_proposal_code", type: "VARCHAR", about: "DPWH Transparency proposal code paired with the project (2027DPWH-Proposal-…)." },
      { name: "house_bill_pdf", type: "VARCHAR", about: "The House bill page that prints the project." },
      { name: "project_page", type: "VARCHAR", about: "The project's page on budget.bettergov.ph: NEP and House bill side by side." },
      { name: "reviewer_page", type: "VARCHAR", about: "The project in the project reviewer, with its documents." },
    ],
  },
  {
    key: `${STEM}-documents`,
    title: "Documents for each project",
    about: "Every document tied to a project: the Senate copies (documents DPWH gave the Senate for the House bill) and DPWH Transparency files (DPWH's documents for its NEP proposals). A file can be tied to more than one project.",
    rows: docs,
    columns: [
      { name: "hgab_id", type: "VARCHAR", about: "The project (projects file)." },
      { name: "source", type: "VARCHAR", about: "senate_copy or dpwh_transparency." },
      { name: "folder_code", type: "VARCHAR", about: "The folder: 2027DPWH-HGAB-… for Senate copies (DPWH's numbering, not the bill row), 2027DPWH-Proposal-… for DPWH Transparency." },
      { name: "document_type", type: "VARCHAR", about: "POW, BP 202, Development Council, Geotagged photos, Certificate of Implementability, or Other." },
      { name: "label_in_source", type: "VARCHAR", about: "The type as the source labels it." },
      { name: "file_name", type: "VARCHAR", about: "File name." },
      { name: "earlier_copy", type: "BOOLEAN", about: "true for an earlier copy kept beside the current one." },
      { name: "matched_by", type: "VARCHAR", about: `How the file was tied to the project: ${Object.entries(LINK_LABEL).map(([k, v]) => `${k} (${v.charAt(0).toLowerCase()}${v.slice(1)})`).join("; ")}. tracker is the weakest. Matches can be wrong.` },
      { name: "redacted", type: "BOOLEAN", about: "Senate copies: true once signatures and handwriting are redacted. Empty for DPWH Transparency files." },
      { name: "url", type: "VARCHAR", about: "Where to get the file. Senate copies have one only once redacted (and their region isn't held back while it is checked)." },
      { name: "bytes", type: "BIGINT", about: "Senate copies: size of the file served today." },
      { name: "sha256", type: "VARCHAR", about: "Senate copies: SHA-256 of the file served today." },
      { name: "senate_file_id", type: "INTEGER", about: "Senate copies: the file's id in the Senate file list." },
    ],
  },
  {
    key: `${STEM}-red-flags`,
    title: "Red flags for each project",
    about: "Every red flag on every project: research.bettergov.ph's, and ours (missing documents after our matching; our NEP comparison). A red flag is a reason to look, not a finding.",
    rows: flags,
    columns: [
      { name: "hgab_id", type: "VARCHAR", about: "The project (projects file)." },
      { name: "flag_code", type: "VARCHAR", about: "Stable code of the flag." },
      { name: "flag", type: "VARCHAR", about: "The flag, in words." },
      { name: "family", type: "VARCHAR", about: `Kind of flag: ${FLAG_FAMILIES.map((f) => `${f.key} (${f.label})`).join(", ")}.` },
      { name: "source", type: "VARCHAR", about: "research.bettergov.ph, or budget.bettergov.ph for ours." },
      { name: "value_php", type: "BIGINT", about: "An amount the flag is about, in pesos, where it has one." },
      { name: "evidence", type: "VARCHAR", about: "The source's evidence or note for the flag; several separated by \" | \"." },
    ],
  },
];

// --- Checks (nothing is written unless they all pass) ---------------------------------------------------------------

ensure(projects.length === ix.rows.length, `projects: ${projects.length}, review.json: ${ix.rows.length}`);
ensure(new Set(projects.map((p) => p.hgab_id)).size === projects.length, "A project appears twice.");
const ids = new Set(projects.map((p) => p.hgab_id as string));
ensure(docs.every((d) => ids.has(d.hgab_id as string)), "A document belongs to no project.");
ensure(flags.every((f) => ids.has(f.hgab_id as string)), "A red flag belongs to no project.");
ensure(docs.length === files.length, `documents: ${docs.length}, files.parquet: ${files.length}`);
ensure(docs.every((d) => d.source !== "senate_copy" || d.redacted || d.url === null), "A Senate copy that isn't redacted has a link.");
const sumBill = ix.rows.reduce((a, r) => a + r[6], 0);
ensure(projects.reduce((a, p) => a + (p.amount_php as number), 0) === sumBill, "Project amounts don't add up to review.json's.");
for (const t of tables) {
  const names = t.columns.map((c) => c.name);
  ensure(names.every((n) => !/review(?!er_page)|verdict|status|member|email|outcome|\bauto|score|note/i.test(n)), `${t.key}: a column looks like review data (${names.join(", ")}).`);
  for (const r of t.rows.slice(0, 50)) ensure(Object.keys(r).join() === names.join(), `${t.key}: columns out of step.`);
}

// --- Write ----------------------------------------------------------------------------------------------------------

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const csvCell = (v: Cell) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const fileInfo = (name: string) => {
  const buf = readFileSync(resolve(OUT, name));
  return { file: name, bytes: buf.length, sha256: sha256(buf) };
};
const written: { key: string; title: string; about: string; rows: number; csv: ReturnType<typeof fileInfo>; parquet: ReturnType<typeof fileInfo>; columns: Column[] }[] = [];
for (const t of tables) {
  const csv = `\uFEFF${[t.columns.map((c) => c.name).join(","), ...t.rows.map((r) => t.columns.map((c) => csvCell(r[c.name])).join(","))].join("\n")}\n`;
  writeFileSync(resolve(OUT, `${t.key}.csv`), csv);
  // Parquet with the declared types, through newline-delimited JSON (nulls stay nulls).
  const tmp = resolve(OUT, `.${t.key}.ndjson`);
  writeFileSync(tmp, t.rows.map((r) => JSON.stringify(r)).join("\n"));
  const cols = `{${t.columns.map((c) => `'${c.name}': '${c.type}'`).join(", ")}}`;
  await con.run(`COPY (SELECT ${t.columns.map((c) => `"${c.name}"`).join(", ")} FROM read_json('${tmp}', format = 'newline_delimited', columns = ${cols}))
    TO '${resolve(OUT, `${t.key}.parquet`)}' (FORMAT parquet, COMPRESSION zstd)`);
  rmSync(tmp);
  const back = (await (await con.run(`SELECT count(*) FROM '${resolve(OUT, `${t.key}.parquet`)}'`)).getRowsJS())[0][0];
  ensure(Number(back) === t.rows.length, `${t.key}.parquet has ${back} rows, expected ${t.rows.length}.`);
  written.push({ key: t.key, title: t.title, about: t.about, rows: t.rows.length, csv: fileInfo(`${t.key}.csv`), parquet: fileInfo(`${t.key}.parquet`), columns: t.columns });
}

const builtAt = new Date().toISOString();
const asOf = builtAt.slice(0, 10);
const redactedSenate = docs.filter((d) => d.redacted).length, allSenate = docs.filter((d) => d.source === "senate_copy").length;
const srcManifest = JSON.parse(readFileSync(resolve(ROOT, "manifest.json"), "utf8")) as { built_at: string; sources: Record<string, { url: string; sha256: string } | unknown> };
const fmt = (n: number) => n.toLocaleString("en-US");
const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`;
const readme = [
  `# DPWH projects in the FY2027 House bill: documents and red flags`,
  "",
  `Built ${asOf} by budget.bettergov.ph (\`npm run build:hgab-review-dataset\`). Project reviewer: ${SITE}/hgab/2027/review`,
  "",
  "Independent and unofficial: our reading of the published documents, not an official record. Amounts are as published, not spending. A red flag is a reason to look, not a finding, and a document tied to a project is a match that can be wrong.",
  "",
  "## What's here",
  "",
  `- ${fmt(projects.length)} DPWH projects in the House bill (HB 10858, third reading, Vol. I-C), ₱${fmt(sumBill)} in all.`,
  `- ${fmt(docs.length)} documents tied to them: ${fmt(allSenate)} Senate copies (${fmt(redactedSenate)} redacted, with a link) and ${fmt(docs.length - allSenate)} DPWH Transparency files.`,
  `- ${fmt(flags.length)} red flags.`,
  "",
  "Not here: volunteers' reviews of the projects, which are not published. Join the three files on `hgab_id`.",
  "",
  "## Sources",
  "",
  "- House Bill 10858, General Appropriations Bill FY2027, third reading, Vol. I-C (Senate Budget Transparency Portal); copies at budget-assets.bettergov.ph/hgab/2027/pdf/.",
  "- research.bettergov.ph (nep-preview): document coverage, red flags and DPWH Transparency records for every House bill DPWH row.",
  "- The documents DPWH gave the Senate for the House bill (\"Senate copies\"), listed in supporting-documents-file-links.jsonl on budget-assets.bettergov.ph.",
  "- DPWH Transparency (s3.infrawatch.ph): DPWH's documents for its NEP proposals.",
  `- Documents and flags as built ${srcManifest.built_at.slice(0, 10)}; Senate redaction status as of ${asOf}.`,
  "",
  "## Conventions",
  "",
  "- Amounts are integer pesos. An empty cell means none or not known, not zero.",
  "- Names and titles are as published, including the documents' own spelling.",
  "- CSVs are UTF-8 with a byte-order mark, comma-separated. The Parquet files hold the same rows with their types (whole numbers, true/false).",
  "- Lists inside a cell are separated by \"; \" (evidence by \" | \").",
  "- Signatures and handwriting in the Senate copies are being redacted for privacy, region by region. Until a copy is redacted its row has `redacted` false and no link. Redacted copies replace the originals at the same address.",
  `- A region whose redacted copies are still being checked is held back: its copies have no link yet. Held back on ${asOf}: ${SENATE_REGIONS_HELD_BACK.join(", ") || "none"}.`,
  "- `matched_by` says how a file was tied to its project (see the documents file's columns). `reviewed` means we settled a disputed folder by reading its program of work; it has nothing to do with volunteers' reviews.",
  "",
  "## Files",
  "",
  ...written.flatMap((w) => [
    `### ${w.csv.file} (also ${w.parquet.file})`, "", `${w.about} ${fmt(w.rows)} rows.`, "",
    "| Column | Meaning |", "| --- | --- |", ...w.columns.map((c) => `| \`${c.name}\` | ${c.about.replace(/\|/g, "\\|")} |`), "",
  ]),
  `### ${STEM}-dataset.zip`, "", "The three CSVs and this README in one file.", "",
  "## Licence and credit",
  "",
  "Free to use, with credit to budget.bettergov.ph and research.bettergov.ph. The government documents are public records.",
  "",
].join("\n");
writeFileSync(resolve(OUT, "README.md"), readme);

const zipName = `${STEM}-dataset.zip`;
execFileSync("python3", ["-I", "-c", `import sys, zipfile
out, *names = sys.argv[1:]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for n in names: z.write(n, n.rsplit('/', 1)[-1])`, resolve(OUT, zipName), ...written.map((w) => resolve(OUT, w.csv.file)), resolve(OUT, "README.md")]);

const manifest = {
  schema: 1,
  title: "DPWH projects in the FY2027 House bill: documents and red flags",
  built_at: builtAt,
  as_of: asOf,
  site: `${SITE}/hgab/2027/review`,
  not_included: "Volunteers' reviews and anything from them; links to Senate copies not yet redacted.",
  sources: {
    documents_build: { built_at: srcManifest.built_at, sources: srcManifest.sources },
    senate_file_list: { url: LINKS_URL, read_from: links.source, sha256: sha256(links.text), files: senate.size },
  },
  totals: { projects: projects.length, amount_php: sumBill, documents: docs.length, senate_copies: allSenate, senate_copies_redacted: redactedSenate, red_flags: flags.length },
  files: [
    ...written.map((w) => ({ key: w.key, title: w.title, rows: w.rows, csv: w.csv, parquet: w.parquet, columns: w.columns.map((c) => ({ name: c.name, type: c.type })) })),
    { key: "readme", ...fileInfo("README.md") },
    { key: "zip", ...fileInfo(zipName) },
  ],
};
writeFileSync(resolve(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);

console.log(`\n✓ ${OUT.replace(process.cwd() + "/", "")} (as of ${asOf})`);
for (const w of written) console.log(`  ${w.key.padEnd(34)} ${fmt(w.rows).padStart(7)} rows  csv ${mb(w.csv.bytes).padStart(8)}  parquet ${mb(w.parquet.bytes).padStart(8)}`);
console.log(`  ${zipName.padEnd(34)} ${mb(statSync(resolve(OUT, zipName)).size).padStart(26)}`);
console.log(`  Senate copies: ${fmt(allSenate)}, ${fmt(redactedSenate)} redacted (linked)`);
