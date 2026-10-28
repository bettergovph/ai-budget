/**
 * "Write to your representative" (`/hgab/2027/letter`): one formal letter per
 * legislative district, as JSON (the page), plain text (to edit) and PDF (to
 * print and sign).
 *
 * Writes what `src/lib/hgab-letter.ts` describes, under data/hgab/2027/letters/:
 *
 *   index.json      LetterIndex: one line per district
 *   <slug>.json     LetterData
 *   <slug>.txt      letterText(composeLetter(data)), UTF-8 with BOM
 *   <slug>.pdf      letterHtml(composeLetter(data)) on A4, footer on every page (headless Chromium)
 *
 * Read from files the other builders already wrote, nothing re-derived:
 *
 *   overview.json         the document catalogue (the NEP and third-reading volumes the pages cite)
 *   districts.json        districts, seat holders, offices and their FY2027 bridges (npm run build:hgab-districts)
 *   leaderboard.json      the office groups: which districts share an office, and their FY2027 figures (npm run build:hgab-leaderboard)
 *   changes-list.json     every inserted and adjusted line, booked to the office the House bill lists (npm run build:hgab-changes-list)
 *   dpwh/projects.parquet the deletion candidates and every line's pages (npm run import:hgab)
 *   juris-authors.json    the cached bills.juris.ph authors, for an email or phone when a record carries one
 *
 * Rules (the section's):
 *   - recipients are the seat holders of every district the district's office group serves (Tier B:
 *     shared and never split, so every one of them is written to), the district's own seat first;
 *   - the annexes are the group's DPWH lines: inserted (changes-list `inserted`, the unconfirmed matches
 *     flagged), adjusted (`increased`, `decreased`) and dropped (`nep_only_candidate`), each read by the
 *     office label the House bill lists, as the leaderboard and the list do; Central Office, regional,
 *     office-change and no-office lines name no district and are in no letter;
 *   - every group's counts and pesos must equal its leaderboard entry and its offices' bridges, and every
 *     office line of the list must land in exactly one letter, or nothing is written.
 *
 *   npm run build:hgab-letters
 *   npm run build:hgab-letters -- --only=abra-lone,isabela-6th --no-pdf
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ChangesListData, ChangesListRow } from "../src/lib/hgab-changes-list";
import type { LeaderboardData, LeaderEntry } from "../src/lib/hgab-leaderboard";
import {
  LETTER_SCHEMA, composeLetter, letterHtml, letterSlug, letterText,
  type LetterData, type LetterFigures, type LetterIndex, type LetterIndexEntry, type LetterRecipient, type LetterRow,
} from "../src/lib/hgab-letter";

// ---------------------------------------------------------------------------
// Inputs (shapes mirror src/lib/hgab.ts; that module reads import.meta.env, so it is not imported)
// ---------------------------------------------------------------------------

interface Doc { key: string; title: string }
interface Overview { source_commit: string; documents: Doc[] }
interface BridgeCell { rows: number; php: number; nep_php: number | null; house_php: number | null }
interface OfficeHistory {
  id: string; name: string; kind: string; district_ids: string[];
  years: Array<{ fy: number; stage: string; matched_label: string | null }>;
  fy2027: {
    nep_records: number; hgab3_records: number;
    bridge: { house_only: BridgeCell; nep_only: BridgeCell; increased: BridgeCell; decreased: BridgeCell } | null;
  } | null;
}
interface Representative { name: string; status: "resolved" | "ambiguous"; member_code?: string | null; profile_url: string | null; candidates?: Representative[] }
interface DistrictCard {
  id: string; label: string; jurisdiction: string; district_label: string; region: string | null;
  representative: Representative | null; office_ids: string[];
}
interface DistrictIndex {
  source_commit: string; districts: DistrictCard[]; offices: Record<string, OfficeHistory>;
  office_change: { row_ids: string[] }; no_office: { row_ids: string[] };
}
interface JurisAuthor { officialMemberId?: string | null; congress?: number; chamber?: string; email?: unknown; phone?: unknown }

interface Args { out: string; only: Set<string> | null; pdf: boolean }
function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const only = get("only");
  return { out: resolve(get("out") ?? "data/hgab/2027"), only: only ? new Set(only.split(",")) : null, pdf: !argv.includes("--no-pdf") };
}

const q = (s: string) => s.replace(/'/g, "''");
const log = (s: string) => process.stdout.write(`${s}\n`);
const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : num(v));
const peso = (n: number | null | undefined) => (n == null ? "—" : `₱${n.toLocaleString("en-US")}`);
const sum = <T,>(xs: readonly T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0);
function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`build-hgab-letters: ${msg}`);
}
function readJson<T>(path: string): T {
  ensure(existsSync(path), `${path} not found`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** The NEP volume and the third-reading House volume every DPWH line is published in, and how the letter names them. */
