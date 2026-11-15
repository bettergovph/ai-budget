/**
 * verify:hgab section for "Multi-purpose buildings or classrooms?" (mpb-documents/; scripts/build-mpb-documents.ts):
 * the summary recomputed from projects.json on the verifier's own path, every project a House bill multi-purpose
 * building line at its amount, the outputs' checksums, the CSV beside the JSON, and the page's copy.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeMpbLines, type MpbLinesFile } from "../src/lib/hgab-mpb-years";
import { MPB_DOCS_TITLE, decodeMpbDocProjects, type MpbDocsProjectsFile, type MpbDocsSummary } from "../src/lib/mpb-documents";

type Check = (name: string, ok: boolean, detail?: string) => void;
interface Opts { out: string; readerCopyHits: (s: string) => string[] }

const readJson = <T,>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

export function verifyMpbDocuments(check: Check, o: Opts): void {
  process.stdout.write("\nmpb-documents/ (multi-purpose buildings or classrooms?)\n");
  const dir = resolve(o.out, "mpb-documents");
  const files = ["summary.json", "projects.json", "projects.csv"].map((f) => resolve(dir, f));
  check("summary.json, projects.json and projects.csv present (npm run build:mpb-documents)", files.every(existsSync), dir);
  if (!files.every(existsSync)) return;
  const S = readJson<MpbDocsSummary>(files[0]);
  const P = decodeMpbDocProjects(readJson<MpbDocsProjectsFile>(files[1]));
  const lines = decodeMpbLines(readJson<MpbLinesFile>(resolve(o.out, "mpb-years/lines.json")));
  const house = new Map(lines.lines.filter((l) => l.fy === 2027 && l.house != null).map((l) => [l.id, l.house!]));
  const inserted = new Set(lines.lines.filter((l) => l.fy === 2027 && l.house != null && l.cls === "house_only").map((l) => l.id));

  const off = P.filter((p) => house.get(p.id) !== p.php || !inserted.has(p.id) || !p.inserted).map((p) => p.id);
  check(`every project in the tally (${P.length.toLocaleString("en-US")}) is a multi-purpose building line the House inserted, at the map's amount`,
    off.length === 0 && new Set(P.map((p) => p.id)).size === P.length, off.slice(0, 4).join(", "));
  const houseTotal = [...house.values()].reduce((a, v) => a + v, 0);
  check("coverage: the House bill's lines and insertions as the map counts them; with and without documents add up; read within those with documents",
    S.coverage.house.lines === house.size && S.coverage.house.php === houseTotal && S.coverage.insertions.lines === inserted.size
      && S.coverage.with_documents.lines + S.coverage.without_documents.lines === S.coverage.insertions.lines
      && S.coverage.read.lines === P.length && S.coverage.read.lines <= S.coverage.with_documents.lines,
    `${S.coverage.house.lines} / ${house.size}, ${S.coverage.insertions.lines} / ${inserted.size}`);

  const ov = readJson<{ datasets: Array<{ bridge?: { house_only?: { rows: number; php: number } } }> }>(resolve(o.out, "overview.json")).datasets[0].bridge?.house_only;
  const d = S.coverage.dpwh;
  check("coverage: all DPWH House insertions as overview.json counts them, with and without documents adding up, at least the MPB insertions",
    d.insertions.lines === ov?.rows && d.insertions.php === ov?.php && d.with_documents.lines + d.without_documents.lines === d.insertions.lines
      && d.with_documents.php + d.without_documents.php === d.insertions.php && d.insertions.lines >= S.coverage.insertions.lines
      && d.with_documents.lines >= S.coverage.with_documents.lines,
    `${d.insertions.lines} / ${ov?.rows}`);
  const tally = (f: (p: (typeof P)[number]) => boolean) => {
    const sel = P.filter(f);
    return { lines: sel.length, php: sel.reduce((a, p) => a + p.php, 0) };
  };
  const same = (a: { lines: number; php: number }, b: { lines: number; php: number }) => a.lines === b.lines && a.php === b.php;
  const badCats = S.categories.filter((c) => !same(c, tally((p) => p.category === c.key))
    || c.at_school !== P.filter((p) => p.category === c.key && p.atSchool === "yes").length).map((c) => c.key);
  check("each kind of building: its projects, amount and those at a school recompute from projects.json",
    badCats.length === 0 && same(S.coverage.read, tally(() => true)), badCats.join(", "));
  const badYn = (["yes", "no", "unclear"] as const).filter((k) => !same(S.classroom[k], tally((p) => p.classroom === k))
    || !same(S.at_school[k], tally((p) => p.atSchool === k)));
  const badMm = S.mismatch.filter((m) => !same(m, tally((p) => p.mismatch === m.key))).map((m) => m.key);
  check("classrooms, at a school and documents that differ recompute from projects.json", badYn.length === 0 && badMm.length === 0,
    [...badYn, ...badMm].join(", "));
  check("every check the build ran passed", S.checks.length > 0 && S.checks.every((c) => c.ok), S.checks.filter((c) => !c.ok).map((c) => c.key).join(", "));
  const outOff = (["projects.json", "projects.csv"] as const).filter((f) => S.outputs[f]?.sha256 !== sha(resolve(dir, f)));
  check("summary.json records the SHA-256 of projects.json and projects.csv (the CSV link's ?v=)", outOff.length === 0, outOff.join(", "));
  const csvRows = readFileSync(files[2], "utf8").replace(/^\uFEFF/, "").split("\n").filter(Boolean);
  // A quoted field may hold a line break; count rows by the record URL each one ends with.
  const ends = csvRows.filter((r) => /\/hgab\/2027\/review\?p=[^,]+$/.test(r)).length;
  check("projects.csv: one row per project read", ends === P.length, `${ends} rows, ${P.length} projects`);
  const copy = [MPB_DOCS_TITLE].flatMap(o.readerCopyHits);
  check("the page title uses plain words", copy.length === 0, copy.join(", "));
}
