/**
 * "We are not ignorant" (`/hgab/2027/we-are-not-ignorant`): every inserted and
 * adjusted project in the FY2027 House bill, as one list.
 *
 * Writes what `src/lib/hgab-changes-list.ts` describes:
 *
 *   data/hgab/2027/changes-list.json   ChangesListData (one array of rows, short keys, a legend)
 *   data/hgab/2027/changes-list.csv    the same rows; UTF-8 with BOM, exact integer pesos, empty = null
 *
 * Read from files the other builders already wrote, nothing re-derived:
 *
 *   overview.json             candidate_changes (the totals every kind must equal), datasets, documents
 *   <dataset>/projects.parquet the rows (npm run import:hgab)
 *   districts.json            offices, districts, seat holders, office-change and no-office ids (npm run build:hgab-districts)
 *
 * Rules (the section's, verbatim):
 *   - inserted = bridge group house_only through TRACE_LABELS in src/lib/hgab.ts, the unconfirmed
 *     matches (held: fuzzy_candidate, ambiguous) included and flagged; increased / decreased = those
 *     groups. Scope review and unchanged are not listed;
 *   - the House amount is the reading candidate_changes compares (DPWH third reading, the three lists
 *     their one House list); NEP and House are shown side by side, never added;
 *   - a DPWH line is booked to the office the House bill lists (the office's hgab3 matched_label, as
 *     build-hgab-districts.ts wrote it), then to that office's connected group (union-find over district
 *     offices and the districts they serve, as officeGroups in src/lib/hgab-districts.ts): every district
 *     the group serves and each one's seat holder, undivided for a shared group. Office-change and
 *     no-office lines (ids from districts.json), Central Office and regional lines name no district;
 *   - the three lists name no office: region (and the province a health facility lists) only;
 *   - every per-program, per-kind count and peso sum must equal candidate_changes, or nothing is written.
 *
 *   npm run build:hgab-changes-list
 *   npm run build:hgab-changes-list -- --out=data/hgab/2027 --contract=src/lib/hgab.ts
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { displayName } from "../src/lib/hgab-leaderboard";
import { houseCitations } from "../src/lib/hgab-citations";
import {
  CHANGES_LIST_CSV_COLUMNS, CHANGES_LIST_LEGEND, CHANGES_LIST_SCHEMA, CHANGES_LIST_SITE, CHANGE_KINDS, CHANGE_PROGRAMS,
  CHANGE_PROGRAM_LABELS, NO_DISTRICT_REASON, districtsServedText,
  type ChangeKind, type ChangeProgram, type ChangesListData, type ChangesListKindTotals, type ChangesListRow, type DistrictBasis,
} from "../src/lib/hgab-changes-list";

// ---------------------------------------------------------------------------
// Inputs (shapes mirror src/lib/hgab.ts; that module reads import.meta.env, so it is not imported)
// ---------------------------------------------------------------------------

interface Doc { key: string; reading: 2 | 3 | null }
interface DatasetMeta {
  key: ChangeProgram;
  documents: { nep: string[]; house: string[]; controls?: { hgab2: string | null; hgab3: string | null }; same_pages?: { extracted: string; third: string; pages: number } | null };
}
interface CcProgram {
  key: ChangeProgram; house_stage: "hgab2" | "hgab3";
  insertions: { count: number; comparison_rows: number | null; amount_php: number };
  adjustments: {
    increased_count: number; reduced_count: number; increased_php: number; reduced_php: number;
    increased_nep_php: number; increased_house_php: number; reduced_nep_php: number; reduced_house_php: number;
  };
}
interface Overview { source_commit: string; datasets: DatasetMeta[]; documents: Doc[]; candidate_changes?: { programs: CcProgram[] } }
interface Representative { name: string; status: "resolved" | "ambiguous"; candidates?: Array<{ name: string }> }
interface DistrictCard { id: string; label: string; jurisdiction: string; district_label: string; representative: Representative | null; office_ids: string[] }
interface OfficeHistory {
  id: string; name: string; kind: string; district_ids: string[]; tier: "A" | "B";
  years: Array<{ fy: number; stage: string; matched_label: string | null }>;
  fy2027: unknown | null;
}
interface DistrictIndex {
  source_commit: string; districts: DistrictCard[]; offices: Record<string, OfficeHistory>;
  office_change: { rows: number; row_ids: string[] }; no_office: { rows: number; row_ids: string[] };
}

interface Args { out: string; contract: string }
function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  return { out: resolve(get("out") ?? "data/hgab/2027"), contract: resolve(get("contract") ?? "src/lib/hgab.ts") };
}

const q = (s: string) => s.replace(/'/g, "''");
const log = (s: string) => process.stdout.write(`${s}\n`);
const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : num(v));
const strOrNull = (v: unknown) => (v == null || v === "" ? null : String(v));
const peso = (n: number | null | undefined) => (n == null ? "—" : `₱${n.toLocaleString("en-US")}`);
const byLabel = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`build-hgab-changes-list: ${msg}`);
}
function readJson<T>(path: string): T {
  ensure(existsSync(path), `${path} not found`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** TRACE_LABELS as written in the contract: label, bridge group, held. */
