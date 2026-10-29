/**
 * Multi-purpose buildings (`/hgab/2027/multi-purpose`, DPWH menu): multi-purpose buildings, flood control and
 * the lines around them, FY2020 GAA to the FY2027 House bill.
 *
 * Writes what `src/lib/hgab-history.ts` describes:
 *
 *   data/hgab/2027/history.json   HistoryData (columns, series with parts, sources, checks)
 *   data/hgab/2027/history.csv    one row per series part and column; UTF-8 with BOM, exact integer pesos, empty = null
 *
 * Reads, nothing re-derived from another builder:
 *
 *   data/<dept>/fpaps/year=*                     GAA FY2020–FY2026 per PAP code (thousands of pesos), depts 18, 07, 13
 *   data/2027/<dept>/line_items.parquet          FY2027 NEP (fy = 2027, pesos)
 *   data/hgab/2027/dpwh/projects.parquet         FY2027 House bill, DPWH lines (third reading), and their NEP side
 *   <pbc>/[PBC] 2026 Budget Data Analysis - *.csv  FY2026 NEP, House bill and Senate bill (People's Budget Coalition)
 *   data/hgab/2027/pdf/hb10858-3r-vol-ia.pdf     FY2027 House bill, DepEd and DOH program lines (pdftotext)
 *
 * Every one of these must hold, or nothing is written:
 *   - the tracker's GAA2025 column equals our FY2025 GAA for every part it carries;
 *   - the tracker's BIP and SIPAG subtotals equal the sum of their rows, and every row under them maps to one part;
 *   - the House-bill data's NEP side equals the DBM NEP extract for every DPWH part;
 *   - every FY2027 BIP line maps to one part, and no part with an FY2027 NEP line lacks a House mapping;
 *   - the Volume I-A lines are found once each and their MOOE + capital outlays equal their total.
 *
 *   npm run build:hgab-history
 *   npm run build:hgab-history -- --out=data/hgab/2027 --pbc=<dir> --vol-ia=<pdf>
 */

import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  HISTORY_COLUMNS, HISTORY_CSV_COLUMNS, HISTORY_SCHEMA, HISTORY_SERIES, PBC_COLUMNS, PBC_FILES, sumRows,
  type HistoryCells, type HistoryData, type HistoryList, type HistoryPart, type HistoryPartDef, type HistorySeries, type PbcSheet,
} from "../src/lib/hgab-history";

interface Args { out: string; data: string; pbc: string; volIa: string }
function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const data = resolve(get("data") ?? "data");
  return {
    out: resolve(get("out") ?? "data/hgab/2027"),
    data,
    pbc: resolve(get("pbc") ?? process.env.PBC_2026_DIR ?? "/home/jason/projects/2026-budget/public/citizens-report"),
    volIa: resolve(get("vol-ia") ?? resolve(data, "hgab/2027/pdf/hb10858-3r-vol-ia.pdf")),
  };
}

const log = (s: string) => process.stdout.write(`${s}\n`);
const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : Number(v));
const peso = (n: number | null | undefined) => (n == null ? "—" : `₱${n.toLocaleString("en-US")}`);
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`build-hgab-history: ${msg}`);
}
/** null and 0 both mean "no amount" when two sources are compared. */
const same = (a: number | null, b: number | null) => (a ?? 0) === (b ?? 0);

