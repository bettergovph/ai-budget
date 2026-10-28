/**
 * Where the source workbench places each FY2027 DPWH line, by legislative
 * district: "Projects placed in this district" on the district pages.
 *
 * Writes what `src/lib/hgab-locations.ts` describes:
 *
 *   data/hgab/2027/locations.json   LocationsData
 *
 * Reads:
 *
 *   <src>/analysis/data/location_district_index_2027.json   upstream's location lens (built, not committed upstream)
 *   <src>/analysis/data/comparison_projects_2027.json       the comparison payload the lens was built against
 *   <out>/dpwh/projects.parquet                             our lines: amounts, trace, office (npm run import:hgab)
 *   <out>/districts.json, leaderboard.json                  offices, districts, office groups
 *
 * The lens is upstream's (analysis/web/buildLocationLens.py, method in
 * analysis/docs/location_district_lens_method.md). Upstream gitignores its
 * output, so build it in an upstream checkout first, at a pinned commit, with
 * upstream's own chain (docs/hgab-data.md, "Project locations"):
 *
 *   node analysis/web/buildComparisonData.mjs && node analysis/web/buildCongressIndex.mjs
 *   python3 master_list/scripts/build_processing_dataset.py   (needs the FMR/HFEP/NIA workbenches)
 *   python3 master_list/scripts/build_master_list.py && python3 master_list/scripts/build_location_interpretations.py
 *   python3 master_list/scripts/build_cleaned_dataset.py && python3 analysis/web/buildLocationLens.py
 *
 * Rules:
 *   - the lens's comparison payload must be ours, line for line (id, title, trace, NEP and House amounts),
 *     or nothing is written: a placement is only meaningful against the lines it was built on;
 *   - every line is placed exactly once; bases, targets, gates and flags are upstream's, verbatim;
 *     district targets are our district ids (all 254 shared with upstream, checked);
 *   - a line's office group is the one its House bill office label belongs to (as the leaderboard keys it);
 *     office-change and no-office lines (districts.json) belong to no group, as on the leaderboard;
 *   - our one check on top: a title_psgc line upstream flags office_location_mismatch is held out of every
 *     district (review: outside_office_districts; place_district_mismatch when its chosen place,
 *     title_psgc.district_id, is not even the district it was placed in);
 *   - nothing here names a person: a placement is not the representative's project.
 *
 *   npm run build:hgab-locations -- --src=/tmp/dpwh-nep-head
 *   npm run build:hgab-locations -- --src=<checkout> --out=data/hgab/2027 --contract=src/lib/hgab.ts
 */

import { DuckDBInstance } from "@duckdb/node-api";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DISTRICT_BASES, LOCATION_BASES, LOCATIONS_SCHEMA,
  type DistrictLocated, type LineLocation, type LocatedCell, type LocationBasis, type LocationFlag, type LocationsData,
  LOCATION_REVIEWS, type LocationReview, type OfficeLocatedSummary, type TitleGate,
} from "../src/lib/hgab-locations";

// ---------------------------------------------------------------------------
// Inputs (shapes mirror src/lib/hgab.ts; that module reads import.meta.env, so it is not imported)
// ---------------------------------------------------------------------------

interface DistrictCard { id: string; label: string; office_ids: string[] }
interface OfficeHistory {
  id: string; name: string; kind: string; district_ids: string[];
  years: Array<{ fy: number; stage: string; matched_label: string | null }>;
  fy2027: unknown | null;
}
interface DistrictIndex {
  source_commit: string; districts: DistrictCard[]; offices: Record<string, OfficeHistory>;
  office_change: { rows: number; row_ids: string[] }; no_office: { rows: number; row_ids: string[] };
}
interface Leaderboard { source_commit: string; entries: Array<{ key: string; offices: Array<{ id: string }> }> }