function contractTraces(path: string): Map<string, { label: string; group: string; held: boolean }> {
  const src = readFileSync(path, "utf8");
  const block = /export const TRACE_LABELS[^{]*\{([\s\S]*?)\n\};/.exec(src)?.[1];
  ensure(block, `TRACE_LABELS not found in ${path}`);
  const out = new Map<string, { label: string; group: string; held: boolean }>();
  for (const m of block.matchAll(/^\s*([a-z0-9_]+):\s*\{\s*label:\s*'([^']*)',\s*group:\s*'([a-z_]+)'(?:,\s*held:\s*(true|false))?/gm)) {
    out.set(m[1], { label: m[2], group: m[3], held: m[4] === "true" });
  }
  ensure(out.size >= 5, `only ${out.size} traces parsed from TRACE_LABELS`);
  return out;
}

const KIND_OF_GROUP: Record<string, ChangeKind | undefined> = { house_only: "inserted", increased: "increased", decreased: "decreased" };

/** csvCell from src/lib/hgab-query.ts: null → empty, numbers as digits, quote when needed. */
function csvCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------------------------------------------------------------------
// Office groups (officeGroups in src/lib/hgab-districts.ts, ported: that module imports lib/hgab.ts)
// ---------------------------------------------------------------------------

interface Group { offices: OfficeHistory[]; districts: DistrictCard[]; tier: "A" | "B"; ds: string; rp: string[] }

/** repName in src/lib/hgab-districts.ts: an ambiguous seat lists every member named. */
function repName(rep: Representative | null): string | null {
  if (!rep) return null;
  if (rep.status === "ambiguous") {
    if (rep.name) return rep.name;
    const names = (rep.candidates ?? []).map((c) => c.name).filter(Boolean);
    return names.length ? names.join(" / ") : null;
  }
  return rep.name || null;
}

function officeGroupsOf(D: DistrictIndex): Map<string, Group> {
  const cards = new Map(D.districts.map((d) => [d.id, d] as const));
  const ledger = Object.values(D.offices).filter((o) => o.kind !== "regional_group");
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let y = x;
    while (parent.get(y) !== r) { const next = parent.get(y)!; parent.set(y, r); y = next; }
    return r;
  };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const o of ledger) parent.set(`o:${o.id}`, `o:${o.id}`);
  for (const d of D.districts) parent.set(`d:${d.id}`, `d:${d.id}`);
  for (const o of ledger) for (const id of o.district_ids) if (cards.has(id)) union(`o:${o.id}`, `d:${id}`);
  for (const d of D.districts) for (const id of d.office_ids) if (parent.has(`o:${id}`)) union(`d:${d.id}`, `o:${id}`);
  const parts = new Map<string, { offices: OfficeHistory[]; districts: DistrictCard[] }>();
  const at = (k: string) => { const r = find(k); let g = parts.get(r); if (!g) { g = { offices: [], districts: [] }; parts.set(r, g); } return g; };
  for (const o of ledger) at(`o:${o.id}`).offices.push(o);
  for (const d of D.districts) at(`d:${d.id}`).districts.push(d);
  const byOffice = new Map<string, Group>();
  for (const { offices, districts } of parts.values()) {
    if (!offices.length) continue;
    ensure(districts.length > 0, `office group ${offices.map((o) => o.id).join(" + ")} serves no district`);
    districts.sort((a, b) => byLabel(a.label, b.label));
    const tier: "A" | "B" = districts.length > 1 ? "B" : "A";
    for (const o of offices) ensure(o.tier === tier, `${o.id} is Tier ${o.tier} but its group serves ${districts.length} district(s)`);
    const g: Group = { offices, districts, tier, ds: districtsServedText(districts), rp: districts.map((d) => displayName(repName(d.representative))) };
    for (const o of offices) byOffice.set(o.id, g);
  }
  return byOffice;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

interface Built { row: ChangesListRow; records: number; nepDoc: string | null; nepPage: number | null; houseDoc: string | null; housePage: number | null }

