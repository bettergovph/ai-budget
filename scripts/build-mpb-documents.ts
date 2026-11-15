/**
 * "Multi-purpose buildings or classrooms?": the House bill's multi-purpose building projects, tallied by what their own
 * documents say they are (src/lib/mpb-documents.ts; docs/hgab-mpb-documents.md).
 *
 * Inputs:
 *   --records  the reading of the Senate copies, one JSON per project (default /data/senate-extract/all/records.jsonl;
 *              scripts/senate-extract/extract_projects.py on branch senate-redact, from the redacted copies only)
 *   data/hgab/2027/mpb-years/lines.json   the map's lines: the House bill's multi-purpose building lines
 *   data/hgab/2027/documents/files.parquet which lines have Senate copies (source = senate)
 * Outputs (data/hgab/2027/mpb-documents/): summary.json, projects.json, projects.csv.
 *
 * Usage: npx tsx scripts/build-mpb-documents.ts [--records=path] [--out=dir]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { decodeMpbLines, type MpbLinesFile } from "../src/lib/hgab-mpb-years";
import {
  MPB_DOCS_COLS, MPB_DOC_CATEGORIES, type MismatchKind, type MpbDocCategory, type MpbDocsSummary, type Tally, type YesNo,
} from "../src/lib/mpb-documents";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const ROOT = resolve(import.meta.dirname, "..");
const DATA = join(ROOT, "data/hgab/2027");
const RECORDS = resolve(args.records ?? "/data/senate-extract/all/records.jsonl");
const OUT = resolve(args.out ?? join(DATA, "mpb-documents"));
const MODEL = "glm-5.1";
const SCHEMA_VERSION = 3;

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`build-mpb-documents: ${msg}`); process.exit(1); }
}
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

interface Rec {
  project_id: string; hgab_id: string; house_title: string; house_amount_php: number; error: string | null;
  category: string; facility: string | null; at_school: string; classroom: string; title_mismatch: string | null;
  mismatch_kind: string | null; size: { storeys: number | null; classrooms: number | null; floor_area_sqm: number | null } | null;
  purpose: string | null; description: string | null; cost: { total_project_cost_php: number | null } | null;
  documents_read: string[] | null; confidence: string | null; quotes: { facility?: string | null; purpose?: string | null } | null;
  location: { barangay: string | null; municipality: string | null; province: string | null; site_name: string | null } | null;
}

async function main() {
  ensure(existsSync(RECORDS), `${RECORDS} missing: the reading of the Senate copies`);
  const lines = decodeMpbLines(JSON.parse(readFileSync(join(DATA, "mpb-years/lines.json"), "utf8")) as MpbLinesFile);
  const house = new Map(lines.lines.filter((l) => l.fy === 2027 && l.house != null).map((l) => [l.id, l]));
  const db = await DuckDBInstance.create(":memory:");
  const con = await db.connect();
  // Each line's Senate files (the Senate's copies of its DPWH documents).
  const filesOf = new Map((await con.runAndReadAll(`SELECT project_id, count(*) FROM read_parquet('${join(DATA, "documents/files.parquet")}')
    WHERE source = 'senate' GROUP BY 1`)).getRows().map((r) => [String(r[0]), Number(r[1])]));
  const withFiles = new Set(filesOf.keys());
  // Every DPWH line the House inserted, of any kind: the traces overview.json counts as House-only (scripts/build-hgab-d1.ts).
  const dpwhInserted = (await con.runAndReadAll(`SELECT id, hgab3_php FROM read_parquet('${join(DATA, "dpwh/projects.parquet")}')
    WHERE trace IN ('house_only_candidate', 'fuzzy_candidate', 'ambiguous')`)).getRows().map((r) => ({ id: String(r[0]), php: Number(r[1]) }));

  const recs = readFileSync(RECORDS, "utf8").split("\n").filter(Boolean).map((s) => JSON.parse(s) as Rec);
  // The tally: the House insertions (no matching NEP line). Lines read that are in the NEP too are counted apart.
  const mine = recs.filter((r) => house.get(r.project_id)?.cls === "house_only" && !r.error);
  const notInserted = recs.filter((r) => house.has(r.project_id) && house.get(r.project_id)!.cls !== "house_only" && !r.error);
  const checks: MpbDocsSummary["checks"] = [];
  const check = (key: string, ok: boolean, detail: string) => { checks.push({ key, ok, detail }); ensure(ok, `check ${key}: ${detail}`); };

  const t = (): Tally => ({ lines: 0, php: 0 });
  const add = (x: Tally, php: number) => { x.lines++; x.php += php; };
  const stage = () => ({ ...t(), insertions: t(), files: 0 });
  const dpwh = { insertions: t(), with_documents: { ...t(), files: 0 }, without_documents: t() };
  for (const d of dpwhInserted) {
    add(dpwh.insertions, d.php);
    if (withFiles.has(d.id)) { add(dpwh.with_documents, d.php); dpwh.with_documents.files += filesOf.get(d.id)!; } else add(dpwh.without_documents, d.php);
  }
  const cov = { dpwh, house: stage(), insertions: stage(), with_documents: stage(), without_documents: t(), read: stage(), read_not_inserted: t() };
  const into = (s: ReturnType<typeof stage>, l: (typeof lines.lines)[number]) => {
    add(s, l.house!);
    if (l.cls === "house_only") add(s.insertions, l.house!);
    s.files += filesOf.get(l.id) ?? 0;
  };
  for (const l of house.values()) {
    into(cov.house, l);
    if (l.cls !== "house_only") continue;
    into(cov.insertions, l);
    if (withFiles.has(l.id)) into(cov.with_documents, l); else add(cov.without_documents, l.house!);
  }
  for (const r of notInserted) add(cov.read_not_inserted, house.get(r.project_id)!.house!);
  const listed = { line_and_title: 0, line_only: 0, title_only: 0 };
  const byKind = new Map<string, number>();
  const cats = new Map<MpbDocCategory, Tally & { at_school: number }>();
  const yn = (): Record<YesNo, Tally> => ({ yes: t(), no: t(), unclear: t() });
  const classroom = yn(), atSchool = yn();
  const mismatch = new Map<MismatchKind, Tally>();
  const confidence = { high: 0, medium: 0, low: 0 };
  const rows: unknown[][] = [];
  const csv: string[][] = [];
  const merged: string[] = [];
  const amountOff: string[] = [];
  for (const r of mine) {
    const l = house.get(r.project_id)!;
    const php = l.house!;
    // A line the comparison merged from rows the bill prints twice: the record reads one of them; the tally uses the line.
    if (r.house_amount_php !== php) (r.house_amount_php > 0 && php % r.house_amount_php === 0 ? merged : amountOff).push(r.project_id);
    const cat = (MPB_DOC_CATEGORIES as readonly string[]).includes(r.category) ? (r.category as MpbDocCategory) : "unclear";
    const yes = (v: string): YesNo => (v === "yes" || v === "no" ? v : "unclear");
    into(cov.read, l);
    listed[l.rule === "pap+title" ? "line_and_title" : l.rule === "pap" ? "line_only" : "title_only"]++;
    for (const k of r.documents_read ?? []) byKind.set(k, (byKind.get(k) ?? 0) + 1);
    const c = cats.get(cat) ?? { ...t(), at_school: 0 };
    add(c, php);
    if (r.at_school === "yes") c.at_school++;
    cats.set(cat, c);
    add(classroom[yes(r.classroom)], php);
    add(atSchool[yes(r.at_school)], php);
    const mk = r.mismatch_kind as MismatchKind | null;
    if (mk) add(mismatch.get(mk) ?? (mismatch.set(mk, t()), mismatch.get(mk)!), php);
    if (r.confidence === "high" || r.confidence === "medium" || r.confidence === "low") confidence[r.confidence]++;
    const loc = r.location ?? { barangay: null, municipality: null, province: null, site_name: null };
    const row: unknown[] = [
      r.project_id, l.title, php, l.office, l.region, cat, r.facility, yes(r.at_school), yes(r.classroom), mk, mk ? r.title_mismatch : null,
      r.size?.storeys ?? null, r.size?.classrooms ?? null, r.size?.floor_area_sqm ?? null, r.purpose, r.description,
      r.cost?.total_project_cost_php ?? null, r.documents_read ?? [], r.confidence, r.quotes?.facility ?? null, r.quotes?.purpose ?? null,
      loc.barangay, loc.municipality, loc.province, loc.site_name, l.cls === "house_only" ? 1 : 0, filesOf.get(r.project_id) ?? 0,
    ];
    while (row.length && row[row.length - 1] == null) row.pop();
    rows.push(row);
    csv.push([
      r.project_id, r.hgab_id, l.title, String(php), l.office ?? "", l.region ?? "", cat, r.facility ?? "", yes(r.at_school), yes(r.classroom),
      mk ?? "", mk ? r.title_mismatch ?? "" : "", String(r.size?.storeys ?? ""), String(r.size?.classrooms ?? ""),
      String(r.size?.floor_area_sqm ?? ""), r.purpose ?? "", r.description ?? "", String(r.cost?.total_project_cost_php ?? ""),
      (r.documents_read ?? []).join("; "), r.confidence ?? "", r.quotes?.facility ?? "", r.quotes?.purpose ?? "",
      loc.barangay ?? "", loc.municipality ?? "", loc.province ?? "", loc.site_name ?? "",
      l.cls === "house_only" ? "yes" : "no", String(filesOf.get(r.project_id) ?? 0),
      `https://budget.bettergov.ph/hgab/2027/dpwh/p/${encodeURIComponent(r.project_id)}`,
      `https://budget.bettergov.ph/hgab/2027/review?p=${encodeURIComponent(r.project_id)}`,
    ]);
  }

  const sum = (xs: Tally[]) => xs.reduce((a, x) => ({ lines: a.lines + x.lines, php: a.php + x.php }), t());
  const catSum = sum([...cats.values()]);
  check("read:within-documents", mine.every((r) => withFiles.has(r.project_id)),
    `every insertion read (${cov.read.lines.toLocaleString("en-US")}) has Senate copies of its documents`);
  check("insertions:with-without", cov.with_documents.lines + cov.without_documents.lines === cov.insertions.lines
    && cov.with_documents.php + cov.without_documents.php === cov.insertions.php && cov.insertions.lines === cov.house.insertions.lines,
    `the ${cov.insertions.lines.toLocaleString("en-US")} House insertions: ${cov.with_documents.lines.toLocaleString("en-US")} with documents, ${cov.without_documents.lines.toLocaleString("en-US")} with none`);
  const overview = JSON.parse(readFileSync(join(DATA, "overview.json"), "utf8")) as { datasets: Array<{ bridge?: { house_only?: Tally & { rows: number } } }> };
  const ovIns = overview.datasets[0].bridge!.house_only!;
  const dpwhIds = new Set(dpwhInserted.map((d) => d.id));
  check("dpwh:insertions", dpwh.insertions.lines === ovIns.rows && dpwh.insertions.php === ovIns.php
    && [...house.values()].every((l) => l.cls !== "house_only" || dpwhIds.has(l.id)),
    `all DPWH House insertions (${dpwh.insertions.lines.toLocaleString("en-US")}) match overview.json, and hold every multi-purpose building insertion; ${dpwh.with_documents.lines.toLocaleString("en-US")} with documents, ${dpwh.without_documents.lines.toLocaleString("en-US")} with none`);
  check("categories:add-up", catSum.lines === cov.read.lines && catSum.php === cov.read.php,
    `the categories add up to the projects read: ${catSum.lines.toLocaleString("en-US")} lines, ₱${catSum.php.toLocaleString("en-US")}`);
  check("classroom:add-up", sum(Object.values(classroom)).php === cov.read.php, "classroom yes, no and unclear add up to the projects read");
  check("at-school:add-up", sum(Object.values(atSchool)).php === cov.read.php, "at a school yes, no and unclear add up to the projects read");
  check("amounts:house-bill", amountOff.length === 0,
    `each record's House bill amount equals the map's line, or is one of the rows it merges (${merged.length}: ${merged.join(", ") || "none"}); the tally uses the line`);
  check("listed:mpb", listed.line_and_title + listed.line_only + listed.title_only === cov.read.lines,
    `every project read is listed as a multi-purpose building: ${listed.line_and_title} on the line with an MPB title, ${listed.line_only} on the line, ${listed.title_only} by title`);
  check("errors", recs.filter((r) => house.get(r.project_id)?.cls === "house_only" && r.error).length === 0, "no insertion's reading failed");

  mkdirSync(OUT, { recursive: true });
  const builtAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  writeFileSync(join(OUT, "projects.json"), JSON.stringify({ schema: 1, built_at: builtAt, cols: MPB_DOCS_COLS, rows }) + "\n");
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = ["project_id", "house_bill_row", "title", "house_bill_php", "dpwh_office", "region", "category", "facility", "at_school",
    "classroom", "documents_differ", "documents_differ_note", "storeys", "classrooms", "floor_area_sqm", "purpose", "description",
    "documents_total_cost_php", "documents_read", "confidence", "quote_facility", "quote_purpose", "barangay", "municipality", "province",
    "site_name", "house_insertion", "senate_files", "record_url", "documents_url"];
  writeFileSync(join(OUT, "projects.csv"), "\uFEFF" + [header, ...csv].map((r) => r.map(q).join(",")).join("\n") + "\n");
  const out = (f: "projects.json" | "projects.csv") => ({ sha256: sha(join(OUT, f)), bytes: statSync(join(OUT, f)).size });
  const summary: MpbDocsSummary = {
    schema: 1,
    built_at: builtAt,
    source: { file: RECORDS, sha256: sha(RECORDS), records_written: statSync(RECORDS).mtime.toISOString().replace(/\.\d+Z$/, "Z"),
      model: MODEL, schema_version: SCHEMA_VERSION, records: recs.length },
    coverage: cov,
    listed,
    documents_read: { total: [...byKind.values()].reduce((a, v) => a + v, 0), by_kind: Object.fromEntries([...byKind].sort((a, b) => b[1] - a[1])) },
    categories: MPB_DOC_CATEGORIES.filter((k) => cats.has(k)).map((k) => ({ key: k, ...cats.get(k)! })).sort((a, b) => b.lines - a.lines),
    classroom, at_school: atSchool,
    mismatch: [...mismatch].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.php - a.php),
    confidence, checks,
    outputs: { "projects.json": out("projects.json"), "projects.csv": out("projects.csv") },
  };
  writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 1) + "\n");
  const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(1)}%`;
  console.log(`DPWH House insertions ${dpwh.insertions.lines}: with documents ${dpwh.with_documents.lines}, none ${dpwh.without_documents.lines}`);
  console.log(`House bill MPB: ${cov.house.lines} lines; insertions ${cov.insertions.lines}: with documents ${cov.with_documents.lines}, none ${cov.without_documents.lines}; read ${cov.read.lines} (${pct(cov.read.lines, cov.with_documents.lines)}); in the NEP too, read and left out: ${cov.read_not_inserted.lines}`);
  for (const c of summary.categories) console.log(`  ${c.key.padEnd(36)} ${String(c.lines).padStart(5)}  ₱${(c.php / 1e9).toFixed(2)}B  at a school ${c.at_school}`);
  console.log(`  classroom yes ${classroom.yes.lines} (₱${(classroom.yes.php / 1e9).toFixed(2)}B); different facility ${mismatch.get("different facility")?.lines ?? 0}`);
  console.log(`wrote ${OUT}: ${checks.length} checks passed`);
}

void main();
