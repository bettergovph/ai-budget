/**
 * The Senate committee report's removals, for the project reviewer's SENATE:REMOVED label and Senate filter (Jason,
 * 2026-11-21: "We now have the senate committee report which includes removals. We need to add another label of the
 * projects that were removed by the senate. Add 'SENATE:REMOVED'. You can also add it to the filters").
 *
 * Reads the Senate report pipeline's DPWH file (data/senate-cr/2027/dpwh_senate.csv, `npm run build:senate-cr`, PR
 * #106: one row per House bill DPWH project by our `id`, with the Senate's status) and the reviewer's project list
 * (data/hgab/2027/documents/review.json), and writes data/hgab/2027/documents/senate.json (`ReviewSenateIndex`): the
 * House bill rows the report cuts to zero ("cut", the report's removals; no project is cut partway), each with the Annex
 * A-4 page that lists it. Every removal must be a reviewer row, and every reviewer row must be in the Senate file.
 *
 * Usage: npm run build:hgab-review-senate   then publish with
 *        npm run upload:hgab -- --only=documents/senate.json --skip-verify
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { REVIEW_INDEX_PATH, REVIEW_SENATE_PATH, type ReviewIndex, type ReviewSenateIndex } from "../src/lib/hgab-documents";

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`build-hgab-review-senate: ${msg}`); process.exit(1); }
}

const ROOT = resolve(import.meta.dirname, "..");
const CSV = join(ROOT, "data/senate-cr/2027/dpwh_senate.csv");
const IX = join(ROOT, "data/hgab/2027", REVIEW_INDEX_PATH);
const OUT = join(ROOT, "data/hgab/2027", REVIEW_SENATE_PATH);
ensure(existsSync(CSV), `${CSV} not found (npm run build:senate-cr, on the Senate report branch)`);
ensure(existsSync(IX), `${IX} not found (npm run build:hgab-documents)`);

/** RFC 4180 rows: quoted fields may hold commas, quotes ("") and line breaks. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = readFileSync(CSV);
const [head, ...body] = parseCsv(raw.toString("utf8")).filter((r) => r.length > 1);
const col = (name: string) => { const i = head.indexOf(name); ensure(i >= 0, `dpwh_senate.csv has no "${name}" column`); return i; };
const [ID, STATUS, HB, SEN, PAGE] = ["id", "status", "hb_php", "senate_php", "senate_pdf_page"].map(col);
const STATUSES = new Set(["unchanged", "renamed", "cut", "reduced", "raised", "added"]);
for (const r of body) ensure(STATUSES.has(r[STATUS]), `unknown status "${r[STATUS]}" for ${r[ID]}`);

const ix = JSON.parse(readFileSync(IX, "utf8")) as ReviewIndex;
// Our comparison row id (`house-reading:N`) → House bill row id; a few comparison rows hold two bill rows.
const byProject = new Map<string, string[]>();
for (const row of ix.rows) byProject.set(row[1], [...(byProject.get(row[1]) ?? []), row[0]]);
const amountOf = new Map(ix.rows.map((row) => [row[0], row[6]]));

const inCsv = new Set(body.map((r) => r[ID]));
const missing = [...byProject.keys()].filter((id) => !inCsv.has(id));
ensure(missing.length === 0, `${missing.length} reviewer projects are not in the Senate file (${missing.slice(0, 3).join(", ")}…)`);

const cut = body.filter((r) => r[STATUS] === "cut");
for (const r of cut) ensure(Number(r[SEN]) === 0, `${r[ID]} is "cut" but keeps ₱${r[SEN]}`);
const removed: ReviewSenateIndex["removed"] = [];
for (const r of cut) {
  const rows = byProject.get(r[ID]);
  ensure(rows, `the Senate removes ${r[ID]}, which is not a reviewer project`);
  const page = r[PAGE] ? Number(r[PAGE]) : null;
  for (const h of rows) removed.push([h, Number.isFinite(page) ? page : null]);
}
removed.sort((a, b) => a[0].localeCompare(b[0]));
const removedPhp = removed.reduce((a, [h]) => a + (amountOf.get(h) ?? 0), 0);
const csvPhp = cut.reduce((a, r) => a + Number(r[HB]), 0);

const out: ReviewSenateIndex = {
  schema: 1,
  built_at: new Date().toISOString(),
  source: {
    report: "Senate Committee on Finance, Committee Report on HB 10858 (FY 2027 GAB)",
    annex: "Annex A-4",
    file: "dpwh_senate.csv",
    sha256: createHash("sha256").update(raw).digest("hex"),
    rows: body.length,
  },
  removed,
  removed_php: removedPhp,
};
writeFileSync(OUT, `${JSON.stringify(out)}\n`);
const b = (php: number) => `₱${(php / 1e9).toFixed(2)}B`;
console.log(`${OUT}: ${removed.length.toLocaleString("en-US")} House bill rows removed (${cut.length.toLocaleString("en-US")} projects in the Senate file), ` +
  `${b(removedPhp)} by the reviewer's amounts, ${b(csvPhp)} by the Senate file's; source ${out.source.sha256.slice(0, 12)}`);