const NEP_DOC = "nep2027-vol-iib";
const HOUSE_DOC = "hb10858-3r-vol-ic";
const DOC_NAMES: Record<string, string> = {
  [NEP_DOC]: "the 2027 NEP, Volume II-B (DPWH)",
  [HOUSE_DOC]: "House Bill No. 10858 on third reading, Volume I-C (DPWH)",
};
const DROPPED_TRACE = "nep_only_candidate";

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const FONTS = "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Noto+Serif:ital,wght@0,400;0,700;1,400&display=block";

/** Print styles for letterHtml's `lt-` classes (the page's screen styles are src/hgab-letter.css). */
const PRINT_CSS = `
  @page { size: A4; margin: 20mm 20mm 22mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: 'Noto Serif', Georgia, serif; font-size: 10pt; line-height: 1.45; color: #141414; }
  p { margin: 0 0 7pt; }
  a { color: inherit; text-decoration: none; }
  .lt-head { border-bottom: 1.6pt solid #141414; padding-bottom: 6pt; margin-bottom: 12pt; }
  .lt-head-title { font-family: Inter, sans-serif; font-weight: 700; font-size: 14pt; letter-spacing: 0.04em; text-transform: uppercase; margin: 0 0 6pt; }
  .lt-head-line { font-family: Inter, sans-serif; font-size: 8.5pt; color: #444; margin: 0 0 3pt; }
  .lt-fill { display: inline-block; min-width: 38mm; border-bottom: 0.6pt solid #555; padding: 9pt 2pt 0; font-family: Inter, sans-serif; font-size: 6.4pt; line-height: 1.15; color: #8a8a8a; vertical-align: baseline; }
  .lt-head .lt-fill { min-width: 44mm; }
  .lt-to { margin-bottom: 12pt; }
  .lt-to.is-many { display: grid; grid-template-columns: 1fr 1fr; gap: 9pt 18pt; }
  .lt-to.is-many .lt-addr { font-size: 9.2pt; }
  .lt-addr { font-style: normal; line-height: 1.35; break-inside: avoid; }
  .lt-addr .lt-fill { min-width: 0; }
  .lt-subject { font-weight: 700; margin: 4pt 0 12pt; }
  .lt-h { font-family: Inter, sans-serif; font-size: 9pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin: 12pt 0 5pt; break-after: avoid; }
  .lt-bullets, .lt-requests { margin: 0 0 9pt; padding-left: 18pt; }
  .lt-bullets li, .lt-requests > li { margin-bottom: 4pt; }
  .lt-sub { list-style: lower-alpha; margin: 3pt 0 0; padding-left: 16pt; }
  .lt-closing { margin-top: 14pt; break-inside: avoid; }
  .lt-closing p { margin: 0 0 2pt; }
  .lt-closing .lt-fill { min-width: 70mm; }
  .lt-closing p:last-child { margin-top: 8pt; }
  .lt-sign-space { height: 13mm; }
  .lt-enc { margin-top: 14pt; font-size: 9pt; break-inside: avoid; }
  .lt-enc p { margin: 0 0 2pt; }
  .lt-enc ul { margin: 0; padding-left: 16pt; }
  .lt-page { break-before: page; }
  .lt-sheet { break-after: page; }
  .lt-annex, .lt-notes { margin-bottom: 18pt; }
  .lt-annex-title { font-family: Inter, sans-serif; font-size: 12pt; font-weight: 700; margin: 0 0 4pt; }
  .lt-annex-intro { font-size: 9pt; color: #333; margin-bottom: 8pt; }
  .lt-table { width: 100%; border-collapse: collapse; font-family: Inter, sans-serif; font-size: 7.6pt; line-height: 1.35; }
  .lt-table thead { display: table-header-group; }
  .lt-table th { text-align: left; font-weight: 700; border-bottom: 1pt solid #141414; padding: 3pt 4pt; }
  .lt-table td { border-bottom: 0.4pt solid #cfcfcf; padding: 3pt 4pt; vertical-align: top; }
  .lt-table tr { break-inside: avoid; }
  .lt-table .lt-n { color: #777; width: 7mm; text-align: right; padding-left: 0; }
  .lt-table th:first-child { white-space: nowrap; }
  .lt-table .lt-num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .lt-table .lt-pages { white-space: nowrap; color: #555; }
  .lt-flag { display: inline-block; font-size: 6.4pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #8a1c1c; border: 0.5pt solid #8a1c1c; border-radius: 2pt; padding: 0 2pt; margin-left: 3pt; }
  .lt-total { font-family: Inter, sans-serif; font-size: 8.5pt; font-weight: 700; margin-top: 6pt; }
  .lt-sig td { height: 10.4mm; padding-top: 0; padding-bottom: 0; }
  .lt-sig th:nth-child(2) { width: 30%; } .lt-sig th:nth-child(3) { width: 28%; } .lt-sig th:nth-child(4) { width: 18%; }
  .lt-notes ul { margin: 0; padding-left: 14pt; font-size: 8.6pt; line-height: 1.45; }
  .lt-notes li { margin-bottom: 5pt; }
`;