async function main(): Promise<void> {
  const args = parseArgs();
  const builtAt = new Date().toISOString();
  const overview = readJson<Overview>(resolve(args.out, "overview.json"));
  const D = readJson<DistrictIndex>(resolve(args.out, "districts.json"));
  ensure(D.source_commit === overview.source_commit, `districts.json source_commit ${D.source_commit} ≠ overview.json ${overview.source_commit} — rebuild districts`);
  const cc = overview.candidate_changes;
  ensure(cc && cc.programs.map((p) => p.key).join() === CHANGE_PROGRAMS.join(), "overview.json has no candidate_changes for the four programs — run npm run import:hgab");
  const traces = contractTraces(args.contract);
  const held = [...traces].filter(([, t]) => t.held).map(([k]) => k).sort();
  ensure(held.join() === "ambiguous,fuzzy_candidate", `TRACE_LABELS held traces are ${held.join(", ")}, not fuzzy_candidate + ambiguous`);
  ensure([...traces.values()].filter((t) => t.held).every((t) => t.group === "house_only"), "a held trace is outside house_only");

  // DPWH: printed office label → office → group; office-change and no-office ids held out of every district.
  const groups = officeGroupsOf(D);
  const officeOfLabel = new Map<string, OfficeHistory>();
  for (const o of Object.values(D.offices)) {
    if (o.kind === "regional_group" || !o.fy2027) continue;
    const label = o.years.find((y) => y.fy === 2027 && y.stage === "hgab3" && y.matched_label)?.matched_label ?? null;
    ensure(label && !label.includes(" + "), `${o.id} has 2027 figures but no single House bill label (${label})`);
    ensure(!officeOfLabel.has(label), `two offices share the House bill label ${label}`);
    ensure(groups.has(o.id), `${o.id} is in no office group`);
    officeOfLabel.set(label, o);
  }
  const officeChange = new Set(D.office_change.row_ids);
  const noOffice = new Set(D.no_office.row_ids);
  ensure(officeChange.size === D.office_change.rows && noOffice.size === D.no_office.rows, "districts.json office_change / no_office row ids disagree with their counts");

  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  const built: Built[] = [];
  const basisCount: Record<string, number> = {};
  for (const p of cc.programs) {
    const key = p.key;
    const meta = overview.datasets.find((d) => d.key === key);
    ensure(meta, `overview.json has no dataset ${key}`);
    const parquet = resolve(args.out, key, "projects.parquet");
    ensure(existsSync(parquet), `${parquet} not found — run npm run import:hgab`);
    const h = `${p.house_stage}_php`;
    const records = key === "dpwh" ? `coalesce(json_array_length(record_json->'$.${p.house_stage === "hgab3" ? "third" : "second"}.records'), 1)` : "1";
    const rows = (await c.runAndReadAll(`
      SELECT id, trace, title, program, pap, region, office, office_kind, nep_php, ${h}, delta_php,
             nep_doc, nep_page, hgab2_doc, hgab2_page, hgab3_doc, hgab3_page,
             CASE WHEN ${h} IS NOT NULL THEN ${records} ELSE 0 END,
             ${key === "hfep" ? "record_json->>'$.record.province'" : "NULL"}
      FROM read_parquet('${q(parquet)}') ORDER BY id`)).getRows();
    const ids = new Set<string>();
    for (const r of rows) {
      const id = String(r[0]);
      ensure(!ids.has(id), `${key}: duplicate id ${id}`);
      ids.add(id);
      const trace = String(r[1]);
      const t = traces.get(trace);
      ensure(t, `${key} ${id}: trace ${trace} is not in TRACE_LABELS`);
      const kind = KIND_OF_GROUP[t.group];
      if (!kind) continue;
      const nep = numOrNull(r[8]), house = numOrNull(r[9]), delta = numOrNull(r[10]);
      if (kind === "inserted") ensure(nep == null && house != null && delta == null, `${key} ${id}: an insertion with NEP ${peso(nep)}, House ${peso(house)}, delta ${peso(delta)}`);
      else {
        ensure(delta != null && (kind === "increased" ? delta > 0 : delta < 0), `${key} ${id}: ${kind} with delta ${peso(delta)}`);
        ensure(nep != null || house != null, `${key} ${id}: adjusted with neither amount`);
        ensure(delta === (house ?? 0) - (nep ?? 0), `${key} ${id}: delta ${peso(delta)} ≠ House ${peso(house)} − NEP ${peso(nep)}`);
      }
      const office = strOrNull(r[6]), officeKind = strOrNull(r[7]);
      let w: DistrictBasis | null = null, tr: "A" | "B" | null = null, ds: string | null = null, rp: string[] | null = null;
      if (key === "dpwh") {
        ensure(office && officeKind, `dpwh ${id}: no office`);
        if (officeChange.has(id)) w = "office_change";
        else if (noOffice.has(id)) w = "no_office";
        else if (officeKind === "Central Office") w = "central";
        else if (officeKind === "Regional offices") w = "regional";
        else {
          ensure(officeKind === "District engineering offices (DEOs)", `dpwh ${id}: office_kind ${officeKind}`);
          const o = officeOfLabel.get(office);
          ensure(o, `dpwh ${id}: district office label "${office}" maps to no office in districts.json`);
          const g = groups.get(o.id)!;
          w = "office"; tr = g.tier; ds = g.ds; rp = g.rp;
        }
        basisCount[w] = (basisCount[w] ?? 0) + 1;
      } else {
        ensure(office == null, `${key} ${id}: the list carries an office (${office})`);
      }
      const cites = houseCitations(
        { hgab2_page: numOrNull(r[14]), hgab3_page: numOrNull(r[16]), hgab2_doc: strOrNull(r[13]), hgab3_doc: strOrNull(r[15]) },
        meta, overview.documents,
      );
      const third = cites.filter((x) => x.reading === 3);
      ensure(house == null || third.length === 1, `${key} ${id}: ${third.length} third-reading House pages`);
      const row: ChangesListRow = {
        i: id, p: key, k: kind, ...(t.held ? { u: 1 as const } : {}), s: t.label,
        t: String(r[2] ?? ""), n: nep, h: house, d: kind === "inserted" ? null : delta,
        ...(num(r[17]) > 1 ? { m: num(r[17]) } : {}),
        r: strOrNull(r[5]),
        ...(key === "hfep" && strOrNull(r[18]) ? { pv: String(r[18]) } : {}),
        ...(key === "hfep" && strOrNull(r[4]) ? { pa: String(r[4]) } : key === "nia" && strOrNull(r[3]) ? { pa: String(r[3]) } : {}),
        o: office, w, tr, ds, rp,
        x: `/hgab/2027/${key}/p/${encodeURIComponent(id)}`,
      };
      ensure(row.t.trim() !== "", `${key} ${id}: no title`);
      built.push({ row, records: kind === "inserted" ? num(r[17]) : 1, nepDoc: strOrNull(r[11]), nepPage: numOrNull(r[12]), houseDoc: third[0]?.doc ?? null, housePage: third[0]?.page ?? null });
    }
  }
  c.closeSync(); db.closeSync();

  // Totals per program and kind; each must equal candidate_changes.
  const zero = (): ChangesListKindTotals => ({ rows: 0, records: 0, nep_php: 0, house_php: 0, delta_php: 0, unconfirmed_rows: 0, unconfirmed_php: 0 });
  const programs = cc.programs.map((p) => {
    const kinds = Object.fromEntries(CHANGE_KINDS.map((k) => [k, zero()])) as Record<ChangeKind, ChangesListKindTotals>;
    for (const b of built.filter((x) => x.row.p === p.key)) {
      const s = kinds[b.row.k];
      s.rows++; s.records += b.records; s.nep_php += b.row.n ?? 0; s.house_php += b.row.h ?? 0; s.delta_php += b.row.d ?? 0;
      if (b.row.u) { s.unconfirmed_rows++; s.unconfirmed_php += b.row.h ?? 0; }
    }
    const a = p.adjustments, k = kinds;
    const cells: Array<[string, number, number]> = [
      ["insertion records", k.inserted.records, p.insertions.count],
      ["insertion rows", k.inserted.rows, p.insertions.comparison_rows ?? p.insertions.count],
      ["insertion House PHP", k.inserted.house_php, p.insertions.amount_php],
      ["increased pairs", k.increased.rows, a.increased_count],
      ["increased NEP", k.increased.nep_php, a.increased_nep_php],
      ["increased House", k.increased.house_php, a.increased_house_php],
      ["increased change", k.increased.delta_php, a.increased_php],
      ["decreased pairs", k.decreased.rows, a.reduced_count],
      ["decreased NEP", k.decreased.nep_php, a.reduced_nep_php],
      ["decreased House", k.decreased.house_php, a.reduced_house_php],
      ["decreased change", -k.decreased.delta_php, a.reduced_php],
    ];
    const bad = cells.filter(([, ours, theirs]) => ours !== theirs);
    ensure(!bad.length, `${p.key}: ${bad.map(([n, o, t]) => `${n} ${o} ≠ candidate_changes ${t}`).join("; ")}`);
    return { key: p.key, label: CHANGE_PROGRAM_LABELS[p.key], house_stage: p.house_stage, kinds };
  });

  // Inserted first, then increased, then decreased (the order the page names them); within each,
  // House amount largest first (no House amount last), then the largest change, then program order and id.
  const order = new Map(CHANGE_PROGRAMS.map((k, i) => [k, i]));
  const kindOrder: Record<string, number> = { inserted: 0, increased: 1, decreased: 2 };
  built.sort((x, y) => (kindOrder[x.row.k] ?? 9) - (kindOrder[y.row.k] ?? 9)
    || (y.row.h ?? -1) - (x.row.h ?? -1) || Math.abs(y.row.d ?? 0) - Math.abs(x.row.d ?? 0)
    || order.get(x.row.p)! - order.get(y.row.p)! || (x.row.i < y.row.i ? -1 : x.row.i > y.row.i ? 1 : 0));

  const rows = built.map((b) => b.row);
  const insertedRecords = programs.reduce((t, p) => t + p.kinds.inserted.records, 0);
  const adjustedRows = programs.reduce((t, p) => t + p.kinds.increased.rows + p.kinds.decreased.rows, 0);
  const data: ChangesListData = {
    schema: CHANGES_LIST_SCHEMA, fiscal_year: 2027, built_at: builtAt, source_commit: overview.source_commit,
    legend: CHANGES_LIST_LEGEND, programs,
    totals: { rows: rows.length, records: insertedRecords + adjustedRows, inserted_records: insertedRecords, adjusted_rows: adjustedRows },
    rows,
  };
  const jsonPath = resolve(args.out, "changes-list.json");
  writeFileSync(jsonPath, JSON.stringify(data));

  const reason = (r: ChangesListRow) => (r.w == null ? NO_DISTRICT_REASON.list : r.w === "office" ? null : NO_DISTRICT_REASON[r.w]);
  const lines = built.map(({ row: r, records, nepDoc, nepPage, houseDoc, housePage }) => {
    const cells: Record<(typeof CHANGES_LIST_CSV_COLUMNS)[number], unknown> = {
      program: CHANGE_PROGRAM_LABELS[r.p], kind: r.k, status_label: r.s, unconfirmed_match: r.u ? "yes" : null,
      title: r.t, detail: r.pa ?? null,
      nep_php: r.n, house_php: r.h, change_php: r.d, house_lines: r.h == null ? null : records,
      region: r.r, province: r.pv ?? null, office: r.o, tier: r.tr, districts_served: r.ds,
      representatives_of_those_districts: r.rp ? r.rp.join("; ") : null, no_district_reason: reason(r),
      record_id: r.i, record_url: `${CHANGES_LIST_SITE}${r.x}`,
      nep_document: r.n == null ? null : nepDoc, nep_page: r.n == null ? null : nepPage,
      house_document: houseDoc, house_page: housePage,
    };
    return CHANGES_LIST_CSV_COLUMNS.map((k) => csvCell(cells[k])).join(",");
  });
  const csvPath = resolve(args.out, "changes-list.csv");
  writeFileSync(csvPath, `\uFEFF${[CHANGES_LIST_CSV_COLUMNS.join(","), ...lines].join("\n")}\n`);

  log(`wrote ${jsonPath} (${(readFileSync(jsonPath).length / 1024 / 1024).toFixed(2)} MB) and ${csvPath} (${(readFileSync(csvPath).length / 1024 / 1024).toFixed(2)} MB)`);
  for (const p of programs) {
    const k = p.kinds;
    log(`  ${p.key.padEnd(4)} inserted ${k.inserted.records.toLocaleString("en-US")} records in ${k.inserted.rows.toLocaleString("en-US")} rows ${peso(k.inserted.house_php)} (unconfirmed ${k.inserted.unconfirmed_rows}, ${peso(k.inserted.unconfirmed_php)})`
      + ` · increased ${k.increased.rows} (${peso(k.increased.nep_php)} → ${peso(k.increased.house_php)}, +${peso(k.increased.delta_php)})`
      + ` · decreased ${k.decreased.rows} (${peso(k.decreased.nep_php)} → ${peso(k.decreased.house_php)}, ${peso(k.decreased.delta_php)})`);
  }
  log(`  DPWH lines by district basis: ${Object.entries(basisCount).map(([k, v]) => `${k} ${v.toLocaleString("en-US")}`).join(" · ")}`);
  log(`  ${rows.length.toLocaleString("en-US")} rows · ${data.totals.records.toLocaleString("en-US")} listed (${insertedRecords.toLocaleString("en-US")} inserted House lines + ${adjustedRows.toLocaleString("en-US")} adjusted) · all equal candidate_changes`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