/** csvCell from src/lib/hgab-query.ts: null → empty, numbers as digits, quote when needed. */
function csvCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 rows (quoted cells, doubled quotes, LF or CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
/** "1,234,000" → 1234000; "+5,000" → 5000; "" → null. Whole pesos only. */
function pesoCell(s: string | undefined): number | null {
  const t = (s ?? "").trim();
  if (t === "") return null;
  const n = Number(t.replace(/[,+]/g, ""));
  ensure(Number.isInteger(n), `not a whole peso amount: "${t}"`);
  return n;
}

const GAA_YEARS = HISTORY_COLUMNS.filter((c) => c.stage === "gaa").map((c) => c.fy);
const col = (key: string) => {
  const i = HISTORY_COLUMNS.findIndex((c) => c.key === key);
  ensure(i >= 0, `column ${key} missing from HISTORY_COLUMNS`);
  return i;
};
const emptyCells = (): (number | null)[] => HISTORY_COLUMNS.map(() => null);
/** A foreign-assisted line in the House-bill data. */
const FOREIGN_PAP = /^Foreign-assisted projects$/;
const likeAny = (field: string, prefixes: readonly string[]) => `(${prefixes.map((p) => `${field} LIKE '${p}%'`).join(" OR ")})`;
const FOREIGN = (field: string) => `(${field} LIKE '3%' AND substr(${field}, 7, 1) = '3')`;
/** The SQL filter for a part's lines (dept + PAP prefixes, or every foreign-assisted DPWH line). */
const partWhere = (p: HistoryPartDef) =>
  p.foreign ? `dept = '18' AND ${FOREIGN("code")}` : `dept = '${p.codes!.dept}' AND ${likeAny("code", p.codes!.prefixes)}`;

async function rows(c: DuckDBConnection, sql: string): Promise<unknown[][]> {
  return (await c.runAndReadAll(sql)).getRows() as unknown[][];
}

async function main(): Promise<void> {
  const args = parseArgs();
  const builtAt = new Date().toISOString();
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  const checks: HistoryData["checks"] = [];
  const check = (key: string, label: string, detail: string) => checks.push({ key, label, ok: true, detail });

  // -------------------------------------------------------------------------
  // GAA FY2020–FY2026: per PAP code and year, from the portal's PAP tables
  // -------------------------------------------------------------------------
  const fpaps = (dept: string) => resolve(args.data, dept, "fpaps", "*", "*.parquet");
  for (const dept of ["18", "07", "13"]) ensure(existsSync(resolve(args.data, dept, "fpaps")), `${resolve(args.data, dept, "fpaps")} not found`);
  await c.run(`CREATE TABLE gaa AS
    SELECT department_id AS dept, CAST(year AS INTEGER) AS fy, code,
           CAST(ROUND(amount * 1000) AS BIGINT) AS php
    FROM read_parquet(['${fpaps("18")}', '${fpaps("07")}', '${fpaps("13")}'], hive_partitioning = true, union_by_name = true)
    WHERE amount > 0 AND code NOT LIKE '%\\_%' ESCAPE '\\'`);
  const years = (await rows(c, "SELECT DISTINCT fy FROM gaa ORDER BY fy")).map((r) => num(r[0]));
  ensure(GAA_YEARS.every((y) => years.includes(y)), `GAA years ${years.join(", ")} do not cover ${GAA_YEARS.join(", ")}`);

  async function gaaPart(p: HistoryPartDef): Promise<{ php: (number | null)[]; projects: (number | null)[]; foreign: (number | null)[] }> {
    const php = emptyCells();
    const projects = emptyCells();
    const foreign = emptyCells();
    if (!p.codes && !p.foreign) return { php, projects, foreign };
    const where = partWhere(p);
    const sql = `SELECT fy, SUM(php), COUNT(DISTINCT code), SUM(CASE WHEN ${FOREIGN("code")} THEN php ELSE 0 END) FROM gaa WHERE ${where} GROUP BY fy`;
    for (const r of await rows(c, sql)) {
      const fy = num(r[0]);
      if (!GAA_YEARS.includes(fy)) continue;
      const i = col(`gaa-${fy}`);
      php[i] = num(r[1]);
      projects[i] = num(r[2]);
      if (p.codes?.dept !== "07" && p.codes?.dept !== "13") foreign[i] = num(r[3]);
    }
    return { php, projects, foreign };
  }

  // -------------------------------------------------------------------------
  // FY2026 NEP, House bill and Senate bill: the People's Budget Coalition tracker
  // -------------------------------------------------------------------------
  interface PbcRow { label: string; gaa2025: number | null; nep: number | null; house: number | null; senate: number | null; used: string | null }
  const pbc = new Map<PbcSheet, PbcRow[]>();
  const pbcSources: HistoryData["sources"] = [];
  for (const sheet of Object.keys(PBC_FILES) as PbcSheet[]) {
    const path = resolve(args.pbc, PBC_FILES[sheet]);
    ensure(existsSync(path), `${path} not found (set --pbc or PBC_2026_DIR)`);
    const table = parseCsv(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    const head = table[0].map((h) => h.trim());
    const at = (name: string) => {
      const i = head.indexOf(name);
      ensure(i > 0, `${PBC_FILES[sheet]}: column ${name} missing`);
      return i;
    };
    const ix = { gaa2025: at(PBC_COLUMNS.gaa2025), nep: at(PBC_COLUMNS.nep), house: at(PBC_COLUMNS.house), senate: at(PBC_COLUMNS.senate) };
    pbc.set(sheet, table.slice(1).filter((r) => (r[0] ?? "").trim() !== "").map((r) => ({
      label: r[0].trim(), gaa2025: pesoCell(r[ix.gaa2025]), nep: pesoCell(r[ix.nep]), house: pesoCell(r[ix.house]), senate: pesoCell(r[ix.senate]), used: null,
    })));
    pbcSources.push({ key: "pbc_files", label: `People's Budget Coalition, FY2026 budget tracker: ${PBC_FILES[sheet]}`, path: basename(path), sha256: sha256(path) });
  }
  function pbcRowsOf(p: HistoryPartDef, owner: string): PbcRow[] {
    if (!p.pbc) return [];
    const found = (pbc.get(p.pbc.sheet) ?? []).filter((r) => p.pbc!.rows.test(r.label));
    for (const r of found) {
      ensure(r.used == null || r.used.split(":")[0] !== owner.split(":")[0], `tracker row "${r.label}" matched twice in ${owner.split(":")[0]}`);
      r.used = owner;
    }
    return found;
  }
  const pbcSum = (rs: PbcRow[], k: "gaa2025" | "nep" | "house" | "senate") => {
    const vals = rs.map((r) => r[k]).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };

  // -------------------------------------------------------------------------
  // FY2027 NEP (DBM extract) and House bill (DPWH lines, third reading)
  // -------------------------------------------------------------------------
  const nepPath = (dept: string) => resolve(args.data, "2027", dept, "line_items.parquet");
  for (const dept of ["18", "07", "13"]) ensure(existsSync(nepPath(dept)), `${nepPath(dept)} not found (npm run import:nep2027)`);
  await c.run(`CREATE TABLE nep AS
    SELECT department_id AS dept, fpap_code AS code, amount AS php
    FROM read_parquet(['${nepPath("18")}', '${nepPath("07")}', '${nepPath("13")}'], union_by_name = true)
    WHERE fy = 2027 AND amount IS NOT NULL`);
  const housePath = resolve(args.data, "hgab/2027/dpwh/projects.parquet");
  ensure(existsSync(housePath), `${housePath} not found (npm run import:hgab)`);
  await c.run(`CREATE TABLE h AS
    SELECT id, program, pap, nep_php, hgab3_php,
      CASE WHEN hgab3_php IS NOT NULL THEN coalesce(json_array_length(record_json->'$.third.records'), 1) ELSE 0 END AS house_lines,
      CASE WHEN nep_php IS NOT NULL THEN coalesce(json_array_length(record_json->'$.nep.records'), 1) ELSE 0 END AS nep_lines
    FROM read_parquet('${housePath}')`);
  const houseRows = (await rows(c, "SELECT id, program, pap, nep_php, hgab3_php, house_lines, nep_lines FROM h")).map((r) => ({
    id: String(r[0]), program: String(r[1] ?? ""), pap: String(r[2] ?? ""),
    nep: r[3] == null ? null : num(r[3]), house: r[4] == null ? null : num(r[4]), houseLines: num(r[5]), nepLines: num(r[6]),
  }));

  async function nepPart(p: HistoryPartDef): Promise<{ php: number | null; foreign: number | null }> {
    if (!p.codes && !p.foreign) return { php: null, foreign: null };
    const r = (await rows(c, `SELECT SUM(php), SUM(CASE WHEN ${FOREIGN("code")} THEN php ELSE 0 END) FROM nep WHERE ${partWhere(p)}`))[0];
    return { php: r[0] == null ? null : num(r[0]), foreign: r[0] == null ? null : num(r[1]) };
  }
  const houseMatch = (p: HistoryPartDef, r: (typeof houseRows)[number]) =>
    !!p.house && (p.house.program ? p.house.program.test(r.program) : true) && (p.house.pap ? p.house.pap.test(r.pap) : true);

  // -------------------------------------------------------------------------
  // FY2027 House bill, DepEd and DOH: Volume I-A as published
  // -------------------------------------------------------------------------
  ensure(existsSync(args.volIa), `${args.volIa} not found: copy House Bill No. 10858 Volume I-A (third reading) there`);
  const volText = execFileSync("pdftotext", ["-layout", args.volIa, "-"], { maxBuffer: 512 * 1024 * 1024 }).toString("utf8");
  ensure(/3RD READING/.test(volText.slice(0, 20000)) && /VOLUME 1A/i.test(volText.slice(0, 20000)), `${args.volIa} is not Volume I-A of the third reading`);
  const volLines = volText.split("\n");
  const pageOfLine: number[] = [];
  {
    let page = 1;
    for (const line of volLines) {
      pageOfLine.push(page);
      page += (line.match(/\f/g) ?? []).length;
    }
  }
  const printed: HistoryData["printed"] = [];

  // -------------------------------------------------------------------------
  // Assemble every series
  // -------------------------------------------------------------------------
  const series: HistorySeries[] = [];
  for (const s of HISTORY_SERIES) {
    const parts: HistoryPart[] = [];
    for (const p of s.parts) {
      const owner = `${s.key}:${p.key}`;
      const { php, projects, foreign } = await gaaPart(p);

      // FY2026 NEP / House / Senate
      const pr = pbcRowsOf(p, owner);
      if (pr.length) {
        php[col("nep-2026")] = pbcSum(pr, "nep");
        php[col("house-2026")] = pbcSum(pr, "house");
        php[col("senate-2026")] = pbcSum(pr, "senate");
        const ours = php[col("gaa-2025")];
        const theirs = pbcSum(pr, "gaa2025");
        ensure(same(ours, theirs), `${owner}: tracker GAA2025 ${peso(theirs)} ≠ our FY2025 GAA ${peso(ours)}`);
      }

      // FY2027 NEP: DBM extract; projects from the House-bill data's NEP side
      const { php: nep27, foreign: nep27Foreign } = await nepPart(p);
      const matched = p.house ? houseRows.filter((r) => houseMatch(p, r)) : [];
      if (s.department === "DPWH") {
        ensure(nep27 == null || p.house, `${owner}: the FY2027 NEP has ${peso(nep27)} but the part has no House-bill mapping`);
        if (p.house) {
          const hNep = matched.reduce((a, r) => a + (r.nep ?? 0), 0);
          ensure(same(hNep, nep27), `${owner}: House-bill data NEP ${peso(hNep)} ≠ DBM NEP ${peso(nep27)}`);
          const isForeign = (r: (typeof houseRows)[number]) => FOREIGN_PAP.test(r.pap);
          const hNepForeign = matched.filter(isForeign).reduce((a, r) => a + (r.nep ?? 0), 0);
          ensure(same(hNepForeign, nep27Foreign), `${owner}: House-bill data foreign-assisted NEP ${peso(hNepForeign)} ≠ DBM ${peso(nep27Foreign)}`);
          const withNep = matched.filter((r) => r.nep != null);
          const withHouse = matched.filter((r) => r.house != null);
          php[col("nep-2027")] = nep27;
          foreign[col("nep-2027")] = nep27 == null ? null : nep27Foreign;
          projects[col("nep-2027")] = withNep.length ? withNep.reduce((a, r) => a + r.nepLines, 0) : null;
          php[col("house-2027")] = withHouse.length ? withHouse.reduce((a, r) => a + (r.house ?? 0), 0) : null;
          foreign[col("house-2027")] = withHouse.length ? withHouse.filter(isForeign).reduce((a, r) => a + (r.house ?? 0), 0) : null;
          projects[col("house-2027")] = withHouse.length ? withHouse.reduce((a, r) => a + r.houseLines, 0) : null;
        }
      } else {
        php[col("nep-2027")] = nep27;
        if (p.printed) {
          const hits = volLines.map((line, i) => ({ m: p.printed!.exec(line), i })).filter((x) => x.m);
          ensure(hits.length === 1, `${owner}: ${hits.length} lines in Volume I-A match ${p.printed}`);
          const [, mooe, co, total] = hits[0].m!.map((v) => v);
          const n = (v: string) => Number(v.replace(/,/g, ""));
          ensure(n(mooe) + n(co) === n(total), `${owner}: Volume I-A MOOE ${mooe} + CO ${co} ≠ ${total}`);
          php[col("house-2027")] = n(total);
          printed.push({ series: s.key, label: p.label, mooe_php: n(mooe), co_php: n(co), total_php: n(total), page: pageOfLine[hits[0].i] });
        }
      }
      if (!s.counted) projects.fill(null);
      parts.push({ key: p.key, label: p.label, php, projects, foreign_php: foreign });
    }

    // Disjoint parts: no PAP code and no House-bill line counted twice within a series
    if (s.department === "DPWH") {
      const coded = s.parts.filter((p) => p.codes);
      for (let i = 0; i < coded.length; i++) for (let j = i + 1; j < coded.length; j++) {
        for (const a of coded[i].codes!.prefixes) for (const b of coded[j].codes!.prefixes) {
          ensure(!a.startsWith(b) && !b.startsWith(a), `${s.key}: parts ${coded[i].key} and ${coded[j].key} share codes ${a}/${b}`);
        }
      }
      for (const r of houseRows) {
        const n = s.parts.filter((p) => houseMatch(p, r)).length;
        ensure(n <= 1, `${s.key}: House-bill line ${r.id} matches ${n} parts`);
      }
    }

    // The tracker's subtotal equals its rows, and every row under it maps to a part
    if (s.pbcTotal) {
      const sheet = pbc.get(s.pbcTotal.sheet) ?? [];
      const total = sheet.filter((r) => s.pbcTotal!.row.test(r.label));
      ensure(total.length === 1, `${s.key}: ${total.length} tracker subtotal rows`);
      const prefix = `${total[0].label} - `.replace(/^Basic Infrastructure Program - $/, "Basic Infrastructure Program (BIP) - ");
      const under = sheet.filter((r) => r.label.startsWith(prefix));
      ensure(under.length > 0, `${s.key}: no tracker rows under "${total[0].label}"`);
      for (const r of under) ensure(r.used?.startsWith(`${s.key}:`), `${s.key}: tracker row "${r.label}" maps to no part`);
      for (const k of ["gaa2025", "nep", "house", "senate"] as const) {
        ensure(same(pbcSum(under, k), total[0][k]), `${s.key}: tracker ${k} rows ${peso(pbcSum(under, k))} ≠ subtotal ${peso(total[0][k])}`);
      }
      check(`pbc_${s.key}_subtotal`, `Tracker ${s.label}: rows add up to the subtotal`, `${under.length} rows; NEP ${peso(total[0].nep)}, House ${peso(total[0].house)}, Senate ${peso(total[0].senate)}`);
    }

    // Every FY2027 BIP line maps to one BIP part
    if (s.key === "bip") {
      for (const r of houseRows.filter((x) => x.pap.startsWith("BIP - "))) {
        ensure(s.parts.some((p) => houseMatch(p, r)), `bip: House-bill line ${r.id} (${r.pap}) maps to no part`);
      }
    }

    const php = sumRows(parts.map((p) => p.php));
    const projects = s.counted ? sumRows(parts.map((p) => p.projects)) : HISTORY_COLUMNS.map(() => null);
    const foreignPhp = sumRows(parts.map((p) => p.foreign_php));

    // The FY2027 list the card opens: the hub's Projects view with the same exact filters. It must add up to the
    // line's FY2027 cells; DOH's list leaves out the program's operating costs, which Volume I-A publishes once.
    let list2027: HistoryList | null = null;
    if (s.list2027) {
      const path = resolve(args.data, "hgab/2027", s.list2027.dataset, "projects.parquet");
      ensure(existsSync(path), `${path} not found (npm run import:hgab)`);
      const cond = Object.entries(s.list2027.params).map(([k, v]) => `${k} = '${v.replace(/'/g, "''")}'`);
      const r = (await rows(c, `SELECT SUM(nep_php), SUM(hgab3_php), COUNT(nep_php), COUNT(hgab3_php) FROM read_parquet('${path}')${cond.length ? ` WHERE ${cond.join(" AND ")}` : ""}`))[0];
      const l = { nep: num(r[0] ?? 0), house: num(r[1] ?? 0), nepRows: num(r[2]), houseRows: num(r[3]) };
      const nepCell = php[col("nep-2027")] ?? 0, houseCell = php[col("house-2027")] ?? 0;
      let unlisted = 0, gap = 0;
      if (s.department === "DPWH") {
        ensure(l.nep === nepCell && l.house === houseCell, `${s.key}: the FY2027 list (${peso(l.nep)} / ${peso(l.house)}) is not the whole line (${peso(nepCell)} / ${peso(houseCell)})`);
      } else {
        // House: the list = the published capital outlays; the rest is the operating costs Volume I-A publishes.
        const pr = printed.find((x) => x.series === s.key);
        ensure(pr && l.house === pr.co_php && houseCell - l.house === pr.mooe_php, `${s.key}: the House list ${peso(l.house)} is not Volume I-A's capital outlays ${peso(pr?.co_php)}`);
        unlisted = pr.mooe_php;
        // NEP: the same operating costs (DBM extract), plus the gap between the list's lines and the total it
        // publishes, which the section's reconciliation already documents (overview.json) — nothing else.
        const ov = JSON.parse(readFileSync(resolve(args.data, "hgab/2027/overview.json"), "utf8")) as { reconciliation?: Array<{ dataset: string; ours_php: number | null; theirs_php: number | null; diff_php: number | null; status: string }> };
        const doc = (ov.reconciliation ?? []).find((x) => x.dataset === s.list2027!.dataset && x.theirs_php === l.nep && x.status === "explained");
        const nepCo = num((await rows(c, `SELECT SUM(php) FROM nep WHERE dept = '${s.parts[0].codes!.dept}' AND code IN (${s.parts[0].codes!.prefixes.map((x) => `'${x}'`).join(", ")})`))[0][0] ?? 0) - unlisted;
        gap = nepCo - l.nep;
        ensure(nepCell - l.nep === unlisted + gap && doc && doc.diff_php === gap && doc.ours_php === nepCo,
          `${s.key}: the NEP list leaves out ${peso(nepCell - l.nep)}: operating costs ${peso(unlisted)} + an undocumented ${peso(gap)}`);
      }
      list2027 = { dataset: s.list2027.dataset, params: { ...s.list2027.params }, nep_php: l.nep, house_php: l.house, nep_rows: l.nepRows, house_rows: l.houseRows, unlisted_php: unlisted, nep_list_gap_php: gap };
      check(`list_${s.key}`, `${s.label}: the 2027 project list adds up to the line`,
        `${l.nepRows} NEP rows ${peso(l.nep)}, ${l.houseRows} House rows ${peso(l.house)}${unlisted ? `; operating costs ${peso(unlisted)} not itemised` : ""}${gap ? `; the published NEP list's lines are ${peso(gap)} short of its total (documented)` : ""}`);
    }
    series.push({ key: s.key, label: s.label, department: s.department, plain: s.plain, php, projects, foreign_php: foreignPhp, parts, overlaps: [...(s.overlaps ?? [])], list2027 });
  }

  // Integer pesos everywhere; nothing negative
  for (const s of series) for (const p of [...s.parts, { key: "total", php: s.php, projects: s.projects, foreign_php: s.foreign_php }]) {
    for (const v of [...p.php, ...p.projects, ...p.foreign_php]) ensure(v == null || (Number.isSafeInteger(v) && v >= 0), `${s.key}:${p.key}: bad cell ${v}`);
    p.foreign_php.forEach((v, i) => ensure(v == null || (p.php[i] != null && v <= p.php[i]!), `${s.key}:${p.key}: foreign-assisted ${peso(v)} exceeds ${peso(p.php[i])}`));
  }

  const carried = HISTORY_SERIES.flatMap((s) => s.parts.filter((p) => p.pbc).map((p) => `${s.key}:${p.key}`));
  check("pbc_gaa2025", "Tracker GAA2025 column equals our FY2025 GAA", `${carried.length} parts, to the peso`);
  check("nep2027_dbm", "House-bill data NEP side equals the DBM NEP extract", "every DPWH part with an FY2027 line, to the peso");
  check("vol_ia_lines", "Volume I-A program lines found once, MOOE + CO = total", printed.map((p) => `${p.label} p.${p.page}`).join("; "));

  const data: HistoryData = {
    schema: HISTORY_SCHEMA,
    built_at: builtAt,
    columns: [...HISTORY_COLUMNS],
    series,
    sources: [
      { key: "gaa", label: "General Appropriations Acts FY2020–FY2026, DBM extracts (BetterGov GAA dataset), PAP level", path: "data/<dept>/fpaps" },
      ...pbcSources,
      { key: "nep2027", label: "FY2027 National Expenditure Program, DBM extract", path: "data/2027/<dept>/line_items.parquet" },
      { key: "house2027", label: "House Bill No. 10858 (third reading), DPWH lines as compared with the NEP", path: "data/hgab/2027/dpwh/projects.parquet" },
      { key: "vol_ia", label: "House Bill No. 10858 (third reading), Volume I-A", path: basename(args.volIa), sha256: sha256(args.volIa) },
    ],
    checks,
    printed,
  };

  const jsonPath = resolve(args.out, "history.json");
  writeFileSync(jsonPath, JSON.stringify(data));

  const lines: string[] = [];
  for (const s of series) {
    const rowsOut: Array<{ part: string; php: HistoryCells; projects: HistoryCells }> = s.parts.map((p) => ({ part: p.label, php: p.php, projects: p.projects }));
    if (s.parts.length > 1) rowsOut.push({ part: "Total", php: s.php, projects: s.projects });
    for (const r of rowsOut) {
      HISTORY_COLUMNS.forEach((cc, i) => {
        const cells: Record<(typeof HISTORY_CSV_COLUMNS)[number], unknown> = {
          series: s.label, part: r.part, department: s.department, fiscal_year: cc.fy, stage: cc.stage, column: cc.label,
          amount_php: r.php[i], project_lines: r.projects[i], source: cc.source,
        };
        lines.push(HISTORY_CSV_COLUMNS.map((k) => csvCell(cells[k])).join(","));
      });
    }
  }
  const csvPath = resolve(args.out, "history.csv");
  writeFileSync(csvPath, `\uFEFF${[HISTORY_CSV_COLUMNS.join(","), ...lines].join("\n")}\n`);

  log(`wrote ${jsonPath} (${(readFileSync(jsonPath).length / 1024).toFixed(1)} KB) and ${csvPath} (${lines.length} rows)`);
  const bn = (v: number | null) => (v == null ? "—" : (v / 1e9).toFixed(1));
  log(`  ${"".padEnd(34)} ${HISTORY_COLUMNS.map((cc) => cc.key.padStart(11)).join("")}`);
  for (const s of series) log(`  ${s.label.padEnd(34)} ${s.php.map((v) => bn(v).padStart(11)).join("")}`);
  for (const ch of checks) log(`  ✓ ${ch.label} (${ch.detail})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