interface LensTitle {
  level: string | null; name: string | null; barangay: string | null; municipality: string | null; province: string | null;
  district_id: string | null;
}
interface LensResolution { basis: LocationBasis; target_id: string; title_psgc: LensTitle | null; title_gate: TitleGate | null }
interface Lens {
  schema_version: number;
  lens: { name: string; authority: string; not_claimed: string; tiers: Record<LocationBasis, string> };
  counts: Record<string, unknown> & { flags: Record<string, number> };
  districts: Record<string, unknown>;
  row_resolution: Record<string, LensResolution>;
  row_flags: Record<string, string[]>;
  input_provenance: Record<string, { path: string; sha256: string }>;
}
interface UpstreamRow { id: string; title: string; trace: string; nep: { amount_php: number | null } | null; third: { amount_php: number | null } | null }

interface Args { src: string; out: string; contract: string }
function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const src = get("src");
  if (!src) throw new Error("build-hgab-locations: --src=<upstream checkout with the lens built> is required");
  return { src: resolve(src), out: resolve(get("out") ?? "data/hgab/2027"), contract: resolve(get("contract") ?? "src/lib/hgab.ts") };
}

const log = (s: string) => process.stdout.write(`${s}\n`);
const num = (v: unknown) => (typeof v === "bigint" ? Number(v) : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : num(v));
const strOrNull = (v: unknown) => (v == null || v === "" ? null : String(v));
const byLabel = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });
function ensure(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`build-hgab-locations: ${msg}`);
}
function readJson<T>(path: string): T {
  ensure(existsSync(path), `${path} not found`);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/** TRACE_LABELS as written in the contract: bridge group, held. */
function contractTraces(path: string): Map<string, { group: string; held: boolean }> {
  const src = readFileSync(path, "utf8");
  const block = /export const TRACE_LABELS[^{]*\{([\s\S]*?)\n\};/.exec(src)?.[1];
  ensure(block, `TRACE_LABELS not found in ${path}`);
  const out = new Map<string, { group: string; held: boolean }>();
  for (const m of block.matchAll(/^\s*([a-z0-9_]+):\s*\{\s*label:\s*'[^']*',\s*group:\s*'([a-z_]+)'(?:,\s*held:\s*(true|false))?/gm)) {
    out.set(m[1], { group: m[2], held: m[3] === "true" });
  }
  ensure(out.size >= 5, `only ${out.size} traces parsed from TRACE_LABELS`);
  return out;
}

type Kind = keyof DistrictLocated["kinds"];
const KIND_OF_GROUP: Record<string, Kind> = {
  house_only: "inserted", increased: "increased", decreased: "decreased", scope_review: "scope_review", unchanged: "unchanged", nep_only: "dropped",
};

const cell = (): LocatedCell => ({ rows: 0, nep_php: 0, house_php: 0 });
function add(c: LocatedCell, l: Line): void {
  c.rows += 1;
  c.nep_php += l.nep ?? 0;
  c.house_php += l.house ?? 0;
}

/** "Barangay 171, City of Caloocan"; "Opol, Misamis Oriental"; the chosen place's own name otherwise. */
function placeLabel(t: LensTitle | null): string | null {
  if (!t) return null;
  const brgy = t.barangay ? (/^(barangay|brgy|poblacion)\b/i.test(t.barangay) || /^\d/.test(t.barangay) ? t.barangay.replace(/^(\d)/, "Barangay $1") : `Barangay ${t.barangay}`) : null;
  const parts = brgy ? [brgy, t.municipality] : t.municipality ? [t.municipality, t.province] : [t.name, t.province];
  const out = parts.filter((x): x is string => Boolean(x)).filter((x, i, a) => a.indexOf(x) === i);
  return out.length ? out.join(", ") : null;
}

// ---------------------------------------------------------------------------
// Office groups (officeGroups in src/lib/hgab-districts.ts, ported as in build-hgab-changes-list.ts)
// ---------------------------------------------------------------------------

interface Group { key: string; offices: OfficeHistory[]; districts: string[] }

function officeGroupsOf(D: DistrictIndex): Map<string, Group> {
  const cards = new Set(D.districts.map((d) => d.id));
  const ledger = Object.values(D.offices).filter((o) => o.kind !== "regional_group");
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const o of ledger) parent.set(`o:${o.id}`, `o:${o.id}`);
  for (const d of D.districts) parent.set(`d:${d.id}`, `d:${d.id}`);
  for (const o of ledger) for (const id of o.district_ids) if (cards.has(id)) union(`o:${o.id}`, `d:${id}`);
  for (const d of D.districts) for (const id of d.office_ids) if (parent.has(`o:${id}`)) union(`d:${d.id}`, `o:${id}`);
  const parts = new Map<string, { offices: OfficeHistory[]; districts: string[] }>();
  const at = (k: string) => { const r = find(k); let g = parts.get(r); if (!g) { g = { offices: [], districts: [] }; parts.set(r, g); } return g; };
  for (const o of ledger) at(`o:${o.id}`).offices.push(o);
  for (const d of D.districts) at(`d:${d.id}`).districts.push(d.id);
  const byOffice = new Map<string, Group>();
  for (const { offices, districts } of parts.values()) {
    if (!offices.length) continue;
    ensure(districts.length > 0, `office group ${offices.map((o) => o.id).join(" + ")} serves no district`);
    const ids = offices.map((o) => o.id).sort();
    const g: Group = { key: districts.length === 1 ? districts[0] : `shared:${ids.join("+")}`, offices, districts: districts.sort(byLabel) };
    for (const o of offices) byOffice.set(o.id, g);
  }
  return byOffice;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

interface Line {
  id: string; trace: string; office: string | null; officeKind: string | null;
  nep: number | null; house: number | null; kind: Kind; held: boolean;
  loc: LineLocation; group: Group | null;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const builtAt = new Date().toISOString();
  const D = readJson<DistrictIndex>(resolve(args.out, "districts.json"));
  const board = readJson<Leaderboard>(resolve(args.out, "leaderboard.json"));
  ensure(board.source_commit === D.source_commit, `leaderboard.json source_commit ${board.source_commit} ≠ districts.json ${D.source_commit}`);
  const lens = readJson<Lens>(resolve(args.src, "analysis/data/location_district_index_2027.json"));
  ensure(lens.schema_version === 1, `lens schema_version ${lens.schema_version}, expected 1`);
  const upstream = readJson<{ projects: UpstreamRow[] }>(resolve(args.src, "analysis/data/comparison_projects_2027.json")).projects;
  const lensCommit = execFileSync("git", ["-C", args.src, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["-C", args.src, "status", "--porcelain", "--untracked-files=no", "--", "analysis/web", "master_list/scripts", "PSGC2LEG", "DEO2LEG"], { encoding: "utf8" }).trim();
  ensure(!dirty, `upstream checkout has modified lens code or inputs:\n${dirty}`);
  const traces = contractTraces(args.contract);

  // Districts: ours and upstream's must be the same 254.
  const ourDistricts = new Set(D.districts.map((d) => d.id));
  const lensDistricts = new Set(Object.keys(lens.districts));
  ensure(ourDistricts.size === 254 && lensDistricts.size === 254, `districts: ours ${ourDistricts.size}, lens ${lensDistricts.size}`);
  for (const id of lensDistricts) ensure(ourDistricts.has(id), `lens district ${id} is not ours`);

  // Offices → groups, as the leaderboard keys them.
  const groups = officeGroupsOf(D);
  const boardKeys = new Set(board.entries.map((e) => e.key));
  for (const g of new Set(groups.values())) ensure(boardKeys.has(g.key) || !g.offices.some((o) => o.fy2027), `office group ${g.key} has 2027 figures but no leaderboard entry`);
  const groupOfLabel = new Map<string, Group>();
  for (const o of Object.values(D.offices)) {
    if (o.kind === "regional_group" || !o.fy2027) continue;
    const label = o.years.find((y) => y.fy === 2027 && y.stage === "hgab3" && y.matched_label)?.matched_label ?? null;
    ensure(label && !label.includes(" + "), `${o.id} has 2027 figures but no single House bill label (${label})`);
    ensure(!groupOfLabel.has(label), `two offices share the House bill label ${label}`);
    groupOfLabel.set(label, groups.get(o.id)!);
  }
  const outOfGroups = new Set([...D.office_change.row_ids, ...D.no_office.row_ids]);

  // Our lines.
  const parquet = resolve(args.out, "dpwh", "projects.parquet");
  ensure(existsSync(parquet), `${parquet} not found — run npm run import:hgab`);
  const db = await DuckDBInstance.create(":memory:");
  const c = await db.connect();
  const rows = (await c.runAndReadAll(
    `SELECT id, title, trace, office, office_kind, nep_php, hgab3_php FROM read_parquet('${parquet.replace(/'/g, "''")}') ORDER BY id`,
  )).getRows();
  ensure(rows.length === upstream.length, `lines: ours ${rows.length}, the lens's comparison ${upstream.length}`);
  const up = new Map(upstream.map((r) => [r.id, r]));
  const res = lens.row_resolution;
  ensure(Object.keys(res).length === rows.length, `lens places ${Object.keys(res).length} lines, we have ${rows.length}`);

  const lines: Line[] = [];
  for (const r of rows) {
    const id = String(r[0]), title = String(r[1]), trace = String(r[2]);
    const nep = numOrNull(r[5]), house = numOrNull(r[6]);
    const u = up.get(id);
    ensure(u, `${id}: not in the lens's comparison payload`);
    ensure(u.title === title, `${id}: title differs from the lens's comparison`);
    ensure(u.trace === trace, `${id}: trace ${trace} ≠ the lens's ${u.trace}`);
    ensure((u.nep?.amount_php ?? null) === nep, `${id}: NEP ${nep} ≠ the lens's ${u.nep?.amount_php}`);
    ensure((u.third?.amount_php ?? null) === house, `${id}: House bill ${house} ≠ the lens's ${u.third?.amount_php}`);
    const t = traces.get(trace);
    ensure(t, `${id}: trace ${trace} is not in TRACE_LABELS`);
    const kind = KIND_OF_GROUP[t.group];
    ensure(kind, `${id}: bridge group ${t.group} has no kind`);
    const z = res[id];
    ensure(z && (LOCATION_BASES as readonly string[]).includes(z.basis), `${id}: lens basis ${z?.basis}`);
    const inDistrict = (DISTRICT_BASES as readonly string[]).includes(z.basis);
    if (inDistrict) ensure(ourDistricts.has(z.target_id), `${id}: placed in ${z.target_id}, not one of our districts`);
    if (z.basis === "deo") ensure(z.target_id.startsWith("office-group:"), `${id}: deo target ${z.target_id}`);
    if (z.basis === "title_psgc") ensure(z.title_gate && z.title_psgc, `${id}: title placement without a gate or a title place`);
    const flags = (lens.row_flags[id] ?? []).slice().sort() as LocationFlag[];
    const placeElsewhere = z.basis === "title_psgc" && z.title_psgc!.district_id !== z.target_id;
    if (placeElsewhere) ensure(flags.includes("office_location_mismatch"), `${id}: chosen place not in the placed district, yet upstream does not flag an office/location mismatch`);
    if (flags.includes("office_location_mismatch")) ensure(z.basis === "title_psgc", `${id}: office_location_mismatch on a ${z.basis} line`);
    const review: LocationReview | null = placeElsewhere ? "place_district_mismatch" : flags.includes("office_location_mismatch") ? "outside_office_districts" : null;
    const office = strOrNull(r[3]);
    lines.push({
      id, trace, office, officeKind: strOrNull(r[4]), nep, house, kind, held: t.held,
      group: office && !outOfGroups.has(id) ? groupOfLabel.get(office) ?? null : null,
      loc: {
        id, basis: z.basis, district: inDistrict && !review ? z.target_id : null, target: z.target_id,
        place: z.basis === "title_psgc" ? placeLabel(z.title_psgc) : null,
        gate: z.basis === "title_psgc" ? z.title_gate : null,
        flags,
        review,
      },
    });
  }

  // Totals per basis, tied to upstream's counts.
  const totals = Object.fromEntries(LOCATION_BASES.map((b) => [b, cell()])) as Record<LocationBasis, LocatedCell>;
  for (const l of lines) add(totals[l.loc.basis], l);
  for (const b of LOCATION_BASES) ensure(totals[b].rows === Number(lens.counts[`${b}_rows`]), `${b}: ${totals[b].rows} lines, lens counts ${lens.counts[`${b}_rows`]}`);
  const flagNames: LocationFlag[] = ["changed_office", "deo_office_conflict", "office_location_mismatch"];
  const flags = Object.fromEntries(flagNames.map((f) => [f, lines.filter((l) => l.loc.flags.includes(f)).length])) as Record<LocationFlag, number>;
  for (const f of flagNames) ensure(flags[f] === (lens.counts.flags[f] ?? 0), `flag ${f}: ${flags[f]} lines, lens counts ${lens.counts.flags[f]}`);
  const heldOut = Object.fromEntries(LOCATION_REVIEWS.map((r) => [r, cell()])) as Record<LocationReview, LocatedCell>;
  for (const l of lines) if (l.loc.review) add(heldOut[l.loc.review], l);

  // Districts.
  const largest = (a: Line, b: Line) => (b.house ?? -1) - (a.house ?? -1) || (b.nep ?? -1) - (a.nep ?? -1) || byLabel(a.id, b.id);
  const byDistrict = new Map<string, Line[]>();
  for (const l of lines) if (l.loc.district) (byDistrict.get(l.loc.district) ?? byDistrict.set(l.loc.district, []).get(l.loc.district)!).push(l);
  const districts: DistrictLocated[] = [];
  for (const d of [...ourDistricts].sort(byLabel)) {
    const here = (byDistrict.get(d) ?? []).sort(largest);
    if (!here.length) continue;
    const own = D.districts.find((x) => x.id === d)!.office_ids.map((id) => groups.get(id)).find(Boolean) ?? null;
    const out: DistrictLocated = {
      district: d,
      kinds: { inserted: cell(), increased: cell(), decreased: cell(), scope_review: cell(), unchanged: cell(), dropped: cell() },
      unconfirmed: { rows: 0, php: 0 },
      all: cell(),
      by_basis: { title_psgc: cell(), deo_to_leg: cell() },
      by_office: { own: cell(), other_deo: cell(), central: cell(), regional: cell() },
      ids: here.map((l) => l.id),
    };
    for (const l of here) {
      add(out.kinds[l.kind], l);
      add(out.all, l);
      add(out.by_basis[l.loc.basis as "title_psgc" | "deo_to_leg"], l);
      if (l.held) { out.unconfirmed.rows += 1; out.unconfirmed.php += l.house ?? 0; }
      const slot = own && l.group === own ? "own"
        : l.officeKind === "Central Office" ? "central"
        : l.officeKind === "Regional offices" ? "regional"
        : "other_deo";
      add(out.by_office[slot], l);
    }
    districts.push(out);
  }
  const placed = districts.reduce((a, d) => a + d.all.rows, 0);
  const held = Object.values(heldOut).reduce((a, x) => a + x.rows, 0);
  ensure(placed + held === totals.title_psgc.rows + totals.deo_to_leg.rows, `districts hold ${placed} lines + ${held} held out ≠ bases title_psgc + deo_to_leg ${totals.title_psgc.rows + totals.deo_to_leg.rows}`);

  // Office groups: where each group's lines are placed.
  const summaries = new Map<string, OfficeLocatedSummary & { _served: Set<string> }>();
  for (const l of lines) {
    if (!l.group) continue;
    let s = summaries.get(l.group.key);
    if (!s) {
      s = { group: l.group.key, all: cell(), per_district: {}, elsewhere: cell(), shared: cell(), unplaced: cell(), held_out: cell(), _served: new Set(l.group.districts) };
      for (const d of l.group.districts) s.per_district[d] = cell();
      summaries.set(l.group.key, s);
    }
    add(s.all, l);
    if (l.loc.review) add(s.held_out, l);
    else if (l.loc.district) add(s._served.has(l.loc.district) ? s.per_district[l.loc.district] : s.elsewhere, l);
    else if (l.loc.basis === "deo") add(s.shared, l);
    else add(s.unplaced, l);
  }
  const offices: OfficeLocatedSummary[] = [...summaries.values()]
    .map((s): OfficeLocatedSummary => ({ group: s.group, all: s.all, per_district: s.per_district, elsewhere: s.elsewhere, shared: s.shared, unplaced: s.unplaced, held_out: s.held_out }))
    .sort((a, b) => byLabel(a.group, b.group));
  for (const s of offices) {
    const parts = Object.values(s.per_district).reduce((a, x) => a + x.rows, 0) + s.elsewhere.rows + s.shared.rows + s.unplaced.rows + s.held_out.rows;
    ensure(parts === s.all.rows, `${s.group}: parts ${parts} ≠ ${s.all.rows} lines`);
    if (!s.group.startsWith("shared:") && s.shared.rows) log(`  note: one-district group ${s.group} has ${s.shared.rows} line(s) the lens keeps with a shared office`);
  }

  const prov = Object.fromEntries(Object.values(lens.input_provenance).map((p) => [p.path, p.sha256]).sort(([a], [b]) => byLabel(a, b)));
  const data: LocationsData = {
    schema: LOCATIONS_SCHEMA,
    built_at: builtAt,
    source_commit: D.source_commit,
    lens_commit: lensCommit,
    lens: { name: lens.lens.name, authority: lens.lens.authority, not_claimed: lens.lens.not_claimed, tiers: lens.lens.tiers },
    totals,
    held_out: heldOut,
    flags,
    lines: lines.map((l) => l.loc),
    districts,
    offices,
    inputs: prov,
    build_notes: [
      "Upstream does not commit the lens output; built here from the pinned commit with upstream's own scripts.",
      "Upstream's committed master-list layers predate its current locations.py, so they were rebuilt before the lens.",
      "The FMR inputs were built from the PSGC shapefiles upstream's CI pins; they matched upstream's recorded hashes.",
    ],
    notes: [
      "A placement is where the documents put the work, not who asked for it.",
      "Title places are provisional: names are matched, sites are not surveyed.",
      "A shared office's lines that no title fixes stay with the office, never split.",
      "NEP and House bill amounts are compared, never added.",
    ],
  };
  const path = resolve(args.out, "locations.json");
  writeFileSync(path, JSON.stringify(data));
  const mb = (readFileSync(path).length / 1e6).toFixed(2);
  log(`locations.json  ${mb} MB  ${lines.length.toLocaleString()} lines  lens ${lensCommit.slice(0, 7)}`);
  for (const b of LOCATION_BASES) log(`  ${b.padEnd(11)} ${String(totals[b].rows).padStart(6)} lines  House ₱${totals[b].house_php.toLocaleString("en-US")}`);
  for (const r of LOCATION_REVIEWS) log(`  held out, ${r}: ${heldOut[r].rows} lines (House ₱${heldOut[r].house_php.toLocaleString("en-US")})`);
  log(`  ${districts.length} districts with placed lines; ${offices.length} office groups; flags ${JSON.stringify(flags)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