const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function pageHtml(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS}" rel="stylesheet"><style>${PRINT_CSS}</style></head><body>${body}</body></html>`;
}

function footerTemplate(text: string): string {
  return `<div style="width:100%;padding:0 20mm;font-family:Helvetica,Arial,sans-serif;font-size:7pt;color:#666;display:flex;justify-content:space-between;gap:12px">` +
    `<span>${escHtml(text)}</span><span style="white-space:nowrap">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  const builtAt = new Date().toISOString();
  const overview = readJson<Overview>(resolve(args.out, "overview.json"));
  const D = readJson<DistrictIndex>(resolve(args.out, "districts.json"));
  const L = readJson<LeaderboardData>(resolve(args.out, "leaderboard.json"));
  const C = readJson<ChangesListData>(resolve(args.out, "changes-list.json"));
  for (const [name, commit] of [["districts.json", D.source_commit], ["leaderboard.json", L.source_commit], ["changes-list.json", C.source_commit]] as const) {
    ensure(commit === overview.source_commit, `${name} source_commit ${commit} ≠ overview.json ${overview.source_commit} — rebuild it`);
  }
  const docOf = (key: string) => {
    const d = overview.documents.find((x) => x.key === key);
    ensure(d, `overview.json lists no document ${key}`);
    return { key: d.key, title: DOC_NAMES[key] };
  };
  const documents = { nep: docOf(NEP_DOC), house: docOf(HOUSE_DOC) };

  // bills.juris.ph: an email or phone, when the author record carries one (keyed by the House member code).
  const jurisPath = resolve(args.out, "juris-authors.json");
  const juris = new Map<string, JurisAuthor>();
  if (existsSync(jurisPath)) {
    for (const a of readJson<{ items: JurisAuthor[] }>(jurisPath).items) {
      if (a.chamber === "house" && a.officialMemberId) juris.set(a.officialMemberId, a);
    }
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const withContact = new Set<string>();

  // Office label as the House bill lists it (the office's hgab3 matched_label), as the list and the leaderboard read it.
  const labelOf = new Map<string, string>();
  for (const o of Object.values(D.offices)) {
    if (o.kind === "regional_group" || !o.fy2027) continue;
    const label = o.years.find((y) => y.fy === 2027 && y.stage === "hgab3" && y.matched_label)?.matched_label ?? null;
    ensure(label && !label.includes(" + "), `${o.id} has 2027 figures but no single House bill label (${label})`);
    labelOf.set(o.id, label);
  }
  const heldOut = new Set([...D.office_change.row_ids, ...D.no_office.row_ids]);

  // Every DPWH line's pages, and the deletion candidates by office label.
  const parquet = resolve(args.out, "dpwh", "projects.parquet");
  ensure(existsSync(parquet), `${parquet} not found — run npm run import:hgab`);
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  const pages = new Map<string, { nd: string | null; np: number | null; hd: string | null; hp: number | null }>();
  const droppedByLabel = new Map<string, LetterRow[]>();
  for (const r of (await c.runAndReadAll(`
    SELECT id, trace, title, office, nep_php, nep_doc, nep_page, hgab3_doc, hgab3_page
    FROM read_parquet('${q(parquet)}') ORDER BY id`)).getRows()) {
    const id = String(r[0]);
    pages.set(id, { nd: r[5] == null ? null : String(r[5]), np: numOrNull(r[6]), hd: r[7] == null ? null : String(r[7]), hp: numOrNull(r[8]) });
    if (String(r[1]) !== DROPPED_TRACE || heldOut.has(id) || r[3] == null) continue;
    const list = droppedByLabel.get(String(r[3])) ?? [];
    list.push({ i: id, t: String(r[2] ?? ""), n: numOrNull(r[4]), h: null, d: null, np: numOrNull(r[6]), hp: null });
    droppedByLabel.set(String(r[3]), list);
  }
  c.closeSync(); db.closeSync();

  const rowOf = (x: ChangesListRow): LetterRow => {
    const p = pages.get(x.i);
    ensure(p, `changes-list row ${x.i} is not in dpwh/projects.parquet`);
    return { i: x.i, t: x.t, n: x.n, h: x.h, d: x.d, ...(x.u ? { u: 1 as const } : {}), ...(x.m ? { m: x.m } : {}), np: x.n == null ? null : p.np, hp: x.h == null ? null : p.hp };
  };
  // Every line a letter cites must sit in the two volumes it names.
  const checkDocs = (r: LetterRow) => {
    const p = pages.get(r.i)!;
    ensure(r.n == null || (p.nd === NEP_DOC && r.np), `${r.i}: NEP amount but its page is ${p.nd} p. ${p.np}`);
    ensure(r.h == null || (p.hd === HOUSE_DOC && r.hp), `${r.i}: House amount but its page is ${p.hd} p. ${p.hp}`);
  };

  // The list's office lines, by the office label they are booked to.
  const listByLabel = new Map<string, ChangesListRow[]>();
  for (const x of C.rows) {
    if (x.p !== "dpwh" || x.w !== "office") continue;
    ensure(x.o, `changes-list row ${x.i} is booked to an office but names none`);
    const list = listByLabel.get(x.o) ?? [];
    list.push(x);
    listByLabel.set(x.o, list);
  }

  // Groups: the leaderboard's entries; every district with an engineering office is in exactly one.
  const cards = new Map(D.districts.map((d) => [d.id, d] as const));
  const entryOf = new Map<string, LeaderEntry>();
  for (const e of L.entries) for (const p of e.people) {
    ensure(!entryOf.has(p.district_id), `${p.district_id} is in two leaderboard entries`);
    ensure(cards.has(p.district_id), `leaderboard district ${p.district_id} is not in districts.json`);
    entryOf.set(p.district_id, e);
  }
  const noOffice = new Set(L.totals.districts_without_office.map((d) => d.id));
  for (const d of D.districts) ensure(entryOf.has(d.id) !== noOffice.has(d.id), `${d.id} is ${entryOf.has(d.id) ? "both ranked and without an office" : "in no entry and not listed as without an office"}`);
  const residualPhp = L.totals.by_office_kind.central.hgab3_php + L.totals.by_office_kind.regional.hgab3_php;

  function recipientOf(d: DistrictCard, own: boolean): LetterRecipient {
    const rep = d.representative;
    const status: LetterRecipient["status"] = !rep ? "missing" : rep.status;
    const names = !rep ? [] : rep.status === "ambiguous" ? (rep.candidates ?? []).map((x) => x.name).filter(Boolean) : rep.name ? [rep.name] : [];
    const a = rep?.status === "resolved" && rep.member_code ? juris.get(rep.member_code) : undefined;
    const email = str(a?.email), phone = str(a?.phone);
    if (email || phone) withContact.add(d.id);
    return {
      district_id: d.id, district: d.label, own, status: names.length ? status : "missing", names,
      profile_url: rep?.status === "resolved" ? rep.profile_url : null, email, phone,
    };
  }

  // Per group (one entry = one set of annexes), checked once.
  interface Annexes { inserted: LetterRow[]; adjusted: LetterRow[]; dropped: LetterRow[]; figures: LetterFigures; offices: string[] }
  const annexesOf = new Map<string, Annexes>();
  const usedList = new Set<string>(), usedDropped = new Set<string>();
  for (const e of L.entries) {
    const offices = e.offices.map((o) => {
      const off = D.offices[o.id];
      ensure(off?.fy2027, `${e.key}: office ${o.id} has no FY2027 figures`);
      return off;
    });
    const labels = offices.map((o) => labelOf.get(o.id)!);
    const listed = labels.flatMap((l) => listByLabel.get(l) ?? []);
    const inserted = listed.filter((x) => x.k === "inserted").map(rowOf).sort((a, b) => (b.h ?? 0) - (a.h ?? 0) || (a.i < b.i ? -1 : 1));
    const adjusted = listed.filter((x) => x.k !== "inserted").map(rowOf).sort((a, b) => Math.abs(b.d ?? 0) - Math.abs(a.d ?? 0) || (a.i < b.i ? -1 : 1));
    const dropped = labels.flatMap((l) => droppedByLabel.get(l) ?? []).sort((a, b) => (b.n ?? 0) - (a.n ?? 0) || (a.i < b.i ? -1 : 1));
    for (const r of [...inserted, ...adjusted]) { ensure(!usedList.has(r.i), `${r.i} is in two letters' groups`); usedList.add(r.i); checkDocs(r); }
    for (const r of dropped) { ensure(!usedDropped.has(r.i), `${r.i} is in two letters' groups`); usedDropped.add(r.i); checkDocs(r); }

    const unconfirmed = inserted.filter((r) => r.u);
    const inc = adjusted.filter((r) => (r.d ?? 0) > 0), dec = adjusted.filter((r) => (r.d ?? 0) < 0);
    const bridge = (k: "house_only" | "nep_only" | "increased" | "decreased") => ({
      rows: sum(offices, (o) => o.fy2027!.bridge?.[k].rows ?? 0),
      nep: sum(offices, (o) => o.fy2027!.bridge?.[k].nep_php ?? 0),
      house: sum(offices, (o) => o.fy2027!.bridge?.[k].house_php ?? 0),
    });
    const figures: LetterFigures = {
      nep_php: e.nep_php, nep_rows: sum(offices, (o) => o.fy2027!.nep_records),
      house_php: e.hgab3_php, house_rows: e.hgab3_rows ?? 0,
      inserted_rows: inserted.length, inserted_php: sum(inserted, (r) => r.h ?? 0),
      unconfirmed_rows: unconfirmed.length, unconfirmed_php: sum(unconfirmed, (r) => r.h ?? 0),
      increased_rows: inc.length, increased_php: sum(inc, (r) => r.d ?? 0),
      decreased_rows: dec.length, decreased_php: sum(dec, (r) => r.d ?? 0),
      dropped_rows: dropped.length, dropped_php: sum(dropped, (r) => r.n ?? 0),
      office_change_rows: e.office_change_rows,
    };
    // Tie out: the leaderboard entry, and the offices' bridges.
    const ho = bridge("house_only"), no = bridge("nep_only"), bi = bridge("increased"), bd = bridge("decreased");
    const cells: Array<[string, number, number]> = [
      ["inserted rows = added + held", figures.inserted_rows, e.added_rows + e.held_rows],
      ["inserted pesos = added + held", figures.inserted_php, e.added_php + e.held_php],
      ["unconfirmed rows = held", figures.unconfirmed_rows, e.held_rows],
      ["unconfirmed pesos = held", figures.unconfirmed_php, e.held_php],
      ["inserted rows = bridge house_only", figures.inserted_rows, ho.rows],
      ["inserted pesos = bridge house_only", figures.inserted_php, ho.house],
      ["dropped rows = entry", figures.dropped_rows, e.dropped_rows],
      ["dropped pesos = entry", figures.dropped_php, e.dropped_php],
      ["dropped rows = bridge nep_only", figures.dropped_rows, no.rows],
      ["increased rows = bridge", inc.length, bi.rows],
      ["increased NEP = bridge", sum(inc, (r) => r.n ?? 0), bi.nep],
      ["increased House = bridge", sum(inc, (r) => r.h ?? 0), bi.house],
      ["decreased rows = bridge", dec.length, bd.rows],
      ["decreased NEP = bridge", sum(dec, (r) => r.n ?? 0), bd.nep],
      ["decreased House = bridge", sum(dec, (r) => r.h ?? 0), bd.house],
      ["House rows = offices' records", figures.house_rows, sum(offices, (o) => o.fy2027!.hgab3_records)],
    ];
    const bad = cells.filter(([, ours, theirs]) => ours !== theirs);
    ensure(!bad.length, `${e.key}: ${bad.map(([n, o, t]) => `${n}: ${o} ≠ ${t}`).join("; ")}`);
    annexesOf.set(e.key, { inserted, adjusted, dropped, figures, offices: e.offices.map((o) => o.name) });
  }
  // Every office line of the list, and every office's deletion candidate, is in exactly one group.
  const listOffice = C.rows.filter((x) => x.p === "dpwh" && x.w === "office");
  ensure(usedList.size === listOffice.length, `${usedList.size} list lines in letters ≠ ${listOffice.length} office lines in changes-list.json`);
  const droppedAll = [...droppedByLabel.entries()].filter(([l]) => [...labelOf.values()].includes(l)).reduce((t, [, v]) => t + v.length, 0);
  ensure(usedDropped.size === droppedAll, `${usedDropped.size} deletion candidates in letters ≠ ${droppedAll} under district offices`);
  ensure(usedDropped.size === sum(L.entries, (e) => e.dropped_rows), `${usedDropped.size} deletion candidates ≠ Σ entries ${sum(L.entries, (e) => e.dropped_rows)}`);

  // One letter per district.
  const letters: LetterData[] = [];
  const slugs = new Set<string>();
  for (const d of D.districts) {
    const slug = letterSlug(d.id);
    ensure(slug && !slugs.has(slug), `slug ${slug} (${d.id}) is empty or not unique`);
    slugs.add(slug);
    const e = entryOf.get(d.id) ?? null;
    const a = e ? annexesOf.get(e.key)! : null;
    const others = e ? e.people.filter((p) => p.district_id !== d.id).map((p) => cards.get(p.district_id)!) : [];
    letters.push({
      schema: LETTER_SCHEMA, fiscal_year: 2027, built_at: builtAt, source_commit: overview.source_commit, slug,
      district: { id: d.id, label: d.label, jurisdiction: d.jurisdiction, district_label: d.district_label, region: d.region },
      tier: e ? e.tier : null,
      offices: a ? a.offices : [],
      recipients: [recipientOf(d, true), ...others.map((x) => recipientOf(x, false))],
      figures: a ? a.figures : null,
      inserted: a ? a.inserted : [], adjusted: a ? a.adjusted : [], dropped: a ? a.dropped : [],
      documents, residual_php: residualPhp,
    });
  }

  // Write.
  const dir = resolve(args.out, "letters");
  mkdirSync(dir, { recursive: true });
  if (!args.only) {
    // A district renamed or removed upstream must not leave its old letter behind.
    for (const f of readdirSync(dir)) {
      const slug = f.replace(/\.(json|txt|pdf)$/, "");
      if (f !== "index.json" && !slugs.has(slug)) rmSync(resolve(dir, f));
    }
  }
  const todo = letters.filter((l) => !args.only || args.only.has(l.slug));
  ensure(todo.length, `--only matched no district (${[...(args.only ?? [])].join(", ")})`);
  for (const l of todo) {
    writeFileSync(resolve(dir, `${l.slug}.json`), JSON.stringify(l));
    writeFileSync(resolve(dir, `${l.slug}.txt`), `\uFEFF${letterText(composeLetter(l))}`);
  }
  const index: LetterIndex = {
    schema: LETTER_SCHEMA, fiscal_year: 2027, built_at: builtAt, source_commit: overview.source_commit,
    letters: letters.map((l): LetterIndexEntry => ({
      slug: l.slug, district_id: l.district.id, label: l.district.label, jurisdiction: l.district.jurisdiction, region: l.district.region,
      tier: l.tier, offices: l.offices, recipients: l.recipients.map((r) => r.names.join(" / ")),
      inserted_rows: l.inserted.length, inserted_php: l.figures?.inserted_php ?? 0, adjusted_rows: l.adjusted.length, dropped_rows: l.dropped.length,
    })),
  };
  if (!args.only) writeFileSync(resolve(dir, "index.json"), JSON.stringify(index));

  if (args.pdf) {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      let n = 0;
      for (const l of todo) {
        const doc = composeLetter(l);
        await page.setContent(pageHtml(doc.title, letterHtml(doc)), { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready);
        await page.pdf({
          path: resolve(dir, `${l.slug}.pdf`), format: "A4", printBackground: true, preferCSSPageSize: true,
          displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: footerTemplate(doc.footer),
        });
        if (++n % 25 === 0) log(`  pdf ${n}/${todo.length}`);
      }
    } finally {
      await browser.close();
    }
  }

  const withRows = letters.filter((l) => l.inserted.length + l.adjusted.length + l.dropped.length > 0).length;
  log(`wrote ${todo.length} letter${todo.length === 1 ? "" : "s"} to ${dir} (${args.pdf ? "JSON, text and PDF" : "JSON and text; PDFs skipped"})${args.only ? "" : " and index.json"}`);
  log(`  ${letters.length} districts · ${letters.filter((l) => l.recipients.length > 1).length} letters to more than one representative · ${withRows} with annexes · ${letters.filter((l) => !l.figures).length} with no DPWH district engineering office`);
  log(`  annex lines: ${usedList.size.toLocaleString("en-US")} inserted and adjusted (every office line of changes-list.json) · ${usedDropped.size.toLocaleString("en-US")} deletion candidates · residual (Central Office + regional, in no letter) ${peso(residualPhp)}`);
  log(`  contacts from bills.juris.ph: ${withContact.size} of ${letters.length} seats carry an email or phone`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
