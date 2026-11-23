/**
 * The Senate committee report on HB 10858 for the 2027 House bill's multi-purpose building lines (Jason, 2026-11-23:
 * "We need to add the Senate CR on the MPB pages"): a sidecar to the map's lines (mpb-years/lines.json), so the NEP vs
 * House bill page can add the Senate as a third budget without rebuilding the map.
 *
 * Reads:
 *   data/hgab/2027/mpb-years/lines.json   the map's lines (npm run build:hgab-mpb-years); FY2027 lines with a House amount
 *   data/senate-cr/2027/dpwh_senate.csv   the Senate report pipeline's DPWH mapping (npm run build:senate-cr): one row
 *                                         per House bill project by our id, with its Senate amount and status
 * Writes data/hgab/2027/mpb-years/:
 *   senate.json   one row per House bill multi-purpose building line: [id, Senate amount, status, report page], totals,
 *                 the checks and the CSV's checksum (src/lib/hgab-mpb-years.ts, MpbSenateFile)
 *   senate.csv    the same with titles, offices, the NEP and House amounts and links, for download
 *
 * Checks (the build stops on any): every House bill line has a Senate row, at the same House amount; every status is
 * known; a cut line is at zero and nothing else is; the Senate adds no DPWH project; the totals add up.
 *
 * Usage: npm run build:mpb-senate [-- --senate=path --out=dir]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  MPB_SENATE_STATUSES, decodeMpbLines, type MpbLinesFile, type MpbSenateFile, type MpbSenateStatus, type MpbSenateTally,
} from "../src/lib/hgab-mpb-years";

function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error(`build-mpb-senate: ${msg}`); process.exit(1); }
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));
const ROOT = resolve(import.meta.dirname, "..");
const DATA = join(ROOT, "data");
const LINES = join(DATA, "hgab/2027/mpb-years/lines.json");
const SENATE = resolve(args.senate ?? join(DATA, "senate-cr/2027/dpwh_senate.csv"));
const OUT = resolve(args.out ?? join(DATA, "hgab/2027/mpb-years"));
const SITE = "https://budget.bettergov.ph";
const REPORT_A4 = "https://budget-assets.bettergov.ph/senate/2027/pdf/senate-cr-annex-a4.pdf";

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

/** RFC 4180 rows: quoted fields may hold commas, doubled quotes and line breaks. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function main(): void {
  ensure(existsSync(LINES), `${LINES} missing (npm run build:hgab-mpb-years)`);
  ensure(existsSync(SENATE), `${SENATE} missing (npm run build:senate-cr)`);
  const linesFile = JSON.parse(readFileSync(LINES, "utf8")) as MpbLinesFile;
  const data = decodeMpbLines(linesFile);
  const house = data.lines.filter((l) => l.fy === 2027 && l.house != null);

  const [head, ...body] = parseCsv(readFileSync(SENATE, "utf8").replace(/^\uFEFF/, ""));
  const col = Object.fromEntries(head.map((k, i) => [k, i])) as Record<string, number>;
  for (const k of ["id", "status", "senate_title", "hb_php", "senate_php", "senate_pdf_page"]) ensure(col[k] != null, `${SENATE} has no ${k} column`);
  const senate = new Map(body.map((r) => [r[col.id], r]));
  ensure(senate.size === body.length, "the Senate mapping repeats an id");

  const checks: MpbSenateFile["checks"] = [];
  const check = (key: string, ok: boolean, detail: string) => { checks.push({ key, ok, detail }); ensure(ok, `check ${key}: ${detail}`); };
  const t = (): MpbSenateTally => ({ lines: 0, php: 0 });
  const add = (x: MpbSenateTally, php: number) => { x.lines++; x.php += php; };
  const totals: MpbSenateFile["totals"] = {
    house: t(), senate: t(), cut: t(), cut_inserted: t(), kept_inserted: t(),
    by_status: Object.fromEntries(MPB_SENATE_STATUSES.map((s) => [s, t()])) as Record<MpbSenateStatus, MpbSenateTally>,
  };
  const rows: MpbSenateFile["rows"] = [];
  const csv: string[][] = [];
  const missing: string[] = [], amountOff: string[] = [], unknown: string[] = [], zeroOff: string[] = [];
  for (const l of house) {
    const r = senate.get(l.id);
    if (!r) { missing.push(l.id); continue; }
    const status = r[col.status] as MpbSenateStatus;
    const si = MPB_SENATE_STATUSES.indexOf(status);
    if (si < 0) { unknown.push(`${l.id} ${status}`); continue; }
    const hb = Number(r[col.hb_php]), sp = Number(r[col.senate_php]);
    if (hb !== l.house) amountOff.push(`${l.id} ${hb} vs ${l.house}`);
    if ((status === "cut") !== (sp === 0)) zeroOff.push(`${l.id} ${status} ${sp}`);
    const page = r[col.senate_pdf_page] ? Number(r[col.senate_pdf_page]) : null;
    rows.push([l.id, sp, si, page]);
    add(totals.house, l.house!);
    add(totals.by_status[status], sp);
    const inserted = l.cls === "house_only";
    if (sp > 0) { add(totals.senate, sp); if (inserted) add(totals.kept_inserted, sp); }
    else { add(totals.cut, l.house!); if (inserted) add(totals.cut_inserted, l.house!); }
    csv.push([
      l.id, l.title, r[col.senate_title] && r[col.senate_title] !== l.title ? r[col.senate_title] : "", l.region ?? "", l.office ?? "",
      inserted ? "yes" : "no", l.nep != null ? String(l.nep) : "", String(l.house), String(sp), status, page != null ? String(page) : "",
      page != null ? `${REPORT_A4}#page=${page}` : "", `${SITE}/hgab/2027/dpwh/p/${encodeURIComponent(l.id)}`,
      `${SITE}/senate/2027/dpwh/p/${encodeURIComponent(l.id)}`,
    ]);
  }
  const ids = new Set(house.map((l) => l.id));
  const added = body.filter((r) => r[col.status] === "added" || !r[col.id]?.startsWith("house-reading:")).length;
  check("every-line", missing.length === 0, `every House bill multi-purpose building line (${house.length}) has a Senate row; missing: ${missing.slice(0, 4).join(", ") || "none"}`);
  check("house-amount", amountOff.length === 0, `each Senate row's House amount equals the map's line: ${amountOff.slice(0, 4).join("; ") || "all equal"}`);
  check("statuses", unknown.length === 0, `every status is one of ${MPB_SENATE_STATUSES.join(", ")}: ${unknown.slice(0, 4).join("; ") || "yes"}`);
  check("cut-is-zero", zeroOff.length === 0, `a cut line is at ₱0 and no other line is: ${zeroOff.slice(0, 4).join("; ") || "yes"}`);
  check("no-dpwh-additions", added === 0, `the report adds no DPWH project (${added} rows outside the House bill)`);
  check("adds-up", totals.senate.lines + totals.cut.lines === totals.house.lines && rows.length === ids.size
    && Object.values(totals.by_status).reduce((a, x) => a + x.php, 0) === totals.senate.php,
    `kept ${totals.senate.lines} + cut ${totals.cut.lines} = ${totals.house.lines} House bill lines; statuses add to the Senate total`);

  mkdirSync(OUT, { recursive: true });
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = ["line_id", "title", "senate_title", "region", "dpwh_office", "house_insertion", "nep_php", "house_bill_php", "senate_php",
    "senate_status", "senate_report_page", "senate_report_url", "record_url", "senate_record_url"];
  writeFileSync(join(OUT, "senate.csv"), "\uFEFF" + [header, ...csv].map((r) => r.map(q).join(",")).join("\n") + "\n");
  const builtAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const file: MpbSenateFile = {
    schema: 1, built_at: builtAt,
    source: { file: SENATE.replace(`${ROOT}/`, ""), sha256: sha(SENATE), lines_built_at: linesFile.built_at },
    statuses: MPB_SENATE_STATUSES, rows, totals, checks,
    outputs: { "senate.csv": { sha256: sha(join(OUT, "senate.csv")), bytes: statSync(join(OUT, "senate.csv")).size } },
  };
  writeFileSync(join(OUT, "senate.json"), JSON.stringify(file) + "\n");
  const b = (v: number) => `₱${(v / 1e9).toFixed(2)}B`;
  console.log(`House bill ${totals.house.lines} lines ${b(totals.house.php)} → Senate ${totals.senate.lines} lines ${b(totals.senate.php)}`);
  console.log(`  cut ${totals.cut.lines} (${b(totals.cut.php)}), of them House insertions ${totals.cut_inserted.lines} (${b(totals.cut_inserted.php)}); insertions kept ${totals.kept_inserted.lines} (${b(totals.kept_inserted.php)})`);
  console.log(`  ${MPB_SENATE_STATUSES.map((s) => `${s} ${totals.by_status[s].lines}`).join(", ")}`);
  console.log(`wrote ${OUT}/senate.{json,csv}: ${checks.length} checks passed`);
}

main();
